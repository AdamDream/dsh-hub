import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../lib/config.js";
import { registerTasteBridge } from "../lib/bridge.js";
import { apply } from "../lib/index.js";
import { createJobQueue } from "../lib/queue.js";
import { listTasteFiles, loadCommandCodeTaste, parseTasteFile, projectRootFor, readTasteFile } from "../lib/storage.js";
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

/** Clone the frozen §8 defaults into a mutable per-test config. */
function configWith(mutate) {
	const config = structuredClone(DEFAULT_CONFIG);
	if (mutate) mutate(config);
	return config;
}

/**
 * The exact dep shape index.js injects into registerTasteBridge (the cwd
 * resolver is the same join(projectRootFor(cwd), ".dsh", "taste") algorithm
 * minus the memoization, which carries no behavior).
 */
function buildDeps(globalDir) {
	return {
		queue: createJobQueue({ cap: 3, runJob: async () => {}, log: () => {} }),
		globalDir: () => globalDir,
		projectDirForCwd: (cwd) => (typeof cwd === "string" && cwd.length > 0 ? join(projectRootFor(cwd), ".dsh", "taste") : undefined),
		loadConfig,
		listTasteFiles,
		readTasteFile,
		parseTasteFile,
		loadCommandCodeTaste,
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
	registerTasteBridge(fakeBridgeCtx(state), buildDeps(join(home, "taste")));
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
		assert.equal(tree.value.scopes.length, 3);
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
		const project = result.value.scopes[0];
		assert.equal(project.present, false);
		assert.deepEqual(project.files, []);
		// The global scope still reads normally.
		const global = result.value.scopes[1];
		assert.equal(global.present, true);
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
		const project = result.value.scopes[0];
		assert.equal(project.present, true);
		assert.deepEqual(project.files.map((file) => file.relPath), ["taste.md"]);
		assert.deepEqual(project.files[0].entries, [{ statement: "Prefer tabs over spaces.", confidence: 0.8 }]);
	});

	it("merges the read-only Command Code stores into the third scope", async (t) => {
		const { handler, commandCodeBase } = setupBridge(t);
		mkdirSync(join(commandCodeBase, ".commandcode", "taste"), { recursive: true });
		writeFileSync(join(commandCodeBase, ".commandcode", "taste", "taste.md"), "- Command Code import. Confidence: 0.6\n", "utf8");
		const result = await handler("getTree", {});
		const commandCode = result.value.scopes[2];
		assert.equal(commandCode.name, "commandCode");
		assert.equal(commandCode.present, true);
		assert.equal(commandCode.files[0].relPath, "(command-code)");
		assert.equal(commandCode.files[0].count, 1);
		assert.deepEqual(commandCode.files[0].entries, [{ statement: "Command Code import.", confidence: 0.6 }]);
	});
});

describe("bridge return shape (design §5.1 用例 3)", () => {
	it("exposes parsed entries plus metadata only — never raw file bytes", async (t) => {
		const { handler, globalTasteDir } = setupBridge(t);
		const seed = "- Always answer in English. Confidence: 0.9\n- Keep answers short. Confidence: 0.5\n";
		writeFileSync(join(globalTasteDir, "taste.md"), seed, "utf8");
		mkdirSync(join(globalTasteDir, "style"), { recursive: true });
		writeFileSync(join(globalTasteDir, "style", "taste.md"), "- Prefer dark themes. Confidence: 0.7\n", "utf8");
		const result = await handler("getTree", {});
		assert.equal(result.ok, true);
		const keys = collectKeys(result.value);
		for (const forbidden of ["content", "bytes", "raw", "markdown", "text"]) {
			assert.ok(!keys.has(forbidden), `unexpected key "${forbidden}" in the tree payload`);
		}
		const global = result.value.scopes[1];
		assert.deepEqual(Object.keys(global).sort(), ["dir", "files", "name", "present"]);
		assert.deepEqual(global.files[0], {
			relPath: "taste.md",
			mtime: global.files[0].mtime,
			count: 2,
			entries: parseTasteFile(seed),
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
			injection: { enabled: true, maxChars: 8000, includeSubagents: false },
			modelMode: "custom",
			queue: { pending: 0, failCount: 0, cooldownUntil: 0, running: false },
			breakerCooling: false,
		});
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
		const global = tree.value.scopes[1];
		assert.deepEqual(global.files[0].entries, [{ statement: "Wired end to end.", confidence: 1 }]);
	});
});
//#endregion
