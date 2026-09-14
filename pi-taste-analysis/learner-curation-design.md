# LEARNER_PROMPT 强化设计：taste 总结与筛选能力（prompt 层 curation）

- 设计日期：2026-09-03
- 目标文件：`/home/CNS2026495165/dsh/dsh-taste/lib/learner.js` 的 `LEARNER_PROMPT`（L30-54）
- 产出物：本设计文档（含可直接粘贴的新 prompt 全文、测试清单、改动清单、风险表）
- 用户决策依据（2026-09-03）：置信度门控与 taste 汰换**不做成代码机制**，全部交由 learner prompt 承担；learner 模型已切 `gpt-5.6-sol-ultra`（config observer，每次 spawn 现读）；两位小数置信度与 display 中文契约不变。

## 0. 结论摘要

只改 `lib/learner.js` 的 `LEARNER_PROMPT` 字符串（L30-54，渲染 25 → 54 行，净增 29 行 / +3062 字符，远低于 ~80 行预算；行数为渲染口径，围栏口径见 §2.4），把 learner 从"只学新"升级为"学新 + 维护"（curator）：新增**证据刻度锚定**（A）、**主动淘汰**（B）、**对撞裁决**（C）、**归并去重**（D）四个 prompt 职责段；现有契约链（NEW-only 学习、无新证据不改置信度、工具面、path 白名单、display 中文边车、两位小数示例、no-changes 出口）逐句保留原文——**唯一例外是有意变更并已披露**：录入准入句由"清晰/重复/明示三选一"放宽为"单次微弱暗示可 0.55 录入"（用户目标 A 的 0.55 档定义所蕴含，见 §2.3 披露行与 §9-R9）。归并取高值已用 prompt 内显式豁免句与"无新证据不改置信度"禁令和解（审计 B1，见 §2.2/§3/§6）；低置信淘汰已收回到证据驱动路径——低分单独永不构成删除理由（审计 B2，见 §2.2/§4.4）。配套新增 7 个测试（§7.1 六个 prompt 断言 it + §7.2 一个 executeEdit 删除语义 test），205 个既有测试零改动零回归（回归门 212，见 §7.3）。删除语义已实证可达：`edit_taste_file` old_text=整行、new_text="" → 条目数 -1、边车键自动 prune（见 §4 实证记录）。

---

## 1. 现状实证（设计前已亲读）

### 1.1 LEARNER_PROMPT 现有结构（lib/learner.js）

| 行号 | 内容 | 契约点 |
|---|---|---|
| L30 | 角色段：taste-learning agent，记录 DURABLE 可泛化偏好 | — |
| L32 | Learn ONLY from the NEW messages；旧上下文仅供解析引用；Do NOT re-record；无新证据不得升降置信度 | 契约 1/2（现有测试断言逐字依赖） |
| L34-37 | 工具面：write/edit/read；scope global/project；path 只能 `taste.md` 或 `{category}/taste.md` | 契约 3 |
| L39-50 | display 中文边车：content 英文、键=语句原文、null 被拒、省略=保留现有译文 | 契约 4（8 条测试断言逐字依赖） |
| L52-53 | bullet 格式 + 两位小数示例 `Confidence: 0.88` + "Only record clear, repeated, or explicitly-stated" + "Prefer amending existing files over creating near-duplicates" | 契约 5 |
| L54 | 无可学时零工具调用、回复 "no changes" | 契约 6 |

### 1.2 buildLearnerInput 与预算（lib/learner.js L88-99, L179-180, L234）

- 输入三段：taste 树 → 旧窗口（仅 20 条、context only）→ NEW messages。
- `observer.maxInputChars`（默认 16000）只 clip **input**（L179-180）；prompt 经 `systemPrompt.section`（L234, order 190）注入 **system 段**，不占 input 预算，只占子代理上下文——加长 prompt 的成本是子代理注意力而非 16k 预算。

### 1.3 executeEdit 删除语义（lib/learner-tools.js，详见 §4）

- L184：old_text 非空门槛（new_text 为空**合法**）；L210-218 唯一匹配校验；L219 `current.replace(old_text, new_text)` 纯文本替换。
- L221-224：edit 前后各做一次 `parseTasteFile` 取 statement key 集；L231-233：key 集变化 → `pruneDisplayMap(scopeDir)` 自动清理边车孤儿键。
- L338 工具 schema 已明示 "Replacement text (may be empty to delete)"。
- `storage.js` L119-129：parseTasteFile 跳过空行——删除残留空行不影响解析。
- `reorganizeIfNeeded`（storage.js L383）与删除操作零交集：全仓库 grep 仅三处提及——定义本身、`test/storage.test.js` 覆盖、`REVIEW.md` 文档描述，**无任何生产调用点**（index.js 不导入，learner 工具链完全不触及），删除不可能触发重组；即便未来接线，`parseCategorySections`（storage.js L363-368）只收 `learningCount > 0` 的段，删除清空一段不会进入迁移候选（且迁移门槛是 >5 条，L389）。

### 1.4 调研报告关键输入（confidence-mechanism-research.md）

- §1/§6.3：上游全 prompt 只有孤例 `0.9`，**无刻度锚定**是公认缺口；报告建议 0.9=多次明确重复 / 0.7=单次明确陈述 / 0.5=间接推断——本设计五档是其超集（§2）。
- §6.1：minConfidence 注入门禁是上游 v2 试过并在 v3 **刻意放弃**的方向（approved-only → 全量注入）——用户"不做代码机制"的裁决与上游教训一致。
- §4：上游对冲突（相反偏好）无任何机制，v2 的 `[superseded]` 状态机 v3 已删——C 职责在 prompt 层重建 supersede 语义，**不复活代码状态机**。
- §5 差异表两行对本设计的约束：(a) 我们的 `write_taste_file` 是**并集合并**（learner-tools.js L93-103：content 未陈述的既有条目全部保留）→ **删除/归并不能走 write，必须走 edit**；(b) `mergeTasteEntries` 只按 `normalizePreferenceKey` 精确去重 → 同义不同词的近重复**代码层不会合并**，只能靠 prompt（D 职责）。

---

## 2. 新 prompt 全文草案（paste-ready）

### 2.1 与旧文的段映射（行号锚点与插入位置）

| 新段 | 来源 | 位置 |
|---|---|---|
| ① Role | 改写 L30（原句保留 + 追加 curator 职责一句） | 替换 L30 |
| ② Evidence & scale（新，职责 A） | 全新 | 插在原 L30 与 L32 之间 |
| ③ Learning rules | L32 原文逐字 + 证据规则段末尾追加归并豁免句（审计 B1 方案 2）+ L54 首句迁移改写（**准入门槛有意放宽**，语义变化见 §2.3 披露行） | 替换 L32 |
| ④ Maintenance rules（新，职责 B/C/D） | 全新 | 插在 ③ 之后、原 L34（工具段）之前 |
| ⑤ Tools & file format | L34-37 原文 + L52-53 格式示例 + "Prefer amending…" + 新增 old_text 唯一性半句 | 替换 L34-37、L52-53 |
| ⑥ Display rules | L39-50 **逐字保留** | 原位（跟在 ⑤ 后） |
| ⑦ Exit | L54 改写：加"且无需维护"条件 | 替换 L54 |

### 2.2 全文（渲染文本；粘贴时反引号需转义为 `\``，全文无 `${` 序列；2026-09-03 按审计 B1/B2 修订）

```
You are the taste-learning agent for DeepSeek Harness (DSH). Review the NEW messages and the user's current taste files, then record DURABLE, generalizable preferences the user revealed — coding style, tooling, workflow, and communication preferences — not one-off task details. You are also the curator of the existing files: each pass, retire what the user has moved away from, resolve contradictions, and merge near-duplicates.

## Evidence and the confidence scale

Anchor every confidence score to the strength of the evidence, always with two decimals:
- 0.55 — a single faint hint: the preference is implied once, indirectly.
- 0.65 — a single explicit statement: the user said it once, plainly.
- 0.75 — repeated or corroborated: stated independently twice, or once explicitly plus consistent behavior.
- 0.85 — repeatedly explicit and enforced: the user restated it and corrected deviations from it.
- 0.95 — repeatedly explicit and written down: anchored in an artifact the user maintains (AGENTS.md, config, committed docs).
Intermediate values interpolate between anchors. Evidence strength is judged from the NEW messages only.

## Learning rules

Learn ONLY from the NEW messages. The previously analyzed conversation was already mined by earlier passes — it is provided so you can resolve references, never to be re-learned. Do NOT re-record a preference that already exists in the taste files, and do NOT raise or lower an existing learning's confidence unless the NEW messages themselves contain fresh evidence for it. Seeing the same preference again in the previously analyzed context is not evidence. (The single exception: when merging near-duplicates, the merged line keeps the higher of the two existing confidences.)
Only record durable, generalizable preferences: a single faint hint may still be recorded at 0.55; record nothing for one-off task details.

## Maintenance rules

Besides learning new preferences, scan the existing entries on every pass:
- Retire outdated entries: when the NEW messages show the user's behavior or fresh statements overturning an existing entry, delete that line with edit_taste_file (old_text = the full bullet line including its trailing newline, new_text = "") or supersede it by rewriting the statement in place.
- Demote stale low-confidence entries: an entry below 0.55 that the NEW messages contradict or move away from follows the retire/supersede rules above; otherwise leave it unchanged — a low score alone is never a reason to delete. Never delete on suspicion alone — deletion requires clearly outdated or clearly contradicted evidence; when in doubt, leave the entry unchanged.
- Resolve contradictions: when NEW evidence points opposite to an existing entry, weigh it explicitly. Strong new evidence (an explicit statement or repeated behavior) → supersede: rewrite or delete the old entry and record the new preference. Weak new evidence (a single ambiguous hint) → keep the existing entry unchanged and do not record the contradiction. State a one-line rationale for the adjudication in your final reply; never write rationale text into the taste files.
- Merge near-duplicates: two entries in the same file stating the same preference in different words should become one — keep the clearer wording, set the confidence to the higher of the two, delete the other line, and re-provide the Chinese display for the merged statement. Do not merge across scopes; a project entry duplicating a global one is legitimate layering.

## Tools and file format

Use the tools to update taste files. Every tool takes a scope, "global" (user-wide) or "project" (current repository), and a path that MUST be either "taste.md" (the root file) or "{category}/taste.md" (a single category folder) — never any other name or nesting:
- write_taste_file to create/replace a file. It merges, it never deletes — retiring or merging always goes through edit_taste_file.
- edit_taste_file to amend an existing file (old_text must match exactly one place; new_text may be empty to delete). Prefer old_text that includes the full statement text so the match stays unique.
- read_taste_file to inspect a file before editing.

Record each learning as a markdown bullet ending in a confidence score, e.g.
  - Prefers tabs over spaces. Confidence: 0.88
Prefer amending existing files over creating near-duplicates.

## Display (Chinese) rules

When you record a NEW preference, also pass its Chinese rendering in the optional
`display` parameter of write_taste_file / edit_taste_file: an object mapping the exact
English statement text to its Chinese statement, e.g.
  display: {"Prefers tabs over spaces.": "偏好使用制表符缩进。"}
Rules:
- The taste file content itself must stay ENGLISH — never write Chinese into `content`;
  Chinese goes ONLY into `display`.
- `display` keys must be the statement exactly as written in `content`; other keys are ignored.
- When you only raise/lower an existing learning's confidence, you MAY re-provide its
  `display`; omit `display` to keep the existing translation unchanged.
- When you have no Chinese rendering to provide, OMIT `display` entirely — never pass
  `null` or an empty value (the tool rejects null).

## Exit

When the new messages reveal nothing durable AND no existing entry needs retiring, superseding, or merging, make no tool calls and reply "no changes".
```

### 2.3 契约链逐条保留对照（现有 13 条测试断言全部不破；末行为 M1 披露行）

| 现有断言（test/learner.test.js L56-75） | 新文中位置 | 状态 |
|---|---|---|
| `/Learn ONLY from the NEW messages/` | ③ 首句逐字 | ✅ 原文 |
| `/never to be re-learned/` | ③ 逐字 | ✅ 原文 |
| `/Do NOT re-record a preference that already exists/` | ③ 逐字 | ✅ 原文 |
| `/reply "no changes"/` | ⑦ 逐字 | ✅ 原文 |
| `/write_taste_file\|edit_taste_file\|read_taste_file/` | ⑤ 工具列表 | ✅ 原文 |
| `/Confidence: 0\.88/` | ⑤ 示例行逐字 | ✅ 原文 |
| `` /`display` parameter of write_taste_file \/ edit_taste_file/ `` | ⑥ 逐字 | ✅ 原文 |
| `/display: \{"Prefers tabs over spaces\.": "偏好使用制表符缩进。"\}/` | ⑥ 逐字 | ✅ 原文 |
| `/must stay ENGLISH/` | ⑥ 逐字 | ✅ 原文 |
| `/Chinese goes ONLY into `display`/` | ⑥ 逐字 | ✅ 原文 |
| `/keys must be the statement exactly as written in `content`/` | ⑥ 逐字 | ✅ 原文 |
| `/omit `display` to keep the existing translation unchanged/` | ⑥ 逐字 | ✅ 原文 |
| `/never pass\s+`null` or an empty value/` | ⑥ 逐字（含换行） | ✅ 原文 |
| （无既有断言——**披露行**，审计 M1）旧句 `Only record clear, repeated, or explicitly-stated preferences` | ③ 第二段改写为 `Only record durable, generalizable preferences: a single faint hint may still be recorded at 0.55; record nothing for one-off task details` | ⚠️ **有意语义变化**：录入准入由"清晰/重复/明示三选一"放宽为"单次微弱暗示可 0.55 录入"——用户目标 A 的 0.55 档定义所蕴含；风险与对冲见 §9-R9；新断言 `/a single faint hint may still be recorded at 0\.55/`（§7.1）锁定 |

`doesNotMatch(/Confidence: 0\.9\b/)`（L65）安全性：新文刻度档位全部写**裸数字**（`0.55`…`0.95`），不带 `Confidence:` 前缀；`\b` 在 "0.95" 的 "9|5" 之间不成立，无匹配风险。唯一带 `Confidence:` 的数字仍是 `0.88`。

### 2.4 行数预算核算

行数口径统一为**渲染口径**（粘贴进 JS 模板字符串后的实际文本）：修订后新 prompt 渲染 **54 行 / 5349 字符**，旧文 25 行 / 2287 字符，**净增 29 行 / +3062 字符 < 80 行预算**（初稿渲染同为 54 行 / 5138 字符；B1/B2 修订 +211 字符、行数不变。另一口径：代码块围栏内原始 56 行含首尾空行，粘贴后即渲染 54 行）。system 段不占 `observer.maxInputChars`（§1.2），成本仅为子代理上下文与注意力（风险 §9-R1）。契约完整性已程序化验证：修订后草案对 13 条既有断言 + L65 doesNotMatch 守门 + §7.1 全部 21 条断言（18 条原有 + 3 条修订新增）共 **35 项检查全部通过**（2026-09-03，/tmp/learner-curation-revise/build-and-check.mjs 施加 B1/B2 编辑后核验、verify-final.mjs 对修订后文档 §2.2 原样复验；初稿复验见 /tmp/taste-del-verify/check-prompt.mjs，独立审计复验见 /tmp/learner-curation-audit/check-prompt.mjs）。

---

## 3. 刻度锚定表（职责 A）

| 档位 | 证据强度定义（一句话） | 对应"单次暗示 / 反复明示 / 成文记录"谱系 |
|---|---|---|
| 0.55 | 单次微弱暗示：偏好被间接隐含地体现一次 | 单次暗示（最弱端） |
| 0.65 | 单次明确陈述：用户直白说过一次 | 单次明示 |
| 0.75 | 重复或佐证：独立出现两次，或一次明示 + 行为一致 | 反复出现 |
| 0.85 | 反复明示且被执行：用户重申并纠正过偏离 | 反复明示 |
| 0.95 | 反复明示且已成文：锚定在用户维护的产物（AGENTS.md、config、committed docs） | 反复明示 + 成文记录（最强端） |

- 档间值线性插值（prompt 内明示 "Intermediate values interpolate between anchors"）。
- 刻度与防漂移约束的关系：刻度只决定**新录条目**的起评分与**有新证据时**的修订目标；无新证据仍一律不动（L32 原句保留，见 §2.3），**唯一显式豁免**是归并近重复时保留行取两条中较高置信度——豁免句已写入 prompt ③ 段正文（审计 B1：豁免不再只存在于设计文档，模型可见，禁令与归并取高不再字面冲突；取高是两条既有数值的保守上界，不引入新证据评估，见 §6）。这与调研报告 §6.2"『无新证据不改置信度』是防漂移核心"一致。
- 与用户口径对齐：`0.55=单次微弱暗示…0.95=多次明示+成文记录`（用户原话的逐档展开）。

---

## 4. 淘汰语义精确定义（职责 B）

### 4.1 删除操作的 edit 参数组合

- `scope`/`path`：目标条目所在文件（`taste.md` 或 `{category}/taste.md`）。
- `old_text` = **完整 bullet 行**（`- <statement> Confidence: <两位小数>`）**含行尾换行符**；
- `new_text` = `""`（空串）。
- 效果：该行整行移除，不留空行；若模型漏带换行符，会残留一个空行——`parseTasteFile` 跳过空行（storage.js L121-123 `continue`），解析无害，仅文件观感（prompt 已要求带换行；见 §9-R4）。

### 4.2 代码依据（必写行号）

1. **删除可达**：`executeEdit`（learner-tools.js L219）`current.replace(args.old_text, args.new_text)` 纯文本替换，`new_text=""` 即删除；L184 只拦**空 old_text**，空 new_text 合法；L338 工具 schema 明示 "may be empty to delete"。
2. **唯一性门槛**：L210-218 `hits===0 → error: old_text not found`；`hits>1 → error: matches N locations`。整行 old_text（含语句全文）天然唯一，满足门槛。
3. **边车自动清理（verify 通过）**：L221-224 在锁内取 edit 前后的 statement key 集（`parseTasteFile → normalizePreferenceKey`）；L231-233 `if (!sameKeySet(before, after)) await pruneDisplayMap(scopeDir)`——删除整行使 after 集少一个 key → key 集变化 → `pruneDisplayMap` 自动删掉该条目的中文边车键。**删除无需任何新代码，边车零残留。**

### 4.3 实证记录（2026-09-03，/tmp/taste-del-verify/verify.mjs，已跑通）

种子：`taste.md` 两条（`- Prefers tabs over spaces. Confidence: 0.88` / `- Uses worktree for parallel work. Confidence: 0.72`），`display.zh.json` 含两条的中文键。

| 用例 | old_text | 结果 |
|---|---|---|
| case1 | 整行**不带**换行符，new_text="" | ✅ `edited taste.md`；文件剩 1 条 + 1 个空行；parse 条目数 2→1；边车仅剩幸存条目键（被删键已 prune） |
| case2 | 整行**含**换行符，new_text="" | ✅ `edited taste.md`；文件干净剩 1 条无空行；parse 1 条；边车同上 |
| case3 | 前导换行符 + 整行，new_text="" | ✅ 同 case2（等价写法） |

（该脚本即 §7.2 新测试的原型，断言逻辑已被脚本验证。）

### 4.4 淘汰触发条件（prompt 措辞，护栏见 §9-R2）

- (a) **过时**：NEW 消息中用户行为或新陈述推翻既有条目 → 删除或原地改写（supersede）。
- (b) **低置信存量（审计 B2 修订：证据驱动）**：低于 0.55 **且 NEW 消息与之矛盾/背离** → 走 (a)/(c) 的 retire/supersede 规则；**否则一律保持不动——低分单独永不构成删除理由**。"低于 0.55" 只是提示存量清理的观察线索，不构成独立删除授权（learner 单轮不可得"长期低置信"的时间维度信息；原措辞 "stuck below 0.55 … trivial and un-reinforced may be lowered or deleted" 依赖不可得信息且与护栏句矛盾，已废弃）。
- 护栏原句（已写入 prompt；B2 修订后各分支删除授权均以 NEW 消息证据为前提，与护栏句零冲突）："Never delete on suspicion alone — deletion requires clearly outdated or clearly contradicted evidence; when in doubt, leave the entry unchanged."

---

## 5. 对撞裁决规则（职责 C）

- **判据（方向性）**：NEW 证据与既有条目**方向相反**——不是程度差异（0.6 vs 0.8 的同一偏好不算对撞），而是语义对立（例：既有"prefers worktree for parallel work" vs 新证据"prefers standalone repos for parallel work"）。
- **动作分支**：
  - 新证据**充分**（明确陈述，或反复行为一致）→ **supersede**：`edit_taste_file` 改写旧条目语句（原地）或删除旧行 + 记录新偏好；新条目置信度按 §3 刻度独立评估，不继承旧值。
  - 新证据**不足**（单次模糊暗示）→ **保持现状**：不学新、不动旧条目（防止弱信号翻转强条目）。
- **裁决记录方式**：**最终 assistant 回复里一句 rationale**（如 "Superseded 'worktree' entry: user stated standalone repos twice in this turn."），**不写入任何文件**——taste.md 行格式是纯 `statement + Confidence`，无元注释位；display 边车只接受 statement→中文 映射，也不承载 rationale。理由进回复即可被人从 GUI 会话记录看到。

---

## 6. 归并规则（职责 D）

- **判据**：同一文件内两条条目 `normalizePreferenceKey` **不同**（代码去重不会触发，learner-tools.js L93-103 只合并同 key）但语义近似（同一偏好的不同表述）。
- **动作**：
  1. `edit_taste_file` 把保留行改写为更清晰的合并表述（若表述变化，置信度同时写入取高值）；
  2. `edit_taste_file` 删除另一行（§4.1 参数组合）；
  3. **重新提供合并语句的中文 display**（edit 的 `display` 参数）——语句文本变了 → key 集变化 → 旧译文被 L231-233 prune，不补就丢中文。
- **置信度取两条中较高者**：prompt ③ 段已写入显式豁免句 "(The single exception: when merging near-duplicates, the merged line keeps the higher of the two existing confidences.)"——归并取高不再与"无新证据不改置信度"禁令字面冲突（审计 B1 修订：豁免从设计文档落进 prompt 正文，模型可见，不再依赖模型自行脑补"保守上界"）；取高仍是两条既有数值的保守上界，不构成新证据评估；降分仍须满足"新证据"约束才允许。
- **边界**：只归并**同文件**条目；跨 scope（global vs project）的同义条目是合法分层，不归并（prompt 已明示 "Do not merge across scopes"）。
- **为什么必须走 edit 而非 write**：`write_taste_file` 是并集合并（L93-103：content 未陈述的既有条目全部保留），**删除不可达**——归并/淘汰只能用 edit。

---

## 7. 测试清单

### 7.1 prompt 内容断言（test/learner.test.js，describe "LEARNER_PROMPT" 内新增 6 个 it：3 个原有 + 3 个审计 B1/B2/M1 修订新增）

```js
it("anchors confidence scores to an evidence-strength scale (curation design §3)", () => {
	for (const rung of ["0\\.55", "0\\.65", "0\\.75", "0\\.85", "0\\.95"]) {
		assert.match(LEARNER_PROMPT, new RegExp(rung));
	}
	assert.match(LEARNER_PROMPT, /interpolate between anchors/i);
	assert.match(LEARNER_PROMPT, /Evidence strength is judged from the NEW messages only/);
});

it("assigns curation duties: retire, adjudicate contradictions, merge near-duplicates", () => {
	assert.match(LEARNER_PROMPT, /Retire outdated entries/);
	assert.match(LEARNER_PROMPT, /old_text = the full bullet line including its trailing newline, new_text = ""/);
	assert.match(LEARNER_PROMPT, /Never delete on suspicion alone/);
	assert.match(LEARNER_PROMPT, /supersede/i);
	assert.match(LEARNER_PROMPT, /Merge near-duplicates/);
	assert.match(LEARNER_PROMPT, /higher of the two/);
	assert.match(LEARNER_PROMPT, /one-line rationale for the adjudication in your final reply/);
	assert.match(LEARNER_PROMPT, /never write rationale text into the taste files/);
});

it("keeps write as merge-only and steers retirement through edit_taste_file", () => {
	assert.match(LEARNER_PROMPT, /It merges, it never deletes/);
	assert.match(LEARNER_PROMPT, /retiring or merging always goes through edit_taste_file/);
	assert.match(LEARNER_PROMPT, /new_text may be empty to delete/);
});

it("admits a single faint hint at 0.55 — the scale-defined entry threshold (review M1)", () => {
	assert.match(LEARNER_PROMPT, /a single faint hint may still be recorded at 0\.55/);
});

it("grants the single no-fresh-evidence exception for merging near-duplicates (review B1)", () => {
	assert.match(LEARNER_PROMPT, /the merged line keeps the higher of the two existing confidences/);
});

it("makes low-confidence demotion evidence-driven — a low score alone never deletes (review B2)", () => {
	assert.match(LEARNER_PROMPT, /a low score alone is never a reason to delete/);
});
```

**既有断言全部不动**：L55-76 三个 it（契约链 / 两位小数 / display 中文）原样保留——新 prompt 逐字保留了它们依赖的全部短语（§2.3 对照表已逐条核过）。修订新增的三个 it（审计 B1/B2/M1 各一条断言，见 M2）与原三个 it 互不重叠、逐字未动原断言；§7.1 合计 6 个 it / 21 条断言，已对修订后 §2.2 草案程序化验证 21/21 通过（/tmp/learner-curation-revise/verify-final.mjs）。特别约束：**未来改 prompt 永远不要出现 "Confidence: 0.9"+词边界**（L65 `doesNotMatch` 守门，刻度档位一律写裸数字）。

### 7.2 executeEdit 删除语义测试（test/learner-tools.test.js 新增 1 个 test）

现状核查：L341 的测试覆盖"改写语句→prune 旧键、仅改置信度→保留键"，**没有**"空 new_text 整行删除→条目 -1+边车 prune"的等价测试，需新增（复用同文件 `makeScopes`/`seed`/`setup`/`bullet`/`loadDisplayMap` helper，原型即 §4.3 已验证脚本）：

```js
test("edit_taste_file deleting a full line with empty new_text removes the entry and prunes its display key", async (t) => {
	const scopes = await makeScopes();
	t.after(scopes.cleanup);
	const file = await seed(
		join(scopes.globalDir, "taste.md"),
		bullet("Stale worktree preference.", 0.72) + "\n" + bullet("Keeps semicolons everywhere.", 0.80) + "\n",
	);
	await seed(
		join(scopes.globalDir, "display.zh.json"),
		JSON.stringify({
			[normalizePreferenceKey("Stale worktree preference.")]: "过时的 worktree 偏好。",
			[normalizePreferenceKey("Keeps semicolons everywhere.")]: "到处保留分号。",
		}),
	);
	const [, , edit] = setup(scopes);
	const result = await edit.execute(
		{ scope: "global", path: "taste.md", old_text: bullet("Stale worktree preference.", 0.72) + "\n", new_text: "" },
		{},
	);
	assert.equal(result, "edited taste.md");
	const saved = await readFile(file, "utf8");
	assert.equal(bulletCount(saved), 1);
	assert.match(saved, /Keeps semicolons everywhere\./);
	assert.deepEqual(await loadDisplayMap(scopes.globalDir), {
		[normalizePreferenceKey("Keeps semicolons everywhere.")]: "到处保留分号。",
	});
});
```

### 7.3 回归门

`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"`——205 旧 + 7 新 = **212 全绿**（§7.1 六个 it + §7.2 一个 test；基线 205/205 已于修订日亲跑复核，fail 0）；translate.test.js L261 断言 translate 用独立 prompt，不受本改动影响。

---

## 8. 改动清单

| # | 文件 | 改动 | 性质 |
|---|---|---|---|
| 1 | `lib/learner.js` L30-54 | `LEARNER_PROMPT` 字符串整体替换为 §2.2 全文（反引号转义 `\``）；L22-29 文档注释补一句 curation 职责说明 | 唯一生产代码改动（纯字符串） |
| 2 | `test/learner.test.js` | 新增 §7.1 的 6 个 it（3 个原有 + 3 个审计 B1/B2/M1 修订新增）；既有断言零改动 | 测试 |
| 3 | `test/learner-tools.test.js` | 新增 §7.2 的 1 个 test | 测试 |

**明确不做**（用户裁决 2026-09-03 + 上游教训）：
- ❌ 代码级淘汰/GC/衰减/时间戳（上游无此机制；v2 状态机已被 v3 刻意移除）
- ❌ minConfidence 注入门禁 / 任何置信度参与注入决策的代码（上游试过并放弃）
- ❌ `lib/storage.js`、`lib/learner-tools.js`、`lib/translate.js`、注入链路、config 的一切改动
- ❌ 新依赖、官方包改动（零新依赖纪律）

生效方式：prompt 是每次 spawn 现读的字符串，改完即对新 learner 生效，无需重启 dsh。

---

## 9. 风险表

| # | 风险 | 评估 | 缓解 |
|---|---|---|---|
| R1 | prompt 变长稀释注意力（渲染 25→54 行） | 中：gpt-5.6-sol-ultra 长上下文服从性**是假设，未经实测**（本部署无法离线验证） | 净增 29 行 / +3062 字符 < 80 预算；小节标题 + bullet 可扫描；契约短语被 13 条既有断言锁死，漂移即测试红 |
| R2 | 淘汰指令诱发过度删除 | 高敏：删除不可逆（无回收站） | 护栏原句 "Never delete on suspicion alone — deletion requires clearly outdated or clearly contradicted evidence; when in doubt, leave the entry unchanged"（B2 修订后各分支删除授权均以 NEW 消息证据为前提，与护栏句零冲突）；(b) 分支已收回到证据驱动——低分单独永不删除（"a low score alone is never a reason to delete" 有断言锁）；删除仅两条路径：NEW 消息推翻（a）或强证据对撞 supersede（c）；对撞弱证据分支=保持不动 |
| R3 | 对撞误判（弱信号翻转强条目） | 中 | 弱证据分支显式"keep + 不学新"；裁决 rationale 强制进最终回复，人在 GUI 会话记录可审计 |
| R4 | 删除漏带换行符 → 残留空行累积 | 低 | prompt 明示 old_text 含行尾换行；parseTasteFile 跳空行（storage.js L121-123），解析与注入零影响，仅观感 |
| R5 | 归并丢中文译文（语句变了旧键被 prune） | 低 | prompt 明示"re-provide the Chinese display for the merged statement"；sanitizeDisplay 以 after 集 bounds（learner-tools.js L235），错键会被丢并留 log |
| R6 | no-changes 出口语义放宽（纯维护轮也调工具） | 有意变更 | 原"无可学零调用"改为"无可学**且无需维护**零调用"——正是职责 B/D 的落地；断言 `/reply "no changes"/` 不破 |
| R7 | 刻度档位诱发一位小数回退 | 低 | 档位全部两位小数裸数字；示例保持 `Confidence: 0.88`；L65 `doesNotMatch(/Confidence: 0\.9\b/)` 守门 |
| R8 | write/edit 职责混淆（模型用 write 做删除） | 低 | 工具段明示 "It merges, it never deletes — retiring or merging always goes through edit_taste_file" |
| R9 | 录入面放宽（单次微弱暗示可 0.55 录入，M1 披露）→ 条目总量增速上升，长期挤占注入预算 | 中：刻度下限即起评 0.55，弱信号不再被准入门槛挡在门外 | B/D 职责对冲：每轮证据驱动淘汰 + 归并去重防语义膨胀；注入侧 16k clip（learner.js L179-180）兜底；准入句有断言 `/a single faint hint may still be recorded at 0\.55/` 锁定，未来收紧或放宽都会显式触发测试改动 |

---

## 附：验证与依据文件索引

- 亲读：`lib/learner.js`（LEARNER_PROMPT L30-54 / buildLearnerInput L88-99 / clip L179-180 / section L234）、`lib/learner-tools.js`（executeEdit L181-248、executeWrite merge L93-103）、`lib/storage.js`（parseTasteFile L119-129、renderTasteFile L152-159、parseCategorySections L363-368、reorganizeIfNeeded L383-399）、`test/learner.test.js`（L54-77 断言）、`test/learner-tools.test.js`（helpers L10-44、edit 测试 L185-262/L341-405）、`pi-taste-analysis/confidence-mechanism-research.md`（§1/§4/§5/§6）。
- 实证脚本：`/tmp/taste-del-verify/verify.mjs`（§4.3 三用例全过）与 `/tmp/taste-del-verify/check-prompt.mjs`（初稿断言复验）；修订日复验：`/tmp/learner-curation-revise/build-and-check.mjs`（对初稿 §2.2 提取件施加 B1/B2 两处编辑后核验）与 `/tmp/learner-curation-revise/verify-final.mjs`（对修订后文档 §2.2 原样复验：13 条既有断言 + L65 doesNotMatch + §7.1 全部 21 条断言 = 35 项全过；行/字符数程序化核数：25/2287 → 54/5349）。独立审计方脚本（交叉采信）：`/tmp/learner-curation-audit/check-prompt.mjs`（28 项断言复跑）与 `/tmp/learner-curation-audit/verify-delete.mjs`（删除语义四用例端到端，含 scope 级 prune 不误伤他文件）。
- 注意：用户消息中调研报告路径 `/home/CNS2026495165/dash/pi-taste-analysis/…` 实际位于 `/home/CNS2026495165/dsh/pi-taste-analysis/confidence-mechanism-research.md`（已按 fallback 读取）。

---

## 修订记录

### 2026-09-03（第二轮）：按独立审计 `dsh-taste/REVIEW-learner-curation.md`（裁决 needs-revision）修订

审计结论 needs-revision 的 2 blocker（B1/B2）+ 2 major（M1/M2）+ 3 minor（m1/m2/m3）全部处置如下；除被点名问题外未改动其他内容。

- **B1（blocker）归并取高值与"无新证据不改置信度"禁令字面冲突**：采用审计 fix 方案 2——prompt ③ 段证据规则段（"Learning rules" 首段）末尾追加豁免句 `(The single exception: when merging near-duplicates, the merged line keeps the higher of the two existing confidences.)`，④ 归并条目原文不动；豁免紧邻其例外的禁令，模型无需跨段对齐。§2.1/§2.2/§3/§6 同步。断言按审计建议锁 `/the merged line keeps the higher of the two existing confidences/`（§7.1 新 it）。
- **B2（blocker）(b) 低置信淘汰依赖单轮不可得信息且与护栏句矛盾**：采用审计推荐改写——(b) 分支删除权收回到证据驱动路径：`an entry below 0.55 that the NEW messages contradict or move away from follows the retire/supersede rules above; otherwise leave it unchanged — a low score alone is never a reason to delete.`；护栏原句 `Never delete on suspicion alone — …` 原位保留（§7.1 既有断言依赖）。"below 0.55" 降级为观察线索，不再构成独立删除理由；"stuck / trivial / un-reinforced" 措辞废弃。§4.4/§9-R2 同步。
- **M1（major）录入准入门槛放宽未披露**：§2.3 补披露行（旧句 `Only record clear, repeated, or explicitly-stated preferences` → "单次微弱暗示可 0.55 录入"，用户目标 A 的 0.55 档定义所蕴含）；§0 撤回"逐句保留原文"的绝对表述并显式披露该例外；§9 新增 R9（录入面放宽 → 条目增速上升 → B/D 职责对冲 + 16k clip 兜底）；§7.1 新增断言 `/a single faint hint may still be recorded at 0\.55/`。
- **M2（major）断言集未覆盖修订后关键句**：§7.1 在原三个 it（既有断言逐字不动）之后新增三个 it（B1/B2/M1 各一条断言，共 3 条）；测试规模 4 新 → 7 新（§7.1 六个 it + §7.2 一个 test），回归门 209 → 212（§7.3、§8 同步）。注：审计 B1 fix 建议把豁免句断言加进"§7.1 第二个 it"，为精确达成审计 M2 的"205 既有 + 7 新增 = 212 全绿门"验收数字，改为独立 it（断言内容与审计建议一致，既有断言零改动）。
- **m1（minor）行数三处口径矛盾**：全文档统一为渲染口径——旧 25 行/2287 字符 → 修订后 54 行/5349 字符，净增 29 行/+3062 字符（初稿 54 行/5138 字符；B1/B2 修订 +211 字符、行数不变）；§2.4 注明围栏口径（56 行含首尾空行）与渲染口径（54 行）的换算；§0 与 §9-R1 的"56/净增 31"、"66/净增 41"错误数字全部修正。
- **m2（minor）未分析 reorganizeIfNeeded**：§1.3 补实证 bullet——全仓库无生产调用点（仅 storage.js L383 定义、test/storage.test.js 覆盖、REVIEW.md 文档提及；index.js 不导入），learner 工具链完全不触及，删除不可能触发；即便未来接线，parseCategorySections（storage.js L363-368）只收 `learningCount > 0` 的段，删除清空一段也不进入迁移候选（迁移门槛 >5 条）。
- **m3（minor，可选）**：§7.2 测试种子 `bullet("Keeps semicolons everywhere.", 0.8)` → `0.80`。运行时等价（JS 数字字面量 0.80 === 0.8，`bullet` 模板插值渲染仍为 `Confidence: 0.8`；审计已确认 parse 兼容、无功能问题），仅源码口径呼应两位小数契约。
- **复验（2026-09-03）**：修订后 §2.2 草案对 13 条既有断言 + L65 doesNotMatch 守门 + §7.1 全部 21 条断言共 35 项检查程序化全过（`/tmp/learner-curation-revise/build-and-check.mjs` 从初稿 §2.2 提取、仅施加 B1/B2 两处编辑后核验；`verify-final.mjs` 对修订后文档 §2.2 原样复验，B1/B2 新句在位、旧措辞已清除）；基线 `node --test "test/*.test.js"` 205/205 亲跑复核（fail 0）。
- **计数勘误（顺带，非审计 issue）**：初稿 §2.3 标题与 §9-R1 写"12 条既有断言"，实际 `test/learner.test.js` L56-75 为 13 条 match + 1 条 doesNotMatch（与审计 §一.1 程序化复验一致），本轮统一修正为 13 条。
