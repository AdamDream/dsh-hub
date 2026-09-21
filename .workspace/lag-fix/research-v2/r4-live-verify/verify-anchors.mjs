#!/usr/bin/env node
/**
 * verify-anchors.mjs — R4 实效审计：独立、只读地复核 deployed 补丁的 14 处替换点契约。
 *
 * 为什么不跑 apply-R4-deployed.mjs 的 dry-run：它在**非本审计目录**写
 * r4-delivery/candidate/{client,index}.js（脚本 280-282 行），超出本档只读边界。
 * 本脚本只读四个文件，只向本目录写 JSON/diff 文本。
 *
 * 对每处替换点检查三件事：
 *   1. post 签名（补丁后应有的代码）在 deployed 中**恰好命中 1 次**；
 *   2. pre 签名（补丁前的旧代码）在 deployed 中**命中 0 次**（插入型规则跳过）；
 *   3. 该处代码在 source 中的对应实现 —— 输出供逐处比对契约一致性。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = '/home/CNS2026495165/dsh/dsh-usage/lib';
const DEP = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify';

const read = (dir, f) => readFileSync(`${dir}/${f}`, 'utf8');
const srcClient = read(SRC, 'client.js');
const srcIndex = read(SRC, 'index.js');
const depClient = read(DEP, 'client.js');
const depIndex = read(DEP, 'index.js');

const count = (text, re) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const m = text.match(g);
  return m === null ? 0 : m.length;
};

/** @type {{id:string,name:string,file:'client.js'|'index.js',post:RegExp,pre:RegExp|null,insertOnly?:boolean,srcText:string}[]} */
const checks = [
  // ── client.js ────────────────────────────────────────────────────────────
  {
    id: 'C1', file: 'client.js', name: 'refs + lifecycle effect',
    post: /const aliveRef = react\.useRef\(true\);\n(?:\s*)const allGenerationRef = react\.useRef\(0\);\n(?:\s*)const sessionsGenerationRef = react\.useRef\(0\);\n(?:\s*)const statusGenerationRef = react\.useRef\(0\);\n(?:\s*)react\.useEffect\(\(\) => \{\n(?:\s*)aliveRef\.current = true;\n(?:\s*)return \(\) => \{\n(?:\s*)aliveRef\.current = false;\n(?:\s*)allGenerationRef\.current \+= 1;\n(?:\s*)sessionsGenerationRef\.current \+= 1;\n(?:\s*)statusGenerationRef\.current \+= 1;/,
    pre: null, insertOnly: true,
    srcText: 'client.js: 同一 guard 块以 `// R4: RPC calls are not assumed cancellable...` 注释开头（英文），标识符与结构完全相同',
  },
  {
    id: 'C2', file: 'client.js', name: 'loadAll 头部（代次 + 首次写入门控）',
    post: /const loadAll = react\.useCallback\(async \(\) => \{\n\s*const generation = \+\+allGenerationRef\.current;\n\s*const current = \(\) => aliveRef\.current && generation === allGenerationRef\.current;\n\s*if \(!rpcAvailable\) \{\n\s*if \(current\(\)\) setError\(\{ code: "unavailable"/,
    pre: /const loadAll = react\.useCallback\(async \(\) => \{\n\s*if \(!rpcAvailable\) \{\n\s*setError\(\{ code: "unavailable"/,
    srcText: 'source 同形（generation/current 两行 + `if (current())` 门控）逐字一致；但依赖数组不同 —— source `[rpcAvailable, rpc, payload, range.from, dataSource]`，deployed 多一个 `trendDay`（hourly 档位）。R4 补丁**未**改动依赖数组，deployed 的 `trendDay` 依赖被保住 ✓',
  },
  {
    id: 'C3', file: 'client.js', name: 'loadAll 成功分支门控',
    post: /if \(current\(\) && calls\.slice\(0, 6\)\.every\(\(r\) => r && r\.ok\)\) \{/,
    pre: /if \(calls\.slice\(0, 6\)\.every\(\(r\) => r && r\.ok\)\) \{/,
    srcText: '⚠️ **关键结构差异（超集保命点）**：deployed 的 loadAll 有 **7** 个 rpc.call —— 第 7 个是 hourly timeseries，且被**故意排除在全有全无闸门之外**（`.catch(() => null)`，注释明确：不支持 hourly 的宿主会 invalid-params，必须降级为日粒度曲线而不是让整卡报错）。所以 deployed 必须是 `calls.slice(0, 6).every(...)`；source 只有 6 个调用故用 `calls.every(...)`。R4 补丁只加 `current() &&` 前缀、**没有**照抄 source 的 `calls.every` —— 若整文件覆盖成 source，第 7 个 null 会让闸门失败 → 整卡报错空白。deployed 超集语义被正确保住 ✓',
  },
  {
    id: 'C4', file: 'client.js', name: 'loadAll 失败分支门控',
    post: /\} else if \(current\(\)\) \{\n\s*const failed = calls\.slice\(0, 6\)\.find/,
    pre: /\} else \{\n\s*const failed = calls\.slice\(0, 6\)\.find/,
    srcText: '⚠️ 同上：source 失败分支为 `calls.find(...)`（它只有 6 个调用）；deployed 必须 `calls.slice(0,6).find(...)` 才能把第 7 个 hourly 调用排除在「谁是失败者」的判定外。deployed 超集语义被保住 ✓',
  },
  {
    id: 'C5', file: 'client.js', name: 'loadAll catch + finally 门控',
    post: /\} catch \(cause\) \{\n\s*if \(current\(\)\) setError\(\{ code: "transport", message: String\(\(cause && cause\.message\) \|\| cause\) \}\);\n\s*\} finally \{\n\s*if \(current\(\)\) setLoading\(false\);/,
    pre: /\} catch \(cause\) \{\n\s*setError\(\{ code: "transport", message: String\(\(cause && cause\.message\) \|\| cause\) \}\);\n\s*\} finally \{\n\s*setLoading\(false\);/,
    srcText: 'source 同形，逐字一致',
  },
  {
    id: 'C6', file: 'client.js', name: 'loadSessions 头部',
    post: /const loadSessions = react\.useCallback\(async \(\) => \{\n\s*const generation = \+\+sessionsGenerationRef\.current;\n\s*const current = \(\) => aliveRef\.current && generation === sessionsGenerationRef\.current;\n\s*if \(!rpcAvailable\) return;/,
    pre: /const loadSessions = react\.useCallback\(async \(\) => \{\n\s*if \(!rpcAvailable\) return;/,
    srcText: 'source 同形，逐字一致',
  },
  {
    id: 'C7', file: 'client.js', name: 'loadSessions 写入分支门控',
    post: /if \(result && result\.ok\) \{\n\s*if \(current\(\)\) setSessionRows\(result\.value \|\| \[\]\);\n\s*\} else if \(current\(\)\) \{\n\s*setError\(\(result && result\.error\)/,
    pre: /if \(result && result\.ok\) \{\n\s*setSessionRows\(result\.value \|\| \[\]\);\n\s*\} else \{\n\s*setError\(\(result && result\.error\)/,
    srcText: 'source 同形（`if (current()) setSessionRows` 嵌在 ok 分支内 + `else if (current())`），逐字一致',
  },
  {
    id: 'C8', file: 'client.js', name: 'loadSessions catch 门控',
    post: /\} catch \(cause\) \{\n\s*if \(current\(\)\) setError\(\{ code: "transport", message: String\(\(cause && cause\.message\) \|\| cause\) \}\);\n\s*\}\n\s*\}, \[rpcAvailable, rpc, dataSource, range\.from, range\.to, sessionFrom, sessionTo\]\);/,
    pre: /\} catch \(cause\) \{\n\s*setError\(\{ code: "transport", message: String\(\(cause && cause\.message\) \|\| cause\) \}\);\n\s*\}\n\s*\}, \[rpcAvailable, rpc, dataSource, range\.from, range\.to, sessionFrom, sessionTo\]\);/,
    srcText: 'source 同形，逐字一致（含依赖数组未变）',
  },
  {
    id: 'C9', file: 'client.js', name: 'loadStatus 头部',
    post: /const loadStatus = react\.useCallback\(async \(\) => \{\n\s*const generation = \+\+statusGenerationRef\.current;\n\s*const current = \(\) => aliveRef\.current && generation === statusGenerationRef\.current;\n\s*if \(!rpcAvailable\) return;/,
    pre: /const loadStatus = react\.useCallback\(async \(\) => \{\n\s*if \(!rpcAvailable\) return;/,
    srcText: 'source 同形，逐字一致',
  },
  {
    id: 'C10', file: 'client.js', name: 'loadStatus 写入门控',
    post: /if \(current\(\) && result && result\.ok\) setStatus\(result\.value\);/,
    pre: /if \(result && result\.ok\) setStatus\(result\.value\);/,
    srcText: 'source 同形，逐字一致',
  },
  // ── index.js ─────────────────────────────────────────────────────────────
  {
    id: 'H1', file: 'index.js', name: 'disposed / 代次状态',
    post: /let disposeTimer = null;\n(?:\s*\/\* dsh-perf-fix R4 v1[\s\S]{0,400}?\*\/\n)?\s*let disposed = false;\n\s*let activationGeneration = 0;\n\s*const isActive = \(generation\) => !disposed && generation === activationGeneration;/,
    pre: null, insertOnly: true,
    srcText: 'source 有相同三个声明与 isActive，但**无** R4 注释横幅（source 侧无标记）',
  },
  {
    id: 'H2', file: 'index.js', name: 'runIngest dispose 门控',
    post: /const runIngest = async \(\) => \{\n\s*\/\/[\s\S]{0,240}?\n\s*if \(disposed \|\| db === null\) return;/,
    pre: /const runIngest = async \(\) => \{\n\s*if \(db === null\) return;/,
    srcText: 'source 同形（`if (disposed || db === null) return;`），注释措辞略异，语义一致',
  },
  {
    id: 'H3a', file: 'index.js', name: '声明 bootstrapGeneration（deployed 原本缺此声明）',
    post: /\/\/ 3 \+ 4\. DB open, async first scan, then the periodic ingest timer\.\n\s*const bootstrapGeneration = \+\+activationGeneration;\n\s*queueMicrotask\(\(\) => \{/,
    pre: /\/\/ 3 \+ 4\. DB open, async first scan, then the periodic ingest timer\.\n\s*queueMicrotask\(\(\) => \{/,
    srcText: 'source 本身就有 `const bootstrapGeneration = ++activationGeneration;`（这正是 H3a 要补回 deployed 的那一行）',
  },
  {
    id: 'H3', file: 'index.js', name: 'bootstrap 全链路门控 + db 延迟发布',
    post: /queueMicrotask\(\(\) => \{\n\s*void \(async \(\) => \{\n\s*let openedDb = null;\n\s*try \{[\s\S]{0,2600}?disposeTimer = null;\n\s*\}\n\s*\}\)\(\)\.catch\(/,
    pre: null, insertOnly: true,
    srcText: 'source 的 queueMicrotask 体与 deployed 补丁后结构一致（`void (async () =>`、openedDb、两处 isActive 复查 + close、ensureSchema 后发布、runIngest 前后复查、timer 安装后再复查并兜底 dispose）',
  },
  {
    id: 'H4', file: 'index.js', name: 'disposer 先失效代次',
    post: /ctx\.effect\(\n\s*\(\) => \(\) => \{\n\s*\/\* dsh-perf-fix R4 v1: 先失效代次再清理[\s\S]{0,120}?\*\/\n\s*disposed = true;\n\s*activationGeneration \+= 1;\n\s*try \{\n\s*disposeTimer\?\.\(\);/,
    pre: /ctx\.effect\(\n\s*\(\) => \(\) => \{\n\s*try \{\n\s*disposeTimer\?\.\(\);/,
    srcText: 'source 同形（disposed = true; activationGeneration += 1; 在 disposeTimer?.( ) 之前），无 R4 注释横幅',
  },
];

// ── 超集功能令牌（deployed 独有，必须存活）────────────────────────────────
const superset = [
  { feature: 'hourly 粒度', re: /granularity === "hour"/g, expectMin: 2 },
  { feature: 'hourly：3 小时 roll-up', re: /rollupBuckets|hoursPerBucket/g, expectMin: 2 },
  { feature: 'hourly：anchorHour / 04:00 使用日', re: /anchorHour|anchor hour/g, expectMin: 2 },
  { feature: 'trend gear（24h 档）', re: /24h gear|Gear/g, expectMin: 2 },
  { feature: 'trend：--du-trend-line / fill 令牌', re: /--du-trend-(line|fill)/g, expectMin: 4 },
  { feature: 'settingsScope prop 接线', re: /settingsScope/g, expectMin: 10 },
  { feature: 'peakRing', re: /peakRing/g, expectMin: 2 },
  { feature: 'heatmap peak 计算', re: /peakDay/g, expectMin: 3 },
];

const results = { at: new Date().toISOString(), files: {}, anchors: [], superset: [], summary: {} };

for (const [name, text] of [['client.js', depClient], ['index.js', depIndex]]) {
  results.files[name] = {
    path: `${DEP}/${name}`,
    sourcePath: `${SRC}/${name}`,
    bytes: Buffer.byteLength(text),
    sourceBytes: Buffer.byteLength(name === 'client.js' ? srcClient : srcIndex),
    markCount: (text.match(/dsh-perf-fix R4 v1/g) || []).length,
    syntaxCheck: null,
  };
}

let postOk = 0, preClean = 0, preSkip = 0;
for (const c of checks) {
  const dep = c.file === 'client.js' ? depClient : depIndex;
  const postHits = count(dep, c.post);
  const preHits = c.pre ? count(dep, c.pre) : null;
  const postPass = postHits === 1;
  const prePass = c.pre === null ? true : preHits === 0;
  if (postPass) postOk += 1;
  if (c.pre === null) preSkip += 1; else if (prePass) preClean += 1;
  results.anchors.push({
    id: c.id, file: c.file, name: c.name,
    postHits, postPass,
    preHits, prePass: c.pre === null ? 'n/a(插入型)' : prePass,
    verdict: postPass && prePass ? 'PASS' : 'FAIL',
    sourceContract: c.srcText,
  });
}

for (const s of superset) {
  const depHits = count(depClient, s.re);
  const srcHits = count(srcClient, s.re);
  results.superset.push({
    feature: s.feature, deployedHits: depHits, sourceHits: srcHits, expectMin: s.expectMin,
    verdict: depHits >= s.expectMin ? 'PASS' : 'FAIL',
    note: srcHits === 0 ? 'source 中不存在 → 纯 deployed 超集功能' : 'source 中亦存在',
  });
}

results.summary = {
  anchorTotal: checks.length,
  anchorPostPass: postOk,
  anchorPreClean: preClean,
  anchorInsertOnly: preSkip,
  supersetTotal: superset.length,
  supersetPass: results.superset.filter((s) => s.verdict === 'PASS').length,
  anchorVerdict: postOk === checks.length ? 'PASS' : 'FAIL',
  supersetVerdict: results.superset.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL',
};

writeFileSync(`${OUT}/raw/anchors.json`, JSON.stringify(results, null, 2) + '\n');

console.log(`anchors: post 命中唯一 ${postOk}/${checks.length}; pre 旧形态残留 ${checks.length - preSkip - preClean} 处`);
for (const a of results.anchors) if (a.verdict === 'FAIL') console.log(`  [FAIL] ${a.id} ${a.name}: post=${a.postHits} pre=${a.preHits}`);
console.log(`superset: ${results.summary.supersetPass}/${superset.length}`);
for (const s of results.superset) console.log(`  [${s.verdict}] ${s.feature}: deployed=${s.deployedHits} source=${s.sourceHits}`);
console.log(`markers: client.js=${results.files['client.js'].markCount} index.js=${results.files['index.js'].markCount}`);
