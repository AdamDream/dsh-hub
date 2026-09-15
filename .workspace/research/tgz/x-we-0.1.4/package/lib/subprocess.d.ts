/**
 * SSH Service Provider for the subprocess capability seam. Each handle starts
 * through the shared SSH connection and keeps its output spill files on the
 * local host (remote bytes already arrive over the channel).
 *
 * The engine half ({@link SshSubprocessEngine}) is a plain class that the
 * mixed provider (see mixed.ts) embeds as its remote branch; the service half
 * ({@link SshSubprocessRuntime}) is the standalone plugin form that mounts as
 * `ctx.subprocess` in pure-SSH deployments.
 * @module @deepseek-ai/dsh-subprocess-ssh
 */
import { Context } from '@deepseek-ai/cordis';
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import type { RemoteSpawnGate } from './remote-approval-gate.ts';
import type { RemoteSandboxFence, RemoteSandboxTerminalGuard } from './remote-sandbox-fence.ts';
/**
 * The SSH execution half of the subprocess capability (no service
 * registration): routes every call over the registry connection named by the
 * working directory.
 *
 * AUDIT-6 (ADR-0020): when a `gate` is supplied, every remote spawn passes it
 * BEFORE any SSH activity. `spawn` keeps its synchronous seam contract — the
 * question rides the handle's async startup (`SshSubprocessHandle` preflight)
 * — while `spawnTerminal` (async signature) awaits the gate up front. The gate
 * itself no-ops for machines without `remoteApproval` (default `'off'`), for
 * non-shell-shaped host-assembled argv, and for routes without a registry
 * machine (the aggregate `ctx.ssh` transport) — see ADR-0020 D1's honest
 * non-coverage list. Temporary (`sw_connect save:false`) ids no longer exist
 * (ADR-0021 §1/§5).
 *
 * REQ-I9 (ADR-0022): a second optional dep, the remote sandbox `fence`, rides
 * the SAME async startup as a later stage. `spawn` hands it to the handle as
 * `resolveArgv` while `runGate` keeps the **unwrapped** argv — the approval card
 * must preview the command the user actually wrote (ADR-0022 §2.2). A fence
 * that cannot prove the remote runner is usable throws, and the command is
 * never serialized, let alone sent (fail closed).
 *
 * The fence (and its terminal guard) is never ABSENT: when no dep is passed —
 * a bare subpath-row mount, `dsh-workspace-enhancement/subprocess`, which is a
 * documented first-class mount style — the engine resolves a context-derived
 * one lazily (`sandboxFence`). Every composition is therefore fenced, and an
 * explicitly passed dep still wins (no double-wrap on the aggregate path).
 */
export declare class SshSubprocessEngine {
    private readonly ctx;
    private readonly gate?;
    private readonly fence?;
    private readonly terminalGuard?;
    private readonly live;
    private readonly terminals;
    private readonly spillDir;
    /** Memoized context-derived fence (see {@link sandboxFence}). */
    private lazyFence;
    /** Memoized context-derived terminal guard (see {@link sandboxTerminalGuard}). */
    private lazyTerminalGuard;
    private disposing;
    constructor(ctx: Context, gate?: RemoteSpawnGate | undefined, fence?: RemoteSandboxFence | undefined, terminalGuard?: RemoteSandboxTerminalGuard | undefined);
    /**
     * Ask the AUDIT-6 approval gate for one route. Pure pass-through: the gate
     * decides coverage (machine mode, shell shape) and throws on denial.
     */
    private runGate;
    /**
     * The REQ-I9 fence for this engine. An explicitly injected dep always wins
     * (the aggregate row passes one, and tests substitute fakes); when there is
     * none, the fence is built **lazily from the context** and memoized — so
     * EVERY composition is fenced, including the documented subpath row
     * (`dsh-workspace-enhancement/subprocess`) that a deployment hand-mounts
     * without deps. Lazy construction is deliberate: `sshRegistry` may not be
     * mounted yet when a constructor runs, and the fence's deps resolve service
     * lookups at call time.
     */
    private sandboxFence;
    /**
     * The terminal twin of {@link sandboxFence} (same explicit-dep-wins rule).
     */
    private sandboxTerminalGuard;
    /**
     * The REQ-I9 terminal-refusal decision for one route: the message to raise,
     * or `undefined` when the route is unfenced. An explicitly injected guard
     * wins; otherwise the guard derived from the context decides (the machine's
     * `remoteSandbox`, read through the registry's secret-free views, exactly
     * like the gate). An unfenced machine and the local world stay as they were.
     */
    private terminalRefusal;
    /**
     * The aggregate SSH transport, resolved lazily through `ctx.get` — property
     * access (`this.ctx.ssh`) needs an inject mapping and throws from a plain
     * plugin fiber, while `ctx.get` reads the service store.
     */
    private ssh;
    /** Terminate every managed process/terminal and await quiescence (idempotent). */
    dispose(): Promise<void>;
    /** @inheritdoc (same as SubprocessRuntime.resolveExecutable, remote world). */
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    /** @inheritdoc (same semantics as SubprocessRuntime.spawn, remote world). */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    /** @inheritdoc (same semantics as SubprocessRuntime.spawnTerminal, remote world). */
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
}
/**
 * Standalone SSH command manager registered as `ctx.subprocess` — the
 * pure-SSH deployment form (also what the mixed provider's remote branch is
 * built from).
 *
 * AUDIT-6 (ADR-0020): an explicit `gate` wins (the aggregate row passes its
 * own); when a subpath deployment mounts this class bare, the constructor
 * attaches the SAME remote approval gate built from its own context — so every
 * deployment form fences gated machines' remote shell commands uniformly. The
 * AI auto-grant answerer is an aggregate-row feature (`plugin.ts` apply); a
 * bare subpath deployment asks and falls through to the deployment's human
 * answerer (fail closed), it just never auto-grants.
 *
 * REQ-I9 (ADR-0022): the `fence` / `terminalGuard` deps are optional and are
 * resolved from the context (lazily, memoized) when absent, so EVERY mount form
 * fences a machine whose `remoteSandbox` is set — the aggregate row passes both
 * explicitly; a hand-mounted subpath row gets the context-derived pair. With
 * both absent AND no registry machine in scope, an `'off'` machine still runs
 * exactly as before (identity argv, zero probes).
 */
export declare class SshSubprocessRuntime extends SubprocessRuntime {
    static inject: string[];
    private readonly engine;
    /** Create the SSH subprocess service and bind its disposal policy. */
    constructor(ctx: Context, gate?: RemoteSpawnGate, fence?: RemoteSandboxFence, terminalGuard?: RemoteSandboxTerminalGuard);
    /** @inheritdoc */
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    /** @inheritdoc */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    /** @inheritdoc */
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
}
export default SshSubprocessRuntime;
