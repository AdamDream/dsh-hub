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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SshConnection } from "./connection.js";
import { HostKeyStore, dshHome, defaultKnownHostsFile, defaultSecretsDir, remoteWorkspacesRoot } from "./hostkey.js";
import { deleteSecret, getSecret, platformBackend, saveSecret } from "./credential.js";
import { hostLocaleOf } from "./locale/host.js";
/**
 * Pure tri-state derivation (exported for tests): a failed probe outranks a
 * live chain, a live unready chain is offline, and no chain at all is unknown.
 */
export function deriveConnectionState(hasLive, liveConnected, probeFailed) {
    if (probeFailed)
        return 'offline';
    if (hasLive)
        return liveConnected ? 'active' : 'offline';
    return 'unknown';
}
/** Probe budget: one round-trip `echo ok` with a hard timeout. */
export const PROBE_TIMEOUT_MS = 8_000;
/** Default TTL of a probe result served by `statusOf` without a new network call. */
export const DEFAULT_STATUS_TTL_MS = 5_000;
/** Parse `ssh://<connId>/<abs>` (the workspace/cwd spelling of a remote path). */
export function parseSshRoute(value) {
    if (!value.startsWith('ssh://'))
        return null;
    const rest = value.slice('ssh://'.length);
    const separator = rest.indexOf('/');
    if (separator <= 0)
        return null;
    const id = rest.slice(0, separator);
    const path = rest.slice(separator);
    if (!/^[A-Za-z0-9._-]+$/.test(id) || !posix.isAbsolute(path))
        return null;
    return { id, path };
}
/** Expand `~`/`~/` (or `%d`-free spellings) in an ssh-config file path. */
function expandHome(path) {
    if (path === '~' || path.startsWith('~/'))
        return join(homedir(), path.slice(1));
    return path;
}
/** Read and parse `~/.ssh/config` into pattern → block entries. */
function readSshConfig(path) {
    const entries = [];
    if (!existsSync(path))
        return entries;
    let current;
    const push = () => {
        if (current === undefined)
            return;
        current.patterns = current.patterns.filter(pattern => pattern.trim() !== '');
        if (current.patterns.length > 0)
            entries.push(current);
        current = undefined;
    };
    try {
        for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (line.length === 0 || line.startsWith('#'))
                continue;
            const [keyword, ...rest] = line.split(/\s+/);
            const value = rest.join(' ').trim();
            if (keyword === undefined || value === '')
                continue;
            const key = keyword.toLowerCase();
            if (key === 'host') {
                push();
                current = { patterns: value.split(/\s+/), block: { identityFiles: [], proxyJump: [] } };
                continue;
            }
            if (current === undefined)
                continue;
            if (key === 'hostname')
                current.block.hostName = value;
            else if (key === 'user')
                current.block.user = value;
            else if (key === 'port') {
                const port = Number(value);
                if (Number.isInteger(port) && port > 0 && port <= 65535)
                    current.block.port = port;
            }
            else if (key === 'identityfile')
                current.block.identityFiles.push(expandHome(value));
            else if (key === 'proxyjump')
                current.block.proxyJump = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '' && entry.toLowerCase() !== 'none');
        }
        push();
    }
    catch {
        // An unreadable ssh config is the same as an absent one for discovery.
    }
    return entries;
}
/** Match one hostname against an OpenSSH Host pattern (exact or trailing `*`). */
function patternMatches(pattern, host) {
    if (pattern === '*')
        return true;
    if (pattern.endsWith('*'))
        return host.startsWith(pattern.slice(0, -1));
    return pattern.toLowerCase() === host.toLowerCase();
}
/** An exact Host alias (no `*` / `?` wildcard, no `!` negation) listable in the UI. */
function isExactAlias(pattern) {
    return pattern !== '' && !/[*?!]/.test(pattern);
}
/** Parse one `[user@]host[:port]` ProxyJump entry. */
function parseJumpEntry(entry) {
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
        const portValue = Number(rest.slice(colon + 1));
        if (Number.isInteger(portValue) && portValue > 0 && portValue <= 65535) {
            port = portValue;
            rest = rest.slice(0, colon);
        }
    }
    return {
        host: rest,
        ...(username !== undefined ? { username } : {}),
        ...(port !== undefined ? { port } : {}),
    };
}
/** Normalize one persisted jump hop (both `privateKey`/`privateKeyPath` spellings). */
function normalizeJump(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const record = raw;
    if (typeof record.host !== 'string' || record.host === '')
        return null;
    const jump = { host: record.host };
    if (typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0)
        jump.port = record.port;
    for (const key of ['username', 'password', 'passphrase', 'agent']) {
        if (typeof record[key] === 'string' && record[key] !== '')
            jump[key] = record[key];
    }
    if (typeof record.privateKey === 'string' && record.privateKey !== '')
        jump.privateKey = record.privateKey;
    else if (typeof record.privateKeyPath === 'string' && record.privateKeyPath !== '')
        jump.privateKey = record.privateKeyPath;
    return jump;
}
/**
 * Normalize one persisted machine record. Accepts both the dsh-ssh spec shape
 * and the dsh-remote machines.json record shape (`name`/`workspace`/`proxy`/
 * `useAgent` aliases) so an existing dsh-remote machines.json at the same path
 * keeps working.
 */
export function normalizeMachine(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const record = raw;
    if (typeof record.id !== 'string' || record.id === '')
        return null;
    if (typeof record.host !== 'string' || record.host === '')
        return null;
    if (typeof record.username !== 'string')
        return null;
    const port = typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535
        ? record.port
        : 22;
    const nameValue = typeof record.name === 'string' ? record.name : '';
    const label = typeof record.label === 'string' && record.label.trim() !== ''
        ? record.label
        : (nameValue.trim() !== '' ? nameValue : record.host);
    const machine = { id: record.id, label, host: record.host, port, username: record.username };
    for (const key of ['password', 'privateKeyPath', 'passphrase', 'agent', 'cwd', 'workspace', 'name']) {
        const value = record[key];
        if (typeof value === 'string' && value !== '') {
            if (key === 'name')
                machine.name = value;
            else
                machine[key] = value;
        }
    }
    if (typeof record.hostKeyMode === 'string' && (record.hostKeyMode === 'accept-new' || record.hostKeyMode === 'verify' || record.hostKeyMode === 'off')) {
        machine.hostKeyMode = record.hostKeyMode;
    }
    if (typeof record.strictHostKeyChecking === 'boolean')
        machine.strictHostKeyChecking = record.strictHostKeyChecking;
    if (Array.isArray(record.knownHosts))
        machine.knownHosts = record.knownHosts.filter((entry) => typeof entry === 'string');
    if (Array.isArray(record.recentWorkspaces)) {
        machine.recentWorkspaces = record.recentWorkspaces.filter((entry) => typeof entry === 'string').slice(0, 8);
    }
    if (typeof record.credentialBackend === 'string' && record.credentialBackend !== '') {
        machine.credentialBackend = record.credentialBackend;
    }
    if (record.encryptFallback === true)
        machine.encryptFallback = true;
    if (Array.isArray(record.jump)) {
        machine.jump = record.jump.map(normalizeJump).filter((hop) => hop !== null);
    }
    else if (typeof record.proxy === 'object' && record.proxy !== null) {
        // dsh-remote single-proxy spelling → one-hop jump chain.
        const proxy = record.proxy;
        if (typeof proxy.host === 'string' && proxy.host !== '') {
            machine.jump = [normalizeJump(proxy)].filter((hop) => hop !== null);
        }
    }
    for (const key of ['readyTimeout', 'keepaliveInterval', 'keepaliveCountMax']) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value))
            machine[key] = value;
    }
    if (machine.agent === undefined && record.useAgent === true) {
        const agent = process.platform === 'win32' ? 'pageant' : (process.env.SSH_AUTH_SOCK ?? '');
        if (agent !== '')
            machine.agent = agent;
    }
    return machine;
}
/** Persist the machines file (mkdir -p first). */
function saveMachinesFile(file, list, currentId) {
    try {
        mkdirSync(dirname(file), { recursive: true });
    }
    catch {
        // A read-only home must not crash the registry; the write below surfaces it.
    }
    writeFileSync(file, JSON.stringify({ list, currentId }, null, 2) + '\n', 'utf8');
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
export function loadMachinesState(machinesFile, legacyFile, warn) {
    // Current table: parsed successfully (even when empty) or not at all.
    let list = [];
    let currentId = null;
    let parsedExisting = false;
    let corrupt = false;
    if (existsSync(machinesFile)) {
        try {
            const parsed = JSON.parse(readFileSync(machinesFile, 'utf8'));
            if (Array.isArray(parsed.list)) {
                list = parsed.list
                    .map(normalizeMachine)
                    .filter((machine) => machine !== null);
                parsedExisting = true;
                currentId = typeof parsed.currentId === 'string' ? parsed.currentId : (list[0]?.id ?? null);
            }
        }
        catch (error) {
            corrupt = true;
            warn(`dsw: cannot read machine state ${machinesFile}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // Legacy import is eligible when the current table is absent or parsed empty,
    // never when it holds machines and never over a corrupt file.
    const eligible = !existsSync(machinesFile) || (parsedExisting && list.length === 0);
    if (eligible && !corrupt && existsSync(legacyFile)) {
        try {
            const parsed = JSON.parse(readFileSync(legacyFile, 'utf8'));
            if (Array.isArray(parsed.connections)) {
                const imported = parsed.connections
                    .map(normalizeMachine)
                    .filter((machine) => machine !== null);
                if (imported.length > 0) {
                    const importedCurrentId = imported[0]?.id ?? null;
                    try {
                        saveMachinesFile(machinesFile, imported, importedCurrentId);
                    }
                    catch (error) {
                        warn(`dsw: legacy import failed (${error instanceof Error ? error.message : String(error)}) — keeping the current registry`);
                        return { list, currentId, migrated: false };
                    }
                    // The import is durable; a failed rename only loses the backup name
                    // (the legacy file stays, but a non-empty machines.json guards the
                    // next boot from re-importing).
                    try {
                        renameSync(legacyFile, `${legacyFile}.bak`);
                    }
                    catch (error) {
                        warn(`dsw: legacy state was imported but ${legacyFile} could not be renamed to .bak: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    return { list: imported, currentId: importedCurrentId, migrated: true };
                }
            }
        }
        catch (error) {
            warn(`dsw: cannot read legacy connection state ${legacyFile}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { list, currentId, migrated: false };
}
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
export async function resolveTestPassword(input, prev, resolve) {
    if (typeof input.password === 'string' && input.password !== '')
        return input.password;
    if (prev !== undefined) {
        if ((prev.credentialBackend ?? 'plain') === 'plain') {
            return prev.password ?? '';
        }
        const stored = await resolve(prev).catch(() => undefined);
        return stored ?? prev.password ?? '';
    }
    return input.password ?? '';
}
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
export function mergeTestFields(input, prev) {
    const pick = (given, stored) => given !== undefined ? (given !== '' ? given : undefined) : stored;
    const privateKeyPath = pick(input.privateKeyPath, prev?.privateKeyPath);
    const passphrase = pick(input.passphrase, prev?.passphrase);
    const agent = pick(input.agent, prev?.agent);
    const jump = input.jump !== undefined
        ? (input.jump.length > 0 ? input.jump : undefined)
        : prev?.jump;
    return {
        ...(privateKeyPath !== undefined ? { privateKeyPath } : {}),
        ...(passphrase !== undefined ? { passphrase } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(jump !== undefined && jump.length > 0 ? { jump } : {}),
    };
}
/**
 * Machine registry service. Persisted state is `machines.json` (single source
 * of truth); live `SshConnection` instances are created lazily and share one
 * chain per entry. Secret fields are persisted verbatim for plaintext
 * machines (the file lives under the DSH home) or held in the OS keychain per
 * machine's `credentialBackend`.
 */
export class SshRegistry extends Service {
    static Config = z.object({
        stateFile: z.string(),
        machinesFile: z.string(),
        knownHostsFile: z.string(),
        secretsDir: z.string(),
        hostKeyMode: z.string(),
        statusTtlMs: z.number().min(0).default(DEFAULT_STATUS_TTL_MS),
        host: z.string(),
        port: z.number(),
        username: z.string(),
        password: z.string(),
        privateKeyPath: z.string(),
        passphrase: z.string(),
        agent: z.string(),
        cwd: z.string(),
        strictHostKeyChecking: z.boolean(),
        knownHosts: z.array(z.string()),
    });
    legacyStateFile;
    machinesFile;
    hostKeyStore;
    secretsDir;
    defaultHostKeyMode;
    configDefault;
    sshConfigPath = join(homedir(), '.ssh', 'config');
    specs = new Map();
    live = new Map();
    probeCache = new Map();
    statusTtlMs;
    temporary = null;
    configConnection = null;
    currentId = null;
    nextId = 1;
    writeTail = Promise.resolve();
    constructor(ctx, config) {
        super(ctx, 'sshRegistry');
        const dshBase = dshHome();
        this.machinesFile = config.machinesFile ?? join(remoteWorkspacesRoot(), 'machines.json');
        this.legacyStateFile = config.stateFile ?? join(dshBase, 'dsh-ssh-connections.json');
        this.hostKeyStore = new HostKeyStore(config.knownHostsFile ?? defaultKnownHostsFile());
        this.secretsDir = config.secretsDir ?? defaultSecretsDir();
        this.defaultHostKeyMode = config.hostKeyMode === 'verify' || config.hostKeyMode === 'off' ? config.hostKeyMode : 'accept-new';
        this.statusTtlMs = config.statusTtlMs ?? DEFAULT_STATUS_TTL_MS;
        this.configDefault = {
            host: config.host ?? '',
            port: config.port ?? 22,
            username: config.username ?? '',
            ...(config.password !== undefined && config.password !== '' ? { password: config.password } : {}),
            ...(config.privateKeyPath !== undefined && config.privateKeyPath !== '' ? { privateKeyPath: config.privateKeyPath } : {}),
            ...(config.passphrase !== undefined && config.passphrase !== '' ? { passphrase: config.passphrase } : {}),
            ...(config.agent !== undefined && config.agent !== '' ? { agent: config.agent } : {}),
            ...(config.cwd !== undefined && config.cwd !== '' ? { cwd: config.cwd } : {}),
            ...(config.strictHostKeyChecking !== undefined ? { strictHostKeyChecking: config.strictHostKeyChecking } : {}),
            ...(config.knownHosts !== undefined && config.knownHosts.length > 0 ? { knownHosts: config.knownHosts } : {}),
        };
        const state = loadMachinesState(this.machinesFile, this.legacyStateFile, message => this.ctx.logger.warn(message));
        if (state.migrated) {
            this.ctx.logger.info(`dsw: imported ${state.list.length} connection(s) from ${this.legacyStateFile} into ${this.machinesFile} (legacy file renamed to .bak)`);
        }
        let maxId = 0;
        for (const spec of state.list) {
            const numeric = /^c(\d+)$/.exec(spec.id);
            if (numeric !== null)
                maxId = Math.max(maxId, Number(numeric[1]));
            this.specs.set(spec.id, spec);
        }
        this.nextId = maxId + 1;
        this.currentId = state.currentId;
    }
    /**
     * Host-language translate face of the validation/routing errors this class
     * throws (t15-r2, captain decision F3): every user/model-triggerable
     * message reads the host language live at call time (settings preference ??
     * en; a settings-less composition reads the EN wording — identical to the
     * pre-i18n copy).
     */
    get t() {
        return hostLocaleOf(this.ctx).t;
    }
    /** The path of the machines.json single source of truth. */
    get statePath() {
        return this.machinesFile;
    }
    /** All registered connections as secret-free legacy views, in insertion order. */
    list() {
        return [...this.specs.values()].map(spec => this.legacyViewOf(spec));
    }
    /** All machines as secret-free rich views plus the current id. */
    listMachines() {
        return {
            machines: [...this.specs.values()].map(spec => this.machineViewOf(spec)),
            currentId: this.currentId,
        };
    }
    /** The live connection for one entry, created on first use. */
    get(id) {
        const spec = this.specs.get(id);
        if (spec === undefined)
            return undefined;
        let connection = this.live.get(id);
        if (connection === undefined) {
            connection = this.fabricateConnection(spec);
            this.live.set(id, connection);
        }
        return connection;
    }
    /** Resolve a `ssh://<id>/<path>` cwd/path into its live connection and remote path. */
    route(value) {
        const parsed = parseSshRoute(value);
        if (parsed === null)
            return undefined;
        const connection = this.get(parsed.id);
        if (connection === undefined)
            return undefined;
        return { connection, path: parsed.path };
    }
    /** Validate, resolve, persist, and register one legacy connection. */
    add(input) {
        const label = (input.label ?? '').trim() || `${input.username ?? ''}@${input.host}`.replace(/^@/, '');
        const host = input.host.trim();
        const username = (input.username ?? '').trim();
        if (host === '')
            throw new Error(`dsw: ${this.t('rpc.hostEmpty')}`);
        if (username === '')
            throw new Error(`dsw: ${this.t('rpc.usernameEmpty')}`);
        const port = input.port ?? 22;
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error(`dsw: ${this.t('rpc.portInvalid', { port })}`);
        }
        const cwd = (input.cwd ?? '').trim();
        if (cwd !== '' && !posix.isAbsolute(cwd)) {
            throw new Error(`dsw: ${this.t('rpc.cwdShape', { cwd })}`);
        }
        for (const [index, hop] of (input.jump ?? []).entries()) {
            if (hop.host.trim() === '') {
                throw new Error(`dsw: ${this.t('rpc.jumpHostEmpty', { index })}`);
            }
        }
        const id = this.allocateId();
        const spec = {
            id,
            label,
            host,
            port,
            username,
            ...(cwd === '' ? {} : { cwd }),
            ...(input.jump !== undefined
                ? { jump: input.jump.map(hop => ({
                        host: hop.host,
                        port: hop.port,
                        username: hop.username,
                        ...(hop.privateKeyPath !== undefined ? { privateKey: hop.privateKeyPath } : {}),
                        ...(hop.agent !== undefined ? { agent: hop.agent } : {}),
                    })) }
                : {}),
        };
        this.applyInputFieldsInto(spec, input);
        this.specs.set(id, spec);
        void this.persist();
        return { id, view: this.legacyViewOf(spec) };
    }
    /**
     * Upsert one machine (dsh-remote `add`/`update` semantics): an existing
     * `input.id` updates that machine; otherwise a new `cN` id is allocated.
     * Handles the per-machine credential backend (OS keychain vs plaintext).
     * When no machine is current, the saved machine becomes current.
     */
    async saveMachine(input) {
        const host = input.host.trim();
        const username = (input.username ?? '').trim() || 'root';
        if (host === '')
            throw new Error(`dsw: ${this.t('rpc.hostEmpty')}`);
        const port = input.port ?? 22;
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error(`dsw: ${this.t('rpc.portInvalid', { port })}`);
        }
        const prev = input.id !== undefined ? this.specs.get(input.id) : undefined;
        const label = (input.label ?? '').trim() || (input.name ?? '').trim() || prev?.label || `${username}@${host}`;
        const id = prev !== undefined ? prev.id : input.id ?? this.allocateId();
        // A caller-supplied id unknown to the table (created outside this registry
        // instance, or a `cN` id whose record was removed) must still be visible to
        // the allocator: leaving nextId behind it would let the next auto-allocation
        // reuse the id and silently overwrite the machine.
        if (prev === undefined && input.id !== undefined) {
            const numeric = /^c(\d+)$/.exec(input.id);
            if (numeric !== null)
                this.nextId = Math.max(this.nextId, Number(numeric[1]) + 1);
        }
        const machine = {
            // P2-④ upsert semantics: an update starts from the FULL previous record,
            // so a field the payload omits (undefined) keeps its stored value — the
            // secret-free edit form cannot echo `privateKeyPath`/`passphrase`/`agent`,
            // and omitting them must never drop the machine's key authentication.
            // `applyInputFieldsInto` overlays only the fields actually present.
            ...(prev !== undefined ? { ...prev } : {}),
            id,
            label,
            host,
            port,
            username,
        };
        this.applyInputFieldsInto(machine, input);
        // Credential backend resolution: explicit backend → encryptPassword →
        // previous backend → plaintext.
        let backend = input.credentialBackend ?? (input.encryptPassword === true ? platformBackend() : prev?.credentialBackend ?? 'plain');
        if (input.credentialBackend === 'plain')
            backend = 'plain';
        const newPassword = typeof input.password === 'string' && input.password !== '' ? input.password : undefined;
        // Honest fallback marker: encryption was requested AND a password was
        // actually given, but the OS backend failed → plaintext with a warning.
        const encryptRequested = input.encryptPassword === true
            || (input.credentialBackend !== undefined && input.credentialBackend !== 'plain');
        // Nothing to encrypt (key/agent auth without a password) must not create a
        // phantom keychain backend nor a warning (B4 honesty, UI-visible).
        if (input.credentialBackend === undefined && input.encryptPassword === true
            && newPassword === undefined && (prev?.credentialBackend ?? 'plain') === 'plain') {
            backend = 'plain';
        }
        if (backend !== 'plain') {
            if (newPassword !== undefined) {
                const saved = await saveSecret(id, newPassword, this.secretsDir);
                if (!saved.ok)
                    backend = 'plain'; // best-effort: fall back to plaintext
            }
            machine.credentialBackend = backend;
            // Omit the empty password field entirely (dsh-remote semantics: '' is
            // "unset"). A keychain machine never carries a plaintext password.
            const fallbackPassword = backend === 'plain' ? (newPassword ?? prev?.password ?? '') : '';
            if (fallbackPassword !== '')
                machine.password = fallbackPassword;
            else
                delete machine.password;
        }
        else {
            machine.credentialBackend = 'plain';
            const fallbackPassword = newPassword ?? prev?.password ?? '';
            if (fallbackPassword !== '')
                machine.password = fallbackPassword;
            else
                delete machine.password;
        }
        if (encryptRequested && newPassword !== undefined && backend === 'plain')
            machine.encryptFallback = true;
        else
            delete machine.encryptFallback;
        // Keychain → plaintext switch: the machine now carries its password in
        // machines.json, so the OS-store secret for this id is stale and must not
        // linger — remove() only cleans secrets of still-keychain machines.
        if (backend === 'plain' && (prev?.credentialBackend ?? 'plain') !== 'plain') {
            void deleteSecret(id, this.secretsDir).catch(() => undefined);
        }
        this.specs.set(id, machine);
        if (this.currentId === null)
            this.currentId = id;
        void this.persist();
        return this.machineViewOf(machine);
    }
    /** Remove one machine (and its live connection + keychain secret). */
    remove(id) {
        const spec = this.specs.get(id);
        if (spec === undefined)
            return false;
        this.specs.delete(id);
        const connection = this.live.get(id);
        if (connection !== undefined) {
            this.live.delete(id);
            connection.dispose();
        }
        this.probeCache.delete(id);
        if ((spec.credentialBackend ?? 'plain') !== 'plain') {
            void deleteSecret(id, this.secretsDir).catch(() => undefined);
        }
        if (this.currentId === id) {
            const first = [...this.specs.values()][0];
            this.currentId = first?.id ?? null;
        }
        if (this.temporary?.spec.id === id)
            this.temporary = null;
        void this.persist();
        return true;
    }
    /** Make a machine current. Returns whether the id exists. */
    setCurrent(id) {
        if (!this.specs.has(id))
            return false;
        this.currentId = id;
        this.temporary = null;
        void this.persist();
        return true;
    }
    /** The physical TOFU store (forget/status surfaces). */
    getHostKeyStore() {
        return this.hostKeyStore;
    }
    /** Drop the TOFU record for one endpoint. */
    forgetHostKey(host, port) {
        return this.hostKeyStore.forget(host, port);
    }
    /** Test one input without persisting: connect, run `true`, and dispose. */
    async test(input) {
        const prev = input.id !== undefined && input.id !== '' ? this.specs.get(input.id) : undefined;
        // A keychain machine persists no plaintext password; resolve the OS-store
        // secret so testing it does not misreport a failure on an empty password.
        const password = await resolveTestPassword(input, prev, spec => this.resolvePassword(spec));
        // P2-④: key/passphrase/agent/jump merge with the updated machine's stored
        // values so a secret-free edit test authenticates like the save would.
        const merged = mergeTestFields(input, prev);
        const spec = {
            id: 'test',
            label: 'test',
            host: input.host,
            port: input.port ?? 22,
            username: input.username ?? '',
            password,
            cwd: '/tmp',
            // Empty-string identity fields mean "not configured" (same semantics as
            // `password: ''`): they must NOT land in the spec — the connection
            // constructor treats any present privateKeyPath/passphrase/agent as a
            // real value, and a '' path throws ENOENT before any auth attempt,
            // failing every password/keychain machine test.
            ...(merged.privateKeyPath !== undefined ? { privateKeyPath: merged.privateKeyPath } : {}),
            ...(merged.passphrase !== undefined ? { passphrase: merged.passphrase } : {}),
            ...(merged.agent !== undefined ? { agent: merged.agent } : {}),
            ...(merged.jump !== undefined
                ? {
                    jump: merged.jump.map(hop => {
                        // Persisted hops carry `privateKey`; payload hops `privateKeyPath`.
                        const keyViaPath = 'privateKeyPath' in hop ? hop.privateKeyPath : undefined;
                        const keyVia = 'privateKey' in hop ? hop.privateKey : undefined;
                        return {
                            ...(hop.host !== undefined ? { host: hop.host } : {}),
                            ...(hop.port !== undefined ? { port: hop.port } : {}),
                            ...(hop.username !== undefined ? { username: hop.username } : {}),
                            ...(keyViaPath !== undefined && keyViaPath !== '' ? { privateKey: keyViaPath } : {}),
                            ...(keyVia !== undefined && keyVia !== '' ? { privateKey: keyVia } : {}),
                            ...('agent' in hop && hop.agent !== undefined && hop.agent !== '' ? { agent: hop.agent } : {}),
                        };
                    }),
                }
                : {}),
        };
        if (input.strictHostKeyChecking !== undefined)
            spec.strictHostKeyChecking = input.strictHostKeyChecking;
        if (input.knownHosts !== undefined && input.knownHosts.length > 0)
            spec.knownHosts = input.knownHosts;
        if (input.hostKeyMode !== undefined)
            spec.hostKeyMode = input.hostKeyMode;
        const connection = new SshConnection(spec, { hostKeyStore: this.hostKeyStore, defaultHostKeyMode: this.defaultHostKeyMode });
        try {
            await connection.getClient();
            const outcome = await connection.exec('true');
            if (outcome.exitCode !== 0)
                throw new Error(outcome.stderr.trim() || `remote command failed with exit code ${String(outcome.exitCode)}`);
            return { ok: true };
        }
        catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
        finally {
            connection.dispose();
        }
    }
    /** Resolve a hostname (possibly a `~/.ssh/config` alias) into its effective config. */
    resolveSshConfig(host, depth = 0) {
        return this.resolveAgainst(this.readConfigEntries(), host, depth);
    }
    /**
     * List the exact `~/.ssh/config` Host aliases for the sidebar, re-reading the
     * file on every call so edits between two openings are picked up. Wildcard
     * and negated patterns stay hidden; each alias carries its resolved
     * username/port plus IdentityFile / ProxyJump presence.
     */
    listConfigHosts() {
        const entries = this.readConfigEntries();
        const seen = new Set();
        const hosts = [];
        for (const entry of entries) {
            for (const pattern of entry.patterns) {
                if (!isExactAlias(pattern))
                    continue;
                const key = pattern.toLowerCase();
                if (seen.has(key))
                    continue;
                seen.add(key);
                const resolved = this.resolveAgainst(entries, pattern, 0);
                hosts.push({
                    alias: pattern,
                    host: resolved.host,
                    username: resolved.username,
                    port: resolved.port,
                    identityFile: resolved.privateKeyPaths.length > 0,
                    jump: resolved.jump.length > 0,
                });
            }
        }
        return hosts;
    }
    /** The active machine: ephemeral tool connection → current → config default. */
    activeSpec() {
        if (this.temporary !== null)
            return this.temporary.spec;
        if (this.currentId !== null) {
            const spec = this.specs.get(this.currentId);
            if (spec !== undefined)
                return spec;
        }
        return this.configDefaultMachine();
    }
    /** The live connection of the active machine (lazily created). */
    getActive() {
        const spec = this.activeSpec();
        if (spec === null)
            return null;
        if (this.temporary !== null && this.temporary.spec.id === spec.id)
            return this.temporary;
        const registered = this.specs.get(spec.id);
        if (registered !== undefined) {
            const connection = this.get(spec.id);
            if (connection !== undefined)
                return { spec, connection };
        }
        this.configConnection ??= this.buildConnection(spec);
        return { spec, connection: this.configConnection };
    }
    /**
     * Connect a temporary machine (sw_connect `save: false`): it becomes the
     * active machine until {@link setCurrent} or a later saved connect.
     */
    connectTemporary(input) {
        const host = input.host.trim();
        const username = (input.username ?? '').trim() || 'root';
        if (host === '')
            throw new Error(this.t('tool.sw_connect.error.hostRequired'));
        const port = input.port ?? 22;
        const id = `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const spec = {
            id,
            label: (input.label ?? input.name ?? '').trim() || `${username}@${host}`,
            host,
            port,
            username,
            ...(input.cwd !== undefined && input.cwd !== '' ? { cwd: input.cwd } : {}),
            ...(input.workspace !== undefined && input.workspace !== '' ? { workspace: input.workspace } : {}),
            ...(input.privateKeyPath !== undefined && input.privateKeyPath !== '' ? { privateKeyPath: input.privateKeyPath } : {}),
            ...(input.passphrase !== undefined && input.passphrase !== '' ? { passphrase: input.passphrase } : {}),
            ...(input.agent !== undefined && input.agent !== '' ? { agent: input.agent } : {}),
            ...(input.password !== undefined && input.password !== '' ? { password: input.password } : {}),
            ...(input.hostKeyMode !== undefined ? { hostKeyMode: input.hostKeyMode } : {}),
        };
        const connection = this.buildConnection(spec);
        this.temporary = { spec, connection };
        return { id, connection };
    }
    /**
     * Upsert the tool-connect machine dsh-remote style: match by
     * host+username+port; update the existing record or create a new one, make
     * it current, and persist.
     */
    async connectUpsert(input) {
        const host = input.host.trim();
        const username = (input.username ?? '').trim() || 'root';
        const port = input.port ?? 22;
        const match = [...this.specs.values()].find(spec => spec.host === host && spec.username === username && spec.port === port);
        const view = await this.saveMachine({
            ...input,
            ...(match !== undefined ? { id: match.id } : {}),
            host,
            username,
            port,
        });
        const id = match?.id ?? view.id;
        this.currentId = id;
        this.temporary = null;
        void this.persist();
        return { id, view };
    }
    /** Persist the active machine's workspace + recentWorkspaces (max 8). */
    setActiveWorkspace(path) {
        const active = this.activeSpec();
        if (active === null)
            return;
        active.workspace = path;
        active.recentWorkspaces = [path, ...(active.recentWorkspaces ?? []).filter(entry => entry !== path)].slice(0, 8);
        if (this.temporary !== null && this.temporary.spec.id === active.id)
            return;
        if (this.specs.has(active.id))
            void this.persist();
    }
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
    setMachineWorkspace(machineId, path) {
        const spec = this.specs.get(machineId);
        if (spec === undefined)
            return false;
        spec.workspace = path;
        spec.recentWorkspaces = [path, ...(spec.recentWorkspaces ?? []).filter(entry => entry !== path)].slice(0, 8);
        void this.persist();
        return true;
    }
    /** Pure status snapshot (no network; ping is the tools' job). */
    status() {
        const active = this.activeSpec();
        const source = this.temporary !== null ? 'ephemeral' : this.currentId !== null && active !== null && this.specs.has(active.id) ? 'machine' : (active !== null ? 'config' : 'none');
        const mode = active?.hostKeyMode ?? this.defaultHostKeyMode;
        const entry = active !== null ? this.hostKeyStore.get(active.host, active.port) : undefined;
        const connection = active !== null ? this.lookupConnection(active) : undefined;
        return {
            host: active?.host ?? '',
            port: active?.port ?? 22,
            username: active?.username ?? '',
            connected: connection?.isConnected() ?? false,
            workspace: active?.workspace ?? active?.cwd ?? '',
            currentId: this.currentId,
            activeSource: source,
            hostKeyMode: mode,
            hostKeyKnown: entry !== undefined,
            hostKeyEntry: entry ?? null,
            machines: [...this.specs.values()].map(spec => this.machineViewOf(spec)),
            backend: platformBackend(),
        };
    }
    /** The effective password for a machine: plaintext or the OS keychain, best-effort. */
    async resolvePassword(spec) {
        if ((spec.credentialBackend ?? 'plain') === 'plain')
            return spec.password;
        if (spec.password !== undefined && spec.password !== '')
            return spec.password;
        const stored = await getSecret(spec.id, this.secretsDir).catch(() => null);
        return stored ?? spec.password;
    }
    /**
     * Allocate the next `cN` id atomically from the CURRENT machine table, never
     * from the load-time nextId cache: the highest numeric id in the table (which
     * may include caller-supplied ids or ids added by this run) plus one is
     * computed and immediately consumed, so two saves cannot agree on one id.
     */
    allocateId() {
        const maxNumeric = this.maxNumericId();
        if (this.nextId <= maxNumeric)
            this.nextId = maxNumeric + 1;
        const id = `c${this.nextId}`;
        this.nextId += 1;
        return id;
    }
    /** The highest `cN` numeric suffix present in the current machine table. */
    maxNumericId() {
        let max = 0;
        for (const id of this.specs.keys()) {
            const numeric = /^c(\d+)$/.exec(id);
            if (numeric !== null)
                max = Math.max(max, Number(numeric[1]));
        }
        return max;
    }
    /** Re-read `~/.ssh/config`; an absent or unreadable file reads as empty. */
    readConfigEntries() {
        return readSshConfig(this.sshConfigPath);
    }
    /** Resolve against one fixed snapshot of the config (jump hops share it). */
    resolveAgainst(entries, host, depth) {
        const block = entries.find(entry => entry.patterns.some(pattern => patternMatches(pattern, host)))?.block;
        const resolved = {
            host: block?.hostName ?? host,
            username: block?.user ?? '',
            port: block?.port ?? 22,
            privateKeyPaths: block?.identityFiles ?? [],
            jump: [],
        };
        if (depth < 8) {
            for (const entry of block?.proxyJump ?? []) {
                const hop = parseJumpEntry(entry);
                const hopConfig = this.resolveAgainst(entries, hop.host, depth + 1);
                resolved.jump.push({
                    host: hopConfig.host,
                    port: hop.port ?? hopConfig.port,
                    username: hop.username ?? (hopConfig.username !== '' ? hopConfig.username : resolved.username),
                    ...(hopConfig.privateKeyPaths[0] !== undefined ? { privateKeyPath: hopConfig.privateKeyPaths[0] } : {}),
                });
            }
        }
        return resolved;
    }
    /** The cordis.yml default machine (active fallback while the table is empty). */
    configDefaultMachine() {
        if (this.configDefault.host === '')
            return null;
        return {
            id: '',
            label: this.configDefault.host,
            host: this.configDefault.host,
            port: this.configDefault.port,
            username: this.configDefault.username,
            ...(this.configDefault.password !== undefined ? { password: this.configDefault.password } : {}),
            ...(this.configDefault.privateKeyPath !== undefined ? { privateKeyPath: this.configDefault.privateKeyPath } : {}),
            ...(this.configDefault.passphrase !== undefined ? { passphrase: this.configDefault.passphrase } : {}),
            ...(this.configDefault.agent !== undefined ? { agent: this.configDefault.agent } : {}),
            ...(this.configDefault.cwd !== undefined ? { cwd: this.configDefault.cwd } : {}),
            ...(this.configDefault.strictHostKeyChecking !== undefined ? { strictHostKeyChecking: this.configDefault.strictHostKeyChecking } : {}),
            ...(this.configDefault.knownHosts !== undefined ? { knownHosts: this.configDefault.knownHosts } : {}),
        };
    }
    /** Look up the cached live connection for one spec (never creates one). */
    lookupConnection(spec) {
        if (this.temporary !== null && this.temporary.spec.id === spec.id)
            return this.temporary.connection;
        if (spec.id === '')
            return this.configConnection ?? undefined;
        return this.live.get(spec.id);
    }
    /** Build one connection with the registry's TOFU store and default mode. */
    buildConnection(spec) {
        const passwordProvider = (spec.credentialBackend ?? 'plain') === 'plain'
            ? undefined
            : (machineId) => this.resolvePassword({ ...spec, id: machineId });
        return new SshConnection(spec, {
            hostKeyStore: this.hostKeyStore,
            defaultHostKeyMode: this.defaultHostKeyMode,
            ...(passwordProvider !== undefined ? { passwordProvider } : {}),
        });
    }
    /**
     * Build one registry-owned connection for a spec (test seam: subclasses may
     * substitute a fake so status/probe/reconnect logic is testable without a
     * real SSH server; production behavior is unchanged).
     */
    fabricateConnection(spec) {
        return this.buildConnection(spec);
    }
    /**
     * Pure status snapshot of one entry — never touches the network. Served
     * straight from the probe cache while fresh (TTL
     * {@link RegistryConfig.statusTtlMs}); beyond it the state derives from the
     * live chain alone, so a cached "offline" never lingers after an expiry.
     * @returns the snapshot, or undefined for an unknown id.
     */
    statusOf(id) {
        const spec = this.specs.get(id);
        if (spec === undefined)
            return undefined;
        const cached = this.probeCache.get(id);
        const now = Date.now();
        if (cached !== undefined && cached.specRef === spec && now - cached.at < this.statusTtlMs) {
            return cached.view;
        }
        return this.statusViewOf(spec, this.live.get(id) ?? null, undefined, false);
    }
    /**
     * Actively verify one entry: `echo ok` over its live chain with a bounded
     * budget. Creates the chain when absent. A failure is a status outcome
     * (`offline` + message), never a thrown error. The outcome is cached for
     * {@link RegistryConfig.statusTtlMs}.
     * @param id - registry entry id.
     * @param signal - caller lifetime (the probe budget still applies).
     */
    async probe(id, signal) {
        const spec = this.requireSpec(id);
        const connection = this.get(id);
        if (connection === undefined)
            throw new Error(`dsw: ${this.t('rpc.unknownConnectionId', { id: JSON.stringify(id) })}`); // unreachable after requireSpec
        return this.probeLive(id, spec, connection, signal);
    }
    /**
     * Reset and re-verify one entry: dispose the cached live chain — the
     * failed-connection-cache root fix: a chain whose `ready` attempt failed is
     * permanently poisoned, so healing requires a fresh chain (see
     * {@link module:dsh-workspace-enhancement/ssh-core} SshSession.getClient) —
     * rebuild it, and probe it. Returns the resulting status; a failed connect
     * is `offline` + message, never a throw.
     */
    async reconnect(id, signal) {
        const spec = this.requireSpec(id);
        const stale = this.live.get(id);
        if (stale !== undefined) {
            this.live.delete(id);
            stale.dispose();
        }
        this.probeCache.delete(id);
        const connection = this.get(id);
        if (connection === undefined)
            throw new Error(`dsw: ${this.t('rpc.unknownConnectionId', { id: JSON.stringify(id) })}`); // unreachable after requireSpec
        return this.probeLive(id, spec, connection, signal);
    }
    requireSpec(id) {
        const spec = this.specs.get(id);
        if (spec === undefined)
            throw new Error(`dsw: ${this.t('rpc.unknownConnectionId', { id: JSON.stringify(id) })}`);
        return spec;
    }
    /** Project one spec + optional live chain into a tri-state status view. */
    statusViewOf(spec, live, message, probeFailed) {
        const connected = live?.isConnected() ?? false;
        const view = {
            id: spec.id,
            state: deriveConnectionState(live !== null, connected, probeFailed),
            connected,
            label: spec.label,
            host: spec.host,
            port: spec.port,
            username: spec.username,
            hostKeyKnown: this.hostKeyStore.get(spec.host, spec.port) !== undefined,
            ...(spec.lastProbeAt !== undefined ? { lastProbeAt: spec.lastProbeAt } : {}),
            ...(spec.lastProbeLatencyMs !== undefined && spec.lastProbeLatencyMs !== null
                ? { lastProbeLatencyMs: spec.lastProbeLatencyMs } : {}),
            ...(message !== undefined ? { message } : {}),
        };
        return view;
    }
    /** Probe one connection and publish its outcome into the status cache. */
    async probeLive(id, spec, connection, signal) {
        const started = Date.now();
        let view;
        try {
            const probeSignal = signal === undefined
                ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
                : AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
            const outcome = await connection.exec('echo ok', { signal: probeSignal });
            if (outcome.exitCode !== 0) {
                throw new Error((outcome.stderr || outcome.stdout || `exit ${String(outcome.exitCode)}`).trim());
            }
            spec.lastProbeAt = new Date().toISOString();
            spec.lastProbeLatencyMs = Date.now() - started;
            view = this.statusViewOf(spec, this.live.get(id) ?? null, undefined, false);
            void this.persist();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            view = this.statusViewOf(spec, this.live.get(id) ?? null, message, true);
        }
        this.probeCache.set(id, { at: Date.now(), view, specRef: spec });
        return view;
    }
    /** Project one spec into its secret-free legacy wire view. */
    legacyViewOf(spec) {
        const auth = spec.agent !== undefined
            ? 'agent'
            : spec.privateKeyPath !== undefined
                ? 'key'
                : (spec.password !== undefined && spec.password !== '') ? 'password' : 'key';
        return {
            id: spec.id,
            label: spec.label,
            host: spec.host,
            port: spec.port,
            username: spec.username,
            ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
            auth,
            jumpHosts: this.jumpHostsOf(spec),
        };
    }
    /** Project one spec into the secret-free machine view (machines.* endpoints). */
    machineViewOf(spec) {
        const backend = spec.credentialBackend ?? 'plain';
        // An explicit private-key path reports key auth; a machine "has" a
        // password only when one is actually stored (keychain alone is not one).
        const passwordSet = spec.password !== undefined && spec.password !== '';
        const auth = spec.agent !== undefined
            ? 'agent'
            : spec.privateKeyPath !== undefined
                ? 'key'
                : passwordSet ? 'password' : 'key';
        return {
            id: spec.id,
            label: spec.label,
            host: spec.host,
            port: spec.port,
            username: spec.username,
            ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
            ...(spec.workspace !== undefined ? { workspace: spec.workspace } : {}),
            auth,
            passwordSet,
            jumpHosts: this.jumpHostsOf(spec),
            ...(spec.hostKeyMode !== undefined ? { hostKeyMode: spec.hostKeyMode } : {}),
            credentialBackend: backend,
            ...(spec.encryptFallback === true ? { encryptFallback: true } : {}),
            ...(spec.recentWorkspaces !== undefined && spec.recentWorkspaces.length > 0 ? { recentWorkspaces: spec.recentWorkspaces } : {}),
        };
    }
    jumpHostsOf(spec) {
        return (spec.jump ?? []).map(hop => `${hop.username ?? spec.username}@${hop.host}:${hop.port ?? 22}`);
    }
    /** Persist the registry (serialized behind the previous write). */
    persist() {
        const snapshot = [...this.specs.values()].map(spec => ({ ...spec }));
        const currentId = this.currentId;
        const write = async () => {
            try {
                saveMachinesFile(this.machinesFile, snapshot, currentId);
            }
            catch (error) {
                this.ctx.logger.warn(`dsw: cannot persist machine state to ${this.machinesFile}: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        this.writeTail = this.writeTail.then(write, write);
        return this.writeTail;
    }
    /** Legacy `connections.add`/`connections.test` field mapping onto a spec. */
    applyInputFieldsInto(spec, input) {
        // P2-④ wire contract: an OMITTED field keeps the stored value (a
        // saveMachine update starts from a full prev copy); an EXPLICIT empty
        // string CLEARS it — the client sends all fields on a new machine ('' =
        // 未配置) and only changed fields on an edit, so the two states are
        // distinguishable. `password` keeps the dsh-remote '' = "unset/keep"
        // semantics: the form's「编辑留空=保持不变」contract depends on it and a
        // new machine has no prev value to clear anyway.
        //
        // `jump` follows the same two-state rule with arrays: an OMITTED chain
        // keeps the stored one (prev copy); an EXPLICIT array — even an empty one
        // — replaces it, so `[]` is the "clear the chain" signal an edit needs
        // (machine-form's jumpChainOf; a new machine sends `jump: []` only when
        // the caller means "no chain", which at the connection layer is EXACTLY
        // the same as absent: connection.ts builds `[...hops, parent]`, views
        // report `jumpHosts: []`, so `[]` is never misread as "has a jump").
        // `mergeTestFields` mirrors the rule for machines.test.
        if (input.password !== undefined && input.password !== '')
            spec.password = input.password;
        if (input.privateKeyPath !== undefined) {
            if (input.privateKeyPath !== '')
                spec.privateKeyPath = input.privateKeyPath;
            else
                delete spec.privateKeyPath;
        }
        if (input.passphrase !== undefined) {
            if (input.passphrase !== '')
                spec.passphrase = input.passphrase;
            else
                delete spec.passphrase;
        }
        if (input.agent !== undefined) {
            if (input.agent !== '')
                spec.agent = input.agent;
            else
                delete spec.agent;
        }
        if (input.cwd !== undefined && input.cwd !== '')
            spec.cwd = input.cwd;
        if (input.workspace !== undefined && input.workspace !== '')
            spec.workspace = input.workspace;
        if (input.jump !== undefined) {
            spec.jump = input.jump.map(hop => ({
                host: hop.host,
                port: hop.port,
                username: hop.username,
                ...(hop.privateKeyPath !== undefined ? { privateKey: hop.privateKeyPath } : {}),
                ...(hop.agent !== undefined ? { agent: hop.agent } : {}),
            }));
        }
        if (input.hostKeyMode !== undefined)
            spec.hostKeyMode = input.hostKeyMode;
        if (input.strictHostKeyChecking !== undefined)
            spec.strictHostKeyChecking = input.strictHostKeyChecking;
        if (input.knownHosts !== undefined && input.knownHosts.length > 0)
            spec.knownHosts = input.knownHosts;
    }
}
export default SshRegistry;
//# sourceMappingURL=registry.js.map