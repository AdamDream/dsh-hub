import io
p = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/audit.md'
s = io.open(p, encoding='utf-8').read()
n_ok = 0

def rep(a, b, required=True):
    global s, n_ok
    if a in s:
        s = s.replace(a, b, 1); n_ok += 1; return True
    if required:
        raise SystemExit('MISS: ' + a[:90])
    return False

# ---------- 1) 顶部「方法学修正采纳」 ----------
adopted = u'''> **方法学修正采纳（2026-09-22，来自 `incident2/plugins-page` 的实测 + 本线自身器械诊断）**
> 1. **阳性对照必须用「页内定时器/点击任务」注入，不能用 `Runtime.evaluate`。** 本线独立得到同一结论（§2.1 三臂矩阵：点击驱动 120 ms → LongTask **120 ms**；`Runtime.evaluate` 120 ms → LongTask **0 条**，而 LoAF 122 ms）。对方 LoAF 123.5 / LongTask 0 与之**互相印证**。本线阳性对照**本来就是用页内任务做的**（`S.spinTask` / `S.installClickSpin`），未受影响。此边界已写入 §2.1、§2.2。
> 2. **「插件」导航 ≠ 「插件列表」。** 点导航「插件」落到 `插件配置`（`configurable`，order 0；`dsh-client-ui-settings-plugins/lib/client.js:420/489/1289-1291`），inventory tab 是 `dsh-client-ui-settings-plugin-inventory/lib/client.js:288` 的 order 10。**本线数据本来就分开计**：点导航「插件」= 9 个 `/usage/*`、**不发** `pluginInventory.list`；后者**只在点「插件列表」子标签时发一次**（run6 实测复现，§3.7）。
> 3. **宿主 `pluginInventory.list` 不是"每次点击无缓存重扫目录"** ⇒ §3.7 更正：它遍历内存 `ctx.loader.entries()`（`dsh-host-plugin-inventory/lib/index.js:102-114`，该文件**无 `fs` 引用**），HTTP p50 **9.09 ms**（177 条 / 21,742 B）vs 9 字节对照 p50 **10.98 ms**（比值 0.83）⇒ **载荷大小无可测代价**。本线 run5 据"窗口内未 settle"推断的 **>1.8 s 已作废**（run6 实测 41.9 / 27.6 ms）。
> 4. **a11y 乘数（引用，不重测）**：`--force-renderer-accessibility`（用户 Chrome 实开）在 Blink 侧带来 **×1.4–1.8**（导航热点击 4.2→6.6 ms、tab 点击样式重算 0.51→0.89 ms、冷导航重算 2.00→3.18 ms）。已作为候选放大器纳入 §7 #10。

'''
rep(u'---\n\n## 0. 逐条裁决（对照任务 1–5）', adopted + u'---\n\n## 0. 逐条裁决（对照任务 1–5）')

# ---------- 2) §2.1 独立复现 ----------
rep(u'这是 Chromium 的行为：LongTask 只统计页面自身任务队列的任务，不统计 inspector 直接下发的任务。**器械边界，已记录**。',
    u'这是 Chromium 的行为：LongTask 只统计页面自身任务队列的任务，不统计 inspector 直接下发的任务。**器械边界，已记录**。**该边界已由 `incident2/plugins-page` 独立复现**（页内 `setTimeout`/rAF 注入 → LongTask **120.0 ms 整**；`Runtime.evaluate` 注入 → LongTask **0**，而 LoAF 抓到 **123.5 ms**）——与本线三臂矩阵结论一致。**故本线阳性对照一律用页内任务（`S.spinTask` / `S.installClickSpin`），从不使用 `page.evaluate` 做阳性对照。**')

# ---------- 3) §3.5 更正 + 新增 §3.7 ----------
rep(u'- `插件列表`（`all`）挂载 → **恰好 1 次 `/api/pluginInventory/list`**；该请求在 1.8 s 窗口结束时**仍未 settle**（`ms` 缺失）⇒ **耗时 > 1.8 s**（终值未取到，标 INCONCLUSIVE）。静态侧证据（`raw/sub-section-cost.md`）：宿主实现每次调用直读 Loader、**无缓存**。',
    u'- `插件列表`（`all`）挂载 → **恰好 1 次 `/api/pluginInventory/list`**。~~⇒ 耗时 > 1.8 s~~ **该推断已作废**：run5 只记了"窗口内未 settle"（`ms` 缺失）就外推了上界，属**单样本过度解读**。run6 定点复测（等到 resolve 为止）得 **41.9 ms（本会话首次）／27.6 ms（二次）**，见 §3.7。')

rep(u'### 3.6 静置（dwell）12 s', u'''### 3.7 定点裁决（run6）：`pluginInventory.list` 真实耗时 + 「插件」导航 vs「插件列表」的前提澄清

`raw/run6-inventory-rpc.json`（loadavg 3.74，`foreign=0`，单请求等到 resolve，上限 25 s）：

**(A) 点导航「插件」** → **9 个 RPC，且 `pluginInventory.list` 的命中数 = false**（与会话 2 完全一致）：

| 方法 | click→发出 | 发出→响应头 | 响应字节 |
|---|---|---|---|
| `/usage/summary` | +9.5 ms | 30.9 ms | 270 |
| `/usage/timeseries` | +10.3 ms | 94.8 ms | 934 |
| `/usage/heatmap` | +10.6 ms | 96.2 ms | 1430 |
| `/usage/byModel` | +10.8 ms | 120.3 ms | 1091 |
| `/usage/byProject` | +10.9 ms | 163.6 ms | 1039 |
| `/usage/byDay` | +11.0 ms | 223.8 ms | 934 |
| `/usage/timeseries`(hour) | +11.0 ms | 247.5 ms | 245 |
| **`/usage/sessions`** | +11.3 ms | 301.7 ms | **54,062** |
| `/usage/status` | +11.4 ms | 352.3 ms | 312 |

⇒ 9 个请求在 **click+9.5…11.4 ms 内并发发出**，**25–352 ms 内陆续到齐**。**`/usage/sessions` = 54,062 字节**，与 `incident2/plugins-page` 独立实测的 **54,062 字符**逐字节吻合。

**(B)/(C) 点「插件列表」子标签** → `/api/pluginInventory/list`，**HTTP 200**：

| 次 | click→发出 | 发出→响应头 | 响应体读完 | 字节 |
|---|---|---|---|---|
| 首次（本会话冷）| +1.9 ms | **41.9 ms** | 43.4 ms | **21,754** |
| 二次（切走再切回，温）| +1.8 ms | **27.6 ms** | 28.5 ms | 21,754 |

**结论与更正**
- **本线 run5 的 ">1.8 s" 推断作废。** 真实量级是 **几十毫秒**，与 `incident2/plugins-page` 的 HTTP 实测 **p50 9.09 ms** 同量级（本线略高：页内带 fetch 包装 + body 副本读取 + 同期多线并发 loadavg≈3.7）。
- **`pluginInventory.list` 不是"无缓存重扫目录"**（对方证伪，本线采纳）：宿主 `dsh-host-plugin-inventory/lib/index.js:102-114` 遍历**内存** `ctx.loader.entries()`，该文件**无 `fs` 引用**；177 条 / 21,742 B 的 p50 **9.09 ms** 与 9 字节对照的 p50 **10.98 ms** 比值 **0.83** ⇒ **载荷大小无可测代价**，~6 ms 地板是启动+回环+调度。本线 §6 候选 3 的**理由已据此改写**。
- **run5 为何显示未 settle（根因 INCONCLUSIVE）**：run5 只记了 `t0`（在窗口内）而**未记 click→发出的偏移**，若该请求在接近窗口末尾才发出，1800 ms 窗口会在 resolve 前结束。**这是最可能解释，但本线无法从 run5 原始数据证实**（run5 未落盘 issuance 偏移），故标 INCONCLUSIVE；run6 已补齐该字段。

### 3.6 静置（dwell）12 s''')

# ---------- 4) §5.1(a) 表注 + §6 候选 3 改写 ----------
rep(u'- **预期收益**：`插件列表` 完整渲染 **1820 dlg 节点 / 1736 内容节点 / 192 SVG**，是通用设置的 **4.3× 节点 / 13.7× SVG**，且每次挂载直读 Loader 的 `/api/pluginInventory/list` **耗时 > 1.8 s**。虚拟化 + 缓存可降低挂载尖峰与无缓存重扫。（「常驻重算」这一预期收益已被 §3.6 实测排除。）',
    u'- **预期收益**：**全部落在客户端渲染规模上** —— `插件列表` 完整渲染 **1820 dlg 节点 / 1736 内容节点 / 192 SVG**，是通用设置的 **4.3× 节点 / 13.7× SVG**。**不再以 RPC 为理由**：run6 实测 `/api/pluginInventory/list` 仅 **41.9 ms（冷）/ 27.6 ms（温）**、21,754 B，且对方已证伪"无缓存重扫目录"（§3.7）⇒ **宿主端点不是成本点，"缓存"不是本候选的收益来源**。「常驻重算」这一预期收益亦已被 §3.6 实测排除。')

rep(u'- **验收标准**：`插件列表` 挂载后 `dialogNodes` 从 **1820 降到 ≤400**、`dlgSvg` 从 192 降到 ≤40；同一会话内 `pluginInventory.list` 调用数 ≤1（现在每次挂载 1 次）；并顺带确认 `插件列表 ↔ 插件配置` 互切时**旧子标签内容确实被卸载**（§3.5 的 INCONCLUSIVE 项）。',
    u'- **验收标准（仅客户端规模）**：`插件列表` 挂载后 `dialogNodes` 从 **1820 降到 ≤400**、`dlgSvg` 从 192 降到 ≤40；挂载窗口的 `ΔScriptDuration` / `ΔLayoutCount` 不高于 `插件配置` 的 1.5×；并顺带确认 `插件列表 ↔ 插件配置` 互切时**旧子标签内容确实被卸载**（§3.5 的 INCONCLUSIVE 项）。**不设 RPC 类验收**（宿主端点非成本点）。')

rep(u'- **改动点**：客户端 `dsh-client-ui-settings-plugin-inventory`（`…/lib/client.js:285` 注册）；宿主侧 `pluginInventory.list`（静态证据：注释明示每次调用直读 Loader、无缓存）。',
    u'- **改动点**：**仅客户端** `dsh-client-ui-settings-plugin-inventory`（`…/lib/client.js:285` 注册；inventory tab `:288` order 10）。**宿主侧 `pluginInventory.list` 不动**——已实测其代价为几十毫秒量级、且载荷无关（§3.7），改它没有收益。')
rep(u'- **热/冷**：**冷**（涉及宿主端点缓存策略 + 前端结构改动）。',
    u'- **热/冷**：**冷**（纯前端结构改动：虚拟化 1820 节点列表；不再涉及宿主端点）。')
rep(u'- **附**：同一修复应顺带**定位**那 ~70/s 的持续样式重算来源（见 §7）。',
    u'- **附**：同一修复应顺带查清 `插件列表 ↔ 插件配置` 互切时**旧子标签内容是否被卸载**（§3.5 的 INCONCLUSIVE 项）——若确认未卸载，则该面板的常驻节点成本会随访问次数累积。')
rep(u'### 候选 3（冷面，规模面）：`插件列表` 的 `pluginInventory.list` 加缓存 + 列表虚拟化',
    u'### 候选 3（冷面，纯客户端规模面）：`插件列表` 列表**虚拟化**（不含宿主端点改动）')

# ---------- 5) §7 新增条目 ----------
rep(u'| 9 | **rAF 帧间隔通道** | **不可用作失速探测器** | §2.2：120/200 ms 注入阻塞产生 0 个 >50ms 帧间隔。**因此本报告不把"帧 p95/p99/max"当作卡顿证据。** |',
    u'''| 9 | **rAF 帧间隔通道** | **不可用作失速探测器** | §2.2：120/200 ms 注入阻塞产生 0 个 >50ms 帧间隔。**因此本报告不把"帧 p95/p99/max"当作卡顿证据。** |
| 10 | **a11y 乘数（引用他人实测，本线未重测）** | **候选变量，未纳入本线对照** | `incident2/plugins-page` 实测：`--force-renderer-accessibility`（**用户 Chrome 实开**）在 Blink 侧带来 **×1.4–1.8**（导航热点击 4.2→6.6 ms、tab 点击样式重算 0.51→0.89 ms、冷导航重算 2.00→3.18 ms）。**本线器械为 headless_shell，未开该开关**，故本线所有时间量与用户的绝对时间量之间**至少差一个 ×1.4–1.8 的已知乘数**（方向：用户更慢）。这与"用户在 Chrome 里感到小卡顿、而本线 headless 测不到长任务"**不矛盾**——本线的 0 长任务结论**只对主线程 JS/布局成立**。 |
| 11 | **`pluginInventory.list` 的"无缓存"表述** | **已更正（采纳对方证伪）** | 见 §3.7：宿主遍历内存 `ctx.loader.entries()`、无 `fs`、载荷无关；本线原表述（来自静态子代理 `raw/sub-section-cost.md`）**过强，已更正**。 |''')

# ---------- 6) §8 锁的澄清 ----------
rep(u'| 共享锁 | `research-v2/.probe.lock`（mkdir 原子 / 18s 重试 / `rm owner.txt && rmdir`）。**未强占任何他人锁**。',
    u'| 共享锁 | `research-v2/.probe.lock`（mkdir 原子 / 18s 重试 / `rm owner.txt && rmdir`）。**未强占任何他人锁**；**也从未清理过他人锁**——唯一一次清理发生在 2026-09-22 11:26，对象是 **`owner.txt` 已被我自己的 run2 删除、目录为空、无任何 owner 记录**的残留目录（我的 `rmSync(dir)` 抛 `ERR_FS_EISDIR` 所致），已在 §8② 记录。`owner_pid 408162` 那条 `owner.txt` 被替换与本线无关（那是 `incident2-why-these-two` 合法持锁期间，我的 `release` 对它的处置是**拒绝删除**）。run6 起 loadavg 与 `concurrentWith` 已随每轮落盘（`raw/run6-inventory-rpc.json`）。')

# ---------- 7) §9 复算加入 run6 ----------
rep(u'node scripts/run5.mjs     # 插件子标签 A/B（修坐标）+ dwell',
    u'node scripts/run5.mjs     # 插件子标签 A/B（修坐标）+ dwell\nnode scripts/run6.mjs     # 定点裁决 pluginInventory.list 真实耗时（冷/温）+ 「插件」导航 vs「插件列表」前提澄清')

io.open(p, 'w', encoding='utf-8').write(s)
print('patch C applied, replacements =', n_ok)
