import { readFile } from "node:fs/promises";
//#region lib/model-registry.js
/**
 * Zero-dependency reader for the DSH model registry (`~/.dsh/settings.yaml`,
 * resolved by index.js via `dshHomePath("settings.yaml")` — the same root and
 * precedence as every official settings consumer). The registry lives at
 * `llm-pi-ai.providers.<provider>.models[].id`; the GUI consumes it to offer a
 * model dropdown for the learner's custom route (gui-mutation-design §3).
 *
 * `settings.yaml` is parsed with a hand-written line scanner, NOT the official
 * `yaml` package: dsh-taste ships no runtime dependency on it (zero-new-deps
 * constraint, gui-mutation-design §0.5). The scanner only understands the
 * block-style YAML the official writer emits and is deliberately blind to
 * everything else — anchors, flow style, quoted keys and tabs produce missing
 * entries or an empty map, never wrong ones ("宁缺勿假"): the GUI falls back
 * to free-text input whenever the expected provider list is absent.
 * @module dsh-taste/model-registry
 */

/** Block-key line: `key:` with an empty value (an optional trailing comment). */
const KEY_RE = /^([^\s:]+)\s*:\s*(?:#.*)?$/;

/** List-item line carrying an id: `- id: X`, quoted or bare, optional comment. */
const ID_RE = /^-\s+id\s*:\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))\s*(?:#.*)?$/;

/** Root key of the model registry; nothing else may seed the block stack. */
const REGISTRY_ROOT = "llm-pi-ai";

/**
 * Parse the model registry out of `settings.yaml` text: a block-path stack
 * state machine that collects `- id:` values under
 * `llm-pi-ai.providers.<name>.models` (gui-mutation-design §3.3).
 *
 * Mechanics: every empty-value block key pushes a `{key, indent}` frame; a
 * line pops every frame whose indent is `>=` its own before anything else.
 * A `models:` frame is *registered* only when the post-push stack suffix is
 * exactly `llm-pi-ai → providers → <name> → models` — and that registration
 * is the ONLY place `listIndent` resets to "unset". A `- id:` line collects
 * solely under a registered `models` frame, pinning `listIndent` to the first
 * item's indent so deeper (or same-frame-different) indented items can never
 * masquerade as registry entries. Pure function: any structural surprise
 * yields a missing entry, never a throw.
 * @param {unknown} text - raw settings.yaml content.
 * @returns {Record<string, string[]>} `{[provider]: sorted unique model ids}`;
 *   providers without a collectable `models` block are absent.
 */
export function parseProviderModels(text) {
	if (typeof text !== "string" || text.trim() === "") return {};
	/** @type {Array<{key: string, indent: number, provider?: string}>} */
	const stack = [];
	/** @type {Map<string, Set<string>>} */
	const collected = new Map();
	let listIndent = -1; // -1 = not pinned yet; only the four-level registration resets it.
	for (const line of text.split(/\r?\n/)) {
		const leadingWhitespace = /^[ \t]*/.exec(line)[0];
		if (leadingWhitespace.includes("\t")) continue; // Tab indentation is illegal YAML — never trust such lines.
		const content = line.slice(leadingWhitespace.length);
		if (content === "" || content.startsWith("#")) continue;
		const indent = leadingWhitespace.length;
		while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop();
		const idMatch = ID_RE.exec(content);
		if (idMatch) {
			// List items never push frames; collect only under a REGISTERED models block.
			const top = stack[stack.length - 1];
			if (!top || top.provider === undefined) continue;
			if (listIndent === -1) listIndent = indent; // Pin once per models block.
			if (indent !== listIndent) continue; // Deeper (or stray) items are refused.
			let id;
			if (idMatch[1] !== undefined) id = idMatch[1].trim();
			else if (idMatch[2] !== undefined) id = idMatch[2].trim();
			else {
				id = idMatch[3];
				// A bare capture starting/ending with a quote is an unterminated
				// string's残串 — drop it rather than guess (宁缺勿假).
				if (id.startsWith('"') || id.startsWith("'") || id.endsWith('"') || id.endsWith("'")) continue;
			}
			if (id === "") continue;
			let ids = collected.get(top.provider);
			if (!ids) {
				ids = new Set();
				collected.set(top.provider, ids);
			}
			ids.add(id);
			continue;
		}
		const keyMatch = KEY_RE.exec(content);
		if (!keyMatch) continue;
		const key = keyMatch[1];
		if (stack.length === 0 && (indent !== 0 || key !== REGISTRY_ROOT)) {
			continue; // Top-level precision gate: only the registry root seeds the stack.
		}
		stack.push({ key, indent });
		const length = stack.length;
		if (
			length >= 4 &&
			stack[length - 4].key === REGISTRY_ROOT &&
			stack[length - 3].key === "providers" &&
			stack[length - 1].key === "models"
		) {
			// Four-level path registration — the ONLY listIndent reset point.
			stack[length - 1].provider = stack[length - 2].key;
			listIndent = -1;
		}
	}
	/** @type {Record<string, string[]>} */
	const result = {};
	for (const [provider, ids] of collected) {
		result[provider] = [...ids].sort((a, b) => a.localeCompare(b));
	}
	return result;
}

/**
 * Fault-tolerant registry read: a missing file, a directory path, unreadable
 * bytes or broken UTF-8 all resolve to `{}` so the GUI falls back to free
 * text input (gui-mutation-design §3.1/§3.4). A readable file is parsed by
 * {@link parseProviderModels}, which itself never throws.
 * @param {string} filePath - absolute settings.yaml path.
 * @returns {Promise<Record<string, string[]>>} provider → sorted model ids (possibly empty).
 */
export async function readProviderModels(filePath) {
	try {
		return parseProviderModels(await readFile(filePath, "utf8"));
	} catch {
		return {};
	}
}
//#endregion
