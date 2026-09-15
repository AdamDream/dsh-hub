/** DeepSeek Harness Host plugin that owns the physical serial connection. */
import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { SerialSessionManager } from '../serial/index.js';
import type { SerialExpectRequest, SerialExpectResult, SerialMarkRequest, SerialMarkerEvent, SerialOpenOptions, SerialPortDescriptor, SerialSendRequest, SerialSendResult, SerialSnapshot, SerialSnapshotRequest, SerialWaitSnapshotRequest } from '../protocol.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        serialConsole: SerialConsoleService;
    }
}
/** Host configuration supplied by cordis.patch.yml. */
export interface Config {
    readonly logDirectory: string;
    readonly ringCapacity?: number;
    readonly snapshotLimit?: number;
}
export declare const Config: schema<Config>;
/** One process-wide service owns every serial RX/TX event and audit record. */
export declare class SerialConsoleService extends TypertRemoteService {
    static Config: schema<Config>;
    readonly manager: SerialSessionManager;
    constructor(ctx: Context, config: Config);
    listPorts(): Promise<readonly SerialPortDescriptor[]>;
    connect(request: SerialOpenOptions): Promise<SerialSnapshot>;
    disconnect(): Promise<SerialSnapshot>;
    snapshot(request: SerialSnapshotRequest, signal?: AbortSignal): SerialSnapshot;
    waitSnapshot(request: SerialWaitSnapshotRequest, signal: AbortSignal): Promise<SerialSnapshot>;
    send(request: SerialSendRequest): Promise<SerialSendResult>;
    mark(request: SerialMarkRequest): SerialMarkerEvent;
    /** Model-only bounded RX matcher; it is intentionally not a browser Remote. */
    expect(request: SerialExpectRequest, signal?: AbortSignal): Promise<SerialExpectResult>;
}
export default SerialConsoleService;
//# sourceMappingURL=host.d.ts.map