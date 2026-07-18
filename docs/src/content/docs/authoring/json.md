---
title: JSONを直接編集する
description: Yuraive v1のグラフ、ノード、ボタン、再生設定をJSONで編集します。
---

画面操作で作れない一括変更や細かな調整には、`.yuraive.json`をテキストとして直接編集できます。

編集後はYuraive Editorで開き、問題一覧とプレビューで検査してください。

## 最小のグラフ

次の例は、音声を1件再生して終了します。

```json
{
  "version": 1,
  "metadata": {
    "displayName": "雨音",
    "author": "Yuraive Example"
  },
  "nodes": {
    "opening": {
      "type": "media",
      "start": true,
      "media": [
        {
          "id": "rain",
          "weight": 1,
          "source": {
            "type": "audio",
            "audio": "audio/rain.ogg",
            "visual": "clear",
            "volume": 1,
            "loop": false
          }
        }
      ],
      "onEnd": [{ "to": "ending", "weight": 1 }],
      "buttons": []
    },
    "ending": {
      "type": "media",
      "terminal": true,
      "media": []
    }
  },
  "buttons": {},
  "playerControls": {}
}
```

`version`は現在も`1`です。

`nodes`、`buttons`、`playerControls`は空の場合でも省略できません。

## トップレベルの項目

| 項目                  | 役割                                           |
| --------------------- | ---------------------------------------------- |
| `version`             | コンテンツ形式のバージョン                     |
| `metadata`            | 作品名、説明、作者、サムネイル、日時、タグなど |
| `nodes`               | ノードIDをキーにしたノードの集合               |
| `buttons`             | ボタンIDをキーにしたボタンの集合               |
| `playerControls`      | 再生設定IDをキーにした設定の集合               |
| `globalPlayerControl` | ノードに個別設定がない場合の再生設定ID         |
| `playbackStats`       | 再生統計を作るStarlark関数                     |
| `editor`              | キャンバス上の座標と色                         |

`metadata`、`globalPlayerControl`、`playbackStats`、`editor`は必要な場合だけ指定します。

`editor`内の値は再生結果に影響しません。

## Media Node

Media Nodeは、進入時に`media`から重みに応じて1件を選びます。

メディアの自然終了時は`onEnd`から次のノードを選びます。

`buttons`にはボタン本体ではなく、トップレベルの`buttons`に存在するIDを書きます。

開始ノードには`"start": true`を付け、グラフ全体で1件だけにします。

終端ノードには`"terminal": true`を付け、`onEnd`と`buttons`を指定しません。

## メディアの種類

| `source.type` | 主な項目                                              |
| ------------- | ----------------------------------------------------- |
| `audio`       | `audio`、`visual`、`volume`、`loop`、`subtitle`       |
| `audioImage`  | `audio`、`image`、`fit`、`volume`、`loop`、`subtitle` |
| `video`       | `video`、`fit`、`volume`、`loop`、`subtitle`          |

`visual`は前の画像を残す`keep`または消す`clear`です。

画像と動画の`fit`には`contain`、`cover`、`stretch`を指定できます。

## 遷移と重み

終了時遷移とボタン押下時遷移は、次の形です。

```json
[
  { "to": "quiet", "weight": 1 },
  { "to": "intense", "weight": 3 }
]
```

`to`には存在するノードIDを指定します。

重みが`0`の候補は選ばれず、正の重みが1件もない遷移は実行できません。

## ボタン

ボタンはトップレベルの`buttons`へ定義し、マップのキーをボタンIDとして使います。

```json
{
  "continue": {
    "text": "続ける",
    "targetSlot": "actions",
    "visibility": [{ "fromMs": 3000, "toMs": null }],
    "onPress": [{ "to": "next", "weight": 1 }]
  }
}
```

`fromMs`と`toMs`は、現在ノードへ入ってからの相対時間です。

`toMs: null`はノードを離れるまで表示します。

`targetSlot`は適用中のレイアウトに存在するslot名と一致させます。

## 直接編集後の確認

1. JSONをUTF-8で保存します。
2. Yuraive Editorのファイルツリーを再読み込みします。
3. 画面下の問題一覧でエラーと警告を確認します。
4. プレビューを開始から終端まで実行します。
5. 配布用の`.yuraive`を改めて書き出します。

古い`.yuraive`が同じフォルダにあると直接編集したJSONより優先されるため、プレイヤーで確認するときは注意してください。
