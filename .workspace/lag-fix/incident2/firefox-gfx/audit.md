# Firefox 合成/光栅路径审计（incident2 / firefox-gfx）

- 审计对象：用户实测「同一个 Codex 网页：Chrome 顺、Firefox 卡」
- 主机显示环境（他线已定，本文仅引用）：X11 `DISPLAY=:1`、mutter 分数缩放 ⇒ 帧缓冲 **5120×2880（14.75 Mpx）** 再 `Transform 1.333328` + bilinear 缩到 4K；合成为 **2 CU 的 AMD Raphael 核显**
- 纪律遵守：**全程只读**；未改任何配置；未重启/未 `pkill`；未启动用户浏览器；未执行 `snap run firefox`；所有工具调用**未传 `sandbox_permissions`**
- 原始证据目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-gfx/raw/`

---

> **📌 后续更新（用户已提供完整 `about:support`）**：本文若干处以实测字段**终审/更正**，详见配套文件
> **`decision-log-analysis.md`**（含本构建 revision `5fdfd0092780e85643e2cddc0e1b590c8b9ef860` 的 Gecko 源码行号）。
> 关键更正三处：① **H1 正式否证**（`合成: WebRender` ⇒ 硬件 WebRender，我上轮 Glean 推断获证）；
> ② §5-H2 里「无原生合成器 ⇒ 无 partial present ⇒ 每帧全幅」**推断作废**（`gfx.webrender.max-partial-present-rects` 默认 1 ⇒ partial present 实为**开启**）；
> ③ §4.4 关于 `WRWorkerLP` 的悬念闭合（由 `gfx.webrender.enable-low-priority-pool` 默认 true 解释，与软件光栅无关）。

## 0. 结论速览（TL;DR）


1. **Firefox 的图形配置是「全默认」**：`prefs.js`（230 条 `user_pref`）中 **`gfx.*` / `layers.*` / `webgl.*` / `apz.*` / `widget.*` / `layout.css.devPixelsPerPx` / `browser.display.os-zoom-behavior` / `dom.webgpu.*` 一个都没有** ⇒ 所有图形行为都是 Firefox 155 的**构建默认**，不是用户调过参数。**PASS**
2. **WebRender 确实开启并在跑**：2026-08-10 → 2026-09-22 的 **64 个 telemetry main ping 全部** `compositor = "webrender"`；活体父进程里有 `WRRenderBackend#0/1`、`WRWorker#0..3`、`WRWorkerLP#0..7`、`WrGlyphRasterizer`；两次 crash 注解均为 `WR? WR+`。**PASS**
3. **关键新事实（本次最大发现）：Firefox 自己的遥测把「环境切换」钉在 2026-09-20 17:18** —— 活动 GPU 从 **NVIDIA RTX 4090 (`0x10de`, `nvidia/unknown`, 驱动 595.84)** 切成 **AMD Raphael 核显 (`0x1002/0x13c0`, `mesa/radeonsi` 25.2.8.0)**。用户抱怨（09-22）正好落在切换之后。**PASS**
4. **Firefox 从不用原生 WebRender 合成器**：所有 ping 里 `wrCompositor = blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`。
   ⚠️ **但这条在 X11 上是「空的降级」，且我原先由它推出的「每帧按整幅 5120×2880 走」是错的**（已更正，见 `decision-log-analysis.md` §1.1/§1.4）：本构建源码里原生合成器分支只存在于 `#if defined(MOZ_WAYLAND)`/`XP_WIN`/`XP_DARWIN`，X11 走 `RenderCompositorEGL`；而 `gfx.webrender.max-partial-present-rects` 在 `MOZ_WIDGET_GTK` 下默认 **1** ⇒ `RenderCompositorEGL::UsePartialPresent()` 返回 **true** ⇒ **X11 下 partial present（脏区 + EGL buffer age）其实是开着的**。**PASS（事实）/ 机制推论已更正**
5. **「Firefox 走软件 WebRender（SWGL）」→ 已由用户实测正式否证**：`about:support` 显示 **`合成: WebRender`**、`GPU #1` AMD radeonsi **活动: 是** ⇒ **硬件 WebRender**，与我上轮由 Glean 得出的 `gfx.status.compositor = "webrender"`（而非 `webrender_software`）**一致**。（软件路径在本机确实发生过 —— 2026-09-04 crash 注解 `RenderCompositorSWGL failed mapping default framebuffer, no dt`、同机 headless 复现同签名 —— 但那是 NVIDIA 期。）**PASS（CONFIRMED）**
6. **新硬证据：Firefox 自己的帧计数器说明 Gecko 不是主犯**。解出 Glean 存储后，用户**真实累计**的帧时间归因为：**`on_time 101,469 = 98.20%`**、`missed_composite*` 合计 1,225 = **1.19%**、**`slow_composite 仅 632 = 0.61%`**、`skipped_composites 1,173`（`gfx.skipped_composites`）。⇒ **没有「Gecko 合成器长期掉帧」的证据**；这与他线「环境放大器」结论一致，并把矛头更多指向**下游呈现（mutter 5120→4K 双线性降采样 + 2 CU 核显）**而非 Gecko 光栅。**PASS（带累计窗口 caveat）**

---

## 1. 逐项裁决表（PASS / FAIL / INCONCLUSIVE）

| # | 审计项 | 裁决 | 依据 |
|---|---|---|---|
| A1 | 能否用文件读出 Firefox 真实图形配置 | **PASS** | `prefs.js` 全量枚举；`datareporting/archived/**/*.main.jsonlz4` 解出 `environment.system.gfx` |
| A2 | `gfx.webrender.*` 用户覆盖 | **PASS（=无覆盖）** | grep 命中 0，见 `raw/prefs-forensics.txt` |
| A3 | `gfx.x11-egl.*` 用户覆盖 | **PASS（=无覆盖）** | 同上；`gfx.x11-egl.force-enabled` 字面量存在于 libxul.so 但未被设置 |
| A4 | `layers.acceleration.*` 用户覆盖 | **PASS（=无覆盖）** | 同上 |
| A5 | `webgl.*` 用户覆盖 | **PASS（=无覆盖）** | 同上 |
| A6 | `layout.css.devPixelsPerPx` / `browser.display.os-zoom-behavior` | **PASS（=无覆盖）** | 两者都不在 prefs.js ⇒ DPR=2 来自 mutter/X11，不是 Firefox 自己拉的 |
| A7 | `widget.*` 覆盖 | **PASS（仅 1 条，与图形无关）** | `widget.content.gtk-high-contrast.enabled = true`（GTK 高对比整合；与 a11y 线相关） |
| A8 | profile 下 GPU 产物 `gfx-blacklist.xml` | **FAIL（文件不存在）** | 该文件是 Windows 专有；Linux 上不存在是**正常**，不构成问题 |
| A9 | profile 下 `*.jsonlz4` 里的 graphics 记录 | **PASS（改用更强来源）** | `search.json.mozlz4` 类文件不含 graphics；改从 `datareporting/archived/*.main.jsonlz4` + `crash .extra` 取到**逐会话**图形环境 |
| A10 | `~/.cache/mozilla/**` 日志 | **FAIL（目录不存在）** | 非 snap 的 `~/.cache/mozilla` 与 `~/.mozilla` 均不存在；snap 的缓存在 `~/snap/firefox/common/.cache/mozilla/firefox/<profile>/`，**里面只有 cache2/startupCache/thumbnails，无图形日志** |
| A11 | 既有 `MOZ_LOG`/`RUST_LOG` 历史日志 | **FAIL（无）** | `~/.bash_history` 无 MOZ_LOG/RUST_LOG 记录（见 §7）；全盘无 webrender/moz 日志 |
| A12 | snap 的 `/dev/dri` 可达性 | **PASS** | `snap connections firefox`：`opengl` 已连接、`content[gpu-2404]`→`mesa-2404:gpu-2404` 已连接；`/dev/dri/{card1,card2,renderD128,renderD129}` 存在，render 节点 `crw-rw----+ root render` |
| A13 | snap 是否用上 GPU | **PASS（用上了）** | Firefox 自报 `AdapterDriverVendor: mesa/radeonsi` + 描述串 `(radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)` + `GPUActive: true`；`GpuSandboxLevel: 0`；`~/snap/firefox/common/.cache/mesa_shader_cache/` 有 103 个 fanout 目录 |
| B1 | 独立 Gecko 实例（Playwright Firefox）可否复现 | **FAIL（不存在）** | `~/.cache/ms-playwright/` 只有 chromium/ffmpeg；`firefox.executablePath()` → `firefox-1466/firefox/firefox`，`exists: false`。详见 `sub-playwright/REPORT.md` |
| B2 | 退而用同机 headless Gecko 观察路径 | **PASS（但价值有限）** | 他线用 snap Firefox 的 RemoteAgent/BiDi 跑 headless，日志出现 `RenderCompositorSWGL failed mapping default framebuffer, no dt`；**headless 无 X11/无 mutter/无分数缩放，不能替证用户的合成路径** |
| C1 | H1 软件 WebRender ⇒ DPR2+5120×2880 光栅爆炸 | **CONFIRMED REFUTED（当前会话）** | 用户 `about:support`：**`合成: WebRender`** + `GPU #1 活动: 是`；Glean `gfx.status.compositor="webrender"`。见 §5-H1 |
| C1b | Glean 存储可否解出用户真实渲染量化数据 | **PASS（本轮突破）** | 格式破解并交叉验证；`on_time 98.20%` / `slow_composite 0.61%` / `skipped_composites 1173`。见 §4.6 |
| C2 | H2 分数缩放+DPR2 下每帧重光栅，Blink 复用图层 | **部分支持（推断）/ 对照侧未证；"每帧全幅"机制已作废** | partial present 实为开启（`max-partial-present-rects` 默认 1）。见 §5-H2 及 `decision-log-analysis.md` |
| C5 | 决策日志三条降级（`WEBRENDER_COMPOSITOR`/`DMABUF_SURFACE_EXPORT`/`MESA_THREADING`）的实际后果 | **已判读（含三处更正）** | 本 revision 源码逐条取证，见 `decision-log-analysis.md` |
| C3 | H3 `GTK_MODULES=…atk-bridge` 强制 a11y | **PASS（确为 Active，跨线引用）** | 见 §5-H3 |
| C4 | H4 snap 打包导致 GPU/EGL 能力缺失 | **REFUTED（无 snap 相关失败签名）** | 见 §5-H4 |
| D1 | 活体进程 fd 是否持有 `/dev/dri` | **INCONCLUSIVE** | `/proc/9042/fd` 可列目录（191 项），但**每个 readlink 目标都被拒**（`权限不够`）⇒ 无法判断是否持有 render 节点。**注意：早前「无 dri fd」是假阴性（对目录跑 `head`），已撤销** |
| D2 | 活体进程 `environ`（MOZ_*/LIBGL_*/DISPLAY） | **INCONCLUSIVE（被拒）** | `/proc/9042/environ` 权限不够；父进程 gnome-shell 4139 的 environ 同样被拒 ⇒ 无法直接读 `MOZ_X11_EGL`/`LIBGL_ALWAYS_SOFTWARE` |
| D3 | 活体进程 `maps`（确认 libEGL/radeonsi/llvmpipe 是否装载） | **INCONCLUSIVE（被拒）** | `/proc/9042/maps`、`smaps`、`smaps_rollup`、`/proc/9042/root` 全部权限不够 |
| D4 | 运行期实测「软光栅 vs GPU 阻塞」 | **INCONCLUSIVE（样本无效）** | 采样时机器 1.6% 空闲、Firefox 仅 0.04 核 ⇒ 静置样本，**不能判别**；要判别需在动画进行中采样，而驱动用户浏览器被纪律禁止 |
| D5 | 远程/内核侧 GPU 客户端归属 | **INCONCLUSIVE（被拒）** | `/sys/kernel/debug/dri/*/clients` 权限不够（需 root） |

---

## 2. 任务项 1：Firefox 真实图形配置（文件读）

### 2.1 取值来源与绝对路径

| 项 | 值 |
|---|---|
| Firefox 版本 / snap rev | **155.0.1-1, rev 8863**（`snap list firefox`；`current -> 8863`） |
| BuildID | `20260904071051`（platform）/ `20260904061719`（app） |
| SourceStamp | `5fdfd0092780e85643e2cddc0e1b590c8b9ef860` |
| profile 目录 | `/home/CNS2026495165/snap/firefox/common/.mozilla/firefox/g05ps3km.default` |
| `prefs.js` | `-rw------- 28757 B, mtime 2026-09-22 10:55` |
| 会话协议 | `IsWayland: 0`、`gfx.linux_window_protocol = "x11"` ⇒ **X11 确认** |
| 活体 pid | **9042**（父=gnome-shell 4139），审计期间持续存活 |

### 2.2 图形相关 prefs：**全部为默认**（关键结论）

精确命令与结果（完整见 `raw/prefs-forensics.txt`）：

```
grep -nE '^user_pref\("(gfx|layers|webgl|apz|widget|dom\.webgpu|
          general\.smoothScroll|mousewheel|ui\.|browser\.display|layout\.css)' prefs.js
⇒ NO MATCHES (exit 1)
```

230 条 `user_pref` 的前缀分布：`services 67 / browser 61 / extensions 22 / media 12 / app 11 / privacy 7 / toolkit 6 / sidebar 6 / nimbus 5 / devtools 4 / datareporting 4 / storage 3 / pdfjs 3 / distribution 3 / signon 2 / network 2 / dom 2 / doh-rollout 2 / captchadetection 2 / trailhead 1 / places 1 / messaging-system-action 1 / idle 1 / gecko 1 / accessibility 1`。

**唯一沾边的 4 条**（均与合成/光栅无关）：

```
user_pref("accessibility.typeaheadfind.flashBar", 0);
user_pref("dom.forms.autocomplete.formautofill", true);
user_pref("dom.push.userAgentID", "8040f97cee8c430897fd24ab6a8a7bad");
user_pref("gecko.handlerService.defaultHandlersVersion", 1);
```

Telementry 侧交叉确认，`environment.settings.userPrefs` 里唯一被上报的图形相关项是：
`widget.content.gtk-high-contrast.enabled = true`。

> 含义：**用户从未手改 Firefox 图形开关**。因此「Firefox 走哪条路」完全由 **Firefox 155 的默认策略 + 环境（GPU 驱动/EGL/合成器）** 决定。这条**排除**了「用户把 WebRender 关了」这一类原因。

### 2.3 GPU 产物 / 缓存 / 快照

| 路径 | 状态 |
|---|---|
| `…/g05ps3km.default/gfx-blacklist.xml` | **不存在**（Linux 无此文件，正常） |
| `…/g05ps3km.default/*.jsonlz4` | 不存在于 profile 根（`search.json.mozlz4` 等不含图形信息） |
| `~/.cache/mozilla` | **不存在** |
| `~/.mozilla` | **不存在**（全走 snap 布局） |
| `~/snap/firefox/common/.cache/mozilla/firefox/g05ps3km.default/` | 存在；含 `cache2/ startupCache/ thumbnails/ safebrowsing/ settings/` —— **无图形日志** |
| `~/snap/firefox/common/.cache/mesa_shader_cache/` | **存在，103 个 fanout 目录**；`marker` 的 mtime = **2026-09-22 10:05**（≈ Firefox 启动时刻）。⇒ 该时刻有 Mesa GL 客户端创建了 shader cache。**弱证据、归属未证实**（gnome-shell 等亦用 Mesa） |
| `Crash Reports/pending/*.extra` | **2 份，含完整 `TelemetryEnvironment`**（本文核心证据） |
| `datareporting/archived/2026-09/*.main.jsonlz4` | **64 份含 `system.gfx`**（逐会话图形环境，可解） |
| `saved-telemetry-pings/`、`glean/pending_pings/` | **空** |
| `datareporting/glean/db/data.safe.bin` | 422 KB，含 `gfx.*` **指标 schema**（含 `gfx.content.frame_time.reason/{on_time,no_vsync,missed_composite*,slow_composite}`、`gfx.checkerboard.*`、`gfx.composite_time`…），但为 Glean 自有二进制存储，**未解析出数值**（见 §7） |

### 2.4 `/dev/dri` + snap 接口

```
snap connections firefox:
  opengl          firefox:opengl        :opengl            -
  content[gpu-2404] firefox:gpu-2404    mesa-2404:gpu-2404 -
  browser-support firefox:browser-sandbox :browser-support -
  wayland / x11 / hardware-observe  均已连接
/dev/dri:  renderD128 (226,128)  renderD129 (226,129)  card1  card2   ← 全部 root:render 0660+
```

**未执行** `snap run --shell firefox`（按纪律，可能拉起 GUI）。

---

## 3. 任务项 2：独立实例能否复现 Gecko 渲染路径

- **Playwright Firefox：不存在。** `~/.cache/ms-playwright/` 仅 `chromium-1148`、`chromium_headless_shell-1148`、`ffmpeg-1010`。决定性验证是问 Playwright 自己：`firefox.executablePath()` → `/home/CNS2026495165/.cache/ms-playwright/firefox-1466/firefox/firefox`，**`exists: false`**（chromium 同为 `exists: true`）。⇒ 未安装即未安装，**没有编造任何探测值**（`gecko-headless-probe.json` 明确标 `"status": "NOT_RUN"`，字段全 `null` 表示「未尝试」而非「不支持」）。
- **同机 headless Gecko 可用但不可替证。** 他线用 snap Firefox 自带 RemoteAgent/BiDi 跑 headless，`gecko-vs-blink/logs/ff-smoke.log` 原文：

  ```
  [307734] Sandbox: CanCreateUserNamespace() unshare(CLONE_NEWPID): EPERM
  *** You are running in headless mode.
  WebDriver BiDi listening on ws://127.0.0.1:18831
  Crash Annotation GraphicsCriticalError: |[0][GFX1-]: RenderCompositorSWGL failed
    mapping default framebuffer, no dt (t=0.553111) …
  ```

  这条证明**同机 headless Gecko 落到 SWGL（软件 WebRender 合成器）**，与 §5-H1 的历史样本同源。
- **价值边界（必须明说）**：headless 无 X11、无 mutter、无分数缩放降采样、无 radeonsi EGL 合成、无 GTK a11y 重排。它能证明的只是**构建级/软件路径**事实——而这些我用静态与遥测手段已经免费拿到了。**用户的合成路径只能从活体进程 + 遥测刻画**，本轮已完成。

---

## 4. 任务项 3 所需的机制事实：Firefox 自报的逐会话图形环境

### 4.1 当前会话（最新 main ping `1790043145834…main.jsonlz4`，2026-09-22 10:12，reason=`environment-change`）

```json
"gfx": {
  "ContentBackend": "Skia", "Headless": false, "TargetFrameRate": 60, "textScaleFactor": 1,
  "adapters": [
    { "description": "AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino,
                       LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)",
      "vendorID": "0x1002", "deviceID": "0x13c0",
      "driverVendor": "mesa/radeonsi", "driverVersion": "25.2.8.0", "GPUActive": true },
    { "vendorID": "0x10de", "deviceID": "0x2684", "GPUActive": false }
  ],
  "monitors": [ { "screenWidth": 5120, "screenHeight": 2880,
                  "defaultCSSScaleFactor": 2, "contentsScaleFactor": 2 } ],
  "features": {
    "compositor": "webrender",
    "hwCompositing":     { "status": "available" },
    "webrender":         { "status": "available" },
    "gpuProcess":        { "status": "unused"    },
    "wrCompositor":      { "status": "blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED" },
    "openglCompositing": { "status": "available" }
  }
}
```

会话标量（parent）：`gfx.linux_window_protocol = "x11"`、`gfx.os_compositor = false`、`gfx.supports_hdr = false`、**`a11y.backplate = true`**。
`processes.gpu` 段为**空**（histograms/scalars 全空）——与 `gpuProcess: "unused"` 自洽。

### 4.2 逐会话时间线（64 个含 gfx 的 main ping，只列变化点）

| 时间 | reason | compositor | 活动 GPU | monitor | cssScale | contentsScale |
|---|---|---|---|---|---|---|
| 2026-08-10 17:19 | aborted-session | webrender | **0x10de / nvidia/unknown** | 3840×2160 | 1 | 1 |
| 2026-08-10 17:26 | aborted-session | webrender | 0x10de / nvidia/unknown | **5120×2880** | **2** | 1 |
| 2026-09-12 14:53 | aborted-session | webrender | 0x10de / nvidia/unknown | 5120×2880 | 2 | **2** |
| **2026-09-20 17:18** | **environment-change** | webrender | **0x1002 / mesa/radeonsi** ← 切换 | 5120×2880 | 2 | 2 |
| 2026-09-22 10:12 | environment-change | webrender | 0x1002 / mesa/radeonsi | 5120×2880 | 2 | 2 |

**`wrCompositor = blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` 自 2026-08-10 起每一个 ping 都相同 —— 从未变过。**

### 4.3 两次 crash 注解（`.extra`）

| 字段 | `17307ff6…extra`（2026-09-21 16:25） | `7c771e5f…extra`（2026-09-04 18:36） |
|---|---|---|
| Version / BuildID | **155.0.1** / 20260904071051 | 141.0 / 20250718161710 |
| 活动 GPU | AMD `0x1002`/`0x13c0` `mesa/radeonsi` 25.2.8.0 | NVIDIA `0x10de`/`0x2684` `nvidia/unknown` 595.84.0.0 |
| **`GraphicsCriticalError`** | **（无）** | **`|[0][GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt (t=1431.43)`** |
| `Accessibility` | **`Active`** | **`Active`** |
| `IsWayland` / `HeadlessMode` | `0` / `0` | `0` / `0` |
| `GpuSandboxLevel` / `ContentSandboxLevel` | **`0`** / `6` | **`0`** / `6` |
| `GraphicsNumActiveRenderers` / `…Renderers` | 4 / 3 | 2 / 3 |
| `Notes` | `-L1000-W0001000-T1) WR? WR+ ` | `FP(D10-L1000-W0000000-T01) WR? WR+ ` |
| 崩溃原因 | `MOZ_CRASH(OOM)`，`OOMAllocationSize` 2.2 GB | `MOZ_CRASH(IPC message size is too large)` |
| `URL` | `http://127.0.0.1:3080/` | `http://127.0.0.1:3080/` |

> 两次 `Notes` 都是 **`WR+`**（WebRender 启用）。两者都 `Accessibility: Active`。**2026-09-04 那份带 `RenderCompositorSWGL` 报错，是「本机确实跑过软件 WebRender」的硬证据。**

### 4.4 活体进程线程名（决定性的一手观测）

```
/proc/9042/task/*/comm  (逐字节，grep 'WR'):
  1 WRRende~ckend#0     1 WRRende~ckend#1          ← WRRenderBackend#N（>15 字符被 '~' 截断）
  1 WRScene~ilder#0     1 WRScene~ilder#1          ← WRSceneBuilder#N
  1 WRScene~derLP#0     1 WRScene~derLP#1         ← WRSceneBuilderLP#N
  1 WRWorker#0 …        1 WRWorker#3              ← 4 个
  1 WRWorkerLP#0 …      1 WRWorkerLP#7            ← 8 个
另含：Compositor / Renderer / WrGlyphRasterizer / SoftwareVsyncThread / CanvasRenderer / ImageBridgeChld
```

**更正一条子代理的静态推论（重要）**：子代理据 `libxul.so` 中 `WRWorkerLP#` 字面量计数为 0，推断「本构建没有低优先级池，`WRWorkerLP#` 永不可能出现」。**该推论被上面的一手观测推翻** —— 名字是运行时拼装的（`WRWorker` 字面量存在 2 次，`#`+序号另行拼接），因此**字面量缺失不能证明池不存在**。以**活体 `/proc` 观测为准**。

**✅ 该悬念已于后续闭合**（本 revision `StaticPrefList.yaml`）：
```yaml
- name: gfx.webrender.enable-low-priority-pool
#if defined(ANDROID)
  value: false
#else
  value: true        ← 本机构建默认开启
#endif
- name: gfx.webrender.render-backend-thread-count
  value: 2
```
⇒ ① **`WRWorkerLP#N` 是默认开启的「低优先级池」，是蓄意特性，与软件光栅无关**（进一步支持上面的更正）；
② `render-backend-thread-count = 2` 与活体实测的 **`WRRenderBackend#0/#1` 恰好 2 条**吻合 ⇒ **独立验证了我上轮的线程名读取可靠**。

### 4.5 libxul.so 字面量指纹（本构建，183,575,264 B）

| 存在 | 不存在 |
|---|---|
| `WRWorker#`(1) `WRRenderBackend`(1) `WRSceneBuilder`(2) `WRSceneBuilderLP`(1) `WrGlyphRasterizer`(1) | **`WRWorkerLP#`(0)**、`WRWorkerLP`(0)、`RenderCompositorLayers`(0) |
| `RenderCompositorSWGL`(6) `RenderCompositorOGL`(8) `RenderCompositorOGLSWGL`(4) `RenderCompositorEGL`(7) `RenderCompositorNative`(4) | `Direct3D 11`(0) |
| `SoftwareVsyncThread`(1) `X11_EGL`(6) `MOZ_X11_EGL`(1) `MOZ_WEBRENDER`(1) | |
| `gfx.webrender.software`(4) `gfx.webrender.compositor`(8) `gfx.x11-egl.force-enabled`(2) `WEBRENDER_PARTIAL`(2) | `gfx.webrender.partial-present`(0) |
| **`WebRender (Software)`(1)** `WebRender`(148) `OpenGL`(21) `Basic`(63) `Compositing`(18) | `Decision Log`/`Failure Log`/`GPU #1`（在 omni.ja 里，不在 libxul） |
| `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`(1) | |

> **`WebRender (Software)` 这个合成值字符串存在于本构建的 libxul.so** ⇒ 若用户 `about:support` 显示它，即为软件 WebRender。

---

### 4.6 解出 Glean 存储（本轮最主要的额外突破）

`datareporting/glean/db/data.safe.bin`（422,377 B，非 LMDB，是 Glean "safe" 序列化格式）**已成功解析**，格式为：

```
[u64 keylen][key bytes][u64 reclen][u8 tag][u64 paylen][payload]     其中 reclen == 1 + 8 + paylen
```

**解码已用已知量交叉验证（非猜测）**：
`gfx.display.primary_width` = **5120** ✓、`primary_height` = **2880** ✓、`display.count` = 1 ✓、`target_frame_rate` = **60** ✓、`linux_window_protocol` = **`"x11"`**（3 字符）✓、`content_backend` = **`"Skia"`**（4 字符）✓、`status.last_compositor_gecko_version` = **`"155.0.1"`**（7 字符）✓。
⇒ tag `6`=整数、`7`=字符串、`1`=计数器、`2/3/11`=分布、`17`=对象/映射。

**① 合成器状态（对应 about:support 的 `Compositing`）**

| 指标 | 记录值 |
|---|---|
| **`gfx.status.compositor`** | **`"webrender"`** ← **不是** `webrender_software` |
| `gfx.features.compositor` | `"webrender"` |
| `gfx.feature.webrender` | `"available"` |
| `gfx.features.webrender` | `{"status":"available"}` |
| `gfx.features.hw_compositing` | `{"status":"available"}` |
| `gfx.features.opengl_compositing` | `{"status":"available"}` |
| `gfx.features.gpu_process` | `{"status":"unused"}` |
| `gfx.features.wr_compositor` | `{"status":"blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED"}` |
| `gfx.status.headless` | 空 ⇒ 非 headless |

**关键**：`grep -a -o -F 'webrender_software' libxul.so` → **1 处存在**；`grep -a -o -F 'WebRender (Software)'` → **1 处存在**。即**软件取值在取值域内、本构建可表达，但实际记录值是 `webrender`**。

**精度声明（不要把这条推得比证据更远）**：
- `\x00webrender\x00` 与 `\x00webrender_software\x00` 都是**独立的 NUL 分隔字面量**（各 1 处），`\x00basic\x00` 2 处 ⇒ 与「存在一个含软件变体的取值枚举」一致；
- **但** `webrender_software` 所处的是**通用字符串池区域**（相邻为 `draw_buffers`/`frag_depth`/`EGL_KHR_*`），**不是**与其它合成器取值紧邻的枚举区；且 `opengl`/`d3d11` 无独立字面量 ⇒ **「它属于 `gfx.status.compositor` 的取值枚举」这一层是推断、未获 Mozilla 官方 `metrics.yaml` 佐证**。
- 因此结论强度定为 **LIKELY（倾向）**，而非 CONFIRMED；**终审仍是 `about:support` 的 `Compositing` 一行**。

**② 用户真实累计帧时间归因（`gfx.content.frame_time.reason/*`）**

| reason | 累计计数 | 占比 |
|---|---|---|
| **`on_time`** | **101,469** | **98.20%** |
| `missed_composite` | 1,020 | 0.99% |
| **`slow_composite`** | **632** | **0.61%** |
| `missed_composite_low` | 159 | 0.15% |
| `missed_composite_long` | 37 | 0.04% |
| `missed_composite_mid` | 9 | 0.01% |
| `no_vsync` / `no_vsync_no_id` | 1 / 1 | ~0% |
| **合计** | **103,328** | 100% |

另：**`gfx.skipped_composites` = 1,173**；`gfx.display.primary_width/height = 5120/2880`。

**caveat（必须随结论一起引用）**：这些是 **Glean store 生命周期内的累计值**（store 最后写入 2026-09-22 11:00），**不是**针对 Codex 页面、**不是**逐会话，且被大量普通/静置帧稀释。因此它**不能**证明「Codex 页面不卡」，但**足以否证**「Gecko 合成器长期大规模掉帧」这一强表述。

---



## 5. 机制假设清单（含验证方式与已有支持/反对证据）

### H1｜Firefox 走**软件 WebRender** ⇒ 5120×2880 + DPR2 下光栅化爆炸
**裁决：对当前会话 CONFIRMED REFUTED（硬件 WebRender）；历史上确实发生过（NVIDIA 期）**

> ✅ **本条已由用户实测终审**：`about:support` → **`合成: WebRender`**、`GPU #1` AMD radeonsi **活动: 是**、`GPU #2` 4090 **活动: 否**。
> 我上轮基于 Glean `gfx.status.compositor = "webrender"` 的推断**获证**。以下"反对"证据现在是结论性证据。

- **支持（仅对历史会话成立）**
  1. **`wrCompositor` 在全部 64 个 ping 中都是 `blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`** ⇒ Firefox **拿不到原生 WebRender 合成器**（EGL/DMABUF 直通路径关闭）。
  2. **硬证据（历史）**：2026-09-04 crash 直接把 `RenderCompositorSWGL failed mapping default framebuffer, no dt` 写进 `GraphicsCriticalError` ⇒ **SWGL 在这台机器上被真实选中过**，不是纸面可能。
  3. **同机 headless Gecko 复现同一签名**（`gecko-vs-blink/logs/ff-smoke.log`）。
  4. 该失败历史样本出现在 **NVIDIA 期**；NVIDIA 专有驱动 + X11 历来是 Gecko 退回 SWGL 的典型场景。
- **反对（针对当前会话，且更强）**
  1. ⭐ **`gfx.status.compositor = "webrender"`**（当前会话 Glean 记录值，store 最后写入 2026-09-22 11:00）——**不是 `webrender_software`**。而 `webrender_software` 这一取值在本构建 `libxul.so` 中**存在**（1 处字面量）⇒ 取值域包含软件变体，但**未被使用**。
  2. **`WebRender (Software)`** 这个 about:support 显示串**只存在于 libxul.so，未出现在任何已记录状态中**。
  3. 当前会话活动 GPU 是 **Mesa radeonsi**（`GPUActive: true`），`openglCompositing: available`、`hwCompositing: available` —— Mesa 路径通常**能**给出硬件 WebRender。
  4. 9 月 21 日那份 155.0.1 crash 里**没有 `GraphicsCriticalError`**（弱反对：那是 content 进程 OOM 崩溃，合成器在 parent 进程，缺失不构成强反证）。
  5. **`WRWorker`/`WRWorkerLP` 线程的存在本身不足以证明 SWGL**：硬件 WebRender 也需要 worker 池做 blob image / 字形 / 图像解码光栅。§4.4 已更正子代理的静态推论（字面量缺失 ≠ 池不存在）。
- **如何终审（一行）**：`about:support` → Graphics → Features → **`Compositing`**：
  - `WebRender (Software)` ⇒ H1 **成立**（推翻上面的倾向性结论，说明 Glean 状态串语义与我推断不同）；
  - `WebRender` ⇒ H1 **当前不成立**，与 Glean 记录一致。
  辅助：`Failure Log` 是否含 `RenderCompositorSWGL failed mapping default framebuffer`；`about:config` 的 `gfx.webrender.software`。

### H1-补｜若 H1 不成立，Firefox 为什么仍比 Blink 慢？（当前证据下的最可能解释）
1. **下游呈现成本（应用无关，最大项）**：mutter 把 **5120×2880 双线性降到 3840×2160**，每帧 1.78× 过绘 + 全屏重采样，且合成跑在 **2 CU 的 Raphael 核显**上。Chrome 与 Firefox 都吃这一刀 —— 这解释了「两处症状同源」。
2. **Gecko 特有的次要项**：`wrCompositor` 被禁 ⇒ Firefox 拿不到原生合成器/脏区直通，走的是「WR 渲染 → 合成上传」的通用路径；而 Blink/Chromium 在 X11 上用自己的合成器 + damage rect / partial present。这**可能**是 Firefox 相对 Blink 的额外开销，**但本轮没有 Blink 侧对照证据**（有头 Chromium 在本机被杀、headed 测量四次全崩），**只能作为假设**。
3. **不属于 Gecko 的项**：a11y 强制 Active（H3）、DLP `twatermarkext` 每帧水印（他线 G3）—— 对所有 X11 客户端一视同仁。


### H2｜分数缩放 + DPR2 下 Firefox 对动画内容每帧重光栅，而 Blink 复用图层
**裁决：机制一半 SUPPORTED（推断）/ 对照一半 INCONCLUSIVE**

> ⚠️ **本条已按用户 `about:support` 更正**：原先"`wrCompositor` 被禁 ⇒ 无脏区快车道 ⇒ 每帧全幅"的**机制推断作废** ——
> `gfx.webrender.max-partial-present-rects` 在 `MOZ_WIDGET_GTK` 下默认 **1**（本 revision `StaticPrefList.yaml`），
> `RenderCompositorEGL::UsePartialPresent()` 因此返回 **true**（`RenderCompositorEGL.cpp:298–299`），
> 并配 `EGL_KHR_partial_update` + `EGL buffer age`（同文件 312–350）⇒ **X11 下局部呈现是开着的**。
> 详见 `decision-log-analysis.md` §1.4。

- **仍然成立的部分**：Firefox 自报 **`Display0: 5120x2880@60Hz scales:2.000000`、`窗口设备像素比: 2, 2`** ⇒ 按 **DPR=2** 光栅到 **5120×2880**，而面板只有 3840×2160（8.29 Mpx）⇒ **应用侧 1.78× 过绘**（与他线 G1 独立互证）。他线受控面积实验：同一 ripple `1280×720` → 60.01 fps / 丢帧 0；`5120×2880` → **44.25 fps / 丢帧 14（26.4%）**，单帧 JS 仅 0.1–0.2 ms ⇒ **成本跟 backing surface 面积走，卡在呈现侧**。
- **已作废的部分**：「每帧整幅重绘」不再是有效解释。
- **仍未证的部分**：「Blink 复用图层」这半边**本轮没有取到任何 Blink 侧对照证据**（有头 Chromium 在本机被 SIGTRAP 杀、headed 测量四次全崩）⇒ 只能是假设。
- **如何验证**：
  - `about:support` Decision Log 读 **`WEBRENDER_PARTIAL`**（若 `disabled/blocked` ⇒ 确认无脏区快车道）。
  - Firefox Profiler 看 `Compositor` 线程每帧 `CompositeToTarget`/上传是否覆盖整幅。
  - 对照：把缩放临时改回 100%（原生 3840×2160）复测同一页面 —— 若两端同时变好，则瓶颈主要是 **DPR2/面积**，不是 Gecko 独有的图层策略。

### H3｜`GTK_MODULES=…atk-bridge` 强制 a11y
**裁决：PASS（a11y 确为 Active，跨线引用，不重复取证）**

- **他线证据（引用，不重复）**：`/etc/environment` 导出 `ACCESSIBILITY_ENABLED=1`/`GNOME_ACCESSIBILITY=1`；`/etc/environment.d/90atk-adaptor.conf` 强制 `GTK_MODULES=…gail:atk-bridge`；5 个进程带 `--force-renderer-accessibility`；而用户自身 a11y 偏好全 false。
- **本线独立佐证（我自己的两条新证据）**：
  1. **两次 crash 注解均为 `Accessibility: "Active"`** —— 覆盖 2026-09-04（141.0）与 2026-09-21（155.0.1）两个版本。
  2. **当前会话 telemetry 标量 `a11y.backplate = true`**（20/20 ping 皆 true），且唯一被上报的图形相关 userPref 是 `widget.content.gtk-high-contrast.enabled = true` ⇒ **a11y/高对比整合通道是活的**。
- **如何验证**：`about:support` → **Accessibility** 段读 **`Activated`**（true/false）与 **`Prevent Accessibility`**；或关于因果用 `accessibility.force_disabled=1` A/B（属他线）。
- **归属提醒**：我确认的是「a11y 处于 Active」这一**事实**；**它是否构成卡顿的因果贡献，不在本线证据范围内**。

### H4｜snap 打包导致 GPU/EGL 能力缺失
**裁决：REFUTED（无 snap 相关失败签名）—— 与本线及他线一致**

- **独立反证（我本轮自己取到的）**
  1. `snap connections firefox`：**`opengl` 已连接**、**`content[gpu-2404]` → `mesa-2404:gpu-2404` 已连接**（Mesa 用户态由 mesa-2404 content snap 提供，rev 1839 = `25.2.8-snap288`）。
  2. `/dev/dri` 四个节点齐备（`renderD128/D129`、`card1/card2`）。
  3. Firefox **自报 GPU 枚举成功**：`AdapterDriverVendor: mesa/radeonsi`、`driverVersion 25.2.8.0`、描述串含 `raphael_mendocino, LLVM 20.1.2, DRM 3.61`、**`GPUActive: true`**；`GpuSandboxLevel: 0`。
  4. `~/snap/firefox/common/.cache/mesa_shader_cache/` 有 **103 个 fanout 目录**（snap 自带 Mesa 确实在编译/缓存着色器）。
  5. `wrCompositor` 的 blocklist **原因是 `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`（=「默认关闭」）**，**不是**任何 snap/EGL 失败码（如 `EGL_CREATE`/`EGL_INIT`/`NO_DMABUF`/`NO_DRM_DEVICE` —— 这些码在本构建里存在，但**没有出现**）。
- **残余不确定（如实标注）**：`/proc/9042/environ`、`maps`、`fd` 目标全被拒 ⇒ 「EGL 是否真的 initialize 成功」是**由 GPU 枚举成功 + Mesa shader cache 推断**，非直接观测。
- **本轮独立加验（ACL，非引用他线）**：
  ```
  getfacl -p /dev/dri/renderD128  →  user::rw-   user:CNS2026495165:rw-   group::rw-   mask::rw-   other::---
  getfacl -p /dev/dri/renderD129  →  同上
  ```
  ⇒ **该用户对两个 render 节点均有 effective rw**（`mask::rw-`）。
  注意：`id` 显示该用户**并不在 `render(992)` / `video(44)` 组内**，其访问权**完全来自这条显式 ACL** —— 这正是 snap/桌面侧为该用户单独授权的证据，**直接否证**「snap 拿不到 GPU 设备」。
- **如何验证**：`about:support` → **GPU #1** 段读 `Driver Vendor`=`mesa/radeonsi` / `Driver Version`=`25.2.8.0`；Failure Log 是否含任何 EGL/DMABUF 失败码。

---

## 6. 任务项 4：零风险可观测的下一步（**要抄给我的确切字段名**）

### 6.1 首选：`about:support` → Graphics 段（纯读，零风险）

以下字段名**取自本机 Firefox 155 自己的 `aboutSupport.ftl` / `aboutSupport.js`**（我已从 snap 的 `omni.ja` 中提取，见 `raw/aboutSupport.ftl`、`raw/aboutSupport.js`），**不是凭记忆**：

Graphics 段结构（顺序）：
`Graphics` → **`Features`** / **`Diagnostics`** / **`GPU #1`** / **`GPU #2`** / **`Decision Log`** / **`Failure Log`** / **`Crash Guard Disabled Features`** / **`Workarounds`**

**Features 表里的行（按代码顺序）**：

| 要抄的确切字段名 | 本机预期读数 | 两种取值的含义 |
|---|---|---|
| **`Window Device Pixel Ratios`** | `2`（或 `2 (5120x2880)`) | `2` ⇒ DPR2 生效、应用按 14.75 Mpx 光栅；`1` ⇒ 缩放没生效（对比实验的关键） |
| **`Compositing`** ⭐ | 待读 | **`WebRender (Software)` ⇒ 软件 WebRender（SWGL）成立，H1 确认，CPU 按 14.75 Mpx 光栅**；**`WebRender` ⇒ 硬件 WebRender**；`OpenGL` ⇒ 未用 WR；`Basic` / `BasicLayers (main thread only)` ⇒ 更差（无独立合成线程） |
| `Async Pan/Zoom` | 若干项 Enabled | 无 |
| `WebGL 1 Driver Renderer` / `WebGL 2 Driver Renderer` | `AMD … (radeonsi, raphael_mendocino, …)` | 若显示 **`llvmpipe`** ⇒ WebGL 走 Mesa 软件光栅（**注意：这与 SWGL 不是一回事**，SWGL 是 Mozilla 自研软件光栅器，不是 llvmpipe/SwiftShader） |
| `WebGL 1 Driver Version` / `WebGL 2 Driver Version` | `25.2.8.0` | — |
| `H264 Hardware Decoding` | 待读 | 无 |
| **`Window Protocol`** | `x11` | `wayland` ⇒ 路径完全不同，结论要重做 |
| **`Desktop Environment`** | `ubuntu:gnome` | — |
| **`Target Frame Rate`** | `60` | 若为 `0`/异常 ⇒ 无 vsync 源 |
| `WebGPU Default Adapter` / `WebGPU Fallback Adapter` | — | 无 |

**`GPU #1` 段（确认活动 GPU 与驱动）**：

| 确切字段名 | 本机预期 |
|---|---|
| `Description` | `AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)` |
| `Vendor ID` / `Device ID` | `0x1002` / `0x13c0` |
| **`Driver Vendor`** | **`mesa/radeonsi`**（若是 `llvmpipe` ⇒ 软件 GL） |
| **`Driver Version`** | **`25.2.8.0`** |
| `Driver Date` / `Drivers` | — |

**`GPU #2`**：应显示 NVIDIA（`0x10de` / `0x2684`）且**非活动**。

**`Decision Log`（逐行 `<FEATURE>: <status>: <message>`）—— 重点抄这几行的状态**：
- **`WEBRENDER_COMPOSITOR`** ← 已知必为 `disabled`（`FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`）⇒ **无原生合成器/无脏区快车道**
- **`WEBRENDER_SOFTWARE`** ⇒ `available` = 允许回退软件；`disabled` = 软件被禁（那就不可能是 SWGL）
- **`WEBRENDER_PARTIAL`** ⇒ 若 `disabled/blocked` ⇒ **确认没有 partial present**（H2 的机制坐实）
- `WEBRENDER` / `WEBRENDER_QUALIFIED` / `HW_COMPOSITING` / `OPENGL_COMPOSITING` / `GPU_PROCESS`
- `X11_EGL`（或 `X11_EGL_PARITY`）⇒ EGL 是否可用/是否被迫
- 任何以 **`WEBRENDER_OLD_MESA` / `WEBRENDER_NEED_HWCOMP` / `NO_DMABUF` / `NO_DRM_DEVICE` / `EGL_CREATE` / `EGL_INIT` / `DISABLED_BY_FALLBACK_SOFTWARE_WEBRENDER`** 结尾的行 ⇒ 直接指出退回原因（这些失败码我已从本构建 libxul.so 全量提取）

**`Failure Log`**：找 **`RenderCompositorSWGL failed mapping default framebuffer, no dt`**（本机已两度出现 ⇒ 出现即软件路径）。

**`Accessibility` 段**（H3）：`Activated`（true/false）、`Prevent Accessibility`。

> 最省事：Graphics 段右上角 **`Copy text to clipboard`**（同样在本机 ftl 中确认）→ 整段贴给我即可。

### 6.2 次选：`about:config`（只读搜索，零风险）

搜索框输入 `gfx.webrender`，抄这几项的**当前值**：

| 键 | 含义（两种取值） |
|---|---|
| **`gfx.webrender.software`** | `true` ⇒ **强制软件 WebRender（SWGL）**；`false`/未设置 ⇒ 由决策逻辑选 |
| `gfx.webrender.all` | `true` ⇒ 无视黑白名单强制 WR；`false` ⇒ 走正常判定 |
| **`gfx.webrender.compositor`** | `true` ⇒ 启用原生 WR 合成器（本机被 blocklist，读它可确认是否真为默认 false） |
| `gfx.x11-egl.force-enabled` | `true` ⇒ 强制 X11 上走 EGL；`false` ⇒ 由探测决定 |
| `layers.acceleration.force-enabled` | `true` ⇒ 强制 GPU 加速；`false` ⇒ 默认 |

**我已证实这些键在本 profile 里全部未被用户设置过**（§2.2），所以读到的都是默认值 —— 这一读只是把默认值显式化。

### 6.3 最高性价比的「活体证据」：Firefox Profiler（零风险、决定性）

`about:profiling` → 勾选线程/CPU → 开始录制 → **复现卡顿 5 秒** → 停止 → 看火焰图的**线程泳道**：

- `WRWorker*` / `WRWorkerLP*` 线程**持续吃满 CPU** ⇒ **软件光栅（SWGL）**，H1 直接坐实；
- 只有 `Compositor` / `WRRenderBackend` 活动而大量**空闲/等待**，但帧仍迟到 ⇒ 瓶颈在**呈现/下游（mutter 合成 + 5120→4K 双线性降采样）**，与 H1 无关；
- `Renderer` 线程若长期停在 `RenderCompositorSWGL*` 或 `CompositeToTarget` 全幅上传 ⇒ H2 的「每帧整幅」坐实。

这条是**唯一能在不依赖 `about:support` 文字、且不改任何配置**的前提下把 H1/H2 分开的动作，且线程名可用（已确认本机线程名含 `WRWorker#N`/`WRWorkerLP#N`）。

---

## 7. 未能取得的信息（及确切原因）

| # | 未取得 | 确切原因 |
|---|---|---|
| 1 | `/proc/9042/environ`（MOZ_*/LIBGL_*/DISPLAY/MOZ_X11_EGL） | **权限不够**（Firefox 对自身进程设了不可 dump；父进程 gnome-shell 4139 的 environ 同样被拒）。⇒ 无法直接确认 `MOZ_X11_EGL`/`LIBGL_ALWAYS_SOFTWARE` |
| 2 | `/proc/9042/maps`、`smaps`、`smaps_rollup` | **权限不够**（需 root/ptrace）⇒ **无法确认 libEGL.so / radeonsi_dri.so / llvmpipe 是否已装载**，这是 H1 本可最直接的一刀 |
| 3 | `/proc/9042/fd` 的 readlink 目标 | 目录可列（191 项），但**每个目标 readlink 都被拒**（`权限不够`）⇒ 无法判断是否持有 `/dev/dri/renderD128`。**注：早前我误用 `head` 探测目录得到「无 dri fd」的假阴性，已撤销该结论** |
| 4 | `/proc/9042/root`（snap 名字空间内 /dev） | 权限不够（他线亦同） |
| 5 | `/sys/kernel/debug/dri/*/clients`（GPU 客户端归属） | 权限不够（需 root） |
| 6 | 运行期「软光栅 vs GPU 阻塞」实测 | 采样窗口机器 1.6% 空闲、Firefox 0.04 核 ⇒ **静置样本无法判别**；要判别需在动画进行中采样，而**驱动用户浏览器被纪律禁止**，故**故意不做**（不给无意义数字） |
| 7 | ~~Glean `gfx.content.frame_time.reason/*` 等数值~~ | **已解决（本轮）**。legacy keyed histogram `CONTENT_FRAME_TIME_REASON` 在 155 中确已不再上报（全 68 个 payload 均无），但 Glean 自有存储 `data.safe.bin` 的格式**已破解并解出数值**，见 §4.6（`on_time` 98.20% / `slow_composite` 0.61%；`gfx.status.compositor="webrender"`）。**残余不确定**：Glean 各指标的**精确语义**（尤其 `webrender_software` 这个取值究竟挂在哪个指标上）**未取得 Mozilla 官方 metrics.yaml 佐证**，仅由「字面量存在 + 记录值非它」推断；`gfx.content.frame_time.from_vsync` / `gfx.composite_time` 等**分布型**指标（tag 2/3/11）的桶结构**未解析**（不影响结论） |
| 8 | Playwright Firefox 实测（`WebGL renderer`/`devicePixelRatio`/`about:support`） | `~/.cache/ms-playwright/firefox-1466/firefox/firefox` **不存在**（`exists: false`）。安装（`npx playwright install firefox`，约 90 MB）会写出我独占目录之外 ⇒ **未做**；且 headless 无 X11/无分数缩放，**对用户路径本就无证明力** |
| 9 | 既有 `MOZ_LOG`/`RUST_LOG` 日志 | `~/.bash_history` 中**零**条 MOZ_LOG/RUST_LOG/firefox 记录；全盘（`/tmp`、workspace、profile）**无** webrender/moz 日志 |
| 10 | 有头对照（Blink 侧图层复用） | 他线已证：有头 Chromium 在本机被 SIGTRAP(+DLP) 杀、4 次 headed 配方全崩、`xvfb-run` 不存在 ⇒ **headed/headless 差异 INCONCLUSIVE（样本缺失）**；我也未取得任何 Blink 侧证据 |
| 11 | `about:processes` / `about:support` **活体**抓取 | 需在用户浏览器里操作 ⇒ **纪律禁止**，只给用户自读指引 |

**推荐补做（都在授权边界内、零风险）**：
1. **用户自读 `about:support` Graphics 段**（§6.1，一分钟）⇒ 一举定案 H1/H2。
2. **解析 Glean `data.safe.bin`** 取 `gfx.content.frame_time.reason/*` 计数（纯文件读）⇒ 给出**用户真实会话**的帧时间归因（`slow_composite`/`missed_composite*` vs `on_time`），这是唯一能客观区分「合成器慢」与「内容侧慢」的既有实测数据。

---

## 8. 对主 agent 的裁决建议

1. **可直接采信（PASS）**：WebRender 开启；图形配置全默认（无用户覆盖）；活动 GPU 已从 RTX 4090 切到 AMD Raphael（2026-09-20 17:18）；DPR=2 + 5120×2880 由 Firefox 自报；原生 WR 合成器长期被禁；a11y Active；snap 未阻断 GPU。
2. ⭐ **H1 的箭头已经反转，请按「当前会话倾向硬件 WebRender」处理，而不要再按「疑似软件光栅」下发**。依据：`gfx.status.compositor = "webrender"`（而 `webrender_software` / `WebRender (Software)` 在本构建中**可表达却未被使用**）。**唯一终审**是一行 `about:support` → Graphics → Features → `Compositing`；请把这一行作为**门控问题**交回用户。若读到 `WebRender (Software)`，则 §5-H1 成立、需改回软件光栅口径。
3. ⭐ **新证据削弱了「Gecko 是主犯」：用户真实累计计数器 `on_time 98.20%`、`slow_composite 仅 0.61%`。** 这与「环境放大器」结论一致，把权重推向**下游呈现（mutter 5120→4K 双线性降采样 + 2 CU 核显）**。引用时**必须**带上「累计窗口、非逐会话、被静置帧稀释」的 caveat，**不得**用它宣称「Codex 页面不卡」。
4. **H4 可以关闭**：无任何 snap/EGL 失败签名，与本机 GPU 枚举成功、Mesa shader cache 在写、`GpuSandboxLevel: 0` 一致；请勿再投入。
5. **H2 的机制部分仍可用，但请标注强度**：`wrCompositor` 被禁 + DPR2 全幅 ⇒ 「无原生合成器/无脏区直通、每帧 14.75 Mpx」是**由 Firefox 自身遥测支持的机制**；但「Blink 复用图层」这半边**没有对照证据**（有头 Chromium 被杀、headed 测量全崩），**只能作为假设**。
6. **本轮新增的两个可复用工具/结论**：
   - **Glean 存储解析器**（格式见 §4.6）—— 可以继续挖 `gfx.checkerboard.*`、`gfx.composite_time`、`gfx.scroll_present_latency`、`gfx.composite_frame_roundtrip_time` 等，全为**只读**；这是本机唯一能拿到「用户真实渲染表现」量化数据的通道。
   - **about:support 字段名权威清单**（§6.1，取自此构建 `omni.ja` 的 `aboutSupport.ftl`/`aboutSupport.js`，非记忆）。
7. **他线可用的两个新线索**：① `mesa_shader_cache/marker` mtime 恰为 Firefox 启动时刻 10:05（弱线索，归属未证实）；② Firefox 2026-09-21 的 content 进程 **OOM 崩溃**（`OOMAllocationSize` 2.2 GB，URL = DSH GUI），而本机 64 GB 内存 —— 与「DSH 宿主内存/对象膨胀」可能有交叉价值。
8. **纪律遵守确认**：本轮未改配置、未重启、未 `pkill`、未启动用户浏览器、未执行 `snap run --shell firefox`、未传 `sandbox_permissions`；用户 Firefox pid 9042 全程存活（审计末仍 `ELAPSED 55:41`）。
