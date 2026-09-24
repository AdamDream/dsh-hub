# verify-report-a — 被审汇报句的文档/代码事实核查（只读审计档）

- 档别：**只读核查**（未改任何源码 / docs / lib / 测试；唯一写入 = 本文件）
- 时点：2026-09-23（本机）；仓库 HEAD `5f7d61b8`
- 被审句（逐字）：
  > 仍未覆盖（已登记 notebook §8）：窄屏 <720 px bottom-sheet 分支的选项行、真实 GUI 的多选交互与"回答后再提问"重挂、选项行键盘/焦点序、以及 D30（btw_ask_user 参数 schema 宽于 read 的 strict codec）的实际后果——机制已确证、后果未实测，要不要修由你定。

---

## 裁决摘要

1. **「已登记 notebook §8」对其中 4 项属实、对 D30 不实**：`docs/program-notebook.md` §8（`:280-294`）全文 **0 次**出现 "D30"（唯一命中在 `:275`，即 §7 表格行）；D30 的「后果未实测」登记在 §7 的 D30 行**状态列**（`docs/program-notebook.md:275`）。**P1**。根因在 `INDEX.md:29` 的「（均登记 notebook §8）」括注，汇报句照抄了它。
2. **那四项「未覆盖」逐项确有缺口**（代码 / 测试 / E2E 三面复核均无反例）：窄屏 bottom-sheet 选项行、真实 GUI 多选、真实 GUI 换题重挂、选项行键盘/焦点序。**P2**（属如实声明，本身无错误）。
3. **真机 E2E 只驱动单选**：脚本写死「单选（single select）」（`.workspace/btw-question/e2e/repro-btw-question.mjs:48`），且 e2e 目录全部 `*.mjs` **0 次**出现 `multi`/`多选`；viewport 恒 `1440×900`（同文件 `:79`）⇒ 多选与换题重挂确未真机覆盖，「多选=仅单测 + 离线 harness」**准确**。**P2**。
4. **「选项行键盘/焦点序未覆盖」属实，但不是 btw 独有缺陷**：官方 `dsh-client-ui-user-questions` 同构——`role=radiogroup` + 原生 `<button role="radio|checkbox" aria-checked>`，**无 roving tabindex、无方向键处理**（官方 bundle `lib/client.js:523,527-535,537-541` 的 `onKeyDown` 只做 Enter 提交）；btw 选项行连 `onKeyDown` 都没有（`SideChatSurface.tsx` 的 `onKeyDown` 仅在 `:175/:215/:438/:643/:701`）⇒ **纯测试缺口**，APG 偏差为上游同款。**P2**。
5. **D29 状态声明的可核项全部为真**（D29 行不实项 = 0）：md5 `88de97e6c22fc6de9ebd61cb27e5779f`、363 814 B、sha1[:12]=`3980d1322992`、served==部署位==仓库、未重启 dsh、真机 `PERSISTED 55/55 @firstOn=185 ms` —— 逐项实测一致。唯一未亲测项 = 「25 files / 250 passed / 2 skipped」（静态与独立档复跑记录吻合）。**P2**。
6. **D30 登记文本的推断句与代码不符**：「推断为 read 失败/抽屉读取报错，而非静默降级」（`docs/program-notebook.md:275`，源自 `audit-b-official-ui.md:298`）。读码事实：宿主 strict 结果校验失败 ⇒ `result-invalid`（`dsh-api-gateway/lib/index.js:112,342-355`）⇒ 客户端 `ok:false` ⇒ `controller.ts:692` 抛出 ⇒ **`poll()` 只在 `:741-744` 打 `console.warn` 并按 1 200 ms 重试，不发布任何 error 态** ⇒ 稳态症状是**近乎静默的停摆**（转录停更 + 问题卡不出现 + 该次 `btw_ask_user` 永久挂起）；只有「关抽屉再打开」的 restore 读路径才会 published 可见 error（`controller.ts:666-678`）。**P1**（D30 文本；被审句未复述该推断 ⇒ 汇报句在此点无独立错误）。
7. **时效漂移（自相矛盾）**：`exec-report.md:291` 仍写「修复后的真实 GUI 端到端未测 …… 这是本次唯一的实质空白」，与 12:02 起的 `e2e/*-after.json`（PERSISTED）及 notebook `:274,:292`、`INDEX.md:23-24`、`arch05:81` 冲突。**P2**。
8. **验收判据自相矛盾且与源码冲突**：`verify-runbook.md:28` 判据「选项行**不再有硬编码绿 `#b7e85b`**」与源码 `side-chat.module.css:365`（U8 有意把选中序号徽标翻 `#b7e85b` 实心）冲突，并与同段 `:29` 判据③「选中徽标翻成 **btw 绿 `#b7e85b` 实心**」直接矛盾。按此判据验收会把正确部署判成失败。**P1**。

---

## 逐条核对表

### Q1 「已登记 notebook §8」是否成立 —— 逐项判定

判定口径：§8 = `docs/program-notebook.md:280-294`，共 **11 条**（`:282-292`）；`grep -n "D30" docs/program-notebook.md` **仅 `:275` 一处命中**。

| 子声称 | 判定 | 证据（file:line） | 建议措辞 |
| --- | --- | --- | --- |
| 窄屏 <720 px bottom-sheet 选项行「已登记 §8」 | **属实** | `docs/program-notebook.md:292`（§8 第 11 条，逐字含「窄屏（<720 px）bottom-sheet 分支的选项行」）；另见 `exec-report.md:292`、`INDEX.md:29` | 保留 |
| 真实 GUI 多选「已登记 §8」 | **属实** | 同上 `:292`（「真实 GUI 多选交互（目前仅单测 + 离线 harness）」） | 保留（可保留"仅单测 + 离线 harness"限定语） |
| 「回答后再提问」重挂「已登记 §8」 | **属实** | 同上 `:292`（「真实 GUI 的「回答后再提问」重挂」）；另 `exec-report.md:293` | 保留 |
| 选项行键盘/焦点序「已登记 §8」 | **属实** | 同上 `:292`（「选项行键盘导航/焦点序」）；另 `exec-report.md:296` | 保留 |
| **D30 的实际后果「已登记 §8」** | **不实** | §8（`:280-294`）无 "D30" 字样；D30 登记在 **§7 表格行** `docs/program-notebook.md:275`，其「后果未实测」写在**该行状态列**（`\| **未修**（机制确证、后果**未实测**） \|`）；正文句亦明写「机制为读源确证；**可观察后果未实测**」。旁证：`exec-report.md:295`（§8 第 5 条，属**执行档自己的**§8，非 notebook）、`plan.md:105`（U6.6 明写「在 notebook **§7** 增 D30」）、`INDEX.md:27`（「notebook D29/**D30**/§8 第 11 条」——此处把 D30 与 §8 并列，措辞正确） | 见下「建议措辞」；并把 `INDEX.md:29` 的「（均登记 notebook §8）」改为「（四项登记 notebook §8 第 11 条；D30 后果登记 §7 的 D30 行）」 |
| 「D30 已登记」（不限定 §8） | **属实** | `docs/program-notebook.md:275` 全行（含 5 处 file:line 引用与「未修」状态） | 保留 |

**「§8 无 D30」是谁的问题（定责）**：
- **notebook 内容**：**不算缺口但不合体例**。§8 的既有惯例是对 D 编号项**交叉引用**（`:287` 第 6 条「**D26**」、`:289` 第 8 条「**D27 的可达性**」、`:292` 第 11 条「**D29**」），而 D30 的"后果未实测"在 §8 **无对应条目**。⇒ notebook 应补 §8 第 **12** 条（一行即可），**不是**改写 D30 行。
- **INDEX.md 措辞**：**是主要责任方**。`INDEX.md:29` 写「…键盘导航、D30 后果（**均登记 notebook §8**）」，把 §7 的 D30 登记统称进 §8，构成过度概括；`INDEX.md:27` 的同一件事写得是对的（「notebook D29/D30/§8 第 11 条」）。⇒ 同一文件内先对后错，属修订时未同步。
- **汇报措辞**：**照抄 INDEX.md:29**，自身不构成新的错误来源，但对外汇报时该措辞确实不实（D30 不在 §8）。

**被审句改成什么才算准确（可直接替换）**：
> 仍未覆盖（4 项登记在 notebook §8 第 11 条；D30 的「后果未实测」登记在 §7 的 D30 行状态列）：窄屏 <720 px bottom-sheet 分支的选项行、真实 GUI 的多选交互与「回答后再提问」重挂、选项行键盘/焦点序；另有 D30（`btw_ask_user` 参数 schema 宽于 read 的 strict codec）的实际后果——机制已读源确证、后果未实测。要不要修由你定。

### Q2 那四项「未覆盖」是否真的未覆盖 —— 逐项查反例

| 子声称 | 判定 | 证据（含反例检索结果） |
| --- | --- | --- |
| 窄屏 <720 px → `bottom-sheet` 分支下**选项行**无验证 | **属实** | ① **放置模式**有测试但只测放置：`tests/overlay-placement.spec.ts:151`（`[640, 800, 'bottom-sheet']`）、`:115`；`tests/overlay-placement-explicit.spec.ts:196,199`；`tests/overlay-measurement.spec.tsx:273,343,383`（断言 `data-placement-mode`/`data-mode`）。② 这三个测试中 `question`/`option` 的**唯一**命中是无关 fixture 文本 `'unfinished question'`（`overlay-measurement.spec.tsx:327,330,344`）⇒ **没有任何测试**把 `QuestionCard` 选项行放进 bottom-sheet 模式。③ `QuestionCard` 的 C1–C5（`tests/side-chat-surface.spec.tsx:712-891`）不涉及 placement/viewport。④ E2E viewport 恒为 `1440×900`（`e2e/repro-btw-question.mjs:79`）⇒ 真机也未走过该分支。⑤ 补充事实：`side-chat.module.css` 的 4 个 media 块（`:519-521`、`:699-702`、`:704`、`:706`）**不含任何 `.questionOption*` 规则**，bottom-sheet 只改抽屉圆角（`:524-526`）与 scrim 显隐（`:700`）⇒ 选项行 CSS 与视口无关，「未验证」的风险落在 scrim/指针层（`bottom-sheet` 下 scrim 是否吞点击）而非选项行样式。 |
| 真实 GUI **多选** 未覆盖；「仅单测 + 离线 harness」准确 | **属实** | ① `e2e/repro-btw-question.mjs:48`（`PROMPT`）逐字「单选（single select）」；`:49` 重试串同为单选。② `grep -rn "multi\|多选" .workspace/btw-question/e2e/*.mjs` → **0 命中**（compare-main-question / measure-option-visual / preview-u8 / verify-skill-scope 均无）。③ 产物侧证据：`e2e/2026-09-23T08-03-24-466Z-final.json` 的 `optionsAtStart` = `role:"radio"` ×2（单选卡），`optionCount=2`。④ 单测确有覆盖多选：C3（`spec:824-843`，多选点 1、2 ⇒ `['true','true']`）、C5（`spec:867-891`，`.questionOptionCheck` ×2 + 勾图标随 `aria-checked`）；离线 harness 亦有：报告 `exec-report.md:245`（多选版黑底白勾）。⇒ 汇报的「仅单测 + 离线 harness」对多选**准确**。⑤ **无漏报**：不存在"真机跑过多选但汇报漏报"的情形。 |
| 真实 GUI「回答后再提问」重挂未覆盖 | **属实（但需精确化：单测已锁"换 questionId ⇒ 重挂清零"，缺的是"先解答再收到新题"的完整真机循环）** | ① 单测 C2（`spec:809-822`）：`pending(QUESTION_ID)` → 点选项 0 ⇒ `['true','false']`，改 `pending('2222…')` 重新 render ⇒ 断言 `['false','false']`。**它走的是 `SideChatSurface` 真调用点（含 `key`），所以"换 questionId ⇒ 重挂/清零"已被锁定**；独立档反向验真亦证实（删 `key` ⇒ C2 失败，收到 `['true','false']`；`xaudit-code.md:86,170-181`）。② **但 C2 不经**「`pendingQuestion` 先消失（作答）→ 再出现新批次」这一段：全 spec 无 `pendingQuestion: undefined` 的过渡断言，也无 `answer()` 提交流程的 UI 断言（`controller.answer` 在 `spec:753` 仅为 mock）。③ 真机侧：E2E 每轮只提问一次、只点一个选项、不提交（`repro-btw-question.mjs:160-196`），且脚本不发送答案 ⇒ 真机确未走完"解答→再提问"。⇒ 汇报的限定语「真实 GUI」是必要且准确的；若脱掉限定语写成"重挂未覆盖"则不实。 |
| 选项行**键盘/焦点序**未覆盖 | **属实** | ① `grep -n "Tab\|focus\|keyboard" spec` 的命中集中在**抽屉销毁确认**的焦点陷阱：`spec:223`「keeps destructive confirmation keyboard-contained」、`:233/:239`（`Tab`/`Shift+Tab` 派发）、`:245/:257/:269`（focus 归还/抢夺）——**全部打在 End 确认对话框与抽屉**，与选项行无关。② `C1–C5`（`:712-891`）**零**键盘/焦点断言（`grep` 只见 `role`/`aria-checked`/`className` 断言）。③ 全仓测试无 Tab 序列/roving tabindex 断言。 |
| 「未覆盖」是纯测试缺口还是**真实缺陷**（ARIA APG 判定） | **纯测试缺口 + 上游同款偏差；btw 侧无本批引入的键盘缺陷** | ① ARIA APG 对 `radiogroup` 要求 roving tabindex + 方向键移动选择；btw 用原生 `<button>`（天然可 Tab、Enter/Space 可触发 `onClick`，`SideChatSurface.tsx:130-137` 的 button 带 `onClick`），因此**键盘可操作、但不符合 radiogroup 惯例**（Tab 会逐个停留、方向键无作用）。② **官方实现同样如此**：`@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:523`（`role: multiSelect === true ? "group" : "radiogroup"`）、`:527-535`（原生 `button` + `role:"radio"|"checkbox"` + `aria-checked`）、`:537-541`（选项行唯一 `onKeyDown` = Enter 提交，非方向键）；全 bundle **无** `tabIndex` 命中。③ 官方 `QuestionFlow` 甚至**零 `useEffect`**（`grep -c useEffect` = 0），与 D29 的"官方同款"引用一致。⇒ 结论：选项行键盘面**与官方契约一致**，"未覆盖"是**测试/E2E 缺口**；不应把 radiogroup 的 APG 偏差记成 btw 新缺陷（要改就得连官方契约一起偏离，需用户裁决）。 |

### Q3 D29 的状态声明是否与事实一致（可核项）

| 子声称 | 判定 | 实测证据 |
| --- | --- | --- |
| served md5 = `88de97e6c22fc6de9ebd61cb27e5779f` | **属实** | `curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js` → `200`、`md5sum` = `88de97e6c22fc6de9ebd61cb27e5779f` |
| 体积 363 814 B | **属实** | `curl -w '%{size_download}'` = `363814`；`stat -c %s dsh-btw/lib/client.js` = `363814` |
| `?rev=3980d1322992` | **属实** | `sha1sum dsh-btw/lib/client.js \| cut -c1-12` = `3980d1322992`；boot HTML `curl -s http://127.0.0.1:3080/` 中 `dsh-btw/client.js?rev=3980d1322992` 命中 1 处 |
| 「served == 部署位 == 仓库」 | **属实** | 三处 md5 同为 `88de97e6c22fc6de9ebd61cb27e5779f`，体积同为 363 814 B、mtime 同为 `2026-09-23 16:03:01`（仓库 `dsh-btw/lib/client.js`、`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`、HTTP 响应体 `/tmp/served-btw-now.js`） |
| 响应头 `cache-control: no-cache` | **属实** | `curl -s -D -` → `cache-control: no-cache`（无 ETag/Last-Modified） |
| 「未重启 dsh」 | **属实** | `ps -eo pid,lstart,cmd` → `dsh web` 主进程 pid 2649213 启动于 **10:09:52**，而部署位文件 mtime **16:03:01** ⇒ 部署晚于进程启动，进程未重启 |
| 真机 E2E `PERSISTED firstOn=185 ms firstOff=null on=55/55` | **属实** | `e2e/2026-09-23T08-03-24-466Z-final.json`：`samples` **55** 条、`active:true` **55** 条、`firstOnMs=185`、`firstOffMs=null`、`verdict=PERSISTED`、`onSampleRatio="55/55"`、`pageErrors=[]`；对照 `e2e/2026-09-23T03-24-41-842Z-before.json`：`onSampleRatio="2/56"`、`firstOnMs=166`、`firstOffMs=270`、`ariaPressed`（旧契约）✅ |
| `25 files / 250 passed / 2 skipped` | **部分核实** | 静态逐项吻合：`ls dsh-btw/tests/*.spec.*` = **25**；Linux 下 `it.skip` 恰好 **2** 处（`tests/sign-contract.spec.ts:46 itOnDarwin`、`:47-49 itOnStrictDarwin`，使用点 `:193`、`:230`）；独立档复跑记录一致（`xaudit-code.md:120`「Test Files 25 passed (25) / Tests 250 passed \| 2 skipped (252)」）。**我本人未复跑 vitest**（只读纪律：运行会写 node_modules 缓存） |
| 回滚钩子 `preimage-U8/client.js` = `241b04c4…` / 363 701 B | **属实** | `md5sum` = `241b04c412be6fbca37048dcf3974589`、`size=363701`（`INDEX.md:28,20` 所述一致） |
| **无法核实** | — | 「首跑，无 flake」（首跑属性不可回溯）；「C1 回归锁独立交叉审计两次反向验真且已字节还原」的**还原后字节**（`xaudit-code.md:160-168` 给了 sha256/`cmp` 记录，但我未复算该 sha256 与还原动作的时序） |

### Q4 D30 引用行号 + 推断后果表述

引用行号核对（注意：notebook 行内写的是**包内相对路径** `src/...`；仓库根**没有** `src/`（`ls -d src` → 不存在），实际文件在 `dsh-btw/src/...`）：

| 引用 | 判定 | 行内容 |
| --- | --- | --- |
| `src/host/side-chat-service.ts:916` | **准确** | `dsh-btw/src/host/side-chat-service.ts:916` = `additionalProperties: true,`（questions item）；同段落 `:926` 是 options item 的 `additionalProperties: true` |
| `:961` | **准确** | `:961` = `const questions = (args as { questions: BtwQuestion[] }).questions`（类型断言，无 parse） |
| `:980` | **准确** | `:978-980` = `entry.pendingQuestion = { questionId, questions, … }`；`:967` = `const questionId = randomUUID()` |
| `src/remote-descriptors.ts:32-34` | **准确（核心行是 :32）** | `dsh-btw/src/remote-descriptors.ts:32` = `result: { mode: 'strict' as const, typeSymbol, schema: resultSchema }`；`:33-34` 是 `sourceLocation` 与收尾括号；`read` 描述符在 `:39` |
| `src/shared/remote.ts:146,153` | **准确** | `:146` = `btwQuestionSchema` 的 `.strict()` 收尾；`:153` = `btwPendingQuestionSchema` 的 `.strict()` 收尾（两者 `.strict()` 语义见 `:137-153`）；引用链成立：`readSideChatResultSchema`（`:164-178`）在 `:174` 用 `btwPendingQuestionSchema.optional()`，外层 `:176/:177` 亦 `.strict()` |
| 「机制已确证」 | **属实（读源确证，且我补证了工具侧不剥离多余键这一环）** | `dsh-tools` 的 JSON-schema 校验器**仅在 `additionalProperties === false` 时**把多余键判为违规（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:465-466`），开放 schema 的类型文档为 `… & Record<string, JsonValue>`（同文件 `:1511`）⇒ `additionalProperties: true` 的 item **不会被框架剥离**，多余键可一路进入 `entry.pendingQuestion.questions` |
| 推断句「推断为 read 失败/抽屉读取报错，**而非静默降级**」（`program-notebook.md:275`，源 `audit-b-official-ui.md:298`） | **部分不实（与代码不符）** | 读码链：宿主自我校验业务结果 ⇒ `decode(descriptor.result, result, "result-invalid", …)`（`~/.npm-global/.../dsh-api-gateway/lib/index.js:112`、`:342-355` 抛 `TypertGatewayError`）⇒ RPC 层包成 `{ok:false,error}`（`:132-134`）⇒ 客户端 `remote.read` 得 `ok:false`（`…/dsh-api-gateway/lib/client.js:243-252`）⇒ `dsh-btw/src/client/controller.ts:692` `if (!result.ok) throw new Error(remoteFailure(result.error))` ⇒ **被 `poll()` 的 catch 吞掉：`:741-744` 只有 `console.warn('[dsh-btw] transcript read failed', error)` + `delay = 1_200`，不 publish、不置 `phase:'error'`**。⇒ 稳态（提问待答期间每 220 ms 轮询，`:723`）的**用户可见**症状是**静默停摆**：转录停止刷新、`pendingQuestion` 永不 publish（`:738`）⇒ 问题卡不出现、该次 `btw_ask_user` 永久挂起；**仅当**失败发生在「关抽屉再打开」的 restore 读路径时才会 published 可见 error（`controller.ts:623-678`，`:666-678` 置 `phase:'error'`）。⇒「抽屉读取报错」不成立于主路径，「而非静默降级」方向说反了。**P1**（D30 登记文本；被审句未复述该推断，故汇报句在此无独立错误） |

**D30 行建议改法（可直接替换该行末段）**：
> 机制为读源确证（工具侧 `additionalProperties: true` 不剥离多余键 ⇒ 存进 `entry.pendingQuestion.questions` ⇒ `sideChat/read` 结果 strict 校验失败，宿主返回 `result-invalid`）；**可观察后果未实测**。读码判断：客户端 `controller.poll()` 对 read 失败**只 `console.warn` 并按 1 200 ms 重试、不发布 error 态**（`dsh-btw/src/client/controller.ts:741-744`）⇒ 预期症状是**抽屉转录停更 + 问题卡不出现 + 该次 `btw_ask_user` 永久挂起**（近乎静默）；只有在「关抽屉再打开」的 restore 读路径上才会 published 可见错误（`:666-678`）。

### Q5 其它不实 / 过度声明 / 时效漂移（按严重度）

| 级别 | 事实 | 证据（file:line） |
| --- | --- | --- |
| **P1** | `verify-runbook.md:28` 判据「选项行**不再有硬编码绿 `#b7e85b`**」与源码冲突、且与同段 `:29` 判据③矛盾——`side-chat.module.css:365`（U8，用户裁决）把**选中序号徽标**（选项行元素）显式设为 `background: #b7e85b`；按 `:28` 验收会把正确部署判成失败。同时 `:28` 的括注「其它 23 处仍在用」计数不准：实测 `grep -c b7e85b` = **24 行**，其中 `:228` 是注释、`:365` 是选项行徽标 ⇒ 非选项行的真实用法 = **22 处** | `docs/runbooks/verify-runbook.md:28`、`:29`；`dsh-btw/src/client/side-chat.module.css:365`（另 `:228` 注释、`:334/336/340/248` 等） |
| **P1** | `xaudit-docs.md:65-69`（O6）称 `#b7e85b` 在 CSS 中「仍有 **8 处**」并只列 9 个行号——与实测 24 行命中不符；其**实质结论**（当时"选项行已无绿"）成立（`:365` 是后来 U8 新增），但计数错误、且该结论在今天**已被 U8 推翻**，凡引用 O6 的下游改稿须重写 | `.workspace/btw-question/xaudit-docs.md:65-69`；对比 `dsh-btw/src/client/side-chat.module.css:365` |
| **P2** | `exec-report.md:291`（§8.1）「**修复后的真实 GUI 端到端未测** …… 这是本次唯一的实质空白」已过期且与其自身 `:71,:278` 冲突（后者已记「部署已由有写权限方落地」）；事实是 12:02 起已有 `PERSISTED` 实测（`e2e/2026-09-23T04-02-20-233Z-after.json` 56/56、`…08-03-24-466Z-final.json` 55/55），notebook/INDEX/arch05 均已按新事实更新 | `.workspace/btw-question/exec-report.md:14,71,278,291`；`.workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after.json`；`docs/program-notebook.md:274,292` |
| **P2** | `INDEX.md:20` 的修订点描述（「runbook `:56` 应为 `241b04c412be6fbc…`」、「notebook §8 补『修复后真机未验收』」）是**历史快照**，与终态冲突：`verify-runbook.md:57` 现写 `88de97e6c22fc6de9ebd61cb27e5779f`，`program-notebook.md:292` 现写「已真机验收」。文件尾 `:22-29` 已给终态，但 `:20` 未标注"当时状态" | `.workspace/btw-question/INDEX.md:20` vs `docs/runbooks/verify-runbook.md:57`、`docs/program-notebook.md:292` |
| **P2** | `verify-runbook.md:28` 括注的绿计数（23）与 `:19-30` 其它判据口径不一致（同一节里 `:29` 用"绿徽标"、`:30` 用"外壳仍绿"，只有 `:28` 用"选项行无绿"）——建议统一为"**选项行交互面（底/边/文字）无硬编码绿；选中徽标为 btw 绿（U8 有意）**" | 同上 `docs/runbooks/verify-runbook.md:19-30` |
| **P2** | D30 行路径写法与 D29 行体例不一致：D29 用全限定 `dsh-btw/src/...`，D30 用包内相对 `src/host/side-chat-service.ts`；仓库根无 `src/`（`ls -d src` → 不存在）⇒ 读者可能误判路径 | `docs/program-notebook.md:274` vs `:275` |
| **观察（非缺陷）** | `INDEX.md:14`「部署被沙箱边界挡住，待用户执行」同为历史条目（终态见 `:23`）；`FEATURE-MAP.md:25`「测试面从**零**覆盖补到 C1–C5」属实——`git diff --stat` 显示该 spec 本次为 **+193 / −0**，新增块全部在 `describe('QuestionCard option rows')`（`spec:712-891`），此前该组件在该文件内确无覆盖 | `.workspace/btw-question/INDEX.md:14,23`；`FEATURE-MAP.md:25`；`dsh-btw/tests/side-chat-surface.spec.tsx:712-891`；`git diff --stat -- dsh-btw/tests/side-chat-surface.spec.tsx`（193 insertions） |
| **观察（已复核为真，勿改）** | ① `arch05:81` 的「token/计算样式层与官方相同 + 保留基态边框差异」措辞与实测一致；② `arch05:167` 的缓存头"按实测拆分"与我的 `curl -D -` 结果一致（插件 bundle `cache-control: no-cache`；`?rev=` 非有效缓存键）；③ `INDEX.md:27`「notebook D29/**D30**/§8 第 11 条」措辞正确；④ `plan.md:105`（U6.6）明确写「在 notebook **§7** 增 D30」⇒ 登记位置自始就是 §7，非 §8 | `docs/architecture/05-performance-and-ux-program.md:81,167`；`.workspace/btw-question/INDEX.md:27`；`.workspace/btw-question/plan.md:105` |

---

## 应修订的文档清单（可直接执行）

| # | 位置 | 现状 | 建议改成 |
| --- | --- | --- | --- |
| 1 | `.workspace/btw-question/INDEX.md:29` | `**未覆盖**：窄屏 bottom-sheet 选项行、真实 GUI 多选、真实 GUI 换题重挂、键盘导航、D30 后果（均登记 notebook §8）。` | `**未覆盖**：窄屏 <720 px bottom-sheet 选项行、真实 GUI 多选、真实 GUI 换题重挂、选项行键盘/焦点序（**四项登记 notebook §8 第 11 条**）；D30 的实际后果（登记在 **notebook §7 的 D30 行状态列**，§8 无该条）。` |
| 2 | `docs/program-notebook.md:292` 之后（新增第 12 条） | §8 共 11 条，D30 无对应条目（与 §8 对 D26/D27/D29 的交叉引用惯例不一致） | 追加：`12. **D30 的可观察后果**：机制（工具侧 open schema 放行 ⇒ 存进 pending ⇒ read 结果 strict 校验失败）**已读源确证**；用户可见形态**未实测**。读码判断：客户端 `controller.poll()` 对 read 失败只 `console.warn` + 1 200 ms 重试、不发布 error 态（`dsh-btw/src/client/controller.ts:741-744`）⇒ 预期症状为抽屉转录停更 + 问题卡不出现；仅关抽屉重开的 restore 读路径会 published error（`:666-678`）。` |
| 3 | `docs/program-notebook.md:275`（D30 行末段） | `机制为读源确证；**可观察后果未实测**（推断为 read 失败/抽屉读取报错，而非静默降级）。` | `机制为读源确证（工具侧 `additionalProperties: true` 不剥离多余键 ⇒ 存进 `entry.pendingQuestion.questions` ⇒ read 结果 strict 校验失败，宿主返回 `result-invalid`）；**可观察后果未实测**。读码判断：主路径（`controller.poll()`，`dsh-btw/src/client/controller.ts:741-744`）只 `console.warn` + 1 200 ms 重试、**不发布 error 态** ⇒ 预期为近乎静默的停摆（转录停更、问题卡不出现、该次 `btw_ask_user` 挂起）；只有 restore 读路径会 published 可见错误（同文件 `:666-678`）。` |
| 4 | `docs/runbooks/verify-runbook.md:28` | `选项行**不再有硬编码绿 `#b7e85b`**（该色在 `side-chat.module.css` 其它 23 处仍在用）。` | `选项行的**交互面（底/边/文字）**不再有硬编码绿 `#b7e85b`；**选中序号徽标**为 btw 绿实心（U8 用户裁决，见判据③）。该色在 `side-chat.module.css` 另有 **22 处**非选项行用法仍在用。` |
| 5 | `.workspace/btw-question/exec-report.md:291` | `1. **修复后的真实 GUI 端到端**（点击后 `aria-checked` 持续保持 ≥3 s）**未测** —— 前置条件是部署落地（§7.1）。这是本次唯一的实质空白。` | `1. **【已由后续运行补齐】** 修复后的真实 GUI 端到端（`aria-checked` 持续 ≥3 s）**本档未做**；收口后已由协调者实测为 `PERSISTED`（`e2e/2026-09-23T04-02-20-233Z-after.json` = 56/56、`e2e/2026-09-23T08-03-24-466Z-final.json` = 55/55，firstOn 185 ms）。本档 §8 的其余条目（窄屏/多选/换题/键盘/D30）仍有效。` |
| 6 | `.workspace/btw-question/INDEX.md:20` | 未标注为历史状态的一串修订点（runbook `:56` 应为 `241b04c4…`；notebook §8 补「修复后真机未验收」） | 在该条前加 `（**当时状态快照**，终态见下方「终态」节：runbook `:57` 现为 `88de97e6…`、notebook §8 第 11 条现为「已真机验收 + 4 项未覆盖」）` |
| 7 | `.workspace/btw-question/xaudit-docs.md:65-69`（O6） | `「仍有 **8 处** `#b7e85b`（…9 个行号…）」` | `「当前实测 **24 行**命中 `#b7e85b`（含注释 1 处 `:228`、选项行徽标 1 处 `:365`）；审阅当时（U8 之前）非注释命中为 23 行，其中选项行 0 处」`；并注明 `:365` 为 U8 有意新增，故「选项行无绿」仅在 U8 之前成立。 |
| 8 | `docs/program-notebook.md:275`（路径体例） | `src/host/side-chat-service.ts:916,961,980`、`src/remote-descriptors.ts:32-34`、`src/shared/remote.ts:146,153` | 统一加包前缀：`dsh-btw/src/host/side-chat-service.ts:916,961,980`、`dsh-btw/src/remote-descriptors.ts:32-34`、`dsh-btw/src/shared/remote.ts:146,153`（仓库根无 `src/`） |
| 9 | 被审汇报句本身（若再次对外引用） | 见文首原文 | 见 Q1「被审句改成什么才算准确」（把 D30 的登记位置与其余 4 项分开写） |

---

## 我无法核实的项

1. **`25 files / 250 passed / 2 skipped` 的通过数**：未复跑 `vitest`（只读纪律；运行会写 node_modules 缓存）。可核部分：25 个 spec 文件、Linux 下 2 个条件 skip（`tests/sign-contract.spec.ts:46,47-49` → `:193,:230`）；另有独立档复跑记录（`xaudit-code.md:120`）与之逐字一致。
2. **「首跑，无 flake」**：首跑属性不可回溯核实（后续多次运行只能证明复现性，不能证明"首跑"）。
3. **C1 反向注入两次实验的"字节还原"是否在时序上成立**：`xaudit-code.md:160-168` 给了 sha256/`git diff \| md5sum`/`cmp` 记录，但我无法在不写文件的前提下复算当时的还原动作；当前工作区源码状态与 `:605` 的 `key` 在位、`grep "pendingQuestion.questions]"` = 0 命中，与"已还原"一致。
4. **D30 的用户可见后果**：本次只做**读码判断**（明确不抢实测档的活）。我已确证失败链与客户端的吞错路径，但"症状究竟是转录停更 / 问题卡不出现 / 该次 `btw_ask_user` 挂起"未经真机观测；另有一个我**未验证**的环节：工具调用参数在模型侧→框架侧是否存在我未读到的第三层剥离/规范化（我只读到 `dsh-tools` 校验器在 `additionalProperties:true` 时不判违规、类型文档为开放记录，`dsh-tools/lib/index.js:465-466,1511`）。
5. **`Ralph`/`workflow` 无关；`arch05` 与 `05-performance-and-ux-program.md` 的 git 跟踪状态**：该文件在本仓库为 **untracked**（`git status --porcelain` → `?? docs/architecture/05-performance-and-ux-program.md`），因此我无法用 `git diff` 核对其历史行文，行号引用基于当前文件内容。
6. **`e2e/2026-09-23T03-20-58-748Z-before-error.json`**（458 B 的 ERROR 记录）与 `preview-u8` 系列的实际执行者/时序：产物存在，但无法核实其归属哪一档执行（不影响本报告结论）。
