#!/usr/bin/env node
/**
 * Generate the candidate artifacts from the pristine deployed targets.
 *
 * Read-only with respect to the deployed tree: the targets are only READ. All output
 * lands under `.workspace/lag-fix/exec-theme/candidates/`.
 *
 * Usage:
 *   node gen-candidates.mjs [--scope signature,themeColor,wallpaperShade,instances,overlay] [--target DIR]
 *
 * Exit codes: 0 = all groups generated; 2 = an anchor was missing or non-unique (hard stop),
 * 3 = the pristine target does not match the audit's recorded pre-image.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEPLOY_PATHS, EXPECTED, DEFAULT_SCOPE, editGroups, applyEdits, countOccurrences } from "./lib/patches.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
	const i = argv.indexOf("--" + name);
	return i >= 0 ? argv[i + 1] : fallback;
};
const scope = argOf("scope", DEFAULT_SCOPE.join(",")).split(",").filter(Boolean);
const outDir = argOf("target", path.join(HERE, "candidates"));
/** Optional path redirect so the same logic can generate MUTATED candidates for the counter-tests. */
const pathOf = (target) => argOf("path-" + target, DEPLOY_PATHS[target]);

const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");
/** wc -l semantics: number of newline characters (the bundles carry no trailing newline). */
const lineCount = (text) => (text.match(/\n/g) || []).length;

fs.mkdirSync(outDir, { recursive: true });
const manifest = {
	generatedAt: new Date().toISOString(),
	scope,
	tool: "exec-theme/gen-candidates.mjs",
	groups: []
};

let hardStop = false;
for (const group of editGroups(scope)) {
	const targetPath = pathOf(group.target);
	if (!fs.existsSync(targetPath)) {
		console.error(`[STOP] missing target ${targetPath}`);
		process.exit(3);
	}
	const source = fs.readFileSync(targetPath, "utf8");
	const pre = md5(source);
	const expect = EXPECTED[group.target];

	console.log(`\n=== ${group.target} :: ${targetPath}`);
	console.log(`    pre-image md5=${pre} lines=${lineCount(source)}`);
	if (pre !== expect.md5) {
		console.error(`    [STOP] pre-image md5 mismatch: expected ${expect.md5} (audit-recorded). The deployed file changed since the audit — re-audit before patching.`);
		process.exit(3);
	}
	if (lineCount(source) !== expect.lines) {
		console.error(`    [STOP] pre-image line count mismatch: expected ${expect.lines}, got ${lineCount(source)}`);
		process.exit(3);
	}

	// Anchor uniqueness. Anchors are checked against the RUNNING text — the first
	// against the pristine target, every later one against the text its predecessors
	// produced — which is exactly the domain `applyEdits` searches. Two anchors of one
	// group deliberately share a region (the sentinel chain), so checking them all
	// against the pristine source would report a false MISSING.
	const anchors = [];
	let text = source;
	let failed = false;
	for (const edit of group.edits) {
		const hits = countOccurrences(text, edit.find);
		const at = text.indexOf(edit.find);
		const line = at === -1 ? null : text.slice(0, at).split("\n").length;
		const pristineHits = countOccurrences(source, edit.find);
		const verdict = hits === 1 ? "UNIQUE" : hits === 0 ? "MISSING" : `NOT-UNIQUE(${hits})`;
		console.log(`    anchor ${edit.key.padEnd(20)} ${verdict.padEnd(14)} ${hits === 1 ? `line ${line} (pristine occurrences=${pristineHits})` : ""}`);
		anchors.push({ key: edit.key, occurrencesInRunningText: hits, occurrencesInPristine: pristineHits, atLine: line });
		if (hits !== 1) {
			failed = true;
			hardStop = true;
			continue;
		}
		try {
			text = applyEdits(text, [edit], group.target);
		} catch (error) {
			console.error(`    [STOP] ${error.message}`);
			failed = true;
			hardStop = true;
		}
	}
	if (failed) {
		console.error(`    [STOP] anchor validation failed for ${group.target} — no candidate written for this group.`);
		continue;
	}

	// A surviving sentinel means the insert chain did not collapse: refuse to emit it.
	if (text.includes("/*@INSTANCE@*/") || text.includes("/*@FRAME@*/")) {
		console.error(`    [STOP] sentinel survived into the ${group.target} candidate — the insert chain is malformed.`);
		hardStop = true;
		continue;
	}

	const outName = `client.${group.target}.js`;
	const outPath = path.join(outDir, outName);
	fs.writeFileSync(outPath, text);
	manifest.groups.push({
		target: group.target,
		deployPath: targetPath,
		candidate: outName,
		preImageMd5: pre,
		postImageMd5: md5(text),
		preImageLines: lineCount(source),
		postImageLines: lineCount(text),
		anchors
	});
	console.log(`    -> ${outName}  md5=${md5(text)} lines=${lineCount(text)} (+${lineCount(text) - lineCount(source)})`);
}

fs.writeFileSync(path.join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nmanifest: ${path.join(outDir, "MANIFEST.json")}`);
if (hardStop) {
	console.error("\n[STOP] at least one anchor failed uniqueness — batch must not be applied.");
	process.exit(2);
}
console.log("[ok] all anchors unique; candidates written.");
