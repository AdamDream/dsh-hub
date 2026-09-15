/**
 * REQ-I11: per-session CONNECTED-MACHINE state — which registry machines a
 * session has switched on with `sw_connect` (or with a toggle in the session
 * workspace panel). The machine universe is the user's registry: this store
 * keeps only machine ID REFERENCES (never credentials, never connection
 * objects), so removing a machine from the registry cannot leak through here.
 *
 * Model (REQ-I11): the connected set is the session's coarse gate.
 *
 * - `sw_connect(machines: [...])` and the panel toggle write THIS store, so the
 *   model's control plane and the UI cannot disagree;
 * - a session with an empty set sees no `sw_exec` and no remote prompt note;
 * - a session whose header cwd routes to a machine treats that machine as
 *   connected implicitly (the caller unions it in — the store stays literal).
 *
 * It is a GATE, not a fence: the filesystem face routes any `ssh://<id>/…` path
 * at registry level (ADR-0021), so this store controls visibility and tool
 * exposure, not reachability.
 *
 * Storage mirrors {@link SessionSideWorkspaceStore}: one JSON file
 * (`<dsh home>/dsw-session-connections.json`) holding
 * `sessions: { <sessionId>: <machineId[]> }` in connection order. Unknown or
 * legacy fields are ignored on read; a corrupt file warns and reads empty
 * rather than failing the host.
 *
 * Validation errors are plain `dsw:` English here: both callers (the tool layer
 * and the `/dsw` channel) re-check the same conditions and own the localized
 * wording at their own boundary.
 * @module dsh-workspace-enhancement/session-connections
 */
import { Context, Service } from '@deepseek-ai/cordis';
/** The persisted file shape (`sessions` only; anything else is ignored). */
export interface SessionConnectionsFile {
    sessions: Record<string, string[]>;
}
/** Default state file path: `<dsh home>/dsw-session-connections.json`. */
export declare function defaultSessionConnectionsFile(dshBase?: string): string;
/** Normalize one stored/!incoming machine id, or null when it cannot be one. */
export declare function normalizeMachineId(value: unknown): string | null;
/** Normalize a session id (padded spellings collapse onto one account). */
export declare function normalizeSessionId(value: unknown): string | null;
/** Dedupe a machine-id list, preserving first-seen order and dropping junk. */
export declare function normalizeMachineIds(values: readonly unknown[]): string[];
/** Load the persisted file (missing → empty; corrupt → warn + empty). */
export declare function loadSessionConnections(file: string, warn: (message: string) => void): Map<string, string[]>;
/**
 * Session → connected-machine store (cordis service `sessionConnections`).
 * Every mutator persists; a failed write warns and keeps the in-memory state
 * authoritative (the same honesty rule as the side-workspace store).
 */
export declare class SessionMachineConnections extends Service {
    private readonly file;
    private readonly sessions;
    constructor(ctx: Context, opts?: {
        file?: string;
    });
    /** The physical state file (tests/displays). */
    get statePath(): string;
    /** The machine ids connected to one session, in connection order. */
    listFor(sessionId: string): string[];
    /** Whether one machine is connected to one session. */
    has(sessionId: string, machineId: string): boolean;
    /** Every session id that currently has at least one connection. */
    sessionIds(): string[];
    /**
     * Replace a session's whole connected set — the `sw_connect(machines: […])`
     * form. Empty input clears the session. Unknown machine ids are NOT rejected
     * here (the caller owns registry validation); use {@link retain} to prune
     * references to machines that were deleted.
     * @returns the stored set.
     */
    set(sessionId: string, machineIds: readonly unknown[]): string[];
    /** Add one machine to the session (idempotent; keeps the existing order). */
    connect(sessionId: string, machineId: string): string[];
    /** Remove one machine from the session (absent id is a no-op `false`). */
    disconnect(sessionId: string, machineId: string): boolean;
    /** Drop one session's whole connection account. */
    clear(sessionId: string): boolean;
    /**
     * Drop references to machine ids the registry no longer knows (a deleted
     * machine must not stay "connected"). Returns the number of removed
     * references. The channel calls this after `machines.remove`, which is the one
     * place that knows an id is gone (there is no startup sweep: the store is
     * registry-agnostic by construction, so a stale reference is pruned the first
     * time a machine is removed rather than on load).
     */
    retain(known: ReadonlySet<string>): number;
    /** Persist (mkdir -p first; a failed write warns and never crashes the caller). */
    persist(): void;
    private requireSession;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionConnections: SessionMachineConnections;
    }
}
/** Convenience: the default file path without touching the service. */
export declare const sessionConnectionsFilePath: (dshBase?: string) => string;
