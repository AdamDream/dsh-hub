import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../lib/config.js";
import { registerTasteBridge } from "../lib/bridge.js";
import { apply } from "../lib/index.js";
import { parseProviderModels, readProviderModels } from "../lib/model-registry.js";
import { createJobQueue } from "../lib/queue.js";
import { deleteTasteEntries, gateTasteEntries, isValidTasteFilePath, listTasteFiles, loadCommandCodeTaste, normalizePreferenceKey, parseTasteFile, projectRootFor, readTasteFile } from "../lib/storage.js";
//#region test/bridge.test.js
/**
 * Host-half tests for the read-only Web GUI bridge (gui-design.md §2/§5.1):
 * endpoint dispatch over the fake rpc context, the whitelist/no-passthrough
 * envelope, the `{ok, value|error}` return shape, and the loopback authority.
 *
 * ISSUE-1 (audit) semantics pinned here: `project.present` reflects the real
 * existence of the project scope directory (fix (b)), so a cwd whose taste
 * directory does not exist yet reads `present === false`.
 */

const REGISTRY_FIXTURE = `llm-pi-ai:
  providers:
    adam:
      models:
        - id: glm-5.3
`;

/** Clone the frozen §8 defaults into a mutable per-test config. */
function configWith(mutate) {
	const config = structuredClone(DEFAULT_CONFIG);
	if (mutate) mutate(config);
	return config;
}

/**
 * The exact dep shape index.js injects into registerTasteBridge (the cwd
 * resolver is the same join(projectRootFor(cwd), ".dsh", "taste") algorithm
 * minus the memoization, which carries no behavior). The mutation seams added
 * by gui-mutation-design §1.7 are the REAL implementations — the bridge must
 * be exercised against the same storage/config functions the commands use.
 */
function buildDeps(globalDir, settingsPath) {
	return {
		queue: createJobQueue({ cap: 3, runJob: async () => {}, log: () => {} }),
		globalDir: () => globalDir,
		projectDirForCwd: (cwd) => (typeof cwd === "string" && cwd.length > 0 ? join(projectRootFor(cwd), ".dsh", "taste") : undefined),
		loadConfig,
		listTasteFiles,
		readTasteFile,
		parseTasteFile,
		loadCommandCodeTaste,
		gateTasteEntries,
		normalizePreferenceKey,
		isValidTasteFilePath,
		deleteTasteEntries,
		saveConfig,
		settingsPath,
		readProviderModels,
		logger: undefined,
	};
}

/** Fake plugin ctx carrying only what the bridge needs, per design §5.1. */
function fakeBridgeCtx(state) {
	return {
		connection: {
			rpc: {
				handle: (channel, handler, options) => {
					state.handles.push({ channel, handler, options });
					return () => {
						state.disposed += 1;
					};
				},
			},
		},
		effect: (fn, label) => state.effects.push({ fn, label }),
	};
}

/** Isolated $DSH_HOME + registered bridge; returns the captured handler. */
function setupBridge(t) {
	const root = mkdtempSync(join(tmpdir(), "dsh-taste-bridge-"));
	const home = join(root, "home");
	const work = join(root, "work");
	mkdirSync(join(home, "taste"), { recursive: true });
	mkdirSync(work, { recursive: true });
	const previousHome = process.env.DSH_HOME;
	process.env.DSH_HOME = home;
	const state = { handles: [], effects: [], disposed: 0 };
	registerTasteBridge(fakeBridgeCtx(state), buildDeps(join(home, "taste"), join(home, "settings.yaml")));
	t.after(() => {
		if (previousHome === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previousHome;
		rmSync(root, { recursive: true, force: true });
	});
	assert.equal(state.handles.length, 1, "registerTasteBridge must register exactly one rpc channel");
	return {
		state,
		handler: state.handles[0].handler,
		globalTasteDir: join(home, "taste"),
		// The bridge derives the Command Code base two levels above the global
		// taste dir (storage.loadTasteSnapshot's algorithm) — not `home` itself.
		commandCodeBase: resolve(home, "taste", "..", ".."),
		home,
		work,
		settingsPath: join(home, "settings.yaml"),
	};
}

/** Recursively collect every object key reachable from `value`. */
function collectKeys(value, into = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) collectKeys(item, into);
		return into;
	}
	if (value !== null && typeof value === "object") {
		for (const [key, nested] of Object.entries(value)) {
			into.add(key);
			collectKeys(nested, into);
		}
	}
	return into;
}

describe("bridge registration (design §2.1)", () => {
	it("registers exactly one /taste channel with the loopback authority and a plugin-bound disposer", (t) => {
		const { state } = setupBridge(t);
		const { channel, options } = state.handles[0];
		assert.equal(channel, "/taste");
		assert.deepEqual(options, { authority: "loopback" });
		assert.deepEqual(state.effects, [{ fn: state.effects[0].fn, label: "taste.rpc.channel" }]);
		// The effect's factory returns the handle's own disposer: activating and
		// disposing must unregister the route exactly once (ISSUE-5 idempotence).
		const dispose = state.effects[0].fn();
		assert.equal(typeof dispose, "function");
		dispose();
		assert.equal(state.disposed, 1);
	});
});

describe("bridge dispatch (design §5.1 用例 1)", () => {
	it("dispatches getTree and getStatus and refuses unknown endpoints", async (t) => {
		const { handler } = setupBridge(t);
		const tree = await handler("getTree", {});
		assert.equal(tree.ok, true);
		assert.ok(tree.value.scopes.length >= 2);
		const status = await handler("getStatus", {});
		assert.equal(status.ok, true);
		assert.deepEqual(Object.keys(status.value).sort(), ["breakerCooling", "injection", "learning", "modelMode", "queue"]);
		const unknown = await handler("evil", {});
		assert.deepEqual(unknown, { ok: false, error: { code: "unknown-endpoint", message: 'taste: unknown endpoint "evil"' } });
		// A missing payload degenerates to `{}` (design: payload ?? {}), not a crash.
		const noPayload = await handler("getTree");
		assert.equal(noPayload.ok, true);
	});

	it("returns {ok,false,error:{code:'internal'}} instead of throwing when the host is hostile", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-bridge-hostile-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const state = { handles: [], effects: [], disposed: 0 };
		const deps = buildDeps(join(root, "taste"));
		deps.queue = undefined; // force getStatus to throw inside the handler
		registerTasteBridge(fakeBridgeCtx(state), deps);
		const status = await state.handles[0].handler("getStatus", {});
		assert.equal(status.ok, false);
		assert.equal(status.error.code, "internal");
		assert.equal(typeof status.error.message, "string");
	});
});

describe("bridge whitelist envelope (design §5.1 用例 2 + audit ISSUE-1)", () => {
	it("ignores any path-like payload and only uses cwd to select the project scope", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(join(globalTasteDir, "taste.md"), "- Always answer in English. Confidence: 0.9\n", "utf8");
		const result = await handler("getTree", { path: "/etc/passwd", cwd: "/nonexistent" });
		assert.equal(result.ok, true);
		// `path` is not a parameter: nothing outside the taste scopes is readable.
		assert.ok(!JSON.stringify(result).includes("/etc/passwd"));
		// ISSUE-1 fix (b): the cwd's taste directory does not exist → present false.
		const project = result.value.scopes.find((scope) => scope.name === "project");
		if (project) { assert.equal(project.present, false); assert.deepEqual(project.files, []); }
		// The global scope still reads normally.
		const global = result.value.scopes.find((scope) => scope.name === "global");
		assert.ok(global?.present);
		assert.equal(global.files[0].count, 1);
	});

	it("reports the project scope as present once its taste directory exists", async (t) => {
		const { handler, work } = setupBridge(t);
		// Mirror index.js' resolver exactly so the assertion cannot flake on a
		// .git directory somewhere above the tmpdir.
		const projectTasteDir = join(projectRootFor(work), ".dsh", "taste");
		mkdirSync(projectTasteDir, { recursive: true });
		writeFileSync(join(projectTasteDir, "taste.md"), "- Prefer tabs over spaces. Confidence: 0.8\n", "utf8");
		const result = await handler("getTree", { cwd: work });
		const project = result.value.scopes.find((scope) => scope.name === "project");
		assert.equal(project.present, true);
		assert.deepEqual(project.files.map((file) => file.relPath), ["taste.md"]);
		assert.deepEqual(project.files[0].entries, [{ statement: "Prefer tabs over spaces.", confidence: 0.8 }]);
	});

	it("merges the read-only Command Code stores into the third scope", async (t) => {
		const { handler, commandCodeBase } = setupBridge(t);
		mkdirSync(join(commandCodeBase, ".commandcode", "taste"), { recursive: true });
		writeFileSync(join(commandCodeBase, ".commandcode", "taste", "taste.md"), "- Command Code import. Confidence: 0.8\n", "utf8");
		const result = await handler("getTree", {});
		const commandCode = result.value.scopes.find((scope) => scope.name === "commandCode");
		assert.equal(commandCode.name, "commandCode");
		assert.equal(commandCode.present, true);
		assert.equal(commandCode.files[0].relPath, "(command-code)");
		assert.equal(commandCode.files[0].count, 1);
		assert.deepEqual(commandCode.files[0].entries, [{ statement: "Command Code import.", confidence: 0.8 }]);
	});
});

describe("bridge return shape (design §5.1 用例 3)", () => {
	it("exposes parsed entries plus metadata only — never raw file bytes", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		const seed = "- 总是使用中文回答。 Confidence: 0.90\n- 保持回答简短。 Confidence: 0.80\n";
		writeFileSync(join(globalTasteDir, "taste.md"), seed, "utf8");
		mkdirSync(join(globalTasteDir, "style"), { recursive: true });
		writeFileSync(join(globalTasteDir, "style", "taste.md"), "- Prefer dark themes. Confidence: 0.7\n", "utf8");
		const result = await handler("getTree", {});
		assert.equal(result.ok, true);
		const keys = collectKeys(result.value);
		for (const forbidden of ["content", "bytes", "raw", "markdown", "text"]) {
			assert.ok(!keys.has(forbidden), `unexpected key "${forbidden}" in the tree payload`);
		}
		const global = result.value.scopes.find((scope) => scope.name === "global");
		assert.ok(global);
		assert.deepEqual(Object.keys(global).sort(), ["dir", "files", "name", "present"]);
		assert.deepEqual(global.files[0], {
			relPath: "taste.md",
			mtime: global.files[0].mtime,
			count: 2,
			entries: parseTasteFile(seed).map((entry) => ({ ...entry })),
		});
		assert.ok(global.files[0].mtime > 0);
		assert.deepEqual(global.files[1].relPath, "style/taste.md");
		for (const file of global.files) {
			assert.deepEqual(Object.keys(file).sort(), ["count", "entries", "mtime", "relPath"]);
			for (const entry of file.entries) {
				assert.deepEqual(Object.keys(entry).sort(), ["confidence", "statement"]);
			}
		}
		const scopes = result.value.scopes;
		assert.deepEqual(scopes.map((scope) => scope.name), ["project", "global", "commandCode"]);
		assert.equal(typeof result.value.generatedAt, "number");
	});

	it("getStatus reflects a hot config.json read (audit ISSUE-4) and the queue snapshot", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(
			join(globalTasteDir, "config.json"),
			JSON.stringify({ learningEnabled: false, injection: { maxChars: 8000 }, observer: { modelMode: "custom" } }),
			"utf8",
		);
		const status = await handler("getStatus", {});
		assert.equal(status.ok, true);
		assert.deepEqual(status.value, {
			learning: false,
			injection: { enabled: true, maxChars: 8000, includeSubagents: false, minConfidence: 0.7 },
			modelMode: "custom",
			queue: { pending: 0, failCount: 0, cooldownUntil: 0, running: false },
			breakerCooling: false,
		});
		// 同测一写一读：minConfidence 热读回显（该用例 config 只写阈值，其余默认）
		writeFileSync(join(globalTasteDir, "config.json"), JSON.stringify({ injection: { minConfidence: 0.85 } }), "utf8");
		const updated = await handler("getStatus", {});
		assert.equal(updated.ok, true);
		assert.equal(updated.value.injection.minConfidence, 0.85);
	});

	it("gates the tree by the confidence threshold and keeps every count coherent", async (t) => {
		const { handler, globalTasteDir, commandCodeBase } = setupBridge(t);
		writeFileSync(
			join(globalTasteDir, "taste.md"),
			[
				"- Gated low statement goes away. Confidence: 0.65",
				"- Boundary statement stays put. Confidence: 0.70",
				"- High confidence statement stays. Confidence: 0.90",
			].join("\n") + "\n",
			"utf8",
		);
		const first = await handler("getTree", {});
		assert.equal(first.ok, true);
		const global = first.value.scopes.find((scope) => scope.name === "global");
		assert.equal(global.files[0].count, 2, "count reflects the visible entries only");
		assert.deepEqual(global.files[0].entries, [
			{ statement: "Boundary statement stays put.", confidence: 0.7 },
			{ statement: "High confidence statement stays.", confidence: 0.9 },
		]);
		assert.equal(first.value.gatedCount, 1, "the 0.65 entry is gated and counted at the top level");

		// Command Code 同一门控：0.6 条目不进入 commandCode scope，gatedCount 计入
		mkdirSync(join(commandCodeBase, ".commandcode", "taste"), { recursive: true });
		writeFileSync(join(commandCodeBase, ".commandcode", "taste", "taste.md"), "- Command Code gated low entry. Confidence: 0.6\n", "utf8");
		const second = await handler("getTree", {});
		const commandCode = second.value.scopes.find((scope) => scope.name === "commandCode");
		assert.equal(commandCode.files[0].count, 0);
		assert.deepEqual(commandCode.files[0].entries, []);
		assert.equal(second.value.gatedCount, 2, "both gated entries (global + commandCode) are counted");
	});
});

describe("apply() wiring (design §2.4)", () => {
	it("registers the bridge with the same deps and channel when apply() runs", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-bridge-apply-"));
		const home = join(root, "home");
		const work = join(root, "work");
		mkdirSync(join(home, "taste"), { recursive: true });
		mkdirSync(work, { recursive: true });
		const previousHome = process.env.DSH_HOME;
		process.env.DSH_HOME = home;
		const state = {
			handles: [],
			effects: [],
			contexts: [],
			handlers: new Map(),
			commands: [],
		};
		const ctx = {
			logger: { warn: () => {} },
			systemPrompt: { context: (spec) => state.contexts.push(spec) },
			on: (event, handler) => {
				const list = state.handlers.get(event) ?? [];
				list.push(handler);
				state.handlers.set(event, list);
			},
			commands: { register: (spec) => state.commands.push(spec) },
			agents: {},
			...fakeBridgeCtx(state),
		};
		apply(ctx, configWith());
		t.after(() => {
			for (const effect of [...state.effects].reverse()) {
				try {
					const dispose = effect.fn();
					if (typeof dispose === "function") dispose();
				} catch {
					// Teardown must never mask a test failure.
				}
			}
			if (previousHome === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previousHome;
			rmSync(root, { recursive: true, force: true });
		});
		assert.equal(state.handles.length, 1);
		assert.equal(state.handles[0].channel, "/taste");
		assert.deepEqual(state.handles[0].options, { authority: "loopback" });
		assert.ok(state.effects.some((effect) => effect.label === "taste.rpc.channel"));
		writeFileSync(join(home, "taste", "taste.md"), "- Wired end to end. Confidence: 1.0\n", "utf8");
		const tree = await state.handles[0].handler("getTree", { cwd: work });
		assert.equal(tree.ok, true);
		const global = tree.value.scopes.find((scope) => scope.name === "global");
		assert.deepEqual(global.files[0].entries, [{ statement: "Wired end to end.", confidence: 1 }]);
	});
});
//#endregion

describe("bridge mutation dispatch (gui-mutation-design §6.3.1-2)", () => {
	it("dispatches the three new endpoints and still refuses unknown ones", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(join(globalTasteDir, "taste.md"), "- Dispatch me away. Confidence: 0.9\n", "utf8");
		const deleted = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Dispatch me away." });
		assert.equal(deleted.ok, true);
		assert.deepEqual(deleted.value, { removed: 1 });
		const settings = await handler("getSettings", {});
		assert.equal(settings.ok, true);
		assert.deepEqual(Object.keys(settings.value).sort(), ["modelsByProvider", "observer"]);
		const set = await handler("setObserver", { modelMode: "inherit", provider: "", model: "" });
		assert.equal(set.ok, true);
		assert.deepEqual(Object.keys(set.value).sort(), ["observer"]);
		const unknown = await handler("evil", {});
		assert.equal(unknown.ok, false);
		assert.equal(unknown.error.code, "unknown-endpoint");
	});

	it("maps a missing deletion helper to internal via the instanceof gate (hostile)", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-bridge-hostile-del-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(root, "taste"), { recursive: true });
		const state = { handles: [], effects: [], disposed: 0 };
		const deps = buildDeps(join(root, "taste"), join(root, "settings.yaml"));
		deps.deleteTasteEntries = undefined; // force deleteEntry to throw inside the handler
		registerTasteBridge(fakeBridgeCtx(state), deps);
		const result = await state.handles[0].handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Whatever statement." });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "internal");
		assert.equal(typeof result.error.message, "string");
	});
});

describe("bridge deleteEntry (gui-mutation-design §1.3/§6.3.3-12)", () => {
	it("removes one global entry and prunes its sidecar key (§6.3.3)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(join(globalTasteDir, "taste.md"), "- Keep this entry. Confidence: 0.9\n- Delete this entry. Confidence: 0.5\n", "utf8");
		const result = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Delete this entry." });
		assert.equal(result.ok, true);
		assert.deepEqual(result.value, { removed: 1 });
		assert.deepEqual(parseTasteFile(await readFile(join(globalTasteDir, "taste.md"), "utf8")), [
			{ statement: "Keep this entry.", confidence: 0.9 },
		]);
	});

	it("deletes from the project scope using the session cwd (§6.3.4)", async (t) => {
		const { handler, work } = setupBridge(t);
		const projectTasteDir = join(projectRootFor(work), ".dsh", "taste");
		mkdirSync(projectTasteDir, { recursive: true });
		writeFileSync(join(projectTasteDir, "taste.md"), "- Project entry to remove. Confidence: 0.8\n", "utf8");
		const result = await handler("deleteEntry", { scope: "project", relPath: "taste.md", statement: "Project entry to remove.", cwd: work });
		assert.equal(result.ok, true);
		assert.deepEqual(result.value, { removed: 1 });
		assert.equal(await readFile(join(projectTasteDir, "taste.md"), "utf8"), "");
	});

	it("refuses the read-only Command Code source (backend half of the double insurance, §6.3.5)", async (t) => {
		const { handler } = setupBridge(t);
		const result = await handler("deleteEntry", { scope: "commandCode", relPath: "(command-code)", statement: "Command Code import." });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "read-only-source");
	});

	it("rejects an invalid or missing scope (§6.3.6)", async (t) => {
		const { handler } = setupBridge(t);
		for (const scope of ["bogus", undefined]) {
			const result = await handler("deleteEntry", { scope, relPath: "taste.md", statement: "Any statement." });
			assert.equal(result.ok, false);
			assert.equal(result.error.code, "invalid-payload");
		}
	});

	it("refuses path-like or non-whitelisted relPath values (§6.3.7)", async (t) => {
		const { handler } = setupBridge(t);
		for (const relPath of ["../../etc/passwd", "notes.txt", "/etc/passwd", ""]) {
			const result = await handler("deleteEntry", { scope: "global", relPath, statement: "Any statement." });
			assert.equal(result.ok, false);
			assert.equal(result.error.code, "invalid-payload");
		}
	});

	it("rejects an empty statement and one that normalizes to an empty key (§6.3.8)", async (t) => {
		const { handler } = setupBridge(t);
		for (const statement of ["", "   ", "!!!"]) {
			const result = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement });
			assert.equal(result.ok, false);
			assert.equal(result.error.code, "invalid-payload");
		}
	});

	it("answers not-found for an unknown key and for a vanished scope directory (§6.3.9)", async (t) => {
		const { handler, globalTasteDir, home } = setupBridge(t);
		writeFileSync(join(globalTasteDir, "taste.md"), "- An existing statement. Confidence: 0.9\n", "utf8");
		const missingKey = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "No such statement anywhere." });
		assert.equal(missingKey.ok, false);
		assert.equal(missingKey.error.code, "not-found");
		// existsSync precheck: a whole missing scope directory is not-found
		// (not internal from a raw ENOENT inside withTasteLock).
		rmSync(join(home, "taste"), { recursive: true, force: true });
		const missingDir = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "An existing statement." });
		assert.equal(missingDir.ok, false);
		assert.equal(missingDir.error.code, "not-found");
	});

	it("rejects a project-scope deletion without a cwd (§6.3.10)", async (t) => {
		const { handler } = setupBridge(t);
		const result = await handler("deleteEntry", { scope: "project", relPath: "taste.md", statement: "Any statement." });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid-payload");
	});

	it("writes an emptied file as \"\" and counts duplicate keys defensively (§6.3.11-12)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		const seed = "- Last statement standing. Confidence: 0.9\n";
		writeFileSync(join(globalTasteDir, "taste.md"), seed, "utf8");
		const last = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Last statement standing." });
		assert.equal(last.ok, true);
		assert.equal(await readFile(join(globalTasteDir, "taste.md"), "utf8"), "");
		writeFileSync(
			join(globalTasteDir, "taste.md"),
			"- Doubled statement appears twice. Confidence: 0.9\n- Doubled statement appears twice. Confidence: 0.6\n",
			"utf8",
		);
		const doubled = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Doubled statement appears twice." });
		assert.equal(doubled.ok, true);
		assert.deepEqual(doubled.value, { removed: 2 });
	});
});

describe("bridge getSettings (gui-mutation-design §1.4/§6.3.13-15)", () => {
	it("answers with the default observer and an empty registry without settings.yaml (§6.3.13)", async (t) => {
		const { handler } = setupBridge(t);
		const result = await handler("getSettings", {});
		assert.equal(result.ok, true);
		assert.deepEqual(result.value, { observer: DEFAULT_CONFIG.observer, modelsByProvider: {} });
	});

	it("serves the model registry hot — re-read per call, no cache (§6.3.14)", async (t) => {
		const { handler, settingsPath } = setupBridge(t);
		const empty = await handler("getSettings", {});
		assert.deepEqual(empty.value.modelsByProvider, {});
		writeFileSync(settingsPath, REGISTRY_FIXTURE, "utf8");
		const first = await handler("getSettings", {});
		assert.equal(first.ok, true);
		assert.deepEqual(first.value.modelsByProvider, parseProviderModels(REGISTRY_FIXTURE));
		assert.deepEqual(first.value.modelsByProvider.adam, parseProviderModels(REGISTRY_FIXTURE).adam);
		// Registry updates follow without a host restart: rewrite, re-call.
		writeFileSync(settingsPath, REGISTRY_FIXTURE.replace("        - id: glm-5.3\n", "        - id: glm-5.3\n        - id: glm-5\n"), "utf8");
		const second = await handler("getSettings", {});
		assert.ok(second.value.modelsByProvider.adam.includes("glm-5"), "the rewritten registry is visible on the next call");
	});

	it("echoes the seeded observer section precisely (§6.3.15)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(
			join(globalTasteDir, "config.json"),
			JSON.stringify({ observer: { modelMode: "custom", provider: "adam", model: "gpt-5.6-sol-ultra", maxInputChars: 24000, timeoutMs: 60000, maxTurns: 10 } }),
			"utf8",
		);
		const result = await handler("getSettings", {});
		assert.deepEqual(result.value.observer, {
			modelMode: "custom",
			provider: "adam",
			model: "gpt-5.6-sol-ultra",
			maxInputChars: 24000,
			timeoutMs: 60000,
			maxTurns: 10,
		});
	});
});

describe("bridge setObserver (gui-mutation-design §1.5/§6.3.16-18)", () => {
	it("writes a valid custom route and preserves the other config sections (§6.3.16)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		writeFileSync(
			join(globalTasteDir, "config.json"),
			JSON.stringify({ learningEnabled: false, injection: { maxChars: 8000 }, observer: { modelMode: "inherit", provider: "", model: "", maxInputChars: 24000 } }),
			"utf8",
		);
		const result = await handler("setObserver", { modelMode: "custom", provider: "adam", model: "glm-5.3" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.value.observer, {
			modelMode: "custom",
			provider: "adam",
			model: "glm-5.3",
			maxInputChars: 24000,
			timeoutMs: 120000,
			maxTurns: 20,
		});
		const persisted = JSON.parse(await readFile(join(globalTasteDir, "config.json"), "utf8"));
		assert.equal(persisted.learningEnabled, false, "learningEnabled survives the write");
		assert.equal(persisted.injection.maxChars, 8000, "injection survives the write");
		assert.equal(persisted.observer.maxInputChars, 24000, "the untouched budget survives the write");
		assert.equal(persisted.observer.modelMode, "custom");
	});

	it("persists trimmed provider/model through inherit too (§6.3.17)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		const result = await handler("setObserver", { modelMode: "inherit", provider: "  adam  ", model: " glm-5.3 " });
		assert.equal(result.ok, true);
		const persisted = JSON.parse(await readFile(join(globalTasteDir, "config.json"), "utf8"));
		assert.deepEqual([persisted.observer.modelMode, persisted.observer.provider, persisted.observer.model], ["inherit", "adam", "glm-5.3"]);
	});

	it("rejects invalid payloads without writing config.json (§6.3.18)", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		const seed = JSON.stringify({ learningEnabled: false, observer: { modelMode: "inherit" } });
		writeFileSync(join(globalTasteDir, "config.json"), seed, "utf8");
		for (const payload of [
			{ modelMode: "bogus", provider: "adam", model: "glm-5.3" },
			{ modelMode: "custom", provider: "adam", model: "   " },
			{ modelMode: "custom", provider: "  ", model: "glm-5.3" },
			{ modelMode: "custom", provider: 42, model: "glm-5.3" },
			{ modelMode: "custom" }, // omitted provider AND model: required, no fallback to current values
			{ modelMode: "inherit", provider: "adam" }, // omitted model
		]) {
			const result = await handler("setObserver", payload);
			assert.equal(result.ok, false, `payload ${JSON.stringify(payload)} must be refused`);
			assert.equal(result.error.code, "invalid-payload");
		}
		assert.equal(await readFile(join(globalTasteDir, "config.json"), "utf8"), seed, "config.json is byte-identical after every refusal");
	});
});

describe("bridge apply() mutation wiring (gui-mutation-design §6.3.19)", () => {
	it("serves getSettings/setObserver/deleteEntry through the real apply()-injected seams", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "dsh-taste-bridge-apply-mut-"));
		const home = join(root, "home");
		const work = join(root, "work");
		mkdirSync(join(home, "taste"), { recursive: true });
		mkdirSync(work, { recursive: true });
		const previousHome = process.env.DSH_HOME;
		process.env.DSH_HOME = home;
		const state = { handles: [], effects: [], disposed: 0 };
		const ctx = {
			logger: { warn: () => {} },
			systemPrompt: { context: () => {} },
			on: () => {},
			commands: { register: () => {} },
			agents: {},
			...fakeBridgeCtx(state),
		};
		apply(ctx, configWith());
		t.after(() => {
			for (const effect of [...state.effects].reverse()) {
				try {
					const dispose = effect.fn();
					if (typeof dispose === "function") dispose();
				} catch {}
			}
			if (previousHome === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previousHome;
			rmSync(root, { recursive: true, force: true });
		});
		const handler = state.handles[0].handler;
		writeFileSync(join(home, "settings.yaml"), REGISTRY_FIXTURE, "utf8");
		// getSettings through dshHomePath("settings.yaml").
		const settings = await handler("getSettings", {});
		assert.equal(settings.ok, true);
		assert.deepEqual(settings.value.modelsByProvider, parseProviderModels(REGISTRY_FIXTURE));
		// setObserver writes the real <home>/taste/config.json (tracked seam).
		const set = await handler("setObserver", { modelMode: "custom", provider: "adam", model: "glm-5.3-flash" });
		assert.equal(set.ok, true);
		const persisted = JSON.parse(await readFile(join(home, "taste", "config.json"), "utf8"));
		assert.equal(persisted.observer.modelMode, "custom");
		// getStatus reads the new route back (modelMode chip source).
		const status = await handler("getStatus", {});
		assert.equal(status.value.modelMode, "custom");
		// deleteEntry mutates the real file and prunes the real sidecar.
		writeFileSync(join(home, "taste", "taste.md"), "- Wired deletion end to end. Confidence: 1.0\n", "utf8");

		const deleted = await handler("deleteEntry", { scope: "global", relPath: "taste.md", statement: "Wired deletion end to end." });
		assert.equal(deleted.ok, true);
		assert.deepEqual(deleted.value, { removed: 1 });
		assert.equal(await readFile(join(home, "taste", "taste.md"), "utf8"), "");
	});
});
//#endregion
