/**
 * probes/bench-projectlist-C1.mjs — 微观基准（只读，不写盘、不联网、不碰宿主）
 *
 * 目的：在**真实代码区域**上量化 P1 / P4 / P2 的收益与成本。
 * 数据来源：目标 bundle 的**逐字节抽取**（非复刻），N 与 DIAGNOSIS.md §1.2 对齐（2361 条会话）。
 * 代码区域用「锚点匹配」抽取，因此同一份脚本可以指向**基线文件**或**改后副本**：
 *   --file <安装树>            → 测现状（并给出交付写法对照）
 *   --file ../patched/client-runtime.client.js → 测交付写法
 *
 * 用法：
 *   node bench-projectlist-C1.mjs
 *   node bench-projectlist-C1.mjs --file ../patched/client-runtime.client.js
 *   node bench-projectlist-C1.mjs --n 500 --reps 50
 */
import { readFileSync } from "node:fs";

const TARGET_DEFAULT =
  "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const FILE = argOf("--file", TARGET_DEFAULT);
const N = Number(argOf("--n", "2361"));
const REPS = Number(argOf("--reps", "100"));

const T = "\t";
const text = readFileSync(FILE, "utf8");

// ---------------------------------------------------------------------------
// 逐字节抽取（唯一的字符串操作是「定位」，不做改写）
// ---------------------------------------------------------------------------
function scanBraces(src, open) {
  let depth = 1;
  let j = open + 1;
  let mode = "code";
  while (j < src.length && depth > 0) {
    const c = src[j];
    const n = src[j + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") mode = "line";
      else if (c === "/" && n === "*") {
        mode = "block";
        j += 1;
      } else if (c === '"' || c === "'" || c === "`") mode = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
    } else if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        j += 1;
      }
    } else if (c === "\\") j += 1;
    else if (c === mode) mode = "code";
    j += 1;
  }
  return j;
}
function uniqueAt(src, needle, label) {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`[extract] ${label}: not found`);
  if (src.indexOf(needle, at + 1) >= 0) throw new Error(`[extract] ${label}: not unique`);
  return at;
}
function extractBlockAt(src, needle, label) {
  const at = uniqueAt(src, needle, label);
  const open = src.indexOf("{", at);
  return src.slice(open, scanBraces(src, open));
}
function extractMethodBody(src, decl, label) {
  const block = extractBlockAt(src, decl, label);
  return block.slice(1, -1);
}
function extractFunctionDecl(src, decl, label) {
  // decl 以 `{` 结尾，block 也以 `{` 开头 → 只保留一份
  return decl + extractBlockAt(src, decl, label).slice(1);
}
/** 把抽取出的函数声明（或改为 `async function name(...)`）编成可调用函数；依赖作为参数注入。 */
function liftDecl(source, name, scope) {
  const keys = Object.keys(scope);
  const trimmed = source.trimEnd().replace(/;$/, "");
  // `new Function` 体里不能出现 async 函数声明 → 去掉 `async` 关键字（本基准只同步调用）
  const decl = trimmed.replace(/(^|\n)(\s*)async function /, "$1$2function ");
  if (process.env.C1_BENCH_DEBUG === "1") {
    console.error("[liftDecl]", name, "declLen=", decl.length, "head=", JSON.stringify(decl.slice(0, 60)), "tail=", JSON.stringify(decl.slice(-40)));
  }
  const fn = new Function(...keys, `return (function () { ${decl}\nreturn ${name}; })();`);
  return fn(...keys.map((k) => scope[k]));
}

const deps = {
  displayTitleOf: (title, cwd, id) => (title !== undefined ? title : cwd !== undefined && cwd !== "" ? "ws" : id),
  flattenLineage: (merged) => merged,
  workspaceTitleOf: () => "ws"
};

function makeWith(d) {
  const keys = Object.keys(d);
  const arm = (bodySource) => new Function(...keys, bodySource)(...keys.map((k) => d[k]));
  return {
    method: (body) => arm(`return (thisArg) => { with (thisArg) { return (function () { ${body} }).call(thisArg); } };`),
    lift: (body, name) => arm(`return (function () { ${body}\nreturn ${name}; })();`)
  };
}

// ---------------------------------------------------------------------------
// 数据
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
const items = makeItems(N);
const summaries = items.map((e) => ({ ...e }));
const cacheSeed = () => new Map(items.map((e) => [e.sessionId, e]));
const w = makeWith(Object.assign({}, deps, { get items() { return items; } }));
const indexSummaries = (arr) => {
  const index = Object.create(null);
  for (const s of arr) index[s.sessionId] = s;
  return index;
};

function makeManagerCtx() {
  return {
    entryCache: cacheSeed(),
    itemsCache: [],
    projectionStores: new Map(),
    pendingInteractions: new Map(),
    completedNotifications: new Set(),
    summaries,
    selected: void 0,
    addresses: new Map(),
    listState: "idle",
    listPhase: "ready",
    listError: null,
    catalogs: new Map(),
    jobsBySession: new Map()
  };
}
function bench(label, fn, reps) {
  for (let i = 0; i < 3; i += 1) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i += 1) fn();
  const t1 = process.hrtime.bigint();
  return { label, ms: Number((Number(t1 - t0) / 1e6 / reps).toFixed(4)) };
}

const isBaseline = text.includes(T.repeat(4) + "for (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id))");
const isPatched = text.includes("/* dsh-perf-fix P1 v1 */");
const kind = isPatched ? "patched" : isBaseline ? "baseline" : "unknown";
const results = [];

// ---- P1：清理行 ----
if (isBaseline) {
  results.push(
    bench(
      `P1 清理行 · 现状 items.some 逐 id（N=${N}）`,
      () => {
        const cache = cacheSeed();
        for (const id of cache.keys()) if (!items.some((e) => e.sessionId === id)) cache.delete(id);
        return cache.size;
      },
      Math.max(20, REPS >> 2)
    )
  );
}
results.push(
  bench(
    `P1 清理行 · 交付写法 预建 Set + 逐 id 判定（N=${N}）`,
    () => {
      const cache = cacheSeed();
      const liveIds = new Set();
      for (const entry of items) liveIds.add(entry.sessionId);
      for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id);
      return cache.size;
    },
    Math.max(20, REPS >> 2)
  )
);

// ---- P1 整段 buildListSnapshot（被测文件的原文） ----
{
  const body = extractMethodBody(text, "buildListSnapshot() {", "buildListSnapshot");
  const fn = w.method(body);
  results.push(bench(`P1 整段 buildListSnapshot（${kind} 原文，N=${N}）`, () => fn(makeManagerCtx()), Math.max(10, REPS >> 3)));
}

// ---- P4：applyMutation（被测文件的原文） ----
{
  const declNew = T.repeat(2) + "function applyMutation(summaries, mutation, index) {";
  const declOld = T.repeat(2) + "function applyMutation(summaries, mutation) {";
  const hasNew = text.includes(declNew);
  const src = extractFunctionDecl(text, hasNew ? declNew : declOld, "applyMutation");
  const apply = liftDecl(
    src,
    "applyMutation",
    {
      sameJobViewList: () => true,
      sameSubagentCatalogs: () => true,
      indexSummaries
    }
  );
  const half = summaries[N >> 1];
  const call = (arr, m) => (hasNew ? apply(arr, m, indexSummaries(arr)) : apply(arr, m));

  results.push({
    label: `P4 索引重建单独计时（对象索引，N=${N}）`,
    ms: bench("x", () => indexSummaries(summaries), REPS).ms
  });
  results.push(
    bench(
      `P4 单次 upsert 命中（${kind} 路径，N=${N}）`,
      () => call(summaries, { kind: "upsert", summary: { ...half, agentPreset: "x" } }),
      Math.max(20, REPS >> 2)
    )
  );
  results.push(
    bench(
      `P4 单次 upsert 未命中新增（${kind} 路径，N=${N}）`,
      () => call(summaries, { kind: "upsert", summary: { sessionId: "s-new", updatedAt: 1, running: false, blank: true } }),
      Math.max(20, REPS >> 2)
    )
  );
  results.push(
    bench(`P4 单次 activity（${kind} 路径，N=${N}）`, () => call(summaries, { kind: "activity", sessionId: `s-${N >> 1}`, updatedAt: Date.now() }), REPS)
  );
  {
    const muts = Array.from({ length: 64 }, (_, k) => ({
      kind: "upsert",
      summary: { sessionId: `s-${k * 7}`, blank: false, updatedAt: k + 1, running: false, agentPreset: `p${k}` }
    }));
    results.push(
      bench(
        `P4 回放 64 次 upsert（${kind} 路径，N=${N}）`,
        () => {
          let cur = summaries;
          for (const m of muts) cur = call(cur, m);
          return cur.length;
        },
        Math.max(10, REPS >> 3)
      )
    );
    if (hasNew) {
      // 对照：索引只建一次（O(1) 摊销形态）——用于说明「索引本身的收益」与「每次重建索引的成本」
      results.push(
        bench(
          `P4 回放 64 次 upsert（索引只建一次，N=${N}）`,
          () => {
            let cur = summaries;
            let index = indexSummaries(cur);
            for (const m of muts) {
              cur = apply(cur, m, index);
              if (cur !== cur) return cur.length;
            }
            return cur.length;
          },
          Math.max(10, REPS >> 3)
        )
      );
    }
  }
}

console.log(JSON.stringify({ file: FILE, kind, n: N, reps: REPS, node: process.version, results }, null, 2));
