# 验证记录（VERIFICATION）

- 日期：2026-09-22
- 范围：`parse-trace.mjs` 解析器 + `dsh-jank-capture.html` 方案 C 工具 + `RUNBOOK-USER-CAPTURE.md`
- 纪律：**未修改任何产品文件**；**未重启进程**（宿主 PID 10806 全程存活）；**未 pkill**；未使用任何提权。
- 一键复现：`bash verify.sh`（全部只读，退出码 0 = 全绿）

---

## 一、验证方式（三层，逐层加强）

| 层 | 手段 | 证明什么 | 结果 |
|---|---|---|---|
| L1 | `node parse-trace.mjs --self-test` | 纯逻辑正确性（30 项断言） | **30/30 PASS** |
| L2 | 用**真实 trace** 跑端到端 | 能解析浏览器真实产物，且窗口/分项/归因都出得来 | 全绿（见二） |
| L3 | **反向对照** + **坏输入** | 不是"永远说 OK"的空壳 | 全绿（见三） |

### L1：30 项内部自检覆盖
分桶边界 6 档 · 分位数（含空数组）· `task` 字符串解析（含 `:line:col` 与无 URL 两种）·
事件名→分项归类 5 例 · 形态判别 3 例 · **合成 devtools trace 端到端 10 项** · **合成 user-capture 端到端 5 项**。

> 自检不是装饰：它在开发中**真的抓出了 2 个 bug**（见四.1、四.2）。

---

## 二、L2：真实 trace 端到端（核心验证）

### 输入（真实产物，非构造）
| 项 | 值 |
|---|---|
| 路径 | `fixtures/real-settings-trace.json` |
| 大小 | 26,121,454 B（≈26 MB） |
| md5 | `1c6b7930eece5d09b2fdad6c9e5b9324` |
| traceEvents | **103,153** |
| 产出方式 | Playwright 1.49.1 + Chromium **131.0.6778.33** headless，**CDP `Tracing`** 采集 |
| 场景 | 打开 `http://127.0.0.1:3080/` → 等 9 s → **真实点击「设置」按钮** → 等 8 s → 停止 |
| 点击方式 | `getByRole('button', { name: '设置', exact: true })`（真实 DOM 点击，非伪造事件） |
| trace 跨度 | ≈ 11.7 s |
| 记录脚本 | `fixtures/capture-fixture.mjs`（可重跑） |

### 关键事件计数（脚本内计数与独立 `grep -c` 双向一致）
`RunTask 10479 · FunctionCall 989 · UpdateLayoutTree 60 · Layout 11 · Paint 100 · ProfileChunk 1091 ·
USER_CLICK_SETTINGS_START 1 · USER_CLICK_SETTINGS_END 1 · navigationStart 2 · firstContentfulPaint 1`

### 解析结果（`--rev` 投喂当前已落地的四个 rev）
```
输入形态     : devtools-trace（时间单位 us）
事件总数     : 103153（其中有时长的事件 20854）
锚点         : performance.mark(USER_CLICK_SETTINGS_START)（点击前那一刻）   [置信度 high]
帧分布口径   : AnimationFrame 间隔
窗口内帧样本 : 4        ← >0，证明 µs/ms 单位链正确
主线程占用   : 68 ms / 6000 ms = 1.1%
Script       : 2063 ms (93.9%)   RecalcStyle: 25 ms   Layout: 45 ms   Paint: 66 ms
CPU 采样     : 80,471 个（ProfileChunk 1091 个）
函数级归属   : 窗口内 top1 = (anonymous) @ assets/index-ClqxG24t.js，17.9 ms / 3 次调用
```

### 已知修复项判定（当前 live 构建）
| 修复项 | 期望 rev | 实际 rev | 判定 |
|---|---|---|---|
| `ui-layout:366` | `82cca1a6178a` | `82cca1a6178a` | ✔ PRESENT |
| `runtime` (U-P2AC) | `5559de4ce28c` | `5559de4ce28c` | ✔ PRESENT |
| `usage` (U-IG1/IG2/IG3/CC1) | `4536b91ed282` | `4536b91ed282` | ✔ PRESENT |
| `wallpaper` ((iv-a)) | `826d9217a8fc` | `826d9217a8fc` | ✔ PRESENT |

这四项 rev 与**正在运行的宿主实际下发的 rev 一致**——由独立 `curl http://127.0.0.1:3080/ | grep 'client.js?rev='` 核对（见下）。

---

## 三、L3：反向对照与坏输入

| # | 用例 | 期望 | 实测 |
|---|---|---|---|
| 1 | 喂**旧** rev（`ui-layout=af19ea709a15…`）并加 `--require-rev ui-layout=82cca1a6178a` | 必须判为未命中 + 退出码 **3** | ✔ 退出码 3，报 `✘ --require-rev 未满足：ui-layout 期望 82cca1a6178a 实际 af19ea709a15` |
| 2 | 输入 `NOT JSON AT ALL {{{` | 友好报错、**不得**抛裸栈 | ✔ 退出非 0，输出含"常见原因"排查提示、无 `at Object.<anonymous>` 栈帧 |
| 3 | 同一解析器吃 `dsh-user-capture/v1`（方案 C 格式） | 自动判别形态并给出 forcedStyleAndLayout 证据 | ✔ 识别为 `dsh-jank-capture.html (inpage)` |
| 4 | 帧分布恒为 0 的**回归守卫** | 窗口内帧样本必须 >0 | ✔ = 4 |

第 1 条是**关键**：它证明 rev 判定不是"只要给了 rev 就说命中"。

---

## 四、验证过程中**真实发现并修掉**的缺陷（诚实记录）

验证不是走过场，以下都是实测暴露的真问题：

### 1. `parseTaskString` 正则截断 URL（L1 抓出）
原正则 `(https?:\/\/\S+?)(?::(\d+):(\d+))?` 里 `\S` 包含 `:`，而 `:line:col` 组是可选的 ⇒
惰性量词在**第一个冒号**就停：`https://127.0.0.1:3080/x.js:12:5` 被切成 `url="https"`，行列号也丢。
**修复**：URL 改贪婪 `((?:https?|file|webpack|chrome-extension):\/\/\S*)`，并把 `:line:col` 作为必选组匹配、无行列号的走第二条分支。

### 2. 自检夹具本身编码了**不存在的现实**（L1 抓出，最有价值的一条）
我的合成 trace 假设 `RunTask.args.data.task` 存在。真相是：
**Chromium 131 的 `RunTask.args` 是空对象 `{}`，全文件 0 次 `toptask`**。
这条失败逼我去查真实 trace，从而发现下面 3、4 两条更严重的形制问题。**如果我选择"改测试让它过"，交付物上真实 trace 会全线失效。**

### 3. **µs / ms 单位链断裂**（L2 抓出，最严重的 bug）
中间形态里 `frameGaps[].t` 与 `runs[].t` 是**毫秒**，而锚点（`performance.mark` 的 `ts`）是 trace 的**微秒**，
二者在 `analyzeWindow` 里被直接比较 ⇒ 相差 **1000 倍** ⇒ **所有窗口统计恒为 0**（帧数 0、top10 空、占用 0.0%）。
危害等级：**静默错误**——报告照常输出，数字看起来像"完全不卡"。
**修复**：在 `analyzeWindow` / `resolveAnchor` 入口统一把锚点与窗口归一到毫秒（写成显式"单位铁律"注释），
并新增 **L3 第 4 条回归守卫**，防止再次退化。

### 4. 帧边界事件名与实际不符
原实现找 `DrawFrame`/`BeginFrame`——**实测这两个在 Chromium 131 的 trace 里是 0 个**。
真实可用的是 `AnimationFrame`（`ph:'b'/'e'` 异步对，**不是** `ph:'X'`）与 `Commit`（`ph:'X'`）。
**修复**：改成按可得性择优的 `FRAME_ORDER`，`AnimationFrame` 取 `ph:'b'` 的 `ts` 作帧起点。

### 5. `ProfileChunk` 的 phase 是 `'P'` 不是 `'X'`
原实现遍历全部事件找 `ProfileChunk` 但在别处用 `ph==='X'` 的集合，导致 **CPU 函数级归因整段为空**（实测 0 样本）。
**修复**：`ProfileChunk` 单独按 `ph:'P'` 收（实测 1044~1599 个 chunk、7.5 万~8 万采样），
并剔除 `(idle)/(program)/(root)/GC` 干扰项后单列"真实代码 top"。

### 6. `performance.mark` 的 phase **不稳定**，且被 400 条上限"挤掉"
- 同一条 `USER_CLICK_SETTINGS_START` 在不同次采集中分别是 `ph:'I'` 和 `ph:'R'` ⇒ **按 name 匹配，绝不按 ph 过滤**。
- 更隐蔽：原实现把 mark 候选集上限设为 400 条，而 trace 里有 **7.7 万条 `StackCpuSampling`** 把上限吃满，
  导致真正的 mark 被挤出数组 ⇒ 锚点退化为"trace 中点"、置信度 low、窗口完全错位。
  **修复**：mark 只收 `blink.user_timing`（仅 29 条），上限提到 2000。

### 7. 锚点选择会踩"窗口越界"陷阱
START/END 中点常把 `+window` 推到采集范围之外（实测尾部只剩 1651 ms），于是"点击后"一栏全 0，
读起来像"点了设置反而不卡"。
**修复**：改为**证据量驱动**——对每个候选真正数一遍窗口内的 `RunTask`/帧样本数与覆盖度，
在"覆盖度达标"的候选里选证据最多的，并在报告里显式打印**选择理由**与每个候选的覆盖度/证据量。
同时新增**覆盖度告警**：数据不足时明确说"这是证据不足，不是不卡"，并给出重录指引。

### 8. 活跃期占用率出现 >100% 的物理不可能值（实测 167.6%）
帧样本只有 3~4 个时，"活跃期跨度"可能只有几十毫秒，而 RunTask 占用的是整个窗口。
**修复**：分母至少取窗口的 1/4 并封顶 100%，且**样本 <10 时干脆不给这个数**。

### 9. rev 自动检测**不可用**（方案 C 的诚实修正）
实测 `curl -sI http://127.0.0.1:3080/` **没有任何 CORS 响应头**（无 `Access-Control-Allow-Origin`）⇒
从 `file://` 或别的端口打开的取证页**必然**无法读取目标页 rev。
原先的错误提示只归因于 `file://`，属于**误导**（用户改用 HTTP 打开仍会失败）。
**修复**：把限制改成"已实测确认服务端不下发 CORS 头，只有同源才可能成功"，并直接给出两种手动取 rev 的替代办法。
**同时验证了好消息**：该服务端**未**设置 `X-Frame-Options` / `frame-ancestors` CSP ⇒ 方案 C 的 iframe 模式**可以正常内嵌**。

---

## 五、验证的限制（明确声明，避免过度解读）

1. **本验证只能证明"解析器能正确解析真实 trace"，不能证明"用户的主观卡顿已被复现"。**
   恰恰相反：**这份 headless trace 里页面并不卡**（窗口主线程占用 1.1%、>50 ms 掉帧 0 次、最长任务 26 ms）。
   这正是任务前提所述——**只有用户环境能复现主观卡顿**，本交付物的作用是让用户那次卡顿**可被解析**。
2. **headless 与用户真实环境不同源**：无 GPU 合成、无真实窗口/缩放、无用户 profile 与插件差异、
   无其他标签页争抢。因此本夹具**不能**用作"修复有效"的证据，只能用作**解析器的输入样本**。
3. **夹具自身的采集质量有已知瑕疵**：录制在点击后仅多等了约 2~2.7 s，
   因此解析器会正确地报 `锚点之后只有 2700 ms 数据（希望 3000 ms）`。
   这条告警**本身就是一次有效的功能验证**（证明覆盖度检查真的会触发）；同时它也是 Runbook 里
   "点击后必须再等 5 秒以上"那条要求的实测依据。
4. **帧事件在 headless/空闲页极度稀疏**（`AnimationFrame` 仅 59~236 个，窗口内可能只有 4 个）
   ⇒ 本夹具**不足以**验证"帧分布统计在长时间卡顿下的表现"。该场景只能靠用户真实环境的 trace 验证。
5. **CPU 采样占比不是绝对时间**：trace 未记录采样间隔，解析器只输出**相对占比**（并剔除 idle/program/GC）。
   这是刻意的保守选择，不做未经验证的绝对值换算。
6. **`usage` 修复项无法由页面 trace 判定**：它在宿主（冷面），页面侧只能看到"一次 RPC/一次长任务"。
   解析器对此显式输出 `[limit]` 说明，需与宿主侧 G1 事件循环延迟数据联合判读。
7. **只验证了 Chromium 131 的 trace 形制**。其它 Chrome/Edge 版本的事件名与 `args` 结构可能不同；
   解析器已按"可得性择优 + 缺失即告警"设计（`实证口径` 小节会列出每个事件名在本 trace 里的**实际个数**，
   缺失的分项会显式标注"不可用"），但**未**在其它版本上实测过。

---

## 六、环境与命令留痕

```bash
# 1) 内部自检
node parse-trace.mjs --self-test

# 2) 真实 trace 端到端（rev 由独立 curl 核对）
curl -s http://127.0.0.1:3080/ | grep -oE '[a-z@/-]+\.js\?rev=[a-f0-9]{12}' | sort -u
node parse-trace.mjs fixtures/real-settings-trace.json \
  --rev 'ui-layout=82cca1a6178a,runtime=5559de4ce28c,usage=4536b91ed282,wallpaper=826d9217a8fc' \
  --json fixtures/parser-report.json

# 3) 反向对照（期望退出码 3）
node parse-trace.mjs fixtures/real-settings-trace.json \
  --rev 'ui-layout=af19ea709a1556b8c48bedfa8b31e785,runtime=000000000000,usage=000000000000' \
  --require-rev ui-layout=82cca1a6178a ; echo "exit=$?"

# 4) 全量验证
bash verify.sh
```

环境：Node v22.23.2 · Playwright 1.49.1 · Chromium 131.0.6778.33（headless）
宿主：DSH PID 10806 全程存活，未重启、未 pkill、未改动任何产品文件。

---

## 七、产物清单

| 文件 | 说明 |
|---|---|
| `RUNBOOK-USER-CAPTURE.md` | 面向用户的取证 Runbook（中文、逐条命令、预期输出、常见坑） |
| `dsh-jank-capture.html` | 方案 C 单文件纯前端只读取证页（iframe 模式 + 控制台探针模式） |
| `parse-trace.mjs` | 解析器（吃 DevTools trace 与方案 C JSON 两种输入） |
| `verify.sh` | 一键验证（16 项，只读） |
| `fixtures/real-settings-trace.json` | **真实** trace 夹具（26 MB / 103,153 事件，含真实点击「设置」） |
| `fixtures/capture-fixture.mjs` | 夹具采集脚本（可重跑） |
| `fixtures/CAPTURE-NOTES.md` | 采集过程留痕 |
| `fixtures/parser-report.json` / `parser-report.txt` | 真实 trace 的解析输出（人读 + 机读） |
| `fixtures/selftest.txt` | 自检输出留痕 |
| `VERIFICATION.md` | 本文件 |
