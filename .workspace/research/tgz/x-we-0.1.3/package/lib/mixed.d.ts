/**
 * Mixed execution-world providers for the `subprocess` and `fs` capability
 * seams: ONE service implementation for each seam routes every call by its
 * working directory / target key.
 *
 * - remote world — `ssh://<id>/<path>`, the `dsw-routes/<id>/…` placeholder
 *   tree, and the legacy `dsh-ssh-routes/<id>/…` tree (a session created from
 *   the remote workspace flow carries one of these as its header cwd) — runs
 *   over the registry-owned SSH transport ({@link SshSubprocessEngine} /
 *   {@link SshFileSystemEngine}).
 * - local world — everything else, including an absent cwd — delegates to the
 *   LOCAL provider implementation re-imported from the seam packages
 *   (`LocalSubprocessRuntime`, `SandboxedFileSystem`).
 *
 * This is the R4-I2 engine-routing fix: the model-facing tools
 * (`tool-bash`/`tool-pwsh`/`tool-fs`) stay bound to `ctx.subprocess`/
 * `ctx.fs`/`ctx.shell` exactly as shipped, and the routing happens inside the
 * services, so a remote workspace session executes its commands and file
 * operations on the server while a local session keeps today's local
 * behavior (including the sandbox fences).
 * @module dsh-workspace-enhancement/mixed
 */
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs';
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import type { SshSubprocessEngine } from './subprocess.ts';
import type { SshFileSystemEngine } from './filesystem.ts';
import type { SideWorkspaceItem } from './session-workspaces.ts';
/**
 * R5: the side-workspace face the mixed providers gate against — the store's
 * `match(path)` (longest owning root) plus the permission leaves only.
 */
export interface SideWorkspaceFace {
    match(path: string): SideWorkspaceItem | undefined;
}
/** The two execution worlds a mixed provider can route one call to. */
export type ExecutionWorld = 'remote' | 'local';
/** The minimal subprocess surface both branches implement. */
export interface SubprocessBranch {
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
}
/**
 * Pure routing decision (exported for tests): a cwd resolves onto the remote
 * world exactly when it names a remote route — `ssh://`, the current
 * `dsw-routes` placeholder tree, or the legacy `dsh-ssh-routes` tree — OR,
 * on a Windows host, when it is a POSIX-absolute path a local Windows
 * working directory cannot represent (its only sources are remote routes and
 * remote workspace values, which the tool layer passes through verbatim).
 * Everything else — drive/UNC paths, relative paths, and most importantly an
 * ABSENT cwd — stays local (any other default would silently send ordinary
 * local sessions over SSH, the exact defect R4-I2 fixes).
 * @param cwd - the caller-supplied working directory.
 * @param platform - host platform override (tests); defaults to the process.
 */
export declare function worldOfCwd(cwd: string | undefined, platform?: NodeJS.Platform): ExecutionWorld;
/**
 * Rewrite one argv vector for the REMOTE world: a Windows-style absolute
 * argv[0] (`C:\…\rg.exe`, `\\server\share\…`) cannot exist on a POSIX host —
 * the only honest remote interpretation is its bare command name (with the
 * `.exe` suffix dropped), resolved by the remote PATH. Bare names and POSIX
 * absolute paths pass through unchanged; the rest of the argv is untouched
 * (the callers' own path arguments are the tools' responsibility).
 */
export declare function remoteArgvOf(argv: readonly (string | undefined)[]): (string | undefined)[];
/**
 * The routing decision for one filesystem target: a target key of the form
 * `ssh://<id>/<path>` is remote; any other key (a local realpath) is local.
 */
export declare function worldOfTargetKey(targetKey: string): ExecutionWorld;
/**
 * Mixed subprocess provider: `spawn`/`spawnTerminal` route on the spec's cwd.
 * `resolveExecutable` is inherently world-less (no cwd parameter) and stays
 * LOCAL — the in-process consumers are host diagnostic tools; the bash/pwsh
 * executors never call it (they spawn `bash`/`pwsh` directly).
 */
export declare class MixedSubprocessRuntime implements SubprocessBranch {
    private readonly local;
    private readonly remote;
    private readonly sides?;
    constructor(local: SubprocessBranch, remote: SshSubprocessEngine, sides?: (() => SideWorkspaceFace | undefined) | undefined);
    /** @inheritdoc — local world (see class doc: resolveExecutable is world-less). */
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    /** @inheritdoc */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    /** @inheritdoc */
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
}
/** The minimal filesystem surface both branches implement (the seam's 13 methods). */
export type FileSystemBranch = {
    /** The backend's default confinement mode, when it confines at all. */
    readonly sandboxMode?: unknown;
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    processPath(target: FsTarget): string;
    /**
     * Map an absolute HARNESS-HOST path into this branch's execution world, or
     * `undefined` when that world cannot read the host file (the seam method the
     * base `FileSystem` declares with an empty body). BUG-2: it was missing from
     * this contract, so `tsc` could not catch a branch that never implemented it.
     */
    processPathFromHostPath(hostPath: string): string | undefined;
    fileUrl(target: FsTarget): string;
    contains(parent: FsTarget, child: FsTarget): boolean;
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsWriteOutcome>;
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsEditOutcome>;
};
/**
 * Mixed filesystem provider: `resolve`/`lstat` route on the supplied cwd,
 * every target operation routes on the target key (`ssh://` = remote).
 * The sandbox mode fact is inherited from the LOCAL delegate (the sandboxed
 * backend reports the deployment default so the tool layer still advertises
 * escalation honestly); the per-call sandbox policy is forwarded to the local
 * delegate and dropped for remote targets — a write on the server can never
 * be fenced by the local sandbox.
 */
export declare class MixedFileSystem implements FileSystemBranch {
    private readonly local;
    private readonly remote;
    private readonly sides?;
    constructor(local: FileSystemBranch, remote: SshFileSystemEngine, sides?: (() => SideWorkspaceFace | undefined) | undefined);
    /** The deployment's confinement fact, as reported by the local backend. */
    get sandboxMode(): unknown;
    /** @inheritdoc */
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    /** @inheritdoc */
    processPath(target: FsTarget): string;
    /**
     * @inheritdoc
     *
     * BUG-2: unlike `processPath`/`fileUrl` there is NO target key to route on —
     * the argument is an absolute HARNESS-HOST path, and only the local world
     * shares the host filesystem. The remote world runs on another machine, so
     * `SshFileSystemEngine` can never read that host file and is deliberately NOT
     * consulted (returning a remote path here would fabricate a mapping that does
     * not exist); the local delegate owns the answer, including the "no mapping"
     * case (`LocalFileSystem`: `isAbsolute(hostPath) ? resolve(hostPath) :
     * undefined`, inherited by `SandboxedFileSystem`).
     */
    processPathFromHostPath(hostPath: string): string | undefined;
    /** @inheritdoc */
    fileUrl(target: FsTarget): string;
    /** @inheritdoc — targets from different worlds never contain one another. */
    contains(parent: FsTarget, child: FsTarget): boolean;
    /** @inheritdoc */
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    /** @inheritdoc */
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    /** @inheritdoc */
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    /** @inheritdoc */
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    /** @inheritdoc */
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /** @inheritdoc */
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    /** @inheritdoc — the per-call policy reaches the local backend only. */
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsWriteOutcome>;
    /** @inheritdoc — the per-call policy reaches the local backend only. */
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsEditOutcome>;
}
