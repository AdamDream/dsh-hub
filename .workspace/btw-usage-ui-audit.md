# btw / usage / vision 五项 UI·功能改进项 — 只读审计报告

> 审计日期：2026-09-14 · 路由：adam/deepseek-v4-flash · 纯只读（未改任何代码）
> 覆盖：① btw 运行横幅配色 ② btw 图片块 + 主会话官方放大机制 ③ usage 图表 tooltip ④ 识图插件提示词
> 部署位说明：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` 与工作区 `dsh-btw/lib/client.js` 逐字节一致（`diff` 验证 SAME；备份 `backup-btw-deploy-20260912-180420-lib` 为 18:04 部署态，仅缺 17:57 后新增的 `currentAction/bannerOutputting` locale 与 state 字段——与本审计结论无关）。`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/*` 与 `.workspace/dsh-usage-src/lib/*` 逐字节一致。

---

## 1. btw 运行横幅配色（用户嫌"蓝色调不和谐"）

### 现状
- **JSX**：`dsh-btw/src/client/SideChatSurface.tsx:399-407` — `{running && <div className={css.runningBanner} role="status" aria-live="polite"><span className={css.runningBannerText}>{state.currentAction?.kind === 'tool' ? t('drawer.bannerOutputting') + ' · ' + t('drawer.bannerCurrentAction') + ': ' + state.currentAction.tool : t('drawer.bannerOutputting')}</span></div>}`。文案 key：`drawer.bannerOutputting` / `drawer.bannerCurrentAction`（`src/client/locales.ts`，lib 内联值：`输出中…` / `当前动作`，lib/client.js:923-924）。`running = state.running`（:268）。
- **CSS**：`dsh-btw/src/client/side-chat.module.css:224-254`
  - `.runningBanner`（:226-238）：`position: sticky; top: 0; z-index: 2;` pill 胶囊（`border-radius: 999px`），**边框** `color-mix(in srgb, var(--dsw-static-deepseek-500) 24%, var(--dsw-alias-border-l1))`（:235），**底色** `color-mix(in srgb, var(--dsw-alias-bg-base) 90%, transparent)`（:237）。
  - `.runningBannerText`（:239-253）：`font: var(--dsw-font-s-strong-14)`，**文字渐变** `linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%)`（:245）+ `background-size: 250% 100%` + `background-clip: text; color: transparent`（:248-251）+ `animation: btw-banner-shimmer 1.8s linear infinite`（:252）。
  - `@keyframes btw-banner-shimmer`（:254）；`prefers-reduced-motion` 覆盖：`background-position: 0 0; background-size: 100% 100%; animation: none`（:494）。
- **token 色值**（定义在 `dsh-client-ui-theme/lib/client.js:124` 注入 `body` 的 CSS）：
  - `--dsw-static-deepseek-500: #4176e6`（主蓝）、`--dsw-static-deepseek-200: #d3e2ff`（浅蓝）。→ 用户感知的"蓝色调"即这组 DeepSeek 品牌蓝。
- **复刻来源**：官方 `TurnStatus` 文本渐变与 btw 完全同源（`dsh-client-ui-conversation/lib/client.js`，`turnStatus{height:26px;font:var(--dsw-font-s-strong-14);…background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%,…var(--dsw-static-deepseek-200) 50%,…);background-clip:text;animation:1.8s …dsh-turn-status-shimmer}`）——btw 是**忠实复刻官方**，非原创配色；而 btw 面板自身主题是石灰绿 `#b7e85b`（`.statusDotRunning` :184、`.readOnlyBadge`、`.sendButton`、各 hover 绿边 :261/:479/:494 等），蓝 banner 与绿面板确实不协调。

### 最小实现面（只改 CSS，两处；无需动 TSX）
1. `side-chat.module.css:245` 文字渐变：`--dsw-static-deepseek-500` → `#b7e85b`（或 `color-mix(in srgb, #b7e85b N%, transparent)` 做阶），`--dsw-static-deepseek-200` → 更浅绿阶（如 `color-mix(in srgb, #b7e85b 45%, transparent)` 或 `#d7f39a` 类近似）。保留 `background-clip:text` + shimmer 动画逻辑不变。
2. `side-chat.module.css:235` 边框 mix：`var(--dsw-static-deepseek-500)` → `#b7e85b`（或降饱和绿），与面板其他绿边对齐（参照 :219/:220/:261 的既有用法）。
- 若想进一步区分"输出中 / 工具执行中"，可换文案（`locales.ts` 的 banner 两条 + `SideChatSurface.tsx:401-405` 判断），与配色无关。
- 可复用点：官方 `turnStatus` 渐变是复刻蓝本（conversation lib）；改色完全在 btw 自己 CSS 内闭环，不触全局 token、不触官方包。

---

## 2. btw 图片块（缩略图 / 放大 / 序号徽标）+ 主会话官方放大机制

### 2a. btw 侧聊转录图片
- **渲染**：`SideChatSurface.tsx:442-462` — `message.images`（类型 `SideChatImageRef[]` = `{attachmentId, mediaType, name?}`，`src/shared/remote.ts:62-66`）→ `imageCache.get(ref.attachmentId)`（`imageCache` 为 `useState<ReadonlyMap<string,string>>`，:192；预取循环 :209-229）→ 命中渲染 `<button className={css.messageImageButton} title={ref.name ?? t('drawer.attachmentOpen')} onClick={() => setLightbox(ref)}><img src={dataUrl} className={css.messageImage}/></button>`（:449-458）；未命中渲染 `<span className={css.messageImagePlaceholder} aria-hidden>`（:447）。
- **CSS**：`.messageImages`（:477，flex wrap gap 7）、`.messageImageButton`（:478-479，`cursor: zoom-in`，hover 绿边）、`.messageImage`（:480，84×84 `object-fit: cover`）、`.messageImagePlaceholder`（:481）、`.lightboxImage`（:482，`max-width: min(560px,82vw); max-height: 74vh; object-fit: contain`）。
- **点击可否放大：可以**。`setLightbox(ref)`（:455）→ 通用 `Modal`（`@deepseek-ai/dsh-client-ui-primitives`，SideChatSurface.tsx:6 导入）承载原图（:551-564）。`Modal`（primitives `lib/index.js:2077`）是 body-portal 对话框：遮罩 `onClick→onClose`、`Escape→onClose`、标题 + 关闭钮。**有 lightbox 语义但非专用组件**（无官方 ImageLightbox 的焦点还原；图宽被限 560px）。
- **「置 1」徽标（图片序号）：当前代码中不存在**。
  - 已核对三处：工作区 `src`（SideChatSurface.tsx:442-462 无任何徽标元素）、部署位 `lib/client.js`（=src 构建，逐字节一致）、部署备份 `backup-btw-deploy-20260912-180420-lib/client.js`（同样无）；官方 `MessageImage / ImageGallery / AttachmentRail` 亦无序号徽标（见 2b）。转录图片是纯 `<button>+<img>`；唯一接近的计数元素是**输入框附件轨**的 `.attachmentCount`（总张数，SideChatSurface.tsx:502-503，样式 side-chat.module.css 内）。→ 用户所述"当前渲染位置与样式"与代码现状不符，属**需新增**（若用户实际在指主会话/官方 web 输入框缩略图，官方同样没有序号徽标，也是新增）。
- **最小实现面（新增徽标：图片左上角、白底黑字）**：
  1. `SideChatSurface.tsx:444` 的 `message.images.map(ref => …)` 改 `(ref, index)`，在 `<button>`（:450-458）内首子元素加 `<span className={css.messageImageBadge}>{index + 1}</span>`（建议 `message.images.length > 1` 时才显示，避免单图噪音；`index` 数据就在 map 参数，无需改 remote/controller）。
  2. `side-chat.module.css:478` `.messageImageButton` 补 `position: relative;`；新增
     `.messageImageBadge { position: absolute; top: 4px; left: 4px; z-index: 1; pointer-events: none; background: #fff; color: #000; font-family: var(--ds-font-family-code); font-size: 10px; line-height: 14px; padding: 0 4px; border-radius: 6px; }`。
  - 生效流：改 `src/client/*` → tsdown build → `lib/` → 同步 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（现行流程：备份 + copy + 重启 dsh web；deploy-side.sh 明确不碰 btw 部署位，btw 走独立 runbook）。

### 2b. 主会话（官方）图片放大机制 —— 注意：不在 dsh-client-ui-renderer
- **纠正前提**：`dsh-client-ui-renderer/lib/client.js`（988 行）只是 **slot 渲染宿主**（renderSlot/renderSlotChain/提供方绑定），全文件**无任何 image/lightbox/zoom 代码**（grep 零命中）。官方图片放大实现在 **`dsh-client-ui-attachment/lib/client.js`**（全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-attachment/lib/client.js`）：
  - **`MessageImage`**（:668）：props `{attachment, load, variant, labels}`。`variant` = `"single"`（独图：`singleFit` 长边 240px、宽高比 clamp [0.25,4]、cover 裁剪，:656-667）| `"tile"`（多图 64×64 方，CSS :617 注入）。经 `load(attachment)`（会话授权 URL loader）加载，失败渲染 `labels.loadFailed` 重试按钮（:693-700）；src 就绪时 `onClick → setOpen(true)`（:706-712）；按钮 `title: labels.open`、`aria-label: labels.openNamed(label)`（:704-705）；CSS `cursor: zoom-in`。
  - **`ImageLightbox`**（:412）：props `{src, alt, labels, onClose}` —— body portal、`z-index:1000` 遮罩（`--dsw-alias-bg-mask-1` + `backdrop-filter`）、图 `max-width: min(100%,1600px); max-height: calc(100vh - 80px)`、右上关闭钮；Escape / 遮罩 / 按钮关闭，**关闭后焦点还原到 opener**（:423-454）。
  - **`ImageGallery`**（:735）：单图 large、多图 64px tile。
  - **slot 入口** `MessageImages`（:752）注册到槽 **`conversation.message.images`**（:770-772），props `{images, loadImage, align, t}`；labels 来自 `messageImageLabels(t)`（:472-479；中文字符串见 `dsh-client-ui-conversation/lib/client.js` locale：`图片/查看原图/{label}，点击查看原图/图片加载中…/图片加载失败，点击重试/原图预览/关闭原图预览`，:6147-6158）。输入框草稿轨 `ComposerAttachments`（:523）+ `AttachmentRail`（:77）+ 同款 ImageLightbox，槽 `conversation.input.attachments`（:766-768）。
- **是否可跨插件复用（按 dsh-btw client 打包边界）**：
  - `dsh-client-ui-attachment` 的 client 包**只导出 `apply`/`inject`**（注释明示 "Register attachment presentation without exporting React components as package values"，:761-777）——`MessageImage / ImageLightbox / ImageGallery` **不是包级导出**，dsh-btw 侧 `import { MessageImage }` 不可行。
  - dsh-btw client 能运行时 require 官方 client 包（`SideChatSurface.tsx:6` 已从 `@deepseek-ai/dsh-client-ui-primitives` 引 Button/Modal 等，tsdown `CLIENT_EXTERNALS` 外置），但 primitives 导出组件值而 attachment 包不导出；且官方槽位由 conversation 渲染器注入 `{images, loadImage, align, t}` 形状，btw 自绘转录无该上下文（btw 用 `{attachmentId, name}` ref + 自有 imageCache dataURL）。
  - **结论：官方 lightbox 组件对 btw 不可直接复用**；btw 保持自有 `Modal` 放大（SideChatSurface.tsx:551-564）为正确边界。可复用的是**视觉规范与实现模式**：`singleFit` 240px / 64px tile、zoom-in 光标、以及官方 ImageLightbox 的 portal + Escape + 焦点还原模式（:423-454，btw 若升级放大体验可照此补焦点还原）。真正共享组件需上游 attachment 包导出组件（全局 live 树，超出本工作区可控面）。

---

## 3. usage 图表 tooltip（面积图 / 柱状图缺悬停数据）

### 现状
- **几何层** `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js`（= `.workspace/dsh-usage-src/lib/charts.js` 逐字节一致）：
  - `areaPath(points, w, h, opts)` :20 — 折线 path + 面积 path；points 仅 `{x, y}`。
  - `barRects(values, w, h, opts)` :39 — rects 保留 `value`，**丢失 `day`**。
  - `scaleBars(series, w, h)` :182 — `{day, value}[]` → rects `{x, y, width, height, value}`（day 被丢）+ ticks `{label: s.day.slice(5), x}`（抽样 ≤8 个，:197-200）。
  - `scaleArea(series, w, h)` :211 — → points `{x, y}`（day/value 全丢）+ ticks（:219-223）。
  - `heatmapGrid(days, cell, opts)` :71 — cells 携带 `{day, value, level}`（这是热力图能做 `<title>` 的原因）。
- **渲染层**（build-free 内联：client.js:50-173 内联 charts.js 同名函数副本，`charts.js 内联` 标记）`TrendChart` client.js:209-231：
  - 数据源：`const series = (props.rows || []).map(r => ({ day: r.day, value: bucketValue(r, props.bucket) }))`（:210）——**每个点的 `{day, value}` 在调用点完全可得**。
  - bar 模式 :215-221 — `scaleBars` + `barRects` 后 `<rect>` 只有 `{key, x, y, width, height, rx: 1}`（:219），**无 title / 无 pointer 事件**；ticks `<text>`（:220-221）。
  - area 模式 :222-228 — `scaleArea` + `areaPath` 产出两个 `<path>`（面积 :225、折线 :226），**均无 title / pointer**。
  - svg 根 :230（viewBox 560×150，`role="img"`）。
- **热力图先例（已实现）**：`HeatmapChart` client.js:244-249 — 每格 `<g key={c.day}><title>{c.day} · 总用量 {formatTokens(c.value)} tokens</title><rect …/></g>`（:247；level 0 格 `c.day + " · 无数据"`）。→ **原生 `<title>` 路线在本插件内已有成熟先例与文案格式**。

### 最小实现面（推荐方案 A：原生 `<title>`，与热力图一致，~6-10 行 client.js）
- **bar**：`:219` 的 map 改 `rects.map((r, i) => React.createElement("rect", {key: r.x + "-" + r.y, x: r.x, y: r.y, width: r.width, height: r.height, rx: 1}, React.createElement("title", null, series[i].day + " · " + formatTokens(series[i].value) + " tokens")))`（`<title>` 作为 rect 子元素）。`rects` 与 `series` 同长同序，`i` 即可回查 `series[i]`——**无需改 charts.js**。
- **area**：在 :225-226 两个 path 之后叠加每点透明命中圆：`scaled.points.map((p, i) => React.createElement("g", {key: "pt" + i}, React.createElement("title", null, series[i].day + " · " + formatTokens(series[i].value) + " tokens"), React.createElement("circle", {cx: p.x, cy: p.y, r: 4, fill: "transparent"})))`。或只给折线 path 挂单个 `<title>`（整线一个 tooltip，信息粒度差，不推荐）。
- 可选（更干净）：`charts.js` `scaleBars`（:187-196）/`scaleArea`（:215-218）各补 `day: s.day` 进 rect/point 输出（向后兼容的加法），client.js 对应改读；**注意 charts.js 与 client.js 内联副本必须同步**（client.js 头部即内联了 charts.js 全文，改动要么两处都改、要么改后跑 `dev/verify-inline.mjs` 校验/重灌）。
- **方案 B（React onMouseMove 自绘 tooltip）**：rect/circle 挂 `onMouseEnter/onMouseMove/onMouseLeave` + card 内 state + 绝对定位浮层。UX 更好（跟随光标、可加框/值/日期样式），但需处理 svg 坐标→card 偏移换算，代码 ~30-50 行，且与插件"0 依赖、自绘 SVG"原则兼容但优先级低于 A。
- **部署流**（usage 插件既定流程，见 `.workspace/usage-heatmap-exec.md`）：改 `.workspace/dsh-usage-src/lib/{charts.js,client.js}` → `cp -r` 到 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/`（同 `deploy-side.sh:92` 的拷贝位）→ 重启 dsh web；charts.js 需保持 `node --check` 通过（它独立可检）。

---

## 4. 识图插件提示词（dsh-vision-adam analyze_image）

### 现状（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`，部署位直改；无工作区源码副本，9-12 升级留有备份 `index.js.bak-restore-20260912-161015`）
- **工具注册**：`ctx.tools.register(defineTool({…}))`（:236-279）
  - `name: "analyze_image"`（:237）；`description`（:238，长英文说明"…return a text description or answer…"）。
  - `parameters`：`file_path`（string，required，:240-244）+ `question`（string，可选，:245-248）。
  - `output`：schema `{text: string}`（:250-260）+ `render` 返回 text（:261-265）。
  - `execute`（:267-278）：校验扩展名（IMAGE_TYPES :48-54 / VIDEO_TYPES :57-64）→ 读文件字节（maxBytes 20MiB / maxVideoBytes 50MiB）→ base64 → `analyzeImageBytes`。
- **给识图模型看的提示词（唯一修改点）**：`analyzeImageBytes`（:147-200）内 **:149-153**：
  ```js
  const prompt = question 非空
    ? `Analyze the attached ${isVideo ? "video" : "image"} and answer the following question. ${question.trim()}`
    : isVideo
      ? "Describe the attached video in detail, including how its content changes over time."
      : "Describe the attached image in detail.";
  ```
  作为 `messages[0].content` 的 text part（:170）与图片（`image_url` data URL，:173）一起发给 vision 模型；`max_tokens` 默认 2000（:39）。**vision 模型只看到这一句 + 图片本身**。
- **systemPrompt 片段**：:229-233 — `ctx.systemPrompt.section({name: "tool:analyze-image", order: 100, text: "Use the analyze_image tool to understand image and video files. It returns text … Prefer it whenever a task mentions an image or video file…"})`。这是给**主模型（agent）**的工具使用提示，**不进入 vision 模型**；改它只影响主模型何时/怎样调用工具，不改变识图输出内容。
- 默认网关/模型：`https://opencode.ai/zen/go/v1` + `deepseek-v4.1-flash`（:33-35）；认证 opencode 三头（:154-160）。

### 与 btw / 主会话的关系
- **btw 图片管线**：btw 通过 `import('@deepseek-ai/dsh-vision-adam')` 复用 `analyzeImageBytes / resolveOptions / resolveApiKey`（`dsh-btw/src/host/vision.ts:70-78`），粘贴图在消息入队前**同步**转文字（`src/host/side-chat-service.ts:931-942`），并携带 btw 自己的 question `VISION_DEFAULT_QUESTION = '请用中文简洁描述这张图片的内容、主体颜色与图中文字。'`（`vision.ts:46`，:112-119 传入）→ **btw 走的是 `analyzeImageBytes` 的 question 分支**（index.js:149-150 前缀拼接）。
- **改动 `analyzeImageBytes` 提示词 = 同时影响 analyze_image 工具（主会话模型调用）与 btw 图片管线**（共享代码路径）——若希望两处都变（一致性），改 vision-adam；若只想变 btw，改 `vision.ts:46` 的 `VISION_DEFAULT_QUESTION`。
- **主会话图片（展示/放大）走官方 attachment 管线**（`MessageImage`/`ImageLightbox`，见 §2b），与 `analyze_image` 工具**无关**，提示词改动不影响主会话图片显示。

### 修改点（用户诉求：尽量完整输出图片内容 + 附审美/设计合理性分析）
1. **vision-adam `lib/index.js:153`（图片默认分支）**：`"Describe the attached image in detail."` → 扩写为如 `"Describe the ENTIRE content of the attached image as completely as possible, including all visible text, objects, layout, and captions; then provide a concise aesthetic/design-rationale analysis (composition, color harmony, typography, visual hierarchy) when applicable."`。
2. **`index.js:152`（视频分支）与 `index.js:149-150`（question 前缀模板）**：按需同步措辞（可在 question 之后追加同一"附审美/设计分析"指令）。
3. **btw 定向**：`dsh-btw/src/host/vision.ts:46` 的 `VISION_DEFAULT_QUESTION` 追加要求（如"尽可能完整输出图片内容，并附审美/设计合理性分析"）——btw 输出即问答模型视角，无需改 vision-adam。
4. **（可选）`index.js:238` 工具 description / `:229-233` systemPrompt**：不改识图内容，仅引导主模型调用时机与传参；若要"主模型主动要完整描述"，可在这里加一句"prefer a comprehensive description including an aesthetic/design assessment"。
- 生效流：直改部署位（先备份当前 index.js，沿用 9-12 的 `.bak` 惯例）→ 重启 dsh web；btw 侧改动走 btw 构建/部署流。

---

## 附：四项改动各自的部署/生效路径（汇总）
| 项 | 改动文件 | 生效方式 |
|---|---|---|
| 1 横幅配色 | `dsh-btw/src/client/side-chat.module.css`（:235、:245） | tsdown build → lib → 同步 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` → 重启 web |
| 2 序号徽标 | `dsh-btw/src/client/SideChatSurface.tsx`（:444/449-458）+ `side-chat.module.css`（:478 附近） | 同上（btw 构建部署流） |
| 3 图表 tooltip | `.workspace/dsh-usage-src/lib/client.js`（:219、:225-226 后）+ 可选 `charts.js`（:187-196/:215-218） | cp 到 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/` → 重启 web；charts.js 与 client.js 内联副本须同步 |
| 4 识图提示词 | 部署位 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`（:149-153；btw 侧可只改 `dsh-btw/src/host/vision.ts:46`） | 备份后直改 + 重启 web（btw 侧走 btw 构建流） |

## 关键结论（一页纸）
1. **横幅蓝**：`--dsw-static-deepseek-500/200`（#4176e6/#d3e2ff）是官方 TurnStatus 渐变原样复刻；改色只需 `side-chat.module.css:235/:245` 两处 CSS（换成 btw 主题绿 `#b7e85b` 系），不动 TSX。
2. **btw 图片**：点击放大已有（primitives `Modal`，SideChatSurface.tsx:551-564）；**序号徽标当前不存在**，需新增（JSX map index + `position:absolute` 左上角白底黑字 span）；官方放大组件（`MessageImage`/`ImageLightbox`，**在 dsh-client-ui-attachment 而非 dsh-client-ui-renderer**）不导出组件值，btw 不可直接复用，应保持自绘。
3. **usage tooltip**：热力图 `<title>`（client.js:247）是先例；面积/柱状图数据点 `{day, value}` 在 TrendChart:210 完全可得，最小做法 = 每 rect/每点命中圆挂原生 `<title>`（同热力图格式），约 6-10 行，无需改 charts.js。
4. **识图提示词**：vision 模型只看到 `analyzeImageBytes` :149-153 的一句话 + 图片；改这里同时影响 analyze_image 工具与 btw 图片管线（共享路径）；btw 定向改 `vision.ts:46` 即可；systemPrompt（:229-233）只影响主模型调用行为，不进 vision 模型。
