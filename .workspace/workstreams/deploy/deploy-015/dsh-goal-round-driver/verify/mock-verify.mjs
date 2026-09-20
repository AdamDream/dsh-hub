/**
 * Mock-level behavior verification for 方案 A (per-agent pending-subagent count)
 * in dsh-goal-round-driver/lib/index.js.
 *
 * Builds a minimal fake `ctx` (events bus + agents/goals/sessions services) that
 * matches the surface the driver uses, loads the PATCHED driver, and simulates
 * the full goal-round + subagent lifecycle:
 *   S1: no pending subagents -> normal goal round drive (baseline, unchanged)
 *   S2: subagent/start -> idle -> readyToDrive must NOT drive
 *   S4: narrow window: end emitted while notice still in flight -> competingQueued
 *       gate blocks drive until the notice is consumed (idle clears it)
 *   S3: second subagent round trip (start blocks, end + notice -> resumes)
 *   S5: two concurrent subagents -> only the last end + notice releases
 *   S6: round-limit still blocks via existing path (regression)
 *
 * Sequencing discipline: the driver's `agent/status idle` handler pauses the
 * goal when an attempt is still queued/claimed at idle (existing behavior with
 * attempt-attribution), so every injected round must be claimed+admitted before
 * the next idle, exactly as the real loop does.
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
import { apply } from "./lib/index.js";

const results = [];
function check(name, ok, detail = "") {
	results.push({ name, ok });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const tick = () => new Promise((r) => setImmediate(r));

function makeCtx() {
	const listeners = new Map();
	const agents = new Map();
	const goals = new Map();
	const calls = { followup: [], blocked: [] };
	let nextInboxId = 1;

	const agent = {
		id: "agent-1",
		session: { id: "agent-1" },
		status: "idle",
		inbox: { nextStep: [], nextTurn: [] },
		followup(message) {
			calls.followup.push({ agentId: this.id, message });
			this.inbox.nextTurn.push(message);
			emit("agent/inbox/inserted", { agent: this, message });
		},
		inject(message) {
			this.inbox.nextStep.push(message);
			emit("agent/inbox/inserted", { agent: this, message });
		},
		steer(message) {
			this.inbox.nextStep.push(message);
			emit("agent/inbox/inserted", { agent: this, message });
		},
		cancel() {},
		whenIdle: async () => {}
	};
	agents.set(agent.id, agent);

	const ctx = {
		fiber: { state: 2 },
		logger: { warn: (...a) => console.log("  [warn]", ...a) },
		agents: {
			get: (id) => agents.get(id),
			list: () => [...agents.values()],
			withoutInitiator: (fn) => fn(),
			currentInitiator: () => void 0
		},
		goals: {
			get: (a) => goals.get(a),
			disarm(a) { const g = goals.get(a); if (g) g.activation = "disarmed"; },
			pause(a) { const g = goals.get(a); if (g) g.phase = "paused"; },
			block(a, ref, info) { calls.blocked.push({ agentId: a.id, ref, info }); }
		},
		sessions: { flush: async () => {} },
		on: (name, fn) => {
			let set = listeners.get(name);
			if (!set) { set = new Set(); listeners.set(name, set); }
			set.add(fn);
			return () => set.delete(fn);
		},
		effect(fn) {
			const gen = fn();
			const first = gen.next();
			return first.value ?? (() => {});
		},
		emit(name, ...args) {
			const set = listeners.get(name);
			if (!set) return;
			for (const fn of [...set]) fn(...args);
		},
		emitScoped(name, info, parent) {
			const set = listeners.get(name);
			if (!set) return;
			for (const fn of [...set]) {
				const carrier = scopeTarget(ctx, parent);
				fn.call(carrier, info);
			}
		}
	};
	return { ctx, agent, calls, goals, emit: ctx.emit.bind(ctx), emitScoped: ctx.emitScoped.bind(ctx), nextInboxId: () => nextInboxId++ };
}

function installGoal(goals, agent, overrides = {}) {
	const view = {
		id: "goal-1",
		revision: 1,
		phase: "active",
		activation: "armed",
		roundsStarted: 0,
		maxGoalRounds: 5,
		...overrides
	};
	goals.set(agent, view);
	return view;
}

const harness = makeCtx();
const { ctx, agent, calls, goals, emit, emitScoped } = harness;

apply(ctx);
installGoal(goals, agent);

/** Inject a notice message into the parent inbox as the loop would deliver it. */
function deliverNotice(childId) {
	const notice = {
		id: `notice-${harness.nextInboxId()}`,
		content: [{ type: "text", text: "subagent settled" }],
		source: { kind: "subagent-settled", form: "notice", senderSessionId: childId }
	};
	agent.inbox.nextTurn.push(notice);
	emit("agent/inbox/inserted", { agent, message: notice });
	return notice;
}
function claimNotice(notice) {
	const idx = agent.inbox.nextTurn.indexOf(notice);
	if (idx >= 0) agent.inbox.nextTurn.splice(idx, 1);
	emit("agent/inbox/claimed", { agent, message: notice });
	emit("session/event", agent.session, { type: "user/message", data: { id: notice.id } });
}
/** Simulate the loop claiming + admitting one queued goal-round message. */
function claimAdmitRound(message) {
	// real loop removes the claimed message from the inbox queue
	const idx = agent.inbox.nextTurn.indexOf(message);
	if (idx >= 0) agent.inbox.nextTurn.splice(idx, 1);
	emit("agent/inbox/claimed", { agent, message });
	emit("session/event", agent.session, { type: "user/message", data: { id: message.id } });
}
function lastGoalRound() {
	for (let i = calls.followup.length - 1; i >= 0; i--) {
		const m = calls.followup[i].message;
		if (m.source?.kind === "goal") return m;
	}
	return void 0;
}
/** Simulate the loop running one turn and returning to idle. */
function runTurnIdle() {
	emit("agent/status", { agent, status: "running" });
	emit("agent/status", { agent, status: "idle" });
}
/** Drive from idle once; return true if a new round was injected. */
async function idleDrive() {
	const before = calls.followup.length;
	emit("agent/status", { agent, status: "idle" });
	await tick();
	return calls.followup.length > before;
}

// ---- S1 baseline: no pending subagents, normal drive ----
emit("agent/created", { agent });
const s1a = await idleDrive();
check("S1 baseline: idle+armed goal injects round 1", s1a, `followups=${calls.followup.length}`);
// complete round 1 (claim+admit+run+idle) -> idle handler drives round 2
claimAdmitRound(lastGoalRound());
runTurnIdle();
await tick();
check("S1 follow-up: completed round then idle drives round 2", calls.followup.length === 2, `followups=${calls.followup.length}`);
// round 2 was injected; claim+admit it so the goal stays active
claimAdmitRound(lastGoalRound());

// ---- S2: subagent/start -> idle must NOT drive ----
emitScoped("subagent/start", { runId: "run-1", provider: "mock", id: "sub-1", local: true }, agent);
const s2 = await idleDrive();
check("S2: pending subagent blocks goal round injection", !s2, `followups=${calls.followup.length} (must stay 2)`);

// ---- S4 narrow window: end emitted, notice NOT yet in inbox ----
// my subagent/end handler calls requestDrive(state) itself; the competingQueued
// gate must hold that drive() back until the notice lands (no idle event in
// between, as in the real loop).
emitScoped("subagent/end", { runId: "run-1", provider: "mock", id: "sub-1", stopReason: "completed" }, agent);
await tick();
check("S4: narrow window -- end without consumed notice still blocks drive", calls.followup.length === 2, `followups=${calls.followup.length} (must stay 2)`);
// notice lands, agent claims+consumes it, returns idle -> gate clears -> drive resumes
const notice1 = deliverNotice("sub-1");
claimNotice(notice1);
runTurnIdle();
await tick();
check("S4: notice consumed -> drive resumes", calls.followup.length === 3, `followups=${calls.followup.length} (must be 3)`);
// claim+admit round 3
claimAdmitRound(lastGoalRound());

// ---- S3: second subagent round trip ----
emitScoped("subagent/start", { runId: "run-2", provider: "mock", id: "sub-2", local: true }, agent);
const s3a = await idleDrive();
check("S3a: second pending subagent blocks drive", !s3a, `followups=${calls.followup.length}`);
emitScoped("subagent/end", { runId: "run-2", provider: "mock", id: "sub-2", stopReason: "completed" }, agent);
await tick();
check("S3b: second subagent end (notice in flight) blocks drive", calls.followup.length === 3, `followups=${calls.followup.length}`);
const notice2 = deliverNotice("sub-2");
claimNotice(notice2);
runTurnIdle();
await tick();
check("S3c: second notice consumed -> drive resumes", calls.followup.length === 4, `followups=${calls.followup.length} (must be 4)`);
claimAdmitRound(lastGoalRound());

// ---- S5: two concurrent subagents; only the LAST end + notice releases ----
emitScoped("subagent/start", { runId: "run-3", provider: "mock", id: "sub-3", local: true }, agent);
emitScoped("subagent/start", { runId: "run-4", provider: "mock", id: "sub-4", local: true }, agent);
const s5a = await idleDrive();
check("S5a: two pending subagents block drive", !s5a, `followups=${calls.followup.length}`);
emitScoped("subagent/end", { runId: "run-3", provider: "mock", id: "sub-3", stopReason: "completed" }, agent);
await tick();
check("S5b: first of two ends still blocks drive", calls.followup.length === 4, `followups=${calls.followup.length} (must stay 4)`);
const notice3 = deliverNotice("sub-3");
claimNotice(notice3);
runTurnIdle();
await tick();
check("S5c: first notice consumed, second subagent still pending -> still blocked", calls.followup.length === 4, `followups=${calls.followup.length} (must stay 4)`);
emitScoped("subagent/end", { runId: "run-4", provider: "mock", id: "sub-4", stopReason: "completed" }, agent);
const notice4 = deliverNotice("sub-4");
claimNotice(notice4);
runTurnIdle();
await tick();
check("S5d: all subagents settled+consumed -> drive resumes", calls.followup.length === 5, `followups=${calls.followup.length} (must be 5)`);
claimAdmitRound(lastGoalRound());

// ---- S6: round-limit still blocks via existing path ----
installGoal(goals, agent, { roundsStarted: 5, maxGoalRounds: 5 });
const s6 = await idleDrive();
check("S6: round-limit still blocks via existing path", !s6 && calls.blocked.some((b) => b.info?.code === "round-limit"), `blocked=${JSON.stringify(calls.blocked.map((b) => b.info?.code))}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
process.exit(failed.length === 0 ? 0 : 1);
