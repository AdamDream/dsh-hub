export declare const DEFAULT_AI_PANEL_WIDTH = 380;
export declare const MIN_AI_PANEL_WIDTH = 300;
export declare const MAX_AI_PANEL_WIDTH = 600;
export interface AiPanelPreferences {
    readonly open: boolean;
    readonly width: number;
}
interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare function clampAiPanelWidth(width: number): number;
export declare function loadAiPanelPreferences(storage?: StorageLike | undefined, viewportWidth?: number): AiPanelPreferences;
export declare function saveAiPanelPreferences(preferences: AiPanelPreferences, storage?: StorageLike | undefined): void;
export {};
//# sourceMappingURL=ai-panel-preferences.d.ts.map