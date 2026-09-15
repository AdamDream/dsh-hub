/** Model-facing serial tools over the single Host-owned serial service. */
import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
export declare const name = "tool-serial-console";
export declare const inject: string[];
export interface Config {
    readonly maxReadLines?: number;
    readonly maxReadBytes?: number;
}
export declare const Config: schema<Config>;
/** Register the serial tool set in the active agent/tool scope. */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=tool.d.ts.map