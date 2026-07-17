fn compute_native_model(
    elements: &[Element],
    request: &LayoutRequest,
    issues: &mut Vec<String>,
) -> Result<Vec<ResolvedButton>, taffy::TaffyError> {
    let canvas = &request.canvas;
    let mut taffy: TaffyTree<ButtonNodeContext> = TaffyTree::new();
    taffy.disable_rounding();
    let mut node_ids = vec![None; elements.len()];
    let root = build_taffy_node(
        0,
        elements,
        &request.buttons,
        canvas,
        &mut taffy,
        &mut node_ids,
        issues,
    )?;
    taffy.compute_layout_with_measure(
        root,
        Size {
            width: AvailableSpace::Definite(canvas.width),
            height: AvailableSpace::Definite(canvas.height),
        },
        |known, available, _, context, _| {
            let Some(context) = context else {
                return Size::ZERO;
            };
            measure_text(context, known, available)
        },
    )?;

    let mut origins = vec![(0.0f32, 0.0f32); elements.len()];
    accumulate_origins(0, elements, &node_ids, &taffy, 0.0, 0.0, &mut origins)?;
    let mut resolved = vec![];
    for (element_index, element) in elements.iter().enumerate() {
        let Some(button_index) = element.button else {
            continue;
        };
        let Some(node_id) = node_ids[element_index] else {
            continue;
        };
        let layout = taffy.layout(node_id)?;
        if layout.size.width <= 0.0 || layout.size.height <= 0.0 {
            continue;
        }
        let button = &request.buttons[button_index];
        let mut style = native_style(element, button, canvas);
        apply_button_override(&mut style, &button.style);
        let enabled = element
            .computed
            .get("pointer-events")
            .is_none_or(|value| value.trim() != "none");
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
        style.size = Size {
            width: Dimension::length(canvas.width),
            height: Dimension::length(canvas.height),
        };
        style.overflow = Point {
            x: Overflow::Hidden,
            y: Overflow::Hidden,
        };
    }
    if element.kind == ElementKind::Button {
        // A browser button injected as a direct grid item stretches by default. A measured Taffy
        // leaf otherwise keeps its intrinsic text width, so make the CSS default explicit here.
        if style.justify_self.is_none() {
            style.justify_self = Some(AlignSelf::STRETCH);
        }
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
        let mut ordered_children: Vec<(usize, usize)> =
            element.children.iter().copied().enumerate().collect();
        ordered_children.sort_by_key(|(source_order, child)| {
            let order = elements[*child]
                .button
                .map(|button| buttons[button].order)
                .or_else(|| integer(&elements[*child].computed, "order"))
                .unwrap_or(0);
            (order, *source_order)
        });
        let mut children = Vec::with_capacity(ordered_children.len());
        for (_, child) in ordered_children {
            children.push(build_taffy_node(
                child, elements, buttons, canvas, taffy, node_ids, issues,
            )?);
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
    let Some(id) = node_ids[index] else {
        return Ok(());
    };
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
    let natural_width =
        glyphs * context.font_size * 0.56 + (glyphs - 1.0).max(0.0) * context.letter_spacing;
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
    let lines = if context.white_space {
        (natural_width / width.max(1.0)).ceil().max(1.0)
    } else {
        1.0
    };
    Size {
        width,
        height: known.height.unwrap_or(context.line_height * lines),
    }
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
        style.box_sizing = if value.trim() == "content-box" {
            BoxSizing::ContentBox
        } else {
            BoxSizing::BorderBox
        };
    }
    if let Some(value) = css.get("position") {
        style.position = if value.trim() == "absolute" {
            Position::Absolute
        } else {
            Position::Relative
        };
    }
    style.size = Size {
        width: dimension(css.get("width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("height"), canvas.height, canvas).unwrap_or(Dimension::auto()),
    };
    style.min_size = Size {
        width: dimension(css.get("min-width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("min-height"), canvas.height, canvas)
            .unwrap_or(Dimension::auto()),
    };
    style.max_size = Size {
        width: dimension(css.get("max-width"), canvas.width, canvas).unwrap_or(Dimension::auto()),
        height: dimension(css.get("max-height"), canvas.height, canvas)
            .unwrap_or(Dimension::auto()),
    };
    if let Some(value) = css.get("aspect-ratio") {
        style.aspect_ratio = parse_ratio(value);
    }

    style.inset = rect_auto(css, "inset", ["left", "top", "right", "bottom"], canvas);
    style.margin = margin_rect(css, canvas);
    style.padding = rect_length(
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
    style.border = border_rect(css, canvas);
    style.gap = Size {
        width: length_percentage(
            css.get("column-gap").or_else(|| css.get("gap")),
            canvas.width,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
        height: length_percentage(
            css.get("row-gap").or_else(|| css.get("gap")),
            canvas.height,
            canvas,
        )
        .unwrap_or(LengthPercentage::ZERO),
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

    if let Some(value) = css.get("flex-direction") {
        if let Ok(parsed) = value.parse() {
            style.flex_direction = parsed;
        }
    }
    if let Some(value) = css.get("flex-wrap") {
        if let Ok(parsed) = value.parse() {
            style.flex_wrap = parsed;
        }
    }
    style.flex_grow = number(css, "flex-grow").unwrap_or(style.flex_grow);
    style.flex_shrink = number(css, "flex-shrink").unwrap_or(style.flex_shrink);
    if let Some(value) = css.get("flex-basis") {
        if let Some(parsed) = dimension(Some(value), canvas.width, canvas) {
            style.flex_basis = parsed;
        }
    }
    if let Some(value) = css.get("flex") {
        apply_flex_shorthand(&mut style, value, canvas);
    }

    apply_grid(&mut style, css, canvas, issues);
    style
}

fn apply_grid(
    style: &mut Style,
    css: &BTreeMap<String, String>,
    canvas: &LayoutCanvas,
    issues: &mut Vec<String>,
) {
    if let Some(value) = css.get("grid-template") {
        let values = split_top_level(value, '/');
        if !css.contains_key("grid-template-rows") {
            if let Some(rows) = values
                .first()
                .map(|v| normalize_track_value(v, canvas.height, canvas))
            {
                if let Ok(parsed) =
                    rows.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>()
                {
                    style.grid_template_rows = parsed.tracks;
                    style.grid_template_row_names = parsed.line_names;
                }
            }
        }
        if !css.contains_key("grid-template-columns") {
            if let Some(columns) = values
                .get(1)
                .map(|v| normalize_track_value(v, canvas.width, canvas))
            {
                if let Ok(parsed) =
                    columns.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>()
                {
                    style.grid_template_columns = parsed.tracks;
                    style.grid_template_column_names = parsed.line_names;
                }
            }
        }
    }
    if let Some(value) = css.get("grid-template-columns") {
        let normalized = normalize_track_value(value, canvas.width, canvas);
        match normalized.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
            Ok(parsed) => {
                style.grid_template_columns = parsed.tracks;
                style.grid_template_column_names = parsed.line_names;
            }
            Err(error) => issues.push(format!(
                "grid-template-columnsを解釈できません: {normalized} ({error:?})"
            )),
        }
    }
    if let Some(value) = css.get("grid-template-rows") {
        let normalized = normalize_track_value(value, canvas.height, canvas);
        match normalized.parse::<GridTemplateTracks<String, GridTemplateComponent<String>>>() {
            Ok(parsed) => {
                style.grid_template_rows = parsed.tracks;
                style.grid_template_row_names = parsed.line_names;
            }
            Err(error) => issues.push(format!(
                "grid-template-rowsを解釈できません: {normalized} ({error:?})"
            )),
        }
    }
    if let Some(value) = css.get("grid-auto-columns") {
        if let Ok(parsed) =
            normalize_track_value(value, canvas.width, canvas).parse::<GridAutoTracks>()
        {
            style.grid_auto_columns = parsed.0;
        }
    }
    if let Some(value) = css.get("grid-auto-rows") {
        if let Ok(parsed) =
            normalize_track_value(value, canvas.height, canvas).parse::<GridAutoTracks>()
        {
            style.grid_auto_rows = parsed.0;
        }
    }
    if let Some(value) = css.get("grid-auto-flow") {
        if let Ok(parsed) = value.parse() {
            style.grid_auto_flow = parsed;
        }
    }
    if let Some(value) = css.get("grid-template-areas") {
        match parse_grid_template_areas(value) {
            Some(areas) => style.grid_template_areas = areas,
            None => issues.push(format!("grid-template-areasを解釈できません: {value}")),
        }
    }
    if let Some(value) = css.get("grid-column") {
        style.grid_column = parse_grid_line(value);
    }
    if let Some(value) = css.get("grid-row") {
        style.grid_row = parse_grid_line(value);
    }
    if let Some(value) = css.get("grid-area") {
        let values = split_top_level(value, '/');
        if values.len() == 1 {
            let name = values[0].trim();
            if !name.is_empty() {
                style.grid_row.start = GridPlacement::NamedLine(name.into(), 1);
                style.grid_column.start = GridPlacement::NamedLine(name.into(), 1);
            }
        } else {
            if let Some(v) = values.first() {
                style.grid_row.start = parse_grid_placement(v);
            }
            if let Some(v) = values.get(1) {
                style.grid_column.start = parse_grid_placement(v);
            }
            if let Some(v) = values.get(2) {
                style.grid_row.end = parse_grid_placement(v);
            }
            if let Some(v) = values.get(3) {
                style.grid_column.end = parse_grid_placement(v);
            }
        }
    }
}

fn parse_grid_line(value: &str) -> Line<GridPlacement<String>> {
    let values = split_top_level(value, '/');
    Line {
        start: parse_grid_placement(values.first().copied().unwrap_or("auto")),
        end: parse_grid_placement(values.get(1).copied().unwrap_or("auto")),
    }
}

fn parse_grid_template_areas(value: &str) -> Option<Vec<GridTemplateArea<String>>> {
    let mut rows: Vec<Vec<String>> = vec![];
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !matches!(chars[i], '\'' | '"') {
            i += 1;
            continue;
        }
        let quote = chars[i];
        i += 1;
        let start = i;
        while i < chars.len() && chars[i] != quote {
            i += 1;
        }
        if i >= chars.len() {
            return None;
        }
        rows.push(
            chars[start..i]
                .iter()
                .collect::<String>()
                .split_ascii_whitespace()
                .map(str::to_owned)
                .collect(),
        );
        i += 1;
    }
    let columns = rows.first()?.len();
    if columns == 0 || rows.iter().any(|row| row.len() != columns) {
        return None;
    }
    let mut bounds: BTreeMap<String, (usize, usize, usize, usize)> = BTreeMap::new();
    for (row, cells) in rows.iter().enumerate() {
        for (column, name) in cells.iter().enumerate() {
            if name == "." || name.chars().all(|ch| ch == '.') {
                continue;
            }
            bounds
                .entry(name.clone())
                .and_modify(|value| {
                    value.0 = value.0.min(row);
                    value.1 = value.1.max(row);
                    value.2 = value.2.min(column);
                    value.3 = value.3.max(column);
                })
                .or_insert((row, row, column, column));
        }
    }
    let mut areas = vec![];
    for (name, (top, bottom, left, right)) in bounds {
        for row in top..=bottom {
            for column in left..=right {
                if rows[row][column] != name {
                    return None;
                }
            }
        }
        areas.push(GridTemplateArea {
            name,
            row_start: top as u16,
            row_end: (bottom + 1) as u16,
            column_start: left as u16,
            column_end: (right + 1) as u16,
        });
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
    Point {
        x: parse(css.get("overflow-x").or(both)),
        y: parse(css.get("overflow-y").or(both)),
    }
}

