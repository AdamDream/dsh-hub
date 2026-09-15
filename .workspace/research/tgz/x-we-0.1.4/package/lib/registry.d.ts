/**
 * Connection registry for the web channel: persisted multi-machine state
 * (`<dsh home>/remote-workspaces/machines.json`, dsh-remote's path and
 * `{ list, currentId }` shape), TOFU host-key trust, optional OS-keychain
 * passwords, and `~/.ssh/config` awareness.
 *
 * The registry is the single source of truth for every connection surface:
 * the `connections.*` web endpoints (kept for the existing client) and the
 * `ssh://<id>/<path>` routing used by the directory browser and the
 * fs/subprocess providers resolve through this service, so every surface
 * shares one live connection per entry.
 *
 * Rust-in-first-run migration: when machines.json is absent and the legacy
 * `dsh-ssh-connections.json` exists, its entries are imported verbatim (ids
 * preserved so `ssh://c1/...` routes keep working) and the legacy file is
 * renamed to `dsh-ssh-connections.json.bak`.
 * @module dsh-workspace-enhancement/registry
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SshConnection } from './connection.ts';
import type { SshConnectionSpec } from './connection.ts';
import type { ExecOutcome } from './ssh-core.ts';
import { HostKeyStore } from './hostkey.ts';
import type { HostKeyMode, KnownHostEntry } from './hostkey.ts';
import type { CredentialBackend } from './credential.ts';
import type { JumpConfig } from './runtime.ts';
import type { RemoteApprovalMode } from './remote-approval-gate.ts';
import type { RemoteSandboxMode } from './remote-sandbox.ts';
/** Registry plugin config. */
export interface RegistryConfig {
    /**
     * Legacy persisted state file (`dsh-ssh-connections.json`); used as the
     * migration source on first run. Defaults to `<dsh home>/dsh-ssh-connections.json`.
     */
    stateFile?: string;
    /** machines.json path; defaults to `<dsh home>/remote-workspaces/machines.json`. */
    machinesFile?: string;
    /** TOFU store path; defaults to `<dsh home>/remote-workspaces/known_hosts.json`. */
    knownHostsFile?: string;
    /** OS-keychain secrets directory; defaults to `<dsh home>/remote-workspaces/.secrets`. */
    secretsDir?: string;
    /**
     * Global default TOFU mode for registry connections (`accept-new`,
     * `verify`, `off`; validated in the constructor — anything else reads as
     * `accept-new`). A machine's `hostKeyMode` overrides it.
     */
    hostKeyMode?: string;
    /**
     * How long (ms) a probe/reconnect result serves `statusOf` without a new
     * network call. Zero disables the cache. Defaults to 5000.
     */
    statusTtlMs?: number;
    /**
     * Default-machine fallback fields (the plugin row's cordis.yml `host` etc.):
     * used as the active machine while machines.json is empty.
     */
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    agent?: string;
    cwd?: string;
    strictHostKeyChecking?: boolean;
    knownHosts?: string[];
}
/** Client-facing view of one registered connection (no secrets). */
export interface SshConnectionView {
    id: string;
    label: string;
    host: string;
    port: number;
    username: string;
    cwd?: string;
    auth: 'password' | 'key' | 'agent';
    jumpHosts: string[];
}
/** One exact `~/.ssh/config` Host alias as the sidebar lists it. */
export interface SshConfigHostView {
    /** The exact alias as spelled in the config (no wildcards). */
    alias: string;
    /** The resolved HostName, or the alias when none is configured. */
    host: string;
    /** The block's User; empty when the config does not specify one. */
    username: string;
    port: number;
    /** Whether the block lists at least one IdentityFile. */
    identityFile: boolean;
    /** Whether the block lists a ProxyJump chain. */
    jump: boolean;
}
/** One ProxyJump hop after `~/.ssh/config` resolution. */
export interface ResolvedJump {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    agent?: string;
}
/** The result of resolving a host alias against `~/.ssh/config`. */
export interface ResolvedSshConfig {
    host: string;
    username: string;
    port: number;
    privateKeyPaths: string[];
    jump: ResolvedJump[];
}
/** Payload the channel accepts for a new connection (`connections.add`). */
export interface ConnectionInput {
    label?: string;
    host: string;
    port?: number;
    username?: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    agent?: string;
    jump?: ResolvedJump[];
    cwd?: string;
    /**
     * When true, reject a host key that does not match an entry in
     * {@link knownHosts}. Defaults to false (historical behavior).
     */
    strictHostKeyChecking?: boolean;
    /** Trusted host keys as `SHA256:<base64>` fingerprints or raw base64 public keys. */
    knownHosts?: string[];
    /** Per-machine TOFU policy; overrides the registry-wide default. */
    hostKeyMode?: HostKeyMode;
}
/** Payload accepted by `machines.add` (superset of {@link ConnectionInput}). */
export interface MachineInput {
    /** Existing machine id to update (upsert); absent creates a new machine. */
    id?: string;
    label?: string;
    /** dsh-remote compat alias; used as the label fallback. */
    name?: string;
    host: string;
    port?: number;
    username?: string;
    password?: string;
    /** Store the password in the OS keychain (backend = platform default). */
    encryptPassword?: boolean;
    /** Explicit credential backend; `plain` keeps the password in machines.json. */
    credentialBackend?: CredentialBackend;
    privateKeyPath?: string;
    passphrase?: string;
    agent?: string;
    jump?: ResolvedJump[];
    cwd?: string;
    workspace?: string;
    hostKeyMode?: HostKeyMode;
    strictHostKeyChecking?: boolean;
    knownHosts?: string[];
    /** AUDIT-6 per-machine approval gate mode (omitted ⇒ keep stored value). */
    remoteApproval?: RemoteApprovalMode;
    /**
     * REQ-I9 per-machine remote sandbox fence mode (omitted ⇒ keep stored
     * value). `'off'` is the default and is never persisted.
     */
    remoteSandbox?: RemoteSandboxMode;
}
/** Secret-free machine view returned by `machines.*` endpoints and `status`. */
export interface MachineView {
    id: string;
    label: string;
    host: string;
    port: number;
    username: string;
    cwd?: string;
    workspace?: string;
    auth: 'password' | 'key' | 'agent';
    passwordSet: boolean;
    jumpHosts: string[];
    hostKeyMode?: HostKeyMode;
    credentialBackend: CredentialBackend;
    /**
     * AUDIT-6 effective approval-gate mode (ADR-0020 D2) — always present in
     * views, normalized to `'off'` for records that predate the field.
     */
    remoteApproval: RemoteApprovalMode;
    /**
     * REQ-I9 effective remote sandbox fence mode (ADR-0022 D1) — always present
     * in views, normalized to `'off'` for records that predate the field.
     */
    remoteSandbox: RemoteSandboxMode;
    /** Encryption was requested but fell back to plaintext (UI warning marker). */
    encryptFallback?: boolean;
    lastConnectedAt?: string | null;
    latencyMs?: number | null;
    recentWorkspaces?: string[];
}
/** The pure status snapshot shared by the `status` endpoint and sw_status. */
export interface WorkspaceStatus {
    host: string;
    port: number;
    username: string;
    /** Whether the active machine's chain reached its ready state. */
    connected: boolean;
    /** Effective remote workspace of the active machine (`workspace` wins). */
    workspace: string;
    currentId: string | null;
    /**
     * Where the active machine comes from. `'ephemeral'` is retained as a
     * wire-vocabulary member for older clients only: it became unreachable when
     * temporary connections were retired (REQ-I11 / ADR-0021 §5), so the registry
     * now only ever reports `'machine' | 'config' | 'none'`.
     */
    activeSource: 'machine' | 'ephemeral' | 'config' | 'none';
    /** Effective host-key mode of the active machine (or the global default). */
    hostKeyMode: HostKeyMode;
    /** Whether the active endpoint has a recorded TOFU fingerprint. */
    hostKeyKnown: boolean;
    /** The active endpoint's trust record, when known. */
    hostKeyEntry: KnownHostEntry | null;
    machines: MachineView[];
    backend: CredentialBackend;
}
/** Tri-state connection status of one registry entry (secret-free). */
export interface ConnectionStatusView {
    id: string;
    /**
     * `unknown`: no live chain was ever built for this entry in this process
     * (and no probe has succeeded); `active`: a live chain reports ready or the
     * last probe succeeded; `offline`: a live chain exists but is not ready, or
     * the last probe failed.
     */
    state: 'unknown' | 'active' | 'offline';
    /** Whether the live chain currently reports its ready state. */
    connected: boolean;
    label: string;
    host: string;
    port: number;
    username: string;
    /** Whether the endpoint has a recorded TOFU fingerprint. */
    hostKeyKnown: boolean;
    /** ISO-8601 timestamp of the last successful probe; absent before the first. */
    lastProbeAt?: string;
    /** Round-trip milliseconds of the last successful probe. */
    lastProbeLatencyMs?: number | null;
    /** Human-readable failure summary of the last failed probe/connect. */
    message?: string;
}
/**
 * Pure tri-state derivation (exported for tests): a failed probe outranks a
 * live chain, a live unready chain is offline, and no chain at all is unknown.
 */
export declare function deriveConnectionState(hasLive: boolean, liveConnected: boolean, probeFailed: boolean): ConnectionStatusView['state'];
/**
 * Structural face of a live connection the status endpoints use
 * (SshConnection satisfies it; tests substitute a fake).
 */
export interface ProbedConnection {
    isConnected(): boolean;
    exec(command: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<ExecOutcome>;
    dispose(): void;
}
/** Probe budget: one round-trip `echo ok` with a hard timeout. */
export declare const PROBE_TIMEOUT_MS = 8000;
/** Default TTL of a probe result served by `statusOf` without a new network call. */
export declare const DEFAULT_STATUS_TTL_MS = 5000;
declare module '@deepseek-ai/cordis' {
    interface Context {
        sshRegistry: SshRegistry;
    }
}
/** The `ssh://<id>/<path>` routing result shared by browsers and providers. */
export interface SshRoute {
    connection: SshConnection;
    /** Absolute POSIX path on the remote host. */
    path: string;
}
/** Parse `ssh://<connId>/<abs>` (the workspace/cwd spelling of a remote path). */
export declare function parseSshRoute(value: string): {
    id: string;
    path: string;
} | null;
/**
 * Normalize one persisted machine record. Accepts both the dsh-ssh spec shape
 * and the dsh-remote machines.json record shape (`name`/`workspace`/`proxy`/
 * `useAgent` aliases) so an existing dsh-remote machines.json at the same path
 * keeps working.
 */
export declare function normalizeMachine(raw: unknown): SshConnectionSpec | null;
export interface MachinesState {
    list: SshConnectionSpec[];
    currentId: string | null;
    /** Whether the legacy file was imported (and renamed to `.bak`) this run. */
    migrated: boolean;
}
/**
 * Load the machine state. First-run migration: when machines.json holds no
 * machines — the file is absent, or a dsh-remote-era empty table
 * (`{ list: [], currentId: null }`) sits in its place — and the legacy
 * `dsh-ssh-connections.json` exists, import its entries verbatim (ids
 * preserved), persist machines.json with the first imported connection as
 * current, and rename the legacy file to `<name>.bak` so a second run never
 * re-imports it.
 *
 * A machines.json with a non-empty list is NEVER touched (an existing registry
 * wins); a corrupt machines.json is left alone as well (its data may be
 * recoverable). With no legacy file, the current state (incl. an empty table)
 * is returned unchanged and no `.bak` is produced.
 */
export declare function loadMachinesState(machinesFile: string, legacyFile: string, warn: (message: string) => void): MachinesState;
/**
 * Resolve the effective password of a connection test, mirroring the
 * connect-time {@link resolveTargetPassword} semantics: an explicit non-empty
 * input password ALWAYS wins; a PLAINTEXT prev machine (an id-only test — the
 * edit form's「测试连接」shape — without a typed password) authenticates with
 * its stored plaintext password (F1: the old code dropped to '' here, ssh2
 * fell back to the default identity probe, and a key-authenticated host
 * reported a false-positive success); a keychain-backed machine resolves its
 * OS-store secret. A provider miss leaves no password.
 * @param input - the test payload (may carry `id` naming the edited machine).
 * @param prev - the persisted machine record the payload updates, if any.
 * @param resolve - the registry's password resolver (plaintext or OS keychain).
 * @returns the password the temporary test connection authenticates with
 *   (empty string counts as "no explicit password").
 */
export declare function resolveTestPassword(input: MachineInput, prev: SshConnectionSpec | undefined, resolve: (spec: SshConnectionSpec) => Promise<string | undefined>): Promise<string>;
/**
 * P2-④: test-time credential merge — the test connection authenticates like
 * the SAVE would. Same wire contract as {@link SshRegistry.saveMachine}: an
 * OMITTED field keeps the updated machine's stored value (the secret-free
 * edit form omits the key/passphrase/agent it cannot echo), an EXPLICIT empty
 * string clears it, and a typed value wins. Editing a key machine and
 * clicking「测试连接」must succeed without retyping the key path (the old code
 * built a key-less spec and failed every key-machine edit-test). Jump follows
 * the save rule too: an explicit chain replaces the stored one, an omitted
 * chain keeps it.
 * @param input - the test payload (may carry `id` naming the edited machine).
 * @param prev - the persisted machine record the payload updates, if any.
 * @returns the effective auth fields for the temporary test connection.
 */
export declare function mergeTestFields(input: Pick<MachineInput, 'privateKeyPath' | 'passphrase' | 'agent' | 'jump'>, prev: Pick<SshConnectionSpec, 'privateKeyPath' | 'passphrase' | 'agent' | 'jump'> | undefined): {
    privateKeyPath?: string;
    passphrase?: string;
    agent?: string;
    jump?: readonly (ResolvedJump | JumpConfig)[];
};
/**
 * Machine registry service. Persisted state is `machines.json` (single source
 * of truth); live `SshConnection` instances are created lazily and share one
 * chain per entry. Secret fields are persisted verbatim for plaintext
 * machines (the file lives under the DSH home) or held in the OS keychain per
 * machine's `credentialBackend`.
 */
export declare class SshRegistry extends Service {
    static Config: z<RegistryConfig>;
    private readonly legacyStateFile;
    private readonly machinesFile;
    private readonly hostKeyStore;
    private readonly secretsDir;
    private readonly defaultHostKeyMode;
    private readonly configDefault;
    private readonly sshConfigPath;
    private readonly specs;
    private readonly live;
    private readonly probeCache;
    private readonly statusTtlMs;
    private configConnection;
    private currentId;
    private nextId;
    private writeTail;
    constructor(ctx: Context, config: RegistryConfig);
    /**
     * Host-language translate face of the validation/routing errors this class
     * throws (t15-r2, captain decision F3): every user/model-triggerable
     * message reads the host language live at call time (settings preference ??
     * en; a settings-less composition reads the EN wording — identical to the
     * pre-i18n copy).
     */
    private get t();
    /** The path of the machines.json single source of truth. */
    get statePath(): string;
    /** All registered connections as secret-free legacy views, in insertion order. */
    list(): SshConnectionView[];
    /** All machines as secret-free rich views plus the current id. */
    listMachines(): {
        machines: MachineView[];
        currentId: string | null;
    };
    /** The live connection for one entry, created on first use. */
    get(id: string): SshConnection | undefined;
    /** Resolve a `ssh://<id>/<path>` cwd/path into its live connection and remote path. */
    route(value: string): SshRoute | undefined;
    /** Validate, resolve, persist, and register one legacy connection. */
    add(input: ConnectionInput): {
        id: string;
        view: SshConnectionView;
    };
    /**
     * Upsert one machine (dsh-remote `add`/`update` semantics): an existing
     * `input.id` updates that machine; otherwise a new `cN` id is allocated.
     * Handles the per-machine credential backend (OS keychain vs plaintext).
     * When no machine is current, the saved machine becomes current.
     */
    saveMachine(input: MachineInput): Promise<MachineView>;
    /** Remove one machine (and its live connection + keychain secret). */
    remove(id: string): boolean;
    /** Make a machine current. Returns whether the id exists. */
    setCurrent(id: string): boolean;
    /** The physical TOFU store (forget/status surfaces). */
    getHostKeyStore(): HostKeyStore;
    /** Drop the TOFU record for one endpoint. */
    forgetHostKey(host: string, port: number): boolean;
    /** Test one input without persisting: connect, run `true`, and dispose. */
    test(input: MachineInput): Promise<{
        ok: true;
    } | {
        ok: false;
        message: string;
    }>;
    /** Resolve a hostname (possibly a `~/.ssh/config` alias) into its effective config. */
    resolveSshConfig(host: string, depth?: number): ResolvedSshConfig;
    /**
     * List the exact `~/.ssh/config` Host aliases for the sidebar, re-reading the
     * file on every call so edits between two openings are picked up. Wildcard
     * and negated patterns stay hidden; each alias carries its resolved
     * username/port plus IdentityFile / ProxyJump presence.
     */
    listConfigHosts(): SshConfigHostView[];
    /**
     * The active machine: the current registry entry → the cordis.yml config
     * default. Temporary connections were retired with `sw_connect save:false`
     * (ADR-0021 §1/§5): the machine universe is the user registry, so there is no
     * third, non-persisted source of an active machine any more.
     */
    activeSpec(): SshConnectionSpec | null;
    /** The live connection of the active machine (lazily created). */
    getActive(): {
        spec: SshConnectionSpec;
        connection: SshConnection;
    } | null;
    /**
     * Upsert the tool-connect machine dsh-remote style: match by
     * host+username+port; update the existing record or create a new one, make
     * it current, and persist.
     *
     * NOTE (REQ-I11): the `sw_connect` tool no longer calls this — the model
     * cannot add machines to the user registry (ADR-0021 §2.1). It stays as public
     * registry API for callers that legitimately create a machine record (the
     * settings page / add-workspace flow go through `machines.add`, which this
     * mirrors).
     */
    connectUpsert(input: MachineInput): Promise<{
        id: string;
        view: MachineView;
    }>;
    /** Persist the active machine's workspace + recentWorkspaces (max 8). */
    setActiveWorkspace(path: string): void;
    /**
     * Persist ONE REGISTERED machine's workspace + recentWorkspaces (max 8) —
     * the flow's write-back (R4): picking a remote directory in the UI records
     * the selection on the machine the session routes to. Unlike
     * {@link setActiveWorkspace}, the target is named explicitly: a flow may
     * pick a directory for a connection that is NOT the current machine, and
     * writing it onto the active machine would corrupt the wrong record.
     * @param machineId - the registry entry the session routes to.
     * @param path - the picked absolute POSIX remote directory.
     * @returns whether the machine is registered (and was updated).
     */
    setMachineWorkspace(machineId: string, path: string): boolean;
    /** Pure status snapshot (no network; ping is the tools' job). */
    status(): WorkspaceStatus;
    /** The effective password for a machine: plaintext or the OS keychain, best-effort. */
    resolvePassword(spec: SshConnectionSpec): Promise<string | undefined>;
    /**
     * Allocate the next `cN` id atomically from the CURRENT machine table, never
     * from the load-time nextId cache: the highest numeric id in the table (which
     * may include caller-supplied ids or ids added by this run) plus one is
     * computed and immediately consumed, so two saves cannot agree on one id.
     */
    private allocateId;
    /** The highest `cN` numeric suffix present in the current machine table. */
    private maxNumericId;
    /** Re-read `~/.ssh/config`; an absent or unreadable file reads as empty. */
    private readConfigEntries;
    /** Resolve against one fixed snapshot of the config (jump hops share it). */
    private resolveAgainst;
    /** The cordis.yml default machine (active fallback while the table is empty). */
    private configDefaultMachine;
    /** Look up the cached live connection for one spec (never creates one). */
    private lookupConnection;
    /** Build one connection with the registry's TOFU store and default mode. */
    private buildConnection;
    /**
     * Build one registry-owned connection for a spec (test seam: subclasses may
     * substitute a fake so status/probe/reconnect logic is testable without a
     * real SSH server; production behavior is unchanged).
     */
    protected fabricateConnection(spec: SshConnectionSpec): SshConnection;
    /**
     * Pure status snapshot of one entry — never touches the network. Served
     * straight from the probe cache while fresh (TTL
     * {@link RegistryConfig.statusTtlMs}); beyond it the state derives from the
     * live chain alone, so a cached "offline" never lingers after an expiry.
     * @returns the snapshot, or undefined for an unknown id.
     */
    statusOf(id: string): ConnectionStatusView | undefined;
    /**
     * Actively verify one entry: `echo ok` over its live chain with a bounded
     * budget. Creates the chain when absent. A failure is a status outcome
     * (`offline` + message), never a thrown error. The outcome is cached for
     * {@link RegistryConfig.statusTtlMs}.
     * @param id - registry entry id.
     * @param signal - caller lifetime (the probe budget still applies).
     */
    probe(id: string, signal?: AbortSignal): Promise<ConnectionStatusView>;
    /**
     * Reset and re-verify one entry: dispose the cached live chain — the
     * failed-connection-cache root fix: a chain whose `ready` attempt failed is
     * permanently poisoned, so healing requires a fresh chain (see
     * {@link module:dsh-workspace-enhancement/ssh-core} SshSession.getClient) —
     * rebuild it, and probe it. Returns the resulting status; a failed connect
     * is `offline` + message, never a throw.
     */
    reconnect(id: string, signal?: AbortSignal): Promise<ConnectionStatusView>;
    private requireSpec;
    /** Project one spec + optional live chain into a tri-state status view. */
    private statusViewOf;
    /** Probe one connection and publish its outcome into the status cache. */
    private probeLive;
    /** Project one spec into its secret-free legacy wire view. */
    private legacyViewOf;
    /** Project one spec into the secret-free machine view (machines.* endpoints). */
    private machineViewOf;
    private jumpHostsOf;
    /** Persist the registry (serialized behind the previous write). */
    private persist;
    /** Legacy `connections.add`/`connections.test` field mapping onto a spec. */
    private applyInputFieldsInto;
}
export default SshRegistry;
