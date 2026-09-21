#!/usr/bin/env node
/**
 * proof/check-experiment-logic.mjs — exercise the experiment harnesses WITHOUT a browser.
 *
 *   X1   every experiment script passes its syntax check;
 *   X1b  every page-side hook is declared AND handed to the page;
 *   X2   `theme-ab.mjs --compare` REJECTS a post-fix run that keeps the baseline numbers —
 *        the verdict logic must be able to fail, or a PASS means nothing;
 *   X3a  ACCEPTS a synthetic post-fix run that meets every PRIMARY criterion;
 *   X3b  rejects windows differing by more than 5% in DOM node count;
 *   X3c  rejects a degraded `rafP50` (the "nothing broke" sentinel);
 *   X3d  rejects a surviving presenter instance (P0 requires 1);
 *   X3e  does NOT enforce the contaminated-batch RecalcStyle/Task by default, and X3e' DOES
 *        enforce it with --enforce-reference (the coordinator's provenance ruling);
 *   X3f  rejects `applyMs/busyMs` above 0.10 (a primary, absolute guard);
 *   X3g  rejects an instance probe that did not declare CAPTURED;
 *   X3h  rejects a pair containing a non-EXCLUSIVE window;
 *   X4   the runner documents its subcommands, each harness writes a lock-owner marker its own
 *        gate predicate accepts, the probe declares the three-valued determination vocabulary,
 *        and a dedicated capture self-test exists.
 *
 * Usage: node proof/check-experiment-logic.mjs
 * Exit: 0 all PASS.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TMP = path.join(HERE, "raw", "tmp");
fs.mkdirSync(TMP, { recursive: true });
const results = [];
let failed = 0;
const check = (id, name, ok, detail) => {
	results.push({ id, name, verdict: ok ? "PASS" : "FAIL", detail });
	if (!ok) failed += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// X1 / X1b
// ---------------------------------------------------------------------------
const SCRIPTS = ["experiments/theme-ab.mjs", "experiments/probe-instances.mjs", "experiments/verify-functional.mjs", "experiments/run-theme-experiments.sh"];
const problems = [];
for (const file of SCRIPTS) {
	const full = path.join(HERE, file);
	try {
		if (file.endsWith(".sh")) execFileSync("bash", ["-n", full], { stdio: "pipe" });
		else execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
	} catch (error) {
		problems.push(`${file}: ${String(error.stderr || error.message).slice(0, 120)}`);
	}
}
check("X1", "every experiment script passes its syntax check", problems.length === 0, problems.join(" | ") || `${SCRIPTS.length} scripts`);

const HOOKS = [
	["experiments/theme-ab.mjs", ["INIT", "RESET", "COLLECT"]],
	["experiments/probe-instances.mjs", ["PROBE", "SELFVAL", "COLLECT"]],
	["experiments/verify-functional.mjs", ["DUMP"]]
];
const hookProblems = [];
let hookCount = 0;
for (const [file, names] of HOOKS) {
	const text = fs.readFileSync(path.join(HERE, file), "utf8");
	for (const name of names) {
		hookCount += 1;
		if (!new RegExp("^const " + name + " = \\(", "m").test(text)) hookProblems.push(`${file}:${name} not declared`);
		const serialised = text.includes(`${name}.toString()`) || new RegExp("addInitScript\\(" + name + "[,)]").test(text);
		if (!serialised) hookProblems.push(`${file}:${name} not handed to the page`);
	}
}
check("X1b", "every page-side hook is declared AND handed to the page", hookProblems.length === 0, hookProblems.join("; ") || `${hookCount} hooks`);

// ---------------------------------------------------------------------------
// synthetic window records (shape of cpuL's long-session window)
// ---------------------------------------------------------------------------
const win = (o) => ({
	variant: o.variant ?? "A",
	label: o.label ?? "w",
	scenario: o.scenario,
	wallSec: 8,
	nodes: o.nodes,
	applyCount: o.applyCount ?? 100,
	applyPerS: o.applyPerS,
	instances: o.instances ?? 2,
	probe: { themeColorMetaContent: "rgba(0, 0, 0, 0)", tokenBgBase: "rgba(21, 21, 23, 0.72)" },
	cdp: {
		ScriptDuration: o.script, ScriptMsPerS: o.script / 8,
		TaskDuration: o.task, TaskMsPerS: o.task / 8,
		RecalcStyleDuration: o.recalc, RecalcMsPerS: o.recalc / 8,
		LayoutDuration: 5, RecalcStyleCount: 1000
	},
	profile: { busyMs: o.busy, busyMsPerS: o.busy / 8, applyMs: o.apply, applyMsPerS: o.apply / 8, applyRowCount: o.instances ?? 2 },
	raf: { count: 480, perS: o.rafPerS, intervals: { n: 479, p50: o.rafP50, p95: 20, p99: o.rafP99, max: o.rafP99, over50: o.rafOver50 } },
	longtasks: { n: o.ltN ?? 0, maxMs: 60 },
	ws: { total: 0, byType: {} },
	pageErrors: [],
	concurrency: { gateOutcome: o.gate ?? "EXCLUSIVE", gateWaitedMs: 100, censusStart: { foreignCount: 0 }, censusEnd: { foreignCount: 0 }, foreignSeenDuringGate: [], exclusiveThroughout: (o.gate ?? "EXCLUSIVE") === "EXCLUSIVE" },
	integrity: { rafOk: true, rafRateSane: true, unitOk: true }
});
const finish = (w) => {
	w.recalcOverTask = w.cdp.RecalcStyleDuration / w.cdp.TaskDuration;
	w.applyShareOfBusy = w.profile.busyMs > 0 ? w.profile.applyMs / w.profile.busyMs : 0;
	w.reconcileRatio = w.profile.busyMs / (w.cdp.ScriptDuration + w.cdp.RecalcStyleDuration);
	return w;
};
const baselineWindow = (scenario, nodes) => finish(win({
	scenario, nodes, label: `before-${scenario}`,
	/* busy = 0.9 * (script + recalc) keeps reconcileRatio in the 0.9-1.1 sanity band, so the
	 * criterion under test is the one that decides each case. */
	applyPerS: 16, apply: 2800, busy: 3420, script: 900, task: 4800, recalc: 2900,
	rafPerS: 40, rafP50: 16.7, rafP99: 133, rafOver50: 34
}));
const fixedWindow = (scenario, nodes, over = {}) => finish(win({
	...over,
	scenario, nodes, label: `after-${scenario}`, instances: over.instances ?? 1,
	applyPerS: over.applyPerS ?? 2, apply: over.apply ?? 60, busy: over.busy ?? 450, script: over.script ?? 300,
	task: over.task ?? 1400, recalc: over.recalc ?? 200, rafPerS: over.rafPerS ?? 58, rafP50: over.rafP50 ?? 16.7,
	rafP99: over.rafP99 ?? 22, rafOver50: over.rafOver50 ?? 1
}));

const writePair = (name, beforeWindows, afterWindows) => {
	const b = path.join(TMP, `synth-${name}-before.json`);
	const a = path.join(TMP, `synth-${name}-after.json`);
	fs.writeFileSync(b, JSON.stringify({ label: "before", windows: beforeWindows }, null, 2));
	fs.writeFileSync(a, JSON.stringify({ label: "after", windows: afterWindows }, null, 2));
	return [b, a];
};
const runCompareWith = (files, extra = []) => {
	try {
		const out = execFileSync(process.execPath, [path.join(HERE, "experiments", "theme-ab.mjs"), "--compare", ...files, "--label", "selftest", ...extra], { stdio: "pipe" }).toString();
		return { code: 0, out };
	} catch (error) {
		return { code: error.status, out: String(error.stdout || "") + String(error.stderr || "") };
	}
};
const runCompare = (files) => runCompareWith(files);

{
	const [b, a] = writePair("same", [baselineWindow("long", 3723)], [baselineWindow("long", 3723)]);
	const r = runCompare([b, a]);
	check("X2", "--compare FAILS when the post-fix run keeps the baseline numbers", r.code === 2 && /BATCH VERDICT: FAIL/.test(r.out), `exit=${r.code}`);
}
{
	const [b, a] = writePair("fixed", [baselineWindow("long", 3723), baselineWindow("long", 3723)], [fixedWindow("long", 3723), fixedWindow("long", 3723)]);
	const r = runCompare([b, a]);
	check("X3a", "--compare PASSES a post-fix run that meets every PRIMARY criterion", r.code === 0 && /BATCH VERDICT: PASS/.test(r.out), `exit=${r.code} ${(r.out.split("\n").find((l) => /BATCH VERDICT/.test(l)) || "").trim()}`);
}
{
	const [b, a] = writePair("nodes", [baselineWindow("long", 3723)], [fixedWindow("long", 4200)]);
	const r = runCompare([b, a]);
	check("X3b", "--compare rejects windows that differ by more than 5% in DOM node count", r.code === 2 && /not comparable/.test(r.out), `exit=${r.code}`);
}
{
	const [b, a] = writePair("p50", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { rafP50: 22.5 })]);
	const r = runCompare([b, a]);
	check("X3c", "--compare rejects a degraded rafP50 sentinel", r.code === 2 && /sentinel/.test(r.out), `exit=${r.code}`);
}
{
	const [b, a] = writePair("inst", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, {})]);
	const doc = JSON.parse(fs.readFileSync(a, "utf8"));
	doc.windows[0].instances = 2;
	fs.writeFileSync(a, JSON.stringify(doc, null, 2));
	const r = runCompare([b, a]);
	check("X3d", "--compare rejects a surviving presenter instance (P0 requires 1)", r.code === 2 && /concurrent presenter instances/.test(r.out), `exit=${r.code}`);
}
{
	/* Coordinator ruling: RecalcStyle/Task came from the CONTAMINATED cpuL batch, so it must be
	 * reported but must NOT decide the verdict unless reference enforcement is requested. */
	const [b, a] = writePair("recalc", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { apply: 40, busy: 1080, recalc: 900, task: 1400 })]);
	const r = runCompare([b, a]);
	check("X3e", "--compare does NOT enforce the contaminated-batch RecalcStyle/Task by default",
		r.code === 0 && /BATCH VERDICT: PASS/.test(r.out) && /contaminated baseline, not enforced/.test(r.out),
		`exit=${r.code} — the 0.64 value is still printed in the ref line, it just does not fail the batch`);
	const r2 = runCompareWith([b, a], ["--enforce-reference"]);
	check("X3e'", "--enforce-reference makes the reference items decide again", r2.code === 2 && /RecalcStyle\/Task/.test(r2.out), `exit=${r2.code}`);
}
{
	const [b, a] = writePair("applybusy", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { apply: 600, busy: 900, script: 300, recalc: 300, task: 1400 })]);
	const r = runCompare([b, a]);
	check("X3f", "--compare rejects applyMs/busyMs above 0.10 (primary, absolute)", r.code === 2 && /applyMs\/busyMs/.test(r.out), `exit=${r.code}`);
}
{
	/* A probe whose detector failed must not be usable as instance evidence. */
	const probePath = path.join(HERE, "raw", "instances-after.json");
	const had = fs.existsSync(probePath);
	const backup = had ? fs.readFileSync(probePath) : null;
	fs.writeFileSync(probePath, JSON.stringify({ probeVersion: 2, scenario: "long", determination: "INCONCLUSIVE-INSTRUMENT", agreement: { N1_stackFunctionObjects: 0, N2_metaNodesInHead: 0, N3_maxBurstSize: 0, allThreeEqual: true } }, null, 2));
	const [b, a] = writePair("probe", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, {})]);
	const r = runCompare([b, a]);
	check("X3g", "--compare rejects when no instance probe run declared CAPTURED", r.code === 2 && /no instance probe run declared CAPTURED/.test(r.out), `exit=${r.code}`);
	if (had) fs.writeFileSync(probePath, backup);
	else fs.rmSync(probePath);
}
{
	const [b, a] = writePair("gate", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { gate: "CONTENDED" })]);
	const r = runCompare([b, a]);
	check("X3h", "--compare rejects a pair containing a non-EXCLUSIVE window", r.code === 2 && /not EXCLUSIVE/.test(r.out), `exit=${r.code}`);
}

// ---------------------------------------------------------------------------
// X4 — runner subcommands, lock-owner markers, probe vocabulary, capture self-test
// ---------------------------------------------------------------------------
{
	const text = fs.readFileSync(path.join(HERE, "experiments", "run-theme-experiments.sh"), "utf8");
	const subs = ["before", "after", "compare", "verify", "probe"].every((x) => text.includes(x));
	check("X4", "run-theme-experiments.sh documents before/after/compare/verify/probe", subs, subs ? "" : "a subcommand is missing");
	const writers = ["experiments/theme-ab.mjs", "experiments/probe-instances.mjs"];
	const bad = [];
	for (const f of writers) {
		const src = fs.readFileSync(path.join(HERE, f), "utf8");
		if (!/agent: exec-theme/.test(src)) bad.push(`${f}: owner marker is not "agent: exec-theme"`);
		if (!/lockHeldByMyLine:\s*!!\(lockOwner && \/exec-theme\//.test(src)) bad.push(`${f}: gate predicate does not accept its own marker`);
	}
	check("X4b", "each harness writes a lock-owner marker its own gate predicate accepts", bad.length === 0, bad.join("; ") || `checked ${writers.length} harnesses`);
	const probe = fs.readFileSync(path.join(HERE, "experiments", "probe-instances.mjs"), "utf8");
	const vocab = ["CAPTURED", "NOT-OBSERVED", "INCONCLUSIVE-INSTRUMENT"].every((v) => probe.includes(v));
	check("X4c", "the instance probe declares the three-valued determination vocabulary", vocab, vocab ? "CAPTURED / NOT-OBSERVED / INCONCLUSIVE-INSTRUMENT" : "a value is missing");
	const selfTest = fs.readFileSync(path.join(HERE, "proof", "probe-capture-selftest.mjs"), "utf8");
	check("X4d", "a dedicated capture self-test exists (rework requirement (a))", selfTest.includes("runBrokenVariant") && selfTest.includes("runFixedVariant"), "v1-shape vs v2-shape mutation control");
}

const outPath = path.join(HERE, "proof", "experiment-logic-report.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results, failed, verdict: failed === 0 ? "PASS" : "FAIL" }, null, 2) + "\n");
console.log(`\n=== ${failed === 0 ? "ALL CHECKED" : `${failed} CHECK(S) FAILED`} (${results.length} checks) ===`);
console.log(`report: ${path.relative(HERE, outPath)}`);
process.exit(failed === 0 ? 0 : 2);
