# incident2 / live-repro — 「全新页面首次点设置」路径的活体测量审计

- 测量线：`incident2/live-repro`（本文所引数据全部由本线自己采集，未复用他线结论）
- 宿主：`node /home/CNS2026495165/.npm-global/bin/dsh web`，PID **10806**（全程存活，未重启/未 pkill/未改产品文件）
- GUI：http://127.0.0.1:3080/ （`https://127.0.0.1:3080` 同源）
- 浏览器：Playwright chromium **131.0.6778.33**；headless 走 `chromium_headless_shell-1148`
- 数据代次冻结：`raw/FROZEN-MANIFEST.txt`（本文所有数字对应下列 sha1，若文件被后续运行覆盖则以 manifest 为准）

| 文件 | sha1 | 内容 |
|---|---|---|
| `raw/headless-run1.json` | `60f2d68b0614…` | headless 正式 1：idle 6s + 点设置 ×3 |
| `raw/headless-run2.json` | `60840f0e493d…` | headless 正式 2：同上 |
| `raw/arm2-headless.json` | `be84244f768d…` | 仪器正对照 + 早点击（0ms / 1500ms）|
| `raw/headed-run1.json` `raw/headed-run2.json` | `47ee2317…` `fe513993…` | headed 两次尝试（均启动失败，ERROR 记录，保留）|
| `raw/headed-diag.json` | `212a7e8279…` | headed 不可用根因诊断（4 组配方）|
| `raw/longtask-probe-headless.json` | `ad423f316798…` | Long Tasks 通道特性（4 种注入方式）|

完整清单与全部 sha1：`raw/FROZEN-MANIFEST.txt`。

> **数据代次警告**：本目录早前的一代 `headless-run*`（10:18/10:19）已被同名文件覆盖，其数字（idle Task 178ms、首位点击 vis 23.8ms）**不在本文引用范围内**。本文只引用上表 sha1。独立审计档（`sub-audit/`）审的正是 `60f2d68b` / `60840f0e` 这一代，与本表一致。

---

## 1. 前提自证 —— 结论 PASS

### 1.1 HTML 注入 rev == 磁盘 sha1-12（四包全查）

`curl -s http://127.0.0.1:3080/` 落盘 `raw/index.html`（16,611 B），逐个比对：

| 包 | HTML 注入 rev | 磁盘 sha1-12 | 磁盘字节 | 一致 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | 24,988 | ✅ |
| `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | 31,803 | ✅ |
| `@deepseek-ai/dsh-client-runtime` | `5559de4ce28c` | `5559de4ce28c` | 398,569 | ✅ |
| `@local/dsh-usage` | `4536b91ed282` | `4536b91ed282` | 72,804 | ✅ |

并且**服务端实际下发的字节**也等于磁盘（`curl "$url?rev=$rev"` → sha1-12 全部等于 rev）：

```
ui-layout   sha1-12=82cca1a6178a  size=24988    (标记合并 grep 命中 7)
wallpaper   sha1-12=826d9217a8fc  size=31803
runtime     sha1-12=5559de4ce28c  size=398569
usage       sha1-12=4536b91ed282  size=72804
```
（`raw/served-*.js`；独立静态审计档 `sub-static/` 用 `cmp` 复核 byte-identical，PASS 4/4）

### 1.2 证明页面确实执行了新代码（不是缓存旧版）

页内 `fetch(url,{cache:'no-store'})` → `crypto.subtle.digest('SHA-1')` → 与 URL rev 比对，并搜修复标记。
**四包全部 `ok=true`**（`markerProof`，在 headless-run1/run2/arm2 三次独立页面里都复现）：

| 包 | 页内 sha1-12 | == rev | 修复标记命中数 |
|---|---|---|---|
| ui-layout | `82cca1a6178a` | ✅ | `scheduleThemeColorRefresh` 3、`lastSignature` 4、`themeColorRefreshQueue` 4 |
| wallpaper | `826d9217a8fc` | ✅ | `shadedTokens` 3、`sameShadedTokens` 2 |
| runtime | `5559de4ce28c` | ✅ | `p2ac-fix` 4 |
| usage | `4536b91ed282` | ✅ | `dsh-perf-fix R4 v1` 1 |

标记的**反证**（`sub-static/`）：四个标记在各自 pre-image 里命中数 **全为 0**，且 pre-image 与 deployed 通过相邻 meta 文件的 md5/sha256 做了密码学配对（不是靠同名推断）。另注意一处陷阱：runtime 里 `/* dsh-perf-fix P2 v1 */` **新旧版都有 2 次**，只有 `p2ac-fix` 能区分本补丁。

> 附带修正（静态档 D3）：`?rev=` **不是服务端内容销钉**——请求 `?rev=deadbeef0000` 同样 200 且字节相同，服务端恒发当前磁盘内容；防陈旧只靠 `cache-control: no-cache`。因此"rev 一致"证明的是"HTML 指向当前磁盘"，"页内 sha1 == rev"才证明"页面拿到的是当前字节"。

### 1.3 已拿到的关键前提：**静息态已被修复，完全安静**

6 秒 idle 窗口（两代独立运行）：

| run | 帧数 | p50 | max | >33.4ms | Task | Script | **RecalcStyleCount** | **LayoutCount** |
|---|---|---|---|---|---|---|---|---|
| headless-run1 | 361 | 16.7 | 17.20 | 0 | 90.2ms | 28.4ms | **0** | **0** |
| headless-run2 | 361 | 16.7 | 17.00 | 0 | 74.3ms | 18.4ms | **0** | **0** |

即 idle 时 60.0 rAF/s、主线程 **12.4–15.0 ms/s**、**6 秒内强制重算 0 次、布局 0 次**。这直接支持"主题重放跳过"已生效——与落地前对照（`recalc 208→0.4–11.4 ms/s`）方向一致。

---

## 2. 测量方法（为什么判读可信）

- **不 sleep 判可见**：页内 `MutationObserver`(childList/subtree) 抓 `[role="dialog"]` 插入时刻 `t_dom`；随后 `requestAnimationFrame` 双帧确认 `getBoundingClientRect()` 非零 + `visibility/display/opacity` 正常 → `t_vis`、`t_paint`。点击瞬间由 window 捕获阶段 `click` 监听器记 `performance.now()`（真实鼠标事件，非 `el.click()`）。
- **逐帧序列**：连续 rAF 循环记录 `[t, dt]`，**不预设窗口**，事后按 marks 切片 → 可给出点击前后任意区间的完整间隔序列。
- **CDP 窗口 delta**：`Performance.enable` + `getMetrics` 在窗口边界取样，取 Task/Script/RecalcStyle/Layout 的 duration 与 count 差值。
- **LongTask / LoF 明细**：`PerformanceObserver`（buffered）抓 `longtask` 与 `long-animation-frame`，LoF 展开 `scripts[]`（name/invoker/dur/forcedStyleAndLayout/sourceURL）。
- **仪器正对照**（关键，见 §6）：注入 180ms 阻塞忙循环，验证三通道能否检出。
- 只点「设置」触发器（开/关抽屉），**从不点保存/应用/删除**；每窗一个浏览器实例。

---

## 3. 点击路径精确测量 —— 结论：**微卡，无冻结**

### 3.1 click → dialog 可见耗时

| 数据 | 序 | click→DOM | **click→可见** | click→双帧 | Playwright 判可见 |
|---|---|---|---|---|---|
| headless-run1 | 1（首开）| 16.8 | **19.7** | 51.9 | 3 |
| | 2（复开）| 10.3 | **13.7** | 38.7 | 4 |
| | 3（复开）| 5.7 | **14.2** | 43.4 | 4 |
| headless-run2 | 1（首开）| 16.4 | **19.8** | 27.6 | 2 |
| | 2（复开）| 9.2 | **15.0** | 37.8 | 3 |
| | 3（复开）| 11.4 | **14.2** | 44.5 | 3 |

**首开 19.7/19.8ms，复开 13.7–15.0ms**（两次独立运行几乎重合，差异 < 0.1ms 级别）。抽屉 DOM 插入 ~17ms、rAF 可见 ~20ms。

### 3.2 点击前后逐帧间隔序列

基线（idle 6s，361 帧）：p50 **16.7**、max 17.0–17.2、**0 帧 ≥33.4ms** —— 干净的 60Hz。

点击后 300ms 内的实际序列（`dt`，毫秒）：

```
run1 click1: [24.3, 32.3, 10.0, 16.7, 16.6, 16.7, 16.7, 16.8, 16.6, 16.7, 16.8, 16.4, ...]
run2 click1: [25.5,  7.9, 24.4,  8.9, 16.7, 16.6, 16.7, 16.6, 16.7, 16.7, 16.6, 16.8, ...]
run1 click2: [17.0, 25.0,  8.2, 16.6, 16.7, 16.6, 16.8, 16.6, 16.6, 16.6, 16.7, 16.8, ...]
run1 click3: [16.8, 29.1,  4.1, 16.7, 16.7, 16.7, 16.7, 16.6, 16.6, 16.9, 17.9, 15.4, ...]
run2 click2: [17.0, 22.7, 10.3, 16.7, 16.8, 16.7, 16.5, 16.8, 16.6, 16.7, 16.7, 16.6, ...]
run2 click3: [17.3, 30.5,  2.1, 17.0, 16.5, 16.7, 16.6, 16.7, 16.7, 16.6, 16.7, 16.6, ...]
```

**形态高度一致**：一次点击 = 一个**长帧（22.7–32.3ms）紧跟一个极短帧（2.1–10.3ms）**，两者之和 ≈ 33–35ms ≈ 恰好一个 vsync 周期。
即：渲染提交把**当前帧**推过预算约 6–16ms，**恰好丢 1 帧**，下一帧立刻补上——教科书式的"单帧丢弃"，不是停顿。

首开与复开的差别：**首开出现两组这样的"长+短"对**（run1 `24.3+32.3+10.0`、run2 `25.5+7.9+24.4+8.9`），**复开只出现一组**。即首开多付一次提交，绝对代价仍只有 ~1 帧。

### 3.3 3 秒窗口 delta 与事件明细

| 数据 | 序 | 窗口帧 p50 / max / >33.4 / **>50** | LongTask | LoF | **Task** | Script | RecalcN | LayoutN | console/pageerror |
|---|---|---|---|---|---|---|---|---|---|
| run1 | 1 | 16.7 / 33.4 / 1 / **0** | **0** | **0** | 102.1ms | 36.3ms | 9 | 4 | 0 / 0 |
| run1 | 2 | 16.7 / 25.0 / 0 / **0** | **0** | **0** | 87.7ms | 33.2ms | 9 | 3 | 0 / 0 |
| run1 | 3 | 16.7 / 29.1 / 0 / **0** | **0** | **0** | 57.2ms | 30.0ms | 8 | 3 | 0 / 0 |
| run2 | 1 | 16.7 / 25.5 / 0 / **0** | **0** | **0** | 81.2ms | 19.0ms | 8 | 3 | 0 / 0 |
| run2 | 2 | 16.7 / 22.7 / 0 / **0** | **0** | **0** | 78.8ms | 46.1ms | 9 | 3 | 0 / 0 |
| run2 | 3 | 16.7 / 30.5 / 0 / **0** | **0** | **0** | 81.9ms | 32.2ms | 9 | 3 | 0 / 0 |

- 窗口内 **Task 57.2–102.1ms / 3.03s = 19–34 ms/s**，Script 19.0–46.1ms。
- **零 LongTask、零 LoF、零 console 错误/警告、零 pageerror**。
- 那唯一一个 33.4ms 帧（run1 click1）**位于点击后 2595ms**，与点击无因果关系（独立审计亦指出此点）。

---

## 4. 形态判定（区分"一次大冻结" vs "持续掉帧"）

**归类：两者都不是 —— 属于 MINOR（每次点击恰好丢 1 帧的单帧丢弃）**

| 判据 | 阈值 | 实测 | 结论 |
|---|---|---|---|
| 是否存在**单个 ≥100ms** 主线程任务 | 冻结特征 | 最大帧间隔 **33.4ms**；窗口内 **0 帧 ≥50ms**；**LongTask 0 条、LoF 0 条**——而两条通道均已由正对照验证可检出 180–188ms 阻塞（§6）| **否（验证过的阴性）** |
| 是否存在**持续 30–80ms 帧列** | 持续掉帧特征 | 每次点击只有 **1 个** 22.7–32.3ms 帧（首开 2 个），且紧跟短帧补回 | **否** |
| 点击是否被延迟响应 | — | click→可见 **13.7–19.8ms**，即 **≤1 帧** | **否** |
| 主线程窗口占用 | — | 19–34 ms/s（idle 基线 12.4–15.0 ms/s）| 轻微抬升 |

**时间线（headless-run2 click1，页面时间 ms，以点击 t=0）**：

```
  -20ms  idle 基线 16.7ms 稳定
    0    真实 mouse click（捕获阶段记录）
   19.6  帧 dt=25.5  ← 长帧：提交把本帧推过预算
   27.5  帧 dt= 7.9  ← 立即补帧（丢 1 帧）
   51.9  帧 dt=24.4  ← 首开第二次提交
   60.8  帧 dt= 8.9  ← 立即补帧
   ~63   起恢复 16.6–16.7ms 直到窗口结束（无后续异常）
  ~19   抽屉 DOM 已插入 [role=dialog]
  ~20   rAF 确认可见（800×800）
```

### 首开 vs 复开对照

| | click→DOM | click→可见 | 长帧对数 | Task/3s | RecalcN |
|---|---|---|---|---|---|
| **首开** | 16.4–16.8 | **19.7–19.8** | **2** | 81–102ms | 8–9 |
| **复开(2)** | 9.2–10.3 | 13.7–15.0 | 1 | 79–88ms | 9 |
| **复开(3)** | 5.7–11.4 | 14.2 | 1 | 57–82ms | 8–9 |

**首开确实比复开贵**（DOM 插入慢 ~1.6–2.9×，可见慢 ~1.4×，多一次提交），但**绝对量级都在 20ms 以内**——即"首开 vs 复开不同"成立，但差异是 6ms 量级，**不构成可感知卡顿**。

---

## 5. 早点击臂（用户真实路径：打开页面立刻点设置）—— 结论：点击仍快，但**页面本身在忙**

用户说的是"打开网页界面、点设置"。此前所有测量都在"等稳定后"点击。补充测量**尽早点击**（`arm2`）：

| 臂 | 按钮可点时刻 | 点击时页面时间 | readyState | DOM 节点 | click→可见 |
|---|---|---|---|---|---|
| delay=0（一可点就点）| 导航后 **1845ms** | 1848ms | `complete` | 512 | **15.6ms** |
| delay=1500 | 导航后 1714ms | 3217ms | `complete` | 577 | **14.8ms** |

**点击本身依旧快（14.8–15.6ms）**，且 **LongTask 0、LoF 0、帧 p50 16.7**。但同一 3 秒窗口内的主线程负载显著升高：

| 臂 | Task/3s | Script/3s | 窗口最大帧 | RecalcN | 对照（稳定态）|
|---|---|---|---|---|---|
| 早点击 delay=0 | **279.4ms（93.1 ms/s）** | 203.4ms | 31.7ms | **33** | 19–34 ms/s |
| 早点击 delay=1500 | **401.7ms（134 ms/s）** | 338.3ms | 41.9ms | 9 | 19–34 ms/s |

即**页面打开后的头几秒，主线程跑在 93–134 ms/s（稳定态的 3–5 倍）**，重算次数达 33 次/3s。这一相的负载来源可从资源时序直接读出（`resourcesAtClick`）：

| 资源 | 大小 | 耗时 |
|---|---|---|
| `/plugins/@local/dsh-pptmaster/client.js` | **4,000 KB** | 403–1074ms |
| `/assets/vendor-D22_Mp1f.js` | 727 KB | 152–301ms |
| `/plugins/.../dsh-client-ui-conversation/client.js` | 437 KB | 84–133ms |
| `/plugins/@deepseek-ai/dsh-client-runtime/client.js` | 389 KB | 151–286ms |
| `/assets/index-ClqxG24t.js` | 390 KB | 151–288ms |
| `/dsh-wallpaper/media/…png` | **2,280 KB** | 228–924ms |
| `/api/session.list` | 488 KB | **1888ms** |

**判读**：用户"打开界面就卡"的**可复现基质是加载/初始化相的主线程占用（93–134 ms/s + 8.3MB 脚本 + 2.28MB 壁纸 + 1.9s 的 session.list）**，而**不是**「设置」点击本身。点击在同一时刻依然只需 ~15ms 并把抽屉开出来。

---

## 6. 仪器可信度（正对照）—— 本报告最关键的一节

**先前的"零 LongTask/零 LoF"一度是无效证据。** 注入 180ms 阻塞忙循环：

| 通道 | clean 窗 | 注入窗 | 结论 |
|---|---|---|---|
| rAF 帧间隔 | max 34.5ms | **max 194.6ms** | ✅ **可检出** |
| `long-animation-frame` | 0 条 | **1 条，dur=188ms**（renderStart/styleAndLayoutStart 均有值）| ✅ **可检出** |
| `longtask` | 0 条 | **0 条** | ⚠️ 见下 |
| CDP `ScriptDuration` | 256.0ms | 182.3ms（≈注入的 180ms）| ✅ 账目可对上（但基线受 ambient 污染，差值不可直接比） |

`longtask` 在**已证明发生 180ms 阻塞**时一条都不报。为免把"通道坏"误当成"页面不卡"，专门做了通道特性实验（`raw/longtask-probe-headless.json`），**四种注入方式对比**：

| 窗口 | 阻塞注入方式 | rAF max | **longtask** | **LoF** |
|---|---|---|---|---|
| W0 基线 | 无 | 16.8ms | 0 | 0 |
| W1 | 页内 `page.evaluate` 忙循环 | 195.7ms | **0** ❌ | 1（184ms）✅ |
| W2 | 页内 `setTimeout` 回调忙循环 | 180.9ms | **1（180ms）** ✅ | 1（180ms）✅ |
| W3 | 页内 `requestAnimationFrame` 回调忙循环 | 180.5ms | **1（180ms）** ✅ | 1（195ms）✅ |

且 `PerformanceObserver.supportedEntryTypes` 含 `longtask`、`long-animation-frame`、`element`、`event`；两个 observer 均安装成功、`err=[]`、`visibilityState=visible`；页内自测阻塞时长 `gotA=180ms / gotB=180ms`（确实阻塞了）。

**结论（三条通道的定性）**：
- **`longtask` 通道本身是好的** —— 它能报出页内 `setTimeout`/`rAF` 回调里的 180ms 阻塞。
- 它**报不出由 CDP `Runtime.evaluate` 注入的**阻塞（W1）—— 这是 CDP 注入任务不进入页面任务归因作用域所致，**是注入方式的偏差，不是 API 失效**。§6 表格里那一行 `longtask 0 条` 正是这个偏差，arm2 正对照当时的 `longtaskFired=false` 亦同源。
- **`long-animation-frame` 与 rAF 三通道全部可用**，W1/W2/W3 一致检出。

**因此本报告的证据强度反而更高**：
- 点击窗口里 **longtask = 0 且 LoF = 0**，是在**通道已被验证可用**（W2/W3）的前提下得到的 ⇒ 这是**经仪器验证的阴性**：点击路径上**确实不存在 ≥50ms 的页面任务**，而不是"没测到"。
- `longtask` 通道可用性由 W2/W3 建立；因此 §3.3 的"零 LongTask"可以采信（点击由真实鼠标事件驱动，属页面归因范围，与 W2/W3 同类）。
- 仍需注明：rAF/LoF 只看**渲染主线程**；**compositor/raster 相**需要 CDP `Tracing`，本线未做（且本环境无法用 headed 补足，见 §7）。


---

## 7. headed 对照 —— 结论：**本环境 headed 无法启动（三线独立复现）**

任务要求"有头模式各跑 ≥2 次"。**已尝试 4 次（本线 2 次）+ 4 组配方诊断，全部失败**，失败记录完整保留（无效窗口不丢弃）。

### 7.1 失败现场

`raw/headed-run1.json` / `headed-run2.json`：`gateOutcome=ERROR`、`windows=[]`、`fatal=`
```
browserType.launch: Target page, context or browser has been closed
[err] chrome_crashpad_handler: --database is required
[err] [pid][ERROR:socket.cc(120)] recvmsg: 连接被对方重置 (104)
```
主进程 **109ms / 97ms 即退出**（`raw/headed-diag.json`）。

### 7.2 排除法（`raw/headed-diag.json`）

| 配方 | 结果 |
|---|---|
| 裸 `chrome` 二进制，headed，最小参数 | ❌ 存活 109ms 后退出，同崩溃 |
| 裸 `chrome` + `--disable-crashpad --disable-breakpad --no-crash-upload` | ❌ 存活 97ms，**同崩溃**（说明不是 crashpad 参数问题，crashpad 只是伴随噪声）|
| Playwright headed，最小参数 | ❌ 同崩溃 |
| Playwright headed + `--disable-crashpad` + `chromiumSandbox:false` | ❌ 同崩溃 |

**环境排除**：
- `DISPLAY=:1` 是真 X.Org 21.1.11（不是 Xvfb），且 `xdpyinfo`/`xset`/`xlsclients` 正常；
- **该 X 能托管 GUI 客户端**：`xclock` 启动成功并出现在 `xlsclients` 列表（已即杀，非产品进程）；
- 探测到的 headed node 进程 env 里 `DISPLAY=:1` **确实存在**（`/proc/<pid>/environ`）；
- `XAUTHORITY=/run/user/1001/gdm/Xauthority` 存在且属主正确。

⇒ 失败是 **chrome 有头模式特有**，与 X 授权/显示可用性无关。

### 7.3 交叉证据（独立于本线）

同 incident2 的 `headed-vs-headless` 线，用**最小参数 + 显式 `--display :1`** 跑 arm B，得到**逐字相同的报错**，其 `raw/` 里 **完全没有 B 臂产物**（只有 A / C-nogpu / C-gpu），其 campaign 脚本自带注释：
> `# ---- Arm B: headed (expected to be BLOCKED in this environment; recorded honestly) ----`

**两条独立线、两套独立代码、同一失败签名** ⇒ headed 阻塞是环境级事实，不是本线探针缺陷。

### 7.4 headless 与 headed 是否给出不同结论？

**无法判定 —— INCONCLUSIVE**。原因是 headed 侧**没有任何有效样本**（不是"跑出来一样"，而是"跑不出来"）。所有"headless 与 headed 一致/不一致"的说法在本环境**都没有证据基础**。任务预设"GPU/compositor 路径不同，可能正是 headless 测不到用户症状的原因"——该假设**未能被本环境证实或证伪**，需要换一台能起有头 chrome 的机器。

替代方案（本环境 XP）：
- `xvfb-run` **不存在**（`/usr/bin/xvfb-run` 缺失，全盘 find 无果）；仅有的 X 是真 X.Org，已证明托管 GUI 正常，**换成 Xvfb 也不会绕开 chrome 自身的有头启动失败**。
- **最接近的可得代理 = headless 下的 GPU 路径变体**。此处引用**同 incident2 `headed-vs-headless` 线**（他线独立数据，非本线采集）的 3×3 结果，作为交叉佐证：

  | 他线臂 | 路径 | click→panel | 帧 max | >50ms |
  |---|---|---|---|---|
  | A（×3）| headless 默认（SwiftShader）| 2–7ms | 16.8–33.4ms | 0 |
  | C-nogpu（×3）| headless + `--disable-gpu` | 2–7ms | 16.8–33.4ms | 0 |
  | C-gpu（×3）| headless + `--use-angle=swiftshader` | 2–5ms | 50–83.4ms | 1/239（0.4%）|

  即**headless 内部换 GPU/合成路径几乎不改变结论**（唯一差别是 C-gpu 偶发 1 帧 50–83ms）。这**不能**替代真 headed（真 headed 有窗口系统合成器、vsync、真实栅格化与遮挡/后台化路径），但说明"仅把 GPU 后端换成软件/ANGLE"不是用户症状的解释变量。
- 真正能补的：CDP `Tracing`（raster/compositor 相）、以及**换一台能起有头 chrome 的机器**。

---

## 8. 并发浏览器实例数 与 gateOutcome

按 `/proc/<pid>/exe` 精确统计（`readlink /proc/<pid>/exe` 命中 `chrome`/`chromium`/`headless_shell`），主进程判据 = cmdline 含 `--remote-debugging-pipe` 且**无** `--type=` 且含 `--user-data-dir=`。
> 实现注意：chromium **会改写内存中的 argv**，`/proc/<pid>/cmdline` 实际是**空格分隔**（仅尾部一个 NUL），**按 NUL 切分会得到 1 个整串**——本线第一版 census 因此漏判主进程（`mine=0`），已修；`ps -eo cmd` 能工作正是因为它把 NUL 换成空格。

### 8.1 实例数

| 数据 | 判读时刻 | mine | foreign | helper | 二进制种类 |
|---|---|---|---|---|---|
| headless-run1 | 6 个括号点（launch 前/idle 后/每次点击后/结束）| 1（launch 前 0）| **0** | 5 | `headless_shell`×5 |
| headless-run2 | 同上 6 点 | 1 | **0** | 5 | `headless_shell`×5 |
| arm2-headless | 6 点 | 1 | **0** | — | — |
| headed-run1/2 | — | — | — | — | launch 失败，无实例 |

**全程单浏览器实例；12+ 个采样时刻 foreign 主进程恒为 0。**

### 8.2 gateOutcome —— 必须分两件事说（此处修正早前过强的写法）

| 数据 | `foreign==0`（全部括号点）| 是否全程持有共享锁 | 判定 |
|---|---|---|---|
| headless-run1 | ✅（lockMine 在 click3 括号点已转 False）| 否（前两窗持有，末段被 `incident2-regression` 接管）| **NO-FOREIGN-BROWSER；锁被抢占** |
| headless-run2 | ✅（6/6）| **否**（launch 后即被 `incident2-regression` 接管；等待 **288.4s / 84 次**才拿到锁）| **NO-FOREIGN-BROWSER；锁被抢占** |
| arm2-headless | ✅（6/6）| 否（launch 后转 False）| **NO-FOREIGN-BROWSER；锁被抢占** |

**含义**（独立审计 G 项对此的批评成立，本报告按修正后的口径陈述）：
- 可支持的强断言：**在所有括号采样时刻，除本线外没有任何浏览器主进程**（`mine=1, foreign=0`）。
- **不可**支持的断言：本线**全程独占**。共享锁在多线竞争下被反复抢占（`incident2-regression` / `incident2-theme-open` / `incident2-conditions` 等），锁只在括号点被采样，**窗口中间的所有权未被连续证明**。因此严格说："无外来浏览器实例污染"有证据；"串行纪律被遵守"**没有**证据（双驱动脚本一度并发也属此类失误，已在数据代次警告中说明）。
- 建议：后续把锁改进为**带 pid+心跳的租约**，并在每个窗口**内部**（而非仅边界）采样 census。

---

## 9. 逐条判定

| # | 任务要求 | 判定 | 依据 |
|---|---|---|---|
| 1a | HTML 注入 rev == 磁盘 sha1-12（四包）| **PASS** | §1.1，4/4，且服务端下发字节 == 磁盘 |
| 1b | 证明确实拿到新代码（页内修复标记）| **PASS** | §1.2，4/4 页内 sha1==rev 且标记命中；pre-image 标记 0 |
| 2a | click→dialog 可见耗时（MutationObserver+rAF，非 sleep）| **PASS** | §3.1，首开 19.7/19.8ms |
| 2b | 点击前后 3 秒逐帧间隔序列 | **PASS** | §3.2，完整序列落盘于 raw JSON `frames[]` |
| 2c | LongTask + LoF 明细 | **PASS（三通道均已验证）** | §6：LoF 检出 188ms；longtask 经 W2/W3 验证可检出 180ms（W1 的静默是 CDP 注入偏差）；故点击窗"0 LT + 0 LoF"为**验证过的阴性** |
| 2d | CDP Script/Task/Recalc/Layout/StyleLayoutCount 窗口 delta | **PASS** | §3.3；注意 `RecalcStyleCount` 即 StyleLayout 类计数 |
| 2e | console / pageerror | **PASS** | 全部窗口 0 错误 0 警告 0 pageerror |
| 3a | 形态归类（大冻结 vs 持续掉帧）| **PASS** | §4：**两者皆非**，单帧丢弃（1 帧/次点击）|
| 3b | 首开 vs 复开对照 | **PASS** | §4：首开 19.7/19.8ms、2 组长-短帧对；复开 13.7–15.0ms、1 组 |
| 4a | 有头模式各跑 ≥2 次 | **FAIL（环境阻塞，非本线偷懒）** | §7：4 次尝试 + 4 组配方全失败；他线独立复现 |
| 4b | 报告 headless 与 headed 差异 | **INCONCLUSIVE** | §7.4：headed 侧零有效样本 |
| 5a | 并发浏览器实例数（/proc/<pid>/exe）| **PASS** | §8.1：单实例，helper 5，foreign 恒 0 |
| 5b | gateOutcome | **PASS（已修正口径）** | §8.2：`NO-FOREIGN-BROWSER` 成立；**全程独占不成立** |
| — | 无效窗口保留 | **PASS** | `headed-run1/2.json`、`control-instrument-*.json`(ERROR)、`headed-diag.json` 全部保留 |
| — | 「headless 测不到用户症状」这一怀疑 | **部分成立（转向）** | idle/点击均干净；**但加载相 93–134 ms/s 与 8.3MB 脚本 + 1.9s `session.list` 是可复现的忙相**——见 §5 |
| — | 仪器自身可信 | **PASS** | §6：rAF ✅（194.6ms）、LoF ✅（188ms）、longtask ✅（W2/W3 报 180ms）、CDP ✅（Script 账目对上）；唯一偏差是 CDP 注入的阻塞不被 longtask 归因（已定性并规避）|

### 独立审计（`sub-audit/`）对本线的反向发现与处置

| 审计项 | 审计判定 | 本报告处置 |
|---|---|---|
| A 窗口切片 | PASS（与自研分析器 90 字段 0 分歧）| 采纳 |
| B click→可见 | PASS | 采纳 |
| C 形态 | PASS，但 LongTask 缺席 INCONCLUSIVE | **已按正对照改判**：改用 rAF+LoF 立论（§6）|
| D idle 基线 | PASS | 采纳（§1.3）|
| E 自扰动 | PASS/INCONCLUSIVE | 采纳；idle 12.4–15.0 ms/s 含探针开销，属可接受 |
| **F 正对照** | **FAIL（当时未注入）** | **已修复并重跑，现为部分 PASS（§6）** |
| **G gate** | **FAIL（EXCLUSIVE 无支撑）** | **已改口径（§8.2）** |
| H 标记 | PASS（附 2 处修正）| 采纳（§1.2）|
| I 外部效度 | COMPLETE | 采纳为 §10 局限 |
| 审计指出：`preWindow` 切片空洞（n=2）| 成立 | 已在 §3.2 改用 idle 作基线，不再用该空洞切片立论 |
| 审计指出：`firstOpenShape` 在 MINOR/SMOOTH 间翻动 | 成立 | 本报告形态结论不再依赖该单值，改用"长-短帧对计数"（6/6 复现）|

---

## 10. 对用户症状的判读与局限

**能说的（有证据）**：
1. 静息态**已彻底安静**（6s 内 0 次重算、0 次布局、12–15 ms/s），主题批修复生效。
2. **点「设置」不是瓶颈**：真实鼠标点击 → 抽屉可见 **13.7–19.8ms**（≤1 帧），**无 ≥50ms 帧、无 LoF、无任何错误**，6 次点击形态一致。
3. 形态**既不是一次大冻结，也不是持续掉帧**，而是**每次点击恰好丢 1 帧**（首开 2 帧），绝对代价 ~16–33ms。
4. 首开确实比复开贵（多一次提交、DOM 插入慢约 2×），但差异在 **6ms 量级**，不足以解释「卡」。
5. **页面打开后的头几秒主线程确实忙**：93–134 ms/s（稳定态 3–5 倍）、重算 33 次/3s，背后是 8.3MB 客户端脚本（其中 pptmaster 单包 4.0MB）、2.28MB 壁纸、以及 **1.9s 的 `/api/session.list`（488KB）**。这是本环境里唯一能对上"打开网页界面就卡"的**可复现忙相**——但它发生在**加载/初始化相**，而**不是**「设置」点击相。

**不能说的（无证据，必须标注）**：
1. **headed/真 GPU 一律未测**（§7）——"真浏览器下是否更差"**未知**。
2. **页面规模失真**：实测页 `treeitems=11`、`nodesAtStable=526–697`；而**真实会话列表为 299 条、顶层 99 条**（只读 `session.list` 实测）。真实 GUI 的 DOM 规模与首屏渲染量**可能大得多**，本线**未**在放大规模下复测 ⇒ 外部效度受限。
3. **无未打桩对照**：所有数字都带探针（rAF 循环 + 2 个 observer）。idle 12.4–15.0 ms/s 属含探针值。
4. **窗口内锁所有权未连续证明**（§8.2）。
5. **宿主 ambient 负载跨运行波动大**（他线 loadavg 6.2），早期曾出现 idle Task 178ms/6s vs 74ms/6s 的代际差异；本报告所用代次已冻结 sha1。
6. CDP 窗口 delta 的"点击窗"= 点击 + 之后 3s（**不含**点击前 3s），因为 `t_pre` 标记与点击几乎同时（切片仅 2–3 帧）。**基线请以 idle 6s 窗口为准**（§3.3/§1.3）。

---

## 11. 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro

# 前提自证（rev vs 磁盘 vs 页内标记）
node scripts/first-settings-probe.mjs --mode=headless --run=1 --clicks=3 \
     --idle=6000 --settle=3000 --post=3000 --lockwait=900000 --tag=headless-run1

# 仪器正对照 + 早点击臂（一次锁内完成）
node scripts/arm2-early-and-control.mjs --mode=headless --early=0,1500 --stall=180 --tag=arm2-headless

# Long Tasks 通道特性
node scripts/longtask-probe.mjs --mode=headless

# headed 可行性诊断（已证阻塞）
node scripts/headed-diag.mjs

# 分析（按 marks 切片、分类）
node scripts/analyze.mjs headless-run1 headless-run2
```

锁：`.workspace/lag-fix/research-v2/.probe.lock`（mkdir 原子；本线已按协议释放；本线运行期间曾被他线抢占，见 §8.2）。
