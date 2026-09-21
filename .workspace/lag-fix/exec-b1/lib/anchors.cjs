'use strict';
/**
 * exec-b1/lib/anchors.cjs —— B1 v2 落地的**锚点登记表**（独立于回放规格）。
 *
 * 为什么要有这份独立登记表：审计 §1.3 的「14 处锚点」是**替换锚点**，而审计 §1.1/§1.2 的
 * 「40 个锚点」是**含完整性/撞车证据的探针锚点**。二者不是同一个集合。落地脚本若只数自己的
 * 替换锚点，就会出现「审计说 40、脚本说 14」的口径错位，因此本表显式分开并给出并集计数：
 *
 *   - `REPLACEMENT`：v2 规格**实际会改写**的锚点 —— pre 阶段每个都必须**恰好命中期望次数**，否则拒绝写入；
 *   - `INTEGRITY`  ：本轮**不改写**、但必须仍以期望次数命中的锚点（含「裸比较器撞车 2 次」这条证据）；
 *   - 并集 **25 条 id / 文件 × 2 排版 = 50 条断言**；其中替换锚点 **14 条 id / 文件 × 2 = 28 条**。
 *     （审计探针的 40 = 20 id × 2 排版；本表 25 id 覆盖同一批锚点并追加负向控制，
 *      与 `anchor-probe.cjs` 的 40 条是**并行口径**，两处都必须 0 失败。）
 *
 * ## 两条被跟踪的状态（**不要混淆**）
 *
 * 本批次有三个文件版本，落地脚本只对其中**两个**做锚点断言：
 *
 *   | 版本 | sha256（index.js） | 角色 |
 *   |---|---|---|
 *   | **deployed（现行部署）** | `1b9915f5…` | 唯一 patch 目标；`REPLACEMENT.expect` 全部按此版本计数 |
 *   | pre-image（`20260920-154039/lib/**`） | `142aac84…` | **规格的输入**（`applyServerFilter` 的入参），不是 patch 目标 |
 *   | target（v2 产物） | `96ad39b7…` | 写入后必须逐字节相等 |
 *
 * ⚠️ 实测：deployed 与 pre-image 相差 **4 个 hunk**（全部属 B1，`diff -u | grep -c '^@@'` = 4），
 * 因此 `MARK-*` / `B2b-*` 这类**由 B1 引入**的锚点在 pre-image 内**根本不存在**（命中 0）。
 * 本表只对 deployed 与 target 断言；pre-image 仅由规格自身消费（审计 §0-E2：`applyServerFilter(pre) == deployed` 逐字节成立）。
 *
 * 锚点字面量**一律不含行首缩进**：行首空白由被读文件派生（审计 §8 坑#1：
 * 手写缩进假设必错，`/^\t/gm` 只吞第一个 TAB）。所有出现次数按**出现次数**统计（非行数）。
 */

/** 统计字面量出现次数（与审计 `grep -c` 同口径，但按出现次数而非行数）。 */
function countLiteral(text, literal) {
  let n = 0;
  for (let i = text.indexOf(literal); i !== -1; i = text.indexOf(literal, i + literal.length)) n += 1;
  return n;
}

/**
 * 替换锚点：v2 规格实际改写的 14 处。
 * `expect` = 该字面量在 **pre-image**（B1 之前、含 C1 基线的当前部署）中的命中数，必须恰好相等。
 * `post`   = 写入后该字面量的期望命中数（用于「改动确实发生且未误伤」的反向判据）。
 * `at`     = 该锚点归属哪一处规格改动（T1/T2/T3/T4，对应审计 §3.2）。
 */
const REPLACEMENT = [
  // ---- T3/T4：冷路径注释 + 比较器（B①） ----
  { id: 'B1a-cold-comment-recent', at: 'T3', expect: 1, post: 0,
    lit: 'subagent 只保留「最近 SUBAGENT_LIST_MAX 条」作为候选，',
    role: 'B① 说谎注释（声称「最近」实为枚举序）' },
  { id: 'B1a-comparator-bare-in-cold', at: 'T4', expect: 2, post: 1,
    lit: '(a, b) => b.updatedAt - a.updatedAt',
    role: 'B① 比较器：**撞车**（冷候选 + 收口字面相同）→ 必须整条语句作锚点' },
  { id: 'B1a-cold-candidates-stmt', at: 'T4', expect: 1, post: 1,
    lit: 'const coldSubagentCandidates = coldSource',
    role: 'B① 替换锚点骨架（带 coldSource 上下文，避开与收口排序撞车；声明本身在 v2 产物中保留）' },
  { id: 'B1a-cold-sort-line', at: 'T4', expect: 1, post: 0,
    lit: '.sort((a, b) => b.updatedAt - a.updatedAt)\n',
    role: 'B① 待换比较器行（行尾换行确保只匹配冷候选那四行语句的中间行）' },
  // ---- T1：聚合函数体建边 ----
  { id: 'B2-childrenOf-from-items', at: 'T1', expect: 1, post: 1,
    lit: 'const childrenOf = new Map();',
    role: 'B② 建边起点（保留：childrenOf 声明本身不变）' },
  { id: 'B2-edge-parent-from-item', at: 'T1', expect: 1, post: 0,
    lit: 'const parentId = item.parentSessionId;',
    role: 'B② **缺陷源**：边由已截断行构建' },
  { id: 'B2-live-status-loop', at: 'T1', expect: 1, post: 0,
    lit: 'for (const session of ctx.sessions.list()) liveStatus.set(session.id,',
    role: 'B② running 状态独立一趟（修订后合并进同一趟）' },
  // ---- T2：jsdoc 三行 ----
  { id: 'B2-doc-truncated-claim', at: 'T2', expect: 1, post: 0,
    lit: '但由宿主在**截断之后**的行上计算，',
    role: 'B② 文档说谎#1（修订后不再成立）' },
  { id: 'B2-doc-param-items', at: 'T2', expect: 1, post: 0,
    lit: '@param items - listVisibleSessionSummaries 产出的行（已排序、已截断）。',
    role: 'B② 文档说谎#2（items 不再参与建边）' },
  { id: 'B2-doc-cost-line', at: 'T2', expect: 1, post: 0,
    lit: '成本：只遍历本次已产出的行 + live agent 表，无新增投影/读盘。',
    role: 'B② 文档说谎#3（成本口径需改为「一次 live 表遍历」）' },
  { id: 'B2-doc-no-dependency', at: 'T2', expect: 1, post: 0,
    lit: '因此侧边栏「N 个子代理运行中」状态点不再依赖被截断的 subagent 行（消费方 C1）。',
    role: 'B② 文档说谎#4（同上一句的续行，其实仍在依赖）' },
  // ---- 签名 / 调用点（本轮**不改**，但必须是替换块的一部分并保持 1 次） ----
  { id: 'B2-signature', at: 'T1', expect: 1, post: 1,
    lit: 'function annotateRunningSubagentCounts(ctx, items) {',
    role: '聚合函数签名（事故后已是 (ctx, items)；本轮**不得改签名与调用点**）' },
  { id: 'B2-call-site', at: 'T1', expect: 1, post: 1,
    lit: 'return annotateRunningSubagentCounts(ctx, retained);',
    role: '调用点（本轮**不改**；V7 断言实参 == 形参）' },
  { id: 'B2-agg-close', at: 'T1', expect: 1, post: 1,
    lit: 'item.runningSubagentCount = count;',
    role: '聚合函数体内标注收尾（确认标注仍在**顶层行**上发生）' },
].map((a) => ({ ...a, kind: 'replacement' }));

/**
 * 完整性锚点：本轮不改写，但必须仍以期望次数命中（防误伤 / 撞车证据 / 标记口径）。
 */
const INTEGRITY = [
  { id: 'B1a-collector-sort', expect: 1, lit: 'items.sort((a, b) => b.updatedAt - a.updatedAt);',
    role: '收口排序（**本轮不改**；B1a 冷候选锚点不得误伤它）' },
  { id: 'B1a-cold-filter-continuation', expect: 1, lit: '.filter((meta) => meta.origin ===',
    role: '冷候选 filter 行（替换块内层，确认未误伤）' },
  { id: 'CMT-cold-cut-reason', expect: 1,
    lit: '// 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。',
    role: 'B① 注释块保留行（改写锚点的上下文）' },
  { id: 'B2b-keep-slice', expect: 1,
    lit: 'for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);',
    role: 'attached keep-set（**本轮不叠加 running 豁免** ⇒ 必须逐字不动）' },
  { id: 'B2b-overflow-slice', expect: 1, lit: 'const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);',
    role: '收口 overflow（**本轮不改** ⇒ 下发上界不变）' },
  { id: 'MARK-SUBAGENT-MAX', expect: 1, lit: '/* dsh-lag-fix B1: subagent 会话下发上限 */',
    role: 'verifyServerFilter 口径标记' },
  { id: 'MARK-RUNNING-COUNT', expect: 2, lit: '/* dsh-lag-fix B1: 聚合字段 runningSubagentCount */',
    role: 'verifyServerFilter 口径标记（定义处 + 返回体）' },
  { id: 'MARK-FILTER', expect: 1, lit: '/* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */',
    role: 'verifyServerFilter 口径标记' },
  { id: 'cold-meta-origin-filter', expect: 1, lit: '.filter((meta) => meta.origin ===',
    role: '冷 meta 带 origin（B① 策略前提）' },
  { id: 'B2-keep-set-running-absent', expect: 0, lit: 'runningIds',
    role: '负向控制：本批次**不得**引入 keep-set running 豁免所需的 runningIds 集合（独立产品决策，不得搭车）' },
].map((a) => ({ ...a, kind: 'integrity' }));

/** 未被上表覆盖、但审计探针另有登记的 id（仅用于口径对账，不参与落地判定）。 */
const PROBE_ONLY = [
  { id: 'B1a-comparator-bare', expect: 2, note: '撞车证据（= B1a-comparator-bare-in-cold 同字面量）' },
  { id: 'CMT-cold-ish-recent', expect: 1, note: '= B1a-cold-comment-recent 所在注释行（含前缀 //）' },
];

/** 去重后的锚点并集（按 id 去重，replacement 优先）。 */
function anchorUnion() {
  const byId = new Map();
  for (const a of [...REPLACEMENT, ...INTEGRITY]) {
    const prev = byId.get(a.id);
    if (prev === undefined) byId.set(a.id, a);
    else if (prev.expect !== a.expect) throw new Error(`锚点登记表自相矛盾 [${a.id}]：${prev.expect} vs ${a.expect}`);
  }
  return [...byId.values()];
}

/**
 * 对一份文本跑全部锚点断言。
 * @param text 目标文件全文
 * @param phase 'deployed'（= 现行部署 / patch 前：替换锚点用 `expect`）
 *              | 'target'（= v2 产物 / patch 后：替换锚点用 `post`，完整性锚点仍用 `expect`）
 * @returns { rows, failures }
 */
function probeAnchors(text, phase) {
  const rows = [];
  for (const a of anchorUnion()) {
    const actual = countLiteral(text, a.lit);
    const expected = phase === 'target' && a.kind === 'replacement' ? a.post : a.expect;
    rows.push({ id: a.id, kind: a.kind, at: a.at ?? null, role: a.role, expected, actual, ok: actual === expected });
  }
  const failures = rows.filter((r) => !r.ok)
    .map((r) => `[${r.id}] 期望 ${r.expected} 实得 ${r.actual}（${r.role}）`);
  return { rows, failures };
}

/**
 * 写入前后的**结构判据**（审计 §1.2 的「验收断言」）：
 *  - 裸比较器写完后全文件**恰好剩 1 次**（只允许收口那处）；
 *  - 新比较器（带 `?? createdAt` 回落 + id tiebreak）恰好 1 次；
 *  - 冷候选四行语句整体被换成新形态。
 */
function structuralPost(text) {
  const checks = [
    { id: 'S1', label: '裸比较器写完后恰好剩 1 次（只允许收口那处）',
      expect: 1, actual: countLiteral(text, '(a, b) => b.updatedAt - a.updatedAt') },
    { id: 'S2', label: '新比较器（?? createdAt 回落 + id 升序 tiebreak）恰好 1 次',
      expect: 1, actual: countLiteral(text, '(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1)') },
    { id: 'S3', label: 'id tiebreak 片段恰好 1 次', expect: 1, actual: countLiteral(text, '(a.id < b.id ? -1 : 1)') },
    { id: 'S4', label: '血缘边改由 live 会话表构建（session.header.parentSession）恰好 1 次',
      expect: 1, actual: countLiteral(text, 'const parentId = session.header.parentSession;') },
    { id: 'S5', label: '缺陷源「由已截断行取 parentSessionId」清零',
      expect: 0, actual: countLiteral(text, 'const parentId = item.parentSessionId;') },
    { id: 'S6', label: '血缘边与 running 状态同源于一趟 live 遍历（liveSessions 声明）恰好 1 次',
      expect: 1, actual: countLiteral(text, 'const liveSessions = ctx.sessions.list();') },
  ];
  const failures = checks.filter((c) => c.actual !== c.expect).map((c) => `${c.id} ${c.label}：期望 ${c.expect} 实得 ${c.actual}`);
  return { checks, failures };
}

module.exports = {
  countLiteral,
  REPLACEMENT,
  INTEGRITY,
  PROBE_ONLY,
  anchorUnion,
  probeAnchors,
  structuralPost,
  /** 去重前替换锚点条目数（用于口径对账：28 = 14 × 2 排版）。 */
  REPLACEMENT_ENTRIES: REPLACEMENT.length,
  INTEGRITY_ENTRIES: INTEGRITY.length,
};
