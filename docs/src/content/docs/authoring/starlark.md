---
title: Starlarkで分岐を作る
description: 再生履歴や現在の状態を使って、遷移とボタン表示を制御します。
---

Starlarkは、履歴や現在の再生状態に応じた分岐を作品へ追加するときに使います。

Yuraiveでは、Script Node、ボタン表示、再生統計から`.star`内の関数を呼び出します。

## スクリプトを作成する

1. ファイルツリーのフォルダまたは空白部分を右クリックします。
2. 「スクリプトを作成」を選びます。
3. 名前を入力して`.star`タブを開きます。
4. 関数を書き、`Ctrl+Enter`でテストします。
5. 成功を確認して保存します。

スクリプトはUTF-8で保存し、同じコンテンツフォルダ内に置きます。

## Script Nodeで遷移先を選ぶ

次の例は、現在の再生セッションで`intro`を再生済みなら`after-intro`へ進みます。

```python
def jump(ctx):
    for entry in ctx["currentHistory"]:
        if entry["nodeId"] == "intro":
            return "after-intro"
    return None
```

1. グラフのツールバーから「Script Node」を作ります。
2. インスペクターでスクリプトと関数を選びます。
3. Script Nodeの右側から、返す可能性のあるノードをすべて接続します。

関数名を省略すると`jump(ctx)`を呼びます。

戻り値のノードIDは、実在し、そのScript Nodeから接続済みでなければなりません。

`None`を返すと、接続済みの終了時遷移から重みに応じて選びます。

Script Nodeはメディアを再生せず、履歴を追加しない0秒の制御ノードです。

## ボタンの表示を変える

次の例は、保持中の履歴が10件以上ならボタンを表示し、文字と色を変えます。

```python
def render(ctx):
    unlocked = ctx["historyCount"] >= 10
    return {
        "visible": unlocked,
        "text": "特別なシーンへ",
        "style": {
            "backgroundColor": "#355070",
            "textColor": "#ffffff",
        },
    }
```

ボタンのインスペクターで、表示スクリプトと関数を選びます。

関数名を省略すると`render(ctx)`を呼びます。

戻り値では`visible`、`text`、`style`を部分的に上書きできます。

配置先slot、配置順、重なり順、レイアウト構造はスクリプトから変更できません。

`ctx["now"]`は実行時点の値であり、時刻の経過だけでは自動実行されません。

## 使用するコンテキスト

| 値                           | 内容                                               |
| ---------------------------- | -------------------------------------------------- |
| `ctx["history"]`             | 保持中の確定履歴、最大1,000件                      |
| `ctx["currentHistory"]`      | 現在の再生セッションに属する確定履歴               |
| `ctx["current"]`             | 現在または直前のノード、メディア、位置、実再生時間 |
| `ctx["trigger"]`             | 開始、終了、ボタン、テストなどの実行契機           |
| `ctx["now"]`                 | 実行時刻                                           |
| `ctx["runId"]`               | 現在の再生セッションID                             |
| `ctx["historyCount"]`        | 確定履歴の件数                                     |
| `ctx["historyActivePlayMs"]` | 確定履歴の実再生時間合計                           |
| `ctx["totalActivePlayMs"]`   | 現在の未確定再生を含む実再生時間合計               |

時刻はRFC 3339の文字列、時間量はミリ秒です。

`ctx["current"]`は未再生時に`None`になるため、フィールドを読む前に確認します。

## 乱数を使う

Yuraiveは次の関数を用意しています。

| 関数                  | 動作                                     |
| --------------------- | ---------------------------------------- |
| `random()`            | 0以上1未満の小数を返す                   |
| `randint(start, end)` | 両端を含む整数を返す                     |
| `choice(items)`       | 空でない配列またはタプルから1件を返す    |
| `shuffled(items)`     | 入力を変えず、並び替えた新しい配列を返す |

これらの乱数は暗号用途には使えません。

## 再生統計を作る

再生統計では`render_stats(ctx)`を定義し、並び順の数値と表示内容を返します。

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
    }
```

グラフ情報の「再生統計」でスクリプトを有効にし、プレビューでテスト対象セッションを選んで実行します。

統計画面には任意のHTMLやMarkdownを返せず、Yuraiveが用意した宣言的な表示要素だけを使います。

## エラーを調べる

テスト結果には戻り値、`print()`出力、エラーが表示されます。

作品全体のプレビューではデバッグペインのTrace、History、Contextを確認します。

Script Nodeが文字列でも`None`でもない値を返した場合や、接続していないノードIDを返した場合はエラーになります。

連続するScript Nodeが循環するとプレイヤーは停止するため、必ずメディア、ボタン入力待ち、または終端へ到達する流れにします。
