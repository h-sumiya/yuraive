# WMGF Player for Windows

WinUI 3 と Windows App SDK を使った x64 デスクトッププレイヤーです。WMGF v1 の検証・Starlark 実行は Android/Web と同じ Rust ランタイムを DLL として呼び出します。

## 必要なもの

- Windows 10 version 1809 以降
- .NET SDK 9 (リポジトリの `global.json` で 9.0.312 を選択)
- Rust stable の `x86_64-pc-windows-msvc` ツールチェーン
- Visual Studio Build Tools の Desktop development with C++
- WebView2 Runtime

Windows App SDK ランタイムはフレームワーク依存配置です。開発機に 2.2 系ランタイムがない場合は Windows App SDK の公式インストーラーを入れてください。

## UI と操作

- Android版と同じライブラリ、常駐ミニプレイヤー、縦型／横型プレイヤー、設定項目を提供します。
- 横長ではタブレット型の2ペインプレイヤー、十分に広い画面でだけライブラリとプレイヤーを併設します。
- 戻るボタン、Esc相当の画面内操作に加えて、マウスの戻るボタンでプレイヤー・フォルダ・履歴・設定から戻れます。
- `*.wmg.json`と、スクリプト・レイアウトを内包する配布用`*.wmg`を読み込み、同名時は`*.wmg`を優先します。

## ビルド・テスト・実行

PowerShell でリポジトリのルートから実行します。

```powershell
dotnet build player-windows/WmgfPlayer.Windows.slnx
dotnet test player-windows/tests/WmgfPlayer.Core.Tests/WmgfPlayer.Core.Tests.csproj -p:Platform=x64
dotnet run --project player-windows/src/WmgfPlayer.App/WmgfPlayer.App.csproj -p:Platform=x64
```

`mise` を使う場合は `mise run windowsBuild`、`mise run windowsTest`、`mise run windowsRun` でも実行できます。アプリとテストのビルド時に Rust の release DLL が増分ビルドされ、出力ディレクトリへコピーされます。

## 保存データ

設定、ライブラリのルート、再生スナップショット、JSONL 履歴は `%LOCALAPPDATA%\WmgfPlayer` に保存します。履歴は作品ごとに最大 1,000 件で、アプリ内から JSONL エクスポート・個別削除・全消去ができます。
