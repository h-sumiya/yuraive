#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = r#"
        <style>
        .stage { position:absolute; inset:0; display:grid; grid-template-rows:1fr auto; padding:clamp(14px,4cqw,28px); }
        slot[name="actions"] { display:grid; grid-row:2; grid-template-columns:repeat(2,minmax(0,1fr)); gap:clamp(8px,2cqw,14px); }
        .yuraive-button { display:grid; place-items:center; min-height:52px; padding:12px 18px; border:0; border-radius:18px; background:#574de5; color:white; font:600 16px/1.3 system-ui; }
        @container yuraive-canvas (max-width:360px) { slot[name="actions"] { grid-template-columns:1fr; } }
        </style><div class="stage"><slot name="actions"></slot><slot></slot></div>
    "#;

    fn request(width: f32) -> LayoutRequest {
        LayoutRequest {
            source: SOURCE.into(),
            canvas: LayoutCanvas {
                width,
                height: 400.0,
                density: 2.0,
                font_scale: 1.0,
                safe_top: 0.0,
                safe_right: 0.0,
                safe_bottom: 0.0,
                safe_left: 0.0,
            },
            buttons: vec![
                LayoutButton {
                    id: "a".into(),
                    visible: true,
                    target_slot: Some("actions".into()),
                    order: 2,
                    z_index: 0,
                    text: "Alpha".into(),
                    style: ButtonInputStyle::default(),
                },
                LayoutButton {
                    id: "b".into(),
                    visible: true,
                    target_slot: Some("actions".into()),
                    order: 1,
                    z_index: 1,
                    text: "Beta".into(),
                    style: ButtonInputStyle::default(),
                },
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
        assert_eq!(a.style.background_color, "#574de5");
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
        input.source = input.source.replace(
            "<div class=\"stage\">",
            "<script>alert(1)</script><div onclick=\"bad()\" class=\"stage\">",
        );
        let output = resolve_button_layout(&input);
        assert_eq!(output.buttons.len(), 2);
        assert!(output
            .issues
            .iter()
            .any(|issue| issue.contains("禁止要素") || issue.contains("イベント属性")));
    }

    #[test]
    fn json_result_is_deterministic() {
        let json = serde_json::to_string(&request(400.0)).unwrap();
        assert_eq!(
            resolve_button_layout_json(&json),
            resolve_button_layout_json(&json)
        );
    }

    #[test]
    fn parses_rectangular_named_grid_areas() {
        let areas = parse_grid_template_areas(r#""hero hero" "actions side""#).unwrap();
        let hero = areas.iter().find(|area| area.name == "hero").unwrap();
        assert_eq!(
            (
                hero.row_start,
                hero.row_end,
                hero.column_start,
                hero.column_end
            ),
            (0, 1, 0, 2)
        );
        assert!(parse_grid_template_areas(r#""broken broken" "broken other""#).is_none());
    }
}
