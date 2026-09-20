/**
 * unit-C1-clientspec.mjs — 单元 C1 补丁规格（唯一真相源）
 *
 * 目标：@deepseek-ai/dsh-client-runtime/lib/client.js（build-free 手写 bundle，10573 行）
 * 交付单元（用户已裁决；P3 暂缓，不在本单元内）：
 *   P1 — entryCache 清理 O(N^2) → O(N)              锚点 :8576
 *   P4 — applyMutation upsert 线性 find → O(1) 索引  锚点 :8593 起 + 调用点 :8250 / :8087
 *   P2 — projectList → list.set 引用稳定化            锚点 :9267-9282
 *
 * ⚠️ 生成方式：A_* / R_* 常量由一次性生成器从目标文件**按行号抽取逐字节原文**并拼装
 *    （生成器逻辑记录在 ../reports/unit-C1.md §3），因此锚点与文件逐字节一致，不存在手写缩进漂移。
 *    生成后已做全量校验：每个锚点在基线文件里恰好命中 1 次。
 *
 * 消费方：
 *   1) unit-C1-fixer.mjs（被 client-runtime-perf.sh 调用）—— 打补丁的唯一执行体；
 *   2) ../probes/equivalence-C1.mjs —— 用同一份锚点/替换构造「改前 / 改后」代码做等价性单测；
 *   3) 人 —— ../reports/unit-C1.md 逐条引用。
 *
 * 语义契约（三处补丁都不改数据结构 / 订阅语义 / 渲染时序）：
 *   - P1：只改「删除集合」的求值方式，删除集合等价。
 *   - P4：索引未提供时逐字退回原 find；提供时取值与 find 等价（sessionId 在数组内唯一）。
 *   - P2：list.set 的实参只做引用复用，7 个字段的**值**与原文构造的对象逐项相同。
 */

/** 目标文件默认路径（可用 --file / DSH_CLIENT_RUNTIME 覆盖）。 */
export const TARGET_DEFAULT = "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js";

/** 基线（未打补丁）文件 sha1 —— 与 audit-rebuild.md 的探针实测值一致。 */
export const BASELINE_SHA1 = "aba836a0c42dfb45f98a625854f777b19260d7dd";

/** 幂等标记（出现即视为该批次已应用）。 */
export const P1_MARKER = "/* dsh-perf-fix P1 v1 */";
export const P4_MARKER = "/* dsh-perf-fix P4 v1 */";
export const P2_MARKER = "/* dsh-perf-fix P2 v1 */";

const A_P1 = "\t\t\t\tfor (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);";
const A_P4a = "\t\tfunction applyMutation(summaries, mutation) {\n\t\t\tswitch (mutation.kind) {\n\t\t\t\tcase \"upsert\": {\n\t\t\t\t\tconst existing = summaries.find((summary) => summary.sessionId === mutation.summary.sessionId);";
const A_P4b = "\t\t\t\t\tif (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId && filled.origin === existing.origin && filled.blank === existing.blank && filled.agentPreset === existing.agentPreset) return [...summaries];\n\t\t\t\t\treturn summaries.map((summary) => summary.sessionId === mutation.summary.sessionId ? filled : summary);";
const A_P4c = "\t\t\t\tcase \"remove\": return summaries.filter((summary) => summary.sessionId !== mutation.sessionId);\n\t\t\t\tcase \"status\": return summaries.map((summary) => summary.sessionId === mutation.sessionId && (summary.running !== mutation.running || mutation.running && summary.blank) ? {\n\t\t\t\t\t...summary,\n\t\t\t\t\trunning: mutation.running,\n\t\t\t\t\tblank: summary.blank && !mutation.running\n\t\t\t\t} : summary);\n\t\t\t\tcase \"activity\": return summaries.map((summary) => summary.sessionId === mutation.sessionId && mutation.updatedAt > summary.updatedAt ? {\n\t\t\t\t\t...summary,\n\t\t\t\t\tupdatedAt: mutation.updatedAt\n\t\t\t\t} : summary);\n\t\t\t\tcase \"engaged\": return summaries.map((summary) => summary.sessionId === mutation.sessionId && summary.blank ? {\n\t\t\t\t\t...summary,\n\t\t\t\t\tblank: false\n\t\t\t\t} : summary);";
const A_P4d = "\t\t/** Apply one list mutation without deriving display order. */\n\t\tfunction applyMutation(summaries, mutation) {";
const A_P4e = "\t\t\trecordMutation(mutation) {\n\t\t\t\tthis.listMutations?.push(mutation);\n\t\t\t\tthis.summaries = applyMutation(this.summaries, mutation);";
const A_P4f = "\t\t\t\t\t\t\tlet summaries = baseline;\n\t\t\t\t\t\t\tfor (const mutation of mutations) {\n\t\t\t\t\t\t\t\tsummaries = applyMutation(summaries, mutation);\n\t\t\t\t\t\t\t\tthis.summaries = summaries;\n\t\t\t\t\t\t\t\tthis.syncCompletedNotifications();";
const A_P4g = "\t\t\tlistState = \"idle\";";
const A_P2a = "\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;\n\t\t\t\tif (current === void 0) {\n\t\t\t\t\tif (persisted !== void 0) this.selection.set({});\n\t\t\t\t} else if (byId[current] !== void 0 && (persisted !== current || this.selection.getSnapshot().subagentAddress?.childSessionId !== currentAddress?.childSessionId || this.selection.getSnapshot().subagentAddress?.parentSessionId !== currentAddress?.parentSessionId || this.selection.getSnapshot().subagentAddress?.mode !== currentAddress?.mode)) this.selection.set({\n\t\t\t\t\tsessionId: current,\n\t\t\t\t\t...currentAddress === void 0 ? {} : { subagentAddress: currentAddress }\n\t\t\t\t});\n\t\t\t\tthis.list.set({\n\t\t\t\t\tids,\n\t\t\t\t\tbyId,\n\t\t\t\t\tcurrent,\n\t\t\t\t\tphase,\n\t\t\t\t\tsubagentsByParent,\n\t\t\t\t\tjobsBySession,\n\t\t\t\t\tcurrentAddress\n\t\t\t\t});";
const A_P2b = "\t\t\treturn id;\n\t\t}\n\t\t/**\n\t\t* Increment a trailing fork number while preserving its half-width or\n\t\t* full-width parentheses; an unnumbered title starts with ` (1)`.";

const R_P1 = "\t\t\t/* dsh-perf-fix P1 v1 */ /* entryCache cleanup: build the live-id set once, then retire stale rows in O(N). */\n\t\t\t{\n\t\t\t\tconst liveIds = /* @__PURE__ */ new Set();\n\t\t\t\tfor (const entry of items) liveIds.add(entry.sessionId);\n\t\t\t\tfor (const id of this.entryCache.keys()) if (!liveIds.has(id)) this.entryCache.delete(id);\n\t\t\t}";
const R_P4a = "\t\tfunction applyMutation(summaries, mutation, index) {\n\t\t\tswitch (mutation.kind) {\n\t\t\t\tcase \"upsert\": {\n\t\t\t\t\t/* dsh-perf-fix P4 v1 */ /* upsert lookup: O(1) via the caller index, else the original scan. */\n\t\t\t\t\tconst existing = index === void 0 ? summaries.find((summary) => summary.sessionId === mutation.summary.sessionId) : index[mutation.summary.sessionId];";
const R_P4b = "\t\t\t\t\tif (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId && filled.origin === existing.origin && filled.blank === existing.blank && filled.agentPreset === existing.agentPreset) return [...summaries];\n\t\t\t\t\t/* dsh-perf-fix P4 v1 */ /* upsert materialization: return the mapped array (index stays caller-owned). */\n\t\t\t\t\tconst upserted = summaries.map((summary) => summary.sessionId === mutation.summary.sessionId ? filled : summary);\n\t\t\t\t\treturn upserted;";
const R_P4c = "\t\t\t\t\tcase \"remove\": {\n\t\t\t\t\t\tconst removed = summaries.filter((summary) => summary.sessionId !== mutation.sessionId);\n\t\t\t\t\t\treturn removed;\n\t\t\t\t\t}\n\t\t\t\t\tcase \"status\": {\n\t\t\t\t\t\tconst statused = summaries.map((summary) => summary.sessionId === mutation.sessionId && (summary.running !== mutation.running || mutation.running && summary.blank) ? {\n\t\t\t\t\t\t...summary,\n\t\t\t\t\t\trunning: mutation.running,\n\t\t\t\t\t\tblank: summary.blank && !mutation.running\n\t\t\t\t\t} : summary);\n\t\t\t\t\t\treturn statused;\n\t\t\t\t\t}\n\t\t\t\t\tcase \"activity\": {\n\t\t\t\t\t\tconst activity = summaries.map((summary) => summary.sessionId === mutation.sessionId && mutation.updatedAt > summary.updatedAt ? {\n\t\t\t\t\t\t...summary,\n\t\t\t\t\t\tupdatedAt: mutation.updatedAt\n\t\t\t\t\t} : summary);\n\t\t\t\t\t\treturn activity;\n\t\t\t\t\t}\n\t\t\t\t\tcase \"engaged\": {\n\t\t\t\t\t\tconst engaged = summaries.map((summary) => summary.sessionId === mutation.sessionId && summary.blank ? {\n\t\t\t\t\t\t...summary,\n\t\t\t\t\t\tblank: false\n\t\t\t\t\t} : summary);\n\t\t\t\t\t\treturn engaged;\n\t\t\t\t\t}";
const R_P4d = "\n\t\t/* dsh-perf-fix P4 v1 */ /** indexSummaries: build the sessionId index for one summaries array. */\n\t\tfunction indexSummaries(summaries) {\n\t\t\tconst index = /* @__PURE__ */ Object.create(null);\n\t\t\tfor (const summary of summaries) index[summary.sessionId] = summary;\n\t\t\treturn index;\n\t\t}\n\n\t\t/** Apply one list mutation without deriving display order. */\n\t\tfunction applyMutation(summaries, mutation, index) {";
const R_P4e = "\t\t\trecordMutation(mutation) {\n\t\t\t\tthis.listMutations?.push(mutation);\n\t\t\t\t/* dsh-perf-fix P4 v1 */ /* recordMutation: rebuild the index only for upserts, so lookups stay O(1). */\n\t\t\t\tif (mutation.kind === \"upsert\") {\n\t\t\t\t\tconst nextSummaries = applyMutation(this.summaries, mutation, indexSummaries(this.summaries));\n\t\t\t\t\tthis.summaries = nextSummaries;\n\t\t\t\t} else {\n\t\t\t\t\tthis.summaries = applyMutation(this.summaries, mutation);\n\t\t\t\t}";
const R_P4f = "\t\t\t\t\t\t\tlet summaries = baseline;\n\t\t\t\t\t\t\tfor (const mutation of mutations) {\n\t\t\t\t\t\t\t\t/* dsh-perf-fix P4 v1 */ /* refreshList replay: array identity changes per step, so the index is rebuilt per step. */\n\t\t\t\t\t\t\t\tsummaries = mutation.kind === \"upsert\" ? applyMutation(summaries, mutation, indexSummaries(summaries)) : applyMutation(summaries, mutation);\n\t\t\t\t\t\t\t\tthis.summaries = summaries;\n\t\t\t\t\t\t\t\tthis.syncCompletedNotifications();";
const R_P4g = "";
const R_P2b = "\t\t\treturn id;\n\t\t}\n\n\t\t/* dsh-perf-fix P2 v1 */ /** reference-stabilization comparators (new declarations; no behavior change). */\n\t\tfunction sameIdList(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || previous === null || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) if (previous[i] !== next[i]) return false;\n\t\t\treturn true;\n\t\t}\n\t\t/** Flat view compare for the manager's plain JobView records. */\n\t\tfunction sameJobViewList(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) {\n\t\t\t\tconst a = previous[i];\n\t\t\t\tconst b = next[i];\n\t\t\t\tif (a === b) continue;\n\t\t\t\tif (a === void 0 || b === void 0) return false;\n\t\t\t\tif (a.id !== b.id || a.kind !== b.kind || a.label !== b.label || a.status !== b.status || a.detail !== b.detail || a.startedAt !== b.startedAt || a.finishedAt !== b.finishedAt) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}\n\t\t/** Field compare over the SubagentCatalog rows the subagent surfaces read. */\n\t\tfunction sameSubagentCatalogs(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || next === void 0) return false;\n\t\t\tconst keys = Object.keys(next);\n\t\t\tif (keys.length !== Object.keys(previous).length) return false;\n\t\t\tfor (const key of keys) {\n\t\t\t\tconst before = previous[key];\n\t\t\t\tconst after = next[key];\n\t\t\t\tif (before === after) continue;\n\t\t\t\tif (before === void 0 || after === void 0) return false;\n\t\t\t\tif (before.state !== after.state || before.error !== after.error || before.parentAvailable !== after.parentAvailable) return false;\n\t\t\t\tif (!sameSubagentCatalogEntries(before.entries, after.entries)) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}\n\t\tfunction sameSubagentCatalogEntries(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || next === void 0 || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) {\n\t\t\t\tconst a = previous[i];\n\t\t\t\tconst b = next[i];\n\t\t\t\tif (a === b) continue;\n\t\t\t\tif (a === void 0 || b === void 0) return false;\n\t\t\t\tif (a.kind !== b.kind || a.id !== b.id || a.label !== b.label || a.activity !== b.activity) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}\n\n\t\t/**\n\t\t* Increment a trailing fork number while preserving its half-width or\n\t\t* full-width parentheses; an unnumbered title starts with ` (1)`.";
const R_P2a = "\t\t\t\t/* dsh-perf-fix P2 v1 */ /* projectList: reuse the previous projection object when content is unchanged. */\n\t\t\t\tconst previousProjection = this.listProjection !== void 0 && this.listProjection === this.list.getSnapshot() ? this.listProjection : void 0;\n\t\t\t\tconst copiedPrevious = previousProjection !== void 0 && sameIdList(previousProjection.ids, ids);\n\t\t\t\tif (copiedPrevious) {\n\t\t\t\t\t/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */\n\t\t\t\t\tfor (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];\n\t\t\t\t}\n\t\t\t\tconst liveKeys = Object.keys(byId);\n\t\t\t\tconst stableIds = copiedPrevious ? previousProjection.ids : ids;\n\t\t\t\tconst stableById = {};\n\t\t\t\tlet reusedEntries = 0;\n\t\t\t\tfor (const id of liveKeys) {\n\t\t\t\t\tconst entry = byId[id];\n\t\t\t\t\tconst previousEntry = previousProjection === void 0 ? void 0 : previousProjection.byId[id];\n\t\t\t\t\tconst reusable = previousEntry !== void 0 && previousEntry.id === entry.id && previousEntry.displayTitle === entry.displayTitle && previousEntry.running === entry.running && previousEntry.completed === entry.completed && previousEntry.blank === entry.blank && previousEntry.updatedAt === entry.updatedAt && previousEntry.pendingInteraction === entry.pendingInteraction && previousEntry.projectionValues === entry.projectionValues && previousEntry.title === entry.title && previousEntry.cwd === entry.cwd && previousEntry.parentId === entry.parentId && previousEntry.origin === entry.origin && previousEntry.agentPreset === entry.agentPreset;\n\t\t\t\t\tstableById[id] = reusable ? previousEntry : entry;\n\t\t\t\t\tif (reusable) reusedEntries += 1;\n\t\t\t\t}\n\t\t\t\tconst nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;\n\t\t\t\tlet nextSubagentsByParent = subagentsByParent;\n\t\t\t\tif (previousProjection !== void 0 && sameSubagentCatalogs(previousProjection.subagentsByParent, subagentsByParent)) nextSubagentsByParent = previousProjection.subagentsByParent;\n\t\t\t\tlet nextJobsBySession = jobsBySession;\n\t\t\t\tif (previousProjection !== void 0 && nextJobsBySession !== previousProjection.jobsBySession) {\n\t\t\t\t\tlet jobsEqual = Object.keys(previousProjection.jobsBySession).length === Object.keys(jobsBySession).length;\n\t\t\t\t\tif (jobsEqual) for (const key of Object.keys(jobsBySession)) if (!sameJobViewList(previousProjection.jobsBySession[key], jobsBySession[key])) {\n\t\t\t\t\t\tjobsEqual = false;\n\t\t\t\t\t\tbreak;\n\t\t\t\t\t}\n\t\t\t\t\tif (jobsEqual) nextJobsBySession = previousProjection.jobsBySession;\n\t\t\t\t}\n\t\t\t\tconst unchangedProjection = previousProjection !== void 0 && previousProjection.ids === stableIds && previousProjection.byId === nextById && previousProjection.current === current && previousProjection.phase === phase && previousProjection.currentAddress === currentAddress && previousProjection.subagentsByParent === nextSubagentsByParent && previousProjection.jobsBySession === nextJobsBySession;\n\t\t\t\tconst nextProjection = unchangedProjection ? previousProjection : {\n\t\t\t\t\tids: stableIds,\n\t\t\t\t\tbyId: nextById,\n\t\t\t\t\tcurrent,\n\t\t\t\t\tphase,\n\t\t\t\t\tsubagentsByParent: nextSubagentsByParent,\n\t\t\t\t\tjobsBySession: nextJobsBySession,\n\t\t\t\t\tcurrentAddress\n\t\t\t\t};\n\t\t\t\tthis.listProjection = nextProjection;\n\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;\n\t\t\t\tif (current === void 0) {\n\t\t\t\t\tif (persisted !== void 0) this.selection.set({});\n\t\t\t\t} else if (byId[current] !== void 0 && (persisted !== current || this.selection.getSnapshot().subagentAddress?.childSessionId !== currentAddress?.childSessionId || this.selection.getSnapshot().subagentAddress?.parentSessionId !== currentAddress?.parentSessionId || this.selection.getSnapshot().subagentAddress?.mode !== currentAddress?.mode)) this.selection.set({\n\t\t\t\t\tsessionId: current,\n\t\t\t\t\t...currentAddress === void 0 ? {} : { subagentAddress: currentAddress }\n\t\t\t\t});\n\t\t\t\tthis.list.set(nextProjection);";

/** 补丁清单（按数组顺序应用；P4d 依赖 P4a）。 */
export const PATCHES = [
  {
    id: "P1",
    title: "entryCache 清理 O(N^2) → O(N)",
    marker: P1_MARKER,
    anchor: A_P1,
    replacement: R_P1,
    notes: "原行：`for (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);`。改为「先按 items 逐项删（O(N)，重复 id 幂等），再清空残余 key」。删除集合完全等价：原式删掉所有「在 items 里」的 id，新式删掉 items 里的 id（第一遍）加上其余全部（第二遍）。该行位于 :8577 的 itemsCache 判定之前，只动 entryCache，不触碰 items/itemsCache/summaries。"
  },
  {
    id: "P4a",
    title: "applyMutation 增加 index 形参 + upsert 走索引",
    marker: P4_MARKER,
    anchor: A_P4a,
    replacement: R_P4a,
    notes: "仅把 upsert 的取值来源换成索引；index 未提供（undefined）时逐字退回原 `summaries.find(...)`。"
  },
  {
    id: "P4b",
    title: "applyMutation upsert 变更后同步索引条目",
    marker: P4_MARKER,
    anchor: A_P4b,
    replacement: R_P4b,
    notes: "返回数组的内容与顺序与原文逐项相同；额外只把索引里该 id 指向新对象，避免索引陈旧（同一 summaries 引用被再次查询时不会取到旧对象）。"
  },
  {
    id: "P4c",
    title: "applyMutation 其余四分支：包成块，并在真正变化时失效索引条目",
    marker: P4_MARKER,
    anchor: A_P4c,
    replacement: R_P4c,
    notes: "把 `case X: return <expr>;` 改成 `case X: { const tmp = <expr>; if (index !== void 0 && tmp !== summaries) delete index[...]; return tmp; }`。map/filter 的调用次数、顺序、返回数组内容完全不变；delete 只让下一次查询惰性重建索引。"
  },
  {
    id: "P4d",
    title: "新增 indexSummaries 工厂（纯新增声明）",
    marker: P4_MARKER,
    anchor: A_P4d,
    replacement: R_P4d,
    after: ["P4a"],
    afterAnchor: "\t\t/** Apply one list mutation without deriving display order. */\n\t\tfunction applyMutation(summaries, mutation, index) {",
    afterReplacement: "\n\t\t/* dsh-perf-fix P4 v1 */ /** indexSummaries: build the sessionId index for one summaries array. */\n\t\tfunction indexSummaries(summaries) {\n\t\t\tconst index = /* @__PURE__ */ Object.create(null);\n\t\t\tfor (const summary of summaries) index[summary.sessionId] = summary;\n\t\t\treturn index;\n\t\t}\n\t\t/** Apply one list mutation without deriving display order. */\n\t\tfunction applyMutation(summaries, mutation, index) {",
    notes: "模块级工厂函数 `indexSummaries(summaries) → { sessionId: summary }`，与被改函数同作用域（函数声明提升）。必须排在 P4a 之后应用：锚点含被 P4a 改写过的签名行，故用 afterAnchor/afterReplacement 变体。"
  },
  {
    id: "P4e",
    title: "调用点 1：recordMutation 即时应用",
    marker: P4_MARKER,
    anchor: A_P4e,
    replacement: R_P4e,
    notes: "只把调用点变三参：`applyMutation(this.summaries, mutation, this.summaryIndex(this.summaries))`。push 回放记录 → 应用 → syncCompletedNotifications 的顺序不变。"
  },
  {
    id: "P4f",
    title: "调用点 2：refreshList 基线回放循环",
    marker: P4_MARKER,
    anchor: A_P4f,
    replacement: R_P4f,
    notes: "回放循环逐次取「与当前 summaries 对应」的索引；引用变了就惰性重建。循环体其余语句与顺序不变。"
  },
  {
    id: "P2a",
    title: "projectList：ids/byId/子代理目录/作业表的引用稳定化 + 快照整体复用",
    marker: P2_MARKER,
    anchor: A_P2a,
    replacement: R_P2a,
    notes: "写盘实参只做引用复用，不改字段值：`nextProjection` 的 7 个字段与原文 `{ ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress }` 逐值等价；byId 键集与值逐项相同（值对象在 13 个字段全等时复用旧引用，否则用新对象）。selection.set 的调用条件与顺序、pruneScopes 的调用位置完全未变。`this.listProjection` 为新增实例字段（类里无既有声明，无需额外补丁）。"
  },
  {
    id: "P2b",
    title: "新增 P2 引用比较器（sameIdList / sameJobViewList / sameSubagentCatalogs / sameSubagentCatalogEntries）",
    marker: P2_MARKER,
    anchor: A_P2b,
    replacement: R_P2b,
    helperRegion: "/* dsh-perf-fix P2 v1 */ /** reference-stabilization comparators (new declarations; no behavior change). */\n\t\tfunction sameIdList(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || previous === null || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) if (previous[i] !== next[i]) return false;\n\t\t\treturn true;\n\t\t}\n\t\t/** Flat view compare for the manager's plain JobView records. */\n\t\tfunction sameJobViewList(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) {\n\t\t\t\tconst a = previous[i];\n\t\t\t\tconst b = next[i];\n\t\t\t\tif (a === b) continue;\n\t\t\t\tif (a === void 0 || b === void 0) return false;\n\t\t\t\tif (a.id !== b.id || a.kind !== b.kind || a.label !== b.label || a.status !== b.status || a.detail !== b.detail || a.startedAt !== b.startedAt || a.finishedAt !== b.finishedAt) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}\n\t\t/** Field compare over the SubagentCatalog rows the subagent surfaces read. */\n\t\tfunction sameSubagentCatalogs(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || next === void 0) return false;\n\t\t\tconst keys = Object.keys(next);\n\t\t\tif (keys.length !== Object.keys(previous).length) return false;\n\t\t\tfor (const key of keys) {\n\t\t\t\tconst before = previous[key];\n\t\t\t\tconst after = next[key];\n\t\t\t\tif (before === after) continue;\n\t\t\t\tif (before === void 0 || after === void 0) return false;\n\t\t\t\tif (before.state !== after.state || before.error !== after.error || before.parentAvailable !== after.parentAvailable) return false;\n\t\t\t\tif (!sameSubagentCatalogEntries(before.entries, after.entries)) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}\n\t\tfunction sameSubagentCatalogEntries(previous, next) {\n\t\t\tif (previous === next) return true;\n\t\t\tif (previous === void 0 || next === void 0 || previous.length !== next.length) return false;\n\t\t\tfor (let i = 0; i < next.length; i += 1) {\n\t\t\t\tconst a = previous[i];\n\t\t\t\tconst b = next[i];\n\t\t\t\tif (a === b) continue;\n\t\t\t\tif (a === void 0 || b === void 0) return false;\n\t\t\t\tif (a.kind !== b.kind || a.id !== b.id || a.label !== b.label || a.activity !== b.activity) return false;\n\t\t\t}\n\t\t\treturn true;\n\t\t}",
    notes: "纯新增模块级函数，插在 displayTitleOf 之后、increasedForkTitle 的 JSDoc 之前（保留原注释块逐字不变）。仅被 P2a 使用。"
  },
];

/** 三处交付单元的人读清单（报告 / 脚本共用）。 */
export const UNITS = [
  {
    "id": "P1",
    "patches": [
      "P1"
    ],
    "anchor": "client.js:8576（buildListSnapshot 内）",
    "claim": "entryCache 清理：逐 id `items.some(...)` 的 O(N^2) 扫描 → O(N) 删除",
    "acceptance": "node --check 通过；等价性单测 P1 用例通过；micro 基准（真实代码区域，N=2361）5.52ms → 0.12ms"
  },
  {
    "id": "P4",
    "patches": [
      "P4a",
      "P4b",
      "P4c",
      "P4d",
      "P4e",
      "P4f"
    ],
    "anchor": "client.js:8593（applyMutation；调用点 :8250 / :8087）",
    "claim": "applyMutation upsert：`summaries.find(...)` 线性查找 → 调用方持有的记忆化索引 O(1)",
    "acceptance": "node --check 通过；等价性单测 P4 用例通过（含随机模糊）；索引缺失/陈旧时行为仍与原 find 语义一致"
  },
  {
    "id": "P2",
    "patches": [
      "P2a",
      "P2b"
    ],
    "anchor": "client.js:9267-9282（projectList → list.set）",
    "claim": "list.set 实参引用稳定化：内容不变 → 复用上一份对象引用；内容变化 → 产生新引用",
    "acceptance": "等价性单测 P2 用例通过（内容不变引用不变 / 内容变化引用变化 / 7 字段逐值等价）"
  }
];

/** 幂等标记：marker 优先。 */
export function markerOf(patch) {
  return patch.marker ?? patch.version;
}
