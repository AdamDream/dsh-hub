import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { finalAssistantOutput } from "@deepseek-ai/dsh-subagent";
import { clipText } from "./storage.js";
import { createTasteTools } from "./learner-tools.js";
//#region lib/learner.js
/**
 * The taste learner: the system prompt, the learner-input builder, and the
 * `agents.create` driver that runs one one-shot learner agent against the
 * triggering conversation. Ported from pi-taste `learner.ts`
 * (`LEARNER_SYSTEM_PROMPT` and `buildLeanerInput`); the run loop itself is
 * delegated to the DSH agent loop instead of being reimplemented.
 * @module lib/learner
 */

/** Cap on the previously-analyzed window handed to the learner (proposal §4). */
const PRIOR_WINDOW_LIMIT = 20;

/** Fallback structure text when no taste files exist (pi-taste wording). */
const EMPTY_TASTE_STRUCTURE = "(empty - no taste files yet)";

/**
 * The learner's system prompt, ported 1:1 from pi-taste
 * `LEARNER_SYSTEM_PROMPT` with the host product name adapted to DSH and the
 * tool list adjusted for the scoped (`global`/`project`) tool signatures.
 * Only NEW messages are learnable; the prior window exists to resolve
 * references; existing preferences are never re-recorded; a turn with
 * nothing durable to record answers "no changes" without calling tools.
 */
export const LEARNER_PROMPT = `You are the taste-learning agent for DeepSeek Harness (DSH). Review the NEW messages and the user's current taste files, then record DURABLE, generalizable preferences the user revealed — coding style, tooling, workflow, and communication preferences — not one-off task details.

Learn ONLY from the NEW messages. The previously analyzed conversation was already mined by earlier passes — it is provided so you can resolve references, never to be re-learned. Do NOT re-record a preference that already exists in the taste files, and do NOT raise or lower an existing learning's confidence unless the NEW messages themselves contain fresh evidence for it. Seeing the same preference again in the previously analyzed context is not evidence.

Use the tools to update taste files. Every tool takes a scope, "global" (user-wide) or "project" (current repository), and a path that MUST be either "taste.md" (the root file) or "{category}/taste.md" (a single category folder) — never any other name or nesting:
- write_taste_file to create/replace a file.
- edit_taste_file to amend an existing file.
- read_taste_file to inspect a file before editing.

Record each learning as a markdown bullet ending in a confidence score, e.g.
  - Prefers tabs over spaces. Confidence: 0.9
Only record clear, repeated, or explicitly-stated preferences. Prefer amending existing files over creating near-duplicates. When the new messages reveal nothing durable, make no tool calls and reply "no changes".`;

/**
 * Keep only visible user/assistant text messages, mirroring pi-taste's
 * `visible()`: role-checked, text-block-only, blank parts dropped. The caller
 * pre-filters automation and redacts, so meta-flag checks are unnecessary.
 * @param {unknown} messages - candidate message list.
 * @returns {Array<{role: string, content: Array<{type: string, text: string}>}>} visible messages.
 */
function visibleMessages(messages) {
	const visible = [];
	if (!Array.isArray(messages)) return visible;
	for (const message of messages) {
		if (message?.role !== "user" && message?.role !== "assistant") continue;
		const content = (Array.isArray(message.content) ? message.content : [])
			.filter((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
			.map((part) => ({ type: "text", text: part.text }));
		if (content.length === 0) continue;
		visible.push({ role: message.role, content });
	}
	return visible;
}

/**
 * Build the learner's user message, ported from pi-taste `buildLeanerInput`:
 * the current taste file tree, the previously analyzed conversation (context
 * only, capped at the last 20 visible messages), and the NEW messages to
 * learn from.
 * @param {object} input - learner input parts.
 * @param {string} input.tasteTree - rendered taste file tree.
 * @param {Array<{role: string, content: Array<{type: string, text: string}>}>} input.newMessages - this turn's visible user/assistant texts.
 * @param {Array<{role: string, content: Array<{type: string, text: string}>}>} [input.priorWindow] - earlier visible messages for reference resolution.
 * @returns {string} the learner input text.
 */
export function buildLearnerInput({ tasteTree, newMessages, priorWindow } = {}) {
	const tree = typeof tasteTree === "string" && tasteTree.trim() ? tasteTree : EMPTY_TASTE_STRUCTURE;
	const previous = visibleMessages(priorWindow).slice(-PRIOR_WINDOW_LIMIT);
	const current = visibleMessages(newMessages);
	return [
		`Current taste structure:\n${tree}\n\n`,
		`Previously analyzed conversation (context only — already processed in earlier passes, do NOT learn from it again):\n${
			previous.length > 0 ? JSON.stringify(previous, null, 2) : "(none)"
		}\n\n`,
		`NEW messages to analyze (learn ONLY from these):\n${JSON.stringify(current, null, 2)}`,
	].join("");
}

/**
 * Run one one-shot learner agent (proposal §3): create it inside the parent's
 * initiator boundary with the three taste tools and the learner prompt
 * section registered in the child scope, deliver the input as one plugin
 * snapshot user message, wait for it to go idle, and read its final assistant
 * output. The handle is disposed on every path (R3/R5).
 *
 * Session metadata note: pi-taste's `meta.origin: "taste-learner"` is not
 * representable here — `dsh-session`'s header validator rejects any origin
 * other than "subagent" — so the learner is marked `origin: "subagent"` with
 * `parentSession`, and the caller's in-flight session set (R5) provides the
 * taste-learner identity.
 *
 * @param {object} args - run arguments.
 * @param {object} args.agents - DSH agents service (`withInitiator`/`create`).
 * @param {object} args.parentAgent - triggering agent; its session id becomes
 *   `parentSession`, and `inherit` model routing reads its options.
 * @param {string} args.input - learner input text from {@link buildLearnerInput}.
 * @param {object} [args.config] - taste configuration (§8 shape).
 * @param {() => string} args.resolveGlobalDir - absolute global taste directory.
 * @param {() => string} args.resolveProjectDir - absolute project taste directory (throws when the session has no project scope).
 * @param {AbortSignal} [args.signal] - plugin teardown signal (R3).
 * @param {string} [args.sessionId] - learner session id; defaults to a fresh UUID. The caller passes one so its in-flight set (R5) can identify the learner before creation.
 * @returns {Promise<{output: Array<{type: string, text: string}>|undefined}>} the final assistant output blocks.
 */
export async function runLearner({
	agents,
	parentAgent,
	input,
	config,
	resolveGlobalDir,
	resolveProjectDir,
	signal,
	sessionId = randomUUID(),
}) {
	if (typeof agents?.create !== "function" || typeof agents?.withInitiator !== "function") {
		throw new TypeError("runLearner: agents service with create() and withInitiator() is required");
	}
	if (typeof parentAgent?.session?.id !== "string") {
		throw new TypeError("runLearner: parentAgent with session.id is required");
	}
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new TypeError("runLearner: input must be a non-empty string");
	}
	const observer = config?.observer ?? {};
	// Model routing (§4/§10.5): M0 ships `inherit` only — the learner follows
	// the triggering agent's provider/model. `custom` routing is a P1 item;
	// observer.modelMode/provider/model stay accepted config fields, unused here.
	const agentOptions = { provider: parentAgent.options?.provider, model: parentAgent.options?.model };
	// The observer's input budget bounds the whole learner message; an absent
	// or unusable budget leaves the input unclipped (storage clipText fails
	// closed to "" for one, which would silently drop the input).
	const maxInputChars = Number(observer.maxInputChars);
	const text = Number.isFinite(maxInputChars) && maxInputChars > 0 ? clipText(input, maxInputChars) : input;
	// Cancellation (R3): the plugin teardown signal is fused with the
	// observer's timeout so a hung learner turn cannot outlive its budget.
	const timeoutMs = Number(observer.timeoutMs);
	const runSignal =
		signal === undefined
			? Number.isFinite(timeoutMs) && timeoutMs > 0
				? AbortSignal.timeout(timeoutMs)
				: undefined
			: Number.isFinite(timeoutMs) && timeoutMs > 0
				? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
				: signal;
	let handle;
	try {
		handle = await agents.withInitiator(parentAgent, () =>
			agents.create({
				sessionId,
				meta: { parentSession: parentAgent.session.id, origin: "subagent" },
				agentOptions,
				signal: runSignal,
				setup(childCtx) {
					childCtx.tools.register(...createTasteTools({ resolveGlobalDir, resolveProjectDir, log: console.warn }));
					childCtx.systemPrompt.section({ name: "taste-learner", order: 190, text: LEARNER_PROMPT });
				},
			}),
		);
		handle.agent.followup(
			createUserMessage({
				content: [{ type: "text", text }],
				source: { kind: "plugin", plugin: "taste", form: "snapshot" },
			}),
		);
		await handle.agent.whenIdle();
		return { output: finalAssistantOutput(handle.agent.session.events) };
	} finally {
		try {
			await handle?.dispose?.();
		} catch (error) {
			console.warn(`taste learner: dispose failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
//#endregion
