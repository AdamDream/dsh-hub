import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MachineForm } from "./machine-form.js";
import { useDialogA11y } from "./ui.js";
import { CloseIcon } from "./icons.js";
import styles from './flow.module.css';
/** Map the sidebar's draft onto the shared form's initial state. */
function draftToInitial(draft) {
    if (draft === undefined)
        return undefined;
    return {
        ...(draft.label !== undefined ? { name: draft.label } : {}),
        ...(draft.host !== undefined ? { host: draft.host } : {}),
        ...(draft.port !== undefined ? { port: draft.port } : {}),
        ...(draft.username !== undefined ? { username: draft.username } : {}),
        ...(draft.privateKeyPath !== undefined ? { privateKeyPath: draft.privateKeyPath } : {}),
        ...(draft.jumpText !== undefined ? { jumpText: draft.jumpText } : {}),
        ...(draft.cwd !== undefined ? { workspace: draft.cwd } : {}),
        ...(draft.focusUsername === true ? { focusUsername: true } : {}),
    };
}
/** The connection form modal (masked password, 密码/私钥二选一). */
export function ConnectionForm({ rpc, draft, t, onClose, onSaved }) {
    const dialogRef = useDialogA11y(true, onClose);
    return (_jsx("div", { className: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget)
            onClose(); }, children: _jsxs("div", { className: styles.form, role: "dialog", "aria-modal": "true", "aria-label": t('form.dialog.label'), ref: dialogRef, children: [_jsxs("div", { className: styles.formHead, children: [_jsxs("div", { className: styles.formHeadText, children: [_jsx("h3", { className: styles.formTitle, children: t('form.title') }), _jsx("p", { className: styles.formSub, children: t('form.subtitle') })] }), _jsx("button", { type: "button", className: styles.iconButton, "aria-label": t('form.close.label'), onClick: onClose, children: _jsx(CloseIcon, {}) })] }), _jsx("div", { className: styles.formGrid, children: _jsx(MachineForm, { mode: "flow", rpc: rpc, initial: draftToInitial(draft), t: t, onSaved: onSaved, onCancel: onClose }) })] }) }));
}
//# sourceMappingURL=form.js.map