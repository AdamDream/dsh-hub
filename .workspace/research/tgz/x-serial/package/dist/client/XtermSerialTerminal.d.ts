import { SearchAddon } from '@xterm/addon-search';
import type { SerialActor, SerialEvent } from '../protocol.js';
import type { SerialLineEnding } from './serial-console-store.js';
import type { TerminalCheckpointCache } from './terminal-checkpoint.js';
type GutterActor = SerialActor | 'board' | 'system';
interface ReceiveSpan {
    readonly eventSeq: number;
    readonly startLine: number;
    readonly endLine: number;
}
interface PendingSubmission {
    readonly actor: SerialActor;
    readonly command: string | undefined;
    readonly lineText: string | undefined;
    readonly minLine: number;
    readonly txSeq: number;
}
interface CachedGutterRecord {
    readonly line: number;
    readonly actor: GutterActor;
}
export interface XtermTerminalCheckpointPayload {
    readonly serializedTerminal: string;
    readonly bufferSignature: string;
    readonly records: readonly CachedGutterRecord[];
    readonly txDrafts: Readonly<Record<SerialActor, string>>;
    readonly txOpaque: Readonly<Record<SerialActor, boolean>>;
    readonly pendingSubmissions: readonly PendingSubmission[];
    readonly receiveTail: readonly ReceiveSpan[];
}
/** Plain React inputs for the component-private xterm instance. */
export interface XtermSerialTerminalProps {
    readonly events: readonly SerialEvent[];
    readonly connected: boolean;
    readonly follow: boolean;
    readonly lineEnding: SerialLineEnding;
    readonly emptyLabel: string;
    readonly checkpointKey: string;
    readonly checkpointBaseSeq: number;
    readonly checkpointAllowed: boolean;
    readonly checkpointCache: TerminalCheckpointCache<XtermTerminalCheckpointPayload>;
    readonly findOpen: boolean;
    readonly onFindOpenChange: (open: boolean) => void;
    readonly onTextInput: (text: string) => Promise<void>;
    readonly onBinaryInput: (dataBase64: string) => Promise<void>;
}
/**
 * Real VT terminal surface. RX bytes are the only bytes rendered; xterm input
 * is forwarded to the board and returns through the authoritative RX stream.
 */
export declare function XtermSerialTerminal({ events, connected, follow, lineEnding, emptyLabel, checkpointKey, checkpointBaseSeq, checkpointAllowed, checkpointCache, findOpen, onFindOpenChange, onTextInput, onBinaryInput, }: XtermSerialTerminalProps): import("react").JSX.Element;
export declare function runTerminalSearch(searchAddon: Pick<SearchAddon, 'findNext' | 'findPrevious'>, term: string, direction: 'next' | 'previous', incremental: boolean): void;
export declare function isTerminalFindShortcut(event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
}): boolean;
export {};
//# sourceMappingURL=XtermSerialTerminal.d.ts.map