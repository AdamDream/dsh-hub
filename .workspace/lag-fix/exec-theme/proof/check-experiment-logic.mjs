#!/usr/bin/env node
/**
 * proof/check-experiment-logic.mjs — exercise the experiment harnesses WITHOUT a browser.
 *
 *   X1   every experiment script passes its syntax check;
 *   X1b  every page-side hook is declared AND serialised with toString() into the page (a body
 *        that failed to parse would throw at that call, and each harness logs `patched` back);
 *   X2   `theme-ab.mjs --compare` REJECTS a post-fix run that keeps the baseline numbers —
 *        the verdict logic must be able to fail, or a PASS means nothing;
 *   X3a  `--compare` ACCEPTS a synthetic post-fix run that meets every §4 threshold;
 *   X3b  `--compare` rejects windows that differ by more than 5% in DOM node count;
 *   X3c  `--compare` rejects a degraded `rafP50` (the "did not break" sentinel);
 *   X3d  `--compare` rejects a surviving presenter instance (P0 requires exactly 1);
 *   X3e  `--compare` rejects `RecalcStyle/Task` above 0.15;
 *   X3f  `--compare` rejects `applyMs/busyMs` above 0.10;
 *   X4   the runner documents its subcommands and each harness writes a lock-owner marker its
 *        own gate predicate accepts.
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
	["experiments/probe-instances.mjs", ["PROBE", "COLLECT"]],
	["experiments/verify-functional.mjs", ["DUMP"]]
];
const hookProblems = [];
let hookCount = 0;
for (const [file, names] of HOOKS) {
	const text = fs.readFileSync(path.join(HERE, file), "utf8");
	for (const name of names) {
		hookCount += 1;
		if (!new RegExp("^const " + name + " = \\(", "m").test(text)) hookProblems.push(`${file}:${name} not declared`);
		if (!text.includes(`${name}.toString()`)) hookProblems.push(`${file}:${name} not serialised into the page`);
	}
}
check("X1b", "every page-side hook is declared AND serialised with toString() into the page", hookProblems.length === 0, hookProblems.join("; ") || `${hookCount} hooks`);

// ---------------------------------------------------------------------------
// synthetic window records
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
	concurrency: { gateOutcome: "EXCLUSIVE", gateWaitedMs: 100, censusStart: { foreignCount: 0 }, censusEnd: { foreignCount: 0 }, foreignSeenDuringGate: [], exclusiveThroughout: true },
	integrity: { rafOk: true, rafRateSane: true, unitOk: true }
});
const finish = (w) => {
	w.recalcOverTask = w.cdp.RecalcStyleDuration / w.cdp.TaskDuration;
	w.applyShareOfBusy = w.profile.busyMs > 0 ? w.profile.applyMs / w.profile.busyMs : 0;
	w.reconcileRatio = w.profile.busyMs / (w.cdp.ScriptDuration + w.cdp.RecalcStyleDuration);
	return w;
};
/* Numbers model cpuL's long-session window (nodes 3723, applyMs/s ~349, apply/busy 0.65).
 * The post-fix numbers follow the audit's expectation: apply keeps only its residual writes
 * while the forced recalculation moves to a coalesced per-frame read, so applyMs/busyMs falls
 * far below 0.10 while total busy time keeps the residual the audit predicts (65-100 ms/s). */
const baselineWindow = (scenario, nodes) => finish(win({
	scenario, nodes, label: `before-${scenario}`,
	applyPerS: 16, apply: 2800, busy: 3200, script: 900, task: 4800, recalc: 2900,
	rafPerS: 40, rafP50: 16.7, rafP99: 133, rafOver50: 34
}));
const fixedWindow = (scenario, nodes, over = {}) => finish(win({
	scenario, nodes, label: `after-${scenario}`, instances: 1,
	applyPerS: over.applyPerS ?? 2, apply: over.apply ?? 40, busy: over.busy ?? 500, script: over.script ?? 300,
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
const runCompare = (files) => {
	try {
		const out = execFileSync(process.execPath, [path.join(HERE, "experiments", "theme-ab.mjs"), "--compare", ...files, "--label", "selftest"], { stdio: "pipe" }).toString();
		return { code: 0, out };
	} catch (error) {
		return { code: error.status, out: String(error.stdout || "") + String(error.stderr || "") };
	}
};

{
	const [b, a] = writePair("same", [baselineWindow("long", 3723)], [baselineWindow("long", 3723)]);
	const r = runCompare([b, a]);
	check("X2", "--compare FAILS when the post-fix run keeps the baseline numbers", r.code === 2 && /BATCH VERDICT: FAIL/.test(r.out), `exit=${r.code}`);
}
{
	const [b, a] = writePair("fixed", [baselineWindow("long", 3723), baselineWindow("long", 3723)], [fixedWindow("long", 3723), fixedWindow("long", 3723)]);
	const r = runCompare([b, a]);
	check("X3a", "--compare PASSES a post-fix run that meets every §4 threshold", r.code === 0 && /BATCH VERDICT: PASS/.test(r.out), `exit=${r.code} ${(r.out.split("\n").find((l) => /BATCH VERDICT/.test(l)) || "").trim()}`);
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
	const [b, a] = writePair("recalc", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { recalc: 900, task: 1400 })]);
	const r = runCompare([b, a]);
	check("X3e", "--compare rejects RecalcStyle/Task above 0.15", r.code === 2 && /RecalcStyle\/Task/.test(r.out), `exit=${r.code}`);
}
{
	const [b, a] = writePair("applybusy", [baselineWindow("long", 3723)], [fixedWindow("long", 3723, { apply: 600, busy: 900 })]);
	const r = runCompare([b, a]);
	check("X3f", "--compare rejects applyMs/busyMs above 0.10", r.code === 2 && /applyMs\/busyMs/.test(r.out), `exit=${r.code}`);
}

// ---------------------------------------------------------------------------
// X4 — runner subcommands and lock-owner markers
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
}

const outPath = path.join(HERE, "proof", "experiment-logic-report.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results, failed, verdict: failed === 0 ? "PASS" : "FAIL" }, null, 2) + "\n");
console.log(`\n=== ${failed === 0 ? "ALL CHECKED" : `${failed} CHECK(S) FAILED`} (${results.length} checks) ===`);
console.log(`report: ${path.relative(HERE, outPath)}`);
process.exit(failed === 0 ? 0 : 2);
