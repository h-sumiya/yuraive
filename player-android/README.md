# Yuraive for Android

Yuraive v1 コンテンツを端末内のフォルダから再生するネイティブ Android アプリです。複数フォルダの永続権限、Media3 によるバックグラウンド再生、動画・音声・画像・WebVTT、Rust製Starlarkエンジンによるノード/ボタン、JSONL 履歴、前回状態の復元に対応します。JSONごとの再生コントロール表示・操作制限、アクセント色、次へ/前へ、作品情報、作者定義のセッション別再生統計と確認付き共有も利用できます。

- 公式サイト: https://yuraive.com
- Yuraive Editor: https://editor.yuraive.com

## ビルド

リポジトリルートで次を実行します。

```bash
mise install
mise run playerBuild
```

生成物は `player-android/app/build/outputs/apk/debug/app-debug.apk` です。接続端末へは次のコマンドで導入できます。
Rust Starlarkランタイムの制約により、APKの対象ABIは`arm64-v8a`と`x86_64`です。

```bash
adb install -r player-android/app/build/outputs/apk/debug/app-debug.apk
```

R8・リソース縮小とRustのrelease最適化を有効にしたリリースAPKは次のタスクで生成します。

```bash
mise run playerReleaseBuild
```

署名設定を与えていない場合の生成物は `player-android/app/build/outputs/apk/release/app-release-unsigned.apk` です。
AndroidリリースはGitHub Actionsで同じ未署名APKを異なる2パスからビルドして一致を確認し、開発者鍵で署名します。
`android-v<versionName>`タグでは、署名済みAPKとSHA-256チェックサムをGitHub Releaseへ公開します。

## 確認

```bash
mise run playerTest
cd player-android
./gradlew lintDebug assembleRelease
```

## フォルダの追加

アプリ内の「＋」から追加元を選びます。

- **この端末**: Android の Storage Access Framework でフォルダを選択します。読み取り権限は再起動後も保持されます。
- **SMB**: ホスト、ポート、共有名を入力し、接続後に追加するフォルダを選択します。ドメイン、ユーザー名、パスワードは任意で、ユーザー名とパスワードがともに空欄の場合は guest 接続を使用します。
- **WebDAV**: HTTPS URL と任意の Basic 認証情報を入力し、接続後に追加するフォルダを選択します。サーバーは `PROPFIND`（`Depth: 1`）と、シークに使用する `GET` の Range リクエストに対応している必要があります。

SMB・WebDAV の接続情報と認証情報は Android Keystore の鍵で暗号化して保存します。端末が Tailscale に接続されていれば、tailnet 内の HTTPS WebDAV URL や SMB ホストも利用できます。

Windows版の「Androidと接続」に表示されるQRコードを読み取ると、Cloudflareを待ち合わせだけに使うQUIC直接接続でWindowsライブラリを追加できます。メディア本体はCloudflareを経由しません。直接UDP経路を作れないネットワークでは接続エラーになり、ライブラリの再読み込み操作で再試行できます。

設定の「すべての再生コントロールを表示・許可」を有効にすると、コンテンツ側の`playerControls`を一時的に上書きできます。JSON仕様は[YURAIVE_v1_SPEC.md](../notes/YURAIVE_v1_SPEC.md)を参照してください。

編集用の`*.yuraive.json`に加えて、スクリプトとレイアウトを内包した配布用`*.yuraive`も読み込めます。
同じ名前の両形式がある場合、ライブラリには`*.yuraive`だけを表示します。
カスタム再生レイアウトのファイル名には`*.yuraive-layout.html`を使用します。
