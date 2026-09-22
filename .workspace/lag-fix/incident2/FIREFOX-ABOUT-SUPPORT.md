# Firefox `about:support` 关键字段（用户实测，2026-09-22 11:1x）

来源：用户直接粘贴的完整 `about:support`。以下只保留**与性能相关**的字段与判读。版本：Firefox **155.0.1**（snap rev 8863，Ubuntu 24.04，内核 6.14.0-27）。

## 一、决定性字段

| 字段 | 值 | 判读 |
|---|---|---|
| **`Display0`** | **`5120x2880@60Hz scales:2.000000\|2.000000 SDR`** | **DPR=2.0 与 5120×2880 后备面得到浏览器自证**（与 mutter `legacy-ui-scaling-factor=2` 一致）⇒ 每帧渲染 14.75 Mpx，最终缩到 4K 显示 |
| **`窗口设备像素比`** | **2, 2** | 同上（两个窗口都是 2.0） |
| **`合成`** | **`WebRender`** | **不是软件渲染** ⇒ 此前"软件 WebRender"假设**被否证** |
| `GPU #1` | `AMD … (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61)`，**活动: 是**，驱动 `mesa/radeonsi 25.2.8.0` | 核显在驱动渲染（GPU 未黑名单） |
| `GPU #2` | NVIDIA `0x2684`（= 4090），**活动: 否** | 4090 未参与（与 Xorg 侧一致） |
| `目标帧率` | **60** | — |
| **`无障碍环境`** | **`已激活: true`**、`强制停用无障碍环境: **0**` | **无障碍被强制激活**（环境 `ACCESSIBILITY_ENABLED=1` + 强制 `GTK_MODULES=…atk-bridge`）⇒ a11y 树真的在构建 |
| `窗口协议` / 桌面 | `x11` / `ubuntu:gnome` | — |
| `安全模式` | `false` | 无扩展干扰（附加组件仅内置项） |
| `内容分析（DLP）` | **`已启用: false`** | **DLP 未作用于 Firefox**（对比：有头 Chromium 被 SIGTRAP 杀死，疑 DLP 只打 Chromium 系） |
| `远程调试（Chromium 协议）` | `接受连接: false` | Firefox 未开 CDP |

## 二、决策日志里的**真实 GPU 路径缺陷**（此前无人报过）

| 特性 | 状态 | 后果 |
|---|---|---|
| **`WEBRENDER_COMPOSITOR`** | **`env: blocklisted`（`FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`）** | **WebRender 合成器被黑名单禁用** ⇒ 走降级的呈现路径（非原生合成），是有代价的 |
| **`DMABUF_SURFACE_EXPORT`** | **`env: blocked`（`FEATURE_FAILURE_BROKEN_DRIVER`）** | **零拷贝路径被禁用**（驱动被判定为 broken）⇒ 每帧多一次或多次拷贝 |
| **`MESA_THREADING`** | **`env: failed`（`No glthread with EGL and X11`）** | Mesa 多线程 GL 在 EGL+X11 下不可用 ⇒ 驱动调用开销更直接地压在主线程 |
| `DMABUF`（通用） | `default: available` | 与上面那条 blocked 并存，属**部分可用** |
| `WEBRENDER_PARTIAL` | `default: available` | 局部呈现可用 |
| `WEBRENDER_SHADER_CACHE` | `default: disabled` | 着色器缓存未开（影响首帧，不影响持续滚动） |
| `WEBRENDER_ANGLE` / `WEBRENDER_DCOMP_PRESENT` | `OS not supported` / `user: disabled` | Windows 专属，与本机无关 |
| `VP8/VP9/H264_HW_ENCODE`、`VP8_HW_DECODE` | `#BLOCKLIST_FEATURE_FAILURE_VIDEO_*_MISSING` | 视频相关，与本症状无关（登记备查） |

## 三、据此更新的假设排序（Firefox 侧）

1. **H-A（强化）无障碍被强制激活**（`已激活: true`、`force_disabled: 0`）——Gecko 会为大 DOM 页面构建 a11y 树；**Chrome 内容渲染不走 GTK，天然免疫** ⇒ 与"Chrome 顺 / Firefox 卡"的不对称**完全吻合**。
2. **H-B（新增，机制级）降级的 Gecko GPU 路径**：`WEBRENDER_COMPOSITOR` 被黑名单 + `DMABUF_SURFACE_EXPORT` blocked（无零拷贝）+ `MESA_THREADING` failed ⇒ **每帧多拷贝、呈现路径非原生**，在 **DPR=2 / 5120×2880** 下被放大。Chrome 用自己的 Viz/Ozone 与独立黑名单，**不共享这些降级**。
3. **H-C 放大器（不变）**：DPR=2 + 5120×2880 后备 + 2 CU 核显；受控面积实验已证同一动效仅因面积即 **60fps → 44fps**。
4. **被否证**：软件 WebRender（`合成: WebRender` + `GPU #1 活动: 是`）、snap 沙箱缺 GPU（ACL/驱动均正常）、DLP 作用 Firefox（`内容分析: 已启用 false`）。
