/**
 * R5 → REQ-I7: per-session attached side-workspace state — plugin-owned records
 * of extra roots (local directories or remote machine directories) a session
 * may operate on. A side root is a THIN DECLARATION (id/kind/rootKey/label):
 * the per-root permission pair (fs r|rw, exec on|off) was retired with
 * REQ-I7 (ADR-0019) — after the remote MAIN workspace matured, any absolute
 * path on the same machine was already reachable from the session, so the
 * gates only ever restricted, and they were advisory with known bypasses.
 *
 * The core session model is 1 session → 1 immutable header cwd, so the
 * attachments and the routing index all live HERE: one state file
 * (`<dsh home>/dsw-session-workspaces.json`) with two maps —
 *
 * - `roots`: rootKey → record (rootKey = canonical key: a `resolve()`d local
 *   absolute path, or `ssh://<machineId>/<posix path>`); ONE record per root;
 * - `sessions`: sessionId → ordered rootKey list (the attachment account;
 *   display and prompt order, no core involvement).
 *
 * Legacy state files that still carry `fs` / `exec` fields on root records
 * load cleanly: the two fields are ignored on read and dropped on the next
 * persist (no error, no migration step).
 *
 * Consumers: the mixed filesystem provider (path→root ROUTING for
 * resolve/lstat), the per-session prompt section (the attached list), and the
 * `/dsw` web endpoints (CRUD).
 * @module dsh-workspace-enhancement/session-workspaces
 */
import { Context, Service } from '@deepseek-ai/cordis';
/** The two attachment kinds a side workspace can be. */
export type SideWorkspaceKind = 'local' | 'remote';
/** One side workspace record (canonical rootKey + display label). */
export interface SideWorkspaceItem {
    /** Stable anchor (uuid-ish string; not the path — a path may be re-rooted). */
    id: string;
    kind: SideWorkspaceKind;
    /**
     * Canonical root key: a `resolve()`d absolute local path (kind `local`) or
     * `ssh://<machineId>/<absolute posix path>` (kind `remote`).
     */
    rootKey: string;
    /** Display label (defaults to the basename at attach time). */
    label: string;
}
/** Attach/update payload (paths in any spelling; canonicalized here). */
export interface SideWorkspaceInput {
    id?: string;
    kind: SideWorkspaceKind;
    path: string;
    label?: string;
}
/** The persisted file shape. */
export interface SideWorkspacesFile {
    roots: Record<string, SideWorkspaceItem>;
    sessions: Record<string, string[]>;
}
/** Default state file path: `<dsh home>/dsw-session-workspaces.json`. */
export declare function defaultSideWorkspacesFile(dshBase?: string): string;
/**
 * Canonicalize one side-workspace path into a root key, or null when the path
 * cannot name a side root: a `remote` kind requires the `ssh://<id>/<abs>`
 * spelling (any POSIX directory spelled through a machine connection), a
 * `local` kind requires an absolute local path. The remote path is
 * posix-normalized; the local path is realpath-canonicalized (see
 * {@link canonicalLocalPath}) so every spelling of the same directory lands on
 * one key.
 */
export declare function normalizeSideRootKey(kind: SideWorkspaceKind, path: string): string | null;
/**
 * Canonicalize ANY remote side-workspace spelling into the
 * `ssh://<id>/<posix>` root key, or null when the path cannot name a remote
 * root. Three spellings select the same registry route (transport rule): the
 * `ssh://<id>/<abs>` form and the local placeholder trees
 * (`dsw-routes/<id>/…`, pre-rename `dsh-ssh-routes/<id>/…`) — so an attach
 * fed a placeholder path must land on exactly the record {@link sideWorkspaceOf}
 * matches for that same path.
 */
export declare function remoteSideRootKey(path: string): string | null;
/** Parse a stored root key back into its kind + canonical path parts. */
export declare function sideRootKeyOf(rootKey: string): {
    kind: SideWorkspaceKind;
    path: string;
} | null;
/**
 * Match one operation path against a root map: the LONGEST owning root, with
 * every real-world spelling canonicalized FIRST:
 *
 * - remote routes: `ssh://<id>/<path>` AND the local placeholder trees
 *   (`dsw-routes/<id>/…`, legacy `dsh-ssh-routes/<id>/…`) — a remote session's
 *   cwd is a placeholder, so path routing must see the same root;
 * - absolute local paths (win32: case-insensitive comparison, NTFS-realpath
 *   targetKeys vs lexical attach spellings);
 * - win32 bare POSIX-absolute paths: remote-by-spelling (the R4 worldOfCwd
 *   rule) — matched against remote roots by path part, machine-agnostic.
 *
 * Relative paths stay unmatched (they resolve against the session cwd world).
 */
export declare function sideWorkspaceOf(roots: ReadonlyMap<string, SideWorkspaceItem>, path: string): SideWorkspaceItem | undefined;
/** Pure validation/normalization of one record (persisted-file safety net). */
export declare function normalizeSideWorkspaceRecord(raw: unknown): SideWorkspaceItem | null;
/** Default display label for a root (last path segment, remote uses the POSIX part). */
export declare function basenameLabel(kind: SideWorkspaceKind, path: string): string;
/** Load the persisted file (missing → empty; corrupt → warn + empty). */
export declare function loadSideWorkspaces(file: string, warn: (message: string) => void): {
    roots: Map<string, SideWorkspaceItem>;
    sessions: Map<string, string[]>;
};
/** New stable side-workspace id (timestamp + random, like the temp machine ids). */
export declare function allocateSideId(): string;
/**
 * Session-attached side workspace store (cordis service `sideWorkspaces`).
 * Owns the durable attachment state; pure path matching lives in the exported
 * helpers so the mixed providers can route without touching this class.
 */
export declare class SessionSideWorkspaceStore extends Service {
    private readonly file;
    private readonly roots;
    private readonly sessions;
    constructor(ctx: Context, opts?: {
        file?: string;
    });
    /** The physical state file (tests/displays). */
    get statePath(): string;
    /** All side workspaces (canonical records), insertion order. */
    list(): SideWorkspaceItem[];
    /** The attachment account of one session, in order (roots only). */
    listFor(sessionId: string): SideWorkspaceItem[];
    /** One record by canonical root key. */
    get(rootKey: string): SideWorkspaceItem | undefined;
    /** The longest owning record of one operation path (routing index). */
    match(path: string): SideWorkspaceItem | undefined;
    /**
     * Attach one side workspace to a session (idempotent per rootKey: an
     * existing root updates record + moves it to the end of the session's
     * account; a new root is canonicalized and appended). Rejects with a `dsw:`
     * error when the path cannot name a side root.
     * @returns the stored record.
     */
    attach(sessionId: string, input: SideWorkspaceInput): SideWorkspaceItem;
    /** Detach one root from a session; drops the root record when nothing references it. */
    detach(sessionId: string, rootKey: string): boolean;
    /** Update a root's presentation field (undefined keeps the value). */
    update(rootKey: string, patch: {
        label?: string;
    }): boolean;
    /** Persist (mkdir -p first; a failed write warns and never crashes the caller). */
    persist(): void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        sideWorkspaces: SessionSideWorkspaceStore;
    }
}
/** Convenience: the default file path without touching the service. */
export declare const sessionWorkspacesFilePath: (dshBase?: string) => string;
