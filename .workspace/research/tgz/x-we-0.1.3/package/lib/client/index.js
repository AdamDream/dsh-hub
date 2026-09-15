/**
 * Browser half of dsh-workspace-enhancement: the add-workspace directory flow —
 * a connection sidebar (saved connections, `~/.ssh/config` hosts, local entry)
 * beside the directory browser — plus the minimal machine-management settings
 * page (`settings.section`). Registered into both directory-flow holes and the
 * settings section, so mounting `dsh-workspace-enhancement` composes the whole
 * picking interaction. Cross-plane calls ride the shared web transport: local
 * listing through the `workspaces` service (the Host's `directoryPicker`
 * browse capability) and remote listing/connection management through the
 * package's `/dsw` RPC channel.
 *
 * I18N: the `dsw` dictionary pair (src/locale/) is registered against the
 * framework LocaleRuntime at apply time (drafts/i18n-design.md §9) — the
 * `locale` service is a hard client dependency (inject), exactly like the
 * official client-ui packages; the settings page Language row owns switching.
 */
import { registerDswLocale } from "../locale/index.js";
import { SshWorkspaceFlow } from "./flow.js";
import { installRowBadges } from "./row-badges.js";
import { RemoteWorkspaceSettingsPage } from "./settings.js";
import { SideWorkspacesAction } from "./side-workspaces.js";
/**
 * Required client services: the slot registry, the wire-facing workspace
 * service, and the locale runtime (hard dependency — the `dsw` dictionary pair
 * registers against it; matching the official client-ui packages).
 */
export const inject = ['slots', 'workspaces', 'sessions', 'locale'];
/**
 * Client plugin body: fill both directory-flow holes with the SSH workspace
 * flow, the settings section with the machine page, and install the sidebar
 * row badge layer (DOM compatibility). `slots.inject` waits for each hole's
 * declaration, and the generator installs the two registrations
 * transactionally.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    // I18N: register the `dsw` dictionary pair first; the effect-bound disposer
    // removes it with this context, and duplicate registration throws early.
    registerDswLocale(ctx);
    // Stable per-namespace translate reference (LocaleRuntime.bind contract):
    // read-time locale resolution, safe for the label thunks below and for any
    // closure that renders copy at call time.
    const t = ctx.locale.bind('dsw');
    const rpcError = () => ({ ok: false, error: { code: 'internal', message: t('rpc.transportUnavailable') } });
    const injected = () => ({
        listLocalDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
        createLocalDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
        rpc: (endpoint, payload, signal) => {
            const connection = ctx.get('connection');
            if (connection === undefined)
                return Promise.resolve(rpcError());
            return connection.rpc.call('/dsw', endpoint, payload ?? {}, signal);
        },
    });
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
            name: 'conversation.hero.workspace.directoryFlow', locale: 'dsw', inject: injected,
        }, SshWorkspaceFlow);
        yield ctx.slots.register({
            name: 'sidebar.workspaces.directoryFlow', locale: 'dsw', inject: injected,
        }, SshWorkspaceFlow);
    }));
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-workspace-enhancement',
        order: 40,
        // Label thunk: read-time resolution keeps the active locale live without
        // re-registration (resolveSlotLabel semantics).
        label: () => t('settings.label'),
        locale: 'dsw',
        inject: injected,
    }, RemoteWorkspaceSettingsPage));
    // R5: one per-session「工作区」button in the header action row — the single
    // entry point for attached side workspaces (add/edit perms/remove).
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'dsh-workspace-enhancement-side',
        order: 25,
        label: () => t('side.headerAction.label'),
        locale: 'dsw',
        inject: injected,
    }, SideWorkspacesAction));
    installSidebarRowBadges(ctx);
}
/**
 * Install the sidebar row badge layer (C3, DOM compatibility). Feeds project
 * from the runtime workspace/session stores; when a feed is absent (runtime
 * not yet up — the client runtime tier normally mounts before bundles),
 * grouped workspaces still mark and the flat mode degrades quietly.
 */
function installSidebarRowBadges(ctx) {
    const workspacesService = ctx.get('workspaces');
    const workspacesFeed = workspacesService?.list;
    const sessionsService = ctx.get('sessions');
    const sessionsFeed = sessionsService?.list;
    const sources = {
        workspaces: () => workspacesFeed?.getSnapshot().items.map(item => ({ title: item.title, path: item.path })) ?? [],
        sessions: () => {
            const state = sessionsFeed?.getSnapshot();
            if (state === undefined)
                return [];
            return Object.values(state.byId).map(row => ({
                title: row.displayTitle,
                ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}),
            }));
        },
    };
    const dispose = installRowBadges((endpoint, payload, signal) => {
        const connection = ctx.get('connection');
        if (connection === undefined) {
            return Promise.resolve({ ok: false, error: { code: 'internal', message: ctx.locale.bind('dsw')('rpc.transportUnavailable') } });
        }
        return connection.rpc.call('/dsw', endpoint, payload ?? {}, signal);
    }, sources, onChange => {
        const un1 = workspacesFeed?.subscribe(onChange);
        const un2 = sessionsFeed?.subscribe(onChange);
        return () => {
            if (un1 !== undefined)
                un1();
            if (un2 !== undefined)
                un2();
        };
    }, 
    // Locale seat + language-switch repaint subscription (design §7: bind gives
    // read-time locale texts; subscribe repaints injected badges in place).
    ctx.locale);
    ctx.effect(() => dispose, 'dsw: sidebar row badges');
}
//# sourceMappingURL=index.js.map