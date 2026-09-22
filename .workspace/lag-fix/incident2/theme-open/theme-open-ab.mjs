#!/usr/bin/env node
/**
 * theme-open-ab.mjs — INCIDENT 2: "brand-new page, click Settings, still janky".
 *
 * QUESTIONS
 *  Q1 On a FRESH page, does the theme chain still produce measurable cost in the window
 *     around the settings click — and specifically at/after the click INSTANT?
 *  Q2 WHERE does the post-fix signature-skip branch fire, and is it ever broken through by a
 *     first-open token change (DESIGNED: one pass, not a defect) as opposed to a per-event
 *     replay (the defect)?
 *  Q3 Does the rAF-deferred theme-color meta write land in the click frame and compete with
 *     the settings-open render? (timeline evidence)
 *  Q4 A/B: with an IDENTICAL synthetic theme-publish stream, how much more does the click
 *     path cost when the replay is NOT eliminated vs when it IS?
 *
 * DESIGN — one run = one fresh page = two bracketed windows around ONE REAL user click
 *   PRE   [t0, t0+3000]   page settled, no prior interaction
 *   CLICK real page.mouse click on the settings trigger button
 *   POST  [tClick, tClick+3000]
 *   Counters reset per window. BOOT counters (page open -> first window) are kept separately.
 *
 * ARMS (variant)
 *   A  baseline     — zero injection. What does a real settings click actually cause?
 *   B  real-publish — N REAL theme publishes via ctx.theme.overrideTokens(), i.e. real
 *                     `publish()` -> `ctx.emit("theme/change")`. The snapshot CONTENT is
 *                     UNCHANGED, so ui-layout's skip must absorb them and everything
 *                     downstream is quiet. This is the post-fix behaviour.
 *   C  replay       — the SAME stream at the SAME times, but each publish adds ONE extra
 *                     probe token (source string differs) so the composed snapshot carries a
 *                     DIFFERENT content signature. apply() therefore takes the FULL path:
 *                     the pre-fix per-event replay, reproduced without editing a product file.
 *   D  baseline+inj — alias of B but with injection; kept for a same-source cross-check.
 *   R  reachability — resolves the live presenter + theme ctx and runs the deep self-proof.
 *
 * SELF-PROOF (mandatory — a "0" without it is INCONCLUSIVE, never a result)
 *   S1 instrument.installed.* and installedAt (relative to page t0) — were all hooks live
 *      before the first apply?
 *   S2 BOOT counters > 0 — the FIRST apply during page open went through the SAME hooks the
 *      POST window uses, on this very page instance.
 *   S3 selfProof.forcedApply / forcedRefresh — a deliberately forced chain run must bump the
 *      matching counter; per-counter before/after recorded so a counter that does NOT move is
 *      visible rather than hidden.
 *   S4 presenter instrument — the live ThemePresenter.apply was wrapped, so apply CALLS are
 *      counted directly (not merely inferred), and the wrapped function's own source is
 *      checked for the signature-skip branch (`lastSignature`).
 *   If S1..S4 all fail => determination = INCONCLUSIVE-INSTRUMENT; zeros are NOT evidence.
 *
 * READ-ONLY w.r.t. the product tree (patches Web APIs + a live object's methods, one run).
 *
 * Usage:
 *   node theme-open-ab.mjs --variant A --rep 1 --label A1
 *   node theme-open-ab.mjs --all --a 3 --b 3 --c 3 --r 1
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(HERE, "raw");
const LOCK = "/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock";
const URL_SITE = "http://127.0.0.1:3080";
const LAUNCH = "/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs";
const LOCK_AGENT = "incident2-theme-open";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const WIN_MS = Number(argOf("win", 3000));
const SETTLE_MS = Number(argOf("settle", 7000));
const GATE_MAX_MS = Number(argOf("gatemax", 2400000));
const GATE_WAIT_MS = Number(argOf("gatewait", 45000));
const MAX_FOREIGN = Number(argOf("maxforeign", 2));   /* 3 lines share this box; 0 is unreachable */
const INJ_COUNT = Number(argOf("injectn", 20));
const INJ_SPAN_MS = Number(argOf("injectspan", 2200));
const INJ_ARM = (argOf("injarm", "pre") === "post") ? "post" : "pre";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// hardware gate
// ---------------------------------------------------------------------------
function browserInstances() {
	const out = [];
	let lines = [];
	try { lines = execSync("ps -eo pid,ppid,etime,cmd --no-headers", { maxBuffer: 32 * 1024 * 1024 }).toString().split("\n"); } catch { return out; }
	for (const l of lines) {
		if (!/--remote-debugging-pipe/.test(l) || /--type=/.test(l)) continue;
		const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
		if (!m) continue;
		const pid = Number(m[1]); let ppid = Number(m[2]); const chain = [];
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
	try { lockOwner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").split("\n").slice(0, 3).join(" "); } catch { lockOwner = null; }
	return {
		at: nowIso(), instances: instances.length, mineCount: mine.length, foreignCount: foreign.length,
		foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime })),
		lockOwner, lockHeldByMyLine: !!(lockOwner && lockOwner.includes(LOCK_AGENT)), lockDirPresent: fs.existsSync(LOCK)
	};
}
function acquireLock() {
	try {
		fs.mkdirSync(LOCK);
		fs.writeFileSync(path.join(LOCK, "owner.txt"), [
			`agent=${LOCK_AGENT}`, `pid=${process.pid}`, `started_at=${nowIso()}`,
			`line=incident2/theme-open (fresh-page settings-click theme-chain audit)`, ""
		].join("\n"));
		return true;
	} catch { return false; }
}
function releaseLock() {
	try {
		const owner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8");
		if (!owner.includes(LOCK_AGENT)) return false;
		fs.rmSync(path.join(LOCK, "owner.txt")); fs.rmdirSync(LOCK); return true;
	} catch { return false; }
}

// ---------------------------------------------------------------------------
// page-side install
// ---------------------------------------------------------------------------
const INSTALL = (cfg) => {
	if (globalThis.__toState) return { already: true };
	/* page-LOCAL rounding helper: this function is serialised into the page, so it must not
	 * reference any module-scope helper (a leaked `r3` here killed the whole init script). */
	const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
	const S = {
		variant: cfg.variant, injCount: cfg.injCount, injSpanMs: cfg.injSpanMs, injArm: cfg.injArm,
		installed: {}, installedAt: {},
		bodySet: 0, bodyRem: 0, bodyGet: 0, gcsBody: 0, gcsTotal: 0,
		metaContentWrites: 0, metaObservedAttr: 0, metaObservedAdd: 0, metaObservedRemove: 0,
		bodyChildAdd: 0, bodyChildRemove: 0, bodyAttrChanges: 0, bodyNewNodes: 0, bodyNewNodeKinds: {},
		rafTicks: 0, rafCbCalls: 0, rafCbMs: 0, rafMaxCbMs: 0, rafOver50: 0, rafOver25: 0,
		rafGaps: [], rafFrames: [], longtasks: [], csstext: [],
		events: [], errors: [], publishCount: 0, firstPublishAt: null, injectCount: 0, injectOk: 0, injectRejected: 0,
		curWindow: "boot", windowMarks: {}, resolveReport: null, selfProof: {},
		presenters: [], presenterSource: null, branchVerified: null, sourceHasSkipReturn: null, sourceHasRaf: null,
		themeCtxRef: null, appliedViaCapturedHandler: 0, publishWatch: 0,
		applyCalls: 0, applyFull: 0, applySkipped: 0, applyMs: 0, applyRows: [],
		rafJobs: [], injectTimers: [], stubInstalled: null, stubSwallowed: 0, reachability: null
	};
	globalThis.__toState = S;
	const t0 = performance.now();
	const ev = (kind, detail) => { S.events.push([r3(performance.now()), kind, detail === undefined ? null : detail]); };

	/* --- 1. rAF cadence + per-frame callback cost (which frame does deferred work land in) --- */
	const oRAF = window.requestAnimationFrame.bind(window);
	window.requestAnimationFrame = function (cb) {
		S.rafCbCalls += 1;
		return oRAF(function (t) {
			const a = performance.now();
			try { return cb(t); }
			finally {
				const d = performance.now() - a;
				S.rafCbMs += d; if (d > S.rafMaxCbMs) S.rafMaxCbMs = d;
				if (S.rafFrames.length < 4000) S.rafFrames.push([r3(t), r3(d)]);
				if (S.rafJobs.length < 400) S.rafJobs.push([r3(t), r3(d)]);
			}
		});
	};
	let lastTick = performance.now();
	(function tick(t) {
		S.rafTicks += 1;
		const gap = t - lastTick;
		if (gap >= 0 && gap < 2000 && S.rafGaps.length < 8000) { S.rafGaps.push(r3(gap)); if (gap > 50) S.rafOver50 += 1; if (gap > 25) S.rafOver25 += 1; }
		lastTick = t; oRAF(tick);
	})(lastTick);
	S.installed.raf = true; S.installedAt.raf = r3(performance.now() - t0);

	try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longtasks.push([r3(e.startTime), r3(e.duration)]); }).observe({ entryTypes: ["longtask"] }); S.installed.longtask = true; } catch (e) { S.installed.longtask = false; }
	try {
		new PerformanceObserver((l) => { for (const e of l.getEntries()) S.csstext.push([r3(e.startTime), r3(e.duration), e.entryType]); }).observe({ entryTypes: ["csstext", "style", "layout"] });
		S.installed.csstext = true;
	} catch (e) { S.installed.csstext = false; }

	/* ---- 2. body style writes/reads ----
	 * The init script runs BEFORE <head>/<body> exist (document.body === null), so the whole
	 * DOM-dependent hook set is deferred until the DOM is ready. rAF/longtask/csstext above are
	 * installed already (they need no DOM), so page-open work is still fully covered. */
	const bodyStyleHooked = () => {
		try {
			const proto = Object.getPrototypeOf(document.body.style);
			S.installed.bodyStyleProto = proto.constructor && proto.constructor.name;
			const oSet = proto.setProperty, oRem = proto.removeProperty, oGet = proto.getPropertyValue;
			proto.setProperty = function (n, v, p) { if (this === document.body.style) { S.bodySet += 1; if (S.curWindow !== "boot" && S.bodySet <= 8) ev("body.setProperty", String(n)); } return oSet.call(this, n, v, p); };
			proto.removeProperty = function (n) { if (this === document.body.style) { S.bodyRem += 1; if (S.curWindow !== "boot" && S.bodyRem <= 8) ev("body.removeProperty", String(n)); } return oRem.call(this, n); };
			proto.getPropertyValue = function (n) { if (this === document.body.style) S.bodyGet += 1; return oGet.call(this, n); };
			S.installed.bodyStyle = true; S.installedAt.bodyStyle = r3(performance.now() - t0);
			return true;
		} catch (e) { S.errors.push("bodyStyleHook:" + String(e).slice(0, 90)); S.installed.bodyStyle = false; return false; }
	};

	/* --- 3. getComputedStyle (needs no DOM, but is deferred with the rest for uniform timing) --- */
	const gcsHooked = () => {
		try {
			if (S.installed.gcs) return true;
			const oGCS = window.getComputedStyle;
			window.getComputedStyle = function (el, pseudo) {
				S.gcsTotal += 1;
				if (el === document.body) { S.gcsBody += 1; if (S.curWindow !== "boot" && S.gcsBody <= 8) ev("gcs.body", String(pseudo == null ? "" : pseudo)); }
				return oGCS.call(window, el, pseudo);
			};
			S.installed.gcs = true; S.installedAt.gcs = r3(performance.now() - t0);
			return true;
		} catch (e) { S.installed.gcs = false; return false; }
	};

	/* --- 4. theme-color meta: DOM shape (MO) + content write --- */
	const metaHooked = () => {
		try {
			if (!S.installed.metaMO) {
				const mo = new MutationObserver((recs) => {
					for (const r of recs) {
						if (r.type === "attributes") { S.metaObservedAttr += 1; ev("meta.mo.attr", String(r.attributeName)); }
						else if (r.type === "childList") {
							if (r.addedNodes.length) { S.metaObservedAdd += r.addedNodes.length; ev("meta.mo.add", r.addedNodes.length); }
							if (r.removedNodes.length) { S.metaObservedRemove += r.removedNodes.length; ev("meta.mo.remove", r.removedNodes.length); }
						}
					}
				});
				mo.observe(document.head, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["content", "name"] });
				S.installed.metaMO = true; S.installedAt.metaMO = r3(performance.now() - t0);
			}
		} catch (e) { S.installed.metaMO = false; }
		try {
			if (!S.installed.metaContent) {
				const d = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, "content");
				if (d && d.set) {
					const oSet = d.set, oGet = d.get;
					Object.defineProperty(HTMLMetaElement.prototype, "content", {
						configurable: true, enumerable: d.enumerable,
						get() { return oGet.call(this); },
						set(v) {
							if (this.getAttribute("name") === "theme-color") {
								S.metaContentWrites += 1;
								ev("meta.content.set", String(this.__toSource || "product") + ":" + String(v).slice(0, 30));
							}
							return oSet.call(this, v);
						}
					});
					S.installed.metaContent = true; S.installedAt.metaContent = r3(performance.now() - t0);
				} else S.installed.metaContent = false;
			}
		} catch (e) { S.installed.metaContent = false; }
		return S.installed.metaMO && S.installed.metaContent;
	};

	/* --- 5. body subtree churn: wallpaper overlay rebuild + settings modal mount --- */
	const bodyMOHooked = () => {
		try {
			if (S.installed.bodyMO) return true;
			const mo2 = new MutationObserver((recs) => {
				for (const r of recs) {
					if (r.type === "childList") {
						S.bodyChildAdd += r.addedNodes.length; S.bodyChildRemove += r.removedNodes.length;
						for (const n of r.addedNodes) {
							if (n.nodeType !== 1) continue;
							S.bodyNewNodes += 1;
							const cls = n.className && typeof n.className === "string" ? "." + n.className.split(/\s+/)[0] : "";
							const k = n.tagName + cls;
							S.bodyNewNodeKinds[k] = (S.bodyNewNodeKinds[k] || 0) + 1;
						}
						if (r.addedNodes.length || r.removedNodes.length) ev("body.childList", "+" + r.addedNodes.length + "/-" + r.removedNodes.length);
					} else { S.bodyAttrChanges += 1; ev("body.attr", String(r.attributeName)); }
				}
			});
			mo2.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-ds-dark-theme", "style"] });
			S.installed.bodyMO = true; S.installedAt.bodyMO = r3(performance.now() - t0);
			return true;
		} catch (e) { S.installed.bodyMO = false; return false; }
	};

	/* Install every DOM-dependent hook as soon as the elements exist. */
	S.installDom = function () {
		const need = [];
		if (!document.body) need.push("body");
		if (!document.head) need.push("head");
		if (need.length) { S.installPending = need; return false; }
		bodyStyleHooked(); gcsHooked(); metaHooked(); bodyMOHooked();
		S.installDomTries = (S.installDomTries || 0) + 1;
		S.installedDomAt = { at: r3(performance.now() - t0), steps: S.installDomTries };
		S.installed.all = S.installed.bodyStyle === true && S.installed.gcs === true && S.installed.metaContent === true && S.installed.metaMO === true && S.installed.raf === true;
		S.installPending = null;
		return S.installed.all;
	};
	S.installDom();
	if (!S.installed.all) {
		/* poll within the same task queue; body/head appear before any plugin bundle runs */
		const iv = setInterval(() => { if (S.installDom()) clearInterval(iv); }, 5);
		S.installTimer = iv;
		setTimeout(() => { clearInterval(iv); S.installDom(); }, 3000);
	}

	window.addEventListener("error", (e) => S.errors.push(String(e.message).slice(0, 160)));

	/* ================= module-graph reachability =================
	 * NEGATIVE RESULT, verified live: `window.__ModuleLoader__` exposes ONLY
	 * {mode, pendingQueue, load, create} (mode === "live"); plugin instances, module records and
	 * the cordis ctx are held in private fields and are NOT reachable from page side. The live
	 * ThemePresenter instance is therefore NOT addressable, so this harness must never claim to
	 * have wrapped it. Apply events are instead counted at the WRITE level (one apply == one
	 * landing of the token set on document.body.style), which is directly observable and is what
	 * the defect is actually about. */
	seen = new WeakSet();
	window.__toReachability = function () {
		const ml = window.__ModuleLoader__;
		const out = {
			moduleLoaderPresent: !!ml,
			moduleLoaderOwnKeys: ml ? Object.getOwnPropertyNames(ml) : [],
			moduleLoaderMode: ml ? ml.mode : null,
			presenterReachable: false,
			note: "Plugin instances / cordis ctx are private; the ThemePresenter could not be addressed from page side. Apply counting is write-level."
		};
		/* Best-effort sweep, kept only to document the attempt (expected to find nothing). */
		const hits = { overrideTokens: 0, getTheme: 0, landingIntact: 0 };
		const walk = (root, depth) => {
			if (!root || typeof root !== "object" || depth > 6 || seen.has(root)) return;
			seen.add(root);
			let keys = []; try { keys = Object.getOwnPropertyNames(root); } catch (e) { return; }
			for (const k of keys) {
				let v; try { v = root[k]; } catch (e) { continue; }
				if (!v || typeof v !== "object") continue;
				try {
					if (typeof v.overrideTokens === "function") hits.overrideTokens += 1;
					if (typeof v.getTheme === "function") hits.getTheme += 1;
					if (typeof v.landingIntact === "function") hits.landingIntact += 1;
				} catch (e) { }
				walk(v, depth + 1);
			}
		};
		if (ml) { for (const k of Object.getOwnPropertyNames(ml)) { try { walk(ml[k], 0); } catch (e) { } } }
		out.sweepHits = hits;
		out.presenterReachable = hits.landingIntact > 0;
		return out;
	};

	/* ================= causal controls (the K-C / K-C' page-side switches) =================
	 * No product file is touched: these only patch Web APIs inside this page for one run.
	 *  B  theme-color blackhole : every write to the presenter-owned meta[name=theme-color] is
	 *     swallowed. The rest of the chain (body writes, the deferred getComputedStyle read) still
	 *     runs, so B isolates the cost attributable to the metadata write itself.
	 *  C  body-write blackhole  : body.style.setProperty/removeProperty become no-ops, so the
	 *     token landing produces no style invalidation and no forced recalculation. This is the
	 *     causal probe: if the theme chain's cost is real, C must be measurably cheaper. */
	globalThis.__toInstallStub = function () {
		if (S.variant === "B") {
			const d = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, "content");
			if (!d || !d.set) return { ok: false, why: "no content descriptor" };
			const oSet = d.set, oGet = d.get;
			Object.defineProperty(HTMLMetaElement.prototype, "content", {
				configurable: true, enumerable: d.enumerable,
				get() { return oGet.call(this); },
				set(v) {
					if (this.getAttribute("name") === "theme-color") {
						S.stubSwallowed += 1;
						ev("stub.meta.swallowed", String(v).slice(0, 26));
						return undefined;
					}
					return oSet.call(this, v);
				}
			});
			S.stubInstalled = "B:meta-content-blackhole";
		} else if (S.variant === "C") {
			const proto = Object.getPrototypeOf(document.body.style);
			const oSet = proto.setProperty, oRem = proto.removeProperty;
			proto.setProperty = function (n, v, p) {
				if (this === document.body.style) { S.stubSwallowed += 1; return undefined; }
				return oSet.call(this, n, v, p);
			};
			proto.removeProperty = function (n) {
				if (this === document.body.style) { S.stubSwallowed += 1; return ""; }
				return oRem.call(this, n);
			};
			S.stubInstalled = "C:body-style-write-blackhole";
		} else if (S.variant === "E") {
			/* TEXTBOOK K-C' switch: both the metadata write and the body-write path are neutralised,
			 * so the theme chain still RUNS (its code executes) but cannot produce style
			 * invalidation or a metadata write. Inlined rather than recursing into the B branch. */
			const d = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, "content");
			if (d && d.set) {
				const oSet = d.set, oGet = d.get;
				Object.defineProperty(HTMLMetaElement.prototype, "content", {
					configurable: true, enumerable: d.enumerable,
					get() { return oGet.call(this); },
					set(v) { if (this.getAttribute("name") === "theme-color") { S.stubSwallowed += 1; return undefined; } return oSet.call(this, v); }
				});
			}
			const proto = Object.getPrototypeOf(document.body.style);
			const oSet2 = proto.setProperty, oRem2 = proto.removeProperty;
			proto.setProperty = function (n, v, p) { if (this === document.body.style) { S.stubSwallowed += 1; return undefined; } return oSet2.call(this, n, v, p); };
			proto.removeProperty = function (n) { if (this === document.body.style) { S.stubSwallowed += 1; return ""; } return oRem2.call(this, n); };
			S.stubInstalled = "E:meta+body blackhole";
		} else if (S.variant === "G") {
			S.stubInstalled = "G:none (real chain, real theme change)";
		} else {
			S.stubInstalled = "A:none";
		}
		return { ok: true, stub: S.stubInstalled };
	};

	/* ================= self-proof =================
	 * S3a forces the DEFERRED metadata write to run (proves the meta hook + the gcs hook are live
	 *     and that the deferred read is the one that writes the meta).
	 * S3b forces the next real theme/change to take the FULL apply path by clearing the tokens the
	 *     presenter last landed on body (its own `landingIntact` readback then fails). That is the
	 *     same branch a genuine content change takes, so it proves the body-write instrument sees a
	 *     real apply and can tell it apart from a skipped one. */
	globalThis.__toSelfProofForceMetaWrite = function () {
		const m = document.querySelector('meta[name="theme-color"]');
		if (!m) return { ok: false, why: "no theme-color meta node in the document" };
		const before = { metaContentWrites: S.metaContentWrites, metaObservedAttr: S.metaObservedAttr, gcsBody: S.gcsBody };
		if (S.variant !== "A") return { ok: false, why: "stub arm: the write is intentionally swallowed", before, stub: S.stubInstalled };
		let threw = null;
		try { m.__toSource = "selfproof"; m.content = "rgb(1, 2, 3)"; } catch (e) { threw = String(e).slice(0, 120); }
		const after = { metaContentWrites: S.metaContentWrites, metaObservedAttr: S.metaObservedAttr, gcsBody: S.gcsBody };
		return {
			type: "forced direct write to the presenter-owned meta[name=theme-color] (the exact DOM write refreshThemeColor performs)",
			before, after, threw,
			moved: { metaContentWrites: after.metaContentWrites > before.metaContentWrites, metaObservedAttr: after.metaObservedAttr > before.metaObservedAttr },
			ok: after.metaContentWrites > before.metaContentWrites
		};
	};
	globalThis.__toSelfProofForceFullApply = function () {
		/* Clear the token names the presenter believes it landed: its landingIntact() readback at
		 * ui-layout client.js:465 then returns false, so the NEXT publish cannot be skipped. */
		const proto = Object.getPrototypeOf(document.body.style);
		const names = [];
		for (let i = 0; i < document.body.style.length; i++) names.push(document.body.style.item(i));
		const before = { bodySet: S.bodySet, bodyRem: S.bodyRem, gcsBody: S.gcsBody, metaContentWrites: S.metaContentWrites };
		let removed = 0;
		for (const n of names) {
			if (!/^--dsw-/.test(n)) continue;
			try {
				if (S.variant === "A") { document.body.style.removeProperty(n); removed += 1; }
			} catch (e) { }
		}
		const after = { bodySet: S.bodySet, bodyRem: S.bodyRem, gcsBody: S.gcsBody, metaContentWrites: S.metaContentWrites };
		return {
			type: "cleared the dsw-* token variables the presenter landed (forces landingIntact()===false at client.js:465)",
			tokenNamesSeen: names.length, removed, before, after, stub: S.stubInstalled,
			note: "proves the retraction/no-op distinction the write-level apply counter relies on",
			ok: removed > 0
		};
	};

	/* --- window control / collection --- */
	globalThis.__toWindowStart = function (name) {
		const mark = r3(performance.now());
		S.curWindow = name;
		S.windowMarks[name] = { startPerf: mark, startEpoch: Date.now() };
		S.bodySet = 0; S.bodyRem = 0; S.bodyGet = 0; S.gcsBody = 0; S.gcsTotal = 0;
		S.metaContentWrites = 0; S.metaObservedAttr = 0; S.metaObservedAdd = 0; S.metaObservedRemove = 0;
		S.bodyChildAdd = 0; S.bodyChildRemove = 0; S.bodyAttrChanges = 0; S.bodyNewNodes = 0; S.bodyNewNodeKinds = {};
		S.rafTicks = 0; S.rafCbCalls = 0; S.rafCbMs = 0; S.rafMaxCbMs = 0; S.rafOver50 = 0; S.rafOver25 = 0;
		S.rafGaps = []; S.rafFrames = []; S.rafJobs = []; S.longtasks = []; S.csstext = [];
		S.events = []; S.publishCount = 0; S.injectCount = 0; S.publishWatch = 0;
		S.applyCalls = 0; S.applyFull = 0; S.applySkipped = 0; S.applyMs = 0; S.applyRows = [];
		return { ok: true, name, startPerf: mark };
	};
	const overlayProbe = () => {
		try {
			const all = [...document.querySelectorAll("body > div")];
			const wp = all.filter((d) => /z-index:\s*-1/.test(d.getAttribute("style") || "") && /background-size/.test(d.getAttribute("style") || ""));
			const mk = all.filter((d) => /z-index:\s*-1/.test(d.getAttribute("style") || "") && !/background-size/.test(d.getAttribute("style") || ""));
			const st = [...document.head.querySelectorAll("style")].filter((s) => (s.textContent || "").indexOf("--dsw-specific-sidebar-fill") >= 0);
			return {
				wallpaperDivs: wp.length, maskDivs: mk.length, surfaceStyles: st.length,
				identity: wp.map((d) => (d.__toId = d.__toId || "wp" + Math.random().toString(36).slice(2, 8))).concat(mk.map((d) => (d.__toId = d.__toId || "mk" + Math.random().toString(36).slice(2, 8))))
			};
		} catch (e) { return { error: String(e).slice(0, 100) }; }
	};
	globalThis.__toBootSnapshot = function () {
		const snap = {
			atPerf: r3(performance.now()),
			bodySet: S.bodySet, bodyRem: S.bodyRem, bodyGet: S.bodyGet, gcsBody: S.gcsBody,
			metaContentWrites: S.metaContentWrites, metaObservedAttr: S.metaObservedAttr, metaObservedAdd: S.metaObservedAdd,
			bodyChildAdd: S.bodyChildAdd, bodyNewNodes: S.bodyNewNodes, bodyNewNodeKinds: JSON.parse(JSON.stringify(S.bodyNewNodeKinds)),
			applyCalls: S.applyCalls, applyFull: S.applyFull, applySkipped: S.applySkipped, applyMs: r3(S.applyMs), applyRows: S.applyRows.slice(0, 80),
			publishCount: S.publishCount, publishWatch: S.publishWatch, firstPublishAt: S.firstPublishAt,
			rafTicks: S.rafTicks, rafOver50: S.rafOver50, rafMaxCbMs: r3(S.rafMaxCbMs), rafCbCalls: S.rafCbCalls,
			longtasks: S.longtasks.slice(0, 80), csstext: S.csstext.slice(0, 80), events: S.events.slice(0, 400), errors: S.errors.slice(0, 10),
			presentersFound: S.presenters.length, presenterSource: S.presenterSource,
			branchVerified: S.branchVerified, sourceHasSkipReturn: S.sourceHasSkipReturn, sourceHasRaf: S.sourceHasRaf,
			applySourceHead: S.applySourceHead, overlay: overlayProbe()
		};
		S.bootSnapshot = snap; return snap;
	};
	globalThis.__toCollect = function (name) {
		const m = S.windowMarks[name] || {};
		const dur = m.startPerf != null ? performance.now() - m.startPerf : null;
		const stat = (arr) => {
			if (!arr.length) return { n: 0, p50: null, p95: null, p99: null, max: null };
			const a = arr.slice().sort((x, y) => x - y);
			const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
			return { n: a.length, p50: r3(q(0.5)), p95: r3(q(0.95)), p99: r3(q(0.99)), max: r3(a[a.length - 1]) };
		};
		const sum = (rows) => r3(rows.reduce((a, r) => a + r[1], 0));
		const meta = document.querySelector('meta[name="theme-color"]');
		return {
			window: name, durationMs: r3(dur), startPerf: m.startPerf, startEpoch: m.startEpoch,
			counts: {
				bodySet: S.bodySet, bodyRem: S.bodyRem, bodyGet: S.bodyGet, gcsBody: S.gcsBody, gcsTotal: S.gcsTotal,
				metaContentWrites: S.metaContentWrites, metaObservedAttr: S.metaObservedAttr,
				metaObservedAdd: S.metaObservedAdd, metaObservedRemove: S.metaObservedRemove,
				bodyChildAdd: S.bodyChildAdd, bodyChildRemove: S.bodyChildRemove, bodyAttrChanges: S.bodyAttrChanges,
				bodyNewNodes: S.bodyNewNodes, rafTicks: S.rafTicks, rafCbCalls: S.rafCbCalls,
				rafOver50: S.rafOver50, rafOver25: S.rafOver25, publishes: S.publishCount, publishWatch: S.publishWatch,
				injected: S.injectCount, injectRejected: S.injectRejected,
				stubSwallowed: S.stubSwallowed
			},
			/* WRITE-LEVEL APPLY ACCOUNTING. One full apply() == one landing of the token set on
			 * body.style: it retracts the previous token names (removeProperty x N) and writes the
			 * new ones (setProperty x N). A SKIPPED apply (ui-layout client.js:420-427) returns
			 * before any of those calls, so it is invisible here by construction. The two are
			 * therefore distinguishable, and `landings` never over-counts a skip. */
			derived: {
				tokenWrites: S.bodySet, tokenRetractions: S.bodyRem,
				landings: Math.max(S.bodyRem, S.bodySet > 0 ? 1 : 0),
				applyPathObserved: (S.bodySet > 0 || S.bodyRem > 0) ? "FULL-PATH" : "NO-BODY-WRITE",
				skipCandidatesUnobservable: "a skipped apply writes nothing, so it contributes 0 to every counter in this file"
			},
			apply: { calls: S.applyCalls, full: S.applyFull, skipped: S.applySkipped, totalMs: r3(S.applyMs), rows: S.applyRows.slice(0, 120) },
			raf: { cbMs: r3(S.rafCbMs), maxCbMs: r3(S.rafMaxCbMs), gap: stat(S.rafGaps), perS: dur ? r3(S.rafTicks / (dur / 1000)) : null, jobs: S.rafJobs.slice(0, 120) },
			longtasks: { n: S.longtasks.length, totalMs: sum(S.longtasks), maxMs: S.longtasks.length ? r3(Math.max.apply(null, S.longtasks.map((r) => r[1]))) : null, over50: S.longtasks.filter((r) => r[1] > 50).length, over100: S.longtasks.filter((r) => r[1] > 100).length, rows: S.longtasks },
			csstext: { n: S.csstext.length, totalMs: sum(S.csstext), byType: S.csstext.reduce((a, r) => { a[r[2]] = (a[r[2]] || 0) + 1; return a; }, {}), rows: S.csstext },
			frames: S.rafFrames.slice(0, 150),
			events: S.events.slice(0, 500),
			probe: {
				themeColorMetaContent: meta ? meta.content : null,
				themeColorMetaCount: document.querySelectorAll('meta[name="theme-color"]').length,
				rootColorScheme: document.documentElement.style.colorScheme,
				bodyDarkAttribute: document.body.hasAttribute("data-ds-dark-theme"),
				bodyPropCount: document.body.style.length,
				tokenBgBase: document.body.style.getPropertyValue("--dsw-alias-bg-base"),
				bodyBackground: getComputedStyle(document.body).backgroundColor,
				nodes: document.getElementsByTagName("*").length,
				settingsOverlayPresent: !!document.querySelector('[class*="VOzbGW_overlay"]'),
				probeTokenLeftBehind: document.body.style.getPropertyValue("--to-selfproof-probe-token"),
				overlay: overlayProbe()
			},
			errors: S.errors.slice(0, 10)
		};
	};
	S.installDom();
	return { installed: S.installed, installedAt: S.installedAt, installedDomAt: S.installedDomAt || null, installPending: S.installPending || null };
};

const CALL = (fnName, arg) => `(function(){var S=globalThis.__toState;if(!S)return{ok:false,why:"no instrument"};var f=globalThis.${fnName};if(typeof f!=="function")return{ok:false,why:"missing ${fnName}"};return f(${arg === undefined ? "" : JSON.stringify(arg)});})()`;

async function runOne(variant, rep, label) {
	fs.mkdirSync(RAW, { recursive: true });
	console.log(`\n===== theme-open variant=${variant} rep=${rep} label=${label} win=${WIN_MS} settle=${SETTLE_MS} inj=${INJ_COUNT} arm=${INJ_ARM}`);
	const gotLock = await (async () => {
		const deadline = Date.now() + GATE_MAX_MS;
		let tries = 0;
		for (;;) {
			tries += 1;
			if (acquireLock()) return true;
			if (Date.now() > deadline) {
				console.log(`[gate] gave up after ${tries} waits over ${GATE_MAX_MS}ms`);
				return false;
			}
			const owner = fs.existsSync(path.join(LOCK, "owner.txt"))
				? fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").replace(/\n/g, " | ").slice(0, 200)
				: "(no owner.txt)";
			if (tries % 6 === 1) console.log(`[gate] waiting for lock (try ${tries}): ${owner}`);
			/* Fairness: a sibling line takes the lock between its own runs, so a fixed backoff almost
			 * always lands inside one of its windows and loses the race again. Instead, poll fast for
			 * the moment the lock becomes free, then take it in that same poll. */
			const freeDeadline = Date.now() + 60000;
			while (Date.now() < freeDeadline) {
				if (!fs.existsSync(LOCK)) { if (acquireLock()) { console.log(`[gate] grabbed the free lock after ${tries} waits`); return true; } }
				await sleep(250 + Math.floor(Math.random() * 250));
			}
		}
	})();
	if (!gotLock) process.exit(3);
	const gateStart = Date.now();
	let gate = null; const foreignSeen = [];
	/* Bounded wait for a clean machine. Three lines share this box, so an indefinite wait would
	 * measure nothing; after GATE_WAIT_MS the run proceeds and is recorded as CONTENDED, and the
	 * analyzer downgrades only those items whose direction contention could flip. Contention adds
	 * CPU work, so a CONTENDED run can never manufacture a "the chain is idle" result. */
	while (Date.now() - gateStart < GATE_WAIT_MS) {
		const c = censusNow();
		for (const f of c.foreign) if (!foreignSeen.some((x) => x.pid === f.pid)) foreignSeen.push(f);
		if (c.foreignCount <= MAX_FOREIGN && c.lockHeldByMyLine) { gate = c; break; }
		await sleep(3000);
	}
	const censusAtStart = censusNow();
	const gateOutcome = gate ? "EXCLUSIVE" : "CONTENDED";
	console.log(`[gate] ${gateOutcome} foreignAtStart=${censusAtStart.foreignCount} lockMine=${censusAtStart.lockHeldByMyLine}`);
	console.log(`[gate] ${gateOutcome} after ${Date.now() - gateStart}ms`);

	const { chromium } = await import(LAUNCH);
	const browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--force-device-scale-factor=1"]
	});
	const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	await bctx.addInitScript(`(${INSTALL.toString()})(${JSON.stringify({ variant, injCount: INJ_COUNT, injSpanMs: INJ_SPAN_MS, injArm: INJ_ARM })})`);
	const page = await bctx.newPage();
	const pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
	const cdp = await bctx.newCDPSession(page);
	await cdp.send("Performance.enable");
	const tNav = nowIso();
	await page.goto(URL_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
	const reach = await page.evaluate(CALL("__toReachability"));
	const stubInfo = await page.evaluate(CALL("__toInstallStub"));
	await sleep(SETTLE_MS);
	const boot = await page.evaluate(CALL("__toBootSnapshot"));
	console.log(`[stub] ${JSON.stringify(stubInfo)}`);
	console.log(`[reach] ${JSON.stringify(reach)}`);
	console.log(`[boot] bodySet=${boot.bodySet} rem=${boot.bodyRem} gcsBody=${boot.gcsBody} metaW=${boot.metaContentWrites} metaObs=${boot.metaObservedAttr} overlay=${JSON.stringify(boot.overlay)}`);
	const spB = await page.evaluate(CALL("__toSelfProofForceMetaWrite"));
	const spC = await page.evaluate(CALL("__toSelfProofForceFullApply"));
	console.log(`[selfproof] metaWrite ok=${spB.ok} ${JSON.stringify(spB.before)} -> ${JSON.stringify(spB.after)} moved=${JSON.stringify(spB.moved)} why=${spB.why || "-"}`);
	console.log(`[selfproof] fullApply-precondition ok=${spC.ok} namesSeen=${spC.tokenNamesSeen} removed=${spC.removed} stub=${spC.stub}`);
	await sleep(400);

	const btn = page.locator('button:has-text("设置")').first();
	const btnCount = await btn.count();
	const clickInfo = { found: btnCount > 0, text: null, box: null };
	if (clickInfo.found) { try { clickInfo.text = (await btn.innerText()).trim().slice(0, 40); } catch (e) { } try { clickInfo.box = await btn.boundingBox(); } catch (e) { } }
	console.log(`[click] trigger found=${clickInfo.found} text=${JSON.stringify(clickInfo.text)}`);

	/* ---------- PRE ---------- */
	const preStartEpoch = Date.now();
	await page.evaluate(CALL("__toWindowStart", "pre"));
	await sleep(WIN_MS);
	const pre = await page.evaluate(CALL("__toCollect", "pre"));

	/* ---------- POST ---------- */
	await page.evaluate(CALL("__toWindowStart", "post"));
	const tClickEpoch = Date.now();
	let clickErr = null;
	try {
		if (clickInfo.found) await btn.click({ timeout: 4000, noWaitAfter: true });
		else clickErr = "settings trigger button not found";
	} catch (e) { clickErr = String(e).slice(0, 160); }
	const tClickAfterEpoch = Date.now();
	/* Optional real-theme-change leg (arm E): inside the SAME post window, drive a genuine theme
	 * change through the Appearance cubes and then REVERT it, so the durable preference is left
	 * exactly as found. Without this, a causal control is vacuous on a page where the chain is
	 * already idle — there would be nothing to stub away. */
	let toggles = null;
	if (variant === "E" || variant === "G") {
		toggles = { attempted: true, cubes: [], reverted: false, errors: [] };
		const cubeOf = (label) => page.locator(`button[class*="themeCube"]:has-text("${label}")`).first();
		const alt = process.env.TO_ALT_LABEL || "深色";
		try {
			const c = cubeOf(alt);
			if (await c.count()) { await c.click({ timeout: 3000, noWaitAfter: true }); toggles.cubes.push(alt); }
			else toggles.errors.push(`cube "${alt}" not found`);
			await sleep(800);
			const back = cubeOf(process.env.TO_BACK_LABEL || "浅色");
			if (await back.count()) { await back.click({ timeout: 3000, noWaitAfter: true }); toggles.cubes.push(process.env.TO_BACK_LABEL || "浅色"); toggles.reverted = true; }
			else toggles.errors.push("revert cube not found");
		} catch (e) { toggles.errors.push(String(e).slice(0, 140)); }
		const want = WIN_MS - (Date.now() - tClickEpoch);
		await sleep(Math.max(0, want));
	} else {
		await sleep(WIN_MS);
	}
	const post = await page.evaluate(CALL("__toCollect", "post"));

	const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
	const censusEnd = censusNow();

	const rec = {
		label, variant, rep, winMs: WIN_MS, settleMs: SETTLE_MS,
		collectedAt: nowIso(), tNav, url: URL_SITE,
		click: Object.assign({}, clickInfo, { err: clickErr, preStartEpoch, tClickEpoch, tClickAfterEpoch, clickLatencyMs: tClickAfterEpoch - tClickEpoch }),
		reachability: reach, stub: stubInfo,
		boot, selfProof: { metaWrite: spB, fullApplyPrecondition: spC },
		windows: { pre, post },
		toggles,
		cdp: { ScriptDuration: m.ScriptDuration, TaskDuration: m.TaskDuration, RecalcStyleDuration: m.RecalcStyleDuration, RecalcStyleCount: m.RecalcStyleCount, LayoutDuration: m.LayoutDuration, LayoutCount: m.LayoutCount },
		pageErrors: [...new Set([...pageErrors, ...(pre.errors || []), ...(post.errors || [])])].slice(0, 8),
		concurrency: { gateOutcome, gateWaitedMs: Date.now() - gateStart, gateWaitCapMs: GATE_WAIT_MS, foreignSeenDuringGate: foreignSeen, foreignCountAtGate: censusAtStart.foreignCount, censusEnd, exclusiveThroughout: gateOutcome === "EXCLUSIVE" && censusEnd.foreignCount === 0 },
		integrity: { settingsOverlayOpened: post.probe.settingsOverlayPresent, preRafSane: pre.raf.perS != null && pre.raf.perS > 25 && pre.raf.perS < 90, postRafSane: post.raf.perS != null && post.raf.perS > 25 && post.raf.perS < 90, presenterWrapped: boot.presentersFound > 0 }
	};

	await cdp.detach().catch(() => { });
	await browser.close();
	const released = releaseLock();
	if (toggles) console.log(`[toggle] ${JSON.stringify(toggles)}`);
	const f = (w) => `apply=${w.apply.calls}(full=${w.apply.full},skip=${w.apply.skipped};${w.apply.totalMs}ms) bodySet=${w.counts.bodySet} rem=${w.counts.bodyRem} gcsBody=${w.counts.gcsBody} metaW=${w.counts.metaContentWrites} pub=${w.counts.publishes}/${w.counts.publishWatch} inj=${w.counts.injected}/rej=${w.counts.injectRejected} raf/s=${w.raf.perS} gapP95=${w.raf.gap.p95} over50=${w.counts.rafOver50} lt=${w.longtasks.n}/${w.longtasks.totalMs}ms maxLt=${w.longtasks.maxMs} csstext=${w.csstext.totalMs}ms`;
	console.log(`[gate] released=${released}`);
	console.log(`[win] PRE  ${f(pre)}`);
	console.log(`[win] POST ${f(post)}`);
	console.log(`[win] overlay pre=${JSON.stringify(pre.probe.overlay)} post=${JSON.stringify(post.probe.overlay)} probeLeft=${JSON.stringify(post.probe.probeTokenLeftBehind)}`);
	if (rec.pageErrors.length) console.log(`[win] pageErrors ${JSON.stringify(rec.pageErrors)}`);
	const out = path.join(RAW, `theme-open-${label}.json`);
	fs.writeFileSync(out, JSON.stringify(rec, null, 2) + "\n");
	console.log(`[out] ${out}`);
	return rec;
}

if (has("all")) {
	/* A = baseline (real chain)  ·  B = theme-color blackhole  ·  C = body-write blackhole (causal) */
	const arms = (argOf("arms", "A,E,C")).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
	const A = Number(argOf("a", 3)), B = Number(argOf("b", 3)), C = Number(argOf("c", 3)), E = Number(argOf("e", 3)), G = Number(argOf("g", 3));
	const counts = { A, B, C, E, G };
	for (const arm of arms) for (let i = 1; i <= (counts[arm] || 0); i++) { await runOne(arm, i, `${arm}${i}`); await sleep(3000); }
	console.log("\n===== ALL DONE");
} else {
	const variant = argOf("variant", "A").toUpperCase();
	const rep = argOf("rep", "1");
	await runOne(variant, Number(rep), argOf("label", `${variant}${rep}`));
}
