# canvas-kind 单点取证：Codex「光标悬停托盘 + 跟随鼠标波纹」是 WebGL 还是 2D/DOM/SVG？

- 取证目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/canvas-kind/`
- 目标产物（只读）：`/usr/lib/chatgpt/resources/app.asar`（355,432,434 B，mtime `2026-09-18 12:00:40 +0800`，`-rw-r--r--`，**取证前后未变**）
- 纪律遵守：未启动任何 GUI、未 pkill、未改任何产品文件、未修改 `app.asar`、未传 `sandbox_permissions`、未派发任何 subagent。
- 方法：解析 Electron ASAR 头部得到 **15480 个成员**的 `(路径, 偏移, 大小)` 索引（`raw/asar_members.tsv`），使每一次原始字节命中都能**精确归属到具体文件**（而非猜测）；随后对命中成员做定向解包（只解包命中项，不整包展开 355MB）。

---

## 0. 一句话裁决

**① Codex 的托盘/波纹是 DOM/CSS/SVG（含 CSS sprite 逐帧），不是 WebGL，也不是 WebGPU，也不是 2D canvas。**
**③ DSH 侧完全没有 WebGL/WebGPU（也没有 canvas 元素）。**
**④ 因此 `DMABUF_SURFACE_EXPORT: blocked` 对用户实际抱怨的那两个 UI（光标悬停托盘、跟随鼠标波纹）没有任何成本——该降级与这两个症状无关。**
**⑤ 额外发现（重要，请回传主 agent）：Codex 是 Electron/Chromium（自带 `libEGL.so`/`libGLESv2.so`/`libvulkan.so.1`），根本不走 Firefox/Gecko 的 gfxVar。**

---

## 1. 任务逐条判定

| # | 任务项 | 判定 | 核心证据 |
|---|---|---|---|
| 1 | `app.asar` 内 `getContext(` 实参检索 | **PASS** | 全库 400 处 `getContext(`：**253× `'2d'`、9× `webgl(2)`、138 处非 canvas 同名方法**（`Statsig.getContext()` 等）。无 `'webgpu'` |
| 1b | `webgl`/`WebGLRenderingContext`/`GPUCanvasContext` 字面量 | **PASS** | 仅 9 处 WebGL 建上下文点；`GPUCanvasContext`=0、`navigator.gpu`=0、`requestAdapter`=0（**本构建无 WebGPU**） |
| 1c | Valdi canvas/渲染后端线索 | **PASS** | Valdi 在 `/webview/assets/experiment-service-8297af95b869.js`；其 web 后端 = `document.createElement`+`setAttribute`（真实 DOM），**webgl 字面量 = 0** |
| 1d | 托盘/波纹 UI 的渲染方式 | **PASS** | 全部 31 个 `avatar\|mascot\|pet\|quick-chat\|…` 成员：**含 GL/WebGPU 构造者 = 0** |
| 2 | wasm/原生库是否绕过 DOM canvas | **PASS（否定）** | 原生仅 HID/serial/sqlite/watcher/node-pty；**无 Skia / Impeller / Valdi-native / ANGLE-standalone**；wasm 全为 .NET/OpenXml/Walnut/LVGL(建盘设备) |
| 3 | DSH 侧是否用 WebGL/WebGPU | **PASS（否定）** | 已部署 `@deepseek-ai/**` 全量：`getContext('webgl'\|'2d'\|'webgpu')`/`WebGLRenderingContext`/`GPUCanvasContext` **命中 0**；前端 bundle 连 `"canvas"` 字面量都没有 |
| 4 | 裁决 + 可被否证的表述 | **PASS** | 见 §5 |
| 5 | 若无法定论则 INCONCLUSIVE | **不适用（已定论）** | 但保留 2 条残余不确定，见 §6 |

---

## 2. 【决定性证据 A】托盘/吉祥物/波纹 UI 的完整文件集合 —— 零 WebGL

对 `avatar|mascot|pet|puppet|quick-chat|fallen` 命中路径做**逐成员能力扫描**（`member_scan.js`，探针：`getContext` / `ctx2d` / `ctx-webgl` / `ctx-webgpu` / `webgl` / `webgpu|GPUCanvasContext|requestAdapter` / `createElement('canvas')` / `OffscreenCanvas` / `texImage2D` / `rAF`）：

```
=== matched members: 31; members containing GL/WebGPU constructs: 0 ===
```

关键成员（完整清单见 `raw/scan_pet_assets.txt`）：

| 大小 | 成员 | 命中探针 |
|---|---|---|
| 242,313 | `/webview/assets/avatar-overlay-native-page-84a63926578f.js` | 仅 `rAF:7`（**无 getContext/webgl/canvas 元素**） |
| 42,817 | `/webview/assets/quick-chat-window-b3d429707aa2.js` | 仅 `rAF:2` |
| 36,312 | `/webview/assets/pets-settings-route-222034a70571.js` | `{}` 全空 |
| 33,865 | `/webview/assets/content-quick-chat-overlay-d9c5bb228791.js` | `{}` |
| 15,507 | `/webview/assets/avatar-mascot-button-bb5b355598a7.css` | `{}` |
| 11,581 | `/webview/assets/puppet-bfeae2f377db.js` | `{}` |
| 9,601 | `/webview/assets/avatar-mascot-button-e610ac96dd37.js` | `{}` |
| 6,391 | `/webview/assets/quick-chat-obstacles-8b01a73f5dda.js` | 仅 `rAF:1` |
| 4,395 | `/webview/assets/avatar-overlay-native-page-ca33544dc9d2.css` | `{}` |
| 1,443,471 | `/webview/assets/fallen-pet-a467195bac78.png` | `{}`（**吉祥物是静态 PNG，不是 canvas**） |
| 88,896 | `/webview/assets/petal-fold-bird-base@2x-c250bfa80ced.webp` | `{}` |
| ... | （余 20 项均为 `{}`，见原始文件） | |

**那 2 次 `canvas` 命中是假信号** —— `avatar-overlay-native-page-84a63926578f.js:1 col86319`：

```js
Tt=(0,vl.jsx)(gt.div,{className:vt,"data-avatar-overlay-backing-canvas":`true`,
   "data-avatar-overlay-hit-region":yt,"data-avatar-overlay-size":`notification-stac...
```

这是 framer-motion 的 **`div`**（`gt.div`）上的一个 **HTML data 属性名叫** `data-avatar-overlay-backing-canvas`。**属性名叫 canvas，元素是 div**。该文件 `getContext` = 0。

---

## 3. 【决定性证据 B】两套波纹实现都是 SVG / DOM，均无 canvas

### B1. SVG 径向渐变逐帧改写（`rippleStops`）—— 与前提描述一致
`/webview/assets/codex-mobile-setup-dialog-2f2fa54a0b3f.js:2`（col 30093）：

```js
,r=d.maxRadius*e,i=Math.max(0,r-Qn),a=Math.min(d.maxRadius,r+Qn),[o,s,c]=n.rippleStops;
 o.setAttribute(`offset`,String(i/d.maxRadius)),
 s.setAttribute(`offset`,String(r/d.maxRadius)),
 c.setAttribute(`offset`,String(a/d.maxRadius)) ...
```
命中的是 **`setAttribute('offset', …)`**，即改写 **SVG `<radialGradient>` 的 `<stop offset>`**。DOM/SVG 光栅化，**无 WebGL**。该文件 `webgl`/`getContext` 命中数 = 0。

### B2. Valdi `Pressable` + `PressFeedback.Ripple` —— 声明式节点属性
`/webview/assets/experiment-service-8297af95b869.js:4`（col 141186 与 144716）：

```js
a=r.makeNodePrototype(`view`,[`accessibilityId`,`valdi-press-ripple`,`accessibilityNavigation`,`ignored`],`q9c5k1ogGU94nz9f`)
...
r.setAttribute(`slowClipping`,!0), r.setAttributeStyle(`style`,S.ripple), r.setAttribute(`touchEnabled`,!1),
r.setAttributeNumber(`scaleX`, +!!this.state.rippleExpanded), r.setAttributeNumber(`scaleY`, …), r.setAttribute…(`opacity`,this.state.pressed?.12:0)
```
波纹 = **`scaleX`/`scaleY`/`opacity` 属性插值**（`setStateAnimated`，`duration:.35`）。该文件是 Valdi 运行时所在处，**`webgl` 字面量 = 0**，`document.createElement` 5 次（建 `div`/`dialog`/`style`，非 canvas）。

### B3. Valdi web 后端 = 真实 DOM（不是 canvas / Skia 表面）
```
87 × setAttribute(     5 × document.createElement     5 × appendChild
```
其中 `createElement` 目标为 `div` / `dialog` / `style`（`createDialog`→`document.createElement('dialog')`）。

### B4. 托盘的"跟随鼠标"动效是 CSS 动画
`avatar-mascot-button-bb5b355598a7.css`：
```css
animation:5s steps(48,end) infinite _activity-shimmer_1eowl_1
@keyframes _activity-shimmer_1eowl_1
```
—— 48 步 CSS sprite 逐帧（配 `hoots-spritesheet-*.webp`），走 CSS 合成器，不是 canvas。

---

## 4. 【边界清晰化】Codex 里**确实存在**的 WebGL（与本症状无关）

全库 `getContext(...)` 实参统计（`raw/getContext_all.txt` → 归属分析）：

| 实参 | 次数 |
|---|---|
| `'2d'` | **253** |
| `'webgl'` / `'webgl2'` | **9** |
| 非 canvas 同名方法（`Statsig.getContext()` 等） | 138 |
| `'webgpu'` | **0** |

9 处 WebGL 建上下文点，逐条归属：

| 成员 | 次数 | 用途 |
|---|---|---|
| `/webview/assets/mapbox-gl-420ccbeb68f9.js` | 2 | Mapbox GL 地图（`webgl2`，`failIfMajorPerformanceCaveat`） |
| `/webview/assets/mapbox-gl-fpgNuqPS-8b3fccf89a0d.js` | 2 | 同上（另一 chunk） |
| `/webview/assets/app-initial-430deae5a13a.js` | 1 | 3D 渲染器（`webgl2`+`premultipliedAlpha`，文件内 `texImage2D`×3） |
| `/webview/assets/impl-b5fd81189ab9.js` | 1 | 「FastTrack」粒子揭示动画 |
| `/webview/assets/index.module-9e940567d3f5.js` | 1 | **PhotoSphereViewer** 全景图（`lt(){…getContext('webgl2')}` 能力探测） |
| `/webview/assets/onboarding-page-b93b0ed836b1.js` | 1 | onboarding 3D 渲染（`rendererStatus`，含 `webglcontextlost` 处理与降级） |
| `/webview/assets/rosalind-helix-c60314d72a9f.js` | 1 | 品牌 helix 装饰（`powerPreference:'low-power'`） |

**`texImage2D` 全库归属（仅 8 个成员，均非宠物 UI）**：
```
16 three.module   · 3 app-initial · 3 mapbox-gl-fpgNuqPS · 2 cytoscape×2
 2 mapbox-gl-420ccbeb68f9 · 1 mapbox-gl-csp-worker · 1 onboarding-page
```

### 最接近"每帧上传纹理"的一处（供完整性，**不是托盘**）
`/webview/assets/impl-b5fd81189ab9.js:1`（col 2814）—— **唯一**一处逐帧 `drawArrays` 的 WebGL 画布：

```js
let n=e.getContext(`webgl`,{alpha:!0,antialias:!1,depth:!1,powerPreference:`high-performance`,stencil:!1});
...
let u=e=>{n.uniform1f(s,e), n.drawArrays(n.TRIANGLES,0,6)},
    d=()=>{ let r=Math.min(window.devicePixelRatio,2), {height:i,width:a}=e.getBoundingClientRect(); e.width=…; n.viewport(0,0,e.width,e.height) },
    f=e=>{ l=0, u((e-c)/1e3), l=window.requestAnimationFrame(f) };
```
- 规模：canvas 尺寸 = **元素 `getBoundingClientRect()` × min(DPR,2)** —— 是**组件块级**（`_Canvas_1lz3t_53` 类，装在 `_Reveal`/`_Mask` 里的 span），不是整窗。
- 每帧：`uniform1f(uTime)` + `drawArrays(TRIANGLES,0,6)`；**无 `texImage2D`**（不逐帧上传纹理）。
- 用途：`_FastTrackParticles_…` 粒子/揭示动效，且 `shouldReduceMotion` 时停 rAF。
- **它是 composer 区域的动效，不属宠物 UI 集合**（§2 的 31 成员扫描里没有它）。

---

## 5. 裁决

### ① Codex 的波纹/托盘是 WebGL（含 WebGPU）还是 2D/DOM/SVG？
**是 DOM/CSS/SVG，三者都不是 WebGL、不是 WebGPU、也不是 2D canvas。**
- 波纹：SVG `<radialGradient>` stop `offset` 逐帧改写（`rippleStops`）+ Valdi 声明式 `scaleX/scaleY/opacity`。
- 托盘/吉祥物：framer-motion `<div>` + Tailwind + **CSS sprite 逐帧**（`steps(48,end)`）+ 静态 PNG/WebP。
- 那处"整窗 canvas"的**候选来源已被证否**：`data-avatar-overlay-backing-canvas` 是 **div 上的 data 属性名**，不是 canvas 元素。

### ② 若含 WebGL，其用途与规模？
宠物/托盘/波纹 UI **不含** WebGL，故此项对其不适用。
（应用内确有 9 处 WebGL，但都在地图/全景图/3D onboarding/品牌 helix/composer 粒子动效；唯一逐帧 `drawArrays` 的 `impl-b5fd81189ab9.js` 是**组件块级、无 `texImage2D`** 的动效画布。）

### ③ DSH 侧是否用到 WebGL/WebGPU？
**没有。** 证据：
- 已部署 `@deepseek-ai/**` 全量扫描：`getContext(['"`](webgl2?|webgpu)` / `WebGLRenderingContext` / `GPUCanvasContext` / `requestAdapter` → **0 命中**。
- `dsh-web-frontend/dist/assets/{index-ClqxG24t.js, vendor-D22_Mp1f.js}`：**连 `"canvas"` / `` `canvas` `` 字面量都没有**，`createElement('canvas')` = 0。
- 所有 `dsh-client-ui-*` / `dsh-client-*` 插件包：0 命中。
- 工作区 `dsh-wallpaper-local`：壁纸 = `backgroundImage` + `wallpaper-effect.png`（静态 PNG），无 canvas/WebGL。
- 干扰排除：`vendor-D22_Mp1f.js` 里 4 次 `three` 是 **KaTeX 宏** `\leftthreetimes` / `\rightthreetimes` 与报错文案（"must have three arguments"），**不是 three.js**（`THREE`/`WebGLRenderer`/`REVISION` 均 0 命中）。

### ④ `DMABUF_SURFACE_EXPORT: blocked` 对用户抱怨的那两个 UI 是否有成本？

> **判决：无成本（对这两个 UI）。可被否证的表述为：**
>
> **「若托盘/波纹 UI 不创建 WebGL/WebGPU 上下文，则"唯一副作用是布尔 gfxVar"的 `DMABUF_SURFACE_EXPORT` 降级对这些 UI 没有每帧成本。」**
>
> 前置已由本次取证证实（§2/§3）：该 UI 的 `getContext` = 0、`webgl/WebGPU` 字面量 = 0。
>
> **否证条件（falsifier，可操作）**：在这两个 UI 活跃时，Firefox Profiler 抓 5 秒，若出现 `WebGLContext`/`WebGL*` 帧，或 DevTools 里能选中一个覆盖整窗的 `<canvas>` 元素，则本判决被推翻。
> 期望结果（若判决成立）：**看不到任何 WebGL 帧**（因为它们是 DOM/CSS/SVG）。

**因此：这两条症状的火力应回到「强制 a11y」与「环境放大器」**，不要在 `DMABUF_SURFACE_EXPORT` 上继续投入。

### ⑤ 【追加，可能改变主 agent 后续动作】Codex 与 Firefox 不是同一个图形栈
| 事实 | 证据 |
|---|---|
| Codex 是 **Electron/Chromium** 应用 | `/usr/lib/chatgpt/resources/linux-package-metadata.json`：`{"codexAppBrand":"chatgpt","codexBuildFlavor":"prod","version":"26.915.31945"}`；`owl-electron-app.json`：`runtimeName:"owl"`，`packagedFrom:"…/ChatGPT-linux-x64"` |
| 自带独立 GPU 栈（Chromium/ANGLE + Vulkan） | `/usr/lib/chatgpt/` 下存在 `libEGL.so`、`libGLESv2.so`、`libvulkan.so.1`、`libvk_swiftshader.so`、`ChatGPT`(317MB)、`chrome_100_percent.pak`、`LICENSES.chromium.html` |
| 主进程完全与 Firefox 无关 | `/.vite/build/main-DUHZj4_w.js` 内 **`webgl` 命中 0**；仅通过 Chromium 自身 API 读 `app.getGPUFeatureStatus()` / `app.commandLine.hasSwitch('disable-gpu')` |

**含义**：Firefox 的 `DMABUF_SURFACE_EXPORT`（Gecko WebRender/WebGL 的 gfxVar）在架构上**不可能**影响 Codex 的渲染。即使 Codex 真用了 WebGL，那也走它自己的 Chromium GPU 进程。这一点**独立于**①③，进一步支持"该降级与 Codex 症状无关"。

---

## 6. 残余不确定（诚实边界）

1. **静态产物 ≠ 运行时全量**：我只证明了**本构建已发布的静态** JS 里没有 WebGL 触达宠物 UI。若某 A/B 实验在运行时**动态 import 未随包发布的 chunk**，静态法看不到（本包 14308 个 webview chunk 已近乎穷举，风险低但非零）。→ 用 §5④ 的否证法收口。
2. **"整窗 canvas"来源未找到实体**：我未能在任何成员里找到覆盖整窗的 `<canvas>` 元素创建 + 每帧绘制。最接近的候选 `avatar-overlay-native-page` 的 `data-…-backing-canvas` 已证实是 `div` 属性名。**若用户实机右键能看到整窗 canvas，那它来自运行时/实验注入，需要 live 复核。**

---

## 7. 原始证据清单

### 索引与脚本（本目录）
| 文件 | 作用 |
|---|---|
| `raw/asar_members.tsv` | **15480** 个成员的 `路径 / 大小 / 绝对偏移 / 是否 unpacked`（后续所有偏移归属的基准） |
| `raw/getContext_all.txt` | 全库 `getContext(` 原始字节命中（400 行） |
| `raw/texImage2D_all.txt` | 全库 `texImage2D` 命中 |
| `raw/grep_getContext.txt` | 带 `路径:行号` 归属的 `getContext(` 摘录 |
| `raw/grep_webgl.txt` | `webgl2`/`webgl`/`WebGLRenderingContext`/`WebGL2RenderingContext`/`GPUCanvasContext`/`navigator.gpu`/`webgpu` 逐模式扫描 |
| `raw/scan_pet_assets.txt` | **31 个宠物/托盘成员的能力扫描（GL 构造者 = 0）** ← 核心证据 A |
| `raw/bfs_pet_ui.txt` | 从宠物 UI 入口做 import 图 BFS（4000 节点上限，见下注） |
| `asar_index.py` / `asar_grep.py` / `asar_extract.py` / `asar_index.py` | 只读 ASAR 索引 / 偏移归属 grep / 定向解包 |
| `member_scan.js` | 逐成员 canvas/GL 能力扫描 |
| `import_bfs.js` | 只读 import 图 BFS + 能力扫描 |

> **BFS 的诚实说明**：`raw/bfs_pet_ui.txt` 显示 `nodes visited: 4000`（达到上限）——说明**可达性分析在此粒度上不可判定**（宠物 UI 经 `app-shared` 可达几乎整个应用，故"可达"≠"被使用"）。因此我没有用 BFS 结论，而改用 §2 的**精确成员集合扫描**（可判定、可否证）。该文件保留作为"为何弃用可达性论证"的证据。

### 解包副本（`extracted/`，均从原包字节精确复制；`avatar-overlay-native-page` 已做 **byte-exact: True** 校验）
```
a8d0cfb2b5d0b9e5dfb421484fbd0e47f36558f89fb0d1f2660c7a68057b6eac  avatar-overlay-native-page-84a63926578f.js
db533e7c421249ae65a7123a41499f5ade1a8872b1475d142d0a36a628402b0b  controls-9cff35d6f2f9.js
cbc0c2b77c8e56bf39ace518012b93b07740c4dcf4b924362bb3b1a437ffa7f2  experiment-service-8297af95b869.js
8274eb0247b9e4a1012161d03e60a625bf8705174564e777cc86e9466bcfaf20  impl-b5fd81189ab9.js
33e528fc6d1c3da4f8da3496249f4010ed763fae05d17914637e8d0c6a2b1991  codex-mobile-setup-dialog-2f2fa54a0b3f.js
9069e68e430bf0e41b7af67d705cbee783660f76cf7655ce6de7aa094b40b689  quick-chat-obstacles-8b01a73f5dda.js
546e09c87401d9076154c3bbf82b492cd4e8260f3f9403e62ca4e6e16316918e  quick-chat-window-b3d429707aa2.js
e6baf534e164f23cce326a087f9d1b90dd4b88036c048d40ccf03cf9694d7973  index.module-9e940567d3f5.js
1223ac420cdd1603c4638d3f08590d44709c3b5bee22e65ede6bfce1679ed443  avatar-mascot-button-bb5b355598a7.css
b04a79311f4359324847cfe52633566812bee3e5b3d37e7dc61aaffbbea4b2a8  controls-5f3a44b7effb.css
```

### 只读性证明
- 原文件：`size=355432434`，`mtime=2026-09-18 12:00:40 +0800`，`mode=-rw-r--r--` —— 取证全程未变（未被写入即不可能保留原 mtime/mode）。
- 所有读取均以 `'rb'` / `'r'` 打开；写操作**只发生在本工作区目录内**。
- 未启动 Codex、未启动 Firefox、未 pkill 任何进程。

---

## 8. 给主 agent 的行动建议

1. **`DMABUF_SURFACE_EXPORT: blocked` 这条线对"光标悬停托盘 + 跟随鼠标波纹"应结案（无成本）**，火力转回「强制 a11y」与「环境放大器」。
2. **不要再假设"Codex 有个整窗 canvas"** —— 该假设的核心证据（`backing-canvas`）实为 div 的 data 属性名。
3. **Codex 与 Firefox 图形栈不同源**（Electron/Chromium vs Gecko）：任何 Firefox `about:support` 的 gfx 决策日志**在原理上都不适用于 Codex**。若 Codex 侧仍需 gfx 证据，应查 Chromium 自身通道：`chrome://gpu` 等价物，即包内已有的 `app.getGPUFeatureStatus()` 路径（`/.vite/build/main-DUHZj4_w.js` 内 `gpuFeatureStatus`/`gpuVendor`/`gpuRenderer`）。
4. 若需 live 收口，用 §5④ 的 5 秒 Profiler 否证法（**零风险、不需改动任何配置**）。
