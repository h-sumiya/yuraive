# Yuraive for Windows

WinUI 3 と Windows App SDK を使った x64 デスクトッププレイヤーです。Yuraive v1 の検証・Starlark 実行は Android/Web と同じ Rust ランタイムを DLL として呼び出します。

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
- `*.yuraive.json` と、スクリプト・`*.yuraive-layout.html` レイアウトを内包する配布用 `*.yuraive` を読み込み、同名時は `*.yuraive` を優先します。

## ビルド・テスト・実行

PowerShell でリポジトリのルートから実行します。

```powershell
dotnet build player-windows/Yuraive.Windows.slnx
dotnet test player-windows/tests/Yuraive.Core.Tests/Yuraive.Core.Tests.csproj -p:Platform=x64
dotnet run --project player-windows/src/Yuraive.App/Yuraive.App.csproj -p:Platform=x64
```

`mise` を使う場合は `mise run windowsBuild`、`mise run windowsTest`、`mise run windowsRun` でも実行できます。アプリとテストのビルド時に Rust の release DLL が増分ビルドされ、出力ディレクトリへコピーされます。

Microsoft Store 提出用の MSIX は次のように生成します。

```powershell
dotnet publish player-windows/src/Yuraive.App/Yuraive.App.csproj -c Release -p:Platform=x64 -p:GenerateAppxPackageOnBuild=true
```

## ブランドと Microsoft Store

| 項目                   | 値                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------- |
| アプリ名               | `Yuraive`                                                                              |
| 公開サイト             | `https://yuraive.com`                                                                  |
| エディタ               | `https://editor.yuraive.com`                                                           |
| Package Identity Name  | `h-sumiya.Yuraive`                                                                     |
| Publisher              | `CN=0CAEE31D-460E-4BC5-A8FA-16FA42C46226`                                              |
| Publisher display name | `h-sumiya`                                                                             |
| Package Family Name    | `h-sumiya.Yuraive_45bv5107ybs6g`                                                       |
| Package SID            | `S-1-15-2-3791779760-2730826886-836300522-2627406885-3025252485-2297235786-4168071393` |
| Microsoft Store ID     | `9N3VN7TLM99W`                                                                         |

`Package.appxmanifest` はこの Store identity と、`.yuraive` バンドルの関連付けを使用します。Windows 用の PNG / ICO 資産は [`assets/icon.svg`](../assets/icon.svg) から生成しています。

## 保存データ

設定、ライブラリのルート、再生スナップショット、JSONL 履歴は `%LOCALAPPDATA%\Yuraive` に保存します。履歴は作品ごとに最大 1,000 件で、アプリ内から JSONL エクスポート・個別削除・全消去ができます。
