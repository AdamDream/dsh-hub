/**
 * Wire identity and envelope adapter of this plugin's browser channel.
 *
 * WHY THIS MODULE EXISTS: the host half used to mount a standalone `/dsw`
 * channel through `connection.rpc.handle`. That API is unusable on the 0.1.5
 * line — `dsh-client-connection`'s `register()` ends in `owner.webServer.register(route)`
 * where `owner` is the Connection service's OWN context, which no longer injects
 * `webServer` (it declares `["credentials"]` alone) — so the registration threw
 * on every host family we support and `/dsw` answered 405 (UPSTREAM-3 F1/F2, see
 * `docs/rounds/R18-F2-dsw-405.md`).
 *
 * The channel therefore rides the OFFICIAL shared transport instead: exact Fetch
 * routes on `/api` (`connection.fetch.register`, the seam
 * `@deepseek-ai/dsh-client-file-upload` uses). Exact routes are matched BEFORE
 * the shared channel's interceptor, which `@deepseek-ai/dsh-api-gateway` already
 * owns (`registerInterceptor` allows exactly one owner per channel), and they
 * keep the same envelope, so the client half keeps calling one unary endpoint at
 * a time. The physical carrier still applies the loopback/Host fence and the
 * browser-session check before our handler runs.
 *
 * BOTH halves import this module, so the path, the namespace and the envelope
 * cannot drift apart (the previous design hard-coded '/dsw' in three places).
 * @module dsh-workspace-enhancement/web-channel
 */
/** The shared browser transport channel (`dsh-client-connection`'s `API_PATH`). */
export declare const API_CHANNEL = "/api";
/** This row's namespace below {@link API_CHANNEL}. */
export declare const CHANNEL_NAMESPACE = "dsw";
/** Endpoint spelling on the wire: what the client passes to `rpc.call`. */
export declare function channelEndpointOf(endpoint: string): string;
/** Absolute request path of one endpoint: what the host registers. */
export declare function channelPathOf(endpoint: string): string;
/** The unary RPC result shape the shared transport expects. */
export type ChannelResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
};
/** One endpoint handler: the `dispatch` switch in `./web.ts`. */
export type ChannelDispatch = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ChannelResult>;
/** One exact Fetch route, shaped like `ConnectionFetchRoute` (upstream `lib/types/rpc.d.ts`). */
export interface ChannelRoute {
    /** Absolute path below `/api`. */
    readonly path: string;
    /** Methods this route owns. */
    readonly methods: readonly ['POST'];
    /** JSON envelopes are small: the configured aggregate body cap applies. */
    readonly requestBody: 'buffered';
    /** Handle one authenticated request. */
    fetch(request: Request): Promise<Response>;
}
/**
 * `true` when an error is the registry's own duplicate-path rejection.
 *
 * `connection.fetch.register` runs inside the CONNECTION service's effect scope,
 * so a plugin reload that does not dispose the Connection service leaves the
 * previous route in place and the second registration throws. That is not a
 * failure: the route object is stateless and resolves the live dispatch per
 * request (see {@link channelRouteOf}), so the surviving registration already
 * serves the newest handler.
 */
export declare function isAlreadyRegistered(error: unknown): boolean;
/**
 * Build the exact Fetch route of one endpoint.
 *
 * The route is STATELESS: it resolves the dispatch through `resolve` on every
 * request, so a reload that cannot re-register the path (see
 * {@link isAlreadyRegistered}) still runs the newest host code.
 * @param endpoint - endpoint name without the namespace (e.g. `connections.list`).
 * @param resolve - live dispatch lookup for `endpoint`.
 * @returns the route to hand to `connection.fetch.register`.
 */
export declare function channelRouteOf(endpoint: string, resolve: (endpoint: string) => ChannelDispatch | undefined): ChannelRoute;
