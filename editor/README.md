# WMGF Editor

WMGF v1（Weighted Media Graph Format）をブラウザ上で視覚的に編集するReactアプリです。

```bash
npm install
npm run dev
```

Chromium系ブラウザではFile System Access APIを使い、選択したコンテンツフォルダ内の
`*.wmg.json`を直接保存します。未対応ブラウザではフォルダを読み込み、保存時にJSONを
ダウンロードします。

主な操作:

- ノードをドラッグして配置
- 独立したボタンをドラッグして自由に配置
- ノード右側のポートを押し、接続先を選んで再生終了時遷移を作成
- ノード下部からボタン上部へ接続し、ノードで使用するボタンを指定
- ボタン右側からノード左側へ接続し、押下時遷移を作成
- キャンバスをダブルクリックしてノードを作成
- `Ctrl/Cmd + S` で保存、`Ctrl/Cmd + N` で新規グラフ
- `Delete` で選択したノードまたはボタンを削除、`Esc` で接続操作を中止

検証は `npm run build` と `npm run lint` で実行できます。
