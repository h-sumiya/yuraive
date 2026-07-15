<p align="center">
  <img src="assets/icon.svg" width="112" height="112" alt="Yuraive icon">
</p>

# Yuraive

Yuraiveは、重み付きグラフとステートマシンで次のメディアを選び、分岐コンテンツを自然に再生する汎用プレイヤーです。コンテンツ作者向けのWeb Editorと、Android・Windows向けのネイティブプレイヤーを同じ形式とRustランタイムで提供します。

- 公式サイト: <https://yuraive.com>
- Yuraive Editor: <https://editor.yuraive.com>
- 編集形式: `*.yuraive.json`
- 配布形式: `*.yuraive`
- レイアウト形式: `*.yuraive-layout.html`

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| [`editor`](./editor) | Yuraive Editor（React / WebAssembly） |
| [`player-android`](./player-android) | Androidプレイヤー（application ID: `com.yuraive.player`） |
| [`player-windows`](./player-windows) | Windowsプレイヤー（Store package: `h-sumiya.Yuraive`） |
| [`runtime`](./runtime) | 共通の検証・Starlark・レイアウト・bundleランタイム |

形式の詳細は [`notes/YURAIVE_v1_SPEC.md`](./notes/YURAIVE_v1_SPEC.md)、配布bundleは [`runtime/BUNDLE_FORMAT.md`](./runtime/BUNDLE_FORMAT.md) を参照してください。

## 開発

```bash
mise run validatorTest
mise run editorDev
mise run playerTest
mise run windowsTest
```
