# Yuraive Documentation

`docs.yuraive.com`で公開するYuraive公式ドキュメントです。

## ローカルで確認する

```bash
npm install
npm run dev
```

## 検証する

```bash
npm run check
npm run build
npm run deploy:dry-run
```

Cloudflare上のWorker名は`yuraive-docs`です。

`wrangler.jsonc`のCustom Domain設定により、`docs.yuraive.com`から静的出力を配信します。

## Cloudflare Git連携

| 項目              | 値                     |
| ----------------- | ---------------------- |
| Worker            | `yuraive-docs`         |
| Root directory    | `docs`                 |
| Build command     | `npm run build`        |
| Deploy command    | `npx wrangler deploy`  |
| Production branch | `main`                 |
| Watch paths       | `docs/**`, `assets/**` |

初回デプロイ後にCustom Domain、証明書、検索、内部リンク、モバイル表示を確認してからGit連携を有効にします。
