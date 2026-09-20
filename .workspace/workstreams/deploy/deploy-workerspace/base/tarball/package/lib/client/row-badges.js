/**
 * Sidebar row enhancement — DOM compatibility layer (C3).
 *
 * The shipped workspace browser (ui-workspace's `sidebar.workspaces`
 * occupant) exposes no per-row slot, so the tri-state remote badge is
 * injected into the rendered list DOM instead: a MutationObserver watches the
 * document for the session tree, remote entries are matched by workspace /
 * session title against the workspace registry projection (paths under the
 * `dsw-routes` / `dsh-ssh-routes` placeholder roots), and each matched row is
 * decorated with a 🌐 + tri-state badge + a mini "re-check and try to
 * connect" button (unknown/offline only).
 *
 * Degradation contract (all deliberate, no exceptions):
 * - Missing/unexpected DOM shapes → the scan no-ops (latch after repeated
 *   failures; upstream re-renders are picked up by the observer).
 * - Unknown ids / RPC failures → badge stays on `unknown` with no button
 *   noise; the row is never duplicated (the single status-marker idempotence)
 *   and our insertions cannot loop (a re-scan after our own mutation inserts
 *   nothing).
 * - Flat-mode sessions are matched by title against the session projection
 *   (ambiguous titles are skipped); grouped sessions inherit their group's
 *   connection.
 * - C3 same-title guard: a remote title that ALSO belongs to a local
 *   workspace / session (path or cwd without a route placeholder root) is
 *   never marked — a missing badge is the accepted cost, a mis-mark is not.
 *   Remote↔remote ambiguity keeps the skip. Rebuild is 先清后标: badges whose
 *   row no longer qualifies are withdrawn before the next injection pass, so
 *   no stale badge can survive a same-title local workspace appearing, a
 *   remote workspace/session deletion, or a title rename.
 * - t6 (no self-sustaining loop): `rowTitleOf` excludes the badge subtree
 *   (badge-root `data-dsw-badge` mark) and the MutationObserver filters our
 *   own badge-paint mutations (target inside the badge subtree), so a
 *   converged scan performs ZERO DOM writes and zero self-induced scans.
 *
 * F0 regression guard: the row status marker is ONE attribute — markRowStatus
 * writes it, rowStatusOf reads it, and paintConn matches it. Both accessors
 * derive from {@link ROW_STATUS_KEY}, so the write/read keys can never drift
 * apart again.
 *
 * No new dependencies; no React; reversible through the returned disposer.
 * @module dsh-workspace-enhancement/client/row-badges
 */
import { CONN_STATE_COLOR, CONN_STATE_LABEL_KEY, zhBaseline } from "./status.js";
/**
 * The ONE row status-marker key: `data-dsw-conn-id` is the idempotence guard
 * (a row already marked for a connection is skipped) AND the paintConn match
 * key (F0: markRow used to write a different attribute than paintConn read,
 * so badges never painted). The badge element carries a separate copy of the
 * attribute for click delegation; this constant governs the ROW only.
 */
export const ROW_STATUS_KEY = 'dswConnId';
/**
 * Read the row's current connection marker (undefined = unmarked).
 * @param row - the row element.
 * @returns the connection id the row is marked for, when marked.
 */
export function rowStatusOf(row) {
    return row.dataset[ROW_STATUS_KEY];
}
/**
 * Mark a row for a connection (F0 single-attribute contract). Idempotent:
 * a row already marked for the SAME connection is untouched and reports
 * false; marking for a different connection replaces the marker (the old
 * badge belongs to an element that a React re-render replaces anyway).
 * @param row - the row element.
 * @param connId - the connection id.
 * @returns whether the row was newly marked.
 */
export function markRowStatus(row, connId) {
    if (row.dataset[ROW_STATUS_KEY] === connId)
        return false;
    row.dataset[ROW_STATUS_KEY] = connId;
    return true;
}
/** Clear the row's status marker (dispose path). */
export function clearRowStatus(row) {
    delete row.dataset[ROW_STATUS_KEY];
}
/** A status view while nothing has been probed yet. */
function unknownView(connId) {
    return {
        id: connId,
        state: 'unknown',
        connected: false,
        label: '',
        host: '',
        port: 22,
        username: '',
        hostKeyKnown: false,
    };
}
/** The `data-dsw-compact` badge attribute: the retry button text variant. */
const COMPACT_KEY = 'dswCompact';
/**
 * Pure badge-text projection (t15-r2): resolves the state label plus the
 * retry button text/title for ONE language. `paintBadge` replays this after a
 * language switch, and the unit test pins the zh→en transition of the button
 * text and title (the in-place rewrite writes only changed values).
 * @param view - the connection status view.
 * @param compact - the row's compact variant (session child rows).
 * @param t - the translate seat (active language).
 */
export function badgeTextsOf(view, compact, t) {
    return {
        stateLabel: t(CONN_STATE_LABEL_KEY[view.state]),
        buttonText: compact ? t('status.retryAction.compact') : t('status.retryAction.recheck'),
        buttonTitle: t('status.retryAction.title'),
    };
}
/**
 * Recover the registry connection id from a route placeholder path
 * (`.../dsw-routes/<id>/<remote path>` or the legacy `dsh-ssh-routes/` tree).
 * Mirrors the host's routeFromPlaceholder root/id rules.
 */
export function routeIdOf(path) {
    const match = /(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i.exec(path);
    if (match === null)
        return undefined;
    const id = match[1];
    if (id === undefined || !/^[A-Za-z0-9._-]+$/.test(id))
        return undefined;
    return id;
}
const STATUS_FRESH_MS = 5_000;
const STATUS_POLL_MS = 30_000;
const SCAN_DELAY_MS = 120;
const SCAN_MIN_GAP_MS = 300;
const MAX_CONSECUTIVE_FAILURES = 3;
/**
 * C3: grouped-view index — remote workspace title → connection id.
 *
 * A workspace is remote when its path carries a route placeholder root
 * (`dsw-routes` / legacy `dsh-ssh-routes`); every OTHER title (a local
 * workspace, or an unclassifiable path) forms the local-title set, and a
 * remote title that also exists there is DROPPED before any marking: a local
 * workspace named like a remote one must never be decorated as remote.
 * Remote↔remote ambiguity (two connections, one title) keeps the existing
 * skip — a missing badge is the accepted cost, a mis-mark is not.
 * @param workspaces - the full workspace projection (local + remote rows).
 * @returns title → connId (only unambiguous, non-colliding remote titles).
 */
export function remoteWorkspaceIndex(workspaces) {
    const localTitles = new Set();
    const byTitle = new Map();
    for (const workspace of workspaces) {
        if (workspace.title === '')
            continue;
        const connId = routeIdOf(workspace.path);
        if (connId === undefined) {
            localTitles.add(workspace.title);
            continue;
        }
        byTitle.set(workspace.title, [...(byTitle.get(workspace.title) ?? []), connId]);
    }
    const index = new Map();
    for (const [title, ids] of byTitle) {
        if (localTitles.has(title))
            continue; // 本地↔远程同名：跳过（C3）
        const unique = ids.filter((id, index) => ids.indexOf(id) === index);
        if (unique.length === 1 && unique[0] !== undefined)
            index.set(title, unique[0]);
    }
    return index;
}
/**
 * C3: flat-view index — remote session title → connection id.
 *
 * Sessions are remote when their recorded cwd carries a route placeholder
 * root; every other session (local cwd, or no cwd recorded — unjudgeable)
 * feeds the local-title set, and a remote title colliding with it is dropped:
 * a local/unknown session named like a remote one must never be marked in
 * flat mode. Remote↔remote ambiguity stays skipped.
 * @param sessions - the full session projection.
 * @returns title → connId (only unambiguous, non-colliding remote titles).
 */
export function remoteSessionIndex(sessions) {
    const localTitles = new Set();
    const byTitle = new Map();
    for (const session of sessions) {
        if (session.title === '')
            continue;
        const connId = session.cwd !== undefined ? routeIdOf(session.cwd) : undefined;
        if (connId === undefined) {
            localTitles.add(session.title);
            continue;
        }
        byTitle.set(session.title, [...(byTitle.get(session.title) ?? []), connId]);
    }
    const index = new Map();
    for (const [title, ids] of byTitle) {
        if (localTitles.has(title))
            continue; // 本地↔远程同名：跳过（C3）
        const unique = ids.filter((id, index) => ids.indexOf(id) === index);
        if (unique.length === 1 && unique[0] !== undefined)
            index.set(title, unique[0]);
    }
    return index;
}
/**
 * C3 撤回: whether one already-marked row still qualifies after a data change.
 * A marked row keeps its badge only when its CURRENT title still maps to the
 * connId it was marked for under the NEW index; everything else — a
 * same-title LOCAL workspace/session that appeared later, a remote
 * workspace/session deleted, a title renamed to something unindexed (or to
 * another connection), or an unreadable title — is withdrawn before the next
 * injection pass, so「重建=先清后标」and no injected badge can linger.
 * @param connId - the connId the row was marked for (rowStatusOf).
 * @param title - the row's current display title (null when unreadable).
 * @param index - the CURRENT (rebuilt) title → connId index of the row's view.
 * @returns whether the badge may stay.
 */
export function markedRowStillQualifies(connId, title, index) {
    return title !== null && index.get(title) === connId;
}
/**
 * `data-dsw-badge`: the ONE attribute marking OUR injected badge ROOT. The
 * badge ALSO carries `data-dsw-conn-id` (click delegation) while the ROW
 * carries the same attribute (F0 marker), so badge-subtree exclusion must key
 * on this dedicated mark — never on a nested conn-id. t6: without it
 * {@link rowTitleOf} returned the badge's own textContent (🌐 + state label +
 * even the display:none reconnect-button text — regularly LONGER than every
 * real title), the C3 撤回 step judged each marked row unmatched, and the
 * badge was withdrawn + re-injected on every scan: the self-sustaining loop.
 */
export const BADGE_MARK_KEY = 'dswBadge';
const BADGE_MARK_SELECTOR = '[data-dsw-badge]';
/**
 * The row's display title = the longest non-icon span OUTSIDE the injected
 * badge subtree. t6: badge root and children (marked `data-dsw-badge`) are
 * skipped — the badge's textContent includes the hidden reconnect button and
 * outgrows the real title, which made the C3 撤回 step see every marked row
 * as unmatched (withdraw + re-inject per scan). The 无变更 path needs this:
 * only the REAL title may drive qualification, or a converged scan never
 * converges.
 * @param row - the row (HTMLElement, or a structural fake in tests).
 * @returns the best real title, or null when nothing readable remains.
 */
export function rowTitleOf(row) {
    let best = '';
    for (const span of Array.from(row.querySelectorAll('span'))) {
        if (span.querySelector('svg') !== null)
            continue;
        if (span.closest(BADGE_MARK_SELECTOR) !== null)
            continue;
        const text = span.textContent?.trim() ?? '';
        if (text.length > best.length)
            best = text;
    }
    return best.length > 0 ? best : null;
}
/**
 * t6 观察器自诱过滤: is a MutationRecord's target INSIDE our badge subtree?
 * Our own badge PAINT writes (label textContent replacement; the only
 * childList mutation we ever perform inside a badge) would otherwise re-arm
 * the MutationObserver and schedule a scan that is guaranteed to be a
 * no-write — a self-induced scan per paint. With the badge-root mark, those
 * records are recognized and skipped, so a scan only ever runs for REAL
 * upstream changes (badge append/removal targets the ROW, not the badge, and
 * still schedules). Structural face (no Element/`instanceof` needed): the
 * browser passes `MutationRecord.target` = the mutated parent element.
 * @param target - the mutation record's target (or a structural fake).
 * @returns whether the mutation belongs to our own badge paint.
 */
export function isOwnBadgeMutation(target) {
    if (target === null || target === undefined)
        return false;
    // For childList records the browser's target is the mutated parent ELEMENT;
    // anything without closest (e.g. a text node) is not one of our paints.
    const element = target;
    if (element === null || typeof element.closest !== 'function')
        return false;
    return element.closest(BADGE_MARK_SELECTOR) !== null;
}
const isElement = (value) => value instanceof HTMLElement;
/**
 * Install the sidebar row enhancement. Returns the disposer (removes every
 * injected badge, listener, observer, subscription, and timer).
 * @param rpc - the `/dsw` channel call.
 * @param sources - workspace/session projections.
 * @param subscribe - drives a re-scan on feed changes (caller combines stores).
 * @param locale - the locale face (bind = read-time translate seat,
 *   subscribe = language-switch repaint of injected badges); omitted → zh
 *   baseline (pure-helper/test callers keep the pre-i18n texts).
 */
export function installRowBadges(rpc, sources, subscribe, locale) {
    if (typeof document === 'undefined')
        return () => { };
    // Read-time translate seat: a stable reference that resolves the ACTIVE
    // locale on every call, so a language switch needs no re-binding here.
    const t = locale !== undefined ? locale.bind('dsw') : zhBaseline;
    /** title → connId; ambiguous titles (two connections, one name) are dropped. */
    let remoteByTitle = new Map();
    let remoteSessionTitles = new Map();
    const statuses = new Map();
    const marked = new Map();
    let consecutiveFailures = 0;
    let disposed = false;
    let pendingScan = null;
    let lastScanAt = 0;
    const rebuildRemote = () => {
        // C3: both indexes drop titles that also belong to a LOCAL workspace /
        // session — an ambiguous title never mis-marks (see the index builders).
        remoteByTitle = remoteWorkspaceIndex(sources.workspaces());
        remoteSessionTitles = remoteSessionIndex(sources.sessions());
    };
    const fetchStatus = async (connId, force) => {
        const record = statuses.get(connId);
        if (!force && record !== undefined && Date.now() - record.at < STATUS_FRESH_MS)
            return record.view;
        const pendingInFlight = record?.pending;
        if (pendingInFlight !== undefined && pendingInFlight !== null)
            return pendingInFlight;
        const pending = (async () => {
            try {
                const result = await rpc('conn.status', { id: connId });
                if (!result.ok)
                    throw new Error(result.error.message);
                const view = result.value;
                if (typeof view !== 'object' || view === null || !('id' in view)) {
                    statuses.delete(connId);
                    return unknownView(connId);
                }
                const parsed = view;
                statuses.set(connId, { view: parsed, at: Date.now(), pending: null });
                return parsed;
            }
            catch {
                statuses.delete(connId);
                return unknownView(connId);
            }
        })();
        statuses.set(connId, {
            view: record?.view ?? unknownView(connId),
            at: record?.at ?? 0,
            pending,
        });
        return pending;
    };
    const paintBadge = (badge, view) => {
        const dot = badge.querySelector('[data-dsw-dot]');
        const label = badge.querySelector('[data-dsw-label]');
        const button = badge.querySelector('[data-dsw-action="reconnect"]');
        if (dot !== null)
            dot.style.background = CONN_STATE_COLOR[view.state];
        const texts = badgeTextsOf(view, badge.dataset[COMPACT_KEY] === '1', t);
        // t6: write only when the value CHANGES — a same-value textContent
        // assignment still mutates the child list, re-arming the MutationObserver
        // for nothing. The converged no-change path must not churn the DOM; the
        // SAME guard makes the language-switch repaint write only the texts that
        // actually differ (self-induced filter keeps it out of the scan loop).
        // t15-r2: the retry BUTTON text and title get the same value-guard
        // rewrite — a language switch previously updated the state label but left
        // the button copy/title in the old language.
        if (label !== null && label.textContent !== texts.stateLabel) {
            label.textContent = texts.stateLabel;
        }
        if (button !== null) {
            const display = view.state === 'active' ? 'none' : '';
            if (button.style.display !== display)
                button.style.display = display;
            if (button.textContent !== texts.buttonText)
                button.textContent = texts.buttonText;
            if (button.title !== texts.buttonTitle)
                button.title = texts.buttonTitle;
        }
    };
    const paintConn = (connId) => {
        const record = statuses.get(connId);
        if (record === undefined)
            return;
        for (const [row, badge] of marked) {
            // Single attribute contract (F0): rowStatusOf is the paintConn key and
            // the idempotence guard — never a second marker.
            if (rowStatusOf(row) === connId)
                paintBadge(badge, record.view);
        }
    };
    /**
     * Language-switch repaint (design §7.3): re-derive every injected badge's
     * texts in place. paintBadge's value guard writes only texts that actually
     * differ, and the writes are badge-subtree mutations the observer filter
     * (isOwnBadgeMutation) skips — no scan storm, no badge DOM rebuild.
     */
    const repaintAll = () => {
        for (const [row, badge] of marked) {
            const connId = rowStatusOf(row);
            if (connId === undefined)
                continue;
            paintBadge(badge, statuses.get(connId)?.view ?? unknownView(connId));
        }
    };
    const refreshConn = async (connId, force) => {
        const view = await fetchStatus(connId, force);
        if (disposed)
            return;
        const record = statuses.get(connId);
        if (record !== undefined)
            record.view = view;
        paintConn(connId);
    };
    const buildBadge = (connId, compact) => {
        const badge = document.createElement('span');
        badge.dataset.dswConnId = connId;
        // t6: the badge-root mark rowTitleOf skips (see BADGE_MARK_KEY).
        badge.dataset[BADGE_MARK_KEY] = '1';
        // t15-r2: record the compact variant so the language-switch repaint can
        // re-resolve the retry button text (compact vs recheck) without rebuilding.
        badge.dataset[COMPACT_KEY] = compact ? '1' : '0';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin:0 4px;vertical-align:middle;flex-shrink:0;user-select:none;';
        const globe = document.createElement('span');
        globe.textContent = '🌐';
        globe.style.cssText = 'font-size:11px;line-height:1;';
        const dot = document.createElement('span');
        dot.dataset.dswDot = '';
        dot.style.cssText = 'width:7px;height:7px;border-radius:50%;display:inline-block;background:' + CONN_STATE_COLOR.unknown + ';';
        const label = document.createElement('span');
        label.dataset.dswLabel = '';
        label.style.cssText = 'font-size:11px;opacity:.85;white-space:nowrap;';
        label.textContent = t(CONN_STATE_LABEL_KEY.unknown);
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.dswAction = 'reconnect';
        button.title = t('status.retryAction.title');
        button.textContent = compact ? t('status.retryAction.compact') : t('status.retryAction.recheck');
        button.style.cssText = 'padding:0 5px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.12);color:inherit;cursor:pointer;font-size:10px;line-height:16px;white-space:nowrap;';
        badge.append(globe, dot, label, button);
        return badge;
    };
    const markRow = (row, connId, compact) => {
        // Single status-marker contract (F0): markRowStatus both checks and sets
        // the ONE attribute paintConn reads — never a second marker.
        if (!markRowStatus(row, connId))
            return;
        const badge = buildBadge(connId, compact);
        // Append at the row END: the badge stays outside the React-managed child
        // list (the row is keyed by session id and never re-created while listed,
        // but reconciliation is safest when a foreign node never sits between two
        // React children). Upstream rows: [slot…, title, time, rowActions] →
        // [slot…, title, time, rowActions, badge].
        row.appendChild(badge);
        marked.set(row, badge);
        void refreshConn(connId, false);
    };
    /**
     * C3 撤回: withdraw every injected badge whose row no longer qualifies
     * under the CURRENT indexes before the next injection pass
     * (「重建=先清后标」 — otherwise a data change — same-title local workspace
     * appearing, a remote workspace/session deleted, a title renamed — leaves
     * stale badges on rows that must no longer look remote). Grouped session
     * children inherit their section's group row: they stay only while that
     * group still qualifies. Runs on every scan; a no-op while nothing changed.
     */
    const withdrawStale = () => {
        for (const [row, badge] of [...marked]) {
            const connId = rowStatusOf(row);
            if (connId === undefined) {
                // Orphaned badge (marker cleared elsewhere): remove and forget.
                badge.remove();
                marked.delete(row);
                continue;
            }
            const tree = row.closest('[role="tree"]');
            if (tree === null)
                continue; // detached rows are pruned by the caller
            // Same view detection as scan(): grouped = the tree carries group rows.
            const grouped = Array.from(tree.querySelectorAll('[role="treeitem"][aria-expanded]')).length > 0;
            const title = rowTitleOf(row);
            let qualify = false;
            if (grouped) {
                if (row.getAttribute('aria-expanded') !== null) {
                    qualify = markedRowStillQualifies(connId, title, remoteByTitle);
                }
                else {
                    // Grouped session child: inherits its section's marked group row.
                    const section = row.parentElement;
                    const group = section === null ? undefined : Array.from(section.children).find((child) => isElement(child)
                        && child !== row
                        && rowStatusOf(child) === connId
                        && child.getAttribute('role') === 'treeitem'
                        && child.getAttribute('aria-expanded') !== null);
                    qualify = group !== undefined && markedRowStillQualifies(connId, rowTitleOf(group), remoteByTitle);
                }
            }
            else {
                qualify = markedRowStillQualifies(connId, title, remoteSessionTitles);
            }
            if (qualify)
                continue;
            badge.remove();
            clearRowStatus(row);
            marked.delete(row);
        }
    };
    const scan = () => {
        if (disposed || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES)
            return;
        try {
            // Prune decorations on rows React already replaced (detached nodes).
            for (const [row, badge] of marked) {
                if (!row.isConnected) {
                    badge.remove();
                    marked.delete(row);
                }
            }
            // C3 撤回: clear badges that no longer qualify FIRST, then inject below.
            withdrawStale();
            const trees = Array.from(document.querySelectorAll('[role="tree"]'));
            for (const tree of trees) {
                const groupRows = Array.from(tree.querySelectorAll('[role="treeitem"][aria-expanded]'));
                if (groupRows.length > 0) {
                    // Grouped view: workspace rows by title; their section's session
                    // rows inherit the connection (no title parsing needed there).
                    for (const row of groupRows) {
                        const title = rowTitleOf(row);
                        const connId = title !== null ? remoteByTitle.get(title) : undefined;
                        if (connId === undefined)
                            continue;
                        markRow(row, connId, false);
                        const section = row.parentElement;
                        if (section === null)
                            continue;
                        for (const child of Array.from(section.children)) {
                            if (child === row || !isElement(child))
                                continue;
                            if (child.getAttribute('role') !== 'treeitem')
                                continue;
                            if (rowStatusOf(child) === connId)
                                continue;
                            markRow(child, connId, true);
                        }
                    }
                }
                else if (remoteSessionTitles.size > 0) {
                    // Flat list / search: session rows matched by display title.
                    for (const row of Array.from(tree.querySelectorAll('[role="treeitem"]'))) {
                        const title = rowTitleOf(row);
                        if (title === null)
                            continue;
                        const connId = remoteSessionTitles.get(title);
                        if (connId === undefined)
                            continue;
                        markRow(row, connId, false);
                    }
                }
            }
            consecutiveFailures = 0;
        }
        catch (error) {
            consecutiveFailures += 1;
            if (consecutiveFailures === 1) {
                console.debug('dsw: sidebar row badges scan failed (degrading):', error);
            }
        }
    };
    const scheduleScan = () => {
        if (disposed || pendingScan !== null)
            return;
        const elapsed = Date.now() - lastScanAt;
        const delay = elapsed >= SCAN_MIN_GAP_MS ? SCAN_DELAY_MS : SCAN_MIN_GAP_MS - elapsed + SCAN_DELAY_MS;
        pendingScan = setTimeout(() => {
            pendingScan = null;
            lastScanAt = Date.now();
            scan();
        }, delay);
    };
    const onChange = () => {
        rebuildRemote();
        scheduleScan();
    };
    const onClick = (event) => {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        const button = target.closest('[data-dsw-action="reconnect"]');
        if (button === null)
            return;
        const badge = button.closest('[data-dsw-conn-id]');
        const connId = badge?.dataset.dswConnId;
        if (badge === null || badge === undefined || connId === undefined)
            return;
        event.preventDefault();
        event.stopPropagation();
        const label = badge.querySelector('[data-dsw-label]');
        if (label !== null)
            label.textContent = t('status.connecting');
        // The button semantics are reconnect (dispose + rebuild + probe), not a
        // mere status read; the fresh view lands in the status map on resolution.
        void rpc('conn.reconnect', { id: connId })
            .then(result => {
            if (!result.ok)
                throw new Error(result.error.message);
            const view = result.value;
            if (typeof view === 'object' && view !== null && 'id' in view) {
                const parsed = view;
                statuses.set(connId, { view: parsed, at: Date.now(), pending: null });
                paintConn(connId);
            }
        })
            .catch(() => { void refreshConn(connId, true).catch(() => undefined); });
    };
    // t6: skip OUR OWN badge paint mutations (target inside a `data-dsw-badge`
    // subtree) — otherwise every paint re-armed the observer for a guaranteed
    // no-write scan; a scan now runs only for real upstream changes (our
    // badge append/removal targets the ROW and still schedules).
    const observer = new MutationObserver(records => {
        if (records.some(record => !isOwnBadgeMutation(record.target)))
            scheduleScan();
    });
    const unsubscribe = subscribe(onChange);
    // Language switch → in-place repaint of every injected badge (a dictionary
    // registration at boot is a no-op: nothing is marked yet). The subscription
    // is released by the returned disposer with everything else.
    const unsubscribeLocale = locale !== undefined ? locale.subscribe(repaintAll) : undefined;
    const rootTarget = document.body ?? document.documentElement;
    observer.observe(rootTarget, { childList: true, subtree: true });
    document.addEventListener('click', onClick, true);
    const pollTimer = setInterval(() => {
        if (marked.size === 0 || disposed)
            return;
        const connIds = new Set();
        for (const badge of marked.values()) {
            const connId = badge.dataset.dswConnId;
            if (connId !== undefined)
                connIds.add(connId);
        }
        for (const connId of connIds) {
            void refreshConn(connId, true).catch(() => undefined);
        }
    }, STATUS_POLL_MS);
    onChange();
    return () => {
        disposed = true;
        observer.disconnect();
        document.removeEventListener('click', onClick, true);
        clearInterval(pollTimer);
        if (pendingScan !== null)
            clearTimeout(pendingScan);
        for (const [row, badge] of marked) {
            badge.remove();
            clearRowStatus(row);
        }
        marked.clear();
        statuses.clear();
        unsubscribeLocale?.();
        unsubscribe();
    };
}
//# sourceMappingURL=row-badges.js.map