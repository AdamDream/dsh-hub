# 取证 Runbook：30 秒内抓到「点设置就卡」的可用证据

> 面向：你自己（用户）。**不需要安装任何东西**，不需要改 DSH，不需要写任何服务端。
> 目标：抓一份能被 `parse-trace.mjs` 解析的证据，用来判断你感受到的卡顿到底卡在哪个函数。
> 三个方案任选其一。**先读「方案选择」表，再照抄命令。**

---

## 0. 先选方案（30 秒决定）

| | 方案 A（首选） | 方案 B（可选，更硬） | 方案 C（备用，最省事） |
|---|---|---|---|
| 做法 | Chrome/Edge 开发者工具 → Performance 面板 → 录制 → 点设置 → 停止 → Save profile | `chrome://tracing` 或给你的浏览器开 CDP 端口 | 浏览器打开我们给你的一个单文件网页（`dsh-jank-capture.html`） |
| 安装 | 零 | 零（但可能要重启浏览器） | 零 |
| 拿到什么 | **最全**：帧、长任务、Script/Recalc/Layout/Paint 分项、函数级 CPU 采样 | 接近 A，粒度可自选 | 只读帧/长任务/LoAF；能自动读目标页 rev |
| 需要你做的写操作 | 只有「点录制 / 点停止 / Save profile」 | 同 A | 同 A（点击即可，工具只读） |
| 适合谁 | 想一次把证据做扎实 | 想更细粒度排查 | 不想碰开发者工具 |

**建议顺序：先做方案 A（约 60 秒）。** 如果 A 里找不到「设置」按钮或录制后文件为空，再走方案 C。

---

## 1. 方案 A：Chrome / Edge 开发者工具 Performance 面板（首选）

### 前置（10 秒）
1. 在**你平时卡的那个浏览器窗口**里，打开 DSH 界面。
2. **先按 `Ctrl+Shift+R` 强制刷新一次**（关键：确保加载的是修复后的构建，而不是缓存的旧 JS）。
   刷新后等界面完全稳定（约 5 秒），**不要马上点设置**。

### 录制（约 20 秒）
3. 按 `F12` 打开开发者工具。
4. 切到 **Performance** 标签页。
   - Chrome：顶部标签就是 `Performance`。
   - Edge：同样叫 `Performance`（在 `Elements / Console / Sources` 右边）。
5. 点左上角的 **⏺ 圆形录制按钮**（或按 `Ctrl+E`）开始录制。
6. **心里数 5 秒**（让录制先攒下一段"点击前"的基线）。
7. **点击「设置」**——就是你平时卡的那个入口。
8. 点完之后**继续等 5 秒以上**（关键，见下方"常见坑"第 3 条），然后点 **⏹ 停止**。

### 导出（10 秒）
9. 停止后，Performance 面板会显示火焰图。
10. 点面板**右上角的下载图标**（向下箭头，提示文字是 `Save profile`），或按 `Ctrl+S`。
11. 保存为 `.json` 文件（默认名类似 `Profile-20260922T....json`），**放到一个你记得住的目录**。
12. 把这个文件的**绝对路径**告诉我。

### 关于录制时长与选项（你问到的两点）

**要录多久？**
- 最短：点击前 5 秒 + 点击 + 点击后 5 秒 ≈ **11~12 秒**。
- 推荐：**15~20 秒**。太短会出现「点击后窗口没有数据」，解析器会直接告诉你"证据不足"，白录一次。
- 上限：**不要超过 60 秒**。文件会从 26 MB 涨到 100 MB+，浏览器导出会明显变慢。

**要不要勾选 Screenshots（截图）？**
- **不要勾。** 理由：① 屏幕截图会把你的聊天内容、工作区文件、会话标题一起录进文件里，**有隐私风险**；② 文件体积会涨 3~10 倍；③ 解析脚本完全不需要截图就能干活。
- 勾选位置：Performance 面板右上角 **⚙️ 齿轮图标** → `Screenshots`。

**要不要勾选 Memory（内存）？**
- **不要勾。** 理由：它录的是堆内存分配，用于查内存泄漏；你这次是**帧/主线程卡顿**，属于不同的问题域。勾了只会让文件变大、录制变慢（本身会干扰测量）。
- 勾选位置：同一个 ⚙️ 齿轮里 → `Memory`。

**应该勾什么？**
- `⚙️ 齿轮` → **`Enable JavaScript samples`（记录 JS 采样）** ✅ **建议勾上**。这是"函数级归属"的数据源；不勾的话解析器只能告诉你"有个 26 ms 的任务"，勾了才能告诉你"这 26 ms 花在哪个函数、哪一行"。默认通常是勾上的，确认一下即可。
- `CPU: No throttling`（不要开 4x slowdown）——真实复现你主观感受，就不要人为降速。

### 常见坑（都很容易踩）

1. **录完发现"点击后"一栏全是 0 / 解析器报「证据不足」**
   → 停太早了。点击「设置」后必须**再等 5 秒以上**才点停止。解析器会针对这种情况明确告警：
   `锚点之后只有 xxx ms 数据（希望 3000 ms）⇒ 录制在点击后过早停止。`

2. **录制里找不到「设置」按钮 / 点不到**
   → 先**不要**开始录制，直接用鼠标确认「设置」是可点的；如果它被悬停才展开的菜单挡住，先把菜单展开、录制开始后**再点**。
   → 录制期间不要切到别的标签页、不要最小化窗口：**切走会让浏览器停止渲染**，帧数据就没了。

3. **录出来的文件很大（100 MB+）**
   → 缩短录制时间；确认没勾 Screenshots；关闭无关的开发者工具标签。

4. **解析器说 `rev 未知`**
   → rev 只是"你跑的是不是修复后的构建"的判据。补法（任选）：
   - 在 DSH 标签页按 `F12` → Console，粘贴执行：
     ```js
     performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/rev=/.test(n)&&/ui-layout|runtime|usage|wallpaper/.test(n))
     ```
     把输出里 `?rev=` 后面的 12 位十六进制值告诉我；或
   - 用方案 C 的工具，它会自动读出来。

5. **想重录**
   → 直接重来即可，**不需要**先关开发者工具。每次点 ⏺ 都是全新一份档案，旧的那份还在你上次保存的位置。

---

## 2. 方案 B：`chrome://tracing` 或给你的浏览器开 CDP（可选，更硬）

### 先判断"你的浏览器支不支持"

在浏览器地址栏输入并回车：

```
chrome://tracing
```

- **能打开**一个深色 Trace-Viewer 界面 → 你可以用下面 B-1（零配置，最省事）。
- **打不开 / 提示"无法访问此网站"** → 你的浏览器（或企业策略、隐私模式）禁用了它。**不要折腾**，直接用方案 A 或方案 C，效果一样。
- Edge 用户同理：`edge://tracing` 通常也支持。

### 判断"能不能给浏览器开 CDP 调试端口"

**不要**在你正在用的这个浏览器上试——开 CDP 必须**完全关闭整个浏览器进程再用参数重开**，会丢掉你当前所有标签页，也可能和你的登录态/profile 冲突。

如果你愿意用**一个单独的浏览器实例**测（推荐这样）：

1. **完全退出** Chrome（确认任务栏/托盘里没有残留）。
2. 用带调试端口的参数重开（把路径换成你自己的）：
   ```bash
   # Linux
   /usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-cdp-profile
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-cdp-profile
   ```
3. 在**这个新窗口**里打开 DSH 界面。
4. 另开一个终端，确认端口活着：
   ```bash
   curl -s http://127.0.0.1:9222/json/version
   ```
   - 有 JSON（含 `"Browser": "Chrome/..."`）→ **支持**。
   - 连接被拒绝 / 空 → **不支持**（多为新版 Chrome 的安全策略），走 A 或 C。
5. 支持的话，用我们已备好的抓取脚本对着这个端口录（会真实地"点击设置"并落盘一份 DevTools 格式 trace）：
   ```bash
   node /path/to/incident2/user-capture/fixtures/capture-fixture.mjs
   ```
   > 注意：该脚本内部用 Playwright 自己启动一个 headless Chromium，**默认不连着你的 9222 端口**。如果你想让它连你已经开好的那个浏览器，需要改脚本里的 `chromium.launch(...)` 为 `chromium.connectOverCDP('http://127.0.0.1:9222')` 并复用已有上下文。**这一步属于可选进阶**，不做也完全不影响方案 A/C 的结论。

### B-1：`chrome://tracing` 用法（若第 1 步能打开）

1. 地址栏输入 `chrome://tracing` 回车。
2. 点 **Record**。
3. 勾选这些类别（其它可以不勾）：
   - `devtools.timeline`
   - `disabled-by-default-devtools.timeline`
   - `blink.user_timing`
   - `v8.execute`
   - `disabled-by-default-v8.cpu_profiler` ← 想要函数级归属就勾这个
4. 点 **Record** 开始。
5. 回到 DSH 标签页：先等 5 秒 → **点「设置」** → 再等 5 秒。
6. 切回 `chrome://tracing` 标签页，点 **Stop**。
7. 点 **Save**，保存成 `.json`。
8. 把路径告诉我。

> ⚠️ `chrome://tracing` 的界面里**没有**"按钮名/函数名"这种可读信息，它只负责录；**读**交给我们的 `parse-trace.mjs`。

### 附带风险提示（我方已知的坑，避免你重复踩）

- `Tracing.end` 这条 CDP 命令**不返回** trace 数据；stream 句柄是在 **`Tracing.tracingComplete` 事件**里给出的。用 CDP 自己写脚本时如果只读 `Tracing.end` 的返回值，会拿到空对象。
- `IO.read` 返回的是**二进制**（`base64Encoded:false`），必须按 **latin1 逐字节**做 buffer 拼接；用默认 UTF-8 字符串解码会把非 UTF-8 字节全部变成 `U+FFFD` 而**静默损坏**文件（我们实测踩过，28 MB 变成 20 KB 的乱码）。
- 参数 `transferMode: "ReturnAsString"` **不是**真实可用的取值——Chrome 会静默接受但不返回字符串。想要"简单模式"请用 `ReportEvents`（事件通过 `Tracing.dataCollected` 下发，无需处理二进制）。

---

## 3. 方案 C：一次性只读取证页面（备用，最省事）

工具文件：**`dsh-jank-capture.html`**（就在本目录，**单个 HTML 文件**）
性质：纯前端、**只读**、零安装、**不依赖 DSH 源码**、**不写任何服务端**、**不修改被观测页面**。

### 为什么需要它
如果你不想碰开发者工具，这个页面会用浏览器标准的 `PerformanceObserver` API 采集：
帧间隔（rAF）、长任务（longtask）、**LoAF（含阻塞时长与脚本归属）**、Event Timing，
并**一键导出 JSON**，还能**自动读出目标页当前下发的 rev**（判断你是不是跑在修复后的构建上）。

### C-0 打开方式

**推荐**：用一条 HTTP 把它发出来（只读静态服务，不写任何服务端）：
```bash
cd /path/to/incident2/user-capture
python3 -m http.server 8931 --bind 127.0.0.1
```
然后浏览器打开：
```
http://127.0.0.1:8931/dsh-jank-capture.html
```

**也可以 `file://` 直接双击打开**，录制功能完全可用（已实测）。

> ⚠️ **关于「检测 rev」按钮（重要，别被它误导）**
> 我方**已实测确认**：DSH 的 GUI 服务（`127.0.0.1:3080`）**不下发任何 CORS 响应头**（没有 `Access-Control-Allow-Origin`）。
> 因此这个按钮**只有在本页与目标页同源时**才可能成功；从 `file://` 或别的端口打开时它**必然失败**——
> 这是浏览器的安全规则，不是工具的 bug，也无法绕过（换成 HTTP 打开也一样，我已验证）。
>
> **rev 请用 Runbook 第 1 节「常见坑」第 4 条的两种手动办法获取**（Console 一行命令或查看源代码）。
> rev 只是判据、不是必需品：**没有它也能正常录制和解析**，只是解析器会显示 `rev 未知`。
>
> 好消息：iframe 模式不受影响——目标页**未**设置 `X-Frame-Options`，也没有 `frame-ancestors` CSP，实测能正常内嵌。

### C-1 模式 A：iframe 内嵌目标页（最省事）

1. 打开工具页，确认「0. 环境自检」里 `longtask` / `long-animation-frame` 显示**可用**。
2. 目标地址保持 `http://127.0.0.1:3080/`，点 **「检测 rev」**。
   - 期待输出里有 `ui-layout/client.js?rev=82cca1a6178a`（= 已含帧内 rAF 合并修复）和
     `dsh-client-runtime/client.js?rev=5559de4ce28c`（= 已含 runtime 修复）。
   - 若 rev 不同 ⇒ **你看到的是旧构建**，先回 DSH 页面 `Ctrl+Shift+R` 强刷再重来。
3. 点 **「打开目标页并开始录制」**（下方出现 iframe 加载 DSH 界面）。
4. **在 iframe 里点一次「设置」**。
5. 等 3~5 秒 → 点 **「停止录制」** → 点 **「下载 JSON 文件」**（文件落进你的「下载」目录）。
6. 也可以点 **「本地解析」** 当场看到帧分布与长任务 top10。
7. 把 JSON 路径告诉我。

**优点**：零粘贴、零安装，跨源也能用；能测到宿主页在这一刻的帧节拍。
**缺点（写清楚，别误解）**：iframe 是跨源的，浏览器**不允许**父页读取 iframe 内部的长任务——所以这个模式**拿不到函数级归属**，长任务明细大概率为空（解析器会明确标注"这是预期结果，不是采集失败"）。**要函数级归属，用模式 B。**

### C-2 模式 B：把探针脚本粘到 DSH 页面控制台（最精确，推荐用于定位）

1. 工具页切到 **「模式 B」**，点 **「复制探针脚本」**。
2. 在**你的 DSH 标签页**按 `F12` → 切到 **Console**。
3. 粘贴脚本并回车。
   - Chrome 首次粘贴可能要求你先输入 `allow pasting` 确认（照做即可）。
4. 回到 DSH 界面：**点一次「设置」**，感受卡顿，再等 3~5 秒。
5. 在 Console 执行：
   ```js
   __DSH_CAPTURE__.stop()
   ```
6. 再执行（结果直接进剪贴板）：
   ```js
   copy(JSON.stringify(__DSH_CAPTURE__.snapshot()))
   ```
7. 粘贴到一个新文件里，存成 `dsh-jank-inpage.json`，把路径告诉我。

如果 `copy()` 不可用，用这条**直接下载**：
```js
var d=JSON.stringify(__DSH_CAPTURE__.snapshot());var b=new Blob([d],{type:"application/json"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="dsh-jank-inpage.json";a.click();
```

**优点**：探针跑在目标页自己的主线程里，能拿到 **longtask + LoAF（阻塞时长 / 脚本 URL / 函数名）+ Event Timing**——这是函数级定位的关键。
**缺点**：需要粘贴一次脚本。

**探针的安全边界（写清楚）**：
- **只读**：只调用 `PerformanceObserver`（observe 标准 entry type）、`requestAnimationFrame`、`performance.mark`。
- 监听 `click/pointerdown/keydown` 用的是**捕获阶段 + 只读**，**不调用** `preventDefault()` / `stopPropagation()`，**不修改**任何 DOM、样式、状态或数据。
- 调用 `__DSH_CAPTURE__.stop()` 后会 `disconnect()` 掉所有 observer 并移除所有监听器。
- 唯一附加的全局是 `window.__DSH_CAPTURE__` 与 `window.__DSH_CAPTURE_CFG__`；刷新页面即彻底消失。
- **不联网、不发请求、不写任何服务端**。

**没抓到点击锚点怎么办？**
如果你**先点了设置、之后才粘贴脚本**，那次点击不在录制范围内。在 Console 里补一句手动锚点即可（单位：毫秒，相对本次录制起点）：
```js
__DSH_CAPTURE__.setAnchor(0, "manual")
```
或者把锚点定在"此刻"：
```js
__DSH_CAPTURE__.setAnchorAbsolute(performance.now(), "manual-now")
```

### C-3 两个模式的取舍（一句话）

| | 模式 A（iframe） | 模式 B（粘控制台） |
|---|---|---|
| 操作成本 | 最低（不粘贴） | 需粘贴一次 |
| 能读 rev | ✅ | ✅（还可能受 CORS 限制，见 C-0） |
| 帧间隔 | ✅ 宿主页节拍 | ✅ 目标页自己的节拍（更准） |
| 长任务/LoAF/函数名 | ❌ 跨源拿不到 | ✅ 全都有 |
| 适用 | 快速看一眼 | **定位到函数** |

---

## 4. 拿到证据之后（我们这边做什么）

把路径给我（任一种即可）：

```
# 方案 A / B-1 的 DevTools trace
node parse-trace.mjs /absolute/path/to/Profile-xxxx.json --rev ui-layout=<12位>,runtime=<12位>,usage=<12位>

# 方案 C 的 JSON（解析器自动识别格式，不需要 --rev）
node parse-trace.mjs /absolute/path/to/dsh-jank-capture-xxxx.json
```

解析器会输出：

1. **点击前后各 3 秒的帧分布**（6 档分桶 + p50/p95/p99/max + 掉帧次数 + 主线程占用率）；
2. **最长任务 top 10**，含**函数名、URL、行号**，以及该任务内的函数占用明细；
3. **Script / RecalcStyle / Layout / Paint 分项**（全 trace 与窗口内两个口径）；
4. **是否命中已知修复项**：
   - `ui-layout:366`（帧内 rAF 合并 · rev `82cca1a6178a`）—— 对应"点设置时样式被反复强制重算"
   - `runtime`（U-P2AC 客户端 runtime · rev `5559de4ce28c`）
   - `usage`（U-IG1/IG2/IG3/CC1 宿主 ingest 阻塞 · rev `4536b91ed282`）
   - `wallpaper`（(iv-a) 内容比较去重 · rev `826d9217a8fc`）
5. **函数级 CPU 采样占比 top 15**（前提：录制时勾了 JS 采样）。

### 怎么读结论（三个数就够）

| 看什么 | 卡 | 不卡 |
|---|---|---|
| **主线程占用率**（窗口内 RunTask 之和 / 窗口跨度） | `>50%` 必然可感知；`>80%` 严重 | `<25%` |
| **>50 ms 掉帧次数** | 有若干次 | 0 次 |
| **最长任务** | 有明显超过 50 ms 的任务，且落在设置相关函数上 | 都在几十毫秒内 |

> 注意：**帧率（FPS）不是我方主推指标**。浏览器空闲时根本不产生帧事件，由帧事件反推的"活跃期 FPS"会偏高，容易误判。真正硬的是**主线程占用率**与**最长任务**。

### 一个真实样例（我方用 headless 跑出来的，供你对照格式）

下面是我方解析**自己采的一份真实 trace** 的实际输出（节选），你可以拿它对照你的结果长什么样：

```
输入形态     : devtools-trace（时间单位 us）
事件总数     : 103153
锚点         : performance.mark(USER_CLICK_SETTINGS_START)（点击前那一刻）   [置信度 high]
帧分布口径   : AnimationFrame 间隔
窗口内帧样本 : 4
主线程占用   : 68 ms / 6000 ms = 1.1%
Script 2063 ms (93.9%) · RecalcStyle 25 ms · Layout 45 ms · Paint 66 ms
CPU 采样     : 80,471 个
窗口内函数级占用 top1 : (anonymous) @ assets/index-ClqxG24t.js  17.9 ms / 3 次调用
已知修复项   : ui-layout / runtime / usage / wallpaper 全部 = 命中（已修复构建）
```

⚠️ **重要提醒**：这份 headless 样例里**页面并不卡**（占用 1.1%、掉帧 0 次、最长任务 26 ms）。
它只能说明"解析链路是通的"，**不能**说明"你的卡顿不存在"。
无头环境与你的真实环境不同源（无 GPU 合成、无真实窗口、无你的 profile 与其它标签页争抢），
**你的卡顿只能在你的浏览器里复现**——这正是需要你录一份的原因。

---

## 5. 纪律与边界（我方承诺）

- **你不执行任何写操作**，除了「点录制 / 点停止 / Save profile / 点按钮」这些 DevTools 与工具页自身操作。
- 工具与脚本**只读**你的浏览器与文件，**不修改 DSH 产品**、**不重启任何进程**、**不写任何服务端**。
- 解析脚本只读输入文件；只有你显式传 `--json <path>` 时才会写一个报告文件。
- 录制的 trace 可能包含你界面上的文本（如会话标题）。**不勾 Screenshots** 可显著降低暴露面；文件由你保管，给我路径即可，我不会外发。

---

## 6. 快速故障排查表

| 症状 | 原因 | 处理 |
|---|---|---|
| 解析器报「窗口内没有任何 RunTask 记录 / 证据不足」 | 录制在点击后过早停止 | 按方案 A 第 8 步，点击后**再等 5 秒以上**重录 |
| 解析器报「锚点置信度 low」 | trace 里没有点击证据（没点按钮，或点了别处） | 重录时确保真的点了「设置」；或用 `--anchor <时间戳>` 手动指定 |
| 方案 C「检测 rev」失败、提示 CORS | 用 `file://` 打开的 | 见 C-0，改用 `python3 -m http.server` 发出来 |
| 方案 C 模式 A 的长任务为空 | 跨源 iframe 的固有限制 | **不是失败**；要长任务请用模式 B |
| 「函数 / URL」显示 `(无函数归属)` | 该 trace 的 `RunTask` 没带函数信息（Chrome 131 就是如此） | 正常；看「窗口内函数级占用」那张表，它来自 `FunctionCall`，是更可靠的归属来源 |
| 「CPU profile」一栏为空 | 录制时没勾 JS 采样 | 方案 A 齿轮里勾 `Enable JavaScript samples` |
| 方案 C 提示「帧边界样本只有 N 个」 | 页面当时基本没在渲染 | 正常；以「主线程占用」与「最长任务」为准 |

---

## 7. 一页速查（真的只要 30 秒）

```
1) 在 DSH 页面按 Ctrl+Shift+R 强刷，等 5 秒
2) F12 → Performance → 点 ⏺
3) 心里数 5 秒 → 点「设置」→ 再数 5 秒 → 点 ⏹
4) 点右上角 ⬇ (Save profile)  →  存成 .json
5) 把该 .json 的绝对路径发给我
```

齿轮里的勾选：`Enable JavaScript samples` ✅ ｜ `Screenshots` ❌ ｜ `Memory` ❌
