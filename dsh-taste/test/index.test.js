import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderContextSections } from "@deepseek-ai/dsh-system-prompt";
import { DEFAULT_CONFIG } from "../lib/config.js";
import { apply, inject, name } from "../lib/index.js";
//#region test/index.test.js
/**
 * apply()-level integration tests for the plugin glue (proposal §3/§6.4/§9):
 * the R9 sanitize boundary driven through the real captured injection
 * function, the injection/hook guard order, the R1 whole-handler try/catch,
 * the R5 in-flight learner set timing, and the queue wiring.
 *
 * The harness isolates `$DSH_HOME` per test (dsh-home-paths resolves the env
 * override at call time), so `dshHomePath("taste")` inside apply() lands in a
 * throwaway directory and nothing real is read or written.
 */

/** Clone the frozen §8 defaults into a mutable per-test config. */
function configWith(mutate) {
	const config = structuredClone(DEFAULT_CONFIG);
	if (mutate) mutate(config);
	return config;
}

/** Fake top-level agent (no subagent marker) over a session event array. */
function topLevelAgent({ id = "main-session", cwd, events = [] } = {}) {
	return { session: { id, header: { cwd }, events }, options: {} };
}

/** Fake delegated agent: DSH's subagent header markers (§1 triple test). */
function subagentAgent({ id = "child-session", cwd, events = [] } = {}) {
	return { session: { id, header: { cwd, origin: "subagent", parentSession: "main-session" } }, options: {} };
}

/** One turn of learnable session events (user question, assistant answer). */
function turnEvents(turn = 1) {
	return [
		{ type: "turn/start", data: { turn } },
		{ type: "user/message", data: { content: [{ type: "text", text: "I prefer tabs over spaces" }], source: { kind: "user" } } },
		{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "Noted." }] } } },
	];
}

/** Seed one preference into the global taste scope. */
function seedGlobalTaste(globalTasteDir, text = "- Always answer in English. Confidence: 0.9\n") {
	writeFileSync(join(globalTasteDir, "taste.md"), text, "utf8");
}

/** Poll until `predicate()` holds; times out with a clear failure. */
async function waitFor(predicate, { timeoutMs = 2_000, step = 5 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, step));
	}
}

/** Fixed spin for negative assertions (a wrongly-pushed job would start within ms). */
async function settle(ms = 100) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drive `apply()` against a fake plugin context and an isolated $DSH_HOME.
 * Captures the three wiring surfaces (systemPrompt.context, ctx.on,
 * commands.register) and a controllable agents service; `state.onCreate` and
 * `state.createImpl` let tests observe and gate the learner's creation.
 */
function setup(t, { config } = {}) {
	const root = mkdtempSync(join(tmpdir(), "dsh-taste-index-"));
	const home = join(root, "home");
	const work = join(root, "work");
	mkdirSync(join(home, "taste"), { recursive: true });
	mkdirSync(work, { recursive: true });
	const previousHome = process.env.DSH_HOME;
	process.env.DSH_HOME = home;

	const state = {
		contexts: [],
		handlers: new Map(),
		commands: [],
		handles: [],
		effects: [],
		warnings: [],
		createCalls: [],
		followups: [],
		tools: [],
		sections: [],
		disposals: 0,
		onCreate: null,
		createImpl: null,
	};
	const ctx = {
		logger: { warn: (message) => state.warnings.push(message) },
		systemPrompt: { context: (spec) => state.contexts.push(spec) },
		on: (event, handler) => {
			const list = state.handlers.get(event) ?? [];
			list.push(handler);
			state.handlers.set(event, list);
		},
		commands: { register: (spec) => state.commands.push(spec) },
		// Web GUI bridge (design §5.1 note): apply() registers the read-only
		// /taste rpc channel on the connection service.
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
		agents: {
			withInitiator: (parent, operation) => operation(parent),
			create: async (options) => {
				state.createCalls.push(options);
				if (state.onCreate) state.onCreate(options);
				if (state.createImpl) return state.createImpl(options);
				options.setup({
					tools: { register: (...tools) => state.tools.push(...tools) },
					systemPrompt: { section: (section) => state.sections.push(section) },
				});
				return {
					agent: { followup: (message) => state.followups.push(message), whenIdle: async () => {} },
					dispose: async () => {
						state.disposals += 1;
					},
				};
			},
		},
		effect: (fn, label) => state.effects.push({ fn, label }),
	};

	apply(ctx, config ?? configWith());

	t.after(() => {
		// Reverse-order disposal mirrors the host: teardown aborts before drain.
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

	const contextSpec = state.contexts[0];
	return {
		state,
		globalTasteDir: join(home, "taste"),
		work,
		injectFn: contextSpec.text,
		turnStopping: state.handlers.get("agent/turn-stopping")[0],
	};
}

describe("plugin surface", () => {
	it("declares the exact inject set, the context registration, and the command wiring", (t) => {
		const h = setup(t);
		assert.equal(name, "taste");
		assert.deepEqual(inject, ["agents", "commands", "systemPrompt", "connection"]);
		assert.deepEqual(h.state.contexts, [{ name: "taste", order: 40, text: h.injectFn }]);
		assert.deepEqual([...h.state.handlers.keys()], ["agent/turn-stopping"]);
		assert.equal(h.state.commands.length, 1);
		assert.equal(h.state.commands[0].name, "taste");
		assert.equal(h.state.commands[0].recordInput, false);
		assert.deepEqual(h.state.commands[0].input, { hint: "<status|on|off|list|remember|forget|paths|model>" });
	});
});

describe("context injection sanitize (R9, §6.4/§9)", () => {
	it("rewrites {{...}} preference text so interpolate cannot crash or substitute", (t) => {
		const h = setup(t);
		writeFileSync(
			join(h.globalTasteDir, "taste.md"),
			[
				"- Prefer {{model}} for quick checks. Confidence: 0.9",
				"- Treat {{unknown}} placeholders as typos. Confidence: 0.5",
				"- Keep pairs {{like this}} and lone }} braces. Confidence: 0.8",
			].join("\n") + "\n",
			"utf8",
		);
		const injected = h.injectFn({ agent: topLevelAgent({ cwd: h.work }) });
		assert.match(injected, /^<taste>\n/);
		assert.match(injected, /\n<\/taste>$/);
		// every registered and unknown variable reference is neutralized
		assert.ok(injected.includes("{ {model}}"), injected);
		assert.ok(injected.includes("{ {unknown}}"), injected);
		assert.ok(injected.includes("{ {like this}}"), injected);
		assert.doesNotMatch(injected, /\{\{/);
		// close braces are not part of the boundary and pass through untouched
		assert.ok(injected.includes("lone }} braces"), injected);

		// Proof against the host's real interpolate: the sanitized text renders
		// verbatim, while the raw forms would throw (unknown variable) or be
		// silently substituted (registered variable) — the exact R9 regression.
		const [section] = renderContextSections({ contexts: [{ name: "taste", text: injected }], variables: { model: "GLM-X", cwd: "/nowhere" } });
		assert.equal(section.name, "taste");
		assert.equal(section.text, injected);
		assert.throws(
			() => renderContextSections({ contexts: [{ name: "taste", text: "see {{unknown}} now" }], variables: { model: "GLM-X" } }),
			/unknown prompt variable/,
		);
		const [corrupted] = renderContextSections({ contexts: [{ name: "taste", text: "see {{model}} now" }], variables: { model: "GLM-X" } });
		assert.equal(corrupted.text, "see GLM-X now");
	});
});

describe("injection guards (§3 order semantics)", () => {
	it("returns empty when learningEnabled is off", (t) => {
		const h = setup(t, { config: configWith((c) => (c.learningEnabled = false)) });
		seedGlobalTaste(h.globalTasteDir);
		assert.equal(h.injectFn({ agent: topLevelAgent({ cwd: h.work }) }), "");
	});

	it("returns empty when injection.enabled is off", (t) => {
		const h = setup(t, { config: configWith((c) => (c.injection.enabled = false)) });
		seedGlobalTaste(h.globalTasteDir);
		assert.equal(h.injectFn({ agent: topLevelAgent({ cwd: h.work }) }), "");
	});

	it("returns empty for subagents unless includeSubagents is on", (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		assert.equal(h.injectFn({ agent: subagentAgent({ cwd: h.work }) }), "");

		const included = setup(t, { config: configWith((c) => (c.injection.includeSubagents = true)) });
		seedGlobalTaste(included.globalTasteDir);
		assert.match(included.injectFn({ agent: subagentAgent({ cwd: included.work }) }), /^<taste>/);
	});

	it("config guards win over includeSubagents (guard order)", (t) => {
		const h = setup(t, {
			config: configWith((c) => {
				c.learningEnabled = false;
				c.injection.includeSubagents = true;
			}),
		});
		seedGlobalTaste(h.globalTasteDir);
		assert.equal(h.injectFn({ agent: subagentAgent({ cwd: h.work }) }), "");
	});

	it("does not special-case a taste-learner header origin (unrepresentable in DSH; see lib/learner.js)", (t) => {
		// dsh-session rejects every origin except "subagent", so the pi-taste
		// origin guard would be dead code; recursion protection is isSubagent
		// plus the in-flight set. This pins the deviation against regression.
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		const agent = topLevelAgent({ cwd: h.work });
		agent.session.header.origin = "taste-learner";
		assert.match(h.injectFn({ agent }), /^<taste>/);
	});

	it("returns empty when there is no snapshot to project", (t) => {
		const h = setup(t);
		assert.equal(h.injectFn({ agent: topLevelAgent({ cwd: h.work }) }), "");
	});

	it("tolerates a missing or empty agent argument", (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		assert.equal(h.injectFn(), "");
		assert.equal(h.injectFn({}), "");
	});
});

describe("turn-stopping hook (R1)", () => {
	it("enqueues a learnable turn and runs one learner end to end", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		h.turnStopping({ agent: topLevelAgent({ id: "main-1", cwd: h.work, events: turnEvents(1) }), turn: 1 });
		await waitFor(() => h.state.disposals === 1);
		assert.equal(h.state.createCalls.length, 1);
		const options = h.state.createCalls[0];
		// R5 deviation codified: the learner session is origin "subagent" + parentSession
		assert.equal(options.meta.origin, "subagent");
		assert.equal(options.meta.parentSession, "main-1");
		assert.notEqual(options.sessionId, "main-1");
		assert.match(options.sessionId, /^[0-9a-f-]{36}$/);
		assert.deepEqual(h.state.sections, [{ name: "taste-learner", order: 190, text: h.state.sections[0].text }]);
		assert.deepEqual(h.state.tools.map((tool) => tool.name), ["read_taste_file", "write_taste_file", "edit_taste_file"]);
		assert.equal(h.state.followups.length, 1);
		assert.equal(h.state.followups[0].role, "user");
		assert.deepEqual(h.state.followups[0].source, { kind: "plugin", plugin: "taste", form: "snapshot" });
		assert.ok(h.state.followups[0].content[0].text.includes("I prefer tabs over spaces"), h.state.followups[0].content[0].text);
		assert.ok(h.state.followups[0].content[0].text.includes("NEW messages to analyze"));
	});

	it("does not enqueue when learningEnabled is off", async (t) => {
		const h = setup(t, { config: configWith((c) => (c.learningEnabled = false)) });
		seedGlobalTaste(h.globalTasteDir);
		h.turnStopping({ agent: topLevelAgent({ cwd: h.work, events: turnEvents(1) }), turn: 1 });
		await settle();
		assert.equal(h.state.createCalls.length, 0);
	});

	it("does not enqueue subagent or learner-shaped sessions", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		h.turnStopping({ agent: subagentAgent({ cwd: h.work, events: turnEvents(1) }), turn: 1 });
		// learner sessions look like subagents: origin "subagent" + parentSession
		h.turnStopping({ agent: subagentAgent({ id: "learner-1", cwd: h.work, events: turnEvents(1) }), turn: 1 });
		await settle();
		assert.equal(h.state.createCalls.length, 0);
	});

	it("never throws on malformed payloads and swallows internal failures", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		const malformed = [
			undefined,
			null,
			{},
			{ agent: null },
			{ agent: {} },
			{ turn: 1 },
			{ agent: { session: null } },
			{ agent: { session: {} }, turn: 1 },
			{ agent: { session: { events: "not-an-array" } }, turn: 1 },
			{ agent: { session: { events: turnEvents(1) } } }, // no turn number
			{ agent: { session: { events: [null, 7, { type: "user/message" }] } }, turn: 1 },
			{ agent: { session: { events: [{ type: "user/message", data: { content: "not-an-array" } }] } }, turn: 1 },
		];
		for (const payload of malformed) {
			assert.doesNotThrow(() => h.turnStopping(payload), `payload: ${JSON.stringify(payload) ?? "undefined"}`);
		}
		// an internal failure (a throwing events accessor) is caught and logged
		const hostile = { agent: { session: { get events() { throw new Error("events boom"); } } }, turn: 2 };
		assert.doesNotThrow(() => h.turnStopping(hostile));
		assert.ok(h.state.warnings.some((w) => w.includes("turn-stopping handler failed") && w.includes("events boom")), h.state.warnings.join("\n"));
		await settle();
		assert.equal(h.state.createCalls.length, 0);
	});
});

describe("in-flight learner set (R5)", () => {
	it("holds the learner id before agents.create and releases it after dispose", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		let releaseCreate;
		const gate = new Promise((resolve) => {
			releaseCreate = resolve;
		});
		const seen = {};
		h.state.onCreate = (options) => {
			seen.sessionId = options.sessionId;
			// synchronous inside create: the id is already in the in-flight set,
			// so the injection guard blocks it before any snapshot is read
			seen.learnerInjection = h.injectFn({ agent: topLevelAgent({ id: options.sessionId, cwd: h.work }) });
			seen.otherInjection = h.injectFn({ agent: topLevelAgent({ id: "main-1", cwd: h.work }) });
			// the hook's in-flight guard: a session carrying the learner id must
			// not enqueue a second learner
			h.turnStopping({ agent: topLevelAgent({ id: options.sessionId, cwd: h.work, events: turnEvents(9) }), turn: 9 });
		};
		h.state.createImpl = async (options) => {
			await gate; // hold the learner open while we observe the in-flight state
			options.setup({
				tools: { register: () => {} },
				systemPrompt: { section: () => {} },
			});
			return {
				agent: { followup: () => {}, whenIdle: async () => {} },
				dispose: async () => {
					h.state.disposals += 1;
				},
			};
		};

		h.turnStopping({ agent: topLevelAgent({ id: "main-1", cwd: h.work, events: turnEvents(1) }), turn: 1 });
		await waitFor(() => h.state.createCalls.length === 1);
		assert.equal(seen.learnerInjection, "", "learner id must be in the in-flight set at create time");
		assert.match(seen.otherInjection, /^<taste>/, "other sessions are not blocked while the learner runs");

		releaseCreate();
		await waitFor(() => h.state.disposals === 1);
		// after dispose the id is gone from the set: the same id now receives the snapshot
		await waitFor(() => h.injectFn({ agent: topLevelAgent({ id: seen.sessionId, cwd: h.work }) }).startsWith("<taste>"));
		await settle();
		assert.equal(h.state.createCalls.length, 1, "the handler's in-flight guard prevented a second learner");
		assert.equal(h.state.disposals, 1);
	});
});
//#endregion
