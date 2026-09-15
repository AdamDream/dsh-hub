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
import type { WireResult } from './index.ts';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConnStatusView } from './status.tsx';
/**
 * The ONE row status-marker key: `data-dsw-conn-id` is the idempotence guard
 * (a row already marked for a connection is skipped) AND the paintConn match
 * key (F0: markRow used to write a different attribute than paintConn read,
 * so badges never painted). The badge element carries a separate copy of the
 * attribute for click delegation; this constant governs the ROW only.
 */
export declare const ROW_STATUS_KEY: "dswConnId";
/** Structural dataset face (HTMLElement.dataset satisfies it). */
export interface StatusDataset {
    dataset: Record<string, string | undefined>;
}
/**
 * Read the row's current connection marker (undefined = unmarked).
 * @param row - the row element.
 * @returns the connection id the row is marked for, when marked.
 */
export declare function rowStatusOf(row: StatusDataset): string | undefined;
/**
 * Mark a row for a connection (F0 single-attribute contract). Idempotent:
 * a row already marked for the SAME connection is untouched and reports
 * false; marking for a different connection replaces the marker (the old
 * badge belongs to an element that a React re-render replaces anyway).
 * @param row - the row element.
 * @param connId - the connection id.
 * @returns whether the row was newly marked.
 */
export declare function markRowStatus(row: StatusDataset, connId: string): boolean;
/** Clear the row's status marker (dispose path). */
export declare function clearRowStatus(row: StatusDataset): void;
/** One workspace registry row projection (title + canonical path). */
export interface RemoteWorkspaceRow {
    title: string;
    path: string;
}
/** One session list projection row (display title + cwd, when recorded). */
export interface RemoteSessionRow {
    title: string;
    cwd?: string;
}
/** The data feeds the badge layer reads (plain getters; the caller drives refresh). */
export interface RowBadgeSources {
    workspaces(): readonly RemoteWorkspaceRow[];
    sessions(): readonly RemoteSessionRow[];
}
/** The `/dsw` RPC face (chip shape; see index.ts). */
export type RowBadgeRpc = (endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<WireResult>;
/**
 * The locale face the badge layer consumes (structural; the framework
 * `ctx.locale` satisfies it): the stable per-namespace translate reference
 * (bind) plus the snapshot subscription that drives the language-switch
 * repaint of already-injected badges.
 */
export interface RowBadgeLocale {
    /** Stable per-namespace translate reference (LocaleRuntime.bind contract). */
    bind(ns: 'dsw'): TranslateNS<'dsw'>;
    /** Fires on every snapshot change (language switch AND dictionary registration). */
    subscribe(fn: () => void): () => void;
}
/** The badge texts a status view renders (state label + retry button). */
export interface BadgeTexts {
    stateLabel: string;
    buttonText: string;
    buttonTitle: string;
}
/**
 * Pure badge-text projection (t15-r2): resolves the state label plus the
 * retry button text/title for ONE language. `paintBadge` replays this after a
 * language switch, and the unit test pins the zh→en transition of the button
 * text and title (the in-place rewrite writes only changed values).
 * @param view - the connection status view.
 * @param compact - the row's compact variant (session child rows).
 * @param t - the translate seat (active language).
 */
export declare function badgeTextsOf(view: ConnStatusView, compact: boolean, t: TranslateNS<'dsw'>): BadgeTexts;
/**
 * Recover the registry connection id from a route placeholder path
 * (`.../dsw-routes/<id>/<remote path>` or the legacy `dsh-ssh-routes/` tree).
 * Mirrors the host's routeFromPlaceholder root/id rules.
 */
export declare function routeIdOf(path: string): string | undefined;
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
export declare function remoteWorkspaceIndex(workspaces: readonly RemoteWorkspaceRow[]): Map<string, string>;
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
export declare function remoteSessionIndex(sessions: readonly RemoteSessionRow[]): Map<string, string>;
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
export declare function markedRowStillQualifies(connId: string, title: string | null, index: Map<string, string>): boolean;
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
export declare const BADGE_MARK_KEY: "dswBadge";
/** The minimal span faces {@link rowTitleOf} reads (HTMLElement satisfies them). */
interface RowTitleSpanFace {
    textContent: string | null;
    querySelector(selector: string): unknown;
    closest(selector: string): unknown;
}
/** The minimal row face {@link rowTitleOf} reads (HTMLElement satisfies it). */
export interface RowTitleSource {
    querySelectorAll(selector: string): ArrayLike<RowTitleSpanFace>;
}
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
export declare function rowTitleOf(row: RowTitleSource): string | null;
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
export declare function isOwnBadgeMutation(target: Node | {
    closest(selector: string): unknown;
} | null | undefined): boolean;
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
export declare function installRowBadges(rpc: RowBadgeRpc, sources: RowBadgeSources, subscribe: (onChange: () => void) => () => void, locale?: RowBadgeLocale): () => void;
export {};
