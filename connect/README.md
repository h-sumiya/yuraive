# Yuraive Connect

`connect.yuraive.com` で動作するYuraiveプレイヤー接続用のCloudflare Workerです。
Worker と Durable Objects の WebSocket Hibernation API を使い、Windows と Android の
WebRTC シグナリングだけを中継します。ライブラリやメディア本体は Worker を通らず、
TURN も使用しません。

```bash
npm install
npm run dev
npm run deploy:dry-run
npm run deploy
```

## エンドポイント

- `GET /`
- `GET /health`
- `GET /v1/rooms/:room?role=host|client` (`Upgrade: websocket`)

どちらもWorkerが稼働中なら次のJSONを返します。

```json
{
  "service": "yuraive-connect",
  "status": "ok"
}
```

接続エンドポイントは `Authorization: Bearer <QR内の256-bit secret>` が必須です。
部屋は Windows host が最初に作成し、同じ role の再接続は以前のソケットを置き換えます。
1部屋につき Windows 1台、Android 1台です。WebSocket は Hibernation API で待機するため、
Free plan の範囲では課金されず、上限到達時は追加課金ではなくリクエスト失敗になります。
