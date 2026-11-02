# 逆向分析：tryanywear.ai（= Decart Anywear）

> 分析时间：2026-11-02　分析对象：`https://tryanywear.ai/`
> 触发来源：用户录屏 `b4fe75621aed97d5dbecd7447fe34b7b.mp4`（31.3s / 1010×944 / 30fps）
> 目的：搞清楚它"把衣服实时穿在真人身上"的技术实现，评估 Cleanfit 能否复刻。

---

## 一、结论速览

| 问题 | 答案 |
|---|---|
| 它是什么 | **Decart 官方 demo**，正式域名 `anywear.decart.ai`（`<link rel="canonical">` 直指此处），`tryanywear.ai` 是同一套代码的对外域名 |
| 托管 | Vercel + Express（`Server: Vercel`、`X-Powered-By: Express`），纯服务端渲染的静态页 + 少量 API |
| 核心引擎 | **Decart `lucy-vton-3.x`** —— 实时视频扩散模型（video-to-video），30fps |
| 推理在哪 | **不在浏览器**。GPU pod 在 Decart 云端，WebSocket 推流 `wss://api3.decart.ai` |
| 衣服怎么"穿"上去 | **一张参考图**，`rtClient.setImage(garmentURL)`。扩散模型每帧重绘人物，自然生成褶皱/袖子/衣领 |
| 有没有 3D 模型 / 骨骼 | **完全没有**。无 three.js、无 MediaPipe/BlazePose、无 ONNX、无 WebGL 推理 |
| 前端体量 | `index.html` 95KB（含大量注释）+ `decart-sdk.min.js` 945KB + `tryon-queue.js` 19KB + 审核脚本 50KB |

**一句话**：它不是"把衣服贴到人身上"，而是"**每一帧都重新画一遍穿着这件衣服的你**"。这是扩散模型的活，不是图形学的活。

---

## 二、完整数据链路

```
① getUserMedia()                     拿摄像头 MediaStream
        ↓
② POST /api/queue/join               排队领座位（PRIORITY 档，自家页面优先）
        ↓
③ /api/tokens                        换 token
        ↓                            token 里带 3 个关键值：
        │                              · apiKey        （Decart 临时密钥）
        │                              · modelName     （服务端绑定，前端只读）
        │                              · maxSessionSeconds（会话上限，服务端说了算）
        ↓
④ createDecartClient({ apiKey })
   .realtime.connect(camStream, {
        model: { name, urlPath:'/v1/stream', fps:30, width:1088, height:624 },
        onRemoteStream: stream => output.srcObject = stream
   })
        ↓                            WSS 长连接，把摄像头帧持续推上去
        ↓                            GPU 上跑 lucy-vton-3.x，逐帧重绘后推回来
        ↓
⑤ <video srcObject=remoteStream>     渲染"穿着衣服的你"
        ↓
⑥ 用户点/拖一件衣服 → rtClient.setImage(url)
        ↓                            只发这一张图，模型立刻换装，不断流
        ↓
⑦ 心跳 /api/queue/heartbeat          保座位；离开 → /api/queue/leave
```

### 关键代码（原文摘录）

```js
const modelDefFor = (slug) => ({
  name: slug, urlPath: '/v1/stream', fps: 30, width: 1088, height: 624, inputSchema: {}
});

const conn = await AWQ.connectAdmitted(got, qOpts, (g) =>
  createDecartClient({ apiKey: g.token.apiKey }).realtime.connect(camStream, {
    model: modelDefFor(MODEL),
    onRemoteStream: (stream) => { output.srcObject = stream; }
  })
);
```

```js
// 换衣：只传一张图，不重建会话
await rtClient.setImage(url);
```

```css
/* 镜像不在模型里做，纯 CSS 翻一下 */
#t-output { transform: scaleX(-1); }
```

---

## 三、SDK 的 API 表面（我们能调用的部分）

从 `decart-sdk.min.js` 里解出的公开方法：

| 方法 | 作用 |
|---|---|
| `createDecartClient({ apiKey })` | 建客户端 |
| `.realtime.connect(mediaStream, opts)` | 建实时流，返回 `{ client, cancelled, busy }` |
| `.setImage(blob \| File \| url \| base64)` | **换衣服/换参考图**，核心方法 |
| `.setPrompt(text, { enhance })` | 文字提示（可与图共存，schema 要求 prompt 与 image 至少一个） |
| `.replaceVideoTrack(track)` | 换视频轨（切摄像头） |
| `.getStats()` | 延迟/帧率统计 |
| `.disconnect()` | 断流 |
| `.sessionId` | 会话 ID，用于对齐服务端日志 |

内部消息协议（从代码里看到的）：`set_image` 消息带 `image_ref` 或 `image_data`，可选附带 `prompt`。

---

## 四、值得抄的工程细节

这部分比模型本身更有参考价值——它是把一个 demo 做成能扛流量的产品的功夫：

1. **会话排队系统**（`tryon-queue.js`）
   - `/api/queue/join` → 拿 ticket → `/api/queue/heartbeat` 续命 → `/api/queue/leave` 归还
   - `/api/queue/requeue`：并发上限撞上了，把 ticket 放回**队首**，等真有空位再连
   - 自家页面走 PRIORITY 档，优先于付费用户

2. **会话时长三重约束**
   - `DEMO_SESSION_S = 90`（demo 只给 90 秒，因为数据显示中位数只用 89s，41% 的人从不选衣服却占满 300s）
   - `DEMO_NO_GARMENT_S = 30`（开了流 30 秒不选衣服就自动收摊，把座位还回去）
   - 平台硬顶 300s
   - 三个数字**都从 token 里读**，不写死在前端 —— 一个数字三处读取，避免漂移

3. **模型名绝不写死**
   - 代码注释里明确写着：曾经硬编码 `lucy-vton-3.5`，账号迁到 `3.6` 后，从 2026-09-15 起 ~100% 的即时试衣全挂（`Model not permitted`）
   - 现在一律读 `/api/tokens` 返回的 `modelName`
   - 还有 `npm run check` 专门拦截"`lucy-vton-*` 字面量重新回到脚本里"

4. **审核（Moderation）**
   - 服务端强制开 NSFW 阈值，不是前端开关
   - pod 端跑自己的 NSFW 通道 + `kv-reset` 模式：清 KV cache、模糊自己的输出、重装检测器
   - 前端监听 `content_flag`，一旦命中就中断，不再把违规画面继续推给用户

5. **埋点**：PostHog，事件如 `website_instant_tryon_worked` / `_garment_applied` / `_error`，`platform: 'landing_demo'` 标签用来把 demo 流量从正式 KPI 里过滤掉

---

## 五、接口清单（已探测）

| 端点 | 方法 | 状态 |
|---|---|---|
| `/api/queue/join` | POST | 需同源 + 会话 |
| `/api/queue/heartbeat` | POST | 同上 |
| `/api/queue/leave` | POST | 同上 |
| `/api/queue/requeue` | POST | 同上 |
| `/api/tokens` | GET/POST | **403 Forbidden**（校验来源与队列座位，裸调拿不到） |
| `wss://api3.decart.ai/v1/stream` | WSS | 需合法 token，按模型授权 |

> 说明：token 接口做了来源校验，无法脱离队列直接取密钥。这是**正确**的设计，没有可绕过的口子——也意味着我们不可能"白嫖"它的算力，只能走正规 API。

---

## 六、对 Cleanfit 的意义

### 为什么我们现在的 canvas 贴图做不到视频里的效果

| 维度 | 我们当前做法 | 视频里的做法 |
|---|---|---|
| 衣服来源 | 一张商品图，切成 6×12 网格做仿射变形 | 同一张图，作为**扩散模型的条件输入** |
| 贴合方式 | 按骨架关键点算轮廓，`prof(t)` 收腰 + 画袖管 + 画领口 | 模型自己理解"布料如何包裹这个体型"，逐帧生成 |
| 光影/褶皱 | 没有 | 每帧重新计算，跟随动作、光照、遮挡 |
| 遮挡关系 | 靠手动画序 | 模型自带深度理解（手臂挡在身前也对） |
| 算力 | 浏览器 Canvas 2D | 云端 GPU 集群 |
| 效果上限 | **中等**，明显是"贴上去的" | **接近真实**，肉眼难分 |

结论：**靠 Canvas 2D 永远到不了视频里的水准**。这不是调参问题，是技术路线问题。

### 三条可选路线

| 路线 | 做法 | 效果 | 成本 | 工作量 |
|---|---|---|---|---|
| **A. 接 Decart** | 照搬它的链路：队列 → token → `realtime.connect` → `setImage` | ★★★★★ 与视频完全一致 | 需 Decart 账号 + API key，按会话/时长计费 | 中（约 300 行，SDK 直接用） |
| **B. 自建 GPU 推理** | 开源 VTON（IDM-VTON / CatVTON）+ 流式封装 + 自己的 GPU | ★★★★☆ 接近，但实时性难保证 | GPU 服务器固定月租，贵 | 高（要写推理服务 + 调度） |
| **C. 保持本地** | 优化现有 canvas 管线 | ★★☆☆☆ 始终是"贴图感" | 0 | 低 |

**建议**：走 A。Cleanfit 的定位是"试衣镜"，效果就是产品本身；B 自建在 demo 阶段性价比极低；C 已经到天花板了。

---

## 七、落地到 Cleanfit 的改造方案（路线 A）

现有 `demo/js/fitting.js` 的 canvas 绘制**保留为降级方案**，新增一条 Decart 通路：

```
demo/js/decart.js         新增：封装 createDecartClient / connect / setImage
demo/js/fitting.js        改造：draw() 前判断 —— 有远端流就显示 <video>，没有才走 canvas
demo/index.html           AD 面板加：API Key 输入框（localStorage 存）+ 连接状态灯
```

改动要点：
1. **AD 面板**从"canvas 画布"变成"`<video>` + canvas 双层"：有远端流时 `<video>` 可见、canvas 隐藏
2. **不引入队列**（个人使用没有并发压力），但保留 30s 无服装超时和 90s 会话上限，防止空烧 token
3. **模型名从环境/输入读**，绝不写死（照抄它的教训）
4. **API key 存 localStorage**，不进仓库
5. 断流/失败自动回落到现有 canvas 贴图，保证 demo 永远能用

---

## 八、附：本次抓取产物

```
D:/Cleanfit/_recon/
  index.html                    95,531 B   首页（含完整流程代码与注释）
  decart-sdk.min.js            945,488 B   官方 @decartai/sdk 打包版
  tryon-queue.js                19,526 B   排队系统
  moderation-reset-attempt.js   50,183 B   审核重置
D:/Cleanfit/_tmpvideo/          10 帧视频截图（fps=1/3）
```

> 注：`_recon/` 仅为分析留档，不参与构建，可随时删除。
