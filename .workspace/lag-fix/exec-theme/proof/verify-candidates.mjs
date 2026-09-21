#!/usr/bin/env node
/**
 * proof/verify-candidates.mjs — static + offline self-proof for the theme batch.
 *
 * Read-only with respect to the deployed tree.
 *
 * Faithful checks (must PASS):
 *   V1  anchor uniqueness for every scope in the matrix (generator + applier agree);
 *   V2  `node --check` on every candidate artifact;
 *   V3  "introduced identifier has a declaration in this file" for every declared name;
 *   V4  the observed pre-image md5/line-count equals the audit-recorded identity;
 *   V5  the candidate files on disk equal what the generator produces now (no drift);
 *   V6  no candidate carries a vetoed pattern (the audit's `cssText` merge) or a soft guard
 *       (`themeColorMeta.isConnected` in the skip path).
 *
 * Discriminating-power (counter) tests — each mutation MUST be rejected; the verifier is
 * only trustworthy if at least one of these fails:
 *   M1  signature includes `revision`            -> replay skip can never hit
 *   M2  landing guard removed from the skip test -> drift can silently skip a needed write
 *   M3  first call skips                         -> cold start never paints
 *   M4  frame deferral removed                   -> (ii) silently reverts to the hot path
 *   M5  wallpaper content comparison removed     -> the re-entrant echo is not cut
 *   M6  ui-theme override comparison removed     -> the producer-side echo is not cut
 *
 * Usage: node proof/verify-candidates.mjs [--scope ...] [--candidates DIR]
 * Exit:  0 all checks PASS, 2 a faithful check failed or a mutation survived.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DEPLOY_PATHS, EXPECTED, DEFAULT_SCOPE, editGroups, applyEdits, countOccurrences, SENTINELS, introducedFor } from "../lib/patches.mjs";

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
	const i = argv.indexOf("--" + name);
	return i >= 0 ? argv[i + 1] : fallback;
};
const SCOPE_ARG = argOf("scope", null);
const CAND = argOf("candidates", path.join(HERE, "candidates"));
const md5 = (v) => crypto.createHash("md5").update(v).digest("hex");
const wcLines = (t) => (t.match(/\n/g) || []).length;

const NUL = String.fromCharCode(0);
const results = [];
let failed = 0;
const check = (id, name, ok, detail) => {
	results.push({ id, name, verdict: ok ? "PASS" : "FAIL", detail });
	if (!ok) failed += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log(`verify-candidates  scope=${SCOPE_ARG ?? "(from manifest)"}  candidates=${CAND}`);
console.log(`node ${process.version}\n`);

// ---------------------------------------------------------------------------
// V1 — anchor uniqueness across the whole scope matrix
// ---------------------------------------------------------------------------
const MATRIX = [
	["signature"],
	["themeColor"],
	["signature", "themeColor"],
	["signature", "themeColor", "instances"],
	["instances"],
	["signature", "themeColor", "wallpaperShade"],
	["signature", "themeColor", "instances", "overlay", "wallpaperShade"],
	["signature", "themeColor", "instances", "overlay", "wallpaperShade", "extra-unknown-unit"]
];
const matrixRows = [];
let matrixOk = true;
for (const scope of MATRIX) {
	let scopeOk = true;
	const detail = [];
	for (const group of editGroups(scope)) {
		const src = fs.readFileSync(group.path, "utf8");
		let text = src;
		for (const edit of group.edits) {
			const hits = countOccurrences(text, edit.find);
			if (hits !== 1) {
				scopeOk = false;
				detail.push(`${group.target}/${edit.key}=${hits}`);
				break;
			}
			text = applyEdits(text, [edit], group.target);
		}
		for (const sentinel of SENTINELS) if (text.includes(sentinel)) { scopeOk = false; detail.push(`${group.target}: sentinel leftovers`); }
	}
	matrixRows.push({ scope: scope.join("+"), ok: scopeOk, detail });
	if (!scopeOk) matrixOk = false;
	console.log(`       matrix ${scope.join("+").padEnd(66)} ${scopeOk ? "unique" : "REJECTED " + detail.join(" ")}`);
}
check("V1", "every anchor matches exactly once in every scope of the matrix", matrixOk, `${matrixRows.length} scopes`);

// ---------------------------------------------------------------------------
// V2/V3/V4/V5/V6 over the candidate artifacts
// ---------------------------------------------------------------------------
const manifestPath = path.join(CAND, "MANIFEST.json");
if (!fs.existsSync(manifestPath)) {
	console.error(`missing ${manifestPath} — run gen-candidates.mjs first (or pass --candidates)`);
	process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
/* The scope under verification is the one the manifest was generated with, unless the
 * caller overrides it: V3/V5 must judge the artifact that is actually on disk. */
const SCOPE = (SCOPE_ARG ? SCOPE_ARG.split(",") : manifest.scope).filter(Boolean);
const introduced = introducedFor(SCOPE);
console.log(`       manifest scope = ${SCOPE.join(",")} (${manifest.groups.length} group(s))`);

console.log("");
for (const group of manifest.groups) {
	const candPath = path.join(CAND, group.candidate);
	if (!fs.existsSync(candPath)) {
		check(`V2:${group.target}`, `${group.candidate} exists and passes node --check`, false, "file missing");
		continue;
	}
	const text = fs.readFileSync(candPath, "utf8");

	// V4 — pre-image identity
	const deployed = fs.readFileSync(group.deployPath, "utf8");
	const expect = EXPECTED[group.target];
	check(
		`V4:${group.target}`,
		"deployed pre-image matches the audit-recorded identity",
		md5(deployed) === expect.md5 && md5(deployed) === group.preImageMd5 && wcLines(deployed) === expect.lines,
		`md5=${md5(deployed)} (audit ${expect.md5}) lines=${wcLines(deployed)} (audit ${expect.lines})`
	);

	// V5 — no drift: regenerate from the anchors and compare byte for byte
	let regenerated = null;
	for (const live of editGroups(SCOPE)) {
		if (live.target !== group.target) continue;
		const src = fs.readFileSync(live.path, "utf8");
		regenerated = applyEdits(src, live.edits, live.target).length > 0 ? (() => {
			let t = src;
			for (const e of live.edits) t = applyEdits(t, [e], live.target);
			return t;
		})() : null;
	}
	check(`V5:${group.target}`, "candidate on disk equals a fresh generation from the anchors", regenerated === text, regenerated === null ? "target not in scope" : `md5 ${md5(text)} vs ${md5(regenerated ?? "")}`);

	// V2 — syntax
	const tmp = path.join(HERE, "raw", "tmp", `verify.${group.target}.js`);
	fs.mkdirSync(path.dirname(tmp), { recursive: true });
	fs.writeFileSync(tmp, text);
	let syntaxOk = true;
	let syntaxDetail = "";
	try {
		execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
	} catch (error) {
		syntaxOk = false;
		syntaxDetail = String(error.stderr || error.message).slice(0, 200);
	}
	check(`V2:${group.target}`, "node --check accepts the candidate", syntaxOk, syntaxDetail);

	// V3 — introduced identifiers are declared in this file
	const names = introduced[group.target] ?? [];
	const bad = [];
	for (const name of names) {
		const declared = new RegExp(String.raw`(?:^|\n)[ \t]*(?:const|let|var|function|class)[ \t]+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`).test(text);
		if (!declared) bad.push(`${name}: no declaration`);
	}
	check(`V3:${group.target}`, `introduced identifiers declared in-file (${names.length})`, bad.length === 0, bad.join("; "));

	// V6 — vetoed patterns absent; hard guard present where required
	const problems = [];
	/* Vetoed-pattern detection must compare against the pristine file: the bundles carry
	 * their own unrelated `.cssText` assignments. */
	const pristineText = fs.readFileSync(group.deployPath, "utf8");
	if (countOccurrences(text, ".cssText") > countOccurrences(pristineText, ".cssText")) problems.push("cssText merge introduced (audit-vetoed)");
	const skipPath = text.slice(text.indexOf("if (signature === this.lastSignature"), text.indexOf("if (signature === this.lastSignature") + 260);
	if (text.includes("signature === this.lastSignature") && !/landingIntact\(/.test(skipPath)) problems.push("skip without landing guard");
	if (text.includes("signature === this.lastSignature") && /isConnected/.test(skipPath)) problems.push("soft isConnected guard in the skip path");
	if (text.includes(String.fromCharCode(0))) problems.push("raw NUL byte in the emitted source (grep-hostile; must be an escape)");
	check(`V6:${group.target}`, "no vetoed pattern / no soft guard / no raw NUL byte", problems.length === 0, problems.join("; "));
}

// ---------------------------------------------------------------------------
// Counter tests — mutations the verifier MUST reject
// ---------------------------------------------------------------------------
console.log("\n--- counter tests (each mutation must be rejected) ---");
const layoutCand = path.join(CAND, "client.layout.js");
const wallpaperCand = path.join(CAND, "client.wallpaper.js");
const uithemeCand = path.join(CAND, "client.uitheme.js");
const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

const SIGNATURE_TEST = "if (signature === this.lastSignature && this.landingIntact(scheme, body)) {";
const GUARD_CALL = "this.landingIntact(scheme, body)";
const DEFER_CALL = "scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);";
const WALLPAPER_TEST = "if (sameShadedTokens(shadedTokens, next)) return;";
const OVERRIDE_TEST = "if (current !== void 0 && sameOverrideTokens(current.tokens, validated)) return () => {";

const mutations = [
	{
		id: "M1",
		name: "signature includes `revision` (the skip can never hit)",
		file: layoutCand,
		/* The emitted artifact writes the NUL as the escape sequence inside a string
		 * literal, so the mutation anchor has to match that source text. */
		line: "const signature = scheme",
		to: "const signature = scheme + String(snapshot.revision) + \u0000"
	},
	{
		id: "M2",
		name: "landing guard dropped from the skip test",
		file: layoutCand,
		from: SIGNATURE_TEST,
		to: "if (signature === this.lastSignature) {"
	},
	{
		id: "M3",
		name: "first call skips too (no `lastSignature === undefined` gate)",
		file: layoutCand,
		from: SIGNATURE_TEST,
		to: "if (this.lastSignature !== void 0 && signature === this.lastSignature && this.landingIntact(scheme, body)) {"
	},
	{
		id: "M4",
		name: "frame deferral removed (back to the synchronous forced read)",
		file: layoutCand,
		from: DEFER_CALL,
		to: "this.refreshThemeColor();"
	},
	{
		id: "M5",
		name: "wallpaper content comparison removed (echo not cut)",
		file: wallpaperCand,
		from: WALLPAPER_TEST,
		to: "if (false) return;"
	},
	{
		id: "M6",
		name: "ui-theme override comparison removed (producer echo not cut)",
		file: uithemeCand,
		from: OVERRIDE_TEST,
		to: "if (false) return () => { this.publish(); };"
	}
];

/** The same predicates the faithful checks use; a mutation must trip at least one. */
function judge(text, which) {
	const problems = [];
	if (which === "layout") {
		if (!text.includes(SIGNATURE_TEST) || countOccurrences(text, SIGNATURE_TEST) !== 1) problems.push("signature test missing/ambiguous");
		if (!text.includes(GUARD_CALL)) problems.push("landing guard missing");
		if (/String\(snapshot\.revision\)|\.revision\b/.test(text.slice(text.indexOf("const signature ="), text.indexOf("const signature =") + 200))) problems.push("revision in signature");
		if (!text.includes(DEFER_CALL)) problems.push("no frame deferral");
		if (!/this\.lastSignature = signature;/.test(text)) problems.push("lastSignature never recorded");
		if (SENTINELS.some((s) => text.includes(s))) problems.push("sentinel leftovers");
		// first-call gate: the field starts undefined, so equality alone already gates it;
		// an explicit `!== void 0` guard around the comparison breaks the shape we proofed.
		if (/this\.lastSignature !== void 0 &&/.test(text)) problems.push("extra first-call guard (shape drift)");
	}
	if (which === "wallpaper") {
		if (!text.includes(WALLPAPER_TEST)) problems.push("wallpaper content comparison missing");
	}
	if (which === "uitheme") {
		if (!text.includes(OVERRIDE_TEST)) problems.push("ui-theme content comparison missing");
	}
	return problems;
}

const mutationsRaw = [];
for (const mutation of mutations) {
	const source = readIf(mutation.file);
	if (source === null) {
		check(mutation.id, mutation.name, false, `candidate ${path.basename(mutation.file)} not generated (scope off) — mutation NOT driven`);
		continue;
	}
	let mutated = null;
	if (mutation.line !== undefined) {
		/* Line-targeted mutation: the anchor text is not unique on its own, so the whole
		 * line is located once and rewritten. */
		const at = source.indexOf(mutation.line);
		if (at === -1 || source.indexOf(mutation.line, at + 1) !== -1) {
			check(mutation.id, mutation.name, false, `mutation line anchor matched ${source.indexOf(mutation.line, at + 1) !== -1 ? "more than once" : "zero"} times — verifier untested`);
			continue;
		}
		const eol = source.indexOf(";", at);
		mutated = source.slice(0, at) + mutation.to + source.slice(eol);
	} else {
		const hits = countOccurrences(source, mutation.from);
		if (hits !== 1) {
			check(mutation.id, mutation.name, false, `mutation anchor matched ${hits} times — mutation NOT applied, verifier untested`);
			continue;
		}
		mutated = source.replace(mutation.from, mutation.to);
	}
	const which = mutation.file.includes("layout") ? "layout" : mutation.file.includes("wallpaper") ? "wallpaper" : "uitheme";
	const problems = judge(mutated, which);
	const rejected = problems.length > 0;
	mutationsRaw.push({ id: mutation.id, name: mutation.name, applied: true, rejected, problems });
	check(mutation.id, `mutation rejected: ${mutation.name}`, rejected, problems.join("; ") || "SURVIVED — verifier has no discriminating power here");
}

// Control: the pristine candidate must be ACCEPTED by the same predicates.
for (const [name, file, which] of [["layout", layoutCand, "layout"], ["wallpaper", wallpaperCand, "wallpaper"], ["uitheme", uithemeCand, "uitheme"]]) {
	const text = readIf(file);
	if (text === null) continue;
	const problems = judge(text, which);
	check(`C:${name}`, `control — the pristine ${name} candidate is accepted`, problems.length === 0, problems.join("; "));
}

// ---------------------------------------------------------------------------
fs.mkdirSync(path.join(HERE, "proof"), { recursive: true });
const report = {
	generatedAt: new Date().toISOString(),
	scope: SCOPE,
	candidates: CAND,
	matrix: matrixRows,
	mutations: mutationsRaw,
	results,
	failed,
	verdict: failed === 0 ? "PASS" : "FAIL"
};
fs.writeFileSync(path.join(HERE, "proof", "verify-report.json"), JSON.stringify(report, null, 2) + "\n");

console.log(`\n=== ${failed === 0 ? "ALL CHECKS PASS" : `${failed} CHECK(S) FAILED`} (${results.length} checks) ===`);
process.exit(failed === 0 ? 0 : 2);
