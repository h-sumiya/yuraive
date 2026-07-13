# WMGF Editor

WMGF v1（Weighted Media Graph Format）をブラウザ上で視覚的に編集するReactアプリです。

```bash
npm install
npm run dev
```

Chromium系ブラウザではFile System Access APIを使い、選択したコンテンツフォルダ内の
`*.wmg.json`と`*.star`を直接保存します。未対応ブラウザではフォルダを読み込み、保存時に
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
- ButtonごとのStarlarkで表示可否、テキスト、型付きスタイル・配置を上書き
- ファイルツリー（項目下の空白を含む）の右クリックからファイル、フォルダ、`.star`スクリプトを作成
- ファイルツリーのボタンから、すべてのフォルダを一括展開・一括折りたたみ
- 作成先のツリー行で名前を入力し、スクリプトの`.star`拡張子は固定表示
- `.star`スクリプトはツリー上の任意のフォルダまたはルートへドラッグして移動
- `.star`はCodeMirrorベースのタブ式エディタで編集し、`Ctrl/Cmd + Enter`でテスト実行
- JSONとスクリプトのタブはドラッグアンドドロップで並べ替え
- タブの`×`はファイルを削除せず閉じ、右クリックからインライン名前変更・削除
- JSONタブでノードもボタンも未選択のとき、インスペクターから表示名、説明、作者、日時、タグを編集
- プレビューのデバッグペインでScript trace、`print`、context、メモリ内再生履歴を確認
- プレビュー履歴はJSONLへエクスポート可能（エディタでは永続化しません）

WMGF JSONの`version`は`1`のままです。任意のトップレベル`metadata`に
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
        "layout": {"x": 0.4, "y": 0.7, "width": 0.2, "height": 0.1},
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
[WMGF v1仕様](../notes/WMGF_v1_SPEC.md#124-playbackhistoryentry)を参照してください。
Starlarkは専用Web Workerで実行され、期限超過時はWorkerごと停止します。Wasmランタイムは
プレビューまたは明示的なテスト実行まで読み込まれません。

検証は `npm run build` と `npm run lint` で実行できます。
