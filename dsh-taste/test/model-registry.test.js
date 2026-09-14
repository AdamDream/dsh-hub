import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseProviderModels, readProviderModels } from "../lib/model-registry.js";
//#region test/model-registry.test.js
/**
 * Line-scanner tests for the settings.yaml model registry
 * (gui-mutation-design §3/§6.1): the block-path stack state machine must
 * collect exactly `llm-pi-ai.providers.<name>.models[].id`, survive the real
 * file's nesting traps (the `gemini-3.6-flash` entry's `input:` block at
 * settings.yaml:139-142), and fail silent-and-empty on every unrecognized
 * shape — the GUI falls back to free-text input whenever a list is missing.
 */

/** Canonical block-style fixture mirroring ~/.dsh/settings.yaml:5-160. */
const REAL_SHAPE = [
	"ui-onboarding:",
	"  welcomeNoticeVersion: 2026-08-13.1",
	"llm-deepseek:",
	"  baseURL: https://opencode.ai/zen/v1/models",
	"llm-pi-ai:",
	"  providers:",
	"    opencode-go:",
	"      apiKeyEnv: OPENCODE_GO_API_KEY",
	"      models:",
	"        - id: minimax-m3",
	"          name: MiniMax-M3",
	"          contextWindow: 1000000",
	"          maxTokens: 131072",
	"        - id: qwen3.7-max",
	"          name: Qwen3.7 Max",
	"    adam:",
	"      apiKeyEnv: ADAM_API_KEY",
	"      api: openai-completions",
	"      baseURL: https://llmapi.example/v1/",
	"      models:",
	"        - id: gpt-5.6-sol-ultra",
	"        - id: deepseek-v4-pro",
	"        - id: glm-5.3",
	"        - id: glm-5.3-flash",
	"agent-default-model:",
	"  provider: adam",
	"  model: gpt-5.6-sol-max",
	"vision-adam:",
	"  model: glm-5.3-flash",
	"",
].join("\n");

/** The gemini-3.6-flash trap verbatim (settings.yaml:139-142): a nested
 *  `input:` block inside a models list item. */
const NESTED_SHAPE = [
	"llm-pi-ai:",
	"  providers:",
	"    adam:",
	"      models:",
	"        - id: gemini-3.6-flash",
	"          input:",
	"            - text",
	"            - image",
	"        - id: gemini-3-flash-preview",
	"        - id: gpt-5.6-sol-ultra",
	"",
].join("\n");

describe("parseProviderModels (gui-mutation-design §3.3/§6.1)", () => {
	it("parses the real block shape into both providers with the expected ids", () => {
		const map = parseProviderModels(REAL_SHAPE);
		assert.deepEqual(Object.keys(map).sort(), ["adam", "opencode-go"]);
		for (const id of ["gpt-5.6-sol-ultra", "glm-5.3", "glm-5.3-flash", "deepseek-v4-pro"]) {
			assert.ok(map.adam.includes(id), `adam must contain ${id}`);
		}
		assert.ok(map["opencode-go"].includes("minimax-m3"), "opencode-go must contain minimax-m3");
		assert.ok(!("agent-default-model" in map) && !("vision-adam" in map), "non-registry sections never leak");
	});

	it("survives the gemini-3.6-flash input: nesting trap and refuses same-or-deeper fake ids", () => {
		// The real-shape immunity: the nested block must not pollute the list…
		const map = parseProviderModels(NESTED_SHAPE);
		assert.equal(map.adam.filter((id) => id === "gemini-3.6-flash").length, 1, "gemini-3.6-flash collected exactly once");
		assert.deepEqual(map.adam, ["gemini-3.6-flash", "gemini-3-flash-preview", "gpt-5.6-sol-ultra"].sort((a, b) => a.localeCompare(b)));
		// …and the two fake-id placements the audit distinguishes must BOTH fail.
		// (a) Pinned at input:'s OWN indent (10): the pop exposes the registered
		// models frame, but 10 ≠ the pinned listIndent (8) → refused. This exact
		// placement is the watershed between "reset listIndent on four-level
		// registration only" and "reset on any block key" — the latter reading
		// would re-pin 10 and wrongly collect; it must stay rejected.
		const fakeAtTen = parseProviderModels(NESTED_SHAPE.replace(
			"        - id: gemini-3-flash-preview",
			"          - id: fake\n        - id: gemini-3-flash-preview",
		));
		assert.ok(!fakeAtTen.adam.includes("fake"), "fake id at the nested block's own indent (10) must be refused");
		assert.ok(fakeAtTen.adam.includes("gemini-3-flash-preview"), "collection continues after the rejected fake");
		// (b) Pinned deeper (12): the stack top is `input`, not a registered
		// models frame → refused under either reading (completeness control).
		const fakeAtTwelve = parseProviderModels(NESTED_SHAPE.replace(
			"        - id: gemini-3-flash-preview",
			"            - id: fake\n        - id: gemini-3-flash-preview",
		));
		assert.ok(!fakeAtTwelve.adam.includes("fake"), "fake id deeper than the nested block (12) must be refused");
	});

	it("sorts each provider's list with localeCompare and dedupes repeated ids", () => {
		const map = parseProviderModels(
			[
				"llm-pi-ai:",
				"  providers:",
				"    adam:",
				"      models:",
				"        - id: zeta",
				"        - id: alpha",
				"        - id: zeta",
				"        - id: Beta",
				"",
			].join("\n"),
		);
		// The reference the design pins: Set-dedupe then ["a","b"].sort(localeCompare).
		const reference = [...new Set(["zeta", "alpha", "zeta", "Beta"])].sort((x, y) => x.localeCompare(y));
		assert.deepEqual(map.adam, reference);
		assert.equal(new Set(map.adam).size, map.adam.length, "no duplicates in the output");
	});

	it("yields {} without llm-pi-ai, without providers, or on flow-style providers", () => {
		assert.deepEqual(parseProviderModels("providers:\n  adam:\n    models:\n      - id: x\n"), {});
		assert.deepEqual(parseProviderModels("llm-pi-ai:\n  adam:\n    models:\n      - id: x\n"), {});
		assert.deepEqual(parseProviderModels("llm-pi-ai:\n  providers: {}\n"), {});
	});

	it("omits providers without a models: block", () => {
		const map = parseProviderModels(
			[
				"llm-pi-ai:",
				"  providers:",
				"    bare:",
				"      apiKeyEnv: BARE_API_KEY",
				"      baseURL: https://example/v1/",
				"",
			].join("\n"),
		);
		assert.deepEqual(map, {});
	});

	it("terminates collection at a following top-level section", () => {
		const map = parseProviderModels(
			[
				"llm-pi-ai:",
				"  providers:",
				"    adam:",
				"      models:",
				"        - id: inside",
				"agent-default-model:",
				"  provider: adam",
				"  model: gpt-5.6-sol-max",
				"vision-adam:",
				"  models:",
				"    - id: never",
				"",
			].join("\n"),
		);
		assert.deepEqual(map, { adam: ["inside"] });
	});

	it("keeps collecting across comments/blank lines and handles quote forms, trailing comments and malformed quotes", () => {
		const map = parseProviderModels(
			[
				"llm-pi-ai:",
				"  providers:",
				"    adam:",
				"      models:  # registry below",
				"        # a comment between items",
				"",
				'        - id: "quoted"',
				"        - id: bare # note",
				'        - id: "two words"',
				'        - id: "unclosed',
				"        - id: bare'",
				"",
			].join("\n"),
		);
		// Quoted forms survive (including a quoted space); unterminated quote
		//残串 are dropped outright (宁缺勿假).
		assert.deepEqual(map.adam, ["bare", "quoted", "two words"]);
	});

	it("ignores tab-indented lines (no fake top level) and tolerates non-2-step indentation", () => {
		assert.deepEqual(parseProviderModels("\tllm-pi-ai:\n  providers:\n    adam:\n      models:\n        - id: x\n"), {});
		const threeStep = parseProviderModels(
			[
				"llm-pi-ai:",
				"   providers:",
				"      adam:",
				"         models:",
				"            - id: x",
				"",
			].join("\n"),
		);
		assert.deepEqual(threeStep, { adam: ["x"] });
	});

	it("returns {} for non-string, undefined and empty input", () => {
		assert.deepEqual(parseProviderModels(undefined), {});
		assert.deepEqual(parseProviderModels(null), {});
		assert.deepEqual(parseProviderModels(42), {});
		assert.deepEqual(parseProviderModels(""), {});
		assert.deepEqual(parseProviderModels("   \n  \n"), {});
	});

	it("merges two blocks of the same provider name into one deduped list", () => {
		const map = parseProviderModels(
			[
				"llm-pi-ai:",
				"  providers:",
				"    adam:",
				"      models:",
				"        - id: beta",
				"    adam:",
				"      models:",
				"        - id: alpha",
				"        - id: beta",
				"",
			].join("\n"),
		);
		assert.deepEqual(map, { adam: ["alpha", "beta"] });
	});
});

describe("readProviderModels (gui-mutation-design §3.1/§6.1)", () => {
	it("resolves {} for a missing file and for a directory path", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-registry-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.deepEqual(await readProviderModels(join(root, "settings.yaml")), {});
		mkdirSync(join(root, "a-directory"));
		assert.deepEqual(await readProviderModels(join(root, "a-directory")), {});
	});

	it("reads a fixture file into exactly what the parser produces", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-registry-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const file = join(root, "settings.yaml");
		writeFileSync(file, REAL_SHAPE, "utf8");
		assert.deepEqual(await readProviderModels(file), parseProviderModels(REAL_SHAPE));
	});

	it("resolves {} on permission denial (skipped when running as root)", async (t) => {
		if (typeof process.getuid === "function" && process.getuid() === 0) return; // root reads anything.
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-registry-"));
		t.after(() => {
			chmodSync(join(root, "settings.yaml"), 0o644);
			rmSync(root, { recursive: true, force: true });
		});
		const file = join(root, "settings.yaml");
		writeFileSync(file, REAL_SHAPE, "utf8");
		chmodSync(file, 0o000);
		assert.deepEqual(await readProviderModels(file), {});
	});
});
//#endregion
