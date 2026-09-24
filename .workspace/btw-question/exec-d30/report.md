# exec-d30 报告 —— D30（btw_ask_user 工具边界 codec 自校验，fail-closed）+ 客户端 read 失败可见化

- 档别：**修订执行复核一体（可写 + 同档自复核）**
- 工作目录：`/home/CNS2026495165/dsh`（包 `dsh-btw` = `@local/dsh-btw`）
- 时点：2026-09-23 18:05–18:27（本机）
- 边界：继承沙箱 `workspace-write`，**未**使用 `sandbox_permissions`；**未**写 `~/.dsh/**`；**未**重启/杀 dsh 进程；**未**执行任何 `git add/commit/checkout/stash`
- 交付单元：U1–U6（逐条落地状态见 §2）
- **自裁决：通过（代码交付面）**，但**必须上报两项环境事实**：① 执行被指定的 `pnpm run lint/typecheck` 时，pnpm 的 pre-run 依赖检查**删除了 `dsh-btw/node_modules` 中 30 个包**，本档已按 lockfile 逐个恢复（§5，含残留不确定项）；② `lib/**` 已按 tsdown 重生成（宿主面 + 客户端面均变化，§6）。
- 未部署、未重启；宿主面改动**需重启 dsh 才生效**（§9）。

---

## 0. 一句话结论

U1–U6 全部落地并逐条实测：宿主在 `btw_ask_user.execute` 里用**与下发 strict codec 同一个 schema**（`btwPendingQuestionSchema.safeParse`）自校验，失败即抛错且**不写 pending**（错误含 path/code/合法键清单 + `multi_select` snake_case 提示，不回显 payload）；共享 schema 的选项项补 `.strict()`；新增 10 条用例（宿主 7 / 客户端 3）把「pending 恒能通过下发 codec」钉住，并让客户端在**连续 3 次** read 失败后给出**非终态**可见提示、成功读后自愈。反向验真三处（U1 去掉 safeParse、U2 去掉 `.strict()`、U4 去掉 publish）**均得到预期失败**，且全部逐字节还原（`sha256sum` 相同 + `cmp` 为空）。全量测试 **25 文件 / 260 passed | 2 skipped**，`oxlint` 0 warn 0 err，`tsc` 三个 config 全 0 退出，`tsdown` 构建成功。

---

## 1. 事实基线与取证来源

| 项 | 值 |
| --- | --- |
| 权威事实文档 | `.workspace/btw-question/d30-consequence.md`（独立档实测取证，本档**未重做**实验，仅引用） |
| 工具边界宽度 | `src/host/side-chat-service.ts` `registerAskBackTool`：题目项 `additionalProperties: true`（改后 `:944`）、选项项 `additionalProperties: true`（改后 `:954`）——**按要求未改** |
| 下发 codec | `src/remote-descriptors.ts:32` `result.mode='strict'` ↔ `src/shared/remote.ts` `readSideChatResultSchema`（改后 `:168`）→ `:178` 的 `pendingQuestion` → `btwPendingQuestionSchema`（`:154-158`）→ `btwQuestionSchema`（`:137-149`） |
| 冻结现象 | 客户端 `controller.poll()` 的 catch（改后 `:774`）只 `console.warn` + `delay = 1_200`（`:786`），不 publish |

---

## 2. 逐单元落地状态

| 单元 | 状态 | 落点 |
| --- | --- | --- |
| **U1** 宿主 `execute` 内 codec 自校验（fail-closed） | ✅ 落地 | `src/host/side-chat-service.ts:55-56`（import）、`:389-412`（`ASK_BACK_ISSUE_LIMIT` + `askBackArgumentMessage`）、`:1003-1005`（铸造 `questionId` + `safeParse` + throw）、`:1021`（存 `checked.data.questions`） |
| **U2** 选项项内层补 `.strict()` | ✅ 落地 | `src/shared/remote.ts:141-148`（`.strict()` 在 `:148`） |
| **U3** 防漂移回归锁（宿主单测） | ✅ 落地 | `tests/host-opening.spec.ts:490-614`（新 `describe('btw_ask_user argument codec lock (D30)')`，7 用例，纯新增 +127 行） |
| **U4** 客户端 read 失败可见 + 可自愈 | ✅ 落地 | `src/client/controller.ts:38`（状态字段）、`:73`（阈值常量）、`:107`（计数器）、`:191`/`:685`（`startPolling` 接入）、`:708-711`（`startPolling` 定义）、`:754`+`:760-761`（成功清零/清除）、`:776`+`:784`（catch 内阈值 publish）；`src/client/locales.ts:8,38,78`（新键）；`src/client/SideChatSurface.tsx:515-519`（非阻塞提示） |
| **U5** 客户端单测 | ✅ 落地 | `tests/controller.spec.ts:805-893`（新 describe，2 用例，+90 行）；`tests/side-chat-surface.spec.tsx:893-913`（1 用例；该文件对 HEAD 的 `+215` 中含既有 D29 用例增量，本档只加末尾 1 例） |
| **U6** 本地验证与产物 | ✅ 落地 | §5（工具链事故与恢复）、§6（命令原始输出 + md5/体积对照） |

**未改**：工具 schema 的 `additionalProperties`（用户裁决走 codec 自校验）；`multi_select` 保持 snake_case；`side-chat.module.css`（复用既有 `sendError` 样式，未动 CSS 文件）；`docs/**`、`FEATURE-MAP.md`、`.workspace/**`（除本文件与 `exec-d30/` 外）、`.gitignore`。

---

## 3. 关键 diff 摘录（含行号）

行号为**改后**文件行号（`git diff` 头显示的 hunk 位置）。

### 3.1 U1 宿主（`git diff -U1 -- dsh-btw/src/host/side-chat-service.ts`）

```diff
@@ -54,2 +54,4 @@ import type {
 } from '../shared/remote.ts'
+import { btwPendingQuestionSchema } from '../shared/remote.ts'
+import type { ZodError } from 'zod'
 import {
@@ -385,2 +387,28 @@ function progressDigestLines(parent: Agent): string {
+/** Issue rows echoed back to the model; beyond this the count is summarized. */
+const ASK_BACK_ISSUE_LIMIT = 5
+
+/**
+ * Correctable rejection text for `btw_ask_user` arguments that the outbound
+ * strict codec would refuse (D30). It names the offending paths and codes and
+ * the legal key set — including the snake_case `multi_select` spelling — but
+ * never echoes the submitted payload itself.
+ */
+function askBackArgumentMessage(error: ZodError): string {
+  const rows = error.issues.slice(0, ASK_BACK_ISSUE_LIMIT).map(issue => {
+    const path = issue.path.length === 0 ? '(root)' : issue.path.map(segment => String(segment)).join('.')
+    const keys = 'keys' in issue && Array.isArray(issue.keys) ? ` [${issue.keys.map(key => String(key)).join(', ')}]` : ''
+    return `- ${path}${keys}: ${issue.code} — ${issue.message}`
+  })
+  const overflow = error.issues.length > ASK_BACK_ISSUE_LIMIT
+    ? `\n… (${error.issues.length} total)`
+    : ''
+  return 'btw_ask_user: these arguments do not match the btw question wire protocol, '
+    + 'so the panel could not display them. Fix them and call again.\n'
+    + rows.join('\n') + overflow + '\n'
+    + 'Allowed keys — question: id, question, header, options, multi_select; '
+    + 'option: label, description. The multi-select key is snake_case `multi_select` (not `multiSelect`); '
+    + 'every `id`, `question`, and option `label` must be non-empty, and `questions` must not be empty.'
+}
@@ -965,4 +993,15 @@ export class SideChatService extends TypertRemoteService {
         }
+        // Fail closed at the tool boundary (D30): the arguments are validated
+        // with the very schema the transcript codec parses on `sideChat/read`, …
+        const questionId = randomUUID()
+        const checked = btwPendingQuestionSchema.safeParse({ questionId, questions })
+        if (!checked.success) throw new Error(askBackArgumentMessage(checked.error))
         return await new Promise<…>((resolve, reject) => {
-          const questionId = randomUUID()
           const settle = () => {
@@ -979,3 +1018,5 @@ export class SideChatService extends TypertRemoteService {
             questionId,
-            questions,
+            // The parsed object graph, so `pendingQuestion` always satisfies
+            // the outbound codec by construction.
+            questions: checked.data.questions,
             resolve: answers => {
```

要点核对（对应用户裁决的 4 条硬要求）：
- (a) 一句话说明线协议不一致 ✅（`these arguments do not match the btw question wire protocol`）；
- (b) 逐条 path + code + message，最多 5 条、超出写 `…（N total）` ✅（`ASK_BACK_ISSUE_LIMIT = 5`）；
- (c) 合法键清单 + `multi_select` snake_case 显式提示 ✅（含 `(not \`multiSelect\`)`）；
- (d) 不回显 payload ✅（只输出 path / issue keys；U3 用例用 `not.toContain('Which scope?')` 钉住）；
- 保留原有「已有待答问题时抛错」守卫（`:993-996`，与 HEAD 逐字相同）；
- 成功路径存**校验后对象图** ✅（`:1021`）。

### 3.2 U2 共享 schema（`git diff -U1 -- dsh-btw/src/shared/remote.ts`）

```diff
@@ -140,2 +140,6 @@ export const btwQuestionSchema = z.object({
   header: z.string().optional(),
+  // Both levels are strict: an undeclared option key must not be silently
+  // stripped here while an undeclared question key is rejected. …
   options: z.array(z.object({
@@ -143,3 +147,3 @@ export const btwQuestionSchema = z.object({
     description: z.string().optional(),
-  })).optional(),
+  }).strict()).optional(),
   multi_select: z.boolean().optional(),
```

**误伤排查（U2 要求）**：
- `grep -rn "btwQuestionSchema|btwPendingQuestionSchema|BtwQuestion\b" src tests` ⇒ 消费者只有 `btwPendingQuestionSchema`（`readSideChatResultSchema`）与宿主 `PendingBtwQuestion.questions`；
- 客户端 `controller.ts:228-256 answer()` 只构造 `{id, selected, custom?}`（`btwAnswerSchema` 形状，**与 options 无关**）⇒ 不受影响；
- 全量 25 文件 260 项通过（含 `tests/remote-contract.spec.ts` 多选题 fixture）⇒ 无既有用例被判据误伤。

### 3.3 U4 客户端（`git diff -U1 -- dsh-btw/src/client/controller.ts`）

```diff
@@ -30,2 +30,10 @@ export interface SideChatClientState {
   readonly error?: string
+  /**
+   * The last transcript-read failure, set once consecutive failures reach
+   * {@link READ_FAILURE_NOTICE_AT} and cleared by the next successful read.
+   * The phase stays `open` … The copy the user sees is localized from this
+   * flag; the value itself carries the underlying reason for diagnostics.
+   */
+  readonly readError?: string
@@ -59,2 +67,9 @@
+/**
+ * Consecutive transcript-read failures before the panel surfaces `readError`.
+ * One failure stays silent: …
+ */
+const READ_FAILURE_NOTICE_AT = 3
@@ -90,2 +105,4 @@
   private pollTimer: ReturnType<typeof setTimeout> | undefined
+  /** Consecutive read failures in the current poll chain (see `startPolling`). */
+  private readFailures = 0
@@ -173,3 +190,3 @@
-      void this.poll(openState.epoch)
+      this.startPolling(openState.epoch)
@@ -641,3 +658,3 @@   (restore 路径)
-        currentAction: previousCurrentAction, ...base } = attempt.parked
+        currentAction: previousCurrentAction, readError: previousReadError, ...base } = attempt.parked
@@ -645,2 +662,5 @@
+      // A resumed conversation starts clean: …
+      void previousReadError
@@ -664,3 +684,3 @@
-      void this.poll(restored.epoch)
+      this.startPolling(restored.epoch)
@@ -683,2 +703,11 @@
+  /** Begin a fresh poll chain for a newly published state: … */
+  private startPolling(epoch: number): void {
+    this.readFailures = 0
+    void this.poll(epoch)
+  }
@@ -724,3 +753,3 @@   (poll 成功分支)
       const { runningTool: previousRunningTool, pendingQuestion: previousPendingQuestion,
-        currentAction: previousCurrentAction, ...baseState } = this.state
+        currentAction: previousCurrentAction, readError: previousReadError, ...baseState } = this.state
@@ -728,2 +757,6 @@
+      // A read that lands ends the outage: …
+      void previousReadError
+      this.readFailures = 0
@@ -742,2 +775,12 @@   (poll catch)
       console.warn('[dsh-btw] transcript read failed', error)
+      this.readFailures += 1
+      const reason = error instanceof Error ? error.message : String(error)
+      if (this.readFailures >= READ_FAILURE_NOTICE_AT
+        && this.state.readError !== reason
+        && this.state.phase === 'open' && this.state.epoch === epoch && this.state.chatToken === token) {
+        this.publish({ ...this.state, readError: reason })
+      }
       delay = 1_200
```

**必须保住的 4 条行为核对**：
1. 单次失败**无**任何可见提示 —— 阈值 3；U5 用例 (1) 断言 `readError` 未定义（见 §4 表，可观察量 = publish 出的 state）。
2. 退避 **220/700/1200 ms 逐字未变** —— `grep -n "delay = |1_200|220 : 700"` ⇒ `:717 let delay = 700` / `:752 delay = running ? 220 : 700` / `:786 delay = 1_200`（行号仅因新增代码下移，值未改）。
3. 业务错误分支（`result.value.ok === false` ⇒ `phase:'error'`）**逐字未变** —— 该分支未被本次 diff 触及；既有用例 `surfaces a background opening failure without dropping the accepted message` 仍通过。
4. 成功读后的 publish 语义**未变** —— 仅在解构中多剥掉 `readError` 字段并加一行计数清零；`running`/`pendingQuestion`/`currentAction`/`model` 的既有 `…(x === undefined ? {} : …)` 结构逐字保留。
- 另外：`poll()` 顶部 `phase !== 'open'` 早退**未**改成终态，`readError` 不参与 `phase` ⇒ 自动恢复能力保住（U5 用例 (3) 断言 phase 仍为 `open`）。
- 可选字段一致性：该版本**不存在** `projectList` / 快照相等性比较器（`grep -rn "projectList|snapshotEqual|statesEqual|shallowEqual" src/` 为空）；字段按既有约定在 `poll` 成功分支与 restore 分支**一起剥离**，其余 `publish` 路径（`updateTokenState`/`answer` 等）按既有 `...state` 语义保留。`answer()` 用 `const { pendingQuestion: cleared, ...rest } = state; void cleared; return rest` 的同款写法，本档沿用（`void previousReadError`）。

### 3.4 U4 文案键与渲染

`src/client/locales.ts`（仅新增键，未改既有键）：

```ts
:8    | 'drawer.contextNote' | 'drawer.error' | 'drawer.readRetrying'
:38   'drawer.readRetrying': 'Live updates paused — retrying',
:78   'drawer.readRetrying': '实时更新已暂停，正在重试',
```

`src/client/SideChatSurface.tsx`（本档只新增 `:515-519` 五行；`state.readError` 出现在 `:515-516`）：

```tsx
515:      {state.readError !== undefined && state.phase !== 'error' && (
516:        <div className={css.sendError} role="status" title={state.readError}>
517:          {t('drawer.readRetrying')}
518:        </div>
519:      )}
```

- 位置：`parentStatus`（`:502-506`）与 `transcript`（`:521`）之间 ⇒ **在滚动区之外**、不覆盖「停止」（`:663`）/「结束」（`:484`）控件，属**非阻塞**提示。
- 样式：复用既有 `css.sendError`（错误色 + 11px 小字），**未新增/修改 CSS 文件**（该文件也不在本档允许边界内）。
- 文案：全部走 locale 键（en/zh 各一条），**无硬编码中英文**；`state.readError`（底层原因）只作为 `title` hover 细节。
- `phase !== 'error'` 守卫：终态时由 `errorState` 块独占（`:531-537`），避免历史 flag 让两处提示叠加。
- **诚实标注**：`t()` 无插值（`Record<SideChatLocaleKey, string>`），故「已尝试次数」**未**进入可见文案；次数保留在内部计数（阈值常量 + 计数清零逻辑），原因串只作 hover 细节。

---

## 4. U3 / U5 断言清单与测试名

### U3 —— `tests/host-opening.spec.ts` → `describe('btw_ask_user argument codec lock (D30)')`（7 项，全绿）

| # | 测试名 | 断言要点 |
| --- | --- | --- |
| 1 | `refuses a question item carrying an undeclared key instead of freezing the panel` | `execute({questions:[{id,question,options:[{label}],multiSelect:true}]})` ⇒ ① 调用前/后 `entry.pendingQuestion` 均 `undefined`（直接读 service 私有 `byToken` 的 live entry）② reject 信息含 `questions.0`、`multiSelect`、`multi_select`、`label, description` ③ **不含** `Which scope?`（不回显 payload） |
| 2 | `refuses an undeclared option key (no silent strip at the tool boundary)` | `{label:'A', extra:1}` ⇒ reject，信息含 `questions.0.options.0` 与 `extra`，pending 仍 `undefined`（U2 生效后不再静默 strip） |
| 3–6 | `refuses %s that the read codec would reject`（参数化 4 条：`an empty question id` / `an empty question text` / `an empty option label` / `an empty question list`） | 值维度四种（`id:''`、`question:''`、`options[].label:''`、`questions:[]`）⇒ 均 reject（`/btw_ask_user: these arguments do not match/`）且 pending 仍 `undefined` |
| 7 | `stores only codec-valid questions and round-trips them through the read schema` | 合法 payload（`{id:'q1',question,header,options:[{label:'继续'},{label:'停止',description}],multi_select:true}`）⇒ 不抛错、`pendingQuestion` 已写入且 `toEqual(LEGAL_QUESTIONS)`；`readSideChatResultSchema.safeParse(service.read({chatToken}))` **success === true**，且解析出的 `value.pendingQuestion.questions` 与传入相同（不变式「pending 里存的对象恒能通过下发 codec」被钉住）；随后 `abort()` ⇒ reject `/cancelled/` 且 pending 清空 |

harness：沿用同文件既有 `hostHarness` + `childHandle` + `contexts` disposer；`env.runSetup({agent,on,tools:{guard,register}})` 后取 `register.mock.calls[0][0]`（= 被注册的 `btw_ask_user` 定义）并直接调 `execute(args, {signal})`。为 `service.read` 补齐 `session.requestHeader`（同文件既有 legacy-header 用例的先例）。**既有用例与既有断言零改动**（`git diff --stat` 该文件 `+127 -0`）。

### U5 —— 客户端（3 项，全绿）

| 文件 | 测试名 | 断言要点 |
| --- | --- | --- |
| `tests/controller.spec.ts` | `stays silent for one dropped read and surfaces the outage only after three` | fake timers 驱动 4 个轮询：读#1 失败 ⇒ `readError` 未定义、`phase==='open'`、`error` 未定义；读#2 失败 ⇒ 仍未定义；读#3 失败 ⇒ `readError === 'result-invalid'` 且 `phase` **仍为 `open`**；随即 `advanceTimersByTimeAsync(1_200)` 后读#4 成功 ⇒ `readError` 未定义且消息已刷新（可观察量 = publish 出的 state） |
| `tests/controller.spec.ts` | `does not carry a failure streak into a newly opened conversation` | 3 连败后 `readError` 存在 ⇒ `retry()`（close+open，`startPolling` 清零）后 `readError` 未定义，且新链首次失败仍保持静默 |
| `tests/side-chat-surface.spec.tsx` | `renders the frozen-snapshot notice without taking over the panel` | 无 `readError` ⇒ DOM 文本不含 `drawer.readRetrying`；有 `readError` ⇒ 含该键文本 + `[title="result-invalid"]` 存在 + `textarea` 与 `[aria-label="drawer.end"]` 仍在（非阻塞）+ 不含 `drawer.error`；`phase:'error'` 且残留 flag ⇒ 只显示 `drawer.error`（可观察量 = 渲染出的 DOM） |

测试计数：**新增 10 项**（宿主 7 + 客户端 3）⇒ 全量 262 项中「既有 252 项（250 passed / 2 skipped）」为**减法推得**（本档未单独跑改动前的全量基线，未实测）。

---

## 5. 环境事故：pnpm pre-run 删包与恢复（必读）

### 5.1 事故经过（如实记录）

按指定命令跑 `cd dsh-btw && pnpm run lint` / `pnpm run typecheck` ⇒ pnpm **先执行 pre-run 依赖检查 `pnpm install`**，该 install 解析到 `@deepseek-ai/dsh-vision-adam`（package.json 的 peerDep，公开 registry 上不存在）后 404 失败；**但在失败前它已删除 `dsh-btw/node_modules` 中的 30 个包**（全是 package.json 直接声明的依赖；`node_modules/.bin` 符号链接与 `.package-lock.json` 仍在）。

- 判据（时间线）：18:16–18:17 本档 `./node_modules/.bin/vitest run` 连续 4 次成功；18:18 首次 `pnpm run lint` 之后 `./node_modules/.bin/vitest` 变为 “没有那个文件或目录”；`dsh-btw/node_modules` mtime = 18:17/18:20。
- 影响面：`dsh-btw/node_modules` **仅此一处**；`~/.dsh/**` 与其它包/仓库文件未受影响；`package.json` / `package-lock.json` **未被改写**（`git status --porcelain -- dsh-btw/package.json dsh-btw/package-lock.json` 为空）；未生成 `pnpm-lock.yaml`；`.pnpm-store/` mtime 仍为 11:35（未被本次改动）。

### 5.2 恢复（按 `node_modules/.package-lock.json` 精确枚举缺失项）

```
缺失项判定：368 条 lock 记录中 30 条在磁盘上不存在（含嵌套路径全量比对）
```

| 恢复源 | 数量 | 校验 |
| --- | --- | --- |
| npm 缓存 `~/.npm/_cacache`（`pacote.extract(offline)`） | 25 | lockfile `integrity`（sha512）校验通过 |
| 公开 registry 现取 tarball（`curl` + `tar --strip-components=1`） | 4（vitest 4.1.11 / oxlint 1.82.0 / publint 0.3.24 / dsh-better-sidebar 0.14.0） | 逐包 `sha512` 与 lockfile `integrity` **逐字节相符**（`INTEGRITY-MISMATCH` 未触发） |
| 版本相同的既有安装副本（`@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`，取自 `~/.dsh/profiles/node_modules/@local/dsh-pptmaster/node_modules/...`） | 1 | **仅版本号一致**，无 tarball 可比 ⇒ **无 integrity 证据**（私包，registry 404、npm 缓存无 tarball）—— 见 §9 残留项 |

恢复后：`still missing: 0`；`vitest/4.1.11`、`Version 6.0.3`（tsc）、`tsdown/0.22.14`、`publint, 0.3.24`、`oxlint Version: 1.82.0` 均可执行（`.bin` 符号链接本就完好，指回原相对路径）。

**未部署、未重启、未越界写入**；本档未对 `node_modules` 之外的任何路径做恢复动作。

---

## 6. U6：命令与原始输出

### 6.1 构建（按要求**不用** `pnpm build`）

```
$ cd dsh-btw && ./node_modules/.bin/tsdown
ℹ target: es2024
ℹ tsconfig: tsconfig.json
ℹ entry: src/client/index.ts
ℹ Build start
ℹ Cleaning 10 files
ℹ Hint: consider adding deps.onlyBundle option …
Detected dependencies in bundle:
- zod
ℹ [ESM] lib/index.js                        67.54 kB │ gzip: 19.42 kB
ℹ [ESM] lib/typert.host.js                   3.46 kB │ gzip:  0.95 kB
ℹ [ESM] lib/typert.remote-client.js          0.27 kB │ gzip:  0.20 kB
ℹ [ESM] lib/remote-C2Gojj6I.js              10.56 kB │ gzip:  2.54 kB
ℹ [ESM] lib/remote-descriptors-Cu5331mU.js   2.96 kB │ gzip:  0.84 kB
ℹ [ESM] lib/index.d.ts                      16.58 kB │ gzip:  5.24 kB
ℹ [ESM] lib/typert.host.d.ts                 4.83 kB │ gzip:  1.12 kB
ℹ [ESM] lib/typert.remote-client.d.ts        2.60 kB │ gzip:  0.65 kB
ℹ [ESM] lib/remote-D8pzPah2.d.ts            23.47 kB │ gzip:  3.29 kB
ℹ [ESM] 9 files, total: 132.28 kB
✔ Build complete in 689ms
ℹ [CJS] lib/client.js  365.27 kB │ gzip: 78.95 kB
ℹ [CJS] 1 files, total: 365.27 kB
✔ Build complete in 693ms
```

### 6.2 构建产物 md5 / 体积 对照

| 文件 | 改动前 md5 | 改动前体积 | 改动后 md5 | 改动后体积 | Δ |
| --- | --- | --- | --- | --- | --- |
| `dsh-btw/lib/client.js` | `88de97e6c22fc6de9ebd61cb27e5779f` | 363 814 B | `66beb3455c59f4991355f3918228e495` | 365 269 B | **+1 455 B** |
| `dsh-btw/lib/index.js` | `6ae7bfcf42fe49763a192c54c5f87c02` | 65 970 B | `e1437b3ba7de953811e65c47d5b392e5` | 67 542 B | **+1 572 B** |

（改动前取值与派单给定值一致，已在构建前实测复核。）

### 6.3 `git diff --stat -- dsh-btw/lib`（宿主面变化性质）

```
 dsh-btw/lib/client.js                      | 825 ++++++++++++++++++++++++++---
 dsh-btw/lib/index.d.ts                     |   2 +-
 dsh-btw/lib/index.js                       |  26 +-
 dsh-btw/lib/remote-DHlY-Qf0.d.ts           | 607 ---------------------
 dsh-btw/lib/remote-Dv1GpyGK.js             | 280 ----------
 dsh-btw/lib/remote-descriptors-D37stQ5y.js |  46 --
 dsh-btw/lib/typert.host.js                 |   2 +-
 dsh-btw/lib/typert.remote-client.d.ts      |   2 +-
 dsh-btw/lib/typert.remote-client.js        |   2 +-
 9 files changed, 778 insertions(+), 1014 deletions(-)
```

- **`lib/index.js` 变化的性质**：U1 + U2 都是**宿主面**代码 ⇒ **必须变**（+1 572 B）。`git diff` 显示两处：(1) `+const ASK_BACK_ISSUE_LIMIT` / `+function askBackArgumentMessage(error)`；(2) `execute` 内新增 `safeParse` + `throw`，`questions,` → `questions: checked.data.questions`；同时 `import { … btwPendingQuestionSchema } from "./remote-C2Gojj6I.js"` 的 chunk 名变化 = U2 改了 `shared/remote` ⇒ 内容哈希换名。
- **`lib/client.js` 的 +825 行**不是本次新增：它同时包含**改动前就已存在**的 D29（问答卡片）与 09-22 抽屉 resize 未提交改动（HEAD 的 `lib/client.js` 远早于 16:03 的那次构建）。本次的真实增量可用「构建前副本 vs 构建后」精确隔离：**+37 / −6 行，全部为 `readError` / `READ_FAILURE_NOTICE_AT` / `startPolling` / `drawer.readRetrying` 相关**（12 个 hunk，无其它内容）——这也是「我未误改客户端其它源码」的旁证（bundle 是全部客户端源码的确定性函数）。
- 新产物字符串自证：`grep -c "multi_select\` (not" lib/index.js` ⇒ `1`；`grep -o readRetrying lib/client.js | wc -l` ⇒ `3`（键 + en + zh）；`grep -o 实时更新已暂停，正在重试 lib/client.js | wc -l` ⇒ `1`。
- 内容哈希 chunk 换名（`remote-Dv1GpyGK.js` → `remote-C2Gojj6I.js`、`remote-DHlY-Qf0.d.ts` → `remote-D8pzPah2.d.ts`）属 tsdown 正常行为，非手工编辑。

### 6.4 lint / typecheck / test（最终冻结态）

```
$ ./node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts
Found 0 warnings and 0 errors.
Finished in 68ms on 57 files with 96 rules using 32 threads.
[exit 0]

$ ./node_modules/.bin/tsc -p tsconfig.json
[exit 0]
$ ./node_modules/.bin/tsc -p tsconfig.client.json
[exit 0]
$ ./node_modules/.bin/tsc -p tsconfig.tests.json
[exit 0]
```

```
$ ./node_modules/.bin/vitest run
 ✓ tests/host-opening.spec.ts (25 tests) 47ms
 ✓ tests/host-persistence.spec.ts (5 tests) 120ms
 ✓ tests/controller.spec.ts (26 tests) 608ms
 ✓ tests/side-chat-surface.spec.tsx (33 tests) 379ms
 …（其余 21 个文件全绿）
 Test Files  25 passed (25)
      Tests  260 passed | 2 skipped (262)
   Duration  882ms
```

**用了哪条命令（如实）**：`pnpm run lint` / `pnpm run typecheck` **均失败**（pre-run 404，见 §5），因此三个验证命令全部改用仓库内二进制：`./node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts`（= `package.json` `lint` 的同一命令）、`./node_modules/.bin/tsc -p tsconfig{,.client,.tests}.json`（= `typecheck` 的三条）、`./node_modules/.bin/vitest run`（= `test`）。构建用 `./node_modules/.bin/tsdown`（= `build`，同一工具同一 config，两个 config 都跑）。

**一次瞬时失败（已复核，非本改动导致）**：18:24:26 的一次「全量 vitest run」与「oxlint + tsc×3」**被我并行发出**，在双进程 CPU 竞争下 `tests/host-persistence.spec.ts` 的
`falls back to a fresh fork and clears the index entry when resume fails` 失败（`expected {…} to be undefined`，收到的是 fresh fork 新写入的 index 条目）。
- 隔离复跑该文件 **12/12 通过**；随后全量 **6/6 通过**（260 passed | 2 skipped）。
- 该用例属时序敏感型（`await start()` 后直接读 index 文件，与 fresh fork 的异步 index 写入竞争）；`host-opening.spec.ts` 内既有注释也记录了同类「并发负载下偶发」现象。
- 与本改动无关的判据：本档对宿主的 diff 仅落在 `registerAskBackTool`（`btw_ask_user`），该用例不调用该工具；该用例读写的 host 索引路径未被本档任何文件触及。

---

## 7. 反向验真（三处，全部逐字节还原）

| # | 实验 | 预期 | 实测 | 还原证据 |
| --- | --- | --- | --- | --- |
| 1 | **U1**：删掉 `safeParse` + `throw`，`questions: checked.data.questions` 改回 `questions,`（= 修复前「纯断言透传」） | U3 的多余键/值维度用例**必失败** | `Tests 6 failed | 1 passed | 18 skipped`：6 条负例全 `AssertionError: expected { …(4) } to be undefined`（pending 被写入非法对象图，正是 D30 冻结链的起点）；合法往返用例仍通过 | `sha256(f37e8d8f…a0b76)` 前后相同；`cmp` 空；还原后 D30 用例 `7 passed` |
| 2 | **U2**：把选项项 `.strict()` 去掉 | 仅「选项项多余键」用例**必失败** | `Tests 1 failed | 6 passed`：`refuses an undeclared option key (no silent strip at the tool boundary)` 失败，其余 6 条通过 ⇒ 锁定精确 | `sha256(e12e620d…9a58)` 前后相同；`cmp` 空；还原后 `host-opening.spec.ts 25 passed` |
| 3 | **U4**：删掉 catch 内的 `this.publish({ ...this.state, readError: reason })`（= 修复前「静默」形态） | U5 两条 controller 用例**必失败** | `Tests 2 failed`：两条均 `AssertionError: expected undefined to be 'result-invalid'` | `sha256(6df94518…1a6c)` 前后相同；`cmp` 空；还原后 `controller.spec.ts 26 passed` |

（实验 1 顺带复现了「修复前 pending 会被写入非法对象」这一失效机理；实验均在 `/tmp/dsh-restore/` 留原始副本，未在工作区留下备份文件。）

---

## 8. 边界合规核对

**改动的文件（全部在允许集内）**

| 文件 | 性质 |
| --- | --- |
| `dsh-btw/src/host/side-chat-service.ts` | U1（+45 行） |
| `dsh-btw/src/shared/remote.ts` | U2（+6 −1） |
| `dsh-btw/src/client/controller.ts` | U4（+51 −4） |
| `dsh-btw/src/client/SideChatSurface.tsx` | U4 渲染（仅 `:515-519` 为本次新增；该文件其余未提交改动 = 既有 D29 / 09-22 resize，**未回滚、未改动**） |
| `dsh-btw/src/client/locales.ts` | U4 文案键（仅 `:8/:38/:78` 三处新增；该文件其余未提交改动为既有） |
| `dsh-btw/tests/host-opening.spec.ts` `tests/controller.spec.ts` `tests/side-chat-surface.spec.tsx` | U3/U5（`+127 / +90 / +215`，**纯新增**，`-0`） |
| `dsh-btw/lib/**` | tsdown 重生成（含内容哈希 chunk 换名） |

**未改动（核对命令）**：`git status --porcelain -- dsh-btw/package.json dsh-btw/package-lock.json`（空）；`docs/**`、`FEATURE-MAP.md`、`.workspace/**`（除本报告目录外）的 `M` 状态**均为本档开工前既有**（开工快照已含 `M FEATURE-MAP.md`、`M docs/…`、`M .workspace/lag-fix/…`）；`.gitignore` 的改动 mtime = 18:08，属**其它并行工作流**（推送就绪审计 T1），非本档。未 `git add/commit/checkout/stash`；未写 `~/.dsh/**`；未重启/杀进程。

**D29（问答卡片）与 09-22 抽屉 resize 改动**：工作区中均保留（`git diff --stat -- dsh-btw/src` 仍显示 `SideChatDrawer.tsx +125`、`overlay-placement.ts +151`、`side-chat.module.css +145`、`use-overlay-placement.ts +160` 等既有改动），本档未触碰其任何行。

---

## 9. 仍属推断 / 未验证（诚实清单）

1. **未部署、未重启 dsh**：宿主面（U1/U2）改动**必须重启 dsh 才在真机生效**；客户端面（U4）虽为热面，但本档**未**把 `lib/**` 拷进 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（越界 + 派单明确要求由协调者部署）。⇒ **真机（GUI）未验收**，本轮所有结论均为源码/单测/构建层面。
2. **真机 D30 复现未重跑**：`d30-consequence.md` 的 27 次失败读 / 45 s 观测为**引用**，本档未重做；「修好后模型带多余键会收到可纠正报错并继续」这一**端到端行为**未在真机验证（仅单测锁住工具边界行为）。
3. **「已尝试次数」未进入可见文案**：`t()` 无插值，故仅 hover `title` 带底层原因；次数只在内部计数。若用户裁决要求可见计数，需再议实现（当前实现符合「可含」的可选表述）。
4. **终态与提示的互斥仅靠守卫**：`phase:'error'` 且残留 `readError` 时会由 `phase !== 'error'` 守卫压掉提示（surface 用例已钉住）；但**未被真实业务错误路径触发过**（该路径既有用例覆盖，本档未新增端到端混合用例）。
5. **环境事故残留不确定项**：`@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2` 的恢复副本**没有 integrity 证据**（私包 404、npm 缓存无 tarball，只能靠「同名同版本既有安装副本」）。功能判据：全量测试 / typecheck / 构建均通过；但**无法逐字节证明**它与被删前的那份完全一致。其余 29 个包均有 sha512 integrity 证据。
6. **被 pnpm 改写的既有包无法逐一比对**：`node_modules` 是 npm 树的混合恢复，本档只能证明「lockfile 记录的文件路径 0 缺失」+ 全量验证通过，**不能**证明每个既有包逐字节未被 pnpm 动过。
7. **测试计数中的既有基线为减法推得**（250 passed / 2 skipped），未单独实测改动前全量。
8. **`host-persistence` 偶发**：见 §6.4，仅在「并行跑两批重命令」时出现 1 次，隔离 12/12、全量 6/6 通过；本档未去修该既有用例（不在 U1–U6 范围，且会越界改动既有断言）。

---

## 10. 交付物指纹（最终态，供部署/复核锚定）

```
src/host/side-chat-service.ts     f37e8d8f6cb0199d4285fe56c11f1915c1511966b0841521c4a1a8e2c85a0b76
src/shared/remote.ts              e12e620d8fdc043559fc018f808adfda70033d46d7eed04d609a4baa312f9a58
src/client/controller.ts          6df94518a977ca6067dc44c8c6386faceda9c2d423698674f8da27fb55391a6c
src/client/locales.ts             2b98511d3968d8de5ae10ba80da00fdf86eab0f7a880b93fd931c65ff80f7f05
src/client/SideChatSurface.tsx    3ef735867713232079421d144923d3d79fd79628020a66b15b465c27b9129440
tests/host-opening.spec.ts        625ada6311cf6483830052b4844434b6d64def254fd869452ebda30484a9b854
tests/controller.spec.ts          fb295bb37f837b93a2353de16c5b12ec9f36575dab51c54d84f4ed2a2862d40f
tests/side-chat-surface.spec.tsx  3a09cb6a20ff636d717b535cad85feda3444d02901e13e788163556a02299af6

lib/client.js   md5 66beb3455c59f4991355f3918228e495   365269 B   (原 88de97e6c22fc6de9ebd61cb27e5779f / 363814 B)
lib/index.js    md5 e1437b3ba7de953811e65c47d5b392e5    67542 B   (原 6ae7bfcf42fe49763a192c54c5f87c02 /  65970 B)
```
