use anyhow::{Context, Result, anyhow, bail};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;

pub const PROTOCOL_VERSION: u16 = 1;
pub const BLOCK_SIZE: u32 = 128 * 1024;
pub const MAX_CONTROL_FRAME: usize = 2 * 1024 * 1024;

pub type ContentId = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub node: NodeInfo,
    pub content_id: ContentId,
    pub block_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RequestBody {
    Authenticate {
        nonce: [u8; 32],
        proof: [u8; 32],
    },
    Roots,
    List {
        root_id: String,
        path: String,
    },
    Stat {
        root_id: String,
        path: String,
    },
    ReadBlock {
        root_id: String,
        path: String,
        content_id: ContentId,
        offset: u64,
        length: u32,
    },
    Cancel {
        request_id: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WireRequest {
    pub version: u16,
    pub request_id: u64,
    pub body: RequestBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ResponseBody {
    Authenticated {
        proof: [u8; 32],
        block_size: u32,
    },
    Roots(Vec<RootInfo>),
    Nodes(Vec<NodeInfo>),
    Stat(Option<FileInfo>),
    Block {
        content_id: ContentId,
        total_size: u64,
        offset: u64,
        data: Vec<u8>,
    },
    Cancelled,
    Error {
        code: ErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidRequest,
    Unauthorized,
    NotFound,
    Changed,
    Timeout,
    Io,
    Internal,
}

#[derive(Debug)]
pub struct RemoteError {
    pub code: ErrorCode,
    pub message: String,
}

impl fmt::Display for RemoteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RemoteError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WireResponse {
    pub version: u16,
    pub request_id: u64,
    pub body: ResponseBody,
}

impl WireRequest {
    pub fn new(request_id: u64, body: RequestBody) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            body,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.version != PROTOCOL_VERSION {
            bail!("未対応のP2Pプロトコルです: {}", self.version);
        }
        match &self.body {
            RequestBody::List { root_id, path } | RequestBody::Stat { root_id, path } => {
                validate_root_and_path(
                    root_id,
                    path,
                    matches!(self.body, RequestBody::Stat { .. }),
                )?;
            }
            RequestBody::ReadBlock {
                root_id,
                path,
                offset,
                length,
                ..
            } => {
                validate_root_and_path(root_id, path, true)?;
                if *length == 0 || *length > BLOCK_SIZE || *offset % u64::from(BLOCK_SIZE) != 0 {
                    bail!("ブロック範囲が不正です");
                }
            }
            _ => {}
        }
        Ok(())
    }
}

impl WireResponse {
    pub fn new(request_id: u64, body: ResponseBody) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            body,
        }
    }

    pub fn into_body(self, request_id: u64) -> Result<ResponseBody> {
        if self.version != PROTOCOL_VERSION {
            bail!("未対応のP2P応答です: {}", self.version);
        }
        if self.request_id != request_id {
            bail!("P2P応答のリクエストIDが一致しません");
        }
        if let ResponseBody::Error { code, message } = self.body {
            return Err(RemoteError { code, message }.into());
        }
        Ok(self.body)
    }
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    postcard::to_allocvec(value).context("バイナリP2Pフレームを作成できません")
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T> {
    postcard::from_bytes(bytes).context("バイナリP2Pフレームを解析できません")
}

pub async fn send<T: Serialize>(stream: &mut quinn::SendStream, value: &T) -> Result<usize> {
    let bytes = encode(value)?;
    if bytes.len() > MAX_CONTROL_FRAME {
        bail!("P2Pフレームが大きすぎます");
    }
    stream
        .write_all(&bytes)
        .await
        .context("P2Pフレームを送信できません")?;
    stream
        .finish()
        .context("P2P送信ストリームを完了できません")?;
    Ok(bytes.len())
}

pub async fn receive<T: for<'a> Deserialize<'a>>(
    stream: &mut quinn::RecvStream,
    maximum: usize,
) -> Result<(T, usize)> {
    let bytes = stream
        .read_to_end(maximum)
        .await
        .context("P2Pフレームを受信できません")?;
    let value = decode(&bytes)?;
    Ok((value, bytes.len()))
}

pub fn client_proof(secret: &[u8], nonce: &[u8; 32]) -> [u8; 32] {
    proof(secret, b"yuraive-p2p-client-v1\0", nonce)
}

pub fn server_proof(secret: &[u8], nonce: &[u8; 32]) -> [u8; 32] {
    proof(secret, b"yuraive-p2p-server-v1\0", nonce)
}

pub fn verify_proof(secret: &[u8], label: &[u8], nonce: &[u8; 32], supplied: &[u8; 32]) -> bool {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else {
        return false;
    };
    mac.update(label);
    mac.update(nonce);
    mac.verify_slice(supplied).is_ok()
}

fn proof(secret: &[u8], label: &[u8], nonce: &[u8; 32]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts every key length");
    mac.update(label);
    mac.update(nonce);
    mac.finalize().into_bytes().into()
}

fn validate_root_and_path(root_id: &str, path: &str, require_file: bool) -> Result<()> {
    if root_id.len() != 32 || !root_id.bytes().all(|value| value.is_ascii_hexdigit()) {
        bail!("ルートIDが不正です");
    }
    if path.len() > 4096 || path.contains('\\') || path.contains('\0') {
        bail!("パスが不正です");
    }
    if path.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.chars().any(char::is_control)
    }) && !path.is_empty()
    {
        bail!("安全でないパスです");
    }
    if require_file && path.is_empty() {
        return Err(anyhow!("ファイルパスがありません"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_protocol_round_trips_without_base64() {
        let request = WireRequest::new(
            42,
            RequestBody::ReadBlock {
                root_id: "0123456789abcdef0123456789abcdef".to_owned(),
                path: "audio/rain.flac".to_owned(),
                content_id: [7; 32],
                offset: u64::from(BLOCK_SIZE),
                length: BLOCK_SIZE,
            },
        );
        let encoded = encode(&request).unwrap();
        let decoded: WireRequest = decode(&encoded).unwrap();
        assert_eq!(decoded, request);
        decoded.validate().unwrap();
    }

    #[test]
    fn proof_is_directional_and_rejects_another_secret() {
        let nonce = [9; 32];
        let client = client_proof(b"secret", &nonce);
        let server = server_proof(b"secret", &nonce);
        assert_ne!(client, server);
        assert!(verify_proof(
            b"secret",
            b"yuraive-p2p-client-v1\0",
            &nonce,
            &client
        ));
        assert!(!verify_proof(
            b"another",
            b"yuraive-p2p-client-v1\0",
            &nonce,
            &client
        ));
    }

    #[test]
    fn block_requests_are_aligned_and_bounded() {
        let make = |offset, length| {
            WireRequest::new(
                1,
                RequestBody::ReadBlock {
                    root_id: "0123456789abcdef0123456789abcdef".to_owned(),
                    path: "file.mp3".to_owned(),
                    content_id: [0; 32],
                    offset,
                    length,
                },
            )
        };
        assert!(make(1, BLOCK_SIZE).validate().is_err());
        assert!(make(0, BLOCK_SIZE + 1).validate().is_err());
        assert!(make(0, BLOCK_SIZE).validate().is_ok());
    }

    #[test]
    fn remote_errors_keep_their_machine_readable_code() {
        let response = WireResponse::new(
            9,
            ResponseBody::Error {
                code: ErrorCode::Changed,
                message: "changed".to_owned(),
            },
        );
        let error = response.into_body(9).unwrap_err();
        let remote = error.downcast_ref::<RemoteError>().unwrap();
        assert_eq!(remote.code, ErrorCode::Changed);
        assert_eq!(remote.to_string(), "changed");
    }
}
