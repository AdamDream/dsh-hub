/**
 * Browser half of the wallpaper plugin: wallpaper layer + dark mask overlay,
 * per-page (home / session / settings) overrides, URL / absolute-path / upload
 * image sources, and persistence through the host settings document via the
 * settingsScope service (`wallpaper` namespace).
 */
export declare const SETTINGS_NS: string;
export declare const inject: string[];
export declare function apply(ctx: unknown): void;
