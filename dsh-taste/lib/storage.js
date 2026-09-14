import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, constants as fsConstants, mkdir, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
//#region lib/storage.js
/**
 * Taste storage: the `taste.md` entry format, the relative-path whitelist,
 * atomic writes and cross-process locking, redaction and clipping helpers,
 * category reorganization, and the read-only Command Code compatibility scan.
 *
 * Ported 1:1 from pi-taste `storage.ts` (TypeScript → plain ESM JavaScript):
 * parsing, whitelisting, slugging and reorganization semantics are unchanged.
 * Scope directories are injected by the caller instead of derived from
 * `getAgentDir()`, atomicity and locking are delegated to
 * `@deepseek-ai/dsh-atomic-write` instead of being reimplemented, and parsed
 * entries carry `{ statement, confidence }` without pi-taste's ids/scopes.
 * @module lib/storage
 */

/** How long a taste-file writer waits on a contended lock before failing. */
const TASTE_LOCK_WAIT_MS = 10_000;

/** Marker inserted by {@link clipText} where middle content was dropped. */
const CLIP_MARKER = "[...clipped...]";

/** Content of the `.gitignore` written into a project taste directory. */
const PROJECT_GITIGNORE_CONTENT = "*";

/**
 * Whether `path` exists and is visible to the current process.
 * @param {string} path - candidate path.
 * @returns {Promise<boolean>} existence verdict.
 */
async function exists(path) {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Clamp an untrusted confidence value into `[0, 1]`; unusable values fall
 * back to pi-taste's neutral `0.5`.
 * @param {unknown} value - parsed capture or stored number.
 * @returns {number} confidence clamped into `[0, 1]`.
 */
function normalizedConfidence(value) {
	const parsed = typeof value === "number" ? value : Number.parseFloat(value);
	return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
}

/**
 * Split a model-supplied relative taste path into non-trivial segments.
 * Empty input, absolute paths (leading `/` or `\`) and drive-qualified paths
 * yield `[]`; `.` and empty parts are dropped; `..` survives as a segment so
 * callers can reject it explicitly.
 * @param {unknown} relPath - model-supplied relative path.
 * @returns {string[]} path segments.
 */
function tastePathSegments(relPath) {
	const trimmed = typeof relPath === "string" ? relPath.trim() : "";
	if (!trimmed) return [];
	if (trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[A-Za-z]:[\\/]?/.test(trimmed)) return [];
	return trimmed
		.replace(/^[/\\]+/, "")
		.split(/[/\\]+/)
		.filter((segment) => segment !== "" && segment !== ".");
}

/**
 * Whether `value` may name one category directory: a Unicode letter or
 * number first, then letters/numbers/dot/underscore/hyphen up to 64 chars
 * total, no trailing dot, and no Windows reserved device name.
 * @param {string} value - candidate category segment.
 * @returns {boolean} safety verdict.
 */
function isSafeCategorySegment(value) {
	if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u.test(value) || value.endsWith(".")) return false;
	return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

/**
 * Slugify a heading into a category directory name (pi-taste semantics):
 * NFKC-normalized, lowercased, unsafe runs collapsed to `-`, edges trimmed,
 * capped at 64 chars; anything unsafe (empty, reserved, malformed) falls back
 * to a `category-<sha256-12>` hash of the original name.
 * @param {string} name - category heading text.
 * @returns {string} safe directory segment.
 */
function categorySlug(name) {
	let slug = name
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 64)
		.replace(/[._-]+$/g, "");
	if (!isSafeCategorySegment(slug)) {
		slug = `category-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
	}
	return slug;
}

/**
 * Parse `taste.md` content into entries. Only bullet lines shaped
 * `- statement. Confidence: 0.88` count; headings, prose, non-bullet lines and
 * statements shorter than four characters are skipped (pi-taste semantics).
 * One or two decimals are both legal — legacy one-decimal (`0.9`) and integer
 * (`1`) confidences parse alongside the two-decimal form the learner now
 * writes. A Chinese full stop directly before `Confidence:` is tolerated, so
 * `- 陈述。Confidence: 0.88` parses alongside the spaced form.
 * @param {string} text - taste file content.
 * @returns {Array<{statement: string, confidence: number}>} parsed entries.
 */
export function parseTasteFile(text) {
	const entries = [];
	for (const line of String(text ?? "").split(/\r?\n/)) {
		const match = line.match(/^\s*-\s+(.+?)(?:\s+|(?<=[。．]))Confidence:\s*(\d*\.?\d+)\s*$/);
		if (!match) continue;
		const statement = match[1].trim();
		if (statement.length < 4) continue;
		entries.push({ statement, confidence: normalizedConfidence(match[2]) });
	}
	return entries;
}

/**
 * Render one confidence value for a taste-file line: rounded to two decimals,
 * then formatted with one decimal when the second decimal is zero — legacy
 * snapshots stay byte-identical (`0.9→"0.9"`, `1→"1.0"`) while fresh
 * two-decimal learnings survive unrounded (`0.88→"0.88"`, `0.95→"0.95"`).
 * @param {unknown} value - confidence value (clamped into `[0, 1]`).
 * @returns {string} one- or two-decimal rendering.
 */
export function formatTasteConfidence(value) {
	const rounded = Math.round(normalizedConfidence(value) * 100) / 100;
	const two = rounded.toFixed(2);
	return two;
}

/** Fallback gate threshold when the caller-supplied value is unusable (keep in sync with config.js / index.js). */
const DEFAULT_MIN_CONFIDENCE = 0.7;

/**
 * Entries clearing the injection/GUI confidence gate: confidence >=
 * minConfidence (boundary-inclusive — an entry exactly at the threshold
 * stays). The threshold is defensively clamped into [0, 1]; an unusable
 * threshold falls back to the default. Non-array input yields [].
 * Read-side filter only — nothing is removed from storage.
 * @param {Array<{statement: string, confidence: number}>} entries - parsed taste entries.
 * @param {unknown} minConfidence - gate threshold (untrusted, from config).
 * @returns {Array<{statement: string, confidence: number}>} entries that clear the gate.
 */
export function gateTasteEntries(entries, minConfidence) {
	const threshold = typeof minConfidence === "number" && Number.isFinite(minConfidence)
		? Math.min(1, Math.max(0, minConfidence))
		: DEFAULT_MIN_CONFIDENCE;
	return (Array.isArray(entries) ? entries : []).filter((entry) => normalizedConfidence(entry?.confidence) >= threshold);
}

/**
 * Render entries back into the `- statement. Confidence: 0.88` line sequence
 * via {@link formatTasteConfidence} (one decimal for exact tenths, two
 * otherwise; trailing newline); an empty list renders as `""`.
 * @param {Array<{statement: string, confidence: number}>} preferences - entries to render.
 * @returns {string} taste file content.
 */
export function renderTasteFile(preferences) {
	const entries = Array.isArray(preferences) ? preferences : [];
	return entries.length === 0
		? ""
		: `${entries
				.map((entry) => `- ${entry.statement} Confidence: ${formatTasteConfidence(entry.confidence)}`)
				.join("\n")}\n`;
}

/**
 * Whether `relPath` is whitelisted: exactly `taste.md`, or
 * `{category}/taste.md` with a safe category segment (≤64 chars, no Windows
 * reserved names). Traversal, absolute and drive-qualified paths fail here.
 * @param {unknown} relPath - model-supplied relative path.
 * @returns {boolean} whitelist verdict.
 */
export function isValidTasteFilePath(relPath) {
	const segments = tastePathSegments(relPath);
	if (segments.length === 1) return segments[0] === "taste.md";
	return segments.length === 2 && isSafeCategorySegment(segments[0]) && segments[1] === "taste.md";
}

/**
 * Authoritative resolver for a model-supplied taste path: turns
 * `taste.md` / `{category}/taste.md` into an absolute path inside
 * `scopeDir` and throws on anything else — empty input, absolute or
 * drive-qualified paths, `..` traversal, and non-whitelisted shapes.
 * @param {string} scopeDir - absolute taste scope directory.
 * @param {unknown} relPath - model-supplied relative path.
 * @returns {string} absolute file path.
 */
export function resolveTastePath(scopeDir, relPath) {
	if (typeof scopeDir !== "string" || !scopeDir.trim()) throw new Error("taste scope directory is required");
	const base = resolve(scopeDir);
	const trimmed = typeof relPath === "string" ? relPath.trim() : "";
	const refuse = (reason) => {
		throw new Error(
			`taste path ${JSON.stringify(trimmed)} refused: ${reason}; expected "taste.md" or "{category}/taste.md"`,
		);
	};
	const segments = tastePathSegments(trimmed);
	if (segments.length === 0) refuse("path is empty, absolute, or drive-qualified");
	if (segments.includes("..")) refuse("path traversal with .. is not allowed");
	if (!isValidTasteFilePath(trimmed)) refuse("path is outside the whitelist");
	const absolute = resolve(base, ...segments);
	if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) refuse("resolved path escapes the taste directory");
	return absolute;
}

/**
 * Read a taste file inside `scopeDir` (whitelist enforced). A missing file
 * rejects with the underlying `ENOENT` error.
 * @param {string} scopeDir - absolute taste scope directory.
 * @param {string} relPath - relative taste path.
 * @returns {Promise<string>} file content.
 */
export async function readTasteFile(scopeDir, relPath) {
	return readFile(resolveTastePath(scopeDir, relPath), "utf8");
}

/**
 * List the whitelisted taste files present in `scopeDir`: the root file first
 * (`taste.md`), then `{category}/taste.md` for each safe one-level category
 * directory, sorted. A missing scope directory yields `[]`.
 * @param {string} scopeDir - absolute taste scope directory.
 * @returns {Promise<string[]>} relative taste paths.
 */
export async function listTasteFiles(scopeDir) {
	const files = [];
	if (typeof scopeDir !== "string" || !scopeDir.trim()) return files;
	const base = resolve(scopeDir);
	if (await exists(join(base, "taste.md"))) files.push("taste.md");
	let entries = [];
	try {
		entries = await readdir(base, { withFileTypes: true });
	} catch {
		return files;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (!entry.isDirectory() || !isSafeCategorySegment(entry.name)) continue;
		if (await exists(join(base, entry.name, "taste.md"))) files.push(`${entry.name}/taste.md`);
	}
	return files;
}

/**
 * Atomically replace `filePath` with `content` (mode 0600 file, 0700 parent
 * directories) via `dsh-atomic-write`'s rename-based commit.
 * @param {string} filePath - absolute target file path.
 * @param {string} content - complete next file content.
 * @returns {Promise<void>} resolves once the file has been replaced.
 */
export async function writeFileAtomicTaste(filePath, content) {
	await writeFileAtomic(filePath, content, { mode: 0o600, dirMode: 0o700 });
}

/**
 * Hold the cross-process writer lock (`<filePath>.lock`) around one
 * operation, delegating to `dsh-atomic-write`'s `withFileLock` with a 10s
 * wait budget. The lock must not span LLM calls; the parent directory must
 * already exist.
 * @param {string} filePath - absolute file whose writers to serialize.
 * @param {() => Promise<T>} operation - read-modify-write cycle to run.
 * @returns {Promise<T>} the operation's result; the lock releases on both outcomes.
 */
export function withTasteLock(filePath, operation) {
	return withFileLock(filePath, operation, { waitMs: TASTE_LOCK_WAIT_MS });
}

/**
 * Strip credential-looking text: `sk-`/`ghp_`/`github_pat_`/`xox*`-style
 * tokens, `Bearer` headers, and `api_key|access_token|password|secret`
 * assignments. Ported 1:1 from pi-taste.
 * @param {string} value - text to redact.
 * @returns {string} redacted text.
 */
export function redactSensitive(value) {
	return String(value ?? "")
		.replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi, "Bearer [REDACTED_TOKEN]")
		.replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"']{8,}/gi, "$1[REDACTED]");
}

/**
 * Bound `value` to `maxChars` characters by keeping the head (35% of the
 * budget) and the tail, joined by the `[...clipped...]` marker. Shorter
 * values pass through unchanged; an unusable budget yields `""`.
 * @param {string} value - text to bound.
 * @param {number} maxChars - maximum rendered length.
 * @returns {string} bounded text.
 */
export function clipText(value, maxChars) {
	const text = String(value ?? "");
	const max = Math.floor(Number(maxChars));
	if (!Number.isFinite(max) || max <= 0) return "";
	if (text.length <= max) return text;
	if (max <= CLIP_MARKER.length) return text.slice(0, max);
	const head = Math.max(0, Math.floor(max * 0.35));
	const tail = Math.max(0, max - head - CLIP_MARKER.length);
	return `${text.slice(0, head)}${CLIP_MARKER}${tail > 0 ? text.slice(-tail) : ""}`;
}

/**
 * Deduplication key for a preference statement (pi-taste semantics): NFKC
 * normalized, lowercased, a trailing `Confidence: x` marker stripped, then
 * punctuation/symbols/whitespace runs collapsed to single spaces.
 * @param {string} statement - preference statement.
 * @returns {string} normalized key.
 */
export function normalizePreferenceKey(statement) {
	return String(statement ?? "")
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/\bconfidence\s*:\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\b/gi, "")
		.replace(/[\p{P}\p{S}\s]+/gu, " ")
		.trim();
}

/**
 * Find the enclosing project root by walking up from `cwd` to the first
 * directory holding `.git` (file or directory); when none is found the
 * resolved `cwd` itself is returned, mirroring pi-taste.
 * @param {string} cwd - directory to walk up from.
 * @returns {string} project root (or `cwd` when outside any repository).
 */
export function projectRootFor(cwd) {
	const workspaceRoot = resolve(cwd ?? ".");
	let current = workspaceRoot;
	for (;;) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return workspaceRoot;
		current = parent;
	}
}

/**
 * Create the project taste directory `dir` (recursively, mode 0700) and drop
 * a `.gitignore` holding `*` so preference state never enters version
 * control. An existing `.gitignore` is never overwritten.
 * @param {string} dir - project taste directory.
 * @returns {Promise<void>} resolves once the directory is ready.
 */
export async function ensureProjectTasteDir(dir) {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const ignorePath = join(dir, ".gitignore");
	if (!(await exists(ignorePath))) {
		await writeFileAtomicTaste(ignorePath, PROJECT_GITIGNORE_CONTENT);
	}
}

/**
 * Split root taste content into level-one `# ` heading sections. Only
 * explicit headings define categories — unheaded root bullets are valid
 * entries and never become directory names — and sections already replaced by
 * a `See [...]` link are skipped. Ported 1:1 from pi-taste.
 * @param {string} content - root taste file content.
 * @returns {Array<{name: string, learningCount: number, learnings: string[], fullSection: string}>} sections.
 */
function parseCategorySections(content) {
	const sections = [];
	const headings = [...content.matchAll(/^# ([^\r\n]+)[^\S\r\n]*(?:\r?\n|$)/gm)];
	for (let index = 0; index < headings.length; index++) {
		const match = headings[index];
		const start = match.index ?? 0;
		const end = headings[index + 1]?.index ?? content.length;
		const fullSection = content.slice(start, end);
		const body = fullSection.slice(match[0].length);
		const name = match[1].trim();
		if (!name || body.includes("See [")) continue;
		const learnings = body
			.split(/\r?\n/)
			.filter((line) => line.trim().startsWith("- ") && line.includes("Confidence:"));
		if (learnings.length > 0) {
			sections.push({ name, learningCount: learnings.length, learnings, fullSection });
		}
	}
	return sections;
}

/**
 * Reorganize the root `taste.md` of `scopeDir` the way Command Code does:
 * every level-one `# ` heading section holding more than five learnings moves
 * into its own `<slug>/taste.md` (heading preserved), and the root keeps a
 * `See [<slug>/taste.md](<slug>/taste.md)` link in its place. Writes are
 * atomic; `false` means nothing crossed the threshold and the tree is
 * untouched.
 * @param {string} scopeDir - absolute taste scope directory.
 * @returns {Promise<boolean>} whether any category was moved.
 */
export async function reorganizeIfNeeded(scopeDir) {
	if (typeof scopeDir !== "string" || !scopeDir.trim()) return false;
	const base = resolve(scopeDir);
	const root = join(base, "taste.md");
	if (!(await exists(root))) return false;
	const content = await readFile(root, "utf8");
	const categories = parseCategorySections(content).filter((category) => category.learningCount > 5);
	if (categories.length === 0) return false;
	let updated = content;
	for (const category of categories) {
		const slug = categorySlug(category.name);
		await writeFileAtomicTaste(join(base, slug, "taste.md"), `# ${category.name}\n${category.learnings.join("\n")}\n`);
		updated = updated.replace(category.fullSection, `# ${category.name}\nSee [${slug}/taste.md](${slug}/taste.md)\n`);
	}
	await writeFileAtomicTaste(root, updated);
	return true;
}

/**
 * Collect read-only Command Code taste files under one store base: the root
 * `taste.md` plus one-level directories matching Command Code's plain-name
 * rule (letters/digits/dot/underscore/hyphen, ≤64 chars, no `--` prefix).
 * Ported 1:1 from pi-taste; a missing base yields `[]`.
 * @param {string} base - Command Code taste store directory.
 * @returns {Promise<string[]>} candidate file paths.
 */
async function commandCodePackageFiles(base) {
	const files = [];
	const main = join(base, "taste.md");
	if (await exists(main)) files.push(main);
	let entries = [];
	try {
		entries = await readdir(base, { withFileTypes: true });
	} catch {
		return files;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (!/^[A-Za-z0-9_.-]{1,64}$/.test(entry.name) || entry.name.startsWith("--")) continue;
		const candidate = join(base, entry.name, "taste.md");
		if (await exists(candidate)) files.push(candidate);
	}
	return files;
}

/**
 * Read-only scan of the Command Code compatibility stores —
 * `<globalHome>/.commandcode/taste` and, when given,
 * `<projectRoot>/.commandcode/taste` — through their root and one-level
 * category files. Entries dedupe by {@link normalizePreferenceKey} in scan
 * order (global first, project second). Never writes anything; missing
 * stores yield `[]`.
 * @param {string} globalHome - user home directory.
 * @param {string} [projectRoot] - project root, when inside a repository.
 * @returns {Promise<Array<{statement: string, confidence: number}>>} imported entries.
 */
export async function loadCommandCodeTaste(globalHome, projectRoot) {
	const sources = [{ base: join(globalHome || homedir(), ".commandcode", "taste") }];
	if (projectRoot) sources.push({ base: join(projectRoot, ".commandcode", "taste") });
	const imported = [];
	const seen = new Set();
	for (const source of sources) {
		for (const path of await commandCodePackageFiles(source.base)) {
			let content;
			try {
				content = await readFile(path, "utf8");
			} catch {
				continue;
			}
			for (const entry of parseTasteFile(content)) {
				const key = normalizePreferenceKey(entry.statement);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				imported.push({ statement: entry.statement, confidence: entry.confidence });
			}
		}
	}
	return imported;
}

/**
 * Best-effort entries from one taste scope directory: every whitelisted file
 * {@link listTasteFiles} reports, parsed; unreadable files are skipped.
 * @param {string} scopeDir - absolute taste scope directory.
 * @returns {Promise<Array<{statement: string, confidence: number}>>} parsed entries.
 */
async function readScopeEntries(scopeDir) {
	const entries = [];
	for (const relPath of await listTasteFiles(scopeDir)) {
		try {
			entries.push(...parseTasteFile(await readTasteFile(scopeDir, relPath)));
		} catch {
			// A listed file can vanish or turn unreadable between listing and
			// reading; a snapshot stays best-effort and skips the loss.
		}
	}
	return entries;
}

/**
 * Shared deletion core (`/taste forget` + GUI deleteEntry, gui-mutation-design
 * §2): for each target file, remove every entry whose
 * {@link normalizePreferenceKey} is in that target's keys — one locked
 * read-modify-write per file while preserving the one-way lock order.
 * behavior and every learner write tool. An emptied file is written as `""`
 * (never unlinked). Targets are regrouped per `${scopeDir}\0${relPath}` so
 * repeated keys merge into one locked rewrite; a file that cannot be read is
 * silently skipped (forget semantics); keys are pruned of empty strings — a
 * punctuation-only statement normalizes to `""` and is never a deletion key
 * @param {Array<{scopeDir: string, relPath: string, keys: Iterable<string>}>} targets -
 *   callers pass ALREADY-NORMALIZED keys ({@link normalizePreferenceKey}).
 * @param {(message: string) => void} [warn] - optional diagnostic sink for prune failures.
 * @returns {Promise<number>} total entries removed (0 = nothing matched).
 */
export async function deleteTasteEntries(targets, warn) {
	const byFile = new Map();
	for (const target of Array.isArray(targets) ? targets : []) {
		if (typeof target?.scopeDir !== "string" || !target.scopeDir) continue;
		if (typeof target?.relPath !== "string" || !target.relPath) continue;
		const fileKey = `${target.scopeDir}\u0000${target.relPath}`;
		if (!byFile.has(fileKey)) byFile.set(fileKey, { scopeDir: target.scopeDir, relPath: target.relPath, keys: new Set() });
		const file = byFile.get(fileKey);
		for (const key of target.keys ?? []) {
			if (typeof key === "string" && key) file.keys.add(key);
		}
	}
	let removed = 0;
	for (const file of byFile.values()) {
		const absolute = join(file.scopeDir, file.relPath);
		await withTasteLock(absolute, async () => {
			let content;
			try {
				content = await readTasteFile(file.scopeDir, file.relPath);
			} catch {
				return; // A vanished/unreadable file is skipped, like forget's loop.
			}
			const before = parseTasteFile(content);
			const remaining = before.filter((entry) => !file.keys.has(normalizePreferenceKey(entry.statement)));
			if (remaining.length === before.length) return; // No change → no write.
			await writeFileAtomicTaste(absolute, renderTasteFile(remaining));
			removed += before.length - remaining.length;
		});
	}
	return removed;
}

/**
 * Build the injection snapshot: project scope first, then global scope, then
 * the Command Code compatibility stores, deduped by
 * {@link normalizePreferenceKey} with project entries winning, rendered as
 * bullet lines. The Command Code stores sit two levels above each scope
 * directory in the standard layout (`~/.dsh/taste` → `~/.commandcode/taste`,
 * `<root>/.dsh/taste` → `<root>/.commandcode/taste`). An empty harvest
 * renders as `""`. 不门控（by design）：`/taste status` 计全量库；注入侧门控
 * 见 index.js readSnapshotSync / gateTasteEntries。
 * @param {string} globalDir - global taste scope directory.
 * @param {string} [projectDir] - project taste scope directory, when inside a repository.
 * @returns {Promise<string>} snapshot text.
 */
export async function loadTasteSnapshot(globalDir, projectDir) {
	const merged = [];
	const seen = new Set();
	const add = (entries) => {
		for (const entry of entries) {
			const key = normalizePreferenceKey(entry.statement);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			merged.push(entry);
		}
	};
	if (projectDir) add(await readScopeEntries(projectDir));
	if (globalDir) add(await readScopeEntries(globalDir));
	add(
		await loadCommandCodeTaste(
			globalDir ? resolve(globalDir, "..", "..") : homedir(),
			projectDir ? resolve(projectDir, "..", "..") : undefined,
		),
	);
	return renderTasteFile(merged);
}
//#endregion
