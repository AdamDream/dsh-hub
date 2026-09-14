# pi-taste 置信度（Confidence）机制调研报告

- 调研日期：2026-09-02（重新调研，覆盖 2026-09-01 旧视角，聚焦置信度全生命周期）
- 调研对象：[LycanW/pi-taste](https://github.com/LycanW/pi-taste) v0.5.6，本地 vendor 副本 `pi-taste-analysis/vendor/pi-taste/`（钉定上游 commit `3818d9e`，见 `VENDOR.md`）
- 上游时效性：npm registry 上 pi-taste **只有 0.5.6 一个版本**（2026-08-31T19:30Z 发布，[registry.npmjs.org/pi-taste](https://registry.npmjs.org/pi-taste)）；GitHub 最新 commit 即 `3818d9e`（2026-08-31T19:33Z，via GitHub API）。**上游自 0.5.6 后零更新**，本次与旧调研面对的是同一份代码。
- 对照对象：`/home/CNS2026495165/dsh/dsh-taste/` 移植版（205/205 绿）。

## 核心结论（TL;DR）

上游 v3 的置信度是**纯模型自评的展示型元数据**：prompt 引导生成 → 存储解析+钳位 → 注入**无门槛全量** → 修订全靠模型改文件。**没有衰减、没有淘汰、没有加权、没有排序、没有 RAG**。更关键的历史事实：上游 v2 曾实现过 approved-only 注入 + `[pending]/[rejected]/[superseded]` 状态机，**v3 刻意移除**（向 Command Code 对齐）。dsh-taste 移植版没有任何遗漏，反而在 4 处超出上游。

---

## 1. 生成：Learner prompt 怎么教置信度

**格式教学**（`learner.ts:26-27`）——唯一教学材料是一行示例，一位小数：

```
Record each learning as a markdown bullet ending in a confidence score, e.g.
  - Prefers tabs over spaces. Confidence: 0.9
```

**校准/防漂移指引**（`learner.ts:19`，两条硬约束）：

> "do NOT raise or lower an existing learning's confidence **unless the NEW messages themselves contain fresh evidence** for it. Seeing the same preference again in the previously analyzed context is not evidence."

即：置信度修订只允许由 NEW 消息里的新证据驱动，旧上下文里的重复出现不算证据。另有准入约束（`learner.ts:28`）："Only record **clear, repeated, or explicitly-stated** preferences"。

**刻度定义：不存在。** prompt 里没有任何"什么证据对应 0.7 vs 0.9"的锚定或分档说明，只有孤例 0.9。置信度语义完全靠模型自觉。

**修订路径**：模型通过 `edit_taste_file`（old_text→new_text 首个匹配替换，`learner.ts:54-63, 174-177`）直接改行内数字，代码层不参与任何置信度决策。`types.ts:7` 注释将格式转述为 `- statement. Confidence: 0-n`（Command Code 兼容），`CHANGELOG.md:77,101`（v0.5.0/0.4.0）明确为 **0-1、"Confidence is model-maintained (0-1), like Command Code, instead of code-computed"**。

## 2. 存储：解析 / 校验 / 默认值 / 精度

- **解析正则**（`storage.ts:182`）：`/^\s*-\s+(.+?)\s+Confidence:\s*(\d*\.?\d+)\s*$/`——要求 `Confidence:` 前有空白；v0.5.5 起不要求语句以英文句号结尾（`CHANGELOG.md:28-29`，明确说"important for Chinese"）。
- **钳位与默认**（`storage.ts:191`）：`Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence ?? 0.5)) : 0.5`——钳位 [0,1]，非法/缺失 → **0.5**。语句 <4 字符整行丢弃（`storage.ts:186`）。测试佐证：`Confidence: 1.4` → 钳到 1（`test/storage.test.ts:34-42`）。
- **渲染精度**：写回文件时恒 `toFixed(1)` 一位小数（`storage.ts:204`）；`/taste list` 显示 `c=0.90`（两位，`index.ts:572`）。存储层没有任何分数/整型/其他格式。
- **规范化 key**（`normalizePreferenceKey`，`storage.ts:497-504`）：NFKC + 小写 + 去标点空白 + **剥离 `Confidence: x` 后缀**——同一语句不同置信度视为同一 key，置信度不参与身份判定。
- **手动路径语义**（显式用户动作 = 满值）：`/taste remember` 已存在 → 只更新语句文本、**置信度不动**（`index.ts:588-594`）；新建 → `confidence: 1`（`index.ts:599`）；`/taste import` → 所有导入条目**强制 1**，丢弃源 markdown 里已写的置信度（`index.ts:633`；测试 `test/index.test.ts:256-270`）。只有 Command Code 只读导入保留原值（`storage.ts:463-468`）。

## 3. 消费：注入门槛 / 排序 / 加权 / 衰减 / 淘汰（最关键）

**明示无门槛、全量注入**（`README.md:79`）：

> "There is **no state machine**. Anything the model writes is injected — exactly like Command Code, **including low-confidence entries**."

`CHANGELOG.md:73-74`（v0.5.0）同述："No state machine: all learnings are injected (Command Code injects everything, including low-confidence entries)."

- **注入 = 文件原文 verbatim**（`buildTasteSection`，`index.ts:155-188`）：保留标题、Confidence 值、`See [category/taste.md]` 引用（`index.ts:162-163` 注释明说"Preserve the authoritative files verbatim"）。project → global → Command Code 导入顺序拼接，`normalizePreferenceKey` 全局去重、先出现者保留（`index.ts:165-179`；测试 `test/index.test.ts:262-270`：同语句 0.8/0.9 两行 → 1 条）。
- **唯一预算约束与置信度无关**：`injection.maxChars = 16000` 字符（`storage.ts:32`），超限 `clipText`（前 35% + 尾部 40 字符，`index.ts:182-184`）——按长度裁剪，不看置信度。
- **无排序 / 无加权**：注入顺序 = 文件行序 + scope 拼接顺序，置信度不参与任何决策。
- **无衰减 / 无低置信淘汰 / 无 GC**：全库 grep `confidence` 共 74 处，无一处涉及时间、轮次、观测计数或淘汰；条目唯一删除途径是 `/taste forget`（手动，`index.ts:664-676`）或模型自己改文件。分类重组（>5 条迁目录，`storage.ts:405-423`）只看数量，不看置信度。
- **非 RAG**：`before_agent_start` 每轮全量注入 system prompt（`index.ts:498-504`），无检索、无按当前任务相关性选取。
- **UI 消费极少**：仅 `/taste list` 文本显示（`index.ts:572`）；`README.md:92` 活动卡示例里的 "(90%)" 在 v3 代码中**未实现**（`activity.ts` 无任何 confidence/百分比渲染）——文档与代码脱节，上游对置信度 UI 投入几乎为零。

**历史演变（上游做过门槛并主动放弃）**——`CHANGELOG.md:88-104`：

| 版本 | 置信度架构 |
|---|---|
| v0.1.0（2026-08-30，v1） | Observer/Reducer 管线，置信度**代码计算**，approved-only 注入 |
| v0.4.0（2026-08-31，v2） | 改为**模型自评 0-1**；状态机 `[pending]/[rejected]/[superseded]` 标记 + approved-only 注入 + Reducer |
| v0.5.0（2026-09-01，v3） | **全部移除**：无状态机、无 Reducer、无审批，全量注入（对齐 Command Code） |

## 4. 修订：重复观测与冲突

- **重复观测同一偏好**：代码层无升级/合并/计数逻辑。模型可自行用 `edit_taste_file` 改写数字，唯一约束是 prompt 的"仅 NEW 消息含新证据才升/降"（`learner.ts:19`）——即在 prompt 层面明确**禁止**"看到一次就 +0.1"式的机械累加。
- **同 key 合并**：身份由 `normalizePreferenceKey`（剥置信度）决定；`remember` 同 key 时只改文本不动置信度；`write_taste_file` 是**整文件替换**，不做 merge（`learner.ts:167-171`）——防重复靠 prompt"do NOT re-record"而非代码。
- **冲突（相反偏好）**：无专门机制。语句不同 → 两行共存，是否删旧行、如何改写置信度全由模型语义判断；无新旧对撞检测、无 superseded 自动流转（v2 的 `[superseded]` 标记在 v3 已删）。

## 5. 与 dsh-taste 移植版逐项对照

| 维度 | 上游 pi-taste 0.5.6 | dsh-taste 移植版 | 差异性质 |
|---|---|---|---|
| prompt 示例精度 | `Confidence: 0.9` 一位小数（learner.ts:27） | `Confidence: 0.88` 两位小数（lib/learner.js:53） | **移植增强**（有意） |
| 校准约束（无新证据不改） | learner.ts:19 | 逐字保留（lib/learner.js:32） | 等价 |
| 解析正则 | 要求 `Confidence:` 前有空白（storage.ts:182） | 额外容忍中文句号直连 `。Confidence:`（lib/storage.js:122） | **增强** |
| 钳位/默认值 | [0,1]，非法→0.5（storage.ts:191） | 相同（lib/storage.js:51-54） | 等价 |
| 存储渲染精度 | 恒 1 位小数（storage.ts:204） | 1-2 位自适应：0.9→"0.9"、0.88→"0.88"（lib/storage.js:139-143） | **增强** |
| write_taste_file | 整文件替换、无内容校验（learner.ts:167-171） | 校验须含有效条目；`mergeTasteEntries` 并集合并、**同 key incoming 连置信度一起覆盖**（lib/learner-tools.js:89-103, 146-152） | **增强**（防模型覆写丢条目） |
| 注入门槛/过滤 | 无（README.md:79 明示） | 无 | 等价 |
| 注入排序/加权 | 无 | 无 | 等价 |
| 衰减/淘汰/GC | 无 | 无 | 等价 |
| 注入方式 | 每轮全量 verbatim + 16k 字符裁剪 | 快照式合并注入（lib/index.js `accumulateScope`） | 等价 |
| remember/import | 新建=1；import 强制 1（index.ts:599,633） | remember 新建=1.0（lib/commands.js:146） | 等价 |
| 置信度 UI | 仅 `/taste list` 文本 `c=0.90`；活动卡无置信度 | 进度条三级 ≥0.7 高 / ≥0.4 中 / 其余低 + `toFixed(2)` 标签（lib/client.js:189-227） | **增强**（上游无此 UI） |

补充说明"同 key incoming 覆盖"：上游**不存在**这个合并点（write 是整文件替换、remember 不动置信度）；我们的 merge 是移植期防模型丢条目的增强，"置信度随 incoming 更新"与上游"置信度由模型维护"的哲学一致。

## 6. 可借鉴结论

**结论先行：上游没有我们没有的置信度设计——没有遗漏项。** 我们在解析容错、渲染精度、write 合并、GUI 展示四处超出上游。上游真正的"额外资产"是**负面教训**：

1. **minConfidence 注入门槛是上游试过并放弃的方向**（v2 approved-only → v3 全量注入，`CHANGELOG.md:73-74,99-104`）。上游证据表明：强制门槛带来审批摩擦，与"全量注入 + 手动 forget 兜底"的极简哲学冲突。若 DSH 想让置信度真正参与注入决策（当前两边的共同空白），**应做成默认关闭的配置项**（如 `injection.minConfidence`，默认 0=不过滤），并保留可关闭的逃生门——这是超越上游的改动，不是对齐上游。
2. **"无新证据不改置信度"的 prompt 约束**是上游防置信度漂移的核心机制，我们已逐字保留，无需补。
3. **刻度定义是上游明摆的空白**（全 prompt 只有孤例 0.9，无 0.7 vs 0.9 锚定）。若要提升置信度语义质量，在 prompt 加一段刻度锚定（如 0.9=多次明确重复或显式陈述 / 0.7=单次明确陈述 / 0.5=间接推断）是纯 prompt 改动、零代码风险，同样属于超越上游。
4. 上游对置信度 UI 投入极少（README 的 90% 徽章停留在文档、代码未实现）；我们的三级进度条已是超出项，无需回补。
5. 上游 `/taste import` 强制置信度 1（显式用户动作=满值）的语义值得保留——我们 remember 已一致；dsh-taste 无独立 import 命令，不构成遗漏。

## 附：规范来源说明（调研路径第 3 项）

pi-taste 仓库内**不存在 TASTE.md 规范文件**（vendor 全目录核对）；所谓"规范"即 Command Code 的 taste.md 行格式。Command Code 官方公开文档 [commandcode.ai/docs/taste](https://commandcode.ai/docs/taste) 与博客 [Taste-Driven Development](https://commandcode.ai/blog/taste-driven-development) **通篇不提 confidence**（2026-09-02 抓取验证，`grep -i confidence` 零命中）。因此上游置信度语义的全部依据只有 Learner prompt 两句话（格式示例 + 无新证据不改），其余全靠模型自觉——上游文档里的 `Confidence: 0-n`（types.ts:7）是对商业闭源产品格式的逆向转述，非公开标准。

## 证据索引

- 本地：`vendor/pi-taste/learner.ts`（prompt/工具/循环）、`storage.ts`（解析/渲染/key/重组）、`index.ts`（注入/命令）、`types.ts`、`CHANGELOG.md`（v1→v2→v3 演变）、`README.md`/`README.zh-CN.md`、`test/*.test.ts`
- 上游：npm registry `pi-taste` 元数据（唯一版本 0.5.6）；GitHub API `repos/LycanW/pi-taste`（最新 commit 3818d9e，2026-08-31）；[commandcode.ai/docs/taste](https://commandcode.ai/docs/taste)、[commandcode.ai/blog/taste-driven-development](https://commandcode.ai/blog/taste-driven-development)（均无 confidence 定义）
- 移植版：`dsh-taste/lib/{learner,storage,learner-tools,commands,client}.js`、`dsh-taste/test/*.test.js`
