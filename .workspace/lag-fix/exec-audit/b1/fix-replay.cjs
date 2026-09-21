#!/usr/bin/env node
/**
 * fix-replay.cjs — B1 执行前审计的**修订可行性回放**（只读）。
 *
 * 目的：在**不碰产品文件**的前提下，先证明「拟改动的两处修订」确实
 *   (1) 锚点唯一、可精确替换；
 *   (2) 替换后新代码语法可编译；
 *   (3) B② 修订能在**真函数字节切片**上把 201/running 反事实从 0 修成 1（并关闭第二条通道）；
 *   (4) 修订对「无截断」的既有场景零回归；
 *   (5) B① 修订把「枚举序 200」变成「确定性、可解释的 200」。
 *
 * 抽取方法（沿用语义审计线口径，禁止手抄）：
 *   - 目标文件 sha256 与 pin 逐字相等，不等即 exit 1（不"重算后继续"）；
 *   - 被测函数以**大括号配平字节切片**从目标文件抽出后 `new Function` 编译执行；
 *   - 修订文本由本文件给出，经锚点唯一性校验后**在内存里**套用到源码字符串，再抽取一次。
 *
 * 只读：不写产品文件、不重启、不发 HTTP。产物仅落本审计目录。
 */
'use strict';
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const LIVE = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib';
const PERSIST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';
const OUT = __dirname;
/** `--dir <path>` 指向另一份 lib 目录（用于对**本地干跑产物**跑 --post 验收，不碰产品文件）。 */
const DIR = (() => { const i = process.argv.indexOf('--dir'); return i === -1 ? LIVE : process.argv[i + 1]; })();

const FILES = {
  bundled: { key: 'index.js', path: join(DIR, 'index.js'), pin: '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62' },
  module: { key: 'types/api-proxy.js', path: join(DIR, 'types/api-proxy.js'), pin: 'f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d' },
};
const PERSIST_PIN = '8b6ebc4509a3e969ab3ad6e0dfb553ae4861e5b101831afed23e593d148d97f3';

const results = { at: new Date().toISOString(), checks: [], verdict: 'PENDING' };
let failures = 0;
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return Boolean(ok);
};
const info = (m) => console.log(`      ${m}`);

function sha256(text) { return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'); }
function count(text, lit) {
  let n = 0;
  for (let i = text.indexOf(lit); i !== -1; i = text.indexOf(lit, i + lit.length)) n += 1;
  return n;
}
/** 大括号配平切片（跳过字符串/模板/注释），返回函数源码。 */
function sliceFunction(text, signatureAt) {
  const braceAt = text.indexOf('{', signatureAt);
  let depth = 0;
  for (let i = braceAt; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(signatureAt, i + 1); }
  }
  throw new Error('切片未配平');
}

// ---------------------------------------------------------------------------
// 0) pins
// ---------------------------------------------------------------------------
/** 已记录的两个「修订后」目标 sha256（由本 harness 首次干跑产出，见 results-fix-replay.json）。 */
const PATCHED_PIN = {
  bundled: '96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310',
  module: 'f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734',
};
const POST = process.argv.includes('--post');
const SRC = {};
for (const [k, f] of Object.entries(FILES)) {
  const text = readFileSync(f.path, 'utf8');
  const sha = sha256(text);
  if (POST) {
    if (sha !== PATCHED_PIN[k]) {
      console.error(`--post 模式下 sha 与「修订后」记录不符 ${f.path}\n  expected ${PATCHED_PIN[k]}\n  actual   ${sha}`);
      process.exit(1);
    }
  } else if (sha !== f.pin) {
    console.error(`pin 不符 ${f.path}: ${sha} != ${f.pin}（若产品已按本审计修订，请改用 --post）`);
    process.exit(1);
  }
  SRC[k] = text;
}
const persistText = readFileSync(PERSIST, 'utf8');
check(`pin: persistence 与审计基线逐字相等${POST ? '（--post 模式：两个宿主产物按「修订后」sha256 校验）' : ''}`,
  sha256(persistText) === PERSIST_PIN, `persistence ${sha256(persistText).slice(0, 16)}…`);

// ---------------------------------------------------------------------------
// 1) 从 persistence 源码**静态派生** fromHeaderLine 产出的 meta 键集（不手抄）
// ---------------------------------------------------------------------------
{
  const at = persistText.indexOf('function fromHeaderLine(line) {');
  const fn = sliceFunction(persistText, at);
  const retAt = fn.indexOf('return {');
  const body = fn.slice(retAt + 'return {'.length, fn.lastIndexOf('}'));
  const keys = new Set();
  for (const m of body.matchAll(/(?:^|\n)\s*(?:\.\.\.[^\n]*?:\s*\{\s*)?([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1]);
  const spreadOnly = [...body.matchAll(/\.\.\.[^\n]*?\?\s*\{\s*([A-Za-z_$][\w$]*)\s*(?::[^}]*)?\}/g)].map((m) => m[1]);
  const all = [...new Set([...keys, ...spreadOnly])].sort();
  results.fromHeaderLineKeys = all;
  check('B①-0 真 fromHeaderLine 产出的 meta 键集**不含 updatedAt**（键集由源码静态派生）',
    !all.includes('updatedAt') && all.includes('createdAt') && all.includes('id'), `keys=[${all.join(', ')}]`);
  const nf = persistText.indexOf('function parseHeaderMeta(');
  const pfn = sliceFunction(persistText, nf);
  check('B①-0b persistence.list() 的 meta 就是 parseHeaderMeta→fromHeaderLine（无 mtime 附加）',
    /fromHeaderLine\(parsed\)/.test(pfn) && !/mtime/.test(pfn), pfn.replace(/\s+/g, ' ').slice(0, 120));
  const lfn = sliceFunction(persistText, persistText.indexOf('async list(signal) {', persistText.indexOf('function parseHeaderMeta(')));
  check('B①-0c persistence.list() 不返回任何 stat/mtime 字段（只 map artifact.header）',
    /map\(\(artifact\) => artifact\.header\)/.test(lfn) && !/mtime|stat\(/.test(lfn), lfn.replace(/\s+/g, ' '));
  const sfn = sliceFunction(persistText, persistText.indexOf('async listSnapshots(signal) {'));
  check('B①-0d listSnapshots() 确实有 per-session stat，但只暴露**不透明** revision（无数字 mtime）',
    /stat\(artifact\.path, \{ bigint: true \}\)/.test(sfn) && /revision: fileRevision\(identity\)/.test(sfn) && !/mtimeMs|updatedAt/.test(sfn),
    'revision = fileRevision(identity) = [dev,ino,size,mtimeNs,ctimeNs].join(":") 的不透明封装');
}

// ---------------------------------------------------------------------------
// 2) B① 冷路径比较器：修订前后对拍（确定性 + 可解释性）
// ---------------------------------------------------------------------------
const B1_OLD_SORT = '.sort((a, b) => b.updatedAt - a.updatedAt)';
const B1_NEW_SORT = '.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))';

/** 用真实格式（fromHeaderLine 键集）造 201 条冷 subagent meta。 */
function coldMetas(n, keyList) {
  const metas = [];
  for (let i = 1; i <= n; i += 1) {
    const m = { version: 1, id: `cold-${String(i).padStart(3, '0')}`, createdAt: i, delegationDepth: 1, origin: 'subagent' };
    metas.push(Object.fromEntries(Object.keys(m).filter((k) => keyList.includes(k)).map((k) => [k, m[k]])));
  }
  return metas;
}
/** 用真比较器源码做候选挑选（复刻 live 的 filter→sort→slice 链）。 */
function pick(metas, comparatorSrc, perm) {
  const cmp = new Function(`return ${comparatorSrc};`)();
  const ordered = perm(metas);
  const sorted = [...ordered].filter((m) => m.origin === 'subagent').sort(cmp).slice(0, 200);
  return sorted.map((m) => m.id);
}
{
  const keyList = results.fromHeaderLineKeys;
  const metas = coldMetas(201, keyList);
  const perms = {
    'createdAt 升序（枚举序 = 最旧→最新）': (a) => [...a],
    'createdAt 逆序': (a) => [...a].reverse(),
    '步长 7 置换': (a) => { const out = []; for (let i = 0; i < a.length; i += 1) out.push(a[(i * 7) % a.length]); return [...new Set(out)]; },
  };
  const oldSets = {};
  const newSets = {};
  for (const [name, p] of Object.entries(perms)) {
    oldSets[name] = pick(metas, B1_OLD_SORT.replace('.sort(', '').replace(/\)$/, ''), p);
    newSets[name] = pick(metas, `(${B1_NEW_SORT.replace('.sort(', '').replace(/\)$/, '')})`, p);
  }
  const expectNew = metas.slice().sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)).slice(0, 200).map((m) => m.id);
  const unique = (arr) => new Set(arr).size;
  info(`修订前三种枚举序入选集合的种类数 = ${unique(Object.values(oldSets).map((s) => s.join(',')))}（>1 即"名额分配取决于目录枚举序"）`);
  info(`修订后三种枚举序入选集合的种类数 = ${unique(Object.values(newSets).map((s) => s.join(',')))}（=1 即确定性）`);
  check('B①-1 真比较器在真实形状 meta 上返回 NaN（键不成立）',
    Number.isNaN(new Function(`return (a, b) => b.updatedAt - a.updatedAt;`)()(metas[0], metas[1])), 'b.updatedAt - a.updatedAt = NaN');
  check('B①-2 修订前：入选集合随枚举序变化（3 种枚举 → >1 个不同集合）',
    unique(Object.values(oldSets).map((s) => s.join(','))) > 1, `丢弃项：${Object.entries(oldSets).map(([k, v]) => { const d = metas.map((m) => m.id).filter((id) => !v.includes(id)); return `${k.slice(0, 8)}→${d}`; }).join(' | ')}`);
  check('B①-3 修订后：入选集合与枚举序无关，且 == 「createdAt 最新 200 条（id 升序 tiebreak）」',
    Object.values(newSets).every((s) => s.join(',') === expectNew.join(',')), `丢弃 ${metas.map((m) => m.id).filter((id) => !expectNew.includes(id))}`);
  check('B①-4 修订后：最旧的一条被丢弃（修订前"枚举升序"时丢弃的是**最新**的一条 cold-201）',
    oldSets[Object.keys(perms)[0]].includes('cold-201') === false && expectNew.includes('cold-201'),
    `旧(升序枚举)丢弃 ${metas.map((m) => m.id).filter((id) => !oldSets[Object.keys(perms)[0]].includes(id))}；新丢弃 cold-001`);
  // tie 场景：同 ms 创建 → 必须有确定性 tiebreak
  const tied = Array.from({ length: 5 }, (_, i) => ({ version: 1, id: `tie-${5 - i}`, createdAt: 1000, delegationDepth: 1, origin: 'subagent' }));
  const cmpNew = new Function(`return (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1);`)();
  const cmpOld = new Function(`return (a, b) => b.updatedAt - a.updatedAt;`)();
  check('B①-5 tie 场景：新比较器给出 id 升序的确定性顺序；旧比较器在 tie 上返回 NaN（回落到稳定序=输入序）',
    [...tied].sort(cmpNew).map((m) => m.id).join(',') === 'tie-1,tie-2,tie-3,tie-4,tie-5'
    && Number.isNaN(cmpOld(tied[0], tied[1])),
    `new=[${[...tied].sort(cmpNew).map((m) => m.id)}]`);
  results.b1 = { oldSets, newSets, expectNew };
}

// ---------------------------------------------------------------------------
// 3) B② 聚合函数：修订前后在 201/running 反事实上的对拍
// ---------------------------------------------------------------------------
const B2_OLD_BODY = {
  bundled: [
    '\tconst childrenOf = new Map();',
    '\tfor (const item of items) {',
    '\t\tconst parentId = item.parentSessionId;',
    '\t\tif (parentId === void 0) continue;',
    '\t\tconst bucket = childrenOf.get(parentId);',
    '\t\tif (bucket === void 0) childrenOf.set(parentId, [item.sessionId]);',
    '\t\telse bucket.push(item.sessionId);',
    '\t}',
    '\tconst liveStatus = new Map();',
    '\tfor (const session of ctx.sessions.list()) liveStatus.set(session.id, ctx.agents.get(session.id)?.status === "running");',
  ].join('\n'),
};
// 注意（本次审计实跑踩到的坑）：`/^\t/gm` 只吞掉行首**第一个** TAB（`\t\t` 会变成 `    \t`）。
// 必须用 `/^\t+/gm` 才能整体换算 —— 这正是"锚点必须由目标文件派生、不能凭排版假设生成"的活例。
const tabsTo4 = (s) => s.replace(/^\t+/gm, (m) => '    '.repeat(m.length));
B2_OLD_BODY.module = tabsTo4(B2_OLD_BODY.bundled)
  .replace(/"running"/g, "'running'");

const B2_NEW_BODY = {
  bundled: [
    '\tconst liveSessions = ctx.sessions.list();',
    '\tconst childrenOf = new Map();',
    '\tconst liveStatus = new Map();',
    '\tfor (const session of liveSessions) {',
    '\t\tliveStatus.set(session.id, ctx.agents.get(session.id)?.status === "running");',
    '\t\tconst parentId = session.header.parentSession;',
    '\t\tif (parentId === void 0) continue;',
    '\t\tconst bucket = childrenOf.get(parentId);',
    '\t\tif (bucket === void 0) childrenOf.set(parentId, [session.id]);',
    '\t\telse bucket.push(session.id);',
    '\t}',
  ].join('\n'),
};
B2_NEW_BODY.module = tabsTo4(B2_NEW_BODY.bundled)
  .replace(/"running"/g, "'running'");

const PATCHED = {};
for (const k of Object.keys(FILES)) {
  const src = SRC[k];
  const oldBody = B2_OLD_BODY[k];
  const newBody = B2_NEW_BODY[k];
  const sortStmtAnchor = k === 'bundled'
    ? '\t\t\tconst coldSubagentCandidates = coldSource\n\t\t\t  .filter((meta) => meta.origin === "subagent")\n\t\t\t  .sort((a, b) => b.updatedAt - a.updatedAt)'
    : '            const coldSubagentCandidates = coldSource\n              .filter((meta) => meta.origin === \'subagent\')\n              .sort((a, b) => b.updatedAt - a.updatedAt)';
  const sortStmtAnchorNew = sortStmtAnchor.replace(B1_OLD_SORT, B1_NEW_SORT);

  if (POST) {
    // --post：产品已按本审计修订，改为**验收**口径（新锚点在、旧锚点不在、可编译、反事实通过）
    check(`[post][${FILES[k].key}] 旧 B② 锚点已消失`, count(src, oldBody) === 0, `命中 ${count(src, oldBody)} 次`);
    check(`[post][${FILES[k].key}] 新 B② 锚点（liveSessions 同源建边）恰好 1 次`,
      count(src, newBody) === 1, `命中 ${count(src, newBody)} 次`);
    check(`[post][${FILES[k].key}] 新 B① 比较器恰好 1 次且带 coldSource 上下文`,
      count(src, sortStmtAnchorNew) === 1, `命中 ${count(src, sortStmtAnchorNew)} 次`);
    check(`[post][${FILES[k].key}] 收口排序维持原样（未被误改）`, count(src, 'items.sort((a, b) => b.updatedAt - a.updatedAt);') === 1, 'ok');
    check(`[post][${FILES[k].key}] 旧「裸比较器」只剩收口那 1 处`, count(src, B1_OLD_SORT) === 1, `命中 ${count(src, B1_OLD_SORT)} 次`);
    PATCHED[k] = src;
  } else {
    const oldHits = count(src, oldBody);
    check(`B②-锚点唯一 [${FILES[k].key}] childrenOf/liveStatus 块`, oldHits === 1, `命中 ${oldHits} 次`);
    check(`B①-锚点唯一 [${FILES[k].key}] 冷候选四行语句（自带 coldSource 上下文，避开与收口排序的撞车）`,
      count(src, sortStmtAnchor) === 1, `命中 ${count(src, sortStmtAnchor)} 次`);
    check(`B①-锚点撞车证据 [${FILES[k].key}] 裸比较器在同一文件内出现 2 次（故不可作锚点）`,
      count(src, B1_OLD_SORT) === 2, `命中 ${count(src, B1_OLD_SORT)} 次`);
    let text = src;
    text = text.replace(oldBody, newBody);
    text = text.replace(sortStmtAnchor, sortStmtAnchorNew);
    PATCHED[k] = text;
    check(`修订后 [${FILES[k].key}] 旧锚点已消失、新锚点各 1 次`,
      count(text, oldBody) === 0 && count(text, B1_NEW_SORT) === 1 && count(text, 'const liveSessions = ctx.sessions.list();') === 1
      && count(text, B1_OLD_SORT) === 1 /* 仅剩收口那一处 */,
      `旧B②块 ${count(text, oldBody)} / 新B① ${count(text, B1_NEW_SORT)} / 裸旧比较器残留 ${count(text, B1_OLD_SORT)}（应为 1 = 收口）`);
    results[`handpatch_${k}`] = { bytes: Buffer.byteLength(text), sha256: sha256(text), note: "手工串替换对拍用；权威期望值见 v2 规格重放" };
  }
  // 语法可编译
  let compileOk = true;
  let compileErr = '';
  try {
    const at = PATCHED[k].indexOf('function annotateRunningSubagentCounts(');
    new Function(`${sliceFunction(PATCHED[k], at)}; return annotateRunningSubagentCounts;`)();
  } catch (e) { compileOk = false; compileErr = String(e.message); }
  check(`修订后 [${FILES[k].key}] 聚合函数可编译（new Function）`, compileOk, compileErr || 'ok');
  // 未声明标识符扫描（复现 2026-09-20 事故的可捕获性）
  const at = PATCHED[k].indexOf('function annotateRunningSubagentCounts(');
  const fn = sliceFunction(PATCHED[k], at);
  const params = fn.slice(fn.indexOf('(') + 1, fn.indexOf(')')).split(',').map((s) => s.trim());
  check(`[${FILES[k].key}] 聚合函数签名声明 ctx 形参（事故直接判据）`,
    params[0] === 'ctx', `params=[${params.join(', ')}]`);
  const mutated = fn.replace('(ctx, items)', '(items)');
  const roots = (body) => {
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    const local = new Set(params.filter((p) => p !== 'ctx'));
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    const kw = new Set(['const', 'let', 'var', 'for', 'of', 'in', 'if', 'else', 'return', 'continue', 'break', 'while', 'new', 'true', 'false', 'void', 'function', 'typeof', 'this']);
    return [...new Set([...stripped.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].filter((n) => !kw.has(n) && !local.has(n));
  };
  const undeclared = roots(mutated);
  check(`防复发自证 [${FILES[k].key}] 去掉 ctx 形参后「未声明标识符」扫描能抓到 ctx`,
    undeclared.includes('ctx'), `扫描出未声明：[${undeclared.join(', ')}]`);
}

// ---- 场景：真函数（旧）+ 真函数（新）跑同一夹具 ----
function buildCtx(live) {
  return {
    sessions: { list: () => live.map((s) => ({ id: s.id, header: { id: s.id, ...(s.parent !== undefined ? { parentSession: s.parent } : {}), ...(s.origin !== undefined ? { origin: s.origin } : {}), createdAt: s.createdAt ?? 1, delegationDepth: 1, version: 1 } })) },
    agents: { get: (id) => (live.find((s) => s.id === id)?.running ? { status: 'running' } : undefined) },
  };
}
function fnOf(text, marker) {
  const at = text.indexOf('function annotateRunningSubagentCounts(');
  return new Function(`${sliceFunction(text, at)}; return annotateRunningSubagentCounts;`)();
}
/** --post 模式下把已修订文件**内存里回退**成修订前形态，用于零回归对拍（不落盘）。 */
const REVERTED = POST ? (() => {
  const out = {};
  for (const k of Object.keys(FILES)) {
    out[k] = SRC[k].replace(B2_NEW_BODY[k], B2_OLD_BODY[k]).replace(B1_NEW_SORT, B1_OLD_SORT);
  }
  return out;
})() : SRC;
check('修订前形态可用（--post 下由内存回退得到，用于零回归对拍）',
  POST ? count(REVERTED.bundled, B1_NEW_SORT) === 0 && count(REVERTED.bundled, 'const liveSessions = ctx.sessions.list();') === 0
       : count(SRC.bundled, B1_NEW_SORT) === 0,
  `回退后 新B①=${count(REVERTED.bundled, B1_NEW_SORT)} liveSessions=${count(REVERTED.bundled, 'const liveSessions = ctx.sessions.list();')}`);
const oldFn = fnOf(REVERTED.bundled, 'old');
const newFn = fnOf(PATCHED.bundled, 'new');
const counts = (fn, ctx, items) => {
  const out = fn(ctx, items.map((r) => ({ ...r })));
  const top = out.find((r) => r.origin !== 'subagent');
  return top ? top.runningSubagentCount : null;
};

{
  // 夹具 A：顶层 p + 201 subagent，第 201 条（最旧）running；items 已被截断为 200 条
  const live = [{ id: 'p', createdAt: 1 }, ...Array.from({ length: 201 }, (_, i) => ({ id: `s-${String(i + 1).padStart(3, '0')}`, parent: 'p', origin: 'subagent', createdAt: i + 1, running: i + 1 === 201 }))];
  const ctx = buildCtx(live);
  const dropped = 's-201';
  const itemsTruncated = [{ sessionId: 'p' }, ...live.filter((s) => s.parent === 'p' && s.id !== dropped).map((s) => ({ sessionId: s.id, origin: 'subagent', parentSessionId: 'p' }))];
  const itemsFull = [{ sessionId: 'p' }, ...live.filter((s) => s.parent === 'p').map((s) => ({ sessionId: s.id, origin: 'subagent', parentSessionId: 'p' }))];
  const oldT = counts(oldFn, ctx, itemsTruncated);
  const newT = counts(newFn, ctx, itemsTruncated);
  const oldF = counts(oldFn, ctx, itemsFull);
  const newF = counts(newFn, ctx, itemsFull);
  check('B②-1 反事实（201 条 subagent、第 201 条 running、该行被截断）：真值 = 1',
    oldF === 1 && newF === 1, `未截断时 旧=${oldF} 新=${newF}`);
  check('B②-2 修订前：截断后漏计为 0（缺陷成立，实跑）', oldT === 0, `旧=${oldT}`);
  check('B②-3 修订后：截断后仍为 1（A2 关闭「收口截断」通道，实跑）', newT === 1, `新=${newT}`);
  results.b2 = { scenario: '201 subagents, #201 running, row truncated', oldTruncated: oldT, newTruncated: newT, oldFull: oldF, newFull: newF };
}
{
  // 夹具 B：两级链 p → a(running) → c201(running)，c201 行被截断
  const live = [{ id: 'p', createdAt: 1 }, { id: 'a', parent: 'p', origin: 'subagent', createdAt: 2, running: true }, { id: 'c-201', parent: 'a', origin: 'subagent', createdAt: 3, running: true }];
  const ctx = buildCtx(live);
  const itemsTruncated = [{ sessionId: 'p' }, { sessionId: 'a', origin: 'subagent', parentSessionId: 'p' }];
  const o = counts(oldFn, ctx, itemsTruncated);
  const n = counts(newFn, ctx, itemsTruncated);
  check('B②-4 两级链反事实：p 的 running 后代真值 = 2（a + c-201）', n === 2, `新=${n}`);
  check('B②-5 修订前两级链漏计为 1（只数到 a）', o === 1, `旧=${o}`);
}
{
  // 夹具 C：无截断的普通场景 —— 修订不得改变既有计数（零回归）
  const live = [
    { id: 'p1', createdAt: 1 }, { id: 'p2', createdAt: 1 },
    { id: 'a', parent: 'p1', origin: 'subagent', createdAt: 2, running: true },
    { id: 'b', parent: 'a', origin: 'subagent', createdAt: 3, running: true },
    { id: 'c', parent: 'p1', origin: 'subagent', createdAt: 4 },
    { id: 'd', parent: 'p2', origin: 'subagent', createdAt: 5, running: true },
  ];
  const ctx = buildCtx(live);
  const items = [{ sessionId: 'p1' }, { sessionId: 'p2' }].concat(live.filter((s) => s.origin === 'subagent').map((s) => ({ sessionId: s.id, origin: 'subagent', parentSessionId: s.parent })));
  const o = oldFn(ctx, items.map((r) => ({ ...r }))).map((r) => `${r.sessionId}:${r.runningSubagentCount ?? '-'}`).join(',');
  const n = newFn(ctx, items.map((r) => ({ ...r }))).map((r) => `${r.sessionId}:${r.runningSubagentCount ?? '-'}`).join(',');
  check('B②-6 零回归：无截断场景下修订前后逐行计数完全一致', o === n, `旧[${o}] 新[${n}]`);
  check('B②-7 零回归：语义值正确（p1=2、p2=1、subagent 行不写该字段）', n === 'p1:2,p2:1,a:-,b:-,c:-,d:-', n);
}
{
  // 夹具 D：被丢弃的行是**冷**（不在 live 表）—— 修订不得凭空计数
  const live = [{ id: 'p', createdAt: 1 }];
  const ctx = buildCtx(live);
  const items = [{ sessionId: 'p' }, { sessionId: 'cold-1', origin: 'subagent', parentSessionId: 'p' }];
  check('B②-8 冷行（不在 live 表）不得被计数：修订前后都为 0',
    counts(oldFn, ctx, items) === 0 && counts(newFn, ctx, items) === 0, `旧=${counts(oldFn, ctx, items)} 新=${counts(newFn, ctx, items)}`);
}
{
  // 夹具 E：环（a↔b）—— 修订后不得死循环
  const live = [{ id: 'p', createdAt: 1 }, { id: 'a', parent: 'b', origin: 'subagent', createdAt: 2, running: true }, { id: 'b', parent: 'a', origin: 'subagent', createdAt: 3 }];
  const ctx = buildCtx(live);
  const items = [{ sessionId: 'p' }];
  let ok = true; let v = null;
  try { v = counts(newFn, ctx, items); } catch (e) { ok = false; }
  check('B②-9 血缘环（a↔b）下修订版仍终止且不虚增（p 无入边 → 0）', ok && v === 0, `新=${v}`);
}

// ---------------------------------------------------------------------------
// 4) 是否有其它单元也在改这两个文件（回滚纯净性判据）
// ---------------------------------------------------------------------------
{
  const pre = readFileSync(join(__dirname, '..', '..', 'backup', 'B1', 'server', '20260920-154039', 'lib', 'index.js'), 'utf8');
  const markers = ['dsh-lag-fix', 'dsh-perf-fix', 'dsh-usage', 'P2 v1', 'dsh-lag-fix B1/C1'];
  const found = markers.filter((m) => pre.includes(m));
  check('回滚点-1 pre-image(20260920-154039/lib/index.js) 内**不含任何**补丁标记 → 全文件还原 = 纯 B1 回滚',
    found.length === 0, `pre sha256=${sha256(pre).slice(0, 16)}… 命中标记=${JSON.stringify(found)}`);
  const liveMarkers = [...SRC.bundled.matchAll(/\/\* (dsh-[a-z-]+ [^:]*):/g)].map((m) => m[1]);
  check('回滚点-2 live 内补丁标记只有 B1（不含 C1/C2/runtime 痕迹）',
    new Set(liveMarkers).size === 1 && liveMarkers[0].startsWith('dsh-lag-fix B1'), JSON.stringify([...new Set(liveMarkers)]));
}

// ---------------------------------------------------------------------------
// 5) 权威期望值：v2 规格（B1-transform.v2-candidate.cjs）重放到 pre-image 的产物
//    —— 用于自证 PATCHED_PIN 不是硬编码，而是**规格可复现**的结果。
// ---------------------------------------------------------------------------
{
  const v2 = require('./B1-transform.v2-candidate.cjs');
  const preDir = join(__dirname, '..', '..', 'backup', 'B1', 'server', '20260920-154039', 'lib');
  const products = [['bundled', 'index.js'], ['module', join('types', 'api-proxy.js')]];
  for (const [k, rel] of products) {
    const out = v2.applyServerFilter(readFileSync(join(preDir, rel), 'utf8'));
    const sha = sha256(out);
    const vf = v2.verifyServerFilter(out);
    check(`v2 规格重放 [${rel}] 产物 sha256 == 记录的「修订后」期望值`, sha === PATCHED_PIN[k], `${sha.slice(0, 16)}… vs ${PATCHED_PIN[k].slice(0, 16)}…`);
    check(`v2 规格重放 [${rel}] verifyServerFilter 零失败`, vf.length === 0, JSON.stringify(vf));
    results[`expected_final_${k}`] = { bytes: Buffer.byteLength(out), sha256: sha };
  }
}

results.failures = failures;
results.verdict = failures === 0 ? 'PASS' : 'FAIL';
writeFileSync(join(OUT, 'results-fix-replay.json'), JSON.stringify(results, null, 2));
console.log(`\n[verdict] ${results.verdict}  failures=${failures}  → results-fix-replay.json`);
process.exit(failures === 0 ? 0 : 1);
