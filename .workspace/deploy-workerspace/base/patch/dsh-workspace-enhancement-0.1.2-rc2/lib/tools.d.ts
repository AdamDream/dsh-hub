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
import type { SshRegistry } from './registry.ts';
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from './session-workspaces.ts';
/** The machine facts the prompt reads (leaf fields only, no live objects). */
export interface PromptMachineFace {
    username: string;
    host: string;
    workspace?: string;
}
/**
 * Minimal agent face read by the prompt probe: `dsh-agent-loop`'s
 * `ReactLoopAgent` (the per-session scope key) exposes `id` and `session`;
 * only these leaf fields are touched.
 */
export interface PromptAgentFace {
    readonly id: string;
    readonly session?: {
        readonly header: {
            readonly cwd?: string;
            readonly id?: string;
        };
    };
}
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
/** Render the one emphasis paragraph of the remote-workplace prompt (order 90). */
export declare function renderRemotePrompt(fact: RemotePromptFact, tr?: TranslateFn): string;
/** The permission fact one side workspace renders as. */
export interface SideWorkspacePromptFact {
    label: string;
    /** Display root: `ssh://<id>/<path>` for remote, absolute local path otherwise. */
    rootKey: string;
    /** `只读` | `读写` */
    fs: string;
    /** `开` | `关` */
    exec: string;
}
/** Pure prompt projection of one side workspace (leaf fields only). */
export declare function sideWorkspacePromptFact(item: SideWorkspaceItem, tr?: TranslateFn): SideWorkspacePromptFact;
/**
 * R5: render the attached side-workspace list for the per-session prompt.
 * Empty list → `''` (zero noise for sessions without attachments). The closing
 * sentence states the enforcement boundary honestly: the exec gate covers the
 * workspace world (spawn cwd / program path), not path text inside a command.
 */
export declare function renderSideWorkspaces(items: readonly SideWorkspaceItem[], tr?: TranslateFn): string;
/**
 * Compose the whole workspace prompt of one session: the R4 remote emphasis
 * (only when the cwd routes remote) plus the R5 side-workspace list (only when
 * attachments exist). Pure and synchronous; an empty result means zero
 * injection.
 */
export declare function composeWorkspacePrompt(cwd: string | undefined, machine: PromptMachineFace | undefined, sides: readonly SideWorkspaceItem[], dshBase?: string, tr?: TranslateFn): string;
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
/** Render the probe as three check lines plus one hint line (never autoload/install). */
export declare function renderRemoteEnvProbe(probe: RemoteEnvProbe, tr?: TranslateFn): string;
/**
 * Register the three sw_* tools plus the per-session workspace-context prompt
 * section on the given context. All side effects are effect-bound, so an
 * unloaded row removes every tool and the prompt section.
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor.
 * @param sides - the side-workspace store accessor (absent → no attachments).
 */
export declare function registerWorkspaceTools(ctx: Context, registry: () => SshRegistry, sides: () => SessionSideWorkspaceStore | undefined): void;
