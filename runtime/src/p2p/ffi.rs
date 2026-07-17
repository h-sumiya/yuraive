use super::client::{ClientConfig, ClientSession};
use super::host::{HostConfig, HostSession};
use super::transport::create_identity;
use crate::{ffi_input, ffi_output};
use dashmap::DashMap;
use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::{jbyteArray, jlong, jstring};
use serde::Serialize;
use std::ffi::{c_char, c_uchar};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);
static HOSTS: OnceLock<DashMap<u64, Arc<HostSession>>> = OnceLock::new();
static CLIENTS: OnceLock<DashMap<u64, Arc<ClientSession>>> = OnceLock::new();

fn hosts() -> &'static DashMap<u64, Arc<HostSession>> {
    HOSTS.get_or_init(DashMap::new)
}

fn clients() -> &'static DashMap<u64, Arc<ClientSession>> {
    CLIENTS.get_or_init(DashMap::new)
}

fn result_json<T: Serialize>(value: anyhow::Result<T>) -> String {
    match value {
        Ok(value) => serde_json::json!({ "value": value }).to_string(),
        Err(error) => serde_json::json!({ "error": error.to_string() }).to_string(),
    }
}

fn next_handle() -> u64 {
    NEXT_HANDLE.fetch_add(1, Ordering::Relaxed).max(1)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_create_identity() -> *mut c_char {
    let output =
        catch_unwind(AssertUnwindSafe(|| result_json(create_identity()))).unwrap_or_else(|_| {
            r#"{"error":"QUIC証明書の生成中に内部エラーが発生しました"}"#.to_owned()
        });
    ffi_output(output)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_create(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| {
        result_json((|| {
            let input = ffi_input(input).map_err(anyhow::Error::msg)?;
            let config: HostConfig = serde_json::from_str(input)
                .map_err(|error| anyhow::anyhow!("P2Pホスト設定が不正です: {error}"))?;
            let session = HostSession::start(config)?;
            let handle = next_handle();
            hosts().insert(handle, session);
            Ok(handle)
        })())
    }))
    .unwrap_or_else(|_| r#"{"error":"P2Pホスト開始中に内部エラーが発生しました"}"#.to_owned());
    ffi_output(output)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_status(handle: u64) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| {
        hosts()
            .get(&handle)
            .map(|session| serde_json::to_string(&session.snapshot()).unwrap_or_default())
            .unwrap_or_else(|| r#"{"state":"stopped","detail":"P2Pホストがありません"}"#.to_owned())
    }))
    .unwrap_or_else(|_| {
        r#"{"state":"error","detail":"P2P状態取得中に内部エラーが発生しました"}"#.to_owned()
    });
    ffi_output(output)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_poll(handle: u64, timeout_ms: u32) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| {
        hosts()
            .get(&handle)
            .and_then(|session| {
                session.poll_request(Duration::from_millis(u64::from(timeout_ms.min(500))))
            })
            .and_then(|request| serde_json::to_string(&request).ok())
            .unwrap_or_default()
    }))
    .unwrap_or_default();
    ffi_output(output)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_respond_json(
    handle: u64,
    request_id: u64,
    input: *const c_char,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        let Ok(value) = ffi_input(input) else {
            return false;
        };
        hosts()
            .get(&handle)
            .is_some_and(|session| session.respond_json(request_id, value.as_bytes()))
    }))
    .unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_respond_bytes(
    handle: u64,
    request_id: u64,
    total_size: u64,
    input: *const c_uchar,
    length: usize,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        if input.is_null() && length != 0 {
            return false;
        }
        // SAFETY: The caller owns a readable buffer for this call and the
        // session copies it before returning.
        let bytes = if length == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(input, length) }
        };
        hosts()
            .get(&handle)
            .is_some_and(|session| session.respond_bytes(request_id, total_size, bytes))
    }))
    .unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_respond_error(
    handle: u64,
    request_id: u64,
    input: *const c_char,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        let Ok(value) = ffi_input(input) else {
            return false;
        };
        hosts()
            .get(&handle)
            .is_some_and(|session| session.respond_error(request_id, value.to_owned()))
    }))
    .unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn yuraive_p2p_host_close(handle: u64) {
    if let Some((_, session)) = hosts().remove(&handle) {
        session.close();
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_createNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    input: JString<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| {
        result_json((|| {
            let input = String::from(
                env.get_string(&input)
                    .map_err(|error| anyhow::anyhow!("P2P設定を受け取れません: {error}"))?,
            );
            let config: ClientConfig = serde_json::from_str(&input)
                .map_err(|error| anyhow::anyhow!("P2Pクライアント設定が不正です: {error}"))?;
            let session = ClientSession::create(config)?;
            let handle = next_handle();
            clients().insert(handle, session);
            Ok(handle)
        })())
    }))
    .unwrap_or_else(|_| {
        r#"{"error":"P2Pクライアント開始中に内部エラーが発生しました"}"#.to_owned()
    });
    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_rootsNative<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jstring {
    client_json(env, handle, |client| client.roots())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_listNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    root_id: JString<'local>,
    path: JString<'local>,
) -> jstring {
    let root_id = match env.get_string(&root_id) {
        Ok(value) => String::from(value),
        Err(error) => return java_string(&env, result_json::<()>(Err(error.into()))),
    };
    let path = match env.get_string(&path) {
        Ok(value) => String::from(value),
        Err(error) => return java_string(&env, result_json::<()>(Err(error.into()))),
    };
    client_json(env, handle, |client| client.list(&root_id, &path))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_statNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    root_id: JString<'local>,
    path: JString<'local>,
) -> jstring {
    let root_id = match env.get_string(&root_id) {
        Ok(value) => String::from(value),
        Err(error) => return java_string(&env, result_json::<()>(Err(error.into()))),
    };
    let path = match env.get_string(&path) {
        Ok(value) => String::from(value),
        Err(error) => return java_string(&env, result_json::<()>(Err(error.into()))),
    };
    client_json(env, handle, |client| client.stat(&root_id, &path))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_statusNative<'local>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jstring {
    let output = clients()
        .get(&(handle as u64))
        .and_then(|client| serde_json::to_string(&client.snapshot()).ok())
        .unwrap_or_else(|| {
            r#"{"state":"closed","detail":"P2Pクライアントがありません"}"#.to_owned()
        });
    java_string(&env, output)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_readNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    root_id: JString<'local>,
    path: JString<'local>,
    offset: jlong,
    count: i32,
) -> jbyteArray {
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<Vec<u8>> {
        if offset < 0 || count < 0 {
            anyhow::bail!("読み込み範囲が不正です");
        }
        let root_id = String::from(env.get_string(&root_id)?);
        let path = String::from(env.get_string(&path)?);
        let client = clients()
            .get(&(handle as u64))
            .map(|value| Arc::clone(value.value()))
            .ok_or_else(|| anyhow::anyhow!("P2Pクライアントがありません"))?;
        client.read(&root_id, &path, offset as u64, count as u32)
    }))
    .unwrap_or_else(|_| Err(anyhow::anyhow!("P2P読み込み中に内部エラーが発生しました")));
    match result {
        Ok(bytes) => env
            .byte_array_from_slice(&bytes)
            .map(|value| value.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(error) => {
            let _ = env.throw_new("java/io/IOException", error.to_string());
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_yuraive_player_data_NativeP2pClient_closeNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) {
    if let Some((_, client)) = clients().remove(&(handle as u64)) {
        client.close();
    }
}

fn client_json<'local, T: Serialize>(
    env: JNIEnv<'local>,
    handle: jlong,
    operation: impl FnOnce(&ClientSession) -> anyhow::Result<T>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| {
        let client = clients()
            .get(&(handle as u64))
            .map(|value| Arc::clone(value.value()))
            .ok_or_else(|| anyhow::anyhow!("P2Pクライアントがありません"));
        result_json(client.and_then(|client| operation(&client)))
    }))
    .unwrap_or_else(|_| r#"{"error":"P2P操作中に内部エラーが発生しました"}"#.to_owned());
    java_string(&env, output)
}

fn java_string(env: &JNIEnv<'_>, value: String) -> jstring {
    env.new_string(value)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
