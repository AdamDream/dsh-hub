import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBackfillBlocks, parseBackfillArg, splitHistoricalTurns } from "../lib/backfill.js";
import { apply, inject, name } from "../lib/index.js";
//#region test/backfill.test.js
/**
 * `/taste backfill` tests (backfill-design §7): §7.1 pure-function units over
 * lib/backfill.js (argument parsing, turn slicing, block packing, mislearn
 * filtering, prior windows) and §7.2 integration tests over the wired plugin
 * (serial waterfall, per-block hot tasteTree, in-flight ids, breaker yields,
 * re-entry gate), using the fake ctx/agents harness style of index.test.js.
 *
 * The harness isolates `$DSH_HOME` per test (dsh-home-paths resolves the env
 * override at call time), so apply() lands in a throwaway directory.
 */

// ---------------------------------------------------------------------------
// Shared event helpers (backfill-design §0 collector shapes)
// ---------------------------------------------------------------------------

/** One learnable user message event (collector shape, non-plugin source). */
function userMessage(text) {
	return { type: "user/message", data: { content: [{ type: "text", text }], source: { kind: "user" } } };
}

/** One assistant message event (DSH nested shape, provable model source). */
function assistantMessage(text) {
	return { type: "assistant/message", data: { message: { content: [{ type: "text", text }], source: { kind: "model" } } } };
}

/** One completed turn (turn/start … turn/end) with optional user/assistant texts. */
function completedTurn(turn, userText, assistantText) {
	return [
		{ type: "turn/start", data: { turn } },
		...(userText === undefined ? [] : [userMessage(userText)]),
		...(assistantText === undefined ? [] : [assistantMessage(assistantText)]),
		{ type: "turn/end", data: { turn } },
	];
}

/** N completed turns of learnable session events. */
function backfillEvents(turnCount, textOf = (turn) => `turn ${turn} preference`) {
	const events = [];
	for (let turn = 1; turn <= turnCount; turn += 1) {
		events.push(...completedTurn(turn, textOf(turn), `answer ${turn}`));
	}
	return events;
}

/** Summed NEW-section character count of one block (the §3.3 budget metric). */
function blockChars(block) {
	return block.newMessages.reduce((sum, message) => sum + message.content[0].text.length, 0);
}

/** User-message count of one block — each enqueued turn contributes exactly one. */
function blockTurns(block) {
	return block.newMessages.filter((message) => message?.role === "user").length;
}

// ---------------------------------------------------------------------------
// §7.1 pure-function units (lib/backfill.js, no IO)
// ---------------------------------------------------------------------------

describe("parseBackfillArg", () => {
	it("accepts empty as Infinity (all historical turns, §2)", () => {
		assert.deepEqual(parseBackfillArg(""), { ok: true, n: Infinity });
		assert.deepEqual(parseBackfillArg("   "), { ok: true, n: Infinity });
		assert.deepEqual(parseBackfillArg(undefined), { ok: true, n: Infinity });
	});

	it("accepts positive decimal integers", () => {
		assert.deepEqual(parseBackfillArg("5"), { ok: true, n: 5 });
		assert.deepEqual(parseBackfillArg(" 12 "), { ok: true, n: 12 });
	});

	it("rejects 0, negatives and non-integers with the design's distinct reasons", () => {
		assert.deepEqual(parseBackfillArg("0"), { ok: false, reason: "n 至少为 1" });
		assert.deepEqual(parseBackfillArg("-1"), { ok: false, reason: "n 必须是正整数" });
		assert.deepEqual(parseBackfillArg("abc"), { ok: false, reason: "n 必须是正整数" });
		assert.deepEqual(parseBackfillArg("1.5"), { ok: false, reason: "n 必须是正整数" });
		assert.deepEqual(parseBackfillArg("+3"), { ok: false, reason: "n 必须是正整数" });
	});
});

describe("splitHistoricalTurns", () => {
	it("slices completed turns in array order with bounded events (§3.1)", () => {
		const events = [...completedTurn(1, "q1", "a1"), ...completedTurn(2, "q2", "a2")];
		const turns = splitHistoricalTurns(events);
		assert.equal(turns.length, 2);
		assert.deepEqual(turns.map((entry) => entry.turn), [1, 2]);
		// each slice starts at its own turn/start and excludes the next one
		assert.equal(turns[0].events[0].type, "turn/start");
		assert.ok(!turns[0].events.some((event) => event?.type === "turn/start" && event.data?.turn === 2));
		assert.ok(turns[0].events.some((event) => event?.type === "user/message"));
		assert.equal(turns[1].events[0].type, "turn/start");
	});

	it("drops the open tail turn without turn/end (it belongs to turn-stopping, §3.1)", () => {
		const events = [...completedTurn(1, "q1", "a1"), { type: "turn/start", data: { turn: 2 } }, userMessage("q2")];
		assert.deepEqual(splitHistoricalTurns(events).map((entry) => entry.turn), [1]);
	});

	it("returns [] without throwing on malformed input (§7.1)", () => {
		for (const events of [null, undefined, "nope", 42, [], [{ type: "user/message" }]]) {
			assert.deepEqual(splitHistoricalTurns(events), []);
		}
	});

	it("skips turn/start events whose turn number is missing or non-finite (§7.1)", () => {
		const events = [...completedTurn(1, "q1", "a1"), { type: "turn/start" }, userMessage("stray")];
		const turns = splitHistoricalTurns(events);
		assert.equal(turns.length, 1);
		assert.equal(turns[0].turn, 1);
		assert.ok(!turns.some((entry) => !Number.isFinite(entry.turn)));
	});
});

describe("buildBackfillBlocks", () => {
	it("returns [] for an empty history or a fully filtered history (§7.1)", () => {
		assert.deepEqual(buildBackfillBlocks([]), []);
		assert.deepEqual(buildBackfillBlocks(undefined), []);
		const commandOnly = [...completedTurn(1, "/taste status"), ...completedTurn(2, "/taste list 3")];
		assert.deepEqual(buildBackfillBlocks(commandOnly), []);
	});

	it("merges two small turns into one block with u,a,u,a NEW order and an empty first prior window", () => {
		const events = [...completedTurn(1, "q1", "a1"), ...completedTurn(2, "q2", "a2")];
		const blocks = buildBackfillBlocks(events, {});
		assert.equal(blocks.length, 1);
		assert.deepEqual(
			blocks[0].newMessages.map((message) => [message.role, message.content[0].text]),
			[
				["user", "q1"],
				["assistant", "a1"],
				["user", "q2"],
				["assistant", "a2"],
			],
		);
		assert.deepEqual(blocks[0].priorWindow, []);
	});

	it("filters single-line /taste command turns but keeps multi-line /taste discussions (audit issue #5)", () => {
		const events = [
			...completedTurn(1, "/taste backfill 3"), // single-line command form → dropped
			...completedTurn(2, "/TASTE status"), // case-insensitive command form → dropped
			...completedTurn(3, "/taste backfill 说明\n我喜欢 tab 缩进"), // multi-line → kept
			...completedTurn(4, "请你添加补学命令"), // natural language → kept
		];
		const blocks = buildBackfillBlocks(events, {});
		assert.equal(blocks.length, 1);
		assert.deepEqual(
			blocks[0].newMessages.map((message) => message.content[0].text),
			["/taste backfill 说明\n我喜欢 tab 缩进", "请你添加补学命令"],
		);
	});

	it("drops turns with no user text (empty turns never enter NEW, §4.2 rule 1)", () => {
		const events = [...completedTurn(1, undefined, "assistant-only answer"), ...completedTurn(2, "q2", "a2")];
		const blocks = buildBackfillBlocks(events, {});
		assert.equal(blocks.length, 1);
		assert.deepEqual(
			blocks[0].newMessages.map((message) => [message.role, message.content[0].text]),
			[
				["user", "q2"],
				["assistant", "a2"],
			],
		);
	});

	it("respects the injected block budget (audit issue #4: the driver passes min(32k, maxInputChars))", () => {
		// 12 turns of ~6k chars each (4k user + 2k assistant): a 16k budget packs
		// 2 turns per block, a 32k budget packs 5 (then 5, then 2).
		const events = Array.from({ length: 12 }, (_, index) => completedTurn(index + 1, "u".repeat(4000), "a".repeat(2000))).flat();
		const narrow = buildBackfillBlocks(events, { blockMaxChars: 16_000 });
		const wide = buildBackfillBlocks(events, { blockMaxChars: 32_000 });
		assert.equal(narrow.length, 6);
		assert.equal(wide.length, 3);
		assert.ok(narrow.every((block) => blockChars(block) <= 16_000), "every 16k block fits the budget");
		assert.ok(wide.every((block) => blockChars(block) <= 32_000), "every 32k block fits the budget");
	});

	it("keeps one oversized turn intact in its own block (a single turn is never split)", () => {
		const events = [...completedTurn(1, "u".repeat(20_000), "a".repeat(9_000))]; // clipped to 8k + 9k
		const blocks = buildBackfillBlocks(events, { blockMaxChars: 16_000 });
		assert.equal(blocks.length, 1);
		assert.equal(blockChars(blocks[0]), 17_000); // over budget, but a turn cannot be split
	});

	it("clips per-turn texts to the collector budgets with redaction applied before clipping (§3.2)", () => {
		const events = [...completedTurn(1, `token sk-abcdefghijklmnopqrstuvwxyz0123456789 tail ${"u".repeat(9000)}`, "a".repeat(13_000))];
		const [block] = buildBackfillBlocks(events, {});
		const [user, assistant] = block.newMessages;
		assert.ok(user.content[0].text.length <= 8_000, `user text bounded: ${user.content[0].text.length}`);
		assert.ok(assistant.content[0].text.length <= 12_000, `assistant text bounded: ${assistant.content[0].text.length}`);
		assert.ok(user.content[0].text.includes("[...clipped...]"));
		assert.ok(assistant.content[0].text.includes("[...clipped...]"));
		// redactFn ran before the clip, so the redacted token survives inside the head
		assert.ok(user.content[0].text.includes("[REDACTED_TOKEN]"));
	});

	it("flushes blocks at the character budget (first limit wins, §3.3)", () => {
		const events = Array.from({ length: 5 }, (_, index) => completedTurn(index + 1, "u".repeat(20), "a".repeat(10))).flat();
		const blocks = buildBackfillBlocks(events, { blockMaxChars: 100 });
		assert.deepEqual(blocks.map(blockTurns), [3, 2]);
		assert.ok(blocks.every((block) => blockChars(block) <= 100));
	});

	it("flushes blocks at the turn ceiling when the character budget is not reached (§3.3)", () => {
		const events = Array.from({ length: 5 }, (_, index) => completedTurn(index + 1, "u".repeat(20), "a".repeat(10))).flat();
		const blocks = buildBackfillBlocks(events, { blockMaxTurns: 2 });
		assert.deepEqual(blocks.map(blockTurns), [2, 2, 1]);
	});

	it("gives each over-budget single turn its own block instead of splitting it (§3.3)", () => {
		const events = Array.from({ length: 3 }, (_, index) => completedTurn(index + 1, "u".repeat(60), "a".repeat(30))).flat();
		const blocks = buildBackfillBlocks(events, { blockMaxChars: 10 });
		assert.equal(blocks.length, 3);
	});

	it("interprets n as the last n completed turns in chronological order (§2)", () => {
		const events = [1, 2, 3, 4].flatMap((turn) => completedTurn(turn, `q${turn}`, `a${turn}`));
		const [last] = buildBackfillBlocks(events, { n: 1 });
		assert.deepEqual(last.newMessages.map((message) => message.content[0].text), ["q4", "a4"]);
		// the prior window reaches behind the n-window: turns 1-3 precede turn 4
		assert.equal(last.priorWindow.length, 6);
		assert.equal(last.priorWindow[0].content[0].text, "q1");

		assert.equal(buildBackfillBlocks(events, { n: 99 })[0].newMessages.length, 8);
		assert.equal(buildBackfillBlocks(events, { n: Infinity })[0].newMessages.length, 8);
	});

	it("bounds every prior window at the last 20 entries before the block's first turn (cross-block dedup, §3.4)", () => {
		const events = [];
		for (let index = 1; index <= 25; index += 1) {
			events.push(index % 2 === 1 ? userMessage(`m${index}`) : assistantMessage(`m${index}`));
		}
		events.push(...completedTurn(1, "q1", "a1"), ...completedTurn(2, "q2", "a2"));
		const blocks = buildBackfillBlocks(events, { blockMaxTurns: 1 });
		assert.equal(blocks.length, 2);
		// block 1: the tail 20 of the 25 standalone messages
		assert.equal(blocks[0].priorWindow.length, 20);
		assert.equal(blocks[0].priorWindow[0].content[0].text, "m6");
		assert.equal(blocks[0].priorWindow.at(-1).content[0].text, "m25");
		// block 2: m8..m25 plus block 1's learned q1/a1 — the learner sees what pass 1 mined
		assert.equal(blocks[1].priorWindow.length, 20);
		assert.equal(blocks[1].priorWindow[0].content[0].text, "m8");
		assert.equal(blocks[1].priorWindow.at(-2).content[0].text, "q1");
		assert.equal(blocks[1].priorWindow.at(-1).content[0].text, "a1");
	});

	it("clips each prior-window entry to 4000 characters (§3.4)", () => {
		const events = [userMessage("m".repeat(10_000)), ...completedTurn(1, "q1", "a1")];
		const [block] = buildBackfillBlocks(events, { blockMaxTurns: 1 });
		assert.equal(block.priorWindow.length, 1);
		assert.ok(block.priorWindow[0].content[0].text.length <= 4_000);
		assert.ok(block.priorWindow[0].content[0].text.includes("[...clipped...]"));
	});
});

// ---------------------------------------------------------------------------
// §7.2 integration tests (fake ctx/agents, harness mirrors index.test.js)
// ---------------------------------------------------------------------------

/** Clone the frozen §8 defaults into a mutable per-test config. */
function configWith(mutate) {
	const config = structuredClone(configWithDefaults());
	if (mutate) mutate(config);
	return config;
}

/** Local copy of the frozen defaults (config.js does not export them). */
function configWithDefaults() {
	return {
		learningEnabled: true,
		injection: { enabled: true, maxChars: 16_000, includeSubagents: false },
		observer: { modelMode: "inherit", provider: "", model: "", maxInputChars: 16_000, timeoutMs: 120_000, maxTurns: 20 },
		storage: { categoriesEnabled: true },
	};
}

/** Fake top-level agent (no subagent marker) over a session event array. */
function topLevelAgent({ id = "main-session", cwd, events = [] } = {}) {
	return { session: { id, header: { cwd }, events }, options: {} };
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
 * Mirrors index.test.js' setup: captures the wiring surfaces and a
 * controllable agents service; `state.onCreate` / `state.createImpl` let
 * tests observe and gate the learner's creation.
 */
function setup(t, { config } = {}) {
	const root = mkdtempSync(join(tmpdir(), "dsh-taste-backfill-"));
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
				return defaultLearnerHandle(state, options);
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
		runCommand: (rawInput, agent) => state.commands[0].handler({ rawInput, attachments: [], signal: {}, agent }),
	};
}

/** Standard one-shot learner handle for the fake agents service (mirrors learner.test.js: session with a benign "no changes" turn so runLearner's error check passes and the job succeeds). */
function defaultLearnerHandle(state, options) {
	options.setup({
		tools: { register: (...tools) => state.tools.push(...tools) },
		systemPrompt: { section: (section) => state.sections.push(section) },
	});
	return {
		agent: {
			followup: (message) => state.followups.push(message),
			whenIdle: async () => {},
			session: {
				id: options.sessionId,
				events: [{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "no changes" }] } } }],
			},
		},
		dispose: async () => {
			state.disposals += 1;
		},
	};
}

describe("backfill command (integration, §7.2)", () => {
	it("runs three blocks serially with per-block hot tasteTree, prior windows, and unique in-flight ids", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		let creates = 0;
		let concurrent = 0;
		let maxConcurrent = 0;
		const inFlightChecks = [];
		h.state.createImpl = async (options) => {
			creates += 1;
			concurrent += 1;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			// R5 gate technique: the learner id is already in the in-flight set at create time
			inFlightChecks.push(h.injectFn({ agent: topLevelAgent({ id: options.sessionId, cwd: h.work }) }));
			if (creates === 1) {
				// block 1's learner "writes" a second preference; block 2 must read it hot (§9)
				writeFileSync(join(h.globalTasteDir, "taste.md"), "- Always answer in English. Confidence: 0.9\n- Prefers tabs over spaces. Confidence: 0.8\n", "utf8");
			}
			const handle = defaultLearnerHandle(h.state, options);
			const originalDispose = handle.dispose;
			handle.dispose = async () => {
				concurrent -= 1;
				await originalDispose();
			};
			return handle;
		};
		const agent = topLevelAgent({ id: "main-bf", cwd: h.work, events: backfillEvents(12) });
		const result = await h.runCommand("backfill", agent);
		assert.equal(result.kind, "success");
		assert.ok(result.text.includes("已排入 3 块（12 轮）"), result.text);
		await waitFor(() => h.state.disposals === 3);
		assert.equal(h.state.createCalls.length, 3);
		assert.equal(maxConcurrent, 1, "blocks ran strictly serially through the shared queue");
		assert.ok(h.state.createCalls.every((call) => call.meta.parentSession === "main-bf" && call.meta.origin === "subagent"));
		assert.equal(new Set(h.state.createCalls.map((call) => call.sessionId)).size, 3, "every block got a fresh learner session id");
		assert.deepEqual(inFlightChecks, ["", "", ""], "every learner id entered the in-flight set at create time");

		const inputs = h.state.followups.map((message) => message.content[0].text);
		assert.ok(inputs[0].includes("NEW 消息（只能从这里学习）"));
		assert.ok(inputs[0].includes("turn 1 preference") && inputs[0].includes("turn 4 preference"));
		assert.ok(!inputs[0].includes("turn 5 preference"));
		assert.ok(inputs[1].includes("turn 5 preference") && inputs[1].includes("turn 8 preference"));
		assert.ok(!inputs[1].includes("turn 9 preference"));
		assert.ok(inputs[2].includes("turn 12 preference"));
		// block 2's prior window carries block 1's learned turns (cross-block dedup, §3.4)
		assert.ok(inputs[1].includes("此前已分析的对话") && inputs[1].includes("turn 4 preference"));
		// per-block hot read: block 1 saw 1 learning, block 2 saw the 2 written by block 1 (§9)
		assert.match(inputs[0], /1 learnings/);
		assert.match(inputs[1], /2 learnings/);
	});

	it("never learns a pure command turn but learns the natural-language turn (§4 end to end)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		const events = [
			// a real slash command is log-only and leaves no user/message behind (§0):
			// an empty "command turn" that the §4.2 empty-user filter drops
			{ type: "turn/start", data: { turn: 1 } },
			{ type: "turn/end", data: { turn: 1 } },
			...completedTurn(2, "我喜欢 tab 缩进", "好的"),
		];
		const agent = topLevelAgent({ id: "main-mislearn", cwd: h.work, events });
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 1 块（1 轮）"), result.text);
		await waitFor(() => h.state.disposals === 1);
		const input = h.state.followups[0].content[0].text;
		assert.ok(input.includes("我喜欢 tab 缩进"));
		assert.ok(!input.includes("/taste backfill"), input);
	});

	it("stops the waterfall after 3 consecutive failed blocks and never enqueues the rest (§6)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		h.state.createImpl = async () => {
			throw new Error("learner boom");
		};
		const agent = topLevelAgent({ id: "main-fail", cwd: h.work, events: backfillEvents(20) }); // 5 blocks of 4
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 5 块（20 轮）"), result.text);
		await waitFor(() => h.state.warnings.some((message) => message.includes("backfill stopped after 3 consecutive block failures")));
		await settle();
		assert.equal(h.state.createCalls.length, 3, "blocks 4-5 were never enqueued");
		// the shared queue breaker armed on the same three consecutive failures (§6)
		const status = await h.runCommand("status", agent);
		assert.match(status.text, /冷却中/);
		assert.match(status.text, /3 次连续失败/);
		assert.doesNotMatch(status.text, /backfill: \d+\/\d+ blocks/, "the gate is cleared after the stop");
	});

	it("yields to regular learning: the next block is pushed only after the queue is fully idle (audit blocker #1)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		let releaseBlock1;
		const block1Gate = new Promise((resolve) => {
			releaseBlock1 = resolve;
		});
		let creates = 0;
		h.state.createImpl = async (options) => {
			creates += 1;
			if (creates === 1) await block1Gate; // hold backfill block 1 while regular jobs pile up
			return defaultLearnerHandle(h.state, options);
		};
		const agent = topLevelAgent({ id: "main-yield", cwd: h.work, events: backfillEvents(8) }); // 2 blocks of 4
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 2 块（8 轮）"), result.text);
		await waitFor(() => h.state.createCalls.length === 1); // block 1 is running, held at create

		// fill the pending lane to cap 3 with regular turn-stopping jobs
		for (let index = 1; index <= 3; index += 1) {
			h.turnStopping({
				agent: topLevelAgent({ id: `reg-${index}`, cwd: h.work, events: backfillEvents(1, () => `regular ${index} text`) }),
				turn: 1,
			});
		}
		const status = await h.runCommand("status", agent);
		assert.match(status.text, /队列：3 待处理/, "three regular jobs are waiting behind the held block");

		releaseBlock1();
		await waitFor(() => h.state.followups.length === 5); // b1 + 3 regular + b2
		await waitFor(() => h.state.disposals === 5);
		// none of the regular jobs was evicted by a blind push, and the waterfall
		// advanced only after the queue fully drained (§5.2 blocker #1 fix)
		const texts = h.state.followups.map((message) => message.content[0].text);
		assert.ok(texts[0].includes("turn 1 preference"), "followup 0 is backfill block 1");
		assert.ok(texts[1].includes("regular 1 text"), "regular job 1 survived");
		assert.ok(texts[2].includes("regular 2 text"), "regular job 2 survived");
		assert.ok(texts[3].includes("regular 3 text"), "regular job 3 survived");
		assert.ok(texts[4].includes("turn 8 preference"), "followup 4 is backfill block 2");
		assert.equal(h.state.createCalls.length, 5);
	});

	it("rejects re-entry while a waterfall runs and returns before the learner finishes (audit blocker #2, §7.2)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		h.state.createImpl = async (options) => {
			await gate;
			return defaultLearnerHandle(h.state, options);
		};
		const agent = topLevelAgent({ id: "main-reentry", cwd: h.work, events: backfillEvents(8) });
		const first = await h.runCommand("backfill", agent);
		assert.ok(first.text.includes("已排入 2 块（8 轮）"), first.text);
		await waitFor(() => h.state.createCalls.length === 1); // learner started…
		assert.equal(h.state.disposals, 0, "…but the command never awaited it (immediate return)");

		const second = await h.runCommand("backfill", agent);
		assert.equal(second.kind, "error");
		assert.ok(second.text.includes("backfill: 已在运行中（0/2 块），请稍候。"), second.text);
		assert.equal(h.state.createCalls.length, 1, "no second waterfall was started");

		release();
		await waitFor(() => h.state.createCalls.length === 2);
		await waitFor(() => h.state.disposals === 2);
		await settle();
		const status = await h.runCommand("status", agent);
		assert.doesNotMatch(status.text, /backfill: \d+\/\d+ blocks/, "progress is cleared after the waterfall ends");
	});

	it("returns the no-history error when nothing is learnable (§2)", async (t) => {
		const h = setup(t);
		const agent = topLevelAgent({ id: "main-empty", cwd: h.work, events: [] });
		const result = await h.runCommand("backfill", agent);
		assert.equal(result.kind, "error");
		assert.equal(result.text, "backfill: 没有可补学的历史轮。");
		await settle();
		assert.equal(h.state.createCalls.length, 0);
	});

	it("rejects invalid arguments with the usage line (§2)", async (t) => {
		const h = setup(t);
		const result = await h.runCommand("backfill 0", topLevelAgent({}));
		assert.equal(result.kind, "error");
		assert.equal(result.text, "用法：/taste backfill [n]。n 至少为 1");
	});

	it("refuses to run when learning is off (§2)", async (t) => {
		const h = setup(t);
		// the command pre-check reads the persisted config, so flip the switch on disk
		writeFileSync(join(h.globalTasteDir, "config.json"), JSON.stringify({ learningEnabled: false }), "utf8");
		const agent = topLevelAgent({ id: "main-off", cwd: h.work, events: backfillEvents(2) });
		const result = await h.runCommand("backfill", agent);
		assert.equal(result.kind, "error");
		assert.equal(result.text, "backfill: 学习已关闭（/taste on 开启）。");
		await settle();
		assert.equal(h.state.createCalls.length, 0);
	});

	it("refuses to run while the breaker is cooling down (§2)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		h.state.createImpl = async () => {
			throw new Error("boom");
		};
		// three consecutive failed turn-stopping jobs arm the shared breaker
		for (let index = 0; index < 3; index += 1) {
			h.turnStopping({ agent: topLevelAgent({ id: `fail-${index}`, cwd: h.work, events: backfillEvents(1) }), turn: 1 });
		}
		await waitFor(() => h.state.warnings.filter((message) => message.includes("job failed")).length === 3);
		const agent = topLevelAgent({ id: "main-cool", cwd: h.work, events: backfillEvents(2) });
		const result = await h.runCommand("backfill", agent);
		assert.equal(result.kind, "error");
		assert.equal(result.text, "backfill: learner 熔断冷却中，请稍后再试。");
		await settle();
		assert.equal(h.state.createCalls.length, 3, "the backfill command enqueued nothing");
	});

	it("caps the block budget at min(32k, observer.maxInputChars) read hot from config.json (audit issue #4)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		writeFileSync(join(h.globalTasteDir, "config.json"), JSON.stringify({ observer: { maxInputChars: 32_000 } }), "utf8");
		// 12 turns of ~4k chars: at a 32k budget the 4-turn ceiling packs first → 3 blocks
		const agent = topLevelAgent({ id: "main-budget-32k", cwd: h.work, events: backfillEvents(12, () => "u".repeat(4000)) });
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 3 块（12 轮）"), result.text);
		await waitFor(() => h.state.disposals === 3);
	});

	it("falls back to the 16k default observer budget when no config.json exists (audit issue #4)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		// same turns, no config.json → the 16k budget flushes after 3 turns (~12k) → 4 blocks
		const agent = topLevelAgent({ id: "main-budget-16k", cwd: h.work, events: backfillEvents(12, () => "u".repeat(4000)) });
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 4 块（12 轮）"), result.text);
		await waitFor(() => h.state.disposals === 4);
	});

	it("lets runLearner re-clip an over-budget single turn to observer.maxInputChars (既有行为, §9)", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		const events = [...completedTurn(1, "u".repeat(20_000), "a".repeat(12_000))]; // 8k + 12k after the collector clip
		const agent = topLevelAgent({ id: "main-clip", cwd: h.work, events });
		const result = await h.runCommand("backfill", agent);
		assert.ok(result.text.includes("已排入 1 块（1 轮）"), result.text);
		await waitFor(() => h.state.followups.length === 1);
		const input = h.state.followups[0].content[0].text;
		assert.ok(input.length <= 16_000, `the whole input was re-clipped to maxInputChars: ${input.length}`);
		assert.ok(input.includes("[...clipped...]"));
	});
});

describe("plugin surface (backfill additions)", () => {
	it("still declares the exact inject set and registers one command (no regression)", (t) => {
		const h = setup(t);
		assert.equal(name, "taste");
		assert.deepEqual(inject, ["agents", "commands", "systemPrompt", "connection"]);
		assert.equal(h.state.commands.length, 1);
		assert.equal(h.state.commands[0].name, "taste");
	});

	it("renders the backfill progress line in /taste status only while active", async (t) => {
		const h = setup(t);
		seedGlobalTaste(h.globalTasteDir);
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		h.state.createImpl = async (options) => {
			await gate;
			return defaultLearnerHandle(h.state, options);
		};
		const agent = topLevelAgent({ id: "main-status", cwd: h.work, events: backfillEvents(8) });
		const before = await h.runCommand("status", agent);
		assert.doesNotMatch(before.text, /backfill: \d+\/\d+ blocks/);
		await h.runCommand("backfill", agent);
		await waitFor(() => h.state.createCalls.length === 1);
		const during = await h.runCommand("status", agent);
		assert.match(during.text, /backfill: 0\/2 块/);
		release();
		await waitFor(() => h.state.disposals === 2);
		const after = await h.runCommand("status", agent);
		assert.doesNotMatch(after.text, /backfill: \d+\/\d+ blocks/);
	});
});
//#endregion
