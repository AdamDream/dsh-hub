import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The add-workspace directory flow of dsh-workspace-enhancement, laid out as a connection
 * sidebar beside a directory browser (VS Code Remote Explorer style): the
 * sidebar lists `~/.ssh/config` hosts (one click resolves, registers, and
 * browses — no form), saved connections, and the local entry; the right pane
 * browses whichever side is active. Picking a remote directory hands the owner
 * an `ssh://<id><path>` workspace path, which the deployment's remote
 * providers consume (see README for the workspace-adoption seam).
 */
import { useEffect, useRef, useState } from 'react';
import { ConnectionForm } from "./form.js";
import { ConnStatusBadge, zhBaseline } from "./status.js";
import { cx, useDialogA11y } from "./ui.js";
import { AlertIcon, CheckIcon, ChevronIcon, CloseIcon, EyeIcon, FolderIcon, FolderPlusIcon, HomeIcon, KeyIcon, LockIcon, MonitorIcon, PlusIcon, RefreshIcon, RouteIcon, ServerIcon, SpinnerIcon, TrashIcon, } from "./icons.js";
import styles from './flow.module.css';
const EMPTY_PANE = { path: null, listing: null, error: null, loading: false };
/** Unwrap a wire result or throw its business error. */
function unwrap(result, fallback) {
    if (!result.ok)
        throw new Error(result.error.message || fallback);
    return result.value;
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Minimal structural check for a wire listing. */
function asListing(value) {
    const record = isRecord(value) ? value : {};
    const wireEntry = (entry) => ({
        name: String(entry?.name ?? ''),
        path: String(entry?.path ?? ''),
        hidden: entry?.hidden === true,
    });
    return {
        path: typeof record.path === 'string' ? record.path : '',
        home: typeof record.home === 'string' ? record.home : '',
        crumbs: Array.isArray(record.crumbs) ? record.crumbs.filter(isRecord).map(wireEntry) : [],
        entries: Array.isArray(record.entries) ? record.entries.filter(isRecord).map(wireEntry) : [],
        truncated: record.truncated === true,
    };
}
/** Structural check for one `config.hosts` row. */
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
/** Structural check for one secret-free connection view. */
function asConnectionView(record) {
    return {
        id: String(record.id ?? ''),
        label: String(record.label ?? ''),
        host: String(record.host ?? ''),
        port: typeof record.port === 'number' ? record.port : 22,
        username: String(record.username ?? ''),
        ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
        auth: (record.auth === 'password' || record.auth === 'agent' ? record.auth : 'key'),
        jumpHosts: Array.isArray(record.jumpHosts) ? record.jumpHosts.map(String) : [],
    };
}
/** Structural check for a `connections.resolve` result. */
function asResolved(value) {
    const record = isRecord(value) ? value : {};
    return {
        host: typeof record.host === 'string' ? record.host : '',
        username: typeof record.username === 'string' ? record.username : '',
        port: typeof record.port === 'number' ? record.port : 22,
        privateKeyPaths: Array.isArray(record.privateKeyPaths) ? record.privateKeyPaths.map(String) : [],
        jump: Array.isArray(record.jump) ? record.jump.filter(isRecord).map(hop => ({
            host: String(hop.host ?? ''),
            ...(typeof hop.port === 'number' ? { port: hop.port } : {}),
            ...(typeof hop.username === 'string' && hop.username !== '' ? { username: hop.username } : {}),
            ...(hop.privateKeyPath !== undefined ? { privateKeyPath: String(hop.privateKeyPath) } : {}),
        })) : [],
        alias: typeof record.alias === 'string' ? record.alias : '',
    };
}
/** Structural check for a `connections.add` result (its view only). */
function asAddedView(value) {
    const record = isRecord(value) ? value : {};
    return asConnectionView(isRecord(record.view) ? record.view : {});
}
/**
 * Translate a raw ssh2/web error into a readable remote failure. ssh2 never
 * consults the OS agent or default identities on its own, so a spec without
 * password/privateKey/agent surfaces as `All configured authentication
 * methods failed` — that one gets the auth-completion guidance.
 */
function describeRemoteFailure(raw, t) {
    if (/invalid_union/.test(raw)) {
        return {
            title: t('flow.error.invalidResponse.title'),
            text: t('flow.error.invalidResponse.text'),
            needsAuth: false,
        };
    }
    if (/all configured authentication methods/i.test(raw)) {
        return {
            title: t('flow.error.auth.title'),
            text: t('flow.error.auth.text'),
            needsAuth: true,
        };
    }
    if (/cannot parse privatekey|cannot read private key|invalid private key|no key found/i.test(raw)) {
        return {
            title: t('flow.error.key.title'),
            text: t('flow.error.key.text', { raw }),
            needsAuth: true,
        };
    }
    if (/timed?\s?out|etimedout/i.test(raw)) {
        return { title: t('flow.error.timeout.title'), text: t('flow.error.timeout.text'), needsAuth: false };
    }
    if (/econnrefused/i.test(raw)) {
        return { title: t('flow.error.refused.title'), text: t('flow.error.refused.text'), needsAuth: false };
    }
    if (/enotfound|getaddrinfo|dns/i.test(raw)) {
        return { title: t('flow.error.dns.title'), text: t('flow.error.dns.text'), needsAuth: false };
    }
    if (/ehostunreach|enetunreach/i.test(raw)) {
        return { title: t('flow.error.unreachable.title'), text: t('flow.error.unreachable.text'), needsAuth: false };
    }
    return { title: t('flow.error.generic.title'), text: raw, needsAuth: false };
}
/** The directory-flow occupant registered into both workspace holes. */
export function SshWorkspaceFlow(props) {
    const { open, busy, onPicked, onCancel, listLocalDirectory, createLocalDirectory, rpc, suppressSessionRoute = false, pickOnly = false, initialConnectionId = '', t: tSeat } = props;
    // The typed translate seat: injected by the slot renderer once the entry
    // declares `locale: 'dsw'` (src/client/index.ts, t7); nested call sites
    // (side-workspaces, t7) thread it explicitly. The seat itself is a stable
    // per-namespace reference (LocaleRuntime.bind), safe for memo deps.
    // t15-r2: `tSeat ?? zhBaseline` (the rest of the components' pattern) —
    // the seat is optional in FlowInjected so a seat-less renderer (tests or a
    // non-locale fence) must fall back instead of throwing.
    const t = tSeat ?? zhBaseline;
    const [mode, setMode] = useState({ kind: 'local' });
    const [pane, setPane] = useState(EMPTY_PANE);
    const [connections, setConnections] = useState([]);
    const [connectionsLoading, setConnectionsLoading] = useState(false);
    const [connectionsError, setConnectionsError] = useState(null);
    const [configHosts, setConfigHosts] = useState([]);
    const [configLoading, setConfigLoading] = useState(false);
    const [configError, setConfigError] = useState(null);
    const [hostPending, setHostPending] = useState(null);
    const [hostError, setHostError] = useState(null);
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [formOpen, setFormOpen] = useState(false);
    const [formDraft, setFormDraft] = useState(undefined);
    const [folderDraft, setFolderDraft] = useState(null);
    const [openingRemote, setOpeningRemote] = useState(false);
    const [folderBusy, setFolderBusy] = useState(false);
    const [folderError, setFolderError] = useState(null);
    const [showHidden, setShowHidden] = useState(false);
    const [nativePicking, setNativePicking] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [removingId, setRemovingId] = useState(null);
    const generation = useRef(0);
    const activeRequest = useRef(null);
    const configGeneration = useRef(0);
    const configRequest = useRef(null);
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const paneRef = useRef(pane);
    paneRef.current = pane;
    const dialogRef = useDialogA11y(open, () => { onCancel(); });
    const folderDialogRef = useDialogA11y(folderDraft !== null, () => { if (!folderBusy)
        setFolderDraft(null); });
    const deleteDialogRef = useDialogA11y(deleteTarget !== null, () => { if (removingId === null)
        setDeleteTarget(null); });
    const confirmDialogRef = useDialogA11y(confirmTarget !== null, () => { if (hostPending === null)
        setConfirmTarget(null); });
    /** List one level, guarding against superseded/closed generations. */
    const loadLevel = async (request) => {
        const current = generation.current += 1;
        const controller = new AbortController();
        activeRequest.current = controller;
        setPane(previous => ({ ...previous, loading: true, error: null }));
        try {
            const listing = await request(controller.signal);
            if (current !== generation.current || controller.signal.aborted)
                return;
            setPane({ path: listing.path, listing, error: null, loading: false });
        }
        catch (error) {
            if (current !== generation.current || controller.signal.aborted)
                return;
            setPane(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
        }
    };
    const navigateLocal = (path) => {
        setMode({ kind: 'local' });
        void loadLevel(signal => listLocalDirectory(path, signal));
    };
    const navigateRemote = (id, path) => {
        setMode({ kind: 'remote', id });
        void loadLevel(async (signal) => asListing(unwrap(await rpc('browse.list', { id, ...(path !== undefined ? { path } : {}) }, signal), t('rpc.browseList'))));
    };
    const openRemotePath = async () => {
        if (mode.kind !== 'remote' || pane.path === null || openingRemote)
            return;
        setOpeningRemote(true);
        try {
            if (pickOnly || suppressSessionRoute) {
                // Opt-out owner (side-workspaces panel) / picker-only mode: hand the
                // raw ssh:// spelling — no placeholder tree, no machine-workspace
                // write-back. Spelling matches sshTargetKey (`ssh://<id><posixPath>`);
                // the host normalizes it into the registry connection on attach.
                // pickOnly wins over suppressSessionRoute when both are present
                // (identical delivery at this boundary).
                onPicked(`ssh://${mode.id}${pane.path}`);
                return;
            }
            // The host mkdir's the session cwd locally, so hand it the local
            // placeholder that stands in for the remote route (both spellings
            // resolve to the same registry connection in the providers). Adopt it
            // through the host's own pick flow: the session gets a workspaceId
            // (the web hero gates cwd-only sessions), and the placeholder routes
            // every bash/fs/terminal operation onto the remote host.
            const routed = unwrap(await rpc('session.route', { id: mode.id, path: pane.path }), t('rpc.sessionRoute'));
            const cwd = isRecord(routed) && typeof routed.cwd === 'string' ? routed.cwd : '';
            if (cwd === '')
                throw new Error(t('flow.route.empty'));
            onPicked(cwd);
        }
        catch (error) {
            setPane(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
        }
        finally {
            setOpeningRemote(false);
        }
    };
    /**
     * Refresh the connection list. `silent` keeps the previous list on screen
     * (post-mutation refreshes) instead of flashing the skeleton. Returns the
     * freshly parsed list ([] when the call failed) so callers can validate an
     * id against the latest registry state.
     */
    const refreshConnections = async (silent = false) => {
        if (!silent)
            setConnectionsLoading(true);
        try {
            const value = unwrap(await rpc('connections.list'), t('rpc.connectionsList'));
            if (Array.isArray(value)) {
                const list = value.filter(isRecord).map(asConnectionView);
                setConnections(list);
                setConnectionsError(null);
                return list;
            }
        }
        catch (error) {
            setConnectionsError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (!silent)
                setConnectionsLoading(false);
        }
        return [];
    };
    /**
     * Refresh the `~/.ssh/config` host list (the Host re-reads the file on every
     * call). Same generation + abort guard as the directory pane so closing the
     * dialog or a rapid retry can never apply a stale answer.
     */
    const refreshConfigHosts = async (silent = false) => {
        if (!silent)
            setConfigLoading(true);
        const current = configGeneration.current += 1;
        const controller = new AbortController();
        configRequest.current = controller;
        try {
            const value = unwrap(await rpc('config.hosts', {}, controller.signal), t('rpc.configHosts'));
            if (current !== configGeneration.current || controller.signal.aborted)
                return;
            setConfigHosts(asConfigHosts(value));
            setConfigError(null);
        }
        catch (error) {
            if (current !== configGeneration.current || controller.signal.aborted)
                return;
            setConfigError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (current === configGeneration.current && !silent)
                setConfigLoading(false);
        }
    };
    /** Open: refresh both sidebar lists and browse the initial target (local home, or the saved connection named by `initialConnectionId` when it exists). Closed: abort. */
    useEffect(() => {
        if (!open) {
            generation.current += 1;
            activeRequest.current?.abort();
            activeRequest.current = null;
            configGeneration.current += 1;
            configRequest.current?.abort();
            configRequest.current = null;
            return;
        }
        generation.current += 1;
        const openGeneration = generation.current;
        setPane(EMPTY_PANE);
        setFolderDraft(null);
        setFormOpen(false);
        setFormDraft(undefined);
        setOpeningRemote(false);
        setDeleteTarget(null);
        setRemovingId(null);
        setHostPending(null);
        setHostError(null);
        setConfirmTarget(null);
        setNativePicking(false);
        void refreshConfigHosts();
        // Snapshot of the requested starting machine (empty/absent id keeps the
        // default local-home browse). When it names a saved connection, open the
        // dialog exactly like clicking that connection once its registry entry is
        // confirmed; an unknown id degrades back to the local home.
        const initialId = initialConnectionId.trim();
        if (initialId === '') {
            setMode({ kind: 'local' });
            void refreshConnections();
            void loadLevel(signal => listLocalDirectory(undefined, signal));
            return;
        }
        setMode({ kind: 'remote', id: initialId });
        void (async () => {
            const list = await refreshConnections();
            if (openGeneration !== generation.current)
                return; // closed / superseded before the list arrived
            if (list.some(connection => connection.id === initialId)) {
                navigateRemote(initialId);
            }
            else {
                setMode({ kind: 'local' });
                void loadLevel(signal => listLocalDirectory(undefined, signal));
            }
        })();
    }, [open]);
    /** The active connection view (undefined while browsing locally). */
    const activeConnection = mode.kind === 'remote' ? connections.find(connection => connection.id === mode.id) : undefined;
    const activePath = pane.path ?? '';
    const refreshCurrent = () => {
        if (modeRef.current.kind === 'local')
            navigateLocal(paneRef.current.path ?? undefined);
        else
            navigateRemote(modeRef.current.id, paneRef.current.path ?? undefined);
    };
    /** One OS folder chooser on the host display; a pick lands straight as the workspace. */
    const pickNative = async () => {
        if (mode.kind !== 'local' || nativePicking)
            return;
        setNativePicking(true);
        try {
            const result = unwrap(await rpc('local.pickNative'), t('rpc.pickNative'));
            const path = isRecord(result) && typeof result.path === 'string' ? result.path : '';
            if (path !== '')
                onPicked(path);
        }
        catch (error) {
            setPane(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
        }
        finally {
            setNativePicking(false);
        }
    };
    /** The registry entry a config alias points at, if it was registered before. */
    const matchConfigHost = (host) => connections.find(connection => connection.port === host.port
        && (connection.host.toLowerCase() === host.alias.toLowerCase()
            || connection.host.toLowerCase() === host.host.toLowerCase()));
    const openForm = (draft) => {
        setFormDraft(draft);
        setFormOpen(true);
    };
    /**
     * One click on a config host: switch to its registered entry when there is
     * one; otherwise resolve the alias first. A missing username routes to the
     * prefilled form (the registry refuses empty usernames); anything else asks
     * for confirmation before it is registered and browsed.
     */
    const activateConfigHost = async (host) => {
        if (hostPending !== null)
            return;
        const existing = matchConfigHost(host);
        if (existing !== undefined) {
            setHostError(null);
            navigateRemote(existing.id);
            return;
        }
        setHostError(null);
        setHostPending(host.alias);
        try {
            const resolved = asResolved(unwrap(await rpc('connections.resolve', { host: host.alias }), t('rpc.connectionsResolve')));
            if (resolved.host === '')
                throw new Error(t('flow.resolve.empty'));
            if (resolved.username.trim() === '') {
                openForm({
                    label: host.alias,
                    host: resolved.host,
                    port: String(resolved.port),
                    username: '',
                    ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] } : {}),
                    ...(resolved.jump.length > 0 ? { jumpText: resolved.jump.map(hop => `${hop.username !== undefined && hop.username !== '' ? `${hop.username}@` : ''}${hop.host}${hop.port !== undefined && hop.port !== 22 ? `:${String(hop.port)}` : ''}`).join(', ') } : {}),
                    focusUsername: true,
                });
                return;
            }
            setConfirmTarget({ host, resolved });
        }
        catch (error) {
            setHostError({ alias: host.alias, message: error instanceof Error ? error.message : String(error) });
        }
        finally {
            setHostPending(null);
        }
    };
    /** Confirmed: register the config host and browse its home right away. */
    const confirmAddHost = async () => {
        if (confirmTarget === null || hostPending !== null)
            return;
        const { host, resolved } = confirmTarget;
        setHostError(null);
        setHostPending(host.alias);
        try {
            const result = await rpc('connections.add', {
                label: host.alias,
                host: resolved.host,
                port: resolved.port,
                username: resolved.username,
                ...(resolved.privateKeyPaths[0] !== undefined ? { privateKeyPath: resolved.privateKeyPaths[0] } : {}),
                ...(resolved.jump.length > 0 ? { jump: resolved.jump } : {}),
            });
            const view = asAddedView(unwrap(result, t('rpc.connectionsAdd')));
            if (view.id === '')
                throw new Error(t('flow.add.missingId'));
            setConfirmTarget(null);
            await refreshConnections(true);
            await refreshConfigHosts(true);
            navigateRemote(view.id);
        }
        catch (error) {
            setConfirmTarget(null);
            setHostError({ alias: host.alias, message: error instanceof Error ? error.message : String(error) });
        }
        finally {
            setHostPending(null);
        }
    };
    /** A prefilled form for the connection whose browse just failed on auth. */
    const draftFromConnection = (connection) => ({
        label: connection.label,
        host: connection.host,
        port: String(connection.port),
        username: connection.username,
        ...(connection.jumpHosts.length > 0 ? { jumpText: connection.jumpHosts.join(', ') } : {}),
    });
    const confirmCreateFolder = async () => {
        const name = (folderDraft ?? '').trim();
        if (name === '' || pane.path === null)
            return;
        if (name === '.' || name === '..' || /[/\\]/.test(name)) {
            setFolderError(t('flow.mkdir.invalidName'));
            return;
        }
        setFolderBusy(true);
        setFolderError(null);
        try {
            if (mode.kind === 'local') {
                await createLocalDirectory(pane.path, name);
            }
            else {
                unwrap(await rpc('browse.mkdir', { id: mode.id, path: pane.path, name }), t('rpc.browseMkdir'));
            }
            setFolderDraft(null);
            refreshCurrent();
        }
        catch (error) {
            setFolderError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setFolderBusy(false);
        }
    };
    const confirmRemove = async () => {
        if (deleteTarget === null || removingId !== null)
            return;
        setRemovingId(deleteTarget.id);
        try {
            unwrap(await rpc('connections.remove', { id: deleteTarget.id }), t('rpc.connectionsRemove'));
            await refreshConnections(true);
            await refreshConfigHosts(true);
            if (mode.kind === 'remote' && mode.id === deleteTarget.id) {
                setMode({ kind: 'local' });
                void loadLevel(signal => listLocalDirectory(undefined, signal));
            }
        }
        catch (error) {
            setConnectionsError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setRemovingId(null);
            setDeleteTarget(null);
        }
    };
    const formSaved = async (view) => {
        setFormOpen(false);
        setFormDraft(undefined);
        await refreshConnections(true);
        await refreshConfigHosts(true);
        navigateRemote(view.id);
    };
    const hiddenCount = (pane.listing?.entries ?? []).filter(entry => entry.hidden).length;
    const visibleEntries = (pane.listing?.entries ?? []).filter(entry => showHidden || !entry.hidden);
    const home = pane.listing?.home ?? '';
    const crumbs = pane.listing?.crumbs ?? [];
    const lastCrumbIndex = crumbs.length - 1;
    const subtitle = mode.kind === 'local'
        ? t('flow.subtitle.local')
        : t('flow.subtitle.remote', { endpoint: activeConnection !== undefined ? `${activeConnection.username}@${activeConnection.host}:${activeConnection.port}` : mode.id });
    /** The translated remote failure for the right pane, when there is one. */
    const remoteFailure = mode.kind === 'remote' && pane.error !== null ? describeRemoteFailure(pane.error, t) : null;
    if (!open)
        return null;
    return (_jsxs("div", { className: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget)
            onCancel(); }, children: [_jsxs("div", { className: styles.dialog, role: "dialog", "aria-modal": "true", "aria-label": t('flow.dialog.label'), ref: dialogRef, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.headerText, children: [_jsx("h3", { className: styles.title, children: t('flow.title') }), _jsx("p", { className: styles.subtitle, children: subtitle })] }), _jsx("button", { type: "button", className: styles.iconButton, "aria-label": t('flow.close.label'), onClick: onCancel, children: _jsx(CloseIcon, {}) })] }), _jsxs("div", { className: styles.body, children: [_jsxs("nav", { className: styles.sidebar, "aria-label": t('flow.sidebar.label'), children: [_jsx("section", { className: styles.sidebarSection, "aria-label": t('flow.sidebar.local.section'), children: _jsx("ul", { className: styles.connectionList, role: "list", children: _jsx("li", { className: cx(styles.connectionItem, mode.kind === 'local' && styles.connectionItemActive), children: _jsxs("button", { type: "button", className: styles.connectionMain, "aria-current": mode.kind === 'local' ? 'true' : 'false', onClick: () => { if (mode.kind !== 'local')
                                                        navigateLocal(); }, children: [_jsx(MonitorIcon, { className: styles.connectionIcon }), _jsxs("span", { className: styles.connectionInfo, children: [_jsx("span", { className: styles.connectionLabel, children: t('flow.sidebar.local.title') }), _jsx("span", { className: styles.connectionDetail, children: _jsx("span", { className: styles.connectionEndpoint, children: t('flow.sidebar.local.subtitle') }) })] })] }) }) }) }), _jsxs("section", { className: styles.sidebarSection, "aria-label": t('flow.sidebar.saved.section'), children: [_jsxs("h4", { className: styles.sidebarTitle, children: [t('flow.sidebar.saved.title'), connections.length > 0 && _jsx("span", { className: styles.sidebarCount, children: connections.length })] }), connectionsLoading && (_jsx("div", { role: "status", "aria-label": t('flow.sidebar.saved.loading'), children: [0, 1].map(index => (_jsxs("div", { className: styles.skeletonRow, children: [_jsx("div", { className: styles.skeletonDot }), _jsxs("div", { className: styles.skeletonLines, children: [_jsx("div", { className: styles.skeletonLine, style: { width: '38%' } }), _jsx("div", { className: styles.skeletonLine, style: { width: '62%' } })] })] }, index))) })), connectionsError !== null && !connectionsLoading && (_jsxs("div", { className: styles.sideError, role: "alert", children: [_jsx("span", { className: styles.sideErrorText, children: connectionsError }), _jsxs("button", { type: "button", className: styles.retryButton, onClick: () => { void refreshConnections(); }, children: [_jsx(RefreshIcon, { style: { width: 12, height: 12 } }), t('flow.retry')] })] })), !connectionsLoading && connectionsError === null && connections.length === 0 && (_jsxs("div", { className: styles.sideEmpty, children: [_jsx(ServerIcon, { className: styles.sideEmptyIcon, style: { width: 18, height: 18 } }), _jsx("p", { className: styles.sideEmptyTitle, children: t('flow.sidebar.saved.empty.title') }), _jsx("p", { className: styles.sideEmptyText, children: t('flow.sidebar.saved.empty.text') })] })), !connectionsLoading && connections.length > 0 && (_jsx("ul", { className: styles.connectionList, role: "list", children: connections.map(connection => {
                                                    const active = mode.kind === 'remote' && mode.id === connection.id;
                                                    return (_jsxs("li", { className: cx(styles.connectionItem, active && styles.connectionItemActive), children: [_jsxs("button", { type: "button", className: styles.connectionMain, "aria-current": active ? 'true' : 'false', onClick: () => { navigateRemote(connection.id); }, children: [_jsx(ServerIcon, { className: styles.connectionIcon }), _jsxs("span", { className: styles.connectionInfo, children: [_jsx("span", { className: styles.connectionLabel, children: connection.label }), _jsxs("span", { className: styles.connectionDetail, children: [_jsxs("span", { className: styles.connectionEndpoint, children: [connection.username, "@", connection.host, ":", connection.port] }), _jsxs("span", { className: styles.badge, children: [connection.auth === 'password' ? _jsx(LockIcon, { style: { width: 11, height: 11 } }) : _jsx(KeyIcon, { style: { width: 11, height: 11 } }), connection.auth === 'password' ? t('flow.badge.auth.password') : connection.auth === 'agent' ? t('flow.badge.auth.agent') : t('flow.badge.auth.key')] }), connection.jumpHosts.length > 0 && (_jsxs("span", { className: styles.badge, title: connection.jumpHosts.join(' → '), children: [_jsx(RouteIcon, { style: { width: 11, height: 11 } }), t('flow.badge.jump', { n: connection.jumpHosts.length })] }))] })] })] }), _jsx("span", { className: styles.connectionStatus, children: _jsx(ConnStatusBadge, { id: connection.id, rpc: rpc, t: t, compact: true }) }), _jsx("button", { type: "button", className: styles.connectionRemove, "aria-label": t('flow.connection.delete.label', { label: connection.label }), title: t('flow.connection.delete.title'), onClick: () => { setDeleteTarget(connection); }, children: _jsx(TrashIcon, { style: { width: 14, height: 14 } }) })] }, connection.id));
                                                }) }))] }), _jsxs("section", { className: styles.sidebarSection, "aria-label": t('flow.sidebar.ssh.section'), children: [_jsxs("h4", { className: styles.sidebarTitle, children: [t('flow.sidebar.ssh.title'), configHosts.length > 0 && _jsx("span", { className: styles.sidebarCount, children: configHosts.length })] }), configLoading && (_jsx("div", { role: "status", "aria-label": t('flow.sidebar.ssh.loading'), children: [0, 1].map(index => (_jsxs("div", { className: styles.skeletonRow, children: [_jsx("div", { className: styles.skeletonDot }), _jsxs("div", { className: styles.skeletonLines, children: [_jsx("div", { className: styles.skeletonLine, style: { width: '38%' } }), _jsx("div", { className: styles.skeletonLine, style: { width: '62%' } })] })] }, index))) })), configError !== null && !configLoading && (_jsxs("div", { className: styles.sideError, role: "alert", children: [_jsx("span", { className: styles.sideErrorText, children: t('flow.sidebar.ssh.error', { detail: configError }) }), _jsxs("button", { type: "button", className: styles.retryButton, onClick: () => { void refreshConfigHosts(); }, children: [_jsx(RefreshIcon, { style: { width: 12, height: 12 } }), t('flow.retry')] })] })), !configLoading && configError === null && configHosts.length === 0 && (_jsxs("div", { className: styles.sideEmpty, children: [_jsx("p", { className: styles.sideEmptyTitle, children: t('flow.sidebar.ssh.empty.title') }), _jsx("p", { className: styles.sideEmptyText, children: t('flow.sidebar.ssh.empty.text') })] })), !configLoading && configHosts.length > 0 && (_jsx("ul", { className: styles.connectionList, role: "list", children: configHosts.map(host => {
                                                    const registered = matchConfigHost(host);
                                                    const working = hostPending === host.alias;
                                                    const failed = hostError !== null && hostError.alias === host.alias;
                                                    return (_jsx("li", { className: styles.connectionItem, children: _jsxs("button", { type: "button", className: styles.connectionMain, "aria-current": "false", disabled: hostPending !== null, title: registered !== undefined
                                                                ? t('flow.ssh.registered.title', { user: registered.username, host: registered.host, port: registered.port })
                                                                : host.username !== ''
                                                                    ? t('flow.ssh.clickRegister.title', { user: host.username, host: host.host, port: host.port })
                                                                    : t('flow.ssh.noUsername.title'), onClick: () => { void activateConfigHost(host); }, children: [_jsx(ServerIcon, { className: styles.connectionIcon }), _jsxs("span", { className: styles.connectionInfo, children: [_jsx("span", { className: styles.connectionLabel, children: host.alias }), _jsx("span", { className: styles.connectionDetail, children: working ? (_jsxs("span", { className: styles.hostWorking, children: [_jsx(SpinnerIcon, { className: cx(styles.spin, styles.hostSpinner) }), t('flow.ssh.adding')] })) : failed && hostError !== null ? (_jsx("span", { className: styles.hostErrorText, role: "alert", children: t('flow.ssh.addFailed', { message: hostError.message }) })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: styles.connectionEndpoint, children: host.username !== '' ? `${host.username}@${host.host}:${host.port}` : t('flow.ssh.noUsername') }), registered !== undefined ? (_jsxs("span", { className: cx(styles.badge, styles.badgeAdded), children: [_jsx(CheckIcon, { style: { width: 11, height: 11 } }), t('flow.ssh.added')] })) : (_jsxs(_Fragment, { children: [host.identityFile && (_jsxs("span", { className: styles.badge, children: [_jsx(KeyIcon, { style: { width: 11, height: 11 } }), t('flow.ssh.badge.key')] })), host.jump && (_jsxs("span", { className: styles.badge, children: [_jsx(RouteIcon, { style: { width: 11, height: 11 } }), t('flow.ssh.badge.jump')] }))] }))] })) })] })] }) }, host.alias));
                                                }) }))] }), _jsx("button", { type: "button", className: styles.sidebarAdd, "aria-label": t('flow.connection.new.label'), title: t('flow.connection.new.title'), onClick: () => { openForm(); }, children: _jsx(PlusIcon, { style: { width: 14, height: 14 } }) })] }), _jsxs("div", { className: styles.main, children: [_jsxs("div", { className: styles.toolbar, children: [_jsxs("nav", { className: styles.crumbs, "aria-label": t('flow.crumbs.label'), children: [_jsx("button", { type: "button", className: styles.crumb, "aria-label": t('flow.crumb.home.label'), title: t('flow.crumb.home.title'), disabled: home === '' || pane.loading, onClick: () => {
                                                            if (mode.kind === 'local')
                                                                navigateLocal(home);
                                                            else
                                                                navigateRemote(mode.id, home);
                                                        }, children: _jsx(HomeIcon, { style: { width: 13, height: 13, verticalAlign: '-2px' } }) }), crumbs.map((crumb, index) => index === lastCrumbIndex ? (_jsx("span", { className: styles.crumbCurrent, "aria-current": "page", title: crumb.path, children: crumb.name }, crumb.path)) : (_jsxs("span", { className: styles.crumbStep, children: [_jsx("button", { type: "button", className: styles.crumb, disabled: pane.loading, onClick: () => {
                                                                    if (mode.kind === 'local')
                                                                        navigateLocal(crumb.path);
                                                                    else
                                                                        navigateRemote(mode.id, crumb.path);
                                                                }, children: crumb.name }), _jsx("span", { className: styles.crumbSep, "aria-hidden": true, children: "/" })] }, crumb.path)))] }), _jsxs("div", { className: styles.toolbarActions, children: [mode.kind === 'local' && (_jsxs("button", { type: "button", className: cx(styles.toolButton, styles.toolButtonText), "aria-label": t('flow.nativePicker.label'), title: t('flow.nativePicker.title'), disabled: nativePicking || busy, onClick: () => { void pickNative(); }, children: [nativePicking ? _jsx(SpinnerIcon, { className: styles.spin }) : _jsx(FolderIcon, { style: { width: 13, height: 13 } }), t('flow.nativePicker.text')] })), _jsx("button", { type: "button", className: styles.toolButton, "aria-label": t('flow.mkdir.label'), title: t('flow.mkdir.title'), disabled: pane.listing === null || pane.loading, onClick: () => {
                                                            setFolderDraft('');
                                                            setFolderError(null);
                                                        }, children: _jsx(FolderPlusIcon, {}) }), _jsxs("button", { type: "button", className: cx(styles.toolButton, showHidden && styles.toolButtonOn), "aria-pressed": showHidden, "aria-label": showHidden ? t('flow.hidden.hideLabel') : t('flow.hidden.showLabel'), title: showHidden ? t('flow.hidden.hideTitle') : t('flow.hidden.showTitle'), onClick: () => { setShowHidden(previous => !previous); }, children: [_jsx(EyeIcon, {}), !showHidden && hiddenCount > 0 && _jsx("span", { className: styles.countBadge, "aria-hidden": true, children: hiddenCount })] }), _jsx("button", { type: "button", className: styles.toolButton, "aria-label": t('flow.refresh.label'), title: t('flow.refresh.title'), disabled: pane.loading || pane.listing === null, onClick: refreshCurrent, children: _jsx(RefreshIcon, { className: pane.loading ? styles.spin : undefined }) })] })] }), _jsxs("div", { className: cx(styles.browser, pane.loading && pane.listing !== null && styles.browserBusy), "aria-busy": pane.loading, children: [pane.loading && pane.listing === null && (_jsx("div", { className: styles.skeletons, role: "status", "aria-label": t('flow.loading.label'), children: [52, 78, 64, 90, 45, 71].map((width, index) => (_jsx("div", { className: styles.skeleton, style: { width: `${width}%` } }, index))) })), pane.error !== null && !pane.loading && (_jsxs("div", { className: styles.errorPanel, role: "alert", children: [_jsx(AlertIcon, { className: styles.errorIcon }), _jsxs("div", { className: styles.errorBody, children: [_jsx("p", { className: styles.errorTitle, children: remoteFailure !== null ? remoteFailure.title : mode.kind === 'remote' ? t('flow.browse.error.remote') : t('flow.browse.error.local') }), _jsx("p", { className: styles.errorText, children: remoteFailure !== null ? remoteFailure.text : pane.error })] }), _jsxs("div", { className: styles.errorActions, children: [remoteFailure?.needsAuth === true && activeConnection !== undefined && (_jsxs("button", { type: "button", className: styles.retryButton, onClick: () => { openForm(draftFromConnection(activeConnection)); }, children: [_jsx(KeyIcon, { style: { width: 12, height: 12 } }), t('flow.auth.complete')] })), _jsxs("button", { type: "button", className: styles.retryButton, onClick: refreshCurrent, children: [_jsx(RefreshIcon, { style: { width: 12, height: 12 } }), t('flow.retry')] })] })] })), pane.listing !== null && visibleEntries.length === 0 && !pane.loading && pane.error === null && (_jsxs("div", { className: styles.emptyState, children: [_jsx(FolderIcon, { className: styles.emptyIcon, style: { width: 22, height: 22 } }), _jsx("p", { className: styles.emptyTitle, children: t('flow.empty.title') }), _jsx("p", { className: styles.emptyText, children: hiddenCount > 0 && !showHidden
                                                            ? t('flow.empty.hidden', { n: hiddenCount })
                                                            : t('flow.empty.text') })] })), visibleEntries.length > 0 && (_jsx("ul", { className: styles.entryList, role: "list", children: visibleEntries.map(entry => (_jsx("li", { children: _jsxs("button", { type: "button", className: cx(styles.entry, entry.hidden && styles.entryHidden), onClick: () => {
                                                            if (mode.kind === 'local')
                                                                navigateLocal(entry.path);
                                                            else
                                                                navigateRemote(mode.id, entry.path);
                                                        }, children: [_jsx(FolderIcon, { className: styles.entryIcon }), _jsx("span", { className: styles.entryName, children: entry.name }), _jsx(ChevronIcon, { className: styles.entryChevron })] }) }, entry.path))) })), pane.listing?.truncated === true && (_jsx("p", { className: styles.truncated, children: t('flow.truncated') }))] })] })] }), _jsxs("footer", { className: styles.footer, children: [_jsx("button", { type: "button", className: styles.button, disabled: busy, onClick: onCancel, children: t('flow.cancel') }), _jsxs("button", { type: "button", className: cx(styles.button, styles.primary), disabled: pane.listing === null || pane.loading || busy || openingRemote || pane.path === null, onClick: () => {
                                    if (pane.path === null)
                                        return;
                                    if (mode.kind === 'local')
                                        onPicked(pane.path);
                                    else if (pickOnly)
                                        onPicked(`ssh://${mode.id}${pane.path}`);
                                    else
                                        void openRemotePath();
                                }, children: [mode.kind === 'remote' && openingRemote && _jsx(SpinnerIcon, { className: styles.spin }), mode.kind === 'remote' ? (openingRemote ? t('flow.footer.connecting') : (pickOnly ? t('flow.footer.pick') : t('flow.footer.open'))) : t('flow.footer.select')] })] })] }), folderDraft !== null && (_jsx("div", { className: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget && !folderBusy)
                    setFolderDraft(null); }, children: _jsxs("div", { className: styles.smallDialog, role: "dialog", "aria-modal": "true", "aria-label": t('flow.mkdir.dialogLabel'), ref: folderDialogRef, children: [_jsx("h3", { className: styles.formTitle, children: t('flow.mkdir.title') }), _jsxs("p", { className: styles.createIn, children: [t('flow.mkdir.location'), _jsx("span", { className: cx(styles.mono, styles.createPath), children: activePath === '' ? '…' : activePath })] }), _jsx("input", { className: cx(styles.input, folderError !== null && styles.inputError), value: folderDraft, placeholder: t('flow.mkdir.placeholder'), disabled: folderBusy, onChange: (event) => { setFolderDraft(event.target.value); }, onKeyDown: (event) => { if (event.key === 'Enter' && !folderBusy)
                                void confirmCreateFolder(); } }), folderError !== null && _jsx("p", { className: styles.fieldError, role: "alert", children: folderError }), _jsxs("div", { className: styles.formActions, children: [_jsx("span", { className: styles.gap }), _jsx("button", { type: "button", className: styles.button, disabled: folderBusy, onClick: () => { setFolderDraft(null); }, children: t('flow.cancel') }), _jsxs("button", { type: "button", className: cx(styles.button, styles.primary), disabled: folderBusy || (folderDraft ?? '').trim() === '', onClick: () => { void confirmCreateFolder(); }, children: [folderBusy && _jsx(SpinnerIcon, { className: styles.spin }), t('flow.mkdir.create')] })] })] }) })), deleteTarget !== null && (_jsx("div", { className: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget && removingId === null)
                    setDeleteTarget(null); }, children: _jsxs("div", { className: styles.smallDialog, role: "dialog", "aria-modal": "true", "aria-label": t('flow.connection.delete.dialogLabel'), ref: deleteDialogRef, children: [_jsxs("div", { className: styles.confirmHead, children: [_jsx("span", { className: styles.confirmIconWrap, children: _jsx(TrashIcon, {}) }), _jsxs("div", { children: [_jsx("h3", { className: styles.formTitle, children: t('flow.connection.delete.confirm', { label: deleteTarget.label }) }), _jsx("p", { className: styles.confirmText, children: t('flow.connection.delete.text', { u: deleteTarget.username, h: deleteTarget.host, p: deleteTarget.port }) })] })] }), _jsxs("div", { className: styles.formActions, children: [_jsx("span", { className: styles.gap }), _jsx("button", { type: "button", className: styles.button, disabled: removingId !== null, onClick: () => { setDeleteTarget(null); }, children: t('flow.cancel') }), _jsxs("button", { type: "button", className: cx(styles.button, styles.danger), disabled: removingId !== null, onClick: () => { void confirmRemove(); }, children: [removingId !== null && _jsx(SpinnerIcon, { className: styles.spin }), t('flow.connection.delete.title')] })] })] }) })), confirmTarget !== null && (_jsx("div", { className: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget && hostPending === null)
                    setConfirmTarget(null); }, children: _jsxs("div", { className: styles.smallDialog, role: "dialog", "aria-modal": "true", "aria-label": t('flow.ssh.confirm.dialogLabel'), ref: confirmDialogRef, children: [_jsxs("div", { className: styles.confirmHead, children: [_jsx("span", { className: cx(styles.confirmIconWrap, styles.confirmIconInfo), children: _jsx(ServerIcon, {}) }), _jsxs("div", { children: [_jsx("h3", { className: styles.formTitle, children: t('flow.ssh.confirm.title', { alias: confirmTarget.host.alias }) }), _jsx("p", { className: styles.confirmText, children: confirmTarget.resolved.jump.length > 0
                                                ? t('flow.ssh.confirm.text.jump', {
                                                    u: confirmTarget.resolved.username,
                                                    h: confirmTarget.resolved.host,
                                                    p: confirmTarget.resolved.port,
                                                    n: confirmTarget.resolved.jump.length,
                                                })
                                                : t('flow.ssh.confirm.text', {
                                                    u: confirmTarget.resolved.username,
                                                    h: confirmTarget.resolved.host,
                                                    p: confirmTarget.resolved.port,
                                                }) })] })] }), _jsxs("div", { className: styles.formActions, children: [_jsx("span", { className: styles.gap }), _jsx("button", { type: "button", className: styles.button, disabled: hostPending !== null, onClick: () => { setConfirmTarget(null); }, children: t('flow.cancel') }), _jsxs("button", { type: "button", className: cx(styles.button, styles.primary), disabled: hostPending !== null, onClick: () => { void confirmAddHost(); }, children: [hostPending !== null && _jsx(SpinnerIcon, { className: styles.spin }), t('flow.ssh.confirm.submit')] })] })] }) })), formOpen && (_jsx(ConnectionForm, { rpc: rpc, draft: formDraft, t: t, onClose: () => { setFormOpen(false); setFormDraft(undefined); }, onSaved: (view) => { void formSaved(view); } }))] }));
}
//# sourceMappingURL=flow.js.map