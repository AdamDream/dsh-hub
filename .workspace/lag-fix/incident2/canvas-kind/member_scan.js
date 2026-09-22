#!/usr/bin/env node
// Read-only capability scan of selected ASAR members.
// Usage: member_scan.js <regex-on-member-path> ...
// Prints per-member counts of canvas/WebGL/WebGPU constructs. Archive opened 'r'.
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ASAR = '/usr/lib/chatgpt/resources/app.asar';
const TSV = path.join(HERE, 'raw', 'asar_members.tsv');

const pats = process.argv.slice(2).map((s) => new RegExp(s));
const raw = fs.readFileSync(TSV, 'utf8').split('\n').slice(1);
const rows = [];
for (const line of raw) {
  if (!line) continue;
  const [p, s, o, u] = line.split('\t');
  if (u === '1' || s === '0') continue;
  if (pats.some((rx) => rx.test(p))) rows.push({ p, size: +s, off: +o });
}

const fd = fs.openSync(ASAR, 'r');
const PROBES = {
  getContext: /getContext\s*\(/g,
  ctx2d: /getContext\s*\(\s*[`'"]2d[`'"]/g,
  'ctx-webgl': /getContext\s*\(\s*[`'"](webgl2?|experimental-webgl)[`'"]/g,
  'ctx-webgpu': /getContext\s*\(\s*[`'"]webgpu[`'"]/g,
  webgl: /webgl/gi,
  webgpup: /webgpu|GPUCanvasContext|requestAdapter/gi,
  canvasElem: /createElement\s*\(\s*[`'"]canvas[`'"]/gi,
  OffscreenCanvas: /OffscreenCanvas/g,
  texImage2D: /texImage2D/g,
  rAF: /requestAnimationFrame/g,
};

let any = 0;
const out = [];
for (const r of rows.sort((a, b) => b.size - a.size)) {
  if (r.size > 40 << 20) {
    out.push(`SKIP-BIG ${r.p} (${r.size})`);
    continue;
  }
  const buf = Buffer.alloc(r.size);
  fs.readSync(fd, buf, 0, r.size, r.off);
  const src = buf.toString('utf8');
  const hits = {};
  for (const [k, rx] of Object.entries(PROBES)) {
    const m = src.match(rx);
    if (m && m.length) hits[k] = m.length;
  }
  const gl = ['ctx-webgl', 'ctx-webgpu', 'webgl', 'webgpup', 'WebGLRenderingContext'].filter(
    (k) => hits[k],
  );
  if (gl.length) any++;
  out.push(
    `${gl.length ? 'GL!!  ' : 'clean '} ${String(r.size).padStart(9)}  ${r.p}\n        ${JSON.stringify(hits)}`,
  );
}
console.log(`=== matched members: ${rows.length}; members containing GL/WebGPU constructs: ${any} ===`);
console.log(out.join('\n'));
fs.closeSync(fd);
