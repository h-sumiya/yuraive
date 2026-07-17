use super::protocol::{
    BLOCK_SIZE, ContentId, ErrorCode, FileInfo, MAX_CONTROL_FRAME, NodeInfo, RequestBody,
    ResponseBody, RootInfo, WireRequest, WireResponse, receive, send, server_proof, verify_proof,
};
use super::signaling::{
    Candidate, exchange_candidates_for_role, prepare_socket, punch, routed_local_address,
};
use super::transport::{CertificateIdentity, server_endpoint};
use anyhow::{Context, Result, anyhow, bail};
use crossbeam_channel::{Receiver, Sender};
use dashmap::DashMap;
use futures_util::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

const HASH_INDEX_VERSION: u16 = 1;
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub endpoint: String,
    pub room: String,
    pub secret: String,
    pub cache_directory: String,
    pub certificate: String,
    pub private_key: String,
    pub fingerprint: String,
}

impl HostConfig {
    fn validate(&self) -> Result<()> {
        if !self.endpoint.starts_with("wss://") {
            bail!("シグナリング接続先はwss://で指定してください");
        }
        if !(22..=64).contains(&self.room.len())
            || !self
                .room
                .bytes()
                .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-')
        {
            bail!("ルームIDが不正です");
        }
        if self.secret.len() != 43
            || !self
                .secret
                .bytes()
                .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-')
        {
            bail!("接続シークレットが不正です");
        }
        Ok(())
    }

    fn identity(&self) -> CertificateIdentity {
        CertificateIdentity {
            certificate: self.certificate.clone(),
            private_key: self.private_key.clone(),
            fingerprint: self.fingerprint.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSnapshot {
    pub state: HostPhase,
    pub detail: Option<String>,
    pub sequence: u64,
    pub updated_at_ms: u64,
    pub local_address: Option<String>,
    pub remote_address: Option<String>,
    pub rtt_ms: Option<u64>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub local_candidates: Vec<Candidate>,
    pub remote_candidates: Vec<Candidate>,
    pub selected_candidate: Option<Candidate>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HostPhase {
    Starting,
    WaitingForPeer,
    Punching,
    Connecting,
    Connected,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequest {
    pub id: u64,
    pub method: ProviderMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderMethod {
    Roots,
    List,
    Stat,
    Read,
}

enum ProviderReply {
    Json(Vec<u8>),
    Bytes { total_size: u64, data: Vec<u8> },
    Error(String),
}

struct ProviderInner {
    requests: Sender<ProviderRequest>,
    next_id: AtomicU64,
    pending: DashMap<u64, oneshot::Sender<ProviderReply>>,
}

#[derive(Clone)]
struct Provider(Arc<ProviderInner>);

impl Provider {
    async fn request_json<T: for<'a> Deserialize<'a>>(
        &self,
        method: ProviderMethod,
        root_id: Option<&str>,
        path: Option<&str>,
    ) -> Result<T> {
        let reply = self
            .request(ProviderRequest {
                id: 0,
                method,
                root_id: root_id.map(str::to_owned),
                path: path.map(str::to_owned),
                offset: None,
                count: None,
            })
            .await?;
        match reply {
            ProviderReply::Json(bytes) => {
                serde_json::from_slice(&bytes).context("Windowsファイル応答を解析できません")
            }
            ProviderReply::Error(message) => bail!(message),
            ProviderReply::Bytes { .. } => bail!("Windowsから不正なファイル応答を受信しました"),
        }
    }

    async fn read(
        &self,
        root_id: &str,
        path: &str,
        offset: u64,
        count: u32,
    ) -> Result<(Vec<u8>, u64)> {
        let reply = self
            .request(ProviderRequest {
                id: 0,
                method: ProviderMethod::Read,
                root_id: Some(root_id.to_owned()),
                path: Some(path.to_owned()),
                offset: Some(offset),
                count: Some(count),
            })
            .await?;
        match reply {
            ProviderReply::Bytes { total_size, data } => Ok((data, total_size)),
            ProviderReply::Error(message) => bail!(message),
            ProviderReply::Json(_) => bail!("Windowsから不正な読み込み応答を受信しました"),
        }
    }

    async fn request(&self, mut request: ProviderRequest) -> Result<ProviderReply> {
        request.id = self.0.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.0.pending.insert(request.id, sender);
        if self.0.requests.send(request.clone()).is_err() {
            self.0.pending.remove(&request.id);
            bail!("Windowsファイルプロバイダーが停止しています");
        }
        match tokio::time::timeout(PROVIDER_TIMEOUT, receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => bail!("Windowsファイルプロバイダーが応答を中断しました"),
            Err(_) => {
                self.0.pending.remove(&request.id);
                bail!("Windowsファイル読み込みがタイムアウトしました")
            }
        }
    }

    fn respond(&self, id: u64, reply: ProviderReply) -> bool {
        self.0
            .pending
            .remove(&id)
            .is_some_and(|(_, sender)| sender.send(reply).is_ok())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HashIndex {
    version: u16,
    entries: HashMap<String, HashRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HashRecord {
    size: u64,
    modified_at: i64,
    content_id: ContentId,
    accessed_at_ms: u64,
}

struct ContentIndex {
    path: PathBuf,
    state: Mutex<HashIndex>,
}

impl ContentIndex {
    fn open(directory: &Path) -> Result<Self> {
        fs::create_dir_all(directory).context("ホストP2Pキャッシュを作成できません")?;
        let path = directory.join("content-index.bin");
        let state = fs::read(&path)
            .ok()
            .and_then(|bytes| postcard::from_bytes::<HashIndex>(&bytes).ok())
            .filter(|value| value.version == HASH_INDEX_VERSION)
            .unwrap_or_else(|| HashIndex {
                version: HASH_INDEX_VERSION,
                entries: HashMap::new(),
            });
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }

    fn get(&self, key: &str, node: &NodeInfo) -> Option<ContentId> {
        let mut state = self.state.lock().unwrap();
        let record = state.entries.get_mut(key)?;
        if record.size != node.size || record.modified_at != node.modified_at {
            state.entries.remove(key);
            return None;
        }
        record.accessed_at_ms = now_ms();
        Some(record.content_id)
    }

    fn put(&self, key: String, node: &NodeInfo, content_id: ContentId) -> Result<()> {
        let bytes = {
            let mut state = self.state.lock().unwrap();
            state.entries.insert(
                key,
                HashRecord {
                    size: node.size,
                    modified_at: node.modified_at,
                    content_id,
                    accessed_at_ms: now_ms(),
                },
            );
            if state.entries.len() > 20_000 {
                let mut records: Vec<_> = state
                    .entries
                    .iter()
                    .map(|(key, value)| (key.clone(), value.accessed_at_ms))
                    .collect();
                records.sort_by_key(|(_, accessed)| *accessed);
                for (key, _) in records.into_iter().take(2_000) {
                    state.entries.remove(&key);
                }
            }
            postcard::to_allocvec(&*state).context("コンテンツ索引を作成できません")?
        };
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", fastrand::u64(..)));
        fs::write(&temporary, bytes).context("コンテンツ索引を保存できません")?;
        fs::rename(&temporary, &self.path).context("コンテンツ索引を置換できません")?;
        Ok(())
    }
}

struct HostShared {
    config: HostConfig,
    provider: Provider,
    index: ContentIndex,
    snapshot: Mutex<HostSnapshot>,
    cancellation: CancellationToken,
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
}

pub struct HostSession {
    shared: Arc<HostShared>,
    request_receiver: Receiver<ProviderRequest>,
    thread: Mutex<Option<JoinHandle<()>>>,
    closed: AtomicBool,
}

impl HostSession {
    pub fn start(config: HostConfig) -> Result<Arc<Self>> {
        config.validate()?;
        let (request_sender, request_receiver) = crossbeam_channel::bounded(128);
        let provider = Provider(Arc::new(ProviderInner {
            requests: request_sender,
            next_id: AtomicU64::new(1),
            pending: DashMap::new(),
        }));
        let shared = Arc::new(HostShared {
            index: ContentIndex::open(Path::new(&config.cache_directory))?,
            config,
            provider,
            snapshot: Mutex::new(HostSnapshot {
                state: HostPhase::Starting,
                detail: None,
                sequence: 1,
                updated_at_ms: now_ms(),
                local_address: None,
                remote_address: None,
                rtt_ms: None,
                bytes_sent: 0,
                bytes_received: 0,
                local_candidates: Vec::new(),
                remote_candidates: Vec::new(),
                selected_candidate: None,
            }),
            cancellation: CancellationToken::new(),
            bytes_sent: AtomicU64::new(0),
            bytes_received: AtomicU64::new(0),
        });
        let session = Arc::new(Self {
            shared: Arc::clone(&shared),
            request_receiver,
            thread: Mutex::new(None),
            closed: AtomicBool::new(false),
        });
        let thread = std::thread::Builder::new()
            .name("yuraive-p2p-host".to_owned())
            .spawn(move || host_thread(shared))
            .context("P2Pホストスレッドを開始できません")?;
        *session.thread.lock().unwrap() = Some(thread);
        Ok(session)
    }

    pub fn snapshot(&self) -> HostSnapshot {
        let mut value = self.shared.snapshot.lock().unwrap().clone();
        value.bytes_sent = self.shared.bytes_sent.load(Ordering::Relaxed);
        value.bytes_received = self.shared.bytes_received.load(Ordering::Relaxed);
        value
    }

    pub fn poll_request(&self, timeout: Duration) -> Option<ProviderRequest> {
        self.request_receiver.recv_timeout(timeout).ok()
    }

    pub fn respond_json(&self, id: u64, json: &[u8]) -> bool {
        self.shared
            .provider
            .respond(id, ProviderReply::Json(json.to_vec()))
    }

    pub fn respond_bytes(&self, id: u64, total_size: u64, data: &[u8]) -> bool {
        self.shared.provider.respond(
            id,
            ProviderReply::Bytes {
                total_size,
                data: data.to_vec(),
            },
        )
    }

    pub fn respond_error(&self, id: u64, message: String) -> bool {
        self.shared
            .provider
            .respond(id, ProviderReply::Error(message))
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.shared.cancellation.cancel();
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}

impl Drop for HostSession {
    fn drop(&mut self) {
        self.close();
    }
}

fn host_thread(shared: Arc<HostShared>) {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("yuraive-p2p-host-io")
        .build()
    {
        Ok(value) => value,
        Err(error) => {
            shared.set_status(HostPhase::Error, Some(error.to_string()), None, None, None);
            return;
        }
    };
    runtime.block_on(host_loop(Arc::clone(&shared)));
    shared.set_status(HostPhase::Stopped, None, None, None, None);
}

async fn host_loop(shared: Arc<HostShared>) {
    let mut delay = Duration::from_secs(1);
    while !shared.cancellation.is_cancelled() {
        match host_once(Arc::clone(&shared)).await {
            Ok(()) => delay = Duration::from_secs(1),
            Err(error) if !shared.cancellation.is_cancelled() => {
                shared.set_status(HostPhase::Error, Some(error.to_string()), None, None, None);
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = shared.cancellation.cancelled() => break,
                }
                delay = (delay * 2).min(Duration::from_secs(20));
            }
            Err(_) => break,
        }
    }
}

async fn host_once(shared: Arc<HostShared>) -> Result<()> {
    shared.reset_path();
    shared.set_status(HostPhase::Starting, None, None, None, None);
    let prepared = tokio::task::spawn_blocking(prepare_socket)
        .await
        .context("UDP候補収集を開始できません")??;
    let local = prepared
        .candidates
        .first()
        .map(|value| value.address.to_string());
    let local_port = prepared.socket.local_addr()?.port();
    shared.set_candidates(&prepared.candidates, &[], None);
    shared.set_status(HostPhase::WaitingForPeer, None, local.clone(), None, None);
    let remote = exchange_candidates_for_role(
        &shared.config.endpoint,
        &shared.config.room,
        "host",
        &shared.config.secret,
        &prepared.candidates,
        &shared.cancellation,
    )
    .await?;
    shared.set_candidates(&prepared.candidates, &remote, None);
    shared.set_status(HostPhase::Punching, None, local.clone(), None, None);
    punch(&prepared.socket, &remote).await;
    let endpoint = server_endpoint(prepared.socket, &shared.config.identity())?;
    shared.set_status(HostPhase::Connecting, None, local.clone(), None, None);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let connection = accept_any(&endpoint, deadline, &shared.cancellation).await?;
        let selected = remote
            .iter()
            .copied()
            .find(|value| value.address == connection.remote_address());
        shared.set_candidates(&prepared.candidates, &remote, selected);
        let selected_local = connection
            .local_ip()
            .map(|ip| SocketAddr::new(ip, local_port))
            .or_else(|| routed_local_address(connection.remote_address(), local_port))
            .map(|value| value.to_string())
            .or_else(|| local.clone());
        if handle_connection(Arc::clone(&shared), connection, selected_local).await {
            break;
        }
    }
    endpoint.close(0u8.into(), b"session ended");
    endpoint.wait_idle().await;
    Ok(())
}

async fn accept_any(
    endpoint: &quinn::Endpoint,
    deadline: tokio::time::Instant,
    cancellation: &CancellationToken,
) -> Result<quinn::Connection> {
    let mut handshakes = FuturesUnordered::new();
    let mut errors = Vec::new();
    loop {
        tokio::select! {
            incoming = endpoint.accept() => {
                let incoming = incoming.ok_or_else(|| anyhow!("QUIC受付が終了しました"))?;
                handshakes.push(async move {
                    tokio::time::timeout(Duration::from_secs(10), incoming)
                        .await
                        .context("QUICハンドシェイクがタイムアウトしました")?
                        .context("QUICハンドシェイクに失敗しました")
                });
            }
            result = handshakes.next(), if !handshakes.is_empty() => match result {
                Some(Ok(connection)) => return Ok(connection),
                Some(Err(error)) => errors.push(error.to_string()),
                None => {}
            },
            _ = tokio::time::sleep_until(deadline) => {
                if errors.is_empty() {
                    bail!("QUIC直接接続がタイムアウトしました");
                }
                bail!("QUIC直接接続がタイムアウトしました: {}", errors.join("; "));
            }
            _ = cancellation.cancelled() => bail!("接続がキャンセルされました"),
        }
    }
}

async fn handle_connection(
    shared: Arc<HostShared>,
    connection: quinn::Connection,
    selected_local: Option<String>,
) -> bool {
    let mut authenticated = false;
    let result = async {
        let (mut send_stream, mut receive_stream) = tokio::select! {
            value = connection.accept_bi() => value.context("認証ストリームを受け付けられません")?,
            _ = tokio::time::sleep(Duration::from_secs(8)) => bail!("QUIC接続認証がタイムアウトしました"),
            _ = shared.cancellation.cancelled() => bail!("接続がキャンセルされました"),
        };
        let (request, received): (WireRequest, usize) =
            receive(&mut receive_stream, MAX_CONTROL_FRAME).await?;
        shared.bytes_received.fetch_add(received as u64, Ordering::Relaxed);
        let (nonce, proof) = match request.body {
            RequestBody::Authenticate { nonce, proof } => (nonce, proof),
            _ => bail!("QUIC接続の最初の要求が認証ではありません"),
        };
        if request.version != super::protocol::PROTOCOL_VERSION
            || !verify_proof(
                shared.config.secret.as_bytes(),
                b"yuraive-p2p-client-v1\0",
                &nonce,
                &proof,
            )
        {
            let response = WireResponse::new(
                request.request_id,
                ResponseBody::Error {
                    code: ErrorCode::Unauthorized,
                    message: "接続相手を認証できません".to_owned(),
                },
            );
            let sent = send(&mut send_stream, &response).await?;
            shared.bytes_sent.fetch_add(sent as u64, Ordering::Relaxed);
            bail!("QUIC接続相手の共有シークレットが一致しません");
        }
        let response = WireResponse::new(
            request.request_id,
            ResponseBody::Authenticated {
                proof: server_proof(shared.config.secret.as_bytes(), &nonce),
                block_size: BLOCK_SIZE,
            },
        );
        let sent = send(&mut send_stream, &response).await?;
        shared.bytes_sent.fetch_add(sent as u64, Ordering::Relaxed);
        let stats = connection.stats();
        shared.set_status(
            HostPhase::Connected,
            None,
            selected_local,
            Some(connection.remote_address().to_string()),
            Some(stats.path.rtt.as_millis().try_into().unwrap_or(u64::MAX)),
        );
        authenticated = true;

        loop {
            let streams = tokio::select! {
                value = connection.accept_bi() => value,
                _ = shared.cancellation.cancelled() => break,
            };
            let Ok((send_stream, receive_stream)) = streams else { break };
            let request_shared = Arc::clone(&shared);
            tokio::spawn(async move {
                if let Err(error) = handle_request(request_shared, send_stream, receive_stream).await {
                    let _ = error;
                }
            });
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = result {
        connection.close(1u8.into(), b"authentication or session error");
        if authenticated && !shared.cancellation.is_cancelled() {
            shared.set_status(HostPhase::Error, Some(error.to_string()), None, None, None);
        }
    }
    authenticated
}

async fn handle_request(
    shared: Arc<HostShared>,
    mut send_stream: quinn::SendStream,
    mut receive_stream: quinn::RecvStream,
) -> Result<()> {
    let (request, received): (WireRequest, usize) =
        receive(&mut receive_stream, MAX_CONTROL_FRAME).await?;
    shared
        .bytes_received
        .fetch_add(received as u64, Ordering::Relaxed);
    let request_id = request.request_id;
    let body = match request.validate() {
        Ok(()) => match process_request(&shared, request.body).await {
            Ok(value) => value,
            Err(error) => ResponseBody::Error {
                code: classify_error(&error),
                message: error.to_string(),
            },
        },
        Err(error) => ResponseBody::Error {
            code: ErrorCode::InvalidRequest,
            message: error.to_string(),
        },
    };
    let sent = send(&mut send_stream, &WireResponse::new(request_id, body)).await?;
    shared.bytes_sent.fetch_add(sent as u64, Ordering::Relaxed);
    Ok(())
}

async fn process_request(shared: &HostShared, request: RequestBody) -> Result<ResponseBody> {
    match request {
        RequestBody::Roots => Ok(ResponseBody::Roots(
            shared
                .provider
                .request_json::<Vec<RootInfo>>(ProviderMethod::Roots, None, None)
                .await?,
        )),
        RequestBody::List { root_id, path } => Ok(ResponseBody::Nodes(
            shared
                .provider
                .request_json::<Vec<NodeInfo>>(ProviderMethod::List, Some(&root_id), Some(&path))
                .await?,
        )),
        RequestBody::Stat { root_id, path } => Ok(ResponseBody::Stat(
            stat_file(shared, &root_id, &path).await?,
        )),
        RequestBody::ReadBlock {
            root_id,
            path,
            content_id,
            offset,
            length,
        } => {
            let current = stat_file(shared, &root_id, &path)
                .await?
                .ok_or_else(|| anyhow!("ファイルが見つかりません"))?;
            if current.content_id != content_id {
                bail!("ファイルは接続後に変更されました");
            }
            if offset >= current.node.size {
                bail!("要求ブロックの位置がファイルサイズを超えています");
            }
            let expected = (current.node.size - offset).min(u64::from(BLOCK_SIZE));
            if u64::from(length) != expected {
                bail!("要求ブロックの範囲がファイルサイズと一致しません");
            }
            let (data, total_size) = shared
                .provider
                .read(&root_id, &path, offset, length)
                .await?;
            if total_size != current.node.size || data.len() != length as usize {
                bail!("Windowsから返されたブロックのサイズが一致しません");
            }
            Ok(ResponseBody::Block {
                content_id,
                total_size,
                offset,
                data,
            })
        }
        RequestBody::Cancel { .. } => Ok(ResponseBody::Cancelled),
        RequestBody::Authenticate { .. } => bail!("認証要求は接続確立後に再送できません"),
    }
}

async fn stat_file(shared: &HostShared, root_id: &str, path: &str) -> Result<Option<FileInfo>> {
    let node: Option<NodeInfo> = shared
        .provider
        .request_json(ProviderMethod::Stat, Some(root_id), Some(path))
        .await?;
    let Some(node) = node else { return Ok(None) };
    if node.is_directory {
        return Ok(None);
    }
    let key = format!("{root_id}\0{path}");
    let content_id = if let Some(value) = shared.index.get(&key, &node) {
        value
    } else {
        let value = hash_provider_file(&shared.provider, root_id, path, node.size).await?;
        shared.index.put(key, &node, value)?;
        value
    };
    Ok(Some(FileInfo {
        node,
        content_id,
        block_size: BLOCK_SIZE,
    }))
}

async fn hash_provider_file(
    provider: &Provider,
    root_id: &str,
    path: &str,
    expected_size: u64,
) -> Result<ContentId> {
    let mut hash = Sha256::new();
    let mut offset = 0u64;
    while offset < expected_size {
        let count = (expected_size - offset).min(1024 * 1024) as u32;
        let (data, total_size) = provider.read(root_id, path, offset, count).await?;
        if total_size != expected_size || data.len() != count as usize {
            bail!("ファイルハッシュ計算中にファイルが変更されました");
        }
        hash.update(&data);
        offset += u64::from(count);
    }
    Ok(hash.finalize().into())
}

impl HostShared {
    fn reset_path(&self) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.local_candidates.clear();
        snapshot.remote_candidates.clear();
        snapshot.selected_candidate = None;
    }

    fn set_candidates(
        &self,
        local_candidates: &[Candidate],
        remote_candidates: &[Candidate],
        selected_candidate: Option<Candidate>,
    ) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.local_candidates = local_candidates.to_vec();
        snapshot.remote_candidates = remote_candidates.to_vec();
        snapshot.selected_candidate = selected_candidate;
    }

    fn set_status(
        &self,
        state: HostPhase,
        detail: Option<String>,
        local_address: Option<String>,
        remote_address: Option<String>,
        rtt_ms: Option<u64>,
    ) {
        let event = {
            let mut snapshot = self.snapshot.lock().unwrap();
            snapshot.state = state;
            snapshot.detail = detail;
            snapshot.sequence = snapshot.sequence.wrapping_add(1);
            snapshot.updated_at_ms = now_ms();
            snapshot.bytes_sent = self.bytes_sent.load(Ordering::Relaxed);
            snapshot.bytes_received = self.bytes_received.load(Ordering::Relaxed);
            snapshot.local_address = local_address;
            snapshot.remote_address = remote_address;
            snapshot.rtt_ms = rtt_ms;
            snapshot.clone()
        };
        super::emit_event(&event);
    }
}

fn classify_error(error: &anyhow::Error) -> ErrorCode {
    let message = error.to_string();
    if message.contains("見つかりません") {
        ErrorCode::NotFound
    } else if message.contains("変更") || message.contains("一致しません") {
        ErrorCode::Changed
    } else if message.contains("タイムアウト") {
        ErrorCode::Timeout
    } else {
        ErrorCode::Io
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_index_invalidates_when_metadata_changes() {
        let directory = tempfile::tempdir().unwrap();
        let index = ContentIndex::open(directory.path()).unwrap();
        let node = NodeInfo {
            name: "rain.flac".to_owned(),
            is_directory: false,
            size: 10,
            modified_at: 20,
        };
        index
            .put("root\0rain.flac".to_owned(), &node, [3; 32])
            .unwrap();
        assert_eq!(index.get("root\0rain.flac", &node), Some([3; 32]));
        assert_eq!(
            index.get("root\0rain.flac", &NodeInfo { size: 11, ..node }),
            None
        );
    }

    #[test]
    fn host_config_rejects_old_or_insecure_endpoints() {
        let config = HostConfig {
            endpoint: "ws://localhost".to_owned(),
            room: "a".repeat(22),
            secret: "b".repeat(43),
            cache_directory: "/tmp".to_owned(),
            certificate: String::new(),
            private_key: String::new(),
            fingerprint: String::new(),
        };
        assert!(config.validate().is_err());
    }
}
