use serde::Serialize;
use std::collections::BTreeMap;

pub const BUNDLE_MAGIC: &[u8; 8] = b"YURAIVE1";
pub const BUNDLE_FORMAT_VERSION: u16 = 1;
pub const BUNDLE_HEADER_SIZE: usize = 16;
pub const MAX_BUNDLE_SIZE: usize = 16 * 1024 * 1024;
const MAX_GRAPH_SIZE: usize = 8 * 1024 * 1024;
const MAX_TEXT_ASSET_SIZE: usize = 2 * 1024 * 1024;
const MAX_TEXT_ASSET_TOTAL_SIZE: usize = 8 * 1024 * 1024;
const MAX_TEXT_ASSETS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedBundle {
    pub bundle_version: u32,
    pub graph_json: String,
    pub text_assets: BTreeMap<String, BundleTextAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTextAsset {
    pub kind: BundleTextAssetKind,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BundleTextAssetKind {
    Starlark,
    Layout,
}

#[derive(Debug, Default)]
struct RawTextAsset {
    path: Option<Vec<u8>>,
    content: Option<Vec<u8>>,
    kind: Option<u64>,
}

/// Decode a Yuraive player bundle with a fixed header and a protobuf payload.
///
/// Unknown protobuf fields are skipped so additive format changes remain
/// readable. Known singular fields must occur exactly once to keep the bundle
/// canonical and avoid ambiguous data.
pub fn decode_bundle(input: &[u8]) -> Result<DecodedBundle, String> {
    if input.len() > MAX_BUNDLE_SIZE {
        return Err("バンドルが大きすぎます".to_owned());
    }
    if input.len() < BUNDLE_HEADER_SIZE {
        return Err("バンドルヘッダーが途中で終了しています".to_owned());
    }
    if &input[..8] != BUNDLE_MAGIC {
        return Err("Yuraiveバンドルのマジック値が一致しません".to_owned());
    }
    let format_version = u16::from_le_bytes([input[8], input[9]]);
    if format_version != BUNDLE_FORMAT_VERSION {
        return Err(format!("未対応のYuraiveバンドル形式です: {format_version}"));
    }
    let header_size = u16::from_le_bytes([input[10], input[11]]) as usize;
    if header_size != BUNDLE_HEADER_SIZE {
        return Err("Yuraiveバンドルのヘッダーサイズが不正です".to_owned());
    }
    let payload_size = u32::from_le_bytes([input[12], input[13], input[14], input[15]]) as usize;
    if payload_size != input.len() - BUNDLE_HEADER_SIZE {
        return Err("Yuraiveバンドルの本文サイズが一致しません".to_owned());
    }

    let mut cursor = 0;
    let payload = &input[BUNDLE_HEADER_SIZE..];
    let mut bundle_version = None;
    let mut graph_json = None;
    let mut raw_assets = Vec::new();
    while cursor < payload.len() {
        let (field, wire) = read_key(payload, &mut cursor)?;
        match (field, wire) {
            (1, 0) => set_once(
                &mut bundle_version,
                read_varint(payload, &mut cursor)?,
                "bundleVersion",
            )?,
            (2, 2) => set_once(
                &mut graph_json,
                read_bytes(payload, &mut cursor, MAX_GRAPH_SIZE)?.to_vec(),
                "graphJson",
            )?,
            (3, 2) => {
                if raw_assets.len() >= MAX_TEXT_ASSETS {
                    return Err("バンドル内のテキストファイルが多すぎます".to_owned());
                }
                let bytes = read_bytes(payload, &mut cursor, MAX_TEXT_ASSET_SIZE + 4096)?;
                raw_assets.push(decode_text_asset(bytes)?);
            }
            _ => skip_field(payload, &mut cursor, wire)?,
        }
    }

    let bundle_version = bundle_version.ok_or_else(|| "bundleVersionがありません".to_owned())?;
    if bundle_version != 1 {
        return Err(format!(
            "未対応のYuraiveバンドルバージョンです: {bundle_version}"
        ));
    }
    let graph_bytes = graph_json.ok_or_else(|| "graphJsonがありません".to_owned())?;
    let graph_json =
        String::from_utf8(graph_bytes).map_err(|_| "graphJsonがUTF-8ではありません".to_owned())?;
    serde_json::from_str::<serde_json::Value>(&graph_json)
        .map_err(|error| format!("graphJsonが正しいJSONではありません: {error}"))?;

    let mut text_assets = BTreeMap::new();
    let mut total_size = 0usize;
    for raw in raw_assets {
        let path = String::from_utf8(
            raw.path
                .ok_or_else(|| "テキストファイルにpathがありません".to_owned())?,
        )
        .map_err(|_| "テキストファイルのpathがUTF-8ではありません".to_owned())?;
        if !is_safe_relative_path(&path) {
            return Err(format!("安全でないテキストファイルパスです: {path}"));
        }
        let content_bytes = raw
            .content
            .ok_or_else(|| format!("{path}: contentがありません"))?;
        if content_bytes.len() > MAX_TEXT_ASSET_SIZE {
            return Err(format!("テキストファイルが大きすぎます: {path}"));
        }
        total_size = total_size.saturating_add(content_bytes.len());
        if total_size > MAX_TEXT_ASSET_TOTAL_SIZE {
            return Err("バンドル内のテキストファイル合計が大きすぎます".to_owned());
        }
        let content = String::from_utf8(content_bytes)
            .map_err(|_| format!("テキストファイルがUTF-8ではありません: {path}"))?;
        let kind = match raw
            .kind
            .ok_or_else(|| format!("{path}: kindがありません"))?
        {
            1 if path.to_ascii_lowercase().ends_with(".star") => BundleTextAssetKind::Starlark,
            2 if path.to_ascii_lowercase().ends_with(".yuraive-layout.html") => {
                BundleTextAssetKind::Layout
            }
            1 => return Err(format!("Starlarkファイルの拡張子が不正です: {path}")),
            2 => return Err(format!("レイアウトファイルの拡張子が不正です: {path}")),
            value => return Err(format!("{path}: 未対応のテキストファイル種別です: {value}")),
        };
        if text_assets
            .insert(path.clone(), BundleTextAsset { kind, content })
            .is_some()
        {
            return Err(format!("テキストファイルパスが重複しています: {path}"));
        }
    }

    Ok(DecodedBundle {
        bundle_version: bundle_version as u32,
        graph_json,
        text_assets,
    })
}

pub fn decode_bundle_json(input: &[u8]) -> String {
    match decode_bundle(input) {
        Ok(bundle) => serde_json::to_string(&bundle).unwrap_or_else(|error| {
            format!(r#"{{"error":"バンドル結果を生成できません: {error}"}}"#)
        }),
        Err(error) => serde_json::json!({ "error": error }).to_string(),
    }
}

fn decode_text_asset(input: &[u8]) -> Result<RawTextAsset, String> {
    let mut result = RawTextAsset::default();
    let mut cursor = 0;
    while cursor < input.len() {
        let (field, wire) = read_key(input, &mut cursor)?;
        match (field, wire) {
            (1, 2) => set_once(
                &mut result.path,
                read_bytes(input, &mut cursor, 4096)?.to_vec(),
                "textAsset.path",
            )?,
            (2, 2) => set_once(
                &mut result.content,
                read_bytes(input, &mut cursor, MAX_TEXT_ASSET_SIZE)?.to_vec(),
                "textAsset.content",
            )?,
            (3, 0) => set_once(
                &mut result.kind,
                read_varint(input, &mut cursor)?,
                "textAsset.kind",
            )?,
            _ => skip_field(input, &mut cursor, wire)?,
        }
    }
    Ok(result)
}

fn set_once<T>(slot: &mut Option<T>, value: T, name: &str) -> Result<(), String> {
    if slot.replace(value).is_some() {
        return Err(format!("{name}が重複しています"));
    }
    Ok(())
}

fn read_key(input: &[u8], cursor: &mut usize) -> Result<(u64, u8), String> {
    let key = read_varint(input, cursor)?;
    let field = key >> 3;
    let wire = (key & 7) as u8;
    if field == 0 {
        return Err("protobufのフィールド番号0は使用できません".to_owned());
    }
    Ok((field, wire))
}

fn read_varint(input: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..=63).step_by(7) {
        let byte = *input
            .get(*cursor)
            .ok_or_else(|| "protobuf varintが途中で終了しています".to_owned())?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err("protobuf varintが64bitを超えています".to_owned());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("protobuf varintが長すぎます".to_owned())
}

fn read_bytes<'a>(
    input: &'a [u8],
    cursor: &mut usize,
    max_size: usize,
) -> Result<&'a [u8], String> {
    let length = read_varint(input, cursor)?;
    let length =
        usize::try_from(length).map_err(|_| "protobuf bytesの長さが不正です".to_owned())?;
    if length > max_size {
        return Err("protobuf bytesが大きすぎます".to_owned());
    }
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "protobuf bytesの長さが不正です".to_owned())?;
    let value = input
        .get(*cursor..end)
        .ok_or_else(|| "protobuf bytesが途中で終了しています".to_owned())?;
    *cursor = end;
    Ok(value)
}

fn skip_field(input: &[u8], cursor: &mut usize, wire: u8) -> Result<(), String> {
    match wire {
        0 => {
            read_varint(input, cursor)?;
        }
        1 => skip_fixed(input, cursor, 8)?,
        2 => {
            let length = read_varint(input, cursor)?;
            let length = usize::try_from(length)
                .map_err(|_| "protobufフィールドの長さが不正です".to_owned())?;
            skip_fixed(input, cursor, length)?;
        }
        5 => skip_fixed(input, cursor, 4)?,
        _ => return Err(format!("未対応のprotobuf wire typeです: {wire}")),
    }
    Ok(())
}

fn skip_fixed(input: &[u8], cursor: &mut usize, length: usize) -> Result<(), String> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "protobufフィールドの長さが不正です".to_owned())?;
    if end > input.len() {
        return Err("protobufフィールドが途中で終了しています".to_owned());
    }
    *cursor = end;
    Ok(())
}

fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(':')
        && !path.contains('\\')
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut output = Vec::new();
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            output.push(if value == 0 { byte } else { byte | 0x80 });
            if value == 0 {
                return output;
            }
        }
    }

    fn bytes_field(field: u8, value: &[u8]) -> Vec<u8> {
        let mut output = vec![(field << 3) | 2];
        output.extend(varint(value.len() as u64));
        output.extend(value);
        output
    }

    fn bundle(graph: &str, assets: &[(&str, &str, u8)]) -> Vec<u8> {
        let mut payload = vec![8, 1];
        payload.extend(bytes_field(2, graph.as_bytes()));
        for (path, content, kind) in assets {
            let mut asset = bytes_field(1, path.as_bytes());
            asset.extend(bytes_field(2, content.as_bytes()));
            asset.extend([24, *kind]);
            payload.extend(bytes_field(3, &asset));
        }
        let mut output = BUNDLE_MAGIC.to_vec();
        output.extend(BUNDLE_FORMAT_VERSION.to_le_bytes());
        output.extend((BUNDLE_HEADER_SIZE as u16).to_le_bytes());
        output.extend((payload.len() as u32).to_le_bytes());
        output.extend(payload);
        output
    }

    #[test]
    fn decodes_graph_and_text_assets() {
        let input = bundle(
            r#"{"version":1,"nodes":{},"buttons":{}}"#,
            &[
                ("scripts/route.star", "def jump(ctx):\n  return None\n", 1),
                ("ui/default.yuraive-layout.html", "<slot></slot>", 2),
            ],
        );
        let decoded = decode_bundle(&input).unwrap();
        assert_eq!(decoded.bundle_version, 1);
        assert!(decoded.graph_json.contains("\"version\":1"));
        assert_eq!(
            decoded.text_assets["scripts/route.star"].kind,
            BundleTextAssetKind::Starlark
        );
        assert_eq!(
            decoded.text_assets["ui/default.yuraive-layout.html"].content,
            "<slot></slot>"
        );
    }

    #[test]
    fn rejects_bad_headers_unsafe_paths_and_truncation() {
        let mut bad_magic = bundle("{}", &[]);
        bad_magic[0] = b'X';
        assert!(decode_bundle(&bad_magic).unwrap_err().contains("マジック"));

        let unsafe_path = bundle("{}", &[("../secret.star", "x = 1", 1)]);
        assert!(decode_bundle(&unsafe_path)
            .unwrap_err()
            .contains("安全でない"));

        let mut truncated = bundle("{}", &[]);
        truncated.pop();
        assert!(decode_bundle(&truncated)
            .unwrap_err()
            .contains("本文サイズ"));
    }
}
