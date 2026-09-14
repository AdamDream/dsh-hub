import type { Context } from '@deepseek-ai/cordis';
/**
 * Host half of the wallpaper plugin: static-image media routes
 * (POST upload / POST import / GET / DELETE / POST cleanup under
 * /dsh-wallpaper/media, files under ~/.dsh/wallpapers) plus the `wallpaper`
 * user-settings namespace registration (global default + per-page overrides).
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
