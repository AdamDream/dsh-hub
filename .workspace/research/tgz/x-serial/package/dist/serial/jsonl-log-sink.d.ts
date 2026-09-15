import type { SerialEvent } from '../protocol.js';
import type { SerialEventSink } from './transport.js';
/** Append-only JSONL evidence sink, partitioned by physical serial session. */
export declare class JsonlSerialEventSink implements SerialEventSink {
    private readonly directory;
    private tail;
    private directoryReady;
    private failure;
    constructor(directory: string);
    write(event: SerialEvent): void;
    flush(): Promise<void>;
}
//# sourceMappingURL=jsonl-log-sink.d.ts.map