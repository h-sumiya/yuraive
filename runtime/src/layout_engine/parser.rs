/// Resolve a request and always return JSON. Invalid input becomes an empty model with an issue.
pub fn resolve_button_layout_json(request_json: &str) -> String {
    let response = match serde_json::from_str::<LayoutRequest>(request_json) {
        Ok(request) => resolve_button_layout(&request),
        Err(error) => LayoutResponse {
            buttons: vec![],
            issues: vec![format!("レイアウト要求が不正です: {error}")],
        },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"buttons\":[],\"issues\":[\"レイアウト結果を生成できません\"]}".into()
    })
}

pub fn resolve_button_layout(request: &LayoutRequest) -> LayoutResponse {
    let mut issues = vec![];
    if !request.canvas.width.is_finite()
        || !request.canvas.height.is_finite()
        || request.canvas.width <= 0.0
        || request.canvas.height <= 0.0
    {
        return LayoutResponse {
            buttons: vec![],
            issues: vec!["キャンバス寸法が不正です".into()],
        };
    }

    let (style_source, markup) = extract_styles(&request.source);
    let mut elements = parse_markup(&markup, &mut issues);
    inject_buttons(&mut elements, &request.buttons, &mut issues);
    let rules = parse_css(&style_source, &request.canvas, &mut issues);
    apply_cascade(&mut elements, &rules, &request.canvas);

    match compute_native_model(&elements, request, &mut issues) {
        Ok(buttons) => LayoutResponse { buttons, issues },
        Err(error) => LayoutResponse {
            buttons: vec![],
            issues: vec![format!("レイアウト計算に失敗しました: {error}")],
        },
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
        let Some(open_rel) = lower[start..].find('>') else {
            break;
        };
        let open_end = start + open_rel + 1;
        let Some(close_rel) = lower[open_end..].find("</style>") else {
            break;
        };
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
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
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
        let Some(end_rel) = find_tag_end(&markup[start + 1..]) else {
            break;
        };
        let end = start + 1 + end_rel;
        let raw = markup[start + 1..end].trim();
        cursor = end + 1;
        if raw.starts_with('!') || raw.starts_with('?') {
            continue;
        }
        if let Some(closing) = raw.strip_prefix('/') {
            let name = closing
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(name.as_str(), "div" | "slot") && stack.len() > 1 {
                stack.pop();
            }
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
            _ => {
                issues.push(format!("未対応要素 <{name}> を除去しました"));
                continue;
            }
        };
        let parent = *stack.last().unwrap_or(&0);
        let mut node = Element::new(kind, Some(parent));
        for (key, value) in parse_attributes(&body[name_end..]) {
            if matches!(
                key.as_str(),
                "class" | "id" | "name" | "style" | "role" | "aria-label"
            ) {
                if key == "class" {
                    node.classes = value.split_ascii_whitespace().map(str::to_owned).collect();
                }
                node.attrs.insert(key, value);
            } else if key.starts_with("on") {
                issues.push(format!("イベント属性 {key} を除去しました"));
            }
        }
        let index = nodes.len();
        nodes.push(node);
        nodes[parent].children.push(index);
        if !self_closing {
            stack.push(index);
        }
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
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '=' {
            i += 1;
        }
        if start == i {
            i += 1;
            continue;
        }
        let key: String = chars[start..i]
            .iter()
            .collect::<String>()
            .to_ascii_lowercase();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            if i < chars.len() && matches!(chars[i], '\'' | '"') {
                let quote = chars[i];
                i += 1;
                let value_start = i;
                while i < chars.len() && chars[i] != quote {
                    i += 1;
                }
                value = chars[value_start..i].iter().collect();
                if i < chars.len() {
                    i += 1;
                }
            } else {
                let value_start = i;
                while i < chars.len() && !chars[i].is_whitespace() {
                    i += 1;
                }
                value = chars[value_start..i].iter().collect();
            }
        }
        attrs.push((key, decode_entities(&value)));
    }
    attrs
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn inject_buttons(nodes: &mut Vec<Element>, buttons: &[LayoutButton], issues: &mut Vec<String>) {
    let slots: Vec<usize> = nodes
        .iter()
        .enumerate()
        .filter_map(|(i, n)| (n.kind == ElementKind::Slot).then_some(i))
        .collect();
    let default_slot = slots
        .iter()
        .copied()
        .find(|&i| slot_id(&nodes[i]).is_empty());
    let mut sorted: Vec<(usize, &LayoutButton)> = buttons
        .iter()
        .enumerate()
        .filter(|(_, button)| button.visible)
        .collect();
    sorted.sort_by_key(|(index, button)| (button.order, *index));
    for (button_index, button) in sorted {
        let requested = button.target_slot.as_deref().unwrap_or("").trim();
        let target = if requested.is_empty() {
            default_slot
        } else {
            slots
                .iter()
                .copied()
                .find(|&i| slot_id(&nodes[i]) == requested)
                .or(default_slot)
        };
        let Some(parent) = target else {
            issues.push(format!("ボタン {} の配置先slotがありません", button.id));
            continue;
        };
        let mut node = Element::new(ElementKind::Button, Some(parent));
        node.classes.push("yuraive-button".into());
        node.attrs
            .insert("data-button-id".into(), button.id.clone());
        node.button = Some(button_index);
        let index = nodes.len();
        nodes.push(node);
        nodes[parent].children.push(index);
    }
}

fn slot_id(node: &Element) -> &str {
    node.attrs
        .get("name")
        .filter(|v| !v.trim().is_empty())
        .or_else(|| node.attrs.get("id"))
        .map(String::as_str)
        .unwrap_or("")
        .trim()
}

fn parse_css(input: &str, canvas: &LayoutCanvas, issues: &mut Vec<String>) -> Vec<CssRule> {
    let mut rules = vec![];
    parse_css_block(input, canvas, &mut rules, issues);
    rules
}

fn parse_css_block(
    input: &str,
    canvas: &LayoutCanvas,
    rules: &mut Vec<CssRule>,
    issues: &mut Vec<String>,
) {
    let mut cursor = 0;
    while let Some(open_rel) = find_top_level(&input[cursor..], '{') {
        let open = cursor + open_rel;
        let Some(close) = matching_brace(input, open) else {
            issues.push("閉じられていないCSSブロックを無視しました".into());
            break;
        };
        let header = input[cursor..open].trim();
        let body = &input[open + 1..close];
        cursor = close + 1;
        if header.starts_with("@container") {
            if container_matches(header, canvas) {
                parse_css_block(body, canvas, rules, issues);
            }
        } else if header.starts_with('@') {
            issues.push(format!("未対応CSS規則 {header} を無視しました"));
        } else {
            let declarations = parse_declarations(body);
            for selector in split_top_level(header, ',') {
                let selector = selector.trim();
                if selector.is_empty() {
                    continue;
                }
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
            (None, '}') => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + relative);
                }
            }
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
            (None, c) if c == delimiter && paren == 0 && bracket == 0 => {
                result.push(&input[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    result.push(&input[start..]);
    result
}

fn parse_declarations(input: &str) -> Vec<(String, String)> {
    split_top_level(input, ';')
        .into_iter()
        .filter_map(|raw| {
            let colon = find_top_level(raw, ':')?;
            let property = raw[..colon].trim().to_ascii_lowercase();
            let value = raw[colon + 1..].trim();
            (!property.is_empty() && !value.is_empty()).then(|| (property, value.to_owned()))
        })
        .collect()
}

fn container_matches(header: &str, canvas: &LayoutCanvas) -> bool {
    let Some(open) = header.find('(') else {
        return true;
    };
    let Some(close) = header.rfind(')') else {
        return false;
    };
    let condition = &header[open + 1..close];
    condition.split("and").all(|part| {
        let Some((name, value)) = part.split_once(':') else {
            return false;
        };
        let axis = if name.contains("height") {
            canvas.height
        } else {
            canvas.width
        };
        let Some(bound) = eval_length(value.trim(), axis, canvas) else {
            return false;
        };
        if name.trim().starts_with("max-") {
            axis <= bound + 0.01
        } else if name.trim().starts_with("min-") {
            axis >= bound - 0.01
        } else {
            (axis - bound).abs() <= 0.01
        }
    })
}

fn specificity(selector: &str) -> (u16, u16, u16) {
    let ids = selector.matches('#').count() as u16;
    let classes = (selector.matches('.').count()
        + selector.matches('[').count()
        + selector.matches(':').count()) as u16;
    let mut tags = 0;
    for token in selector.split(|c: char| c.is_whitespace() || c == '>') {
        let head = token
            .trim()
            .split(['.', '#', '[', ':'])
            .next()
            .unwrap_or("");
        if !head.is_empty() && head != "*" {
            tags += 1;
        }
    }
    (ids, classes, tags)
}

fn apply_cascade(nodes: &mut [Element], rules: &[CssRule], canvas: &LayoutCanvas) {
    for index in 0..nodes.len() {
        let mut chosen: HashMap<String, ((u16, u16, u16), usize, String)> = HashMap::new();
        for rule in rules {
            if selector_matches(nodes, index, &rule.selector) {
                for (property, value) in &rule.declarations {
                    let replace = chosen.get(property).is_none_or(|(spec, order, _)| {
                        rule.specificity > *spec
                            || (rule.specificity == *spec && rule.order >= *order)
                    });
                    if replace {
                        chosen.insert(
                            property.clone(),
                            (rule.specificity, rule.order, value.clone()),
                        );
                    }
                }
            }
        }
        if let Some(inline) = nodes[index].attrs.get("style") {
            for (property, value) in parse_declarations(inline) {
                chosen.insert(
                    property,
                    ((u16::MAX, u16::MAX, u16::MAX), usize::MAX, value),
                );
            }
        }
        let parent = nodes[index].parent;
        for property in [
            "color",
            "font-size",
            "font-weight",
            "line-height",
            "letter-spacing",
            "text-align",
            "white-space",
            "pointer-events",
        ] {
            if !chosen.contains_key(property) {
                if let Some(value) = parent
                    .and_then(|p| nodes[p].computed.get(property))
                    .cloned()
                {
                    chosen.insert(property.into(), ((0, 0, 0), 0, value));
                }
            }
        }
        nodes[index].computed = chosen
            .into_iter()
            .map(|(key, (_, _, value))| (key, substitute_variables(&value, canvas)))
            .collect();
    }
}

fn selector_matches(nodes: &[Element], index: usize, selector: &str) -> bool {
    let parts = tokenize_selector(selector);
    if parts.is_empty() {
        return false;
    }
    match_selector_from(nodes, index, &parts, parts.len() - 1)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Combinator {
    Descendant,
    Child,
}

fn tokenize_selector(selector: &str) -> Vec<(String, Option<Combinator>)> {
    let mut parts = vec![];
    let mut current = String::new();
    let mut quote = None;
    let mut bracket = 0;
    let mut paren = 0;
    let mut pending = None;
    for ch in selector.trim().chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => {
                quote = None;
                current.push(ch);
            }
            (Some(_), _) => current.push(ch),
            (None, '\'' | '"') => {
                quote = Some(ch);
                current.push(ch);
            }
            (None, '[') => {
                bracket += 1;
                current.push(ch);
            }
            (None, ']') => {
                bracket -= 1;
                current.push(ch);
            }
            (None, '(') => {
                paren += 1;
                current.push(ch);
            }
            (None, ')') => {
                paren -= 1;
                current.push(ch);
            }
            (None, '>') if bracket == 0 && paren == 0 => {
                if !current.trim().is_empty() {
                    parts.push((current.trim().to_owned(), pending));
                    current.clear();
                }
                pending = Some(Combinator::Child);
            }
            (None, c) if c.is_whitespace() && bracket == 0 && paren == 0 => {
                if !current.trim().is_empty() {
                    parts.push((current.trim().to_owned(), pending));
                    current.clear();
                    pending = Some(Combinator::Descendant);
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push((current.trim().to_owned(), pending));
    }
    parts
}

fn match_selector_from(
    nodes: &[Element],
    node_index: usize,
    parts: &[(String, Option<Combinator>)],
    part: usize,
) -> bool {
    if !simple_selector_matches(&nodes[node_index], &parts[part].0) {
        return false;
    }
    if part == 0 {
        return true;
    }
    match parts[part].1.unwrap_or(Combinator::Descendant) {
        Combinator::Child => nodes[node_index]
            .parent
            .is_some_and(|p| match_selector_from(nodes, p, parts, part - 1)),
        Combinator::Descendant => {
            let mut parent = nodes[node_index].parent;
            while let Some(p) = parent {
                if match_selector_from(nodes, p, parts, part - 1) {
                    return true;
                }
                parent = nodes[p].parent;
            }
            false
        }
    }
}

fn simple_selector_matches(node: &Element, selector: &str) -> bool {
    let mut positive = selector.to_owned();
    loop {
        let Some(start) = positive.find(":not(") else {
            break;
        };
        let Some(end_rel) = positive[start + 5..].find(')') else {
            return false;
        };
        let end = start + 5 + end_rel;
        if simple_selector_matches(node, &positive[start + 5..end]) {
            return false;
        }
        positive.replace_range(start..=end, "");
    }
    let chars: Vec<char> = positive.chars().collect();
    let mut i = 0;
    let tag_start = i;
    while i < chars.len() && !matches!(chars[i], '.' | '#' | '[' | ':') {
        i += 1;
    }
    let tag: String = chars[tag_start..i].iter().collect();
    if !tag.is_empty() && tag != "*" && !tag.eq_ignore_ascii_case(node.tag()) {
        return false;
    }
    while i < chars.len() {
        match chars[i] {
            '.' => {
                i += 1;
                let start = i;
                while i < chars.len() && is_ident(chars[i]) {
                    i += 1;
                }
                let class: String = chars[start..i].iter().collect();
                if !node.classes.iter().any(|c| c == &class) {
                    return false;
                }
            }
            '#' => {
                i += 1;
                let start = i;
                while i < chars.len() && is_ident(chars[i]) {
                    i += 1;
                }
                let id: String = chars[start..i].iter().collect();
                if node.attrs.get("id") != Some(&id) {
                    return false;
                }
            }
            '[' => {
                let start = i + 1;
                let Some(rel) = chars[start..].iter().position(|&c| c == ']') else {
                    return false;
                };
                let end = start + rel;
                let expression: String = chars[start..end].iter().collect();
                let (key, expected) = expression
                    .split_once('=')
                    .map(|(k, v)| (k.trim(), Some(v.trim().trim_matches(['\'', '"']))))
                    .unwrap_or((expression.trim(), None));
                let actual = node.attrs.get(&key.to_ascii_lowercase());
                if actual.is_none()
                    || expected.is_some_and(|v| actual.map(String::as_str) != Some(v))
                {
                    return false;
                }
                i = end + 1;
            }
            ':' => return false,
            _ => i += 1,
        }
    }
    true
}

fn is_ident(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '-' | '_')
}

fn substitute_variables(value: &str, canvas: &LayoutCanvas) -> String {
    let variables = [
        ("--yuraive-canvas-width", format!("{}px", canvas.width)),
        ("--yuraive-canvas-height", format!("{}px", canvas.height)),
        ("--yuraive-safe-top", format!("{}px", canvas.safe_top)),
        ("--yuraive-safe-right", format!("{}px", canvas.safe_right)),
        ("--yuraive-safe-bottom", format!("{}px", canvas.safe_bottom)),
        ("--yuraive-safe-left", format!("{}px", canvas.safe_left)),
        ("--yuraive-density", canvas.density.to_string()),
        ("--yuraive-font-scale", canvas.font_scale.to_string()),
    ];
    let mut result = value.to_owned();
    for (name, replacement) in variables {
        result = result.replace(&format!("var({name})"), &replacement);
    }
    result
}
