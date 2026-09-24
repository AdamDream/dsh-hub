/*
 * pixdiff.mjs — appearance-equivalence evidence for the exec-mask candidate.
 *
 * Decodes the PNG screenshots taken by tools/panel-compare.mjs (see
 * png-read.mjs; no pngjs/sharp available on this box) and reports, per pair:
 *   - per-channel mean / median / max absolute delta
 *   - p99 / max of the per-pixel max-channel delta (exact, via 256-bin histograms)
 *   - fraction of pixels with any channel delta > 2/255, > 8/255, > 32/255
 *   - WHERE those pixels are: inside the panel rect (opaque dialog), inside the
 *     core of it, in the thin edge band, or outside it (the dimmed margin)
 *   - an 8x8 spatial grid of the >2/255 pixels
 * The panel rect comes from getBoundingClientRect() recorded at shot time
 * (CSS px) multiplied by the shot's device scale factor.
 *
 * Pairs compared:
 *   normal vs patch    (the candidate's own pixel cost)
 *   normal vs normal2  (NULL CONTROL: two unpatched arms -> noise floor)
 *
 * usage: node pixdiff.mjs --raw <runner.json> [--raw ...] --out <pixdiff.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png-read.mjs';

const argv = process.argv.slice(2);
const argAll = (n) => argv.reduce((a, v, i) => (v === n && argv[i + 1] ? a.concat([argv[i + 1]]) : a), []);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const RAWS = argAll('--raw');
const OUT = argOf('--out', null);
if (!RAWS.length) { console.error('usage: pixdiff.mjs --raw <runner.json> [...] --out <out.json>'); process.exit(2); }

const q = (hist, total, p) => { if (!total) return null; const target = p * total; let acc = 0; for (let d = 0; d < hist.length; d++) { acc += hist[d]; if (acc >= target) return d; } return hist.length - 1; };
const mean = (hist, total) => { if (!total) return null; let s = 0; for (let d = 0; d < hist.length; d++) s += d * hist[d]; return Math.round((s / total) * 10000) / 10000; };

function diffPair(aFile, bFile, panelCss, dsf) {
  const A = decodePNG(fs.readFileSync(aFile));
  const B = decodePNG(fs.readFileSync(bFile));
  if (A.width !== B.width || A.height !== B.height) throw new Error(`size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  const W = A.width, H = A.height, N = W * H;
  const pr = panelCss ? { x: panelCss.x * dsf, y: panelCss.y * dsf, w: panelCss.w * dsf, h: panelCss.h * dsf } : null;
  const inRect = (x, y, r) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const prCore = pr ? { x: pr.x + 16, y: pr.y + 16, w: Math.max(0, pr.w - 32), h: Math.max(0, pr.h - 32) } : null;

  const ch = ['r', 'g', 'b', 'a'].map(() => ({ hist: new Float64Array(256), sum: 0, max: 0 }));
  const maxHist = new Float64Array(256);          // per-pixel max-channel delta
  const gt = { gt0: 0, gt2: 0, gt8: 0, gt32: 0 };
  // mutually exclusive regions: core of the opaque panel / its thin edge band / the dimmed margin
  const REG = ['insideCore', 'edgeBand', 'outsidePanel'];
  const loc = { insideCore: 0, edgeBand: 0, outsidePanel: 0 };
  const locGt2 = { insideCore: 0, edgeBand: 0, outsidePanel: 0 };
  const locGt8 = { insideCore: 0, edgeBand: 0, outsidePanel: 0 };
  const locSum = { insideCore: 0, edgeBand: 0, outsidePanel: 0 };   // sum of per-pixel max-channel delta
  const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const gridTot = Array.from({ length: 8 }, () => new Array(8).fill(0));
  let bbox = null;
  let sumMax = 0, maxMax = 0;

  for (let y = 0; y < H; y++) {
    const gy = Math.min(7, (y * 8 / H) | 0);
    const rowIn = pr ? (y >= pr.y && y < pr.y + pr.h) : false;
    const rowCore = prCore ? (y >= prCore.y && y < prCore.y + prCore.h) : false;
    let ia = y * W * 4;
    for (let x = 0; x < W; x++, ia += 4) {
      const d0 = Math.abs(A.data[ia] - B.data[ia]);
      const d1 = Math.abs(A.data[ia + 1] - B.data[ia + 1]);
      const d2 = Math.abs(A.data[ia + 2] - B.data[ia + 2]);
      const d3 = Math.abs(A.data[ia + 3] - B.data[ia + 3]);
      const ds = [d0, d1, d2, d3];
      for (let c = 0; c < 4; c++) { ch[c].hist[ds[c]]++; ch[c].sum += ds[c]; if (ds[c] > ch[c].max) ch[c].max = ds[c]; }
      const dm = Math.max(d0, d1, d2, d3);
      maxHist[dm]++; sumMax += dm; if (dm > maxMax) maxMax = dm;
      if (dm > 0) gt.gt0++;
      if (dm > 2) gt.gt2++;
      if (dm > 8) gt.gt8++;
      if (dm > 32) gt.gt32++;
      const inP = rowIn && x >= pr.x && x < pr.x + pr.w;
      const inC = rowCore && x >= prCore.x && x < prCore.x + prCore.w;
      const reg = inC ? 'insideCore' : (inP ? 'edgeBand' : 'outsidePanel');
      loc[reg]++;
      locSum[reg] += dm;
      if (dm > 2) locGt2[reg]++;
      if (dm > 8) locGt8[reg]++;
      const gx = Math.min(7, (x * 8 / W) | 0);
      gridTot[gy][gx]++;
      if (dm > 2) {
        grid[gy][gx]++;
        if (!bbox) bbox = { x0: x, y0: y, x1: x, y1: y };
        else { if (x < bbox.x0) bbox.x0 = x; if (x > bbox.x1) bbox.x1 = x; if (y < bbox.y0) bbox.y0 = y; if (y > bbox.y1) bbox.y1 = y; }
      }
    }
  }
  const pct = (n) => Math.round((n / N) * 1e6) / 1e4; // percent with 4 decimals
  return {
    a: aFile, b: bFile, w: W, h: H, pixels: N, dsf,
    panelRectDev: pr ? { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.w), h: Math.round(pr.h) } : null,
    identical: gt.gt0 === 0,
    perChannel: { r: { meanAbs: mean(ch[0].hist, N), medianAbs: q(ch[0].hist, N, 0.5), maxAbs: ch[0].max },
                  g: { meanAbs: mean(ch[1].hist, N), medianAbs: q(ch[1].hist, N, 0.5), maxAbs: ch[1].max },
                  b: { meanAbs: mean(ch[2].hist, N), medianAbs: q(ch[2].hist, N, 0.5), maxAbs: ch[2].max },
                  a: { meanAbs: mean(ch[3].hist, N), medianAbs: q(ch[3].hist, N, 0.5), maxAbs: ch[3].max } },
    maxChannelDelta: { mean: Math.round((sumMax / N) * 10000) / 10000, p50: q(maxHist, N, 0.5), p90: q(maxHist, N, 0.9),
                       p99: q(maxHist, N, 0.99), p999: q(maxHist, N, 0.999), max: maxMax },
    frac: { gt0: pct(gt.gt0), gt2: pct(gt.gt2), gt8: pct(gt.gt8), gt32: pct(gt.gt32) },
    counts: { gt2: gt.gt2, gt8: gt.gt8, gt32: gt.gt32, pixels: N },
    where: {
      pixelSharePct: { insideCore: pct(loc.insideCore), edgeBand: pct(loc.edgeBand), outsidePanel: pct(loc.outsidePanel) },
      gt2ShareOfAllPct: { insideCore: pct(locGt2.insideCore), edgeBand: pct(locGt2.edgeBand), outsidePanel: pct(locGt2.outsidePanel) },
      gt2Counts: locGt2,
      gt8Counts: locGt8,
      meanMaxChannelDeltaByRegion: { insideCore: Math.round((locSum.insideCore / Math.max(1, loc.insideCore)) * 1e4) / 1e4,
                                     edgeBand: Math.round((locSum.edgeBand / Math.max(1, loc.edgeBand)) * 1e4) / 1e4,
                                     outsidePanel: Math.round((locSum.outsidePanel / Math.max(1, loc.outsidePanel)) * 1e4) / 1e4 },
      gt2PctWithinRegion: { insideCore: Math.round((locGt2.insideCore / Math.max(1, loc.insideCore)) * 1e6) / 1e4,
                            edgeBand: Math.round((locGt2.edgeBand / Math.max(1, loc.edgeBand)) * 1e6) / 1e4,
                            outsidePanel: Math.round((locGt2.outsidePanel / Math.max(1, loc.outsidePanel)) * 1e6) / 1e4 },
      regionPixelCounts: loc,
      gt2BBoxDev: bbox,
      grid8x8Gt2Counts: grid,
      grid8x8Gt2PctOfCell: grid.map((row, i) => row.map((v, j) => Math.round((v / Math.max(1, gridTot[i][j])) * 1e4) / 100)),
    },
  };
}

// --------------------------------------------------------------------- main
const pairs = [];
const skipped = [];
const duplicates = [];      // same (aFile,bFile) already compared: the shot
                            // filename did not carry the invocation stamp, so an
                            // earlier invocation's PNGs were overwritten and the
                            // later ones repeat the same file pair.
const seenFilePairs = new Set();
for (const rf of RAWS) {
  const j = JSON.parse(fs.readFileSync(rf, 'utf8'));
  const byArm = {};
  for (const rep of j.reps || []) {
    const arm = rep.arm || 'normal';
    if (!rep.shotMeta) continue;
    for (const [name, meta] of Object.entries(rep.shotMeta)) {
      byArm[arm] = byArm[arm] || {};
      byArm[arm][`${rep.rep}|${name}`] = meta;
    }
  }
  const mk = (aArm, bArm, kind) => {
    for (const [key, ma] of Object.entries(byArm[aArm] || {})) {
      const mb = (byArm[bArm] || {})[key];
      if (!mb) { skipped.push({ raw: rf, key, kind, reason: `no ${bArm} shot` }); continue; }
      const fp = `${ma.file}|${mb.file}`;
      if (seenFilePairs.has(fp)) { duplicates.push({ raw: rf, kind, shot: key.split('|')[1], rep: Number(key.split('|')[0]), a: ma.file, b: mb.file, note: 'identical file pair already counted (shot files were overwritten by a later invocation)' }); continue; }
      try {
        const d = diffPair(ma.file, mb.file, ma.panel, ma.dsf);
        seenFilePairs.add(fp);
        pairs.push(Object.assign({ raw: rf, run: j.run, kind, shot: key.split('|')[1], rep: Number(key.split('|')[0]),
                                   viewport: j.viewport, viewportDsf: j.dsf,
                                   maskStyleA: { arm: aArm, backdropFilter: ma.maskBackdropFilter, background: ma.maskBackground, backgroundColor: ma.maskBackgroundColor, activeNav: ma.activeNav, activeTab: ma.activeTab, scrollTops: ma.scrollTops },
                                   maskStyleB: { arm: bArm, backdropFilter: mb.maskBackdropFilter, background: mb.maskBackground, backgroundColor: mb.maskBackgroundColor, activeNav: mb.activeNav, activeTab: mb.activeTab, scrollTops: mb.scrollTops },
                                   stateMatch: { nav: ma.activeNav === mb.activeNav, tab: ma.activeTab === mb.activeTab, scroll: JSON.stringify(ma.scrollTops) === JSON.stringify(mb.scrollTops), panel: JSON.stringify(ma.panel) === JSON.stringify(mb.panel) } }, d));
      } catch (e) { skipped.push({ raw: rf, key, kind, reason: String(e).split('\n')[0] }); }
    }
  };
  mk('normal', 'patch', 'normal-vs-patch');
  mk('normal', 'normal2', 'null-control-normal-vs-normal2');
  mk('patch', 'normal2', 'patch-vs-normal2');
}
const out = { generatedAt: new Date().toISOString(), raws: RAWS, pairCount: pairs.length, distinctFilePairs: seenFilePairs.size, skipped, duplicates, pairs };
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); }
console.log(`pixdiff: ${pairs.length} pairs from ${seenFilePairs.size} DISTINCT file pairs (${duplicates.length} duplicate file-pair comparisons suppressed), ${skipped.length} skipped` + (OUT ? ` -> ${OUT}` : ''));
for (const p of pairs) {
  console.log(`  ${p.run} ${p.kind} rep${p.rep} ${p.shot}: identical=${p.identical} mean=${p.maxChannelDelta.mean} p99=${p.maxChannelDelta.p99} max=${p.maxChannelDelta.max} gt2=${p.frac.gt2}% gt8=${p.frac.gt8}% outsideGt8=${p.where.gt8Counts.outsidePanel} insideGt8=${p.where.gt8Counts.insideCore + p.where.gt8Counts.edgeBand} stateMatch=${JSON.stringify(p.stateMatch)} A=${p.maskStyleA.backdropFilter} B=${p.maskStyleB.backdropFilter}`);
}
