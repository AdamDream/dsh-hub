/**
 * Route-aware SSH filesystem provider for the filesystem capability seam.
 * The aggregate `ctx.ssh` connection is the default transport; a cwd of the
 * form `ssh://<connectionId>/<path>` (or a target resolved from such a cwd)
 * routes every operation to that registry-owned connection.
 * @module @deepseek-ai/dsh-fs-ssh
 */
import type { Context } from '@deepseek-ai/cordis';
import { FileSystem, FsVersion } from '@deepseek-ai/dsh-fs';
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs';
/**
 * Route-aware remote filesystem backend. The engine half ({@link SshFileSystemEngine})
 * is a plain class the mixed provider embeds as its remote branch; the service
 * half ({@link SshFileSystem}) is the standalone plugin form that mounts as
 * `ctx.fs` in pure-SSH deployments.
 */
export declare class SshFileSystemEngine {
    private readonly ctx;
    private readonly locks;
    constructor(ctx: Context);
    private routeCwd;
    private routeTarget;
    private pathOf;
    private transportOf;
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    processPath(target: FsTarget): string;
    fileUrl(target: FsTarget): string;
    contains(parent: FsTarget, child: FsTarget): boolean;
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read one byte window `[offset, offset + length)` of a regular file — the
     * seam method the 0.1.5 line added to `FileSystem` (UPSTREAM-1). Semantics
     * mirror the upstream implementation exactly: an empty `length` is empty
     * without any I/O, a window starting at or past EOF is empty, a window that
     * runs past EOF comes back short, and the file is never buffered whole —
     * `start`/`end` bound the transfer to the window (ssh2's `end` is inclusive,
     * and a read at/past EOF simply ends the stream, so no `stat`-based clamping
     * is needed).
     */
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>;
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: ReturnType<typeof FsVersion>;
    }, signal?: AbortSignal): Promise<FsEditOutcome>;
    private withLock;
    /**
     * The aggregate SSH transport, resolved lazily through `ctx.get` — property
     * access (`this.ctx.ssh`) needs an inject mapping and throws from a plain
     * plugin fiber, while `ctx.get` reads the service store.
     */
    private ssh;
    private canonicalPath;
    private probe;
    private requireRegular;
    private readBytesRaw;
    private checkWriteIntent;
    private readForDiff;
    private readForEdit;
    private writeAtomic;
    private removeStaging;
}
/** R4 ⑦: whether a path names OUR random `.dsh-<uuid>.tmp` staging directory. */
export declare function isOwnStagingDirectory(directory: string): boolean;
/** R4 ⑦: the `mv -f` overwrite publication command for one random staging file. */
export declare function overwritePublicationCommand(temporary: string, target: string): string;
/** R4 ⑦: the recursive staging-directory cleanup command (the caller's own random dir). */
export declare function stagingCleanupCommand(directory: string): string;
/**
 * Standalone SSH filesystem provider registered as `ctx.fs` — the pure-SSH
 * deployment form (also the engine behind the mixed provider's remote branch).
 * An incoming per-call sandbox policy is deliberately dropped: a remote write
 * cannot be fenced by the LOCAL sandbox, and the tool layer's policy is
 * resolved against the session's local placeholder root.
 */
export declare class SshFileSystem extends FileSystem {
    static inject: string[];
    private readonly engine;
    constructor(ctx: Context);
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    processPath(target: FsTarget): string;
    fileUrl(target: FsTarget): string;
    contains(parent: FsTarget, child: FsTarget): boolean;
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Deliberately declared WITHOUT `override`: the pre-0.1.5 base class has no
     * `readByteRange`, and `override` on a member that the base does not declare
     * is TS4113 — the plugin must compile against BOTH families (UPSTREAM-1).
     */
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, _sandboxPolicy?: unknown): Promise<FsWriteOutcome>;
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, _sandboxPolicy?: unknown): Promise<FsEditOutcome>;
}
export default SshFileSystem;
