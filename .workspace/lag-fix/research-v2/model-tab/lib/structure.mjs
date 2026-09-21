/*
 * Static structural analysis of the models settings panel: which components
 * build the DOM, how many elements each creates per render, what is memoized,
 * and what is rebuilt on every store notification.
 *
 * Pure source reading — no browser, no product write, no network.
 * Output: structure-facts.json (machine-readable) + stdout report.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib';
const FILE = path.join(DIR, 'client.js');
const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const src = lines.join('\n');

/* component boundaries: `function Name(` / `var Name = class` at tab indent level */
const comps = [];
const re = /^\t\tfunction ([A-Z][A-Za-z0-9_]*)\s*\(/gm;
let m;
while ((m = re.exec(src))) {
  const startLine = src.slice(0, m.index).split('\n').length;
  comps.push({ name: m[1], startLine });
}
/* find the end of each component body by brace matching from its first `{` */
const bodyOf = (startLine) => {
  let depth = 0, started = false, out = [];
  for (let i = startLine - 1; i < lines.length; i++) {
    const l = lines[i];
    for (const ch of l) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    out.push(l);
    if (started && depth <= 0) break;
    if (out.length > 3000) break;
  }
  return out.join('\n');
};

const jsxRe = /react_jsx_runtime\.jsxs?\)?\(\s*"([a-zA-Z0-9]+)"/g;
const jsxAnyRe = /react_jsx_runtime\.jsxs?\)?\(/g;
const facts = [];
for (const c of comps) {
  const body = bodyOf(c.startLine);
  const tags = [...body.matchAll(jsxRe)].map((x) => x[1]);
  const nJsx = [...body.matchAll(jsxAnyRe)].length;
  const maps = [...body.matchAll(/\.map\(/g)].length;
  const memo = [...body.matchAll(/react\.memo\(/g)].length;
  const useMemo = [...body.matchAll(/react\.useMemo\(/g)].length + [...body.matchAll(/react\.useMemo\)\(/g)].length;
  const useCB = [...body.matchAll(/react\.useCallback\(/g)].length + [...body.matchAll(/react\.useCallback\)\(/g)].length;
  const useState = [...body.matchAll(/react\.useState[\)]?\(/g)].length;
  const useEffect = [...body.matchAll(/react\.useEffect[\)]?\(/g)].length;
  const useSync = [...body.matchAll(/useSyncExternalStore/g)].length;
  const sub = [...body.matchAll(/useSnapshot\s*\(/g)].length;
  const jsxLines = [];
  body.split('\n').forEach((l, i) => { if (/react_jsx_runtime\.jsxs?\)?\(/.test(l)) jsxLines.push(c.startLine + i); });
  facts.push({
    name: c.name, startLine: c.startLine, endLine: c.startLine + body.split('\n').length - 1,
    jsxCalls: nJsx, jsxTags: tags, maps, reactMemo: memo, useMemo, useCallback: useCB, useState, useEffect,
    useSyncExternalStore: useSync, snapshotSubscriptions: sub,
    jsxLineRange: jsxLines.length ? [jsxLines[0], jsxLines[jsxLines.length - 1]] : null,
  });
}

/* static global facts */
const globals = {
  file: FILE, totalLines: lines.length,
  reactMemoCount: (src.match(/react\.memo\(/g) || []).length,
  createContextCount: (src.match(/createContext/g) || []).length,
  useMemoCount: (src.match(/react\.useMemo\(/g) || []).length + (src.match(/react\.useMemo\)\(/g) || []).length,
  useCallbackCount: (src.match(/react\.useCallback[\)]?\(/g) || []).length,
  virtualizationMarkers: (src.match(/virtual|Virtual|windowSize|overscan|IntersectionObserver/g) || []).length,
  jsxRuntime: 'react/jsx-runtime (jsx/jsxs)',
  bareListMaps: facts.filter((f) => f.maps > 0).map((f) => ({ comp: f.name, line: f.startLine, maps: f.maps })),
};

/* ------------------------------------------------------------- report */
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log('=== MODELS PANEL: components that build DOM (source: lib/client.js) ===');
console.log(pad('component', 26) + pad('lines', 14) + pad('jsx', 6) + pad('jsxCalls', 9) + pad('maps', 6) + pad('memo', 6) + pad('useMemo', 9) + pad('useState', 9) + pad('useEffect', 10) + pad('uSES', 6));
for (const f of facts) {
  if (f.jsxCalls === 0 && f.snapshotSubscriptions === 0 && f.useState === 0) continue;
  console.log(pad(f.name, 26) + pad(f.startLine + '-' + f.endLine, 14) + pad(f.jsxTags.length, 6) + pad(f.jsxCalls, 9) + pad(f.maps, 6) + pad(f.reactMemo, 6) + pad(f.useMemo, 9) + pad(f.useState, 9) + pad(f.useEffect, 10) + pad(f.useSyncExternalStore + '/' + f.snapshotSubscriptions, 6));
}
console.log('\n=== GLOBAL ===');
console.log(JSON.stringify(globals, null, 1));
console.log('\n=== JSX tag histogram, DOM-building components ===');
for (const f of facts) {
  if (f.jsxTags.length === 0) continue;
  const h = {};
  for (const t of f.jsxTags) h[t] = (h[t] || 0) + 1;
  console.log(pad(f.name, 26), JSON.stringify(Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v)));
}

fs.writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab/raw/structure-facts.json', JSON.stringify({ globals, components: facts }, null, 1));
console.log('\nwritten raw/structure-facts.json');
