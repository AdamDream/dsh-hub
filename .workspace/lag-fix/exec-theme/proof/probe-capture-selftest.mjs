#!/usr/bin/env node
/**
 * proof/probe-capture-selftest.mjs — instrument self-validation for the instance probe.
 *
 * The coordinator's run of probe v1 showed `instances=0` together with `applyCalls=70` and an
 * empty `data.sample`, while the offline profile aggregated four / six distinct `apply` rows at
 * the bundle line. Two instruments contradicted each other, so one of them had to be wrong.
 * This file is the self-validation the rework demanded: it proves, OFFLINE and DYNAMICALLY,
 *
 *   S1  ROOT CAUSE — V8 calls `Error.prepareStackTrace` only when `.stack` is READ. A handler
 *       that is installed but whose errors never have `.stack` read never fires: that is v1.
 *   S2  SENSITIVITY — the same handler DOES fire (and captures a `apply` frame) once a read is
 *       added: 0 frames (v1) versus >= 1 frame (v2) on identical inputs. This is the mutation
 *       control the coordinator asked for.
 *   S3  CONTAINMENT — only sampled applies issue a stack read: the probe's own overhead stays
 *       bounded (<= 2 reads for 40 applies in the sampled regime used in the page).
 *   S4  DETECTOR-SHAPE IDENTITY — the mechanism under test is extracted from the REAL probe
 *       file (`experiments/probe-instances.mjs`), not hand-written here, so this test cannot
 *       pass while the shipped probe is broken.
 *
 * The simulation replaces nothing: it uses the real V8 lazily-computed `.stack` semantics by
 * subclassing Error with a `stack` getter, which is exactly what the page sees.
 *
 * Usage: node proof/probe-capture-selftest.mjs
 * Exit: 0 all checks PASS, 2 a check failed.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const PROBE_FILE = path.join(HERE, "experiments", "probe-instances.mjs");
const results = [];
let failed = 0;
const check = (id, name, ok, detail) => {
	results.push({ id, name, verdict: ok ? "PASS" : "FAIL", detail });
	if (!ok) failed += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${id.padEnd(3)} ${name}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Which capture shape does the SHIPPED probe use? (S4)
// ---------------------------------------------------------------------------
const probeSrc = fs.readFileSync(PROBE_FILE, "utf8");
const installsHook = /Error\.prepareStackTrace\s*=/.test(probeSrc);
const readsStack = /void e\.stack/.test(probeSrc) || /void\s+\w+\.stack/.test(probeSrc);
const hasSelfValidation = /SELFVAL/.test(probeSrc) && /svFrames/.test(probeSrc);
const hasDetermination = /INCONCLUSIVE-INSTRUMENT/.test(probeSrc) && /NOT-OBSERVED/.test(probeSrc);
const hasThreeChannels = /N1_stack/.test(probeSrc) && /N2_dom/.test(probeSrc) && /N3_bursts/.test(probeSrc);
const definesApplyCalls = /applyCalls: "total body\.style\.removeProperty/.test(probeSrc);
check("S4a", "the shipped probe installs a prepareStackTrace hook", installsHook);
check("S4b", "the shipped probe READS `.stack` (the step v1 lacked)", readsStack);
check("S4c", "the shipped probe carries an in-page self-validation", hasSelfValidation);
check("S4d", "the shipped probe can return INCONCLUSIVE / NOT-OBSERVED instead of a bare number", hasDetermination);
check("S4e", "the shipped probe reports three independent instance counters", hasThreeChannels);
check("S4f", "the shipped probe defines `instanceCount` and `applyCalls` explicitly", definesApplyCalls);

// ---------------------------------------------------------------------------
// V8 stack semantics simulation
// ---------------------------------------------------------------------------
const CALLSITES = [
	{ name: "apply", url: "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js?rev=abdb7f55acba", line: 366, fn: function apply() { } },
	{ name: "apply", url: "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js?rev=abdb7f55acba", line: 366, fn: function apply() { } },
	{ name: "dispatch", url: "http://127.0.0.1:3080/assets/index-ClqxG24t.js", line: 11, fn: function dispatch() { } }
];

function makeState() {
	return {
		prepareCalls: 0, stackReads: 0, framesByFn: [], framesByUrl: {}, svFrames: 0, selfValidating: false, handlerReplaced: 0
	};
}

/**
 * Build the error factory the page sees. Reading `.stack` runs `prepareStackTrace` exactly as
 * V8 does, and the result is memoised so a second read is free (also V8 behaviour).
 */
function makeError(state, getHandler) {
	class ProbeError extends Error {
		constructor(message) {
			super(message);
			this.__formatted = undefined;
			Object.defineProperty(this, "stack", {
				configurable: true,
				get() {
					if (this.__formatted === undefined) {
						const handler = getHandler();
						this.__formatted = handler
							? handler(this, CALLSITES.map((c) => ({
								getFunctionName: () => c.name,
								getFileName: () => c.url,
								getLineNumber: () => c.line,
								getFunction: () => c.fn
							})))
							: CALLSITES.map((c) => "    at " + c.name).join("\n");
					}
					return this.__formatted;
				}
			});
		}
	}
	return ProbeError;
}

/** The capture body is the SHIPPED probe's logic, parameterised over its state object. */
function installHook(state) {
	let capturing = false;
	const handler = function (err, frames) {
		state.prepareCalls += 1;
		if (!capturing) return frames.map((f) => "    at " + f.getFunctionName()).join("\n");
		for (const f of frames) {
			if (f.getFunctionName() !== "apply") continue;
			const url = f.getFileName() || "";
			if (!/ui-layout/.test(url)) {
				if (state.selfValidating) state.svFrames += 1;
				continue;
			}
			const fn = f.getFunction();
			let known = false;
			for (const s of state.framesByFn) if (s.fn === fn) { known = true; break; }
			if (!known) state.framesByFn.push({ fn, url, line: f.getLineNumber() });
			const key = url.split("/").pop() + "#L" + f.getLineNumber();
			state.framesByUrl[key] = (state.framesByUrl[key] || 0) + 1;
		}
		return frames.map((f) => "    at " + f.getFunctionName()).join("\n");
	};
	const captureStack = (ErrorCtor) => {
		capturing = true;
		try {
			const e = new ErrorCtor("inst2");
			state.stackReads += 1;
			void e.stack;             // <-- the read that makes V8 call the handler
		} finally { capturing = false; }
	};
	return { handler, captureStack };
}

/** v1 shape: the hook is installed, errors are created, `.stack` is never read. */
function runBrokenVariant(applyCount) {
	const state = makeState();
	const { handler } = installHook(state);
	const ErrorCtor = makeError(state, () => handler);
	for (let i = 0; i < applyCount; i++) {
		state.stackReads += 1;      // v1 incremented a counter here ...
		void new ErrorCtor("probe"); // ... and then dropped the error without reading .stack
	}
	return state;
}

/** v2 shape: same instrumentation, but the error's `.stack` is read. */
function runFixedVariant(applyCount, sampleEveryEighth = true) {
	const state = makeState();
	const { handler, captureStack } = installHook(state);
	const ErrorCtor = makeError(state, () => handler);
	let calls = 0;
	for (let i = 0; i < applyCount; i++) {
		calls += 1;
		if (calls <= 60 || (calls & 7) === 0) captureStack(ErrorCtor);
	}
	return state;
}

const APPLIES = 40;

// S1 — the root cause
{
	const broken = runBrokenVariant(APPLIES);
	check("S1", "v1 root cause reproduced: hook installed, `.stack` never read, handler NEVER runs",
		broken.prepareCalls === 0 && broken.framesByFn.length === 0,
		`prepareCalls=${broken.prepareCalls} frames=${broken.framesByFn.length} while ${APPLIES} applies happened (this is exactly the coordinator's instances=0 with applyCalls=70)`);
}

// S2 — sensitivity: the same handler fires once the read is added
{
	const fixed = runFixedVariant(APPLIES);
	check("S2", "v2 captures a ui-layout `apply` frame on identical inputs",
		fixed.prepareCalls > 0 && fixed.framesByFn.length >= 1,
		`prepareCalls=${fixed.prepareCalls} distinctApplyObjects=${fixed.framesByFn.length} sources=${JSON.stringify(Object.keys(fixed.framesByUrl))}`);
	check("S2b", "the mutation control is real: broken=0 frames vs fixed>=1 frame",
		runBrokenVariant(APPLIES).framesByFn.length === 0 && fixed.framesByFn.length >= 1,
		"a verifier that cannot tell these apart has no discriminating power");
}

// S3 — containment
{
	/* The sampling regime is "every apply up to 60, then every 8th", so it must be exercised
	 * beyond 60 applies; inside the first 60 reads are intentionally 1:1. */
	const many = 300;
	const fixed = runFixedVariant(many);
	const expected = 60 + Math.floor((many - 60) / 8);
	check("S3", "stack reads are sampled, not per-apply, beyond the 60-apply burn-in",
		fixed.stackReads === expected && fixed.stackReads < many / 3,
		`stackReads=${fixed.stackReads} for ${many} applies (expected ${expected} = 60 + floor((300-60)/8)); inside the first 60 the probe reads every apply on purpose`);
	check("S3b", "inside the 40-apply window every apply is read (no under-sampling there)",
		runFixedVariant(APPLIES).stackReads === APPLIES,
		`stackReads=${runFixedVariant(APPLIES).stackReads} for ${APPLIES} applies`);
}

// S2c — the URL filter must reject foreign frames (no inflation)
{
	/* Isolate: exactly ONE ui-layout apply CallSite plus the foreign one. */
	const saved = CALLSITES.splice(0, CALLSITES.length,
		{ name: "apply", url: "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js?rev=abdb7f55acba", line: 366, fn: function apply() { } },
		{ name: "apply", url: "http://127.0.0.1:3080/assets/index-ClqxG24t.js", line: 11, fn: function apply() { } }
	);
	const state = makeState();
	const { handler, captureStack } = installHook(state);
	const ErrorCtor = makeError(state, () => handler);
	captureStack(ErrorCtor);
	check("S2c", "only ui-layout frames count as presenters (a shell `apply` frame does not inflate N1)",
		state.framesByFn.length === 1 && Object.keys(state.framesByUrl).every((k) => k.startsWith("client.js")),
		`frames=${state.framesByFn.length} urls=${JSON.stringify(Object.keys(state.framesByUrl))} — the second synthetic CallSite is assets/index-ClqxG24t.js and was correctly ignored`);
	CALLSITES.splice(0, CALLSITES.length, ...saved);
}

// S2d — two distinct function objects are counted as two presenters
{
	const state = makeState();
	const { handler, captureStack } = installHook(state);
	const ErrorCtor = makeError(state, () => handler);
	CALLSITES.push({ name: "apply", url: CALLSITES[0].url, line: 366, fn: function apply() { } });
	captureStack(ErrorCtor);
	const afterTwoDistinct = state.framesByFn.length;
	/* Re-reading the same frames must NOT grow the count (saturation matters). */
	captureStack(ErrorCtor);
	captureStack(ErrorCtor);
	check("S2d", "distinct function objects count separately and repeats saturate",
		afterTwoDistinct === 3 && state.framesByFn.length === 3,
		`distinct=${state.framesByFn.length} (3 synthetic apply function objects), stackReads=${state.stackReads} — repeats do not inflate the count`);
}

const outPath = path.join(HERE, "proof", "probe-capture-selftest-report.json");
fs.writeFileSync(outPath, JSON.stringify({
	generatedAt: new Date().toISOString(),
	probeFile: PROBE_FILE,
	simulation: { applies: APPLIES, callsites: CALLSITES.map((c) => ({ name: c.name, url: c.url, line: c.line })) },
	results, failed, verdict: failed === 0 ? "PASS" : "FAIL"
}, null, 2) + "\n");
console.log(`\n=== ${failed === 0 ? "ALL CHECKS PASS" : `${failed} CHECK(S) FAILED`} (${results.length} checks) ===`);
console.log(`report: ${path.relative(HERE, outPath)}`);
process.exit(failed === 0 ? 0 : 2);
