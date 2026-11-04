# Cleanfit · Decart 实时换装（真·一比一）

用 **Decart Lucy VTON Realtime** 把衣服实时穿到摄像头前的人身上。这是你给的那支视频
（tryanywear.ai / Decart）**同一个引擎**，所以效果是一比一复刻，而不是本地 2D 贴图近似。

- 模型：`lucy-vton-latest`（`lucy-vton-3.6`），WebRTC 实时视频流
- 链路：浏览器摄像头 → WebRTC → Decart（逐帧生成人+衣服）→ WebRTC → 页面播放
- 密钥安全：永久 `DECART_API_KEY` 只在服务端；浏览器每次连接前向 `/api/realtime-token`
  取一个 **60 秒有效的 client token**

---

## 1. 前置条件

- Node.js ≥ 18（本机是 v22）
- 一个 Decart 账号与 API Key：<https://platform.decart.ai>（需付费额度，见下方定价）
- 摄像头 + 浏览器（Chrome / Edge / Safari 均可；`getUserMedia` 需要 https 或 localhost）

## 2. 本地运行

```bash
cd D:/Cleanfit/holo
cp .env.example .env          # 然后把 DECART_API_KEY= 后面填上你的 key
npm install                   # 已装过可跳过
npm start                     # 默认 http://localhost:8788
```

浏览器打开 <http://localhost:8788>：

1. 上传一件衣服（PNG/JPG，建议白底或纯色背景、主体完整）
2. 点「开始试穿」，允许摄像头
3. 页面中间出现的是 **Decart 实时生成的画面**（衣服长在你身上，跟着你动）
4. 换衣服：直接再上传一张，会实时热切换（`setImage`）
5. 「Fast 模式」= 更低延迟、更高吞吐，计费翻倍

> 不想改 `.env`？点右上角「设置」把 key 粘进去即可（存本机 localStorage）。

## 2.1 两种鉴权模式（自动选择）

前端会**按有没有本地 key 自动切换**，所以同一套代码既能本地跑、也能纯静态部署：

| 模式 | 触发条件 | 怎么鉴权 | 需要后端吗 |
|---|---|---|---|
| **直连 key** | 「设置」里粘贴过 key（存 localStorage） | `createDecartClient({ apiKey })`，key 直接随 WebRTC 连接发送 | ❌ 不需要 |
| **后端签发** | 没存 key | `apiKeyProvider → POST /api/realtime-token`，用服务端 `.env` key 换 60s client token | ✅ 需要 `npm start` |

**线上分享链接**（<https://cleanfit-holo.apps.workbuddy.host/?sharecode=LATEL4JUFX>）
是**纯静态托管、没有 Node 后端**，因此走「直连 key」模式：
打开页面 → 右上角「设置」粘贴你的 Decart API Key → 上传衣服 → 开始试穿。
key 只存在你自己浏览器的 localStorage 里，不上传任何服务器。

## 3. 原理 / 架构

```
浏览器                         本服务(Node)                 Decart 云端
──────                         ───────────                 ──────────
getUserMedia ──┐
               ├─ WebRTC ────────────────────────────────▶  lucy-vton
createDecartClient(apiKeyProvider) ──POST /api/realtime-token──▶ tokens.create()
               │                      (用服务端永久 key 换 60s token)
onRemoteStream ◀── WebRTC ────────────────────────────────  逐帧生成的人+衣服
   → <video> 播放
```

- `server.js`：Express，静态托管 `public/`；`POST /api/realtime-token` 用服务端 key
  或请求体里用户自带的 key，调用 `client.tokens.create({ allowedModels, allowedOrigins, expiresIn:60 })`。
- `public/js/app.js`：有本地 key 时 `createDecartClient({ apiKey })`，否则
  `createDecartClient({ apiKeyProvider: () => mintToken() })` →
  `realtime.connect(stream, { model, mirror, resolution:'720p', speed, initialState:{ image, prompt } })`
  → `onRemoteStream` 把返回流塞进 `<video>`。
- `public/vendor/decart/`：官方 `@decartai/sdk` 浏览器构建（已内置 LiveKit，无需 CDN）。

## 4. 定价（Decart 官方）

| 模式 | 分辨率 | 计费 |
|---|---|---|
| Realtime 标准 | 720p | 2 信用 / 秒 |
| Realtime Fast | 720p | 4 信用 / 秒 |
| Batch | 720p | 4 信用 / 秒 |

页面上会实时显示 `LIVE 12s · ≈24 credits`，方便估算消耗。

## 5. 手机上跑（"都要"）

同一个 Web 应用可以直接包进 **WebView / Capacitor / Tauri Mobile**：WebRTC 与 SDK 在
移动端 WebView 里都能用，后端 `/api/realtime-token` 不变。真要上架原生 App 时，只需把
`getUserMedia` 换成原生相机流、把 token 端点部署到公网，其余逻辑复用。

## 6. 安全提示（重要）

这是**个人原型**。两种模式的安全边界不同：
- **直连 key（线上静态版）**：key 存在你浏览器的 localStorage 里，只在你自己的设备上生效。
  别人打开链接不会拿到你的 key，但也用不了——他们得自己粘自己的 key。
- **后端签发（本地版）**：`/api/realtime-token` 接受请求体里用户自带的 key，若把带后端的
  服务公开到公网，任何拿到链接的人都能用 **你的 key 额度**。公开前请改成"仅服务端 env key +
  `allowedOrigins` 白名单"，并去掉请求体带 key 的通道。
- 私用没问题；不要把带 key 的 `.env` 提交进 git（已在 `.gitignore` 忽略）。

## 7. 常见问题

- **摄像头打不开**：必须 https 或 localhost；浏览器地址栏确认已授权。
- **`Invalid or expired API key`**：key 错了或过期，重新生成。
- **`NO_API_KEY`**：没配 key；填 `.env` 或在「设置」里粘贴。
- **连接中断 / 额度用尽**：页面会提示"会话已结束"，检查 Decart 账户余额。
- **延迟高**：打开「Fast 模式」，并确保上行带宽足够（720p 实时需要稳定上行）。
