/**
 * The flow's connection-form shell (R2 表单并集): the modal chrome —
 * overlay, dialog, head, close — around the shared {@link MachineForm}
 * (mode="flow"). All field/interaction logic lives in the shared component;
 * this shell only maps a config-host `draft` to the form's `initial` and
 * forwards the saved view back to the flow (「保存并浏览」→ sidebar select +
 * remote-directory browse).
 * @module dsh-workspace-enhancement/client/form
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { RpcCall } from './status.tsx';
import type { MachineSaveView } from './machine-form.tsx';
/** Prefilled fields for a form opened from the sidebar (config host / auth fix). */
export interface ConnectionDraft {
    label?: string;
    host?: string;
    port?: string;
    username?: string;
    privateKeyPath?: string;
    jumpText?: string;
    cwd?: string;
    /** Focus the username field on open (the missing piece the user must fill). */
    focusUsername?: boolean;
}
export interface ConnectionFormProps {
    /** The `/dsw` RPC channel (the shared form drives resolve/test/save itself). */
    rpc: RpcCall;
    /** Prefilled fields, when the sidebar opened the form for one config host. */
    draft?: ConnectionDraft | undefined;
    /** Typed translate seat of the `dsw` namespace (threaded from the flow). */
    t: TranslateNS<'dsw'>;
    /** The operator dismissed the form. */
    onClose(): void;
    /** A connection was saved; the flow switches the browser to it. */
    onSaved(view: MachineSaveView): void;
}
/** The connection form modal (masked password, 密码/私钥二选一). */
export declare function ConnectionForm({ rpc, draft, t, onClose, onSaved }: ConnectionFormProps): import("react").JSX.Element;
