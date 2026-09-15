import type { SerialActor, SerialEvent, SerialExpectRequest, SerialExpectResult, SerialMarkerEvent, SerialOpenOptions, SerialSendResult, SerialSnapshot, SerialWaitSnapshotRequest } from '../protocol.js';
import type { Dispose, SerialEventSink, SerialTransportFactory } from './transport.js';
export interface SerialSessionManagerOptions {
    readonly ringCapacity?: number;
    readonly snapshotLimit?: number;
    readonly eventSink?: SerialEventSink;
    readonly now?: () => number;
    readonly monotonicNow?: () => number;
    readonly createSessionId?: () => string;
}
export interface SerialWriteMetadata {
    readonly actor: SerialActor;
    readonly text?: string;
    readonly toolCallId?: string;
}
export declare class SerialExpectTimeoutError extends Error {
    readonly timeoutMs: number;
    readonly pattern: string;
    constructor(timeoutMs: number, pattern: string);
}
export declare class SerialSessionManagerClosedError extends Error {
    constructor();
}
export declare const DEFAULT_SERIAL_SNAPSHOT_WAIT_MS = 750;
export declare const MAX_SERIAL_SNAPSHOT_WAIT_MS = 1000;
/**
 * Single owner of one physical port. Every model and user write enters the same
 * queue, and every RX/TX/state transition receives one Host sequence number.
 */
export declare class SerialSessionManager {
    private readonly factory;
    private readonly events;
    private readonly listeners;
    private readonly snapshotWaitClosers;
    private readonly snapshotLimit;
    private readonly sink;
    private readonly now;
    private readonly monotonicNow;
    private readonly createSessionId;
    private status;
    private port;
    private sessionId;
    private nextSeq;
    private transport;
    private transportDisposers;
    private decoder;
    private writeTail;
    private intentionalClose;
    private closed;
    constructor(factory: SerialTransportFactory, options?: SerialSessionManagerOptions);
    listPorts(): Promise<readonly import("../protocol.js").SerialPortDescriptor[]>;
    /** Open a new physical lifecycle, closing the previous one first if needed. */
    connect(options: SerialOpenOptions): Promise<SerialSnapshot>;
    /** Drain accepted writes, close the transport, and preserve the event log. */
    disconnect(): Promise<SerialSnapshot>;
    /** Serialize one write with every other model and user write. */
    send(data: Uint8Array, metadata: SerialWriteMetadata): Promise<SerialSendResult>;
    mark(label: string, actor: SerialActor, toolCallId?: string): SerialMarkerEvent;
    snapshot(afterSeq?: number, limit?: number): SerialSnapshot;
    /** Wait for the next event without losing an event published while subscribing. */
    waitSnapshot(request?: SerialWaitSnapshotRequest, signal?: AbortSignal): Promise<SerialSnapshot>;
    subscribe(listener: (event: SerialEvent) => void): Dispose;
    /** Wait for an RX-only regular-expression match without feeding unrelated logs to the model. */
    waitForText(request: SerialExpectRequest, signal?: AbortSignal): Promise<SerialExpectResult>;
    close(): Promise<void>;
    private receive;
    private onTransportClosed;
    private setState;
    private publishState;
    private reportError;
    private publish;
    private detachTransport;
}
//# sourceMappingURL=session-manager.d.ts.map