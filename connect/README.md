# Yuraive Connect

`connect.yuraive.com` で動作するYuraiveプレイヤー接続用のCloudflare Workerです。
現在はWorkerとCustom Domainの稼働確認用エンドポイントのみを提供します。

```bash
npm install
npm run dev
npm run deploy:dry-run
npm run deploy
```

## エンドポイント

- `GET /`
- `GET /health`

どちらもWorkerが稼働中なら次のJSONを返します。

```json
{
  "service": "yuraive-connect",
  "status": "ok"
}
```
