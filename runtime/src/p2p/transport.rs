use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use quinn::{ClientConfig, Endpoint, EndpointConfig, ServerConfig, TransportConfig};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::net::UdpSocket;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateIdentity {
    pub certificate: String,
    pub private_key: String,
    pub fingerprint: String,
}

pub fn create_identity() -> Result<CertificateIdentity> {
    let generated = rcgen::generate_simple_self_signed(vec!["p2p.yuraive.local".to_owned()])
        .context("QUIC証明書を生成できません")?;
    let certificate = generated.cert.der().to_vec();
    let private_key = generated.signing_key.serialize_der();
    Ok(CertificateIdentity {
        fingerprint: fingerprint(&certificate),
        certificate: STANDARD.encode(certificate),
        private_key: STANDARD.encode(private_key),
    })
}

pub fn fingerprint(certificate: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(certificate))
}

pub fn server_endpoint(socket: UdpSocket, identity: &CertificateIdentity) -> Result<Endpoint> {
    let certificate = STANDARD
        .decode(&identity.certificate)
        .context("QUIC証明書の保存内容が壊れています")?;
    if fingerprint(&certificate) != identity.fingerprint {
        bail!("QUIC証明書のフィンガープリントが一致しません");
    }
    let private_key = STANDARD
        .decode(&identity.private_key)
        .context("QUIC秘密鍵の保存内容が壊れています")?;
    let mut server = ServerConfig::with_single_cert(
        vec![CertificateDer::from(certificate)],
        PrivatePkcs8KeyDer::from(private_key).into(),
    )
    .context("QUICサーバー証明書を設定できません")?;
    server.transport = transport_config();
    socket
        .set_nonblocking(true)
        .context("QUICソケットを非同期モードにできません")?;
    Endpoint::new(
        EndpointConfig::default(),
        Some(server),
        socket,
        Arc::new(quinn::TokioRuntime),
    )
    .context("QUIC受付を開始できません")
}

pub fn client_endpoint(socket: UdpSocket, expected_fingerprint: &str) -> Result<Endpoint> {
    let expected: [u8; 32] = URL_SAFE_NO_PAD
        .decode(expected_fingerprint)
        .context("接続先証明書のフィンガープリントが壊れています")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("接続先証明書のフィンガープリント長が不正です"))?;
    let crypto = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(PinnedCertificate::new(expected))
        .with_no_client_auth();
    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(crypto)
        .context("QUICクライアント暗号設定を作成できません")?;
    let mut client = ClientConfig::new(Arc::new(quic_crypto));
    client.transport_config(transport_config());
    socket
        .set_nonblocking(true)
        .context("QUICソケットを非同期モードにできません")?;
    let mut endpoint = Endpoint::new(
        EndpointConfig::default(),
        None,
        socket,
        Arc::new(quinn::TokioRuntime),
    )
    .context("QUIC接続元を作成できません")?;
    endpoint.set_default_client_config(client);
    Ok(endpoint)
}

fn transport_config() -> Arc<TransportConfig> {
    let mut transport = TransportConfig::default();
    transport.max_concurrent_bidi_streams(64u32.into());
    transport.max_concurrent_uni_streams(0u8.into());
    transport.keep_alive_interval(Some(Duration::from_secs(10)));
    transport.max_idle_timeout(Some(Duration::from_secs(45).try_into().unwrap()));
    Arc::new(transport)
}

struct PinnedCertificate {
    expected: [u8; 32],
    provider: Arc<CryptoProvider>,
}

impl PinnedCertificate {
    fn new(expected: [u8; 32]) -> Arc<Self> {
        Arc::new(Self {
            expected,
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        })
    }
}

impl fmt::Debug for PinnedCertificate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PinnedCertificate")
            .finish_non_exhaustive()
    }
}

impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let actual: [u8; 32] = Sha256::digest(end_entity.as_ref()).into();
        if constant_time_equal(&actual, &self.expected) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "Yuraive pairing certificate fingerprint mismatch".to_owned(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    let mut difference = 0u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_identity_has_matching_pin() {
        let identity = create_identity().unwrap();
        let certificate = STANDARD.decode(&identity.certificate).unwrap();
        assert_eq!(fingerprint(&certificate), identity.fingerprint);
        assert_eq!(
            URL_SAFE_NO_PAD.decode(&identity.fingerprint).unwrap().len(),
            32
        );
    }

    #[test]
    fn modified_identity_is_rejected_before_listening() {
        let mut identity = create_identity().unwrap();
        identity.fingerprint = URL_SAFE_NO_PAD.encode([0u8; 32]);
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        assert!(server_endpoint(socket, &identity).is_err());
    }
}
