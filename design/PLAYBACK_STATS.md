# 再生統計 設計案

## 目的

Yuraive作品ごとの再生履歴から、各再生セッションの結果を作者定義のStarlarkで生成し、
プレイヤー上で一覧、並べ替え、共有できるようにする。

作者が担当するのは「1セッション分の並べ替え用数値、表示内容、任意の共有内容を返す」部分だけとする。
同一作品の判定、履歴の抽出、`runId`ごとのグループ化、集計、スクリプト呼び出し、並べ替え、
エラー処理はホストが担当し、作者に履歴管理の知識を要求しない。

再生統計は、生の再生ログを確認する既存の「再生履歴」とは別のユーザー向け機能として扱う。

## 設計原則

- スクリプトは1セッションにつき1回呼び出す
- スクリプトにセッションの抽出、一覧生成、並べ替えをさせない
- セッション単位と作品全体の基本集計値をホストで計算してから渡す
- 表示内容は作者が宣言的UIツリーで自由に構成できる
- ナビゲーション、共有ボタン、並べ替えUIなどの操作はホストが管理する
- 共有は必ずユーザー操作で開始し、投稿前に内容を確認、編集できるようにする
- Yuraive本体の`version`は引き続き`1`とし、追加フィールドは任意とする

## Yuraiveへの定義

トップレベルに任意の`playbackStats`を追加する。値は既存の`ScriptCall`と同じ形式とする。

```json
{
  "version": 1,
  "playbackStats": {
    "path": "scripts/playback_stats.star",
    "function": "render_stats"
  }
}
```

| フィールド | 型     | 内容                                       |
| ---------- | ------ | ------------------------------------------ |
| `path`     | string | Yuraiveファイルからの相対`.star`パス。必須 |
| `function` | string | 呼び出す関数名。省略時は`render_stats`     |

`playbackStats`がない作品ではプレイヤーの再生統計ボタンを表示しない、または無効化する。

## 作品の識別

現在の`graphId`は保存ルートURIと相対パスを含むため、ファイルの移動や名前変更で別作品になる。
ファイルの位置に依存せず、作者が複数のYuraiveを同じ作品または作品グループとして扱えるよう、
リリース前に`metadata.contentId`を追加する。

```json
{
  "metadata": {
    "contentId": "com.example.rain_asmr",
    "displayName": "雨音シナリオ"
  }
}
```

- 新規作品の`contentId`の初期値は、エディタがUUIDとして発行する
- エディタ上ではAndroidのApplication IDに近い`com.example.groupId`形式を推奨する
- 推奨形式は作者が管理しやすくするための案内であり、UUIDや別形式も有効とする
- 作者は`contentId`を編集でき、複数のYuraiveへ意図的に同じ値を設定できる
- 同じ`contentId`を持つYuraiveの履歴は、同じ作品または作品グループの統計として集計する
- 同じ値を持つファイルを検出しても重複警告を表示しない
- ファイルの移動、名前変更、複製、通常の保存では自動変更しない
- 別の統計として分離したい場合は、作者が`contentId`を変更するかエディタで新しいIDを発行する
- `contentId`のない既存作品は当面`graphId`へフォールバックする

## ホストによるセッション生成

ホストは次の処理を行う。

1. `contentId`、なければ`graphId`が一致する保持中の履歴を読み込む
2. 履歴を`runId`でグループ化する
3. 各グループ内を`startedAt`順に並べる
4. 件数、実再生時間、開始時刻、終了時刻などを集計する
5. 各セッションについて`render_stats(ctx)`を1回呼び出す
6. 返り値を検証し、ホストが結果一覧を並べ替える

スクリプトが同一作品のセッションを列挙したり、`runId`で履歴をフィルターしたりする必要はない。

再生中のランも統計対象にできる。この場合、確定済み履歴に`current.activePlayMs`を加えた値を
セッションの実再生時間とし、履歴自体へ未確定エントリを追加しない。

## 統計用コンテキスト

既存のStarlarkコンテキストに`session`と`aggregate`を追加する。
`history`は既存仕様どおり同一作品の保持中の全履歴とし、通常の統計作成では
集計済みの`session`を使う。

```json
{
  "now": "2026-07-14T12:05:10.250Z",
  "graphId": "content://root::rain/graph.yuraive.json",
  "history": [],
  "current": null,
  "trigger": {
    "type": "stats",
    "runId": "2d56f9e8-1e7b-46aa-a937-f8e2f60ab715"
  },
  "session": {
    "runId": "2d56f9e8-1e7b-46aa-a937-f8e2f60ab715",
    "startedAt": "2026-07-14T11:40:00.000Z",
    "endedAt": "2026-07-14T12:03:14.000Z",
    "isActive": false,
    "entryCount": 8,
    "activePlayMs": 1394000,
    "entries": []
  },
  "aggregate": {
    "sessionCount": 12,
    "entryCount": 86,
    "activePlayMs": 14832000,
    "firstStartedAt": "2026-06-20T02:11:00.000Z",
    "lastEndedAt": "2026-07-14T12:03:14.000Z"
  }
}
```

### `session`

| フィールド     | 型                     | 内容                                         |
| -------------- | ---------------------- | -------------------------------------------- |
| `runId`        | string                 | 評価対象の再生ランID                         |
| `startedAt`    | string                 | セッション内で最初の再生開始時刻             |
| `endedAt`      | string \| null         | 最後の履歴確定時刻。再生中は`null`           |
| `isActive`     | bool                   | 現在再生中のランか                           |
| `entryCount`   | number                 | セッション内の確定済み履歴件数               |
| `activePlayMs` | number                 | セッションの実再生時間。再生中は現在値を含む |
| `entries`      | PlaybackHistoryEntry[] | このセッションに属する確定済み履歴           |

### `aggregate`

| フィールド       | 型             | 内容                         |
| ---------------- | -------------- | ---------------------------- |
| `sessionCount`   | number         | 保持中のセッション数         |
| `entryCount`     | number         | 保持中の履歴件数             |
| `activePlayMs`   | number         | 全セッションの実再生時間合計 |
| `firstStartedAt` | string \| null | 保持中の最初の再生開始時刻   |
| `lastEndedAt`    | string \| null | 保持中の最後の履歴確定時刻   |

ホスト側でさらに安全に計算できる共通値が必要になった場合は、作者に同じ集計処理を
書かせるのではなく`session`または`aggregate`へ追加する。

## スクリプトの返り値

スクリプトは1セッションにつき、次のオブジェクトを1件返す。

```python
def render_stats(ctx):
    minutes = ctx["session"]["activePlayMs"] // 60000
    rank = "S" if minutes >= 20 else "A" if minutes >= 10 else "B"

    return {
        "sortValue": minutes,
        "display": {
            "schemaVersion": 1,
            "fallbackText": "今回の安眠度は%sランクでした" % rank,
            "root": {
                "type": "column",
                "style": {
                    "padding": 20,
                    "gap": 12,
                    "backgroundColor": "#241B35",
                    "cornerRadius": 24,
                },
                "children": [
                    {
                        "type": "text",
                        "text": "今回の安眠度",
                        "style": {
                            "fontSize": 14,
                            "color": "#C8B8E8",
                        },
                    },
                    {
                        "type": "text",
                        "spans": [
                            {
                                "text": rank,
                                "style": {
                                    "fontSize": 64,
                                    "fontWeight": 800,
                                    "color": "#D9B7FF",
                                },
                            },
                            {
                                "text": " RANK",
                                "style": {
                                    "fontSize": 20,
                                    "fontWeight": 600,
                                },
                            },
                        ],
                    },
                    {
                        "type": "progress",
                        "value": min(minutes / 30.0, 1.0),
                        "label": "安眠度",
                    },
                ],
            },
        },
        "share": {
            "text": "『雨音シナリオ』で安眠度%sランクでした" % rank,
            "hashtags": ["Yuraive", "雨音ASMR"],
        },
    }
```

| フィールド  | 型              | 必須 | 内容                                           |
| ----------- | --------------- | ---- | ---------------------------------------------- |
| `sortValue` | integer         | 必須 | ホストがセッションを並べ替えるための値         |
| `display`   | DisplayDocument | 必須 | 統計画面内へ描画する宣言的UI                   |
| `share`     | ShareData       | 任意 | 共有ボタンと共有内容。省略時は共有UIを出さない |

`sortValue`は表示文字列から解析しない。負数を許可する符号付き64 bit整数の範囲とし、
範囲外や整数以外はスクリプト結果エラーとする。

## 並べ替え

並べ替えは完全にホスト側で行う。スクリプトは一覧や並び順を返さない。

統計画面では少なくとも次を選択できるようにする。

- 新しい順
- `sortValue`の高い順
- `sortValue`の低い順

`sortValue`が同じ場合は`startedAt`の新しい順、それも同じ場合は`runId`の辞書順で
安定して並べる。初期表示を新しい順とするか数値の高い順とするかは、実際のUIを確認して決める。

## 自由表示用Display DSL

`display`は固定のタイトル、値、説明ではなく、作者がレイアウトと装飾を組み立てられる
宣言的UIツリーとする。HTML、Markdown、Android Composeコードなど、特定ホストに依存する形式は使わない。

```json
{
  "schemaVersion": 1,
  "fallbackText": "今回の安眠度はSランクでした",
  "root": {
    "type": "column",
    "style": {},
    "children": []
  }
}
```

### 初期対応する要素

| 分類       | `type`     | 用途                             |
| ---------- | ---------- | -------------------------------- |
| レイアウト | `column`   | 子を縦に配置                     |
| レイアウト | `row`      | 子を横に配置                     |
| レイアウト | `stack`    | 子を重ねて配置                   |
| レイアウト | `spacer`   | 可変または固定の空白             |
| レイアウト | `divider`  | 区切り線                         |
| 表示       | `text`     | 通常テキストまたはリッチテキスト |
| 表示       | `image`    | Yuraive内の画像アセット          |
| 表示       | `icon`     | ホストが用意するアイコン         |
| 表示       | `surface`  | 背景、枠線、角丸を持つコンテナ   |
| 表示       | `badge`    | 短い補助情報                     |
| 表示       | `progress` | 0から1までの進捗表示             |

`row`、`column`、`stack`、`surface`は`children`を持てる。
スクリプト側ですでに条件分岐できるため、Display DSLには条件式や繰り返し構文を持たせない。

### リッチテキスト

`text`要素は単一の`text`、または複数の`spans`を受け付ける。

```json
{
  "type": "text",
  "spans": [
    { "text": "S", "style": { "fontSize": 64, "fontWeight": 800 } },
    { "text": " RANK", "style": { "fontSize": 20 } }
  ]
}
```

初期版ではspan内のリンク、クリック、任意アクションは許可しない。

### スタイル

初期版では次のスタイルを候補とする。正確な型と適用可能な要素は実装時に別途固定する。

- レイアウト: `width`、`height`、`minHeight`、`aspectRatio`、`padding`、`gap`
- 配置: `horizontalAlignment`、`verticalAlignment`、`textAlign`
- 表面: `backgroundColor`、`borderColor`、`borderWidth`、`cornerRadius`、`opacity`
- 文字: `color`、`fontSize`、`fontWeight`、`lineHeight`、`maxLines`
- Stack用: `align`、`offsetX`、`offsetY`

寸法はホストごとの論理ピクセルとして扱う。`wrap`と`fill`を用意し、画面幅そのものを
スクリプトへ渡さなくてもレスポンシブに表示できるようにする。

### ホストが管理する外側のUI

作者が自由に変更できるのは統計結果の表示領域内だけとする。次はホスト側で描画する。

- 統計画面のタイトル、戻る操作
- セッション日時と再生中表示
- 並べ替えUI
- 共有ボタン
- エラー、読み込み中、空状態
- スクロールと画面端の安全領域

初期版ではDisplay DSLにボタンやリンクを含めない。表示領域からアプリ操作や外部アプリ起動を
行えるようにする場合は、用途と権限を別途設計する。

### 制限とフォールバック

クロスプラットフォームで安定して描画するため、ホストは次を制限する。

- UIノード総数
- ツリーの最大深度
- 文字列、span、子要素の最大数
- フォントサイズ、寸法、余白、オフセットの範囲
- 画像の最大表示サイズ
- 色、数値、列挙値の形式

画像はYuraive内の相対アセットだけを許可し、リモートURL、`file:`、`content:`などは許可しない。
不明な要素や未対応の`schemaVersion`を受け取った場合は、可能であれば`fallbackText`を表示する。
アニメーションは初期版に含めない。

`display.schemaVersion`はYuraive本体のバージョンから独立させ、表示DSLだけを将来拡張できるようにする。

## 共有データ

共有先へ依存しすぎないよう、返り値は`x`ではなく`share`とする。

```json
{
  "text": "『雨音シナリオ』で安眠度Sランクでした",
  "url": "https://example.com/work",
  "hashtags": ["Yuraive", "雨音ASMR"],
  "via": "example_author"
}
```

| フィールド | 型       | 内容                      |
| ---------- | -------- | ------------------------- |
| `text`     | string   | 投稿、共有する本文        |
| `url`      | string   | 作品ページなどのHTTPS URL |
| `hashtags` | string[] | `#`を含まないハッシュタグ |
| `via`      | string   | `@`を含まないXユーザー名  |

`share`が存在し、検証に成功した結果にだけ共有ボタンを表示する。

### 共有フロー

- 共有ボタンを押すまで外部通信や外部アプリ起動を行わない
- 共有前に、実際に渡す本文を確認できるようにする
- X向けは編集可能な投稿コンポーザーを開き、自動投稿しない
- Androidではシステム共有も利用できるようにする
- Xがない環境ではブラウザのX Web Intentへフォールバックできるようにする
- `runId`、ローカルパス、正確な再生時刻などをホストから自動追加しない
- スクリプトからIntent URI、対象パッケージ、任意MIME typeを指定させない

長さ超過を黙って切り捨てず、共有前に警告する。Xでは日本語、絵文字、URLで文字数の扱いが
異なるため、単純な文字列長ではなくX互換の重み付き文字数を使用する。

将来、統計結果を画像として共有する場合は、Display DSLからホストが結果カード画像を生成する。
作者が任意HTMLや描画コードを返す方式にはしない。

## プレイヤーUI

- プレイヤーのLike横にある再生統計アイコンを入口にする
- `playbackStats`がない場合は統計アイコンを表示しない、または無効化する
- 現在のプレイヤーのセッション結果を画面先頭に固定する
- その下にホスト集計の総再生回数、累計実再生時間、最終再生日を表示する
- 残りのセッション結果は「デフォルト（`sortValue`の高い順）」または「新しい順」で並べる
- 各結果の共有UIは`share`がある場合だけ表示する
- 生の再生履歴への導線は統計画面内に置き、統計結果と履歴ログを混在させない

プレイヤー画面へLike、統計、履歴の大きなボタンをすべて並べると窮屈になるため、
履歴は統計画面内の「再生履歴を見る」から開く構成を第一候補とする。

## 評価タイミングとキャッシュ

- 統計画面を開いたときに、保持中の各セッションを評価する
- 再生中セッションは画面を開いた時点のスナップショットで評価する
- 画面表示中に毎秒スクリプトを再実行しない
- 履歴が確定した場合は、該当セッションだけ再評価する
- 同一セッション、同一スクリプト、同一最終履歴IDの結果はキャッシュ可能とする
- スクリプトやYuraiveが更新された場合はキャッシュを破棄して再評価する

統計結果は再生履歴とは別の派生データであり、元のJSONL履歴へ書き込まない。

## エラー処理

1セッションのスクリプトエラーで統計画面全体を失敗させない。

- エラーになったセッションだけ結果を表示しない、または簡潔なエラー表示にする
- 他のセッションの評価と表示は続行する
- タイムアウトは既存のStarlark設定を使用する
- 返り値の型エラーはセッションとフィールド名が分かる形でログへ残す
- `display`だけが無効で`fallbackText`が使える場合はテキスト表示へフォールバックする
- `share`だけが無効な場合は表示を残し、共有ボタンだけを出さない

## エディタ対応

- グラフ設定から`playbackStats`のスクリプトと関数を選択できるようにする
- `ctx["session"]`と`ctx["aggregate"]`を補完と型表示へ追加する
- プレビュー履歴を`runId`でグループ化し、対象セッションを選んでテストできるようにする
- Display DSLのプレビューを統計スクリプト編集画面に表示する
- UIツリー、スタイル、共有データの検証エラーを表示する
- 新規作品の`contentId`にはUUIDを設定し、作者による編集とIDの再発行を扱う
- `contentId`入力欄に`com.example.groupId`形式を推奨する説明を表示する
- 同じ`contentId`を持つ複数のYuraiveを許可し、重複警告を表示しない
