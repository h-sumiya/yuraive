fn native_style(
    element: &Element,
    _button: &LayoutButton,
    canvas: &LayoutCanvas,
) -> NativeButtonStyle {
    let css = &element.computed;
    let font_size = font_size(css, canvas);
    let shorthand_line_height = css.get("font").and_then(|font| {
        font.split_ascii_whitespace()
            .find_map(|part| part.split_once('/').map(|(_, height)| height.to_owned()))
    });
    let line_height = css
        .get("line-height")
        .or(shorthand_line_height.as_ref())
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed == "normal" {
                None
            } else if let Ok(multiplier) = trimmed.parse::<f32>() {
                Some(font_size * multiplier)
            } else {
                eval_length(trimmed, font_size, canvas)
            }
        })
        .unwrap_or(font_size * 1.2);
    let padding = resolved_box(
        css,
        "padding",
        [
            "padding-left",
            "padding-top",
            "padding-right",
            "padding-bottom",
        ],
        canvas,
    );
    let border = resolved_border(css, canvas);
    NativeButtonStyle {
        background_color: background_color(css).unwrap_or_else(|| "#00000000".into()),
        background_image: css
            .get("background-image")
            .or_else(|| css.get("background"))
            .and_then(|value| extract_url(value)),
        background_size: css
            .get("background-size")
            .cloned()
            .unwrap_or_else(|| "cover".into()),
        background_position: css
            .get("background-position")
            .cloned()
            .unwrap_or_else(|| "center".into()),
        background_repeat: css
            .get("background-repeat")
            .cloned()
            .unwrap_or_else(|| "no-repeat".into()),
        text_color: css
            .get("color")
            .cloned()
            .unwrap_or_else(|| "#ff000000".into()),
        opacity: number(css, "opacity").unwrap_or(1.0).clamp(0.0, 1.0),
        border_color: border_color(css).unwrap_or_else(|| "#00000000".into()),
        border_width: border[0].max(border[1]).max(border[2]).max(border[3]),
        border_radius: css
            .get("border-radius")
            .and_then(|v| eval_length(v, canvas.width.min(canvas.height), canvas))
            .unwrap_or(0.0)
            .max(0.0),
        font_size,
        font_weight: font_weight(css),
        padding_left: padding[0],
        padding_top: padding[1],
        padding_right: padding[2],
        padding_bottom: padding[3],
        text_align: css
            .get("text-align")
            .cloned()
            .unwrap_or_else(|| "center".into()),
        vertical_align: css
            .get("align-items")
            .or_else(|| css.get("place-items"))
            .map(|v| {
                v.split_ascii_whitespace()
                    .next()
                    .unwrap_or("center")
                    .to_owned()
            })
            .unwrap_or_else(|| "center".into()),
        line_height,
        letter_spacing: css
            .get("letter-spacing")
            .and_then(|v| eval_length(v, font_size, canvas))
            .unwrap_or(0.0),
        white_space: css
            .get("white-space")
            .cloned()
            .unwrap_or_else(|| "normal".into()),
        text_overflow: css
            .get("text-overflow")
            .cloned()
            .unwrap_or_else(|| "clip".into()),
        overflow: css
            .get("overflow")
            .cloned()
            .unwrap_or_else(|| "visible".into()),
        box_shadow: css.get("box-shadow").cloned(),
        filter: css.get("filter").cloned(),
        transform: css.get("transform").cloned(),
    }
}

fn apply_button_override(style: &mut NativeButtonStyle, input: &ButtonInputStyle) {
    if let Some(value) = &input.background_color {
        style.background_color = value.clone();
    }
    if let Some(value) = &input.background_image {
        style.background_image = Some(value.clone());
    }
    if let Some(value) = &input.text_color {
        style.text_color = value.clone();
    }
    if let Some(value) = input.opacity {
        style.opacity = value.clamp(0.0, 1.0);
    }
    if let Some(value) = &input.border_color {
        style.border_color = value.clone();
    }
    if let Some(value) = input.border_width {
        style.border_width = value.max(0.0);
    }
    if let Some(value) = input.border_radius {
        style.border_radius = value.max(0.0);
    }
    if let Some(value) = input.font_size {
        style.font_size = value.max(1.0);
    }
    if let Some(value) = input.font_weight {
        style.font_weight = value;
    }
    if let Some(value) = input.padding_horizontal {
        style.padding_left = value.max(0.0);
        style.padding_right = value.max(0.0);
    }
    if let Some(value) = input.padding_vertical {
        style.padding_top = value.max(0.0);
        style.padding_bottom = value.max(0.0);
    }
}

fn background_color(css: &BTreeMap<String, String>) -> Option<String> {
    css.get("background-color").cloned().or_else(|| {
        css.get("background").and_then(|value| {
            value
                .split_ascii_whitespace()
                .find(|part| is_color(part))
                .map(str::to_owned)
        })
    })
}

fn border_color(css: &BTreeMap<String, String>) -> Option<String> {
    css.get("border-color")
        .or_else(|| css.get("border-left-color"))
        .cloned()
        .or_else(|| {
            css.get("border").and_then(|value| {
                value
                    .split_ascii_whitespace()
                    .find(|part| is_color(part))
                    .map(str::to_owned)
            })
        })
}

fn extract_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let inside = trimmed.strip_prefix("url(")?.strip_suffix(')')?.trim();
    let path = inside.trim_matches(['\'', '"']);
    if path.starts_with("http:") || path.starts_with("https:") || path.starts_with("data:") {
        None
    } else {
        Some(path.to_owned())
    }
}

fn is_color(value: &str) -> bool {
    value.starts_with('#')
        || value.starts_with("rgb(")
        || value.starts_with("rgba(")
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "transparent" | "white" | "black" | "red" | "green" | "blue" | "currentcolor"
        )
}

fn font_size(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> f32 {
    if let Some(value) = css
        .get("font-size")
        .and_then(|v| eval_length(v, 16.0, canvas))
    {
        return value.max(1.0);
    }
    if let Some(font) = css.get("font") {
        for part in font.split_ascii_whitespace() {
            let size = part.split('/').next().unwrap_or(part);
            if let Some(value) = eval_length(size, 16.0, canvas) {
                if size.ends_with("px") {
                    return value.max(1.0);
                }
            }
        }
    }
    16.0
}

fn font_weight(css: &BTreeMap<String, String>) -> i32 {
    if let Some(value) = css.get("font-weight") {
        return match value.trim() {
            "normal" => 400,
            "bold" => 700,
            other => other.parse().unwrap_or(400),
        };
    }
    if let Some(font) = css.get("font") {
        for part in font.split_ascii_whitespace() {
            if let Ok(weight) = part.parse::<i32>() {
                if (1..=1000).contains(&weight) {
                    return weight;
                }
            }
            if part == "bold" {
                return 700;
            }
        }
    }
    400
}

fn clean(value: f32) -> f32 {
    if value.is_finite() {
        (value * 1000.0).round() / 1000.0
    } else {
        0.0
    }
}

fn number(css: &BTreeMap<String, String>, property: &str) -> Option<f32> {
    css.get(property)?.trim().parse().ok()
}
fn integer(css: &BTreeMap<String, String>, property: &str) -> Option<i32> {
    css.get(property)?.trim().parse().ok()
}

fn parse_ratio(value: &str) -> Option<f32> {
    if let Some((left, right)) = value.split_once('/') {
        Some(left.trim().parse::<f32>().ok()? / right.trim().parse::<f32>().ok()?.max(f32::EPSILON))
    } else {
        value.trim().parse().ok()
    }
}

fn apply_flex_shorthand(style: &mut Style, value: &str, canvas: &LayoutCanvas) {
    let parts: Vec<&str> = value.split_ascii_whitespace().collect();
    if let Some(v) = parts.first().and_then(|v| v.parse().ok()) {
        style.flex_grow = v;
    }
    if let Some(v) = parts.get(1).and_then(|v| v.parse().ok()) {
        style.flex_shrink = v;
    }
    if let Some(v) = parts
        .get(2)
        .and_then(|v| dimension(Some(&v.to_string()), canvas.width, canvas))
    {
        style.flex_basis = v;
    }
}

fn dimension(
    value: Option<&String>,
    percent_base: f32,
    canvas: &LayoutCanvas,
) -> Option<Dimension> {
    let value = value?.trim();
    if value == "auto" {
        return Some(Dimension::auto());
    }
    if is_simple_percent(value) {
        return value
            .trim_end_matches('%')
            .parse::<f32>()
            .ok()
            .map(|v| Dimension::percent(v / 100.0));
    }
    eval_length(value, percent_base, canvas).map(Dimension::length)
}

fn length_percentage(
    value: Option<&String>,
    percent_base: f32,
    canvas: &LayoutCanvas,
) -> Option<LengthPercentage> {
    let value = value?.trim();
    if is_simple_percent(value) {
        return value
            .trim_end_matches('%')
            .parse::<f32>()
            .ok()
            .map(|v| LengthPercentage::percent(v / 100.0));
    }
    eval_length(value, percent_base, canvas).map(LengthPercentage::length)
}

fn length_percentage_auto(
    value: Option<&String>,
    percent_base: f32,
    canvas: &LayoutCanvas,
) -> Option<LengthPercentageAuto> {
    let value = value?.trim();
    if value == "auto" {
        return Some(LengthPercentageAuto::auto());
    }
    if is_simple_percent(value) {
        return value
            .trim_end_matches('%')
            .parse::<f32>()
            .ok()
            .map(|v| LengthPercentageAuto::percent(v / 100.0));
    }
    eval_length(value, percent_base, canvas).map(LengthPercentageAuto::length)
}

fn is_simple_percent(value: &str) -> bool {
    value
        .strip_suffix('%')
        .is_some_and(|v| v.trim().parse::<f32>().is_ok())
}

fn rect_auto(
    css: &BTreeMap<String, String>,
    shorthand: &str,
    sides: [&str; 4],
    canvas: &LayoutCanvas,
) -> Rect<LengthPercentageAuto> {
    let values = box_values(css.get(shorthand).map(String::as_str));
    Rect {
        left: length_percentage_auto(
            css.get(sides[0]).or_else(|| values[0].as_ref()),
            canvas.width,
            canvas,
        )
        .unwrap_or(LengthPercentageAuto::auto()),
        top: length_percentage_auto(
            css.get(sides[1]).or_else(|| values[1].as_ref()),
            canvas.height,
            canvas,
        )
        .unwrap_or(LengthPercentageAuto::auto()),
        right: length_percentage_auto(
            css.get(sides[2]).or_else(|| values[2].as_ref()),
            canvas.width,
            canvas,
        )
        .unwrap_or(LengthPercentageAuto::auto()),
        bottom: length_percentage_auto(
            css.get(sides[3]).or_else(|| values[3].as_ref()),
            canvas.height,
            canvas,
        )
        .unwrap_or(LengthPercentageAuto::auto()),
    }
}

fn margin_rect(
    css: &BTreeMap<String, String>,
    canvas: &LayoutCanvas,
) -> Rect<LengthPercentageAuto> {
    let values = box_values(css.get("margin").map(String::as_str));
    let side = |property: &str, shorthand: &Option<String>, base: f32| {
        length_percentage_auto(css.get(property).or(shorthand.as_ref()), base, canvas)
            .unwrap_or(LengthPercentageAuto::length(0.0))
    };
    Rect {
        left: side("margin-left", &values[0], canvas.width),
        top: side("margin-top", &values[1], canvas.height),
        right: side("margin-right", &values[2], canvas.width),
        bottom: side("margin-bottom", &values[3], canvas.height),
    }
}

fn rect_length(
    css: &BTreeMap<String, String>,
    shorthand: &str,
    sides: [&str; 4],
    canvas: &LayoutCanvas,
) -> Rect<LengthPercentage> {
    let values = box_values(css.get(shorthand).map(String::as_str));
    Rect {
        left: length_percentage(
            css.get(sides[0]).or_else(|| values[0].as_ref()),
            canvas.width,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
        top: length_percentage(
            css.get(sides[1]).or_else(|| values[1].as_ref()),
            canvas.height,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
        right: length_percentage(
            css.get(sides[2]).or_else(|| values[2].as_ref()),
            canvas.width,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
        bottom: length_percentage(
            css.get(sides[3]).or_else(|| values[3].as_ref()),
            canvas.height,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
    }
}

fn border_rect(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> Rect<LengthPercentage> {
    let resolved = resolved_border(css, canvas);
    Rect {
        left: LengthPercentage::length(resolved[0]),
        top: LengthPercentage::length(resolved[1]),
        right: LengthPercentage::length(resolved[2]),
        bottom: LengthPercentage::length(resolved[3]),
    }
}

fn resolved_border(css: &BTreeMap<String, String>, canvas: &LayoutCanvas) -> [f32; 4] {
    let mut width = css
        .get("border-width")
        .and_then(|v| eval_length(v, canvas.width, canvas))
        .unwrap_or(0.0);
    if let Some(border) = css.get("border") {
        if let Some(part) = border
            .split_ascii_whitespace()
            .find(|part| eval_length(part, canvas.width, canvas).is_some())
        {
            width = eval_length(part, canvas.width, canvas).unwrap_or(width);
        }
    }
    [
        css.get("border-left-width")
            .and_then(|v| eval_length(v, canvas.width, canvas))
            .unwrap_or(width),
        css.get("border-top-width")
            .and_then(|v| eval_length(v, canvas.height, canvas))
            .unwrap_or(width),
        css.get("border-right-width")
            .and_then(|v| eval_length(v, canvas.width, canvas))
            .unwrap_or(width),
        css.get("border-bottom-width")
            .and_then(|v| eval_length(v, canvas.height, canvas))
            .unwrap_or(width),
    ]
}

fn resolved_box(
    css: &BTreeMap<String, String>,
    shorthand: &str,
    sides: [&str; 4],
    canvas: &LayoutCanvas,
) -> [f32; 4] {
    let values = box_values(css.get(shorthand).map(String::as_str));
    [
        css.get(sides[0])
            .and_then(|v| eval_length(v, canvas.width, canvas))
            .or_else(|| {
                values[0]
                    .as_ref()
                    .and_then(|v| eval_length(v, canvas.width, canvas))
            })
            .unwrap_or(0.0),
        css.get(sides[1])
            .and_then(|v| eval_length(v, canvas.height, canvas))
            .or_else(|| {
                values[1]
                    .as_ref()
                    .and_then(|v| eval_length(v, canvas.height, canvas))
            })
            .unwrap_or(0.0),
        css.get(sides[2])
            .and_then(|v| eval_length(v, canvas.width, canvas))
            .or_else(|| {
                values[2]
                    .as_ref()
                    .and_then(|v| eval_length(v, canvas.width, canvas))
            })
            .unwrap_or(0.0),
        css.get(sides[3])
            .and_then(|v| eval_length(v, canvas.height, canvas))
            .or_else(|| {
                values[3]
                    .as_ref()
                    .and_then(|v| eval_length(v, canvas.height, canvas))
            })
            .unwrap_or(0.0),
    ]
}

fn box_values(value: Option<&str>) -> [Option<String>; 4] {
    let Some(value) = value else {
        return [None, None, None, None];
    };
    let parts = split_whitespace_top_level(value);
    match parts.as_slice() {
        [a] => [
            Some(a.clone()),
            Some(a.clone()),
            Some(a.clone()),
            Some(a.clone()),
        ],
        [vertical, horizontal] => [
            Some(horizontal.clone()),
            Some(vertical.clone()),
            Some(horizontal.clone()),
            Some(vertical.clone()),
        ],
        [top, horizontal, bottom] => [
            Some(horizontal.clone()),
            Some(top.clone()),
            Some(horizontal.clone()),
            Some(bottom.clone()),
        ],
        [top, right, bottom, left, ..] => [
            Some(left.clone()),
            Some(top.clone()),
            Some(right.clone()),
            Some(bottom.clone()),
        ],
        _ => [None, None, None, None],
    }
}

fn split_whitespace_top_level(value: &str) -> Vec<String> {
    let mut result = vec![];
    let mut current = String::new();
    let mut depth = 0;
    for ch in value.chars() {
        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            depth -= 1;
        }
        if ch.is_whitespace() && depth == 0 {
            if !current.is_empty() {
                result.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn normalize_track_value(value: &str, percent_base: f32, canvas: &LayoutCanvas) -> String {
    let mut result = String::new();
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit()
            || chars[i] == '.'
            || (chars[i] == '-' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit())
        {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let unit_start = i;
            while i < chars.len() && (chars[i].is_ascii_alphabetic() || chars[i] == '%') {
                i += 1;
            }
            let token: String = chars[start..i].iter().collect();
            let unit: String = chars[unit_start..i].iter().collect();
            if matches!(unit.as_str(), "cqw" | "cqh") {
                result.push_str(&format!(
                    "{}px",
                    eval_length(&token, percent_base, canvas).unwrap_or(0.0)
                ));
            } else {
                result.push_str(&token);
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    // Taffy does not resolve calc() pointers. Resolve whole clamp/min/max functions used as tracks.
    for name in ["clamp", "calc"] {
        loop {
            let Some(start) = result.find(&format!("{name}(")) else {
                break;
            };
            let Some(end) = matching_paren(&result, start + name.len()) else {
                break;
            };
            let expression = result[start..=end].to_owned();
            let replacement = format!(
                "{}px",
                eval_length(&expression, percent_base, canvas).unwrap_or(0.0)
            );
            result.replace_range(start..=end, &replacement);
        }
    }
    result
        .replace("minmax(0,", "minmax(0px,")
        .replace("minmax(0 ,", "minmax(0px,")
}

fn matching_paren(value: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    for (offset, ch) in value[open..].char_indices() {
        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(open + offset);
            }
        }
    }
    None
}

