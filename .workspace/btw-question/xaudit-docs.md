# xaudit-docs — 独立交叉审计：btw 问答卡片修复的「文档/证据 vs 事实」核对

- 档别：**独立交叉审计档（只读）**；未改任何既有文件与 git 状态（本文件为唯一新增产物）
- 时点：2026-09-23（本机）；被审对象：`plan.md` U6 清单 + `exec-report.md` + 4 份被改文档 + `FEATURE-MAP.md` + `.workspace/btw-question/e2e/`、`harness/`
- 纪律：**不照抄执行档结论**；每条结论标注【已验证事实】/【高置信推断】/【未验证】
- 未做的事（如实声明）：**未复跑 vitest**、**未复跑 C1 反向注入**、**未尝试写入 `~/.dsh`**（只读纪律）

---

## 0. 一句话结论

**没有发现任何"线上已生效"类错误措辞**——四份文档一致地把线上指纹写成旧值 `6c29b98b645d`（361 702 B）并明写"未部署/部署待落地"，我实测复核全部一致。
但查出 **1 处方法论误引（官方 `key={question.key}` 重挂）、1 处把"未在真机观察过的效果"写成既成事实（"不再被抹掉"）、1 条**不具判别力**的 runbook 判据（选中底色＝旧包 hover 底色）、1 处作用域失当的判据（`aria-pressed`）、1 处归因不实的实现偏离理由、1 处 `Cache-Control` 前提与实测不符，以及 1 项未记录的行为变更（`setError(null)` 随 effect 一并删除）。**

---

## 1. U6 逐条核对表（plan §U6 第 1–7 条）

| # | plan 要求 | 判定 | 我核对到的事实（file:line / 数值） |
| --- | --- | --- | --- |
| 1 | notebook §7 新增 **D29**（现象/根因 file:line/状态/证据），"表格现有最大编号 D28" | **做了** | `docs/program-notebook.md:274` = D29、`:275` = D30；`:273` = D28 且为改动前既有最大号（`git diff` 中 D28 为上下文行）⇒ 编号衔接正确。D29 引用的 `controller.ts:723` 我实测命中 `delay = running ? 220 : 700`（`dsh-btw/src/client/controller.ts:723`）；`QuestionCard` 定位正确（`SideChatSurface.tsx:60` 起）；`questionId` 由 `randomUUID()` 铸造且在文件内不复用（`src/host/side-chat-service.ts:967,969,973,979`） |
| 2 | arch05 §3 btw 批行（`:80`）live 指纹 **换成部署后新值**；§7（计划写 `:158`）同步 | **不符（有正当理由）** | 实际是：`:80` **保持不动**（仍是 `6c29b98b645d` / 361 702 B），**新增 `:81`** 一行记录新构建产物与"未部署"，`:159` 更新为"线上现状 + 尚未部署"。因部署确实未落地，**这一偏离在事实层面是正确的**（把新构建指纹写成线上值才是错的）；但计划第 2 条本身未被字面执行，且计划所引 `:158` 与实际行 `:159` 差 1 行（`:158` 是"客户端（热面）"行） |
| 3 | verify-runbook `:18` 补"选中态 ≥3s 不回落"判据；`:41` 补排查项 | **做了（行号漂移 + 判据有缺陷）** | 实际落在 `:19`（4 条判据）与 `:43`（`点了选项不留色` 排查项）/`:45`（部署位字节核对）；plan 写 `:18`/`:41`，因新增文本插入而顺移，内容正确。判据本身存在"不具判别力/无采样口径"问题，见 §2 O3 |
| 4 | `FEATURE-MAP.md:25` btw 行补日期与口径 | **做了** | `grep -n "dsh-btw 侧边对话 v2" FEATURE-MAP.md` → `:25`；改动含"09-23…源码/测试完成、部署待落地"与"线上仍是旧包 `6c29b98b645d`，需一次 `cp -a lib/.`"⇒ 口径与日期准确 |
| 5 | `04-ops-deploy.md:194` 测试文件数 `24 → 25` | **做了且属实** | 我独立数：`dsh-btw/tests/*.spec.{ts,tsx}` = **25**（`find` 输出 25 个文件）；`:194` 已改为 **25** 并附"2026-09-23 实测：25 files / 250 passed / 2 skipped" |
| 6 | 可选：notebook 增 **D30** 并**必须标注未实测** | **做了且标注到位** | `docs/program-notebook.md:275` 状态列 = "**未修**（机制确证、后果**未实测**）"，正文亦写"**可观察后果未实测**"（双处标注）。引用行号复核：`side-chat-service.ts:916` = `additionalProperties: true` ✓、`:961` = `(args as { questions: BtwQuestion[] }).questions`（类型断言）✓、`:980` = 入 pending 的 `questions` ✓、`remote-descriptors.ts:32` = `result: { mode: 'strict' …}` ✓、`shared/remote.ts:146,153` = 两处 `.strict()` ✓（plan 写 `28-32`，D30 写 `32-34`，两者都指向同一处，**无实质漂移**） |
| 7 | **禁止改** `dsh-btw/README*.md` | **遵守** | `git status --porcelain -- dsh-btw/README.md dsh-btw/README.zh.md` → 空；`sign-contract.spec.ts:120` 依赖该 README 原文串，未被破坏 |

**关于"docs 里混有本次之外的未提交改动"（本任务第 1 点）——已分清：**

- **属于本次修复**：`FEATURE-MAP.md:25`；`docs/runbooks/verify-runbook.md:19,43-45`；`docs/architecture/04-ops-deploy.md:194`；`docs/program-notebook.md:274-275`；`docs/architecture/05-performance-and-ux-program.md:81,159`（该文件整体 **未被 git 跟踪**，`git status` 显示 `?? docs/architecture/05-…`）。
- **不属于本次修复（性能/技能发现批次遗留）**：`docs/architecture/02-plugin-system.md` 整个 §8（skill 发现根，+27 行）；`program-notebook.md` 的数据时点行、§5.3、§6 索引新增 6 行、§8 的 3/6–10 条、§7 中 D12/D13/D17 的状态更新。**这些与 btw 问答卡片无关**，审计时不应计入本次口径。
- 结论：**本次修复的文档足迹约为 5 个文件 7 处落点**（与 exec-report §5 自述一致）。

---

## 2. 过度声明清单（文档原文短引 → 事实 → 建议措辞）

### O1【方法论误引】**「官方卡片靠 `key={question.key}` 重挂」——官方 bundle 里根本没有 `key` prop**
- 原文：`docs/program-notebook.md:274`「修法采**官方同款**（官方 `dsh-client-ui-user-questions` 卡片**零 `useEffect`**，靠 `key={question.key}` 重挂）」；同措辞见于 `FEATURE-MAP.md:25`（"改官方同款「删除重置 effect + 调用点 `key={questionId}` 重挂」"）与源码注释 `dsh-btw/src/client/SideChatSurface.tsx:80-81`。
- 事实【已验证】：官方 bundle `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`（37 586 B）中 **`useEffect` 出现 0 次 ✓**（这一半成立），但 **`key:` 子串仅 2 处且都在字符串字面量里**（`"error.incomplete"`/`"error.unanswered"`），全文件 **没有任何 React `key` prop**；其 DOM 侧属性是 `"data-question-key": pending.key`（同文件），组件定义是 `function QuestionFlow({ pending, t })` + `useState(() => questions.map(…))` ⇒ 官方"每题干净初值"来自**组件随 `pending` 出现/消失的挂载边界**，不是 key 重挂。
- 建议措辞：「官方卡片**零 `useEffect`**（不做草稿重置），其"每题干净初值"来自组件随 `pending` 出现/消失的挂载边界（DOM 侧仅 `data-question-key`）；本实现在调用点额外用 `key={questionId}` 把该边界显式化」。

### O2【把未观察到的效果写成既成事实】**「选中态不再被 220 ms 轮询抹掉」**
- 原文：`docs/architecture/05-performance-and-ux-program.md:81`「点选后选中态**不再被** 220 ms 轮询抹掉（回归锁 C1…；隔离验真：注入旧 effect ⇒ C1 必失败）」。
- 事实【已验证】：同一行右侧明确写"线上**仍** `6c29b98b645d`（未部署）"；`exec-report.md:289` 自述"修复后的真实 GUI 端到端…**未测**…这是本次唯一的实质空白"。⇒ 该效果的直接证据只有**单测 C1**（`tests/side-chat-surface.spec.tsx:792-807`）与**离线静态 harness**，**从未在任何真实运行中观察到**（E2E 三次全在旧包上）。
- 建议措辞：「源码侧已删除重置 effect，回归锁 C1 锁住该缺陷（同 `questionId`+新数组身份不清空）；**真机效果待部署后验收**」。

### O3【判据不具判别力】**runbook 判据②"底色转中性灰蓝 `rgba(38,49,72,0.06)`"无法区分"选中"与"仅悬停"**
- 原文：`docs/runbooks/verify-runbook.md:19`「② 点选后**选中态可见且保持 ≥3 s 不回落**（底色转中性灰蓝 `rgba(38,49,72,0.06)`、边框 `rgba(0,0,0,0.1)`，与主会话官方卡片同款…）」
- 事实【已验证】：(a) `rgba(38,49,72,0.06)` 恰是**旧包的 hover 底色**——`e2e/2026-09-23T03-24-41-842Z-before.json` 的 `afterHold.background = "rgba(38, 49, 72, 0.06)"` 且 `className = "SalQ5q_questionOption"`（即已回落、仅剩 hover）；(b) 新实现里 hover 与 selected 用**同一 token**：`side-chat.module.css:350`（hover）与 `:351`（selected）均为 `--dsw-alias-interactive-bg-hover`；亮色下该 token = `#2631480f` ≈ rgba(38,49,72,0.059)（官方 theme bundle 实测值）；官方自身也是同值：`.Mbwy4a_option:hover:not(:disabled),.Mbwy4a_optionSelected{background:var(--dsw-alias-interactive-bg-hover)}`；(c) 判据只给亮色值，暗色实测为 `rgba(255,255,255,0.08)`/`rgba(255,255,255,0.12)`（`harness/…-harness.json` after/dark）。
- 另【已验证】判据未给**采样口径**：本缺陷可观察窗口只有 ~100 ms 量级（before：166→270 ms、2/56；after-dense：162→225 ms、4/181），人眼"看 3 秒"极可能漏判"闪一下就没"。
- 建议措辞：「点选后 **`aria-checked="true"` 且 class 含 `questionOptionSelected`**；**把指针移开该行**后 3 s 内不回落（只按底色不可判：hover 与 selected 同 token）；采样口径：click 后 0–3000 ms 内以 ≤50 ms 间隔连续采样（或至少在 200/500/1500/3000 ms 各判一次）；暗色下选中底/边为白系 `rgba(255,255,255,0.08)`/`rgba(255,255,255,0.12)`」。

### O4【作用域失当】**"不应再有 `aria-pressed`" 在同插件内仍有合法命中**
- 原文：`docs/runbooks/verify-runbook.md:19` 判据④「…选项 `role=radio|checkbox` + `aria-checked`（**不应**再有 `aria-pressed`）」；`exec-report.md:34`「`grep -rn aria-pressed src/` → **0 命中**」、`:191` 同命令。
- 事实【已验证】：`dsh-btw/src/client/SideChatButton.tsx:33` 仍有 `aria-pressed={view.visible}`（面板头部 btw 切换按钮，**合法**语义），并被打进新包 `dsh-btw/lib/client.js`（命中 1 处，上下文即 `"aria-pressed": view.visible`）。⇒ "0 命中"只对**选项行/`SideChatSurface.tsx`** 成立，对 `src/` 整体**不成立**。
- 建议措辞：「**问答卡片选项行**上不应再有 `aria-pressed`（`SideChatButton` 的 `aria-pressed` 属切换按钮合法语义，保留）」；exec-report 的两条 grep 论断应标注为文件范围（`src/client/SideChatSurface.tsx`）。

### O5【归因不实】**"plan 的 hover 写法会让选中底被覆盖 ⇒ 点了不留色"**
- 原文：`exec-report.md:40`「`.questionOption:hover:not(:disabled)` 特异性 (0,3,0) **高于** `.questionOptionSelected` (0,1,0)…⇒ 该写法会让**选中底被 hover 规则覆盖**（观感上仍是「点了不留色」）」。
- 事实【已验证】：plan 的写法是**分组选择器，两条规则声明的是同一个值**（同一 hover token），覆盖不会产生任何可见差异；官方 bundle 用的正是这一分组写法（见 O3(b)）。特异性比较成立，但**推论不成立**。实现加 `:not(.questionOptionSelected)` 无害且更显式，**仅理由错误**（CSS 注释 `side-chat.module.css:346-348` 未复述该错误理由，问题仅限 exec-report）。
- 建议措辞：「加 `:not(.questionOptionSelected)` 使"选中优先"在源码层显式（官方以分组选择器达成同一效果，二者背景同值，**不存在可见回归**）」。

### O6【作用域失当】**"去掉硬编码绿 `#b7e85b`"／"不再有硬编码绿"** —— **【计数已更正；实质结论已被 U8 推翻，2026-09-23】**
- 原文：`docs/program-notebook.md:274`「…去掉硬编码绿 `#b7e85b`…」；`exec-report.md:39`「旧 `.questionOptionActive` 已删除（全仓 0 命中），**不再有硬编码绿**」。
- **计数更正（2026-09-23 实测复核）**：当时写的「仍有 **8 处**」不准——`grep -c b7e85b dsh-btw/src/client/side-chat.module.css` 现为 **24 行**命中；扣除 **1 行注释**（`:228`）与 **1 行选项行徽标**（`:365`，U8 新增）后为 **22 处**。**审阅当时（U8 之前）的非注释命中为 23 行**，其中**选项行 0 处**（旧 `.questionOptionActive` 已删除）——故 O6 当时"**选项行已无绿**"的实质结论**在当时成立**。
- **该结论今天已被 U8 推翻**：`side-chat.module.css:365` `.questionOptionSelected .questionOptionIndex { background: #b7e85b; … }` 是 **U8（用户裁决）有意**把**选中行序号徽标**翻绿（官方选中底 6% 中性覆盖在绿壳卡片上仅 13.01/255 均差、易被读成"没选上"；徽标区实测 53.55/255）⇒ **不得再按"选项行无绿"验收**，凡引用 O6 的下游改稿须重写口径（已落到 `docs/runbooks/verify-runbook.md:28`：「选项行**交互面（底/边/文字）**无硬编码绿；**选中序号徽标为 btw 绿实心＝U8 有意**；该色另有 22 处非选项行用法」）。
- 仍成立的部分：按用户裁决保留外壳绿是**正确的**；"全仓无绿"从来不是结论（句子读快了会误解）。
- 建议措辞：「**选项行交互面**不再有硬编码绿；选中徽标（U8 有意）与外壳/品牌元素按裁决保留 `#b7e85b`（实测共 24 行命中：注释 1 + 选项行徽标 1 + 非选项行 22）」。

### O7【相邻文档事实不符（非本次足迹）】**arch05 §7"该资源无 `Cache-Control`/`ETag`"**
- 原文：`docs/architecture/05-performance-and-ux-program.md:167` ④「**该资源无 `Cache-Control`/`ETag`** 且改内容不改名 ⇒ 必须硬刷新」（③ 的"该资源"= 被服务的 btw client.js）
- 事实【已验证】实测响应头：`GET/HEAD http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js` → **有 `cache-control: no-cache`**，无 ETag/Last-Modified；而壳层 `/assets/index-ClqxG24t.js` → **确实两者皆无**。⇒ 该句对 btw 资源**前提不实**（对壳层 dist 成立）。副产物：因为 btw 资源带 `no-cache`，"部署后**必须硬刷新**"并非严格必需（保守无害，但判据可按资源区分）。
- 建议措辞：「壳层 `/assets/*` 无 `Cache-Control`/`ETag` ⇒ 必须硬刷新；btw client.js 带 `cache-control: no-cache`（无 ETag）⇒ 常规刷新即会重取；`?rev=` 是内容哈希但不是有效缓存键」。

---

## 3. 证据链核对结果（e2e JSON + harness + 截图）

### 3.1 指纹与部署状态（全部独立复核，与文档一致）
| 项 | 文档声称 | 我的实测 | 判定 |
| --- | --- | --- | --- |
| 线上 served md5 / 体积 / rev | `6c29b98b645df00b8bc3e9279d6df93e` / 361 702 B / `?rev=a0ba609897df` | `curl …/plugins/@local/dsh-btw/client.js` → md5 `6c29b98b645d…`、size 361 702；boot 清单 `"rev":"a0ba609897df"` | ✅ |
| 部署位文件 | 同上 | `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` md5 同左；**mtime = 2026-09-23 10:01:27**（早于 11:35 的修复构建） | ✅ 未部署（**双重独立证据**） |
| 新构建 | `241b04c412be6fbca37048dcf3974589` / `93d7907f1e76` / 363 701 B | `md5sum`/`sha1sum|cut -c1-12`/`stat` 完全一致 | ✅ |
| 旧包内容确为"未修版" | — | 线上 bundle 含 `questionOptionActive` ×3、`aria-pressed` ×2、`8px 11px` ×1；新包 `questionOptionActive` **0**、`questionOptionSelected` ×3 | ✅ |
| pre-image 回滚钩子 | `preimage-lib-20260923-113216/` + `SHA256SUMS.txt` | `sha256sum -c` → 10/10 **成功** | ✅ 可回滚 |
| 沙箱拒绝归因 | "沙箱边界而非 unix 权限" | `test -w <profile lib>` → **WRITABLE**（权限位可写）⇒ 与"非 unix 权限"一致，但我**未复现**写入失败 | 【高置信推断】 |

### 3.2 `after` 跑出 `NEVER-ON` 的解释是否成立
- 【已验证】**"跑在旧包上"确证无疑**：`e2e/2026-09-23T03-39-41-934Z-after.json` 的 `optionsAtStart[].role = null`、`ariaChecked = null`、`ariaPressed = "false"`；新包必然给出 `role="radio"` + `aria-checked`（`harness.json` after 页实测 `role:"radio"/ariaChecked:"true"`）⇒ 该次运行服务的是未修复字节。**故"修复无效/无效验"的过度解读在这份证据下不成立，文档没有这样写**（`exec-report.md:222` 明写"三条都是同一份线上旧包的结果 ⇒ 证明的是修复尚未生效，不构成修复后的验收"）。
- 【高置信推断】但对 `NEVER-ON` 的**机制读法**（`exec-report.md:79`「首采样落在 167 ms，**恰好错过** 166–218 ms 的短暂选中窗」）证据不足：旧包选中窗 = click→下一次 220 ms 轮询 publish 之间（相位 0–220 ms 随机），after 那次相位 <167 ms 可使首采样即"已回落"；**但 JSON 无法排除"该次 click 未生效"**（`beforeClick` 与 `afterHold` 同为 `bg rgba(38,49,72,0.06)` + class `questionOption`）。⇒ 该读法应降级为**推断**，判决性论据请改用 `optionsAtStart`（见上）。
- 【已验证】`after-dense`（`--sample-ms 15`）复现出 `REVERTED firstOn=162/firstOff=225/on=4/181`，与 `before`（`166/270, 2/56`）**同现象同量级**，且翻回点均落在 ~220 ms 轮询周期上——"采样口径有效"的说法成立。
- 【已验证】三张截图与 JSON 一致：`…-before-2-after-click-200ms.png` 首行呈**淡绿底+绿描边**（旧包有效窗口 @200 ms，与 JSON 166/218 ms 采样吻合）；`…-after-2-after-click-200ms.png` 两行**同为中性灰**、无任何序号徽标/单选指示（既是 `NEVER-ON` 的视觉一致证据，也**再次确证旧包**——新包的 1/2 徽标在本图缺失）。

### 3.3 `main-ref2` 的"逐值相同"是否有 JSON 支撑
- 【已验证】两份参照物 JSON **逐字段完全相同**（剔除 `label/startedAt/finishedAt/shots/questionKey/steps` 后 `dict == dict` → `True`）；选中行实测 `bg rgba(38,49,72,0.06)`、`border rgba(0,0,0,0.1)`、`radius 12px`、`minHeight 40px`、`padding 8px 12px 8px 8px`、`role radio`、`ariaChecked true`、`ariaPressed None`。
- 【已验证】离线 harness 的 after/light 选中行与上述**逐值相同**：`rgba(38, 49, 72, 0.06)` / `rgba(0, 0, 0, 0.1)` / `12px` / `40px` / `8px 12px 8px 8px`（`harness/2026-09-23T03-38-46-274Z-harness.json`），且 `role:"radio"`、`ariaChecked:"true"`、`ariaPressed:null`、前导徽标 `questionOptionIndex` 文本 `"1"` ⇒ `arch05:81` 的"与主会话实测**逐值相同**"**在 token/几何层成立**。
- 【已验证】harness before/light 选中行 = `rgba(183, 232, 91, 0.12)` + 绿边、class `questionOptionActive`（**旧规则保真复现**，不是稻草人）；classMap 哈希前缀 `SalQ5q` 与线上 className（`SalQ5q_questionOption`）一致。
- 【已验证】harness 目视（`after-light.png`）与 `exec-report.md:236-239` 四条判据一致：1/2 序号徽标、多选黑底白勾复选框、选中行中性灰（**非绿**）、外壳仍绿。
- 边界（与 exec-report 自述一致）：harness 是静态渲染，且 `plainRow.borderColor = rgba(0,0,0,0.1)` 而官方基态为 `rgba(0,0,0,0)`（**有意偏离**，已在 `exec-report.md:239`、`:44` 声明）⇒ "与官方一致"**只在选中态 token/几何成立**，基态边框不同。

### 3.4 exec-report 中与事实不匹配的解释（除 O5 外）
- **未记录的行为变更【已验证】**：被删 effect 是 `useEffect(() => { setDrafts(全空); setError(null) }, [questionId, questions])`（`git diff` 中 `-  setError(null)` 与 `-  }, [pendingQuestion.questionId, pendingQuestion.questions])`）。删除后 **`error` 不再被每次轮询清空**（仅在 `questionId` 变更/卸载时重置）。这大概是改善（错误提示不再一闪而过），但**D29 / arch05 / FEATURE-MAP 均未提及**，属"代码行为变更未同步文档"。

### 3.5 测试计数（只读条件下的独立核对）
- 【已验证】文件数 **25**（`find dsh-btw/tests -name '*.spec.ts' -o -name '*.spec.tsx' | wc -l` = 25）⇒ `04-ops-deploy.md:194` 的 24→25 属实。
- 【高置信推断】断言数静态相容：224 个 `it(` + 6 个 `it.each(`（展开 26：overlay-placement 3+6+3、sign-contract 2、tool-policy 5+7）+ 2 个变量化声明（`sign-contract.spec.ts:193 itOnDarwin`、`:230 itOnStrictDarwin`，Linux 下均 `it.skip`）= **252 总数，其中 2 跳过 ⇒ 250 passed / 2 skipped**，与 `exec-report.md:139`、`04-ops-deploy.md:194` 完全吻合。**但我未复跑 vitest**（只读纪律），故仍标为高置信推断而非实测。
- 【高置信推断】C1 的"注入旧 effect 必失败"逻辑自洽：`tests/side-chat-surface.spec.tsx:792-807` 在 click 后用**内容相同、对象图全新**的 `pending(QUESTION_ID, SINGLE)` 重渲染，旧 effect 依赖 `[questionId, questions]` ⇒ 必然 `setDrafts(全空)` ⇒ `aria-checked` 变 `false` ⇒ 断言失败。**未复跑**。

---

## 4. 漏项与建议补正

| # | 漏项 / 偏差 | 依据 | 建议 |
| --- | --- | --- | --- |
| L1 | notebook **§8「未验证项」无"修复后真机未验收"条目**（§7 D29 状态列只写"部署待落地"） | `exec-report.md:289` 自述这是"本次**唯一**的实质空白"；notebook §8 的体例正是"本页明确不声称" | §8 增一条：「btw 问答卡片修复的**真实 GUI 端到端**（点选后选中态保持）**未测** —— 前置条件为部署落地（见 §7 D29）」 |
| L2 | plan §U6 第 2 条未按字面执行（`:80` 未替换为新指纹） | 部署未落地（我实测 md5+mtime 双证） | 在 arch05 `:81` 或 U6 记录里补一句"计划前提=部署完成；实际未部署故保留 `:80` 旧值 + 新增本行"；同时修正 plan 里 `§7 地图行（:158）`→ `:159` |
| L3 | `setError(null)` 随 effect 一并删除，**文档零处记录**该行为变更 | `git diff` 删除行；`SideChatSurface.tsx:72-73` 现有 `error` state 只在 `submit()` 内被清 | 在 D29 或 arch05 补半句：「副作用：草稿与 `error` 不再随轮询重置（错误提示现在会保持到本次提问结束/重挂）」 |
| L4 | runbook 判据④ 未限定作用域（`aria-pressed` 在同插件 `SideChatButton.tsx:33` 仍合法存在） | 见 O4 | 明确"仅选项行" |
| L5 | runbook 判据③"外壳仍是 btw 绿"缺可判定取样点（与②④粒度不一致） | `side-chat.module.css:334,336,340` | 补"卡片外框 `color-mix(#b7e85b 45%, --dsw-alias-border-l1)` / 头部绿点 `#b7e85b` + `btwQuestionPulse`" |
| L6 | `exec-report.md:63` 把部署失败归因"沙箱边界"（我未能复现该失败） | `test -w` → WRITABLE | 保留结论但注明依据（`touch`/`cp` 的 EACCES + 目标在工作区外），避免读者以为权限位可写却仍失败 |
| L7（可选） | notebook §6 索引未收录 `.workspace/btw-question/` | 本页 §6 口径是"证据在 `.workspace/`" | 可选补一行索引（plan 未要求，非缺陷） |

---

## 5. 未验证项（本次审计自身）

1. **未复跑 vitest / tsc / lint / build**（只读纪律：测试运行会写 `node_modules` 缓存）⇒ "25 files / 250 passed / 2 skipped"、"typecheck/lint 全绿"、"宿主面 6 产物逐字节相同"均为**静态或逻辑相容**，非我实测。
2. **未复跑 C1 反向注入**（"注入旧 effect ⇒ C1 必失败"为逻辑推断）。
3. **未复现部署被拒**；仅确认"未部署"这一**结果事实**（served md5 + 部署位 md5 + mtime 10:01:27）。`test -w` 显示 unix 权限位可写。
4. **修复后真机表现未验**（结构上不可能：部署未落地）。含：点选保持、多选真机交互、`<720px` bottom-sheet、回答后再次提问、键盘可达性——均与 `exec-report.md` §8 清单一致。
5. **`after.json` 的"错过选中窗"读法未获决定性证据**（见 §3.2）；另一解释（该次 click 未生效）无法由 JSON 排除。
6. **harness 不等于真机**：其 token 表、CSS 编译哈希、结构同构我已抽样核对，但未做宿主级 CSS 级联/主题切换的端到端等价性证明（`exec-report.md:85` 亦如此自述边界）。
7. **`arch05:167` 的指代歧义**：我按"③ 的该资源 = btw client.js"判其前提不实；若作者本意是壳层 `/assets/*`，则原文成立（该资源实测确无 `Cache-Control`/`ETag`）——需作者澄清指代。
8. 未核查 `docs/architecture/05` 全篇（189 行）中属于性能专项的其他断言（超出本任务范围）。

---

## 6. 附：本次核对的关键原始命令与数值（可重放）

```bash
# 线上/仓库指纹（与文档一致）
curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum   # 6c29b98b645df00b8bc3e9279d6df93e, 361702
md5sum dsh-btw/lib/client.js                                             # 241b04c412be6fbca37048dcf3974589, 363701
sha1sum dsh-btw/lib/client.js | cut -c1-12                               # 93d7907f1e76
stat -c '%y' ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js    # 2026-09-23 10:01:27（早于 11:35 构建）
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client\.js?rev=[a-f0-9]*'  # rev=a0ba609897df
find dsh-btw/tests -name '*.spec.ts' -o -name '*.spec.tsx' | wc -l        # 25
grep -n "delay = running" dsh-btw/src/client/controller.ts                # 723: delay = running ? 220 : 700
grep -c useEffect <官方 user-questions client.js>                          # 0
grep -o "key:" <官方 user-questions client.js>                             # 2（均为字符串字面量，无 React key prop）
grep -o "_option:hover[^}]*}" <官方 client.js>                             # .Mbwy4a_option:hover:not(:disabled),.Mbwy4a_optionSelected{background:var(--dsw-alias-interactive-bg-hover)}
grep -o "interactive-bg-hover:[^;,}]*" <官方 theme client.js>              # #2631480f（亮）/ #ffffff14（暗）
curl -sI http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js            # cache-control: no-cache（无 ETag）
curl -sI http://127.0.0.1:3080/assets/index-ClqxG24t.js                    # 无 Cache-Control / ETag
cd .workspace/btw-question/preimage-lib-20260923-113216 && sha256sum -c SHA256SUMS.txt   # 10/10 成功
python3 比对 main-ref.json vs main-ref2.json（剔除时点/标签/截图/questionKey）  # 完全相同 True
```

**图片目视（analyze_image）**：`e2e/…-before-2-after-click-200ms.png`（首行淡绿底绿边＝旧包有效窗口）；`e2e/…-after-2-after-click-200ms.png`（两行同中性灰、**无** 1/2 徽标 ⇒ 旧包）；`harness/…-after-light.png`（1/2 徽标 + 多选黑底白勾 + 中性灰选中 + 绿壳）。
