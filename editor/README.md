# Yuraive Editor

Yuraive のコンテンツグラフをブラウザ上で視覚的に編集する公式エディタです。

公開URL: <https://editor.yuraive.com/>

```bash
npm install
npm run dev
```

`npm run dev` / `npm run build` は `wasm-pack` を通して
ルートの `runtime` にある Rust ランタイムを WebAssembly にビルドしてからエディタを起動します。

Chromium系ブラウザではFile System Access APIを使い、選択したコンテンツフォルダ内の
`*.yuraive.json`、`*.star`、`*.yuraive-layout.html`を直接保存します。未対応ブラウザではフォルダを読み込み、保存時に
対象ファイルをダウンロードします。

主な操作:

- ノードをドラッグして配置
- 独立したボタンをドラッグして自由に配置
- ノード右側のポートを押し、接続先を選んで再生終了時遷移を作成
- ノード下部からボタン上部へ接続し、ノードで使用するボタンを指定
- ボタン右側からノード左側へ接続し、押下時遷移を作成
- キャンバスをダブルクリックしてノードを作成
- `Ctrl/Cmd + S` で保存、`Ctrl/Cmd + N` で新規グラフ
- `Delete` で選択したノードまたはボタンを削除、`Esc` で接続操作を中止
- Script Nodeへ遷移するとStarlarkを実行し、戻されたNode IDへ0秒で遷移
- ButtonごとのStarlarkで表示可否、テキスト、型付きスタイルを上書き
- ファイルツリー（項目下の空白を含む）の右クリックからファイル、フォルダ、`.star`スクリプト、`.yuraive-layout.html`レイアウトを作成
- ファイルツリーのボタンから、すべてのフォルダを一括展開・一括折りたたみ
- ファイルツリーの再読み込みボタンから、フォルダ外で行われた変更を反映
- 作成先のツリー行で名前を入力し、スクリプトの`.star`拡張子は固定表示
- `.star`と`.yuraive-layout.html`はツリー上の任意のフォルダまたはルートへドラッグして移動
- `.star`はCodeMirrorベースのタブ式エディタで編集し、`Ctrl/Cmd + Enter`でテスト実行
- `.yuraive-layout.html`は対応HTML/CSS一覧と390×390ライブプレビューを備えたタブで編集
- レイアウトファイルはツールバー、グラフ右クリック、ファイルツリーからのドロップでノードとして配置し、再生設定上部へ接続
- レイアウトファイルを再生設定ノード上部中央のポートへドロップして接続
- JSON、スクリプト、レイアウトのタブはドラッグアンドドロップで並べ替え
- タブの`×`はファイルを削除せず閉じ、右クリックからインライン名前変更・削除
- JSONタブでノードもボタンも未選択のとき、インスペクターから表示名、説明、作者、日時、タグを編集
- グラフ情報インスペクターから、GUI座標を除去して全`.star`・`.yuraive-layout.html`を同梱した配布用`.yuraive`を出力
- 新規作品の`contentId`発行と再発行、再生統計スクリプトの設定、Display DSLの検証付きプレビュー
- 再生設定ごとの安全なアクセントカラー指定
- プレビューのデバッグペインでScript trace、`print`、context、メモリ内再生履歴を確認
- プレビュー履歴はJSONLへエクスポート可能（エディタでは永続化しません）

Yuraive JSONの`version`は`1`のままです。任意のトップレベル`metadata`に
`displayName`、`description`、`author`、`createdAt`、`updatedAt`、`tags`を保存できます。
日時はRFC 3339、値のない項目は省略します。

## Starlark

Script Nodeは既定で`jump(ctx)`を呼び、接続済みの遷移先Node IDまたは`None`を受け取ります。
Buttonは既定で`render(ctx)`を呼び、次の値を任意に返せます。

```python
def jump(ctx):
    return "next-node"

def render(ctx):
    return {
        "visible": True,
        "text": "続ける",
        "style": {"backgroundColor": "#355070", "textColor": "#ffffff"},
    }
```

`ctx["history"]`にはプレビュー中に確定した再生履歴（最大1000件）が全件入ります。
`ctx`のトップレベルには次の値が入ります。

```text
history, current, trigger,
now, graphId, runId, runStartedAt,
historyStartedAt, historyEndedAt, historyCount,
historyActivePlayMs, totalActivePlayMs
```

再生統計の`render_stats(ctx)`では`session`と`aggregate`も追加されます。全スクリプトで
`random()`、`randint(start, end)`、`choice(items)`、`shuffled(items)`を利用できます。

`current`は`nodeId`、`mediaId`、`source`、`startedAt`、`positionMs`、`mediaDurationMs`、
`activePlayMs`を持ちます。`historyActivePlayMs`は確定履歴のみ、`totalActivePlayMs`は
それに履歴へ未確定の現在再生時間を加えた合計です。確定直後のメディアが`current`にも残る
Script Node実行時も二重には加算しません。`trigger.type`は`start`、`restart`、`end`、
`button`、`empty`、`render`、`test`、`debug`のいずれかで、必要に応じて`scriptNodeId`または
`buttonId`を含みます。ボタンの`render(ctx)`に渡る`now`は呼び出し時点のスナップショットで、
時刻経過だけによる自動再評価は行いません。

実再生時間はpauseを除いた`activePlayMs`として集計し、seekイベント自体は保存しません。
履歴はメディア再生の記録であり、状態遷移先を示す`transition_to`は持ちません。
`PlaybackHistoryEntry`の全フィールドとJSONL仕様は
[Yuraive v1仕様](../notes/YURAIVE_v1_SPEC.md#134-playbackhistoryentry)を参照してください。
StarlarkはAndroidプレイヤーと共通のRust製エンジンをWebAssembly化し、専用Web Workerで
実行します。期限超過時はRust側で中断し、応答不能時はWorkerごと停止します。Wasmランタイムは
プレビューまたは明示的なテスト実行まで読み込まれません。`load()`は同じコンテンツ内の
`.star`ファイルを絶対パス風または呼び出し元からの相対パスで参照できます。

検証は `npm run build` と `npm run lint` で実行できます。

`.yuraive`のヘッダー、Protobuf本文、サイズ上限は
[Player Bundle v1仕様](../runtime/BUNDLE_FORMAT.md)を参照してください。
