/**
 * Per-session workspace facts shared by the prompt sections of BOTH halves of
 * the workspace surface: the `sw-remote` section (registered by `tools.ts`)
 * and the `tool:sw-exec` / `tool:bash` sections (registered by `exec-tools.ts`).
 *
 * Living in its own module keeps `tools.ts` → `exec-tools.ts` one-directional:
 * `exec-tools.ts` imports these helpers instead of importing `tools.ts` back
 * (a value-import cycle would be harmless at runtime — both modules only call
 * each other from function bodies — but it is a real dependency smell and it
 * makes bundler graphs harder to reason about).
 *
 * Injection-point choice (reconnaissance conclusion, R4/R5): a GLOBAL
 * `ctx.systemPrompt.section({ text: context => … })` plus a scope lookup.
 * `context.scope` IS the session's agent instance (`dsh-agent-loop`'s
 * `assembleContextFor` returns `{ agent, scope: agent }`; the per-session scope
 * key is minted by `ReactLoopAgent` via `createScope(loopCtx, this)`), so
 * `agent.session.header` exposes the only leaves needed here: `cwd` and `id`.
 * @module dsh-workspace-enhancement/session-remote-context
 */
import { remoteRouteFromCwd } from "./transport.js";
/**
 * Read the per-session workspace facts from one assembly context. Pure leaf
 * projection — no live Cordis object leaves this function, and a missing scope
 * carrier yields empty facts instead of throwing.
 * @param context - the assembly context handed to a `systemPrompt.section` text provider.
 * @param store - the side-workspace store accessor (absent → no attachments).
 */
export function sessionWorkspaceContextOf(context, store) {
    const agent = context.scope;
    const cwd = agent?.session?.header.cwd;
    const sessionId = agent?.session?.header.id;
    return {
        ...(cwd !== undefined ? { cwd } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        sides: sessionId !== undefined ? (store?.()?.listFor(sessionId) ?? []) : [],
    };
}
/**
 * REQ-I6 ②: is this session inside the REMOTE workspace world? True when the
 * session cwd routes to a machine (`ssh://<id>/…` or the placeholder tree) or
 * when at least one side workspace is attached. A local session with no
 * attachments is `false` — the remote-only prompt sections then inject nothing
 * (zero noise in a plain local conversation).
 * @param context - the assembly context of the session being assembled.
 * @param store - the side-workspace store accessor (absent → no attachments).
 */
export function hasRemoteWorkspaceContext(context, store) {
    const facts = sessionWorkspaceContextOf(context, store);
    if (facts.sides.length > 0)
        return true;
    return facts.cwd !== undefined && remoteRouteFromCwd(facts.cwd) !== null;
}
//# sourceMappingURL=session-remote-context.js.map