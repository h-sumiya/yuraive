use anyhow::{Context, Result, anyhow, bail};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_util::sync::CancellationToken;

const SIGNAL_MAGIC: &[u8; 4] = b"YSG1";
const SIGNAL_READY: u8 = 1;
const SIGNAL_PEER_LEFT: u8 = 2;
const SIGNAL_CANDIDATES: u8 = 3;
const STUN_SERVER: &str = "stun.cloudflare.com:3478";
const STUN_COOKIE: u32 = 0x2112_A442;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidateKind {
    Local = 1,
    ServerReflexive = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub kind: CandidateKind,
    pub address: SocketAddr,
}

pub struct PreparedSocket {
    pub socket: UdpSocket,
    pub candidates: Vec<Candidate>,
}

pub fn prepare_socket() -> Result<PreparedSocket> {
    let socket =
        UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).context("P2P用UDPソケットを作成できません")?;
    socket
        .set_read_timeout(Some(Duration::from_millis(900)))
        .context("UDPタイムアウトを設定できません")?;
    socket
        .set_write_timeout(Some(Duration::from_secs(1)))
        .context("UDPタイムアウトを設定できません")?;

    let port = socket.local_addr()?.port();
    let mut candidates = BTreeSet::new();
    for interface in if_addrs::get_if_addrs().context("ローカルIPアドレスを取得できません")?
    {
        let ip = interface.ip();
        if should_skip_interface(&interface.name)
            || ip.is_unspecified()
            || ip.is_multicast()
            || ip.is_loopback()
        {
            continue;
        }
        if let IpAddr::V4(value) = ip {
            candidates.insert(Candidate {
                kind: CandidateKind::Local,
                address: SocketAddr::new(IpAddr::V4(value), port),
            });
        }
    }
    if candidates.is_empty() {
        candidates.insert(Candidate {
            kind: CandidateKind::Local,
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        });
    }

    if let Ok(address) = stun_address(&socket) {
        candidates.insert(Candidate {
            kind: CandidateKind::ServerReflexive,
            address,
        });
    }

    Ok(PreparedSocket {
        socket,
        candidates: candidates.into_iter().collect(),
    })
}

fn should_skip_interface(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "lo"
        || name == "lo0"
        || name.starts_with("docker")
        || name.starts_with("veth")
        || name.starts_with("virbr")
        || name.starts_with("br-")
}

pub async fn exchange_candidates_for_role(
    endpoint: &str,
    room: &str,
    role: &str,
    secret: &str,
    local: &[Candidate],
    cancellation: &CancellationToken,
) -> Result<Vec<Candidate>> {
    if role != "host" && role != "client" {
        bail!("シグナリング役割が不正です");
    }
    let base = endpoint.trim_end_matches('/');
    let url = format!("{base}/{room}?role={role}");
    exchange_candidates_with_role(&url, secret, local, cancellation).await
}

async fn exchange_candidates_with_role(
    url: &str,
    secret: &str,
    local: &[Candidate],
    cancellation: &CancellationToken,
) -> Result<Vec<Candidate>> {
    let mut request = url
        .into_client_request()
        .context("シグナリングURLが不正です")?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {secret}")).context("接続シークレットが不正です")?,
    );
    let (mut socket, _) = tokio::select! {
        result = tokio_tungstenite::connect_async(request) => {
            result.context("Cloudflareシグナリングへ接続できません")?
        }
        _ = cancellation.cancelled() => bail!("接続がキャンセルされました"),
    };

    let deadline = tokio::time::sleep(Duration::from_secs(20));
    tokio::pin!(deadline);
    let mut announced = false;
    loop {
        let message = tokio::select! {
            value = socket.next() => value,
            _ = &mut deadline => bail!("接続相手の待機がタイムアウトしました"),
            _ = cancellation.cancelled() => bail!("接続がキャンセルされました"),
        };
        let message = message
            .ok_or_else(|| anyhow!("シグナリング接続が閉じられました"))?
            .context("シグナリングの受信に失敗しました")?;
        match message {
            Message::Binary(bytes) => match decode_signal(&bytes)? {
                Signal::Ready => {
                    if !announced {
                        socket
                            .send(Message::Binary(encode_candidates(local)?.into()))
                            .await
                            .context("接続候補を送信できません")?;
                        announced = true;
                    }
                }
                Signal::PeerLeft => bail!("接続相手が待機を終了しました"),
                Signal::Candidates(candidates) => {
                    if !announced {
                        socket
                            .send(Message::Binary(encode_candidates(local)?.into()))
                            .await
                            .context("接続候補を送信できません")?;
                    }
                    let _ = socket.close(None).await;
                    if candidates.is_empty() {
                        bail!("接続相手から有効な候補が返されませんでした");
                    }
                    return Ok(candidates);
                }
            },
            Message::Ping(value) => socket
                .send(Message::Pong(value))
                .await
                .context("シグナリングのkeepaliveに応答できません")?,
            Message::Close(frame) => {
                let reason = frame
                    .map(|value| value.reason.to_string())
                    .unwrap_or_default();
                bail!("シグナリング接続が閉じられました: {reason}");
            }
            _ => {}
        }
    }
}

pub async fn punch(socket: &UdpSocket, candidates: &[Candidate]) {
    const PUNCH: &[u8] = b"Yuraive QUIC punch v1";
    for _ in 0..4 {
        for candidate in candidates {
            let _ = socket.send_to(PUNCH, candidate.address);
        }
        tokio::time::sleep(Duration::from_millis(35)).await;
    }
}

pub fn routed_local_address(remote: SocketAddr, port: u16) -> Option<SocketAddr> {
    let bind = match remote {
        SocketAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
        SocketAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
    };
    let socket = UdpSocket::bind(bind).ok()?;
    socket.connect(remote).ok()?;
    Some(SocketAddr::new(socket.local_addr().ok()?.ip(), port))
}

fn stun_address(socket: &UdpSocket) -> Result<SocketAddr> {
    let server = STUN_SERVER
        .to_socket_addrs()
        .context("STUNサーバーを名前解決できません")?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| anyhow!("STUNサーバーのIPv4アドレスがありません"))?;
    let mut transaction = [0u8; 12];
    getrandom::fill(&mut transaction).context("STUNトランザクションIDを生成できません")?;
    let mut request = [0u8; 20];
    request[0..2].copy_from_slice(&0x0001u16.to_be_bytes());
    request[4..8].copy_from_slice(&STUN_COOKIE.to_be_bytes());
    request[8..20].copy_from_slice(&transaction);

    for _ in 0..2 {
        socket
            .send_to(&request, server)
            .context("STUN要求を送信できません")?;
        let mut response = [0u8; 1024];
        match socket.recv_from(&mut response) {
            Ok((length, source)) if source.ip() == server.ip() => {
                if let Ok(value) = parse_stun(&response[..length], &transaction) {
                    return Ok(value);
                }
            }
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error).context("STUN応答を受信できません"),
        }
    }
    bail!("STUNサーバーから応答がありません")
}

fn parse_stun(bytes: &[u8], transaction: &[u8; 12]) -> Result<SocketAddr> {
    if bytes.len() < 20
        || u16::from_be_bytes([bytes[0], bytes[1]]) != 0x0101
        || u32::from_be_bytes(bytes[4..8].try_into().unwrap()) != STUN_COOKIE
        || bytes[8..20] != transaction[..]
    {
        bail!("STUN応答ヘッダーが不正です");
    }
    let declared = usize::from(u16::from_be_bytes([bytes[2], bytes[3]]));
    if declared + 20 > bytes.len() {
        bail!("STUN応答が途中で終了しています");
    }
    let mut cursor = 20;
    while cursor + 4 <= declared + 20 {
        let kind = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]);
        let length = usize::from(u16::from_be_bytes([bytes[cursor + 2], bytes[cursor + 3]]));
        let start = cursor + 4;
        let end = start + length;
        if end > bytes.len() {
            bail!("STUN属性が途中で終了しています");
        }
        if kind == 0x0020 && length >= 8 {
            let family = bytes[start + 1];
            let port = u16::from_be_bytes([bytes[start + 2], bytes[start + 3]])
                ^ (STUN_COOKIE >> 16) as u16;
            if family == 0x01 && length >= 8 {
                let cookie = STUN_COOKIE.to_be_bytes();
                let ip = Ipv4Addr::new(
                    bytes[start + 4] ^ cookie[0],
                    bytes[start + 5] ^ cookie[1],
                    bytes[start + 6] ^ cookie[2],
                    bytes[start + 7] ^ cookie[3],
                );
                return Ok(SocketAddr::new(IpAddr::V4(ip), port));
            }
            if family == 0x02 && length >= 20 {
                let mut mask = [0u8; 16];
                mask[..4].copy_from_slice(&STUN_COOKIE.to_be_bytes());
                mask[4..].copy_from_slice(transaction);
                let mut ip = [0u8; 16];
                for index in 0..16 {
                    ip[index] = bytes[start + 4 + index] ^ mask[index];
                }
                return Ok(SocketAddr::new(IpAddr::V6(Ipv6Addr::from(ip)), port));
            }
        }
        cursor = end.div_ceil(4) * 4;
    }
    bail!("STUN応答に外部アドレスがありません")
}

enum Signal {
    Ready,
    PeerLeft,
    Candidates(Vec<Candidate>),
}

fn encode_candidates(candidates: &[Candidate]) -> Result<Vec<u8>> {
    if candidates.len() > 32 {
        bail!("接続候補が多すぎます");
    }
    let mut output = Vec::with_capacity(6 + candidates.len() * 20);
    output.extend_from_slice(SIGNAL_MAGIC);
    output.push(SIGNAL_CANDIDATES);
    output.push(candidates.len() as u8);
    for candidate in candidates {
        output.push(candidate.kind as u8);
        match candidate.address.ip() {
            IpAddr::V4(ip) => {
                output.push(4);
                output.extend_from_slice(&candidate.address.port().to_be_bytes());
                output.extend_from_slice(&ip.octets());
            }
            IpAddr::V6(ip) => {
                output.push(6);
                output.extend_from_slice(&candidate.address.port().to_be_bytes());
                output.extend_from_slice(&ip.octets());
            }
        }
    }
    Ok(output)
}

fn decode_signal(bytes: &[u8]) -> Result<Signal> {
    if bytes.len() < 5 || &bytes[..4] != SIGNAL_MAGIC {
        bail!("シグナリングフレームが不正です");
    }
    match bytes[4] {
        SIGNAL_READY if bytes.len() == 5 => Ok(Signal::Ready),
        SIGNAL_PEER_LEFT if bytes.len() == 5 => Ok(Signal::PeerLeft),
        SIGNAL_CANDIDATES => {
            let count = *bytes
                .get(5)
                .ok_or_else(|| anyhow!("接続候補数がありません"))? as usize;
            if count > 32 {
                bail!("接続候補が多すぎます");
            }
            let mut cursor = 6;
            let mut candidates = BTreeSet::new();
            for _ in 0..count {
                let kind = match bytes.get(cursor) {
                    Some(1) => CandidateKind::Local,
                    Some(2) => CandidateKind::ServerReflexive,
                    _ => bail!("接続候補の種別が不正です"),
                };
                let family = *bytes
                    .get(cursor + 1)
                    .ok_or_else(|| anyhow!("接続候補が途中で終了しています"))?;
                let port = u16::from_be_bytes(
                    bytes
                        .get(cursor + 2..cursor + 4)
                        .ok_or_else(|| anyhow!("接続候補が途中で終了しています"))?
                        .try_into()
                        .unwrap(),
                );
                cursor += 4;
                let ip = match family {
                    4 => {
                        let octets: [u8; 4] = bytes
                            .get(cursor..cursor + 4)
                            .ok_or_else(|| anyhow!("IPv4候補が途中で終了しています"))?
                            .try_into()
                            .unwrap();
                        cursor += 4;
                        IpAddr::V4(Ipv4Addr::from(octets))
                    }
                    6 => {
                        let octets: [u8; 16] = bytes
                            .get(cursor..cursor + 16)
                            .ok_or_else(|| anyhow!("IPv6候補が途中で終了しています"))?
                            .try_into()
                            .unwrap();
                        cursor += 16;
                        IpAddr::V6(Ipv6Addr::from(octets))
                    }
                    _ => bail!("接続候補のアドレス種別が不正です"),
                };
                if port != 0 && !ip.is_unspecified() && !ip.is_multicast() {
                    candidates.insert(Candidate {
                        kind,
                        address: SocketAddr::new(ip, port),
                    });
                }
            }
            if cursor != bytes.len() {
                bail!("接続候補フレームに余分なデータがあります");
            }
            Ok(Signal::Candidates(candidates.into_iter().collect()))
        }
        _ => bail!("未対応のシグナリングフレームです"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_frame_round_trips_ipv4_and_ipv6() {
        let values = vec![
            Candidate {
                kind: CandidateKind::Local,
                address: "192.168.1.4:43100".parse().unwrap(),
            },
            Candidate {
                kind: CandidateKind::ServerReflexive,
                address: "[2001:db8::1]:50000".parse().unwrap(),
            },
        ];
        let frame = encode_candidates(&values).unwrap();
        let Signal::Candidates(decoded) = decode_signal(&frame).unwrap() else {
            panic!("unexpected signal");
        };
        assert_eq!(decoded, values);
    }

    #[test]
    fn malformed_candidate_frame_is_rejected() {
        assert!(decode_signal(b"YSG1\x03\x01\x01").is_err());
        assert!(decode_signal(b"old-json").is_err());
    }

    #[test]
    fn parses_xor_mapped_stun_address() {
        let transaction = [3u8; 12];
        let address: SocketAddr = "203.0.113.8:54321".parse().unwrap();
        let cookie = STUN_COOKIE.to_be_bytes();
        let mut response = vec![0u8; 32];
        response[0..2].copy_from_slice(&0x0101u16.to_be_bytes());
        response[2..4].copy_from_slice(&12u16.to_be_bytes());
        response[4..8].copy_from_slice(&cookie);
        response[8..20].copy_from_slice(&transaction);
        response[20..22].copy_from_slice(&0x0020u16.to_be_bytes());
        response[22..24].copy_from_slice(&8u16.to_be_bytes());
        response[25] = 1;
        response[26..28]
            .copy_from_slice(&(address.port() ^ (STUN_COOKIE >> 16) as u16).to_be_bytes());
        let IpAddr::V4(ip) = address.ip() else {
            unreachable!()
        };
        for (target, (value, mask)) in response[28..32]
            .iter_mut()
            .zip(ip.octets().into_iter().zip(cookie))
        {
            *target = value ^ mask;
        }
        assert_eq!(parse_stun(&response, &transaction).unwrap(), address);
    }

    #[test]
    fn ignores_loopback_aliases_and_container_bridges() {
        for name in ["lo", "lo0", "docker0", "veth123", "virbr0", "br-a1b2"] {
            assert!(should_skip_interface(name), "{name}");
        }
        for name in ["eth0", "wlan0", "tun0", "Ethernet", "Wi-Fi"] {
            assert!(!should_skip_interface(name), "{name}");
        }
    }

    #[test]
    fn resolves_the_local_address_selected_for_a_route() {
        let local = routed_local_address("127.0.0.1:9".parse().unwrap(), 43210).unwrap();
        assert_eq!(local, "127.0.0.1:43210".parse().unwrap());
    }
}
