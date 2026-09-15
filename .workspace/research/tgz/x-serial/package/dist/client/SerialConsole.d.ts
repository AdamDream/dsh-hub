import type { UseSerialConversation } from './ai-activity.js';
import type { SerialConsoleStore } from './serial-console-store.js';
import './serial-console.css';
/** Props for the standalone serial-console surface. */
export interface SerialConsoleProps {
    readonly store: SerialConsoleStore;
    /** DSH session selector hook; omitted when embedding the standalone React surface. */
    readonly useConversation?: UseSerialConversation;
}
/** Standalone serial console combining xterm with Host connection controls. */
export declare function SerialConsole({ store, useConversation }: SerialConsoleProps): import("react").JSX.Element;
//# sourceMappingURL=SerialConsole.d.ts.map