#!/usr/bin/env node
/**
 * experiments/probe-instances.mjs — P0 machine check for unit (0).
 *
 * Answers, with no product change and no browser restart:
 *   1. how many DISTINCT `ThemePresenter.apply` function objects are live in this page, and
 *      which bundle URL each one comes from;
 *   2. whether the extra objects come from ONE materialised bundle (same URL -> multiple
 *      plugin fibers, i.e. the module-scope singleton in unit (0) fixes them) or from TWO
 *      materialisations (different URL or a second registration -> unit (0) can NOT fix
 *      them and the fix must move to the plugin assembly side);
 *   3. the value evidence the audit marked unverified: the computed body background versus
 *      `--dsw-alias-bg-base`, which decides whether `(ii-a)` would be value-preserving.
 *
 * Mechanism: a one-shot `Error.prepareStackTrace` reads the CallSite objects of every `apply`
 * call and keeps the distinct function objects plus their file names.
 *
 * Usage:
 *   node experiments/probe-instances.mjs --win 8000 --label instances-baseline
 *   node experiments/probe-instances.mjs --win 8000 --scenario settings --label instances-after
 *
 * Exit: 0 window accepted (EXCLUSIVE), 3 gate never became exclusive (result marked CONTENDED).
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
	return { at: new Date().toISOString(), instances: instances.length, mineCount: mine.length, foreignCount: foreign.length, foreign: foreign.map((b) => b.pid), lockHeldByMyLine: !!(lockOwner && /exec-theme/.test(lockOwner)), lockOwner };
}
const gotLock = (() => {
	try {
		fs.mkdirSync(LOCK);
		fs.writeFileSync(path.join(LOCK, "owner.txt"), ["agent: exec-theme (theme batch, subagent)", "line: P0 instance-count probe", `pid: ${process.pid}`, `started_at: ${new Date().toISOString()}`, ""].join("\n"));
		return true;
	} catch { return false; }
})();
if (!gotLock) {
	console.error(`[gate] lock held by another line; aborting (${fs.existsSync(LOCK) ? fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8") : ""})`);
	process.exit(3);
}

const PROBE = () => {
	window.__inst = { seen: [], urls: {}, calls: 0, blocked: 0, sample: [] };
	const orig = Error.prepareStackTrace;
	Error.prepareStackTrace = function (err, frames) {
		try {
			for (const f of frames) {
				if (f.getFunctionName() !== "apply") continue;
				const url = f.getFileName() || "";
				if (!/ui-layout/.test(url)) continue;
				const fn = f.getFunction();
				let known = false;
				for (const s of window.__inst.seen) if (s.fn === fn) { known = true; break; }
				if (!known) {
					window.__inst.seen.push({ fn, url, at: performance.now() });
					window.__inst.urls[url] = (window.__inst.urls[url] || 0) + 1;
					if (window.__inst.sample.length < 6) {
						window.__inst.sample.push({
							url,
							line: f.getLineNumber(),
							column: f.getColumnNumber(),
							ctor: (() => { try { return f.getThis()?.constructor?.name ?? null; } catch { return null; } })()
						});
					}
				}
			}
		} catch { }
		return orig ? orig(err, frames) : frames.map((f) => "    at " + f).join("\n");
	};
	const install = () => {
		if (!document.body || window.__instPatched) return !!window.__instPatched;
		const proto = Object.getPrototypeOf(document.body.style);
		const oRem = proto.removeProperty;
		const oSet = proto.setProperty;
		proto.removeProperty = function (n) {
			if (this === document.body.style) {
				window.__inst.calls += 1;
				/* Sample the stack every time for the first 40 applies, then sparsely. */
				if (window.__inst.calls <= 40 || (window.__inst.calls & 15) === 0) void new Error("probe");
			}
			return oRem.call(this, n);
		};
		/* K-C is NOT used here: this probe must observe the real read. */
		void oSet;
		window.__instPatched = true;
		return true;
	};
	if (!install()) { const iv = setInterval(() => { if (install()) clearInterval(iv); }, 40); }
};
const COLLECT = () => {
	const inst = window.__inst || { seen: [], urls: {}, calls: 0, sample: [] };
	const body = document.body;
	const cs = getComputedStyle(body);
	const meta = document.querySelector('meta[name="theme-color"]');
	const csBase = getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base");
	const root = getComputedStyle(document.documentElement);
	return {
		instanceCount: inst.seen.length,
		urls: inst.urls,
		sample: inst.sample,
		applyCalls: inst.calls,
		nodes: document.getElementsByTagName("*").length,
		valueEvidence: {
			computedBodyBackgroundColor: cs.backgroundColor,
			computedBodyBackgroundImage: cs.backgroundImage,
			computedBodyBgBaseToken: csBase,
			inlineTokenBgBase: body.style.getPropertyValue("--dsw-alias-bg-base"),
			rootBgBaseToken: root.getPropertyValue("--dsw-alias-bg-base"),
			themeColorMetaContent: meta ? meta.content : null,
			themeColorMetaCount: document.querySelectorAll('meta[name="theme-color"]').length,
			rootColorScheme: document.documentElement.style.colorScheme,
			bodyDarkAttribute: body.hasAttribute("data-ds-dark-theme"),
			bodyStyleAttr: body.getAttribute("style") || "",
			bodyPropCount: body.style.length,
			bodyBackgroundRule: [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
				.filter((r) => r.selectorText && /(^|,)\s*body\s*$/.test(r.selectorText))
				.map((r) => ({ selector: r.selectorText, background: r.style.background, backgroundColor: r.style.backgroundColor }))
		}
	};
};

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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(9000);

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

await page.evaluate(() => { window.__inst.seen.length = 0; window.__inst.urls = {}; window.__inst.calls = 0; window.__inst.sample.length = 0; });
await sleep(WIN);
const data = await page.evaluate(`(${COLLECT.toString()})()`);
const censusEnd = censusNow();
await browser.close();
try { if (/exec-theme/.test(fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8"))) { fs.rmSync(path.join(LOCK, "owner.txt")); fs.rmdirSync(LOCK); } } catch { }

const verdict = {
	instances: data.instanceCount,
	urlCount: Object.keys(data.urls).length,
	interpretation: data.instanceCount <= 1
		? "single presenter — unit (0) has nothing to remove in this window"
		: (Object.keys(data.urls).length === 1
			? "MULTIPLE presenters, all from ONE bundle URL => they are extra plugin fibers of one materialised module. Unit (0)'s module-scope singleton removes them; verify it reaches 1."
			: "MULTIPLE presenters from DIFFERENT bundle URLs => the module was materialised/loaded more than once. Unit (0)'s singleton can NOT fix this; the fix belongs to the plugin assembly side (report this to the coordinator).")
};
const out = {
	generatedAt: new Date().toISOString(),
	label: LABEL,
	scenario: SCENARIO,
	winMs: WIN,
	concurrency: { gateOutcome, censusStart: gate, censusEnd },
	errors,
	data,
	verdict
};
fs.writeFileSync(path.join(RAW, `instances-${LABEL}.json`), JSON.stringify(out, null, 2) + "\n");
console.log(`\ninstances=${data.instanceCount} urls=${JSON.stringify(data.urls)} applies=${data.applyCalls}`);
console.log(`value evidence: computed body background=${JSON.stringify(data.valueEvidence.computedBodyBackgroundColor)} token-inline=${JSON.stringify(data.valueEvidence.inlineTokenBgBase)} computed-token=${JSON.stringify(data.valueEvidence.computedBodyBgBaseToken)} theme-color meta=${JSON.stringify(data.valueEvidence.themeColorMetaContent)}`);
console.log(`body background rules: ${JSON.stringify(data.valueEvidence.bodyBackgroundRule)}`);
console.log(`VERDICT: ${verdict.interpretation}`);
if (SCENARIO !== "home") console.log("NOTE: an instance count of >1 right after opening the settings/long-session view is itself the finding.");
process.exit(gateOutcome === "EXCLUSIVE" ? 0 : 3);
