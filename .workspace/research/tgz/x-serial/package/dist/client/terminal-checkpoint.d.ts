import type { SerialEvent } from '../protocol.js';
/** One in-memory xterm checkpoint owned by a browser-side console generation. */
export interface TerminalCheckpoint<TPayload> {
    readonly key: string;
    readonly baseSeq: number;
    readonly throughSeq: number;
    readonly cols: number;
    readonly rows: number;
    readonly payload: TPayload;
}
/** Mutable cache container that can survive a React view unmount. */
export interface TerminalCheckpointCache<TPayload> {
    current: TerminalCheckpoint<TPayload> | undefined;
}
export interface TerminalCheckpointLookup {
    readonly key: string;
    readonly baseSeq: number;
    readonly events: readonly SerialEvent[];
    readonly allowRestore: boolean;
}
export declare function createTerminalCheckpointCache<TPayload>(): TerminalCheckpointCache<TPayload>;
/**
 * Return a checkpoint only when the retained event window can continue it
 * without a session, clear-view, rewind, or truncation gap.
 */
export declare function takeRestorableTerminalCheckpoint<TPayload>(cache: TerminalCheckpointCache<TPayload>, lookup: TerminalCheckpointLookup): TerminalCheckpoint<TPayload> | undefined;
export declare function saveTerminalCheckpoint<TPayload>(cache: TerminalCheckpointCache<TPayload>, checkpoint: TerminalCheckpoint<TPayload>): void;
//# sourceMappingURL=terminal-checkpoint.d.ts.map