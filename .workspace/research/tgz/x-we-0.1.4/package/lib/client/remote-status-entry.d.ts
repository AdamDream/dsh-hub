/**
 * The header-action VIEW of the remote-status entry (REQ-I2 entry point). All
 * judgments live in `./remote-status.ts` — this file only renders them, because
 * the sandbox runner never executes `.tsx`.
 *
 * One row in the session header action strip: the tri-state state of the
 * connection the current session's cwd routes to (dot + state label), plus a
 * click that re-checks and reconnects. A local session renders nothing at all —
 * the strip stays exactly as upstream built it.
 * @module dsh-workspace-enhancement/client/remote-status-entry
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteStatusSeats } from './remote-status.ts';
import type { RpcCall } from './status.tsx';
/** The props this entry receives: its seats, the session, the wire, the seat. */
export interface RemoteStatusActionProps extends RemoteStatusSeats {
    /** The session the framework scopes this row to. */
    sessionId: string;
    /** The `/dsw` channel call (conn.status / conn.reconnect). */
    rpc: RpcCall;
    /** Typed translate seat injected by the slot (defaults to the zh baseline). */
    t?: TranslateNS<'dsw'>;
}
/** The remote-status row: dot + state label, click = re-check and reconnect. */
export declare function RemoteStatusAction(props: RemoteStatusActionProps): JSX.Element | null;
