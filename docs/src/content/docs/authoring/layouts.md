---
title: ボタンレイアウトを作る
description: 安全なHTMLとCSS Gridで、画面サイズに応じたボタン配置を作成します。
---

ボタンの位置と大きさは、`.yuraive-layout.html`のslotとCSSで決まります。

レイアウトはJavaScriptを使わないHTMLとCSSの小さな断片です。

## レイアウトを作成する

1. ファイルツリーのフォルダまたは空白部分を右クリックします。
2. 「レイアウトファイルを作成」を選びます。
3. 名前を入力します。
4. 作成したファイルを開きます。

エディタは390×390のライブプレビュー、slot一覧、対応する要素とCSSを表示します。

## 二つのボタンを下に並べる例

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

  slot[name='actions'] {
    display: grid;
    grid-row: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(8px, 2cqw, 14px);
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
    padding: 12px 18px;
    border: 0;
    border-radius: 18px;
    background: #574de5;
    color: #ffffff;
    font:
      600 16px/1.3 system-ui,
      sans-serif;
    text-align: center;
    pointer-events: auto;
  }

  @container yuraive-canvas (max-width: 360px) {
    slot[name='actions'] {
      grid-template-columns: 1fr;
    }
  }
</style>

<div class="stage">
  <slot name="actions"></slot>
  <slot></slot>
</div>
```

ボタン側の`targetSlot`を`actions`にすると、`slot name="actions"`へ配置されます。

名前もIDもない`<slot></slot>`は、配置先を指定しないボタンを受け取るデフォルトslotです。

## slotの規則

レイアウトにはデフォルトslotをちょうど1件置きます。

名前付きslotは`<slot name="actions">`または`<slot id="actions">`で作成できます。

同じ名前またはIDをレイアウト内で重複させません。

ボタンの配置順には`order`、重なり順には`zIndex`を使います。

## 使用できるHTML

使用できる要素は`style`、`div`、`slot`です。

`div`と`slot`では`class`、`id`、`name`、`style`、`role`、`aria-label`を使用できます。

`script`、イベント属性、外部フレーム、外部CSS、外部URLの読み込みは使用できません。

対応していない要素と属性はプレイヤーが除去します。

## 使用できるCSS

端末間で同じ結果にするため、次の範囲を使います。

- CSS Gridの列、行、gap、配置
- `position`、`inset`、`order`、`z-index`
- 幅、高さ、最小値、最大値、余白、はみ出し
- 背景、色、不透明度、枠線、影、変形
- フォント、行間、文字揃え、省略
- size containerと`@container`

長さには`px`、`%`、`fr`、`cqw`、`cqh`と、`calc()`、`min()`、`max()`、`clamp()`を使用できます。

ブラウザのプレビューで動いても一覧外のCSSはAndroid版とWindows版で同じ結果になるとは限りません。

## プレイヤーから受け取る値

レイアウトでは、次のCSSカスタムプロパティを使えます。

| 変数                                                                                         | 内容                     |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| `--yuraive-canvas-width`                                                                     | ボタン描画領域の幅       |
| `--yuraive-canvas-height`                                                                    | ボタン描画領域の高さ     |
| `--yuraive-safe-top`、`--yuraive-safe-right`、`--yuraive-safe-bottom`、`--yuraive-safe-left` | 画面内の安全余白         |
| `--yuraive-density`                                                                          | 端末のdevice pixel ratio |
| `--yuraive-font-scale`                                                                       | プレイヤーの文字倍率     |

画面の向きと大きさが変わるとレイアウトは再計算されます。

固定幅だけで作らず、`fr`、`cqw`、`clamp()`、`@container`を使って縦向きと横向きの両方を確認します。
