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
import type { Client, SFTPWrapper } from 'ssh2';
import type { ExecOutcome, ResolvedConnectionHost } from './ssh-core.ts';
import type { JumpConfig } from './runtime.ts';
import { HostKeyStore } from './hostkey.ts';
import type { HostKeyMode } from './hostkey.ts';
import type { CredentialBackend } from './credential.ts';
import type { RemoteApprovalMode } from './remote-approval-gate.ts';
/** A registry entry as persisted in the state file (machine record). */
export interface SshConnectionSpec {
    /** Stable registry id (`c1`, `c2`, …). */
    id: string;
    /** Operator-facing display name. */
    label: string;
    /** dsh-remote compat alias; `label` wins when both are present. */
    name?: string;
    /** Target hostname or address. */
    host: string;
    /** Target SSH port. */
    port: number;
    /** Remote login user. */
    username: string;
    /** Password authentication (stored verbatim when `credentialBackend` is plain). */
    password?: string;
    /** Local path to a PEM identity file. */
    privateKeyPath?: string;
    /** Passphrase for an encrypted private key. */
    passphrase?: string;
    /** SSH agent socket path or the `pageant` sentinel for Windows. */
    agent?: string;
    /** Ordered ProxyJump chain (same semantics as the ssh service). */
    jump?: JumpConfig[];
    /** Remote working directory (dsh-ssh legacy spelling); an absolute POSIX path. */
    cwd?: string;
    /**
     * Remote working directory (dsh-remote canonical spelling); an absolute
     * POSIX path. When both are present, `workspace` wins.
     */
    workspace?: string;
    /** Socket connect timeout in milliseconds. */
    readyTimeout?: number;
    /** TCP keepalive interval in milliseconds; 0 disables. */
    keepaliveInterval?: number;
    /** TCP keepalive retry budget before the connection is considered dead. */
    keepaliveCountMax?: number;
    /**
     * Per-machine TOFU policy; overrides the registry-wide default. Absent and
     * `strictHostKeyChecking`/`knownHosts` absent → the default mode
     * (`accept-new`).
     */
    hostKeyMode?: HostKeyMode;
    /**
     * When true and no {@link hostKeyMode} is set, reject a host key that does
     * not match an entry in {@link knownHosts}. Defaults to false (historical
     * behavior); the TOFU default replaces it for new records.
     */
    strictHostKeyChecking?: boolean;
    /** Trusted host keys as `SHA256:<base64>` fingerprints or raw base64 public keys. */
    knownHosts?: string[];
    /** OS-keychain storage backend for the password (else plaintext). */
    credentialBackend?: CredentialBackend;
    /**
     * The operator asked for encrypted storage but the OS backend failed and the
     * password fell back to plaintext; the UI shows a warning for these.
     */
    encryptFallback?: boolean;
    /** Last workspaces picked on this machine, most recent first (max 8). */
    recentWorkspaces?: string[];
    /** ISO-8601 timestamp of the last successful status probe (conn.probe/reconnect). */
    lastProbeAt?: string;
    /** Round-trip milliseconds of the last successful status probe. */
    lastProbeLatencyMs?: number | null;
    /**
     * AUDIT-6 (ADR-0020 D2): per-machine remote-command approval gate —
     * `'off'` (default, absent on pre-AUDIT-6 records ⇒ zero migration),
     * `'human'` (ask a human before every gated remote command), `'ai'`
     * (whitelisted read-only commands auto-granted, everything else to the
     * human). One field drives BOTH the asker (the seam gate) and the answerer
     * (the AI auto-grant filter) — one source of truth.
     */
    remoteApproval?: RemoteApprovalMode;
}
/** Connection-level host-key policy resolved from a spec + global default. */
export type HostKeyPolicy = {
    kind: 'tofu';
    mode: HostKeyMode;
} | {
    kind: 'manual';
} | {
    kind: 'none';
};
/** Minimal source of host-key policy fields (spec, config, machine record). */
export interface HostKeyPolicySource {
    hostKeyMode?: HostKeyMode;
    strictHostKeyChecking?: boolean;
}
/**
 * Resolve a spec's host-key policy. Priority: `hostKeyMode` (TOFU) →
 * `strictHostKeyChecking`/`knownHosts` (legacy manual; `false` = no
 * verification, preserving historical behavior) → the registry-wide default
 * mode (TOFU, default `accept-new`).
 */
export declare function resolveHostKeyPolicy(source: HostKeyPolicySource, defaultMode: HostKeyMode): HostKeyPolicy;
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
export declare function redactValues(message: string, values: readonly string[]): string;
/**
 * Redact every credential-bearing field value of a spec from a message
 * (private-key paths, passwords, passphrases — the target and every jump hop).
 * @param message - the message to sanitize (transited text only).
 * @param spec - the spec whose secret values are cleared from the message.
 * @returns the sanitized message.
 */
export declare function redactSpecMessage(message: string, spec: SshConnectionSpec): string;
/** Options passed by the registry into every connection it owns. */
export interface SshConnectionOptions {
    /** TOFU store; defaults to `<dsh home>/remote-workspaces/known_hosts.json`. */
    hostKeyStore?: HostKeyStore;
    /** Registry-wide default TOFU mode applied when the spec sets no policy. */
    defaultHostKeyMode?: HostKeyMode;
    /**
     * Async password provider for keychain-backed machines; consulted before the
     * chain is opened so an OS-store password never lands in the persisted spec.
     */
    passwordProvider?: (machineId: string) => Promise<string | undefined>;
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
export declare function resolveTargetPassword(current: readonly ResolvedConnectionHost[], provider: (machineId: string) => Promise<string | undefined>, machineId: string): Promise<readonly ResolvedConnectionHost[]>;
/** A registry-owned live SSH connection (jump chain + shared SFTP). */
export declare class SshConnection {
    readonly spec: SshConnectionSpec;
    readonly id: string;
    readonly label: string;
    readonly endpoint: string;
    private readonly session;
    private readonly hostKeyPolicy;
    private readonly hostKeyGuard;
    private readonly hostKeyStore;
    /** The transport's default remote working directory (`workspace` wins). */
    get cwd(): string;
    /** The resolved host-key policy for this connection. */
    get policy(): HostKeyPolicy;
    /** Build the hop chain from a registry spec (auth defaults fall down the chain). */
    constructor(spec: SshConnectionSpec, options?: SshConnectionOptions);
    /**
     * Whether the jump chain reached its ready state and has not been disposed.
     * Never forces a connect; a brand-new connection reports `false`.
     */
    isConnected(): boolean;
    /** Whether the given endpoint has a recorded TOFU fingerprint. */
    hostKeyKnown(host?: string, port?: number): boolean;
    /** The trust record for this connection's endpoint, if any. */
    hostKeyEntry(): {
        algo: string;
        fingerprint: string;
        firstSeen: string;
    } | undefined;
    /** Release the chain and the shared SFTP channel. */
    dispose(): void;
    /**
     * Map a caller-supplied working directory onto this connection's host. The
     * rules mirror {@link SshRuntime.resolveRemoteCwd}: a POSIX absolute path is
     * already remote, while a Windows drive/UNC path or the absent cwd falls
     * back to the registry entry's configured remote cwd.
     */
    resolveRemoteCwd(cwd: string | undefined): string;
    /** The authenticated target client after the jump chain succeeds. */
    getClient(signal?: AbortSignal): Promise<Client>;
    /** The shared SFTP channel, opened lazily once per connection. */
    getSftp(signal?: AbortSignal): Promise<SFTPWrapper>;
    /** The remote login environment, read once and cached. */
    getRemoteEnvironment(signal?: AbortSignal): Promise<Record<string, string>>;
    /** Run one control-plane command with collected output. */
    exec(command: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<ExecOutcome>;
}
export default SshConnection;
