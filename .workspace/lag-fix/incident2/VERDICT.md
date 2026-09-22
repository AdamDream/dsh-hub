# incident2 收口裁决：用户可感卡顿的因果链（2026-09-22）

> 触发：用户报告「打开网页界面点设置就卡」，并补充「Codex 界面的悬停托盘 + 跟随鼠标波纹动效也卡，**觉得不一定是 DSH 本身的问题**」。
> 本报告只写**有证据的结论**，并显式区分 **已确证 / 已撤回 / 未决**。所有原始证据在各线目录的 `audit.md` + `raw/`。

---

## 一、因果链（按证据强度）

### ① Firefox 侧：启动器强制打开无障碍 ⇒ 实测 1.86× 帧时间、p95 3.0×【已确证】

| 项 | 证据 |
|---|---|
| 机制 | **`/usr/bin/firefox` 第 72 行 = `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`**（`dpkg -V` md5 不符，非推断）；生效变量是 **`GNOME_ACCESSIBILITY`** 而**不是** `ACCESSIBILITY_ENABLED`（`libxul.so` 含前者字面量、完全不含后者） |
| 激活实证 | 用户 Firefox 父进程 **9042 是 AT-SPI 总线注册应用**且应用根可查询（`Name="Firefox"`/`role=application`/`ChildCount=2`）；用户自身偏好全 false、`prefs.js` 无任何 `accessibility.*`、无 `user.js` ⇒ **环境强开** |
| 代价（headed 15000 行 / 45009 节点，3 次/条件、轮次交错、自证 3/3） | a11y 开：**31.4 ms/帧、p95 54 ms**；a11y 关：**16.8 ms/帧、p95 18 ms** ⇒ **帧时间 1.86×、p95 3.0×、树 CPU 1.42×、DOM 变更吞吐成本 4.6×** |
| 唯一有效且可回滚的开关 | **`accessibility.force_disabled = 1`**（3/3 生效：引擎 ABSENT、总线 3/3→0/3）；用户级、即时、无需 root、回滚 = 改回 `0` |
| **为何只有 Firefox 卡** | 环境变量**不打开 Chrome 的网页无障碍**（`env-cleared` 与 `env-default` 完全无差异、`chrome://accessibility` 的 AXMode 全 false）；而**强制打开时 Blink 更贵（2.35×、p95 12.9×）** ⇒ **两个引擎都很贵，差别在"谁被环境打开了"** |
| ⚠️ 关键边界 | **同一逻辑在 headless 下 a11y 开/关成本比 ≈1.00**（headless 无真实 AT-SPI 消费者，总线成员 0/3）⇒ **headless 结构上测不出此问题**，因此只有用户桌面体感是有效证据 |

### ② 环境放大器：显示链路【已确证，但"是否为主因"取决于①的复测】

| 项 | 证据 |
|---|---|
| 显示器接在核显上 | `card2 = 0x1002:0x13c0 (AMD Raphael, 2 CU)` `boot_vga=1`、**`HDMI-A-3 connected/enabled 3840x2160`**；`card1 = 0x10de:0x2684 (RTX 4090)` **四个口全 disconnected**；内核 `nvidia 0000:01:00.0: [drm] Cannot find any crtc or sizes` |
| 每帧多付 78% 填充 + 全屏重采样 | mutter 为 150% 分数缩放在 **5120×2880（14.75 Mpx）** 渲染后 `Transform 1.333328` + bilinear 缩到 **3840×2160（8.29 Mpx）**；Firefox 自报 `Display0: 5120x2880@60Hz scales:2.0\|2.0` |
| 受控面积实验 | 同一份"跟随鼠标波纹"仅改视口：**720p = 60.01 fps / 丢帧 0** ↔ **5120×2880 = 44.25 fps / 丢帧 26.4%**（两侧单帧 JS 均 0.1–0.2 ms）⇒ **卡在呈现侧** |
| 用户侧遥测（单位已对 Mozilla 官方 `metrics.yaml` 确认） | **Gecko 合成自身健康**：`composite_time` 中位 **0.96 ms**、`on_time 98.26%`；**但呈现延迟中位 ≈31 ms**（≈2 vsync）、4.74% ≥36.6 ms、**破图 50 次（42% ≥2 帧、最坏 414 ms）** ⇒ **差值落在"合成之后"= mutter + 核显** |
| 物理切换时刻 | **09-20 11:10:42 开机时即已从 4090 切到核显**（四层证据：固件 boot-VGA / X 主屏 / 已连接显示器 / 内核 crtc 报错对象 + `11-nvidia-offload.conf` btime 11:10:44.708）；**不是**遥测上报的 17:18:43（那是 ping 的创建时刻，早 6h08m） |

### ③ DSH 侧：真实但量级有限的靶点【已确证】

| # | 事实 | 证据 |
|---|---|---|
| D1 | **「插件」栏目每次切回固定重发 9 个 `/usage/*`**（click+6~11 ms 并发发出、25→352 ms 到齐；`/usage/sessions` 单响应 **54,062 字节**，两条线独立测得**逐字节吻合**） | 两条线一致；机制 = 设置面板**无 keep-alive**（`renderSlot({only: active})` ⇒ 切换即卸载重挂），4 个自带取数的栏目每次切换重新取数 |
| D2 | **「插件列表」子标签渲染规模最大**：**1820 节点 / 192 SVG**（通用设置的 4.3×/13.7×） | 仅支持"客户端列表虚拟化"这一条修复；**RPC/缓存类收益已撤回** |
| D3 | 宿主 **`session.list` / `subagent.list` 无 memo 全量重扫**，会阻塞宿主（探针 p95 4.6→43.9 ms、峰值 **789 ms**）——**唯一能造成 0.3–0.8 s 宿主级停顿者** | 其中**最严重一处（B1 引入的比较器 O(N log N × events)）已由协调者修复并落地**：`session.list` 中位 **1.35 s → 0.166 s**，回归哨兵逐项一致 |
| D4 | **点击设置本身廉价**：click→可见 **13.2–19.8 ms**、**0 个 >50 ms 长任务**、形态为"恰丢 1 帧"；点击只触发 1 条 RPC（`agentPreset.list`） | 四条线独立收敛 |
| D5 | **我们四个补丁的靶点在点击相位全部不执行**（主题 apply / rAF 延后 / usage 9 路 / P2AC 回拷均 0 次）⇒ 与该路径**不相交**（不是错，是没打到） | regression 线 |
| D6 | **"点设置卡"的载体候选：设置弹窗全视口遮罩 `div.VOzbGW_mask` 的 `backdrop-filter: blur(2px)`**（A-B-A 消融 5/7 步抖动归零、重开弹窗完整复原）——**但有另一条线逆序复现失败 ⇒ 待四通道仲裁** | **未决** |

---

## 二、已撤回的结论（不得再引用）

| 撤回项 | 事实 |
|---|---|
| 「`WEBRENDER_COMPOSITOR` 被黑名单 ⇒ 有代价的降级」 | X11 上本就是**空降级**（原生合成器仅存在于 Wayland/Win/macOS），且 `ForceDisable` 写 runtime 槽、**无法用 pref 强开** |
| 「`DMABUF_SURFACE_EXPORT: blocked` ⇒ 每帧失去零拷贝」 | 该特性官方描述即 **"WebGL DMABuf surface export"**，**只作用于 WebGL**；通用 `DMABUF` 实测 `available`，合成器直接画进窗口 EGLSurface |
| 「`MESA_THREADING: failed` ⇒ 驱动调用压主线程」 | 是 Mozilla 对 **bug 1670545** 的**故意 workaround**；GL 上下文在 **RenderThread**，主线程未被压；**无可用用户开关** |
| 「Firefox 的 gfx 降级可解释 Codex 也卡」 | **跨栈误归因**：Codex 是 **Electron/Chromium**（自带 GPU 进程），Firefox 的 `gfxVar` / `PR_SetEnv(mesa_glthread=false)` 只作用于 Gecko 自己的进程树 |
| 「Codex 那个整窗 canvas」 | **不存在**：`data-avatar-overlay-backing-canvas` 是 framer-motion `div` 上的 **data 属性名**；31 个宠物/托盘成员中 **GL/WebGPU 构造者 = 0** |
| 「`pluginInventory.list` 耗时 >1.8 s（宿主无缓存重扫）」 | 该线**自曝为单样本过度解读并撤回**：定点复测 **41.9 ms 冷 / 27.6 ms 温**；宿主遍历内存 `ctx.loader.entries()`、**无 `fs`** |
| 「snap Firefox 沙箱/GPU 受限是主因」 | 图形设备 ACL 齐备、`GpuSandboxLevel:0`、`mesa/radeonsi` ⇒ 排除 |
| 「高回报率鼠标 + 每事件重排导致跟手掉帧」 | 三只鼠标均 USB Full Speed（≤1000Hz）；最坏实现 13.77 ms/1000 事件 = **1.4% CPU** |
| 「软件 WebRender」 | `合成: WebRender` + `GPU #1 活动: 是` ⇒ 排除 |

---

## 三、未决 / 边界（诚实清单）

1. **用户侧 a11y 关闭后的复测结论**（关键路径）：`about:support` 已确认 `已激活: false` / `强制停用: 1`；**主观"是否还卡"待用户回报** ⇒ 决定 ① 是否为主因。
2. **遮罩模糊是否载体**：四通道仪器仲裁线运行中（帧通道 / LongTask / LoAF / CDP trace 地面真值；前台 vs 后台 × rAF 内 vs 定时器内 × CDP 注入）。
3. **"切换后才变差"无法证实**：Glean store 与 archived ping **两条路径均无切换后的 gfx 直方图数据**（archived 最后一笔有数据是 09-12，其后 14 个 ping 全 0）⇒ **结构性"无数据"**。
4. **有头 Chromium 在本机 100% 启不来**（SIGTRAP/exit 133，连不存在的 `:9` 也崩），疑与 DLP 注入件同族 ⇒ **Paint/CompositeLayers 只有有头才能测，本机拿不到**。
5. **headless 保真度**：无 GPU 合成、无 AT-SPI 消费者 ⇒ 本批所有 headless"不卡"结论**只对主线程 JS/布局成立**。
6. **两个浏览器启动器都被改过** ⇒ 建议交 **IT/安全复核**（既是安全事项，也会持续污染排障）。
7. **NVIDIA 用户态栈异常**：`nvidia-smi` 报 `Failed to initialize NVML`，同机并存 `nvidia-utils-590` 与 `-595`、`nvidia-driver-590-open` 与 `-595-open`（可疑污染源）；**切回 4090 非软件开关**（由固件 boot-VGA + 显示器实际接线决定），方案 S0–S6 含回滚、**未执行任何一步**。

---

## 四、对用户可执行的两条最小动作

1. **已生效**：`accessibility.force_disabled = 1`（用户级、可回滚）。若主观卡顿消失 ⇒ 主因定案为"启动器强开 a11y"，后续只需让它保持 + 交 IT 复核启动器改动。
2. **若要独立验证环境放大器**（与 ① 正交、30 秒、可回滚）：GNOME「设置 → 显示器」缩放改回 **100%**（原生 3840×2160）；配合 Glean 累计计数器的**两次快照差值**做前后对比（快照 A 已存 `incident2/glean-ab/snap/`）。
