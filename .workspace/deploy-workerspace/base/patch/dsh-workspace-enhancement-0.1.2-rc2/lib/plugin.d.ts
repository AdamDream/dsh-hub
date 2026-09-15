/**
 * One-row aggregate plugin: mounts the shared SSH connection owner plus the
 * MIXED subprocess and filesystem providers — the single implementation of
 * `ctx.subprocess` / `ctx.fs`, routing every call by its working directory
 * (remote routes over SSH, everything else delegates to the local
 * implementations). The local provider rows are disabled by this bundle's
 * patch (cordis.patch.yml) so their service registrations cannot collide with
 * the mixed ones; the sandbox rows and the sandboxed shell executors
 * (`bash-sandbox`/`pwsh-sandbox`) stay enabled and consume the mixed
 * `ctx.subprocess`.
 *
 * R4-I2 执行适配层：远程会话的每会话沙箱模式被固定为 `danger-full-access`
 * （session/created 时写入 `sandbox/mode` 覆盖事件），因此沙箱化的 shell
 * 执行器对远程会话跳过本地跑器包装，`bash -c`/`pwsh -Command` 原样到达远端。
 *
 * `name: dsh-workspace-enhancement` in cordis.yml is equivalent to the three
 * subpath rows (`dsh-workspace-enhancement/ssh`, `dsh-workspace-enhancement/
 * subprocess`, `dsh-workspace-enhancement/fs`) — except that the mixed wiring
 * only happens on the aggregate row. Subpath rows keep the pure-SSH form for
 * deployments that compose providers individually.
 * @module dsh-workspace-enhancement/plugin
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './runtime.ts';
/**
 * Install the mixed providers: the LOCAL implementation classes are
 * constructed in THIS fiber (each Service subclass registration makes this
 * row the provider of the seam name), then `ctx.set` swaps the registered
 * value for the routing facade. Consumers that `inject` the seams can only
 * activate once the name is provided, so they always observe the facade —
 * row order does not matter.
 *
 * The composition is deliberately synchronous: provide + set are the only two
 * steps, and no consumer fiber can wake between them (activation runs on a
 * later microtask).
 * @param ctx - the aggregate row's context.
 */
export declare function installMixedProviders(ctx: Context): void;
/**
 * Mount the aggregate plugin.
 * @param ctx - the mounting Cordis context.
 * @param config - the shared SSH connection configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
