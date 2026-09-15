import type { AiActivitySnapshot } from './ai-activity.js';
export interface AiActivityPanelProps {
    readonly activity: AiActivitySnapshot;
    readonly onClose: () => void;
}
/** Compact read-only mirror of the selected DSH session's current AI activity. */
export declare function AiActivityPanel({ activity, onClose }: AiActivityPanelProps): import("react").JSX.Element;
//# sourceMappingURL=AiActivityPanel.d.ts.map