/** Combined browser plugin: mount Remote descriptors and register the Serial tab. */
import type { Context } from '@deepseek-ai/cordis';
export declare const inject: string[];
/**
 * Mount the serial Remote namespace, then expose one conversation Serial tab.
 *
 * This bundle mounts and consumes the namespace in one entry, so it cannot
 * declare `remote.serialConsole` in `inject`: the namespace service only comes
 * into existence while this very apply runs, and a PENDING fiber never runs.
 * Cordis therefore gates `ctx.remote.serialConsole` reads behind that inject
 * declaration. `ctx.get()` is the documented no-inject read path, and after
 * `$mount()` settled the namespace fiber is ACTIVE, so the read is safe.
 */
export declare function apply(baseContext: Context): Promise<void>;
//# sourceMappingURL=client.d.ts.map