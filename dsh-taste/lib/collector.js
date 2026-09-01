/**
 * Turn-scoped visible-text collection for the taste learner.
 *
 * Pure functions over session event arrays: this module imports nothing,
 * never touches the filesystem, and never throws on malformed event shapes —
 * malformed events and blocks are skipped (audit R1 sunk to the unit layer).
 * Clipping mirrors storage's `clipText` semantics inline because the
 * collector must not import storage.
 * @module lib/collector
 */
const CLIP_MARKER = "[...clipped...]";
/** The two newlines around the marker are part of the reserved clip budget. */
const CLIP_RESERVE = CLIP_MARKER.length + 2;
/** Below this budget no marker fits; clipping degrades to plain truncation. */
const CLIP_MIN_CHARS = 64;

/**
 * Whether one session event is a user message the learner may read.
 * Plugin-authored user messages (e.g. runtime-context snapshots) are the only
 * excluded source kind; an event without a source is not a plugin message.
 * @param event - session event candidate (element of `session.events`).
 * @returns true when the event is a learnable user message.
 */
export function isLearnableUserEvent(event) {
	return event?.type === "user/message" && event.data?.source?.kind !== "plugin";
}

/**
 * Collect the visible user and assistant text of one turn.
 *
 * The slice runs from after the last `turn/start` event with
 * `data.turn === turn` to the end of the array; a missing `turn/end` is
 * expected because the current turn is still open when collection runs. Every
 * learnable user message contributes its text parts and every assistant
 * message contributes its `type: "text"` blocks; parts join with "\n". Each
 * joined text is redacted with `opts.redactFn` (caller-injected, defaults to
 * identity) and only then clipped to its character budget.
 *
 * @param events - session event array (elements carry `.type`/`.data`/`.seq`).
 * @param turn - turn number to slice; a non-finite value yields empty texts.
 * @param opts - `{ userMaxChars, assistantMaxChars, redactFn }`; an invalid
 *   budget leaves the text unclipped, and `redactFn` exceptions propagate.
 * @returns `{ userText, assistantText }`, both `""` when nothing survived.
 */
export function collectTurnTexts(events, turn, opts = {}) {
	const slice = turnSlice(events, turn);
	return {
		userText: finishText(joinParts(userTextParts(slice)), opts.redactFn, opts.userMaxChars),
		assistantText: finishText(joinParts(assistantTextParts(slice)), opts.redactFn, opts.assistantMaxChars),
	};
}

/** Events after the last `turn/start` for `turn`, through the array end. */
function turnSlice(events, turn) {
	if (!Array.isArray(events) || typeof turn !== "number" || !Number.isFinite(turn)) return [];
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "turn/start" && event.data?.turn === turn) return events.slice(index + 1);
	}
	return [];
}

/** Non-blank `type: "text"` string parts of one content array; the rest is skipped. */
function textParts(content) {
	const parts = [];
	if (!Array.isArray(content)) return parts;
	for (const block of content) {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.trim()) continue;
		parts.push(block.text);
	}
	return parts;
}

/** Text parts of the slice's learnable user messages (DSH shape: data is the message). */
function userTextParts(slice) {
	const parts = [];
	for (const event of slice) {
		if (isLearnableUserEvent(event)) parts.push(...textParts(event.data?.content));
	}
	return parts;
}

/**
 * Text parts of the slice's assistant messages. DSH nests the message at
 * `data.message`; a flat `data.content` is tolerated against shape drift.
 */
function assistantTextParts(slice) {
	const parts = [];
	for (const event of slice) {
		if (event?.type !== "assistant/message") continue;
		const data = event.data;
		if (Array.isArray(data?.message?.content)) parts.push(...textParts(data.message.content));
		else parts.push(...textParts(data?.content));
	}
	return parts;
}

function joinParts(parts) {
	return parts.join("\n");
}

/** Redact first, then clip; a non-string redactor output fails closed to "". */
function finishText(text, redactFn, maxChars) {
	const redacted = typeof redactFn === "function" ? redactFn(text) : text;
	return clipText(typeof redacted === "string" ? redacted : "", maxChars);
}

/**
 * Keep the 35% head and the tail of over-budget text with a marker between,
 * never exceeding `maxChars`. An invalid budget (non-finite or negative)
 * leaves the text unclipped.
 * @param value - text to bound.
 * @param maxChars - character budget.
 * @returns the bounded text.
 */
function clipText(value, maxChars) {
	if (typeof maxChars !== "number" || !Number.isFinite(maxChars) || maxChars < 0) return value;
	if (value.length <= maxChars) return value;
	if (maxChars < CLIP_MIN_CHARS) return value.slice(0, Math.floor(maxChars));
	const head = Math.floor(maxChars * 0.35);
	const tail = maxChars - head - CLIP_RESERVE;
	return `${value.slice(0, head)}\n${CLIP_MARKER}\n${value.slice(-tail)}`;
}
