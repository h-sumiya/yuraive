#[cfg(not(target_arch = "wasm32"))]
fn ffi_input(input: *const c_char) -> Result<&'static str, String> {
    if input.is_null() {
        return Err("入力がnullです".to_owned());
    }
    // SAFETY: Callers must pass a live, NUL-terminated UTF-8 string for the
    // duration of this call. Every public FFI entry point copies the result
    // before returning.
    unsafe { CStr::from_ptr(input) }
        .to_str()
        .map_err(|error| format!("入力がUTF-8ではありません: {error}"))
}

#[cfg(not(target_arch = "wasm32"))]
fn ffi_output(value: String) -> *mut c_char {
    CString::new(value)
        .unwrap_or_else(|_| {
            CString::new(r#"{"error":"結果に不正なNUL文字が含まれています"}"#).unwrap()
        })
        .into_raw()
}

/// Validate Yuraive JSON for native desktop hosts.
///
/// The returned UTF-8 string belongs to the caller and must be released with
/// `yuraive_string_free`.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_validate_json(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| match ffi_input(input) {
        Ok(value) => validation_json(value),
        Err(error) => serde_json::to_string(&vec![ValidationIssue::error(error)])
            .unwrap_or_else(|_| "[]".to_owned()),
    }))
    .unwrap_or_else(|_| {
        r#"[{"severity":"ERROR","message":"Rust検証器で内部エラーが発生しました"}]"#.to_owned()
    });
    ffi_output(output)
}

/// Read the optional metadata object from a bounded JSON prefix.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_extract_metadata_prefix(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| match ffi_input(input) {
        Ok(value) => metadata_prefix_json(value),
        Err(error) => serde_json::to_string(&MetadataPrefixResult::invalid(error))
            .unwrap_or_else(|_| r#"{"status":"invalid"}"#.to_owned()),
    }))
    .unwrap_or_else(|_| {
        r#"{"status":"invalid","error":"Rustメタデータ解析器で内部エラーが発生しました"}"#
            .to_owned()
    });
    ffi_output(output)
}

/// Execute a Starlark request for native desktop hosts.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_run_starlark_json(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| match ffi_input(input) {
        Ok(value) => run_starlark_json(value),
        Err(error) => {
            serde_json::to_string(&StarlarkRunResponse::error(error)).unwrap_or_else(|_| {
                r#"{"prints":[],"error":"実行リクエストを受け取れません"}"#.to_owned()
            })
        }
    }))
    .unwrap_or_else(|_| {
        r#"{"prints":[],"error":"Rustスクリプトエンジンで内部エラーが発生しました"}"#.to_owned()
    });
    ffi_output(output)
}

/// Interpret a safe Yuraive button layout and return a platform-neutral native render model.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_resolve_button_layout_json(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| match ffi_input(input) {
        Ok(value) => resolve_button_layout_json(value),
        Err(error) => format!(
            r#"{{"buttons":[],"issues":[{}]}}"#,
            serde_json::to_string(&error).unwrap_or_default()
        ),
    }))
    .unwrap_or_else(|_| {
        r#"{"buttons":[],"issues":["Rustレイアウトエンジンで内部エラーが発生しました"]}"#.to_owned()
    });
    ffi_output(output)
}

/// Decode a Yuraive binary player bundle and return its graph and embedded text
/// files as JSON. The input buffer only needs to remain valid for this call.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_decode_bundle(input: *const u8, length: usize) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| {
        if input.is_null() {
            return serde_json::json!({ "error": "バンドル入力がnullです" }).to_string();
        }
        // SAFETY: The caller guarantees a readable buffer of `length` bytes
        // for the duration of this call. decode_bundle_json never retains it.
        let bytes = unsafe { std::slice::from_raw_parts(input, length) };
        decode_bundle_json(bytes)
    }))
    .unwrap_or_else(|_| {
        serde_json::json!({ "error": "Rustバンドル解析器で内部エラーが発生しました" }).to_string()
    });
    ffi_output(output)
}

/// Release a string returned by one of the native desktop entry points.
#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_string_free(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: The pointer was allocated by CString::into_raw in
        // `ffi_output` and ownership is transferred back exactly once.
        unsafe { drop(CString::from_raw(value)) };
    }
}

#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_model_NativeGraphValidator_validateJsonNative<
    'local,
>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JString<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.get_string(&input) {
        Ok(value) => validation_json(&String::from(value)),
        Err(error) => serde_json::to_string(&vec![ValidationIssue::error(format!(
            "JSONを受け取れません: {error}"
        ))])
        .unwrap_or_else(|_| "[]".to_owned()),
    }))
    .unwrap_or_else(|_| {
        r#"[{"severity":"ERROR","message":"Rust検証器で内部エラーが発生しました"}]"#.to_owned()
    });

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_model_NativeGraphMetadataExtractor_extractNative<
    'local,
>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JString<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.get_string(&input) {
        Ok(value) => metadata_prefix_json(&String::from(value)),
        Err(error) => serde_json::to_string(&MetadataPrefixResult::invalid(format!(
            "JSONを受け取れません: {error}"
        )))
        .unwrap_or_else(|_| r#"{"status":"invalid"}"#.to_owned()),
    }))
    .unwrap_or_else(|_| {
        r#"{"status":"invalid","error":"Rustメタデータ解析器で内部エラーが発生しました"}"#
            .to_owned()
    });

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_model_NativeBundleDecoder_decodeNative<'local>(
    env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JByteArray<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.convert_byte_array(&input) {
        Ok(value) => decode_bundle_json(&value),
        Err(error) => {
            serde_json::json!({ "error": format!("バンドルを受け取れません: {error}") }).to_string()
        }
    }))
    .unwrap_or_else(|_| {
        serde_json::json!({ "error": "Rustバンドル解析器で内部エラーが発生しました" }).to_string()
    });

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_playback_NativeStarlarkEngine_runJsonNative<
    'local,
>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JString<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.get_string(&input) {
        Ok(value) => run_starlark_json(&String::from(value)),
        Err(error) => serde_json::to_string(&StarlarkRunResponse::error(format!(
            "実行リクエストを受け取れません: {error}"
        )))
        .unwrap_or_else(|_| r#"{"prints":[],"error":"実行リクエストを受け取れません"}"#.to_owned()),
    }))
    .unwrap_or_else(|_| {
        r#"{"prints":[],"error":"Rustスクリプトエンジンで内部エラーが発生しました"}"#.to_owned()
    });

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_ui_NativeButtonLayoutEngine_resolveJsonNative<
    'local,
>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JString<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.get_string(&input) {
        Ok(value) => resolve_button_layout_json(&String::from(value)),
        Err(error) => format!(
            r#"{{"buttons":[],"issues":[{}]}}"#,
            serde_json::to_string(&format!("レイアウト要求を受け取れません: {error}"))
                .unwrap_or_default()
        ),
    }))
    .unwrap_or_else(|_| {
        r#"{"buttons":[],"issues":["Rustレイアウトエンジンで内部エラーが発生しました"]}"#.to_owned()
    });

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

