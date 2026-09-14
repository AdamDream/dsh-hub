import { collectTurnEvidence } from "./collector.js";
import { clipText, redactSensitive } from "./storage.js";
//#region lib/backfill.js
/**
 * `/taste backfill` support (backfill-design §3/§4): pure, side-effect-free
 * helpers that slice a session's completed historical turns, filter out
 * mislearnable turns, and pack the remaining turn texts into serial learner
 * blocks, each carrying a prior window for cross-block dedup. Imports only
 * the existing pure modules (collector, storage) — never lib/index.js — so
 * the module stays unit-testable without schemastery/home-paths.
 * @module lib/backfill
 */

/**
 * Design block character budget (§3.3); the driver injects
 * `min(BLOCK_MAX_CHARS, observer.maxInputChars ?? BLOCK_MAX_CHARS)` so a whole
 * block is never silently re-clipped by runLearner (audit issue #4).
 */
export const BLOCK_MAX_CHARS = 32_000;

/** Block turn ceiling; whichever limit hits first flushes the block (§3.3). */
export const BLOCK_MAX_TURNS = 4;

/** Per-turn collector budgets, mirroring the turn-stopping hook (index.js:76-77). */
const TURN_USER_MAX_CHARS = 8_000;
const TURN_ASSISTANT_MAX_CHARS = 12_000;

/** Prior-window bounds, mirroring index.js:80-81 (proposal §4). */
const PRIOR_WINDOW_LIMIT = 20;
const PRIOR_ENTRY_MAX_CHARS = 4_000;

/**
 * Parse the `/taste backfill [n]` argument (§2): empty means every completed
 * historical turn (`Infinity`), a positive decimal integer means the last n
 * turns; everything else — 0, negatives, non-integers — is rejected with a
 * usage reason.
 * @param {string|undefined} argument - text after the `backfill` verb.
 * @returns {{ok: true, n: number}|{ok: false, reason: string}} parse result.
 */
export function parseBackfillArg(argument) {
	const text = String(argument ?? "").trim();
	if (text.length === 0) return { ok: true, n: Infinity };
	if (!/^\d+$/.test(text)) return { ok: false, reason: "n 必须是正整数" };
	const n = Number.parseInt(text, 10);
	if (n === 0) return { ok: false, reason: "n 至少为 1" };
	return { ok: true, n };
}

/**
 * Slice the historical events into completed turns (§3.1). Unlike the
 * collector's open-ended `turnSlice` (which serves the still-open current
 * turn), the history is cut at every `turn/start` boundary into bounded
 * segments, and only segments containing a `turn/end` survive — the open tail
 * turn belongs to the turn-stopping hook and would be learned twice if
 * backfill took it too. Array order is authoritative; a `turn/start` whose
 * turn number is missing or non-finite contributes no segment.
 * @param {Array|undefined} events - session event array.
 * @returns {Array<{turn: number, events: Array}>} completed turns, chronological.
 */
export function splitHistoricalTurns(events) {
	if (!Array.isArray(events)) return [];
	const starts = [];
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		if (event?.type === "turn/start" && Number.isFinite(event.data?.turn)) starts.push(index);
	}
	const turns = [];
	for (let position = 0; position < starts.length; position += 1) {
		const start = starts[position];
		const end = position + 1 < starts.length ? starts[position + 1] : events.length;
		const slice = events.slice(start, end);
		if (!slice.some((event) => event?.type === "turn/end")) continue; // open tail turn
		turns.push({ turn: events[start].data.turn, events: slice });
	}
	return turns;
}

/**
 * Whether one turn's user text must never enter a backfill NEW section (§4.2):
 * empty turns (pure command turns — slash commands are log-only and leave no
 * user/message — and plugin-snapshot-only turns) are dropped, and so is a
 * single-line `/taste …` message, the defensive shape of a pasted or
 * unrecognized slash command. A multi-line message that merely opens with
 * `/taste ` is a normal discussion of the command and is kept for the learner
 * prompt's one-off-task filter, so a real preference on a later line survives
 * (audit issue #5).
 * @param {string} userText - the turn's joined user text.
 * @returns {boolean} whether the turn is dropped.
 */
function isCommandTurn(userText) {
	const t = (userText ?? "").trim();
	if (t.length === 0) return true; // 空轮（纯命令轮 / 全 plugin snapshot 轮）→ 剔除
	// 审计 issue #5：仅当整段为"单条 /taste 命令形态"（trim 后无换行、无第二行）才剔除
	return /^\/taste(?:\s|$)/i.test(t) && !/[\r\n]/.test(t);
}

/**
 * Join a message content array's non-blank text blocks.
 * @param {Array|undefined} content - message content blocks.
 * @returns {string} the joined visible text.
 */
function joinVisibleText(content) {
	// 与 lib/index.js:309-331 逐字对齐，改一处需同步另一处
	const parts = [];
	if (!Array.isArray(content)) return parts.join("\n");
	for (const block of content) {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.trim()) continue;
		parts.push(block.text);
	}
	return parts.join("\n");
}

/**
 * The backfill prior window of one block: visible user/assistant texts
 * strictly before the block's first `turn/start`, most recent `limit` entries,
 * each redacted and clipped. Blocks run chronologically, so block k's window
 * is exactly the tail of blocks 1..k-1 — the learner sees what earlier passes
 * already mined and will not re-record it.
 * @param {Array|undefined} events - full session event array.
 * @param {number} turn - the block's first turn number.
 * @returns {Array<{role: string, content: Array<{type: string, text: string}>}>} prior entries.
 */
function collectPriorWindow(events, turn) {
	// 与 lib/index.js:309-331 逐字对齐，改一处需同步另一处
	if (!Array.isArray(events) || typeof turn !== "number" || !Number.isFinite(turn)) return [];
	let boundary = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]?.type === "turn/start" && events[index].data?.turn === turn) {
			boundary = index;
			break;
		}
	}
	const history = boundary < 0 ? events : events.slice(0, boundary);
	const entries = [];
	for (const event of history) {
		const evidence = collectTurnEvidence([{ type: "turn/start", data: { turn: -1 } }, event], -1, { userMaxChars: PRIOR_ENTRY_MAX_CHARS, assistantMaxChars: PRIOR_ENTRY_MAX_CHARS, redactFn: redactSensitive });
		for (const item of [...evidence.user, ...evidence.assistant]) entries.push({ role: item.role, provenance: item.provenance, content: [{ type: "text", text: item.text }] });
	}
	return entries.slice(-PRIOR_WINDOW_LIMIT);
}

/**
 * Pack the history into serial learner blocks (§3): each block carries the
 * merged NEW messages of up to `blockMaxTurns` learnable turns or
 * `blockMaxChars` characters of turn text (first limit wins; a single turn is
 * never split and may occupy an over-budget block alone), plus the prior
 * window taken before the block's first turn. Per-turn texts reuse the
 * collector with the turn-stopping budgets (redact first, then clip).
 * @param {Array|undefined} events - session event array.
 * @param {object} [options] - packing options.
 * @param {number} [options.n=Infinity] - backfill only the last n completed turns.
 * @param {(text: string) => string} [options.redactFn=redactSensitive] - per-turn redactor.
 * @param {number} [options.blockMaxChars=BLOCK_MAX_CHARS] - block character budget.
 * @param {number} [options.blockMaxTurns=BLOCK_MAX_TURNS] - block turn ceiling.
 * @returns {Array<{newMessages: Array, priorWindow: Array}>} serial blocks; empty when nothing is learnable.
 */
export function buildBackfillBlocks(events, { n = Infinity, redactFn = redactSensitive, blockMaxChars = BLOCK_MAX_CHARS, blockMaxTurns = BLOCK_MAX_TURNS } = {}) {
	let turns = splitHistoricalTurns(events);
	if (n !== Infinity) {
		const limit = Number(n);
		if (Number.isFinite(limit) && limit > 0) turns = turns.slice(-Math.floor(limit));
	}
	const blocks = [];
	let current = null;
	const flush = () => {
		if (current) blocks.push({ newMessages: current.newMessages, priorWindow: collectPriorWindow(events, current.firstTurn) });
		current = null;
	};
	for (const { turn, events: slice } of turns) {
		const evidence = collectTurnEvidence(slice, turn, { userMaxChars: TURN_USER_MAX_CHARS, assistantMaxChars: TURN_ASSISTANT_MAX_CHARS, redactFn });
		const userText = evidence.user.map((item) => item.text).join("\n");
		if (isCommandTurn(userText)) continue;
		const assistantText = evidence.assistant.map((item) => item.text).join("\n"); // 防误学：空轮/命令轮剔除（§4.2）
		const chars = userText.length + assistantText.length;
		if (current && (current.chars + chars > blockMaxChars || current.turnCount >= blockMaxTurns)) flush();
		if (!current) current = { newMessages: [], chars: 0, turnCount: 0, firstTurn: turn };
		current.newMessages.push(...evidence.user.map((item) => ({ role: item.role, provenance: item.provenance, content: [{ type: "text", text: item.text }] })));
		if (assistantText) current.newMessages.push(...evidence.assistant.map((item) => ({ role: item.role, provenance: item.provenance, content: [{ type: "text", text: item.text }] })));
		current.chars += chars;
		current.turnCount += 1;
	}
	flush();
	return blocks;
}
//#endregion
