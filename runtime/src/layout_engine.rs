//! Platform-neutral interpreter for the safe `.wmg-layout.html` subset.
//!
//! The runtime intentionally produces geometry and appearance data only.  Android and Windows
//! turn that render model into native controls; no browser DOM or JavaScript is involved.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use taffy::prelude::*;
use taffy::geometry::Point;
use taffy::style::{
    GridAutoTracks, GridPlacement, GridTemplateArea, GridTemplateComponent, GridTemplateTracks, Overflow,
};
use unicode_width::UnicodeWidthStr;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRequest {
    pub source: String,
    #[serde(default)]
    pub buttons: Vec<LayoutButton>,
    pub canvas: LayoutCanvas,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutCanvas {
    pub width: f32,
    pub height: f32,
    #[serde(default = "one")]
    pub density: f32,
    #[serde(default = "one")]
    pub font_scale: f32,
    #[serde(default)]
    pub safe_top: f32,
    #[serde(default)]
    pub safe_right: f32,
    #[serde(default)]
    pub safe_bottom: f32,
    #[serde(default)]
    pub safe_left: f32,
}

fn one() -> f32 { 1.0 }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutButton {
    pub id: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub target_slot: Option<String>,
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub style: ButtonInputStyle,
}

fn yes() -> bool { true }

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonInputStyle {
    pub background_color: Option<String>,
    pub background_image: Option<String>,
    pub text_color: Option<String>,
    pub opacity: Option<f32>,
    pub border_color: Option<String>,
    pub border_width: Option<f32>,
    pub border_radius: Option<f32>,
    pub font_size: Option<f32>,
    pub font_weight: Option<i32>,
    pub padding_horizontal: Option<f32>,
    pub padding_vertical: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutResponse {
    pub buttons: Vec<ResolvedButton>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedButton {
    pub id: String,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub z_index: i32,
    pub enabled: bool,
    pub style: NativeButtonStyle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeButtonStyle {
    pub background_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_image: Option<String>,
    pub background_size: String,
    pub background_position: String,
    pub background_repeat: String,
    pub text_color: String,
    pub opacity: f32,
    pub border_color: String,
    pub border_width: f32,
    pub border_radius: f32,
    pub font_size: f32,
    pub font_weight: i32,
    pub padding_left: f32,
    pub padding_top: f32,
    pub padding_right: f32,
    pub padding_bottom: f32,
    pub text_align: String,
    pub vertical_align: String,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub white_space: String,
    pub text_overflow: String,
    pub overflow: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_shadow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElementKind { Root, Div, Slot, Button }

#[derive(Debug, Clone)]
struct Element {
    kind: ElementKind,
    attrs: BTreeMap<String, String>,
    classes: Vec<String>,
    parent: Option<usize>,
    children: Vec<usize>,
    button: Option<usize>,
    computed: BTreeMap<String, String>,
}

impl Element {
    fn new(kind: ElementKind, parent: Option<usize>) -> Self {
        Self { kind, attrs: BTreeMap::new(), classes: vec![], parent, children: vec![], button: None, computed: BTreeMap::new() }
    }

    fn tag(&self) -> &'static str {
        match self.kind { ElementKind::Root => "wmg-canvas", ElementKind::Div => "div", ElementKind::Slot => "slot", ElementKind::Button => "button" }
    }
}

#[derive(Debug, Clone)]
struct CssRule {
    selector: String,
    declarations: Vec<(String, String)>,
    specificity: (u16, u16, u16),
    order: usize,
}

#[derive(Debug, Clone)]
struct ButtonNodeContext {
    text: String,
    font_size: f32,
    line_height: f32,
    letter_spacing: f32,
    white_space: bool,
    stretch_width: bool,
}

/// Resolve a request and always return JSON. Invalid input becomes an empty model with an issue.
pub fn resolve_button_layout_json(request_json: &str) -> String {
    let response = match serde_json::from_str::<LayoutRequest>(request_json) {
        Ok(request) => resolve_button_layout(&request),
        Err(error) => LayoutResponse { buttons: vec![], issues: vec![format!("レイアウト要求が不正です: {error}")] },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| "{\"buttons\":[],\"issues\":[\"レイアウト結果を生成できません\"]}".into())
}

pub fn resolve_button_layout(request: &LayoutRequest) -> LayoutResponse {
    let mut issues = vec![];
    if !request.canvas.width.is_finite() || !request.canvas.height.is_finite()
        || request.canvas.width <= 0.0 || request.canvas.height <= 0.0
    {
        return LayoutResponse { buttons: vec![], issues: vec!["キャンバス寸法が不正です".into()] };
    }

    let (style_source, markup) = extract_styles(&request.source);
    let mut elements = parse_markup(&markup, &mut issues);
    inject_buttons(&mut elements, &request.buttons, &mut issues);
    let rules = parse_css(&style_source, &request.canvas, &mut issues);
    apply_cascade(&mut elements, &rules, &request.canvas);

    match compute_native_model(&elements, request, &mut issues) {
        Ok(buttons) => LayoutResponse { buttons, issues },
        Err(error) => LayoutResponse { buttons: vec![], issues: vec![format!("レイアウト計算に失敗しました: {error}")] },
    }
}

fn extract_styles(source: &str) -> (String, String) {
    let lower = source.to_ascii_lowercase();
    let mut css = String::new();
    let mut html = String::with_capacity(source.len());
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find("<style") {
        let start = cursor + relative;
        html.push_str(&source[cursor..start]);
        let Some(open_rel) = lower[start..].find('>') else { break };
        let open_end = start + open_rel + 1;
        let Some(close_rel) = lower[open_end..].find("</style>") else { break };
        let close = open_end + close_rel;
        css.push_str(&source[open_end..close]);
        css.push('\n');
        cursor = close + "</style>".len();
    }
    html.push_str(&source[cursor..]);
    (remove_css_comments(&css), html)
}

fn remove_css_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') { i += 1; }
            i = (i + 2).min(bytes.len());
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

fn parse_markup(markup: &str, issues: &mut Vec<String>) -> Vec<Element> {
    let mut nodes = vec![Element::new(ElementKind::Root, None)];
    let mut stack = vec![0usize];
    let mut cursor = 0;
    while let Some(rel) = markup[cursor..].find('<') {
        let start = cursor + rel;
        let Some(end_rel) = find_tag_end(&markup[start + 1..]) else { break };
        let end = start + 1 + end_rel;
        let raw = markup[start + 1..end].trim();
        cursor = end + 1;
        if raw.starts_with('!') || raw.starts_with('?') { continue; }
        if let Some(closing) = raw.strip_prefix('/') {
            let name = closing.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
            if matches!(name.as_str(), "div" | "slot") && stack.len() > 1 { stack.pop(); }
            continue;
        }
        let self_closing = raw.ends_with('/');
        let body = raw.trim_end_matches('/').trim();
        let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
        let name = body[..name_end].to_ascii_lowercase();
        let kind = match name.as_str() {
            "div" => ElementKind::Div,
            "slot" => ElementKind::Slot,
            "script" | "iframe" | "link" | "img" => {
                issues.push(format!("禁止要素 <{name}> を除去しました"));
                continue;
            }
            "" => continue,
            _ => { issues.push(format!("未対応要素 <{name}> を除去しました")); continue; }
        };
        let parent = *stack.last().unwrap_or(&0);
        let mut node = Element::new(kind, Some(parent));
        for (key, value) in parse_attributes(&body[name_end..]) {
            if matches!(key.as_str(), "class" | "id" | "name" | "style" | "role" | "aria-label") {
                if key == "class" { node.classes = value.split_ascii_whitespace().map(str::to_owned).collect(); }
                node.attrs.insert(key, value);
            } else if key.starts_with("on") {
                issues.push(format!("イベント属性 {key} を除去しました"));
            }
        }
        let index = nodes.len();
        nodes.push(node);
        nodes[parent].children.push(index);
        if !self_closing { stack.push(index); }
    }
    nodes
}

fn find_tag_end(input: &str) -> Option<usize> {
    let mut quote = None;
    for (i, ch) in input.char_indices() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (None, '\'' | '"') => quote = Some(ch),
            (None, '>') => return Some(i),
            _ => {}
        }
    }
    None
}

fn parse_attributes(input: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = input.chars().collect();
    let mut attrs = vec![];
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() { i += 1; }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '=' { i += 1; }
        if start == i { i += 1; continue; }
        let key: String = chars[start..i].iter().collect::<String>().to_ascii_lowercase();
        while i < chars.len() && chars[i].is_whitespace() { i += 1; }
        let mut value = String::new();
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() { i += 1; }
            if i < chars.len() && matches!(chars[i], '\'' | '"') {
                let quote = chars[i]; i += 1; let value_start = i;
                while i < chars.len() && chars[i] != quote { i += 1; }
                value = chars[value_start..i].iter().collect();
                if i < chars.len() { i += 1; }
            } else {
                let value_start = i;
                while i < chars.len() && !chars[i].is_whitespace() { i += 1; }
                value = chars[value_start..i].iter().collect();
            }
        }
        attrs.push((key, decode_entities(&value)));
    }
    attrs
}

fn decode_entities(value: &str) -> String {
    value.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn inject_buttons(nodes: &mut Vec<Element>, buttons: &[LayoutButton], issues: &mut Vec<String>) {
    let slots: Vec<usize> = nodes.iter().enumerate().filter_map(|(i, n)| (n.kind == ElementKind::Slot).then_some(i)).collect();
    let default_slot = slots.iter().copied().find(|&i| slot_id(&nodes[i]).is_empty());
    let mut sorted: Vec<(usize, &LayoutButton)> = buttons.iter().enumerate().filter(|(_, button)| button.visible).collect();
    sorted.sort_by_key(|(index, button)| (button.order, *index));
    for (button_index, button) in sorted {
        let requested = button.target_slot.as_deref().unwrap_or("").trim();
        let target = if requested.is_empty() {
            default_slot
        } else {
            slots.iter().copied().find(|&i| slot_id(&nodes[i]) == requested).or(default_slot)
        };
        let Some(parent) = target else {
            issues.push(format!("ボタン {} の配置先slotがありません", button.id));
            continue;
        };
        let mut node = Element::new(ElementKind::Button, Some(parent));
        node.classes.push("wmg-button".into());
        node.attrs.insert("data-button-id".into(), button.id.clone());
        node.button = Some(button_index);
        let index = nodes.len();
        nodes.push(node);
        nodes[parent].children.push(index);
    }
}

fn slot_id(node: &Element) -> &str {
    node.attrs.get("name").filter(|v| !v.trim().is_empty())
        .or_else(|| node.attrs.get("id")).map(String::as_str).unwrap_or("").trim()
}

fn parse_css(input: &str, canvas: &LayoutCanvas, issues: &mut Vec<String>) -> Vec<CssRule> {
    let mut rules = vec![];
    parse_css_block(input, canvas, &mut rules, issues);
    rules
}

fn parse_css_block(input: &str, canvas: &LayoutCanvas, rules: &mut Vec<CssRule>, issues: &mut Vec<String>) {
    let mut cursor = 0;
    while let Some(open_rel) = find_top_level(&input[cursor..], '{') {
        let open = cursor + open_rel;
        let Some(close) = matching_brace(input, open) else { issues.push("閉じられていないCSSブロックを無視しました".into()); break };
        let header = input[cursor..open].trim();
        let body = &input[open + 1..close];
        cursor = close + 1;
        if header.starts_with("@container") {
            if container_matches(header, canvas) { parse_css_block(body, canvas, rules, issues); }
        } else if header.starts_with('@') {
            issues.push(format!("未対応CSS規則 {header} を無視しました"));
        } else {
            let declarations = parse_declarations(body);
            for selector in split_top_level(header, ',') {
                let selector = selector.trim();
                if selector.is_empty() { continue; }
                rules.push(CssRule {
                    selector: selector.to_owned(),
                    declarations: declarations.clone(),
                    specificity: specificity(selector),
                    order: rules.len(),
                });
            }
        }
    }
}

fn find_top_level(input: &str, needle: char) -> Option<usize> {
    let mut quote = None;
    let mut paren = 0;
    let mut bracket = 0;
    for (i, ch) in input.char_indices() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(ch),
            (None, '(') => paren += 1,
            (None, ')') => paren = (paren - 1).max(0),
            (None, '[') => bracket += 1,
            (None, ']') => bracket = (bracket - 1).max(0),
            (None, c) if c == needle && paren == 0 && bracket == 0 => return Some(i),
            _ => {}
        }
    }
    None
}

fn matching_brace(input: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut quote = None;
    for (relative, ch) in input[open..].char_indices() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(ch),
            (None, '{') => depth += 1,
            (None, '}') => { depth -= 1; if depth == 0 { return Some(open + relative); } }
            _ => {}
        }
    }
    None
}

fn split_top_level(input: &str, delimiter: char) -> Vec<&str> {
    let mut result = vec![];
    let mut start = 0;
    let mut quote = None;
    let mut paren = 0;
    let mut bracket = 0;
    for (i, ch) in input.char_indices() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(ch),
            (None, '(') => paren += 1,
            (None, ')') => paren = (paren - 1).max(0),
            (None, '[') => bracket += 1,
            (None, ']') => bracket = (bracket - 1).max(0),
            (None, c) if c == delimiter && paren == 0 && bracket == 0 => { result.push(&input[start..i]); start = i + c.len_utf8(); }
            _ => {}
        }
    }
    result.push(&input[start..]);
    result
}

fn parse_declarations(input: &str) -> Vec<(String, String)> {
    split_top_level(input, ';').into_iter().filter_map(|raw| {
        let colon = find_top_level(raw, ':')?;
        let property = raw[..colon].trim().to_ascii_lowercase();
        let value = raw[colon + 1..].trim();
        (!property.is_empty() && !value.is_empty()).then(|| (property, value.to_owned()))
    }).collect()
}

fn container_matches(header: &str, canvas: &LayoutCanvas) -> bool {
    let Some(open) = header.find('(') else { return true };
    let Some(close) = header.rfind(')') else { return false };
    let condition = &header[open + 1..close];
    condition.split("and").all(|part| {
        let Some((name, value)) = part.split_once(':') else { return false };
        let axis = if name.contains("height") { canvas.height } else { canvas.width };
        let Some(bound) = eval_length(value.trim(), axis, canvas) else { return false };
        if name.trim().starts_with("max-") { axis <= bound + 0.01 }
        else if name.trim().starts_with("min-") { axis >= bound - 0.01 }
        else { (axis - bound).abs() <= 0.01 }
    })
}

fn specificity(selector: &str) -> (u16, u16, u16) {
    let ids = selector.matches('#').count() as u16;
    let classes = (selector.matches('.').count() + selector.matches('[').count() + selector.matches(':').count()) as u16;
    let mut tags = 0;
    for token in selector.split(|c: char| c.is_whitespace() || c == '>') {
        let head = token.trim().split(['.', '#', '[', ':']).next().unwrap_or("");
        if !head.is_empty() && head != "*" { tags += 1; }
    }
    (ids, classes, tags)
}

fn apply_cascade(nodes: &mut [Element], rules: &[CssRule], canvas: &LayoutCanvas) {
    for index in 0..nodes.len() {
        let mut chosen: HashMap<String, ((u16, u16, u16), usize, String)> = HashMap::new();
        for rule in rules {
            if selector_matches(nodes, index, &rule.selector) {
                for (property, value) in &rule.declarations {
                    let replace = chosen.get(property).is_none_or(|(spec, order, _)| rule.specificity > *spec || (rule.specificity == *spec && rule.order >= *order));
                    if replace { chosen.insert(property.clone(), (rule.specificity, rule.order, value.clone())); }
                }
            }
        }
        if let Some(inline) = nodes[index].attrs.get("style") {
            for (property, value) in parse_declarations(inline) {
                chosen.insert(property, ((u16::MAX, u16::MAX, u16::MAX), usize::MAX, value));
            }
        }
        let parent = nodes[index].parent;
        for property in ["color", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "white-space", "pointer-events"] {
            if !chosen.contains_key(property) {
                if let Some(value) = parent.and_then(|p| nodes[p].computed.get(property)).cloned() {
                    chosen.insert(property.into(), ((0, 0, 0), 0, value));
                }
            }
        }
        nodes[index].computed = chosen.into_iter().map(|(key, (_, _, value))| (key, substitute_variables(&value, canvas))).collect();
    }
}

fn selector_matches(nodes: &[Element], index: usize, selector: &str) -> bool {
    let parts = tokenize_selector(selector);
    if parts.is_empty() { return false; }
    match_selector_from(nodes, index, &parts, parts.len() - 1)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Combinator { Descendant, Child }

fn tokenize_selector(selector: &str) -> Vec<(String, Option<Combinator>)> {
    let mut parts = vec![];
    let mut current = String::new();
    let mut quote = None;
    let mut bracket = 0;
    let mut paren = 0;
    let mut pending = None;
    for ch in selector.trim().chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => { quote = None; current.push(ch); }
            (Some(_), _) => current.push(ch),
            (None, '\'' | '"') => { quote = Some(ch); current.push(ch); }
            (None, '[') => { bracket += 1; current.push(ch); }
            (None, ']') => { bracket -= 1; current.push(ch); }
            (None, '(') => { paren += 1; current.push(ch); }
            (None, ')') => { paren -= 1; current.push(ch); }
            (None, '>') if bracket == 0 && paren == 0 => {
                if !current.trim().is_empty() { parts.push((current.trim().to_owned(), pending)); current.clear(); }
                pending = Some(Combinator::Child);
            }
            (None, c) if c.is_whitespace() && bracket == 0 && paren == 0 => {
                if !current.trim().is_empty() { parts.push((current.trim().to_owned(), pending)); current.clear(); pending = Some(Combinator::Descendant); }
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() { parts.push((current.trim().to_owned(), pending)); }
    parts
}

fn match_selector_from(nodes: &[Element], node_index: usize, parts: &[(String, Option<Combinator>)], part: usize) -> bool {
    if !simple_selector_matches(&nodes[node_index], &parts[part].0) { return false; }
    if part == 0 { return true; }
    match parts[part].1.unwrap_or(Combinator::Descendant) {
        Combinator::Child => nodes[node_index].parent.is_some_and(|p| match_selector_from(nodes, p, parts, part - 1)),
        Combinator::Descendant => {
            let mut parent = nodes[node_index].parent;
            while let Some(p) = parent {
                if match_selector_from(nodes, p, parts, part - 1) { return true; }
                parent = nodes[p].parent;
            }
            false
        }
    }
}

fn simple_selector_matches(node: &Element, selector: &str) -> bool {
    let mut positive = selector.to_owned();
    loop {
        let Some(start) = positive.find(":not(") else { break };
        let Some(end_rel) = positive[start + 5..].find(')') else { return false };
        let end = start + 5 + end_rel;
        if simple_selector_matches(node, &positive[start + 5..end]) { return false; }
        positive.replace_range(start..=end, "");
    }
    let chars: Vec<char> = positive.chars().collect();
    let mut i = 0;
    let tag_start = i;
    while i < chars.len() && !matches!(chars[i], '.' | '#' | '[' | ':') { i += 1; }
    let tag: String = chars[tag_start..i].iter().collect();
    if !tag.is_empty() && tag != "*" && !tag.eq_ignore_ascii_case(node.tag()) { return false; }
    while i < chars.len() {
        match chars[i] {
            '.' => {
                i += 1; let start = i; while i < chars.len() && is_ident(chars[i]) { i += 1; }
                let class: String = chars[start..i].iter().collect();
                if !node.classes.iter().any(|c| c == &class) { return false; }
            }
            '#' => {
                i += 1; let start = i; while i < chars.len() && is_ident(chars[i]) { i += 1; }
                let id: String = chars[start..i].iter().collect();
                if node.attrs.get("id") != Some(&id) { return false; }
            }
            '[' => {
                let start = i + 1; let Some(rel) = chars[start..].iter().position(|&c| c == ']') else { return false }; let end = start + rel;
                let expression: String = chars[start..end].iter().collect();
                let (key, expected) = expression.split_once('=').map(|(k, v)| (k.trim(), Some(v.trim().trim_matches(['\'', '"'])))).unwrap_or((expression.trim(), None));
                let actual = node.attrs.get(&key.to_ascii_lowercase());
                if actual.is_none() || expected.is_some_and(|v| actual.map(String::as_str) != Some(v)) { return false; }
                i = end + 1;
            }
            ':' => return false,
            _ => i += 1,
        }
    }
    true
}

fn is_ident(ch: char) -> bool { ch.is_alphanumeric() || matches!(ch, '-' | '_') }

fn substitute_variables(value: &str, canvas: &LayoutCanvas) -> String {
    let variables = [
        ("--wmg-canvas-width", format!("{}px", canvas.width)),
        ("--wmg-canvas-height", format!("{}px", canvas.height)),
        ("--wmg-safe-top", format!("{}px", canvas.safe_top)),
        ("--wmg-safe-right", format!("{}px", canvas.safe_right)),
        ("--wmg-safe-bottom", format!("{}px", canvas.safe_bottom)),
        ("--wmg-safe-left", format!("{}px", canvas.safe_left)),
        ("--wmg-density", canvas.density.to_string()),
        ("--wmg-font-scale", canvas.font_scale.to_string()),
    ];
    let mut result = value.to_owned();
    for (name, replacement) in variables { result = result.replace(&format!("var({name})"), &replacement); }
    result
}

fn compute_native_model(
    elements: &[Element],
    request: &LayoutRequest,
    issues: &mut Vec<String>,
) -> Result<Vec<ResolvedButton>, taffy::TaffyError> {
    let canvas = &request.canvas;
    let mut taffy: TaffyTree<ButtonNodeContext> = TaffyTree::new();
    taffy.disable_rounding();
    let mut node_ids = vec![None; elements.len()];
    let root = build_taffy_node(0, elements, &request.buttons, canvas, &mut taffy, &mut node_ids, issues)?;
    taffy.compute_layout_with_measure(
        root,
        Size {
            width: AvailableSpace::Definite(canvas.width),
            height: AvailableSpace::Definite(canvas.height),
        },
        |known, available, _, context, _| {
            let Some(context) = context else { return Size::ZERO };
            measure_text(context, known, available)
        },
    )?;

    let mut origins = vec![(0.0f32, 0.0f32); elements.len()];
    accumulate_origins(0, elements, &node_ids, &taffy, 0.0, 0.0, &mut origins)?;
    let mut resolved = vec![];
    for (element_index, element) in elements.iter().enumerate() {
        let Some(button_index) = element.button else { continue };
        let Some(node_id) = node_ids[element_index] else { continue };
        let layout = taffy.layout(node_id)?;
        if layout.size.width <= 0.0 || layout.size.height <= 0.0 { continue; }
        let button = &request.buttons[button_index];
        let mut style = native_style(element, button, canvas);
        apply_button_override(&mut style, &button.style);
        let enabled = element.computed.get("pointer-events").is_none_or(|value| value.trim() != "none");
        resolved.push(ResolvedButton {
            id: button.id.clone(),
            text: button.text.clone(),
            x: clean(origins[element_index].0),
            y: clean(origins[element_index].1),
            width: clean(layout.size.width),
            height: clean(layout.size.height),
            z_index: integer(&element.computed, "z-index").unwrap_or(button.z_index),
            enabled,
            style,
        });
    }
    resolved.sort_by_key(|button| button.z_index);
    Ok(resolved)
}

fn build_taffy_node(
    index: usize,
    elements: &[Element],
    buttons: &[LayoutButton],
    canvas: &LayoutCanvas,
    taffy: &mut TaffyTree<ButtonNodeContext>,
    node_ids: &mut [Option<NodeId>],
    issues: &mut Vec<String>,
) -> Result<NodeId, taffy::TaffyError> {
    let element = &elements[index];
    let mut style = taffy_style(element, canvas, issues);
    if element.kind == ElementKind::Root {
        style.display = Display::Block;
        style.size = Size { width: Dimension::length(canvas.width), height: Dimension::length(canvas.height) };
        style.overflow = Point { x: Overflow::Hidden, y: Overflow::Hidden };
    }
    if element.kind == ElementKind::Button {
        // A browser button injected as a direct grid item stretches by default. A measured Taffy
        // leaf otherwise keeps its intrinsic text width, so make the CSS default explicit here.
        if style.justify_self.is_none() { style.justify_self = Some(AlignSelf::STRETCH); }
    }
    let id = if let Some(button_index) = element.button {
        let native = native_style(element, &buttons[button_index], canvas);
        let context = ButtonNodeContext {
            text: buttons[button_index].text.clone(),
            font_size: native.font_size,
            line_height: native.line_height,
            letter_spacing: native.letter_spacing,
            white_space: native.white_space != "nowrap",
            stretch_width: style.justify_self == Some(AlignSelf::STRETCH),
        };
        taffy.new_leaf_with_context(style, context)?
    } else {
        let mut ordered_children: Vec<(usize, usize)> = element.children.iter().copied().enumerate().collect();
        ordered_children.sort_by_key(|(source_order, child)| {
            let order = elements[*child].button.map(|button| buttons[button].order)
                .or_else(|| integer(&elements[*child].computed, "order")).unwrap_or(0);
            (order, *source_order)
        });
        let mut children = Vec::with_capacity(ordered_children.len());
        for (_, child) in ordered_children {
            children.push(build_taffy_node(child, elements, buttons, canvas, taffy, node_ids, issues)?);
        }
        taffy.new_with_children(style, &children)?
    };
    node_ids[index] = Some(id);
    Ok(id)
}

fn accumulate_origins(
    index: usize,
    elements: &[Element],
    node_ids: &[Option<NodeId>],
    taffy: &TaffyTree<ButtonNodeContext>,
    parent_x: f32,
    parent_y: f32,
    origins: &mut [(f32, f32)],
) -> Result<(), taffy::TaffyError> {
    let Some(id) = node_ids[index] else { return Ok(()) };
    let layout = taffy.layout(id)?;
    let x = parent_x + layout.location.x;
    let y = parent_y + layout.location.y;
    origins[index] = (x, y);
    for &child in &elements[index].children {
        accumulate_origins(child, elements, node_ids, taffy, x, y, origins)?;
    }
    Ok(())
}

fn measure_text(
    context: &ButtonNodeContext,
    known: Size<Option<f32>>,
    available: Size<AvailableSpace>,
) -> Size<f32> {
    let glyphs = UnicodeWidthStr::width(context.text.as_str()).max(1) as f32;
    let natural_width = glyphs * context.font_size * 0.56 + (glyphs - 1.0).max(0.0) * context.letter_spacing;
    let available_width = match available.width {
        AvailableSpace::Definite(value) => value,
        _ => natural_width,
    };
    let width = known.width.unwrap_or_else(|| {
        if context.stretch_width && matches!(available.width, AvailableSpace::Definite(_)) {
            available_width.max(1.0)
        } else {
            natural_width.min(available_width.max(1.0))
        }
    });
    let lines = if context.white_space { (natural_width / width.max(1.0)).ceil().max(1.0) } else { 1.0 };
    Size { width, height: known.height.unwrap_or(context.line_height * lines) }
}

fn taffy_style(element: &Element, canvas: &LayoutCanvas, issues: &mut Vec<String>) -> Style {
    let css = &element.computed;
    let mut style = Style::default();
    style.box_sizing = BoxSizing::BorderBox;
    if let Some(value) = css.get("display") {
        style.display = match value.trim() {
            "none" => Display::None,
            "grid" => Display::Grid,
            "flex" | "inline-flex" => Display::Flex,
            _ => Display::Block,
        };
    }
    if let Some(value) = css.get("box-sizing") {
        style.box_sizing = if value.trim() == "content-box" { BoxSizing::ContentBox } else { BoxSizing::BorderBox };
    }
    if let Some(value) = css.get("position") {
        style.position = if value.trim() == "absolute" { Position::Absolute } else { Position::Relative };
    }
    style.size = Size {
        width: dimension(css.get("width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("height"), canvas.height, canvas).unwrap_or(Dimension::auto()),
    };
    style.min_size = Size {
        width: dimension(css.get("min-width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("min-height"), canvas.height, canvas).unwrap_or(Dimension::auto()),
    };
    style.max_size = Size {
        width: dimension(css.get("max-width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("max-height"), canvas.height, canvas).unwrap_or(Dimension::auto()),
    };
    if let Some(value) = css.get("aspect-ratio") { style.aspect_ratio = parse_ratio(value); }

    style.inset = rect_auto(css, "inset", ["left", "top", "right", "bottom"], canvas);
    style.margin = margin_rect(css, canvas);
    style.padding = rect_length(css, "padding", ["padding-left", "padding-top", "padding-right", "padding-bottom"], canvas);
    style.border = border_rect(css, canvas);
    style.gap = Size {
        width: length_percentage(css.get("column-gap").or_else(|| css.get("gap")), canvas.width, canvas).unwrap_or(LengthPercentage::ZERO),
        height: length_percentage(css.get("row-gap").or_else(|| css.get("gap")), canvas.height, canvas).unwrap_or(LengthPercentage::ZERO),
    };
    style.overflow = overflow(css);

    style.align_items = css.get("align-items").and_then(|v| v.parse().ok());
    style.justify_items = css.get("justify-items").and_then(|v| v.parse().ok());
    style.align_self = css.get("align-self").and_then(|v| v.parse().ok());
    style.justify_self = css.get("justify-self").and_then(|v| v.parse().ok());
    style.align_content = css.get("align-content").and_then(|v| v.parse().ok());
    style.justify_content = css.get("justify-content").and_then(|v| v.parse().ok());
    if let Some(value) = css.get("place-items") {
        let parts: Vec<&str> = value.split_ascii_whitespace().collect();
        style.align_items = parts.first().and_then(|v| v.parse().ok());
        style.justify_items = parts.get(1).or(parts.first()).and_then(|v| v.parse().ok());
    }
    if let Some(value) = css.get("place-content") {
        let parts: Vec<&str> = value.split_ascii_whitespace().collect();
        style.align_content = parts.first().and_then(|v| v.parse().ok());
        style.justify_content = parts.get(1).or(parts.first()).and_then(|v| v.parse().ok());
    }

    if let Some(value) = css.get("flex-direction") { if let Ok(parsed) = value.parse() { style.flex_direction = parsed; } }
    if let Some(value) = css.get("flex-wrap") { if let Ok(parsed) = value.parse() { style.flex_wrap = parsed; } }
    style.flex_grow = number(css, "flex-grow").unwrap_or(style.flex_grow);
    style.flex_shrink = number(css, "flex-shrink").unwrap_or(style.flex_shrink);
    if let Some(value) = css.get("flex-basis") { if let Some(parsed) = dimension(Some(value), canvas.width, canvas) { style.flex_basis = parsed; } }
    if let Some(value) = css.get("flex") { apply_flex_shorthand(&mut style, value, canvas); }

    apply_grid(&mut style, css, canvas, issues);
    style
}

fn apply_grid(style: &mut Style, css: &BTreeMap<String, String>, canvas: &LayoutCanvas, issues: &mut Vec<String>) {
    if let Some(value) = css.get("grid-template") {
        let values = split_top_level(value, '/');
        if !css.contains_key("grid-template-rows") {
            if let Some(rows) = values.first().map(|v| normalize_track_value(v, canvas.height, canvas)) {
                if let Ok(parsed) = rows.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
                    style.grid_template_rows = parsed.tracks; style.grid_template_row_names = parsed.line_names;
                }
            }
        }
        if !css.contains_key("grid-template-columns") {
            if let Some(columns) = values.get(1).map(|v| normalize_track_value(v, canvas.width, canvas)) {
                if let Ok(parsed) = columns.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
                    style.grid_template_columns = parsed.tracks; style.grid_template_column_names = parsed.line_names;
                }
            }
        }
    }
    if let Some(value) = css.get("grid-template-columns") {
        let normalized = normalize_track_value(value, canvas.width, canvas);
        match normalized.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
            Ok(parsed) => { style.grid_template_columns = parsed.tracks; style.grid_template_column_names = parsed.line_names; }
            Err(error) => issues.push(format!("grid-template-columnsを解釈できません: {normalized} ({error:?})")),
        }
    }
    if let Some(value) = css.get("grid-template-rows") {
        let normalized = normalize_track_value(value, canvas.height, canvas);
        match normalized.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
            Ok(parsed) => { style.grid_template_rows = parsed.tracks; style.grid_template_row_names = parsed.line_names; }
            Err(error) => issues.push(format!("grid-template-rowsを解釈できません: {normalized} ({error:?})")),
        }
    }
    if let Some(value) = css.get("grid-auto-columns") {
        if let Ok(parsed) = normalize_track_value(value, canvas.width, canvas).parse::<GridAutoTracks>() { style.grid_auto_columns = parsed.0; }
    }
    if let Some(value) = css.get("grid-auto-rows") {
        if let Ok(parsed) = normalize_track_value(value, canvas.height, canvas).parse::<GridAutoTracks>() { style.grid_auto_rows = parsed.0; }
    }
    if let Some(value) = css.get("grid-auto-flow") { if let Ok(parsed) = value.parse() { style.grid_auto_flow = parsed; } }
    if let Some(value) = css.get("grid-template-areas") {
        match parse_grid_template_areas(value) {
            Some(areas) => style.grid_template_areas = areas,
            None => issues.push(format!("grid-template-areasを解釈できません: {value}")),
        }
    }
    if let Some(value) = css.get("grid-column") { style.grid_column = parse_grid_line(value); }
    if let Some(value) = css.get("grid-row") { style.grid_row = parse_grid_line(value); }
    if let Some(value) = css.get("grid-area") {
        let values = split_top_level(value, '/');
        if values.len() == 1 {
            let name = values[0].trim();
            if !name.is_empty() {
                style.grid_row.start = GridPlacement::NamedLine(name.into(), 1);
                style.grid_column.start = GridPlacement::NamedLine(name.into(), 1);
            }
        } else {
            if let Some(v) = values.first() { style.grid_row.start = parse_grid_placement(v); }
            if let Some(v) = values.get(1) { style.grid_column.start = parse_grid_placement(v); }
            if let Some(v) = values.get(2) { style.grid_row.end = parse_grid_placement(v); }
            if let Some(v) = values.get(3) { style.grid_column.end = parse_grid_placement(v); }
        }
    }
}

fn parse_grid_line(value: &str) -> Line<GridPlacement<String>> {
    let values = split_top_level(value, '/');
    Line { start: parse_grid_placement(values.first().copied().unwrap_or("auto")), end: parse_grid_placement(values.get(1).copied().unwrap_or("auto")) }
}

fn parse_grid_template_areas(value: &str) -> Option<Vec<GridTemplateArea<String>>> {
    let mut rows: Vec<Vec<String>> = vec![];
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !matches!(chars[i], '\'' | '"') { i += 1; continue; }
        let quote = chars[i]; i += 1; let start = i;
        while i < chars.len() && chars[i] != quote { i += 1; }
        if i >= chars.len() { return None; }
        rows.push(chars[start..i].iter().collect::<String>().split_ascii_whitespace().map(str::to_owned).collect());
        i += 1;
    }
    let columns = rows.first()?.len();
    if columns == 0 || rows.iter().any(|row| row.len() != columns) { return None; }
    let mut bounds: BTreeMap<String, (usize, usize, usize, usize)> = BTreeMap::new();
    for (row, cells) in rows.iter().enumerate() {
        for (column, name) in cells.iter().enumerate() {
            if name == "." || name.chars().all(|ch| ch == '.') { continue; }
            bounds.entry(name.clone()).and_modify(|value| {
                value.0 = value.0.min(row); value.1 = value.1.max(row);
                value.2 = value.2.min(column); value.3 = value.3.max(column);
            }).or_insert((row, row, column, column));
        }
    }
    let mut areas = vec![];
    for (name, (top, bottom, left, right)) in bounds {
        for row in top..=bottom { for column in left..=right { if rows[row][column] != name { return None; } } }
        areas.push(GridTemplateArea { name, row_start: top as u16, row_end: (bottom + 1) as u16, column_start: left as u16, column_end: (right + 1) as u16 });
    }
    Some(areas)
}

fn parse_grid_placement(value: &str) -> GridPlacement<String> {
    value.trim().parse().unwrap_or(GridPlacement::Auto)
}

fn overflow(css: &BTreeMap<String, String>) -> Point<Overflow> {
    fn parse(value: Option<&String>) -> Overflow {
        match value.map(|v| v.trim()) {
            Some("hidden" | "clip") => Overflow::Hidden,
            Some("scroll") => Overflow::Scroll,
            Some("auto") => Overflow::Hidden,
            _ => Overflow::Visible,
        }
    }
    let both = css.get("overflow");
    Point { x: parse(css.get("overflow-x").or(both)), y: parse(css.get("overflow-y").or(both)) }
}

fn native_style(element: &Element, _button: &LayoutButton, canvas: &LayoutCanvas) -> NativeButtonStyle {
    let css = &element.computed;
    let font_size = font_size(css, canvas);
    let shorthand_line_height = css.get("font").and_then(|font| {
        font.split_ascii_whitespace().find_map(|part| part.split_once('/').map(|(_, height)| height.to_owned()))
    });
    let line_height = css.get("line-height").or(shorthand_line_height.as_ref()).and_then(|value| {
        let trimmed = value.trim();
        if trimmed == "normal" { None }
        else if let Ok(multiplier) = trimmed.parse::<f32>() { Some(font_size * multiplier) }
        else { eval_length(trimmed, font_size, canvas) }
    }).unwrap_or(font_size * 1.2);
    let padding = resolved_box(css, "padding", ["padding-left", "padding-top", "padding-right", "padding-bottom"], canvas);
    let border = resolved_border(css, canvas);
    NativeButtonStyle {
        background_color: background_color(css).unwrap_or_else(|| "#00000000".into()),
        background_image: css.get("background-image").or_else(|| css.get("background")).and_then(|value| extract_url(value)),
        background_size: css.get("background-size").cloned().unwrap_or_else(|| "cover".into()),
        background_position: css.get("background-position").cloned().unwrap_or_else(|| "center".into()),
        background_repeat: css.get("background-repeat").cloned().unwrap_or_else(|| "no-repeat".into()),
        text_color: css.get("color").cloned().unwrap_or_else(|| "#ff000000".into()),
        opacity: number(css, "opacity").unwrap_or(1.0).clamp(0.0, 1.0),
        border_color: border_color(css).unwrap_or_else(|| "#00000000".into()),
        border_width: border[0].max(border[1]).max(border[2]).max(border[3]),
        border_radius: css.get("border-radius").and_then(|v| eval_length(v, canvas.width.min(canvas.height), canvas)).unwrap_or(0.0).max(0.0),
        font_size,
        font_weight: font_weight(css),
        padding_left: padding[0], padding_top: padding[1], padding_right: padding[2], padding_bottom: padding[3],
        text_align: css.get("text-align").cloned().unwrap_or_else(|| "center".into()),
        vertical_align: css.get("align-items").or_else(|| css.get("place-items")).map(|v| v.split_ascii_whitespace().next().unwrap_or("center").to_owned()).unwrap_or_else(|| "center".into()),
        line_height,
        letter_spacing: css.get("letter-spacing").and_then(|v| eval_length(v, font_size, canvas)).unwrap_or(0.0),
        white_space: css.get("white-space").cloned().unwrap_or_else(|| "normal".into()),
        text_overflow: css.get("text-overflow").cloned().unwrap_or_else(|| "clip".into()),
        overflow: css.get("overflow").cloned().unwrap_or_else(|| "visible".into()),
        box_shadow: css.get("box-shadow").cloned(),
        filter: css.get("filter").cloned(),
        transform: css.get("transform").cloned(),
    }
}

fn apply_button_override(style: &mut NativeButtonStyle, input: &ButtonInputStyle) {
    if let Some(value) = &input.background_color { style.background_color = value.clone(); }
    if let Some(value) = &input.background_image { style.background_image = Some(value.clone()); }
    if let Some(value) = &input.text_color { style.text_color = value.clone(); }
    if let Some(value) = input.opacity { style.opacity = value.clamp(0.0, 1.0); }
    if let Some(value) = &input.border_color { style.border_color = value.clone(); }
    if let Some(value) = input.border_width { style.border_width = value.max(0.0); }
    if let Some(value) = input.border_radius { style.border_radius = value.max(0.0); }
    if let Some(value) = input.font_size { style.font_size = value.max(1.0); }
    if let Some(value) = input.font_weight { style.font_weight = value; }
    if let Some(value) = input.padding_horizontal { style.padding_left = value.max(0.0); style.padding_right = value.max(0.0); }
    if let Some(value) = input.padding_vertical { style.padding_top = value.max(0.0); style.padding_bottom = value.max(0.0); }
}

fn background_color(css: &BTreeMap<String, String>) -> Option<String> {
    css.get("background-color").cloned().or_else(|| css.get("background").and_then(|value| {
        value.split_ascii_whitespace().find(|part| is_color(part)).map(str::to_owned)
    }))
}

fn border_color(css: &BTreeMap<String, String>) -> Option<String> {
    css.get("border-color").or_else(|| css.get("border-left-color")).cloned().or_else(|| {
        css.get("border").and_then(|value| value.split_ascii_whitespace().find(|part| is_color(part)).map(str::to_owned))
    })
}

fn extract_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let inside = trimmed.strip_prefix("url(")?.strip_suffix(')')?.trim();
    let path = inside.trim_matches(['\'', '"']);
    if path.starts_with("http:") || path.starts_with("https:") || path.starts_with("data:") { None } else { Some(path.to_owned()) }
}

fn is_color(value: &str) -> bool {
    value.starts_with('#') || value.starts_with("rgb(") || value.starts_with("rgba(") || matches!(value.to_ascii_lowercase().as_str(), "transparent" | "white" | "black" | "red" | "green" | "blue" | "currentcolor")
}

fn font_size(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> f32 {
    if let Some(value) = css.get("font-size").and_then(|v| eval_length(v, 16.0, canvas)) { return value.max(1.0) }
    if let Some(font) = css.get("font") {
        for part in font.split_ascii_whitespace() {
            let size = part.split('/').next().unwrap_or(part);
            if let Some(value) = eval_length(size, 16.0, canvas) { if size.ends_with("px") { return value.max(1.0); } }
        }
    }
    16.0
}

fn font_weight(css: &BTreeMap<String, String>) -> i32 {
    if let Some(value) = css.get("font-weight") {
        return match value.trim() { "normal" => 400, "bold" => 700, other => other.parse().unwrap_or(400) };
    }
    if let Some(font) = css.get("font") {
        for part in font.split_ascii_whitespace() {
            if let Ok(weight) = part.parse::<i32>() { if (1..=1000).contains(&weight) { return weight; } }
            if part == "bold" { return 700; }
        }
    }
    400
}

fn clean(value: f32) -> f32 { if value.is_finite() { (value * 1000.0).round() / 1000.0 } else { 0.0 } }

fn number(css: &BTreeMap<String, String>, property: &str) -> Option<f32> { css.get(property)?.trim().parse().ok() }
fn integer(css: &BTreeMap<String, String>, property: &str) -> Option<i32> { css.get(property)?.trim().parse().ok() }

fn parse_ratio(value: &str) -> Option<f32> {
    if let Some((left, right)) = value.split_once('/') { Some(left.trim().parse::<f32>().ok()? / right.trim().parse::<f32>().ok()?.max(f32::EPSILON)) }
    else { value.trim().parse().ok() }
}

fn apply_flex_shorthand(style: &mut Style, value: &str, canvas: &LayoutCanvas) {
    let parts: Vec<&str> = value.split_ascii_whitespace().collect();
    if let Some(v) = parts.first().and_then(|v| v.parse().ok()) { style.flex_grow = v; }
    if let Some(v) = parts.get(1).and_then(|v| v.parse().ok()) { style.flex_shrink = v; }
    if let Some(v) = parts.get(2).and_then(|v| dimension(Some(&v.to_string()), canvas.width, canvas)) { style.flex_basis = v; }
}

fn dimension(value: Option<&String>, percent_base: f32, canvas: &LayoutCanvas) -> Option<Dimension> {
    let value = value?.trim();
    if value == "auto" { return Some(Dimension::auto()) }
    if is_simple_percent(value) { return value.trim_end_matches('%').parse::<f32>().ok().map(|v| Dimension::percent(v / 100.0)); }
    eval_length(value, percent_base, canvas).map(Dimension::length)
}

fn length_percentage(value: Option<&String>, percent_base: f32, canvas: &LayoutCanvas) -> Option<LengthPercentage> {
    let value = value?.trim();
    if is_simple_percent(value) { return value.trim_end_matches('%').parse::<f32>().ok().map(|v| LengthPercentage::percent(v / 100.0)); }
    eval_length(value, percent_base, canvas).map(LengthPercentage::length)
}

fn length_percentage_auto(value: Option<&String>, percent_base: f32, canvas: &LayoutCanvas) -> Option<LengthPercentageAuto> {
    let value = value?.trim();
    if value == "auto" { return Some(LengthPercentageAuto::auto()) }
    if is_simple_percent(value) { return value.trim_end_matches('%').parse::<f32>().ok().map(|v| LengthPercentageAuto::percent(v / 100.0)); }
    eval_length(value, percent_base, canvas).map(LengthPercentageAuto::length)
}

fn is_simple_percent(value: &str) -> bool { value.strip_suffix('%').is_some_and(|v| v.trim().parse::<f32>().is_ok()) }

fn rect_auto(css: &BTreeMap<String, String>, shorthand: &str, sides: [&str; 4], canvas: &LayoutCanvas) -> Rect<LengthPercentageAuto> {
    let values = box_values(css.get(shorthand).map(String::as_str));
    Rect {
        left: length_percentage_auto(css.get(sides[0]).or_else(|| values[0].as_ref()), canvas.width, canvas).unwrap_or(LengthPercentageAuto::auto()),
        top: length_percentage_auto(css.get(sides[1]).or_else(|| values[1].as_ref()), canvas.height, canvas).unwrap_or(LengthPercentageAuto::auto()),
        right: length_percentage_auto(css.get(sides[2]).or_else(|| values[2].as_ref()), canvas.width, canvas).unwrap_or(LengthPercentageAuto::auto()),
        bottom: length_percentage_auto(css.get(sides[3]).or_else(|| values[3].as_ref()), canvas.height, canvas).unwrap_or(LengthPercentageAuto::auto()),
    }
}

fn margin_rect(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> Rect<LengthPercentageAuto> {
    let values = box_values(css.get("margin").map(String::as_str));
    let side = |property: &str, shorthand: &Option<String>, base: f32| {
        length_percentage_auto(css.get(property).or(shorthand.as_ref()), base, canvas).unwrap_or(LengthPercentageAuto::length(0.0))
    };
    Rect {
        left: side("margin-left", &values[0], canvas.width),
        top: side("margin-top", &values[1], canvas.height),
        right: side("margin-right", &values[2], canvas.width),
        bottom: side("margin-bottom", &values[3], canvas.height),
    }
}

fn rect_length(css: &BTreeMap<String, String>, shorthand: &str, sides: [&str; 4], canvas: &LayoutCanvas) -> Rect<LengthPercentage> {
    let values = box_values(css.get(shorthand).map(String::as_str));
    Rect {
        left: length_percentage(css.get(sides[0]).or_else(|| values[0].as_ref()), canvas.width, canvas).unwrap_or(LengthPercentage::ZERO),
        top: length_percentage(css.get(sides[1]).or_else(|| values[1].as_ref()), canvas.height, canvas).unwrap_or(LengthPercentage::ZERO),
        right: length_percentage(css.get(sides[2]).or_else(|| values[2].as_ref()), canvas.width, canvas).unwrap_or(LengthPercentage::ZERO),
        bottom: length_percentage(css.get(sides[3]).or_else(|| values[3].as_ref()), canvas.height, canvas).unwrap_or(LengthPercentage::ZERO),
    }
}

fn border_rect(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> Rect<LengthPercentage> {
    let resolved = resolved_border(css, canvas);
    Rect { left: LengthPercentage::length(resolved[0]), top: LengthPercentage::length(resolved[1]), right: LengthPercentage::length(resolved[2]), bottom: LengthPercentage::length(resolved[3]) }
}

fn resolved_border(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> [f32; 4] {
    let mut width = css.get("border-width").and_then(|v| eval_length(v, canvas.width, canvas)).unwrap_or(0.0);
    if let Some(border) = css.get("border") {
        if let Some(part) = border.split_ascii_whitespace().find(|part| eval_length(part, canvas.width, canvas).is_some()) { width = eval_length(part, canvas.width, canvas).unwrap_or(width); }
    }
    [
        css.get("border-left-width").and_then(|v| eval_length(v, canvas.width, canvas)).unwrap_or(width),
        css.get("border-top-width").and_then(|v| eval_length(v, canvas.height, canvas)).unwrap_or(width),
        css.get("border-right-width").and_then(|v| eval_length(v, canvas.width, canvas)).unwrap_or(width),
        css.get("border-bottom-width").and_then(|v| eval_length(v, canvas.height, canvas)).unwrap_or(width),
    ]
}

fn resolved_box(css: &BTreeMap<String, String>, shorthand: &str, sides: [&str; 4], canvas: &LayoutCanvas) -> [f32; 4] {
    let values = box_values(css.get(shorthand).map(String::as_str));
    [
        css.get(sides[0]).and_then(|v| eval_length(v, canvas.width, canvas)).or_else(|| values[0].as_ref().and_then(|v| eval_length(v, canvas.width, canvas))).unwrap_or(0.0),
        css.get(sides[1]).and_then(|v| eval_length(v, canvas.height, canvas)).or_else(|| values[1].as_ref().and_then(|v| eval_length(v, canvas.height, canvas))).unwrap_or(0.0),
        css.get(sides[2]).and_then(|v| eval_length(v, canvas.width, canvas)).or_else(|| values[2].as_ref().and_then(|v| eval_length(v, canvas.width, canvas))).unwrap_or(0.0),
        css.get(sides[3]).and_then(|v| eval_length(v, canvas.height, canvas)).or_else(|| values[3].as_ref().and_then(|v| eval_length(v, canvas.height, canvas))).unwrap_or(0.0),
    ]
}

fn box_values(value: Option<&str>) -> [Option<String>; 4] {
    let Some(value) = value else { return [None, None, None, None] };
    let parts = split_whitespace_top_level(value);
    match parts.as_slice() {
        [a] => [Some(a.clone()), Some(a.clone()), Some(a.clone()), Some(a.clone())],
        [vertical, horizontal] => [Some(horizontal.clone()), Some(vertical.clone()), Some(horizontal.clone()), Some(vertical.clone())],
        [top, horizontal, bottom] => [Some(horizontal.clone()), Some(top.clone()), Some(horizontal.clone()), Some(bottom.clone())],
        [top, right, bottom, left, ..] => [Some(left.clone()), Some(top.clone()), Some(right.clone()), Some(bottom.clone())],
        _ => [None, None, None, None],
    }
}

fn split_whitespace_top_level(value: &str) -> Vec<String> {
    let mut result = vec![];
    let mut current = String::new();
    let mut depth = 0;
    for ch in value.chars() {
        if ch == '(' { depth += 1; }
        if ch == ')' { depth -= 1; }
        if ch.is_whitespace() && depth == 0 {
            if !current.is_empty() { result.push(std::mem::take(&mut current)); }
        } else { current.push(ch); }
    }
    if !current.is_empty() { result.push(current); }
    result
}

fn normalize_track_value(value: &str, percent_base: f32, canvas: &LayoutCanvas) -> String {
    let mut result = String::new();
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() || chars[i] == '.' || (chars[i] == '-' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) {
            let start = i; i += 1;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') { i += 1; }
            let unit_start = i;
            while i < chars.len() && (chars[i].is_ascii_alphabetic() || chars[i] == '%') { i += 1; }
            let token: String = chars[start..i].iter().collect();
            let unit: String = chars[unit_start..i].iter().collect();
            if matches!(unit.as_str(), "cqw" | "cqh") {
                result.push_str(&format!("{}px", eval_length(&token, percent_base, canvas).unwrap_or(0.0)));
            } else { result.push_str(&token); }
        } else { result.push(chars[i]); i += 1; }
    }
    // Taffy does not resolve calc() pointers. Resolve whole clamp/min/max functions used as tracks.
    for name in ["clamp", "calc"] {
        loop {
            let Some(start) = result.find(&format!("{name}(")) else { break };
            let Some(end) = matching_paren(&result, start + name.len()) else { break };
            let expression = result[start..=end].to_owned();
            let replacement = format!("{}px", eval_length(&expression, percent_base, canvas).unwrap_or(0.0));
            result.replace_range(start..=end, &replacement);
        }
    }
    result.replace("minmax(0,", "minmax(0px,").replace("minmax(0 ,", "minmax(0px,")
}

fn matching_paren(value: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    for (offset, ch) in value[open..].char_indices() {
        if ch == '(' { depth += 1; }
        if ch == ')' { depth -= 1; if depth == 0 { return Some(open + offset); } }
    }
    None
}

fn eval_length(value: &str, percent_base: f32, canvas: &LayoutCanvas) -> Option<f32> {
    let mut parser = LengthParser { input: value.trim().as_bytes(), position: 0, percent_base, canvas };
    let result = parser.expression()?;
    parser.skip_ws();
    (parser.position == parser.input.len() && result.is_finite()).then_some(result)
}

struct LengthParser<'a> {
    input: &'a [u8],
    position: usize,
    percent_base: f32,
    canvas: &'a LayoutCanvas,
}

impl LengthParser<'_> {
    fn expression(&mut self) -> Option<f32> {
        let mut value = self.term()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'+') => { self.position += 1; value += self.term()?; }
                Some(b'-') => { self.position += 1; value -= self.term()?; }
                _ => return Some(value),
            }
        }
    }

    fn term(&mut self) -> Option<f32> {
        let mut value = self.factor()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'*') => { self.position += 1; value *= self.factor()?; }
                Some(b'/') => { self.position += 1; value /= self.factor()?.max(f32::EPSILON); }
                _ => return Some(value),
            }
        }
    }

    fn factor(&mut self) -> Option<f32> {
        self.skip_ws();
        if self.peek() == Some(b'-') { self.position += 1; return Some(-self.factor()?); }
        if self.peek() == Some(b'(') {
            self.position += 1; let value = self.expression()?; self.skip_ws(); self.expect(b')')?; return Some(value);
        }
        if self.peek()?.is_ascii_alphabetic() {
            let name = self.ident(); self.skip_ws(); self.expect(b'(')?;
            return match name.as_str() {
                "calc" => { let v = self.expression()?; self.skip_ws(); self.expect(b')')?; Some(v) }
                "min" | "max" => {
                    let mut values = vec![self.expression()?];
                    while { self.skip_ws(); self.peek() == Some(b',') } { self.position += 1; values.push(self.expression()?); }
                    self.skip_ws(); self.expect(b')')?;
                    if name == "min" { values.into_iter().reduce(f32::min) } else { values.into_iter().reduce(f32::max) }
                }
                "clamp" => {
                    let low = self.expression()?; self.skip_ws(); self.expect(b',')?;
                    let preferred = self.expression()?; self.skip_ws(); self.expect(b',')?;
                    let high = self.expression()?; self.skip_ws(); self.expect(b')')?;
                    Some(preferred.clamp(low.min(high), low.max(high)))
                }
                _ => None,
            };
        }
        let start = self.position;
        while self.peek().is_some_and(|c| c.is_ascii_digit() || c == b'.') { self.position += 1; }
        if start == self.position { return None; }
        let number = std::str::from_utf8(&self.input[start..self.position]).ok()?.parse::<f32>().ok()?;
        let unit = self.ident();
        match unit.as_str() {
            "" | "px" => Some(number),
            "%" => Some(number * self.percent_base / 100.0),
            "cqw" => Some(number * self.canvas.width / 100.0),
            "cqh" => Some(number * self.canvas.height / 100.0),
            _ => None,
        }
    }

    fn ident(&mut self) -> String {
        let start = self.position;
        while self.peek().is_some_and(|c| c.is_ascii_alphabetic() || c == b'%' || c == b'-') { self.position += 1; }
        String::from_utf8_lossy(&self.input[start..self.position]).to_ascii_lowercase()
    }
    fn peek(&self) -> Option<u8> { self.input.get(self.position).copied() }
    fn skip_ws(&mut self) { while self.peek().is_some_and(|c| c.is_ascii_whitespace()) { self.position += 1; } }
    fn expect(&mut self, expected: u8) -> Option<()> { (self.peek()? == expected).then(|| self.position += 1) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = r#"
        <style>
        .stage { position:absolute; inset:0; display:grid; grid-template-rows:1fr auto; padding:clamp(14px,4cqw,28px); }
        slot[name="actions"] { display:grid; grid-row:2; grid-template-columns:repeat(2,minmax(0,1fr)); gap:clamp(8px,2cqw,14px); }
        .wmg-button { display:grid; place-items:center; min-height:52px; padding:12px 18px; border:0; border-radius:18px; background:#702bc4; color:white; font:600 16px/1.3 system-ui; }
        @container wmg-canvas (max-width:360px) { slot[name="actions"] { grid-template-columns:1fr; } }
        </style><div class="stage"><slot name="actions"></slot><slot></slot></div>
    "#;

    fn request(width: f32) -> LayoutRequest {
        LayoutRequest {
            source: SOURCE.into(),
            canvas: LayoutCanvas { width, height: 400.0, density: 2.0, font_scale: 1.0, safe_top: 0.0, safe_right: 0.0, safe_bottom: 0.0, safe_left: 0.0 },
            buttons: vec![
                LayoutButton { id: "a".into(), visible: true, target_slot: Some("actions".into()), order: 2, z_index: 0, text: "Alpha".into(), style: ButtonInputStyle::default() },
                LayoutButton { id: "b".into(), visible: true, target_slot: Some("actions".into()), order: 1, z_index: 1, text: "Beta".into(), style: ButtonInputStyle::default() },
            ],
        }
    }

    #[test]
    fn computes_grid_and_stable_order() {
        let output = resolve_button_layout(&request(400.0));
        assert!(output.issues.is_empty(), "{:?}", output.issues);
        assert_eq!(output.buttons.len(), 2);
        let a = output.buttons.iter().find(|b| b.id == "a").unwrap();
        let b = output.buttons.iter().find(|b| b.id == "b").unwrap();
        assert!(b.x < a.x);
        assert!((a.height - 52.0).abs() < 0.1);
        assert_eq!(a.style.background_color, "#702bc4");
    }

    #[test]
    fn container_query_stacks_buttons() {
        let output = resolve_button_layout(&request(340.0));
        let a = output.buttons.iter().find(|b| b.id == "a").unwrap();
        let b = output.buttons.iter().find(|b| b.id == "b").unwrap();
        assert!((a.x - b.x).abs() < 0.1);
        assert!(a.y > b.y);
    }

    #[test]
    fn button_style_overrides_css() {
        let mut input = request(400.0);
        input.buttons[0].style.background_color = Some("#123456".into());
        input.buttons[0].style.border_radius = Some(7.0);
        let output = resolve_button_layout(&input);
        let a = output.buttons.iter().find(|b| b.id == "a").unwrap();
        assert_eq!(a.style.background_color, "#123456");
        assert_eq!(a.style.border_radius, 7.0);
    }

    #[test]
    fn strips_unsafe_markup() {
        let mut input = request(400.0);
        input.source = input.source.replace("<div class=\"stage\">", "<script>alert(1)</script><div onclick=\"bad()\" class=\"stage\">");
        let output = resolve_button_layout(&input);
        assert_eq!(output.buttons.len(), 2);
        assert!(output.issues.iter().any(|issue| issue.contains("禁止要素") || issue.contains("イベント属性")));
    }

    #[test]
    fn json_result_is_deterministic() {
        let json = serde_json::to_string(&request(400.0)).unwrap();
        assert_eq!(resolve_button_layout_json(&json), resolve_button_layout_json(&json));
    }

    #[test]
    fn parses_rectangular_named_grid_areas() {
        let areas = parse_grid_template_areas(r#""hero hero" "actions side""#).unwrap();
        let hero = areas.iter().find(|area| area.name == "hero").unwrap();
        assert_eq!((hero.row_start, hero.row_end, hero.column_start, hero.column_end), (0, 1, 0, 2));
        assert!(parse_grid_template_areas(r#""broken broken" "broken other""#).is_none());
    }
}
