import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The shared machine/connection form (R2 表单并集): the union of the settings
 * page「添加服务器」form and the add-workspace flow's「新建连接」form — one
 * component, one field set, one interaction set; only the submit action
 * differs by `mode`.
 *
 * Union surface (docs/ui-merge-design.md §2): 主机名/别名（失焦/粘贴自动解析 +
 * 「识别 ssh 配置 ▾」精确别名下拉）、端口、用户名（预填 root）、名称（默认
 * user@host，留空由宿主回退）、默认工作区、认证 tabs（私钥文件/密码；切换
 * 不清空对方）、私钥路径（编辑留空=保持不变，P2-④）、私钥口令、密码（编辑
 * 留空=不变）、高级折叠区（加密保存密码 checkbox——认证=密码时显示；HostKey
 * 模式 select；跳板链文本 + 实时校验摘要 + 清除 + 提交时坏段阻止保存，P2-②）、
 * 测试连接（loading + 结果）、保存（同步 busy 守卫防双击双发，P2-③）。
 *
 * `mode='settings'`：保存后清空表单 + 成功提示（banner 保留）；`mode='flow'`：
 * 保存按钮文案「保存并浏览」，成功后通过 `onSaved(view)` 交给外壳切换目录浏览。
 * Payload 唯一出口是 {@link module:dsh-workspace-enhancement/client/machine-payload}
 * 的 machinePayload（含跳板链）；测试连接走 machines.test；服务端零改动。
 * 全部样式内联、中文标签；无新依赖。
 * @module dsh-workspace-enhancement/client/machine-form
 */
import { useEffect, useRef, useState } from 'react';
import { zhBaseline } from "./status.js";
import { machinePayload } from "./machine-payload.js";
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Parse a `[user@]host[:port]` jump list (comma/space separated). */
export function parseJumpText(text) {
    const entries = text.split(/[\s,]+/).map(entry => entry.trim()).filter(entry => entry !== '');
    return entries.map((entry) => {
        let rest = entry;
        let username;
        let port;
        const at = rest.lastIndexOf('@');
        if (at >= 0) {
            username = rest.slice(0, at);
            rest = rest.slice(at + 1);
        }
        const colon = rest.lastIndexOf(':');
        if (colon >= 0) {
            const parsed = Number(rest.slice(colon + 1));
            if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
                port = parsed;
                rest = rest.slice(0, colon);
            }
        }
        return {
            host: rest,
            ...(port !== undefined ? { port } : {}),
            ...(username !== undefined && username !== '' ? { username } : {}),
        };
    });
}
/** Render one resolved hop as `user@host:port` (defaults hidden). */
export function formatHop(hop) {
    return `${hop.username !== undefined && hop.username !== '' ? `${hop.username}@` : ''}${hop.host}${hop.port !== undefined && hop.port !== 22 ? `:${String(hop.port)}` : ''}`;
}
/** Realtime jump summary: `3 · user@b1 → host:2202`, or the bad-input hint. */
export function jumpSummaryOf(text, t = zhBaseline) {
    const hops = parseJumpText(text);
    if (hops.length === 0)
        return '';
    if (hops.some(hop => hop.host.trim() === ''))
        return t('form.jump.unresolved');
    const joined = hops.map(formatHop).join(' → ');
    return hops.length === 1
        ? t('form.jump.summaryOne', { count: hops.length, hops: joined })
        : t('form.jump.summary', { count: hops.length, hops: joined });
}
/**
 * P2-②: submit-time jump validation. A non-empty jump text that cannot be
 * parsed into hosts is a hard error — the payload must never silently drop
 * the chain (the old code sent no `jump` when a segment was malformed while
 * the summary already warned). Returns the error text, or null when the jump
 * is absent or fully parseable.
 */
export function jumpErrorOf(text, t = zhBaseline) {
    const trimmed = text.trim();
    if (trimmed === '')
        return null;
    const hops = parseJumpText(trimmed);
    if (hops.length === 0 || hops.some(hop => hop.host.trim() === '')) {
        return t('form.jump.unresolvedHint');
    }
    return null;
}
/**
 * t8: the jump chain to put on the wire. A non-empty text parses to its hops.
 * An EMPTY text during an EDIT whose machine HAD a jump chain (the
 * secret-free initial knows only its `jumpText`) yields `[]` — the explicit
 * clear, because an omitted chain keeps the stored one and the operator must
 * be able to REMOVE the chain. A new machine, or an edit of one that never
 * had a chain, yields undefined (omit = no jump). The wire builder
 * (machinePayload) serializes `[]` as-is.
 */
export function jumpChainOf(text, isEdit, hadJumpText) {
    const jumped = parseJumpText(text);
    if (jumped.length > 0)
        return jumped;
    return isEdit && (hadJumpText ?? '').trim() !== '' ? [] : undefined;
}
/**
 * P2-③: synchronous busy gate. `busy` state turns the buttons `disabled` only
 * after a re-render, so two clicks in one tick both pass the `disabled` check
 * and double-send; the gate flips synchronously on claim and clears in
 * `finally`, which closes that window. Only the current owner may release, so
 * an overlapping operation (resolve/test/save) can never clear another one's
 * busy state — the old code let a late resolve's `finally` re-enable the
 * buttons while a save was still in flight.
 */
export function createActionGate() {
    let owner = null;
    return {
        busy: () => owner !== null,
        claim(task) {
            if (owner !== null)
                return false;
            owner = task;
            return true;
        },
        release(task) {
            if (owner !== task)
                return false;
            owner = null;
            return true;
        },
    };
}
/** The one-line resolve summary: alias → user@host:port · identity · jumps. */
export function formatResolvedSummary(resolved, t = zhBaseline) {
    const endpoint = `${resolved.username !== '' ? `${resolved.username}@` : ''}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ''}`;
    const parts = [];
    if (resolved.alias.toLowerCase() !== resolved.host.toLowerCase())
        parts.push(`${resolved.alias} → ${endpoint}`);
    else
        parts.push(endpoint);
    if (resolved.privateKeyPaths[0] !== undefined)
        parts.push(t('form.resolve.privateKey', { path: resolved.privateKeyPaths[0] }));
    if (resolved.jump.length > 0)
        parts.push(t('form.resolve.jump', { hops: resolved.jump.map(formatHop).join(' → ') }));
    return parts.join(' · ');
}
/** Structural check of a `connections.resolve` result. */
function asResolved(value) {
    const record = isRecord(value) ? value : {};
    const jump = Array.isArray(record.jump) ? record.jump.filter(isRecord).map(hop => ({
        host: String(hop.host ?? ''),
        ...(typeof hop.port === 'number' ? { port: hop.port } : {}),
        ...(typeof hop.username === 'string' && hop.username !== '' ? { username: hop.username } : {}),
    })) : [];
    return {
        host: String(record.host ?? ''),
        username: String(record.username ?? ''),
        port: typeof record.port === 'number' ? record.port : 22,
        privateKeyPaths: Array.isArray(record.privateKeyPaths)
            ? record.privateKeyPaths.filter((path) => typeof path === 'string')
            : [],
        jump,
        alias: String(record.alias ?? ''),
    };
}
/** Structural check of one machine save result (`machines.add`/`saveMachine`). */
export function asSaveView(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string' || value.id === '')
        return null;
    return {
        id: value.id,
        label: typeof value.label === 'string' ? value.label : String(value.host ?? ''),
        host: typeof value.host === 'string' ? value.host : '',
        port: typeof value.port === 'number' ? value.port : 22,
        username: typeof value.username === 'string' ? value.username : '',
        ...(value.encryptFallback === true ? { encryptFallback: true } : {}),
    };
}
function asConfigHosts(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter(isRecord).map(record => ({
        alias: String(record.alias ?? ''),
        host: String(record.host ?? ''),
        username: String(record.username ?? ''),
        port: typeof record.port === 'number' ? record.port : 22,
        identityFile: record.identityFile === true,
        jump: record.jump === true,
    })).filter(host => host.alias !== '');
}
/** Shared inline styles (settings-page vocabulary; used by both shells). */
const inputStyle = {
    // `minWidth: 0` is load-bearing: a flex item defaults to `min-width: auto`,
    // which for an <input> is its intrinsic width (~169px). Without it the
    // Username field refuses to shrink and pushes ~13px past the card edge at a
    // 1440px viewport (E2E-02 / E2E-04 regression guards).
    flex: 1, minWidth: 0, boxSizing: 'border-box',
    padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)', color: 'inherit', outline: 'none', fontSize: 13,
};
const inputErrorStyle = { borderColor: '#e06c75' };
const buttonStyle = {
    padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)', color: 'inherit', cursor: 'pointer', fontSize: 12,
    whiteSpace: 'nowrap',
};
const primaryStyle = {
    ...buttonStyle, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600,
};
const segmentStyle = (active) => ({
    padding: '4px 10px', borderRadius: 6, border: active
        ? '1px solid #2563eb'
        : '1px solid rgba(128,128,128,0.35)',
    background: active ? 'rgba(37,99,235,0.18)' : 'rgba(128,128,128,0.08)',
    color: 'inherit', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
});
/** One field row: label column + control. */
function fieldRow(label, control, key, hint) {
    return (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' }, children: [_jsx("label", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0, paddingTop: 8 }, children: label }), _jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }, children: [control, hint !== undefined ? _jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: hint }) : null] })] }, key));
}
/** The shared form body: fields + feedback + actions (no modal shell). */
export function MachineForm({ mode, rpc, initial, onSaved, onCancel, t: tSeat }) {
    const t = tSeat ?? zhBaseline;
    const initialState = () => ({
        id: initial?.id ?? '',
        name: initial?.name ?? '',
        host: initial?.host ?? '',
        port: initial?.port ?? '22',
        username: initial?.username ?? 'root',
        password: '',
        privateKeyPath: initial?.privateKeyPath ?? '',
        passphrase: initial?.passphrase ?? '',
        workspace: initial?.workspace ?? '',
        hostKeyMode: initial?.hostKeyMode ?? '',
        encryptPassword: initial?.encryptPassword ?? false,
        remoteApproval: initial?.remoteApproval ?? 'off',
        remoteSandbox: initial?.remoteSandbox ?? 'off',
    });
    const [form, setForm] = useState(initialState);
    // F3: an edit of a password/keychain machine (recorded via `auth`, or a
    // keychain-flagged initial) must open the 密码 tab first — the operator sees
    // the password field and the keychain switch without hunting the segment; a
    // key machine still defaults to the 私钥文件 tab.
    const [authKind, setAuthKind] = useState(initial?.auth ?? (initial?.encryptPassword === true ? 'password' : 'key'));
    const [jumpText, setJumpText] = useState(initial?.jumpText ?? '');
    const [advanced, setAdvanced] = useState((initial?.hostKeyMode !== undefined && initial.hostKeyMode !== '')
        || (initial?.jumpText !== undefined && initial.jumpText !== '')
        || initial?.encryptPassword === true
        || (initial?.remoteApproval !== undefined && initial.remoteApproval !== 'off')
        || (initial?.remoteSandbox !== undefined && initial.remoteSandbox !== 'off'));
    const [revealed, setRevealed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [busyTask, setBusyTask] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [resolveSummary, setResolveSummary] = useState(null);
    const [autoBusy, setAutoBusy] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [configBusy, setConfigBusy] = useState(false);
    const [configList, setConfigList] = useState(null);
    const [configError, setConfigError] = useState(null);
    const usernameRef = useRef(null);
    const autoGeneration = useRef(0);
    const lastAutoHost = useRef(null);
    // P2-③: the synchronous busy gate (claim before any await, release in finally).
    const actionGate = useRef(createActionGate()).current;
    useEffect(() => {
        if (initial?.focusUsername === true)
            usernameRef.current?.focus();
    }, [initial?.focusUsername]);
    const errorsOf = () => {
        const errors = {};
        if (form.host.trim() === '')
            errors.host = t('form.error.host');
        const portText = form.port.trim();
        if (portText === '')
            errors.port = t('form.error.required');
        else if (!/^\d+$/.test(portText))
            errors.port = t('form.error.port.number');
        else {
            const parsed = Number(portText);
            if (parsed < 1 || parsed > 65535)
                errors.port = t('form.error.port.range');
        }
        if (form.username.trim() === '')
            errors.username = t('form.error.username');
        return errors;
    };
    const errorOf = (key) => (revealed ? errorsOf()[key] : undefined);
    /** Prefill every field the resolution covers; keep operator edits elsewhere. */
    const applyResolved = (resolved, currentCwd, currentUser) => {
        setForm(prev => ({
            ...prev,
            host: resolved.host,
            ...(resolved.port !== 22 ? { port: String(resolved.port) } : {}),
            ...(resolved.username !== '' ? { username: resolved.username } : {}),
            ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] } : {}),
            ...(currentCwd.trim() === '' && (resolved.username !== '' ? resolved.username : currentUser).trim() !== ''
                ? { workspace: `/home/${(resolved.username !== '' ? resolved.username : currentUser).trim()}` }
                : {}),
        }));
        if (resolved.privateKeyPaths.length > 0)
            setAuthKind('key');
        setJumpText(resolved.jump.map(formatHop).join(', '));
        setResolveSummary(resolved);
    };
    /**
     * Silent alias resolution for blur/paste: no validation reveal, no error
     * surface, never disables the form. Guarded by its own generation counter
     * so a stale answer cannot clobber a newer edit.
     */
    const autoResolve = async (value) => {
        const hostText = value.trim();
        if (hostText === '' || actionGate.busy())
            return;
        if (lastAutoHost.current === hostText)
            return;
        lastAutoHost.current = hostText;
        const current = autoGeneration.current += 1;
        setAutoBusy(true);
        try {
            const result = await rpc('connections.resolve', { host: hostText });
            if (!result.ok)
                return;
            const resolved = asResolved(result.value);
            if (current !== autoGeneration.current)
                return;
            applyResolved(resolved, form.workspace, form.username);
        }
        catch {
            // Silent by design; the manual list/button reports the error.
        }
        finally {
            if (current === autoGeneration.current)
                setAutoBusy(false);
        }
    };
    const resolveExplicit = async (alias, expectedCount = 0) => {
        if (!actionGate.claim('resolve'))
            return;
        const current = autoGeneration.current += 1;
        setAutoBusy(false);
        setBusy(true);
        setBusyTask('resolve');
        setFeedback({ kind: 'info', text: t('form.config.reading') });
        try {
            const result = await rpc('connections.resolve', { host: alias.trim() });
            if (!result.ok)
                throw new Error(result.error.message);
            const resolved = asResolved(result.value);
            if (current !== autoGeneration.current)
                return;
            lastAutoHost.current = resolved.host;
            applyResolved(resolved, form.workspace, form.username);
            setFeedback({
                kind: 'success',
                text: t('form.config.resolved', { alias: resolved.alias, endpoint: `${resolved.username !== '' ? `${resolved.username}@` : ''}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ''}` }),
            });
            if (expectedCount > 0)
                setConfigList(previous => previous === null ? previous : previous.filter(host => host.alias !== alias));
        }
        catch (error) {
            setFeedback({ kind: 'error', text: t('form.config.resolveFailed', { message: error instanceof Error ? error.message : String(error) }) });
        }
        finally {
            if (actionGate.release('resolve')) {
                setBusy(false);
                setBusyTask(null);
            }
        }
    };
    const toggleConfigList = async () => {
        if (configOpen) {
            setConfigOpen(false);
            return;
        }
        setConfigOpen(true);
        if (configList !== null)
            return;
        setConfigBusy(true);
        setConfigError(null);
        try {
            const result = await rpc('config.hosts');
            if (!result.ok)
                throw new Error(result.error.message);
            setConfigList(asConfigHosts(result.value));
        }
        catch (error) {
            setConfigList([]);
            setConfigError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setConfigBusy(false);
        }
    };
    /**
     * The wire payload. P2-②: submissions validate the jump chain before this
     * runs (`jumpErrorOf`), so a malformed segment can no longer be silently
     * dropped — the parsed chain is always passed through verbatim. t8:
     * `jumpChainOf` turns an emptied chain on an edit that previously had one
     * into the explicit `jump: []` clear (an omitted chain would keep it).
     */
    const payload = () => {
        return machinePayload(form, jumpChainOf(jumpText, form.id !== '', initial?.jumpText));
    };
    const runTest = async () => {
        if (!actionGate.claim('test'))
            return;
        try {
            setRevealed(true);
            setConfigOpen(false);
            const jumpError = jumpErrorOf(jumpText, t);
            if (jumpError !== null) {
                setFeedback({ kind: 'error', text: jumpError });
                return;
            }
            const input = payload();
            if (form.host.trim() === '') {
                setFeedback({ kind: 'error', text: t('form.test.noHost') });
                return;
            }
            const editing = form.id !== '';
            if (authKind === 'password' && input.password === undefined && !editing) {
                setFeedback({ kind: 'error', text: t('form.test.noPassword') });
                return;
            }
            if (authKind === 'key' && (input.privateKeyPath === undefined || input.privateKeyPath === '')) {
                // P2-④: an edit cannot show the stored key path; the host keeps it
                // when the payload omits it — only a brand-new machine must carry one.
                if (!editing) {
                    setFeedback({ kind: 'error', text: t('form.test.noKey') });
                    return;
                }
            }
            setBusy(true);
            setBusyTask('test');
            setFeedback({ kind: 'info', text: t('form.test.testing') });
            try {
                const result = await rpc('machines.test', input);
                setFeedback(result.ok
                    ? { kind: 'success', text: t('form.test.success') }
                    : { kind: 'error', text: t('form.test.failed', { message: result.error.message }) });
            }
            catch (error) {
                setFeedback({ kind: 'error', text: t('form.test.error', { message: error instanceof Error ? error.message : String(error) }) });
            }
        }
        finally {
            if (actionGate.release('test')) {
                setBusy(false);
                setBusyTask(null);
            }
        }
    };
    const runSave = async () => {
        if (!actionGate.claim('save'))
            return;
        try {
            setRevealed(true);
            setConfigOpen(false);
            const found = errorsOf();
            if (found.host !== undefined || found.port !== undefined || found.username !== undefined) {
                setFeedback({ kind: 'error', text: t('form.save.incomplete') });
                return;
            }
            const jumpError = jumpErrorOf(jumpText, t);
            if (jumpError !== null) {
                setFeedback({ kind: 'error', text: jumpError });
                return;
            }
            setBusy(true);
            setBusyTask('save');
            setFeedback({ kind: 'info', text: t('form.save.saving') });
            try {
                const result = await rpc('machines.add', payload());
                if (!result.ok)
                    throw new Error(result.error.message);
                const raw = isRecord(result.value) ? result.value.machine : undefined;
                const machineRecord = isRecord(raw) ? raw : null;
                const view = asSaveView(machineRecord);
                if (view === null)
                    throw new Error(t('form.save.missingId'));
                // R1 保持：加密请求落在明文回退时要明说（honest marker）。
                const fallbackHint = machineRecord?.encryptFallback === true
                    ? t('form.encrypt.fallback')
                    : '';
                if (mode === 'settings') {
                    setForm(initialState);
                    setJumpText('');
                    setAuthKind('key');
                    setResolveSummary(null);
                    setAdvanced(false);
                    // F2: the success acknowledgment lives at the page level (the form
                    // remounts on `key={editing?.id}` change and any in-form text would
                    // vanish); only a stale pre-save feedback is cleared here.
                    setFeedback(null);
                }
                onSaved({ ...view, ...(fallbackHint !== '' ? { encryptFallback: true } : {}) });
            }
            catch (error) {
                setFeedback({ kind: 'error', text: t('form.save.failed', { message: error instanceof Error ? error.message : String(error) }) });
            }
        }
        finally {
            if (actionGate.release('save')) {
                setBusy(false);
                setBusyTask(null);
            }
        }
    };
    const resetForm = () => {
        if (actionGate.busy())
            return;
        setForm(initialState);
        setJumpText(initial?.jumpText ?? '');
        setAuthKind(initial?.auth ?? 'key');
        setAdvanced(false);
        setResolveSummary(null);
        setFeedback(null);
        setRevealed(false);
    };
    const jumpSummary = jumpSummaryOf(jumpText, t);
    const hostError = errorOf('host');
    const portError = errorOf('port');
    const usernameError = errorOf('username');
    const saveLabel = mode === 'flow' ? t('form.save.flowLabel') : t('form.save.settingsLabel');
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0 }, children: [t('form.label.host'), _jsx("span", { style: { color: '#e06c75' }, children: " *" })] }), _jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }, children: [_jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("input", { style: { ...inputStyle, ...(hostError !== undefined ? inputErrorStyle : {}) }, value: form.host, placeholder: t('form.placeholder.host'), disabled: busy, onChange: event => {
                                            setForm(prev => ({ ...prev, host: event.target.value }));
                                            setResolveSummary(null);
                                            lastAutoHost.current = null;
                                        }, onBlur: () => { void autoResolve(form.host); }, onPaste: event => {
                                            const text = event.clipboardData.getData('text');
                                            if (text.trim() !== '')
                                                void autoResolve(text);
                                        } }), _jsxs("button", { type: "button", style: buttonStyle, disabled: busy, onClick: () => { void toggleConfigList(); }, children: [t('form.config.recognize'), " \u25BE"] })] }), autoBusy && _jsx("span", { style: { fontSize: 11, opacity: 0.7 }, role: "status", children: t('form.config.matching') }), hostError !== undefined && _jsx("span", { style: { fontSize: 11, color: '#e06c75' }, children: hostError }), _jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: t('form.config.hint') })] })] }), configOpen && (_jsx("div", { style: { border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, marginBottom: 8, maxHeight: 180, overflowY: 'auto', background: 'rgba(128,128,128,0.06)' }, children: configBusy
                    ? _jsx("div", { style: { padding: 8, fontSize: 12, opacity: 0.6 }, children: t('form.config.reading') })
                    : configError !== null
                        ? _jsx("div", { style: { padding: 8, fontSize: 12, color: '#e06c75' }, children: configError })
                        : (configList ?? []).length === 0
                            ? _jsx("div", { style: { padding: 8, fontSize: 12, opacity: 0.6 }, children: t('form.config.empty') })
                            : (configList ?? []).map(host => (_jsxs("div", { onClick: () => { void resolveExplicit(host.alias, (configList ?? []).length); }, style: { padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid rgba(128,128,128,0.25)' }, children: [host.alias, " \u2192 ", host.host, host.username !== '' ? ` (${host.username})` : '', host.identityFile ? ` ${t('form.config.badge.key')}` : '', host.jump ? ' ⛳' : ''] }, host.alias))) })), resolveSummary !== null && (_jsxs("div", { style: { fontSize: 12, color: '#98c379', marginBottom: 8 }, role: "status", children: ["\u2713 ", formatResolvedSummary(resolveSummary, t)] })), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }, children: [_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }, children: [_jsxs("label", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0 }, children: [t('form.label.port'), _jsx("span", { style: { color: '#e06c75' }, children: " *" })] }), _jsx("input", { style: { ...inputStyle, maxWidth: 110, ...(portError !== undefined ? inputErrorStyle : {}) }, value: form.port, inputMode: "numeric", disabled: busy, onChange: event => { setForm(prev => ({ ...prev, port: event.target.value })); } }), portError !== undefined && _jsx("span", { style: { fontSize: 11, color: '#e06c75' }, children: portError })] }), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }, children: [_jsxs("label", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0 }, children: [t('form.label.username'), _jsx("span", { style: { color: '#e06c75' }, children: " *" })] }), _jsx("input", { ref: usernameRef, style: { ...inputStyle, ...(usernameError !== undefined ? inputErrorStyle : {}) }, value: form.username, disabled: busy, onChange: event => { setForm(prev => ({ ...prev, username: event.target.value })); } }), usernameError !== undefined && _jsx("span", { style: { fontSize: 11, color: '#e06c75' }, children: usernameError })] })] }), fieldRow(t('form.label.name'), (_jsx("input", { style: inputStyle, value: form.name, placeholder: t('form.placeholder.name'), disabled: busy, onChange: event => { setForm(prev => ({ ...prev, name: event.target.value })); } })), 'name'), fieldRow(t('form.label.workspace'), (_jsx("input", { style: inputStyle, value: form.workspace, placeholder: t('form.placeholder.workspace'), disabled: busy, onChange: event => { setForm(prev => ({ ...prev, workspace: event.target.value })); } })), 'workspace'), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("label", { style: { fontSize: 12, opacity: 0.8, display: 'block', marginBottom: 4 }, children: t('form.label.auth') }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("button", { type: "button", role: "radio", "aria-checked": authKind === 'key', style: segmentStyle(authKind === 'key'), disabled: busy, onClick: () => { setAuthKind('key'); }, children: t('form.auth.keyTab') }), _jsx("button", { type: "button", role: "radio", "aria-checked": authKind === 'password', style: segmentStyle(authKind === 'password'), disabled: busy, onClick: () => { setAuthKind('password'); }, children: t('form.auth.passwordTab') })] }), authKind === 'key' ? (_jsxs("div", { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("input", { style: inputStyle, value: form.privateKeyPath, placeholder: t('form.placeholder.keyPath'), disabled: busy, onChange: event => { setForm(prev => ({ ...prev, privateKeyPath: event.target.value })); } }), _jsx("input", { type: "password", style: inputStyle, value: form.passphrase, placeholder: t('form.placeholder.keyPassphrase'), disabled: busy, onChange: event => { setForm(prev => ({ ...prev, passphrase: event.target.value })); } })] })) : (_jsxs("div", { style: { marginTop: 8 }, children: [_jsx("input", { type: "password", style: inputStyle, value: form.password, placeholder: form.id !== '' ? t('form.placeholder.password.edit') : t('form.placeholder.password.new'), disabled: busy, onChange: event => { setForm(prev => ({ ...prev, password: event.target.value })); } }), _jsx("span", { style: { display: 'block', fontSize: 11, opacity: 0.6, marginTop: 4 }, children: t('form.password.hint.edit') })] }))] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("button", { type: "button", style: { background: 'none', border: 'none', padding: 0, color: 'inherit', fontSize: 12, opacity: 0.75, cursor: 'pointer', textAlign: 'left' }, onClick: () => { setAdvanced(value => !value); }, "aria-expanded": advanced, children: advanced ? t('form.advanced.expanded') : t('form.advanced.collapsed') }), advanced && (_jsxs("div", { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }, children: [authKind === 'password' && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0 }, children: t('form.label.credentialStore') }), _jsxs("label", { style: { fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }, children: [_jsx("input", { type: "checkbox", checked: form.encryptPassword, disabled: busy, onChange: event => { setForm(prev => ({ ...prev, encryptPassword: event.target.checked })); } }), t('form.encrypt.checkbox')] })] })), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0 }, children: t('form.label.hostKey') }), _jsxs("select", { style: { ...inputStyle, maxWidth: 260 }, value: form.hostKeyMode, disabled: busy, onChange: event => { setForm(prev => ({ ...prev, hostKeyMode: event.target.value })); }, children: [_jsx("option", { value: "", children: t('form.hostKey.default') }), _jsx("option", { value: "accept-new", children: t('form.hostKey.acceptNew') }), _jsx("option", { value: "verify", children: t('form.hostKey.verify') }), _jsx("option", { value: "off", children: t('form.hostKey.off') })] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }, children: [_jsx("span", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0, paddingTop: 8 }, children: t('form.label.remoteApproval') }), _jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }, children: [_jsxs("select", { style: { ...inputStyle, maxWidth: 260 }, value: form.remoteApproval, disabled: busy, onChange: event => { setForm(prev => ({ ...prev, remoteApproval: event.target.value })); }, children: [_jsx("option", { value: "off", children: t('form.remoteApproval.off') }), _jsx("option", { value: "human", children: t('form.remoteApproval.human') }), _jsx("option", { value: "ai", children: t('form.remoteApproval.ai') })] }), _jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: t('form.remoteApproval.hint') })] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }, children: [_jsx("span", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0, paddingTop: 8 }, children: t('form.label.remoteSandbox') }), _jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }, children: [_jsxs("select", { style: { ...inputStyle, maxWidth: 260 }, value: form.remoteSandbox, disabled: busy, onChange: event => { setForm(prev => ({ ...prev, remoteSandbox: event.target.value })); }, children: [_jsx("option", { value: "off", children: t('form.remoteSandbox.off') }), _jsx("option", { value: "read-only", children: t('form.remoteSandbox.readOnly') }), _jsx("option", { value: "workspace-write", children: t('form.remoteSandbox.workspaceWrite') })] }), _jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: t('form.remoteSandbox.hint') })] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }, children: [_jsx("span", { style: { width: 90, fontSize: 12, opacity: 0.8, flexShrink: 0, paddingTop: 8 }, children: t('form.label.jump') }), _jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }, children: [_jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("input", { style: inputStyle, value: jumpText, placeholder: t('form.placeholder.jump'), disabled: busy, onChange: event => { setJumpText(event.target.value); } }), _jsx("button", { type: "button", style: buttonStyle, disabled: busy || jumpText === '', onClick: () => { setJumpText(''); }, children: t('form.jump.clear') })] }), jumpSummary !== '' && (_jsx("span", { style: { fontSize: 11, opacity: 0.7 }, children: jumpSummary }))] })] })] }))] }), feedback !== null && (_jsxs("div", { role: feedback.kind === 'error' ? 'alert' : 'status', style: {
                    fontSize: 12,
                    marginBottom: 8,
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(128,128,128,0.25)',
                    background: feedback.kind === 'success'
                        ? 'rgba(152,195,121,0.12)'
                        : feedback.kind === 'error'
                            ? 'rgba(224,108,117,0.12)'
                            : 'rgba(128,128,128,0.08)',
                    color: feedback.kind === 'success' ? '#98c379' : feedback.kind === 'error' ? '#e06c75' : 'inherit',
                }, children: [feedback.kind === 'success' ? '✓ ' : feedback.kind === 'error' ? '✕ ' : '··· ', feedback.text] })), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }, children: [_jsx("button", { type: "button", style: buttonStyle, disabled: busy, onClick: () => { void runTest(); }, children: busyTask === 'test' ? t('form.test.testing') : t('form.test.button') }), mode === 'flow' && onCancel !== undefined && (_jsx("button", { type: "button", style: buttonStyle, disabled: busy, onClick: onCancel, children: t('form.cancel') })), mode === 'settings' && (_jsx("button", { type: "button", style: buttonStyle, disabled: busy, onClick: resetForm, children: initial?.id !== undefined ? t('form.clear.edit') : t('form.clear.empty') })), _jsx("button", { type: "button", style: primaryStyle, disabled: busy, onClick: () => { void runSave(); }, children: busyTask === 'save' ? t('form.save.saving') : saveLabel })] })] }));
}
//# sourceMappingURL=machine-form.js.map