# Yuraive Website

`yuraive.com` で公開するYuraive公式サイトです。Astroで静的HTMLを生成し、Cloudflare WorkerからStatic Assetsとして配信します。

- `/` は空白ページです。
- `/privacy/` はアプリ、エディタ、公式サイト共通のプライバシーポリシーです。
- `/privacy` と `/privacy-policy` は `/privacy/` へリダイレクトします。

## 開発

```bash
npm install
npm run dev
```

## 検証とデプロイ

```bash
npm run build
npm run deploy:dry-run
npm run deploy
```

Cloudflare上のWorker名は`yuraive-website`です。`wrangler.jsonc`のCustom Domain設定により、初回デプロイ時に`yuraive.com`用のDNSレコードと証明書が作成されます。
