# 客户端侧补丁独立审计报告（cross-client · 证伪/确认）

**审计员**：独立审计 subagent（只读观测）
**对象**：DSH Web GUI <http://127.0.0.1:3080>，宿主 PID **20806**（审计全程未重启/未停止/未修改任何源码或配置）
**时间**：2026-09-20 16:02–16:21（CST）
**方法**：HTTP 取字节 + sha1 比对 · 交付件对拍（diff/backup）· Playwright 无头浏览器功能冒烟（真实 GUI）· `probes/measure-after-C1.mjs --window 20` 复测 · `probes/session-list-shape.mjs` 只读取服务端载荷
**纪律声明**：未点任何「应用/保存/删除/确认」类写状态按钮；未改任何源码/配置；未重启宿主；浏览器实例最多 1 个并发；总请求量 ≈ 5 次整页加载 + 1 次 `session.list` + 4 次 bundle GET；临时文件在 `/tmp/gui-audit/`。

---

## 0. 结论摘要

| # | 审计问题 | 结论 |
|---|---|---|
| 1 | 4 个包 rev 与磁盘/服务字节一致 | ✅ **全部确认**（rev == 磁盘 sha1-12 == 实际 GET 字节 sha1-12；且与各自交付副本逐字节相同） |
| 2 | 功能冒烟无异常 | ✅ **通过**（8 个设置标签 + 首页 + 会话列表 + 子代理面板全部渲染；全程 **0** console error / 0 pageerror / 0 requestfailed） |
| 3 | 是否引入回归 | ⚠️ **发现 1 处客户端回归（低危·可见）**：`@local/dsh-usage` 刷新周期下拉出现**重复的「60s 刷新」选项**（5 项并列，DOM 实据 + 补丁源锚点实据）。另有 1 处理论性陈旧化改动（P2 的 byId 前向携带），未观察到可见效应 |
| 4 | 是否有可见功能缺失 | ✅ **6 项功能逐项验证存在**（会话侧栏 / 设置面板 / 模型选择 / 子代理列表+抽屉+成员切换 / 用量卡片 / 远程工作区标签） |
| 5 | 性能数字 | ⚠️ 结论方向成立但**量级不可复现**：本轮 idle 实测 62.8 ms/s（基线 121），但本轮 WS 帧负载是基线的 **2.2–2.8 倍**；BEFORE-AFTER.md 宣称的 27.5 ms/s 本轮未复现。**逐帧归一化后 script −51%**（保守仍支持补丁收益） |

---

## 1. 问题 1：rev 与字节一致性（逐个结论）

### 1.1 方法与原始数据

宿主 HTML（`curl http://127.0.0.1:3080/` 原样保存 `/tmp/gui-audit/gui-audit-index.html`）注入的 `?rev=`，与磁盘文件 sha1 前 12 位、以及**实际 GET 该 URL 拿到的字节**的 sha1 前 12 位三方比对：

| 包 | 宿主 HTML 注入 rev | 磁盘文件 sha1 | GET 实测 sha1 | 字节 | 三方一致 |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` | `a0fb4bb225d3` | `a0fb4bb225d3aa09f6864321090b3c670495df59` | `a0fb4bb225d3aa09f6864321090b3c670495df59` | 397,957 | ✅ YES |
| `@deepseek-ai/dsh-client-ui-workspace` | `5596cec54007` | `5596cec54007779b007cb3cd874a0ae75604acc6` | `5596cec54007779b007cb3cd874a0ae75604acc6` | 114,359 | ✅ YES |
| `@local/dsh-usage` | `1988a5bb4e94` | `1988a5bb4e94b96764d09217a91431957bdd23e6` | `1988a5bb4e94b96764d09217a91431957bdd23e6` | 71,194 | ✅ YES |
| `dsh-workspace-enhancement` | `b295bb00e32b` | `b295bb00e32b58e5ca47afcd2f118651fb40ec92` | `b295bb00e32b58e5ca47afcd2f118651fb40ec92` | 267,026 | ✅ YES |

磁盘路径（宿主实际读取）：`/home/CNS2026495165/.dsh/profiles/node_modules/<pkg>/lib/client.js`
其中 `@deepseek-ai/*` 为**符号链接**，真实文件在 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js`（该真实路径 sha1 亦为 `a0fb4bb225d3…`，已核）；`dsh-workspace-enhancement` 与 `@local/dsh-usage` 是 profiles 下的独立拷贝。

### 1.2 热替换机制独立复核（证明"服务出的就是磁盘当前字节"）

| 复核项 | 实测 |
|---|---|
| 响应头 `cache-control` | 4 个包全部 `cache-control: no-cache`（另 `content-type: text/javascript; charset=utf-8`） → 每次 GET 回源读盘 |
| **伪造 rev**：GET `…/client.js?rev=deadbeef0000` | 返回 200，sha1 仍为 `a0fb4bb225d3`（runtime）/ `1988a5bb4e94`（usage） → `?rev=` 仅是缓存破坏串，**不参与内容选择** |
| HMR 插件存在 | `/plugins/@deepseek-ai/dsh-client-hmr/client.js?rev=774dfcde3162` 已注入，bundle 内含 `rebuilt` 推送逻辑 |

### 1.3 交叉证据：live 字节 == 交付副本（排除"rev 对得上但内容是旧的/别的"）

| 包 | 对拍对象 | 结果 |
|---|---|---|
| runtime | `backup/B1/20260920-153948/b1-client-runtime.patched.js` | sha1 **完全相同**（397,957 B） |
| ui-workspace | `backup/B1/20260920-153948/b1-ui-workspace.patched.js` | sha1 **完全相同**（114,359 B） |
| workspace-enhancement | `patched/workspace-enhancement.client.js` | sha256 均 `7df7a655…`，且 == C2 `meta.txt` 记录的 `patched_sha256` |
| dsh-usage | `patches/usage-plugin.sh` + `backup-usage/deployed/backup-20260920-154018/`（pre 镜像） | diff 6 hunks / +83 −6 行（其中宿主半 `db.js` 3 hunks / +213 −18）；客户端 6 hunks 中 5 处为设计内改动、1 处多插（见 §6.1） |

**补丁语义标记（确认字节里真的是补丁，而非同名空改动）**：

- runtime：`/* dsh-perf-fix P1 v1 */`（`client.js:8576`，`liveIds = new Set()` + `liveIds.has(id)` 的 O(N) 清理，替换原 `items.some(...)`）；`/* dsh-perf-fix P2 v1 */`（`:8842` 新增 `sameIdList/sameJobViewList/sameSubagentCatalogs/sameSubagentCatalogEntries`；`:9322` `projectList` 引用稳定化；`:9370` `this.list.set(nextProjection)`）；B1 新鲜度字段（`:8572` 追加 `&& prev.runningSubagentCount === entry.runningSubagentCount`）。
- ui-workspace：`:171` 与 `:286` 两处 `runningSubagentCount: typeof … === "number" ? … : (descendants.get(…)?.runningCount ?? 0)`（B1 消费方 + 回落分支）。
- workspace-enhancement：`:4124` `Array.from(new Set(ids))`（原 `ids.filter((id,index)=>ids.indexOf(id)===index)`）；`:5418` `sessions: (() => { … memoized by snapshot identity … })()`。
- dsh-usage：`:773` `useState(60)`（原 30）；`:776-806` IntersectionObserver 可见性门控 + `pollVisible`；`:957/:961` `!pollVisible \|\| document.hidden` 门控；`:917` `loadAllRef.current = loadAll`；`:860`/`:917` 窗口日对齐。

**P1/P2/B1 增量 diff 规模**（vs `backup/C1/20260920-153800/`）:  4 hunks / **+99 −11 行**，全部落在两个区域（entryCache 清理、projectList），无越界改动。

> **问题 1 结论**：4 个包 **确认生效**，且服务字节 = 磁盘字节 = 交付补丁副本，无缓存陈旧风险。

> **并发写入提示（不影响本次结论）**：`.workspace/lag-fix/patched/` 目录在本审计期间（16:04）被**另一个并行工作档**改写（`patched/client-runtime.client.js` 变为 399,218 B，**不等于** live 的 397,957 B）。本审计的一切判据以 **live 文件与 HTTP 实测字节**为准（两者与 `backup/B1/…/b1-client-runtime.patched.js` 逐字节相同）；若后续有人拿 `patched/` 目录做对照，请注意该目录是活跃工作区、其内容此刻并非 live 的镜像。

---

## 2. 问题 2：功能冒烟（无头浏览器 · 真实 GUI）

所有步骤全程监听 `console.error` / `pageerror` / `requestfailed`。

### 2.1 首页渲染

| 观测 | 值 |
|---|---|
| DOM 节点总数 | **584**（与历史 after 复测的 584 完全一致 → 无 DOM 膨胀回归） |
| 侧边栏 | 存在（`.sg_sidebar` / `.qDHVXG_*` 工作区树 + 11 个工作区分组 + 「分布式节点」文件夹） |
| 主区 | 「探索未至之境 / 预览版」+ 输入框 + 模型/权限/预设 chip 全部渲染（截图 `audit-01-homepage.png`） |
| 错误 | **0** console error / 0 pageerror / 0 requestfailed |

### 2.2 设置面板：默认标签 + 8 个标签逐个切换

默认标签 = **通用设置**（`navCell active`）。逐标签点击结果：

| 标签 | 点击 | 切换后 active | 面板文本长度 | 新增错误 | 内容抽样 |
|---|---|---|---|---|---|
| 通用设置 | ✅ | 通用设置 | 377 | **0** | 预设/权限/语言/外观/Enter 行为/壁纸（含"应用"按钮，**未点**） |
| 模型 | ✅ | 模型 | 144 | **0** | provider 列表：DeepSeek / opencode-go / adam / 自定义（带编辑/删除） |
| 插件 | ✅ | 插件 | 1938 | **0** | 终端 / Agent 循环 / 网页搜索 + **Token 用量 · dsh-usage 卡片** |
| Agent 预设 | ✅ | Agent 预设 | 562 | **0** | 标准/PTC/极简 三个内置预设 |
| 远程工作区 | ✅ | 远程工作区 | 296 | **0** | 机器管理表单（"还没有机器。在下方添加。"） |
| 分布式控制 · dsh-ssh-gui | ✅ | 同左 | 403 | **0** | 节点列表（0）+ 新建节点表单 |
| vision-adam 识图设置 | ✅ | 同左 | 646 | **0** | 当前生效 model/baseURL/apiKeyEnv/maxTokens |
| 子代理模型 | ✅ | 同左 | 1392 | **0** | provider=adam · model=deepseek-v4-pro（settings 段覆盖 preset） |

→ **8/8 标签可渲染、8/8 切换无异常、0 错误**。截图：`audit-02-settings-default.png`。

### 2.3 设置面板内的用量卡片（"插件"标签）

**渲染成功**（非空、非报错、非 "无数据"）：`[class*="du_root"]` 存在，`du_*` 节点 **59** 个；截图 `audit-03-usage-card.png`。

实测可见数据（数据略旧属预期，宿主半未重启）：

```
请求数 24931 · 输入(未缓存) 111.54m · 输出 24.61m · 缓存读 4.25b · 缓存写 0 · 命中率 97% · 覆盖会话 502
按模型：deepseek-v4-flash 17852 / deepseek-v4.1-flash 6790 / gpt-6-astra 289
上次 ingest：2026-09-20 · 来源事件：dsh 82207 / cc 22700
趋势标题：「趋势（按日 · 宿主暂不支持小时粒度，重启后生效）」（小时粒度回落分支——符合"宿主半待重启"的预期）
```

### 2.4 会话列表：能列出 / 能点开 / 变更能刷新（P2 `list.set` 重点回归面）

| 子项 | 方法 | 结果 |
|---|---|---|
| 列表能列出 | 逐个点开 11 个工作区分组 | 会话行 `[aria-label^="会话“"]` 由 **1 → 15** 条（`audit-p3-03-all-groups.png`） |
| 能点开一条会话看到消息流 | 点侧栏行「检查工作区相关内容」 | DOM **584 → 3056** 节点；正文 20,693 字符；含消息流、工具行、「详情」面板、`对话/轨迹` 标签、「加载更早」（`audit-p2-01-session-open.png`） |
| **选中态随点击更新** | 同一次点击前后 | 选中行由「新会话」(临时空行) → 「检查工作区相关内容」；临时空行**从侧栏消失** → 列表内容变更即时反映（P2 未冻结引用） |
| **切回后列表恢复** | 点侧栏「新会话」行 | 选中态回「新会话」，子代理徽标集合回到切换前状态；URL/路由无异常 |
| **链路实时刷新（页内证据）** | 同一页面先后两次快照 | 侧栏行由 `面试 \| 1 个子代理运行中 \| 检查工作区相关内容 \| 37分钟` → `面试 \| 进行中 \| 1 个子代理运行中 \| 检查工作区相关内容 \| 37分钟`（**行状态标签在页内自发出现**，无刷新） → 证明 `projectList → list.set → 订阅者重渲染` 通路仍然活着 |
| 时间戳随活动推进 | 多次快照 | 27分钟 → 30分钟 → 33分钟 → 37分钟 → 38分钟（跨页面观测，非同一页内） |

> **未验证**：点「新会话」后侧栏**没有新增行**。原因经代码核对是设计使然：`ui-workspace` 的 `groupByWorkspace/sessionVisible` 注释明确"Blank sessions are excluded except for the selected provisional New Session row"——新会话在发出首条消息前是"临时行"，不会新增列表项。要观测"新建后多一行"必须真发一条消息（写状态），本次**按纪律未做**（见 §5）。

### 2.5 正在运行的子代理：徽标/状态点（服务端字段未生效时的回落分支）

| 观测 | 值 |
|---|---|
| 服务端字段 | `POST /api/session.list` 实测：**88 条顶层会话中 `runningSubagentCount` 出现 0/88**（`probes/session-list-shape.mjs`：A6 FAIL 0/88）→ 服务端字段确实还没生效 |
| 客户端表现 | 侧栏行**显示了**「**1 个子代理运行中**」文本（无头浏览器无障碍树实测），且会话头部 chip `aria-label="1 个子代理，正在运行"` / 可见文本「12 个子代理」 |
| 数值自洽 | 回落分支按 `indexSubagentDescendants(list.byId).get(id).runningCount` 现算，与"当前确有 1 个运行中的子代理（本审计档）"一致 |
| 报错 | **0**（回落分支不报错，符合预期） |

### 2.6 子代理抽屉 / 成员切换

| 步骤 | 结果 |
|---|---|
| 点击头部「12 个子代理」chip | 展开 `ZKlsPq_menu` 面板（DOM 新增 110 个新类名节点），列出 **12 名子代理成员**：label（Audit Liuyuhang line / Audit Xiaoqi line / Audit Mazibo line / Web-verify Sun claims / …）+ 摘要（"… · 可继续 · 当前未运行"）+ token 用量（801K / 2.5M / 7.1M / 9.6M tok…）+ 耗时（2分48秒 / 18分47秒…）；截图 `audit-p6-01-subagent-panel.png` |
| 点击成员行（`ZKlsPq_clickarea` 第 1 条） | **成员切换成功**：面包屑变为「检查工作区相关内容 / Audit Liuyuhang line」，DOM 3110 → **1331** 节点（子代理会话视图渲染），`可返回父会话` 存在；截图 `audit-p7-01-member-switched.png` |
| 点回父会话行 | 回到父会话（DOM 2883 节点返回）→ 往复切换可用；截图 `audit-p7-02-back-to-parent.png` |
| 错误 | **0** |

### 2.7 模型选择

1. 点「选择模型，当前 deepseek-v4-pro」→ 一级菜单 `[role=menu]`（`aria-label="模型与推理等级"`）= 单元格「模型 deepseek-v4-pro ›」。
2. 点该单元格 → 二级菜单列出**全部模型并按 provider 分组**：`DeepSeek`（DeepSeek-V4-Flash / DeepSeek-V4-Pro / DeepSeek-V4-Flash-Vision-Exp）、`opencode-go`（MiniMax-M3 / Qwen3.7 Max / Qwen3.7 Plus / DeepSeek V4 Flash / DeepSeek V4 Pro / GLM-5.1 / GLM-5.2 / Hy3 / Kimi K2.6 / K2.7 Code / K3 / MiMo V2.5 …）、`adam`（deepseek-v4-flash / deepseek-v4-pro / glm-5.1 / glm-5.2 / claude-* / gpt-5.4 …）等（DOM 文本 30+ 项，菜单可滚动）；截图 `audit-p6-03-model-list.png`。
3. **未点任何模型**（属写状态）→ "切换生效"未验证。

---

## 3. 问题 3：回归排查（性能与本轮唯一确认的回归）

### 3.1 复测口径与可比性（先讲判读纪律）

本轮自跑：`cd .workspace/lag-fix && node probes/measure-after-C1.mjs --window 20 --out /tmp/gui-audit/measure-after-audit.json`（16:04，宿主同一 PID 20806）。

**关键可比性事实**：本轮 idle 窗口的 WS 帧总速率 **160.3 帧/s**，基线（DIAGNOSIS §1.2 / measure3.json）是 **73 帧/s** → 本轮负载是基线的 **2.2 倍**。另做一次按 `payload.type` 分类的 20s 窗口：`session/event` **203 帧/s**、`session/projection` 2.8 帧/s（合计 205.9 帧/s）——基线同口径是 `session/event` ≈ 65 帧/s，即本轮 **3.1 倍**。

> 附带纠正一处**方法学缺陷**（不是补丁问题，是历史报告的可比性标注）：`probes/measure-after-C1.mjs` 统计的是 WS **信封** `type`，实测 100% 为 `server-request`（键集 `method,payload,rpcId,type`），而基线报的 73 帧/s 是被分类后的帧数。两者"总帧数"量级可比，但**分类型对比不可比**。`reports/BEFORE-AFTER.md` 中"打补丁后 ws 135.2 比基线 73 更重"这一句因此只对"总帧数"成立，不能按类型解读。
> 另：该探针的 `session_list` 字段本轮返回 `bytes=680 / items=null`（页面内 `fetch('/api/session.list')` 拿不到隧道鉴权），**该字段不可用**；历史 after 报告里它同样是 680 B，真实值应用 `probes/session-list-shape.mjs`（本轮实测 **743 条 / 1,240,902 B**，顶层 88 + subagent 655；`runningSubagentCount` 0/88 → 服务端过滤与聚合字段均待重启）。

### 3.2 对照表（20s 窗口）

| 指标 | 基线（idle） | 本轮（idle，16:04） | Δ 原始 | 逐帧归一化（基线 1075 帧 → 本轮 1140 帧） |
|---|---|---|---|---|
| script ms/s | **121.4**（2428.1 ms/20s） | **62.8**（1256.9 ms/20s） | **−48.2%** | 2.259 → **1.102 ms/帧，−51.2%** |
| task ms/20s | 3087.1 | 2551.7 | −17.3% | 2.872 → **2.238 ms/帧，−22.1%** |
| recalc style ms/20s | 418.9 | **937.6** | **+123.8%** | 0.390 → **0.822 ms/帧，+110.9%** |
| 帧 p50 | 16.7 | **16.7** | 0 | — |
| 帧 p99 | 100.1 | **49.9** | −50.2% | — |
| >50ms 帧 | 22 | **10** | **−54.5%**（门槛"降 >50%" 达成） | — |
| 帧 max | 133.4 | 116.7 | −12.5% | — |
| 帧数/20s | 1075 | 1140 | +6.0% | — |
| dom_nodes_total | —（基线未记） | **584**（设置打开 755 / 面板 168） | — | 与历史 after 复测逐值相同（584/755） |
| ws 帧/s | 73 | **160.3** | **+119.6%（负载更重）** | 不可按类型比（见 3.1） |

设置窗口（本轮负载反而**低于**基线 73 帧/s）：

| 窗口 | 基线 script | 本轮 script | Δ | 逐帧 | 本轮 ws |
|---|---|---|---|---|---|
| 设置打开 | 2550.5 ms（127.5 ms/s） | 886.9 ms（**44.3 ms/s**） | −65.2% | 2.413 → 0.772 ms/帧（−68%） | 25.0 |
| 设置停留 | 3795.4 ms（189.8 ms/s） | 1015.5 ms（**50.8 ms/s**） | −73.2% | 3.893 → 0.897 ms/帧（−77%） | 16.3 |
| 设置打开·帧 p99 | 116.6 | **50.0** | −57.1% | — | — |
| 设置打开·>50ms | 26 | **8** | −69.2% | — | — |
| 设置停留·>50ms | 40 | **14** | −65.0% | — | — |

### 3.3 判读与结论

1. **补丁收益方向成立，且本轮是"更重负载下仍更好"**：idle 负载 2.2–2.8×、`session/event` 3.1×，script 仍 −48%（逐帧 −51%），p99 由 100.1→49.9 ms，>50ms 卡顿帧 22→10（−55%，达门槛）。
2. **BEFORE-AFTER.md 宣称的「27.5 ms/s（−77%）」本轮未复现**：本轮同探针同参数得 62.8 ms/s。历史 after 序列为 C1-v2(ws 92.5) 45.0 → N734 安静(ws 5.3) 16.4 → N734 活跃(ws 135.2) 27.5；本轮 ws 160.3 得 62.8。即在"ws 135→160（+19%）"区间内 script 由 27.5 → 62.8（+128%），**负载对数值的影响远超补丁本身**，因此"−77%"是特定负载下的点值，不能作为可复现口径引用。
3. **`recalc_style` 是唯一反向指标**（+124% 原始 / +111% 逐帧）。但设置窗口（负载仅为基线 0.34×）的逐帧 style 只 +7%~+34%，且历史 after 复测 idle 逐帧 style 为 0.379（≈基线 0.390，持平）——三条事实合起来指向"**style 随事件/失效频率上升**"的负载效应，而非补丁引入的渲染回归。P1/P2/B1/C2 的改动方向都是**减少**重渲染（引用稳定化 + 快照记忆化），与"style 上升"的机制不符。
4. **判定**：**未发现补丁引入的性能回归**；但 idle 窗口的 style 数值需要在**宿主重启后、GUI 静默时**做一次受控复测才能定论（见 §5）。

---

## 4. 问题 4：可见功能缺失逐项核对

| 功能 | 验证方式（实际做法） | 结论 |
|---|---|---|
| 会话侧栏 | 首页 DOM：`.sg_sidebar`/工作区树 11 组 + 逐组展开得 15 条会话行 + 点击行打开会话（584→3056 节点） | ✅ 正常 |
| 设置面板 | 点「设置」→ 默认标签「通用设置」；8 标签逐个点击，8/8 渲染、0 报错 | ✅ 正常 |
| 模型选择 | 点模型 chip → 一级菜单 → 二级菜单列出 DeepSeek/opencode-go/adam 等 30+ 模型；截图留证 | ✅ 正常（"切换生效"未验证，属写状态） |
| 子代理列表 / 抽屉 | 点「12 个子代理」→ `ZKlsPq_menu` 列出 12 名成员（label/摘要/token/耗时）；点成员切换视图（含面包屑与返回） | ✅ 正常 |
| 用量卡片 | 「设置 → 插件」→ `du_root` 渲染，7 个指标 + 趋势 + 热力图 + 按模型表；小时粒度回落提示符合预期 | ✅ 正常（**但下拉项有重复，见 §6.1**） |
| 远程工作区标签 | 「设置 → 远程工作区」渲染机器管理表单（无机器态）；「分布式控制 · dsh-ssh-gui」渲染节点列表（0）+ 新建节点表单 | ✅ 正常 |

---

## 5. 问题 5：未验证项（明确列出）

1. **"新建会话后列表新增一行"**：未验证。点「新会话」只切换到"临时空行"，不新增列表项（代码注释确认是设计）；要产生真实新行必须发一条消息，属写状态，按纪律未做。
2. **模型切换生效**：二级菜单已列出全部模型，但**未选择**任何模型（写状态），"选择后模型真变、持久化正确"未验证。
3. **用量卡片的正确性/新鲜度**：只验证"能渲染、有数、无报错"。数字正确性依赖宿主半（`db.js` 走 `usage_daily`）重启后才生效，本次**未做数值等价性复算**（属 A 档交付，另外的探针覆盖）。
4. **服务端字段 `runningSubagentCount`**：本轮 0/88（待重启），因此**只验证了客户端回落分支**，"服务端字段到位后客户端优先采用服务端值"这一分支未验证。
5. **`session.list` 服务端过滤/聚合**：743 条 / 1.24 MB / 无 `runningSubagentCount` → 服务端补丁待重启；A1/A2/A6/A7 仍 FAIL（预期内，不构成回归）。
6. **P1/P2 的微观收益（`buildListSnapshot` 单次耗时）**：未做微基准复算（历史 micro 数据 5.66 ms → 0.09 ms 未独立复现）；本轮只有宏观指标。
7. **静默态性能基线**：本轮 GUI 全程有活跃会话事件流（ws 160–206 帧/s），**无法**在 73 帧/s 条件下取得严格同口径的 idle 复测；`recalc_style` 反向项的定论需要该条件。
8. **HMR 热替换的端到端推送**（改文件→500ms 内 SSE `rebuilt`→浏览器原地换）：未验证，因为**不允许改任何文件**；只验证了"GET 回源读盘"与"rev == 磁盘 sha1-12"这两个等价保障。
9. **"应用/保存/删除"类按钮的写入行为**：按纪律全部未点（含壁纸"应用"、provider"删除"、用量"手动刷新"也未点以避免触发宿主 SQLite 阻塞）。

---

## 6. 发现的问题清单

### 6.1 【回归·已确认·低危但用户可见】`@local/dsh-usage` 刷新周期下拉出现重复项

**现象**：用量卡片工具栏的刷新周期下拉，运行时 DOM 实测为 **5 个选项、其中「60s 刷新」重复**：

```json
{ "cls": "du_select", "value": "60",
  "options": ["0:不轮询", "5:5s 刷新", "60:60s 刷新", "30:30s 刷新", "60:60s 刷新"] }
```
（`/tmp/gui-audit/probe3.json` → `usageSelect.selects[2]`；同一文本亦出现在无头冒烟的插件标签面板文本中）

**根因（补丁源锚点实据）**：`patches/usage-plugin.replacements.txt` 的 `@@JOB client-poll` 第 4 组替换为"**前插**"而非"替换"：

```
@@OLD      react.createElement("option", { value: "30" }, "30s 刷新"),
@@NEW      react.createElement("option", { value: "60" }, "60s 刷新"),
           react.createElement("option", { value: "30" }, "30s 刷新"),
```
原文件本就是 `不轮询 / 5s / 30s / 60s`，前插后变成 `不轮询 / 5s / 60s / 30s / 60s`。**补丁真实目标（轮询默认 30s→60s）已经通过 `useState(60)` 正确达成**，这行前插是多余动作。附带损坏了下移一行的缩进（`client.js:1121` 比同级少一个 tab）。

**影响**：纯 UI 冗余——两个 `value="60"` 选项，`<select value="60">` 只命中**第一个**，第二个选中后显示回落、无实际效果；轮询行为与功能不受影响，无报错。
**修复建议（一行）**：删掉 `@local/dsh-usage/lib/client.js:1120` 的 `react.createElement("option", { value: "60" }, "60s 刷新"),`（并恢复 1121 行缩进），同时在替换脚本里把该组改成真正的 `OLD→NEW` 替换，避免重放再生。

### 6.2 【观察·未证实可见效应】P2 的 `byId` 前向携带可能留下陈旧行走廊

`client.js:9325-9328`：当 `ids` 与上一投影相同（`copiedPrevious`）时，把上一投影 `byId` 中"新 byId 里没有的行"（注释说明是地址链子行）**携带进新 byId**。原实现会丢弃这类行。

- 风险面：`ui-workspace:194/224/253` 用 `indexSubagentDescendants(list.byId)`、`list.ids.map(id => list.byId[id])`（按 ids 取值，不受影响）。因此唯一可能受影响的是"子代理后代索引"——理论上可能把已离开地址链的子代理仍算作某父会话的后代，进而让「N 个子代理运行中」回落值偏大。
- 本轮**未观察到**该效应（回落值与"确有 1 个运行中子代理"一致）；且 `ids` 未变时才生效，属窄窗口。
- 建议：列为待观察项；若后续出现"子代理徽标不消失"，优先看这段。

### 6.3 【历史报告勘误建议】两处可比性/口径问题（非补丁缺陷）

1. `reports/BEFORE-AFTER.md` 把 `ws_rate_per_s`（信封 `server-request` 帧）与基线 73 帧/s 直接对比并称"更重"——总帧数可比，但分类型不可比；建议在报告中标注口径（§3.1 已给实测分类数据）。
2. `probes/measure-after-C1.mjs` 的 `session_list` 字段恒为 `bytes=680 / items=null`，不可用于规模判读（真实值请用 `probes/session-list-shape.mjs`）；建议在探针里加断言，避免再次被引用为 2361 条的对照值。

---

## 7. 证据文件清单

**截图（`/home/CNS2026495165/dsh/.workspace/lag-fix/reports/`，本轮新增 25 张）**

| 文件 | 内容 |
|---|---|
| `audit-01-homepage.png` | 首页渲染（侧栏 + 工作区树 + 「1 个子代理运行中」行徽标） |
| `audit-02-settings-default.png` | 设置面板默认标签「通用设置」 |
| `audit-03-usage-card.png` | 用量卡片完整渲染（7 指标 + 趋势 + 刷新选择器显示 `60s 刷新`） |
| `audit-p2-01-session-open.png` / `audit-p2-02-switch-back.png` | 打开会话 / 切回 |
| `audit-p3-03-all-groups.png` | 11 个工作区全展开（15 条会话行） |
| `audit-p5-03-subagent-chip.png` / `audit-p6-01-subagent-panel.png` | 子代理 chip 与 12 名成员列表 |
| `audit-p6-03-model-list.png` | 模型二级菜单（按 provider 分组的全部模型） |
| `audit-p7-01-member-switched.png` / `audit-p7-02-back-to-parent.png` | 成员切换 / 返回父会话 |
| `audit-p6-04-details.png` | 会话消息流 + 详情面板 |
| 其余 `audit-p2/p3/p5-*` | 各阶段中间态 |

**机器可读证据（已随报告落盘：`reports/audit-cross-client-*.{json,diff,txt}`）**

- `measure-after-audit.json`：本轮 idle/设置打开/设置停留三窗口原始指标
- `smoke-audit.json`：首页 + 8 标签 + 用量卡片 + 会话操作 + 错误列表
- `probe2.json` / `probe3.json` / `probe5.json` / `probe6.json` / `probe7.json`：列表刷新、下拉项、全展开、子代理面板、成员切换、模型菜单
- `session-list-now.json`：`POST /api/session.list` 原始响应（743 条 / 1,240,902 B）
- `served-*.js` 与 `runtime.diff` / `usage.diff` / `usage-db.diff`：服务字节、与交付/预镜像的逐行差异

---

## 8. 总裁决

- **问题 1（rev/字节）**：✅ 4/4 确认生效，且与交付副本逐字节相同。
- **问题 2（功能冒烟）**：✅ 通过；设置 8 标签、会话列表/切换/页内刷新、子代理面板与成员切换、模型菜单、用量卡片全部可用；全程 0 错误。
- **问题 3（回归）**：⚠️ 性能无回归（更重负载下 script −48%、p99 −50%、>50ms 帧 −55%），但历史"−77%"口径不可复现；**存在 1 处确证的客户端回归**（usage 刷新下拉重复「60s 刷新」，纯 UI 冗余，一行可修）。
- **问题 4（功能缺失）**：✅ 6/6 功能存在，无缺失。
- **问题 5（未验证）**：见 §5（9 项），主因是"不得写状态"与"宿主半待重启"。
- **最该修的一项**：`@local/dsh-usage/lib/client.js:1120` 的重复 `60s 刷新` 选项（删除该行 + 修正替换脚本为真替换 + 顺手恢复缩进）。
