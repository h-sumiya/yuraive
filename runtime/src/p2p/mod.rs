mod cache;
mod client;
mod ffi;
mod host;
mod protocol;
mod signaling;
mod transport;

#[cfg(target_os = "android")]
#[link(name = "log")]
unsafe extern "C" {
    fn __android_log_write(
        priority: std::ffi::c_int,
        tag: *const std::ffi::c_char,
        text: *const std::ffi::c_char,
    ) -> std::ffi::c_int;
}

fn emit_event<T: serde::Serialize>(event: &T) {
    let Ok(json) = serde_json::to_string(event) else {
        return;
    };
    #[cfg(target_os = "android")]
    {
        let Ok(message) = std::ffi::CString::new(json) else {
            return;
        };
        // SAFETY: Both strings remain valid and NUL-terminated for the duration
        // of the synchronous Android logging call.
        unsafe {
            __android_log_write(4, c"YuraiveP2P".as_ptr(), message.as_ptr());
        }
    }
    #[cfg(not(target_os = "android"))]
    eprintln!("YURAIVE_P2P {json}");
}

#[cfg(test)]
mod live_tests {
    use super::client::{ClientConfig, ClientSession};
    use super::host::{HostConfig, HostPhase, HostSession, ProviderMethod};
    use super::protocol::BLOCK_SIZE;
    use super::transport::create_identity;
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::Duration;

    #[test]
    #[ignore = "CloudflareとUDPネットワークを使う明示的な疎通試験"]
    fn cloudflare_signaling_establishes_pinned_quic_and_binary_request() {
        let directory = tempfile::tempdir().unwrap();
        let identity = create_identity().unwrap();
        let room = token(16);
        let secret = token(32);
        let host = HostSession::start(HostConfig {
            endpoint: "wss://connect.yuraive.com/v2/rooms".to_owned(),
            room: room.clone(),
            secret: secret.clone(),
            cache_directory: directory.path().join("host").to_string_lossy().into_owned(),
            certificate: identity.certificate,
            private_key: identity.private_key,
            fingerprint: identity.fingerprint.clone(),
        })
        .unwrap();
        let stopped = Arc::new(AtomicBool::new(false));
        let read_count = Arc::new(AtomicU64::new(0));
        let content: Arc<Vec<u8>> = Arc::new(
            (0..(BLOCK_SIZE as usize * 3 + 17))
                .map(|index| (index % 251) as u8)
                .collect(),
        );
        let provider_host = Arc::clone(&host);
        let provider_stopped = Arc::clone(&stopped);
        let provider_reads = Arc::clone(&read_count);
        let provider_content = Arc::clone(&content);
        let provider = std::thread::spawn(move || {
            while !provider_stopped.load(Ordering::SeqCst) {
                let Some(request) = provider_host.poll_request(Duration::from_millis(100)) else {
                    continue;
                };
                match request.method {
                    ProviderMethod::Roots => assert!(provider_host.respond_json(
                        request.id,
                        br#"[{"id":"0123456789abcdef0123456789abcdef","name":"Live test"}]"#,
                    )),
                    ProviderMethod::List => assert!(provider_host.respond_json(
                        request.id,
                        format!(
                            r#"[{{"name":"sample.bin","isDirectory":false,"size":{},"modifiedAt":1234}}]"#,
                            provider_content.len()
                        )
                        .as_bytes(),
                    )),
                    ProviderMethod::Stat => assert!(provider_host.respond_json(
                        request.id,
                        format!(
                            r#"{{"name":"sample.bin","isDirectory":false,"size":{},"modifiedAt":1234}}"#,
                            provider_content.len()
                        )
                        .as_bytes(),
                    )),
                    ProviderMethod::Read => {
                        provider_reads.fetch_add(1, Ordering::Relaxed);
                        let offset = request.offset.unwrap() as usize;
                        let count = request.count.unwrap() as usize;
                        assert!(provider_host.respond_bytes(
                            request.id,
                            provider_content.len() as u64,
                            &provider_content[offset..offset + count],
                        ));
                    }
                }
            }
        });

        std::thread::sleep(Duration::from_millis(500));
        let client = ClientSession::create(ClientConfig {
            endpoint: "wss://connect.yuraive.com/v2/rooms".to_owned(),
            room,
            secret,
            fingerprint: identity.fingerprint,
            cache_directory: directory
                .path()
                .join("client")
                .to_string_lossy()
                .into_owned(),
            maximum_cache_bytes: 16 * 1024 * 1024,
        })
        .unwrap();
        let roots = client.roots().unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].name, "Live test");
        assert_eq!(roots[0].id, "0123456789abcdef0123456789abcdef");
        let nodes = client.list("0123456789abcdef0123456789abcdef", "").unwrap();
        assert_eq!(nodes[0].name, "sample.bin");
        let info = client
            .stat("0123456789abcdef0123456789abcdef", "sample.bin")
            .unwrap()
            .unwrap();
        assert_eq!(info.node.size, content.len() as u64);
        let offset = 1_024u64;
        let count = BLOCK_SIZE * 2;
        let received = client
            .read(
                "0123456789abcdef0123456789abcdef",
                "sample.bin",
                offset,
                count,
            )
            .unwrap();
        assert_eq!(
            received,
            content[offset as usize..offset as usize + count as usize]
        );
        std::thread::sleep(Duration::from_millis(500));
        let reads_after_fill = read_count.load(Ordering::Relaxed);
        let cached = client
            .read(
                "0123456789abcdef0123456789abcdef",
                "sample.bin",
                offset,
                count,
            )
            .unwrap();
        assert_eq!(cached, received);
        assert_eq!(read_count.load(Ordering::Relaxed), reads_after_fill);

        client.close();
        host.close();
        stopped.store(true, Ordering::SeqCst);
        provider.join().unwrap();
    }

    #[test]
    #[ignore = "接続済みAndroid実機から明示的に起動する疎通試験"]
    fn android_jni_device_smoke_host() {
        let directory = tempfile::tempdir().unwrap();
        let identity = create_identity().unwrap();
        let room = token(16);
        let secret = token(32);
        let pairing_uri = format!(
            "yuraive://pair?v=2&endpoint=wss%3A%2F%2Fconnect.yuraive.com%2Fv2%2Frooms&room={room}&secret={secret}&pin={}&device={}&name=Rust-JNI-Test",
            identity.fingerprint,
            token(16),
        );
        let host = HostSession::start(HostConfig {
            endpoint: "wss://connect.yuraive.com/v2/rooms".to_owned(),
            room,
            secret,
            cache_directory: directory.path().join("host").to_string_lossy().into_owned(),
            certificate: identity.certificate,
            private_key: identity.private_key,
            fingerprint: identity.fingerprint,
        })
        .unwrap();
        let ready_deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < ready_deadline
            && host.snapshot().state != HostPhase::WaitingForPeer
        {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(host.snapshot().state, HostPhase::WaitingForPeer);
        std::fs::write("/tmp/yuraive-p2p-device-uri", &pairing_uri).unwrap();
        println!("PAIRING_URI={pairing_uri}");
        let saw_roots = Arc::new(AtomicBool::new(false));
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        while std::time::Instant::now() < deadline && !saw_roots.load(Ordering::SeqCst) {
            let Some(request) = host.poll_request(Duration::from_millis(200)) else {
                continue;
            };
            match request.method {
                ProviderMethod::Roots => {
                    saw_roots.store(true, Ordering::SeqCst);
                    assert!(host.respond_json(
                        request.id,
                        br#"[{"id":"fedcba9876543210fedcba9876543210","name":"Android JNI test"}]"#,
                    ));
                }
                ProviderMethod::List => assert!(host.respond_json(request.id, b"[]")),
                ProviderMethod::Stat => assert!(host.respond_json(request.id, b"null")),
                ProviderMethod::Read => {
                    host.respond_error(request.id, "unexpected read".to_owned());
                }
            }
        }
        std::thread::sleep(Duration::from_secs(2));
        host.close();
        assert!(
            saw_roots.load(Ordering::SeqCst),
            "Android実機からRustホストへroots要求が届きませんでした"
        );
    }

    fn token(length: usize) -> String {
        let mut bytes = vec![0u8; length];
        getrandom::fill(&mut bytes).unwrap();
        URL_SAFE_NO_PAD.encode(bytes)
    }
}
