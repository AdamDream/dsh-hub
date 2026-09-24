# xaudit-code — btw 问答卡片修复：独立只读交叉审计（代码面）

- 档别：独立交叉审计（**只读**；未 commit/checkout/stash/rm；未 kill 进程；未重启 dsh；未部署；未重新构建产物）
- 时点：2026-09-23 11:51–11:56（本机）
- 审计对象：`dsh-btw/src/client/SideChatSurface.tsx`、`dsh-btw/src/client/side-chat.module.css`、`dsh-btw/tests/side-chat-surface.spec.tsx`、产物 `dsh-btw/lib/client.js`
- 方法：**先读真实 diff 与文件现状**，再独立复跑验证；对 U1/U3 做了**反向注入实测**（唯一一处临时写文件，已按字节还原并给证据）
- 结论分档：**【已验证】**（带 file:line / 原始输出）、**【高置信推断】**、**【未验证】**

---

## 0. 批次归属（先分清，避免把上一批改动算进来）

`git status --porcelain -- dsh-btw` 与逐文件 diff 核对，**属于上一批（drawer resize / w28 / a11y）而非本次问答卡片修复**的文件：

| 文件 | 内容指纹（本次审计独立读 diff 得出） |
| --- | --- |
| `src/client/SideChatDrawer.tsx`、`overlay-placement.ts`、`use-overlay-placement.ts` | resize 手柄 / 显式摆放 |
| `src/client/locales.ts`（+9） | 新增 `drawer.resizeWidth/Height/Corner/Hint` 四个 key ⇒ **resize 批次** |
| `src/client/presentation.tsx`（+8） | 注释 `w28 F2/P3`：`viewStore.clear()` 提前到 `await controller.close()` 之前 |
| `src/client/SideChatJumpList.tsx`（+7,-1） | 注释 `w28 F3/P4`：`if (!view.jumpOpen) return` + 依赖加 `view.jumpOpen` |
| `src/client/index.ts`（+26） | `createDrawerSizeStore()` 注入 + `/*<<dsh-exec-a11y:U-A11Y3:v1*/` 和弦守卫 ⇒ **两大批遗留** |
| 未跟踪 `SideChatResizeHandle.tsx`/`drawer-size.ts`/`drawer-size-store.ts`/`tests/overlay-placement-explicit.spec.ts` | resize 批次 |
| `lib/client.js` | **本次整包重建**，同时含 resize 批 + 本次修复的编译结果（执行档 U4 已说明） |

**本次修复的真实面**（其余一行未动）：`SideChatSurface.tsx`、`side-chat.module.css`（仅 `:343-360` 区段）、`tests/side-chat-surface.spec.tsx`、`lib/client.js`。
**【已验证】** `git diff --stat -- dsh-btw/src/host dsh-btw/src/shared` 为空、`README*.md` 无 diff（沿用执行档命令复核，我另行 grep 确认 host 侧 `pendingQuestion` 三处赋值未变）。

---

## 1. 核对表（U1 / U2 / U3 逐条）

### U1 持久化根因修复 —— 【已验证】落地，无实质偏差

| # | 判据 | 结论 | 证据 |
| --- | --- | --- | --- |
| U1-1 | 重置 `useEffect` **真的删除**（不是改依赖） | ✅ 删除 | `SideChatSurface.tsx:69-73` 之后直接是说明性注释 `:74-81`；`grep -c "setError(null)" src/client/SideChatSurface.tsx` = **1**（仅提交路径 `:97`；旧码为 2）；`grep "pendingQuestion.questions]"` 命中 0 |
| U1-2 | `useEffect` import 保留（文件其它处仍在用） | ✅ | `:2` import；`:214/:280/:297/:333/:347/:350` 六处调用 |
| U1-3 | `useState` 初值保持 | ✅ | `:69-71` 未改（`Object.fromEntries(questions.map(...))`） |
| U1-4 | 调用点 `key` 绑定 `state.pendingQuestion.questionId` | ✅ | `:604-608`，`key` 在 `:605` |
| U1-5 | `key` 只在 `pendingQuestion !== undefined` 分支内 | ✅ | `:603` `{interactive && state.pendingQuestion !== undefined && (`；全仓 `<QuestionCard` 仅 `:604` 一个调用点 |
| U1-6 | 删 effect 后**是否丢失它承担的行为** | 见下 §1.1 | — |
| U1-7 | 是否引入**新失败模式** | 见下 §1.2 | — |

#### 1.1 被删 effect 实际承担的行为（逐条）
被删代码只做了两件事：`setDrafts(全空 map)` 与 `setError(null)`。
- **`setDrafts`（轮询污染 → 本次修复目标）**：草稿初值改由挂载承担，替换机制是 key ⇒ 语义等价且更强。**【已验证】** 反向注入实测见 §3.1。
- **`setError(null)` 在"问题批次切换"时清空**：现在由 remount 承担（key 变化 ⇒ 全部 `useState` 重建）。**【已验证·结构性】** `:603-608` + `:72-73`。
- **`setError(null)` 在"同一批次内每次轮询"时清空**：**不再发生** ⇒ 行为变化（见 §2-F1）。这是**有意且合理**的变化（原本失败的应答 error 会在 ≤220 ms 内被抹掉，用户看不到），但执行档未记录该行为面变更。
- **"已在输入的自定义文本"清空**：旧码里它**同样是被轮询抹掉**的受害者（`:165` 的 `draft.custom` 与 `draft.selected` 同属 `drafts`）。现随草稿一起保留、换题时随 remount 清空。**【已验证·结构性】**
- **`sending` 态**：被删代码**从未触碰** `sending` ⇒ 无丢失。`sending` 仍由 `:96/:108` 管理。**【已验证】**

#### 1.2 新失败模式评估
- **F2-1「同 `questionId` + `questions` 变化不再重同步」——不可达，且降级良性【高置信推断】**
  宿主每次 `btw_ask_user` 现铸 `randomUUID()`（`src/host/side-chat-service.ts:967`，写入 `:978-980`），pending 期间二次提问直接抛错（`:962-965`），settle 时置空（`:969`）；read 每次返回 `{questionId, questions}`（`:594-595`），同 id 下 `questions` 内容不变。即便未来变得可达，渲染侧有兜底：`drafts[question.id] ?? 空`（`:119`、`:100`、`:172`），未登记的 question.id 渲染为空草稿而非崩溃 ⇒ 失效模式良性。
- **F2-2「草稿只活在挂载实例里」——与旧码等价，非回归【已验证·结构性】**
  任何卸载路径（`phase` 转 `error` 使 `interactive=false`（`:371`）、抽屉最小化/跳转）都会丢草稿；旧码的 effect 恰好也是"重置为空"，所以两者结果相同。但删 effect 后**没有任何重新同步路径**，设计上更依赖"卡片不卸载"。
- **F2-3「草稿以 `question.id` 为键，跨批次会重名」⇒ `key` 是唯一重置手段（设计脆弱性，已被 C2 锁定）**
  `question.id` 是模型给的短 id（线上常见 `q1`），换批次极易重名；若将来有人顺手删掉 `:605` 的 key，草稿会静默跨批次残留 —— 这正是 §3.2 实测到的现象（删 key ⇒ C2 失败，收到 `['true','false']`）。**【已验证】** 归为**低-中**，因已有 C2 锁。
- **F1「error 现在长驻到下次提交或换题」**：见 §2-F1（信息级）。
- **应答失败后重试 / `sending` 期轮询 / 多问题批次部分回答**：均**改善或不变**。重试路径现在保留用户选择（旧码会因轮询重置而"重试时发送空答案"）；`submit` 在发起时已用闭包捕获 `drafts`（`:99-105`），轮询不再改写草稿，故 `sending` 期语义更干净；多问题批次由初值 `:69-71` 覆盖全部 question.id。

### U2 选项行观感/语义对齐 —— 【已验证】落地；ARIA 与官方契约逐值一致；CSS 优先级确已修好

| # | 判据 | 结论 | 证据 |
| --- | --- | --- | --- |
| U2-1 | 选项 `role` 随 `multi_select` 取 `checkbox`/`radio`，`aria-checked={active}`，**无 `aria-pressed`** | ✅ | `:133-134`；选项行内无 `aria-pressed`（残留见 §2-F3） |
| U2-2 | 容器 `group`/`radiogroup` 与子角色自洽（radiogroup 内只有 radio；group 内只有 checkbox） | ✅ | `:125` 容器；`:126-158` 子节点全是 `role=radio|checkbox` 的 button；`questionHint` 只在多选（`group`）分支渲染 `:159` ⇒ 单选容器内无非法子项 |
| U2-3 | 单/多选 role 映射**与官方实现一致**（独立核对官方产物） | ✅ | 官方 `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`：`multiSelect === true ? "group" : "radiogroup"`、`multiSelect === true ? "checkbox" : "radio"`、全包 `aria-checked` × 1、`aria-pressed` × 0 |
| U2-4 | CSS 选择器特异性真的修好 | ✅ | `:350` `.questionOption:hover:not(:disabled):not(.questionOptionSelected)`；编译产物（`lib/client.js`）为 `.SalQ5q_questionOption:hover:not(:disabled):not(.SalQ5q_questionOptionSelected){background:var(--dsw-alias-interactive-bg-hover)}` ⇒ `:not()` 内类名**被正确哈希**；`.questionOptionSelected` 紧跟其后 `:351` |
| U2-5 | 是否还有**其它**能覆盖选中态的选择器 / 顺序问题 | ✅ 无 | 全模块仅 3 条规则触及选项行背景或边框（`:349`/`:350`/`:351`）；`grep -n "!important" side-chat.module.css` → 0；四个 `@media` 块（`:506/:686/:691/:693`）内**无** `questionOption*`；`:361` 以后无 `questionOption*` 规则 ⇒ 无后续覆盖 |
| U2-6 | `.questionCard` 绿壳**零改动** | ✅ 双证据 | ① CSS diff 首个 hunk 从 `:343` 开始（`:327-339` 未入 hunk）；② **编译产物比对**：新 `lib/client.js` 与 pre-image（`.workspace/btw-question/preimage-lib-20260923-113216/client.js`）里 `questionCard{...}` 规则串**逐字符相同**（含 `#b7e85b 45%` / `#b7e85b 8%`） |
| U2-7 | 选项行规则里**无硬编码 `#b7e85b` 残留** | ✅ | `:349-360` 无 `#b7e85b`（模块内其余 `#b7e85b` 属于 questionCard/questionDot/banner/sendButton 等**有意保留**的绿身份） |
| U2-8 | 旧 `.questionOptionActive` 已清除 | ✅ | `grep -rn questionOptionActive src lib/client.js` → 0 命中 |
| U2-9 | 单选互斥 / 多选累加与 `multi_select` 一致 | ✅ | `:83-92`：单选先 `clear()` 再判断 ⇒ 同项再点**不会取消**（仍是合法 radio 语义）；多选为 toggle ⇒ 可取消。与 `:128` 的 `multi` 同源（`:136` 传 `multi`），无二义 |
| U2-10 | 与 plan 的偏差是否只有执行档自报的那一处 | ✅ 是 | plan U2.3 写 `:hover:not(:disabled)`，实现多加了 `:not(.questionOptionSelected)` —— 该加项**必要**（否则 hover 特异性 (0,3,0) 压过 `.questionOptionSelected` (0,1,0)，鼠标停留时选中底仍会被覆盖）；执行档 §1/U2 已披露，属**正确纠偏**，非擅自扩范围 |

**观感一致性口径（重要，见 §4-2）**：token 值层面**逐值相同**已独立核实——theme 包（`@deepseek-ai/dsh-client-ui-theme/lib/client.js`）中 `interactive-bg-hover:#2631480f`（= rgba(38,49,72,0.0588≈0.06)）、`border-l2:#0000001a`（= rgba(0,0,0,0.102≈0.1)），官方 `.optionSelected{background:var(--dsw-alias-interactive-bg-hover)}` + `.optionSelected{border-color:var(--dsw-alias-border-l2)}` 用的正是这两个 token，btw `:351` 亦同。**但渲染态并不等同**：官方基态边框 `transparent` → 选中才出现 `border-l2`（有"边框浮现"这一档线索）；btw 基态已是 `border-l2`（plan 声明保留），故选中时只剩底色变化；且底色是半透明叠加在 `questionCard` 的**淡绿底**之上（`:336` `color-mix(... 92%, #b7e85b 8%)`），合成后的实际像素与主会话官方卡片不同。

### U3 回归测试 —— 【已验证】C1 确实锁原缺陷，C2 确实锁 key（均为**我本人**的反向注入实测）

| # | 判据 | 结论 | 证据 |
| --- | --- | --- | --- |
| U3-1 | primitives mock 补 `IconCheckOutline14` | ✅ | `tests/side-chat-surface.spec.tsx:44` |
| U3-2 | C1 在「同 questionId + **新数组身份**」下断言选中保持 | ✅ | `:792-807`：`pending()` 每次调用重建全部对象/数组（`:723-725`），`:801-802` 赋值后重新 render，`:804` 断言 `aria-checked=true` |
| U3-3 | **C1 真能失败**（不是恒真断言） | ✅ **实测**：注回旧 effect ⇒ C1 在 `:804` 失败（详见 §3.1）；失败点落在**轮询后**那条断言，`:797/:798`（轮询前）仍通过 ⇒ 失败原因精确是"新身份触发重置"，**不是** aria 属性改名带来的假失败 |
| U3-4 | C2 锁住 key（`questionId` 变化 ⇒ 空草稿） | ✅ **实测**：删掉 `:605` 的 key ⇒ C2 在 `:821` 失败，收到 `['true','false']`（详见 §3.2） |
| U3-5 | C3 单选互斥 / 多选累加 | ✅ 通过（`:824-844`） |
| U3-6 | C4 ARIA 合法 + 断言无 `aria-pressed` | ✅ 通过（`:845-866`） |
| U3-7 | C5 序号徽标 / 复选框前导 | ✅ 通过（`:867-889`） |

**覆盖缺口（低，见 §2-F4）**：无用例覆盖 ①2 题以上批次；②`custom` 文本在轮询下保持（这也是本次被修的同一缺陷面）；③`error` 在轮询下不再被抹（行为变更未被锁）；④`sending` 期间轮询不清草稿。

---

## 2. 新发现问题 / 风险清单

| ID | 严重度 | 问题 | 触发条件 | 证据 |
| --- | --- | --- | --- | --- |
| **F1** | 信息级（行为变更，未记录） | `error` **不再被轮询清空**，会一直显示到"再次提交"或"换题 remount"。旧行为是 ≤220 ms 内被抹掉 | 应答失败（`controller.answer` 返回 `!ok`，如 `No pending question matches this question id` 的竞态） | `:97`（唯一 `setError(null)` 在提交开头）、`:106`；`:108` `finally` 只复位 `sending` |
| **F2** | 低-中（设计脆弱性，已被 C2 锁定） | 草稿键是**模型给的 `question.id`**（跨批次极易重名）；重置**完全依赖** `:605` 的 `key`。任何人删 key 都会静默回归"跨批次残留选择" | 删/改 `:605`；或未来把 `pendingQuestion` 换成不带 key 的渲染 | §3.2 实测：删 key ⇒ `['true','false']` |
| **F3** | 低（**报告准确性**，非代码缺陷） | 执行档 §1/U2 与 §2:191 声称 `grep -rn "aria-pressed" dsh-btw/src` → **0 命中，与事实不符** | — | `src/client/SideChatButton.tsx:33` 仍有 `aria-pressed={view.visible}`（启动器 toggle，属**既有未改文件**、本次范围外；准确表述应为"**选项行**已无 aria-pressed"） |
| **F4** | 低（测试覆盖缺口） | U3 未覆盖：2+ 题批次、`custom` 文本保持、`error` 不再被抹、`sending` 期轮询 | 后续重构时可能出现静默回归 | 「QuestionCard option rows」仅 C1–C5（`:712-889`） |
| **F5** | 低（观感残留，plan 已声明） | 选中态"边框浮现"线索缺失：官方基态 `border:transparent`，btw 基态即 `border-l2`；且选中底为半透明、叠加在绿底卡片上 ⇒ 绝对像素与官方不同（对比度更低） | 任何使用该卡片的场景 | 官方 `.option{}` 与 btw `:349`/`:351`；`:336` 绿底 |
| **F6** | 低（既有，非本次引入） | `sending` 期间选项行仍可点击（只有提交按钮 `:186` 被 disable）；提交后改选择不会进入已发出的 payload（闭包捕获 `:99-105`）⇒ UI 可能显示"未发送的选择" | 提交后在 RPC 返回前点击选项 | `:186` vs `:130-136` |
| **F7** | 低（既有，非本次引入） | 卡片一旦卸载（`phase→error` 使 `interactive=false`，`:371`；或抽屉最小化/跳转）草稿即丢，且删 effect 后无重新同步路径 | 待答期间发生一次 `sideChat/read` 的 RPC 级失败（`:700-710` 发布 `phase:'error'`） | `:371`、`:603`；**未实测**（见 §5） |

`#b7e85b` 硬编码残留、`.questionCard` 被误改、`aria-pressed` 残留于选项行、hover 覆盖选中态、编译产物与源码不一致（哈希前缀 `SalQ5q` 与线上同族）—— **均未发现**。

---

## 3. 独立验证：原始命令与输出摘要

### 3.0 只读复跑（全部由本档亲自执行）

```bash
cd /home/CNS2026495165/dsh/dsh-btw
npx vitest run tests/side-chat-surface.spec.tsx
#   → Test Files 1 passed (1) / Tests 32 passed (32) / Duration 663ms
npx vitest run
#   → Test Files 25 passed (25) / Tests 250 passed | 2 skipped (252) / Duration 850ms
./node_modules/.bin/tsc -p tsconfig.client.json --noEmit   # → exit 0，无输出
./node_modules/.bin/oxlint src tests
#   → Found 0 warnings and 0 errors. Finished in 43ms on 55 files with 96 rules
md5sum dsh-btw/lib/client.js
#   → 241b04c412be6fbca37048dcf3974589  (363701 B, mtime 11:35 —— 未重新构建)
```
（与执行档一致：目标 spec 32、全量 25/250/2、lint 0/0。oxlint 文件数 55 vs 执行档 57，差异仅是执行档多传了 `tsdown.config.ts vitest.config.ts`。）

产物级独立取证（**不部署**即可做的行为面证据）：
```bash
grep -n "setDrafts" dsh-btw/lib/client.js
#   → 1250(useState 初值) / 1257(toggle) / 1373(input onChange) —— 共 3 处，
#     QuestionCard 编译体内**没有** useEffect 重置；`grep -o questionOptionActive` → 0
grep -o "aria-checked" dsh-btw/lib/client.js            # → 命中（选项行已改为该属性）
grep -o "interactive-bg-hover:[^;}]*" ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js
#   → #2631480f（亮） / #ffffff14（暗）  == rgba(38,49,72,0.06) / rgba(255,255,255,0.08)
grep -o "border-l2:[^;}]*" …/dsh-client-ui-theme/lib/client.js   # → #0000001a == rgba(0,0,0,0.1)
```
> 【已验证】构建产物里已无重置 effect（**产物级**证据；不是 GUI 级证据）。

### 3.1 反向验真 A：注回旧 effect ⇒ C1 必失败【实测】

基线冻结：`sha256(SideChatSurface.tsx) = be36cd23f593ae47bdcbb0bac0c6e9d1aa072f2aa4231496c739276b054bd63c`、`md5(git diff -- <file>) = 85e9c94ae74a61a4b54f96258decaba0`、`git diff --stat` = `39 insertions(+), 16 deletions(-)`、备份 `/tmp/xaudit-SideChatSurface.tsx.orig`。

仅注回被删的那 6 行 effect（**保留** `aria-checked`/新类名，以排除"改名导致的假失败"）：
```bash
npx vitest run tests/side-chat-surface.spec.tsx -t 'C1'
#   × C1 keeps the selection when the same questionId arrives with a new questions array identity 22ms
#   AssertionError: expected 'false' to be 'true' // Object.is equality
#     ❯ tests/side-chat-surface.spec.tsx:804:59
#       802|     renderSurface()
#       804|     expect(optionRows()[0]?.getAttribute('aria-checked')).toBe('true')
#       805|     expect(optionRows()[0]?.className).toContain('questionOptionSelect…
#       806|     expect(optionRows()[1]?.getAttribute('aria-checked')).toBe('false')
#   Test Files 1 failed (1) / Tests 1 failed | 31 skipped (32)
```
⇒ 失败点正是**第二次 render（模拟一次 220 ms 轮询）之后**的那条断言，`:797/:798`（轮询前）通过。**C1 确实锁住原缺陷**，且锁的是"新数组身份触发重置"这一机制本身。

还原证据（**字节级**，未用任何 git 写命令）：
```bash
cp -a /tmp/xaudit-SideChatSurface.tsx.orig dsh-btw/src/client/SideChatSurface.tsx
sha256sum  → be36cd23f593ae47bdcbb0bac0c6e9d1aa072f2aa4231496c739276b054bd63c  （与基线相同）
git diff -- <file> | md5sum → 85e9c94ae74a61a4b54f96258decaba0  （与基线相同）
git diff --stat → dsh-btw/src/client/SideChatSurface.tsx | 55 ++++--- 39 insertions(+), 16 deletions(-)
cmp /tmp/xaudit-SideChatSurface.tsx.orig <file> → CMP_IDENTICAL
grep "pendingQuestion.questions]" → 0 命中（旧 effect 依赖已不在）
npx vitest run tests/side-chat-surface.spec.tsx → Tests 32 passed (32)
```

### 3.2 反向验真 B（执行档未做）：删掉 `key` ⇒ C2 必失败【实测】

同一套备份/还原流程（还原后再次 `sha256sum` 与 `diff md5` 均等于基线、`cmp` → `CMP_IDENTICAL`、`grep -n "key={state.pendingQuestion.questionId}"` → `:605` 在位）：
```bash
npx vitest run tests/side-chat-surface.spec.tsx -t 'C2'
#   FAIL  C2 resets the drafts when the questionId changes
#   AssertionError: expected [ 'true', 'false' ] to deeply equal [ 'false', 'false' ]
#     ❯ tests/side-chat-surface.spec.tsx:821:23
#   Tests 1 failed | 31 skipped (32)
```
⇒ U1 的**两个半边**（删 effect、加 key）都有可失败的回归锁；C2 还顺带证明"草稿键是复用的 `question.id`，key 是唯一重置手段"（见 §2-F2）。

### 3.3 身份链（机制）独立复现【实测】

```bash
node -e "…zod 4.6.2，用 src/shared/remote.ts:150-153 同形状 schema，对同一 payload parse 两次…"
#   → questions identity equal? false | options identity equal? false | pendingQuestion identity equal? false
#   → json roundtrip questions identity vs original? false
```
与源码路径对齐：`controller.ts:738` 每次 poll 把 `value.pendingQuestion`（zod 解析产物）写入 snapshot；宿主 `side-chat-service.ts:594-595` 每次 read 新建 `{questionId, questions}` 对象；客户端身份必然每轮变化 ⇒ 旧 effect 的依赖 `[…, pendingQuestion.questions]` 每 ~220 ms 变化一次（`controller.ts:723` `running ? 220 : 700`）。**【已验证】**

### 3.4 工作区/边界核对
```
git status --porcelain -- dsh-btw   # 与审计开始时逐行相同（无新增/无删除；无 commit）
git stash list                      # 空
HEAD = 5f7d61b8（未变）
ls dsh-btw/src/client | grep -i xaudit → no stray files
```

---

## 4. 与执行档结论不一致之处

1. **「aria-pressed 已彻底删除 / grep 0 命中」不实**（执行档 §1/U2 与 §2 末行）。`src/client/SideChatButton.tsx:33` 仍有 `aria-pressed={view.visible}`。该文件本次未改、也**不该**改（启动器 toggle 用 `aria-pressed` 是合法的），但"全 src 0 命中"的表述是错的，应限定为"**问答选项行**已无 `aria-pressed`"。
2. **「选中底/边与主会话实测逐值相同」只在 token 层成立，不等于渲染态相同**（执行档 §4.3 判据④、`docs/architecture/05-performance-and-ux-program.md:81`）。反例：①官方基态 `border:transparent`、选中才出 `border-l2`；btw 基态即 `border-l2` ⇒ 选中时**没有边框变化这一档线索**；②btw 选中底是半透明 `interactive-bg-hover`，叠加在 `.questionCard` 的**淡绿底**（`side-chat.module.css:336`）上，合成像素与官方（中性会话底）不同。执行档 §4.3 的"遗留观感事实"段已承认对比度更低，但 **docs 的行文更绝对**，建议在该行补一句"token 值同、基态边框与背景合成不同"。
3. **未记录的行为变更**：`error` 现在不再被轮询清空（§2-F1）。属改善，但属行为面变更，验收/文档口径应知晓。
4. **U1 的"无偏差"结论我完全支持**，且比执行档更进一步：我证到 C1 的失败点落在**轮询后**断言（执行档只给了 `expected 'false' to be 'true'`，未说明是第几条断言，无法排除"改名假失败"）。
5. **执行档 §2 的构建产物指纹、宿主面逐字节未变、E2E 三次运行都只对旧包**——与我的只读核对一致（md5 `241b04c4…`/363701 B；`lib/client.js` 的 `questionCard` 规则与 pre-image 相同）。**"未部署"不是代码缺陷**，我按此口径审计。
6. 执行档 §2 末"pnpm 把包移入 `.ignored` 后完整还原"：我只读复核 `node_modules/.bin/` 下 `tsc/vitest/oxlint/tsdown` 均可正常调用（本次全部命令均成功执行）⇒ **还原有效**，无残留损伤。

---

## 5. 未验证项（明确不声称）

1. **部署后真实 GUI 级 `PERSISTED`**：仍无独立证据（产物未部署，线上仍是 `6c29b98b645d…` / 361702 B）。我可给出的最强证据止于：**组件级反向注入实测**（§3.1/§3.2）+ **构建产物内已无重置 effect**（§3.0）。
2. `<720px` bottom-sheet 模式下的选项行（未部署、未实测）。
3. 真实 GUI 的多选交互、键盘导航/焦点可达性、`radiogroup` 的 roving tabindex（btw 未实现，仅按钮天然可 Tab）——未实测、未声称。
4. 宿主 shell 的**全局** `button` 样式/`!important` 是否会覆盖 `.questionOptionSelected`：只能在部署后的真实 GUI 验证（模块内已确认无覆盖，见 U2-5）。
5. F7（`phase→error`/卸载导致草稿丢失）未实测；仅源码结构推断。
6. C1 的"新数组身份"由测试手工构造、未驱动真实 220 ms 定时器；与线上 zod/RPC 身份 churn 的**等价性**由 §3.3 的实验 + 源码路径论证支撑（【高置信推断】，非 GUI 级实测）。
7. 本轮**未执行** `pnpm build`（按要求保护"已构建"证据）、未部署、未重启、未 kill、未改 git 状态；唯一的临时写入是 §3.1/§3.2 的 source 注入，均已按 sha256/`git diff` md5/`cmp` 三重证据还原。
