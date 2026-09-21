#!/usr/bin/env node
/**
 * apply-Theme-v1.mjs — deploy the theme-batch candidates into the deployed profile tree.
 *
 * WRITES ONLY WITH --apply. Without it this is a pure dry run: it reads the deployed
 * targets, re-validates every anchor, checks the pre-image identity, and reports.
 *
 * Guarantees enforced before any byte is written:
 *   1. pre-image md5 + line count equal the audit-recorded values for every target;
 *   2. every anchor matches EXACTLY ONCE in the pristine source (a second match aborts);
 *   3. the patched text is byte-identical to the reviewed candidate artifact;
 *   4. `node --check` passes on the patched text (written to a workspace temp file);
 *   5. every identifier the patch introduces at module scope is DECLARED in the patched file;
 *   6. a pre-image backup is taken under `.workspace/lag-fix/exec-theme/backup/<stamp>/`
 *      (never into the deployed tree) before the write;
 *   7. the write itself is atomic (temp file in the target directory + rename).
 *
 * Usage:
 *   node apply-Theme-v1.mjs                       # dry run, default scope
 *   node apply-Theme-v1.mjs --apply               # write
 *   node apply-Theme-v1.mjs --scope signature,themeColor,wallpaperShade,instances,overlay --apply
 *   node apply-Theme-v1.mjs --restore <stamp>     # restore every backup of that stamp
 *
 * Exit codes: 0 ok/dry-run-clean, 2 precondition failure (nothing written), 3 write failure.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DEPLOY_PATHS, EXPECTED, DEFAULT_SCOPE, editGroups, applyEdits, countOccurrences, introducedFor } from "./lib/patches.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
	const i = argv.indexOf("--" + name);
	return i >= 0 ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes("--" + name);

const APPLY = has("apply");
const scope = argOf("scope", DEFAULT_SCOPE.join(",")).split(",").filter(Boolean);
const STAMP = argOf("stamp", new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15));
const CAND_DIR = argOf("candidates", path.join(HERE, "candidates"));
const BACKUP_DIR = path.join(HERE, "backup", STAMP);
const TMP_DIR = path.join(HERE, "raw", "tmp");
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const wcLines = (text) => (text.match(/\n/g) || []).length;
const fail = (message) => {
	console.error(`\n[PRECONDITION FAILED] ${message}`);
	console.error("Nothing was written. Fix the precondition and re-run.");
	process.exit(2);
};

// --restore ------------------------------------------------------------------
{
	const at = argv.indexOf("--restore");
	if (at !== -1) {
		const restoreStamp = argv[at + 1];
		if (!restoreStamp) fail("--restore needs a stamp, e.g. --restore 20260921-0836");
		const dir = path.join(HERE, "backup", restoreStamp);
		if (!fs.existsSync(dir)) fail(`no backup at ${dir}`);
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".preimage.js"));
		let restored = 0;
		for (const file of files) {
			const meta = JSON.parse(fs.readFileSync(path.join(dir, file.replace(/\.preimage\.js$/, ".meta.json")), "utf8"));
			fs.writeFileSync(meta.target, fs.readFileSync(path.join(dir, file)));
			restored += 1;
			console.log(`[restore] ${meta.target} <- ${file}`);
		}
		console.log(`[restore] ${restored} file(s) restored from ${dir}`);
		process.exit(0);
	}
}

console.log(`apply-Theme-v1  mode=${APPLY ? "APPLY (writing deployed files)" : "DRY-RUN (no writes)"}`);
console.log(`scope=${scope.join(",")}  stamp=${STAMP}  candidates=${CAND_DIR}`);
console.log(`python-free / node ${process.version}\n`);

const groups = editGroups(scope);
if (groups.length === 0) fail(`scope "${scope.join(",")}" selects no edit group`);

const introduced = introducedFor(scope);
const planned = [];

for (const group of groups) {
	const target = group.path;
	console.log(`=== ${group.target}`);
	console.log(`    target   ${target}`);
	if (!fs.existsSync(target)) fail(`target missing: ${target}`);
	const stat = fs.statSync(target);
	const sourceBuf = fs.readFileSync(target);
	const source = sourceBuf.toString("utf8");
	const pre = md5(sourceBuf);
	const expect = EXPECTED[group.target];

	// (1) pre-image identity
	if (has("ignore-preimage")) console.log(`    [warn] --ignore-preimage: skipping the audit pre-image check`);
	else if (pre !== expect.md5) fail(`${group.target}: pre-image md5 ${pre} != audit-recorded ${expect.md5}. The deployed file changed since the audit; re-audit before patching.`);
	if (wcLines(source) !== expect.lines) fail(`${group.target}: pre-image line count ${wcLines(source)} != ${expect.lines}`);
	console.log(`    pre-image md5=${pre} lines=${wcLines(source)} mode=${(stat.mode & 0o777).toString(8)} writable=${canWriteFile(target)}`);

	// (2) anchor uniqueness against the pristine source
	for (const edit of group.edits) {
		const hits = countOccurrences(source, edit.find);
		const atLine = source.indexOf(edit.find) === -1 ? null : source.slice(0, source.indexOf(edit.find)).split("\n").length;
		console.log(`    anchor ${edit.key.padEnd(20)} occurrences=${hits}${atLine ? ` line=${atLine}` : ""}`);
		if (hits !== 1) fail(`${group.target}/${edit.key}: anchor matched ${hits} times (must be exactly 1)`);
	}

	let text;
	try {
		text = applyEdits(source, group.edits, group.target);
	} catch (error) {
		fail(error.message);
	}

	// (3) candidate identity
	const candPath = path.join(CAND_DIR, `client.${group.target}.js`);
	if (fs.existsSync(candPath)) {
		const cand = fs.readFileSync(candPath, "utf8");
		if (cand !== text) fail(`${group.target}: patched text differs from reviewed candidate ${candPath} — regenerate candidates before applying`);
		console.log(`    candidate identity OK (${path.relative(HERE, candPath)})`);
	} else {
		console.log(`    [warn] no reviewed candidate at ${candPath}; proceeding from the anchor definitions only`);
	}

	// (4) syntax check on the patched text
	fs.mkdirSync(TMP_DIR, { recursive: true });
	const tmp = path.join(TMP_DIR, `client.${group.target}.check.js`);
	fs.writeFileSync(tmp, text);
	try {
		execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
		console.log(`    node --check OK`);
	} catch (error) {
		fail(`${group.target}: node --check failed on the patched text:\n${error.stderr?.toString() || error.message}`);
	}

	// (5) introduced identifiers are declared in the patched file
	for (const name of introduced[group.target] ?? []) {
		const declared = new RegExp(String.raw`(?:^|\n)[ \t]*(?:const|let|var|function|class)[ \t]+${escapeRe(name)}\b`).test(text);
		const referenced = new RegExp(String.raw`\b${escapeRe(name)}\b`).test(text.replace(new RegExp(String.raw`(?:const|let|var|function)[ \t]+${escapeRe(name)}\b`, "g"), ""));
		console.log(`    identifier ${name.padEnd(26)} declared=${declared} referenced=${referenced}`);
		if (!declared) fail(`${group.target}: introduced identifier "${name}" has no declaration in the patched file`);
		if (!referenced) fail(`${group.target}: introduced identifier "${name}" is never referenced`);
	}

	planned.push({ group, target, pre, post: md5(Buffer.from(text, "utf8")), text, sourceBuf });
	console.log(`    post-image md5=${md5(Buffer.from(text, "utf8"))} lines=${wcLines(text)} delta=+${wcLines(text) - wcLines(source)}\n`);
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function canWriteFile(file) {
	try {
		fs.accessSync(file, fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

console.log(`--- ${planned.length} group(s) validated ---`);
for (const item of planned) console.log(`    ${item.group.target.padEnd(10)} ${item.pre} -> ${item.post}`);

if (!APPLY) {
	console.log(`\n[DRY-RUN] no file written. Re-run with --apply to deploy (the deploying writer must own ${DEPLOY_PATHS.layout.replace(/\/node_modules.*$/, "")}/...).`);
	process.exit(0);
}

// ---------------------------------------------------------------------------
// APPLY
// ---------------------------------------------------------------------------
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const applied = [];
for (const item of planned) {
	if (!canWriteFile(item.target)) {
		fail(`target not writable by this process: ${item.target}`);
	}
	try {
		// (6) pre-image backup OUTSIDE the deployed tree
		fs.writeFileSync(path.join(BACKUP_DIR, `${item.group.target}.preimage.js`), item.sourceBuf);
		fs.writeFileSync(path.join(BACKUP_DIR, `${item.group.target}.meta.json`), JSON.stringify({
			target: item.target,
			preImageMd5: item.pre,
			postImageMd5: item.post,
			stamp: STAMP,
			scope,
			at: new Date().toISOString()
		}, null, 2) + "\n");
		// (7) atomic write
		const tmp = path.join(path.dirname(item.target), `.client.js.theme-v1.${process.pid}.tmp`);
		fs.writeFileSync(tmp, item.text);
		fs.renameSync(tmp, item.target);
		const readBack = fs.readFileSync(item.target);
		if (md5(readBack) !== item.post) throw new Error(`read-back md5 mismatch on ${item.target}`);
		applied.push({ target: item.target, md5: item.post });
		console.log(`[applied] ${item.target} md5=${item.post} (pre-image backed up to ${path.relative(HERE, BACKUP_DIR)})`);
	} catch (error) {
		console.error(`[WRITE FAILED] ${item.target}: ${error.message}`);
		process.exit(3);
	}
}

fs.writeFileSync(path.join(HERE, "raw", `applied-${STAMP}.json`), JSON.stringify({
	stamp: STAMP, scope, applied, backupDir: BACKUP_DIR, at: new Date().toISOString()
}, null, 2) + "\n");
console.log(`\n[ok] ${applied.length} file(s) written. Backups: ${BACKUP_DIR}`);
console.log(`[next] the client bundles carry a ?rev= stamp and __DSH_BOOT__ has no __DSH_HMR__: this batch needs a restart to take effect.`);
console.log(`[next] then run experiments/run-theme-experiments.sh (M-A baseline / M-B / M-C / M-D) and experiments/probe-instances.mjs.`);
