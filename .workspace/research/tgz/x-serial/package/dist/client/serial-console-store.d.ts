import type { SerialConsoleRemote, SerialEvent, SerialOpenOptions, SerialPortDescriptor, SerialSendRequest, SerialSnapshot } from '../protocol.js';
/** Line-ending bytes selected for a physical Enter key press. */
export type SerialLineEnding = NonNullable<SerialSendRequest['lineEnding']>;
/** Immutable browser projection of the Host-owned serial session. */
export interface SerialConsoleViewState {
    readonly remote: SerialSnapshot;
    readonly ports: readonly SerialPortDescriptor[];
    readonly events: readonly SerialEvent[];
    readonly selectedPath: string;
    readonly baudRate: string;
    readonly lineEnding: SerialLineEnding;
    readonly loadingPorts: boolean;
    readonly polling: boolean;
    readonly gapDetected: boolean;
    readonly lastError: string | undefined;
    readonly syncError: string | undefined;
    readonly syncFault: string | undefined;
}
/** Synchronization and retention settings for one browser-side serial console. */
export interface SerialConsoleStoreOptions {
    readonly initialBaudRate?: number;
    readonly pollIntervalMs?: number;
    readonly waitMs?: number;
    readonly pollLimit?: number;
    readonly maxClientEvents?: number;
    readonly snapshotTimeoutMs?: number;
}
/**
 * Browser-side synchronization store. Physical writes are serialized in one FIFO;
 * xterm owns terminal editing and the Host remains authoritative for events.
 * Empty unchanged polls preserve the published snapshot reference.
 */
export declare class SerialConsoleStore {
    private readonly remote;
    private readonly listeners;
    private readonly pollIntervalMs;
    private readonly waitMs;
    private readonly pollLimit;
    private readonly maxClientEvents;
    private readonly snapshotTimeoutMs;
    private state;
    private running;
    private timer;
    private refreshInFlight;
    private refreshController;
    private refreshEpoch;
    private syncSuspensions;
    private waitCapability;
    private opaqueWaitFailureConfirmations;
    private drainingBacklog;
    private retryDelayMs;
    private nextRefreshDelayMs;
    private writeTail;
    constructor(remote: SerialConsoleRemote, options?: SerialConsoleStoreOptions);
    getSnapshot: () => SerialConsoleViewState;
    subscribe: (listener: () => void) => (() => void);
    /** Retain the selected device path across component remounts. */
    setSelectedPath(selectedPath: string): void;
    /** Retain editable baud-rate text across component remounts. */
    setBaudRate(baudRate: string): void;
    /** Retain the physical Enter-key line ending across component remounts. */
    setLineEnding(lineEnding: SerialLineEnding): void;
    /** Start continuous snapshot synchronization and return its idempotent disposer. */
    start(): () => void;
    /** Stop synchronization, abort the carrier, and fence any late response. */
    stop(): void;
    /** Refresh the selectable physical-port list. */
    loadPorts(): Promise<void>;
    /** Open a physical port and replace the local event window with its session. */
    connect(options: SerialOpenOptions): Promise<void>;
    /** Close the active physical port while retaining the user's connection choices. */
    disconnect(): Promise<void>;
    /**
     * Send xterm text exactly as produced by its input stream. Enter conversion
     * is performed by the terminal adapter before this method is called.
     */
    sendTerminalText(text: string): Promise<void>;
    /** Send xterm's binary mouse/report stream without UTF-8 re-encoding. */
    sendTerminalBinary(dataBase64: string): Promise<void>;
    /** Serialize one user/model request behind all earlier browser writes. */
    send(request: SerialSendRequest): Promise<void>;
    /** Pull one immediate read-only snapshot through the single-flight gate. */
    refresh(): Promise<void>;
    private beginRefresh;
    private refreshOnce;
    private withSnapshotTimeout;
    /** Abort one snapshot generation without forgetting its unsettled Promise. */
    private retireRefresh;
    private suspendSynchronization;
    private resumeSynchronization;
    private acceptSnapshot;
    private observeWaitCapability;
    private recordTransientSynchronizationError;
    private tripSynchronizationFault;
    private assertSynchronizationWritable;
    private applyRemote;
    private enqueueSend;
    private schedule;
    private patch;
    private replace;
}
//# sourceMappingURL=serial-console-store.d.ts.map