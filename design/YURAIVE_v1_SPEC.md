# Yuraive Content Format v1

Yuraiveは、メディアを再生しながら重み付き有向グラフを遷移するJSON形式です。ノードと
ボタンは独立したグラフオブジェクトであり、トップレベルの別々のマップに保存します。
Starlarkスクリプトによる0秒遷移とボタン表示の上書きも定義します。

配布時はグラフからGUI専用情報を除き、スクリプトとレイアウトを同梱した
[`*.yuraive` Player Bundle](../runtime/BUNDLE_FORMAT.md)も利用できます。

## 1. コンテンツとパス

Yuraiveファイルの親フォルダをコンテンツルートとします。メディア、字幕、レイアウト、ボタン背景画像は
すべてYuraiveファイルからの相対パスで参照します。

```text
content/
├── graph.yuraive.json
├── audio/
│   └── voice.ogg
├── images/
│   └── background.png
├── scripts/
│   ├── route.star
│   └── button.star
└── ui/
    ├── default.yuraive-layout.html
    └── continue.png
```

パス区切りは`/`です。メディアとスクリプトのどちらも、Yuraiveファイルからの
相対パスで参照します。絶対パス、外部URL、コンテンツルート外へ出る`..`参照は
禁止します。Starlarkファイルの拡張子は`.star`、ボタンレイアウトの拡張子は
`.yuraive-layout.html`です。どちらもUTF-8で保存します。

## 2. グラフ全体

```json
{
  "version": 1,
  "metadata": {
    "contentId": "com.example.rain_asmr",
    "displayName": "雨音シナリオ",
    "description": "就寝用の分岐コンテンツ",
    "author": "Hiro",
    "thumbnail": "images/cover.webp",
    "socialLinks": [
      { "label": "Web", "url": "https://example.com/hiro" }
    ],
    "createdAt": "2026-07-13T12:00:00+09:00",
    "updatedAt": "2026-07-13T15:30:00+09:00",
    "tags": ["ASMR", "睡眠"]
  },
  "nodes": {},
  "buttons": {},
  "globalPlayerControl": "default",
  "playbackStats": {
    "path": "scripts/playback_stats.star",
    "function": "render_stats"
  },
  "playerControls": {
    "default": {
      "accentColor": "#574de5",
      "layout": "ui/default.yuraive-layout.html",
      "allowStop": true,
      "showSeekBar": true,
      "showPlaybackTime": true,
      "allowSeek": true,
      "showSceneName": true,
      "showFileName": false,
      "allowNext": false,
      "allowPrevious": false
    }
  },
  "editor": {
    "layouts": {
      "ui/default.yuraive-layout.html": {
        "x": 120,
        "y": 20,
        "color": "#4d8e9f"
      }
    }
  }
}
```

| フィールド | 内容 |
| --- | --- |
| `version` | 形式バージョン。v1では`1` |
| `metadata` | 作品の表示名や作者などの任意メタデータ |
| `nodes` | ノードIDをキーとするノードマップ |
| `buttons` | ボタンIDをキーとする独立ボタンマップ |
| `playerControls` | 設定IDをキーとする再生コントロール設定マップ |
| `globalPlayerControl` | 個別設定のないMedia Nodeに適用する任意の設定ID |
| `playbackStats` | セッション単位の再生統計を生成する任意の`ScriptCall` |
| `editor` | GUI専用情報。レイアウトファイルノードの座標と色を含む |

`version`、`nodes`、`buttons`、`playerControls`は必須、`metadata`、`globalPlayerControl`、`playbackStats`、`editor`は任意です。
`playerControls`は空のオブジェクトでも構いません。IDはそれぞれのマップ内で一意に
します。旧式のノード内埋め込みボタン配列は読み込みません。本仕様の追加項目は
Yuraive v1内で定義し、`version`は`1`のままです。

### 2.1 メタデータ

`metadata`自体とその全フィールドは任意です。空文字列や空のタグは保存せず、値のない
フィールドを省略します。メタデータは再生や遷移の結果に影響しません。

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `contentId` | string | ファイル位置に依存しない作品・作品グループID |
| `displayName` | string | 作品の表示名 |
| `description` | string | 作品の説明 |
| `author` | string | 作者名または作者表記 |
| `thumbnail` | string | ライブラリ表示に使う任意のサムネイル画像。Yuraiveファイルからの相対パス |
| `socialLinks` | `{label: string, url: string}[]` | 作品情報に表示する外部リンク。URLは`http`または`https` |
| `createdAt` | string | 作成日時。RFC 3339形式 |
| `updatedAt` | string | 更新日時。RFC 3339形式 |
| `tags` | string[] | 検索や分類に使う文字列の配列 |

新規作品ではエディタが`metadata.contentId`へUUIDを発行します。作者が管理しやすい
`com.example.groupId`形式を推奨しますが、UUIDや別形式も有効です。同じ`contentId`を持つ
複数のYuraiveは同じ作品グループとして履歴と統計を集計し、重複警告は出しません。移動、名前変更、
複製、通常保存では自動変更しません。別の統計へ分離するときだけ作者が変更または再発行します。
`contentId`のない既存作品は`graphId`へフォールバックします。

## 3. ノード

```json
{
  "type": "media",
  "start": false,
  "terminal": false,
  "media": [],
  "onEnd": [],
  "buttons": ["continue-button"],
  "playerControl": "cinematic",
  "editor": {
    "x": 100,
    "y": 200,
    "label": "Scene",
    "color": "#446688"
  }
}
```

| フィールド | 内容 |
| --- | --- |
| `type` | `media`または`script`。ノードの種類 |
| `start` | 再生開始位置。グラフ全体で必ず1件 |
| `terminal` | このノードで再生を終了する |
| `script` | Script Nodeが実行する`ScriptCall` |
| `media` | 進入時に抽選するメディア候補 |
| `onEnd` | メディア終了時、または即時遷移時の遷移候補 |
| `buttons` | このノードで有効になるトップレベルボタンIDの配列 |
| `playerControl` | このMedia Nodeに個別適用する再生コントロール設定ID |
| `editor` | GUI専用の位置、表示名、色 |

`type`は必須です。`media`、`buttons`、`playerControl`はMedia Nodeでのみ使用し、`script`はScript Nodeでのみ
使用します。`buttons`はボタン本体ではなく参照です。同じボタンIDを複数ノードから参照でき、その場合も
ボタンの対象slot・個別外観・押下時遷移は1つの定義を共有します。同一ノード内で同じIDを重複
指定してはいけません。

`terminal: true`のノードは`onEnd`と`buttons`を持てません。開始ノードは入力遷移を持たず、
終端ノードは出力遷移を持ちません。

### 3.1 Script Node

Script Nodeは、メディアを再生せずStarlarkを1回実行し、戻り値で次のノードを決定する
0秒の制御ノードです。Media Nodeまたはボタンから通常の遷移先として指定できます。

```json
{
  "type": "script",
  "start": false,
  "script": {
    "path": "scripts/route.star",
    "function": "jump"
  },
  "onEnd": [
    { "to": "quiet", "weight": 1 },
    { "to": "intense", "weight": 1 }
  ],
  "editor": {
    "x": 300,
    "y": 200,
    "label": "Route"
  }
}
```

`script.path`と1件以上の`onEnd`が必須です。`script.function`を省略すると`jump`を呼び出します。
`jump(ctx)`はNode IDの文字列または`None`を返します。文字列は実在し、かつそのScript Nodeの
`onEnd`に含まれるノードIDでなければなりません。`None`のときは`onEnd`を重み付き抽選します。

Script Nodeに`media`、`buttons`は指定できず、`terminal: true`にもできません。Script Nodeへの進入は
メディア再生履歴を生成しません。連続Script Nodeの循環はプレイヤー側で検出し、停止します。

## 4. メディア候補と重み

Media Nodeに入ると、`media`から`weight`に応じて1件を選択します。

```json
{
  "id": "voice-a",
  "weight": 2,
  "source": {
    "type": "audioImage",
    "audio": "audio/voice-a.ogg",
    "image": "images/background.png",
    "volume": 1,
    "loop": false,
    "fit": "cover"
  }
}
```

重みは比率で、合計を100にする必要はありません。0の候補は選択されません。

### 4.1 音声

```json
{
  "type": "audio",
  "audio": "audio/voice.ogg",
  "visual": "keep",
  "volume": 1,
  "loop": false,
  "subtitle": "subtitles/voice.vtt"
}
```

`visual`は`keep`または`clear`です。音声終了をメディア終了として扱います。

### 4.2 音声と画像

```json
{
  "type": "audioImage",
  "audio": "audio/voice.ogg",
  "image": "images/background.png",
  "fit": "cover",
  "imageTransition": {
    "type": "crossfade",
    "durationMs": 1000
  }
}
```

### 4.3 動画

```json
{
  "type": "video",
  "video": "video/movie.mp4",
  "subtitle": "subtitles/movie.vtt",
  "volume": 1,
  "loop": false,
  "fit": "contain"
}
```

`fit`は`contain`、`cover`、`stretch`です。字幕はUTF-8のWebVTTを使用します。

## 5. 再生終了時の遷移

```json
{
  "onEnd": [
    { "to": "next-a", "weight": 30 },
    { "to": "next-b", "weight": 70 }
  ]
}
```

`to`はノードIDです。遷移先が1件だけの場合は`weight: 1`とします。

## 6. 独立ボタン

ボタンはトップレベルの`buttons`マップに定義します。マップのキーがボタンIDであり、
ボタン本体に`id`フィールドは持ちません。

```json
{
  "buttons": {
    "continue-button": {
      "visibility": [
        { "fromMs": 3000, "toMs": null }
      ],
      "targetSlot": "actions",
      "order": 10,
      "zIndex": 2,
      "text": "Continue",
      "style": {
        "backgroundColor": "#333333",
        "backgroundImage": "ui/continue.png",
        "textColor": "#ffffff",
        "opacity": 1,
        "borderColor": "#ffffff",
        "borderWidth": 1,
        "borderRadius": 8,
        "fontSize": 16,
        "fontWeight": 600,
        "paddingHorizontal": 20,
        "paddingVertical": 12
      },
      "render": {
        "path": "scripts/button.star",
        "function": "render"
      },
      "onPress": [
        { "to": "next", "weight": 1 }
      ],
      "editor": {
        "x": 420,
        "y": 340,
        "color": "#8b6fa3"
      }
    }
  }
}
```

| フィールド | 内容 |
| --- | --- |
| `visibility` | 現在ノード開始からの表示区間 |
| `targetSlot` | 注入先slotの`name`または`id`。省略時はデフォルトslot |
| `order` | slot内の注入順を決める整数。省略時`0` |
| `zIndex` | 注入したボタンのCSS `z-index`。省略時`0` |
| `text` | ボタンの表示文字列。省略時はボタンID |
| `style` | ボタン個別のインラインスタイル。省略した値はレイアウトCSSへ委ねる |
| `render` | 表示可否、テキスト、個別スタイルを上書きする`ScriptCall` |
| `onPress` | 押下時の重み付きノード遷移 |
| `editor` | GUI上の自由配置位置と線の色 |

### 6.1 ノードとの関連

ノードの`buttons`にIDが含まれる間、そのボタンを現在ノードのボタンとして表示します。
トップレベルに存在しても、現在ノードから参照されていないボタンは表示しません。

未接続ボタンは編集途中の状態として許可します。プレイヤーでは使用されず、エディタは警告を
表示します。ボタンを削除した場合、全ノードの参照からも同時に削除します。

### 6.2 表示タイミング

`visibility`の`fromMs`と`toMs`は、ボタンを参照している現在ノードへ入った時点からの
相対時間です。`toMs: null`はノードを離れるまでを表します。省略時は常時表示です。

同じボタンを複数ノードが共有する場合、各ノードへ入るたびにタイマーを0から開始します。

### 6.3 slotへの注入と個別スタイル

ボタンの位置とサイズはボタン自身ではなく、適用中の`.yuraive-layout.html`とそのslotが決めます。
プレイヤーは表示対象ボタンを`order`の昇順で安定ソートし、`targetSlot`が一致するslotへ
`<button type="button" class="yuraive-button">`として追加します。同じ`order`ならMedia Nodeの
`buttons`配列順を維持します。`targetSlot`を省略したボタンは、`name`と`id`のないデフォルトslotへ
追加します。対象slotがない定義は検証エラーです。実行時に不正な定義を受け取った場合だけ、
プレイヤーはデフォルトslotへフォールバックします。

`order`はDOMへの注入順とCSS Grid/Flexの`order`、`zIndex`はCSS `z-index`へ反映します。
注入順と重なり順は別の値です。プレイヤーはボタンへ位置、サイズ、色、余白、角丸などの
外観既定値を補いません。強制するのは既存の要素スタイルを消す`all: unset`と
`box-sizing: border-box`だけです。そのため、レイアウトCSSの`.yuraive-button`またはボタンの`style`で
必要な外観を明示しなければ、装飾のないボタンになります。

`style`の対応フィールドは次のとおりです。数値の長さはCSS pxへ変換します。個別スタイルは
インラインスタイルなので、同じプロパティのレイアウトCSSより優先します。

| フィールド | 型 | CSSへの反映 |
| --- | --- | --- |
| `backgroundColor` | string | `background-color` |
| `backgroundImage` | string | コンテンツ内画像を`background-image`として表示 |
| `textColor` | string | `color` |
| `opacity` | number | `opacity`。0〜1 |
| `borderColor` | string | `border-color` |
| `borderWidth` | number | `border-width`と`solid` |
| `borderRadius` | number | `border-radius` |
| `fontSize` | number | `font-size` |
| `fontWeight` | integer | `font-weight` |
| `paddingHorizontal` | number | 左右`padding` |
| `paddingVertical` | number | 上下`padding` |

### 6.4 押下時遷移

ボタンが押されると、そのボタンの`onPress`だけを使って遷移先を抽選します。遷移確定後は
現在メディアを停止し、現在ノードのボタンを消して次ノードへ進みます。

### 6.5 表示スクリプト

`render` がある場合、ボタン表示時にStarlarkを1回呼び出します。`render.function`を省略すると
`render`を呼び出します。戻り値は次のフィールドを任意に含むマップです。

```python
def render(ctx):
    return {
        "visible": True,
        "text": "続ける",
        "style": {
            "backgroundColor": "#355070",
            "backgroundImage": "ui/continue.png",
            "textColor": "#ffffff",
            "opacity": 1.0,
            "borderColor": "#ffffff",
            "borderWidth": 1,
            "borderRadius": 8,
            "fontSize": 16,
            "fontWeight": 600,
            "paddingHorizontal": 20,
            "paddingVertical": 12,
        },
    }
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `visible` | boolean | `false`ならボタンを表示しない |
| `text` | string | ボタン本体の`text`を上書きする文字列 |
| `style` | object | ボタン本体の`style`と同じフィールドの部分上書き |

戻されなかった値はボタン本体の`text`と`style`を使います。表示スクリプトから
`targetSlot`、`order`、`zIndex`、レイアウト構造は変更できません。表示スクリプトの
`ctx["now"]`は呼び出し時点のスナップショットです。時刻の経過だけを理由に自動再評価はしません。
表示内容を更新する場合は、プレイヤーが定める再評価タイミングで再実行します。

### 6.6 レイアウトファイル

ボタンレイアウトは独立したUTF-8の`.yuraive-layout.html`ファイルです。JavaScriptを持たない小さな
HTML/CSSフラグメントとして、複数の`div`と`slot`、およびそれらのCSS Gridレイアウトを定義します。

```html
<style>
.stage {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  padding: clamp(16px, 4cqw, 32px);
  pointer-events: none;
}

slot[name="actions"] {
  display: grid;
  grid-row: 2;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(8px, 2cqw, 16px);
  pointer-events: auto;
}

slot:not([name]):not([id]) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.yuraive-button {
  display: grid;
  place-items: center;
  min-height: 52px;
  padding: 12px 20px;
  border: 0;
  border-radius: 18px;
  background: #574de5;
  color: #ffffff;
  font: 600 16px/1.3 system-ui, sans-serif;
  text-align: center;
  pointer-events: auto;
}

@container yuraive-canvas (max-width: 420px) {
  slot[name="actions"] { grid-template-columns: 1fr; }
}
</style>

<div class="stage">
  <slot name="actions"></slot>
  <slot></slot>
</div>
```

許可する要素は`style`、`div`、`slot`です。`div`と`slot`で許可する属性は`class`、`id`、
`name`、`style`、`role`、`aria-label`です。それ以外の要素と属性は除去します。`script`、イベント属性、
外部フレーム、外部CSS、外部URLの読み込みは禁止します。レイアウトには`name`または`id`を持たない
デフォルトslotをちょうど1件含め、slot識別子はファイル内で重複させません。名前付きslotは
`<slot name="actions">`と`<slot id="actions">`のどちらでも定義でき、`name`が優先されます。

互換対象のCSSは次のサブセットです。

- CSS Grid: `display`、`grid-template*`、`grid-area`、`grid-column`、`grid-row`、`gap`、配置系プロパティ
- 配置と積層: `position`、`inset`、`top/right/bottom/left`、`order`、`z-index`
- サイズ: `width/height`、`min-*`、`max-*`、`padding`、`margin`、`overflow`、`box-sizing`
- 外観: `background*`、`color`、`opacity`、`border*`、`box-shadow`、`filter`、`transform`
- 文字: `font*`、`line-height`、`letter-spacing`、`text-align`、`white-space`、`text-overflow`
- レスポンシブ: `container`、`container-type`、`container-name`、`@container`

値には`px`、`%`、`fr`、`cqw`、`cqh`と`calc()`、`min()`、`max()`、`clamp()`を使用できます。
この一覧外のCSSはWeb実装で偶然動作しても互換性を保証しません。プレイヤーはレイアウトのルートを
`yuraive-canvas`というsize containerにし、次のCSSカスタムプロパティを注入します。

| 変数 | 内容 |
| --- | --- |
| `--yuraive-canvas-width` / `--yuraive-canvas-height` | ボタン描画領域のCSS pxサイズ |
| `--yuraive-safe-top/right/bottom/left` | 描画領域内の安全余白。CSS px |
| `--yuraive-density` | 端末のdevice pixel ratio |
| `--yuraive-font-scale` | プレイヤーが使用する文字倍率 |

レイアウトは端末サイズや向きが変わるたびに再計算します。エディタはレイアウト専用タブでコード編集、
390×390のライブプレビュー、slot一覧、対応要素・属性・CSS・Canvas変数を表示します。新規作成時は
上記相当の明示的な既定レイアウトをファイルへ書き込みます。この既定値はプレイヤー内蔵の暗黙値ではなく、
作者が自由に削除・変更できる通常のレイアウトファイルです。

## 7. 再生コントロール設定

再生画面の可視要素と許可操作は、トップレベルの`playerControls`に独立した設定として定義します。
マップのキーが設定IDです。Media Nodeの`playerControl`が最優先で、未指定なら
`globalPlayerControl`、それも未指定または参照不能なら次の既定値を使用します。

```json
{
  "globalPlayerControl": "default",
  "playerControls": {
    "default": {
      "layout": "ui/default.yuraive-layout.html",
      "allowStop": true,
      "showSeekBar": true,
      "showPlaybackTime": true,
      "allowSeek": true,
      "showSceneName": true,
      "showFileName": false,
      "allowNext": false,
      "allowPrevious": false,
      "editor": { "x": 120, "y": 40, "color": "#4f8c78" }
    }
  }
}
```

| フィールド | 既定値 | 内容 |
| --- | --- | --- |
| `accentColor` | アプリ設定 | プレイヤーUIのアクセント色。任意の`#RRGGBB` |
| `layout` | なし | ボタン描画に使う`.yuraive-layout.html`の相対パス |
| `allowStop` | `true` | 再生セッションを停止できる。停止時は復元情報を削除し、そのセッションは再開不能になる |
| `showSeekBar` | `true` | シークバーを表示する。`showPlaybackTime: false`なら割合だけを示す |
| `showPlaybackTime` | `true` | 現在位置と総再生時間を表示する |
| `allowSeek` | `true` | シーク操作を受け付ける。`false`では表示中のシークバーも操作不能になる |
| `showSceneName` | `true` | `node.editor.label`、なければNode IDを表示する |
| `showFileName` | `false` | 再生中ソースのファイル名を表示する |
| `allowNext` | `false` | 「次へ」を表示・許可する |
| `allowPrevious` | `false` | 「前へ」を表示・許可する |
| `editor` | — | GUI上の自由配置位置と線の色。再生には影響しない |

ボタンを1件以上参照するMedia Nodeでは、`playerControl`または`globalPlayerControl`から解決した
再生コントロール設定に`layout`が必須です。参照先が存在しない、拡張子が異なる、デフォルトslotがない、
またはボタンの`targetSlot`が存在しない場合は検証エラーです。ボタンのないノードでは`layout`を省略できます。

`accentColor`はアルファなしの`#RRGGBB`だけを許可します。操作要素が背景へ溶け込むのを防ぐため、
sRGB相対輝度が`0.08`未満または`0.90`を超える、黒・白に近すぎる色は検証エラーにします。
利用者の「すべて表示・許可」設定で操作制限を上書きした場合も、作品のアクセント色と`layout`は維持します。

「次へ」は現在メディアを`endReason: "completed"`として確定し、自然終了時と同じ`onEnd`抽選を
直ちに行います。終端ノードではグラフを完了します。「前へ」は現在ノードの未確定再生を破棄し、
同じrunの直前の確定履歴へ戻ります。戻り先と、すでに確定済みなら現在ノードの履歴も削除してから、
戻り先で当時と同じメディアIDを新しい再生として開始します。

プレイヤー実装は、利用者向け設定としてJSONを無視して全コントロールを表示・許可する上書きを
提供できます。この上書きはコンテンツJSON自体を書き換えません。作品タイトルは
`metadata.displayName`を使用し、未指定時はYuraiveファイルの親フォルダ名へフォールバックします。
説明、作者、`socialLinks`はタイトル横の作品情報UIから表示します。

## 8. 空ノード

`media`が空で、有効なボタン参照もないMedia Nodeは、進入直後に`onEnd`を抽選します。空ノードが
連続する場合は、メディア、ボタン、終端のいずれかを持つノードまで進みます。

`media`が空でも、有効なボタン参照が1件以上あればボタン入力待ちになります。

空ノードだけの閉じたループは実行不能です。プレイヤーは循環を検出して停止し、エディタは
警告対象にできます。

## 9. 終端

Media Nodeの`terminal: true`では、メディアがあれば最後まで再生して終了し、なければ進入直後に終了します。
`onEnd`とボタン参照は指定できません。終了しなくなるためメディアの`loop: true`も禁止します。

## 10. 同時イベント

ボタン操作とメディア終了がほぼ同時に発生した場合、プレイヤーが先に受理した方を使用します。
一度遷移が確定した後のイベントは無視します。

## 11. 抽選方法

メディア候補、`onEnd`、`onPress`は同じ方法で抽選します。

```text
1. weightが0より大きい候補を集める
2. weightの合計を求める
3. 0以上、合計未満の乱数を作る
4. 先頭から重みを累積し、乱数が累積値を下回った候補を選ぶ
```

## 12. GUIエディタ情報

ノード、ボタン、再生コントロール設定、およびグラフ直下の`editor`は再生に影響しません。
`editor.layouts`はレイアウトの相対パスをキー、`{x, y, color}`を値とするマップです。
エディタは次の5種類の線を表示します。

- ノード右側からノード左側への`onEnd`
- Media Node下部中央からボタン上部中央へのボタン参照
- ボタン右側からノード左側への`onPress`
- Media Node上部中央から再生設定下部中央への`playerControl`
- レイアウトノード下部中央から再生設定上部中央への`playerControls.*.layout`

`.yuraive-layout.html`はファイルを表すレイアウトノードとしてグラフへ配置できます。グラフツールバーの
「レイアウト」、グラフ背景の右クリックメニュー、またはファイルツリーからキャンバスへのドラッグ＆
ドロップで配置します。同じパスのノードはグラフ内に1件だけ配置でき、再配置操作は既存ノードを移動します。
レイアウトノードの下部ポートから再生設定ノード上部中央のポートへ接続すると、その設定の`layout`へ
相対パスを保存します。1つのレイアウトノードを複数の再生設定へ接続できます。接続済みポートまたは線を
クリック・右クリックすると解除できます。ファイルツリーから再生設定上部ポートへの直接ドロップと、
インスペクターの選択欄も同じ接続を作成します。

レイアウトノードをグラフから取り除くと、そのファイル自体は削除せず、そのレイアウトを参照する再生設定の
接続を解除します。ファイル名変更・移動時は`playerControls.*.layout`と`editor.layouts`のキーを追従更新します。

ノード、ボタン、再生設定は独立して自由に移動できます。再生設定は対象Media Nodeより上への配置を
基本とします。線上には同じ遷移集合内の重み、または計算した確率を表示できます。
ボタン参照線と再生設定線には重みを持ちません。1つのMedia Nodeから接続できる再生設定は1件です。

## 13. Starlarkと再生履歴

### 13.1 ScriptCall

Script Nodeの`script`とボタンの`render`は同じ`ScriptCall`形式を使います。

```json
{
  "path": "scripts/route.star",
  "function": "jump"
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `path` | string | Yuraiveファイルからの相対`.star`パス。必須 |
| `function` | string | 呼び出す関数名。任意 |

`function`の既定値はScript Nodeで`jump`、ボタンで`render`、再生統計で`render_stats`です。いずれの関数も1個の
引数`ctx`を受け取ります。

### 13.2 `ctx`コンテキスト

Starlarkに渡す`ctx`はJSON互換のマップです。すべての時刻はRFC 3339文字列、すべての
時間量は非負のミリ秒です。

```json
{
  "now": "2026-07-13T12:05:10.250Z",
  "graphId": "graph.yuraive.json",
  "runId": "2d56f9e8-1e7b-46aa-a937-f8e2f60ab715",
  "runStartedAt": "2026-07-13T12:00:00.000Z",
  "historyStartedAt": null,
  "historyEndedAt": null,
  "historyCount": 0,
  "historyActivePlayMs": 0,
  "totalActivePlayMs": 18500,
  "history": [],
  "currentHistory": [],
  "current": {
    "nodeId": "choice",
    "mediaId": "voice",
    "source": "audio/voice.ogg",
    "startedAt": "2026-07-13T12:04:51.000Z",
    "positionMs": 21300,
    "mediaDurationMs": 60000,
    "activePlayMs": 18500
  },
  "trigger": {
    "type": "render",
    "buttonId": "finish"
  }
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `now` | string | コンテキスト生成時点の現在時刻 |
| `graphId` | string | 再生中のグラフ識別子。通常はコンテンツルート内のYuraiveパス |
| `runId` | string | 現在の再生ランを識別する一意なID |
| `runStartedAt` | string | 現在の再生ラン開始時刻。リスタート時に更新 |
| `historyStartedAt` | string \| null | 保持中の確定履歴の最初の`startedAt`。履歴がなければ`null` |
| `historyEndedAt` | string \| null | 保持中の確定履歴の最後の`endedAt`。履歴がなければ`null` |
| `historyCount` | number | `history`の件数 |
| `historyActivePlayMs` | number | 確定済み`history[].activePlayMs`の合計 |
| `totalActivePlayMs` | number | `historyActivePlayMs`と履歴へ未確定の`current.activePlayMs`の合計 |
| `history` | PlaybackHistoryEntry[] | 保持中の確定済み再生履歴。最大1000件を全件渡す |
| `currentHistory` | PlaybackHistoryEntry[] | `history`のうち`runId`が現在の`ctx.runId`と一致する確定履歴 |
| `current` | object \| null | 現在または直前のMedia Nodeとメディア。未再生なら`null` |
| `trigger` | object | 実行契機。`type`と契機ごとのIDを持つ |

`current`は次の型です。Script Node実行中はその0秒ノードではなく、遷移直前のMedia Nodeを
参照することがあります。Media Nodeにメディアがない場合、`mediaId`、`source`、`startedAt`は
`null`になり、再生時間系の値は`0`になります。

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `nodeId` | string | 現在ノードID |
| `mediaId` | string \| null | 抽選されたメディアID |
| `source` | string \| null | 再生中メディアの相対パス |
| `startedAt` | string \| null | 現在メディアの再生セッション開始時刻 |
| `positionMs` | number | 現在のメディア位置。シークにより前後する |
| `mediaDurationMs` | number | メディア全体の長さ |
| `activePlayMs` | number | pause中を除いて実際に再生した時間の現在値 |

`historyActivePlayMs`は確定履歴だけの値です。`totalActivePlayMs`は実行中でまだ履歴へ確定して
いないメディアを含むため、その`current.activePlayMs`だけ大きくなります。遷移直後のScript Nodeでは、
直前に確定したメディアを`current`として参照できる場合がありますが、同じ時間を二重には加算しません。

`currentHistory`は`history`内の同じ履歴要素への参照だけを持つリストとして共通Starlarkランタイムが
生成します。履歴エントリ本体を複製しないため、追加メモリはリストの参照分だけです。未確定の`current`は
含みません。別作品を経由した後や再生終了後に同じ作品を開いた場合は新しい`runId`になるため、開始時は
空のリストになります。

### 13.3 `trigger`の型

| `type` | 追加フィールド | 実行契機 |
| --- | --- | --- |
| `start` | `scriptNodeId`（Script Node実行時） | 開始ノードからの初回進入 |
| `restart` | `scriptNodeId`（Script Node実行時） | 最初から再生し直した |
| `end` | `scriptNodeId`（Script Node実行時） | メディアが自然終了して遷移した |
| `next` | `scriptNodeId`（Script Node実行時） | 「次へ」で現在メディアをEnd扱いにして遷移した |
| `previous` | `scriptNodeId`（Script Node実行時） | 「前へ」で直前の履歴へ戻った |
| `button` | `buttonId`、`scriptNodeId`（Script Node実行時） | ボタン押下で遷移した |
| `empty` | `scriptNodeId`（Script Node実行時） | 空のMedia Nodeから即時遷移した |
| `render` | `buttonId` | ボタンの表示スクリプトを実行した |
| `test` | なし | エディタから明示的にテスト実行した |
| `debug` | なし | デバッグ用のコンテキスト表示を生成した |
| `stats` | `runId` | 1セッション分の再生統計を生成した |

`scriptNodeId`は`jump(ctx)`を実行するScript NodeのIDです。ボタンからScript Nodeへ遷移した
場合の`trigger`は`type: "button"`、`buttonId`、`scriptNodeId`をすべて持ちます。

### 13.4 PlaybackHistoryEntry

履歴はメディア再生が確定終了するたびに1件生成します。Script Nodeと空ノードの0秒遷移は
履歴を生成しません。

```json
{
  "schemaVersion": 1,
  "id": "f149aeba-e049-4221-82d6-73bef6e60f2c",
  "runId": "2d56f9e8-1e7b-46aa-a937-f8e2f60ab715",
  "graphId": "graph.yuraive.json",
  "contentId": "com.example.rain_asmr",
  "nodeId": "choice",
  "mediaId": "voice",
  "source": "audio/voice.ogg",
  "startedAt": "2026-07-13T12:00:01.000Z",
  "endedAt": "2026-07-13T12:01:02.000Z",
  "mediaDurationMs": 60000,
  "activePlayMs": 55800,
  "startPositionMs": 0,
  "endPositionMs": 60000,
  "endReason": "completed"
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `schemaVersion` | `1` | 履歴レコードのスキーマバージョン |
| `id` | string | 履歴レコードの一意なID |
| `runId` | string | この再生が属するランID |
| `graphId` | string | 再生したグラフ識別子 |
| `contentId` | string \| 省略 | 再生時の`metadata.contentId`。未定義の旧作品では省略 |
| `nodeId` | string | 再生したMedia NodeのID |
| `mediaId` | string | 再生したメディア候補のID |
| `source` | string \| null | 再生した音声または動画の相対パス。特定できなければ`null` |
| `startedAt` | string | 再生セッションの開始時刻 |
| `endedAt` | string | 再生セッションの終了確定時刻 |
| `mediaDurationMs` | number | メディア全体の長さ |
| `activePlayMs` | number | pause中を除いて実際に再生した累積時間 |
| `startPositionMs` | number | 再生セッション開始時のメディア位置 |
| `endPositionMs` | number | 履歴確定時のメディア位置 |
| `endReason` | string | `completed`、`button`、`stopped`、`restarted`、`error`、`interrupted`のいずれか |

`endReason`は、自然終了、ボタン押下、明示停止、リスタート、再生エラー、外部要因による中断の順に
対応します。履歴は状態遷移ログではなくメディア再生ログのため、`transition_to`フィールドは
持ちません。

### 13.5 保持とJSONL

履歴の交換形式はJSON Lines（JSONL）で、1行に1件の`PlaybackHistoryEntry`をUTF-8で記録します。
Web、Android、Windowsは同じレコード形式を使い、具体的な保存先と書き込み方法はそれぞれの
ホスト実装が担当します。保持上限は1000件で、`ctx["history"]`には保持中の全件を渡し、
`ctx["currentHistory"]`には現在の`runId`に属する確定履歴だけを渡します。
Webエディタのプレビューでは履歴をプレビュー内のメモリにのみ保持し、必要に応じてJSONLへ
エクスポートできます。

シークごとに履歴を追加しません。`activePlayMs`はplayとpauseの時刻から実再生時間を累積し、
`positionMs`、`startPositionMs`、`endPositionMs`との差からシークを含む再生位置の飛びを判断できるようにします。

### 13.6 乱数組み込み

共通Starlarkランタイムは次の乱数関数をグローバルに提供します。暗号用途には使用しません。

| 関数 | 戻り値 |
| --- | --- |
| `random()` | `0.0`以上`1.0`未満の一様な浮動小数点数 |
| `randint(start, end)` | `start`と`end`の両端を含む一様な整数。`start <= end`が必要 |
| `choice(items)` | 空でないlistまたはtupleから一様に選んだ1要素 |
| `shuffled(items)` | 入力を変更せず、シャッフルした新しいlist |

空の`choice`や逆転した`randint`はスクリプトエラーです。Android、Windows、Webエディタは同じRust実装を使います。

## 14. 再生統計

トップレベルの任意`playbackStats`は既存の`ScriptCall`と同じ形式です。

```json
{
  "playbackStats": {
    "path": "scripts/playback_stats.star",
    "function": "render_stats"
  }
}
```

`path`は安全な相対`.star`パスで必須、`function`の既定値は`render_stats`です。
未定義の作品ではプレイヤーの統計入口を無効化します。再生統計は生ログを表示する再生履歴とは
独立した派生表示であり、結果を履歴JSONLへ書き込みません。

### 14.1 セッションの生成とコンテキスト

ホストは`contentId`（未定義なら`graphId`）が一致する保持履歴を`runId`でグループ化し、各グループを
`startedAt`順に並べます。再生中ランも1セッションとし、確定履歴へ未確定の
`current.activePlayMs`を一度だけ加算します。ホストは各セッションにつき`render_stats(ctx)`を1回呼び、
抽出、基本集計、結果検証、並べ替え、エラー分離を担当します。

通常コンテキストに次の`session`と`aggregate`を追加し、`trigger`は
`{"type":"stats","runId":"..."}`とします。`history`には同じ作品グループの保持履歴全件を渡し、
`currentHistory`には評価対象セッションと同じ`runId`の確定履歴を渡します。

| `session`フィールド | 型 | 内容 |
| --- | --- | --- |
| `runId` | string | 評価対象ランID |
| `startedAt` | string | セッション最初の開始時刻 |
| `endedAt` | string \| null | 最後の確定終了時刻。再生中は`null` |
| `isActive` | boolean | 現在再生中のランか |
| `entryCount` | number | 確定済み履歴件数 |
| `activePlayMs` | number | 未確定の現在値を含む実再生時間 |
| `entries` | PlaybackHistoryEntry[] | このランの確定履歴 |

| `aggregate`フィールド | 型 | 内容 |
| --- | --- | --- |
| `sessionCount` | number | 保持中セッション数 |
| `entryCount` | number | 保持中履歴件数 |
| `activePlayMs` | number | 全セッションの実再生時間合計 |
| `firstStartedAt` | string \| null | 最初の開始時刻 |
| `lastEndedAt` | string \| null | 最後の確定終了時刻 |

### 14.2 戻り値と並べ替え

```python
def render_stats(ctx):
    minutes = ctx["session"]["activePlayMs"] // 60000
    return {
        "sortValue": minutes,
        "display": {
            "schemaVersion": 1,
            "fallbackText": "%s分再生" % minutes,
            "root": {"type": "text", "text": "%s分再生" % minutes},
        },
        "share": {"text": "ASMRを%s分再生しました" % minutes, "hashtags": ["Yuraive"]},
    }
```

| フィールド | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `sortValue` | signed 64 bit integer | 必須 | ホストの数値並べ替え値 |
| `display` | DisplayDocument | 必須 | 作者定義の宣言的UI |
| `share` | ShareData | 任意 | 検証成功時だけ共有UIを表示 |

ホストは「デフォルト」と「新しい順」を提供します。デフォルトは`sortValue`の高い順です。同値時は
`startedAt`の新しい順、さらに同じなら`runId`の辞書順です。現在のプレイヤーのセッションは並べ替えの
対象外として画面先頭に固定します。

### 14.3 Display DSL v1

`DisplayDocument`は`schemaVersion: 1`、必須の`fallbackText`、必須の`root`を持ちます。
HTML、Markdown、Composeコード、任意アクションは受け付けません。

| `type` | 必須・任意データ |
| --- | --- |
| `column` / `row` / `stack` / `surface` | 任意の`children`（最大32件） |
| `text` | `text`または`spans`のどちらか一方 |
| `image` | Yuraive内の安全な相対パス`source` |
| `icon` | `play`、`history`、`timer`、`star`、`favorite`、`sleep`、`trophy`、`stats` |
| `badge` | `text` |
| `progress` | 0〜1の`value`、任意の`label` |
| `spacer` / `divider` | 任意の`style` |

共通`style`は`width`、`height`（数値、`wrap`、`fill`）、`minHeight`、`aspectRatio`、`padding`、
`gap`、`horizontalAlignment`、`verticalAlignment`、`textAlign`、`backgroundColor`、`borderColor`、
`borderWidth`、`cornerRadius`、`opacity`、`color`、`fontSize`、`fontWeight`、`lineHeight`、`maxLines`、
`align`、`offsetX`、`offsetY`を扱います。色は`#RRGGBB`です。

ホストはUIノード128件、深度12、子32件、span32件、文字列4096文字を上限とし、寸法、文字サイズ、
不透明度なども安全な範囲へ制限します。リモートURL、`file:`、`content:`、コンテンツ外の画像は禁止です。
未対応スキーマや無効なUIで有効な`fallbackText`がある場合はテキストへフォールバックします。

### 14.4 共有

`ShareData`は必須の`text`、任意のHTTPS `url`、`#`なしの`hashtags`（最大10件）、`@`なしの
`via`を持ちます。共有ボタンを押すまで外部通信や外部アプリ起動を行いません。ホストは実際に渡す
本文を編集可能な確認画面に表示し、システム共有またはX Web Intentをユーザー操作で開きます。
自動投稿、任意Intent URI、パッケージ指定、ローカルパスや`runId`の自動追加は禁止です。
X向けにはURLを固定長として扱う重み付き文字数を表示し、上限超過時はXへの遷移を無効化します。

### 14.5 評価、キャッシュ、エラー

統計画面を開いた時点のスナップショットで各セッションを評価し、画面表示中に毎秒再実行しません。
履歴が確定したときは再読み込みし、同じグラフ・スクリプト・セッション履歴・集計値の結果はキャッシュ
できます。Yuraiveまたはスクリプト更新時はキャッシュキーが変わります。1セッションのタイムアウトや
型エラーはそのセッションだけの簡潔なエラーとして扱い、他セッションの評価と表示は続けます。
`share`だけが無効なら表示を残して共有を無効化します。

## 15. 完全例

```json
{
  "version": 1,
  "metadata": {
    "contentId": "com.example.rain_asmr",
    "displayName": "雨音シナリオ",
    "description": "音声再生後に選択肢を表示するサンプル",
    "author": "Yuraive Example",
    "thumbnail": "images/background.png",
    "socialLinks": [
      { "label": "Website", "url": "https://example.com/yuraive" }
    ],
    "createdAt": "2026-07-13T12:00:00+09:00",
    "tags": ["ASMR", "sample"]
  },
  "nodes": {
    "start": {
      "type": "media",
      "start": true,
      "media": [],
      "onEnd": [
        { "to": "choice", "weight": 1 }
      ],
      "buttons": [],
      "playerControl": "navigation",
      "editor": { "x": 100, "y": 180, "label": "Start", "color": "#4676a9" }
    },
    "choice": {
      "type": "media",
      "media": [
        {
          "id": "voice",
          "weight": 1,
          "source": {
            "type": "audioImage",
            "audio": "audio/voice.ogg",
            "image": "images/background.png",
            "fit": "cover"
          }
        }
      ],
      "onEnd": [
        { "to": "ending", "weight": 1 }
      ],
      "buttons": ["retry", "finish"],
      "playerControl": "navigation",
      "editor": { "x": 380, "y": 180, "label": "Choice", "color": "#75629a" }
    },
    "ending": {
      "type": "media",
      "terminal": true,
      "media": [],
      "onEnd": [],
      "buttons": [],
      "editor": { "x": 760, "y": 180, "label": "Ending", "color": "#89704d" }
    }
  },
  "buttons": {
    "retry": {
      "targetSlot": "actions",
      "order": 10,
      "zIndex": 10,
      "text": "Retry",
      "style": { "backgroundColor": "#333333", "textColor": "#ffffff" },
      "onPress": [{ "to": "choice", "weight": 1 }],
      "editor": { "x": 360, "y": 360, "color": "#8b6fa3" }
    },
    "finish": {
      "targetSlot": "actions",
      "order": 20,
      "zIndex": 10,
      "text": "Finish",
      "style": { "backgroundColor": "#333333", "textColor": "#ffffff" },
      "render": { "path": "scripts/button.star", "function": "render" },
      "onPress": [
        { "to": "choice", "weight": 20 },
        { "to": "ending", "weight": 80 }
      ],
      "editor": { "x": 570, "y": 360, "color": "#a06f7d" }
    }
  },
  "globalPlayerControl": "default",
  "playbackStats": { "path": "scripts/playback_stats.star", "function": "render_stats" },
  "playerControls": {
    "default": {
      "accentColor": "#574de5",
      "layout": "ui/default.yuraive-layout.html",
      "allowStop": true,
      "showSeekBar": true,
      "showPlaybackTime": true,
      "allowSeek": true,
      "showSceneName": true,
      "showFileName": false,
      "allowNext": false,
      "allowPrevious": false,
      "editor": { "x": 100, "y": 30, "color": "#4f8c78" }
    },
    "navigation": {
      "layout": "ui/default.yuraive-layout.html",
      "allowStop": true,
      "showSeekBar": true,
      "showPlaybackTime": false,
      "allowSeek": false,
      "showSceneName": true,
      "showFileName": true,
      "allowNext": true,
      "allowPrevious": true,
      "editor": { "x": 380, "y": 30, "color": "#5c9270" }
    }
  }
}
```

この例の`ui/default.yuraive-layout.html`は次のように定義できます。

```html
<style>
.stage {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  padding: clamp(14px, 4cqw, 28px);
  pointer-events: none;
}

slot[name="actions"] {
  display: grid;
  grid-row: 2;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(8px, 2cqw, 14px);
  pointer-events: auto;
}

.yuraive-button {
  display: grid;
  place-items: center;
  min-height: 52px;
  padding: 12px 18px;
  border: 0;
  border-radius: 18px;
  background: #574de5;
  color: white;
  font: 600 16px/1.3 system-ui, sans-serif;
  text-align: center;
  pointer-events: auto;
}

@container yuraive-canvas (max-width: 360px) {
  slot[name="actions"] { grid-template-columns: 1fr; }
}
</style>

<div class="stage">
  <slot name="actions"></slot>
  <slot></slot>
</div>
```
