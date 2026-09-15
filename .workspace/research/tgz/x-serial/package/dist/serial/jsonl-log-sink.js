import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Append-only JSONL evidence sink, partitioned by physical serial session. */
export class JsonlSerialEventSink {
    directory;
    tail = Promise.resolve();
    directoryReady;
    failure;
    constructor(directory) {
        this.directory = directory;
        if (directory.trim().length === 0)
            throw new TypeError('log directory must not be blank');
    }
    write(event) {
        this.tail = this.tail.then(async () => {
            if (this.failure !== undefined)
                throw this.failure;
            this.directoryReady ??= mkdir(this.directory, { recursive: true }).then(() => undefined);
            await this.directoryReady;
            const path = join(this.directory, `${safeFileSegment(event.sessionId)}.jsonl`);
            await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
        }).catch((error) => {
            this.failure = error instanceof Error ? error : new Error(String(error));
        });
    }
    async flush() {
        await this.tail;
        if (this.failure !== undefined)
            throw this.failure;
    }
}
function safeFileSegment(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
//# sourceMappingURL=jsonl-log-sink.js.map