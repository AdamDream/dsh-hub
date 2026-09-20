/**
 * The add-workspace directory flow of dsh-workspace-enhancement, laid out as a connection
 * sidebar beside a directory browser (VS Code Remote Explorer style): the
 * sidebar lists `~/.ssh/config` hosts (one click resolves, registers, and
 * browses — no form), saved connections, and the local entry; the right pane
 * browses whichever side is active. Picking a remote directory hands the owner
 * an `ssh://<id><path>` workspace path, which the deployment's remote
 * providers consume (see README for the workspace-adoption seam).
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WireListing, WireResult } from './index.ts';
/** Services the plugin injects into every registration. */
export interface FlowInjected {
    listLocalDirectory(path?: string, signal?: AbortSignal): Promise<WireListing>;
    createLocalDirectory(path: string, name: string): Promise<string>;
    rpc(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<WireResult>;
}
/**
 * The locale translate seat of the `dsw` namespace. The slot renderer injects
 * `t` when a registration declares `locale: 'dsw'` (src/client/index.ts, t7);
 * the type stays optional so nested call sites (side-workspaces, t7) compile
 * until they thread their own `t` — the runtime seat is always provided.
 */
export interface FlowTimed {
    t?: TranslateNS<'dsw'>;
}
/** The owner share of the directory-flow holes (see ui-workspace's contract). */
export interface FlowProps {
    open: boolean;
    busy: boolean;
    onPicked(path: string): void;
    onCancel(): void;
    onError(message: string): void;
    /**
     * Skip the host `session.route` adoption when a remote directory is picked:
     * no placeholder tree is created and no machine workspace is written back —
     * the raw `ssh://<id><posixPath>` spelling is handed to the owner instead
     * (the host normalizes it anyway). Defaults to false (unchanged behavior).
     */
    suppressSessionRoute?: boolean;
    /**
     * When non-empty, `open` turning true opens the dialog with that saved
     * connection as the current browse target — the same as clicking the
     * connection in the sidebar (remote mode + its home listed through
     * `browse.list`, including its error handling). An id that is not a saved
     * connection degrades to the default local-home browse; undefined/'' keeps
     * the current behavior. The value is snapshotted when `open` turns true;
     * later changes while the dialog stays open do not re-navigate.
     */
    initialConnectionId?: string;
    /**
     * Picker-only mode: the remote footer button reads「选择此目录」and hands the
     * raw `ssh://<id><posixPath>` spelling straight to `onPicked` — no
     * `session.route` adoption, no placeholder tree, no write-back (the same
     * delivery path as `suppressSessionRoute`). Takes precedence over
     * `suppressSessionRoute` when both are set. Defaults to false (unchanged
     * behavior).
     */
    pickOnly?: boolean;
}
/** The directory-flow occupant registered into both workspace holes. */
export declare function SshWorkspaceFlow(props: FlowProps & FlowInjected & FlowTimed): import("react").JSX.Element | null;
