/**
 * Connection status UI shared by every machine surface (settings rows, the
 * add-workspace flow sidebar, the DOM row layer): the `/dsw/conn.*` wire
 * contract, a small TTL + in-flight dedupe status center, the `useConnStatus`
 * hook, and the tri-state badge component (◇ unknown / ● active / ● offline)
 * with the "re-check and try to connect" affordance.
 *
 * The wire contract mirrors the host's ConnectionStatusView (registry.ts);
 * unknown fields are tolerated. No new dependencies.
 * @module dsh-workspace-enhancement/client/status
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { DswKey } from '../locale/index.ts';
import type { WireResult } from './index.ts';
/**
 * zh baseline translate: the design's backward-compatible default for pure
 * render helpers and for components whose caller does not thread a `t` seat
 * yet — renders the zh dictionary (identical output to the pre-i18n literals).
 */
export declare const zhBaseline: TranslateNS<'dsw'>;
/** Tri-state connection state as wired by `/dsw/conn.*`. */
export type ConnState = 'unknown' | 'active' | 'offline';
/** One `/dsw/conn.status` row (structural; unknown fields tolerated). */
export interface ConnStatusView {
    id: string;
    state: ConnState;
    connected: boolean;
    label: string;
    host: string;
    port: number;
    username: string;
    hostKeyKnown: boolean;
    lastProbeAt?: string;
    lastProbeLatencyMs?: number | null;
    message?: string;
}
/** The `/dsw` RPC face (same channel shape as the settings/flow inject). */
export type RpcCall = (endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<WireResult>;
/** Structural check of one conn.status row. */
export declare function asConnStatus(value: unknown): ConnStatusView | null;
/** Per-id async status handle: TTL cache + in-flight dedupe. */
export interface StatusCenter {
    /** Cached view without touching the wire (null when absent/expired). */
    peek(id: string): ConnStatusView | null;
    /** Resolve the current status (cache-first; the wire only on expiry). */
    get(id: string): Promise<ConnStatusView | null>;
    /** Force a live probe (network; replaces the cache entry). */
    probe(id: string): Promise<ConnStatusView | null>;
    /** Dispose + rebuild + probe (network; the failed-cache root fix). */
    reconnect(id: string): Promise<ConnStatusView | null>;
}
/** Create a status center backed by one `/dsw` RPC channel. */
export declare function createStatusCenter(rpc: RpcCall, statusTtlMs?: number, probeTtlMs?: number, getT?: () => TranslateNS<'dsw'>): StatusCenter;
/** The app-wide center (one `/dsw` channel in the client bundle). */
export declare function getStatusCenter(rpc: RpcCall, getT?: () => TranslateNS<'dsw'>): StatusCenter;
/** Bind one entry's status to a component (auto-fetch + refresh actions). */
export declare function useConnStatus(center: StatusCenter | null, id: string | undefined): {
    view: ConnStatusView | null;
    busy: boolean;
    refresh: () => Promise<ConnStatusView | null>;
    reconnect: () => Promise<ConnStatusView | null>;
};
/**
 * The dictionary-key mapping of the tri-state label — the single key source
 * for the React badge AND the DOM row-badge layer (row-badges, t8). The plain
 * legacy label map ({@link CONN_STATE_LABEL}) was removed in t15-r2: its last
 * consumer (the DOM row layer) migrated to the KEY mapping in t8, so the
 * frozen zh-only snapshot only ever threatened to drift from the dictionary.
 */
export declare const CONN_STATE_LABEL_KEY: Record<ConnState, DswKey>;
export declare const CONN_STATE_COLOR: Record<ConnState, string>;
/**
 * The tri-state badge: colored dot + label, and (unless `compact`) the
 * "re-check and try to connect" button shown for unknown/offline entries.
 */
export declare function ConnStatusBadge({ id, rpc, center, compact, t: tSeat, }: {
    id: string;
    rpc: RpcCall;
    center?: StatusCenter | null;
    compact?: boolean;
    /** Typed translate seat (threaded by the callers; defaults to the zh baseline). */
    t?: TranslateNS<'dsw'>;
}): ReactNode;
