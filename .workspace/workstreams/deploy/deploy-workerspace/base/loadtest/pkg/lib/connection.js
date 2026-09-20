/**
 * One standalone SSH connection owned by the connection registry (not the
 * `ctx.ssh` service): the same ProxyJump chain, auth, SFTP, and exec mechanics
 * as `SshRuntime`, but bound to a registry entry instead of the shared
 * service. The registry uses it for connection tests and per-connection
 * directory browsing; the `ssh://<id>/<path>` cwd routing in the providers
 * rides the same instances.
 *
 * The shared session state lives in {@link module:dsh-workspace-enhancement/ssh-core};
 * this module only resolves a registry spec into the hop chain and wires the
 * per-connection error messages. Host-key policy resolution order:
 * `spec.hostKeyMode` (TOFU) → `spec.strictHostKeyChecking`/`spec.knownHosts`
 * (legacy manual) → the registry-wide default mode (TOFU `accept-new`).
 * @module dsh-workspace-enhancement/connection
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SshSession, resolveRemoteCwd as mapRemoteCwd } from "./ssh-core.js";
import { HostKeyGuard, HostKeyStore, defaultKnownHostsFile } from "./hostkey.js";
/**
 * Resolve a spec's host-key policy. Priority: `hostKeyMode` (TOFU) →
 * `strictHostKeyChecking`/`knownHosts` (legacy manual; `false` = no
 * verification, preserving historical behavior) → the registry-wide default
 * mode (TOFU, default `accept-new`).
 */
export function resolveHostKeyPolicy(source, defaultMode) {
    if (source.hostKeyMode !== undefined)
        return { kind: 'tofu', mode: source.hostKeyMode };
    if (source.strictHostKeyChecking === true)
        return { kind: 'manual' };
    if (source.strictHostKeyChecking === false)
        return { kind: 'none' };
    return { kind: 'tofu', mode: defaultMode };
}
/**
 * Every credential-bearing field value of a spec that must never surface in a
 * transited error message (private-key paths, passwords, passphrases — the
 * target and every jump hop).
 */
function sensitiveSpecValues(spec) {
    const values = [];
    const push = (value) => {
        if (typeof value === 'string' && value !== '')
            values.push(value);
    };
    push(spec.privateKeyPath);
    push(spec.password);
    push(spec.passphrase);
    for (const hop of spec.jump ?? []) {
        push(hop.privateKey);
        push(hop.password);
        push(hop.passphrase);
    }
    return values;
}
/**
 * Replace every occurrence of one value in a message with `<redacted>`. Path
 * values (containing a separator, e.g. an ENOENT message quoting a private-key
 * file) are always redacted; password/passphrase values shorter than the
 * threshold are skipped — error text never quotes the password itself, and
 * substituting a 1–2 character value would collide with ordinary words and
 * wreck the message.
 * @param message - the message to sanitize (transited text only; the error
 *   object and its FsError mapping semantics are untouched).
 * @param values - the sensitive field values cleared from the message.
 * @returns the sanitized message.
 */
export function redactValues(message, values) {
    let redacted = message;
    for (const value of values) {
        if (value.length < 4 && !/[\\/]/.test(value))
            continue;
        redacted = redacted.split(value).join('<redacted>');
    }
    return redacted;
}
/**
 * Redact every credential-bearing field value of a spec from a message
 * (private-key paths, passwords, passphrases — the target and every jump hop).
 * @param message - the message to sanitize (transited text only).
 * @param spec - the spec whose secret values are cleared from the message.
 * @returns the sanitized message.
 */
export function redactSpecMessage(message, spec) {
    return redactValues(message, sensitiveSpecValues(spec));
}
/**
 * ssh2 failures carry transport `code`s (ECONNREFUSED, CLIENT_AUTH…) that host
 * services forward verbatim and their closed wire vocabularies then reject;
 * rewrap into a bare Error so consumers fall back to their own mapping. Abort
 * reasons and our own messages pass through untouched. The inner message is
 * redacted so credential values (private-key paths, passwords) never reach the
 * UI or the logs.
 */
function rewrapConnectError(error, label, endpoint, spec) {
    if (!(error instanceof Error))
        return error;
    if (error.name === 'AbortError' || error.message.startsWith('dsw:'))
        return error;
    return new Error(`dsw: cannot connect to "${label}" (${endpoint}): ${redactSpecMessage(error.message, spec)}`);
}
/** Read one identity file, redacting a failure message built from its path.
 * Node quotes the `~`-EXPANDED path in an ENOENT message, so both the
 * configured spelling and the expanded one are cleared (the raw
 * `redactSpecMessage` on the spec alone would miss the expanded form). */
function readIdentityFileFor(spec, path) {
    const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
    try {
        return readFileSync(expanded, 'utf8');
    }
    catch (error) {
        if (error instanceof Error)
            error.message = redactValues(redactSpecMessage(error.message, spec), [expanded]);
        throw error;
    }
}
/**
 * Resolve the keychain-backed password into the chain's TARGET hop. An
 * explicit non-empty password ALWAYS wins; an empty string counts as "no
 * explicit password" so a keychain machine persisted with `password: ''`
 * (same-session save) still resolves its secret. A provider miss leaves the
 * hops untouched (no empty-password auth attempt). Jump hops keep their own
 * auth as configured.
 * @param current - the configured hop chain (target last).
 * @param provider - the machine's password resolver (OS keychain, best-effort).
 * @param machineId - the machine id the provider resolves for.
 * @returns the enriched hop chain, or `current` unchanged on a provider miss.
 */
export async function resolveTargetPassword(current, provider, machineId) {
    const password = await provider(machineId);
    if (password === undefined || password === '')
        return current;
    return current.map((hop, index) => (index === current.length - 1 && (hop.password === undefined || hop.password === '')
        ? { ...hop, password }
        : hop));
}
/** A registry-owned live SSH connection (jump chain + shared SFTP). */
export class SshConnection {
    spec;
    id;
    label;
    endpoint;
    session;
    hostKeyPolicy;
    hostKeyGuard;
    hostKeyStore;
    /** The transport's default remote working directory (`workspace` wins). */
    get cwd() {
        return this.spec.workspace ?? this.spec.cwd ?? '/root';
    }
    /** The resolved host-key policy for this connection. */
    get policy() {
        return this.hostKeyPolicy;
    }
    /** Build the hop chain from a registry spec (auth defaults fall down the chain). */
    constructor(spec, options = {}) {
        this.spec = spec;
        this.id = spec.id;
        this.label = spec.label;
        this.endpoint = `${spec.username}@${spec.host}`;
        // Tailscale/DERP-relayed paths routinely exceed 20s to ready (observed
        // 4–20s variance); OpenSSH has no client-side handshake cap at all.
        const readyTimeout = spec.readyTimeout ?? 45_000;
        const keepaliveInterval = spec.keepaliveInterval ?? 0;
        const keepaliveCountMax = spec.keepaliveCountMax ?? 3;
        const parent = {
            host: spec.host,
            port: spec.port,
            username: spec.username,
            readyTimeout,
            keepaliveInterval,
            keepaliveCountMax,
        };
        // An empty-string password means "no explicit password" (the keychain
        // backend persists `''` as the no-plaintext marker); writing it would both
        // force an empty-password auth attempt and mask the keychain resolution
        // below, so only non-empty values land in the hop chain.
        if (spec.password !== undefined && spec.password !== '')
            parent.password = spec.password;
        if (spec.privateKeyPath !== undefined)
            parent.privateKey = readIdentityFileFor(spec, spec.privateKeyPath);
        if (spec.passphrase !== undefined)
            parent.passphrase = spec.passphrase;
        if (spec.agent !== undefined)
            parent.agent = spec.agent;
        const hops = [...(spec.jump ?? []).map((jump) => {
                const hop = {
                    host: jump.host ?? parent.host,
                    port: jump.port ?? parent.port,
                    username: jump.username ?? parent.username,
                    readyTimeout: jump.readyTimeout ?? readyTimeout,
                    keepaliveInterval: jump.keepaliveInterval ?? keepaliveInterval,
                    keepaliveCountMax: jump.keepaliveCountMax ?? keepaliveCountMax,
                };
                if (jump.password !== undefined)
                    hop.password = jump.password;
                if (jump.privateKey !== undefined)
                    hop.privateKey = jump.privateKey.includes('-----BEGIN') ? jump.privateKey : readIdentityFileFor(spec, jump.privateKey);
                if (jump.passphrase !== undefined)
                    hop.passphrase = jump.passphrase;
                if (jump.agent !== undefined)
                    hop.agent = jump.agent;
                return hop;
            }), parent];
        this.hostKeyStore = options.hostKeyStore ?? new HostKeyStore(defaultKnownHostsFile());
        this.hostKeyPolicy = resolveHostKeyPolicy(spec, options.defaultHostKeyMode ?? 'accept-new');
        if (this.hostKeyPolicy.kind !== 'tofu') {
            this.hostKeyGuard = undefined;
        }
        else {
            this.hostKeyGuard = new HostKeyGuard(this.hostKeyStore, this.hostKeyPolicy.mode);
        }
        const hostKeyGuard = this.hostKeyGuard;
        const sessionHostVerifier = hostKeyGuard === undefined
            ? undefined
            : (host, key) => hostKeyGuard.verifier(host.host, host.port)(key);
        const passwordProvider = options.passwordProvider;
        const resolveHosts = passwordProvider === undefined
            ? undefined
            : (current) => resolveTargetPassword(current, passwordProvider, this.id);
        this.session = new SshSession(hops, spec.strictHostKeyChecking ?? false, spec.knownHosts ?? [], {
            disposedMessage: `dsw: connection "${this.label}" is disposed`,
            label: this.label,
            ...(sessionHostVerifier !== undefined ? { hostVerifier: sessionHostVerifier } : {}),
            ...(resolveHosts !== undefined ? { resolveHosts } : {}),
            connectErrorRewriter: (error) => {
                const hostKeyError = hostKeyGuard?.lastError;
                if (hostKeyError !== null && hostKeyError !== undefined) {
                    return new Error(`dsw: ${hostKeyError}`);
                }
                return rewrapConnectError(error, this.label, this.endpoint, spec);
            },
            resolveRemoteCwd: (cwd) => mapRemoteCwd(this.cwd, cwd),
        });
    }
    /**
     * Whether the jump chain reached its ready state and has not been disposed.
     * Never forces a connect; a brand-new connection reports `false`.
     */
    isConnected() {
        return this.session.isConnected();
    }
    /** Whether the given endpoint has a recorded TOFU fingerprint. */
    hostKeyKnown(host, port) {
        return this.hostKeyStore.get(host ?? this.spec.host, port ?? this.spec.port) !== undefined;
    }
    /** The trust record for this connection's endpoint, if any. */
    hostKeyEntry() {
        return this.hostKeyStore.get(this.spec.host, this.spec.port);
    }
    /** Release the chain and the shared SFTP channel. */
    dispose() {
        this.session.dispose();
    }
    /**
     * Map a caller-supplied working directory onto this connection's host. The
     * rules mirror {@link SshRuntime.resolveRemoteCwd}: a POSIX absolute path is
     * already remote, while a Windows drive/UNC path or the absent cwd falls
     * back to the registry entry's configured remote cwd.
     */
    resolveRemoteCwd(cwd) {
        return mapRemoteCwd(this.cwd, cwd);
    }
    /** The authenticated target client after the jump chain succeeds. */
    getClient(signal) {
        return this.session.getClient(signal);
    }
    /** The shared SFTP channel, opened lazily once per connection. */
    getSftp(signal) {
        return this.session.getSftp(signal);
    }
    /** The remote login environment, read once and cached. */
    getRemoteEnvironment(signal) {
        return this.session.getRemoteEnvironment(signal);
    }
    /** Run one control-plane command with collected output. */
    exec(command, opts) {
        return this.session.exec(command, opts);
    }
}
export default SshConnection;
//# sourceMappingURL=connection.js.map