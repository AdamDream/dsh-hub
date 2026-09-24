# exec-docs 报告 —— 文档面修订执行复核一体档（D1–D8）

- 档别：**修订执行复核一体（文档面；可写 + 同档自复核）**
- 工作目录：`/home/CNS2026495165/dsh`（DSH 插件 monorepo）
- 时点：2026-09-23（本机）
- 边界：继承沙箱 `workspace-write`，**未**使用 `sandbox_permissions`；**未**改 `dsh-btw/**`（源码/测试/lib 一律只读）、`.gitignore`、`~/.dsh/**`、其它 `.workspace/**`；**未**执行任何 `git add/commit/push`；**未**重启 dsh。
- 主契约：`.workspace/btw-question/verify-report-a.md`（被审汇报句逐条核查 + §「应修订的文档清单」9 条）
- **自裁决：通过**

---

## 0. 一句话结论

D1–D8 **全部落地**。核心动作是：把 notebook §7 的 D30 行从「后果未实测 + 与代码相反的推断」重写为**真机实测后果 + 精度修正 + 已修（宿主侧待重启生效）**；新增 D31（answer 语义校验登记）与 D32（R10 仓体积欠账）；§8 新增第 12 条并把第 11 条按现状改写（不预写补测结论）；verify-runbook 修掉那条**与源码冲突**的绿色判据并新增两条可判别判据；arch05/FEATURE-MAP 同步工件指纹与生效面。自复核：**禁用措辞 0 命中**、**所有引用路径实测存在**、**所有数字可追到事实源**。

---

## 1. 逐单元状态

| 单元 | 状态 | 落点（行号为**改后**文件行号） |
| --- | --- | --- |
| **D1** notebook §7 D30 行整体重写 | ✅ 落地 | `docs/program-notebook.md:279`（机制 + 精度修正 + 实测后果 + 修法 + 状态列 + 证据列 + 路径统一为 `dsh-btw/src/...`） |
| **D2** notebook §8 新增第 12 条 + 第 11 条改写 | ✅ 落地 | `docs/program-notebook.md:298`（新增 12）、`:297`（第 11 条改写） |
| **D3** notebook §7 新增 D31 行 | ✅ 落地 | `docs/program-notebook.md:280` |
| **D4** notebook D3 行更新 + 新增 D32 行 | ✅ 落地 | `docs/program-notebook.md:251`（D3）、`:252`（D32） |
| **D5** verify-runbook `:19-30` 判据修正 + 新增两条判据 | ✅ 落地 | `docs/runbooks/verify-runbook.md:28`（P1 冲突判据修正）、`:35-37`（判据 9）、`:38-40`（判据 10）、`:13`（节标题口径） |
| **D6** `.workspace/btw-question/` 三处修正 | ✅ 落地（+1 处同因连带，见 §3.2） | `exec-report.md:291`、`:295`；`INDEX.md:20`、`:29`（+ 新增 `:31` "D30 收口"节）；`xaudit-docs.md:65-70`（O6 重写） |
| **D7** arch05 增补 D30 行 + FEATURE-MAP 同步 | ✅ 落地 | `05-performance-and-ux-program.md:83`（§3 新行）、`:160`（§7 地图行改双面）、`:181`（§8 新增第 8 条）、`:68`（§3 标题计数口径）；`FEATURE-MAP.md:25` |
| **D8** 一致性自检 + §6 索引补行 | ✅ 落地 | `docs/program-notebook.md:237-239`（§6 新增 3 行）、`:251-252,279-280,297-298` 路径统一；禁用措辞 grep 见 §5.1 |

**明确未做（越界/无授权）**：`dsh-btw/**` 任何文件、`.gitignore`、`.workspace/btw-question/{verify-report-a,d30-consequence,push-plan,audit-*,plan,xaudit-code}.md`、`.workspace/btw-question/{d30,e2e,harness,preimage-*}/`、其它 `.workspace/**`、任何 git 命令的写操作、任何进程重启。

---

## 2. 逐文件 diff 摘要（含行号）

`git diff --stat`（tracked 目标）：
```
 FEATURE-MAP.md                  |  2 +-
 docs/program-notebook.md        | 68 +++++++++++++++++++++++++++++++++++------
 docs/runbooks/verify-runbook.md | 24 ++++++++++++++-
 3 files changed, 83 insertions(+), 11 deletions(-)
```
> ⚠️ 上表含**本档开工前**该三文件的既有未提交改动（D29/性能批次）。本档自身的改动按下面的逐条锚点计。另外 4 个目标文件在本仓库**未被 git 跟踪**（`docs/architecture/05-performance-and-ux-program.md`、`.workspace/btw-question/{INDEX,exec-report,xaudit-docs}.md`），故无 `git diff` 基线，行号均为当前文件实测行号。

### 2.1 `docs/program-notebook.md`（314 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:237` | 新增行 | §6 索引：`.workspace/btw-question/d30-consequence.md` = D30 后果实证单一事实源 |
| `:238` | 新增行 | §6 索引：`.workspace/btw-question/exec-d30/report.md` = D30 修法落地报告 |
| `:239` | 新增行 | §6 索引：`.workspace/btw-question/push-plan.md` = 推送就绪审计（T1/T2 + R1–R12） |
| `:251` | 整行重写 | **D3**：补 2026-09-23 T1 `.gitignore` 增补已落地（6 类 + 依据数字），D3 本体仍未处理（2 + 447 文件仍被跟踪）；证据列补 `.gitignore:72-94` 与两条 `git ls-files` 计数 |
| `:252` | **新增行** | **D32**（R10）：HEAD 4 个 >10 MB 跟踪 blob（最大 `mgr.tgz` 51.1 MB）、`.gitignore:16` 只指向重构后新路径 ⇒ 与 D3 同型欠账，状态「未修」 |
| `:279` | 整行重写 | **D30**：机制 + **精度修正**（选项项曾被静默 strip、爆点只在题目项层；DSL 无 minLength/minItems）+ **真机实测后果**（27 次/45 s、中位 1.475 s、冻结、唯一出路是停止、收起重开无效）+ **修法 3 条** + 客户端加固 + 状态列「已修（源码+构建+部署就位）；宿主侧 ⇒ 待重启生效」+ 证据列 + 路径统一 `dsh-btw/src/...` |
| `:280` | **新增行** | **D31**：`answer` 方向缺 `matchesQuestions` 那类语义校验（官方 `:1379-1393` 对照），状态「未修（登记；对 D30 无因果）」 |
| `:297` | 整行改写 | **§8 第 11 条**：保留「已真机验收 55/55」+ 新增**口径限定**（该轮 E2E 写死单选）+ 原 4 项「仍未覆盖」措辞暂不动 + 标明【另有档正在补测、结果回来后须再更新——现记现状、不预写结论】 |
| `:298` | **新增行** | **§8 第 12 条**：D30 残留与未知（后果已实测、键类+值维度已覆盖、3 项仍未知） |

### 2.2 `docs/runbooks/verify-runbook.md`（63 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:13` | 改写 | 节标题：「原 8 步 + 第 9/10 条判据：读失败可见性 / D30 参数不一致」 |
| `:28` | 改写（P1） | 删掉与 `side-chat.module.css:365` 冲突的「选项行**不再有硬编码绿 `#b7e85b`**（其它 **23 处**仍在用）」；改为「选项行**交互面（底/边/文字）**无硬编码绿；**选中序号徽标为 btw 绿实心＝U8 有意（见判据③）**；该色另有 **22 处**非选项行用法；实测 `grep -c` = **24 行**（扣注释 `:228`、选项行徽标 `:365`）」 |
| `:35-37` | **新增（判据 9）** | 读失败可见性（标注「**已上线可即时验**」）：连续失败 ≥3 次出现「实时更新已暂停，正在重试」、成功读后自动消失；4 条可判别口径（1–2 次须静默 / `phase` 仍 `open` / 不与 `drawer.error` 叠加 / 恢复后消失）+ 旧包反面判据 |
| `:38-40` | **新增（判据 10）** | 标注「**[待重启后可验]**」：模型多带未声明键调用 `btw_ask_user` 应得**工具报错**而非抽屉冻结；给出可复现的构造说法（谎称前端埋点契约、固定话术）；4 条可判别口径 + 反面判据（冻结/无卡片/唯一出路是按停止/收起重开无效） |

### 2.3 `docs/architecture/05-performance-and-ux-program.md`（191 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:68` | 改写 | §3 标题：「其余线上改动（含 btw 批与 D30；原标"12 项"的计数已不再维护）」——原「12 项」与实测 15 行不符，改为不维护计数 |
| `:83` | **新增行** | §3 表格新增 **btw D30 修复（fail-closed）** 行：落点、实测后果（27/45 s/1.475 s）、精度修正、客户端加固、**两条面分开记的指纹**（热面已生效 / 宿主待重启）、测试计数、回滚钩子、证据路径 |
| `:160` | 整行重写 | §7 落地与回滚地图的 btw 行：拆成①客户端面（热面，`66beb345…`/365 269 B/`?rev=887a12106dcd`，**已生效**）②宿主面（冷面，`e1437b3b…`/67 542 B，**已部署未生效**）；回滚方式补 **D30 前 pre-image 整目录回滚**命令 |
| `:181` | **新增条目** | §8 新增第 8 条：宿主面修法尚未生效 + 3 项未验证（自然发生率 / `confirmRestore` 形态 / 官方路径 fault injection） |

### 2.4 `FEATURE-MAP.md`（95 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:25` | 改写（状态列 + 说明列） | 状态列补「09-23 D30 修复（读失败可见化已热生效；宿主面已部署 **待重启生效**，served `66beb345…` / `?rev=887a12106dcd`）」；说明列测试计数改 **25 files / 260 passed / 2 skipped (262)**、現服务 md5 改 `66beb345…`、新增 D30 段落（后果 + 修法 + 两条面生效状态 + 证据链接风格保持既有 `·` 分隔）。表格格式与链接风格未变（`grep` 校验见 §5.2） |

### 2.5 `.workspace/btw-question/INDEX.md`（66 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:20` | 前缀 + 尾补 | 行首加「（**当时状态快照**，终态见下方「终态」节）」；行尾补**逐条终态对照**（runbook `:57` 现为 `88de97e6…`、18:23 后为 `66beb345…`；notebook §8 第 11 条现为「已真机验收 + 4 项未覆盖」） |
| `:27` | 尾补 | 「文档同步」行补后续 D30 批次的文档同步清单（指向本报告） |
| `:29` | 改写（修订清单第 1 条） | 未覆盖项改「四项登记 **notebook §8 第 11 条**；**D30 的实际后果**（登记在 **notebook §7 的 D30 行状态列**，§8 无该条）」 |
| `:31-38` | **新增节** | 新增「D30 收口（2026-09-23 18:05–18:29）」节：修法、客户端加固、测试计数、两份产物指纹与生效面、回滚钩子（标注**不入库**）、证据路径 |

### 2.6 `.workspace/btw-question/exec-report.md`（298 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:291` | 改写（时效修正） | §8 第 1 条改为「**【已由后续运行补齐】**」并给出两产物数字：`…04-02-20-233Z-after.json` = `PERSISTED` / **56/56** / `firstOnMs=167`；`…08-03-24-466Z-final.json` = `PERSISTED` / **55/55** / `firstOnMs=185`（两产物 `pageErrors=[]`） |
| `:295` | 改写（连带，见 §3.2） | §8 第 5 条「D30 的可观察后果未实测」改为「**【已由后续实测补上】**」并指到 `d30-consequence.md` / `exec-d30/report.md` |

### 2.7 `.workspace/btw-question/xaudit-docs.md`（162 行）

| 位置 | 类型 | 摘要 |
| --- | --- | --- |
| `:65-70` | 整节重写（O6） | 标题加「**【计数已更正；实质结论已被 U8 推翻，2026-09-23】**」；计数改为「现 **24 行**命中；扣 1 注释（`:228`）+ 1 选项行徽标（`:365`）= **22 处**；**审阅当时（U8 之前）非注释 23、选项行 0**」；注明 `:365` 为 U8 有意新增 ⇒「选项行无绿」仅在 U8 之前成立，**凡引用 O6 的下游改稿须重写口径**；建议措辞改为「选项行交互面无绿；选中徽标（U8 有意）与外壳/品牌元素按裁决保留」 |

---

## 3. 与审计建议不一致之处及理由（必须逐条给理由）

### 3.1 D4：R10 写入**新增 D32 行**而非并入 D3 行 —— 采用了「新增行」

**理由（按该表体例）**：notebook §7 的粒度是**一条缺陷/欠账一行**，且每行有**独立的状态列**。D3 与 R10 虽然根因同型（.gitignore 路径漂移/覆盖不全），但**状态不同、处置批次不同**：
- D3 = 「路径没被忽略，且**文件仍被跟踪**」⇒ 处置需 `git rm -r --cached` + 独立验收（本批不处理）；
- D32 = 「路径**已经**改指新路径，但**旧路径的已跟踪对象仍留在 HEAD**」⇒ 工作树已净、欠账纯在历史，处置选项含 `filter-repo` 重写历史（破坏协作者 clone，须用户授权）。
把两者塞进同一行会让**状态列无法同时为真**（一个"T1 已落地/本体欠账"、一个"纯历史欠账、不阻断推送"）。另：审计原文（`push-plan.md` R5）也明确建议把 D3 与 R10 **合并成"一次批次"**——那是**执行批次**的合并，不是**登记粒度**的合并；登记粒度按行分列恰好支撑"合并成一批次"的执行建议（两条都指向同一批次）。故：**新增 D32 行**，并在 D3 行的证据列交叉引用 R5/R7。

### 3.2 D6：`exec-report.md` 多改了 1 处（`:295`）—— 超出 D6 明确列出的「`:291` 时效修正」

**理由**：`:295` 即 §8 第 5 条「**D30 的可观察后果未实测**（机制已读源确证）」。它与 D1 直接矛盾（D30 后果**已实测**），且 D6 的单元名是「`.workspace/btw-question/` 三处修正」+ 要求「不得留下与实测相反的措辞」。若只改 `:291`，同一文件的 §8 里会同时存在「已由后续补齐」与「D30 后果未实测」两句互斥声明，正是 verify-report-a 给 `:291` 定级（P2 时效漂移/自相矛盾）的同型缺陷。⇒ 按"同一失效模式在允许文件内一并闭掉"处理，并在此如实登记。**该处未改变任何原意的强度**：仍保留"本档当时未实测"的事实，只补"收口后已由实测档补上"。

### 3.3 D8/runbook：`verify-runbook.md:57` 的 md5 核对值**已过期**，但**未改**

**事实**：`verify-runbook.md:57` 现写「**应为** `88de97e6c22fc6de9ebd61cb27e5779f`（363 814 B，`?rev=3980d1322992`）」，而 18:23 起线上 served 已是 `66beb3455c59f4991355f3918228e495` / 365 269 B / `?rev=887a12106dcd`（本档亲测，见 §5.4）。按该行判据执行，会把**正确的当前部署判成"修复前的旧包"**并触发一次不必要的落盘 —— 与 verify-report-a 给 `:28` 判据定级（P1：按此判据验收会把正确部署判成失败）**完全同型**。

**为什么没改**：派单对 D5 的明确范围是「`:19-30` 与 §5 相关段」，而 `:57` 属 §3「故障排查」；且硬边界要求"不要夹带私货"，越界改动会破坏单一写入者约定。**⇒ 本档只登记、不改**，建议主代理单独裁决（一处改动即可，内容为把"应为"的 md5/体积/rev 更新为 `66beb345…` / 365 269 B / `?rev=887a12106dcd`，并保留 `88de97e6…` 作为"问答卡片终版、D30 前"的回溯档）。

### 3.4 D7/arch05：§3 标题「其余 **12** 项线上改动」与实测 **15** 行不符

原表标题写 12 项，但表格实测 15 行（本档新增第 16 行后为 16 行）。本档**不臆造计数**，改为「其余线上改动（含 btw 批与 D30；原标"12 项"的计数已不再维护）」，避免写出一个无法追源的数字。

### 3.5 INDEX.md：`INDEX.md:14` 的同型历史快照**未标注**（越出 D6 三处）

`:14` 写「**代码/构建/测试完成；部署被沙箱边界挡住，待用户执行**」，与 `:23`「终版产物………已部署」直接冲突（verify-report-a 已把它列为"观察（非缺陷）"）。派单 D6 只点名 `:20` 与 `:29`，故**未改**；若主代理要求彻底闭掉该文件的时效漂移，`INDEX.md:14` 应同样加「（当时状态快照，终态见下方「终态」节）」前缀（一处即可）。

---

## 4. 数字 → 事实源对照表

> 口径：`★` = 本档亲自执行命令/读文件实测；`◆` = 直接取自指定事实源原文。所有数字**至少有一个来源**，无一处是外推或估算。

| 数字（本档写入的） | 写入位置 | 来源（★ 亲测 / ◆ 事实源） |
| --- | --- | --- |
| 27 次失败读 / 45 s 观测窗；`questionCard=false` | notebook `:279`、arch05 `:83` | ◆ `d30-consequence.md:161`（probe3 `readFailed=27`、`poisonedReads=27`、`card=false`）；`d30-consequence.md:219` |
| warn 间隔中位 **1.475 s**（min 1.203 / max 3.132） | 同上 | ◆ `d30-consequence.md:169`（27 条时间戳 min/中位/max 逐字） |
| 按下停止后 **14 s** 内零失败读、DOM 回 `running:false` | 同上 | ◆ `d30-consequence.md:182`（"其后 **14 s** 静默"）；`:181`（`4-after-stop: stop=false textareaDisabled=false`） |
| `id:''`/`question:''`/`options[].label:''`/`questions:[]` 四类值维度 | notebook `:279`、`:298`、arch05 `:83` | ◆ `d30-consequence.md:270-277`（`exp6-output.txt` 6c 逐条 tool PASS → codec FAIL） |
| 选项项多余键曾被**静默 strip**、爆点只在题目项层 | notebook `:279`、arch05 `:83` | ◆ `d30-consequence.md:79-85`（`:79` 只有最外层 strict）。★ 旁证：`dsh-btw/src/shared/remote.ts:141-148` 现为内层 `.strict()`（本档实读，见 §5.3） |
| 旧 catch 行号 `:741-746` → 现 `:774-787`（`:775` warn、`:781-784` publish、`:786` `1_200`） | notebook `:279` | ★ `grep -n "console.warn\|delay = \|1_200"` + `awk 'NR>=766 && NR<=792'`（见 §5.3） |
| 客户端阈值 **3**（`READ_FAILURE_NOTICE_AT`） | notebook `:279`、arch05 `:83`、runbook `:35` | ★ `dsh-btw/src/client/controller.ts:73`（grep 实测）；◆ `exec-d30/report.md:147` |
| locale 文案「实时更新已暂停，正在重试」 | notebook `:279`、runbook `:35`、arch05 `:83` | ★ `dsh-btw/src/client/locales.ts:78`（本档实读）；en `:38` |
| 提示 `role="status"` + `title` 带底层原因 + `phase !== 'error'` 守卫 | runbook `:35` | ★ `dsh-btw/src/client/SideChatSurface.tsx:515-519`（本档实读） |
| 宿主进程启动 **10:09:52**；部署位 mtime **18:23:20** | notebook `:279`、arch05 `:83`、`:160` | ★ `ps -eo pid,lstart,cmd`（pid 2649213 = 三 9月 23 10:09:52）+ `stat -c %y`（2026-09-23 18:23:20） |
| `client.js` = `66beb3455c59f4991355f3918228e495` / **365 269 B** / `?rev=887a12106dcd`；**served == 部署位 == 仓库** | notebook `:279`、arch05 `:83`、`:160`、FEATURE-MAP `:25` | ★ `md5sum`/`stat`（仓库与部署位）+ `curl`（`http=200`、`size=365269`、boot HTML `?rev=887a12106dcd`、`sha1sum\|cut -c1-12`）— 见 §5.4 |
| `index.js` = `e1437b3ba7de953811e65c47d5b392e5` / **67 542 B** | notebook `:279`、arch05 `:83`、`:160`、FEATURE-MAP `:25` | ★ `md5sum`/`stat`（仓库与部署位同值） |
| 上一版 `88de97e6c22fc6de9ebd61cb27e5779f` / 363 814 B、`6ae7bfcf42fe49763a192c54c5f87c02` / 65 970 B | notebook `:279`、arch05 `:83`、`:160`、INDEX `:20`、`:38` | ★ pre-image 目录实测（`preimage-lib-20260923-182907-pre-D30/client.js` md5 `88de97e6…`、`index.js` md5 `6ae7bfcf…`，`stat` 363 814 / 65 970）+ ◆ `exec-d30/report.md:312-313` |
| 测试 **25 files / 260 passed / 2 skipped (262)**；新增 10 例（宿主 7 + 客户端 3） | notebook `:279`（新增 7/2/1 拆分）、arch05 `:83`、INDEX `:36`、FEATURE-MAP `:25` | ★ 行范围实测：`host-opening.spec.ts:490-614`（`:490` describe、`:614` 收尾）、`controller.spec.ts:805-893`（`:805` describe、`:893` 收尾）、`side-chat-surface.spec.tsx:893-913`（`:893` 用例、`:913` 收尾）；◆ 计数与绿灯取自 `exec-d30/report.md:354-362`（**本档未复跑 vitest**，见 §6.1） |
| `answer` 官方语义校验在 `@deepseek-ai/dsh-api-gateway/lib/index.js:1379-1393` | notebook `:280` | ★ `grep -n matchesQuestions …` → `:1379` 定义、`:3895` 使用点；◆ `d30-consequence.md:335,337` |
| btw `answer` 唯一校验是 `questionId` 匹配（`:1162-1164`） | notebook `:280` | ◆ `d30-consequence.md:337`；`d30-consequence.md:420` §F.4(b) |
| `mgr.tgz` **51.1 MB**（实体 **53 561 751 B**）+ 另 3 个 >10 MB blob（37.3 / 24.9 / 18.6 MB） | notebook `:252` | ★ `git rev-list HEAD --objects \| git cat-file --batch-check=… \| awk '$3>10485760'` → 逐条 51.1 / 37.3 / 24.9 / 18.6 MB；★ `ls -la` 实体 53 561 751 B |
| `.gitignore:16` 指向新路径且命中 `mgr.tgz` | notebook `:252` | ★ `git check-ignore -v` → `.gitignore:16:…tmp-ppt-research/`；★ `git ls-files \| grep mgr.tgz` = 0；★ `.workspace/tmp-ppt-research` 不存在 |
| D3：`deploy-slots/` = 10（其中 `backup-20260915-162522/` **2 文件**）、`deploy-015/` = **447** | notebook `:251` | ★ `git ls-files \| grep -c 'deploy-slots/'` = 10、`grep -c 'deploy-015/'` = 447（另逐行列出 `backup-20260915-162522/` 两条） |
| T1 依据「未跟踪 **13 808** 文件 / **5 599.9** MiB；`git add -A` 会入库 **3** 个真实密钥」 | notebook `:251` | ◆ `push-plan.md` R7（`:866`）；★ `.gitignore:73-74` 已落盘同表述 |
| `.pnpm-store/` 553 文件 / 18.93 MB；`*.zstd` 8 512 个 / 4.7 GiB；`projcache` 单份 11.5 MB | notebook `:251` | ◆ `push-plan.md:199-213`（T1 逐行理由）；★ `.gitignore:80-89` 已落盘同表述 |
| `.gitignore` T1 段落在 `:72-94` | notebook `:251` | ★ `grep -n` 实测（`:72` 段首注释、`:94` `.workspace/btw-question/preimage-*/`） |
| b7e85b：`grep -c` = **24 行**；注释 `:228`、选项行徽标 `:365` ⇒ 非选项行 **22 处** | runbook `:28`、xaudit-docs `:65-70` | ★ `grep -n b7e85b dsh-btw/src/client/side-chat.module.css`（24 行，含 `:228`、`:365`、`:334/336/340` 等）+ `grep -c` = 24 |
| 「审阅当时（U8 之前）非注释 23 行、选项行 0 处」 | xaudit-docs `:65-70` | ◆ verify-report-a `:92`（P1 行：「非选项行的真实用法 = **22 处**」，并给出 `:228` 注释、`:365` 选项行徽标）；xaudit-docs 原文自述「选项行确实已无绿」（U8 之前） |
| e2e `…04-02-20-233Z-after.json` = 56/56 / `firstOnMs=167`；`…08-03-24-466Z-final.json` = 55/55 / `firstOnMs=185`，两者 `pageErrors=[]` | exec-report `:291` | ★ python3 逐字段读两 JSON（`verdict=PERSISTED`、`onSampleRatio`、`firstOnMs`、`firstOffMs=None`、`pageErrors=[]`）；◆ verify-report-a `:66` |
| e2e 提问串写死「单选（single select）」`repro-btw-question.mjs:48`；view 口 `1440×900` `:79`；`optionsAtStart` `role=radio`×2 | notebook `:297` | ★ 两 JSON 的 `optionsAtStart` = 2 items / roles `['radio','radio']`（实读）；◆ verify-report-a `:14`、`:51`（`:48`、`:79` 原文） |
| 官方参数 schema 同宽（题目项/选项项 `additionalProperties: true`）、下游 UI 无 `.strict()` 命中 | notebook `:298` | ◆ `d30-consequence.md:296`（§5 第 4 条未实测项，逐字给出官方包 `:24,45` 与「全树无 `.strict()` 命中」） |
| `mgr.tgz` 已接近 GitHub **50 MB** 告警线、未达 **100 MB** 硬上限 | notebook `:252` | ◆ `push-plan.md:869`（R10 逐字） |
| HEAD 树 **370.6 MiB / 5 955 文件** | notebook `:252` | ★ `git ls-files \| wc -l` = **5 955**；◆ `push-plan.md:869`（370.6 MiB） |

**本档写入的数字中，没有来源的三类"非数字断言"（不作数、仅措辞）**：①「唯一出路是按停止」——◆ `d30-consequence.md:239-243`（含 code 依据）；②「收起重开无效」——◆ 同文件 `:243`（真机 probe4）；③「宿主抛 `result-invalid` 并被泛化成 `internal`」——◆ 同文件 `:16`、`:102-103`。

---

## 5. 自复核（对照 D1–D8 逐条 + 指定 grep）

### 5.1 指定 grep ①：notebook 里已无与实测相反的措辞

```
$ grep -n "而非静默降级\|推断为 read 失败\|抽屉读取报错" docs/program-notebook.md
  → 0 命中（三串均已不存在）
```
扩展扫描（本档改过的全部 7 个文件）：`grep -n "而非静默降级"` 逐个 = **0**。
D30 行的现行措辞是实测版：「**无问答卡片、无报错、无消息更新**」「**唯一出路是按「停止」**」。

### 5.2 指定 grep ②：runbook 已无与 `side-chat.module.css:365` 冲突的判据

```
$ grep -n "23 处\|其它 23\|不再有硬编码绿" docs/runbooks/verify-runbook.md
  → 仅 :28 命中，且现行文本为「选项行的交互面（底/边/文字）不再有硬编码绿」+「选中序号徽标是 btw 绿实心 = U8 有意为之，不是回归」
$ grep -n "选项行.*不再有硬编码绿.*其它 23\|不再有硬编码绿.*23 处" docs/runbooks/verify-runbook.md
  → 0 命中（原冲突判据已不存在）
```
源码侧对照（本档实读）：`dsh-btw/src/client/side-chat.module.css:365` = `.questionOptionSelected .questionOptionIndex { background: #b7e85b; … }`；`:363-364` 注释逐字写「2026-09-23 (U8, user-decided) … Selected rows now also flip the index badge to a solid btw-green chip」⇒ 现行判据与源码一致，**不会再把正确部署判成失败**。

### 5.3 源码侧关键断言逐条实读（防止引用行号漂移）

```
$ grep -n "btwPendingQuestionSchema.safeParse\|askBackArgumentMessage\|checked.data.questions\|^import { btwPendingQuestionSchema" dsh-btw/src/host/side-chat-service.ts
55:import { btwPendingQuestionSchema } from '../shared/remote.ts'
397:function askBackArgumentMessage(error: ZodError): string {
1004:        const checked = btwPendingQuestionSchema.safeParse({ questionId, questions })
1005:        if (!checked.success) throw new Error(askBackArgumentMessage(checked.error))
1021:            questions: checked.data.questions,

$ sed -n '137,155p' dsh-btw/src/shared/remote.ts
（:141 起 options: z.array(z.object({ label … description … }).strict()).optional()；:148 内层 .strict()；:154 外层 .strict()）

$ grep -n "readError\|READ_FAILURE_NOTICE_AT\|readFailures" dsh-btw/src/client/controller.ts
38 / 73（=3）/ 107 / 659 / 709 / 754 / 761 / 776 / 781-784

$ grep -n "readRetrying" dsh-btw/src/client/locales.ts
8:（键联合）/ 38:'Live updates paused — retrying' / 78:'实时更新已暂停，正在重试'
```
⇒ notebook D30 行的证据列已按这些**实测行号**书写（并把 §7 文本里残留的旧行号 `:741-746` 更新为 `:774-787`，避免读者按旧号读空）。

### 5.4 部署/生效面亲测（"未生效"措辞的事实依据）

```
$ md5sum dsh-btw/lib/client.js dsh-btw/lib/index.js
66beb3455c59f4991355f3918228e495  dsh-btw/lib/client.js
e1437b3ba7de953811e65c47d5b392e5  dsh-btw/lib/index.js
$ stat -c '%s' dsh-btw/lib/{client,index}.js
365269 / 67542
$ sha1sum dsh-btw/lib/client.js | cut -c1-12
887a12106dcd
$ md5sum ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/{client,index}.js
66beb3455c59f4991355f3918228e495  …/client.js   (mtime 2026-09-23 18:23:20)
e1437b3ba7de953811e65c47d5b392e5  …/index.js    (mtime 2026-09-23 18:23:20)
$ curl -s -o /tmp/served-btw-docs.js -w 'http=%{http_code} size=%{size_download}\n' http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js
http=200 size=365269        → md5 66beb3455c59f4991355f3918228e495
$ curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client.js?rev=[a-f0-9]*'
dsh-btw/client.js?rev=887a12106dcd
$ ps -eo pid,lstart,cmd | grep 'dsh web'
2649213 三 9月 23 10:09:52 2026 node …/bin/dsh web      ← 早于 18:23 的部署 ⇒ 宿主未重启
```
⇒ 「客户端面**已生效**、宿主面**待重启生效**」两句话**均为实测**，未留"已生效"这类与实际不符的措辞。

### 5.5 路径存在性验证（逐条 `test -e` / `ls`）

```
OK   dsh-btw/src/host/side-chat-service.ts
OK   dsh-btw/src/shared/remote.ts
OK   dsh-btw/src/remote-descriptors.ts
OK   dsh-btw/src/client/controller.ts
OK   dsh-btw/src/client/SideChatSurface.tsx
OK   dsh-btw/src/client/locales.ts
OK   dsh-btw/src/client/side-chat.module.css
OK   dsh-btw/tests/host-opening.spec.ts
OK   dsh-btw/tests/controller.spec.ts
OK   dsh-btw/tests/side-chat-surface.spec.tsx
OK   dsh-btw/lib/client.js
OK   dsh-btw/lib/index.js
OK   .workspace/btw-question/d30-consequence.md
OK   .workspace/btw-question/d30
OK   .workspace/btw-question/exec-d30/report.md
OK   .workspace/btw-question/preimage-lib-20260923-182907-pre-D30
OK   .workspace/btw-question/preimage-lib-20260923-182907-pre-D30/SHA256SUMS.txt
OK   .workspace/btw-question/preimage-lib-20260923-113216
OK   .workspace/btw-question/preimage-U8/client.js
OK   .workspace/btw-question/push-plan.md
OK   .workspace/btw-question/audit-b-official-ui.md
OK   .workspace/btw-question/e2e/repro-btw-question.mjs
OK   .workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after.json
OK   .workspace/btw-question/e2e/2026-09-23T08-03-24-466Z-final.json
OK   .gitignore
（26 条，无 MISSING）
```
另：`git check-ignore -v .workspace/btw-question/preimage-lib-20260923-182907-pre-D30/client.js` → `.gitignore:94:.workspace/btw-question/preimage-*/` ⇒ 「回滚钩子属本机件、不入库」的措辞**有实测依据**。

### 5.6 返回状态词汇复核（DOC-STYLE §6/§7）

- 状态标记带日期：写入了 `2026-09-23`（D30/D31/D32/D3 更新、§8 第 11/12 条、arch05 §3/§8、FEATURE-MAP `:25`）。
- 未使用非规范状态词描述"已上线"；宿主侧一律写「**已部署但宿主未重启 ⇒ 未生效**」「**待重启生效**」；客户端侧写「热面**已生效**」（有 §5.4 实测支撑）。
- fail-closed 表述与实现一致：`execute` 内 `safeParse` 失败即 `throw` 且**不写 pending**（§5.3 实读 `:1004-1005`、`:1021`）。

### 5.7 Markdown 表格完整性（改动行未破坏表格）

用「未被反斜杠转义的行分隔竖线数」校验（4 列表应为 5、3 列应为 4）：
- `docs/program-notebook.md` §7 表 34 行全部 = 5（含新写的 D3/D30/D31/D32 长行）；
- `docs/architecture/05-performance-and-ux-program.md` §3 表 16 行 = 5、§7 表 10 行 = 4；
- `FEATURE-MAP.md` §一表 = 4；`.workspace/btw-question/INDEX.md` §阶段产物表 = 4。
（`git ls-files \| grep` 这类含竖线的写法已转义为 `\|`。）

---

## 6. 诚实清单（明确不声称 / 未验证）

1. **本档未复跑 `vitest`**：`25 files / 260 passed / 2 skipped (262)` 取自 `exec-d30/report.md:354-362` 的原始输出，本档只**独立复核了新增用例的行范围存在且首尾闭合**（`host-opening.spec.ts:490-614`、`controller.spec.ts:805-893`、`side-chat-surface.spec.tsx:893-913`）。**未**独立验证该计数。（另按派单要求：本档全程**未**使用 `pnpm run *`，故未触发 pre-run install 删包事故。）
2. **本档未重新取证 D30 的真机现象**（27 次/45 s/1.475 s/14 s 等）：全部引自 `d30-consequence.md`（该档是唯一实测方）。本档只实测了**产物指纹与生效面**（§5.4）。
3. **未验证「修好后模型带多余键会收到可纠正报错并继续」的端到端行为**：`exec-d30/report.md:410`（§9 第 2 条）自述为"**端到端行为未在真机验证（仅单测锁住工具边界行为）**"，且宿主**未重启** ⇒ 该行为目前**不可验**。runbook 判据 10 已据此标注「**[待重启后可验]**」。
4. **D31 的官方对照只做了引用级核对**：本档实读确认 `matchesQuestions` 定义在 `@deepseek-ai/dsh-api-gateway/lib/index.js:1379`、使用点在 `:3895`，但**未逐条复核** `d30-consequence.md` 列出的 6 条语义规则与官方实现逐字一致（该文件 §F.0 自述为其实读所得）。
5. **D32 的 `370.6 MiB` 取自 `push-plan.md` R10**，本档只实测了 `5 955` 文件与 4 个 >10 MB blob；未独立复算树体积。
6. **§8 第 11 条刻意保留原 4 项「仍未覆盖」措辞**：按派单要求，另有档正在补测，结果回来后须由主代理指派再更新；本档**未预写**补测结论（已在正文显式标注该悬置状态）。
7. **`verify-runbook.md:57` 的过期 md5 未改**（§3.3）、**`INDEX.md:14` 的历史快照未标注**（§3.5）：均为明确登记、未处理的越界/未授权项，**不声称已闭**。
8. **`docs/architecture/05-performance-and-ux-program.md`、`.workspace/btw-question/{INDEX,exec-report,xaudit-docs}.md` 在本仓库未被 git 跟踪** ⇒ 本档无法用 `git diff` 提供基线对照，行号均为当前文件实测；若这些文件先前的行号被下游引用，需按下表重定位：

| 旧引 | 现位置 | 说明 |
| --- | --- | --- |
| notebook §8 第 11 条 | `docs/program-notebook.md:297` | 原 `:292`（本档开工前为 `:292`） |
| notebook §7 D30 行 | `:279` | 原 `:275` |
| notebook §7 D3 行 | `:251` | 原 `:248` |
| notebook §6 索引表末 | `:237-239` | 新增 3 行，表尾原为 `:236` |
| runbook 绿判据 | `docs/runbooks/verify-runbook.md:28` | 未移动 |
| arch05 btw 回滚行 | `docs/architecture/05-performance-and-ux-program.md:160` | 原 `:159` |
| INDEX 未覆盖项 | `.workspace/btw-question/INDEX.md:29` | 未移动 |

---

## 7. 自裁决

**通过**。

- D1–D8 逐条落地，无遗漏（§1 表；D6 有 1 处同因连带已登记，§3.2）。
- 两条指定 grep 均为 0 命中/口径一致（§5.1、§5.2）。
- 所有写入数字均可追到事实源（§4 对照表；其中"无来源"项已单独列出且**未作为数字使用**）。
- 所有新增/修改的仓库内路径引用实测存在（§5.5，26 条 0 缺失）。
- 状态词汇遵守 DOC-STYLE，宿主侧一律写「待重启生效/未生效」（§5.6、§5.4）。
- **不阻塞项（如实上报，均未越界处理）**：① ~~`verify-runbook.md:57` 的 md5 核对值已过期~~（**第 2 轮 D11 已裁决并修复**）；② ~~`INDEX.md:14` 的历史快照未标注~~（**第 2 轮 D12 已修复**）；③ D31/D32 为登记项，未修。

---

# 第 2 轮追加单元（D9–D12，2026-09-23 真机补测收口）

- 触发：真机补测档收口（`.workspace/btw-question/e2e-cover/report.md` + `raw-*.json`，**只读引用**）。
- 写面：仍限于上一轮那 7 个文件（+ `docs/` 内已改过的文件）；**新增引用只读**，未改 `e2e-cover/**`。
- **第 2 轮自裁决：通过**（详见 §B.5）。

## B.1 逐单元状态

| 单元 | 状态 | 落点（改后行号） |
| --- | --- | --- |
| **D9** §8 第 11 条定稿 | ✅ 落地 | `docs/program-notebook.md:299`（删除"另有档正在补测、不预写结论"，替换为 T1–T4 全部 PASS + 每项关键数字 + 官方对照 + 5 条诚实边界；D29 旧指纹 `88de97e6…` 与新指纹 `66beb345…` / 365 269 B / `?rev=887a12106dcd` 对齐并标明前者为"D30 前版本"） |
| **D10** §7 新增 D33 行 | ✅ 落地 | `docs/program-notebook.md:282`（窄屏 bottom-sheet 内容溢出、控件不可达；含根因 file:line、复原公式、"非本批回归"判据、与 T3 PASS 不矛盾的澄清、未判定项） |
| **D11** runbook：过期核对值更新 + 判据 11 | ✅ 落地 | `docs/runbooks/verify-runbook.md:63`（过期核对值 → `66beb345…` / 365 269 B / `?rev=887a12106dcd`，并把 `88de97e6…` 降为"回溯档/D30 前"；补"宿主面需重启才生效"提示）、`:64-67`（**判据 11**：窄屏 ≤640 px 下「停止」/输入框/「发送回答」须可命中，**标注当前 FAIL＝D33、待修后可验**，4 条可判别口径 + 反面判据 + 复现脚本与证据路径） |
| **D12** 收尾一致性 | ✅ 落地 | `docs/architecture/05-performance-and-ux-program.md:182`（§8 新增第 9 条：D33 登记 + 4 项补测 PASS + 5 条仍未判定）、`:181`（第 8 条补"D30 不涉及窄屏布局"交叉引用）；`FEATURE-MAP.md:25`（说明列补"真机补测收口"段 + D33 已知缺陷登记）；`.workspace/btw-question/INDEX.md:14`（历史快照标注）+ 新增 `:42-49`「真机补测收口」节；`docs/program-notebook.md:240`（§6 索引新增 `e2e-cover/report.md` 一行） |

> 行号说明（**均已逐条实测复核**）：D9/D10 的插入使 notebook 后续行号下移 ⇒ `§8 第 11 条` = `docs/program-notebook.md:299`、`D33` = `:282`、§6 索引新增行 = `:240`；D33 在 §7 表中的插入 ⇒ `D31` = `:281`。
> 注：派单写"`:57`（或你核实到的实际行）"——核实结果是**过期核对值在 `:63`**（`:57` 是 §3「故障排查」首条"插件没加载"），已按核实位置修改。

## B.2 与派单口径的两处**主动收紧**（如实登记）

1. **D33 的"控件中心点 y"未照抄派单的 `y≈980–1010`，而是写成中心点 `y≈995 / 986` + 顶边 `980 / 962`**：探针里 `box.y` 是 `getBoundingClientRect()` 的 **top**，而 `centerInViewport` 用的是 `top + h/2`（`t3-geometry-probe.mjs:29-33,35` 逐字可证）。`980 / 962` 是 box 顶边，中心点各加 h/2（15 / 24）。派单的"y≈980–1010"恰是 box 顶边到 box 底边的区间，两种读法都自洽；为避免 notebook/runbook 出现"用 box 顶边冒充中心点"的混淆，本档统一写**中心点值 + 顶边值**并注明 h/2 关系。
2. **D9 未把 T3 的 PASS 写成"窄屏一切正常"**：T3 判定的是**选项行本体**（bbox 在视口内 + 点选持久化 + 未被 scrim 吞点击），与 D33（泳道高度不足导致 composer 页脚出视口）**是同一分支上的两件事**。notebook §8 第 11 条已写明"同一分支另有 1 项新登记缺陷 ⇒ 见 §7 D33"，D33 行亦写明"不是 scrim 吞点击"⇒ 两处不矛盾。

## B.3 第 2 轮数字 → 事实源对照（全部本档亲自复算）

> 口径：**★ 本档逐字段读 raw JSON 复算**（30/30 断言命中，见 §B.4）；◆ 取自 `e2e-cover/report.md` 文字。

| 数字 | 写入位置 | 来源 |
| --- | --- | --- |
| 被测版本：`?rev=887a12106dcd` / md5 `66beb345…` / 365 269 B / 4 轮 0 pageerror | notebook `:299`、FEATURE-MAP `:25`、INDEX 补测节 | ◆ `e2e-cover/report.md` §0（`:16-24`）；★ 本档另用 `curl`+`md5sum` 独立复核同值（第 1 轮 §5.4） |
| T1：`role=group` + 3×`role=checkbox`；**59/59 / 2 967 ms**；卡片 1 ms 内消失；`promptKind=no-keyname` | notebook §8 第 11 条（`:299`）、FEATURE-MAP `:25` | ★ `raw-…-T1.json`：`verdict=PASS`、`optionsWrapRole=group`、`optionCount=3`、`sampleSummary.ratio=59/59`、`observedMs=2967`、`cardGoneAfterMs=1`、`attempts[0].promptKind=no-keyname` |
| T1 提交结果 `{"answers":[{"id":"drinks","selected":["咖啡","茶"]}]}` | notebook §8 第 11 条（`:299`） | ◆ `e2e-cover/report.md` §2.1/§4（宿主日志 seq 23 逐字） |
| T2：草稿全清 + 题干/选项全变；**59/59 / 2 974 ms**；`uuidAttrs` 为空 | notebook §8 第 11 条（`:299`） | ★ `raw-…-T2.json`：`verdict=PASS`、`ratio=59/59`、`observedMs=2974`、`cardSnapshot.uuidAttrs` 长度 = **0**、`diffHeader/diffQuestion/diffLabels` 均 True |
| T2 宿主侧 `drinks`→`time_slot` | notebook §8 第 11 条（`:299`）、INDEX 补测节 | ◆ `e2e-cover/report.md` §2.2/§4（seq 36 逐字） |
| T3：**2 ms** 内 `right`→`bottom-sheet`；选项行 bbox 全在视口内；**59/59 / 2 963 ms**；「发送回答」真实点击成功 | notebook §8 第 11 条（`:299`）、FEATURE-MAP `:25` | ★ `raw-…-T3.json`：`verdict=PASS`、`modeWaitMs=2`、`hitTests.optionRow.fullyInsideViewport=True`、`ratio=59/59`、`observedMs=2963`、`submitRealClick='ok'` |
| T4：Space **59/59** / 再按 **0/59** / 第三次 true；Enter 可切换且 `reachedAt=6`、卡片数恒 1；方向键无效 | notebook §8 第 11 条（`:299`）、FEATURE-MAP `:25` | ★ `raw-…-T4b.json`：`ratio` 出现 5×`59/59` + 2×`0/59`，`observedMs` 含 2971 / 2959；★ `raw-…-T4-enter.json`：`reachedAt=6`、`cardBefore=1`、`cardAfterEnter=1`、`cardAfterEnter2=1`、`afterEnter2[0].checked=false` |
| T4：官方卡 Tab **2 步** 可达、Space 选中后单选再按不取消、方向键无作用 | notebook §8 第 11 条（`:299`） | ◆ `e2e-cover/report.md` §2.5 修正轮 A（真机实测）；★ `raw-…-T4b.json` 含 `containerRole`/`optionTabIndexes` |
| T4 首轮 FAIL = **判定口径错**（radio 不可取消，官方 `choose()` 同款） | notebook §8 第 11 条（`:299`） | ◆ `e2e-cover/report.md` §3（`:313-323`）；★ `raw-…-T4.json` 首轮 `verdict=FAIL` 且 `composerProbe.disabled=true`（锚点回退前提） |
| D33：drawer `clientHeight 370` / `scrollHeight 633`；transcript 窗 **54 px**；stop/textarea/submit 均在视口外 | notebook §7 D33 行（`:282`）、runbook `:64-67`、arch05 `:182`、FEATURE-MAP `:25` | ★ `raw-…-T3-extra.json` `at640x800`：`drawer.clientH=370`、`drawer.scrollH=633`、`transcriptScroll.clientHeight=54`、`stopInsideSurface.centerInViewport=False`、`composerTextarea.centerInViewport=False`、`submit.centerInViewport=False` |
| D33 对照：1440×900 下 stop/submit 全部 `centerInViewport=true` | notebook §7 D33 行（`:282`）、runbook `:67`、arch05 `:182`、FEATURE-MAP `:25` | ★ 同 JSON `at1440x900`：`stopInsideSurface.centerInViewport=True`、`submit.centerInViewport=True`、`drawer.clientH=874 == scrollH=874` |
| D33 根因公式 `BOTTOM_SHEET_RATIO=0.48`×可用高度、夹 `clamp(…, min(280, available), 560)`；非显式分支 | notebook §7 D33 行（`:282`） | ★ `dsh-btw/src/client/overlay-placement.ts:86-88`（常量 `0.48` / `280` / `560` 逐字）、`:396-407` `sheetHeight()`（`:402-406` 为非 `explicitSize` 分支） |
| `HANDLE_MIN_VIEWPORT=720` 以下不套用显式尺寸 | notebook §7 D33 行（`:282`） | ★ `dsh-btw/src/client/drawer-size.ts:41-46`（注释逐字："Below this window width the drag handles are removed (product decision 3) and the explicit size is not applied at render time"） |
| 滚到底后 composer 仍在视口外 | notebook §7 D33 行（`:282`） | ★ 同 JSON `afterScrollToBottom`：`stopInsideSurface.centerInViewport=False`、`composerTextarea.centerInViewport=False`（与 `at640x800` 同值） |

## B.4 第 2 轮复算与自检输出

**① 30/30 断言逐项命中**（本档读 raw JSON 复算，全部与报告一致）：
```
T1 verdict=PASS / ratio=59/59 / observedMs=2967 / wrapperRole=group / optionCount=3 / cardGoneAfterMs=1 / promptKind=no-keyname
T2 verdict=PASS / ratio=59/59 / observedMs=2974 / uuidAttrs=0
T3 verdict=PASS / modeWaitMs=2 / ratio=59/59 / observedMs=2963 / fullyInsideViewport=True / submitRealClick=ok
D33 drawer clientH=370 / scrollH=633 / transcript clientH=54 / stop clientH=30
D33 stop|textarea|submit centerInViewport=False ; 1440 stop|submit centerInViewport=True
T4-enter reachedAt=6 / cardBefore=1 / cardAfterEnter=1 / afterShiftTab.text=—
→ 30/30 matched
```

**② 禁用措辞 0 命中**（7 个源文件）：
```
docs/program-notebook.md                                    0
docs/runbooks/verify-runbook.md                             0
docs/architecture/05-performance-and-ux-program.md          0
FEATURE-MAP.md                                              0
.workspace/btw-question/INDEX.md                            0
.workspace/btw-question/exec-report.md                      0
.workspace/btw-question/xaudit-docs.md                      0
（扫描串："而非静默降级" / "预写结论" / "另有档正在补测"）
```

**③ 路径存在性**（本轮新增引用 12 条，`test -e` 全部 OK）：`e2e-cover/report.md`、`raw-…-T1/T2/T3/T4.json`、`raw-…-T4b.json`、`raw-…-T3-extra.json`、`raw-…-T4-enter.json`、`t3-geometry-probe.mjs`、`dsh-btw/src/client/overlay-placement.ts`、`dsh-btw/src/client/drawer-size.ts`、`exec-docs/report.md` — 无 MISSING。

**④ 表格完整性**（未转义竖线计数）：notebook §7 = **33 行全部 5**（D1…D33 顺序连续、无缺号）；arch05 §3 = 5、§7 = 4；FEATURE-MAP §一 = 4；INDEX 阶段产物表 = 4。

**⑤ 源码锚点实读**：`overlay-placement.ts:86-88,396-407`、`drawer-size.ts:41-46` 均逐字核对（§B.3 末两行）。

## B.5 第 2 轮诚实清单

1. **未复跑 T1–T4**：全部数字取自只读 raw JSON **逐字段复算**（§B.4 ①），未重跑 Playwright（重跑会新建会话且需触发真机提问，越出文档面职责）。
2. **D33 只登记、未修**（用户裁决另开一轮）：本档只把根因读到 file:line，**未验证**修法与回归面。
3. **D33 的未判定项照抄不扩大**：其它窄屏尺寸/高度、720 px 边界行为、横屏、`data-placement-degraded` 是否可能非 `null` —— 均**未测**。
4. **`e2e-cover/report.md:8` 的并发写入披露与本档相关**：该档在其运行窗（18:40–18:49）观察到 `docs/program-notebook.md`(18:42:55)、`verify-runbook.md`(18:43:05)、`arch05`(18:41:33)、`FEATURE-MAP.md`(18:41:57) 的 mtime 变动，并声明其对 `docs/**` 只读。**该变动即本档第 1 轮的写入**（时间窗吻合，且本档为唯一写入者）⇒ 两档记录一致，无第三方写入疑点。
5. **官方对照的边界**：官方只测了**单选**卡片；**官方多选 checkbox 未做真机对照**（notebook §8 第 11 条（`:299`） 第 ④ 条已写明），故"checkbox 再按取消"的一致性只有 btw 侧实测 + 双方读源。
6. **T2 不声称 React 重挂机制**：DOM 无 questionId（实测 `uuidAttrs=[]`）⇒ 仅等价判据，已在 notebook 与 FEATURE-MAP 明确写为"**可观察等价判据**"。
7. **宿主面仍未生效**：`index.js` D30 修复需重启；本轮 4 项补测**全部是客户端面** ⇒ 不构成对宿主新代码的验证（`e2e-cover/report.md:27` 同款声明已写入 notebook/arch05/INDEX）。

