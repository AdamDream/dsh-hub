/**
 * R5: the session header action「⊕ 工作区」and its side-workspaces panel —
 * one session's attached extra roots (local dirs / remote machine dirs), each
 * with its permission pair (fs r|rw, exec on|off). Add/edit/remove ride the
 * `/dsw session.ws.*` endpoints; the picker reuses the shared add-workspace
 * directory flow (`SshWorkspaceFlow`), so local and remote browsing go through
 * the very same modal the main add-workspace flow uses. Registered into
 * `conversation.session.header.actions` (official additive list slot; the
 * framework passes `sessionId` as a standard prop).
 * @module dsh-workspace-enhancement/client/side-workspaces
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { FlowInjected } from './flow.tsx';
/** One side workspace as the wire returns it. */
export interface SideWorkspaceRow {
    id: string;
    kind: 'local' | 'remote';
    rootKey: string;
    label: string;
    fs: 'r' | 'rw';
    exec: 'on' | 'off';
}
/** The trigger: one per-session button in the header action row. */
export declare function SideWorkspacesAction(props: FlowInjected & {
    sessionId: string;
    t?: TranslateNS<'dsw'>;
}): JSX.Element;
/** The per-session side-workspaces manager. */
export declare function SideWorkspacesPanel(props: {
    sessionId: string;
    injected: FlowInjected;
    t?: TranslateNS<'dsw'>;
    onClose: () => void;
}): JSX.Element;
