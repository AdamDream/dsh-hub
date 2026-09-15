import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useMemo, useState } from 'react';
import { lookup } from "../locale/index.js";
/**
 * zh baseline translate: the design's backward-compatible default for pure
 * render helpers and for components whose caller does not thread a `t` seat
 * yet — renders the zh dictionary (identical output to the pre-i18n literals).
 */
export const zhBaseline = (key, params) => lookup('zh', key, params);
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Structural check of one conn.status row. */
export function asConnStatus(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.username !== 'string')
        return null;
    const state = value.state === 'active' || value.state === 'offline' ? value.state : 'unknown';
    const view = {
        id: value.id,
        state,
        connected: value.connected === true,
        label: typeof value.label === 'string' ? value.label : value.host,
        host: value.host,
        port: typeof value.port === 'number' ? value.port : 22,
        username: value.username,
        hostKeyKnown: value.hostKeyKnown === true,
    };
    if (typeof value.lastProbeAt === 'string')
        view.lastProbeAt = value.lastProbeAt;
    if (typeof value.lastProbeLatencyMs === 'number')
        view.lastProbeLatencyMs = value.lastProbeLatencyMs;
    if (typeof value.message === 'string')
        view.message = value.message;
    return view;
}
/** Unwrap a wire result into its value (throws the business message). */
function unwrap(result, t) {
    if (!result.ok)
        throw new Error(result.error.message || t('status.rpc.failed'));
    return result.value;
}
const DEFAULT_NETWORK_TTL_MS = 10_000;
const DEFAULT_PROBE_TTL_MS = 4_000;
/** Create a status center backed by one `/dsw` RPC channel. */
export function createStatusCenter(rpc, statusTtlMs = DEFAULT_NETWORK_TTL_MS, probeTtlMs = DEFAULT_PROBE_TTL_MS, getT = () => zhBaseline) {
    const cache = new Map();
    const inflight = new Map();
    const fresh = (id, ttl) => {
        const entry = cache.get(id);
        if (entry === undefined)
            return null;
        return Date.now() - entry.at < ttl ? entry.view : null;
    };
    const put = (view) => {
        cache.set(view.id, { view, at: Date.now() });
        return view;
    };
    /**
     * P2-①: dedupe keyed by `endpoint:id`, never by id alone. `conn.status`
     * (cache-first read), `conn.probe` (live echo), and `conn.reconnect`
     * (dispose + rebuild + probe) have different semantics and different
     * TTLs — sharing one id slot made a reconnect return a stale probe or a
     * status read latch onto a pending probe and never issue its own request.
     * Each endpoint keeps its own in-flight slot per id; the TTL cache stays
     * per id (the latest view of the entry).
     * (t8: this used to take a per-call `ttl` that nothing consumed — expiry
     * is honored at read time by {@link StatusCenter.peek} / `get` via
     * {@link fresh}; the dead parameter is gone.)
     * (t15-r2: the translate seat is a LIVE PROVIDER, never a snapshot — the
     * unwrap fallback reads the active language at call time, so a language
     * switch needs no re-created center.)
     */
    const networked = (id, endpoint) => {
        const key = `${endpoint}:${id}`;
        const pending = inflight.get(key);
        if (pending !== undefined)
            return pending;
        const call = rpc(endpoint, { id })
            .then(result => { const view = asConnStatus(unwrap(result, getT())); return view === null ? null : put(view); })
            .catch(() => null)
            .finally(() => { inflight.delete(key); });
        inflight.set(key, call);
        return call;
    };
    return {
        peek: id => fresh(id, Math.max(statusTtlMs, probeTtlMs)),
        get: id => {
            const cached = fresh(id, statusTtlMs);
            if (cached !== null)
                return Promise.resolve(cached);
            return networked(id, 'conn.status');
        },
        probe: id => networked(id, 'conn.probe'),
        reconnect: id => networked(id, 'conn.reconnect'),
    };
}
let sharedCenter = null;
/** The latest live translate provider the shared center unwraps with. */
let sharedGetT = () => zhBaseline;
/** The app-wide center (one `/dsw` channel in the client bundle). */
export function getStatusCenter(rpc, getT = () => zhBaseline) {
    // t15-r2: never cache a translate snapshot in the singleton — the provider
    // slot is refreshed on every call, so the center's unwrap fallback follows
    // the ACTIVE language even after a language switch (the center itself holds
    // no language state).
    sharedGetT = getT;
    sharedCenter ??= createStatusCenter(rpc, undefined, undefined, () => sharedGetT());
    return sharedCenter;
}
/** Bind one entry's status to a component (auto-fetch + refresh actions). */
export function useConnStatus(center, id) {
    const [view, setView] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (center === null || id === undefined)
            return;
        let alive = true;
        setView(center.peek(id));
        void center.get(id).then(found => { if (alive)
            setView(found); });
        return () => { alive = false; };
    }, [center, id]);
    const run = (fn) => {
        return async () => {
            if (center === null || id === undefined)
                return null;
            setBusy(true);
            try {
                const found = await fn();
                setView(found);
                return found;
            }
            catch {
                return null;
            }
            finally {
                setBusy(false);
            }
        };
    };
    // Stable per (center, id); rebuild only when identity changes.
    return useMemo(() => ({
        view,
        busy,
        refresh: run(() => center !== null && id !== undefined ? center.get(id) : Promise.resolve(null)),
        reconnect: run(() => center !== null && id !== undefined ? center.reconnect(id) : Promise.resolve(null)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [center, id, busy, view]);
}
/**
 * The dictionary-key mapping of the tri-state label — the single key source
 * for the React badge AND the DOM row-badge layer (row-badges, t8). The plain
 * legacy label map ({@link CONN_STATE_LABEL}) was removed in t15-r2: its last
 * consumer (the DOM row layer) migrated to the KEY mapping in t8, so the
 * frozen zh-only snapshot only ever threatened to drift from the dictionary.
 */
export const CONN_STATE_LABEL_KEY = {
    unknown: 'status.unknown',
    active: 'status.active',
    offline: 'status.offline',
};
export const CONN_STATE_COLOR = {
    unknown: '#8a8f98',
    active: '#98c379',
    offline: '#e06c75',
};
/**
 * The tri-state badge: colored dot + label, and (unless `compact`) the
 * "re-check and try to connect" button shown for unknown/offline entries.
 */
export function ConnStatusBadge({ id, rpc, center, compact = false, t: tSeat, }) {
    const t = tSeat ?? zhBaseline;
    const resolved = center !== undefined ? center : getStatusCenter(rpc, () => t);
    const { view, busy, reconnect } = useConnStatus(resolved, id);
    const state = view?.state ?? 'unknown';
    const label = busy ? t('status.checking') : t(CONN_STATE_LABEL_KEY[state]);
    const actionTitle = t('status.retryAction.title');
    return (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }, children: [_jsx("span", { title: view?.message !== undefined && view.message !== '' ? view.message : t(CONN_STATE_LABEL_KEY[state]), style: { width: 8, height: 8, borderRadius: '50%', background: CONN_STATE_COLOR[state], display: 'inline-block', flexShrink: 0 } }), _jsx("span", { style: { fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }, children: label }), state !== 'active' && (_jsx("button", { type: "button", title: actionTitle, disabled: busy, onClick: () => { void reconnect(); }, style: {
                    padding: compact ? '1px 5px' : '2px 6px',
                    borderRadius: 6,
                    border: '1px solid rgba(128,128,128,0.35)',
                    background: 'rgba(128,128,128,0.08)',
                    color: 'inherit',
                    cursor: busy ? 'default' : 'pointer',
                    fontSize: compact ? 10 : 11,
                    whiteSpace: 'nowrap',
                }, children: compact ? t('status.retryAction.compact') : t('status.retryAction.full') }))] }));
}
//# sourceMappingURL=status.js.map