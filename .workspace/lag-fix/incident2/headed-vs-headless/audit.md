# incident2 / headed-vs-headless — 有头 vs 无头对照审计

- 目录：`.workspace/lag-fix/incident2/headed-vs-headless/`
- 时间：2026-09-22 10:10–10:45 (+08:00)
- 目标 URL：`http://127.0.0.1:3080/`（宿主 PID 10806 全程存活，未重启、未 pkill、未改产品）
- 判据协议：`research-v2/measure-hardening/docs/PROTOCOL.md` v1（预注册终点：`frames_over_50ms_ratio ≤ 0.02`、`long_task_total_ms_per_s ≤ 100`、click-to-paint ≤ 100 ms 为 secondary）
- 同一脚本同一判据：`measure-v2.mjs`（**所有组共用同一文件**），结果 `raw/v2-*.json`，汇总 `comparison.json`（`build-comparison.py` 可复算）

---

## 0. 一句话裁决

**用户症状无法在 headless 复现**（三种 headless 配置、9 个窗口，帧间隔 p95 = 16.7–16.8 ms、点击到面板 48–52 ms、**点击窗口内 0 个 LongTask**；9 个窗口中 7 个 >50 ms 帧数为 0，最差窗口 2 帧 / ≈240 帧 = 0.9%，远低于 0.02 门槛）；
**但这不是"没问题"的证据——headless 根本不把绘制计入统计**：`Paint` / `CompositeLayers` 在三种 headless 配置下**在 `Performance.getMetrics` 的指标名单里根本不存在**（不是"值为 0"，是"没有这一项"，已打印完整名单核对）。
有头下的可复现性**无法测量**，因为**本机存在硬阻塞：有头 Chromium 一律被 SIGTRAP 杀死**（§2 附完整取证与复现步骤）。

---

## 1. 环境盘点（任务 1）

| 项 | 实测值 | 来源 |
|---|---|---|
| `$DISPLAY` | `:1` | shell 环境 |
| `/tmp/.X11-unix` | `X1`（socket，X.Org 21.1.11，**真实 GPU 桌面**：Xorg + gdm + gnome-session，amdgpu，HDMI-A-2 5120×2880） | `xdpyinfo`/`xrandr` |
| `xvfb-run` / `Xvfb` | **均不存在**（PATH 与全盘 `find` 均无） | `command -v` / `find` |
| `Xephyr` | 存在，已成功在 `:2` 起独立嵌套 X（1920×1200），`xclock` 正常渲染 | `Xephyr :2 -screen 1920x1200 -ac` |
| Chromium | Playwright 1.49.1 捆绑 **Chromium 131.0.6778.33**（`~/.cache/ms-playwright/chromium-1148`）+ `headless_shell` 同版本 | `--version` |
| 显示器刷新率 | **60.00 Hz**（3840×2160@60 为当前模式；物理屏 5120×2880） | `xrandr` |
| headless 下 `screen.refreshRate` | **null**（浏览器不暴露） | 每个 artifact `screen_initial` |
| headless 下 rAF 节拍 | 16.6667 ms 稳定 → 等效 60 Hz（见 §3） | `frames.interval_series_after_click` |
| DPR | headless 测量为 **1**（1440×900 CSS = 1440×900 设备像素）；真实屏幕 5120×2880 @144 dpi | `screen_initial` |
| CDP `SystemInfo.getInfo` | **GPU 字段全空**（`devices: null`、`featureStatus: {}`、`auxAttributes: null`、`modelInfo: null`）；已加"先触发 WebGL 再重试"仍为空 → headless 拿不到 `chrome://gpu` 等价信息 | `raw/v2-A-systeminfo.json` |
| 间接 GPU 身份（唯一可得） | WebGL `UNMASKED_RENDERER` = `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` ⇒ **纯软件光栅** | `gpu.webgl` |
| 被服务的代码身份 | runtime rev `5559de4ce28c`、modules rev `7eb526320903`、frontend dist `index-ClqxG24t.js` + `index-C6eRlFa6.css` | `curl /` |
| 并发环境 | 兄弟线 `incident2-live-repro` 的 2 个 `headless_shell` 全程在场（`foreign_instances=2`），loadavg ≈ 5.5 | 每窗口 `environment.at_start` |

**环境阻碍（决定性）**：**有头 Chromium 在本机无法启动** —— 见 §2。

---

## 2. 有头组（B）不可测：根因取证

### 2.1 现象

`headless:false` 启动 Chromium → 进程被 **SIGTRAP** 杀死（exit 133），**确定性复现 6/6**：

```
exit=133 ... 追踪或断点陷阱 (core dumped)     # bash 报 "Trace/breakpoint trap"
```

```
[pid][err] chrome_crashpad_handler: --database is required
[pid][err] [pid:pid:0922/...:ERROR:socket.cc(120)] recvmsg: 连接被对方重置 (104)
--- SIGTRAP {si_signo=SIGTRAP, si_code=SI_KERNEL, si_addr=NULL} ---   # 主进程 34318 死点
```

### 2.2 已排除的因素（每项都有实测反证）

| 假设 | 反证 |
|---|---|
| 缺少 X display | 在 `:1`（真 GPU 桌面）与 `:2`（Xephyr 嵌套 X）**均崩**；`xclock` 在 `:2` 正常渲染 |
| X 授权失败 | strace 显示 `connect(@/tmp/.X11-unix/X1)=0` **成功**、`openat("/run/user/1001/gdm/Xauthority")=3` **成功**；`xset q`/`xdpyinfo` 正常 |
| 参数组合错误 | 极简参数（`--no-sandbox --user-data-dir --no-first-run about:blank`）也崩；Playwright 完整参数集也崩；`--disable-gpu`、`--single-process`、`--ozone-platform=headless`、`--remote-debugging-pipe` 全崩 |
| 产品/页面导致 | 崩在 `about:blank`，**页面尚未加载** |
| `--headless=new`（全浏览器无头）可绕开 | 同样 SIGTRAP（exit 133） |
| 外部 ptrace 注入 | 崩溃进程自身 `ptrace` 系统调用计数 = **0**；无 attach 记录 |
| apport/gdb 可给出回溯 | `/proc/PID/mem` 权限不足（13），gdb 无法附加；core limit = 0，apport 记 `signal 5`（SIGTRAP）后被 `executable does not belong to a package` 丢弃 |
| 换成别的有头浏览器 | 系统 Firefox 是 **snap 包**，在本会话 `cap_dac_override` 缺失 → `snap-confine ... cannot continue`（exit 1），不可用 |

### 2.3 最可能根因（**INCONCLUSIVE**，不下结论）

本机装有一套**企业准入控制 / 屏幕水印 DLP 代理**，且对进程做了**注入式挂钩**：
`/usr/lib/x86_64-linux-gnu/libPrintCtrl.so`（8.9 MB，root 安装）+ `/usr/local/.OCular/{LMonitor,LAgent,LSDConfig,LMonitorFileOP,...}`（root 常驻）
+ `/etc/.OCular/` 配置 + `/var/log/TecAgentLog/`。

Chrome 主进程的 strace 显示崩前**确有以下动作**：
```
connect(AF_INET 127.0.0.1:30800) = -1 ECONNREFUSED
connect(AF_INET 127.0.0.1:30802) = -1 ECONNREFUSED
connect(AF_UNIX @/tmp/.X11-unix/X1) = 0
connect(AF_INET 0.0.0.0:8721) = 0        # 代理接口，连接成功
openat("/run/user/1001/gdm/Xauthority") = 5
--- SIGTRAP (SI_KERNEL) ---               # 紧接着即死
```
即：**`libPrintCtrl.so` 只在"要开窗/要连 X"的路径上被加载并连上代理 8721 端口，随后主进程立刻 `int3` 自陷**；而纯 `headless_shell` 二进制（不加载该库、不走开窗路径）可长时间稳定运行。

> 归属说明：`SI_KERNEL` 表示 `int3` 指令自陷（Chromium 的 `ImmediateCrash()`/`CHECK` 失败即此形态），**不能**据此断定是代理主动 kill，也不能断定是 Chromium 自身 CHECK。**两者都无法在本权限下证伪 ⇒ INCONCLUSIVE。**

### 2.4 复现步骤（给协调者/用户，只读、不改产品）

```bash
CH=~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome
# 1) 有头最小复现（本机 100% 复现）
timeout 20 env DISPLAY=:1 $CH --no-sandbox --user-data-dir=/tmp/repro --no-first-run about:blank; echo "exit=$?"   # 期望 133
# 2) 反证：同二进制 --version 正常，headless_shell 正常
$CH --version
timeout 20 env DISPLAY=:1 ~/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell \
  --no-sandbox --user-data-dir=/tmp/repro2 --no-first-run --headless about:blank; echo "exit=$?"   # 期望 124(=一直在跑)
# 3) 隔离 display 也要崩（排除 X 因素）
Xephyr :2 -screen 1920x1200 -ac -nolisten tcp -noreset & sleep 3
timeout 20 env DISPLAY=:2 $CH --no-sandbox --user-data-dir=/tmp/repro3 --no-first-run about:blank; echo "exit=$?"   # 期望 133
# 4) 观察注入库与代理端口
grep -E "PrintCtrl|8721|Xauthority|SIGTRAP" <strace 输出>
```
**绕过该阻塞的唯一路径是环境侧**：由管理员在 DLP/准入策略里放行 Chromium（或提供已放行的浏览器），否则有头测量在本机**永久不可得**。这与任务提示的"用 xvfb-run"不冲突——但要注意：①本机**没有 Xvfb/xvfb-run**（需先说清，否则照抄提示会失败）；②即使装上 Xvfb，也仍有概率被同一代理拦截（本机在真实 X 上也崩）。

---

## 3. 三组对照结果（任务 2）

> 所有数字来自 `measure-v2.mjs` 的 9 个窗口 + 2 个专用探针窗口；逐条原始 JSON 见 `raw/`。
> 每组 3 次重复，**浏览器严格串行**（同一时刻仅 1 个自建实例，`logs/runner.log` 有并发门禁读数）。

### 3.1 主表（各窗口原始值）

| 指标 | A (headless) r1/r2/r3 | C-nogpu r1/r2/r3 | C-gpu r1/r2/r3 |
|---|---|---|---|
| click→面板可见帧 (ms) | 48.4 / 48.3 / 51.9 | 48.6 / 48.0 / 49.0 | 48.5 / 48.4 / 48.0 |
| 帧间隔 p50 (ms) | 16.7 / 16.7 / 16.7 | 16.7 / 16.7 / 16.7 | 16.7 / 16.7 / 16.7 |
| 帧间隔 p95 (ms) | 16.8 / 16.8 / 16.7 | 16.8 / 16.8 / 16.8 | 16.8 / 16.8 / 16.8 |
| 帧间隔 p99 (ms) | 16.8 / **33.3** / 16.8 | 16.8 / 16.8 / 16.8 | 16.8 / 16.8 / **49.9** |
| 帧间隔 max (ms) | 33.3 / 83.4 / 16.8 | 16.8 / 16.8 / 50.0 | 50.0 / 50.0 / 66.7 |
| >50 ms 帧数 | 0 / 2 / 0 | 0 / 0 / 0 | 0 / 0 / 2 |
| `frames_over_50ms_ratio`（门槛 ≤0.02） | 0 / 0.009 / 0 | 0 / 0 / 0 | 0 / 0 / 0.009 |
| LongTask 数（点击后） | **0 / 0 / 0** | **0 / 0 / 0** | **0 / 0 / 0** |
| LongTask 数（文档全程，多为加载期） | 3 / 3 / 3 | 3 / 2 / 3 | 3 / 3 / 3 |
| LongTask max (ms) | 95 / 94 / 99 | 88 / 93 / 93 | 90 / 87 / 87 |
| ScriptDuration Δ (ms) | 153 / 576 / 303 | 189 / 188 / 264 | 469 / 590 / 706 |
| TaskDuration Δ (ms) | 255 / 678 / 421 | 281 / 305 / 348 | 624 / 739 / 836 |
| RecalcStyleDuration Δ (ms) | 22 / 23 / 26 | 25 / 16 / 20 | 20 / 36 / 32 |
| LayoutDuration Δ (ms) | 5 / 4 / 4 | 4 / 9 / 4 | 10 / 5 / 6 |
| LayoutCount Δ | 3 / 2 / 2 | 2 / 7 / 2 | 6 / 3 / 3 |
| RecalcStyleCount Δ | 253 / 242 / 254 | 253 / 139 / 249 | 133 / 253 / 238 |
| **`Paint` 存在/非零** | **否 / 否** | **否 / 否** | **否 / 否** |
| **`CompositeLayers` 存在/非零** | **否 / 否** | **否 / 否** | **否 / 否** |
| LoF 条数 / 总量 | 0–1 / ≤0.033 | 0 / 0 | 0 / 0 |

（`raw/v2-*.json`；"Δ"= 从点击前基线到面板可见后 +4 s 结算的 CDP 累计差值，窗口 ≈4.1 s）

### 3.1bis B 组（有头）三显位取证

`raw/v2-B-display{1,2,9}.json`：三个显位（真 GPU 桌面 `:1`、Xephyr 嵌套 `:2`、**不存在的 `:9`**）**全部** `launch-failed`，
三份 fatal 文本**等长（3595 B）且除临时 profile 名与 PID 外完全相同**（唯一差异区在偏移 1492 附近：
`playwright_chromiumdev_profile-XXXX` / `pid=NNNNNN`）⇒ 崩点与 X 显位**无关**，发生在 X 连接之前的启动路径上（§2）。
（"在 `:9` 上也以同样文本失败"是关键反证：连不存在的 display 都不会改变失败形态。）

### 3.2 关键"能测到卡"的对照实验（**本审计最重要的方法学证据**）

在 headless 里**人为注入 120 ms 主线程阻塞**，看 rAF 流能否记录到卡顿（`probe-startup-control.mjs`）：

| arm | 控制块实测 | rAF 窗口 max | >50 ms 帧数 | 结论 |
|---|---|---|---|---|
| A | 120 ms | **100 ms** | **1** | ✅ 仪器**能**测到卡顿 |
| C-nogpu | 120 ms | **100 ms** | **1** | ✅ 同上 |

⇒ **headless 的"不卡"不是仪器失灵**（它连 120 ms 的故意阻塞都如实记成 ~100 ms 掉帧）。
⇒ 但**真实用户点击**在 headless 下：`click→visible = 48–50 ms`、点击窗口内 **LongTask = 0**、帧间隔 max = 16.7–33.4 ms。

### 3.3 启动成本 vs 点击成本（专用探针，A 与 C-nogpu 各一次）

| 阶段 | A | C-nogpu |
|---|---|---|
| 加载期 6 s 内 LongTask | 3 个：104+95 ms、201.9+52 ms、354.6+69 ms（合计 216 ms） | 3 个（同为加载期） |
| **点击紧窗口**（严格 click→visible，CDP 窗口仅 95.6 ms） | Script 44.2 ms / Task 67.5 ms / Recalc 3.4 ms / Layout 5.6 ms / LayoutCount 2 / RecalcStyleCount 12 / **LongTask 0** | 窗口更短，Task 23.6 ms / LayoutCount 3 / RecalcStyleCount 9 / **LongTask 0** |
| 空闲 3 s 窗口 | Task 353 ms、Script 290 ms、**RecalcStyleCount 181**、LayoutCount 0、rAF 185 帧、Paint ABSENT | Task 487 ms、RecalcStyleCount 0、LayoutCount 0 |

**要点**：campaign 里那 3 个 LongTask **全部落在加载期（28–590 ms，点击发生在 2980–4630 ms）**，点击窗口内 0 个。
⇒ 之前把 `long_task_total_ms_per_s ≈ 54` 当作"设置页卡顿"是**口径错误**：它被加载期任务主导，不是点击成本（本审计已把该字段标注为"文档全程，非点击窗口"）。

---

## 4. 逐条 PASS / FAIL / INCONCLUSIVE（任务 3、4）

| # | 判据 | 裁决 | 证据 |
|---|---|---|---|
| 1 | 用户症状**能否在 headless 复现** | **FAIL（不能复现）** | 9/9 窗口 p95=16.8 ms、>50 ms 帧 0–2（比值 ≤0.009 < 0.02）、点击窗口 LongTask 0、click→visible 48–50 ms；且控制实验证明仪器灵敏度足够（120 ms 阻塞→100 ms 掉帧）。**"不能复现"成立。** |
| 2 | 若不能，**有头下是否有可复现卡顿（量级）** | **INCONCLUSIVE** | 有头 Chromium 100% 启动失败（§2）。**无法给出任何量级**；任何"有头也一样顺/一样卡"的说法都无证据。 |
| 3 | **哪条指标只有有头才能观测** | **PASS（已确定）** | `Paint` 与 `CompositeLayers` 在 A / C-nogpu / C-gpu **全部缺席**（`Paint_present=false`、`CompositeLayers_present=false`，且 metric 名单里根本没有这两项）。`Page` 域（MainFrame/Subframes/…）未采集 ⇒ 光栅化/合成/GPU 线程耗时**在 headless 下结构性不可见**。另：`SystemInfo.getInfo` 的 GPU 字段（devices/featureStatus/auxAttributes/modelInfo）在 headless 下**全空**，`chrome://gpu` 等价信息也只能有头（或真实 GPU 进程）才拿得到。 |
| 4 | 刷新率差异是否是差异来源 | **PASS（已排除为主因）** | 真实屏 60.00 Hz，headless rAF 节拍 16.6667 ms = 60 Hz；**节拍一致**。差异不在频率，而在**合成/绘制路径与 DPR**（headless DPR=1，真实屏 5120×2880 高 DPI）。 |
| 5 | DPR / 可视尺寸是否已被记录 | **PASS** | 每窗口 `screen_initial`：DPR、inner/outer、screen、avail、visualViewport、orientation、`refreshRate`（null 也如实记录）。 |
| 6 | `--disable-gpu` 与启用 GPU 的差异（任务 2 的 C 组） | **INCONCLUSIVE** | C-nogpu 与 C-gpu 与 A **无可区分差异**（所有末端指标在噪声内一致），但**三者全是软件光栅**（WebGL renderer 均为 SwiftShader）、且 **Paint/CompositeLayers 全缺席** ⇒ 所谓"C 组有 GPU"并不成立：**本机根本没有可用的 GPU 渲染路径**，"启用 GPU 的 headless"这个对照组在当前环境**构造不出来**（全浏览器 `--headless=new` 亦被 SIGTRAP 杀死，见 §2.2）。 |
| 7 | 点击→面板可见耗时（有头专有的 click-to-paint 口径） | **INCONCLUSIVE** | 真实 **click-to-paint**（含合成/上屏）在有头下才成立；本机只能用 click→"含设置面特征的下一帧"（headless 下 ≈48–50 ms，约 3 帧）。**不能当作有头的 click-to-paint。** |
| 8 | LoF（布局偏移） | **PASS（可测，值为 0）** | 9/9 窗口 LoF ≤1 条、累计 ≤0.033；不是本症状来源。 |
| 9 | 只有有头才有的成本项 → **归属到 bundle/行号** | **INCONCLUSIVE** | 见 §5：**无法归属**。headless 从未绘制，paint/composite 成本为 0/不可见，因此**没有任何观测能把某个成本项钉到某 bundle 的某一行**。只能给出待验证假设 + 验证方法。 |
| 10 | 单浏览器实例 / 不点保存应用删除 / 不 pkill | **PASS** | `logs/runner.log`；A→C-nogpu→C-gpu 严格串行；只点击设置入口；全程未对任何进程投信号（`kill`/`pkill` 计数 0）。 |
| 11 | 协议锁 | **PASS（如实记录，未持锁）** | 共享锁 `.workspace/lag-fix/research-v2/.probe.lock` 被兄弟线 `incident2-live-repro` **持续占用**；等待 150 s 后按纪律**记录并继续**（`logs/preemptions.log` 记 `contention_no_shared_lock`），未抢占活锁；每窗口 `foreign_instances=2` ⇒ `baseline_status=contended`、`usable_as_baseline=false`（绝对值不得当基线，仅口径/门禁/同窗相对比较可用）。 |

---

## 5. 只有有头才有的成本项：归属与假设（**INCONCLUSIVE**，按任务 4 要求只给假设+验证法）

### 5.1 结论先说：**无法给出 bundle/行号归属**

理由是结构性的，不是没找：
1. headless 全程 `Paint`/`CompositeLayers` **缺席** ⇒ 绘制/合成的**时间成本在观测口径里根本不存在**（不是"为 0"，是"未统计"）。
2. 因此 headless 拿不到任何"有头才付的成本"样本，**任何行号级归属都是编的**。
3. 唯一能做的替代归属是**有头侧**（需要 §2 的环境放行），或**用户侧自采 trace**。

### 5.2 可给出的成本项清单（有头才会真正支付，按可能性排序）

| 候选成本项 | 为什么只可能有头 | 可测性 |
|---|---|---|
| a. 设置面板打开时的**图层化 + 光栅化 + 合成**（大圆角/阴影/`backdrop-filter` 模糊背景/壁纸图层） | headless 不合成，`CompositeLayers` 缺席 | 仅 trace / 有头 CDP |
| b. **高 DPI 光栅**（真实屏 5120×2880；headless DPR=1） ⇒ 像素量约 **4×**（DPR 2 时） | headless DPR 固定 1 | 有头设 DPR/真机 |
| c. **GPU→CPU 回读 / 上传**（壁纸图片、字体图集上传到 GPU 纹理） | 无 GPU 进程路径则不存在该传输 | 仅 trace |
| d. **vsync 对齐的真实 click-to-paint**（headless rAF 由 CPU 合成器驱动，不等真实上屏） | 协议 §6.4 已列为未验证项 | 有头 |
| e. ~~有头专属的 hover/pointer 样式路径~~ | **已被本审计实测否定（见 §5.4）** | 不再计入 |

> **§5.4 hover/pointer 消融（已做，结论：不是差异来源）**：历史 headless 探针带
> `--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4`，
> 语义上是"无 hover / 无精细指针"。用 `probe-hover-capability.mjs` 做消融（3+3 次）：
> | mode | `any-hover:hover` / `any-pointer:fine` | click→可见帧 | 点击后帧数 | RecalcStyleDuration | RecalcStyleCount | LayoutCount | hover 事件 |
> |---|---|---|---|---|---|---|---|
> | hoverless（带该 pin） | **true / true** | 40.8 / 38.9 / 40.8 ms | 3 / 3 / 2 | 2.39 / 2.43 / 2.33 ms | 8 / 8 / 8 | 2 / 2 / 2 | 4 / 4 / 4 |
> | natural（不带） | **true / true** | 37.3 / 35.8 ms（1 次无效） | 2 / 2 | 2.84 / 2.35 ms | 7 / 7 | 2 / 2 | 4 / 4 / 4 |
>
> ⇒ ① 该 pin 在 Chromium 131 上**并未真的把能力降级**（两种模式的能力查询结果完全相同）；
> ② 因此"hover 样式成本被结构性抹掉"这一怀疑**不成立**，不是 headless 测不到的成因。
> （这条消融的价值是**排除了一个高可能性的替代解释**，避免把环境差异误当成根因。）

### 5.3 验证方法（可执行，按优先级）

1. **环境放行后重跑本目录脚本**（零改动）：`N=3 DISPLAY_TO_USE=:1 bash run-campaign.sh` —— 有头组会自动开始产出数据并把 `Paint`/`CompositeLayers` 项填上；若 B 组仍 `launch-failed`（exit 133），说明策略未放行。
2. **有头 + DPR 2** 与 **有头 + DPR 1** 对照：若 b 项成立，paint/composite 时间应≈随像素量放大。
3. ~~hover 消融~~ **已做，见 §5.4：不是差异来源。**
4. **用户侧 10 s trace**：由用户在自己浏览器 `chrome://tracing` 或 DevTools Performance 录一次"点设置"，直接给到 `CompositeLayers`/`Paint` 的真实数值——**这是当前唯一能立刻拿到有头 ground truth 的路径**。

---

## 6. 产物清单

| 文件 | 内容 |
|---|---|
| `audit.md` | 本报告 |
| `comparison.json` | 机器可读汇总（各 arm 中位数/极值、启动/控制探针、baseline_status） |
| `build-comparison.py` | 由原始 JSON **复算** comparison.json 的脚本 |
| `measure-v2.mjs` | 主探针（三组共用的同一文件） |
| `measure.mjs` | v1 探针（保留溯源；三个缺陷见下方"方法学修订"） |
| `probe-startup-control.mjs` | 启动期 vs 点击期分离 + **120 ms 控制阻塞灵敏度实验** |
| `probe-hover-capability.mjs` | hover/pointer 能力消融（`raw/hover2-*.json`） |
| `probe-hover-ablation.mjs` | 上一版消融（判据过松，保留溯源；结论以 `probe-hover-capability.mjs` 为准） |
| `run-campaign.sh` | 串行编排 + 锁协议 + 并发门禁 |
| `LOCK.md` | 锁协议与纪律 |
| `raw/v2-{A,C-nogpu,C-gpu}-r{1,2,3}.json` | 9 个对照窗口原始数据 |
| `raw/startup-{A,C-nogpu}.json` | 启动/点击分离 + 控制实验原始数据 |
| `raw/hover2-{hoverless,natural}-r{1,2,3}.json` | hover/pointer 消融原始数据 |
| `raw/v2-B-display{1,2,9}.json` | **有头失败**取证（三个显位，fatal 逐字节相同） |
| `raw/v2-A-systeminfo.json` | SystemInfo GPU 字段全空的取证 |
| `raw/v2-B-display{1,2,9}.json` | **有头失败**取证（三个显位；fatal/launch 日志，`launch-failed`/exit 133） |
| `raw/[AC]-r*.json`、`raw/smoke-*.json` | v1 数据，仅溯源，不用于结论 |
| `shots/A-r{0..3}-settings.png` | headless 下设置面板截图（面板确实打开：侧栏 8 项 + 通用设置内容，见人眼/视觉复核） |
| `logs/runner.log`、`logs/preemptions.log` | 并发门禁读数、锁竞争记录 |
| `logs/headed-block-strace.txt`、`logs/headed-block-gdb.txt` | 有头阻塞的 strace/gdb 原始输出 |

### 方法学修订（v1 → v2，必须声明）

v1（`measure.mjs`）有三个缺陷，导致 v1 数据**不能**用于结论：
1. **就绪判据过严**：要求 `body.innerText.length > 200`，在 2/9 窗口误判 `page-never-ready`（页面其实已可用）；
2. **click→可见帧标记从未触发**：`markClick` 在点击时才注册，而 rAF 轮询循环只在"点击之后新建的 document"上注册，SPA 不换 document ⇒ `click_to_panel_visible_frame_ms` 恒为 null；
3. 由 2 派生：v1 的"点击到面板"只有 Node 侧 50 ms 轮询分辨率（恒为 2 ms），无信息量。

v2 修好三点（每帧闭环检测，分辨率 = 1 帧），并新增"控制阻塞"灵敏度实验。**审计中所有数字均来自 v2。**

---

## 7. 给协调者的下一步建议（按性价比）

1. **需要外部条件（最高优先）**：请用户/管理员放行 Chromium 的窗口化启动（DLP/准入策略，见 §2.3–2.4），否则"有头 vs 无头"在本机**永远无法闭环**；在此之前，任何"有头也这样/有头更卡"的结论都属于无证据。
2. **最快拿到有头真值**：请用户在自己浏览器里录 10 s（点一次设置）的 Performance trace 并导出——直接给 `Paint`/`CompositeLayers`/`click-to-paint` 真值，比本机继续折腾环境更快。**这是当前唯一可立即获得有头 ground truth 的路径。**
3. **顺带纠正历史口径**：`long_task_total_ms_per_s ≈ 54`（以及历史同名字段）在本轮被证明**由加载期任务主导**（点击窗口内 0 个 LongTask），**不是设置点击成本**；引用该字段作"设置页卡顿"证据的旧结论应重新标注口径。
4. **已被排除的方向（不要再花时间）**：hover/pointer 能力差异（§5.4 实测否定）、刷新率差异（两侧均为 60 Hz）、`--disable-gpu` vs 软件 GPU（无可区分差异且两者都无 paint）。
