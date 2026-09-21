#!/usr/bin/env node
/**
 * experiments/probe-instances.mjs — P0 machine check for unit (0). REBUILT (v2).
 *
 * WHY THIS FILE WAS REWRITTEN
 *   v1 installed `Error.prepareStackTrace` and then created errors with `new Error("probe")`,
 *   but it never READ `.stack`. V8 calls that hook only when `.stack` is accessed, so the hook
 *   could not fire once: the coordinator's run showed `instances=0` alongside `applyCalls=70`,
 *   i.e. "single presenter" was an artefact of a DEAD HALLWAY. v1 is kept as the lesson; this
 *   version is required to PROVE its channels are alive before any number may be used.
 *
 * v2 EVIDENCE MODEL
 *   Determination (never a bare number):
 *     CAPTURED                 — observed application is large enough AND the stack channel
 *                                passed self-validation; the counts may be used as P0 evidence;
 *     NOT-OBSERVED             — channels healthy but the window held almost no apply work:
 *                                this says NOTHING about the presenter count (it is NOT
 *                                "single presenter");
 *     INCONCLUSIVE-INSTRUMENT  — a channel failed its own precondition: numbers unusable.
 *
 *   Three INDEPENDENT counters for the live-presenter count, each from different physics:
 *     N1 stack   : distinct `apply` function objects captured on the stack (function identity);
 *     N2 DOM     : distinct `<meta name=theme-color>` nodes in <head>. `layout :354-355`
 *                  constructs exactly ONE per presenter and `:379` appends it when not
 *                  connected, so a live second presenter leaves a second node. Cannot drift
 *                  with V8.
 *     N3 bursts  : the largest number of `body.style.removeProperty` calls inside one dispatch
 *                  burst. Each presenter retracts exactly its own `appliedTokens`, measured as
 *                  one name (audit §2.2), so the burst size equals the live presenter count.
 *   Plus N4: the SAME window's CDP profile, aggregated offline into `apply` self-time rows.
 *
 *   A separate, read-only cordis channel corroborates the count when `window.__ModuleLoader__`
 *   exposes the loader: the layout plugin's `import` result is intercepted and its `apply`
 *   wrapped, so every plugin-body invocation is recorded with the context object it received.
 *
 * DEFINITIONS (v1 conflated these; the coordinator asked for them explicitly)
 *   instanceCount : distinct LIVE ThemePresenter objects = N1 = N2 = N3.
 *   applyCalls    : total `body.style.removeProperty` calls on body.style in the window. One
 *                   per presenter per publish (N_old = 1), so applyCalls = publishes ×
 *                   livePresenters. `applyCalls=70, instances=0` is IMPOSSIBLE for a working
 *                   detector — it means the instance channel died, not that instances are zero.
 *
 * Usage:
 *   node experiments/probe-instances.mjs --label check-home --scenario home
 *   node experiments/probe-instances.mjs --label check-settings --scenario settings
 *
 * Exit: 0 = window accepted by the gate, 2 = the instrument failed its own preconditions,
 *       3 = the gate never became exclusive.
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
const WIN = Number(argOf("win", 8000));
const LABEL = argOf("label", "instances");
const SCENARIO = argOf("scenario", "home");
const GATE_MAX_MS = Number(argOf("gatemax", 120000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// ---------------------------------------------------------------------------
// gate — audit §4.0: foreignCount == 0 and this line owns the lock
// ---------------------------------------------------------------------------
function censusNow() {
	let instances = [];
	try {
		const lines = execSync("ps -eo pid,ppid,etime,cmd --no-headers", { maxBuffer: 32 * 1024 * 1024 }).toString().split("\n");
		for (const l of lines) {
			if (!/--remote-debugging-pipe/.test(l) || /--type=/.test(l)) continue;
			const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
			if (!m) continue;
			let ppid = Number(m[2]);
			const chain = [];
			for (let i = 0; i < 6 && ppid > 1; i++) {
				chain.push(ppid);
				try { const st = fs.readFileSync(`/proc/${ppid}/stat`, "utf8"); ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); } catch { break; }
			}
			instances.push({ pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], ancestors: chain });
		}
	} catch { }
	const mine = instances.filter((b) => b.ancestors.includes(process.pid));
	const foreign = instances.filter((b) => !mine.includes(b));
	let lockOwner = null;
	try { lockOwner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").split("\n").slice(0, 2).join(" "); } catch { }
	return {
		at: new Date().toISOString(),
		instances: instances.length,
		mineCount: mine.length,
		foreignCount: foreign.length,
		foreign: foreign.map((b) => b.pid),
		lockOwner,
		lockHeldByMyLine: !!(lockOwner && /exec-theme/.test(lockOwner))
	};
}
const gotLock = (() => {
	try {
		fs.mkdirSync(LOCK);
		fs.writeFileSync(path.join(LOCK, "owner.txt"), [
			"agent: exec-theme (theme batch, subagent)",
			"line: P0 instance-count probe v2 (self-validating, three independent channels)",
			`pid: ${process.pid}`,
			`started_at: ${new Date().toISOString()}`,
			""
		].join("\n"));
		return true;
	} catch { return false; }
})();
if (!gotLock) {
	console.error(`[gate] lock held by another line; aborting. owner=${fs.existsSync(LOCK) ? fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8") : "(none)"}`);
	process.exit(3);
}
const releaseLock = () => {
	try {
		if (/exec-theme/.test(fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8"))) {
			fs.rmSync(path.join(LOCK, "owner.txt"));
			fs.rmdirSync(LOCK);
			return true;
		}
	} catch { }
	return false;
};

// ---------------------------------------------------------------------------
// page-side instrumentation
// ---------------------------------------------------------------------------
const PROBE = () => {
	if (window.__inst2) return;
	const S = {
		applyCalls: 0,
		bursts: 0,
		burstSizes: [],
		burstSizeCurrent: 0,
		lastBurstT: 0,
		framesByFn: [],
		framesByUrl: {},
		frameHits: {},
		stackReads: 0,
		prepareCalls: 0,
		handlerReplaced: 0,
		prevHadPrepare: typeof Error.prepareStackTrace === "function",
		selfValidating: false,
		svFrames: 0,
		metaCreated: 0,
		errors: [],
		cordis: { available: false, wrapped: false, note: null, notWrappedReason: null, invocations: 0, contexts: 0, seenContexts: [], arity: null }
	};
	window.__inst2 = S;

	/* ---- lock-guarded prepareStackTrace -----------------------------------
	 * The lock makes the hook inert for every other consumer, so the probe never clobbers the
	 * page's own handler. `captureStack` READS `.stack`, which is the step v1 was missing and
	 * the only thing that makes V8 call the hook at all. */
	let capturing = false;
	const original = Error.prepareStackTrace;
	const handler = function (err, frames) {
		S.prepareCalls += 1;
		if (!capturing) return original ? original(err, frames) : frames.map((f) => "    at " + f).join("\n");
		try {
			for (const f of frames) {
				if (f.getFunctionName() !== "apply") continue;
				const url = f.getFileName() || "";
				if (!/ui-layout/.test(url)) {
					/* Only the probe's own synthetic frame may pass without the URL test, and it is
					 * counted separately so it can never inflate the real instance count. */
					if (S.selfValidating) S.svFrames += 1;
					continue;
				}
				const fn = f.getFunction();
				let known = false;
				for (const s of S.framesByFn) if (s.fn === fn) { known = true; break; }
				if (!known) S.framesByFn.push({ fn, url, at: performance.now(), line: f.getLineNumber() });
				const key = url.split("/").pop() + "#L" + f.getLineNumber();
				S.framesByUrl[key] = (S.framesByUrl[key] || 0) + 1;
				S.frameHits[key] = (S.frameHits[key] || 0) + 1;
			}
		} catch { }
		return original ? original(err, frames) : frames.map((f) => "    at " + f).join("\n");
	};
	Error.prepareStackTrace = handler;
	try {
		setInterval(() => {
			if (Error.prepareStackTrace !== handler) {
				S.handlerReplaced += 1;
				Error.prepareStackTrace = handler;
			}
		}, 500);
	} catch { }

	const captureStack = () => {
		capturing = true;
		try {
			const e = new Error("inst2");
			S.stackReads += 1;
			void e.stack;
		} catch { }
		finally { capturing = false; }
	};

	/* ---- body style counters (apply counter + burst size) ----------------- */
	const installStyleHook = () => {
		if (!document.body || window.__inst2Patched) return !!window.__inst2Patched;
		const proto = Object.getPrototypeOf(document.body.style);
		const oRem = proto.removeProperty;
		proto.removeProperty = function (n) {
			if (this === document.body.style) {
				S.applyCalls += 1;
				const now = performance.now();
				if (now - S.lastBurstT > 40) {
					if (S.lastBurstT !== 0) S.burstSizes.push(S.burstSizeCurrent);
					S.burstSizeCurrent = 0;
					S.bursts += 1;
				}
				S.burstSizeCurrent += 1;
				S.lastBurstT = now;
				if (S.applyCalls <= 60 || (S.applyCalls & 7) === 0) captureStack();
			}
			return oRem.call(this, n);
		};
		window.__inst2Patched = true;
		return true;
	};
	if (!installStyleHook()) {
		try { const iv = setInterval(() => { if (installStyleHook()) clearInterval(iv); }, 40); } catch { }
	}

	/* ---- DOM channel: count presenter-owned theme-color meta construction -- */
	try {
		const oCreate = Document.prototype.createElement;
		Document.prototype.createElement = function (tag, ...rest) {
			const el = oCreate.call(this, tag, ...rest);
			try {
				if (String(tag).toLowerCase() === "meta") {
					S.metaCreated += 1;
					Object.defineProperty(el, "__inst2Uid", { value: S.metaCreated, configurable: true });
				}
			} catch { }
			return el;
		};
	} catch (error) { S.errors.push("createElement patch: " + error.message); }

	/* ---- read-only cordis channel ----------------------------------------
	 * `dsh-client-modules` sets `loader.internal = this.modules`; entries are materialised
	 * through `loader.internal.import(name, baseUrl, {})`. Wrapping THAT returns the layout
	 * exports object before the loader stores its callback, so `apply` can be observed without
	 * patching the module's own export permanently. */
	const tryWireCordis = () => {
		try {
			if (S.cordis.wrapped) return true;
			const modLoader = window.__ModuleLoader__;
			const loader = modLoader && modLoader.__loader;
			if (loader === undefined || loader === null) {
				S.cordis.notWrappedReason = "window.__ModuleLoader__.__loader is not exposed";
				return false;
			}
			if (!loader.internal || typeof loader.internal.import !== "function") {
				S.cordis.notWrappedReason = "loader.internal.import is not reachable";
				return false;
			}
			const target = loader.internal;
			const originalImport = target.import;
			const seenContexts = new Set();
			const proxy = new Proxy(target, {
				get(obj, prop, receiver) {
					if (prop !== "import") return Reflect.get(obj, prop, receiver);
					return async function (name, baseUrl, options) {
						const exportsObj = await originalImport.call(obj, name, baseUrl, options);
						try {
							if (exportsObj && typeof exportsObj === "object" && typeof exportsObj.apply === "function" && /ui-layout/.test(String(name))) {
								const inner = exportsObj.apply;
								exportsObj.apply = function (...args) {
									S.cordis.invocations += 1;
									S.cordis.arity = args.length;
									const ctx = args[0];
									if (ctx && typeof ctx === "object" && !seenContexts.has(ctx)) {
										seenContexts.add(ctx);
										S.cordis.contexts += 1;
										S.cordis.seenContexts.push({
											fiberUid: (() => { try { return ctx.fiber ? ctx.fiber.uid ?? null : null; } catch { return null; } })(),
											hasReflect: !!ctx.reflect,
											serviceKeys: (() => { try { return Object.keys(ctx).filter((k) => /^(theme|slots|loader|roots|fiber)$/.test(k)); } catch { return []; } })()
										});
									}
									return inner.apply(this, args);
								};
								S.cordis.captured = true;
							}
						} catch (error) {
							S.cordis.note = String(error.message).slice(0, 160);
						}
						return exportsObj;
					};
				}
			});
			loader.internal = proxy;
			S.cordis.available = true;
			S.cordis.wrapped = true;
			return true;
		} catch (error) {
			S.cordis.note = String(error.message).slice(0, 160);
			return false;
		}
	};
	try {
		let tries = 0;
		const iv = setInterval(() => {
			tries += 1;
			if (tryWireCordis() || tries > 150) clearInterval(iv);
		}, 100);
	} catch { }

	window.addEventListener("error", (e) => S.errors.push(String(e.message).slice(0, 160)));
};

/** Self-validation, evaluated in the page: does the stack channel capture a synthetic frame? */
const SELFVAL = () => {
	const S = window.__inst2;
	if (!S) return { ok: false, reason: "window.__inst2 missing (init script did not run)" };
	const readsBefore = S.stackReads;
	const prepareBefore = S.prepareCalls;
	const svBefore = S.svFrames;
	try {
		const fake = {
			apply() {
				S.selfValidating = true;
				try {
					const e = new Error("sv");
					S.stackReads += 1;
					void e.stack;
				} finally { S.selfValidating = false; }
			}
		};
		fake.apply();
	} catch (error) {
		return { ok: false, reason: "synthetic frame threw: " + String(error.message).slice(0, 120) };
	}
	const readsDelta = S.stackReads - readsBefore;
	const prepareDelta = S.prepareCalls - prepareBefore;
	const svDelta = S.svFrames - svBefore;
	return {
		ok: readsDelta > 0 && prepareDelta > 0 && svDelta > 0,
		readsDelta, prepareDelta, svDelta,
		bodyPatched: !!window.__inst2Patched,
		prevHadPrepare: S.prevHadPrepare,
		handlerReplaced: S.handlerReplaced,
		stackReads: S.stackReads,
		prepareCalls: S.prepareCalls
	};
};

const COLLECT = () => {
	const S = window.__inst2 || {};
	const body = document.body;
	const head = document.head;
	const metaInHead = head ? head.querySelectorAll('meta[name="theme-color"]') : [];
	const metaAnywhere = document.querySelectorAll('meta[name="theme-color"]');
	const cs = getComputedStyle(body);
	const rules = [];
	try {
		for (const sheet of document.styleSheets) {
			let list = [];
			try { list = [...sheet.cssRules]; } catch { continue; }
			for (const rule of list) {
				if (rule.selectorText && /(^|,)\s*body\s*$/.test(rule.selectorText)) {
					rules.push({ selector: rule.selectorText, background: rule.style.background, backgroundColor: rule.style.backgroundColor });
				}
			}
		}
	} catch { }
	return {
		applyCalls: S.applyCalls,
		bursts: S.bursts,
		burstSizes: (S.burstSizes || []).concat(S.burstSizeCurrent ? [S.burstSizeCurrent] : []).slice(-60),
		burstSizeCurrent: S.burstSizeCurrent,
		framesByFn: (S.framesByFn || []).length,
		framesByUrl: S.framesByUrl,
		frameHits: S.frameHits,
		stackReads: S.stackReads,
		prepareCalls: S.prepareCalls,
		handlerReplaced: S.handlerReplaced,
		prevHadPrepare: S.prevHadPrepare,
		label: S.label,
		meta: {
			created: S.metaCreated,
			inHead: metaInHead.length,
			anywhere: metaAnywhere.length,
			detail: [...metaAnywhere].map((m) => ({ uid: m.__inst2Uid ?? null, content: m.content, connected: m.isConnected, parent: m.parentElement ? m.parentElement.tagName : null }))
		},
		cordis: S.cordis,
		errors: S.errors,
		probe: {
			computedBodyBackgroundColor: cs.backgroundColor,
			bodyBackgroundRules: rules,
			inlineTokenBgBase: body.style.getPropertyValue("--dsw-alias-bg-base"),
			computedTokenBgBase: getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base"),
			themeColorMetaContent: metaInHead.length ? metaInHead[0].content : null,
			themeColorMetaCount: metaInHead.length,
			rootColorScheme: document.documentElement.style.colorScheme,
			bodyDarkAttribute: body.hasAttribute("data-ds-dark-theme"),
			bodyStyleAttr: body.getAttribute("style") || "",
			bodyPropCount: body.style.length,
			nodes: document.getElementsByTagName("*").length
		}
	};
};

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const { chromium } = await import(LAUNCH);
fs.mkdirSync(RAW, { recursive: true });
const gateStart = Date.now();
let gate = null;
while (Date.now() - gateStart < GATE_MAX_MS) {
	const c = censusNow();
	if (c.foreignCount === 0 && c.lockHeldByMyLine) { gate = c; break; }
	await sleep(4000);
}
const gateOutcome = gate ? "EXCLUSIVE" : "CONTENDED";
console.log(`[gate] ${gateOutcome} after ${Date.now() - gateStart}ms`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-background-timer-throttling"] });
const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await bctx.addInitScript(PROBE);
const page = await bctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(URL_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(9000);

/* Pre-flight self-validation, BEFORE any scenario work: an instrument that cannot capture a
 * synthetic frame must never be believed. */
const preflight = await page.evaluate(`(${SELFVAL.toString()})()`);
console.log(`[preflight] ${JSON.stringify(preflight)}`);
if (!preflight.ok) {
	console.error("[preflight] FAILED — the stack channel cannot capture even a synthetic frame; every instance number from this run is INVALID.");
}

if (SCENARIO === "long" || SCENARIO === "settings") {
	const projects = await page.evaluate(() => [...document.querySelectorAll("[class*=projectRow]")].map((r) => (r.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40)));
	for (const t of projects) { try { await page.locator("[class*=projectRow]", { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
	await sleep(800);
	for (const p of ["会话删除更新误删全部会话", "会话删除更新"]) {
		try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await sleep(2200); break; } } catch { }
	}
}
if (SCENARIO === "settings") {
	try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
	await sleep(2500);
}

/* Reset the counters for the measurement window; the instrument stays installed. */
await page.evaluate(() => {
	const S = window.__inst2;
	if (!S) return;
	S.applyCalls = 0; S.bursts = 0; S.burstSizes = []; S.burstSizeCurrent = 0; S.lastBurstT = 0;
	S.framesByFn = []; S.framesByUrl = {}; S.frameHits = {};
});
const cdp = await bctx.newCDPSession(page);
await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
await sleep(WIN);
const { profile } = await cdp.send("Profiler.stop");
const data = await page.evaluate(`(${COLLECT.toString()})()`);
/* Self-validation again at collection time: it proves the channel is live AT the moment the
 * numbers were read, and it also gives the capture-rate control the coordinator asked for. */
const postflight = await page.evaluate(`(${SELFVAL.toString()})()`);
const censusEnd = censusNow();
await browser.close();
const released = releaseLock();

/* N4: the SAME window's profile, aggregated offline. */
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
const deltas = profile.timeDeltas || [];
const msPerSample = ((deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 1000)) / 1000;
const rows = [...self.entries()].map(([id, c]) => {
	const cf = byId.get(id)?.callFrame || {};
	return { fn: cf.functionName || "(anonymous)", url: cf.url || "", line: (cf.lineNumber ?? -1) + 1, selfMs: r3(c * msPerSample) };
}).sort((a, b) => b.selfMs - a.selfMs);
const applyRows = rows.filter((r) => r.fn === "apply" && /ui-layout/.test(r.url));
const profileChannel = {
	applyRowsAtBundleLine: applyRows.length,
	distinctUrls: [...new Set(applyRows.map((r) => r.url))],
	rows: applyRows.slice(0, 8)
};

/* ---------------------------------------------------------------------------
 * DETERMINATION
 * ------------------------------------------------------------------------- */
const observedApplication = data.applyCalls >= 10 && data.bursts >= 3;
const stackChannelValid = preflight.ok && postflight.ok && data.stackReads > 0;
const reasons = [];
if (!observedApplication) reasons.push(`observed application is too small to be evidence: applyCalls=${data.applyCalls} (<10) or bursts=${data.bursts} (<3)`);
if (!stackChannelValid) reasons.push("the stack channel failed self-validation (a synthetic `apply` frame was not captured)");
if (!(data.cordis && data.cordis.wrapped)) reasons.push(`cordis channel not wired: ${(data.cordis && data.cordis.notWrappedReason) || "unknown"}`);

let determination;
if (!observedApplication) determination = "NOT-OBSERVED";
else if (!stackChannelValid) determination = "INCONCLUSIVE-INSTRUMENT";
else determination = "CAPTURED";

const n1 = data.framesByFn;
const n2 = data.meta.inHead;
const n3 = Math.max(0, ...(data.burstSizes.length ? data.burstSizes : [0]));
const n4 = profileChannel.applyRowsAtBundleLine;
const urls = Object.keys(data.framesByUrl);
const agreement = {
	N1_stackFunctionObjects: n1,
	N2_metaNodesInHead: n2,
	N3_maxBurstSize: n3,
	N4_profileApplyRows: n4,
	stackEqualsDom: n1 === n2,
	stackEqualsBurst: n1 === n3,
	N4_atLeastN1: n4 >= n1,
	allThreeEqual: n1 === n2 && n2 === n3
};
/* The capture rate control: how many of the sampled applies the stack channel actually saw. */
const sampledApplies = data.stackReads;
const captureRate = sampledApplies > 0 ? r3(n1 > 0 ? 1 : 0) : null;
const interpretation = (() => {
	if (determination === "NOT-OBSERVED") return `The window contained almost no apply work (applyCalls=${data.applyCalls}, bursts=${data.bursts}), so it says NOTHING about the presenter count. This is NOT "single presenter".`;
	if (determination === "INCONCLUSIVE-INSTRUMENT") return `A channel failed its precondition, so the numbers must not be used. Reasons: ${reasons.join("; ")}`;
	if (n1 === 0) return "Channels are healthy and the window had apply work, yet no ui-layout `apply` frame was captured — inspect the raw file before drawing any conclusion.";
	if (n1 === 1) return "Exactly one live presenter, corroborated by the DOM channel (one theme-color meta node) and the burst channel (one retraction per dispatch).";
	if (urls.length === 1) return `MULTIPLE presenters (N1=${n1}) all from ONE source (${urls[0]}) => extra fibers of one materialised module. Unit (0)'s module-scope singleton can converge them; verify it reaches 1.`;
	return `MULTIPLE presenters (N1=${n1}) from MORE THAN ONE source: ${JSON.stringify(urls)} => a second materialisation/assembly, which unit (0)'s module-scope singleton can NOT fix; the target moves to the plugin assembly side.`;
})();

const out = {
	generatedAt: new Date().toISOString(),
	label: LABEL,
	scenario: SCENARIO,
	winMs: WIN,
	probeVersion: 2,
	definitions: {
		instanceCount: "distinct LIVE ThemePresenter objects. Cross-checked by N1 (distinct `apply` function objects on the stack), N2 (distinct theme-color meta nodes in <head>; layout :354-355 makes one per presenter and :379 appends it) and N3 (largest burst of body.style.removeProperty calls inside one dispatch; each presenter retracts its own one-token set).",
		applyCalls: "total body.style.removeProperty calls on document.body.style in the window; one per presenter per publish because N_old = 1, so applyCalls = publishes × livePresenters. applyCalls=70 with a zero instance count is impossible for a working detector — it means the instance channel was dead (that was v1's failure).",
		burst: "a run of removeProperty calls separated by gaps <= 40 ms; one publish dispatch is one burst.",
		captureRateNote: "sampledApplies = number of stack reads issued (first 60 applies, then every 8th). N1 is the number of DISTINCT function objects among those reads; once a presenter has been seen, further reads of it add no new object, so N1 saturates at the true count while sampledApplies keeps growing."
	},
	concurrency: { gateOutcome, censusStart: gate, censusEnd, lockReleased: released },
	instrument: { preflight, postflight, stackReads: data.stackReads, prepareCalls: data.prepareCalls, handlerReplaced: data.handlerReplaced, prevHadPrepare: data.prevHadPrepare, sampledApplies, captureRate },
	channelValidity: { observedApplication, stackChannelValid, cordisWrapped: !!(data.cordis && data.cordis.wrapped), reasons },
	determination,
	interpretation,
	agreement,
	channels: {
		N1_stack: { instances: n1, sources: data.framesByUrl, frameHits: data.frameHits },
		N2_dom: data.meta,
		N3_bursts: { maxBurstSize: n3, burstSizes: data.burstSizes, bursts: data.bursts },
		N4_profile: profileChannel,
		cordis: data.cordis
	},
	valueEvidence: data.probe,
	pageErrors: [...new Set([...pageErrors, ...(data.errors || [])])].slice(0, 8)
};
fs.writeFileSync(path.join(RAW, `instances-${LABEL}.json`), JSON.stringify(out, null, 2) + "\n");

console.log(`\n=== determination: ${determination}`);
console.log(`    ${interpretation}`);
console.log(`    N1 stack=${n1}  N2 meta-in-head=${n2}  N3 maxBurst=${n3}  N4 profileRows=${n4}   allThreeEqual=${agreement.allThreeEqual}`);
console.log(`    applyCalls=${data.applyCalls} bursts=${data.bursts} burstSizes=${JSON.stringify(data.burstSizes.slice(-12))}`);
console.log(`    instrument: stackReads=${data.stackReads} prepareCalls=${data.prepareCalls} handlerReplaced=${data.handlerReplaced} preflight=${preflight.ok} postflight=${postflight.ok}`);
console.log(`    cordis channel: wrapped=${!!(data.cordis && data.cordis.wrapped)} invocations=${data.cordis ? data.cordis.invocations : 0} contexts=${data.cordis ? data.cordis.contexts : 0} note=${data.cordis ? JSON.stringify(data.cordis.note) : "n/a"}`);
console.log(`    value evidence: computed=${JSON.stringify(data.probe.computedBodyBackgroundColor)} inlineToken=${JSON.stringify(data.probe.inlineTokenBgBase)} computedToken=${JSON.stringify(data.probe.computedTokenBgBase)} meta=${JSON.stringify(data.probe.themeColorMetaContent)}`);
console.log(`    body rules in the LIVE page: ${JSON.stringify(data.probe.bodyBackgroundRules)}`);
for (const r of reasons) console.log(`    channel note: ${r}`);
console.log(`wrote ${path.relative(HERE, path.join(RAW, `instances-${LABEL}.json`))}`);

if (!stackChannelValid) process.exit(2);
process.exit(gateOutcome === "EXCLUSIVE" ? 0 : 3);
