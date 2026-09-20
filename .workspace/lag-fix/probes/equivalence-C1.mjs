/**
 * probes/equivalence-C1.mjs — 单元 C1 等价性单测（真实执行，只读）
 *
 * 方法：从**基线 bundle** 与**改后副本**里逐字节抽取对应代码区域，在同一 Node 进程里以相同
 * 输入分别执行，逐字段比较输出。抽取的是文件原文，不做任何字符串改写。
 *
 * 作用域注入方式：把被抽取片段包进 `new Function(...deps) { <片段> }`，依赖是**显式函数参数**
 * （局部绑定），不用 `with` —— 避免「外层同名变量/函数把注入值遮蔽」的静默陷阱
 * （该陷阱在本次开发中真实出现过一次，见 reports/unit-C1.md §5）。
 *
 * 覆盖：
 *   P1  entryCache 清理：删除集合等价（普通 / 部分 stale / 全 stale / items 空 / cache 空 / items 重复 id）
 *       + 整段 buildListSnapshot（基线 vs 改后）逐字段等价（三轮，含 itemsCache 复用与 stale 清理）
 *   P4  applyMutation：五种 mutation × 有/无索引逐元素等价；500 组 × 12 步随机模糊；
 *       调用点集成（recordMutation 单发 / 回放 1/3/64 次）
 *   P2  projectList → list.set：7 字段逐值等价；内容不变 ⇒ 引用不变；内容变化 ⇒ 引用变化；
 *       首跑 / 上一份投影错配 / 地址链（subagent 视图）场景
 *
 * 用法：node equivalence-C1.mjs [--baseline <file>] [--patched <file>] [--out <json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PATCHES as SPEC_PATCHES } from "../patches/unit-C1-clientspec.mjs";
import {
  TARGET_DEFAULT,
  ANCHOR,
  extractLine,
  extractBlock,
  extractFunction,
  snapshotDecl,
  byIdLoop,
  projectTail,
  addressChain
} from "./extract-C1.mjs";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const BASE_FILE = argOf("--baseline", TARGET_DEFAULT);
const PATCH_FILE = argOf("--patched", new URL("../patched/client-runtime.client.js", import.meta.url).pathname);
const OUT = argOf("--out", "");

const baseline = readFileSync(BASE_FILE, "utf8");
const patched = readFileSync(PATCH_FILE, "utf8");
const sha = (t) => createHash("sha1").update(t, "utf8").digest("hex");

const results = [];
function check(id, name, fn) {
  try {
    const detail = fn();
    const skipped = detail !== null && typeof detail === "object" && "skipped" in detail;
    results.push({ id, name, ok: true, skipped, detail });
    console.log(`[${skipped ? "SKIP" : "PASS"}] ${id} — ${name}${skipped ? `（${detail.skipped}）` : ""}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    results.push({ id, name, ok: false, detail: message });
    console.log(`[FAIL] ${id} — ${name}\n       ${message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n  base=${sa.slice(0, 300)}\n  new =${sb.slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// 注入执行器：依赖 = 显式局部绑定（无 with，无遮蔽风险）
// ---------------------------------------------------------------------------
/**
 * 编译 `(scope) => { <deps 解包>; <片段> }` 并以 scope 作为 receiver 执行。
 * deps 的键从 scope 上**按属性读取**（不是参数注入），因此不存在遮蔽问题；
 * 同时 `this.x` 与裸 `x` 都指向同一个 scope 对象。
 */
/**
 * 注入执行器：把 scope 的**全部键**以局部 const 绑定注入被抽取片段，同时把 scope 作为 receiver
 * 传给内层 IIFE —— 原文里的裸标识符（`items` / `displayTitleOf`）与 `this.xxx` 都解析到同一对象。
 * 约束：scope 键不得与片段自身的 `const/let` 声明重名（GoTD 早错），由调用点保证。
 */
function runInScope(source, scope) {
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
  const decl = keys.length > 0 ? `const { ${keys.join(", ")} } = scope;` : "";
  const fn = new Function("scope", `${decl} (function () { ${source} }).call(scope);`);
  return fn(scope);
}
/** 编译一段「声明 + 取用」源码，返回其中的入口函数。 */
function buildFrom(source, entry, deps = {}) {
  const keys = Object.keys(deps);
  const decl = keys.length > 0 ? `const { ${keys.join(", ")} } = __deps;` : "";
  return new Function("__deps", `${decl} ${source}; return ${entry};`)(deps);
}

// ---------------------------------------------------------------------------
// 数据构造（刻意不定义模块级同名数据变量，避免任何意外遮蔽）
// ---------------------------------------------------------------------------
function makeItems(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      sessionId: `s-${i}`,
      title: i % 3 === 0 ? `title ${i}` : void 0,
      cwd: `/home/u/proj-${i % 40}`,
      running: i % 7 === 0,
      blank: false,
      completed: i % 11 === 0,
      updatedAt: 1700000000000 + i,
      parentSessionId: i % 13 === 0 ? `s-${i - 1}` : void 0,
      origin: i % 17 === 0 ? "subagent" : void 0,
      agentPreset: i % 19 === 0 ? "standard-glm" : void 0,
      projectionValues: i % 23 === 0 ? { m: "x" } : void 0,
      pendingInteraction: i % 29 === 0 ? "approval" : void 0
    });
  }
  return out;
}
const keysSorted = (m) => [...m.keys()].sort();
const displayTitle = (t, c, id) => (t !== undefined ? t : c !== undefined && c !== "" ? "ws" : id);

// ===========================================================================
// P1 — entryCache 清理
// ===========================================================================
const p1BaselineSrc = extractLine(baseline, ANCHOR.p1Baseline, "P1 baseline");
const p1PatchedSrc = extractBlock(patched, ANCHOR.p1Patched, "P1 patched");
const snapshotBaselineSrc = snapshotDecl(baseline);
const snapshotPatchedSrc = snapshotDecl(patched);

check("P1.a", "清理后 entryCache 键集等价（6 组输入）", () => {
  const items0 = makeItems(40);
  const scenarios = [
    ["普通：全部命中", () => new Map(items0.map((e) => [e.sessionId, e])), items0],
    ["部分 stale", () => new Map([...items0.map((e) => [e.sessionId, e]), ["ghost-1", {}], ["ghost-2", {}]]), items0],
    ["全 stale", () => new Map([["x", {}], ["y", {}]]), items0],
    ["items 空", () => new Map(items0.map((e) => [e.sessionId, e])), []],
    ["cache 空", () => new Map(), items0],
    ["items 含重复 id", () => new Map(items0.map((e) => [e.sessionId, e])), [...items0, items0[5], items0[5]]]
  ];
  const report = [];
  for (const [name, makeCache, itemsArg] of scenarios) {
    const cacheA = makeCache();
    runInScope(`{ ${p1BaselineSrc} }`, { items: itemsArg, entryCache: cacheA });
    const cacheB = makeCache();
    runInScope(p1PatchedSrc, { items: itemsArg, entryCache: cacheB });
    eq(keysSorted(cacheA), keysSorted(cacheB), `${name}: 键集不等价`);
    report.push({ scenario: name, remainingKeys: keysSorted(cacheA).length });
  }
  return report;
});

check("P1.b", "整段 buildListSnapshot 等价（N=2361，三轮）", () => {
  const items = makeItems(2361);
  const itemsSome = items.slice(0, 1900);
  const scopeDeps = { displayTitleOf: displayTitle, flattenLineage: (m) => m, workspaceTitleOf: () => "ws" };
  const asFunctionDecl = (decl) => `function buildListSnapshot${decl.slice("buildListSnapshot".length)}`;
  const baseFn = buildFrom(asFunctionDecl(snapshotBaselineSrc), "buildListSnapshot", scopeDeps);
  const newFn = buildFrom(asFunctionDecl(snapshotPatchedSrc), "buildListSnapshot", scopeDeps);
  const mkCtx = () =>
    Object.assign(
      {
        entryCache: new Map([...itemsSome.map((e) => [e.sessionId, e]), ["stale-a", {}], ["stale-b", {}]]),
        itemsCache: [],
        projectionStores: new Map(),
        pendingInteractions: new Map(),
        completedNotifications: new Set(),
        summaries: itemsSome,
        selected: void 0,
        addresses: new Map(),
        listState: "idle",
        listPhase: "ready",
        listError: null,
        catalogs: new Map(),
        jobsBySession: new Map()
      },
      scopeDeps
    );
  const a = mkCtx();
  const b = mkCtx();
  const ra = baseFn.call(a);
  const rb = newFn.call(b);
  assert(ra.items === a.itemsCache && rb.items === b.itemsCache, "items 应取 itemsCache");
  eq(ra, rb, "首次返回值不等价");
  eq(keysSorted(a.entryCache), keysSorted(b.entryCache), "首次 entryCache 键集不等价");
  // items 覆盖 1900 条，另加 2 条 stale → 两者都应只保留 1900 条
  assert(
    keysSorted(a.entryCache).length === 1900,
    `首次 entryCache 应保留 1900 条（items 覆盖 + 2 条 stale 被清），实际 ${keysSorted(a.entryCache).length}`
  );
  const ra2 = baseFn.call(a);
  const rb2 = newFn.call(b);
  eq(ra2, rb2, "第二轮返回值不等价");
  assert(ra2.items === ra.items && rb2.items === rb.items, "内容未变时 items 应复用同一数组");
  const shorter = itemsSome.slice(0, 900);
  a.summaries = shorter;
  b.summaries = shorter;
  const ra3 = baseFn.call(a);
  const rb3 = newFn.call(b);
  eq(ra3, rb3, "第三轮返回值不等价");
  eq(keysSorted(a.entryCache), keysSorted(b.entryCache), "第三轮 entryCache 键集不等价");
  assert(ra3.items.length === 900 && rb3.items.length === 900, "第三轮 items 长度应为 900");
  assert(keysSorted(a.entryCache).length === 900, `第三轮 entryCache 应收缩到 900，实际 ${keysSorted(a.entryCache).length}`);
  return { firstCacheKeys: 1900, thirdCacheKeys: keysSorted(a.entryCache).length, thirdItems: ra3.items.length };
});

// ===========================================================================
// P4 — applyMutation
// ===========================================================================
const applyBaselineSrc = extractFunction(baseline, ANCHOR.applyMutationBaseline, "applyMutation baseline");
// 交付副本可能是「全量」或「仅 P1+P2」子集（`--only P1,P2`）→ P4 相关区域可能不存在
const hasP4 = patched.includes(ANCHOR.applyMutationPatched);
const applyPatchedSrc = hasP4 ? extractFunction(patched, ANCHOR.applyMutationPatched, "applyMutation patched") : applyBaselineSrc;
const indexSummariesSrc = hasP4 ? extractBlock(patched, ANCHOR.indexSummaries, "indexSummaries") : "function indexSummaries() {}";
console.log(`[info] 交付副本含 P4：${hasP4}${hasP4 ? "" : "（P4 相关用例将标记 SKIP：其区域未打补丁，恒等于基线）"}`);

const applyBaseline = buildFrom(applyBaselineSrc, "applyMutation");
const applyPatched = hasP4 ? buildFrom(applyPatchedSrc, "applyMutation") : applyBaseline;
const indexSummaries = hasP4 ? buildFrom(indexSummariesSrc, "indexSummaries") : () => void 0;

const MUTATION_KINDS = ["upsert", "remove", "status", "activity", "engaged"];
function rndFactory(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
function makeMutation(kind, id, rnd) {
  if (kind === "upsert")
    return {
      kind,
      summary: {
        sessionId: id,
        updatedAt: Math.floor(rnd() * 5),
        running: rnd() < 0.5,
        blank: rnd() < 0.5,
        cwd: rnd() < 0.5 ? "/new" : void 0,
        parentSessionId: rnd() < 0.5 ? "s-0" : void 0,
        origin: rnd() < 0.5 ? "subagent" : void 0,
        agentPreset: rnd() < 0.5 ? "p" : void 0
      }
    };
  return { kind, sessionId: id, running: rnd() < 0.5, updatedAt: Math.floor(rnd() * 5) };
}
const norm = (arr) => arr.map((s) => ({ ...s }));

check("P4.a", "五种 mutation × 有/无索引：返回数组逐元素等价", () => {
  if (!hasP4) return { skipped: "交付副本未包含 P4（--only P1,P2）" };
  const base = norm(
    makeItems(50).map((e) => ({
      sessionId: e.sessionId,
      blank: e.blank,
      running: e.running,
      updatedAt: e.updatedAt,
      cwd: e.cwd,
      parentSessionId: e.parentSessionId,
      origin: e.origin,
      agentPreset: e.agentPreset
    }))
  );
  const rnd = rndFactory(7);
  let cases = 0;
  for (const kind of MUTATION_KINDS) {
    for (const id of ["s-0", "s-25", "s-49", "s-missing", "s-1"]) {
      const m = makeMutation(kind, id, rnd);
      const a = applyBaseline(base, m);
      const b = applyPatched(base, m, void 0);
      eq(norm(a), norm(b), `${kind}/${id}: 无索引时与基线不等价`);
      const c = applyPatched(base, m, indexSummaries(base));
      eq(norm(a), norm(c), `${kind}/${id}: 有索引时与基线不等价`);
      cases += 1;
    }
  }
  return { cases };
});

check("P4.b", "随机模糊 500 组 × 12 步：逐元素等价", () => {
  if (!hasP4) return { skipped: "交付副本未包含 P4" };
  const report = { steps: 0, longestArray: 0 };
  for (let trial = 0; trial < 500; trial += 1) {
    const rnd = rndFactory(trial + 3);
    const n = 1 + Math.floor(rnd() * 8);
    const seedArr = Array.from({ length: n }, (_, i) => ({
      sessionId: `s-${i}`,
      blank: rnd() < 0.5,
      running: rnd() < 0.5,
      updatedAt: Math.floor(rnd() * 5),
      cwd: rnd() < 0.5 ? `/c${i}` : void 0,
      parentSessionId: rnd() < 0.5 ? "s-0" : void 0,
      origin: rnd() < 0.5 ? "subagent" : void 0,
      agentPreset: rnd() < 0.5 ? "p" : void 0
    }));
    let a = seedArr;
    let b = norm(seedArr);
    for (let step = 0; step < 12; step += 1) {
      const kind = MUTATION_KINDS[Math.floor(rnd() * MUTATION_KINDS.length)];
      const m = makeMutation(kind, `s-${Math.floor(rnd() * 10)}`, rnd);
      const na = applyBaseline(a, m);
      // 交付调用点：upsert 才建索引（indexSummaries(当前数组)），其余 kind 不传索引
      const nb = kind === "upsert" ? applyPatched(b, m, indexSummaries(b)) : applyPatched(b, m);
      eq(norm(na), norm(nb), `trial ${trial} step ${step} (${kind}): 数组不等价`);
      assert(na.length === nb.length, `trial ${trial} step ${step}: 长度不等`);
      a = na;
      b = nb;
      report.steps += 1;
    }
    report.longestArray = Math.max(report.longestArray, b.length);
  }
  return report;
});

check("P4.c", "调用点集成：recordMutation 单发 / 回放循环（1/3/64 次）等价", () => {
  if (!hasP4) return { skipped: "交付副本未包含 P4" };
  const report = {};
  for (const n of [1, 3, 64]) {
    const base = norm(makeItems(30).map((e) => ({ sessionId: e.sessionId, blank: false, running: false, updatedAt: 0 })));
    const muts = Array.from({ length: n }, (_, k) => ({
      kind: "upsert",
      summary: { sessionId: `s-${(k * 7) % 30}`, blank: false, updatedAt: k + 1, running: false, agentPreset: `p${k}` }
    }));
    let a = base;
    for (const m of muts) a = applyBaseline(a, m);
    let b = base;
    // 交付 P4e/P4f：upsert 传 indexSummaries(summaries)，其余不传
    for (const m of muts) b = m.kind === "upsert" ? applyPatched(b, m, indexSummaries(b)) : applyPatched(b, m);
    eq(norm(a), norm(b), `回放 ${n} 次不等价`);
    report[`replay_${n}`] = a.length;
  }
  return report;
});

// ===========================================================================
// P2 — projectList → list.set 引用稳定化
// ===========================================================================
// P2 辅助函数整段：直接取 spec 里的 helperRegion（与交付文本逐字节相同）
const p2HelperSrc = SPEC_PATCHES.find((x) => x.id === "P2b").helperRegion;
if (typeof p2HelperSrc !== "string" || !p2HelperSrc.includes("sameSubagentCatalogEntries")) {
  throw new Error("spec 缺少 P2b.helperRegion");
}
if (patched.split(p2HelperSrc).length - 1 !== 1) throw new Error("P2 helperRegion 未在改后副本里唯一命中");
const tailBaselineSrc = projectTail(baseline, false);
const tailPatchedSrc = projectTail(patched, true);
const byIdLoopSrc = byIdLoop(baseline); // 两版共用（该区域未打补丁）
const chainSrc = addressChain(baseline); // 两版共用

const p2Helpers = new Function(`${p2HelperSrc}; return { sameIdList, sameJobViewList, sameSubagentCatalogs, sameSubagentCatalogEntries };`)();

/**
 * 把「byId 循环 + 地址链 + 尾段」按真实顺序拼成一段源码（原文拼接，零改写）。
 * byIdLoopSrc 以闭包读 `items`——这里把它的**内部语句**原样搬到一个以 `items` 为参数的
 * 内层 IIFE 里（该循环与补丁无关，任何包装方式都不改变被测语义），从而把 `items`
 * 变成合法参数而不是散落的自由变量。
 */
const byIdLoopInner = (() => {
  const lines = byIdLoopSrc.split("\n");
  const firstBrace = lines.findIndex((l) => l.trim().endsWith("{"));
  if (firstBrace < 0) throw new Error("byIdLoop 结构不符合预期");
  const inner = lines.slice(firstBrace + 1, lines.length - 1).join("\n");
  if (!inner.includes("ids.push")) throw new Error("byIdLoop 内部语句抽取失败");
  return inner;
})();

function mkProjectSource(tailSrc) {
  const pad = "\t\t\t\t";
  return [
    ...byIdLoopSrc.split("\n"),
    chainSrc,
    tailSrc
  ].join("\n");
}

/** 把「byId 循环 + 地址链 + 尾段」按真实顺序拼成一段源码（原文拼接）。 */
function makeProjectRunner(tailSrc) {
  const full = mkProjectSource(tailSrc);
  return (scope) => runInScope(mkProjectSource(tailSrc), scope);
}

function makeP2Scope(state) {
  let storeState =
    state.initialStore !== void 0
      ? state.initialStore
      : { ids: [], byId: {}, current: void 0, phase: "pending", subagentsByParent: {}, jobsBySession: {}, currentAddress: void 0 };
  let projection = state.listProjection;
  const setCalls = [];
  // 注意：**不能用 Object.assign 构造**——它会把 getter 摊平成当时的值，
  // 而真实 projectList 每次重建都重新读 manager 快照（fixture 改写后必须能观察到）。
  const scope = Object.create(null);
  const base = {
    manager: {
      getListSnapshot: () => ({
        items: state.items,
        current: state.current,
        phase: state.phase,
        subagentsByParent: state.subagentsByParent,
        jobsBySession: state.jobsBySession,
        currentAddress: state.currentAddress
      }),
      navigationAddress: state.navigationAddress ?? (() => void 0)
    },
    selected: state.current,
    addresses: new Map(),
    selection: {
      getSnapshot: () => ({ sessionId: state.persistedSessionId }),
      set: () => void 0
    },
    list: {
      getSnapshot: () => storeState,
      set: (next) => {
        setCalls.push(next);
        storeState = next;
      }
    },
    pruneScopes: () => void 0,
    displayTitleOf: displayTitle,
    __getStore: () => storeState
  };
  for (const [k, v] of Object.entries(base)) scope[k] = v;
  for (const [k, v] of Object.entries(p2Helpers)) scope[k] = v;
  // manager 快照的字段名：用 getter 跟随 fixture 当前值
  for (const key of ["items", "current", "phase", "subagentsByParent", "jobsBySession", "currentAddress"]) {
    Object.defineProperty(scope, key, {
      get: () => state[key],
      enumerable: true,
      configurable: true
    });
  }
  Object.defineProperty(scope, "listProjection", {
    get: () => projection,
    set: (v) => {
      projection = v;
    },
    enumerable: true,
    configurable: true
  });
  scope.__setCalls = setCalls;
  scope.__setProjection = (v) => {
    projection = v;
  };
  return scope;
}

/** P2 scope = 数据 + 尾段依赖（displayTitleOf / same* 比较器）一并挂上。 */
function makeP2ScopeFull(state) {
  return makeP2Scope(state);
}
const runProjectBaseline = makeProjectRunner(tailBaselineSrc);
const runProjectPatched = makeProjectRunner(tailPatchedSrc);

function makeState(overrides = {}) {
  return Object.assign(
    {
      items: makeItems(30),
      jobsBySession: {},
      subagentsByParent: {},
      current: "s-3",
      currentAddress: void 0,
      phase: "ready",
      persistedSessionId: "s-3",
      listProjection: void 0,
      initialStore: void 0
    },
    overrides
  );
}

const hasP2 = patched.includes(ANCHOR.p2TailPatched);
check("P2.a", "内容不变 ⇒ list.set 实参引用不变（连续 3 次）", () => {
  if (!hasP2) return { skipped: "交付副本未包含 P2" };
  const scopeB = makeP2ScopeFull(makeState());
  const scopeN = makeP2ScopeFull(makeState());
  const refsB = [];
  const refsN = [];
  for (let i = 0; i < 3; i += 1) {
    runProjectBaseline(scopeB);
    refsB.push(scopeB.__getStore());
    runProjectPatched(scopeN);
    refsN.push(scopeN.__getStore());
  }
  assert(new Set(refsB).size === 3, `基线应每次新引用，实际 ${new Set(refsB).size}`);
  assert(new Set(refsN).size === 1, `改后内容不变应只有 1 个引用，实际 ${new Set(refsN).size}`);
  return { baselineDistinct: new Set(refsB).size, patchedDistinct: new Set(refsN).size };
});

check("P2.b", "内容变化 ⇒ 引用变化（8 类字段/结构 + jobs + catalogs）", () => {
  const cases = [
    ["updatedAt 变化", (st) => { st.items[3].updatedAt += 1; }],
    ["title 变化", (st) => { st.items[3].title = "renamed"; }],
    ["running 变化", (st) => { st.items[3].running = !st.items[3].running; }],
    ["cwd 变化（→ displayTitle）", (st) => { st.items[3].cwd = "/other/proj"; }],
    ["blank 变化", (st) => { st.items[3].blank = !st.items[3].blank; }],
    ["新增会话", (st) => { st.items.push({ sessionId: "s-new", blank: false, running: false, updatedAt: 1, title: "n" }); }],
    ["删除会话", (st) => { st.items.splice(3, 1); }],
    ["顺序变化", (st) => { const [x] = st.items.splice(3, 1); st.items.unshift(x); }],
    ["jobsBySession 变化", (st) => { st.jobsBySession = { "s-3": [{ id: "bash-1", kind: "bash", label: "x", status: "running", startedAt: 1 }] }; }],
    [
      "subagentsByParent 变化",
      (st) => {
        st.subagentsByParent = { "s-3": { entries: [{ kind: "child", id: "c1", label: "L", activity: "running" }], parentAvailable: true, state: "ready", error: null } };
      }
    ]
  ];
  const report = [];
  for (const [name, mutate] of cases) {
    const st = makeState();
    const scope = makeP2ScopeFull(st);
    runProjectPatched(scope);
    const first = scope.__getStore();
    mutate(st);
    runProjectPatched(scope);
    const second = scope.__getStore();
    assert(first !== second, `${name}: 内容变了却复用了旧引用`);
    report.push({ case: name, refChanged: true });
  }
  return report;
});

check("P2.c", "7 字段逐值等价（含 byId 键集与逐项字段）+ 条目引用复用度", () => {
  const scopeB = makeP2ScopeFull(makeState());
  const scopeN = makeP2ScopeFull(makeState());
  runProjectBaseline(scopeB);
  runProjectPatched(scopeN);
  const a = scopeB.__getStore();
  const b = scopeN.__getStore();
  for (const k of ["ids", "byId", "current", "phase", "subagentsByParent", "jobsBySession", "currentAddress"]) {
    assert(k in a && k in b, `字段 ${k} 缺失`);
  }
  eq(a.ids, b.ids, "ids 不等价");
  eq(Object.keys(a.byId).sort(), Object.keys(b.byId).sort(), "byId 键集不等价");
  for (const id of Object.keys(a.byId)) eq(a.byId[id], b.byId[id], `byId[${id}] 不等价`);
  assert(a.current === b.current, "current 不等价");
  assert(a.phase === b.phase, "phase 不等价");
  eq(a.subagentsByParent, b.subagentsByParent, "subagentsByParent 不等价");
  eq(a.jobsBySession, b.jobsBySession, "jobsBySession 不等价");
  assert(a.currentAddress === b.currentAddress, "currentAddress 不等价");
  runProjectPatched(scopeN);
  const b2 = scopeN.__getStore();
  let reused = 0;
  for (const id of Object.keys(b.byId)) if (b2.byId[id] === b.byId[id]) reused += 1;
  assert(reused === Object.keys(b.byId).length, `byId 条目未全部复用（${reused}/${Object.keys(b.byId).length}）`);
  assert(b2.ids === b.ids, "ids 未复用");
  assert(b2 === b, "顶层对象未复用");
  assert(scopeN.__setCalls.length === 2, `list.set 应被调用两次，实际 ${scopeN.__setCalls.length}`);
  assert(scopeN.__setCalls[1] === scopeN.__setCalls[0], "第二次 list.set 实参应与第一次同一引用");
  return { entries: Object.keys(b.byId).length, byIdReused: reused, idsReused: true, topLevelReused: true };
});

check("P2.d", "首跑（无上一份投影）与上一份投影错配时不崩且字段正确", () => {
  const items = makeItems(10);
  const scope = makeP2ScopeFull(makeState({ items, current: "s-2", phase: "pending", persistedSessionId: void 0 }));
  runProjectPatched(scope);
  const first = scope.__getStore();
  assert(first.ids.length === items.length, `首跑 ids 长度错误：${first.ids.length}`);
  assert(first.phase === "pending", "首跑 phase 错误");
  assert(first.current === "s-2", "首跑 current 错误");
  assert(first.byId["s-2"] !== void 0, "首跑 byId 缺 current");
  const scope2 = makeP2ScopeFull(makeState({ items, current: "s-2", phase: "pending" }));
  // 错配：把 listProjection 指到与 store 快照不同的对象 → 守卫应忽略它
  scope2.__setProjection({ ids: ["bogus"], byId: { bogus: { id: "bogus" } }, current: "bogus", phase: "ready", subagentsByParent: {}, jobsBySession: {}, currentAddress: void 0 });
  runProjectPatched(scope2);
  const second = scope2.__getStore();
  eq(second.ids, items.map((e) => e.sessionId), "错配后 ids 错误");
  assert(second.current === "s-2", "错配后 current 错误");
  return { firstRunIds: first.ids.length, mismatchedGuardOk: true };
});

check("P2.e", "地址链（subagent 视图）：额外 byId 条目、displayTitle 覆盖与改名传播", () => {
  const items = makeItems(6);
  const address = { parentSessionId: "s-0", childSessionId: "child-x" };
  const state = makeState({
    items,
    current: "child-x",
    currentAddress: address,
    subagentsByParent: {
      "s-0": {
        entries: [{ kind: "child", id: "child-x", label: "调研子代理", activity: "running", mode: void 0 }],
        parentAvailable: true,
        state: "ready",
        error: null
      }
    },
    persistedSessionId: "child-x"
  });
  const scope = makeP2ScopeFull(state);
  runProjectPatched(scope);
  const first = scope.__getStore();
  assert(first.byId["child-x"] !== void 0, "地址链未把 child-x 补进 byId");
  eq(first.byId["child-x"].displayTitle, "调研子代理", "地址链 displayTitle 覆盖错误");
  assert(first.ids.indexOf("child-x") === -1, "ids 不应包含地址链条目（保持原文语义）");
  assert(first.current === "child-x", "current 应保留 child-x");
  runProjectPatched(scope);
  const second = scope.__getStore();
  eq(Object.keys(second.byId).sort(), Object.keys(first.byId).sort(), "第二轮 byId 键集漂移");
  assert(second.byId["child-x"] === first.byId["child-x"], "地址链条目未复用引用");
  state.subagentsByParent = {
    "s-0": {
      entries: [{ kind: "child", id: "child-x", label: "改名后", activity: "running", mode: void 0 }],
      parentAvailable: true,
      state: "ready",
      error: null
    }
  };
  runProjectPatched(scope);
  const third = scope.__getStore();
  assert(third !== second, "子代理改名后整份快照应更新");
  eq(third.byId["child-x"].displayTitle, "改名后", "子代理改名未反映到 byId");
  return { addressChainEntry: true };
});

// ---------------------------------------------------------------------------
console.log("");
const skipped = results.filter((r) => r.skipped === true).length;
const passed = results.filter((r) => r.ok && r.skipped !== true).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`等价性单测：${passed} 通过 / ${skipped} 跳过 / ${failed} 失败（共 ${results.length} 例）`);
const allGreen = failed === 0;
console.log(`baseline sha1 = ${sha(baseline)}  (${BASE_FILE})`);
console.log(`patched  sha1 = ${sha(patched)}  (${PATCH_FILE})`);

if (OUT !== "") {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        baseline: { file: BASE_FILE, sha1: sha(baseline) },
        patched: { file: PATCH_FILE, sha1: sha(patched) },
        node: process.version,
        passed,
        skipped,
        failed,
        total: results.length,
        results
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`已写入 ${OUT}`);
}
process.exit(allGreen ? 0 : 1);
