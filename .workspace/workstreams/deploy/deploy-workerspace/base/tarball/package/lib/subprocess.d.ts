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
/**
 * The SSH execution half of the subprocess capability (no service
 * registration): routes every call over the registry connection named by the
 * working directory.
 */
export declare class SshSubprocessEngine {
    private readonly ctx;
    private readonly live;
    private readonly terminals;
    private readonly spillDir;
    private disposing;
    constructor(ctx: Context);
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
 */
export declare class SshSubprocessRuntime extends SubprocessRuntime {
    static inject: string[];
    private readonly engine;
    /** Create the SSH subprocess service and bind its disposal policy. */
    constructor(ctx: Context);
    /** @inheritdoc */
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    /** @inheritdoc */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    /** @inheritdoc */
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
}
export default SshSubprocessRuntime;
