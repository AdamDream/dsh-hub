# 决策日志三条降级的实测判读（Firefox 155.0.1 / snap 8863 / X11）

**素材**：用户实测 `about:support`（见 `FIREFOX-ABOUT-SUPPORT.md`）
**源码依据**：本轮直接抓取**本构建对应 revision** 的 Gecko 源码 ——
revision `5fdfd0092780e85643e2cddc0e1b590c8b9ef860`
（来源：`payload.info.revision` 遥测字段 + `application.ini` 的 `SourceStamp`，二者一致）
抓取方式：`https://hg.mozilla.org/releases/mozilla-release/raw-file/<rev>/<path>`（只读 HTTP GET）
落盘：`firefox-gfx/src/`（12 个源文件 + `StaticPrefList.yaml`）
**纪律**：全程只读；未改任何配置；未启动用户浏览器；未 `pkill`；未传 `sandbox_permissions`

---

## 0. 先落定：我上一轮的推断已被用户实测证实

| 项 | 我上轮（Glean 解码）推断 | 用户 `about:support` 实测 | 结论 |
|---|---|---|---|
| 合成路径 | `gfx.status.compositor = "webrender"`，**不是**软件 | **`合成: WebRender`** | ✅ **推断正确**，H1（软件 WebRender）**正式否证** |
| 活动 GPU | AMD `0x1002/0x13c0` `mesa/radeonsi`，`GPUActive:true` | `GPU #1` AMD radeonsi **活动: 是**；`GPU #2` 4090 **活动: 否** | ✅ 一致 |
| 后备面 | `gfx.display.primary_width/height = 5120/2880` | `Display0: 5120x2880@60Hz scales:2.000000\|2.000000`；`窗口设备像素比: 2, 2` | ✅ 一致 |
| 帧率 | `gfx.target_frame_rate = 60` | `目标帧率 60` | ✅ 一致 |
| 协议 | `gfx.linux_window_protocol = "x11"` | `窗口协议 x11` | ✅ 一致 |
| a11y | `a11y.backplate = true` | `无障碍环境 已激活: true`、`强制停用: 0` | ✅ 一致 |

⇒ 上轮交付里被判 **LIKELY** 的那一条（`webrender_software` 是可用取值但未被选中 ⇒ 当前会话是硬件 WebRender）**现在升格为 CONFIRMED**。

---

## 1. 三条降级逐条判读（**结论与协调者的假设有三处不同**）

### 1.1 `WEBRENDER_COMPOSITOR: env: blocklisted` —— **在 X11 上是"空的"降级，没有性能代价，也**无法**通过 pref 启用**

**这条我判为：不是缺陷，也修不了（在 X11 上）。**

**(a) 它的定义**（`gfx/config/gfxFeature.h:28`）：
```c
_(WEBRENDER_COMPOSITOR, Feature, "WebRender native compositor")
```
即"原生 WebRender 合成器"。

**(b) 它在哪些平台上才可达**（`gfx/webrender_bindings/RenderCompositor.cpp`，`RenderCompositor::Create`）：
```cpp
  if (aWidget->GetCompositorOptions().UseSoftwareWebRender()) {      // 203
#ifdef XP_DARWIN ... #elif defined(MOZ_WAYLAND) ...                  // 204-209
    return RenderCompositorLayersSWGL::Create(...);                  // → SWGL 路径
  }
#ifdef XP_WIN                                                        // 232
  if (gfx::gfxVars::UseWebRenderANGLE()) return RenderCompositorANGLE::Create(...);
#endif
#if defined(MOZ_WAYLAND)                                             // 238
  if (gfx::gfxVars::UseWebRenderCompositor() &&                      // 239
      aWidget->GetCompositorOptions().AllowNativeCompositor()) {     // 240
    ... RenderCompositorLayerNativeOGL / RenderCompositorNativeOGL
  }
#endif
#if defined(MOZ_WIDGET_ANDROID) || defined(MOZ_WIDGET_GTK)           // 249
  UniquePtr<RenderCompositor> eglCompositor =
      RenderCompositorEGL::Create(aWidget, aError);                  // 251  ← 本机走这条
  if (eglCompositor) return eglCompositor;
#endif
#elif defined(XP_DARWIN) ... #else
  return RenderCompositorOGL::Create(aWidget, aError);               // 274
```
⇒ **原生合成器的分支被 `#ifdef XP_WIN` / `#if defined(MOZ_WAYLAND)` / `#elif defined(XP_DARWIN)` 包住**。Linux/GTK 在 X11 会话下落到 **`RenderCompositorEGL`**（第 249–251 行）。

**(c) 谁把它关掉的**（`gfx/thebes/gfxPlatformGtk.cpp:283–317`）：
```cpp
void gfxPlatformGtk::InitWebRenderConfig() {                          // 283
  gfxPlatform::InitWebRenderConfig();
  if (!XRE_IsParentProcess()) return;
  FeatureState& feature = gfxConfig::GetFeature(Feature::WEBRENDER_COMPOSITOR);
#if defined(MOZ_WAYLAND)
  if (feature.IsEnabled()) {
    if (!IsWaylandDisplay()) {
      feature.ForceDisable(FeatureStatus::Unavailable,
                           "Wayland support missing",                 // 296
                           "FEATURE_FAILURE_NO_WAYLAND"_ns);
    } else if (... !gfxConfig::IsEnabled(Feature::DMABUF)) { ... }
  }
#else  // MOZ_WAYLAND
  feature.ForceDisable(FeatureStatus::Unavailable, "Not available on X11",
                       "FEATURE_FAILURE_NO_WAYLAND"_ns);              // 313
#endif
  gfxVars::SetUseWebRenderCompositor(feature.IsEnabled());            // 317
}
```

**(d) 为什么 pref 强开也没用**（这是"可回滚 A/B"的关键）：
- `ForceDisable` 的实现（`gfx/config/gfxFeature.h:105–108`）：
  ```cpp
  void ForceDisable(FeatureStatus aStatus, const char* aMessage, const nsACString& aFailureId) {
    SetFailed(aStatus, aMessage, aFailureId);   // → 写入 mRuntime
  }
  ```
- `GetValue()` 的优先级（`gfx/config/gfxFeature.cpp:18–36`）：
  ```cpp
  if (mRuntime.mStatus != FeatureStatus::Unused) return mRuntime.mStatus;   // ← 第一优先
  if (mUser.mStatus == FeatureStatus::ForceEnabled) return FeatureStatus::ForceEnabled;
  if (mEnvironment.mStatus != FeatureStatus::Unused) return mEnvironment.mStatus;
  ...
  ```
  ⇒ **runtime 高于 user 强开**。而 `gfxPlatformGtk::InitWebRenderConfig()` 的 `ForceDisable` 恰好写 runtime。

**综合判读**：
- 本机（X11）**从来不用原生合成器**，无论这条是 `blocklisted` 还是 `unavailable`；`UseWebRenderCompositor` 恒为 `false`（第 317 行）。
- 若把 `gfx.webrender.compositor.force-enabled` 设为 true ⇒ 使 `feature.IsEnabled()` 变 true ⇒ **恰好触发**上面的 Wayland 检查 ⇒ `ForceDisable(Unavailable, "Wayland support missing")`（第 293–296 行）⇒ `GetValue()` 返回 runtime=Unavailable ⇒ `IsEnabled()` 仍为 false。**净效果：零，最多让决策日志那行文字从 `blocklisted` 变成 `unavailable`。**
- ⇒ **本条不构成"性能缺陷"，也**不是**"可优化项"。协调者表中把它列为"是有代价的降级"——**这一条应降级为"cosmetic/inert"**。

**⚠️ 一处未闭合的细节（如实标注）**：用户抄回的 `env: blocklisted（FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED）` 是**决策日志里 `env:` 那一行**；按 (c) 的源码，若该特性当时 `IsEnabled()`，应当还会出现一行 `runtime: unavailable: Wayland support missing (FEATURE_FAILURE_NO_WAYLAND)`。我在本轮抓取的 12 个文件里**没有找到** `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` 的设置点（不在 `gfxPlatform.cpp`/`gfxPlatformGtk.cpp`/`gfxConfig.cpp`/`gfxFeature.cpp`/`nsWindow.cpp` 中），而外部代码检索不可用（searchfox 需 JS、grep.app 被 Vercel 拦截、GitHub code search 需鉴权）。
⇒ **请让用户顺手把 `WEBRENDER_COMPOSITOR` 那一条的 `runtime:`/`default:` 行也抄回来**（若存在）以闭合。**但这不影响上面的功能结论**：(b)(d) 两级证据已足够证明 X11 上不可达且强开无效。

---

### 1.2 `DMABUF_SURFACE_EXPORT: env: blocked（FEATURE_FAILURE_BROKEN_DRIVER）` —— **不是"每帧失去零拷贝"，作用域是 WebGL**

**这条我判为：真实存在，但被协调者的表述放大了。它**不是**通用呈现路径的零拷贝开关。**

**(a) 它的定义**（`gfx/config/gfxFeature.h`，`GFX_FEATURE_MAP`）：
```c
_(DMABUF_SURFACE_EXPORT, Feature, "WebGL DMABuf surface export")
```
⇒ 官方描述**明确限定在 WebGL**（"WebGL DMABuf surface export"）。

**(b) 它的唯一作用点**（`gfx/thebes/gfxPlatform.cpp:3296–3317`）：
```cpp
#ifdef MOZ_WIDGET_GTK
  if (kIsLinux) {
    FeatureState& feature = gfxConfig::GetFeature(Feature::DMABUF_SURFACE_EXPORT);
    feature.EnableByDefault();                                        // 3300 默认开
    nsCString discardFailureId; int32_t status;
    if (NS_FAILED(gfxInfo->GetFeatureStatus(
            nsIGfxInfo::FEATURE_DMABUF_SURFACE_EXPORT,
            discardFailureId, &status)) ||
        status != nsIGfxInfo::FEATURE_STATUS_OK) {
#  ifdef NIGHTLY_BUILD
      if (StaticPrefs::widget_dmabuf_export_force_enabled_AtStartup()) {
        feature.UserForceEnable("Force-enabled by pref");
      } else
#  endif
      {
        feature.Disable(FeatureStatus::Blocked, "Blocklisted by gfxInfo",
                        discardFailureId);          // ← 用户看到的 blocked / FEATURE_FAILURE_BROKEN_DRIVER
      }
    }
    gfxVars::SetUseDMABufSurfaceExport(feature.IsEnabled());          // 3317 全流程唯一副作用
  }
```
⇒ 它**全部后果就是一个布尔 gfxVar**：`gfxVars::UseDMABufSurfaceExport`。失败码来自 `gfxInfo` 的驱动黑名单（`FEATURE_FAILURE_BROKEN_DRIVER`）。

**(c) 通用呈现路径**由**另外三个**特性管，**它们都没被打掉**：
| 特性 | 用户决策日志 | 本构建默认 | 说明 |
|---|---|---|---|
| `DMABUF` | **`default: available`** | `widget.dmabuf.enabled = true` | 通用 DMABuf（EGL import/export、GBM）——**可用** |
| `DMABUF_WEBGL` | 未列出 | `widget.dmabuf-webgl.enabled = true` | "DMABuf for WebGL"，另一个独立特性 |
| `HW_DECODED_VIDEO_ZERO_COPY` | 未列出 | 视频零拷贝 | 视频专用 |
另有 `widget.dmabuf.force-enabled`（默认 false）。

**(d) 呈现路径本身**（`gfx/webrender_bindings/RenderCompositorEGL.cpp`）：
```cpp
UniquePtr<RenderCompositor> RenderCompositorEGL::Create(...) {        // 38
  if (kIsLinux && !gfx::gfxVars::UseEGL()) return nullptr;           // 40  ← 需要 EGL
  RefPtr<gl::GLContext> gl = RenderThread::Get()->SingletonGL(aError);
  ...
}
```
⇒ 本机合成器把 WebRender 输出**直接画进窗口的 EGLSurface**（`CreateEGLSurfaceForCompositorWidget`），**并没有"帧缓冲 → CPU → 再上传"的额外拷贝**。所以"每帧多一次或多次拷贝"这个推论**不成立**。

**判读**：`DMABUF_SURFACE_EXPORT: blocked` 的真实代价是 —— **WebGL 画布无法把后备面以 DMABuf 零拷贝方式交给合成器**（以及 WebGPU 共享纹理互操作），于是 WebGL 走回退（额外拷贝/回读）。
⇒ **只有当目标页面使用 WebGL 时才有成本**。对**纯 DOM/CSS/SVG 与 2D canvas 的动画，这条不产生每帧成本。**
⚠️ **我不知道用户的 Codex 页面里那个整窗 canvas 是 WebGL 还是 2D**（他线描述为"rAF 逐帧改写 SVG 径向渐变 offset"+挂在整窗 canvas 上，二者都提到）。**若是 WebGL，这条就与症状直接相关；若是 2D，则无关。** 这需要补一步取证（见 §4 的 B 项）。

**未取得**：`gfxVars::UseDMABufSurfaceExport` 的**读取方（消费者）文件**我没定位到——在 `gfxPlatform.cpp`/`gfxVars.h` 之外，`WebGLContext.cpp`、`GLBlitHelper.cpp`、`TextureClient.cpp`、`ShareableCanvasRenderer.cpp`、`PersistentBufferProvider.cpp`、`CanvasRenderer.cpp`、`CanvasRenderingContext2D.cpp` 里都没有。**⇒ 消费者站点 INCONCLUSIVE**（但特性描述与唯一作用点已足以定性作用域）。

---

### 1.3 `MESA_THREADING: env: failed（No glthread with EGL and X11）` —— **这是 Mozilla 故意写的绕过补丁；且它**不会**"让驱动调用压主线程"**

**(a) 完整源码**（`gfx/thebes/gfxPlatformGtk.cpp:331–359`，逐字）：
```cpp
void gfxPlatformGtk::InitMesaThreading() {                            // 331
  FeatureState& featureMesaThreading = gfxConfig::GetFeature(Feature::MESA_THREADING);
  featureMesaThreading.EnableByDefault();                             // 默认想开
  ... gfxInfo 黑名单检查 ...
  // Enabling glthread crashes on X11/EGL, see bug 1670545    ← 349 原文注释
  if (gfxConfig::IsEnabled(Feature::X11_EGL) && IsX11Display()) {     // 350
    featureMesaThreading.Disable(FeatureStatus::Failed,               // 351
                                 "No glthread with EGL and X11",      // 352
                                 "FEATURE_FAILURE_EGL_X11"_ns);
  }
  if (!featureMesaThreading.IsEnabled()) {
    PR_SetEnv("mesa_glthread=false");                                 // 357 ← 进程级环境变量
  }
}
```
⇒ 这条 `env: failed` 是**对 Mozilla bug 1670545 的刻意 workaround**（X11/EGL 下开 glthread 会崩），**不是驱动故障、不是配置错误**。

**(b) 对"压主线程"这个说法的更正**：成立不了。WebRender 的 GL 上下文由 **RenderThread** 持有（`RenderCompositorEGL::Create` 用 `RenderThread::Get()->SingletonGL(aError)`），合成调用发生在**合成/渲染线程**，不在内容进程主线程、也不在父进程主线程。glthread 的作用是把 GL 提交从**调用线程**再挪到一个驱动线程；它关掉的代价是"少一层线程卸载"，**与"主线程被驱动调用压住"不是同一件事**。

**(c) 有没有开关能规避？——**没有可用的用户开关**：
- `gfx.blacklist.mesa.threading` 这个 pref 名**存在于本构建**（libxul 字面量），但我**没能取到**消费它的代码 ⇒ **其语义（force-allow/deny）未证实 → INCONCLUSIVE，不建议依赖**。
- 更关键：即便黑名单层放行，**第 350 行的 `X11_EGL && IsX11Display()` 是无条件的**，会把状态改成 `Failed` 并设 `mesa_glthread=false`。
- 唯一能让第 350 行不成立的办法是让 `X11_EGL` 不启用，即 `gfx.x11-egl.force-disabled = true`（该 pref 名确实存在于本构建，且 `gfxPlatformGtk.cpp:154` 会读它）——**但代价很大**，见 §3 的 A5。
⇒ **结论：glthread 这条在 X11/EGL 下确实"无 pref 可解"，只能从 驱动/Xorg/会话协议 侧解决**（见 §3 A6）。

**判读**：这条降级**真实存在但因果未证**。它的量级远小于 DPR=2 全幅过绘；我**没有**任何本地证据表明它是卡顿的主因。**标记：INCONCLUSIVE（存在为事实，贡献未证）**。

---

### 1.4 顺带：两条被忽略但相关的条目

- **`WEBRENDER_PARTIAL: default: available` ⇒ 局部呈现其实是开着的**（这条重要，见下）：
  `RenderCompositorEGL` 的实现（`RenderCompositorEGL.cpp`）：
  ```cpp
  bool RenderCompositorEGL::UsePartialPresent() {                     // 298
    return gfx::gfxVars::WebRenderMaxPartialPresentRects() > 0;       // 299
  }
  bool RenderCompositorEGL::RequestFullRender() { return false; }     // 302
  bool RenderCompositorEGL::ShouldDrawPreviousPartialPresentRegions() { return true; }  // 308
  size_t RenderCompositorEGL::GetBufferAge() const {                  // 312
    if (!StaticPrefs::gfx_webrender_allow_partial_present_buffer_age_AtStartup()) return 0;
    return gl()->GetBufferAge();                                      // 317  EGL buffer age
  }
  void RenderCompositorEGL::SetBufferDamageRegion(...) {              // 320
    if (gle->HasKhrPartialUpdate() && ...) egl->fSetDamageRegion(...) // 324/345
  }
  ```
  而 `WebRenderMaxPartialPresentRects` 的来源（`gfxPlatform.cpp:2958–2961`）：
  ```cpp
  if (gfxConfig::IsEnabled(Feature::WEBRENDER_PARTIAL)) {
    gfxVars::SetWebRenderMaxPartialPresentRects(
        StaticPrefs::gfx_webrender_max_partial_present_rects_AtStartup());
  }
  ```
  默认值（本 revision `modules/libpref/init/StaticPrefList.yaml`，**经 `#ifdef` 展开**）：
  ```yaml
  - name: gfx.webrender.max-partial-present-rects
  #if defined(XP_WIN) || defined(MOZ_WIDGET_ANDROID) || defined(MOZ_WIDGET_GTK)
    value: 1        ← 本机构建命中这一支
  #else
    value: 0
  #endif
  - name: gfx.webrender.allow-partial-present-buffer-age
    value: true     ← 默认已允许 buffer age
  ```
  ⇒ **`UsePartialPresent()` 在本机返回 true**，配合 `EGL_KHR_partial_update` + buffer age，X11 下**有脏区局部呈现**。
  ⚠️ **这更正了我上一轮 audit.md §5-H2 里"无原生合成器 ⇒ 没有 partial present ⇒ 每帧全幅"的推断。** 我已在 `audit.md` 标注更正。

- **`WEBRENDER_SHADER_CACHE: default: disabled`**：只影响着色器磁盘缓存（`gfx.webrender.program-binary-disk`），**影响冷启动/首帧，不影响持续滚动**。

- **顺带闭合上一轮两个悬而未决的问题**（同一份 `StaticPrefList.yaml`）：
  ```yaml
  - name: gfx.webrender.enable-low-priority-pool
  #if defined(ANDROID)
    value: false
  #else
    value: true     ← 默认开
  #endif
  - name: gfx.webrender.render-backend-thread-count
    value: 2
  ```
  ⇒ ① 活体看到的 **`WRWorkerLP#0..7` 是默认开启的"低优先级池"**，是一个蓄意特性，**不能**据此推软件光栅（进一步支持我上轮对子代理那条静态推论的更正）；② `render-backend-thread-count = 2` 与活体实测的 **`WRRenderBackend#0/#1` 恰好 2 条**吻合，**独立验证了我上轮的线程名读取可靠**。

---

## 2. 为什么 Chrome 不受影响（机制层对比 + 本机 Chrome 侧记录）

### 2.1 本机 Chrome 侧**实际取到的记录**（只读文件）
| 证据 | 值 | 含义 |
|---|---|---|
| `~/.config/google-chrome/Local State` → **`hardware_acceleration_mode_previous`** | **`true`** | Chrome **自己记录"硬件加速已启用"**（这是 Chrome 侧的权威标记） |
| `~/.config/google-chrome/Default/GPUCache/` | `data_1` 270 KB、`index` 262 KB，**mtime 10:50–11:05（活跃写入）** | Chrome 的 GPU 着色器缓存在**实际使用中** |
| `~/.config/google-chrome/GPUPersistentCache/GPUCache/BD7RRYH6N2GU2SW4PUX52D2BXFCQMDPU` | **5.3 MB** | 持久化 GPU 缓存已填充 |
| `~/.config/google-chrome/Default/DawnWebGPUCache/` | 300 KB，活跃 | WebGPU/Dawn 也用上了 GPU |
| `google-chrome --version` | **153.0.8010.52** | — |

⇒ **本机 Chrome 侧没有任何"GPU 降级/回退"的记录，反而有正向证据（加速开、着色器缓存在写）。** 与用户"Chrome 顺"一致。

### 2.2 机制层：三条降级**结构上不可能**影响 Chrome
1. **三条降级都是 Gecko 自己的 `gfxConfig` 特性**（`Feature::WEBRENDER_COMPOSITOR` / `DMABUF_SURFACE_EXPORT` / `MESA_THREADING`，定义在 `gfx/config/gfxFeature.h`）。Chromium **没有对应实现**，它用 Viz + Ozone 与**自己的** `gpu_driver_bug_list.json` 驱动黑名单 —— **两套黑名单彼此独立**，Gecko 被 block 不等于 Chrome 被 block。
2. **`mesa_glthread=false` 是 Gecko 用 `PR_SetEnv` 设的进程级环境变量**（`gfxPlatformGtk.cpp:357`），只作用于 **Gecko 自己的进程树**。Chrome 进程不受其影响。（这是"Chrome 天然免疫"里最干净的一条硬机制。）
3. **原生合成器**：Gecko 在 X11 上不可达（§1.1）；Chromium 的 X11 呈现走自己的 Viz/`SharedImage` 路径，**不依赖** Gecko 的 `WEBRENDER_COMPOSITOR` 开关。
4. **a11y 不对称（他线 H-A，机制上有据）**：Gecko/GTK 会因 `GTK_MODULES=…atk-bridge` + `ACCESSIBILITY_ENABLED=1` 为页面构建 a11y 树；**Chromium 的渲染进程不走 GTK/AT-SPI**，故不受该环境变量影响。**这是"同一环境、只有 Firefox 卡"的结构性解释里最强的一条。**

### 2.3 诚实边界
- **`chrome://gpu` 本轮拿不到**（有头 Chrome 在本机被 SIGTRAP/DLP 杀、无头 Chromium 是 Playwright 自带且非同一渲染路径）⇒ **"Chrome 侧是否也有自己的黑名单命中"未被观测**。上面 2.2 全部是**机制层对比**，不是实测对照。**标记 INCONCLUSIVE**。
- **一条需要防止过度解读的项**：用户 `about:support` 里 `内容分析（DLP）已启用: false` 只说明 **Firefox 自己的 DLP 集成**没开；而 Xorg 侧的 `twatermarkext`（他线 G3）若真在每帧画水印，那是**在 X11/合成层对所有窗口生效**的，**与 Firefox 这个 flag 无关**。不要把两者当成互斥证据。

---

## 3. 可回滚 A/B 建议（**只给步骤，不执行**；按性价比排序）

**前置优势（也是回滚安全性的来源）**：我已证实该 profile 的 `prefs.js` 里 **`gfx.*` 用户覆盖为 0 条**（230 条 `user_pref` 中一条都没有）。⇒ 任何改动都是"从**已知干净默认**出发"，回滚 = about:config 里右键 **`Reset`**（或把值设回默认），**不需要动 profile 文件、不需要重置 profile**。用户 `about:support` 也确认 `安全模式: false`（无扩展干扰）。

| # | 键名（`about:config`） | 建议值 | 预期效果 | 风险 | 回滚方法 |
|---|---|---|---|---|---|
| **A0** | 只读核对：`gfx.webrender.max-partial-present-rects`（期望 **`1`**）与 `gfx.webrender.allow-partial-present-buffer-age`（期望 **`true`**） | **不改** | 确认局部呈现已生效（源码：`UsePartialPresent()` ⇔ 该值 > 0）。**这是基线，动了会变慢** | 零（只读） | 无需 |
| **A1** | `accessibility.force_disabled` | **`1`** | 唯一"Chrome 天然免疫"的不对称项。若 a11y 树构建是 Firefox 独有成本，关闭后应改善 | 低（仅暂时失去无障碍；用户自身 a11y 偏好本就全 false） | 设为 `0` 或 Reset；若 `/etc/environment` 仍强制，需与 IT 协调（他线） |
| **A2** | `gfx.webrender.software` | **`false`（保持；这是"排除项"）** | **反向验证用**：设 `true` 会真的切 SWGL 软件光栅，在 5120×2880/DPR2 下**必然显著变慢**。用它做"如果更慢，说明当前确实是硬件路径"的对照 | **会变慢**（但正是它的用途） | 设回 `false` 或 Reset |
| **A3** | `gfx.webrender.compositor.force-enabled` | **不建议动**（若已动，设回 `false`） | **预期零效果**：X11 上原生合成器不可达；`ForceDisable`→`SetFailed`→runtime 槽，而 `GetValue()` 优先返回 runtime，**压过 user ForceEnabled**。唯一可见变化是决策日志那行文字 | 几乎无（但无收益） | Reset |
| **A4** | `gfx.x11-egl.force-disabled` | **不建议**（这是唯一能"规避 glthread 降级"的开关，但代价大于收益） | 关掉 X11/EGL ⇒ `InitMesaThreading()` 第 350 行不再触发，**glthread 有可能启用**；**但同时** `InitDmabufConfig()` 里 `if (!gfxVars::UseEGL()) ForceDisable("Requires EGL")`（`gfxPlatformGtk.cpp:208–210`）⇒ **DMABUF 整条被关**，且 `RenderCompositorEGL::Create()` 在 `!UseEGL()` 时返回 nullptr（`RenderCompositorEGL.cpp:40`）⇒ 合成器退回 **`RenderCompositorOGL`（GLX）**。**净效应大概率变慢** | 中高（失去 EGL+DMABuf） | 设回 `false` 或 Reset |
| **A5** | `gfx.webrender.program-binary-disk` | `true`（可选） | 针对 `WEBRENDER_SHADER_CACHE: disabled`。**只改善冷启动/首帧**，不改善持续滚动 ⇒ 若症状是"滚动/动效持续卡"，**预期无帮助** | 低 | Reset |
| **A6** | ——（**无 pref**）**驱动/Xorg/会话协议侧** | ① 换 **Wayland 会话**；② 或等 Mesa 修 bug 1670545 / 升级 Mesa | **①是唯一能同时解掉两条降级的路径**：Wayland 下 `IsWaylandDisplay()` 为真 ⇒ `WEBRENDER_COMPOSITOR` 不再被 "Wayland support missing" 关掉（原生合成器可达，`RenderCompositor.cpp:238–240`），且 `InitMesaThreading()` 的 `IsX11Display()` 条件不成立（glthread 限制不适用）。**②** 只对 glthread 一条 | 中（切会话协议会改变整机显示栈，需先备份 `~/.config/monitors.xml` 等；见他线） | 重新登录时选回 Xorg/GNOME on X11 |
| **A7** | 环境放大器（他线 G1/G2） | 缩放回 100%（原生 3840×2160@60）/ 把显示器接 4090 | **最高杠杆**，但属他线范围 | — | 见他线 |

**关于"规避 DMABUF/glthread 降级的开关是否存在"——明确回答**：
- **glthread：无可用用户开关。** `gfx.blacklist.mesa.threading` 名称存在于构建，但① 其语义本轮未证实（INCONCLUSIVE），② 即使放行，`gfxPlatformGtk.cpp:350` 的 `X11_EGL && IsX11Display()` 规则**无条件**把它改回 `Failed`。⇒ **只能从驱动/Xorg/会话协议侧解决**（A6）。
- **DMABUF：通用 DMABUF 本来就是 `available`，没有"被降级"需要规避**；真正 blocked 的 `DMABUF_SURFACE_EXPORT` 是 **WebGL 专用**（§1.2），且它由 gfxInfo 驱动黑名单判定为 `BROKEN_DRIVER` —— **绕过驱动黑名单本身是风险动作，不建议**。

**建议的测量方式（零风险）**：每次 A/B 前后各抄一份 `about:support` 的 **Graphics → Features（`Compositing`/`窗口设备像素比`）+ Decision Log + Failure Log**，并用 **`about:profiling`** 抓 5 秒复现的线程泳道：
- `WRWorker*`/`WRWorkerLP*` 持续吃满 CPU ⇒ 软件光栅；
- 只有 `Compositor`/`WRRenderBackend` 活动而大量空闲、帧仍迟到 ⇒ **下游呈现瓶颈**（→ 指向他线 G1/G2，而非 Gecko）。

---

## 4. 结论排序更新（Firefox 侧）

| 排序 | 假设 | 本轮裁决 | 依据 |
|---|---|---|---|
| 1 | **H-A 强制 a11y**（唯一"Chrome 免疫"的不对称项） | **保留为第一优先待验**（因果未证） | `无障碍环境 已激活: true`；机制上 Chromium 渲染进程不走 GTK/AT-SPI；A1 可零风险 A/B |
| 2 | **H-C 环境放大器**（DPR=2 + 5120×2880 + 2 CU 核显） | **保留（他线已受控验证）** | 面积实验 60→44 fps；Firefox 自报 5120×2880/scale 2 |
| 3 | ~~H-B 降级的 Gecko GPU 路径~~ | **大幅下调**：三条里 **`WEBRENDER_COMPOSITOR` 在 X11 上是空的**（§1.1）；**partial present 其实是开的**（§1.4，更正我上轮）；`MESA_THREADING` 是故意 workaround 且不等于"压主线程"（§1.3）；**只剩 `DMABUF_SURFACE_EXPORT` 一条可能有成本，且仅限 WebGL**（§1.2） | 上列源码行号 |
| 4 | 软件 WebRender | **已否证** | `合成: WebRender` + `GPU #1 活动: 是`；我的 Glean 推断获证 |
| 5 | snap 沙箱缺 GPU | **已否证** | ACL `user:CNS…:rw-`、`mesa/radeonsi` `GPUActive:true`、`GpuSandboxLevel:0` |
| 6 | DLP 作用于 Firefox | **已否证（仅指 Firefox 自身 DLP 集成）** | `内容分析: 已启用 false`；⚠️ 但不排除 Xorg 侧水印对所有窗口生效 |

**唯一新的、值得单独跟进的 Firefox 侧线索**：**那个整窗 canvas 到底是 WebGL 还是 2D**。
若是 **WebGL** ⇒ `DMABUF_SURFACE_EXPORT: blocked` 就**直接**意味着该 canvas 每帧多一次回读/拷贝，在 14.746 Mpx 上量级可观，且与面积实验吻合；
若是 **2D canvas / DOM / SVG** ⇒ 这条与症状无关，应把火力全部放回 H-A 与 H-C。
**取证方式（只读）**：在他线的 `cross-app/` 已有 Codex `app.asar` 与页面副本基础上，检索 `getContext("webgl")` / `webgl2` 的出现；或让用户在 Firefox 里开 `about:support` 顺带看 WebGL 段是否被该页使用（更直接：对该页面用 Firefox Profiler 看有无 `WebGLContext` 相关帧）。

---

## 5. 本轮未能证实 / INCONCLUSIVE（逐条给原因）

| # | 项 | 原因 |
|---|---|---|
| 1 | `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` 的**设置点** | 不在本轮抓取的 12 个源文件中；searchfox 需 JS、grep.app 被 Vercel 安全拦截、GitHub code search 需鉴权 ⇒ 无代码检索手段。**不影响功能结论**（§1.1(b)(d) 已足够） |
| 2 | `gfxVars::UseDMABufSurfaceExport` 的**消费者文件** | 同上；已试 `WebGLContext.cpp`/`GLBlitHelper.cpp`/`TextureClient.cpp`/`ShareableCanvasRenderer.cpp`/`PersistentBufferProvider.cpp`/`CanvasRenderer.cpp`/`CanvasRenderingContext2D.cpp` 均未命中 |
| 3 | `gfx.blacklist.*` 系列 pref 的**语义**（force-allow/deny） | 消费代码未定位到（§1.3c）⇒ 不建议依赖 |
| 4 | `AllowNativeCompositor()` 的定义 | `gfx/layers/CompositorOptions.h` 在该 revision 返回 **HTTP 404**（路径不同），另两个候选文件无该符号 ⇒ 未取到。**它是第二道闸**；第一道闸（`UseWebRenderCompositor=false`）已足以定案 |
| 5 | **`MESA_THREADING` 失败对卡顿的实际贡献** | 无本地对照实验；且要在动画进行中采样需驱动用户浏览器（被纪律禁止）⇒ **存在为事实，贡献未证** |
| 6 | Chrome 侧是否也有自己的黑名单命中 | `chrome://gpu` 不可得（有头 Chrome 被 SIGTRAP 杀、无头非同一渲染路径）⇒ 只做机制层对比 |
| 7 | Codex 整窗 canvas 是 WebGL 还是 2D | 本线未取证（属他线素材范围）；决定 §1.2 是否有实际成本 ⇒ **列为下一步最高价值的单点取证** |
| 8 | 本轮 `web_search` 工具不可用 | 返回 `An active OpenCode Go subscription is required to use Go models.`；已改用"抓本构建 revision 源码"作为**更硬**的替代（源码即本二进制） |

---

## 6. 纪律确认
未改任何配置／未重启／未 `pkill`／未启动用户浏览器／未执行 `snap run --shell firefox`；**所有工具调用未传 `sandbox_permissions`**。对 Gecko 源码只做**只读 HTTP GET**，全部落在 `firefox-gfx/src/`。用户 Firefox **pid 9042 全程存活**。
