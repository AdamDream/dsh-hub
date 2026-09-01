import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
	isValidTasteFilePath,
	normalizePreferenceKey,
	parseTasteFile,
	renderTasteFile,
	resolveTastePath,
	withTasteLock,
	writeFileAtomicTaste,
} from "./storage.js";
//#region lib/learner-tools.js
/**
 * The three taste-file tools the learner agent uses to record preferences.
 * Every tool resolves its scope directory lazily at execution time, validates
 * the model-supplied relative path against the storage whitelist, and reports
 * failures as `error: ...` text so the learner can read and self-correct
 * instead of aborting its turn.
 * @module dsh-taste/learner-tools
 */
const SCOPE_VALUES = ["global", "project"];
const PATH_RULES = 'taste file must be "taste.md" or "{category}/taste.md"';
const UNPARSABLE_HINT =
	'error: content holds no valid taste entries ("- statement. Confidence: 0.9"); re-read the file with read_taste_file and use edit_taste_file to amend it instead of overwriting';

/** Flatten any thrown value into one message line. */
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve a scope plus relative path into an absolute file path, or return an
 * `error:` string. The whitelist check runs first for a friendly message;
 * `resolveTastePath` remains the authoritative gate against traversal.
 */
function resolveTarget(deps, scope, relPath) {
	let scopeDir;
	try {
		scopeDir = scope === "project" ? deps.resolveProjectDir() : deps.resolveGlobalDir();
	} catch (error) {
		return `error: cannot resolve ${scope} taste directory: ${errorText(error)}`;
	}
	if (!isValidTasteFilePath(relPath)) return `error: ${PATH_RULES}`;
	try {
		return { absolute: resolveTastePath(scopeDir, relPath) };
	} catch (error) {
		return `error: ${errorText(error)}`;
	}
}

/**
 * Union of the incoming entries plus every current entry the incoming content
 * does not state, keyed by {@link normalizePreferenceKey}. Order: incoming
 * first, then the surviving current entries in file order.
 */
function mergeTasteEntries(current, incoming) {
	const stated = new Set(incoming.map((entry) => normalizePreferenceKey(entry.statement)));
	const merged = [...incoming];
	for (const entry of current) {
		const key = normalizePreferenceKey(entry.statement);
		if (!stated.has(key)) {
			merged.push(entry);
			stated.add(key);
		}
	}
	return merged;
}

/** `read_taste_file`: return the file content, or an explicit miss/error text. */
async function executeRead(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	try {
		return await readFile(target.absolute, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return "(file does not exist)";
		return `error: ${errorText(error)}`;
	}
}

/**
 * `write_taste_file`: read-merge-write inside the taste lock. The submitted
 * content is a target snapshot, never a blind overwrite — entries the file
 * already holds and the content does not state survive, so writes that raced
 * across LLM turns cannot lose each other.
 */
async function executeWrite(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	const { absolute } = target;
	try {
		// The lock sibling is created inside the target directory, which may be
		// brand new, so the directory must exist before the lock is acquired.
		await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
		let result = `wrote ${args.path}`;
		await withTasteLock(absolute, async () => {
			let current = "";
			try {
				current = await readFile(absolute, "utf8");
			} catch {
				current = "";
			}
			const currentEntries = parseTasteFile(current);
			if (currentEntries.length === 0) {
				// Empty (or entry-less) file: write the submitted content verbatim.
				await writeFileAtomicTaste(absolute, args.content);
				return;
			}
			const incomingEntries = parseTasteFile(args.content);
			if (incomingEntries.length === 0) {
				deps.log(`write_taste_file refused non-taste content for ${args.path}`);
				result = UNPARSABLE_HINT;
				return;
			}
			await writeFileAtomicTaste(absolute, renderTasteFile(mergeTasteEntries(currentEntries, incomingEntries)));
		});
		return result;
	} catch (error) {
		return `error: ${errorText(error)}`;
	}
}

/**
 * `edit_taste_file`: read, replace the one unique `old_text` occurrence, and
 * write atomically — all inside the taste lock, so the edit is RMW-safe.
 */
async function executeEdit(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	if (args.old_text.length === 0) return "error: old_text must be a non-empty string";
	const { absolute } = target;
	try {
		// Existence probe first: a missing file must report cleanly (and create
		// nothing) even when the scope — and with it the lock sibling's
		// directory — does not exist yet. The authoritative read still happens
		// inside the lock below, so a file deleted after this probe is caught.
		try {
			await stat(absolute);
		} catch (error) {
			if (error?.code === "ENOENT") return "error: file does not exist";
			return `error: ${errorText(error)}`;
		}
		let result = `edited ${args.path}`;
		await withTasteLock(absolute, async () => {
			let current;
			try {
				current = await readFile(absolute, "utf8");
			} catch (error) {
				result = error?.code === "ENOENT" ? "error: file does not exist" : `error: ${errorText(error)}`;
				return;
			}
			const hits = current.split(args.old_text).length - 1;
			if (hits === 0) {
				result = "error: old_text not found";
				return;
			}
			if (hits > 1) {
				result = `error: old_text matches ${hits} locations; provide a longer snippet that matches exactly one`;
				return;
			}
			await writeFileAtomicTaste(absolute, current.replace(args.old_text, args.new_text));
		});
		return result;
	} catch (error) {
		return `error: ${errorText(error)}`;
	}
}

/** Tool definition shared plumbing: string result rendered as one text block. */
const stringOutput = {
	schema: { type: "string" },
	render: (_args, value) => [{ type: "text", text: value }],
};

/** Build the `read_taste_file` definition. */
function readTasteFileTool(deps) {
	return defineTool({
		name: "read_taste_file",
		description: 'Read a taste file. Path is relative to the taste directory: "taste.md" or "{category}/taste.md".',
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: 'Taste directory to read: "global" (user-wide) or "project" (current repository).',
			},
			path: {
				type: "string",
				required: true,
				description: 'Relative taste path: "taste.md" or "{category}/taste.md".',
			},
		},
		output: stringOutput,
		execute: (args) => executeRead(deps, args),
	});
}

/** Build the `write_taste_file` definition. */
function writeTasteFileTool(deps) {
	return defineTool({
		name: "write_taste_file",
		description: 'Create or replace a taste file with "- statement. Confidence: 0.9" entries. Entries already on disk that the content does not state are kept. Path MUST be "taste.md" or "{category}/taste.md".',
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: 'Taste directory to write: "global" (user-wide) or "project" (current repository).',
			},
			path: {
				type: "string",
				required: true,
				description: 'Relative taste path: "taste.md" or "{category}/taste.md".',
			},
			content: {
				type: "string",
				required: true,
				description: 'Full target content as taste entries ("- statement. Confidence: 0.9" lines).',
			},
		},
		output: stringOutput,
		execute: (args) => executeWrite(deps, args),
	});
}

/** Build the `edit_taste_file` definition. */
function editTasteFileTool(deps) {
	return defineTool({
		name: "edit_taste_file",
		description: "Replace exactly one occurrence of old_text with new_text in a taste file; old_text must match uniquely. Path MUST be \"taste.md\" or \"{category}/taste.md\".",
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: 'Taste directory to edit: "global" (user-wide) or "project" (current repository).',
			},
			path: {
				type: "string",
				required: true,
				description: 'Relative taste path: "taste.md" or "{category}/taste.md".',
			},
			old_text: {
				type: "string",
				required: true,
				description: "Exact text to replace; must occur exactly once in the file.",
			},
			new_text: {
				type: "string",
				required: true,
				description: "Replacement text (may be empty to delete).",
			},
		},
		output: stringOutput,
		execute: (args) => executeEdit(deps, args),
	});
}

/**
 * Build the learner's three taste-file tools.
 * @param {object} deps - directory resolvers called lazily per execution, plus
 *   an optional log sink for refusals.
 * @param {() => string} deps.resolveGlobalDir - absolute global taste directory.
 * @param {() => string} deps.resolveProjectDir - absolute project taste directory.
 * @param {(message: string) => void} [deps.log] - diagnostic sink.
 * @returns {Array<object>} `read_taste_file`, `write_taste_file`, and
 *   `edit_taste_file` definitions ready for tool registration.
 */
export function createTasteTools({ resolveGlobalDir, resolveProjectDir, log }) {
	const deps = {
		resolveGlobalDir,
		resolveProjectDir,
		log: typeof log === "function" ? log : () => {},
	};
	return [readTasteFileTool(deps), writeTasteFileTool(deps), editTasteFileTool(deps)];
}
//#endregion
