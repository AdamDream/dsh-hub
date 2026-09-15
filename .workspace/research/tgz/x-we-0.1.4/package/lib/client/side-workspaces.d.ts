/**
 * R5 → REQ-I7 → REQ-I11: the session header action「⊕ 工作区」and its panel — now
 * the session workspace COCKPIT (ADR-0021 §2.9), three visibly separated
 * sections:
 *
 *   1. 主工作区 — read-only: the registry machine + remote path this session's cwd
 *      routes to, or the local-session copy;
 *   2. 副工作区 — the side-root declaration list and its mount/unmount/rename
 *      behaviour, unchanged (add/edit/remove over the `session.ws.*` endpoints);
 *   3. 已连接的机器 — one toggle per registry machine, reflecting
 *      `session.conn.list` and writing `session.conn.connect` /
 *      `session.conn.disconnect` — the SAME store `sw_connect` writes, re-read
 *      after every mutation so the panel and the model cannot disagree
 *      (ADR-0021 §0/§2.9).
 *
 * Every judgment (which rows exist, where the session works, which toggle is on,
 * how an unknown machine id is handled) lives in `./cockpit.ts`, pure and
 * sandbox-testable; this file only renders it and drives the wire. The picker
 * reuses the shared add-workspace directory flow (`SshWorkspaceFlow`) in
 * `pickOnly` mode, so local and remote browsing go through the very same modal
 * the main add-workspace flow uses.
 *
 * Registered into `conversation.session.header.actions` (official additive list
 * slot; the framework passes `sessionId` as a standard prop, `index.ts` injects
 * the directory seats and the session-feed seats the main-workspace section
 * reads — the same `remoteFacts`/`subscribeRemote` pair the remote-status header
 * cell consumes).
 * @module dsh-workspace-enhancement/client/side-workspaces
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { FlowInjected } from './flow.tsx';
import type { RemoteStatusSeats } from './remote-status.ts';
/** The side-row shape as the wire returns it (REQ-I7: declaration only). */
export type { CockpitSideRow as SideWorkspaceRow } from './cockpit.ts';
/** The props the cockpit receives: its seats, the session, the wire, the seat. */
export interface SideWorkspacesProps extends FlowInjected {
    /** The session the framework scopes this header action to. */
    sessionId: string;
    /** Typed translate seat injected by the slot (defaults to the zh baseline). */
    t?: TranslateNS<'dsw'>;
    /** The session's facts (injected; optional so a seat-less renderer still mounts). */
    remoteFacts?: RemoteStatusSeats['remoteFacts'];
    /** Session-feed change events (injected; the main section follows the cwd). */
    subscribeRemote?: RemoteStatusSeats['subscribeRemote'];
}
/** The trigger: one per-session button in the header action row. */
export declare function SideWorkspacesAction(props: SideWorkspacesProps): JSX.Element;
/** The per-session workspace cockpit: main workspace + side roots + connections. */
export declare function SideWorkspacesPanel(props: SideWorkspacesProps & {
    injected: FlowInjected;
    onClose: () => void;
}): JSX.Element;
