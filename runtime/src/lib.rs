#![allow(dead_code)]

mod script_engine;

#[cfg(not(target_arch = "wasm32"))]
use jni::objects::{JObject, JString};
#[cfg(not(target_arch = "wasm32"))]
use jni::sys::jstring;
#[cfg(not(target_arch = "wasm32"))]
use jni::JNIEnv;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
#[cfg(not(target_arch = "wasm32"))]
use std::panic::{catch_unwind, AssertUnwindSafe};

pub use script_engine::{run_starlark, run_starlark_json, StarlarkRunRequest, StarlarkRunResponse};

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
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
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
    layout: Option<ButtonLayout>,
    #[serde(default)]
    appearance: Option<ButtonAppearance>,
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

#[derive(Deserialize)]
struct ButtonLayout {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    z: i64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ButtonAppearance {
    #[serde(default)]
    background_color: Option<String>,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    text_color: Option<String>,
}

#[allow(dead_code)]
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerControlSettings {
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
            "対応している WMGF バージョンは 1 です",
        ));
    }
    let starts = graph.nodes.values().filter(|node| node.start).count();
    if starts != 1 {
        issues.push(ValidationIssue::error(format!(
            "開始ノードは 1 件必要です（現在 {starts} 件）"
        )));
    }

    if let Some(metadata) = &graph.metadata {
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
        if let Some(layout) = &button.layout {
            if [layout.x, layout.y, layout.width, layout.height]
                .iter()
                .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
            {
                issues.push(ValidationIssue::error(format!(
                    "{button_id}: ボタン配置は 0〜1 で指定してください"
                )));
            }
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

    for id in graph.player_controls.keys() {
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
        if let Some(appearance) = &button.appearance {
            insert_optional(&mut paths, &appearance.background_image);
        }
        if let Some(render) = &button.render {
            paths.insert(render.path.clone());
        }
    }
    paths
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

#[no_mangle]
#[cfg(not(target_arch = "wasm32"))]
pub extern "system" fn Java_dev_hiro_wmgfplayer_model_NativeGraphValidator_validateJsonNative<
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
pub extern "system" fn Java_dev_hiro_wmgfplayer_playback_NativeStarlarkEngine_runJsonNative<
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
}
