import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyEventForTaste, collectTurnEvidence, collectTurnTexts, isLearnableUserEvent } from "../lib/collector.js";

let nextSeq = 1;

function ev(type, data) {
	return { type, seq: nextSeq++, time: 0, data };
}

function text(block) {
	return typeof block === "string" ? { type: "text", text: block } : block;
}

function userMessage(parts, kind = "user") {
	return ev("user/message", { id: "u", role: "user", source: { kind }, content: parts.map(text) });
}

function assistantMessage(parts, nested = true, kind = "model") {
	const message = { id: "a", role: "assistant", source: { kind, provider: "deepseek", model: "m" }, content: parts.map(text) };
	return ev("assistant/message", nested ? { message } : { content: message.content, source: { kind } });
}

function turnStart(turn) {
	return ev("turn/start", { turn });
}

function turnEnd(turn) {
	return ev("turn/end", { turn });
}

test("classifyEventForTaste is the only classification API with the strict {kind, reason} shape", () => {
	assert.deepEqual(classifyEventForTaste(userMessage(["hello"])), { kind: "user-primary", reason: "user-message" });
	assert.deepEqual(classifyEventForTaste(assistantMessage(["hi"])), { kind: "assistant-secondary", reason: "assistant-message" });
	// 事件类型闸门：非 message 类型、缺 type、data 非对象一律 event-shape-or-type。
	for (const event of [turnStart(1), ev("tool/call", {}), ev("tool/result", {}), ev("agent/inbox", {}), ev("agent/inbox/spliced", {}), ev("system", {}), ev("runtime-context", {}), ev("rpc/x", {}), ev("turn/end", {}), null, undefined, 42, "a string", {}, { type: "user/message" }, { type: "user/message", data: null }]) {
		assert.deepEqual(classifyEventForTaste(event), { kind: "reject", reason: "event-shape-or-type" }, JSON.stringify(event?.type ?? event));
	}
});

test("source gate: automation kinds, unknown values and invalid shapes fail closed", () => {
	for (const kind of ["plugin", "tool", "system", "runtime-context", "agent", "rpc", "subagent", "automation", "inbox", "spliced", "something-new"]) {
		assert.deepEqual(classifyEventForTaste(userMessage(["x"], kind)), { kind: "reject", reason: "unknown-or-automated-source" }, kind);
	}
	// source 为对象但缺字符串 kind：invalid，不走“缺失 source”兼容放行。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: {}, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "unknown-or-automated-source" },
	);
	// source 为非字符串非对象：同样 fail-closed。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: 42, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "unknown-or-automated-source" },
	);
	// 兼容 shape：字符串 source === "user" 放行。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: "user", content: [{ type: "text", text: "x" }] })),
		{ kind: "user-primary", reason: "user-message" },
	);
});

test("missing source: only user/message with role absent or exactly user proceeds; assistant never", () => {
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", content: [{ type: "text", text: "x" }] })),
		{ kind: "user-primary", reason: "user-message" },
		"missing source is compatibly accepted for a role-checked user message",
	);
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { content: [{ type: "text", text: "x" }] })),
		{ kind: "user-primary", reason: "user-message" },
		"missing role with missing source is accepted (audited compat)",
	);
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "unknown-or-automated-source" },
		"assistant without a provable model source fails closed",
	);
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "x" }] } })),
		{ kind: "reject", reason: "unknown-or-automated-source" },
		"nested assistant envelope without source also fails closed",
	);
});

test("assistant source must be exactly assistant/model/llm (flat and nested shapes)", () => {
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { content: [{ type: "text", text: "x" }], source: { kind: "model" } })),
		{ kind: "assistant-secondary", reason: "assistant-message" },
	);
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { content: [{ type: "text", text: "x" }], source: "assistant" })),
		{ kind: "assistant-secondary", reason: "assistant-message" },
	);
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { content: [{ type: "text", text: "x" }], source: { kind: "user" } })),
		{ kind: "reject", reason: "unknown-or-automated-source" },
	);
	// 嵌套信封：来源在 data.message.source（设计 §8.1 的真实 assistant shape）。
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { message: { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text: "x" }] } })),
		{ kind: "assistant-secondary", reason: "assistant-message" },
	);
});

test("role gate: present role must match the event type", () => {
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "assistant", source: { kind: "user" }, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "role-mismatch" },
	);
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { role: "user", content: [{ type: "text", text: "x" }], source: { kind: "model" } })),
		{ kind: "reject", reason: "role-mismatch" },
	);
});

test("content gate: only non-blank {type:'text', text:string} blocks count; containers fail closed", () => {
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user" }, content: "not an array" })),
		{ kind: "reject", reason: "content-shape" },
	);
	// 嵌套 assistant：message 存在但 content 非数组 → content-shape，不回退 flat。
	assert.deepEqual(
		classifyEventForTaste(ev("assistant/message", { message: { role: "assistant", source: { kind: "model" }, content: "nope" }, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "content-shape" },
	);
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user" }, content: [{ type: "image", url: "x" }, { type: "thinking" }, { type: "text", text: "   " }] })),
		{ kind: "reject", reason: "no-visible-text" },
	);
});

test("embedded automation records fail closed without scanning ordinary user text keywords", () => {
	// 外层 agent/inbox 直接作为 data.message。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user" }, message: { type: "agent/inbox", payload: 1 }, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "embedded-automation-record" },
	);
	// 内层 spliced/记录嵌套在 source 对象里。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user", note: { type: "agent/inbox/spliced" } }, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "embedded-automation-record" },
	);
	// 嵌套记录 source.kind 自动化/未知。
	assert.deepEqual(
		classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user" }, message: { type: "note", source: { kind: "inbox" } }, content: [{ type: "text", text: "x" }] })),
		{ kind: "reject", reason: "embedded-automation-record" },
	);
	// tool/rpc/system/runtime 嵌套记录。
	for (const nestedType of ["tool/call", "rpc/req", "system", "runtime-context"]) {
		assert.deepEqual(
			classifyEventForTaste(ev("user/message", { role: "user", source: { kind: "user" }, message: { type: nestedType }, content: [{ type: "text", text: "x" }] })),
			{ kind: "reject", reason: "embedded-automation-record" },
			nestedType,
		);
	}
	// 真实用户讨论工具/inbox 字样不被关键词误伤。
	assert.deepEqual(
		classifyEventForTaste(userMessage(["请用 query_peers 查看 agent inbox，再 read_taste_file 检查 taste"])),
		{ kind: "user-primary", reason: "user-message" },
	);
	// 用户引用 assistant 的纠正仍是 user-primary。
	assert.deepEqual(
		classifyEventForTaste(userMessage(["assistant 说错了，我偏好 Y"])),
		{ kind: "user-primary", reason: "user-message" },
	);
});

test("isLearnableUserEvent only compares classifyEventForTaste's kind", () => {
	assert.equal(isLearnableUserEvent(userMessage(["hello"])), true);
	assert.equal(isLearnableUserEvent(userMessage(["snapshot"], "plugin")), false);
	assert.equal(isLearnableUserEvent(ev("user/message", { role: "user", source: { kind: "user" }, content: [] })), false, "no visible text is not learnable");
	assert.equal(isLearnableUserEvent(assistantMessage(["hi"])), false);
	assert.equal(isLearnableUserEvent(turnStart(1)), false);
	assert.equal(isLearnableUserEvent(null), false);
	assert.equal(isLearnableUserEvent(undefined), false);
	assert.equal(isLearnableUserEvent(42), false);
});

test("collectTurnEvidence emits {role, provenance, text} items, user before assistant", () => {
	const events = [
		turnStart(2),
		userMessage(["A1"]),
		assistantMessage(["B1"]),
		userMessage(["A2"]),
		assistantMessage(["B2"]),
	];
	const evidence = collectTurnEvidence(events, 2);
	assert.deepEqual(evidence, {
		user: [
			{ role: "user", provenance: "user-primary", text: "A1" },
			{ role: "user", provenance: "user-primary", text: "A2" },
		],
		assistant: [
			{ role: "assistant", provenance: "assistant-secondary", text: "B1" },
			{ role: "assistant", provenance: "assistant-secondary", text: "B2" },
		],
	});
});

test("slices from the matching turn/start to the array end without a turn/end", () => {
	const events = [
		turnStart(1),
		userMessage(["A1"]),
		assistantMessage(["B1"]),
		turnEnd(1),
		turnStart(2),
		userMessage(["A2"]),
		assistantMessage(["B2"]),
	];
	assert.deepEqual(collectTurnTexts(events, 2), { userText: "A2", assistantText: "B2" }, "no turn/end is required");
	assert.deepEqual(collectTurnTexts(events, 1), { userText: "A1\nA2", assistantText: "B1\nB2" }, "the slice runs to the array end by contract");
	assert.deepEqual(collectTurnTexts(events, 99), { userText: "", assistantText: "" }, "an unknown turn yields empty texts");
});

test("joins multiple messages and multiple text parts with newlines; tool blocks are skipped", () => {
	const events = [
		turnStart(3),
		userMessage(["first part", { type: "image", url: "x" }, "second part"]),
		userMessage(["third part"]),
		assistantMessage(["answer head", { type: "toolCall", callId: "c1" }, "answer tail"]),
	];
	assert.deepEqual(collectTurnTexts(events, 3), {
		userText: "first part\nsecond part\nthird part",
		assistantText: "answer head\nanswer tail",
	});
});

test("excludes plugin-authored user messages inside the slice", () => {
	const events = [
		turnStart(4),
		userMessage(["Current runtime context: none."], "plugin"),
		userMessage(["real request"]),
		assistantMessage(["reply"]),
	];
	assert.deepEqual(collectTurnTexts(events, 4), { userText: "real request", assistantText: "reply" });
	assert.deepEqual(
		collectTurnTexts([turnStart(5), userMessage(["only snapshot"], "plugin")], 5),
		{ userText: "", assistantText: "" },
	);
});

test("skips malformed events and blocks without throwing (R1)", () => {
	const events = [
		turnStart(7),
		null,
		undefined,
		42,
		"a string",
		ev("user/message", null),
		ev("user/message", { role: "user", source: { kind: "user" } }),
		ev("user/message", { role: "user", source: { kind: "user" }, content: "not an array" }),
		ev("user/message", {
			role: "user",
			source: { kind: "user" },
			content: [null, 7, "bare string", { type: "text" }, { type: "text", text: 123 }, { type: "text", text: "   " }, { type: "text", text: "good" }],
		}),
		ev("assistant/message", null),
		ev("assistant/message", { message: null }),
		ev("assistant/message", { message: { role: "assistant", source: { kind: "model" }, content: [null, { type: "text", text: "ok-assistant" }] } }),
		ev("turn/start", null),
	];
	assert.deepEqual(collectTurnTexts(events, 7), { userText: "good", assistantText: "ok-assistant" });
});

test("tolerates non-array event inputs and non-number turns", () => {
	assert.deepEqual(collectTurnTexts(null, 1), { userText: "", assistantText: "" });
	assert.deepEqual(collectTurnTexts(undefined, 1), { userText: "", assistantText: "" });
	assert.deepEqual(collectTurnTexts("nope", 1), { userText: "", assistantText: "" });
	assert.deepEqual(collectTurnTexts([userMessage(["x"])], "1"), { userText: "", assistantText: "" });
	assert.deepEqual(collectTurnTexts([userMessage(["x"])], Number.NaN), { userText: "", assistantText: "" });
});

test("accepts a flat assistant data shape only with a provable model source", () => {
	assert.deepEqual(
		collectTurnTexts([turnStart(8), assistantMessage(["flat reply"], false)], 8),
		{ userText: "", assistantText: "flat reply" },
		"flat assistant with source {kind:'model'} is collected",
	);
	assert.deepEqual(
		collectTurnTexts([turnStart(80), ev("assistant/message", { content: [{ type: "text", text: "no source" }] })], 80),
		{ userText: "", assistantText: "" },
		"flat assistant without source fails closed",
	);
});

test("applies redactFn to both texts and defaults to identity", () => {
	const events = [turnStart(9), userMessage(["token secret-value here"]), assistantMessage(["secret reply"])];
	const redacted = collectTurnTexts(events, 9, { redactFn: (value) => value.replaceAll("secret-value", "[REDACTED]") });
	assert.equal(redacted.userText, "token [REDACTED] here");
	assert.equal(redacted.assistantText, "secret reply", "the redactor only rewrites what it matches");

	assert.deepEqual(collectTurnTexts(events, 9), {
		userText: "token secret-value here",
		assistantText: "secret reply",
	}, "without opts redaction is the identity");
	const nonFunction = collectTurnTexts(events, 9, { redactFn: "not a function" });
	assert.equal(nonFunction.userText, "token secret-value here", "a non-function redactFn is ignored");
});

test("redacts before clipping", () => {
	const events = [turnStart(10), userMessage(["a".repeat(200)])];
	const clipped = collectTurnTexts(events, 10, { userMaxChars: 100, redactFn: (value) => value.slice(0, 50) });
	assert.equal(clipped.userText, "a".repeat(50), "the redactor output fits the budget, so no clip marker may appear");
});

test("clips over-budget text to head 35%, marker, tail", () => {
	const long = `${"h".repeat(60)}${"m".repeat(200)}${"t".repeat(60)}`;
	const events = [turnStart(11), userMessage([long]), assistantMessage([long])];
	const { userText, assistantText } = collectTurnTexts(events, 11, { userMaxChars: 100, assistantMaxChars: 200 });
	for (const [label, clipped, maxChars] of [["userText", userText, 100], ["assistantText", assistantText, 200]]) {
		const head = Math.floor(maxChars * 0.35);
		const tail = maxChars - head - "[...clipped...]".length - 2;
		assert.equal(clipped.length, maxChars, `${label} respects the budget`);
		assert.ok(clipped.startsWith(long.slice(0, head)), `${label} keeps the head`);
		assert.ok(clipped.endsWith(long.slice(-tail)), `${label} keeps the tail`);
		assert.ok(clipped.includes("\n[...clipped...]\n"), `${label} carries the clip marker`);
	}
});

test("leaves text untouched within the budget and without budgets", () => {
	const exact = "e".repeat(100);
	const long = "x".repeat(500);
	const events = [turnStart(12), userMessage([exact, long]), assistantMessage([long])];
	const joined = `${exact}\n${long}`;

	const bounded = collectTurnTexts(events, 12, { userMaxChars: 250, assistantMaxChars: 1000 });
	assert.equal(bounded.assistantText, long, "assistantText within budget is untouched");
	assert.equal(bounded.userText.length, 250, "userText clips against the joined total, not per part");
	assert.ok(bounded.userText.startsWith(exact.slice(0, 80)), "userText keeps its head");
	assert.ok(bounded.userText.endsWith("x".repeat(40)), "userText keeps the tail");
	assert.ok(bounded.userText.includes("\n[...clipped...]\n"), "userText carries the clip marker");

	assert.deepEqual(collectTurnTexts(events, 12), { userText: joined, assistantText: long }, "no opts means no clipping");
});
