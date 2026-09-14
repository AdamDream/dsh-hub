import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARNER_PROMPT, buildLearnerInput, runLearner } from "../lib/learner.js";

/** Build a fake DSH agents service recording every create/withInitiator call. */
function createFakeAgents({ createImpl } = {}) {
	const calls = { create: [], setups: [], sections: [], tools: [], followups: [], disposed: 0, sessionAppends: [] };
	const agents = {
		calls,
		withInitiator: (parent, operation) => operation(parent),
		create: async (options) => {
			calls.create.push(options);
			if (createImpl) return createImpl(options);
			const childCtx = {
				// Mirrors the real child context: agent.session.append(type, data)
				// backs the subagent/descriptor event, and ToolRuntime.register
				// takes ONE tool per call (a spread-style register would push only
				// the first tool here and fail the 3-name assertion below).
				agent: { session: { append: (type, data) => calls.sessionAppends.push({ type, data }) } },
				tools: { register: (tool) => calls.tools.push(tool) },
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
 it("is Chinese-first and enforces core boundaries", () => {
  assert.match(LEARNER_PROMPT, /只分析 NEW 消息中的真实用户偏好/);
  assert.match(LEARNER_PROMPT, /无变化/);
  assert.match(LEARNER_PROMPT, /Confidence: 0\.88/);
  for (const tool of ["read_taste_file", "write_taste_file", "edit_taste_file"]) assert.match(LEARNER_PROMPT, new RegExp(tool));
  assert.match(LEARNER_PROMPT, /assistant 只能辅助佐证/);
  assert.match(LEARNER_PROMPT, /汰换/);
 });
});

describe("buildLearnerInput", () => {
	it("renders the three ported sections in pi-taste order", () => {
		const input = buildLearnerInput({
			tasteTree: "├── taste.md (2 learnings)",
			newMessages: [{ role: "user", content: [{ type: "text", text: "I prefer tabs" }] }],
			priorWindow: [{ role: "assistant", content: [{ type: "text", text: "sure" }] }],
		});
		assert.match(input, /^当前 taste 结构：\n├── taste\.md \(2 learnings\)\n\n/);
		assert.match(input, /此前已分析的对话（仅供指代，不得再次学习）：\n\[.*"assistant".*\]\n\n/s);
		assert.match(input, /NEW 消息（只能从这里学习）：\n\[\s*\{\s*"role": "user"/s);
		assert.ok(input.indexOf("此前已分析") < input.indexOf("NEW 消息"));
	});

	it("falls back to the pi-taste empty-structure marker and (none)/(empty) windows", () => {
		const input = buildLearnerInput({ tasteTree: "", newMessages: [], priorWindow: [] });
		assert.match(input, /当前 taste 结构：\n（暂无 taste\.md 条目）/);
		assert.match(input, /不得再次学习）：\n（无）/);
		assert.match(input, /NEW 消息（只能从这里学习）：\n\[\]/);
	});

	it("caps the prior window at the last 20 visible entries and drops non-text shapes", () => {
		const priorWindow = Array.from({ length: 30 }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `m${index}` }],
		}));
		priorWindow.unshift({ role: "system", content: [{ type: "text", text: "hidden" }] });
		const input = buildLearnerInput({ tasteTree: "t", newMessages: [], priorWindow });
		const previous = input.slice(input.indexOf("此前已分析的对话") + input.slice(input.indexOf("此前已分析的对话")).indexOf("["), input.indexOf("\n\nNEW 消息"));
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

	it("rejects structurally invalid arguments", async () => {
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: {}, config: {} }), /agents service/);
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: createFakeAgents(), parentAgent: {}, config: {} }), /parentAgent/);
		await assert.rejects(() => runLearner({ ...DEFAULT_ARGS(), agents: createFakeAgents(), config: {}, input: "  " }), /input/);
	});

	it("keeps the default prompt and three learning tools when no override is given (zero behavior change)", async () => {
		const agents = createFakeAgents();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: {} });
		assert.deepEqual(agents.calls.tools.map((tool) => tool.name), ["read_taste_file", "write_taste_file", "edit_taste_file"]);
		assert.deepEqual(agents.calls.sections, [{ name: "taste-learner", order: 190, text: LEARNER_PROMPT }]);
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

	it("appends a one-shot subagent/descriptor event so the GUI panel does not mislabel the learner corrupt", async () => {
		// 2026-09-02 incident: the GUI subagent panel folds subagent/descriptor
		// to identify cold children (dsh-subagent foldSubagentDescriptor);
		// a raw agents.create child without the event lists as "会话记录损坏".
		const agents = createFakeAgents();
		await runLearner({ ...DEFAULT_ARGS(), agents, config: {} });
		const descriptor = agents.calls.sessionAppends.find((entry) => entry.type === "subagent/descriptor");
		assert.ok(descriptor, "setup must append subagent/descriptor");
		// Exactly the ONE_SHOT_DESCRIPTOR_KEYS set: version/mode/provider/label.
		assert.deepEqual(Object.keys(descriptor.data).sort(), ["label", "mode", "provider", "version"]);
		assert.equal(descriptor.data.version, 2);
		assert.equal(descriptor.data.mode, "one-shot");
		assert.equal(typeof descriptor.data.provider, "string");
		assert.equal(typeof descriptor.data.label, "string");
	});

	it("keeps learning alive when the descriptor append fails (cosmetic, warn-only)", async () => {
		const agents = createFakeAgents({
			createImpl: (options) => {
				const childCtx = {
					agent: { session: { append: () => { throw new Error("append boom"); } } },
					tools: { register: (tool) => agents.calls.tools.push(tool) },
					systemPrompt: { section: (section) => agents.calls.sections.push(section) },
				};
				options.setup(childCtx);
				const agent = {
					options: options.agentOptions,
					followup: (message) => agents.calls.followups.push(message),
					whenIdle: async () => {},
					session: { events: [{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "no changes" }] } } }] },
				};
				return { agent, dispose: async () => void (agents.calls.disposed += 1) };
			},
		});
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		try {
			const result = await runLearner({ ...DEFAULT_ARGS(), agents, config: {} });
			assert.deepEqual(result.output, [{ type: "text", text: "no changes" }]);
		} finally {
			console.warn = originalWarn;
		}
		assert.equal(agents.calls.tools.length, 3); // tools still registered
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /descriptor append failed: append boom/);
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
