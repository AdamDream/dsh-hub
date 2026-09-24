# btw 问答卡片问题闭环 — 协调者索引（事实基线）

用户诉求（2026-09-23）：「查阅一下 notebook，目前 btw 的问答工具好像并不和主会话一致，我点击选项以后按键并没有持久化改变颜色」

目标（goal-6a07d6f5-5d69-40c0-8d7a-e0d9ac9f651a）：查清机制级根因 → 细粒度修复单元 → 落地最小修复（保留观感）→ 验证 → 同步 notebook/architecture。

## 阶段产物
| 档 | 文件 | 内容 |
| --- | --- | --- |
| 审计 A | `audit-a-state.md` | btw 问答卡片状态生命周期根因（**已落盘**：根因确认 = effect 依赖不稳定数组身份 + 220ms 轮询；推荐官方同款 `key={questionId}` + 删 effect） |
| 审计 B | `audit-b-official-ui.md` | 官方契约与复用可行性（**已落盘**：复用不可行——三重封死；给出 P0 CSS 6 条 / P1 结构+aria 8 条 / P2 需裁决 4 条） |
| 审计 C | `audit-c-docs-deploy.md` | notebook 现状 + 部署/生效链路 + 测试面（**已落盘**：必须同步 D29/arch05 指纹/verify-runbook/FEATURE-MAP；构建=`pnpm build` 整包 + 只拷 `lib/` + 刷新，无需重启） |
| 交付单元 | `plan.md` | 协调者定稿的 U1–U7（可直接执行） |
| 执行档 | `exec-report.md` | 修复 + 自复核（含 E2E before/after）——**代码/构建/测试完成；部署被沙箱边界挡住，待用户执行**（**当时状态快照**，终态见下方「终态」节：部署已落地并真机验收；另见「D30 收口」与「真机补测收口」节） |
| 交叉审计（代码面） | `xaudit-code.md` | U1/U2/U3 均落地无新增缺陷；**反向验真实测**：注入旧 effect ⇒ C1（轮询后断言）必失败、删 key ⇒ C2 必失败，均已字节还原；指出 1 处报告不实（aria-pressed 全仓 0 命中）、1 处过度声明、1 处未记录行为变更 |
| 交叉审计（文档面） | `xaudit-docs.md` | 无"已生效"类错误；U6 逐条基本达标；O1–O7 过度声明清单 + 2 项漏项 |

## 协调者裁决（交叉审计后，2026-09-23）
- **O1 驳回**：文档审计称"官方无 React key、`key={question.key}` 是误引"——**错**。主代理独立核实官方 bundle 编译产物：`react_jsx_runtime.jsx(QuestionFlow, { pending, t }, question.key)`，**第三参即 React key**（另有 `useMemo(…,[props.matched])`、`useEffect` 0 次）⇒ D29 的"官方同款修法"成立，不改。
- （**当时状态快照**，终态见下方「终态」节） **O2–O7 + 2 项漏项 采纳**，已派回原执行档做单一写入者修订（只动文档/报告，**不动源码与 lib**，以保住已交付的部署核对值 `241b04c412be6fbca37048dcf3974589` / 363701 B / `?rev=93d7907f1e76`）。修订点：arch05 `:81` 证据分层措辞 + "逐值相同"限 token/计算样式层（渲染态有差异：官方基态边框 transparent、btw 基态 border-l2、选中底叠绿壳）；verify-runbook `:19` 判据② 改为**可判别**口径（`role`/`aria-checked` 持续 ≥3s + 50ms 采样协议，因旧包 hover 与新包选中底**同值**、单看颜色不可判别）、判据④ 限作用域（`SideChatButton.tsx:33` 仍合法有 `aria-pressed`）、"不再有绿色"限选项行；arch05 `:167` 缓存头按实测拆分（壳层无 / 插件 bundle `cache-control: no-cache`）；D29 补"`setError(null)` 随 effect 删除 ⇒ error 不再被轮询清空"；notebook §8 补"修复后真机未验收"；exec-report 更正 hover 归因（同值 ⇒ 非根因，属特异性加固）、`NEVER-ON` 降级为推断、aria-pressed 措辞。**逐条终态对照（见下方「终态」节 `:22-29`）**：runbook 的部署核对值现为 **`:57` = `88de97e6c22fc6de9ebd61cb27e5779f`**（快照当时要求的是 `241b04c4…`；**2026-09-23 18:23 后进一步变为 `66beb3455c59f4991355f3918228e495` / `?rev=887a12106dcd`，见下方「D30 收口」节**）；notebook §8 第 11 条现为「**D29 已真机验收 + 4 项未覆盖**」（快照当时要求补的是"修复后真机未验收"）；括注里的 `241b04c4…` / 363701 B / `?rev=93d7907f1e76` 是**快照当时的部署位**，终态为 `88de97e6…` / 363 814 B / `?rev=3980d1322992`。

## 终态（2026-09-23 收口）
- **终版产物**：`88de97e6c22fc6de9ebd61cb27e5779f` / 363 814 B / `?rev=3980d1322992`，**served == 部署位 == 仓库**，未重启 dsh。
- **真机验收**：修复前 `REVERTED firstOn=166ms firstOff=270ms on=2/56` ⇒ 终版 **`PERSISTED firstOn=185ms on=55/55`**（`e2e/*-before.json` vs `e2e/*-final.json`）。
- **观感**：选中徽标 btw 绿实心 + 深色数字（徽标区均差 53.55/255；仅靠官方选中底只有 13.01/255）；选项基态文字补成官方主色 `rgb(15,17,21)`。
- **交叉审计**：`xaudit-code.md`（U1–U3 落地、两次反向验真）、`xaudit-docs.md`（O1 驳回、O2–O7 + 2 漏项采纳并已修订）。
- **文档同步**：notebook D29/D30/§8 第 11 条、arch05 §3/§7、verify-runbook §5 判据、FEATURE-MAP §一；另含 skill 全局化（notebook §6 + arch02 §8）。（**后续 D30 批次又更新**：notebook §7 D30 行重写 + 新增 D31/D32 + §8 新增第 12 条 + §6 索引 3 行、verify-runbook `:19-30` 判据修正 + 新增判据 9/10、arch05 §3/§7/§8、FEATURE-MAP `:25`；见下方「D30 收口」节与 `.workspace/btw-question/exec-docs/report.md`）。
- **回滚**：`preimage-U8/client.js`（=`241b04c4…`）/ `preimage-lib-20260923-113216/`（=`6c29b98b645d`，修复前）。
- **未覆盖**：窄屏 <720 px bottom-sheet 选项行、真实 GUI 多选、真实 GUI 换题重挂、选项行键盘/焦点序（**四项登记 notebook §8 第 11 条**）；**D30 的实际后果**（登记在 **notebook §7 的 D30 行状态列**，§8 无该条）。

## D30 收口（2026-09-23 18:05–18:29，独立于上面 D29 批次）
- **修法（用户裁决：工具边界 codec 自校验 fail-closed）**：`dsh-btw/src/host/side-chat-service.ts` 的 `btw_ask_user.execute` 内用**与下发同一 schema**（`btwPendingQuestionSchema.safeParse`）自校验，失败抛**可纠正**错误（issue path/code + 合法键清单 + `multi_select` snake_case 提示、**不回显 payload**）且**不写 pending**；`dsh-btw/src/shared/remote.ts` 的**选项项内层补 `.strict()`**（修复前选项项多余键只被静默 strip、**爆点只在题目项层**）。
- **客户端同批加固**：`readError?` 状态 + 连续失败阈值 3（`READ_FAILURE_NOTICE_AT`）⇒ 非阻塞提示「实时更新已暂停，正在重试」（locale 键 `drawer.readRetrying`），成功读自动清除、`phase` 仍为 `open`。
- **测试**：全量 `vitest run` = **25 files / 260 passed / 2 skipped (262)**（新增 10 例：宿主 7 + 客户端 3）；反向验真 3 处均得预期失败并逐字节还原。
- **产物与部署**（本档亲测复核）：
  - `dsh-btw/lib/client.js` = `66beb3455c59f4991355f3918228e495` / **365 269 B** / `?rev=887a12106dcd` —— **served == 部署位 == 仓库，热面已生效**（本轮 `curl` 复核：HTTP 200 / 365 269 B / md5 同值）。
  - `dsh-btw/lib/index.js` = `e1437b3ba7de953811e65c47d5b392e5` / **67 542 B** —— **已部署但宿主未重启 ⇒ 未生效**（宿主进程启动于 10:09:52，部署位 mtime 18:23:20）。
  - 上一版：`client.js` `88de97e6c22fc6de9ebd61cb27e5779f` / 363 814 B、`index.js` `6ae7bfcf42fe49763a192c54c5f87c02` / 65 970 B。
- **回滚钩子**（仅本机、**不入库**）：`.workspace/btw-question/preimage-lib-20260923-182907-pre-D30/`（client.js `88de97e6…`、index.js `6ae7bfcf…` + `SHA256SUMS.txt`；被 `.gitignore` 的 `preimage-*` 规则排除）。
- **证据**：`.workspace/btw-question/d30-consequence.md`、`.workspace/btw-question/d30/`、`.workspace/btw-question/exec-d30/report.md`。

## 真机补测收口（2026-09-23 18:40–18:49，独立实测档）
- **范围**：notebook §8 第 11 条遗留的 4 项「未覆盖」⇒ **4 项全部真机补测 PASS**（T1 多选 / T2 回答后再提问重挂 / T3 窄屏 bottom-sheet 选项行本体 / T4 选项行键盘与焦点序）。
- **被测版本已取证**：页面实际加载 `?rev=887a12106dcd`、md5 `66beb3455c59f4991355f3918228e495` / 365 269 B、4 轮 **0 pageerror**（客户端面；**宿主面 `index.js` 未重启 ⇒ 本批不构成对宿主新代码的验证**）。
- **关键数字**：T1 = `role=group` + 3×`role=checkbox`、**59/59（2 967 ms）**、提交后卡片 1 ms 内消失；T2 = 草稿全清 + 题干/选项全变、**59/59（2 974 ms）**；T3 = **2 ms** 内 `right`→`bottom-sheet`、bbox 全在视口内、**59/59（2 963 ms）**、未被 scrim 吞点击；T4 = Space **59/59** / 再按 **0/59** / 第三次 true、Enter 可切换且未误提交、方向键无效。**官方真机对照逐项一致**（APG 偏差为上游同款）。
- **新登记缺陷（未修，用户裁决另开一轮）＝ notebook §7 D33**：窄屏 bottom-sheet 下抽屉内容溢出、控件不可达（640×800：`scrollHeight 633 > clientHeight 370`、「停止」/输入框 `elementFromPoint=null`；1440×900 正常）。**不是本批引入的回归**（`sheetHeight` 与 `HANDLE_MIN_VIEWPORT` 分支与 HEAD 逐字相同）。
- **仍未判定**：5 条（React 重挂机制不可观测 / 待答时输入框 disabled 致锚点不可构造 / 窄屏仅 640×800 一档 / 官方多选 checkbox 未做真机对照 / Shift+Tab 反向不镜像）——详见 `docs/program-notebook.md` §8 第 11 条。
- **证据**：`.workspace/btw-question/e2e-cover/report.md`、`raw-*-T1/T2/T3/T4.json`、`raw-*-T4b.json`、`raw-*-T3-extra.json`、`raw-*-T4-enter.json`、`t3-geometry-probe.mjs`（**该目录只读引用，非本档写入面**）。

## 修复前 E2E 实证（协调者实测，已验证）
- `e2e/2026-09-23T03-24-41-842Z-before.json`：`VERDICT=REVERTED firstOn=166ms firstOff=270ms on=2/56`；点击后 `questionOptionActive` + `background rgba(183,232,91,0.12)` 只存活 ~104ms 即被抹回基态 ⇒ 与 220ms 轮询吻合。
- 主会话官方卡片参照物：`e2e/2026-09-23T03-26-30-367Z-main-ref.json`（`role=radio`/`aria-checked`、选中 `rgba(38,49,72,0.06)` + `rgba(0,0,0,0.1)` 边框、序号徽标 1/2、`min-height 40px`/`radius 12px`）。

## 用户裁决（2026-09-23）
- 范围 = **A：修持久化 + 观感/语义向主会话对齐**（不做结构性复用）。
- **只对齐选项行，卡片外壳保留 btw 绿色身份**。
- 允许 headless E2E 实证（会新建临时会话）。

## 协调者已独立验证的事实（带 file:line）
1. **btw 问答卡片是自绘的**，不是官方组件：`dsh-btw/src/client/SideChatSurface.tsx:60-173`（`QuestionCard`），选中态类 `.questionOption` / `.questionOptionActive`，样式在 `dsh-btw/src/client/side-chat.module.css:345-354`（active 用 `color-mix(in srgb,#b7e85b 12%,transparent)`，硬编码色，非 `--dsw-alias-*` token）。
2. **主会话走官方插件** `@deepseek-ai/dsh-client-ui-user-questions`（`.../dsh/node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`，`QuestionFlow`/`QuestionComposer`，`.optionSelected`/`.checkboxChecked`）。
3. **btw 用不了官方 `ask_user_question`（设计如此，U7）**：`dsh-btw/src/shared/tool-policy.ts:1-43` 明确「built-in `ask_user_question` stays OUT on purpose：DELEGATED_CALLER 守卫 + 隐藏子会话无客户端应答作用域」，btw 自带 `btw_ask_user` 通道 ⇒ 卡片「与主会话不一致」有其结构性原因，需要区分「观感对齐」与「复用官方组件」两条路。
4. **根因（高置信，待审计 A 交叉验证）：轮询重置 effect 依赖不稳定数组身份**
   - `SideChatSurface.tsx:74-79`：`useEffect(() => { setDrafts(全空) ; setError(null) }, [pendingQuestion.questionId, pendingQuestion.questions])`。
   - `dsh-btw/src/client/controller.ts:690-747`：`poll()` 定时 `remote.read`，间隔 `delay = running ? 220 : 700`（第 723 行），每次 `publish({...baseState, ..., ...(value.pendingQuestion === undefined ? {} : { pendingQuestion: value.pendingQuestion })})`（第 738 行）——`pendingQuestion` 每次都是**跨 RPC 反序列化出的新对象、`questions` 是新数组**。
   - 后果：提问挂起期间（turn 仍 running）每 ~220 ms 触发一次该 effect → 用户刚点选的 `selected` 被清空 → 选中态颜色「闪一下就没」。
   - 稳定身份只有 `questionId`：`dsh-btw/src/host/side-chat-service.ts:967` `const questionId = randomUUID()`（每次提问一个新 uuid，应答前不变），`side-chat-service.ts:595` 把 `{questionId, questions}` 打包下发。
5. **构建产物与部署副本一致**：`dsh-btw/lib/client.js` 与 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` **md5 相同**（`6c29b98b645df00b8bc3e9279d6df93e`），且该 profile 目录是**实体目录（拷贝）不是符号链接** ⇒ 改完源码**必须重新构建 lib 并同步到 profile 副本**才会在 http://127.0.0.1:3080 生效（审计 C 给出确切命令）。
6. **工作区有未提交的 btw 改动**（drawer resize 批次：`SideChatDrawer.tsx`、`overlay-placement.ts`、`use-overlay-placement.ts`、`lib/client.js` 等为 M；`SideChatResizeHandle.tsx`、`drawer-size*.ts` 为 ??）——执行档**不得回滚这些**，构建要基于当前工作区源码。
7. 可用工具面：Playwright 在 `/home/CNS2026495165/playwright_scratch/node_modules`（只有 playwright/playwright-core）；可复用 runner `dsh-btw` 无关的 `.workspace/lag-fix/exec-mask/tools/panel-compare.mjs`（`URL_ = http://127.0.0.1:3080`，`READY_FN` 见 :259-269）；btw 抽屉按钮选择器 `button[title*="btw"]`（`SideChatButton.tsx:26,34`）。

## 待用户裁决（审计 B 回来后问）
- 范围 A（最小）：修持久化（effect 依赖改为稳定身份）+ 向官方观感/无障碍语义对齐。
- 范围 B（结构性）：评估复用官方 `QuestionComposer`（若审计证明可行）。
