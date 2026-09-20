import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useRef, useState } from 'react';
import { SshWorkspaceFlow } from "./flow.js";
import { zhBaseline } from "./status.js";
import { CloseIcon, FolderIcon, PlusIcon, ServerIcon, TrashIcon } from "./icons.js";
import styles from './side-workspaces.module.css';
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
function asSideWorkspaceRow(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string' || typeof value.rootKey !== 'string')
        return null;
    return {
        id: value.id,
        kind: value.kind === 'remote' ? 'remote' : 'local',
        rootKey: value.rootKey,
        label: typeof value.label === 'string' ? value.label : value.rootKey,
        fs: value.fs === 'r' ? 'r' : 'rw',
        exec: value.exec === 'off' ? 'off' : 'on',
    };
}
function asMachine(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string')
        return null;
    const label = typeof value.label === 'string' && value.label !== '' ? value.label : value.id;
    const host = typeof value.host === 'string' ? value.host : '';
    const username = typeof value.username === 'string' ? value.username : '';
    return { id: value.id, label, host, username };
}
function unwrap(result, t) {
    if (result.ok)
        return result.value;
    throw new Error(result.error?.message ?? t('side.rpc.failed'));
}
/**
 * The flow delivers a remote pick either as its raw `ssh://<id><posixPath>`
 * spelling (pickOnly / suppressSessionRoute) or as the local placeholder that
 * stands in for a remote route (`<DSH_HOME>/dsw-routes/<id>/<path>`, or the
 * legacy `dsh-ssh-routes` spelling). Detect both; the host normalizes either
 * into the same registry-backed root key.
 */
const isRemoteSpelling = (path) => /^ssh:\/\//.test(path) || /[\\/](dsw-routes|dsh-ssh-routes)[\\/]/.test(path);
/** The trigger: one per-session button in the header action row. */
export function SideWorkspacesAction(props) {
    const t = props.t ?? zhBaseline;
    const [open, setOpen] = useState(false);
    return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: styles.action, onClick: () => setOpen(value => !value), title: t('side.headerAction.title'), children: [_jsx(PlusIcon, { width: 13, height: 13 }), t('side.headerAction.label')] }), open ? _jsx(SideWorkspacesPanel, { sessionId: props.sessionId, injected: props, t: t, onClose: () => setOpen(false) }) : null] }));
}
/** The per-session side-workspaces manager. */
export function SideWorkspacesPanel(props) {
    const { sessionId, injected, onClose, t: tSeat } = props;
    const t = tSeat ?? zhBaseline;
    const [items, setItems] = useState([]);
    const [machines, setMachines] = useState([]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [draftKind, setDraftKind] = useState('local');
    const [draftPath, setDraftPath] = useState('');
    const [draftMachine, setDraftMachine] = useState('');
    const [draftLabel, setDraftLabel] = useState('');
    const [draftFs, setDraftFs] = useState('rw');
    const [draftExec, setDraftExec] = useState('on');
    const [browseOpen, setBrowseOpen] = useState(false);
    const [editing, setEditing] = useState(''); // rootKey being label-edited
    const [editingLabel, setEditingLabel] = useState('');
    const cardRef = useRef(null);
    const refresh = () => {
        setBusy(true);
        setError('');
        Promise.all([
            injected.rpc('session.ws.list', { sessionId }),
            injected.rpc('machines.list', {}),
        ]).then(([listResult, machinesResult]) => {
            const listValue = unwrap(listResult, t);
            setItems(Array.isArray(listValue.items) ? listValue.items.map(asSideWorkspaceRow).filter((row) => row !== null) : []);
            const machinesValue = unwrap(machinesResult, t);
            const rows = Array.isArray(machinesValue.machines) ? machinesValue.machines.map(asMachine).filter((row) => row !== null) : [];
            setMachines(rows);
            setDraftMachine(current => current !== '' ? current : (rows[0]?.id ?? ''));
            setBusy(false);
        }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setBusy(false);
        });
    };
    useEffect(() => {
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);
    const draftPathSpelling = () => {
        const path = draftPath.trim();
        if (path === '')
            return '';
        return draftKind === 'remote' ? `ssh://${draftMachine}${path}` : path;
    };
    /**
     * A pick from the shared flow: fill the draft back into the form. The flow
     * runs in pickOnly mode, so a remote pick arrives as the raw
     * `ssh://<id>/<posix>` spelling and a local pick as an absolute path;
     * mounting only goes through the「挂载」button — no `session.ws.add` here.
     */
    const handlePicked = (path) => {
        setError('');
        if (/^ssh:\/\//.test(path)) {
            // `ssh://<id>/<posix>` → the first segment after the scheme is the
            // machine id (registry ids never contain '/'), the remainder the POSIX
            // path in `/xxx` form. `'ssh://'` is 6 characters — slice by its exact
            // length so the id is never truncated.
            const segments = path.slice('ssh://'.length).split('/');
            const id = segments.shift() ?? '';
            setDraftKind('remote');
            setDraftMachine(id);
            setDraftPath(`/${segments.join('/')}`);
        }
        else if (isRemoteSpelling(path)) {
            // Defensive: pickOnly no longer produces placeholder spellings, but a
            // legacy dsw-routes / dsh-ssh-routes path still means a remote root —
            // recover the registry id and the POSIX path (the placeholder joins the
            // remote segments with OS separators, so normalize them back to '/'),
            // so the draft can be re-spelled as ssh://<id>/<path> on mount. Never
            // put the placeholder itself into draftPath: the 挂载 spelling would
            // wrap it again, and the host would reject it.
            const match = /[\\/](dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(path);
            if (match === null) {
                setError(t('side.error.unresolvedPath'));
                setBrowseOpen(false);
                return;
            }
            const rest = (match[3] ?? '').split(/[\\/]+/).filter(segment => segment !== '').join('/');
            setDraftKind('remote');
            setDraftMachine(match[2] ?? '');
            setDraftPath(rest === '' ? '/' : `/${rest}`);
        }
        else {
            setDraftKind('local');
            setDraftPath(path);
        }
        setBrowseOpen(false);
    };
    const addSide = () => {
        const path = draftPathSpelling();
        if (draftKind === 'remote' && draftMachine === '') {
            setError(t('side.error.noMachine'));
            return;
        }
        if (path === '') {
            setError(draftKind === 'remote' ? t('side.error.path.remote') : t('side.error.path.local'));
            return;
        }
        setBusy(true);
        setError('');
        injected.rpc('session.ws.add', {
            sessionId,
            id: `sw-${Date.now().toString(36)}`,
            kind: draftKind,
            path,
            ...(draftLabel.trim() !== '' ? { label: draftLabel.trim() } : {}),
            fs: draftFs,
            exec: draftExec,
        }).then(() => {
            setDraftPath('');
            setDraftLabel('');
            setBusy(false);
            refresh();
        }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setBusy(false);
        });
    };
    const updateSide = (rootKey, patch) => {
        injected.rpc('session.ws.update', { rootKey, ...patch }).then(() => refresh())
            .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    };
    const updateLabel = (rootKey, label) => {
        if (label.trim() === '') {
            setEditing('');
            return;
        }
        injected.rpc('session.ws.update', { rootKey, label: label.trim() }).then(() => {
            setEditing('');
            refresh();
        }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    };
    const removeSide = (rootKey) => {
        injected.rpc('session.ws.remove', { sessionId, rootKey }).then(() => refresh())
            .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    };
    return (_jsxs("div", { className: styles.panel, onClick: (event) => { if (event.target === event.currentTarget)
            onClose(); }, children: [_jsxs("div", { ref: cardRef, className: styles.card, role: "dialog", "aria-label": t('side.card.label'), onKeyDown: (event) => { if (event.key === 'Escape')
                    onClose(); }, children: [_jsxs("div", { className: styles.header, children: [_jsx("strong", { className: styles.title, children: t('side.card.title') }), _jsx("button", { type: "button", className: styles.iconButton, onClick: onClose, "aria-label": t('side.close.label'), children: _jsx(CloseIcon, { width: 14, height: 14 }) })] }), error !== '' ? _jsx("div", { className: styles.error, children: error }) : null, _jsxs("div", { className: styles.list, children: [busy && items.length === 0 ? _jsx("div", { className: styles.loading, children: t('side.loading') }) : null, items.length === 0 ? _jsx("div", { className: styles.empty, children: t('side.empty') }) : null, items.map(item => (_jsxs("div", { className: styles.row, children: [item.kind === 'remote' ? _jsx(ServerIcon, { className: styles.rowIcon, width: 13, height: 13 }) : _jsx(FolderIcon, { className: styles.rowIcon, width: 13, height: 13 }), editing === item.rootKey
                                        ? (_jsx("input", { className: styles.input, value: editingLabel, onChange: (event) => setEditingLabel(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter')
                                                updateLabel(item.rootKey, editingLabel); } }))
                                        : _jsx("span", { className: styles.itemLabel, children: item.label }), _jsx("span", { className: styles.rowPath, title: item.rootKey, children: item.rootKey }), _jsxs("select", { className: styles.select, value: item.fs, onChange: (event) => updateSide(item.rootKey, { fs: event.target.value }), "aria-label": t('side.fs.label'), children: [_jsx("option", { value: "rw", children: t('permission.rw') }), _jsx("option", { value: "r", children: t('permission.r') })] }), _jsxs("select", { className: styles.select, value: item.exec, onChange: (event) => updateSide(item.rootKey, { exec: event.target.value }), "aria-label": t('side.exec.label'), children: [_jsx("option", { value: "on", children: t('permission.execOn') }), _jsx("option", { value: "off", children: t('permission.execOff') })] }), _jsx("button", { type: "button", className: styles.renameButton, title: t('side.rename.title'), onClick: () => { setEditing(item.rootKey); setEditingLabel(item.label); }, children: t('side.rename.button') }), _jsx("button", { type: "button", className: `${styles.iconButton} ${styles.danger}`, title: t('side.remove.title'), onClick: () => removeSide(item.rootKey), children: _jsx(TrashIcon, { width: 13, height: 13 }) })] }, item.rootKey)))] }), _jsxs("div", { className: styles.form, children: [_jsxs("div", { className: styles.segment, role: "group", "aria-label": t('side.kind.label'), children: [_jsx("button", { type: "button", className: draftKind === 'local' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton, onClick: () => setDraftKind('local'), children: t('side.kind.local') }), _jsx("button", { type: "button", className: draftKind === 'remote' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton, onClick: () => setDraftKind('remote'), children: t('side.kind.remote') })] }), draftKind === 'remote' ? (_jsx("select", { className: `${styles.select} ${styles.selectWide}`, value: draftMachine, onChange: (event) => setDraftMachine(event.target.value), "aria-label": t('side.machine.label'), children: machines.map(machine => _jsx("option", { value: machine.id, children: machine.label }, machine.id)) })) : null, _jsxs("div", { className: styles.fieldRow, children: [_jsx("input", { className: styles.input, placeholder: draftKind === 'remote' ? t('side.draft.path.remote') : t('side.draft.path.local'), value: draftPath, onChange: (event) => setDraftPath(event.target.value) }), _jsx("button", { type: "button", className: styles.button, onClick: () => setBrowseOpen(true), children: t('side.browse') })] }), _jsxs("div", { className: styles.fieldRow, children: [_jsx("input", { className: styles.input, placeholder: t('side.draft.labelPlaceholder'), value: draftLabel, onChange: (event) => setDraftLabel(event.target.value) }), _jsxs("select", { className: styles.select, value: draftFs, onChange: (event) => setDraftFs(event.target.value), "aria-label": t('side.fs.label'), children: [_jsx("option", { value: "rw", children: t('permission.rw') }), _jsx("option", { value: "r", children: t('permission.r') })] }), _jsxs("select", { className: styles.select, value: draftExec, onChange: (event) => setDraftExec(event.target.value), "aria-label": t('side.exec.label'), children: [_jsx("option", { value: "on", children: t('permission.execOn') }), _jsx("option", { value: "off", children: t('permission.execOff') })] }), _jsx("button", { type: "button", className: `${styles.button} ${styles.primary}`, disabled: busy, onClick: addSide, children: t('side.mount') })] })] })] }), _jsx(SshWorkspaceFlow, { open: browseOpen, busy: busy, suppressSessionRoute: true, pickOnly: true, initialConnectionId: draftKind === 'remote' ? draftMachine : '', onPicked: handlePicked, onCancel: () => setBrowseOpen(false), onError: (message) => setError(message), listLocalDirectory: injected.listLocalDirectory, createLocalDirectory: injected.createLocalDirectory, rpc: injected.rpc, t: t })] }));
}
//# sourceMappingURL=side-workspaces.js.map