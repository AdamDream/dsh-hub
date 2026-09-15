import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useRef, useState } from 'react';
import { SshWorkspaceFlow } from "./flow.js";
import { asConnectedIds, asMachineRows, asSideRows, cockpitViewOf, machineEndpointOf, toggleRequest, } from "./cockpit.js";
import { zhBaseline } from "./status.js";
import { CloseIcon, FolderIcon, PlusIcon, ServerIcon, TrashIcon } from "./icons.js";
import styles from './side-workspaces.module.css';
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
/**
 * Follow the session's recorded cwd across feed changes (the main-workspace
 * section's only input). The seat functions are stable across renders (apply
 * builds them once); a seat-less renderer degrades to "local session" rather
 * than throwing inside the panel's render.
 */
function useSessionCwd(props) {
    const { sessionId, remoteFacts, subscribeRemote } = props;
    const [cwd, setCwd] = useState(() => remoteFacts?.(sessionId)?.cwd);
    useEffect(() => {
        if (remoteFacts === undefined) {
            setCwd(undefined);
            return;
        }
        const sync = () => {
            const next = remoteFacts(sessionId)?.cwd;
            setCwd(previous => (previous === next ? previous : next));
        };
        sync();
        return subscribeRemote?.(sync);
    }, [sessionId, remoteFacts, subscribeRemote]);
    return cwd;
}
/** The trigger: one per-session button in the header action row. */
export function SideWorkspacesAction(props) {
    const t = props.t ?? zhBaseline;
    const [open, setOpen] = useState(false);
    return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: styles.action, onClick: () => setOpen(value => !value), title: t('side.headerAction.title'), children: [_jsx(PlusIcon, { width: 13, height: 13 }), t('side.headerAction.label')] }), open ? _jsx(SideWorkspacesPanel, { ...props, t: t, injected: props, onClose: () => setOpen(false) }) : null] }));
}
/** The per-session workspace cockpit: main workspace + side roots + connections. */
export function SideWorkspacesPanel(props) {
    const { sessionId, injected, onClose, t: tSeat } = props;
    const t = tSeat ?? zhBaseline;
    const [items, setItems] = useState([]);
    const [machines, setMachines] = useState([]);
    // The connected set as the LAST `session.conn.list` read returned it. Never a
    // second source of truth: every mutation is followed by a re-read, and the
    // returned `{ items }` is adopted as a read, not as an assumption.
    const [connected, setConnected] = useState([]);
    const [busy, setBusy] = useState(true);
    const [toggling, setToggling] = useState('');
    const [error, setError] = useState('');
    const [draftKind, setDraftKind] = useState('local');
    const [draftPath, setDraftPath] = useState('');
    const [draftMachine, setDraftMachine] = useState('');
    const [draftLabel, setDraftLabel] = useState('');
    const [browseOpen, setBrowseOpen] = useState(false);
    const [editing, setEditing] = useState(''); // rootKey being label-edited
    const [editingLabel, setEditingLabel] = useState('');
    const cardRef = useRef(null);
    const view = cockpitViewOf(useSessionCwd(props), machines, connected);
    /**
     * Re-read every feed the cockpit renders: the side declarations, the machine
     * universe, and the connected set. The connected set comes from the RPC on
     * every pass — the panel owns no copy it could drift from (ADR-0021 §0).
     * @param keepError - keep the current banner (a re-read that follows a FAILED
     *   mutation must not wipe the message that explains why).
     */
    const refresh = (keepError = false) => {
        setBusy(true);
        if (!keepError)
            setError('');
        Promise.all([
            injected.rpc('session.ws.list', { sessionId }),
            injected.rpc('machines.list', {}),
            injected.rpc('session.conn.list', { sessionId }),
        ]).then(([listResult, machinesResult, connResult]) => {
            setItems(asSideRows(unwrap(listResult, t)));
            const rows = asMachineRows(unwrap(machinesResult, t));
            setMachines(rows);
            setConnected(asConnectedIds(unwrap(connResult, t)));
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
    /**
     * One「已连接的机器」toggle. The endpoint answers with the new set, but the panel
     * still re-reads: a failure clears the in-flight marker and re-reads too, so
     * the UI ends up consistent with the next `session.conn.list` instead of
     * optimistically wrong (ADR-0021 §2.9). The implicit main machine has no
     * toggle at all (`toggleRequest` returns undefined for it): its connection
     * comes from the session's own cwd and cannot be removed from here.
     */
    const toggleConnection = (row) => {
        const request = toggleRequest(sessionId, row);
        if (request === undefined)
            return;
        setToggling(row.id);
        setError('');
        injected.rpc(request.endpoint, request.payload).then(result => {
            setConnected(asConnectedIds(unwrap(result, t)));
            setToggling('');
            refresh();
        }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setToggling('');
            // The next read wins, and the banner explaining the failure stays up.
            refresh(true);
        });
    };
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
                    onClose(); }, children: [_jsxs("div", { className: styles.header, children: [_jsx("strong", { className: styles.title, children: t('side.card.title') }), _jsx("button", { type: "button", className: styles.iconButton, onClick: onClose, "aria-label": t('side.close.label'), children: _jsx(CloseIcon, { width: 14, height: 14 }) })] }), error !== '' ? _jsx("div", { className: styles.error, children: error }) : null, _jsxs("div", { className: styles.section, children: [_jsx("div", { className: styles.sectionTitle, children: t('side.main.heading') }), view.main.kind === 'remote'
                                ? (_jsxs("div", { className: styles.mainRow, children: [_jsx(ServerIcon, { className: styles.rowIcon, width: 13, height: 13 }), _jsx("span", { className: styles.itemLabel, children: view.main.label }), machineEndpointOf(view.main) !== ''
                                            ? _jsx("span", { className: styles.rowHost, children: machineEndpointOf(view.main) })
                                            : null, _jsx("span", { className: styles.mainPath, title: view.main.path, children: view.main.path })] }))
                                : _jsx("div", { className: styles.empty, children: t('side.main.none') })] }), _jsxs("div", { className: `${styles.section} ${styles.divided}`, children: [_jsx("div", { className: styles.sectionTitle, children: t('side.roots.heading') }), _jsxs("div", { className: styles.list, children: [busy && items.length === 0 ? _jsx("div", { className: styles.loading, children: t('side.loading') }) : null, items.length === 0 ? _jsx("div", { className: styles.empty, children: t('side.empty') }) : null, items.map(item => (_jsxs("div", { className: styles.row, children: [item.kind === 'remote' ? _jsx(ServerIcon, { className: styles.rowIcon, width: 13, height: 13 }) : _jsx(FolderIcon, { className: styles.rowIcon, width: 13, height: 13 }), editing === item.rootKey
                                                ? (_jsx("input", { className: styles.input, value: editingLabel, onChange: (event) => setEditingLabel(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter')
                                                        updateLabel(item.rootKey, editingLabel); } }))
                                                : _jsx("span", { className: styles.itemLabel, children: item.label }), _jsx("span", { className: styles.rowPath, title: item.rootKey, children: item.rootKey }), _jsx("button", { type: "button", className: styles.renameButton, title: t('side.rename.title'), onClick: () => { setEditing(item.rootKey); setEditingLabel(item.label); }, children: t('side.rename.button') }), _jsx("button", { type: "button", className: `${styles.iconButton} ${styles.danger}`, title: t('side.remove.title'), onClick: () => removeSide(item.rootKey), children: _jsx(TrashIcon, { width: 13, height: 13 }) })] }, item.rootKey)))] }), _jsxs("div", { className: styles.form, children: [_jsxs("div", { className: styles.segment, role: "group", "aria-label": t('side.kind.label'), children: [_jsx("button", { type: "button", className: draftKind === 'local' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton, onClick: () => setDraftKind('local'), children: t('side.kind.local') }), _jsx("button", { type: "button", className: draftKind === 'remote' ? `${styles.segmentButton} ${styles.segmentButtonOn}` : styles.segmentButton, onClick: () => setDraftKind('remote'), children: t('side.kind.remote') })] }), draftKind === 'remote' ? (_jsx("select", { className: `${styles.select} ${styles.selectWide}`, value: draftMachine, onChange: (event) => setDraftMachine(event.target.value), "aria-label": t('side.machine.label'), children: machines.map(machine => _jsx("option", { value: machine.id, children: machine.label }, machine.id)) })) : null, _jsxs("div", { className: styles.fieldRow, children: [_jsx("input", { className: styles.input, placeholder: draftKind === 'remote' ? t('side.draft.path.remote') : t('side.draft.path.local'), value: draftPath, onChange: (event) => setDraftPath(event.target.value) }), _jsx("button", { type: "button", className: styles.button, onClick: () => setBrowseOpen(true), children: t('side.browse') })] }), _jsxs("div", { className: styles.fieldRow, children: [_jsx("input", { className: styles.input, placeholder: t('side.draft.labelPlaceholder'), value: draftLabel, onChange: (event) => setDraftLabel(event.target.value) }), _jsx("button", { type: "button", className: `${styles.button} ${styles.primary}`, disabled: busy, onClick: addSide, children: t('side.mount') })] })] })] }), _jsxs("div", { className: `${styles.section} ${styles.divided}`, children: [_jsx("div", { className: styles.sectionTitle, children: t('side.conn.heading') }), _jsx("div", { className: styles.hint, children: t('side.conn.hint') }), !busy && !view.anyConnected ? _jsx("div", { className: styles.empty, children: t('side.conn.empty') }) : null, _jsx("div", { className: styles.list, children: view.connections.map(row => (_jsxs("div", { className: styles.row, children: [_jsx(ServerIcon, { className: styles.rowIcon, width: 13, height: 13 }), _jsx("span", { className: styles.itemLabel, children: row.label }), machineEndpointOf(row) !== '' ? _jsx("span", { className: styles.rowHost, children: machineEndpointOf(row) }) : null, _jsx("span", { className: styles.spacer }), row.canToggle
                                            ? (_jsx("button", { type: "button", className: row.connected ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle, "aria-pressed": row.connected, disabled: busy || toggling !== '', onClick: () => { toggleConnection(row); }, children: toggling === row.id ? t('side.conn.busy') : row.connected ? t('side.conn.disconnect') : t('side.conn.connect') }))
                                            : _jsx("span", { className: styles.badge, children: t('side.main.heading') })] }, row.id))) })] })] }), _jsx(SshWorkspaceFlow, { open: browseOpen, busy: busy, suppressSessionRoute: true, pickOnly: true, initialConnectionId: draftKind === 'remote' ? draftMachine : '', onPicked: handlePicked, onCancel: () => setBrowseOpen(false), onError: (message) => setError(message), listLocalDirectory: injected.listLocalDirectory, createLocalDirectory: injected.createLocalDirectory, rpc: injected.rpc, t: t })] }));
}
//# sourceMappingURL=side-workspaces.js.map