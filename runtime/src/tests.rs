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
