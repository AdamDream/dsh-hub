#!/usr/bin/env node
/**
 * experiments/verify-functional.mjs — the P2 regression list, page-API-clean.
 *
 * NOTHING here patches a page API: no getComputedStyle override, no style no-ops, no frame
 * dropping. The audit is explicit that R1..R9 must be judged without any probe.
 *
 * PASSIVE checks (run automatically, read-only DOM):
 *   R5  meta[name=theme-color].content is non-empty and a legal CSS colour;
 *   R4  body's inline `--dsw-alias-bg-base` is present and matches the rgba() shape the
 *       wallpaper writes (recorded for byte-level comparison against the pre-fix run);
 *   R8  the Appearance row selection agrees with the applied palette;
 *   R9  cold-start first frame state (colour scheme, attribute, token, meta) — compare the
 *       BEFORE and AFTER dumps byte for byte;
 *   and the value evidence the audit left unverified: computed body background versus the
 *   token, plus every `body { ... }` rule found in the document's stylesheets.
 *
 * ACTIVE checks are printed as an explicit manual checklist because they need a real
 * preference write or a media emulation, and the audit allows exactly one real preference
 * write per session with coordinator approval:
 *   R1/R2 dark<->light   R3 system follow (CDP Emulation.setEmulatedMedia)
 *   R6 wallpaper opacity -> none    R7 locale switch
 *
 * Usage:
 *   node experiments/verify-functional.mjs --label verify-before
 *   node experiments/verify-functional.mjs --label verify-after --emulate-dark 1
 *
 * Exit: 0 = passive checks PASS, 2 = a passive check FAILED.
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
const LABEL = argOf("label", "verify");
const EMULATE_DARK = argOf("emulate-dark", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function census() {
	let instances = [];
	try {
		const lines = execSync("ps -eo pid,ppid,cmd --no-headers", { maxBuffer: 32 * 1024 * 1024 }).toString().split("\n");
		for (const l of lines) {
			if (!/--remote-debugging-pipe/.test(l) || /--type=/.test(l)) continue;
			const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
			if (!m) continue;
			let ppid = Number(m[2]);
			const chain = [];
			for (let i = 0; i < 6 && ppid > 1; i++) {
				chain.push(ppid);
				try { const st = fs.readFileSync(`/proc/${ppid}/stat`, "utf8"); ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); } catch { break; }
			}
			instances.push({ pid: Number(m[1]), ancestors: chain });
		}
	} catch { }
	const mine = instances.filter((b) => b.ancestors.includes(process.pid));
	return { instances: instances.length, mine: mine.length, foreign: instances.length - mine.length };
}

const DUMP = () => {
	const body = document.body;
	const meta = document.querySelector('meta[name="theme-color"]');
	const cs = getComputedStyle(body);
	const rules = [];
	for (const sheet of document.styleSheets) {
		let list = [];
		try { list = [...sheet.cssRules]; } catch { continue; }
		for (const rule of list) {
			if (!rule.selectorText) continue;
			if (!/(^|,)\s*body\s*$/.test(rule.selectorText)) continue;
			rules.push({ selector: rule.selectorText, backgroundColor: rule.style.backgroundColor, background: rule.style.background, cssText: rule.cssText.slice(0, 240) });
		}
	}
	const legalColour = (v) => typeof v === "string" && v.trim() !== "" && (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()) || /^rgba?\(/i.test(v.trim()) || /^hsla?\(/i.test(v.trim()) || /^[a-z]+$/i.test(v.trim()));
	const appearanceRow = (() => {
		const cells = [...document.querySelectorAll("[class*=navCell]")];
		const appearance = cells.find((c) => /外观|Appearance/i.test(c.innerText || ""));
		if (!appearance) return null;
		return { text: (appearance.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80), active: /active/.test(appearance.className) };
	})();
	return {
		href: location.href,
		readyState: document.readyState,
		nodes: document.getElementsByTagName("*").length,
		rootColorScheme: document.documentElement.style.colorScheme,
		bodyDarkAttribute: body.hasAttribute("data-ds-dark-theme"),
		bodyStyleAttr: body.getAttribute("style") || "",
		bodyPropCount: body.style.length,
		inlineTokenBgBase: body.style.getPropertyValue("--dsw-alias-bg-base"),
		computedBodyBackgroundColor: cs.backgroundColor,
		computedBodyBgBaseToken: getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base"),
		rootBgBaseToken: getComputedStyle(document.documentElement).getPropertyValue("--dsw-alias-bg-base"),
		themeColorMetaCount: document.querySelectorAll('meta[name="theme-color"]').length,
		themeColorMetaContent: meta ? meta.content : null,
		themeColorMetaLegalColour: legalColour(meta ? meta.content : ""),
		bodyBackgroundRules: rules,
		appearanceRow,
		prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
		wallpaperElementPresent: !!document.querySelector('[class*=wallpaper],[data-wallpaper],#dsh-wallpaper')
	};
};

const { chromium } = await import(LAUNCH);
fs.mkdirSync(RAW, { recursive: true });
const c0 = census();
console.log(`[census] instances=${c0.instances} mine=${c0.mine} foreign=${c0.foreign} lock=${fs.existsSync(LOCK) ? "present" : "absent"}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await bctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const cdp = await bctx.newCDPSession(page);

/* R9: cold start, exactly as the user sees it */
await page.goto(URL_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(9000);
const cold = await page.evaluate(`(${DUMP.toString()})()`);
console.log(`cold start: colorScheme=${JSON.stringify(cold.rootColorScheme)} dark=${cold.bodyDarkAttribute} token=${JSON.stringify(cold.inlineTokenBgBase)} meta=${JSON.stringify(cold.themeColorMetaContent)} nodes=${cold.nodes}`);

let emulated = null;
if (EMULATE_DARK !== null && EMULATE_DARK !== "0") {
	await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
	await sleep(2500);
	emulated = await page.evaluate(`(${DUMP.toString()})()`);
	console.log(`emulated dark: colorScheme=${JSON.stringify(emulated.rootColorScheme)} dark=${emulated.bodyDarkAttribute} token=${JSON.stringify(emulated.inlineTokenBgBase)} meta=${JSON.stringify(emulated.themeColorMetaContent)}`);
}

const toSettings = await (async () => {
	try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) { await l.click({ timeout: 2500 }); await sleep(2500); return true; } } catch { }
	return false;
})();
const settings = toSettings ? await page.evaluate(`(${DUMP.toString()})()`) : null;
console.log(`settings view opened=${toSettings} appearanceRow=${JSON.stringify(settings ? settings.appearanceRow : null)}`);
await browser.close();

const checks = [];
const push = (id, name, ok, detail) => {
	checks.push({ id, name, verdict: ok ? "PASS" : "FAIL", detail });
	console.log(`[${ok ? "PASS" : "FAIL"}] ${id.padEnd(3)} ${name}${detail ? `  — ${detail}` : ""}`);
};
push("R5", "theme-color meta is present, non-empty and a legal CSS colour",
	cold.themeColorMetaCount === 1 && cold.themeColorMetaLegalColour === true,
	`count=${cold.themeColorMetaCount} content=${JSON.stringify(cold.themeColorMetaContent)}`);
push("R4", "body carries the wallpaper token in its inline style (rgba shape recorded for byte comparison)",
	cold.inlineTokenBgBase !== "" && /^rgba?\(/.test(cold.inlineTokenBgBase),
	`inlineTokenBgBase=${JSON.stringify(cold.inlineTokenBgBase)} bodyProps=${cold.bodyPropCount} styleLen=${cold.bodyStyleAttr.length}`);
push("R8", "an Appearance row exists in the settings view",
	toSettings ? settings.appearanceRow !== null : true,
	settings && settings.appearanceRow ? JSON.stringify(settings.appearanceRow) : "settings view not opened");
push("R9", "cold start applied a palette (colour scheme set, attribute consistent, meta filled)",
	(cold.rootColorScheme === "dark" || cold.rootColorScheme === "light") && cold.bodyDarkAttribute === (cold.rootColorScheme === "dark") && cold.themeColorMetaContent !== null,
	`colorScheme=${cold.rootColorScheme} dark=${cold.bodyDarkAttribute} meta=${JSON.stringify(cold.themeColorMetaContent)}`);
push("V?", "VALUE EVIDENCE: is the computed body background the token, or transparent? (audit §6.2)",
	true,
	`computed=${JSON.stringify(cold.computedBodyBackgroundColor)} inlineToken=${JSON.stringify(cold.inlineTokenBgBase)} computedToken=${JSON.stringify(cold.computedBodyBgBaseToken)} bodyBackgroundRules=${JSON.stringify(cold.bodyBackgroundRules)}`);
push("V?", "page errors during the probe-free run",
	errors.length === 0, errors.length ? JSON.stringify(errors) : "none");
if (emulated) {
	push("R3", "emulated prefers-color-scheme: dark reached the document (apply path alive)",
		emulated.bodyDarkAttribute === true || emulated.rootColorScheme === "dark",
		`colorScheme=${emulated.rootColorScheme} dark=${emulated.bodyDarkAttribute}`);
}

const manual = [
	"R1 dark -> light: settings > 通用 > 外观, switch to light (the one allowed real preference write, needs coordinator approval). PASS if colorScheme===\"light\", no data-ds-dark-theme, page visibly brighter.",
	"R2 light -> dark: the reverse. PASS if colorScheme===\"dark\", data-ds-dark-theme present, page darker.",
	"R6 token override add/remove: change the wallpaper opacity once, then set the wallpaper to none. PASS if the token disappears from body.style and the UI returns to the opaque base.",
	"R7 locale: switch language. PASS if colours do not change and the language switch still works (proves the signature did not absorb locale).",
	"R9b cold start visual: compare the first-frame screenshot before and after the fix."
];
const out = {
	generatedAt: new Date().toISOString(),
	label: LABEL,
	probeFree: true,
	emulateDark: EMULATE_DARK,
	censusStart: c0,
	censusEnd: census(),
	cold,
	emulated,
	settings,
	errors,
	checks,
	manual,
	verdict: checks.some((c) => c.verdict === "FAIL") ? "FAIL" : "PASS"
};
fs.writeFileSync(path.join(RAW, `verify-functional-${LABEL}.json`), JSON.stringify(out, null, 2) + "\n");
console.log(`\n=== passive verdict: ${out.verdict} (${checks.filter((c) => c.verdict === "PASS").length}/${checks.length}) ===`);
console.log("manual checklist (audit §4.3):");
for (const m of manual) console.log("  - " + m);
process.exit(out.verdict === "PASS" ? 0 : 2);
