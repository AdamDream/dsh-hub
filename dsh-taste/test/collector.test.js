import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTurnTexts, isLearnableUserEvent } from "../lib/collector.js";

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

function assistantMessage(parts, nested = true) {
	const message = { id: "a", role: "assistant", source: { kind: "model", provider: "deepseek", model: "m" }, content: parts.map(text) };
	return ev("assistant/message", nested ? { message } : { content: message.content });
}

function turnStart(turn) {
	return ev("turn/start", { turn });
}

function turnEnd(turn) {
	return ev("turn/end", { turn });
}

test("isLearnableUserEvent accepts real user messages and rejects plugin sources and junk", () => {
	assert.equal(isLearnableUserEvent(userMessage(["hello"])), true);
	assert.equal(isLearnableUserEvent(userMessage(["snapshot"], "plugin")), false, "plugin-kind user messages are excluded");
	assert.equal(isLearnableUserEvent(ev("user/message", { role: "user", content: [] })), true, "missing source is not a plugin source");
	assert.equal(isLearnableUserEvent(assistantMessage(["hi"])), false);
	assert.equal(isLearnableUserEvent(turnStart(1)), false);
	assert.equal(isLearnableUserEvent(null), false);
	assert.equal(isLearnableUserEvent(undefined), false);
	assert.equal(isLearnableUserEvent(42), false);
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

test("joins multiple messages and multiple text parts with newlines", () => {
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
		ev("assistant/message", { message: { role: "assistant", content: [null, { type: "text", text: "ok-assistant" }] } }),
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

test("accepts a flat assistant data shape (content directly on data)", () => {
	const events = [turnStart(8), assistantMessage(["flat reply"], false)];
	assert.deepEqual(collectTurnTexts(events, 8), { userText: "", assistantText: "flat reply" });
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
