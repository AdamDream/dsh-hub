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
import type { Context } from '@deepseek-ai/cordis';
import type { LocaleDictOf, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
/** Local, self-contained wire contracts (no cross-plugin value imports). */
export interface WireEntry {
    name: string;
    path: string;
    hidden: boolean;
}
export interface WireListing {
    path: string;
    home: string;
    crumbs: WireEntry[];
    entries: WireEntry[];
    truncated: boolean;
}
export interface ConnectionView {
    id: string;
    label: string;
    host: string;
    port: number;
    username: string;
    cwd?: string;
    auth: 'password' | 'key' | 'agent';
    jumpHosts: string[];
}
/** One exact `~/.ssh/config` Host alias (the `config.hosts` wire row). */
export interface ConfigHostView {
    alias: string;
    host: string;
    username: string;
    port: number;
    identityFile: boolean;
    jump: boolean;
}
export type WireResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/**
 * The client `workspaces` service (the Workspace Controller's own face):
 * create / rename / delete / archiveSession / list. It carries NO directory
 * methods — those live on `uiWorkspace` (`./local-directory.ts`), which is why
 * BUG-3 threw `ctx.workspaces.listDirectory is not a function`.
 */
export interface ClientWorkspaces {
    /** The workspaces feed (present once the runtime workspace service is up). */
    list?: ClientSnapshot<{
        items: readonly WorkspaceRowLike[];
    }>;
}
/** One workspace registry projection row (the sidebar grouping source). */
export interface WorkspaceRowLike {
    title: string;
    path: string;
}
/** One session list projection row (the flat-mode sidebar source). */
export interface SessionRowLike {
    displayTitle: string;
    cwd?: string;
}
/** Minimal observable snapshot face of a runtime store. */
export interface ClientSnapshot<T> {
    getSnapshot(): T;
    subscribe(fn: () => void): () => void;
}
/** The client connection handle's RPC face. */
export interface ClientConnection {
    rpc: {
        call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<WireResult>;
    };
}
/**
 * Minimal duck face of the framework LocaleRuntime (contract: i18n-contracts
 * §1.2) — only the members the plugin consumes: typed `register` + stable
 * `bind` + `subscribe` for re-render hooks. Deliberately duck-typed (same
 * stance as `slots.register`); the official dsh-client-locale client types
 * are NOT loaded to avoid dragging the official SlotRegistry onto `Context`.
 */
export interface ClientLocaleRuntime {
    register(ns: 'dsw', dicts: Record<'zh' | 'en', LocaleDictOf<'dsw'>>): () => void;
    bind(ns: 'dsw'): TranslateNS<'dsw'>;
    subscribe(fn: () => void): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        slots: {
            inject(key: string, callback: () => (() => void) | Iterable<() => void, void, void>): () => void;
            register(options: {
                name: string;
                /** List-slot row identity (required by SlotCore for list slots). */
                id?: string;
                /** Nav/sort position of a list-slot row. */
                order?: number;
                /** Registrant-localized display text (label resolver). */
                label?: () => string;
                /**
                 * Declare the registrant locale namespace (SlotCore injects the typed
                 * `t` translate seat into the component props; the renderer derives it
                 * per (namespace, revision), so a language switch re-renders cleanly).
                 */
                locale?: string;
                inject?: (...args: never[]) => Record<string, unknown>;
            }, component: unknown): () => void;
        };
        workspaces: ClientWorkspaces;
        /** Framework LocaleRuntime (hard dependency; see `inject`). */
        locale: ClientLocaleRuntime;
    }
}
/**
 * Required client services: the slot registry, the wire-facing workspace
 * service, and the locale runtime (hard dependency — the `dsw` dictionary pair
 * registers against it; matching the official client-ui packages).
 */
export declare const inject: string[];
/**
 * Client plugin body: fill both directory-flow holes with the SSH workspace
 * flow, the settings section with the machine page, and install the sidebar
 * row badge layer (DOM compatibility). `slots.inject` waits for each hole's
 * declaration, and the generator installs the two registrations
 * transactionally.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
