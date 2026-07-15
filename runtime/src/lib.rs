#![allow(dead_code)]

mod bundle;
mod layout_engine;
mod script_engine;

#[cfg(not(target_arch = "wasm32"))]
use jni::objects::{JByteArray, JObject, JString};
#[cfg(not(target_arch = "wasm32"))]
use jni::sys::jstring;
#[cfg(not(target_arch = "wasm32"))]
use jni::JNIEnv;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
#[cfg(not(target_arch = "wasm32"))]
use std::ffi::{c_char, CStr, CString};
#[cfg(not(target_arch = "wasm32"))]
use std::panic::{catch_unwind, AssertUnwindSafe};

pub use script_engine::{run_starlark, run_starlark_json, StarlarkRunRequest, StarlarkRunResponse};
pub use layout_engine::{resolve_button_layout, resolve_button_layout_json, LayoutRequest, LayoutResponse};
pub use bundle::{decode_bundle, decode_bundle_json, BundleTextAsset, BundleTextAssetKind, DecodedBundle};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = runStarlarkJson)]
pub fn run_starlark_wasm(request_json: &str) -> String {
    run_starlark_json(request_json)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl ValidationIssue {
    fn error(message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            message: message.into(),
            path: None,
        }
    }

    fn error_at(message: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            message: message.into(),
            path: Some(path.into()),
        }
    }

    fn warning(message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            message: message.into(),
            path: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Graph {
    version: i64,
    #[serde(default)]
    metadata: Option<Metadata>,
    nodes: BTreeMap<String, Node>,
    buttons: BTreeMap<String, Button>,
    #[serde(default)]
    player_controls: BTreeMap<String, PlayerControlSettings>,
    #[serde(default)]
    global_player_control: Option<String>,
    #[serde(default)]
    playback_stats: Option<ScriptCall>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    #[serde(default)]
    content_id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    social_links: Vec<SocialLink>,
}

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct MetadataPreview {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct MetadataPrefixResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<MetadataPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl MetadataPrefixResult {
    fn found(metadata: Option<MetadataPreview>) -> Self {
        Self {
            status: "found",
            metadata,
            error: None,
        }
    }

    fn simple(status: &'static str) -> Self {
        Self {
            status,
            metadata: None,
            error: None,
        }
    }

    fn invalid(error: impl Into<String>) -> Self {
        Self {
            status: "invalid",
            metadata: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum PrefixScanError {
    NeedMore,
    Invalid(&'static str),
}

fn skip_json_whitespace(bytes: &[u8], mut cursor: usize) -> usize {
    while cursor < bytes.len() && matches!(bytes[cursor], b' ' | b'\n' | b'\r' | b'\t') {
        cursor += 1;
    }
    cursor
}

fn json_string_end(bytes: &[u8], start: usize) -> Result<usize, PrefixScanError> {
    if bytes.get(start) != Some(&b'"') {
        return Err(PrefixScanError::Invalid("JSONのキーが文字列ではありません"));
    }
    let mut cursor = start + 1;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'"' {
            return Ok(cursor + 1);
        } else if byte < 0x20 {
            return Err(PrefixScanError::Invalid(
                "JSON文字列に制御文字が含まれています",
            ));
        }
        cursor += 1;
    }
    Err(PrefixScanError::NeedMore)
}

fn json_value_end(bytes: &[u8], start: usize) -> Result<usize, PrefixScanError> {
    let start = skip_json_whitespace(bytes, start);
    let Some(first) = bytes.get(start).copied() else {
        return Err(PrefixScanError::NeedMore);
    };
    if first == b'"' {
        return json_string_end(bytes, start);
    }
    if matches!(first, b'{' | b'[') {
        let mut stack = vec![first];
        let mut cursor = start + 1;
        while cursor < bytes.len() {
            match bytes[cursor] {
                b'"' => cursor = json_string_end(bytes, cursor)?,
                b'{' | b'[' => {
                    stack.push(bytes[cursor]);
                    cursor += 1;
                }
                b'}' => {
                    if stack.pop() != Some(b'{') {
                        return Err(PrefixScanError::Invalid("JSONオブジェクトの終端が不正です"));
                    }
                    cursor += 1;
                    if stack.is_empty() {
                        return Ok(cursor);
                    }
                }
                b']' => {
                    if stack.pop() != Some(b'[') {
                        return Err(PrefixScanError::Invalid("JSON配列の終端が不正です"));
                    }
                    cursor += 1;
                    if stack.is_empty() {
                        return Ok(cursor);
                    }
                }
                _ => cursor += 1,
            }
        }
        return Err(PrefixScanError::NeedMore);
    }

    let mut cursor = start;
    while cursor < bytes.len()
        && !matches!(
            bytes[cursor],
            b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t'
        )
    {
        cursor += 1;
    }
    if cursor == bytes.len() {
        Err(PrefixScanError::NeedMore)
    } else if cursor == start {
        Err(PrefixScanError::Invalid("JSONの値が不正です"))
    } else {
        Ok(cursor)
    }
}

fn extract_metadata_prefix(input: &str) -> MetadataPrefixResult {
    let bytes = input.as_bytes();
    let mut cursor = skip_json_whitespace(bytes, 0);
    if bytes.get(cursor) != Some(&b'{') {
        return if cursor == bytes.len() {
            MetadataPrefixResult::simple("needMore")
        } else {
            MetadataPrefixResult::invalid("JSONのルートがオブジェクトではありません")
        };
    }
    cursor += 1;

    loop {
        cursor = skip_json_whitespace(bytes, cursor);
        let Some(byte) = bytes.get(cursor).copied() else {
            return MetadataPrefixResult::simple("needMore");
        };
        if byte == b'}' {
            return MetadataPrefixResult::simple("missing");
        }

        let key_end = match json_string_end(bytes, cursor) {
            Ok(end) => end,
            Err(PrefixScanError::NeedMore) => return MetadataPrefixResult::simple("needMore"),
            Err(PrefixScanError::Invalid(error)) => return MetadataPrefixResult::invalid(error),
        };
        let key = match serde_json::from_slice::<String>(&bytes[cursor..key_end]) {
            Ok(key) => key,
            Err(error) => return MetadataPrefixResult::invalid(error.to_string()),
        };
        cursor = skip_json_whitespace(bytes, key_end);
        if bytes.get(cursor) != Some(&b':') {
            return if cursor == bytes.len() {
                MetadataPrefixResult::simple("needMore")
            } else {
                MetadataPrefixResult::invalid("JSONのキーの後にコロンがありません")
            };
        }
        cursor += 1;
        let value_start = skip_json_whitespace(bytes, cursor);

        let value_end = match json_value_end(bytes, value_start) {
            Ok(end) => end,
            Err(PrefixScanError::NeedMore) => return MetadataPrefixResult::simple("needMore"),
            Err(PrefixScanError::Invalid(error)) => return MetadataPrefixResult::invalid(error),
        };
        if key == "metadata" {
            return match serde_json::from_slice::<Option<MetadataPreview>>(
                &bytes[value_start..value_end],
            ) {
                Ok(metadata) => MetadataPrefixResult::found(metadata),
                Err(error) => MetadataPrefixResult::invalid(error.to_string()),
            };
        }

        cursor = skip_json_whitespace(bytes, value_end);
        match bytes.get(cursor) {
            Some(b',') => cursor += 1,
            Some(b'}') => return MetadataPrefixResult::simple("missing"),
            None => return MetadataPrefixResult::simple("needMore"),
            _ => return MetadataPrefixResult::invalid("JSONオブジェクトの区切りが不正です"),
        }
    }
}

fn metadata_prefix_json(input: &str) -> String {
    serde_json::to_string(&extract_metadata_prefix(input)).unwrap_or_else(|error| {
        format!(r#"{{"status":"invalid","error":"結果を生成できません: {error}"}}"#)
    })
}

#[derive(Deserialize)]
struct SocialLink {
    label: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    start: bool,
    #[serde(default)]
    terminal: bool,
    #[serde(default)]
    script: Option<ScriptCall>,
    #[serde(default)]
    media: Vec<MediaCandidate>,
    #[serde(default)]
    on_end: Vec<Transition>,
    #[serde(default)]
    buttons: Vec<String>,
    #[serde(default)]
    player_control: Option<String>,
    #[serde(default)]
    editor: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ScriptCall {
    path: String,
    #[serde(default)]
    function: Option<String>,
}

#[derive(Deserialize)]
struct MediaCandidate {
    id: String,
    weight: f64,
    source: MediaSource,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaSource {
    #[serde(rename = "type")]
    source_type: String,
    #[serde(default)]
    audio: Option<String>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    video: Option<String>,
    #[serde(default)]
    subtitle: Option<String>,
    #[serde(default)]
    visual: Option<String>,
    #[serde(default = "default_volume")]
    volume: f64,
    #[serde(default)]
    r#loop: bool,
    #[serde(default = "default_fit")]
    fit: String,
    #[serde(default)]
    image_transition: Option<ImageTransition>,
}

fn default_volume() -> f64 {
    1.0
}

fn default_fit() -> String {
    "contain".to_owned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageTransition {
    #[serde(rename = "type")]
    transition_type: String,
    duration_ms: i64,
}

#[derive(Deserialize)]
struct Transition {
    to: String,
    weight: f64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Button {
    #[serde(default)]
    visibility: Vec<VisibilityRange>,
    #[serde(default)]
    target_slot: Option<String>,
    #[serde(default)]
    order: i64,
    #[serde(default)]
    z_index: i64,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    style: ButtonStyle,
    #[serde(default)]
    render: Option<ScriptCall>,
    #[serde(default)]
    on_press: Vec<Transition>,
    #[serde(default)]
    editor: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisibilityRange {
    from_ms: i64,
    #[serde(default)]
    to_ms: Option<i64>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ButtonStyle {
    #[serde(default)]
    background_color: Option<String>,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    text_color: Option<String>,
    #[serde(default)]
    opacity: Option<f64>,
    #[serde(default)]
    border_color: Option<String>,
    #[serde(default)]
    border_width: Option<f64>,
    #[serde(default)]
    border_radius: Option<f64>,
    #[serde(default)]
    font_size: Option<f64>,
    #[serde(default)]
    font_weight: Option<i64>,
    #[serde(default)]
    padding_horizontal: Option<f64>,
    #[serde(default)]
    padding_vertical: Option<f64>,
}

#[allow(dead_code)]
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerControlSettings {
    #[serde(default)]
    accent_color: Option<String>,
    #[serde(default)]
    layout: Option<String>,
    #[serde(default)]
    allow_stop: Option<bool>,
    #[serde(default)]
    show_seek_bar: Option<bool>,
    #[serde(default)]
    show_playback_time: Option<bool>,
    #[serde(default)]
    allow_seek: Option<bool>,
    #[serde(default)]
    show_scene_name: Option<bool>,
    #[serde(default)]
    show_file_name: Option<bool>,
    #[serde(default)]
    allow_next: Option<bool>,
    #[serde(default)]
    allow_previous: Option<bool>,
    #[serde(default)]
    editor: Option<serde_json::Value>,
}

pub fn validate_json(input: &str) -> Vec<ValidationIssue> {
    match serde_json::from_str::<Graph>(input) {
        Ok(graph) => validate_graph(&graph),
        Err(error) => vec![ValidationIssue::error(format!(
            "JSONを解析できません: {error}"
        ))],
    }
}

pub fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(':')
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "..")
}

fn validate_graph(graph: &Graph) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    if graph.version != 1 {
        issues.push(ValidationIssue::error(
            "対応している Yuraive バージョンは 1 です",
        ));
    }
    let starts = graph.nodes.values().filter(|node| node.start).count();
    if starts != 1 {
        issues.push(ValidationIssue::error(format!(
            "開始ノードは 1 件必要です（現在 {starts} 件）"
        )));
    }

    if let Some(metadata) = &graph.metadata {
        if metadata
            .content_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty())
        {
            issues.push(ValidationIssue::error(
                "metadata.contentId は空文字列にできません",
            ));
        }
        for (index, link) in metadata.social_links.iter().enumerate() {
            if link.label.trim().is_empty() {
                issues.push(ValidationIssue::error(format!(
                    "socialLinks[{index}]: label は必須です"
                )));
            }
            let lower = link.url.to_ascii_lowercase();
            if !lower.starts_with("https://") && !lower.starts_with("http://") {
                issues.push(ValidationIssue::error(format!(
                    "socialLinks[{index}]: http(s) URL を指定してください"
                )));
            }
        }
    }

    if let Some(stats) = &graph.playback_stats {
        if stats.path.trim().is_empty() {
            issues.push(ValidationIssue::error("playbackStats.path は必須です"));
        } else if !stats.path.to_ascii_lowercase().ends_with(".star") {
            issues.push(ValidationIssue::error(
                "playbackStats.path は .star ファイルを指定してください",
            ));
        }
        if stats
            .function
            .as_ref()
            .is_some_and(|function| function.trim().is_empty())
        {
            issues.push(ValidationIssue::error(
                "playbackStats.function は空文字列にできません",
            ));
        }
    }

    if let Some(id) = &graph.global_player_control {
        if !graph.player_controls.contains_key(id) {
            issues.push(ValidationIssue::error(format!(
                "グローバル再生設定 {id} がありません"
            )));
        }
    }

    for (node_id, node) in &graph.nodes {
        if node_id.trim().is_empty() {
            issues.push(ValidationIssue::error("空のノード ID は使用できません"));
        }
        if node.node_type != "media" && node.node_type != "script" {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: 未対応のノード種別 {}",
                node.node_type
            )));
        }
        validate_transitions(
            &format!("{node_id} の終了遷移"),
            &node.on_end,
            graph,
            &mut issues,
        );

        if node.node_type == "script" {
            if node
                .script
                .as_ref()
                .is_none_or(|script| script.path.trim().is_empty())
            {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: スクリプトが設定されていません"
                )));
            }
            if node.on_end.is_empty() {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: スクリプトノードには終了遷移が必要です"
                )));
            }
            if node.terminal {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: スクリプトノードを終端にはできません"
                )));
            }
            if node.player_control.is_some() {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: スクリプトノードには再生設定を接続できません"
                )));
            }
        }

        if let Some(id) = &node.player_control {
            if !graph.player_controls.contains_key(id) {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: 再生設定 {id} がありません"
                )));
            }
        }
        if node.terminal && (!node.on_end.is_empty() || !node.buttons.is_empty()) {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: 終端ノードには遷移やボタンを設定できません"
            )));
        }
        if node.terminal && node.media.iter().any(|media| media.source.r#loop) {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: 終端メディアはループできません"
            )));
        }
        if node.node_type == "media"
            && !node.terminal
            && node.on_end.is_empty()
            && node.buttons.is_empty()
        {
            issues.push(ValidationIssue::warning(format!(
                "{node_id}: 終端ではないノードに遷移がありません"
            )));
        }
        if has_duplicates(node.buttons.iter().map(String::as_str)) {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: 同じボタンが重複しています"
            )));
        }
        for id in node
            .buttons
            .iter()
            .filter(|id| !graph.buttons.contains_key(*id))
        {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: ボタン {id} がありません"
            )));
        }
        if node.node_type == "media" && !node.buttons.is_empty() {
            let control_id = node
                .player_control
                .as_ref()
                .or(graph.global_player_control.as_ref());
            let layout = control_id
                .and_then(|id| graph.player_controls.get(id))
                .and_then(|control| control.layout.as_ref());
            if layout.is_none() {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}: ボタンを表示する再生設定にレイアウトが接続されていません"
                )));
            }
        }
        if has_duplicates(node.media.iter().map(|media| media.id.as_str())) {
            issues.push(ValidationIssue::error(format!(
                "{node_id}: メディア ID が重複しています"
            )));
        }
        for media in &node.media {
            if media.weight < 0.0 || !media.weight.is_finite() {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}/{}: 重みは 0 以上の有限値にしてください",
                    media.id
                )));
            }
            if !(0.0..=1.0).contains(&media.source.volume) || !media.source.volume.is_finite() {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}/{}: 音量は 0〜1 で指定してください",
                    media.id
                )));
            }
            let source_ok = match media.source.source_type.as_str() {
                "audio" | "audioImage" => media
                    .source
                    .audio
                    .as_ref()
                    .is_some_and(|path| !path.trim().is_empty()),
                "video" => media
                    .source
                    .video
                    .as_ref()
                    .is_some_and(|path| !path.trim().is_empty()),
                _ => false,
            };
            if !source_ok {
                issues.push(ValidationIssue::error(format!(
                    "{node_id}/{}: メディアソースが不正です",
                    media.id
                )));
            }
        }
    }

    for (button_id, button) in &graph.buttons {
        if button_id.trim().is_empty() {
            issues.push(ValidationIssue::error("空のボタン ID は使用できません"));
        }
        validate_transitions(
            &format!("{button_id} の押下遷移"),
            &button.on_press,
            graph,
            &mut issues,
        );
        if button
            .style
            .opacity
            .is_some_and(|opacity| !opacity.is_finite() || !(0.0..=1.0).contains(&opacity))
        {
            issues.push(ValidationIssue::error(format!(
                "{button_id}: opacity は 0〜1 の有限値で指定してください"
            )));
        }
        for (name, value) in [
            ("borderWidth", button.style.border_width),
            ("borderRadius", button.style.border_radius),
            ("paddingHorizontal", button.style.padding_horizontal),
            ("paddingVertical", button.style.padding_vertical),
        ] {
            if value.is_some_and(|value| !value.is_finite() || value < 0.0) {
                issues.push(ValidationIssue::error(format!(
                    "{button_id}: {name} は 0 以上の有限値で指定してください"
                )));
            }
        }
        if button
            .style
            .font_size
            .is_some_and(|value| !value.is_finite() || value <= 0.0)
        {
            issues.push(ValidationIssue::error(format!(
                "{button_id}: fontSize は 0 より大きい有限値で指定してください"
            )));
        }
        if button
            .style
            .font_weight
            .is_some_and(|value| !(1..=1000).contains(&value))
        {
            issues.push(ValidationIssue::error(format!(
                "{button_id}: fontWeight は 1〜1000 の整数で指定してください"
            )));
        }
        for range in &button.visibility {
            if range.from_ms < 0 || range.to_ms.is_some_and(|end| end < range.from_ms) {
                issues.push(ValidationIssue::error(format!(
                    "{button_id}: 表示区間が不正です"
                )));
            }
        }
        if !graph
            .nodes
            .values()
            .any(|node| node.buttons.contains(button_id))
        {
            issues.push(ValidationIssue::warning(format!(
                "{button_id}: どのノードにも接続されていません"
            )));
        }
    }

    for (id, control) in &graph.player_controls {
        if id.trim().is_empty() {
            issues.push(ValidationIssue::error("空の再生設定 ID は使用できません"));
        }
        if graph.global_player_control.as_ref() != Some(id)
            && !graph
                .nodes
                .values()
                .any(|node| node.player_control.as_ref() == Some(id))
        {
            issues.push(ValidationIssue::warning(format!(
                "{id}: どこにも接続されていない再生設定です"
            )));
        }
        if let Some(color) = &control.accent_color {
            if !is_safe_accent_color(color) {
                issues.push(ValidationIssue::error(format!(
                    "{id}: accentColor は白・黒に近すぎない #RRGGBB 形式で指定してください"
                )));
            }
        }
        if let Some(layout) = &control.layout {
            if !layout.to_ascii_lowercase().ends_with(".yuraive-layout.html") {
                issues.push(ValidationIssue::error(format!(
                    "{id}: layout は .yuraive-layout.html ファイルを指定してください"
                )));
            }
        }
    }

    for path in all_asset_paths(graph) {
        if !is_safe_relative_path(&path) {
            issues.push(ValidationIssue::error_at(
                format!("コンテンツ外を参照するパスです: {path}"),
                path,
            ));
        }
    }
    issues
}

fn validate_transitions(
    label: &str,
    transitions: &[Transition],
    graph: &Graph,
    issues: &mut Vec<ValidationIssue>,
) {
    for transition in transitions {
        if !graph.nodes.contains_key(&transition.to) {
            issues.push(ValidationIssue::error(format!(
                "{label}: 遷移先 {} がありません",
                transition.to
            )));
        }
        if transition.weight < 0.0 || !transition.weight.is_finite() {
            issues.push(ValidationIssue::error(format!(
                "{label}: 重みは 0 以上の有限値にしてください"
            )));
        }
    }
    if !transitions.is_empty() && !transitions.iter().any(|transition| transition.weight > 0.0) {
        issues.push(ValidationIssue::error(format!(
            "{label}: 重みがすべて 0 です"
        )));
    }
}

fn all_asset_paths(graph: &Graph) -> BTreeSet<String> {
    let mut paths = BTreeSet::new();
    if let Some(metadata) = &graph.metadata {
        insert_optional(&mut paths, &metadata.thumbnail);
    }
    if let Some(stats) = &graph.playback_stats {
        paths.insert(stats.path.clone());
    }
    for node in graph.nodes.values() {
        if let Some(script) = &node.script {
            paths.insert(script.path.clone());
        }
        for media in &node.media {
            insert_optional(&mut paths, &media.source.audio);
            insert_optional(&mut paths, &media.source.image);
            insert_optional(&mut paths, &media.source.video);
            insert_optional(&mut paths, &media.source.subtitle);
        }
    }
    for button in graph.buttons.values() {
        insert_optional(&mut paths, &button.style.background_image);
        if let Some(render) = &button.render {
            paths.insert(render.path.clone());
        }
    }
    for control in graph.player_controls.values() {
        insert_optional(&mut paths, &control.layout);
    }
    paths
}

fn is_safe_accent_color(color: &str) -> bool {
    let bytes = color.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return false;
    }
    let channel =
        |index: usize| u8::from_str_radix(&color[index..index + 2], 16).unwrap() as f64 / 255.0;
    let linear = |value: f64| {
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    let luminance =
        0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5));
    (0.08..=0.90).contains(&luminance)
}

fn insert_optional(paths: &mut BTreeSet<String>, path: &Option<String>) {
    if let Some(path) = path {
        paths.insert(path.clone());
    }
}

fn has_duplicates<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    values.any(|value| !seen.insert(value))
}

fn validation_json(input: &str) -> String {
    serde_json::to_string(&validate_json(input)).unwrap_or_else(|error| {
        format!(r#"[{{"severity":"ERROR","message":"検証結果を生成できません: {error}"}}]"#)
    })
}

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
#[no_mangle]
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
#[no_mangle]
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
#[no_mangle]
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
#[no_mangle]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_resolve_button_layout_json(input: *const c_char) -> *mut c_char {
    let output = catch_unwind(AssertUnwindSafe(|| match ffi_input(input) {
        Ok(value) => resolve_button_layout_json(value),
        Err(error) => format!(r#"{{"buttons":[],"issues":[{}]}}"#, serde_json::to_string(&error).unwrap_or_default()),
    }))
    .unwrap_or_else(|_| r#"{"buttons":[],"issues":["Rustレイアウトエンジンで内部エラーが発生しました"]}"#.to_owned());
    ffi_output(output)
}

/// Decode a Yuraive binary player bundle and return its graph and embedded text
/// files as JSON. The input buffer only needs to remain valid for this call.
#[no_mangle]
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
    .unwrap_or_else(|_| serde_json::json!({ "error": "Rustバンドル解析器で内部エラーが発生しました" }).to_string());
    ffi_output(output)
}

/// Release a string returned by one of the native desktop entry points.
#[no_mangle]
#[cfg(not(target_arch = "wasm32"))]
pub extern "C" fn yuraive_string_free(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: The pointer was allocated by CString::into_raw in
        // `ffi_output` and ownership is transferred back exactly once.
        unsafe { drop(CString::from_raw(value)) };
    }
}

#[no_mangle]
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

#[no_mangle]
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

#[no_mangle]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_com_yuraive_player_model_NativeBundleDecoder_decodeNative<'local>(
    env: JNIEnv<'local>,
    _this: JObject<'local>,
    input: JByteArray<'local>,
) -> jstring {
    let output = catch_unwind(AssertUnwindSafe(|| match env.convert_byte_array(&input) {
        Ok(value) => decode_bundle_json(&value),
        Err(error) => serde_json::json!({ "error": format!("バンドルを受け取れません: {error}") }).to_string(),
    }))
    .unwrap_or_else(|_| serde_json::json!({ "error": "Rustバンドル解析器で内部エラーが発生しました" }).to_string());

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
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

#[no_mangle]
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
        Err(error) => format!(r#"{{"buttons":[],"issues":[{}]}}"#, serde_json::to_string(&format!("レイアウト要求を受け取れません: {error}")).unwrap_or_default()),
    }))
    .unwrap_or_else(|_| r#"{"buttons":[],"issues":["Rustレイアウトエンジンで内部エラーが発生しました"]}"#.to_owned());

    env.new_string(output)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages(json: &str) -> Vec<String> {
        validate_json(json)
            .into_iter()
            .map(|issue| issue.message)
            .collect()
    }

    #[test]
    fn safe_paths_reject_escapes_and_urls() {
        assert!(is_safe_relative_path("audio/rain.ogg"));
        assert!(!is_safe_relative_path("../secret.mp3"));
        assert!(!is_safe_relative_path("https://example.com/a.mp3"));
        assert!(!is_safe_relative_path("/sdcard/a.mp3"));
    }

    #[test]
    fn requires_exactly_one_start_and_existing_transitions() {
        let issues = messages(
            r#"{
            "version":1,
            "nodes":{
                "start":{"type":"media","start":true,"onEnd":[{"to":"missing","weight":1}]},
                "second":{"type":"media","start":true,"terminal":true}
            },
            "buttons":{}
        }"#,
        );
        assert!(issues.iter().any(|message| message.contains("開始ノード")));
        assert!(issues.iter().any(|message| message.contains("missing")));
    }

    #[test]
    fn checks_controls_social_urls_and_script_nodes() {
        let issues = validate_json(
            r#"{
            "version":1,
            "metadata":{"socialLinks":[{"label":"Web","url":"javascript:alert(1)"}]},
            "nodes":{
                "route":{"type":"script","start":true,"script":{"path":"route.star"},"onEnd":[{"to":"end","weight":1}],"playerControl":"default"},
                "end":{"type":"media","terminal":true}
            },
            "buttons":{},
            "playerControls":{"default":{},"unused":{}},
            "globalPlayerControl":"missing"
        }"#,
        );
        assert!(issues.iter().any(|issue| issue.message.contains("http(s)")));
        assert!(issues
            .iter()
            .any(|issue| issue.message.contains("グローバル再生設定")));
        assert!(issues
            .iter()
            .any(|issue| issue.message.contains("スクリプトノードには再生設定")));
        assert!(issues
            .iter()
            .any(|issue| issue.severity == Severity::Warning && issue.message.contains("unused")));
    }

    #[test]
    fn valid_graph_has_no_semantic_issues() {
        let issues = validate_json(
            r#"{
            "version":1,
            "nodes":{"start":{"type":"media","start":true,"terminal":true,"media":[{"id":"rain","weight":1,"source":{"type":"audio","audio":"audio/rain.ogg"}}]}},
            "buttons":{}
        }"#,
        );
        assert!(issues.is_empty(), "{issues:?}");
    }

    #[test]
    fn button_nodes_require_a_v1_layout_document() {
        let missing = messages(
            r#"{
            "version":1,
            "nodes":{
              "start":{"type":"media","start":true,"buttons":["continue"]},
              "end":{"type":"media","terminal":true}
            },
            "buttons":{"continue":{"text":"Continue","onPress":[{"to":"end","weight":1}]}},
            "playerControls":{"default":{}},
            "globalPlayerControl":"default"
        }"#,
        );
        assert!(missing.iter().any(|message| message.contains("レイアウト")));

        let valid = validate_json(
            r#"{
            "version":1,
            "nodes":{
              "start":{"type":"media","start":true,"buttons":["continue"]},
              "end":{"type":"media","terminal":true}
            },
            "buttons":{"continue":{"targetSlot":"actions","order":10,"zIndex":2,"text":"Continue","style":{"opacity":0.8},"onPress":[{"to":"end","weight":1}]}},
            "playerControls":{"default":{"layout":"default.yuraive-layout.html"}},
            "globalPlayerControl":"default"
        }"#,
        );
        assert!(valid.is_empty(), "{valid:?}");
    }

    #[test]
    fn validates_playback_stats_and_safe_accent_colors() {
        let valid = validate_json(
            r##"{
            "version":1,
            "metadata":{"contentId":"com.example.rain"},
            "playbackStats":{"path":"scripts/stats.star"},
            "nodes":{"start":{"type":"media","start":true,"terminal":true}},
            "buttons":{},
            "playerControls":{"default":{"accentColor":"#574de5"}},
            "globalPlayerControl":"default"
        }"##,
        );
        assert!(valid.is_empty(), "{valid:?}");

        let invalid = messages(
            r##"{
            "version":1,
            "playbackStats":{"path":"stats.py"},
            "nodes":{"start":{"type":"media","start":true,"terminal":true}},
            "buttons":{},
            "playerControls":{"white":{"accentColor":"#FFFFFF"}}
        }"##,
        );
        assert!(invalid.iter().any(|message| message.contains(".star")));
        assert!(invalid
            .iter()
            .any(|message| message.contains("accentColor")));
    }

    #[test]
    fn extracts_metadata_without_reading_nodes() {
        let result = extract_metadata_prefix(
            r#"{"version":1,"metadata":{"displayName":"Rain","author":"Hiro","thumbnail":"cover.webp"},"nodes":{"huge":"#,
        );
        assert_eq!(result.status, "found");
        assert_eq!(
            result.metadata,
            Some(MetadataPreview {
                display_name: Some("Rain".to_owned()),
                author: Some("Hiro".to_owned()),
                thumbnail: Some("cover.webp".to_owned()),
            })
        );
    }

    #[test]
    fn metadata_prefix_reports_partial_and_missing_metadata() {
        assert_eq!(
            extract_metadata_prefix(r#"{"version":1,"meta"#).status,
            "needMore"
        );
        assert_eq!(
            extract_metadata_prefix(r#"{"version":1,"nodes":{"still":"not read""#).status,
            "needMore"
        );
        assert_eq!(
            extract_metadata_prefix(r#"{"version":1,"nodes":{},"buttons":{}}"#).status,
            "missing"
        );
    }

    #[test]
    fn extracts_legacy_metadata_after_nodes_without_deserializing_nodes() {
        let result = extract_metadata_prefix(
            r#"{"version":1,"nodes":{"large":{"nested":[1,2,3]}},"metadata":{"displayName":"Legacy","thumbnail":"images/cover.png"},"buttons":{}}"#,
        );
        assert_eq!(result.status, "found");
        assert_eq!(
            result.metadata,
            Some(MetadataPreview {
                display_name: Some("Legacy".to_owned()),
                author: None,
                thumbnail: Some("images/cover.png".to_owned()),
            })
        );
    }
}
