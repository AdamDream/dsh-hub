export const DEFAULT_AI_PANEL_WIDTH = 380;
export const MIN_AI_PANEL_WIDTH = 300;
export const MAX_AI_PANEL_WIDTH = 600;
const STORAGE_KEY = '@infinitepersistence/dsh-serial-console/ai-panel';
export function clampAiPanelWidth(width) {
    if (!Number.isFinite(width))
        return DEFAULT_AI_PANEL_WIDTH;
    return Math.min(MAX_AI_PANEL_WIDTH, Math.max(MIN_AI_PANEL_WIDTH, Math.round(width)));
}
export function loadAiPanelPreferences(storage = browserStorage(), viewportWidth = browserViewportWidth()) {
    const fallback = {
        open: viewportWidth >= 900,
        width: DEFAULT_AI_PANEL_WIDTH,
    };
    if (storage === undefined)
        return fallback;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null)
            return fallback;
        const parsed = JSON.parse(raw);
        return {
            open: typeof parsed.open === 'boolean' ? parsed.open : fallback.open,
            width: typeof parsed.width === 'number'
                ? clampAiPanelWidth(parsed.width)
                : fallback.width,
        };
    }
    catch {
        return fallback;
    }
}
export function saveAiPanelPreferences(preferences, storage = browserStorage()) {
    if (storage === undefined)
        return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({
            open: preferences.open,
            width: clampAiPanelWidth(preferences.width),
        }));
    }
    catch {
        // Storage may be denied by browser privacy policy; UI state still works in memory.
    }
}
function browserStorage() {
    try {
        return typeof window === 'undefined' ? undefined : window.localStorage;
    }
    catch {
        return undefined;
    }
}
function browserViewportWidth() {
    return typeof window === 'undefined' ? 1_024 : window.innerWidth;
}
//# sourceMappingURL=ai-panel-preferences.js.map