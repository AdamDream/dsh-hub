#!/usr/bin/env node
/**
 * experiments/theme-ab.mjs — M-A / M-B / M-C / M-D causal-separation harness plus the
 * P0 machine checks for the theme batch.
 *
 * Everything here is READ-ONLY with respect to the product tree: it only patches Web APIs
 * and CSSStyleDeclaration methods inside the page for the lifetime of one measurement.
 *
 * Variants (audit §5):
 *   M-A  baseline, no instrumentation beyond the shared counters;
 *   M-B  K-C: `window.getComputedStyle` is replaced for `document.body` only, so the one
 *        forced sync recalculation at `:378` disappears while every other apply behaviour
 *        stays; also timestamps WebSocket inbound frames by payload type.
 *   M-C  K-C': body `setProperty`/`removeProperty` become no-ops, so apply runs in full but
 *        produces no style invalidation (the forced recalculation collapses to ~0).
 *   M-D  counter-proof: inbound `session/event` frames are dropped, everything else stays.
 *
 * Page-side counters (all from the audit's own tooling conventions):
 *   applyCount      = `removeProperty` calls on `document.body.style` (one per apply because
 *                     the retraction set has exactly one token),
 *   instances       = DISTINCT `apply` function objects observed at the call site, captured
 *                     with Error.prepareStackTrace CallSite.getFunction() — this is the P0
 *                     machine check for unit (0), and it reports the bundle URL per object so
 *                     a same-URL multi-fiber reading is distinguishable from a different-URL
 *                     re-materialisation,
 *   coloredProbe    = whether the computed body background is transparent or follows the
 *                     `--dsw-alias-bg-base` token (the audit's §6.2 open question that
 *                     decides whether `(ii-a)` would be value-preserving).
 *
 * Usage:
 *   node experiments/theme-ab.mjs --variant A --label before --scenarios home,long --win 8000
 *   node experiments/theme-ab.mjs --variant B --label after  --scenarios home,long --win 8000
 *   node experiments/theme-ab.mjs --compare raw/theme-ab-BEFORE.json raw/theme-ab-AFTER.json
 *
 * Exit: 0 = window(s) accepted (every window EXCLUSIVE), 3 = gate never became exclusive
 * (windows are still written and marked CONTENDED so they can be judged as INCONCLUSIVE).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const RAW = path.join(HERE, "raw");
const LOCK = "/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock";
const URL_SITE = "http://127.0.0.1:3080";
const LAUNCH = "/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const VARIANT = argOf("variant", "A").toUpperCase();
const LABEL = argOf("label", "run");
const WIN_MS = Number(argOf("win", 8000));
const SCENARIOS = argOf("scenarios", "home,long").split(",").filter(Boolean);
const GATE_MAX_MS = Number(argOf("gatemax", 120000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// ---------------------------------------------------------------------------
// gate (same hardware condition the audit mandates: foreignCount == 0 and we hold the lock)
// ---------------------------------------------------------------------------
function browserInstances() {
	const out = [];
	let lines = [];
	try { lines = execSync("ps -eo pid,ppid,etime,cmd --no-headers", { maxBuffer: 32 * 1024 * 1024 }).toString().split("\n"); } catch { return out; }
	for (const l of lines) {
		if (!/--remote-debugging-pipe/.test(l) || /--type=/.test(l)) continue;
		const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
		if (!m) continue;
		const pid = Number(m[1]);
		let ppid = Number(m[2]);
		const chain = [];
		for (let i = 0; i < 6 && ppid > 1; i++) {
			chain.push(ppid);
			try { const st = fs.readFileSync(`/proc/${ppid}/stat`, "utf8"); ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); } catch { break; }
		}
		out.push({ pid, ppid: Number(m[2]), etime: m[3], ancestors: chain });
	}
	return out;
}
function censusNow() {
	const instances = browserInstances();
	const mine = instances.filter((b) => b.ancestors.includes(process.pid) || b.pid === process.pid);
	const foreign = instances.filter((b) => !mine.includes(b));
	let lockOwner = null;
	try { lockOwner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").split("\n").slice(0, 2).join(" "); } catch { lockOwner = null; }
	return {
		at: new Date().toISOString(),
		instances: instances.length,
		mineCount: mine.length,
		foreignCount: foreign.length,
		foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime })),
		lockOwner,
		lockHeldByMyLine: !!(lockOwner && /exec-theme/.test(lockOwner)),
		lockDirPresent: fs.existsSync(LOCK)
	};
}
function acquireLock() {
	try {
		fs.mkdirSync(LOCK);
		fs.writeFileSync(path.join(LOCK, "owner.txt"), [
			"agent: exec-theme (theme batch, subagent)",
			"line: M-A/M-B/M-C/M-D causal separation + P0 instance check",
			`pid: ${process.pid}`,
			`started_at: ${new Date().toISOString()}`,
			`started_epoch: ${Math.floor(Date.now() / 1000)}`,
			"purpose: each window requires foreignCount==0 && this lock held by this line",
			""
		].join("\n"));
		return true;
	} catch { return false; }
}
function releaseLock() {
	try {
		if (fs.existsSync(LOCK) && /exec-theme/.test(fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8"))) {
			fs.rmSync(path.join(LOCK, "owner.txt"));
			fs.rmdirSync(LOCK);
			return true;
		}
	} catch { }
	return false;
}

// ---------------------------------------------------------------------------
// page-side instrumentation
// ---------------------------------------------------------------------------
const INIT = (variant) => {
	if (window.__th) return;
	const S = {
		variant,
		applyCount: 0,
		bodySetProperty: 0,
		bodyRemoveProperty: 0,
		computedStyleCalls: 0,
		blockedComputedStyle: 0,
		instances: [],
		instanceUrls: {},
		wsFrames: [],
		raf: [],
		lt: [],
		errors: [],
		firstApplySeen: false,
		probe: {}
	};
	window.__th = S;

	/* rAF cadence + long tasks */
	requestAnimationFrame(function tick(t) { S.raf.push(t); requestAnimationFrame(tick); });
	try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration }); }).observe({ entryTypes: ["longtask"] }); } catch { }

	/* instance discovery: a CallSite receiver is the ThemePresenter whose `apply` we are in.
	 * Reading getFunction() gives the exact function object, so distinct objects = distinct
	 * presenters; the CallSite also carries the script URL for each one. */
	const origPrepare = Error.prepareStackTrace;
	Error.prepareStackTrace = function (err, frames) {
		try {
			for (const f of frames) {
				if (f.getFunctionName() !== "apply") continue;
				const fn = f.getFunction();
				const url = f.getFileName() || "";
				if (!/ui-layout/.test(url)) continue;
				let known = false;
				for (const seen of S.instances) if (seen === fn) { known = true; break; }
				if (!known) {
					S.instances.push(fn);
					S.instanceUrls[url] = (S.instanceUrls[url] || 0) + 1;
				}
			}
		} catch { }
		return origPrepare ? origPrepare(err, frames) : frames.map((f) => "    at " + f.toString()).join("\n");
	};

	const install = () => {
		if (!document.body || window.__thPatched) return !!window.__thPatched;
		const proto = Object.getPrototypeOf(document.body.style);
		const oSet = proto.setProperty;
		const oRem = proto.removeProperty;
		proto.setProperty = function (n, v, p) {
			if (this === document.body.style) {
				S.bodySetProperty += 1;
				/* apply writes the retraction set back after clearing it: one apply = one
				 * removeProperty per applied token, so this pair is the apply counter. */
			}
			if (variant === "C" && this === document.body.style) return void 0;
			return oSet.call(this, n, v, p);
		};
		proto.removeProperty = function (n) {
			if (this === document.body.style) {
				S.bodyRemoveProperty += 1;
				/* Error() construction is what drives prepareStackTrace; do it only on a
				 * sampled basis so the probe itself does not dominate the profile. */
				if (!S.firstApplySeen) { S.firstApplySeen = true; void new Error("apply"); }
				else if ((S.bodyRemoveProperty & 7) === 0) void new Error("apply");
			}
			if (variant === "C" && this === document.body.style) return "";
			return oRem.call(this, n);
		};
		window.__thPatched = true;
		return true;
	};
	if (!install()) { const iv = setInterval(() => { if (install()) clearInterval(iv); }, 40); }

	/* K-C: block ONLY the body read, which is the single getComputedStyle call site in the
	 * layout bundle. A minimal fake object keeps the read from forcing a recalculation. */
	if (variant === "B") {
		const oGCS = window.getComputedStyle;
		window.getComputedStyle = function (el, pseudo) {
			if (el === document.body && (pseudo === undefined || pseudo === null)) {
				S.blockedComputedStyle += 1;
				return { backgroundColor: "rgb(0, 0, 0)", getPropertyValue: () => "" };
			}
			S.computedStyleCalls += 1;
			return oGCS.call(window, el, pseudo);
		};
	}

	/* WebSocket inbound frames, timestamped and classified (M-B/M-D need them). */
	const oAdd = WebSocket.prototype.addEventListener;
	WebSocket.prototype.addEventListener = function (type, fn, opts) {
		if (type !== "message") return oAdd.call(this, type, fn, opts);
		return oAdd.call(this, type, function (ev) {
			try {
				const j = JSON.parse(ev.data);
				const pt = j && j.payload && j.payload.type;
				S.wsFrames.push([performance.now(), pt || j.type || "?"]);
				/* M-D: drop the session/event frames to falsify the session-event causal story. */
				if (variant === "D" && pt === "session/event") return;
			} catch { }
			return fn.call(this, ev);
		}, opts);
	};
	window.addEventListener("error", (e) => S.errors.push(String(e.message).slice(0, 160)));
};

const RESET = () => {
	const S = window.__th;
	if (!S) return { ok: false };
	S.applyCount = S.bodyRemoveProperty;
	S.bodySetProperty = 0;
	S.bodyRemoveProperty = 0;
	S.computedStyleCalls = 0;
	S.blockedComputedStyle = 0;
	S.wsFrames.length = 0;
	S.raf.length = 0;
	S.lt.length = 0;
	return { ok: true, variant: S.variant, patched: !!window.__thPatched };
};

const COLLECT = () => {
	const S = window.__th || {};
	/* Value probe for the audit's §6.2 question, plus R5's regression read. */
	const body = document.body;
	const meta = document.querySelector('meta[name="theme-color"]');
	const cs = getComputedStyle(body);
	const probe = {
		computedBodyBackground: cs.backgroundColor,
		tokenBgBase: body.style.getPropertyValue("--dsw-alias-bg-base"),
		themeColorMetaContent: meta ? meta.content : null,
		themeColorMetaCount: document.querySelectorAll('meta[name="theme-color"]').length,
		rootColorScheme: document.documentElement.style.colorScheme,
		bodyDarkAttribute: body.hasAttribute("data-ds-dark-theme"),
		bodyStyleAttr: body.getAttribute("style") || "",
		bodyPropCount: body.style.length,
		nodes: document.getElementsByTagName("*").length
	};
	S.probe = probe;
	return {
		variant: S.variant,
		applyCount: S.bodyRemoveProperty,
		bodySetProperty: S.bodySetProperty,
		bodyRemoveProperty: S.bodyRemoveProperty,
		computedStyleCalls: S.computedStyleCalls,
		blockedComputedStyle: S.blockedComputedStyle,
		instances: S.instances.length,
		instanceUrls: S.instanceUrls,
		wsFrames: S.wsFrames.slice(-4000),
		raf: S.raf.slice(),
		lt: S.lt.slice(),
		errors: S.errors.slice(0, 6),
		probe
	};
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
if (has("compare")) {
	const files = argv.slice(argv.indexOf("--compare") + 1).filter((a) => !a.startsWith("--"));
	if (files.length < 2) {
		console.error("--compare needs two result files: --compare BEFORE.json AFTER.json");
		process.exit(2);
	}
	const before = JSON.parse(fs.readFileSync(path.resolve(files[0]), "utf8"));
	const after = JSON.parse(fs.readFileSync(path.resolve(files[1]), "utf8"));
	const thresholds = JSON.parse(fs.readFileSync(path.join(HERE, "experiments", "thresholds.json"), "utf8"));
	const rows = [];
	let verdict = "PASS";
	const scen = [...new Set([...before.windows.map((w) => w.scenario), ...after.windows.map((w) => w.scenario)])];
	for (const s of scen) {
		const b = before.windows.filter((w) => w.scenario === s);
		const a = after.windows.filter((w) => w.scenario === s);
		if (!b.length || !a.length) continue;
		const avg = (list, f) => list.reduce((x, w) => x + (f(w) ?? 0), 0) / list.length;
		const rb = (x, y) => (y === 0 ? null : r3(x / y));
		const bNodes = avg(b, (w) => w.nodes);
		const aNodes = avg(a, (w) => w.nodes);
		const sameScale = bNodes === 0 ? false : Math.abs(aNodes - bNodes) / bNodes <= 0.05;
		const row = {
			scenario: s,
			windows: { before: b.length, after: a.length },
			nodes: { before: r3(bNodes), after: r3(aNodes), sameScale },
			applyPerS: { before: r3(avg(b, (w) => w.applyPerS)), after: r3(avg(a, (w) => w.applyPerS)) },
			applyMsPerS: { before: r3(avg(b, (w) => w.applyMsPerS)), after: r3(avg(a, (w) => w.applyMsPerS)) },
			busyMsPerS: { before: r3(avg(b, (w) => w.busyMsPerS)), after: r3(avg(a, (w) => w.busyMsPerS)) },
			recalcOverTask: { before: r3(avg(b, (w) => w.recalcOverTask)), after: r3(avg(a, (w) => w.recalcOverTask)) },
			applyOverBusy: { before: r3(avg(b, (w) => w.applyShareOfBusy)), after: r3(avg(a, (w) => w.applyShareOfBusy)) },
			rafOver50: { before: avg(b, (w) => w.rafOver50), after: avg(a, (w) => w.rafOver50) },
			rafP50: { before: r3(avg(b, (w) => w.rafP50)), after: r3(avg(a, (w) => w.rafP50)) },
			rafP99: { before: r3(avg(b, (w) => w.rafP99)), after: r3(avg(a, (w) => w.rafP99)) },
			instances: { before: avg(b, (w) => w.instances), after: avg(a, (w) => w.instances) }
		};
		const fails = [];
		if (!sameScale) fails.push("DOM node count differs by more than 5% — windows are not comparable (INCONCLUSIVE)");
		if (row.instances.after !== 1) fails.push(`P0: concurrent presenter instances = ${row.instances.after} (must be 1)`);
		const applyDrop = rb(row.applyMsPerS.before - row.applyMsPerS.after, row.applyMsPerS.before);
		if (applyDrop !== null && applyDrop < thresholds.p1.applyMsPerS.dropMin) fails.push(`applyMsPerS drop ${applyDrop} < ${thresholds.p1.applyMsPerS.dropMin}`);
		if (!(row.recalcOverTask.after <= thresholds.p1.recalcOverTask.max)) fails.push(`RecalcStyle/Task ${row.recalcOverTask.after} > ${thresholds.p1.recalcOverTask.max}`);
		if (!(row.applyOverBusy.after <= thresholds.p1.applyShareOfBusy.max)) fails.push(`applyMs/busyMs ${row.applyOverBusy.after} > ${thresholds.p1.applyShareOfBusy.max}`);
		if (!(row.rafP50.after <= thresholds.p1.rafP50.sentinelMax && row.rafP50.after >= thresholds.p1.rafP50.sentinelMin)) fails.push(`rafP50 ${row.rafP50.after} outside the ${thresholds.p1.rafP50.sentinelMin}-${thresholds.p1.rafP50.sentinelMax} sentinel band (the fix introduced or masked frame trouble)`);
		if (!(row.rafP99.after <= thresholds.p1.rafP99.max)) fails.push(`rafP99 ${row.rafP99.after} > ${thresholds.p1.rafP99.max}`);
		if (!(row.rafOver50.after <= thresholds.p1.rafOver50.maxPer2Windows)) fails.push(`rafOver50 ${row.rafOver50.after} > ${thresholds.p1.rafOver50.maxPer2Windows}`);
		if (!(row.applyPerS.after <= thresholds.p0.applyPerS.maxAbsolute)) fails.push(`apply/s ${row.applyPerS.after} > ${thresholds.p0.applyPerS.maxAbsolute}`);
		if (applyDrop !== null && applyDrop < thresholds.p0.applyPerS.dropMin) fails.push(`apply/s drop ${applyDrop} < ${thresholds.p0.applyPerS.dropMin}`);
		row.verdict = fails.length === 0 ? "PASS" : "FAIL";
		row.failures = fails;
		if (fails.length) verdict = "FAIL";
		rows.push(row);
	}
	const out = { generatedAt: new Date().toISOString(), before: files[0], after: files[1], thresholds, rows, verdict };
	fs.writeFileSync(path.join(RAW, `compare-${LABEL}.json`), JSON.stringify(out, null, 2) + "\n");
	for (const row of rows) {
		console.log(`\n=== ${row.scenario}  ${row.verdict}`);
		console.log(`    nodes ${row.nodes.before} -> ${row.nodes.after} (sameScale=${row.nodes.sameScale})`);
		console.log(`    instances ${row.instances.before} -> ${row.instances.after}`);
		console.log(`    apply/s ${row.applyPerS.before} -> ${row.applyPerS.after}`);
		console.log(`    applyMs/s ${row.applyMsPerS.before} -> ${row.applyMsPerS.after}`);
		console.log(`    busyMs/s ${row.busyMsPerS.before} -> ${row.busyMsPerS.after}`);
		console.log(`    RecalcStyle/Task ${row.recalcOverTask.before} -> ${row.recalcOverTask.after}`);
		console.log(`    applyMs/busyMs ${row.applyOverBusy.before} -> ${row.applyOverBusy.after}`);
		console.log(`    rafP50 ${row.rafP50.before} -> ${row.rafP50.after} (sentinel)`);
		console.log(`    rafP99 ${row.rafP99.before} -> ${row.rafP99.after}`);
		console.log(`    rafOver50 ${row.rafOver50.before} -> ${row.rafOver50.after}`);
		for (const f of row.failures) console.log(`    FAIL: ${f}`);
	}
	console.log(`\n=== BATCH VERDICT: ${verdict} ===`);
	process.exit(verdict === "PASS" ? 0 : 2);
}

const { chromium } = await import(LAUNCH);
fs.mkdirSync(RAW, { recursive: true });
console.log(`theme-ab variant=${VARIANT} label=${LABEL} win=${WIN_MS}ms scenarios=${SCENARIOS.join(",")}`);

const gotLock = acquireLock();
if (!gotLock) {
	console.log(`[gate] lock ${LOCK} is held by another line — running WITHOUT the lock is not allowed.`);
	console.log(`${fs.existsSync(LOCK) ? fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8") : ""}`);
	process.exit(3);
}
console.log(`[gate] lock acquired at ${new Date().toISOString()}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] });
const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await bctx.addInitScript(INIT, VARIANT);
const page = await bctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(URL_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(9000);

const windows = [];
async function capture(label, scenario, pre) {
	/* hardware gate: only start a window when the machine is ours */
	const gateStart = Date.now();
	let gate = null;
	const foreignSeen = [];
	while (Date.now() - gateStart < GATE_MAX_MS) {
		const c = censusNow();
		if (c.foreignCount === 0 && c.lockHeldByMyLine) { gate = c; break; }
		if (c.foreignCount > 0) for (const f of c.foreign) if (!foreignSeen.some((x) => x.pid === f.pid)) foreignSeen.push(f);
		await sleep(4000);
	}
	const gateOutcome = gate ? "EXCLUSIVE" : "CONTENDED";
	const cdp = await bctx.newCDPSession(page);
	await cdp.send("Performance.enable");
	await page.evaluate(`(${RESET.toString()})()`);
	const censusStart = censusNow();
	const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
	await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.start");
	const t0 = Date.now();
	if (pre) await pre();
	await sleep(WIN_MS);
	const t1 = Date.now();
	const { profile } = await cdp.send("Profiler.stop");
	const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
	const data = await page.evaluate(`(${COLLECT.toString()})()`);
	const censusEnd = censusNow();
	const wallS = (t1 - t0) / 1000;

	/* profile aggregation (timeDeltas are microseconds) */
	const byId = new Map(profile.nodes.map((n) => [n.id, n]));
	const self = new Map();
	for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
	const deltas = profile.timeDeltas || [];
	const sumUs = deltas.reduce((a, b) => a + b, 0);
	const msPerSample = (deltas.length ? sumUs / deltas.length : 1000) / 1000;
	const wallMs = (profile.endTime - profile.startTime) / 1000;
	const rows = [...self.entries()].map(([id, c]) => {
		const cf = byId.get(id)?.callFrame || {};
		return { fn: cf.functionName || "(anonymous)", url: cf.url || "", line: (cf.lineNumber ?? -1) + 1, selfMs: r3(c * msPerSample) };
	}).sort((a, b) => b.selfMs - a.selfMs);
	const V8I = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;
	const busyMs = rows.filter((r) => !V8I.test(r.fn)).reduce((a, r) => a + r.selfMs, 0);
	const applyRows = rows.filter((r) => r.fn === "apply" && /ui-layout/.test(r.url));
	const applyMs = applyRows.reduce((a, r) => a + r.selfMs, 0);

	const g = (k) => r3(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000);
	const raf = data.raf;
	const iv = raf.slice(1).map((t, i) => t - raf[i]);
	const stat = (a) => {
		if (!a.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0 };
		const x = [...a].sort((p, q) => p - q);
		const q = (v) => r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * v))]);
		return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r3(x[x.length - 1]), over50: a.filter((v) => v > 50).length };
	};
	const rec = {
		variant: VARIANT,
		label,
		scenario,
		wallSec: r3(wallS),
		nodes: data.probe.nodes,
		applyCount: data.applyCount,
		applyPerS: r3(data.applyCount / wallS),
		bodySetProperty: data.bodySetProperty,
		bodyRemoveProperty: data.bodyRemoveProperty,
		instances: data.instances,
		instanceUrls: data.instanceUrls,
		blockedComputedStyle: data.blockedComputedStyle,
		probe: data.probe,
		cdp: {
			ScriptDuration: g("ScriptDuration"), ScriptMsPerS: r3(g("ScriptDuration") / wallS),
			TaskDuration: g("TaskDuration"), TaskMsPerS: r3(g("TaskDuration") / wallS),
			RecalcStyleDuration: g("RecalcStyleDuration"), RecalcMsPerS: r3(g("RecalcStyleDuration") / wallS),
			LayoutDuration: g("LayoutDuration"),
			RecalcStyleCount: g("RecalcStyleCount")
		},
		profile: { msPerSample: r3(msPerSample), samples: (profile.samples || []).length, wallMs: r3(wallMs), busyMs: r3(busyMs), busyMsPerS: r3(busyMs / (wallMs / 1000)), applyMs: r3(applyMs), applyMsPerS: r3(applyMs / (wallMs / 1000)), applyRowCount: applyRows.length, applyRows: applyRows.slice(0, 8), top: rows.slice(0, 8) },
		raf: { count: raf.length, perS: r3(raf.length / wallS), intervals: stat(iv) },
		longtasks: { n: data.lt.length, maxMs: data.lt.length ? r3(Math.max(...data.lt.map((x) => x.d))) : null },
		ws: { total: data.wsFrames.length, byType: data.wsFrames.reduce((a, [t, ty]) => { a[ty] = (a[ty] || 0) + 1; return a; }, {}) },
		pageErrors: [...new Set([...pageErrors, ...data.errors])].slice(0, 6),
		concurrency: { gateOutcome, gateWaitedMs: Date.now() - gateStart, censusStart, censusEnd, foreignSeenDuringGate: foreignSeen, exclusiveThroughout: gateOutcome === "EXCLUSIVE" && censusStart.foreignCount === 0 && censusEnd.foreignCount === 0 },
		integrity: { rafOk: raf.length > 0, rafRateSane: raf.length / wallS < 80, unitOk: msPerSample > 0.5 && msPerSample < 3 }
	};
	rec.recalcOverTask = rec.cdp.TaskDuration > 0 ? r3(rec.cdp.RecalcStyleDuration / rec.cdp.TaskDuration) : null;
	rec.applyShareOfBusy = busyMs > 0 ? r3(applyMs / busyMs) : null;
	rec.reconcileRatio = r3(busyMs / Math.max(0.0001, g("ScriptDuration") + g("RecalcStyleDuration")));
	await cdp.detach();
	return rec;
}

const push = (r) => {
	windows.push(r);
	console.log(`[win] ${r.label.padEnd(18)} gate=${r.concurrency.gateOutcome} wall=${r.wallSec}s nodes=${r.nodes} instances=${r.instances} apply/s=${r.applyPerS} applyMs/s=${r.profile.applyMsPerS} busyMs/s=${r.profile.busyMsPerS} apply/busy=${r.applyShareOfBusy} recalc/task=${r.recalcOverTask} raf/s=${r.raf.perS} p50=${r.raf.intervals.p50} p99=${r.raf.intervals.p99} >50=${r.raf.intervals.over50} lt=${r.longtasks.n} blockedGCS=${r.blockedComputedStyle} integ=${r.integrity.rafOk && r.integrity.rafRateSane && r.integrity.unitOk ? "OK" : "CHECK"}`);
	if (r.pageErrors.length) console.log(`       page errors: ${JSON.stringify(r.pageErrors)}`);
};

async function expandSidebar() {
	const projects = await page.evaluate(() => [...document.querySelectorAll("[class*=projectRow]")].map((r) => (r.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40)));
	for (const t of projects) { try { await page.locator("[class*=projectRow]", { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
	await sleep(900);
}
async function openSession(title) {
	for (const p of [title, title.slice(0, 12)]) {
		try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await sleep(2200); return p; } } catch { }
	}
	return null;
}

if (SCENARIOS.includes("home")) push(await capture(`${LABEL}-home`, "home-idle"));
if (SCENARIOS.includes("long")) {
	await expandSidebar();
	const opened = await openSession("会话删除更新误删全部会话");
	console.log(`[setup] long-session probe=${JSON.stringify(opened)}`);
	await sleep(2000);
	push(await capture(`${LABEL}-long`, "long-session-idle"));
}
if (SCENARIOS.includes("settings")) {
	try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
	await sleep(2500);
	push(await capture(`${LABEL}-settings`, "settings-dwell"));
}
await browser.close();
const released = releaseLock();
console.log(`[gate] lock ${released ? "released" : "not released"}`);

const accepted = windows.filter((w) => w.concurrency.gateOutcome === "EXCLUSIVE");
const out = {
	generatedAt: new Date().toISOString(),
	variant: VARIANT,
	label: LABEL,
	winMs: WIN_MS,
	scenarios: SCENARIOS,
	windows,
	acceptedWindows: accepted.length,
	discipline: "read-only; single browser; single page; no save/apply/delete/refresh; page-API instrumentation only",
	notes: [
		"applyCount = body.style.removeProperty calls (one per apply, because the retraction set holds one token)",
		"instances = distinct `apply` function objects observed through Error.prepareStackTrace CallSite.getFunction()",
		"K-C (variant B) replaces window.getComputedStyle for document.body only; functional checks must run without it",
		"variant C makes body style writes no-ops, so it must not be used for functional judgements"
	]
};
fs.writeFileSync(path.join(RAW, `theme-ab-${LABEL}.json`), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote ${path.relative(HERE, path.join(RAW, `theme-ab-${LABEL}.json`))}  accepted=${accepted.length}/${windows.length}`);
process.exit(accepted.length === windows.length ? 0 : 3);
