/**
 * Web-facing RPC channel of dsh-workspace-enhancement: mounts the connection
 * registry and registers the plugin's unary channel as exact Fetch routes on the
 * shared `/api` transport (the loopback/Host fence and the browser-session check
 * are applied by that transport, not here). The client half drives connection
 * management and remote directory browsing through it; endpoints are plain JSON.
 * Remote listing shares one level walk with the directory-picker backend
 * ({@link module:dsh-workspace-enhancement/listing}).
 *
 * The wire identity (channel path, namespace, envelope) lives in
 * `./web-channel.ts`, which the client half imports too.
 * @module dsh-workspace-enhancement/web
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RegistryConfig } from './registry.ts';
import type { ChannelRoute } from './web-channel.ts';
/** Channel config. */
export interface WebChannelConfig extends RegistryConfig {
    /** Complete-result bound of one remote listing level. */
    maxEntries?: number;
}
export type { ChannelResult } from './web-channel.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /**
         * Host connection transport. Only the surface this row uses is declared —
         * the exact Fetch-route registry on the shared `/api` channel, mirrored from
         * `@deepseek-ai/dsh-client-connection`'s `HostConnectionFetch` /
         * `ConnectionFetchRoute` types. `connection.rpc.handle` is deliberately NOT
         * declared: it is unusable on the 0.1.5 line (see `./web-channel.ts`), and
         * leaving it out keeps it from creeping back in.
         */
        connection: {
            fetch: {
                register(route: ChannelRoute): () => Promise<void>;
            };
        };
    }
}
/** Required host services: the web transport + the tools/system-prompt registry. */
export declare const inject: string[];
/** Validated channel config. */
export declare const Config: z<WebChannelConfig>;
/**
 * Every endpoint this row serves, in one place.
 *
 * The dispatch switch below is the implementation and this list is the mount
 * surface, so the two can drift; `test/web-channel.test.ts` reads this file and
 * fails when a `case 'x':` is not listed here (or vice versa).
 */
export declare const CHANNEL_ENDPOINTS: readonly ["connections.list", "config.hosts", "connections.resolve", "connections.add", "connections.remove", "connections.test", "machines.list", "machines.current", "machines.setCurrent", "machines.add", "machines.remove", "machines.test", "hostkey.forget", "status", "conn.status", "conn.probe", "conn.reconnect", "browse.home", "browse.list", "browse.mkdir", "session.route", "local.pickNative", "session.ws.list", "session.ws.add", "session.ws.update", "session.ws.remove", "session.conn.list", "session.conn.connect", "session.conn.disconnect", "session.conn.set"];
/**
 * Mount the connection registry and this row's `/api/dsw/*` channel.
 * @param ctx - the mounting Cordis context.
 * @param config - state file and listing bound.
 */
export declare function apply(ctx: Context, config: WebChannelConfig): void;
