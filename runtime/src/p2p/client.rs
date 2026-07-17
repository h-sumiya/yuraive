use super::cache::BlockCache;
use super::protocol::{
    BLOCK_SIZE, ContentId, ErrorCode, FileInfo, MAX_CONTROL_FRAME, NodeInfo, RemoteError,
    RequestBody, ResponseBody, RootInfo, WireRequest, WireResponse, client_proof, receive, send,
    verify_proof,
};
use super::signaling::{
    Candidate, exchange_candidates_for_role, prepare_socket, punch, routed_local_address,
};
use super::transport::client_endpoint;
use anyhow::{Context, Result, anyhow, bail};
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use futures_util::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex as AsyncMutex, watch};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub endpoint: String,
    pub room: String,
    pub secret: String,
    pub fingerprint: String,
    pub cache_directory: String,
    pub maximum_cache_bytes: u64,
}

impl ClientConfig {
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
        if self.secret.len() != 43 || self.fingerprint.len() != 43 {
            bail!("接続認証情報が不正です");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClientPhase {
    Offline,
    Signaling,
    Punching,
    Connecting,
    Connected,
    Loading,
    Error,
    Closed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnapshot {
    pub state: ClientPhase,
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

struct ManagedConnection {
    _endpoint: quinn::Endpoint,
    connection: quinn::Connection,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BlockKey {
    content_id: ContentId,
    block_index: u64,
}

struct InflightLeader {
    core: Arc<ClientCore>,
    key: BlockKey,
    sender: Option<watch::Sender<()>>,
}

impl Drop for InflightLeader {
    fn drop(&mut self) {
        self.core.inflight.remove(&self.key);
        self.sender.take();
    }
}

struct RequestActivity<'a> {
    core: &'a ClientCore,
    completed: bool,
}

impl<'a> RequestActivity<'a> {
    fn start(core: &'a ClientCore) -> Self {
        if core.active_requests.fetch_add(1, Ordering::AcqRel) == 0 {
            core.set_status(ClientPhase::Loading, None, None, None, None);
        }
        Self {
            core,
            completed: false,
        }
    }

    fn complete(mut self) -> bool {
        self.completed = true;
        self.core.active_requests.fetch_sub(1, Ordering::AcqRel) == 1
    }
}

impl Drop for RequestActivity<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.core.active_requests.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

struct ClientCore {
    config: ClientConfig,
    connection: AsyncMutex<Option<ManagedConnection>>,
    cache: Mutex<BlockCache>,
    file_info: Mutex<HashMap<(String, String), FileInfo>>,
    inflight: DashMap<BlockKey, watch::Receiver<()>>,
    next_request: AtomicU64,
    snapshot: Mutex<ClientSnapshot>,
    cancellation: CancellationToken,
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
    active_requests: AtomicU64,
}

pub struct ClientSession {
    runtime: tokio::runtime::Runtime,
    core: Arc<ClientCore>,
    closed: AtomicBool,
}

impl ClientSession {
    pub fn create(config: ClientConfig) -> Result<Arc<Self>> {
        config.validate()?;
        let cache = BlockCache::new(
            Path::new(&config.cache_directory),
            config.maximum_cache_bytes,
        )?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(3)
            .enable_all()
            .thread_name("yuraive-p2p-client")
            .build()
            .context("P2Pクライアントランタイムを開始できません")?;
        Ok(Arc::new(Self {
            runtime,
            core: Arc::new(ClientCore {
                config,
                connection: AsyncMutex::new(None),
                cache: Mutex::new(cache),
                file_info: Mutex::new(HashMap::new()),
                inflight: DashMap::new(),
                next_request: AtomicU64::new(1),
                snapshot: Mutex::new(ClientSnapshot {
                    state: ClientPhase::Offline,
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
                active_requests: AtomicU64::new(0),
            }),
            closed: AtomicBool::new(false),
        }))
    }

    pub fn roots(&self) -> Result<Vec<RootInfo>> {
        self.run(async {
            match self.core.request(RequestBody::Roots).await? {
                ResponseBody::Roots(values) => Ok(values),
                _ => bail!("接続先から不正なルート応答を受信しました"),
            }
        })
    }

    pub fn list(&self, root_id: &str, path: &str) -> Result<Vec<NodeInfo>> {
        let root_id = root_id.to_owned();
        let path = path.to_owned();
        self.run(async {
            match self
                .core
                .request(RequestBody::List { root_id, path })
                .await?
            {
                ResponseBody::Nodes(values) => Ok(values),
                _ => bail!("接続先から不正なフォルダ応答を受信しました"),
            }
        })
    }

    pub fn stat(&self, root_id: &str, path: &str) -> Result<Option<FileInfo>> {
        let root_id = root_id.to_owned();
        let path = path.to_owned();
        self.run(async {
            let value = self.core.stat(&root_id, &path).await?;
            Ok(value)
        })
    }

    pub fn read(&self, root_id: &str, path: &str, offset: u64, count: u32) -> Result<Vec<u8>> {
        if count == 0 || count > 4 * 1024 * 1024 {
            bail!("読み込みサイズが不正です");
        }
        let root_id = root_id.to_owned();
        let path = path.to_owned();
        let core = Arc::clone(&self.core);
        self.run(async move { core.read_range(&root_id, &path, offset, count).await })
    }

    pub fn snapshot(&self) -> ClientSnapshot {
        let mut value = self.core.snapshot.lock().unwrap().clone();
        value.bytes_sent = self.core.bytes_sent.load(Ordering::Relaxed);
        value.bytes_received = self.core.bytes_received.load(Ordering::Relaxed);
        value
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.core.cancellation.cancel();
        self.runtime.block_on(async {
            if let Some(connection) = self.core.connection.lock().await.take() {
                connection.connection.close(0u8.into(), b"client closed");
            }
        });
        self.core
            .set_status(ClientPhase::Closed, None, None, None, None);
    }

    fn run<T>(&self, future: impl std::future::Future<Output = Result<T>>) -> Result<T> {
        if self.closed.load(Ordering::SeqCst) {
            bail!("P2Pクライアントは終了しています");
        }
        self.runtime.block_on(future)
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        self.close();
    }
}

impl ClientCore {
    async fn request(&self, body: RequestBody) -> Result<ResponseBody> {
        WireRequest::new(0, body.clone()).validate()?;
        for attempt in 0..2 {
            let connection = match self.connected().await {
                Ok(value) => value,
                Err(error) => {
                    self.set_status(
                        ClientPhase::Error,
                        Some(error.to_string()),
                        None,
                        None,
                        None,
                    );
                    return Err(error);
                }
            };
            let request_id = self.next_request.fetch_add(1, Ordering::Relaxed);
            let activity = RequestActivity::start(self);
            let result = async {
                let (mut send_stream, mut receive_stream) = connection
                    .open_bi()
                    .await
                    .context("QUIC要求ストリームを開けません")?;
                let request = WireRequest::new(request_id, body.clone());
                let sent = send(&mut send_stream, &request).await?;
                self.bytes_sent.fetch_add(sent as u64, Ordering::Relaxed);
                let (response, received): (WireResponse, usize) =
                    receive(&mut receive_stream, MAX_CONTROL_FRAME).await?;
                self.bytes_received
                    .fetch_add(received as u64, Ordering::Relaxed);
                response.into_body(request_id)
            }
            .await;
            let last_request = activity.complete();
            match result {
                Ok(value) => {
                    if last_request {
                        let stats = connection.stats();
                        self.set_status(
                            ClientPhase::Connected,
                            None,
                            None,
                            Some(connection.remote_address().to_string()),
                            Some(stats.path.rtt.as_millis().try_into().unwrap_or(u64::MAX)),
                        );
                    }
                    return Ok(value);
                }
                Err(error) if error.downcast_ref::<RemoteError>().is_some() => {
                    self.set_status(
                        ClientPhase::Error,
                        Some(error.to_string()),
                        None,
                        None,
                        None,
                    );
                    return Err(error);
                }
                Err(error) => {
                    self.invalidate_connection(connection.stable_id()).await;
                    if attempt == 0 && !self.cancellation.is_cancelled() {
                        self.set_status(
                            ClientPhase::Connecting,
                            Some("QUIC通信を再接続しています".to_owned()),
                            None,
                            None,
                            None,
                        );
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(350)) => {}
                            _ = self.cancellation.cancelled() => bail!("接続がキャンセルされました"),
                        }
                        continue;
                    }
                    self.set_status(
                        ClientPhase::Error,
                        Some(error.to_string()),
                        None,
                        None,
                        None,
                    );
                    return Err(error);
                }
            }
        }
        unreachable!("P2P要求の試行回数は固定です")
    }

    async fn connected(&self) -> Result<quinn::Connection> {
        let mut state = self.connection.lock().await;
        if let Some(value) = state.as_ref()
            && value.connection.close_reason().is_none()
        {
            return Ok(value.connection.clone());
        }
        *state = None;
        let managed = self.establish().await?;
        let connection = managed.connection.clone();
        *state = Some(managed);
        Ok(connection)
    }

    async fn establish(&self) -> Result<ManagedConnection> {
        self.reset_path();
        self.set_status(ClientPhase::Signaling, None, None, None, None);
        let prepared = tokio::task::spawn_blocking(prepare_socket)
            .await
            .context("UDP候補収集を開始できません")??;
        let local = prepared
            .candidates
            .first()
            .map(|value| value.address.to_string());
        let local_port = prepared.socket.local_addr()?.port();
        self.set_candidates(&prepared.candidates, &[], None);
        let remote = exchange_candidates_for_role(
            &self.config.endpoint,
            &self.config.room,
            "client",
            &self.config.secret,
            &prepared.candidates,
            &self.cancellation,
        )
        .await?;
        self.set_candidates(&prepared.candidates, &remote, None);
        self.set_status(ClientPhase::Punching, None, local.clone(), None, None);
        punch(&prepared.socket, &remote).await;
        let endpoint = client_endpoint(prepared.socket, &self.config.fingerprint)?;
        self.set_status(ClientPhase::Connecting, None, local, None, None);
        let connection = connect_any(&endpoint, &remote, &self.cancellation).await?;
        let selected = remote
            .iter()
            .copied()
            .find(|value| value.address == connection.remote_address());
        self.set_candidates(&prepared.candidates, &remote, selected);
        let selected_local = connection
            .local_ip()
            .map(|ip| std::net::SocketAddr::new(ip, local_port))
            .or_else(|| routed_local_address(connection.remote_address(), local_port))
            .map(|value| value.to_string());
        authenticate(
            &connection,
            &self.config.secret,
            &self.bytes_sent,
            &self.bytes_received,
        )
        .await?;
        let stats = connection.stats();
        self.set_status(
            ClientPhase::Connected,
            None,
            selected_local,
            Some(connection.remote_address().to_string()),
            Some(stats.path.rtt.as_millis().try_into().unwrap_or(u64::MAX)),
        );
        Ok(ManagedConnection {
            _endpoint: endpoint,
            connection,
        })
    }

    async fn invalidate_connection(&self, stable_id: usize) {
        let mut state = self.connection.lock().await;
        if state
            .as_ref()
            .is_some_and(|value| value.connection.stable_id() == stable_id)
            && let Some(value) = state.take()
        {
            value.connection.close(1u8.into(), b"request failed");
        }
    }

    async fn stat(&self, root_id: &str, path: &str) -> Result<Option<FileInfo>> {
        let response = self
            .request(RequestBody::Stat {
                root_id: root_id.to_owned(),
                path: path.to_owned(),
            })
            .await?;
        match response {
            ResponseBody::Stat(value) => {
                let mut metadata = self.file_info.lock().unwrap();
                if let Some(info) = value.as_ref() {
                    metadata.insert((root_id.to_owned(), path.to_owned()), info.clone());
                } else {
                    metadata.remove(&(root_id.to_owned(), path.to_owned()));
                }
                Ok(value)
            }
            _ => bail!("接続先から不正なファイル情報を受信しました"),
        }
    }

    async fn read_range(
        self: Arc<Self>,
        root_id: &str,
        path: &str,
        offset: u64,
        count: u32,
    ) -> Result<Vec<u8>> {
        let key = (root_id.to_owned(), path.to_owned());
        let mut info = self.file_info.lock().unwrap().get(&key).cloned();
        if info.is_none() {
            info = self.stat(root_id, path).await?;
        }
        let info = info.ok_or_else(|| anyhow!("ファイルが見つかりません"))?;
        if offset >= info.node.size {
            return Ok(Vec::new());
        }
        let end = offset.saturating_add(u64::from(count)).min(info.node.size);
        let first = offset / u64::from(BLOCK_SIZE);
        let last = (end - 1) / u64::from(BLOCK_SIZE);

        let mut pending = FuturesUnordered::new();
        for block_index in first..=last {
            let core = Arc::clone(&self);
            let root = root_id.to_owned();
            let path = path.to_owned();
            let info = info.clone();
            pending.push(async move {
                let data = core.get_block(&root, &path, &info, block_index).await?;
                Ok::<_, anyhow::Error>((block_index, data))
            });
        }
        let mut blocks = HashMap::new();
        while let Some(value) = pending.next().await {
            let (index, data) = value?;
            blocks.insert(index, data);
        }

        for block_index in (last + 1)..=(last + 3) {
            if block_index * u64::from(BLOCK_SIZE) >= info.node.size {
                break;
            }
            let core = Arc::clone(&self);
            let root = root_id.to_owned();
            let path = path.to_owned();
            let info = info.clone();
            tokio::spawn(async move {
                let _ = core.get_block(&root, &path, &info, block_index).await;
            });
        }

        let mut output = Vec::with_capacity((end - offset) as usize);
        for block_index in first..=last {
            let block = blocks
                .remove(&block_index)
                .ok_or_else(|| anyhow!("要求ブロックを取得できません"))?;
            let block_start = block_index * u64::from(BLOCK_SIZE);
            let from = offset.saturating_sub(block_start) as usize;
            let to = (end - block_start).min(block.len() as u64) as usize;
            output.extend_from_slice(&block[from..to]);
        }
        Ok(output)
    }

    async fn get_block(
        self: Arc<Self>,
        root_id: &str,
        path: &str,
        info: &FileInfo,
        block_index: u64,
    ) -> Result<Vec<u8>> {
        if let Some(value) =
            self.cache
                .lock()
                .unwrap()
                .read_block(&info.content_id, info.node.size, block_index)?
        {
            return Ok(value);
        }
        let key = BlockKey {
            content_id: info.content_id,
            block_index,
        };
        loop {
            let (mut waiter, leader) = match self.inflight.entry(key.clone()) {
                Entry::Occupied(entry) => (Some(entry.get().clone()), None),
                Entry::Vacant(entry) => {
                    let (sender, receiver) = watch::channel(());
                    entry.insert(receiver);
                    (
                        None,
                        Some(InflightLeader {
                            core: Arc::clone(&self),
                            key: key.clone(),
                            sender: Some(sender),
                        }),
                    )
                }
            };
            if let Some(waiter) = waiter.as_mut() {
                let _ = waiter.changed().await;
                if let Some(value) = self.cache.lock().unwrap().read_block(
                    &info.content_id,
                    info.node.size,
                    block_index,
                )? {
                    return Ok(value);
                }
                continue;
            }

            let offset = block_index * u64::from(BLOCK_SIZE);
            let length = (info.node.size - offset).min(u64::from(BLOCK_SIZE)) as u32;
            let result = async {
                match self
                    .request(RequestBody::ReadBlock {
                        root_id: root_id.to_owned(),
                        path: path.to_owned(),
                        content_id: info.content_id,
                        offset,
                        length,
                    })
                    .await?
                {
                    ResponseBody::Block {
                        content_id,
                        total_size,
                        offset: response_offset,
                        data,
                    } if content_id == info.content_id
                        && total_size == info.node.size
                        && response_offset == offset
                        && data.len() == length as usize =>
                    {
                        let protected = {
                            self.inflight
                                .iter()
                                .map(|value| value.key().content_id)
                                .collect::<HashSet<_>>()
                        };
                        self.cache.lock().unwrap().write_block(
                            &content_id,
                            total_size,
                            offset,
                            &data,
                            &protected,
                        )?;
                        Ok(data)
                    }
                    ResponseBody::Block { .. } => bail!("受信ブロックの検証に失敗しました"),
                    _ => bail!("接続先から不正なブロック応答を受信しました"),
                }
            }
            .await;
            if result.as_ref().err().is_some_and(|error| {
                error
                    .downcast_ref::<RemoteError>()
                    .is_some_and(|remote| remote.code == ErrorCode::Changed)
            }) {
                self.file_info
                    .lock()
                    .unwrap()
                    .remove(&(root_id.to_owned(), path.to_owned()));
            }
            drop(leader);
            return result;
        }
    }

    fn set_status(
        &self,
        state: ClientPhase,
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
            if local_address.is_some() {
                snapshot.local_address = local_address;
            }
            if remote_address.is_some() {
                snapshot.remote_address = remote_address;
            }
            if rtt_ms.is_some() {
                snapshot.rtt_ms = rtt_ms;
            }
            snapshot.clone()
        };
        super::emit_event(&event);
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

    fn reset_path(&self) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.local_address = None;
        snapshot.remote_address = None;
        snapshot.rtt_ms = None;
        snapshot.local_candidates.clear();
        snapshot.remote_candidates.clear();
        snapshot.selected_candidate = None;
    }
}

async fn connect_any(
    endpoint: &quinn::Endpoint,
    candidates: &[Candidate],
    cancellation: &CancellationToken,
) -> Result<quinn::Connection> {
    let mut attempts = FuturesUnordered::new();
    for candidate in candidates {
        let candidate = *candidate;
        let connecting = match endpoint.connect(candidate.address, "p2p.yuraive.local") {
            Ok(value) => value,
            Err(_) => continue,
        };
        attempts.push(async move {
            let result: Result<quinn::Connection> = async {
                tokio::time::timeout(Duration::from_secs(10), connecting)
                    .await
                    .context("候補へのQUIC接続がタイムアウトしました")?
                    .context("候補へのQUIC接続に失敗しました")
            }
            .await;
            result.map_err(|error| (candidate, error))
        });
    }
    if attempts.is_empty() {
        bail!("接続可能なQUIC候補がありません");
    }
    let mut errors = Vec::new();
    loop {
        tokio::select! {
            result = attempts.next() => match result {
                Some(Ok(connection)) => return Ok(connection),
                Some(Err((candidate, error))) => errors.push(format!("{}: {error:#}", candidate.address)),
                None => break,
            },
            _ = cancellation.cancelled() => bail!("接続がキャンセルされました"),
        }
    }
    if errors.is_empty() {
        bail!("どの候補にも直接接続できませんでした");
    }
    bail!(
        "どの候補にも直接接続できませんでした: {}",
        errors.join("; ")
    )
}

async fn authenticate(
    connection: &quinn::Connection,
    secret: &str,
    bytes_sent: &AtomicU64,
    bytes_received: &AtomicU64,
) -> Result<()> {
    let mut nonce = [0u8; 32];
    getrandom::fill(&mut nonce).context("接続認証nonceを生成できません")?;
    let request_id = fastrand::u64(..);
    let request = WireRequest::new(
        request_id,
        RequestBody::Authenticate {
            nonce,
            proof: client_proof(secret.as_bytes(), &nonce),
        },
    );
    let (mut send_stream, mut receive_stream) = connection
        .open_bi()
        .await
        .context("QUIC認証ストリームを開けません")?;
    let sent = send(&mut send_stream, &request).await?;
    bytes_sent.fetch_add(sent as u64, Ordering::Relaxed);
    let (response, received): (WireResponse, usize) =
        receive(&mut receive_stream, MAX_CONTROL_FRAME).await?;
    bytes_received.fetch_add(received as u64, Ordering::Relaxed);
    match response.into_body(request_id)? {
        ResponseBody::Authenticated { proof, block_size }
            if verify_proof(
                secret.as_bytes(),
                b"yuraive-p2p-server-v1\0",
                &nonce,
                &proof,
            ) && block_size == BLOCK_SIZE =>
        {
            Ok(())
        }
        _ => bail!("QUIC接続先を認証できません"),
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

    fn test_session(directory: &Path) -> Arc<ClientSession> {
        ClientSession::create(ClientConfig {
            endpoint: "wss://connect.yuraive.com/v2/rooms".to_owned(),
            room: "a".repeat(22),
            secret: "b".repeat(43),
            fingerprint: "c".repeat(43),
            cache_directory: directory.to_string_lossy().into_owned(),
            maximum_cache_bytes: 1024 * 1024,
        })
        .unwrap()
    }

    #[test]
    fn client_rejects_pairing_without_certificate_pin() {
        let config = ClientConfig {
            endpoint: "wss://connect.yuraive.com/v2/rooms".to_owned(),
            room: "a".repeat(22),
            secret: "b".repeat(43),
            fingerprint: String::new(),
            cache_directory: "/tmp".to_owned(),
            maximum_cache_bytes: 1024 * 1024,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn cancelled_requests_release_activity_and_inflight_waiters() {
        let directory = tempfile::tempdir().unwrap();
        let session = test_session(directory.path());
        let activity = RequestActivity::start(&session.core);
        assert_eq!(session.core.active_requests.load(Ordering::Acquire), 1);
        drop(activity);
        assert_eq!(session.core.active_requests.load(Ordering::Acquire), 0);

        let key = BlockKey {
            content_id: [7; 32],
            block_index: 4,
        };
        let (sender, receiver) = watch::channel(());
        session.core.inflight.insert(key.clone(), receiver.clone());
        let leader = InflightLeader {
            core: Arc::clone(&session.core),
            key: key.clone(),
            sender: Some(sender),
        };
        drop(leader);
        assert!(!session.core.inflight.contains_key(&key));
        assert!(receiver.has_changed().is_err());
    }
}
