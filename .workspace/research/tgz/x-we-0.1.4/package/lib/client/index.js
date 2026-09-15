/**
 * Browser half of dsh-workspace-enhancement: the add-workspace directory flow —
 * a connection sidebar (saved connections, `~/.ssh/config` hosts, local entry)
 * beside the directory browser — plus the minimal machine-management settings
 * page (`settings.section`). Registered into both directory-flow holes and the
 * settings section, so mounting `dsh-workspace-enhancement` composes the whole
 * picking interaction. Cross-plane calls ride the shared web transport: local
 * listing through the client `uiWorkspace` service (the Host `directoryPicker`
 * browse capability — NOT the `workspaces` controller face, see BUG-3 and
 * `./local-directory.ts`) and remote listing/connection management through the
 * package's channel on the shared `/api` transport (`../web-channel.ts`).
 *
 * I18N: the `dsw` dictionary pair (src/locale/) is registered against the
 * framework LocaleRuntime at apply time (drafts/i18n-design.md §9) — the
 * `locale` service is a hard client dependency (inject), exactly like the
 * official client-ui packages; the settings page Language row owns switching.
 */
import { API_CHANNEL, channelEndpointOf } from "../web-channel.js";
import { registerDswLocale } from "../locale/index.js";
import { SshWorkspaceFlow } from "./flow.js";
import { createLocalDirectorySeats } from "./local-directory.js";
import { installRowBadges } from "./row-badges.js";
import { createRemoteStatusSeats, remoteStatusRegisterOptions, REMOTE_STATUS_SLOT } from "./remote-status.js";
import { RemoteStatusAction } from "./remote-status-entry.js";
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
    // Local pane seats (BUG-3): the directory capability lives on `uiWorkspace`,
    // resolved lazily and optionally so a missing service degrades to one
    // localized line instead of keeping the plugin from mounting.
    const localSeats = createLocalDirectorySeats(() => ctx.get('uiWorkspace'), () => t('flow.error.directoryUnavailable'));
    // t4: the session feed behind the header's remote-status cell. Optional
    // service (`ctx.get`, never `inject`): a runtime without the store leaves the
    // cell hidden instead of holding the whole plugin back. Built ONCE so the
    // seat function identities stay stable across renders (the cell's effect
    // depends on them).
    // The store lives on `sessions.list` — the service face itself carries
    // open/fork/search/…, so resolving the face as a feed would break the cell.
    const remoteSeats = createRemoteStatusSeats(() => {
        const sessions = ctx.get('sessions');
        return sessions?.list;
    });
    const injected = () => ({
        ...localSeats,
        ...remoteSeats,
        rpc: (endpoint, payload, signal) => {
            const connection = ctx.get('connection');
            if (connection === undefined)
                return Promise.resolve(rpcError());
            return connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint), payload ?? {}, signal);
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
    // t4: the header's remote-status cell. `conversation.session.header.utilities`
    // is the official right-aligned utilities list seat that BOTH supported
    // families declare (0.1.2-rc.1 — the family the live deployment runs — and
    // 0.1.5-rc.2), so the cell is visible on both; the title-adjacent
    // `conversation.session.header.actions` group above keeps its own cell and is
    // NOT second-registered. No conditional double registration exists anywhere:
    // `slots.inject` waits for a declaration and cannot answer whether a key
    // exists (see ADR-0017).
    ctx.slots.inject(REMOTE_STATUS_SLOT, () => ctx.slots.register({ ...remoteStatusRegisterOptions(t), inject: injected }, RemoteStatusAction));
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
        return connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint), payload ?? {}, signal);
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