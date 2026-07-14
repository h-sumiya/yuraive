# WMGF Player Bundle v1

WMGF Player Bundleは、配布用グラフと作者が作成したテキストファイルを1つにまとめる
バイナリ形式です。拡張子は`.wmg`です。編集可能な元データである`.wmg.json`は
引き続きサポートし、同じフォルダに同名の両形式がある場合はプレイヤーが`.wmg`を優先します。

`story.wmg.json`に対応するバンドル名は`story.wmg`です。

## 1. 格納対象

バンドルには次のデータだけを格納します。

- `editor`という名前の全フィールドを除去した、UTF-8 JSONのWMGF v1グラフ
- コンテンツルート以下のUTF-8 `.star`ファイル
- コンテンツルート以下のUTF-8 `.wmg-layout.html`ファイル

音声、動画、画像、字幕、ボタン背景画像は格納しません。これらは従来どおり、`.wmg`の
親フォルダをコンテンツルートとしてグラフ内の安全な相対パスから解決します。

## 2. 固定ヘッダー

先頭16バイトは次の固定ヘッダーです。複数バイト整数はlittle-endianです。

| オフセット | サイズ | 内容 |
| --- | ---: | --- |
| 0 | 8 | ASCII `WMGFBNDL` |
| 8 | 2 | ヘッダー形式バージョン。v1は`1` |
| 10 | 2 | ヘッダーサイズ。v1は`16` |
| 12 | 4 | 後続するProtobuf本文のバイト数 |

本文サイズは実際の残りバイト数と完全に一致しなければなりません。

## 3. Protobuf本文

本文は次のproto3メッセージと同じwire formatです。`.proto`のコード生成は必須では
なく、エディタは小さなTypeScriptエンコーダー、プレイヤーは共通Rustデコーダーを使います。

```protobuf
syntax = "proto3";

message WmgfBundle {
  uint32 bundle_version = 1; // v1は1
  bytes graph_json = 2;      // UTF-8 JSON
  repeated TextAsset text_assets = 3;
}

message TextAsset {
  string path = 1;           // グラフからの安全な相対パス
  string content = 2;        // UTF-8
  TextAssetKind kind = 3;
}

enum TextAssetKind {
  TEXT_ASSET_KIND_UNSPECIFIED = 0;
  STARLARK = 1;
  LAYOUT = 2;
}
```

未知フィールドは読み飛ばします。既知の単一フィールドの重複、同じ`path`の重複、種別と
拡張子の不一致、絶対パス、`.`または`..`のパス要素、空のパス要素、バックスラッシュはエラーです。

## 4. v1の上限

| 対象 | 上限 |
| --- | ---: |
| バンドル全体 | 16 MiB |
| `graph_json` | 8 MiB |
| テキストファイル1件 | 2 MiB |
| テキストファイル合計 | 8 MiB |
| テキストファイル数 | 256件 |
| `path` | UTF-8で4096バイト |

これらの上限はメディアを誤って格納することや、信頼できないバンドルによる過剰なメモリ使用を
防ぐためのものです。
