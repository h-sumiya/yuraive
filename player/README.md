# WMGF Player for Android

WMGF v1 コンテンツを端末内のフォルダから再生するネイティブ Android アプリです。複数フォルダの永続権限、Media3 によるバックグラウンド再生、動画・音声・画像・WebVTT、Rust製Starlarkエンジンによるノード/ボタン、JSONL 履歴、前回状態の復元に対応します。JSONごとの再生コントロール表示・操作制限、アクセント色、次へ/前へ、作品情報、作者定義のセッション別再生統計と確認付き共有も利用できます。

## ビルド

リポジトリルートで次を実行します。

```bash
mise install
mise run playerBuild
```

生成物は `player/app/build/outputs/apk/debug/app-debug.apk` です。接続端末へは次のコマンドで導入できます。
Rust Starlarkランタイムの制約により、APKの対象ABIは`arm64-v8a`と`x86_64`です。

```bash
adb install -r player/app/build/outputs/apk/debug/app-debug.apk
```

R8・リソース縮小とRustのrelease最適化を有効にしたリリースAPKは次のタスクで生成します。

```bash
mise run playerReleaseBuild
```

署名設定を与えていない場合の生成物は `player/app/build/outputs/apk/release/app-release-unsigned.apk` です。

## 確認

```bash
mise run playerTest
cd player
./gradlew lintDebug assembleRelease
```

アプリ内の「＋」から WMGF コンテンツを含むフォルダを追加します。選択したフォルダの読み取り権限は Android の Storage Access Framework により再起動後も保持されます。

設定の「すべての再生コントロールを表示・許可」を有効にすると、コンテンツ側の`playerControls`を一時的に上書きできます。JSON仕様は[WMGF_v1_SPEC.md](../notes/WMGF_v1_SPEC.md)を参照してください。
