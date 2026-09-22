#!/usr/bin/env node
// Read-only ASAR import-graph BFS + capability scan.
//
// Starting from entry members (the pet/tray/ripple UI bundles), follows static
// ESM relative imports (`from"./x.js"`) to a bounded depth, and reports, for
// every reachable member, whether it contains canvas/WebGL/WebGPU constructs.
//
// The archive is opened read-only ('r'); nothing is written back to it.
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const ASAR = '/usr/lib/chatgpt/resources/app.asar';
const TSV = path.join(HERE, 'raw', 'asar_members.tsv');

const entriesReq = process.argv.slice(2);
const MAXNODES = 4000;
const MAXDEPTH = 12;

// ---- load index ------------------------------------------------------------
const raw = fs.readFileSync(TSV, 'utf8').split('\n').slice(1);
const members = new Map();
for (const line of raw) {
  if (!line) continue;
  const [p, s, o, u] = line.split('\t');
  if (u === '1') continue;
  members.set(p, { off: Number(o), size: Number(s) });
}

const fd = fs.openSync(ASAR, 'r');
function readMember(p) {
  const m = members.get(p);
  if (!m) return null;
  const buf = Buffer.alloc(m.size);
  fs.readSync(fd, buf, 0, m.size, m.off);
  return buf;
}

const PROBES = [
  ['getContext', /getContext\s*\(/g],
  ['ctx2d', /getContext\s*\(\s*[`'"]2d[`'"]/g],
  ['ctx-webgl', /getContext\s*\(\s*[`'"](webgl2?|experimental-webgl)[`'"]/g],
  ['ctx-webgpu', /getContext\s*\(\s*[`'"]webgpu[`'"]/g],
  ['webgl-literal', /webgl/gi],
  ['webgpu-literal', /webgpu|GPUCanvasContext|requestAdapter/gi],
  ['WebGLRenderingContext', /WebGLRenderingContext|WebGL2RenderingContext/g],
  ['canvas-elem', /createElement\s*\(\s*[`'"]canvas[`'"]|createElementNS\s*\([^)]*canvas/gi],
  ['OffscreenCanvas', /OffscreenCanvas/g],
  ['texImage2D', /texImage2D/g],
];

const seen = new Set();
const queue = [];
for (const e of entriesReq) queue.push([e, 0]);
const results = new Map();

while (queue.length && results.size < MAXNODES) {
  const [p, depth] = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  if (!members.has(p)) {
    results.set(p, { missing: true, depth });
    continue;
  }
  let src;
  try {
    src = readMember(p).toString('utf8');
  } catch (e) {
    results.set(p, { unreadable: true, depth });
    continue;
  }
  const hits = {};
  for (const [name, rx] of PROBES) {
    const m = src.match(rx);
    if (m && m.length) hits[name] = m.length;
  }
  results.set(p, { hits, depth, size: members.get(p).size });

  if (depth >= MAXDEPTH) continue;
  const dir = p.slice(0, p.lastIndexOf('/'));
  const importRe = /(?:from|import)\s*\(?\s*[`'"](\.[^`'"]+)[`'"]/g;
  let mm;
  while ((mm = importRe.exec(src))) {
    let dep = mm[1];
    if (dep.startsWith('./')) dep = dir + '/' + dep.slice(2);
    else if (dep.startsWith('../')) {
      dep = path.posix.normalize(dir + '/' + dep);
    } else continue;
    if (!seen.has(dep)) queue.push([dep, depth + 1]);
  }
}

// ---- report ----------------------------------------------------------------
const cap = [];
for (const [p, r] of results) {
  if (r.hits && Object.keys(r.hits).length) cap.push([p, r]);
}
console.log(`=== nodes visited: ${seen.size} (results ${results.size}) ===`);
console.log(`=== nodes with canvas/GL constructs: ${cap.length} ===`);
for (const [p, r] of cap.sort()) {
  console.log(`  d${r.depth} ${p}  size=${r.size}`);
  console.log(`      ${JSON.stringify(r.hits)}`);
}
fs.closeSync(fd);
