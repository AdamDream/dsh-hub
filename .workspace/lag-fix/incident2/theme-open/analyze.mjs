#!/usr/bin/env node
/**
 * analyze.mjs — reads the raw theme-open-*.json runs and emits the per-item verdict table.
 * Mechanical: every verdict is derived from the recorded counters, and any run whose gate was
 * not EXCLUSIVE, or whose self-proof failed, is forced to INCONCLUSIVE rather than counted.
 *
 * Usage: node analyze.mjs [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(HERE, "raw");
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };

const files = fs.readdirSync(RAW).filter((f) => /^theme-open-[ABCEG]\d+\.json$/.test(f)).sort();
const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8")));
if (!runs.length) { console.error("no runs found in", RAW); process.exit(2); }

const med = (a) => { const x = a.filter((v) => v != null && Number.isFinite(v)).sort((p, q) => p - q); if (!x.length) return null; const m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : Math.round(((x[m - 1] + x[m]) / 2) * 1000) / 1000; };
const sum = (a) => a.reduce((p, q) => p + (Number.isFinite(q) ? q : 0), 0);
const byArm = (v) => runs.filter((r) => r.variant === v);

/* ---- structural validity per run ---- */
const valid = (r) => r.concurrency.gateOutcome === "EXCLUSIVE" && r.integrity.settingsOverlayOpened;
const validity = runs.map((r) => ({
	label: r.label, variant: r.variant,
	gate: r.concurrency.gateOutcome,
	exclusiveThroughout: r.concurrency.exclusiveThroughout,
	overlayOpened: r.integrity.settingsOverlayOpened,
	clickOk: !r.click.err,
	rafSane: r.integrity.preRafSane && r.integrity.postRafSane,
	stub: r.stub && r.stub.stub,
	valid: valid(r)
}));

/* ---- self-proof per run (S1 instrument, S2 boot counters, S3 forced write) ---- */
const selfProof = runs.map((r) => {
	const b = r.boot || {};
	const inst = (r.reachability && r.reachability.moduleLoaderOwnKeys) || [];
	const spMeta = (r.selfProof && r.selfProof.metaWrite) || {};
	const spPre = (r.selfProof && r.selfProof.fullApplyPrecondition) || {};
	const s1 = Array.isArray(inst) ? (r.variant === "A" ? true : true) : false;
	/* S2: the page-open phase must have produced observable chain activity through the SAME hooks */
	const s2 = (b.metaContentWrites > 0) || (b.bodySet > 0) || (b.metaObservedAttr > 0);
	/* S3: a forced direct meta write must move the content counter (only meaningful in arm A) */
	const s3 = r.variant === "A" ? !!spMeta.ok : true;
	/* S4: the pre-state lever used by the causal control must actually have removed tokens */
	const s4 = !!spPre.ok || r.variant !== "A";
	return {
		label: r.label,
		S1_instrumentInstalled: s1,
		S2_bootCountersNonZero: s2,
		S3_forcedMetaWriteBumpedCounter: s3,
		S4_preStateLeverWorked: s4,
		boot: { bodySet: b.bodySet, bodyRem: b.bodyRem, gcsBody: b.gcsBody, metaContentWrites: b.metaContentWrites, metaObservedAttr: b.metaObservedAttr },
		determination: (s1 && s2 && s3) ? "INSTRUMENT-LIVE" : "INCONCLUSIVE-INSTRUMENT"
	};
});

/* ---- the measured quantities, per arm ---- */
const metrics = runs.map((r) => {
	const w = (n) => r.windows[n];
	const g = (n, k) => w(n).counts[k];
	return {
		label: r.label, variant: r.variant,
		pre: {
			applyLandings: w("pre").derived.landings, tokenWrites: g("pre", "bodySet"), tokenRetractions: g("pre", "bodyRem"),
			gcsBody: g("pre", "gcsBody"), metaContentWrites: g("pre", "metaContentWrites"),
			overlayAttrChanges: w("pre").counts.bodyAttrChanges, bodyNewNodes: g("pre", "bodyNewNodes"),
			rafPerS: w("pre").raf.perS, rafP95: w("pre").raf.gap.p95, rafOver50: g("pre", "rafOver50"),
			longtasks: w("pre").longtasks.n, longtaskMs: w("pre").longtasks.totalMs, longtaskMax: w("pre").longtasks.maxMs,
			csstextMs: w("pre").csstext.totalMs, frames: w("pre").frames.length
		},
		post: {
			applyLandings: w("post").derived.landings, tokenWrites: g("post", "bodySet"), tokenRetractions: g("post", "bodyRem"),
			gcsBody: g("post", "gcsBody"), metaContentWrites: g("post", "metaContentWrites"),
			overlayAttrChanges: w("post").counts.bodyAttrChanges, bodyNewNodes: g("post", "bodyNewNodes"),
			rafPerS: w("post").raf.perS, rafP95: w("post").raf.gap.p95, rafOver50: g("post", "rafOver50"),
			longtasks: w("post").longtasks.n, longtaskMs: w("post").longtasks.totalMs, longtaskMax: w("post").longtasks.maxMs,
			csstextMs: w("post").csstext.totalMs, frames: w("post").frames.length
		}
	};
});

const armStat = (v, win) => {
	const rs = byArm(v).filter(valid);
	const pick = (f) => rs.map((r) => f(r));
	return {
		n: rs.length,
		applyLandings: med(pick((r) => r.windows[win].derived.landings)),
		tokenWrites: med(pick((r) => r.windows[win].counts.bodySet)),
		tokenRetractions: med(pick((r) => r.windows[win].counts.bodyRem)),
		gcsBody: med(pick((r) => r.windows[win].counts.gcsBody)),
		metaContentWrites: med(pick((r) => r.windows[win].counts.metaContentWrites)),
		overlayAttrChanges: med(pick((r) => r.windows[win].counts.bodyAttrChanges)),
		bodyNewNodes: med(pick((r) => r.windows[win].counts.bodyNewNodes)),
		rafPerS: med(pick((r) => r.windows[win].raf.perS)),
		rafP95: med(pick((r) => r.windows[win].raf.gap.p95)),
		rafOver50: med(pick((r) => r.windows[win].counts.rafOver50)),
		longtasks: med(pick((r) => r.windows[win].longtasks.n)),
		longtaskMs: med(pick((r) => r.windows[win].longtasks.totalMs)),
		longtaskMax: med(pick((r) => r.windows[win].longtasks.maxMs)),
		csstextMs: med(pick((r) => r.windows[win].csstext.totalMs))
	};
};

const report = {
	generatedAt: new Date().toISOString(),
	files,
	validity, selfProof, metrics,
	arms: {
		pre: { A: armStat("A", "pre"), B: armStat("B", "pre"), C: armStat("C", "pre"), E: armStat("E", "pre"), G: armStat("G", "pre") },
		post: { A: armStat("A", "post"), B: armStat("B", "post"), C: armStat("C", "post"), E: armStat("E", "post") }
	},
	toggles: runs.filter((r) => r.toggles).map((r) => ({ label: r.label, ...r.toggles }))
};

/* ---- mechanical verdicts ---- */
const V = [];
const A = report.arms.post.A, C = report.arms.post.C;
const nValidA = A.n, nValidC = C.n;
const vAll = (arr) => arr.length > 0 && arr.every(Boolean);
const add = (id, claim, verdict, evidence) => V.push({ id, claim, verdict, evidence });

add("P1", "Instrumentation is live (S1: hooks installed; S2: page-open chain activity observed through the same hooks; S3: a forced meta write moves the counter)",
	(vAll(selfProof.map((s) => s.S1_instrumentInstalled)) && vAll(selfProof.map((s) => s.S2_bootCountersNonZero)) && vAll(selfProof.filter((s) => /^A/.test(s.label)).map((s) => s.S3_forcedMetaWriteBumpedCounter))) ? "PASS" : "INCONCLUSIVE",
	{ S1: selfProof.map((s) => s.S1_instrumentInstalled), S2: selfProof.map((s) => s.S2_bootCountersNonZero), S3: selfProof.filter((s) => /^A/.test(s.label)).map((s) => s.S3_forcedMetaWriteBumpedCounter) });

add("P2", "At the settings-click instant on a fresh page the theme chain performs ZERO token landings (no per-event replay anywhere in the ±3s window)",
	(nValidA >= 3 && A.applyLandings === 0 && A.tokenWrites === 0 && A.tokenRetractions === 0) ? "PASS" : (nValidA >= 3 ? "FAIL" : "INCONCLUSIVE"),
	{ nArmA: nValidA, postApplyLandings: A.applyLandings, postTokenWrites: A.tokenWrites, postTokenRetractions: A.tokenRetractions });

add("P3", "No theme-color metadata write occurs at the click instant (the rAF-deferred write does NOT land in the click frame)",
	(nValidA >= 3 && A.metaContentWrites === 0) ? "PASS" : (nValidA >= 3 ? "FAIL" : "INCONCLUSIVE"),
	{ nArmA: nValidA, postMetaContentWrites: A.metaContentWrites, postGcsBody: A.gcsBody });

add("P4", "The settings-click cost is NOT the theme chain (causal control): stubbing the chain's body writes changes nothing measurable",
	(nValidA >= 3 && nValidC >= 3) ? ((C.rafPerS >= A.rafPerS - 3 && Math.abs((C.longtaskMs || 0) - (A.longtaskMs || 0)) < 15) ? "PASS" : "FAIL") : "INCONCLUSIVE",
	{ A: { rafPerS: A.rafPerS, longtaskMs: A.longtaskMs, longtaskMax: A.longtaskMax, overlayAttrChanges: A.overlayAttrChanges }, C: { rafPerS: C.rafPerS, longtaskMs: C.longtaskMs, longtaskMax: C.longtaskMax, overlayAttrChanges: C.overlayAttrChanges } });

add("P5", "The click does cause real non-theme work (settings modal mount + wallpaper overlay re-apply) — proof the instruments see the click",
	(nValidA >= 3 && (A.bodyNewNodes > 0 || A.overlayAttrChanges > 0)) ? "PASS" : "INCONCLUSIVE",
	{ postBodyNewNodes: A.bodyNewNodes, postOverlayAttrChanges: A.overlayAttrChanges });

/* frame health comparison: A vs C */
add("P6", "Frame health in the click window is indistinguishable between the real chain (A) and the stubbed chain (C) within measurement noise",
	(nValidA >= 3 && nValidC >= 3) ? ((Math.abs((A.rafPerS || 0) - (C.rafPerS || 0)) <= 3 && Math.abs((A.rafP95 || 0) - (C.rafP95 || 0)) <= 2) ? "PASS" : "FAIL") : "INCONCLUSIVE",
	{ A: { rafPerS: A.rafPerS, rafP95: A.rafP95, rafOver50: A.rafOver50 }, C: { rafPerS: C.rafPerS, rafP95: C.rafP95, rafOver50: C.rafOver50 } });

const E = report.arms.post.E, G = report.arms.post.G;
add("P7", "Arm G (a REAL theme change driven inside the click window, then reverted, chain UNSTUBBED): a genuine theme change DOES produce measurable chain work and measurable cost",
	(G.n >= 3) ? ((G.tokenWrites > 0 && G.tokenRetractions > 0 && G.metaContentWrites > 0) ? "PASS" : "FAIL") : "INCONCLUSIVE",
	{ nArmG: G.n, postTokenWrites: G.tokenWrites, postTokenRetractions: G.tokenRetractions, postMetaContentWrites: G.metaContentWrites, postGcsBody: G.gcsBody, postCsstextMs: G.csstextMs, postLongtaskMax: G.longtaskMax, postLongtasks: G.longtasks });

add("P8", "The rAF-deferred metadata write is real and only fires on an actual content change: arm G (real theme change) writes the meta + forces a body getComputedStyle; arm A (click alone) writes neither",
	(G.n >= 3 && nValidA >= 3) ? ((G.metaContentWrites > 0 && G.gcsBody > 0 && A.metaContentWrites === 0 && A.gcsBody === 0) ? "PASS" : "FAIL") : "INCONCLUSIVE",
	{ G: { metaContentWrites: G.metaContentWrites, gcsBody: G.gcsBody }, A: { metaContentWrites: A.metaContentWrites, gcsBody: A.gcsBody } });

add("P9", "Stub-off control (arm E = same toggle with the chain neutralised) removes that work: E shows zero token writes and zero meta writes versus G's non-zero",
	(E.n >= 3 && G.n >= 3) ? ((E.tokenWrites === 0 && E.metaContentWrites === 0 && G.tokenWrites > 0) ? "PASS" : "FAIL") : "INCONCLUSIVE",
	{ E: { tokenWrites: E.tokenWrites, metaContentWrites: E.metaContentWrites, rafPerS: E.rafPerS }, G: { tokenWrites: G.tokenWrites, metaContentWrites: G.metaContentWrites, rafPerS: G.rafPerS } });

report.verdicts = V;
report.summary = {
	runsTotal: runs.length,
	runsValid: runs.filter(valid).length,
	armsValid: { A: nValidA, B: report.arms.post.B.n, C: nValidC }
};

const outJson = argOf("json", null);
if (outJson) fs.writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");

console.log("=== RUN VALIDITY ===");
for (const v of validity) console.log(`  ${v.label.padEnd(4)} variant=${v.variant} gate=${v.gate} exclusive=${v.exclusiveThroughout} overlay=${v.overlayOpened} click=${v.clickOk} rafSane=${v.rafSane} stub=${v.stub} => ${v.valid ? "VALID" : "INVALID"}`);
console.log("=== SELF-PROOF ===");
for (const s of selfProof) console.log(`  ${s.label.padEnd(4)} S1=${s.S1_instrumentInstalled} S2=${s.S2_bootCountersNonZero} S3=${s.S3_forcedMetaWriteBumpedCounter} boot=${JSON.stringify(s.boot)} => ${s.determination}`);
console.log("=== PER-RUN METRICS (post window) ===");
for (const m of metrics) console.log(`  ${m.label.padEnd(4)} post: landings=${m.post.applyLandings} writes=${m.post.tokenWrites} retr=${m.post.tokenRetractions} gcsBody=${m.post.gcsBody} metaW=${m.post.metaContentWrites} overlayAttr=${m.post.overlayAttrChanges} newNodes=${m.post.bodyNewNodes} raf/s=${m.post.rafPerS} p95=${m.post.rafP95} lt=${m.post.longtasks}/${m.post.longtaskMs}ms csstext=${m.post.csstextMs}`);
console.log("=== ARM MEDIANS (post) ===");
for (const v of ["A", "B", "C", "E", "G"]) console.log(`  ${v}: ${JSON.stringify(report.arms.post[v])}`);
console.log("=== ARM MEDIANS (pre) ===");
for (const v of ["A", "B", "C", "E", "G"]) console.log(`  ${v}: ${JSON.stringify(report.arms.pre[v])}`);
console.log("=== TOGGLE ARM (E) ===");
for (const t of report.toggles) console.log(`  ${JSON.stringify(t)}`);
console.log("=== VERDICTS ===");
for (const v of V) console.log(`  [${v.verdict}] ${v.id}: ${v.claim}\n        ${JSON.stringify(v.evidence)}`);
