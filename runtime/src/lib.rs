#![allow(dead_code)]

mod bundle;
mod layout_engine;
mod script_engine;

#[cfg(not(target_arch = "wasm32"))]
use jni::JNIEnv;
#[cfg(not(target_arch = "wasm32"))]
use jni::objects::{JByteArray, JObject, JString};
#[cfg(not(target_arch = "wasm32"))]
use jni::sys::jstring;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
#[cfg(not(target_arch = "wasm32"))]
use std::ffi::{CStr, CString, c_char};
#[cfg(not(target_arch = "wasm32"))]
use std::panic::{AssertUnwindSafe, catch_unwind};

pub use bundle::{
    BundleTextAsset, BundleTextAssetKind, DecodedBundle, decode_bundle, decode_bundle_json,
};
pub use layout_engine::{
    LayoutRequest, LayoutResponse, resolve_button_layout, resolve_button_layout_json,
};
pub use script_engine::{StarlarkRunRequest, StarlarkRunResponse, run_starlark, run_starlark_json};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = runStarlarkJson)]
pub fn run_starlark_wasm(request_json: &str) -> String {
    run_starlark_json(request_json)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = decodeBundle)]
pub fn decode_bundle_wasm(input: &[u8]) -> String {
    decode_bundle_json(input)
}

include!("validation.rs");
include!("ffi.rs");
include!("tests.rs");
