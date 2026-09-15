import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Minimal remote-machine management settings page (machine registry edition):
 * machine list (edit / delete / set current / forget host key) plus the shared
 * {@link MachineForm} (mode="settings") — one form component with the flow's
 * add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
 * audit / update sections — those belong to dsh-remote only and are
 * deliberately not ported.
 *
 * All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget);
 * all styles are inline.
 * @module dsh-workspace-enhancement/settings
 */
import { useEffect, useState } from 'react';
import { MachineForm } from "./machine-form.js";
import { ConnStatusBadge, zhBaseline } from "./status.js";
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Structural check for one machine wire row (unknown fields tolerated). */
function asMachineView(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.username !== 'string')
        return null;
    const machine = {
        id: value.id,
        label: typeof value.label === 'string' ? value.label : value.host,
        host: value.host,
        port: typeof value.port === 'number' ? value.port : 22,
        username: value.username,
        auth: value.auth === 'password' || value.auth === 'agent' ? value.auth : 'key',
        passwordSet: value.passwordSet === true,
        jumpHosts: Array.isArray(value.jumpHosts) ? value.jumpHosts.map(String) : [],
        credentialBackend: typeof value.credentialBackend === 'string' ? value.credentialBackend : 'plain',
    };
    if (typeof value.cwd === 'string')
        machine.cwd = value.cwd;
    if (typeof value.workspace === 'string')
        machine.workspace = value.workspace;
    if (value.hostKeyMode === 'accept-new' || value.hostKeyMode === 'verify' || value.hostKeyMode === 'off') {
        machine.hostKeyMode = value.hostKeyMode;
    }
    if (value.encryptFallback === true)
        machine.encryptFallback = true;
    if (Array.isArray(value.recentWorkspaces))
        machine.recentWorkspaces = value.recentWorkspaces.map(String);
    return machine;
}
/** Unwrap a wire result or throw its business error. */
function unwrap(result, fallback) {
    if (!result.ok)
        throw new Error(result.error.message || fallback);
    return result.value;
}
/** Map a machine row onto the shared form's edit initial state (secret-free). */
function editInitialOf(machine) {
    return {
        id: machine.id,
        name: machine.label,
        host: machine.host,
        port: String(machine.port || 22),
        username: machine.username || 'root',
        workspace: machine.workspace ?? machine.cwd ?? '',
        hostKeyMode: machine.hostKeyMode ?? '',
        encryptPassword: machine.credentialBackend !== '' && machine.credentialBackend !== 'plain',
        auth: machine.auth === 'password'
            || machine.passwordSet === true
            || (machine.credentialBackend !== '' && machine.credentialBackend !== 'plain')
            ? 'password'
            : 'key',
        jumpText: machine.jumpHosts.join(', '),
    };
}
/**
 * F2: the durable save acknowledgment. The machine form's success text cannot
 * persist — the form remounts when `key={editing?.id}` changes and any in-form
 * feedback vanishes with it — so the settings page owns the banner. The
 * honest fallback marker (encryption requested, OS backend failed) rides
 * along as pure text (no live data; a `MachineSaveView` leaf).
 */
export function savedBanner(view, t = zhBaseline) {
    const label = view.label || `${view.username}@${view.host}`;
    const fallback = view.encryptFallback === true ? t('settings.encrypt.fallback') : '';
    return t('settings.saved', { label, fallback });
}
/** The registers page component: machine list + shared form. */
export function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }) {
    const t = tSeat ?? zhBaseline;
    const [machines, setMachines] = useState([]);
    const [currentId, setCurrentId] = useState('');
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const refresh = async () => {
        try {
            const result = await rpc('machines.list');
            const state = unwrap(result, t('settings.rpc.listMachines'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
    };
    useEffect(() => { void refresh(); }, []);
    const startEdit = (machine) => {
        setEditing(editInitialOf(machine));
        setErr('');
        setMsg('');
    };
    const del = async (id) => {
        if (!window.confirm(t('settings.delete.confirm')))
            return;
        setBusy(true);
        setErr('');
        setMsg('');
        try {
            const result = await rpc('machines.remove', { id });
            const state = unwrap(result, t('settings.rpc.removeFailed'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
            if (editing?.id === id)
                setEditing(null);
            setMsg(t('settings.deleted'));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const useNow = async (id) => {
        setBusy(true);
        setErr('');
        setMsg('');
        try {
            const result = await rpc('machines.setCurrent', { id });
            const state = unwrap(result, t('settings.rpc.switchFailed'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
            setMsg(t('settings.setCurrent'));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const forgetKey = async (machine) => {
        setBusy(true);
        setErr('');
        setMsg('');
        try {
            const result = await rpc('hostkey.forget', { id: machine.id });
            unwrap(result, t('settings.rpc.forgetKeyFailed'));
            setMsg(t('settings.forgotten', { host: machine.host, port: machine.port }));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const handleSaved = (view) => {
        setEditing(null);
        setErr('');
        // F2: the page-level banner is the durable acknowledgment (the in-form
        // prompt is remounted away); it must stay visible after the refresh.
        setMsg(savedBanner(view, t));
        void refresh();
    };
    const buttonStyle = {
        padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.35)',
        background: 'rgba(128,128,128,0.08)', color: 'inherit', cursor: 'pointer', fontSize: 12,
    };
    const boxStyle = {
        border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, background: 'rgba(128,128,128,0.06)', padding: 10,
    };
    return (_jsxs("div", { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }, children: [_jsx("div", { style: { fontSize: 15, fontWeight: 600 }, children: t('settings.title') }), _jsx("div", { style: { fontSize: 12, opacity: 0.8 }, children: t('settings.description') }), err !== '' ? _jsx("div", { style: { color: '#e06c75', fontSize: 12 }, children: err }) : null, msg !== '' ? _jsx("div", { style: { color: '#98c379', fontSize: 12 }, children: msg }) : null, _jsxs("div", { style: boxStyle, children: [_jsx("div", { style: { marginBottom: 6, fontSize: 13, fontWeight: 600 }, children: t('settings.machines.title') }), machines.length > 0
                        ? machines.map(machine => (_jsx("div", { style: { padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.25)' }, children: _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: '1 1 220px', minWidth: 0, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, minWidth: 0 }, children: [_jsx("span", { children: machine.label }), _jsxs("code", { style: { fontSize: 12, opacity: 0.8 }, children: [machine.username, "@", machine.host, ":", machine.port] }), machine.credentialBackend !== '' && machine.credentialBackend !== 'plain' ? ' 🗝' : '', machine.encryptFallback === true ? _jsxs("span", { style: { color: '#e6c07b', fontSize: 12 }, children: [" ", t('settings.machines.encryptFallbackBadge')] }) : '', machine.jumpHosts.length > 0 ? ' ⛳' : ''] }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }, children: [_jsx(ConnStatusBadge, { id: machine.id, rpc: rpc, t: t }), machine.id === currentId ? _jsx("span", { style: { color: '#98c379', fontSize: 12 }, children: t('settings.machines.currentBadge') }) : null] })] }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto' }, children: [_jsx("button", { style: { ...buttonStyle, whiteSpace: 'nowrap' }, onClick: () => startEdit(machine), children: t('settings.machines.edit') }), _jsx("button", { style: { ...buttonStyle, whiteSpace: 'nowrap' }, onClick: () => void del(machine.id), children: t('settings.machines.delete') }), _jsx("button", { style: { ...buttonStyle, whiteSpace: 'nowrap' }, onClick: () => void useNow(machine.id), disabled: machine.id === currentId || busy, children: t('settings.machines.setCurrent') }), _jsx("button", { style: { ...buttonStyle, whiteSpace: 'nowrap' }, onClick: () => void forgetKey(machine), children: t('settings.machines.forgetKey') })] })] }) }, machine.id)))
                        : _jsx("div", { style: { opacity: 0.6, fontSize: 12 }, children: t('settings.machines.empty') })] }), _jsxs("div", { style: boxStyle, children: [_jsx("div", { style: { marginBottom: 6, fontSize: 13, fontWeight: 600 }, children: editing !== null ? t('settings.form.editTitle') : t('settings.form.addTitle') }), _jsx(MachineForm, { mode: "settings", rpc: rpc, initial: editing ?? undefined, t: t, onSaved: handleSaved }, editing?.id ?? 'blank')] })] }));
}
export default RemoteWorkspaceSettingsPage;
//# sourceMappingURL=settings.js.map