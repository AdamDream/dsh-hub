/**
 * `sw_*` workspace tools and the per-session remote-context system-prompt
 * section of dsh-workspace-enhancement, riding the machine registry. Three
 * management tools only: status/connect/pick-workspace. The registry's own
 * `connections.*` RPC surface stays separate; tools are the model's control
 * plane and never enumerate the file/execution tools (those belong to the
 * seam engine).
 * @module dsh-workspace-enhancement/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import { type TranslateFn } from './locale/index.ts';
import type { SessionConnectionsFace } from './session-remote-context.ts';
import type { RemoteApprovalMode } from './remote-approval-gate.ts';
import type { RemoteSandboxMode } from './remote-sandbox.ts';
import type { SshRegistry } from './registry.ts';
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from './session-workspaces.ts';
/** The machine facts the prompt reads (leaf fields only, no live objects). */
export interface PromptMachineFace {
    username: string;
    host: string;
    workspace?: string;
    /** AUDIT-6 gate mode of the routed machine (absent ⇒ treat as `'off'`). */
    remoteApproval?: RemoteApprovalMode;
    /** REQ-I9 fence mode of the machine (absent ⇒ treat as `'off'`). */
    remoteSandbox?: RemoteSandboxMode;
}
/**
 * Minimal agent face read by the prompt probe: `dsh-agent-loop`'s
 * `ReactLoopAgent` (the per-session scope key) exposes `id` and `session`;
 * only these leaf fields are touched. Re-exported from
 * `session-remote-context.ts` (the shared home of the per-session prompt
 * facts, so `exec-tools.ts` needs no import back into this module).
 */
export type { PromptAgentFace } from './session-remote-context.ts';
/** The per-session remote-context fact the prompt renders. */
export interface RemotePromptFact {
    /** Registry connection id the session routes to. */
    connectionId: string;
    /** Absolute POSIX remote path the session works in (from the cwd route). */
    remotePath: string;
    /** `user@host` of the routed machine. */
    endpoint: string;
    /** Placeholder-tree root basename shown as the local routing alias. */
    placeholderRoot: string;
    /** The remote path the prompt shows: machine workspace when set, else the route path. */
    displayPath: string;
}
/**
 * R4: compose the per-session remote-context fact from a resolved cwd route
 * and the routed machine. Pure and synchronous; `route === null` (local
 * session) never reaches this helper — callers return `''` first.
 * @param cwd - the session's header cwd (any route spelling).
 * @param machine - the routed machine's leaves; `undefined` keeps `connectionId` as the endpoint label.
 * @param dshBase - DSH home override (tests); defaults to the environment.
 */
export declare function remotePromptFact(cwd: string | undefined, machine: PromptMachineFace | undefined, dshBase?: string): RemotePromptFact | null;
/**
 * Render the one emphasis paragraph of the remote-workplace prompt (order 90).
 * ENGLISH ONLY — model-facing copy never follows the UI language (ADR-0014).
 */
export declare function renderRemotePrompt(fact: RemotePromptFact): string;
/** The fact one side workspace renders as (English, model-facing). */
export interface SideWorkspacePromptFact {
    label: string;
    /** Display root: `ssh://<id>/<path>` for remote, absolute local path otherwise. */
    rootKey: string;
}
/** Pure prompt projection of one side workspace (leaf fields only). */
export declare function sideWorkspacePromptFact(item: SideWorkspaceItem): SideWorkspacePromptFact;
/**
 * R5 → REQ-I7: render the attached side-workspace list for the per-session
 * prompt. Empty list → `''` (zero noise for sessions without attachments).
 * Since REQ-I7 (ADR-0019) a side root is a thin declaration — the line shows
 * label + root only, no permission marks.
 * ENGLISH ONLY (ADR-0014).
 */
export declare function renderSideWorkspaces(items: readonly SideWorkspaceItem[]): string;
/**
 * REQ-I11: one connected machine as the prompt renders it (leaf fields only).
 * `reachable` is `null` when the fact carries no live probe result (the panel
 * turned the machine on without a ping): the prompt then claims nothing.
 */
export interface ConnectedMachineFact {
    id: string;
    endpoint: string;
    reachable?: boolean | null;
    /** REQ-I9: the machine's fence mode when it is not `off` (absent ⇒ no fence). */
    sandbox?: RemoteSandboxMode;
}
/** Pure prompt projection of one connected registry machine. */
export declare function connectedMachineFact(id: string, machine: PromptMachineFace | undefined): ConnectedMachineFact;
/**
 * REQ-I11 (ADR-0021 §2.8): render the per-session connected-machine list — the
 * model-facing statement of the session's coarse gate, so the model knows which
 * ids `sw_exec` accepts. Empty list → `''` (a session with no connections
 * injects nothing). ENGLISH ONLY (ADR-0014).
 * @param facts - one entry per connected machine, in connection order.
 */
export declare function renderConnectedMachines(facts: readonly ConnectedMachineFact[]): string;
/** Render the `sw_status` connected-machine line (ids + endpoint, or the none text). */
export declare function renderConnectedStatusLine(ids: readonly string[], machineOf: (id: string) => PromptMachineFace | undefined, tr: TranslateFn): string;
/**
 * REQ-I11 (ADR-0021 §2.8): the VOLATILE session-workspace state — the connected
 * machine list and the side-root list — rendered as ONE runtime-context
 * contribution. Both lists are re-evaluated per assembly, so a `sw_connect` call
 * or a panel toggle becomes visible to the model inside the same conversation
 * (a `section()` alone would only be re-read in the header prompt). Both empty →
 * `''`, which is how a local session with zero connections keeps zero injection.
 * ENGLISH ONLY (ADR-0014).
 * @param connected - one fact per connected machine, in connection order.
 * @param sides - the session's side roots (薄声明清单, REQ-I7).
 */
export declare function renderSessionWorkspaceContext(connected: readonly ConnectedMachineFact[], sides: readonly SideWorkspaceItem[]): string;
/**
 * Compose the STABLE framing of one session's workspace prompt: the R4 remote
 * emphasis (only when the cwd routes remote) plus the AUDIT-6 honesty sentences.
 * Pure and synchronous; an empty result means this session has no remote main
 * workspace. ENGLISH ONLY (ADR-0014).
 *
 * REQ-I11 (ADR-0021 §2.8): the VOLATILE lists (connected machines, side roots)
 * moved to the `dsw-session-workspace` runtime-context contribution
 * ({@link renderSessionWorkspaceContext}) — they must be re-read as durable
 * user-role snapshots inside the conversation, not frozen into the header
 * prompt. The optional `connected`/`sides` parameters stay for callers that want
 * the full single-shot composition (tests, tools), but the host registration
 * never renders the lists twice.
 *
 * AUDIT-6 (ADR-0020 D6): a remote-main-workspace session additionally always
 * carries the `remoteNoSandbox` honesty sentence, plus the `remoteGateActive`
 * expectation sentence exactly when the routed machine's approval gate is on.
 */
export declare function composeWorkspacePrompt(cwd: string | undefined, machine: PromptMachineFace | undefined, sides: readonly SideWorkspaceItem[], dshBase?: string, connected?: readonly ConnectedMachineFact[]): string;
/** The remote toolbox the R4 remote world needs (bash/pwsh for terminals, rg for glob/searches). */
export interface RemoteEnvProbe {
    bash: boolean;
    pwsh: boolean;
    rg: boolean;
}
/**
 * R4 ⑧⑨: probe the remote toolbox with one bounded `command -v` pass. A
 * missing shell explains a remote terminal failure ("command not found"),
 * and a missing `rg` is the one requirement of the model-facing glob/search
 * tools — the remote surface reports it honestly instead of silently
 * degrading (the mixed provider rewrites `rg.exe` → `rg`; a remote without
 * rg then fails with a clear 127).
 */
export declare function remoteEnvProbeCommand(): string;
/** Parse a `command -v` probe: stdout lines are the resolved paths of found tools. */
export declare function parseRemoteEnvProbe(output: string): RemoteEnvProbe;
/**
 * Render the probe as three check lines plus one hint line (never
 * autoload/install). ENGLISH ONLY — this is model-facing tool output
 * (ADR-0014); the heading and the missing-tool hint both come from the same
 * English source instead of the pre-ADR mixed zh/en pair.
 */
export declare function renderRemoteEnvProbe(probe: RemoteEnvProbe): string;
/**
 * Register the three sw_* tools plus the per-session workspace prompt
 * contributions on the given context. All side effects are effect-bound, so an
 * unloaded row removes every tool, section and runtime-context entry.
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor.
 * @param sides - the side-workspace store accessor (absent → no attachments).
 * @param connections - the connected-machine store accessor (absent → no session
 *   connections; the `sw_connect` tool then reports the missing store instead of
 *   silently pretending the session switched anything on).
 */
export declare function registerWorkspaceTools(ctx: Context, registry: () => SshRegistry, sides: () => SessionSideWorkspaceStore | undefined, connections: () => SessionConnectionsFace | undefined): void;
