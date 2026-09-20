/**
 * Shared remote-directory listing for the directory-picker browse backend and
 * the `/dsw` browse channel. One implementation of the level walk (SFTP
 * readdir, symlink follow, name-ascending bounded window, abort-aware probing)
 * and of the remote-home resolution that both surfaces used to duplicate.
 * @module dsh-workspace-enhancement/listing
 */
import type { SshTransport } from './transport.ts';
/** One wire row of a remote listing. */
export interface RemoteListingEntry {
    name: string;
    path: string;
    hidden: boolean;
}
/** One remote listing level. */
export interface RemoteListing {
    path: string;
    home: string;
    crumbs: RemoteListingEntry[];
    entries: RemoteListingEntry[];
    truncated: boolean;
}
/** The thrown value as an Error (wire/abort reasons may be anything). */
export declare function asError(reason: unknown): Error;
/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. SFTP reads are not retractable, so the operation itself keeps
 * running against a channel the caller then abandons — its late settlement
 * is swallowed here so an abandoned read cannot surface as an unhandled
 * rejection.
 * @param operation - the in-flight step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export declare function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
/**
 * Insert a streamed candidate into the name-ascending bounded window,
 * evicting the name-largest candidate when the window exceeds `keep`.
 * Memory over an arbitrarily large level stays O(keep).
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export declare function boundedInsert<T extends {
    name: string;
}>(window: T[], candidate: T, keep: number): boolean;
/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target.
 * @param target - the listed directory.
 * @param dirnameOf - path dirname function (posix or win32).
 * @param basenameOf - path basename function (posix or win32).
 */
export declare function ancestryCrumbs(target: string, dirnameOf: (path: string) => string, basenameOf: (path: string) => string): RemoteListingEntry[];
/**
 * The remote host account's home directory: the login environment's HOME, else
 * the transport's default remote cwd. A transport whose chain cannot be opened
 * (connect/auth failure) surfaces its error instead of masquerading as a
 * working home — the old catch-all fell back to the spec cwd, so `browse.home`
 * answered `ok: true {path:'/root'}` even when the connection was dead. Once
 * the chain is up, an unreadable environment (env probe failed, HOME unset) is
 * the one case that still falls back to the configured cwd.
 * @param ssh - the transport backing the listing.
 * @param signal - caller lifetime.
 * @returns the remote home path.
 */
export declare function remoteHome(ssh: SshTransport, signal?: AbortSignal): Promise<string>;
/**
 * List one remote level over a transport's shared SFTP channel: directories
 * only (symlinks to directories followed), name-ascending, bounded at `limit`
 * rows with `truncated` flagging a cut, abort-aware.
 * @param ssh - the transport backing the listing.
 * @param target - absolute POSIX directory to list.
 * @param limit - complete-result bound for one level.
 * @param opts - caller lifetime and optional pre-resolved home.
 * @returns the level's listing with ancestry.
 */
export declare function listRemoteLevel(ssh: SshTransport, target: string, limit: number, opts?: {
    signal?: AbortSignal | undefined;
    home?: string;
}): Promise<RemoteListing>;
