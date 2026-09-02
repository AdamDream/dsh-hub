import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARNER_PROMPT, buildLearnerInput, runLearner } from "../lib/learner.js";

/** Build a fake DSH agents service recording every create/withInitiator call. */
function createFakeAgents({ createImpl } = {}) {
	const calls = { create: [], setups: [], sections: [], tools: [], followups: [], disposed: 0 };
	const agents = {
		calls,
		withInitiator: (parent, operation) => operation(parent),
		create: async (options) => {
			calls.create.push(options);
			if (createImpl) return createImpl(options);
			const childCtx = {
				tools: { register: (...tools) => calls.tools.push(...tools) },
				systemPrompt: { section: (section) => calls.sections.push(section) },
			};
			options.setup(childCtx);
			calls.setups.push(childCtx);
			const agent = {
				options: options.agentOptions,
				followup: (message) => calls.followups.push(message),
				whenIdle: async () => {},
				session: {
					id: options.sessionId,
					events: [{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "no changes" }] } } }],
				},
			};
			return { agent, dispose: async () => void (calls.disposed += 1) };
		},
	};
	return agents;
}

const PARENT = {
	session: { id: "parent-session" },
	options: { provider: "parent-provider", model: "parent-model" },
};

const DEFAULT_ARGS = () => ({
	parentAgent: PARENT,
	input: "NEW messages to analyze",
	resolveGlobalDir: () => "/tmp/taste-global",
	resolveProjectDir: () => "/tmp/taste-project",
});

describe("LEARNER_PROMPT", () => {
	it("carries the pi-taste contract: NEW-only learning, reference-only prior window, no-changes exit", () => {
		assert.match(LEARNER_PROMPT, /Learn ONLY from the NEW messages/);
		assert.match(LEARNER_PROMPT, /never to be re-learned/);
		assert.match(LEARNER_PROMPT, /Do NOT re-record a preference that already exists/);
		assert.match(LEARNER_PROMPT, /reply "no changes"/);
		assert.match(LEARNER_PROMPT, /write_taste_file|edit_taste_file|read_taste_file/);
	});
});

describe("buildLearnerInput", () => {
	it("renders the three ported sections in pi-taste order", () => {
		const input = buildLearnerInput({
			tasteTree: "├── taste.md (2 learnings)",
			newMessages: [{ role: "user", content: [{ type: "text", text: "I prefer tabs" }] }],
			priorWindow: [{ role: "assistant", content: [{ type: "text", text: "sure" }] }],
		});
		assert.match(input, /^Current taste structure:\n├── taste\.md \(2 learnings\)\n\n/);
		assert.match(input, /Previously analyzed conversation \(context only[^\n]*do NOT learn from it again\):\n\[.*"assistant".*\]\n\n/s);
		assert.match(input, /NEW messages to analyze \(learn ONLY from these\):\n\[\s*\{\s*"role": "user"/s);
		assert.ok(input.indexOf("Previously analyzed") < input.indexOf("NEW messages"));
	});

	it("falls back to the pi-taste empty-structure marker and (none)/(empty) windows", () => {
		const input = buildLearnerInput({ tasteTree: "", newMessages: [], priorWindow: [] });
		assert.match(input, /Current taste structure:\n\(empty - no taste files yet\)/);
		assert.match(input, /do NOT learn from it again\):\n\(none\)/);
		assert.match(input, /NEW messages to analyze \(learn ONLY from these\):\n\[\]/);
	});

	it("caps the prior window at the last 20 visible entries and drops non-text shapes", () => {
		const priorWindow = Array.from({ length: 30 }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `m${index}` }],
		}));
		priorWindow.unshift({ role: "system", content: [{ type: "text", text: "hidden" }] });
		const input = buildLearnerInput({ tasteTree: "t", newMessages: [], priorWindow });
		const previous = input.slice(input.indexOf("again):\n") + 8, input.indexOf("\n\nNEW messages"));
		const parsed = JSON.parse(previous);
		assert.equal(parsed.length, 20);
		assert.equal(parsed[0].content[0].text, "m10"); // the 10 oldest were dropped
		assert.equal(parsed.at(-1).content[0].text, "m29");
	});
});

describe("runLearner", () => {
	it("creates the learner inside withInitiator with inherit routing and the parent session link", async () => {
		const agents = createFakeAgents();
		const result = await runLearner({ ...DEFAULT_ARGS(), agents, config: { observer: { modelMode: "inherit" } } });
		assert.equal(agents.calls.create.length, 1);
		const options = agents.calls.create[0];
		assert.equal(options.agentOptions.provider, "parent-provider");
		assert.equal(options.agentOptions.model, "parent-model");
		assert.equal(options.meta.parentSession, "parent-session");
		assert.equal(options.meta.origin, "subagent"); // dsh-session rejects any other origin
		assert.equal(options.sessionId, agents.calls.create[0].sessionId);
		assert.match(options.sessionId, /^[0-9a-f-]{36}$/);
		// setup registered the three taste tools and the prompt section
		assert.deepEqual(agents.calls.tools.map((tool) => tool.name), ["read_taste_file", "write_taste_file", "edit_taste_file"]);
		assert.deepEqual(agents.calls.sections, [{ name: "taste-learner", order: 190, text: LEARNER_PROMPT }]);
		// followup carried the input as a plugin snapshot user message
		assert.equal(agents.calls.followups.length, 1);
		assert.deepEqual(agents.calls.followups[0].content, [{ type: "text", text: "NEW messages to analyze" }]);
		assert.deepEqual(agents.calls.followups[0].source, { kind: "plugin", plugin: "taste", form: "snapshot" });
		assert.equal(agents.calls.followups[0].role, "user");
		assert.equal(agents.calls.disposed, 1);
		assert.deepEqual(result.output, [{ type: "text", text: "no changes" }]);
	});

	it("routes custom modelMode to the configured observer provider/model", async () => {
		const agents = createFakeAgents();
		await runLearner({
			...DEFAULT_ARGS(),
			agents,
			config: { observer: { modelMode: "custom", provider: "adam", model: "deepseek-v4-pro" } },
		});
		assert.equal(agents.calls.create.length, 1);
		assert.deepEqual(agents.calls.create[0].agentOptions, { provider: "adam", model: "deepseek-v4-pro" });
	});

	it("falls back to inherit routing with a warning when custom routing is incomplete", async () => {
		const agents = createFakeAgents();
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		try {
			// missing model
			await runLearner({
				...DEFAULT_ARGS(),
				agents,
				config: { observer: { modelMode: "custom", provider: "adam", model: "" } },
			});
			// missing provider (non-string counts as missing)
			await runLearner({ ...DEFAULT_ARGS(), agents, config: { observer: { modelMode: "custom", provider: 42, model: "m" } } });
		} finally {
			console.warn = originalWarn;
		}
		assert.equal(agents.calls.create.length, 2);
		for (const options of agents.calls.create) {
			assert.deepEqual(options.agentOptions, { provider: "parent-provider", model: "parent-model" });
		}
		assert.equal(warnings.length, 2, warnings.join("\n"));
		assert.match(warnings[0], /falling back to inherit/);
		assert.match(warnings[1], /falling back to inherit/);
	});

	it("never warns and keeps the parent route for inherit mode", async () => {
		const agents = createFakeAgents();
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		try {
			await runLearner({
				...DEFAULT_ARGS(),
				agents,
				config: { observer: { modelMode: "inherit", provider: "unused-provider", model: "unused-model" } },
			});
		} finally {
			console.warn = originalWarn;
		}
		assert.deepEqual(agents.calls.create[0].agentOptions, { provider: "parent-provider", model: "parent-model" });
		assert.equal(warnings.length, 0);
	});

	it("passes the caller's session id and signal through to create", async () => {
		const agents = createFakeAgents();
		const controller = new AbortController();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: {}, signal: controller.signal, sessionId: "learner-session" });
		assert.equal(agents.calls.create[0].sessionId, "learner-session");
		assert.equal(agents.calls.create[0].signal, controller.signal);
	});

	it("fuses the plugin signal with the observer timeout when timeoutMs is set", async () => {
		const agents = createFakeAgents();
		const controller = new AbortController();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: { observer: { timeoutMs: 60_000 } }, signal: controller.signal });
		const signal = agents.calls.create[0].signal;
		assert.equal(signal.aborted, false);
		controller.abort();
		assert.equal(signal.aborted, true); // fused signal tracks the plugin signal
	});

	it("disposes the handle on the success path exactly once", async () => {
		const agents = createFakeAgents();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: {} });
		assert.equal(agents.calls.disposed, 1);
	});

	it("contains a disposal failure and still returns the output", async () => {
		const agents = createFakeAgents({
			createImpl: () => {
				const agent = {
					options: {},
					followup: () => {},
					whenIdle: async () => {},
					session: { events: [{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "done" }] } } }] },
				};
				return { agent, dispose: async () => { throw new Error("dispose boom"); } };
			},
		});
		const result = await runLearner({ ...DEFAULT_ARGS(), agents, config: {} });
		assert.deepEqual(result.output, [{ type: "text", text: "done" }]);
	});

	it("propagates creation failure (no handle to dispose)", async () => {
		const agents = createFakeAgents({ createImpl: () => { throw new Error("create boom"); } });
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents, config: {} }), /create boom/);
		assert.equal(agents.calls.disposed, 0);
	});

	it("rejects on structurally invalid arguments", async () => {
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: {}, config: {} }), /agents service/);
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: createFakeAgents(), parentAgent: {}, config: {} }), /parentAgent/);
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: createFakeAgents(), config: {}, input: "  " }), /input/);
	});

	it("leaves the input unclipped without a usable maxInputChars budget", async () => {
		const agents = createFakeAgents();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: { observer: { maxInputChars: undefined } } });
		assert.deepEqual(agents.calls.followups[0].content, [{ type: "text", text: "NEW messages to analyze" }]);
	});

	it("propagates the parent's cwd and agentPreset into the learner session meta (persona {{cwd}} incident)", async () => {
		// 2026-09-02 incident: without meta.cwd the learner's system-prompt
		// assembly died on {{cwd}} in the deployment persona section before
		// any model call. Mirrors dsh-subagent childSessionMeta.
		const agents = createFakeAgents();
		const parent = {
			session: { id: "parent-session", header: { id: "parent-session", cwd: "/home/user/project", agentPreset: "standard-glm" } },
			options: { provider: "p", model: "m" },
		};
		await runLearner({ ...DEFAULT_ARGS(), parentAgent: parent, agents, config: {} });
		const meta = agents.calls.create[0].meta;
		assert.equal(meta.cwd, "/home/user/project");
		assert.equal(meta.agentPreset, "standard-glm");
		assert.equal(meta.parentSession, "parent-session");
		assert.equal(meta.origin, "subagent");
	});

	it("omits cwd/agentPreset from meta when the parent header lacks them", async () => {
		const agents = createFakeAgents();
		const parent = { session: { id: "parent-session", header: { id: "parent-session" } }, options: { provider: "p", model: "m" } };
		await runLearner({ ...DEFAULT_ARGS(), parentAgent: parent, agents, config: {} });
		const meta = agents.calls.create[0].meta;
		assert.equal("cwd" in meta, false);
		assert.equal("agentPreset" in meta, false);
	});

	it("rejects when the learner turn ends in error instead of booking a silent success", async () => {
		// An errored learner turn resolves whenIdle normally with no assistant
		// output; runLearner must surface it so the queue counts a failure and
		// the breaker can trip (observable via /taste status).
		let disposed = 0;
		const agents = createFakeAgents({
			createImpl: () => {
				const agent = {
					options: {},
					followup: () => {},
					whenIdle: async () => {},
					session: {
						events: [
							{ type: "turn/start", data: { turn: 1 } },
							{ type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: 'prompt variable "{{cwd}}" has no value for this assembly' } } } },
						],
					},
				};
				return { agent, dispose: async () => void (disposed += 1) };
			},
		});
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents, config: {} }), /learner turn failed: prompt variable/);
		assert.equal(disposed, 1); // finally still disposes on the failure path
	});
});
