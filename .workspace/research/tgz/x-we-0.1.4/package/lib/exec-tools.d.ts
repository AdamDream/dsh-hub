/**
 * S1+S2 of drafts/sw-exec-requirement.md: the `sw_exec` cross-server execution
 * tool and the win32-host `bash` seam tool.
 *
 * - `sw_exec`: bash/pwsh-tool-aligned command execution ON A NAMED SERVER — a
 *   registry machine id (`c1`, …) that is CONNECTED TO THIS SESSION
 *   (REQ-I11 / ADR-0021: the stored `sessionConnections` set ∪ the implicit
 *   main machine) — with a `server` parameter plus an optional workdir. The
 *   target server's OS is probed once per connection (`uname -s`, falling
 *   back to `cmd /c ver`, then `unknown`) and selects the shell:
 *   `bash -c` (POSIX / unknown) or `pwsh -Command` (win32). Execution goes
 *   through the MIXED subprocess provider with an `ssh://<id>/<path>` cwd, so
 *   the machine routing is the same one every other spawn uses. Non-zero exits
 *   are reported, not errored.
 * - win32 bash: on a Windows host (no local bash, the official bash executor
 *   is not composed) a `bash` tool is registered that runs the session's
 *   REMOTE-Linux command through the same mixed provider; a local session gets
 *   a clear error instead of silently degrading.
 *
 * Everything testable is a pure function or takes a small faceted env
 * (`SwExecEnv`) so unit tests never touch the network.
 * @module dsh-workspace-enhancement/exec-tools
 */
import type { Context } from '@deepseek-ai/cordis';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import type { SshRegistry } from './registry.ts';
import type { SshConnectionSpec } from './connection.ts';
import type { ExecOutcome } from './ssh-core.ts';
import { type TranslateFn } from './locale/index.ts';
import type { SessionConnectionsFace } from './session-remote-context.ts';
import type { SessionSideWorkspaceStore } from './session-workspaces.ts';
/** The operating-system fact a probed server gets. */
export type RemoteOs = 'linux' | 'win32' | 'unknown';
/** Foreground run budget applied when the model omits `timeoutMs` (executor default, dsh-bash-local config). */
export declare const SW_EXEC_DEFAULT_TIMEOUT_MS = 120000;
/** Upper bound for a per-call `timeoutMs` override (dsh-bash-local maxTimeoutMs). */
export declare const SW_EXEC_MAX_TIMEOUT_MS = 600000;
/** Kill-escalation grace of the spawn spec (SIGTERM → SIGKILL / drain bound) — NOT the run timeout. */
export declare const SW_EXEC_KILL_GRACE_MS = 60000;
/** In-memory output cap per stream (tail kept; overflow spilled). */
export declare const SW_EXEC_OUTPUT_MAX_BYTES: number;
/** Whole-stream spill cap per stream (path reported to the model). */
export declare const SW_EXEC_OUTPUT_SPILL_MAX_BYTES: number;
/** Background job kind used with `ctx.jobs` (opaque namespace, no validation). */
export declare const SW_EXEC_JOB_KIND = "sw-exec";
/** Minimal connection face: registry connections and temp connections satisfy it. */
export interface SwExecConnection {
    readonly id: string;
    readonly endpoint: string;
    readonly spec: SshConnectionSpec;
    exec(command: string, opts?: {
        signal?: AbortSignal;
    }): Promise<ExecOutcome>;
}
/** The server-selection face `swExecCore` needs (registry + temp + config fallback). */
export interface SwExecEnv {
    get(id: string): SwExecConnection | undefined;
    getActive(): {
        spec: SshConnectionSpec;
        connection: SwExecConnection;
    } | null;
    listMachines(): {
        machines: readonly {
            id: string;
        }[];
    };
    /** The mixed subprocess provider: routes by the spec's cwd (`ssh://…` → machine). */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
}
/** The canonical foreground value of sw_exec (bash-aligned + server/os facts). */
export interface SwExecForeground {
    kind: 'foreground';
    server: string;
    endpoint: string;
    os: RemoteOs;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    aborted: boolean;
    timeoutMs: number;
    stdout: SwExecStream;
    stderr: SwExecStream;
}
/** One collected stream: tail text plus truncation facts. */
export interface SwExecStream {
    text: string;
    truncated: boolean;
    spillPath?: string;
}
/** The canonical background value of sw_exec (job id returned immediately). */
export interface SwExecBackground {
    kind: 'background';
    jobId: string;
    server: string;
    endpoint: string;
}
/** The canonical foreground value of the win32 bash tool (bash-tool-aligned). */
export interface BashForeground {
    kind: 'foreground';
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    aborted: boolean;
    timeoutMs: number;
    stdout: SwExecStream;
    stderr: SwExecStream;
}
/** The canonical background value of the win32 bash tool. */
export interface BashBackground {
    kind: 'background';
    jobId: string;
}
/** The parameter face of the sw_exec tool. */
export interface SwExecArgs {
    command: string;
    description: string;
    timeoutMs?: number;
    workdir?: string;
    server?: string;
    run_in_background?: boolean;
}
/** The parameter face of the win32 bash tool (official bash parameters, no escalation). */
export interface Win32BashArgs {
    command: string;
    description: string;
    timeoutMs?: number;
    workdir?: string;
    run_in_background?: boolean;
}
/**
 * Classify a `uname -s` result (sync despite the Async suffix — the name is
 * fixed by the S1 spec). `null` means "no usable POSIX answer": the caller
 * falls through to the Windows probe. Git-Bash/MSYS/Cygwin report a Windows
 * kernel here and must NOT get bash semantics; every other non-empty POSIX
 * family name reads as `linux` (bash -c is the honest best effort).
 */
export declare function parseUnameAsync(exitCode: number | null, output: string): RemoteOs | null;
/** Classify a `cmd /c ver` result: exit 0 confirms Windows. */
export declare function parseVerProbe(exitCode: number | null, output: string): 'win32' | null;
/** The one process-local OS cache: keyed by id, invalidated when the connection rebuilds. */
export interface RemoteOsCache {
    get(connection: SwExecConnection): RemoteOs | undefined;
    set(connection: SwExecConnection, os: RemoteOs): void;
}
/** Create a process-local OS cache (per-registration instance). */
export declare function createRemoteOsCache(): RemoteOsCache;
/**
 * Probe the target's OS with one `uname -s` round-trip, falling back to
 * `cmd /c ver` and then `unknown` (S1 semantics). Probe exit-code failures
 * fall through; thrown errors (a broken/disposed connection) propagate as
 * infrastructure failures instead of silently reporting `unknown`.
 * @param connection - the live connection.
 * @param signal - optional abort bound for both probes.
 * @param cache - the process-local OS cache.
 */
export declare function resolveRemoteOs(connection: SwExecConnection, signal: AbortSignal | undefined, cache: RemoteOsCache): Promise<RemoteOs>;
/** Build the shell argv for one OS: POSIX/unknown → `bash -c`, win32 → `pwsh -Command`. */
export declare function buildShellArgv(os: RemoteOs, command: string): string[];
/** The machine's primary remote directory: `workspace` wins, then `cwd`, then `/`. */
export declare function defaultRemoteDir(spec: SshConnectionSpec): string;
/**
 * Normalize the model-supplied workdir for sw_exec (S1 workdir column):
 * - undefined → `undefined` (the core defaults to the target server's primary
 *   workspace);
 * - `ssh://<id>/<path>` → verbatim — it names a machine and a directory;
 * - POSIX absolute → verbatim (interpreted on the `server` machine);
 * - relative → resolved against the session workspace (official bash
 *   semantics; a relative workdir REQUIRES a remote session cwd).
 * Windows drive/UNC spellings are rejected: the remote world is POSIX.
 */
export declare function normalizeSwExecWorkdir(workdir: string | undefined, sessionRoute: {
    id: string;
    path: string;
} | null, tr?: TranslateFn): string | undefined;
/**
 * Resolve the final spawn working directory and its effective machine:
 * `ssh://<server>/<dir>` for default/absolute workdirs, the explicit
 * `ssh://<id>/<path>` verbatim when one is given (the ID names the machine —
 * OS detection and the report header follow it, since the mixed provider
 * routes the spawn by this exact cwd anyway).
 */
export declare function resolveSwExecCwd(workdir: string | undefined, serverId: string, machineDefault: string, tr?: TranslateFn): {
    cwd: string;
    machineId: string;
};
/**
 * Resolve the target server: a registry id, then the active machine for an
 * omitted id. Unknown ids fail with the known-id list (S1: unknown server
 * error). Temporary ids are gone with `sw_connect save:false` (ADR-0021 §1/§5),
 * and the per-session connection gate runs BEFORE this resolver — by the time
 * it is called, the id is either connected or the implicit main machine.
 * v1 has no local server: the local world belongs to bash/pwsh.
 */
export declare function resolveSwExecServer(env: SwExecEnv, serverId: string | undefined, tr?: TranslateFn): {
    connection: SwExecConnection;
    spec: SshConnectionSpec;
};
/**
 * The registry slice a reachability probe needs: one live connection per
 * registry id. `SshRegistry` satisfies it structurally (its `get` returns a
 * live `SshConnection`), which keeps the probe testable without a registry.
 */
export interface ProbeRegistryFace {
    get(id: string): {
        exec(command: string, opts?: {
            signal?: AbortSignal;
        }): Promise<ExecOutcome>;
    } | undefined;
}
/** One machine's reachability outcome (plain data — no live objects). */
export interface MachineProbeResult {
    id: string;
    /** Whether `echo ok` came back with exit code 0 inside the budget. */
    ok: boolean;
    latencyMs: number;
    /** Failure reason (model/user-visible); `''` when reachable. */
    detail: string;
}
/** Reachability budget of one machine (mirrors the registry's PROBE_TIMEOUT_MS). */
export declare const MACHINE_PROBE_TIMEOUT_MS = 8000;
/**
 * Probe ONE registry machine with the `echo ok` contract every `sw_*`
 * connectivity check uses, inside a hard budget. A failed command, a thrown
 * error (dead/poisoned chain), an unknown id and a timeout are all reported as
 * `ok: false` + detail — the caller decides whether that is fatal.
 * @param registry - the registry slice (live connection lookup).
 * @param id - registry machine id.
 * @param budgetMs - probe budget (defaults to {@link MACHINE_PROBE_TIMEOUT_MS}).
 */
export declare function probeMachine(registry: ProbeRegistryFace, id: string, budgetMs?: number): Promise<MachineProbeResult>;
/** Probe several machines, preserving the requested order (sequential, bounded each). */
export declare function probeMachines(registry: ProbeRegistryFace, ids: readonly string[], budgetMs?: number): Promise<MachineProbeResult[]>;
/**
 * The per-session connection facts `sw_exec` gates on (ADR-0021 §2.4/§2.5):
 * the STORED connected set plus the implicit main machine the session's header
 * cwd routes to. The implicit machine is a read-time union — it is never
 * written back, so a remote session does not manufacture persisted state just
 * by running a command.
 */
export interface ConnectedMachines {
    /** The session id the gate ran for (`null` ⇒ unresolvable ⇒ fail closed). */
    sessionId: string | null;
    /** Stored ∪ implicit, in that order, deduped. */
    ids: string[];
    /** The main-workspace machine id when the cwd routes remote. */
    implicit: string | null;
}
/**
 * Merge the session's stored connections with the implicit main machine
 * (ADR-0021 §2.4). Pure and synchronous: the cwd route comes from the header,
 * the stored set from the `sessionConnections` service.
 * @param sessionCwd - `session.header.cwd` (any route spelling), if any.
 * @param sessionId - `session.header.id`, if the carrier exposes it.
 * @param listFor - the store's `listFor` (absent ⇒ no stored connections).
 * @param registry - the registry slice used to validate the implicit id.
 */
export declare function connectedMachinesOf(sessionCwd: string | undefined, sessionId: string | undefined, listFor: ((sessionId: string) => readonly string[]) | undefined, registry: ProbeRegistryFace): ConnectedMachines;
/**
 * REQ-I11 / ADR-0021 §2.5 — the `sw_exec` server gate. The tool stays GLOBALLY
 * registered (ADR-0021 §3 rejects every scoped/preset alternative for lack of
 * a per-session scope handle), so the refusal lives here:
 *
 * 1. an unresolvable session id → fail closed (A1 unknown #8: never fail open);
 * 2. no connection at all → "call `sw_connect` first";
 * 3. a KNOWN registry machine that is not connected to this session → the
 *    connected ids are listed;
 * 4. an id the registry does not know → the registry's own "unknown server"
 *    error with the known-id list (unchanged wording).
 *
 * The caller has already resolved `requested` (explicit `server`, else the
 * implicit main machine), so an untouched explicit id is checked by name.
 * @param connected - the merged per-session facts.
 * @param requested - the machine the call names, or `undefined` when it names none.
 * @param registered - every registry machine id (the known-id list).
 * @param tr - translator for the refusal messages (host language).
 */
export declare function requireConnectedServer(connected: ConnectedMachines, requested: string | undefined, registered: readonly string[], tr?: TranslateFn): void;
/** A caller-signal + timeout deadline merged into ONE spawn abort signal. */
export interface SwExecDeadline {
    signal: AbortSignal;
    timedOut(): boolean;
    dispose(): void;
}
/**
 * Merge the tool-call abort signal with an optional run timeout (the spawn
 * spec's `signal` starts the terminate escalation on either). Timers are
 * cleared on dispose; a caller abort propagates its reason.
 */
export declare function makeSwExecDeadline(timeoutMs: number | undefined, caller: AbortSignal | undefined): SwExecDeadline;
/**
 * Resolve a per-call `timeoutMs` the way the official bash executor does
 * (`dsh-bash-local` resolve): an omitted value gets the executor default
 * (120s), an override above the cap is clamped (600s). Validation rejects
 * non-positive/non-finite values before this runs.
 */
export declare function resolveSwExecTimeout(timeoutMs: number | undefined): number;
/**
 * The canonical tool-call-aborted error (official bash tool contract):
 * a `HarnessError` with code `ABORTED` and `name: 'AbortError'` — the tools
 * pipeline recognizes HarnessError errorInfo, so a plain Error would lose the
 * ABORTED classification.
 */
export declare function toolAbortError(): HarnessError;
/**
 * The sw_exec core: resolve the server, probe its OS, build the shell argv,
 * and run the command through the mixed provider with an `ssh://` cwd.
 * Unit tests and E2E scripts call this directly with a faceted env; the tool
 * wraps it.
 * @param env - server lookup + spawner (the tool builds it from the registry
 *   and `ctx.subprocess`).
 * @param server - registry machine id; `undefined` → the active machine.
 * @param command - the command text to execute (validated non-empty).
 * @param workdir - already-normalized: `ssh://` verbatim, a POSIX absolute
 *   path (interpreted on `server`), or `undefined` for the server's primary
 *   workspace. Relative values are rejected here (the tool layer resolves
 *   them against the session cwd).
 * @param timeoutMs - optional run bound overrides; omitted applies the
 *   executor default ({@link SW_EXEC_DEFAULT_TIMEOUT_MS}) and an override is
 *   clamped at {@link SW_EXEC_MAX_TIMEOUT_MS} (official bash executor
 *   semantics). Background jobs carry no timeout.
 * @param signal - the tool-call cancellation signal.
 * @param osCache - the process-local OS cache (per-registration instance).
 * @returns the canonical foreground result (non-zero exits are reported, not errored).
 */
export declare function swExecCore(env: SwExecEnv, server: string | undefined, command: string, workdir: string | undefined, timeoutMs: number | undefined, signal: AbortSignal | undefined, osCache: RemoteOsCache, tr?: TranslateFn): Promise<SwExecForeground>;
/** The minimal `ctx.jobs` face (dsh-jobs `start` contract, verified on disk). */
export interface BackgroundJobs {
    start(spec: {
        kind: string;
        label: string;
        owner?: unknown;
        run(): {
            cancel(reason?: string): void;
            done: Promise<unknown>;
            readOutput?(): string;
        };
    }): string;
}
/** Render the shared body: stdout, marked stderr, then timeout/signal/exit markers. */
export declare function renderStreamBody(parts: {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    timeoutMs: number;
    stdout: SwExecStream;
    stderr: SwExecStream;
}, tr?: TranslateFn): string;
/** sw_exec foreground render: the honest `server/OS` header line first. */
export declare function renderSwExecForeground(value: SwExecForeground, tr?: TranslateFn): string;
/** S1 arg validation, mirroring the official bash tool's validateBashArgs. */
export declare function validateSwExecArgs(args: SwExecArgs, tr?: TranslateFn): void;
/** The win32 bash tool mirrors the official bash validation (no escalation args). */
export declare function validateBashToolArgs(args: Win32BashArgs, tr?: TranslateFn): void;
/**
 * Register the `sw_exec` tool plus its `tool:sw-exec` prompt section (S1).
 * The tool is registered on every platform — the server makes it remote-only.
 * All side effects are effect-bound (unmount removes the tool + section).
 * @param ctx - the mounting context.
 * @param registry - the machine registry accessor (server id lookup).
 * @param opts - `enableRunInBackground` mirrors the official bash flag
 *   (`?? true`); background requires `ctx.jobs` and errors honestly when absent.
 *   `sides` is the side-workspace store accessor and `connections` the
 *   connected-machine store accessor: together with the session cwd route they
 *   decide (a) whether the model-facing section is injected at all
 *   (REQ-I6 ② + REQ-I11: a local session with no attachments AND no connected
 *   machine gets zero prompt text) and (b) which servers this session may
 *   execute on (ADR-0021 §2.5).
 */
export declare function registerSwExec(ctx: Context, registry: () => SshRegistry, opts?: {
    enableRunInBackground?: boolean;
    sides?: () => SessionSideWorkspaceStore | undefined;
    connections?: () => SessionConnectionsFace | undefined;
}): void;
/**
 * Resolve the win32 bash tool's cwd with the official resolveWorkdir
 * semantics: an explicit absolute path wins, a relative one is
 * session-cwd-relative, an explicit `ssh://` route is used verbatim (a route
 * is not a host path), and an omitted workdir is the session cwd.
 */
export declare function resolveWin32BashWorkdir(modelWorkdir: string | undefined, sessionCwd: string | undefined): string | undefined;
/**
 * Register the win32 bash seam tool plus its `tool:bash` prompt section (S2).
 * NO-OP on POSIX hosts — the official bash tool owns the `bash` name and the
 * `tool:bash` section there. On Windows (official bash executor absent) the
 * tool is registered; at execution time `worldOfCwd` decides honestly: a
 * remote (Linux) world runs `bash -c` on the server through the mixed
 * provider, a local Windows session errors instead of silently degrading.
 * @param ctx - the mounting context.
 * @param registry - reserved: routing is cwd-based; the accessor keeps the
 *   calling convention uniform with `registerSwExec`.
 * @param options - `platform` injectable for tests; `enableRunInBackground`
 *   mirrors the official bash flag (`?? true`); `sides` is the side-workspace
 *   store accessor used by the REQ-I6 ② injection decision.
 */
export declare function registerWin32Bash(ctx: Context, registry: () => SshRegistry, options?: {
    platform?: NodeJS.Platform;
    enableRunInBackground?: boolean;
    sides?: () => SessionSideWorkspaceStore | undefined;
    /**
     * REQ-I11: the session connection store, so this tool applies the SAME gate
     * `sw_exec` does. This is the plugin's OWN exec face: without the gate it
     * would be the one exec surface a model could use to reach a registered but
     * unconnected machine (the official `bash`/`pwsh` bypass is documented as
     * structural; ours need not be).
     */
    connections?: () => SessionConnectionsFace | undefined;
}): void;
