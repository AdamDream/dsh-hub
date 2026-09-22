#!/usr/bin/env node
/*
 * summarize-loadcurve.mjs — Blink vs Gecko frame delivery as a function of
 * rAF-locked main-thread load per frame. Both engines run identical code; the
 * only difference is the engine. Reports, per load level: frames delivered,
 * frame-interval p50/p95/max, and per-frame JS self-time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const RAW = path.join(ROOT, 'raw');

const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { return null; } };
const chrom = load('loadcurve-chromium-dpr1-combined.json');
const gecko = load('loadcurve-firefox-dpr1-combined.json');
if (!chrom || !gecko) { console.log('loadcurve files missing'); process.exit(0); }

const byLevel = (rep) => {
  const m = new Map();
  for (const l of rep.levels) {
    const k = l.levelMs;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(l);
  }
  return m;
};
const agg = (arr, f) => {
  const v = arr.map(f).filter((x) => x != null && !Number.isNaN(x));
  if (!v.length) return null;
  return +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
};

const c = byLevel(chrom), g = byLevel(gecko);
const levels = [...new Set([...c.keys(), ...g.keys()])].sort((a, b) => a - b);

console.log('# Frame delivery vs rAF-locked per-frame load (passes averaged; identical injected code both engines)\n');
console.log('| load/frame (ms) | frames Blink | frames Gecko | Gecko/Blink | p50 Blink | p50 Gecko | p95 Blink | p95 Gecko | max Blink | max Gecko | rafJs mean Blink | rafJs mean Gecko |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
const rows = [];
for (const L of levels) {
  const ca = c.get(L) || [], ga = g.get(L) || [];
  const row = {
    levelMs: L,
    framesBlink: agg(ca, (x) => x.frames), framesGecko: agg(ga, (x) => x.frames),
    p50Blink: agg(ca, (x) => x.intervalStats.p50), p50Gecko: agg(ga, (x) => x.intervalStats.p50),
    p95Blink: agg(ca, (x) => x.intervalStats.p95), p95Gecko: agg(ga, (x) => x.intervalStats.p95),
    maxBlink: agg(ca, (x) => x.intervalStats.max), maxGecko: agg(ga, (x) => x.intervalStats.max),
    rafJsBlink: agg(ca, (x) => x.rafJs && x.rafJs.meanMs), rafJsGecko: agg(ga, (x) => x.rafJs && x.rafJs.meanMs),
    tickBlink: agg(ca, (x) => x.tick && x.tick.meanMs), tickGecko: agg(ga, (x) => x.tick && x.tick.meanMs),
  };
  row.framesRatio = row.framesBlink && row.framesGecko ? +(row.framesGecko / row.framesBlink).toFixed(3) : null;
  rows.push(row);
  console.log(`| ${L} | ${row.framesBlink} | ${row.framesGecko} | ${row.framesRatio} | ${row.p50Blink} | ${row.p50Gecko} | ${row.p95Blink} | ${row.p95Gecko} | ${row.maxBlink} | ${row.maxGecko} | ${row.rafJsBlink} | ${row.rafJsGecko} |`);
}

const out = {
  schema: 'gvb.loadcurve-summary/1',
  generatedAt: new Date().toISOString(),
  blink: { version: chrom.version, url: chrom.url, levels: chrom.levels.length },
  gecko: { version: gecko.version, url: gecko.url, levels: gecko.levels.length },
  rows,
};
fs.writeFileSync(path.join(RAW, 'loadcurve-summary.json'), JSON.stringify(out, null, 1));
console.log('\n-> ' + path.join(RAW, 'loadcurve-summary.json'));
