# exec-report — btw 问答卡片：持久化修复 + 选项行向主会话对齐（修订执行复核一体档）

- 档别：修订执行复核一体（可写 + 同档自复核）
- 工作目录：`/home/CNS2026495165/dsh`
- 事实基线：`.workspace/btw-question/plan.md`（U1–U7）+ `audit-a-state.md` / `audit-b-official-ui.md` / `audit-c-docs-deploy.md`
- 时点：2026-09-23 11:32–11:45（本机）
- 用户裁决：**修持久化 + 选项行向主会话对齐；`.questionCard` 绿色外壳保留**；允许 headless E2E（会新建临时会话）
- **自裁决：返工（仅因部署被授权边界拒绝，非代码缺陷）** —— 详见 §7

---

## 0. 一句话结论

U1/U2/U3/U6 全部落地并有实测证据。U4 的构建成功；**部署一步在本档执行时被沙箱拒绝**（写入 `~/.dsh/profiles/...` 越界）⇒ 当时裁决返工，**但收尾前已由有写权限方落地**（线上现服务 `241b04c412be6fbc…` / 363 701 B / `?rev=93d7907f1e76`，判据满足）⇒ 阻塞解除。U5 的 E2E 因此**只对旧包跑过**（结论与修复前一致，反证采样口径有效），已用**工作区内离线像素 harness** 补上 CSS/结构的真实渲染证据；**修复后的真机复测仍未做**。代码与文档侧无返工项。

### 0.1 交叉审计裁决（2026-09-23，主代理两路独立交叉审计）

- **采纳 O2–O7 + 两项漏项**，并已按修订清单落到 `docs/program-notebook.md`（D29 补行为变更、§8 补未验证项）、`docs/architecture/05-performance-and-ux-program.md`（`:81` 证据分级 + token 层限定、`:167` 缓存头按实测拆分）、`docs/runbooks/verify-runbook.md`（`:19` 可判别主判据 + 采样协议 + 两处作用域限定）、本报告（O5 归因更正、`after` 证据降级、aria-pressed 作用域）。
- **驳回 O1**：审计称「官方靠 `key={question.key}` 重挂」是误引，**不成立**。证据：官方 bundle 编译后为 `react_jsx_runtime.jsx(QuestionFlow, { pending: question, t: props.t }, question.key)` —— **第三个参数就是 React key**（`@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`，`QuestionFlow` 调用点），且该包带 `useMemo(..., [props.matched])`、`useEffect` 计数 **0** ⇒ D29 的「官方同款 = 删 effect + `key={questionId}`」说法成立，措辞保留（notebook 内已把引用写精确到 `jsx(...)` 第三参）。
- **独立交叉审计的两次反向验真（与本地自验一致）**：① 注入旧 effect ⇒ C1 **在轮询后断言必失败**；② 删除调用点 `key` ⇒ C2 **必失败**。两次实验**均已字节还原**（本地另有 `cp` 还原 + `diff -q` = `RESTORED` 记录）。

---

## 1. 逐单元落地内容（含 file:line）

### U1 持久化根因修复（官方同款：稳定 key + 删掉重置 effect）✅

文件 `dsh-btw/src/client/SideChatSurface.tsx`

| 落点 | 内容 |
| --- | --- |
| `:74-81` | **删除**原 `useEffect(() => { setDrafts(全空); setError(null) }, [pendingQuestion.questionId, pendingQuestion.questions])`（原 `:74-79`），替换为一段说明根因的注释（现 `:74-81`）；`useEffect` 在文件其它处仍在使用（grep 计数 7）⇒ **未删 import** |
| `:69-71` | `useState` 初值（`pendingQuestion.questions` → 空草稿 map）**保持不变** ⇒「换题=重挂=干净初始化」 |
| `:603-610` | 调用点改为 `<QuestionCard key={state.pendingQuestion.questionId} … />`（`key` 在 `:605`；原 `:585-587` 无 key） |

### U2 选项行观感/语义向官方对齐（P0 CSS + P1 结构）✅

**语义/结构** `dsh-btw/src/client/SideChatSurface.tsx:124-158`
- 容器保持 `role={multi ? 'group' : 'radiogroup'}`（`:125`）。
- 选项按钮：`role={multi ? 'checkbox' : 'radio'}`（`:133`）+ `aria-checked={active}`（`:134`），**选项行已无 `aria-pressed`**（`grep -rn aria-pressed dsh-btw/src/` 唯一命中为 `SideChatButton.tsx:33` 的启动器 toggle，属本次范围外）。
- 横向 `[前导标记][文案列]`：单选前导 = `<span className={css.questionOptionIndex} aria-hidden="true">{index + 1}</span>`（`:149`）；多选前导 = `questionOptionCheck`/`questionOptionCheckChecked` + `active && <IconCheckOutline14 size={12} />`（`:138-148`）；文案列 = `questionOptionCopy` 包住 label + 可选 description（`:150-155`）；`option.description` 分支见 `:152-154`。
- `IconCheckOutline14` 从既有依赖 `@deepseek-ai/dsh-client-ui-primitives` 导入（`:7`）⇒ **零新依赖**；类名用模板字符串拼接，与文件既有风格一致。

**CSS** `dsh-btw/src/client/side-chat.module.css:345-360`
- 按 plan 逐值落地 `.questionOptions`(`:345`) / `.questionOption(+Selected)`(`:349-351`) / `.questionOptionIndex`(`:352`) / `.questionOptionCheck(+Checked)`(`:353-357`) / `.questionOptionCopy`(`:358`) / `.questionOptionLabel`(`:359`) / `.questionOptionDescription`(`:360`)；旧 `.questionOptionActive` **已删除**（全仓 0 命中），不再有硬编码绿。
- **有意偏离（唯一一处，已在 CSS 内注明理由）**：plan 写 `.questionOption:hover:not(:disabled), .questionOptionSelected { background: … }`，但 `.questionOption:hover:not(:disabled)` 特异性 (0,3,0) **高于** `.questionOptionSelected` (0,1,0)，而鼠标点选后必然仍悬停在该行。**归因更正（交叉审计 O5）**：两组选择器**同值**（都是 `--dsw-alias-interactive-bg-hover`），因此它在旧包上**不会**表现为「点了不留色」——本次缺陷的成因是重置 effect。该 `:not(.questionOptionSelected)` 属**特异性脆弱性**加固（若日后两值分叉，hover 会压过选中），**不是**根因。故实现为 `.questionOption:hover:not(:disabled):not(.questionOptionSelected)`（`:350`），使选中态稳定拥有选中底。其余 CSS 逐字照 plan。

**必须保持（已核）**：`git diff` 显示 `.questionCard` / `.questionHead` / `.questionDot` / `@keyframes btwQuestionPulse` / `questionHint` / `questionInput` / `questionError` / 显式提交按钮**零改动**（该区域 diff 仅新增一条解释性注释）。

**有意偏离清单（照 plan §U2.5 保留，未顺手对齐）**：① 选项基态边框保留 `--dsw-alias-border-l2`（官方为 `transparent`）；② 保留「点选 + 发送回答」显式提交（官方单选点击即提交）；③ `questionOptions` 保持 `gap: 6px`；④ 未改字段名 `multi_select`；⑤ 未改「单选 + custom」的答案编码语义。

### U3 回归测试 ✅

文件 `dsh-btw/tests/side-chat-surface.spec.tsx`
- primitives mock 补 `IconCheckOutline14: () => <span data-icon="check" />`（`:44`）。
- 新增 `describe('QuestionCard option rows')`（`:712-900`），用例 **C1–C5**：
  - **C1**（直接回归锁）同 `questionId` + **内容相同但对象/数组全新建**的快照再 render ⇒ 仍 `aria-checked=true` 且 class 含 `questionOptionSelected`（`:792-808`）。
  - **C2** `questionId` 变化 ⇒ 两项皆 false（`:809-823`）。
  - **C3** 单选互斥（点 1 再点 2 ⇒ `[false,true]`）/ 多选累加（⇒ `[true,true]`）（`:824-844`）。
  - **C4** 单选容器 `radiogroup` + 选项 `radio`；多选容器 `group` + 选项 `checkbox`；**断言 `[aria-pressed]` 命中 0**（`:845-866`）。
  - **C5** 单选渲染序号文本 `1`/`2`；多选渲染 `questionOptionCheck`，勾选图标随 `aria-checked`（`:867-889`）。
- **回归锁验真（关键，非仅"用例通过"）**：临时把旧的 `useEffect(…, [questionId, questions])` 注回 `QuestionCard` 后跑 C1 ⇒
  `× C1 … AssertionError: expected 'false' to be 'true'`、`Tests 1 failed | 31 skipped`；随后 `cp` 还原并 `diff -q` 确认 `RESTORED`。⇒ 该用例**确实**锁住本次缺陷。

### U4 构建 ✅ / 部署 ⛔（被授权边界拒绝）

1. **pre-image（现场取）**：`cp -a ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/. .workspace/btw-question/preimage-lib-20260923-113216/` + `sha256sum * > SHA256SUMS.txt`。
2. **构建**：见 §2——`pnpm build` 因环境问题失败（与本修复无关），改用仓库内 `node_modules/.bin/tsdown`（**整包两个 config 都跑**）。
3. **部署**：`cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` ⇒ **`权限不够`（EACCES）**。目标目录权限实为 `drwxrwxr-x CNS2026495165`、`uid=1001(CNS2026495165)` 属主一致，shell `touch` 同样失败 ⇒ 判定为**会话文件沙箱的 workspace-write 边界**（`~/.dsh` 在工作区 `/home/CNS2026495165/dsh` 之外）。已按规则做**一次**同类升级重试（`danger-full-access`）⇒ **被用户拒绝**（`the user rejected escalating this command`）⇒ 按纪律停止，不再绕道。
4. **生效核对（本档执行时线上仍是旧包，如实记录）**：`curl -s …/plugins/@local/dsh-btw/client.js | md5sum` = `6c29b98b645df00b8bc3e9279d6df93e`、`size=361702`、boot 图 `?rev=a0ba609897df` ⇒ 与 pre-image 完全相同，**未变**。
   ⚠️ **后续状态变更（本档收尾时复测）**：该步已由**有写权限方**完成——线上现服务修复包：`size=363701`、md5 `241b04c412be6fbca37048dcf3974589`、`?rev=93d7907f1e76`，且 served 字节 == 部署位 == 仓库。**阻塞已解除**，但 §8 的「真机 GUI 未验收」仍未补测。
5. **未重启 dsh**、未 kill 任何进程（本次修复面为纯热面，本也不需要）。

**构建产物指纹（部署时用）**：
| 项 | 值 |
| --- | --- |
| `dsh-btw/lib/client.js` md5 | `241b04c412be6fbca37048dcf3974589` |
| sha1[:12]（= `?rev=`） | `93d7907f1e76` |
| 体积 | 363 701 B（旧 361 702 B，+1 999 B） |
| 宿主面 6 个产物 | 与 pre-image **逐字节相同**（`sha256sum` diff 为空）⇒ 仅 `client.js` 变化 |
| 线上现状 | **`241b04c412be6fbca37048dcf3974589` / 363 701 B / `?rev=93d7907f1e76`（已部署）**；本档执行时曾为 `6c29b98b645d…` / 361 702 B / `?rev=a0ba609897df` |

### U5 E2E 实证

1. **采样口径已按 plan 更新** `.workspace/btw-question/e2e/repro-btw-question.mjs`：`snapshotOption` 读 `aria-checked`（旧包回退 `aria-pressed`）并记 `active` + `selectedClass` + `role`（`:51-73`，`ariaChecked` 在 `:64`）；采样循环与判定按 `active` 计（`:172`）；`optionsAtStart` 同步记 role/aria（`:144`）。判定逻辑不变（全程 true = PERSISTED）。
2. **跑 `--label after --hold-ms 3000`**（对线上旧包）：`VERDICT=NEVER-ON firstOn=null on=0/56` —— 该判定**只能说明「该次点击后未观测到选中态」**，**不能**排除「这次 click 未生效」。由 `optionsAtStart`（`role=null` / `ariaChecked=null` / `ariaPressed="false"`）可确证的是**该次跑在旧包上**；「首采样落在 167 ms、恰好错过 166–218 ms 的短暂选中窗」为**推断**（据 `after-dense` 同包复现与基线翻回点），**非结论**；该次采样中该行已是 hover-only（`background: rgba(38,49,72,0.06)`、class 回到 `questionOption`）。
3. **补跑 `--label after-dense --sample-ms 15`**（更密采样）：`VERDICT=REVERTED firstOn=162ms firstOff=225ms on=4/181` ⇒ 与修复前基线 `REVERTED firstOn=166ms firstOff=270ms on=2/56` **同一现象、同一量级**（翻回点都在 ~220 ms 轮询周期上）。这是对**旧包**的复现，也反证采样口径有效。
4. **主会话参照物重跑** `compare-main-question.mjs --label main-ref2` ⇒ `OK`，产出 `2026-09-23T03-40-45-729Z-main-ref2.json` + 2 张 PNG。
5. **真实渲染像素核验（替代面）**：因部署被拒，运行中的 GUI 无法加载新 CSS/结构，故在工作区内建**离线 harness**（`.workspace/btw-question/harness/`）：
   - 素材全部真实：`dsh-client-ui-theme` 的**真 token 表**（亮/暗两套）、`side-chat.module.css` 经 **lightningcss 同款 pattern（`[hash]_[local]`）编译**的产物（哈希前缀 `SalQ5q` 与线上一致）、修复前规则**从 pre-image bundle 提取**、标记与 `SideChatSurface.tsx` 同构。
   - 结论见 §4「目视核验」。
   - **边界（不声称）**：harness 是静态渲染，**不能**替代「真实 GUI + 真实 `btw_ask_user` + 真实 220 ms 轮询」的端到端实证；持久化行为由 C1 回归锁证明。

### U6 文档同步 ✅

| 文件 | 改动 |
| --- | --- |
| `docs/program-notebook.md:274` | §7 新增 **D29**（现象/根因 file:line/状态=「源码已修 + 已回归锁定 + **已部署**」/证据 + 漏项 a 的 `setError(null)` 行为变更）；`:275` 新增 **D30**（可选条，**机制确证、后果未实测**，行内明写「未实测」）；`:292` §8 新增第 11 条「真机（GUI）未验收」 |
| `docs/architecture/05-performance-and-ux-program.md:81` | §3 btw 批行（`:80`）**保持不动**，在其后新增一行 **「btw 问答卡片修复（2026-09-23）」** 记录产物指纹（`241b04c412be6fbc…` / `?rev=93d7907f1e76` / 363 701 B）+ 证据分级 + token 层限定 + 渲染态差异 |
| `docs/architecture/05-performance-and-ux-program.md:159` | §7 地图 btw 行改为「线上现状 = 修复包 `241b04c412be6fbc…`；前一版 `6c29b98b645d`」+ 本批 pre-image 回滚命令（**部署后已按新事实更正**） |
| `docs/runbooks/verify-runbook.md:19` | §1 第 5 步补判据：序号徽标/方框勾、**可判别主判据**（`role=radio\|checkbox` + `aria-checked=true` 持续 ≥3 s；旧包为 `null`/`aria-pressed`）+ **每 50 ms × 3 s 采样协议**（自动命令 + Console 一行式）、颜色列辅助判据（并注明旧包 hover 同值 ⇒ 单看颜色不可判别）、**选项行**不再有硬编码绿 `#b7e85b`（该色 CSS 其它 23 处仍在用）、**外壳仍是 btw 绿**（有意保留）、合法 ARIA（**选项行**不应再有 `aria-pressed`；`SideChatButton.tsx:33` 范围外） |
| `docs/runbooks/verify-runbook.md:43` | §3 新增排查项「点了选项不留色」：查 `QuestionCard` 草稿态是否被轮询重置 + 症状（~220 ms 后回落 / class 回 `questionOption`）+ 修法 + **先核部署位字节**（`:56` 已按部署后事实改为「应为 `241b04c412be6fbca37048dcf3974589`…若为 `6c29b98b645d…` 则是修复前的旧包」） |
| `FEATURE-MAP.md:25` | btw 行补 09-23 日期、口径与证据链（指向 `.workspace/btw-question/exec-report.md`）；**本轮按部署后事实更正**：状态由「部署待落地」改为「已完成并已部署（served `241b04c412be6fbc…` / `?rev=93d7907f1e76`）、真机 GUI 复测待补」，并改写末尾的部署说明段 |
| `docs/architecture/04-ops-deploy.md:194` | 既有漂移修正：btw 测试文件数 `24` → **25**，并补本次实测「25 files / 250 passed / 2 skipped」 |
| `dsh-btw/README*.md` | **未改**（`git diff --stat` 为空）⇒ `tests/sign-contract.spec.ts:120` 的 README 原文串断言未受影响（全量 vitest 通过亦印证） |

### U7 同档自复核 ✅（裁决见 §7）

---

## 2. 执行过的原始命令与关键输出摘要

```bash
# 基线（改动前）
cd /home/CNS2026495165/dsh
curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum
#   → 6c29b98b645df00b8bc3e9279d6df93e
curl -s -o /tmp/served-btw-pre.js -w '%{http_code} %{size_download}\n' …/client.js
#   → 200 361702
md5sum dsh-btw/lib/client.js ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js
#   → 两处均 6c29b98b645df00b8bc3e9279d6df93e（served == 部署位 == 仓库）
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client\.js?rev=[a-f0-9]*'
#   → dsh-btw/client.js?rev=a0ba609897df
find dsh-btw/src -newer dsh-btw/lib/client.js -type f      # → 空（无在途 src 改动）

# pre-image
cp -a ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/. .workspace/btw-question/preimage-lib-20260923-113216/
( cd …/preimage-lib-20260923-113216 && sha256sum * > SHA256SUMS.txt )

# 目标测试（U3）
cd dsh-btw && npx vitest run tests/side-chat-surface.spec.tsx
#   → Test Files 1 passed (1) / Tests 32 passed (32)
# 回归锁验真：注入旧 effect 后
npx vitest run tests/side-chat-surface.spec.tsx -t 'C1'
#   → × C1 … AssertionError: expected 'false' to be 'true'   Tests 1 failed | 31 skipped (32)
#   还原：cp /tmp/SideChatSurface.tsx.keep src/client/SideChatSurface.tsx && diff -q → RESTORED

# 静态门
npx tsc -p tsconfig.json && npx tsc -p tsconfig.client.json && npx tsc -p tsconfig.tests.json
#   → TYPECHECK_OK（无输出）
npx oxlint src tests tsdown.config.ts vitest.config.ts
#   → Found 0 warnings and 0 errors. (57 files, 96 rules)

# 全量（U7）
npx vitest run --reporter=dot
#   → Test Files 25 passed (25) / Tests 250 passed | 2 skipped (252)   （两次独立跑均同结果）

# 构建
cd dsh-btw && pnpm build
#   → ✘ [ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@deepseek-ai%2Fdsh-vision-adam: Not Found
#     （pnpm 的 pre-run deps 状态检查触发的 install，需要联网解析 registry；与本修复无关）
./node_modules/.bin/tsdown
#   → [CJS] lib/client.js 363.70 kB │ gzip: 78.50 kB
#     [ESM] lib/index.js 65.97 kB、typert.host.js 3.46 kB、… 
#     ✔ Build complete in 755ms / 756ms（两个 config 都完成）
md5sum dsh-btw/lib/client.js && sha1sum dsh-btw/lib/client.js | cut -c1-12 && stat -c '%s' dsh-btw/lib/client.js
#   → 241b04c412be6fbca37048dcf3974589 / 93d7907f1e76 / 363701
# 宿主面未变（与 pre-image 逐字节比对）
diff /tmp/pre.txt /tmp/post.txt   # → 空（ALL_HOST_ARTIFACTS_BYTE_IDENTICAL，6 个产物）
diff -rq …/preimage-lib-20260923-113216 lib/
#   → 仅 client.js 不同，其余全部相同

# 部署（被拒）
cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/
#   → cp: 无法创建普通文件 '…/lib/./client.js': 权限不够（≥10 个文件全部 EACCES，exit 1）
ls -ld ~/.dsh ~/.dsh/profiles/node_modules/@local/dsh-btw/lib
#   → drwx------ CNS2026495165（.dsh）；drwxrwxr-x CNS2026495165（lib）；id → uid=1001(CNS2026495165)
touch ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/.write-probe
#   → touch: 无法 touch …: 权限不够  ⇒ 沙箱边界，不是 unix 权限

# 生效核对（部署前后均同值）
curl -s …/client.js | md5sum        # → 6c29b98b645df00b8bc3e9279d6df93e（未变）
curl -s -w '%{http_code} %{size_download}\n' -o /tmp/served-btw-post.js …/client.js
#   → 200 361702
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client\.js?rev=[a-f0-9]*'
#   → dsh-btw/client.js?rev=a0ba609897df（未变）

# E2E（U5）
node .workspace/btw-question/e2e/repro-btw-question.mjs --label after --hold-ms 3000
#   → VERDICT=NEVER-ON firstOn=nullms firstOff=nullms on=0/56
node .workspace/btw-question/e2e/repro-btw-question.mjs --label after-dense --hold-ms 3000 --sample-ms 15
#   → VERDICT=REVERTED firstOn=162ms firstOff=225ms on=4/181
node .workspace/btw-question/e2e/compare-main-question.mjs --label main-ref2
#   → captured official card reference（OK）

# 离线像素 harness（U5 替代面）
node .workspace/btw-question/harness/build-harness.mjs
#   → class hash prefix: SalQ5q / legacy rules extracted: 6
node .workspace/btw-question/harness/capture-harness.mjs
#   → before/light selected bg=rgba(183,232,91,0.12) border=color(srgb 0.699 0.887 0.348/0.616)   ← 绿
#     after /light selected bg=rgba(38,49,72,0.06)  border=rgba(0,0,0,0.1)                          ← 与主会话同值
#     after /dark  selected bg=rgba(255,255,255,0.08) border=rgba(255,255,255,0.12)

# 边界核对（U7）
git status --short -- dsh-btw/src dsh-btw/tests dsh-btw/README.md docs FEATURE-MAP.md dsh-btw/package.json
git diff --stat -- dsh-btw/src/host dsh-btw/src/shared dsh-btw/src/remote-descriptors.ts dsh-btw/src/index.ts dsh-btw/package.json dsh-btw/tsdown.config.ts   # → 空
git diff --stat -- dsh-btw/README.md dsh-btw/README.zh.md                                                                                                # → 空
grep -rn "questionOptionActive" dsh-btw/src dsh-btw/tests                # → 0 命中
grep -rn "aria-pressed" dsh-btw/src                                      # → 1 命中：SideChatButton.tsx:33（启动器 toggle，范围外）
grep -n "aria-pressed" dsh-btw/lib/client.js                             # → 1 命中（即上述 toggle，已进新包）
git diff -- src/client/side-chat.module.css | grep -E "^[-+].*(questionCard|questionDot|questionHead|btwQuestionPulse|questionInput|questionHint|questionError)"
#   → 仅新增一条注释（外壳与保留元素零改动）
```

**一次环境损伤与恢复（如实记录）**：`pnpm build` 失败时 pnpm 把 13 个包目录移入了 `dsh-btw/node_modules/.ignored/`（tsdown/typescript/vitest/zod/oxlint/publint/react/react-dom/lightningcss/happy-dom/dsh-better-sidebar/@types/@deepseek-ai/*），造成 `.bin` 下 7 个符号链接断裂。已用 `cp -a node_modules/.ignored/. node_modules/ && rm -rf node_modules/.ignored` **完整还原**，复核 `node_modules/.bin/*` 断裂数 = 0，且此后 `tsc --version`、`vitest`、`tsdown` 与全量测试均正常。**未删除任何包、未改动 `package.json`/lockfile。**

---

## 3. 部署前后 served md5 / 体积 / `?rev=`

| 时点 | 仓库 `lib/client.js` md5 | 部署位 md5 | served body md5 | 体积 | `?rev=` |
| --- | --- | --- | --- | --- | --- |
| 改动前（基线） | `6c29b98b645df00b8bc3e9279d6df93e` | 同左 | 同左 | 361 702 B | `a0ba609897df` |
| 构建后 / 部署前 | `241b04c412be6fbca37048dcf3974589` | `6c29b98b645d…` | `6c29b98b645d…` | 仓库 363 701 B / served 361 702 B | `a0ba609897df` |
| 部署后 | `241b04c412be6fbca37048dcf3974589` | `241b04c412be6fbca37048dcf3974589` | `241b04c412be6fbca37048dcf3974589` | 363 701 B | `93d7907f1e76` |

⇒ **部署判据（served md5 == 仓库 md5）已满足**。时间线：本档执行时 Step 3 被沙箱拒绝（线上仍为 `6c29b98b645d…`，判据未满足）；**收尾复测时已由有写权限方落地**，三处字节完全一致。

---

## 4. E2E before → after 对照 + 目视结论

### 4.1 采样对照（btw 卡片）

| 运行 | 标签 | 判定 | firstOn | firstOff | 选中采样比 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 修复前（协调者，旧包） | `before` | `REVERTED` | 166 ms | **270 ms** | 2/56 | 基线证据 |
| 本次（旧包，50 ms 采样） | `after` | `NEVER-ON` | — | — | 0/56 | 只能说该次未观测到选中态，**不能**排除 click 未生效；错过窗口为**推断** |
| 本次（旧包，15 ms 采样） | `after-dense` | `REVERTED` | 162 ms | **225 ms** | 4/181 | 与基线同现象同量级 |

三条都是**同一份线上旧包**的结果 ⇒ 它们证明的是「本档运行时修复尚未生效」，**不构成修复后的验收**。修复后的验收须对**已部署的新包**重跑（`--label after-deployed`，期望 `VERDICT=PERSISTED`）；该复测**本档未做**（见 §8 未验证项）。

### 4.2 主会话参照物（`main-ref2`，2026-09-23T03-40-45-729Z）

官方卡片实测（`[data-question-key] button[class*="_option"]`）：
- 未选中：`role=radio`、`aria-checked=false`、`bg rgba(0,0,0,0)`、`border rgba(0,0,0,0)`（透明）、`radius 12px`、`min-height 40px`、`padding 8px 12px 8px 8px`、首子元素 `Mbwy4a_number` 文本 `1`。
- 选中：`class` 追加 `optionSelected`、`aria-checked=true`、`bg **rgba(38, 49, 72, 0.06)**`、`border **rgba(0, 0, 0, 0.1)**`、文字色不变 `rgb(15,17,21)`。

### 4.3 harness 真实渲染（新 CSS 编译产物 + 真 token）

`analyze_image` 目视（`2026-09-23T03-38-46-274Z-after-light.png` / `…-before-light.png`）：

| 判据（plan U5.4） | 结论 |
| --- | --- |
| ① 选中态在截图里可见 | ✅ 选中行有**明确的中性灰蓝底 + 可见边框**；多选版另有**黑色实心勾选框**（白勾）⇒ 选中态不再只靠颜色 |
| ② 选项行有 1/2 序号徽标、选中底为中性灰蓝（不再绿） | ✅ 单选版左侧可见圆角方形 `1`/`2` 徽标；选中底 `rgba(38,49,72,0.06)`、边 `rgba(0,0,0,0.1)`（**与官方 main-ref2 实测逐值相同**）；选项行**无绿色** |
| ③ 卡片外壳仍是 btw 绿、无观感退化 | ✅ 外壳仍为绿色描边 + 淡绿底 + 饱和绿点（`#b7e85b` 系）⇒ 品牌身份保留 |
| ④ 与官方卡片观感一致 | ✅ 序号徽标 + 中性选中底/边 + `min-height:40px`/`radius:12px`/`padding:8px 12px 8px 8px` 与 main-ref2 逐项一致（**有意差异**：btw 未选中行保留可见边框，官方为透明） |

**目视发现的遗留观感事实（如实记录，非缺陷）**：`.questionCard` 的淡绿底 + 官方中性灰蓝选中底叠在一起时，选中底对比度较弱（1.05–1.15:1 量级）——这是**保留绿壳**与**对齐中性选中底**两条裁决共同作用的必然结果；官方卡片本身也是同一套低对比选中底（1.27:1 量级）。

---

## 5. 文档改动清单

见 §1/U6 的表（5 个文件 7 处落点）。`dsh-btw/README*.md` **未改**。

---

## 6. 工作区边界核对

- 未动 host / wire / schema / remote 描述符 / `package.json` 的 `dsh.client` / `tsdown.config.ts`：`git diff --stat` 对应路径**为空** ⇒ **保持热面**。
- 未动 `.questionCard` 外壳（见 §1/U2 的 `git diff` 证据）。
- 未回滚既有未提交改动：drawer resize 批次的 `SideChatDrawer.tsx`、`overlay-placement.ts`、`use-overlay-placement.ts`、`lib/client.js` 以及未跟踪的 `SideChatResizeHandle.tsx` / `drawer-size.ts` / `drawer-size-store.ts` / `tests/overlay-placement-explicit.spec.ts` **均仍在**（`git status` 可见）；`SideChatJumpList.tsx`/`index.ts`/`locales.ts`/`presentation.tsx` 亦为前批遗留、本次未触碰。
- `git status` 新增项全部为预期：本档新增 `.workspace/btw-question/`（`preimage-lib-20260923-113216/`、`harness/`、`e2e/*after*`、`exec-report.md` 等）。
- **未 `git commit` / `checkout` / `stash`**（提交决策留给用户）。
- 未修改 `.workspace/btw-question/e2e/2026-09-23T03-24-41-842Z-before*`（只读）与三份 `audit-*.md`（只读）；**除** `repro-btw-question.mjs`（plan U5.1 明确要求更新采样口径）。
- 未 kill 任何进程、未重启 dsh。

---

## 7. 自裁决

# 通过（本档执行期的「返工」唯一原因是 U4 部署被授权边界拒绝；该阻塞已于收尾前由有写权限方解除，代码与文档侧无返工项）

**原返工清单的当前状态**

1. **【已解除】U4 Step 3 部署**：本档执行时 `cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` 需写入会话工作区之外，本会话为 `workspace-write`、升级 `danger-full-access` 的申请**被用户拒绝** ⇒ 当时裁决返工。**收尾复测：已由有写权限方落地**，判据满足（served md5 == 部署位 == 仓库 = `241b04c412be6fbca37048dcf3974589`，363 701 B，`?rev=93d7907f1e76`）。**剩余待办**：重跑 U5（`--label after-deployed`，期望 `VERDICT=PERSISTED`）。
   **回滚钩子**：`cp -a /home/CNS2026495165/dsh/.workspace/btw-question/preimage-lib-20260923-113216/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（该 pre-image 是**现场取的 live 副本**，符合 notebook D4 纪律）。
2. **【不阻塞·环境类】`pnpm build` 在本机当前不可用**：pnpm 的 pre-run deps 检查会触发 `install`，而 peer `@deepseek-ai/dsh-vision-adam` 不在 npm registry（`ERR_PNPM_FETCH_404`）。本档改用**等价的仓库内直接构建** `./node_modules/.bin/tsdown`（同样是 tsdown、同样整包两个 config），已产出正确产物并逐项验证。若 runbook 要长期可用，建议后续补一个 `--ignore-scripts`/离线路径或改走 `node_modules/.bin/tsdown`。
3. **【不阻塞·可选】U6.6 的 D30 已登记但后果未实测**（已在条目内明写「未实测」）。若要闭环，用一个带 `detail: "x"` 的 `btw_ask_user` 调用实测 `sideChat/read` 的失败形态。

**非返工项（已达成/已验证）**：U1/U2/U3/U6 全部落地；typecheck / lint / 目标 spec / 全量 vitest 全通过；C1 回归锁经反向注入验真（独立交叉审计复核一致）；构建产物正确且宿主面逐字节未变；部署已落地。

**本轮文档措辞修订（交叉审计裁决落地）**：O2–O7 + 两项漏项已按修订清单落到 notebook D29/§8、arch05 `:81`/`:167` 与 §7 地图行、verify-runbook `:19`/`:56`；**O1 驳回**（见 §0.1）。仅改文档，未触碰 `dsh-btw/src`、`lib`、`tests`（`lib/client.js` md5 复证未变）。

---

## 8. 未验证项（明确不声称）

1. **【已由后续运行补齐】** 修复后的真实 GUI 端到端（点击后 `aria-checked` 持续保持 ≥3 s）**本档未做** —— 当时前置条件是部署落地（§7.1）。**收口后已由后续运行实测为 `PERSISTED`**：`.workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after.json` = `PERSISTED` / `onSampleRatio 56/56` / `firstOnMs=167` / `firstOffMs=null`；`.workspace/btw-question/e2e/2026-09-23T08-03-24-466Z-final.json` = `PERSISTED` / `55/55` / `firstOnMs=185` / `firstOffMs=null`（两产物 `pageErrors=[]`）。⇒ 本条**不再是空白**；本档 §8 的其余条目（窄屏/多选/换题/键盘/D30）按各自状态另计。
2. **`<720px` bottom-sheet 模式下的选项行**未实测（沿用审计 A 的静态结论：scrim 不吞点击）。
3. **回答后再次提问**（`questionId` 变化 → 卡片以空草稿重挂）**在真实 GUI 未测**；已由单测 C2 覆盖。
4. **多选场景的真实交互**（方框勾 + 累加）只有单测 C3/C5 + 离线 harness 渲染证据，**未**在真实 GUI 走通一次多选提问。
5. **【已由后续实测补上】** D30 的可观察后果：本档收尾时**未实测**（机制已读源确证）；**收口后已由实测档构造出条件并实测**（详见 `.workspace/btw-question/d30-consequence.md`）——宿主 `sideChat/read` 结果校验失败 ⇒ 客户端 `poll()` 只 `console.warn` + 1 200 ms 退避、不 publish ⇒ 抽屉冻结在最后一次成功快照（无卡片 / 无报错 / 无消息更新），真机 27 次失败读 / 45 s、warn 间隔中位 1.475 s，唯一出路是按「停止」。修法落地与验证见 `.workspace/btw-question/exec-d30/report.md`。
6. **`has-focus`/键盘可达性**：选项行改为 `role=radio|checkbox` 后未做完整键盘导航实测（原结构本就不是合法 radiogroup，属改善方向；未声称无障碍已达标）。
7. **服务端 `?rev=` 与浏览器缓存的实际交互**未端到端复现（沿用审计 C 的 `curl` 结论）。
8. 本轮**未**修改任何 `settings.yaml`、未重启服务、未 kill 进程；`pnpm build` 触发的 `node_modules/.ignored` 变动已完整还原（§2 末）。
