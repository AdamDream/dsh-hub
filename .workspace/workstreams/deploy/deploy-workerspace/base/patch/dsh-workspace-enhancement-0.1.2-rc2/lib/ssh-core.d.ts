/**
 * Shared SSH connection mechanics for dsh-workspace-enhancement.
 *
 * One copy of the ProxyJump-chain open, host-key verification, exec channel
 * collection, remote-environment read (with cache), SFTP caching, and shell
 * quoting helpers that the aggregate `ctx.ssh` runtime and the registry-owned
 * `SshConnection` both need. The connection-world contracts (`SshTransport`,
 * `ExecOutcome`, `JumpConfig`, `SshConnectionSpec`) are unchanged; this module
 * only removes the duplicated implementations of `runtime.ts` and
 * `connection.ts`, which are thin shells around {@link SshSession} now.
 * @module dsh-workspace-enhancement/ssh-core
 */
import { Client } from 'ssh2';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
/** Collected result of one control-plane command. */
export interface ExecOutcome {
    /** Exit code; null when the command died from a signal. */
    exitCode: number | null;
    /** Terminating signal; null on normal exit. */
    signal: string | null;
    /** Collected standard output. */
    stdout: string;
    /** Collected standard error. */
    stderr: string;
}
/** One connection hop after auth and defaults are resolved. */
export interface ResolvedConnectionHost {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    agent?: string;
    readyTimeout: number;
    keepaliveInterval: number;
    keepaliveCountMax: number;
}
/**
 * Quote one argument for a POSIX login shell: single quotes with the only
 * escaping a single-quoted string needs. Identical in spirit to the E2B
 * adapter's helper so both remote providers share one quoting rule.
 * @param value - exact argument value to preserve.
 * @returns a single shell word with no interpolation.
 */
export declare function quoteShellArg(value: string): string;
/**
 * Wrap a remote command so it runs from the configured working directory.
 * @param cwd - absolute remote working directory.
 * @param command - the remote command to run there.
 * @returns the `cd`-guarded command text.
 */
export declare function wrapCwd(cwd: string, command: string): string;
/**
 * The first existing OpenSSH default identity, mirroring the ssh client's own
 * probe: a hop with no password, key, or agent configured would otherwise be
 * rejected by every server because ssh2 never tries default key files.
 */
export declare function defaultIdentity(): string | undefined;
/**
 * Reads an identity value that is either PEM content or a local identity-file
 * path. A missing file must not leak its local path into a user-facing message
 * — the raw ENOENT text is replaced by a sanitized one here because the
 * `ctx.ssh` construction path (resolveHost/resolveJump) has no connect-rewrap
 * layer to clean it. The error object is kept (code/name preserved).
 */
export declare function resolvePrivateKey(value: string): string | Buffer;
/**
 * Build the host-key verifier for strict checking: accept only a key whose
 * SHA256 fingerprint or raw base64 encoding matches a known-hosts entry.
 * @param knownHosts - configured trusted fingerprints or keys.
 * @returns a verifier accepting exactly the matching keys.
 */
export declare function hostVerifierFor(knownHosts: readonly string[]): (key: Buffer) => boolean;
/**
 * Shape the ssh2 connection config for one hop, without the jump socket.
 * Host-key verification and the default-identity probe apply per hop, so a
 * jump chain is verified at every boundary it crosses. A caller-supplied
 * per-hop verifier (TOFU) wins over the static known-hosts list; `strict`
 * falls back to {@link hostVerifierFor} otherwise.
 */
export declare function toConnectConfig(host: ResolvedConnectionHost, strict: boolean, knownHosts: readonly string[], hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean): ConnectConfig;
/** Resolve once the client reaches its ready state. */
export declare function connectReady(client: Client, config: ConnectConfig): Promise<void>;
/** Open a direct-tcpip channel through one already-connected hop. */
export declare function forwardThrough(client: Client, host: string, port: number): Promise<ClientChannel>;
/**
 * Open the whole jump chain: each hop connects after the previous one, and the
 * last client is the target. On failure the already-opened clients are ended
 * (the original error owns the failure) and it is rethrown.
 * @param hosts - resolved hops in order (target last).
 * @param strict - whether to enforce {@link hostVerifierFor} on every hop.
 * @param knownHosts - trusted host keys applied when strict.
 * @param hostVerifier - optional per-hop verifier (TOFU); wins over strict.
 * @returns the opened clients, target last.
 */
export declare function openChain(hosts: readonly ResolvedConnectionHost[], strict: boolean, knownHosts: readonly string[], hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean): Promise<Client[]>;
/**
 * Run one control-plane command on an authenticated client with collected
 * output. Used by adapters for executable lookup, canonical-path resolution,
 * and the remote-environment probe, not for user work.
 * @param client - the authenticated target client.
 * @param text - remote command text (already shell-quoted by the caller).
 * @param opts - optional cancellation.
 * @returns the collected exit facts and output.
 */
export declare function execChannel(client: Client, text: string, opts?: {
    signal?: AbortSignal;
}): Promise<ExecOutcome>;
/** Parse the NUL-delimited name/value stream produced by a remote `env -0`. */
export declare function parseRemoteEnvironment(stdout: string): Record<string, string>;
/**
 * Map a caller-supplied working directory onto a remote host. The harness
 * hands providers the session cwd, which is a local path when the harness
 * runs on the developer machine; a local absolute path (Windows drive, UNC)
 * or a relative path has no meaning on the remote host, so it is redirected
 * to the configured remote cwd. A POSIX absolute path is a remote path and
 * passes through unchanged.
 * @param fallback - the transport's default remote working directory.
 * @param cwd - the caller-supplied working directory, or `undefined` for the default.
 * @returns the remote working directory to execute in.
 */
export declare function resolveRemoteCwd(fallback: string, cwd: string | undefined): string;
/** Options shared by every session owner (runtime service or registry connection). */
export interface SshSessionOptions {
    /** Error message when an operation runs after dispose. */
    disposedMessage?: string;
    /** Optional rewriter of a failed chain open (the registry rewraps ssh2 transport codes). */
    connectErrorRewriter?: (error: unknown) => unknown;
    /** Owner label embedded in the remote-environment failure message. */
    label?: string;
    /**
     * Map a caller-supplied working directory onto this session's remote host.
     */
    resolveRemoteCwd?: (cwd: string | undefined) => string;
    /**
     * Optional per-hop host-key verifier (TOFU); when set it wins over the
     * static `strict`/`knownHosts` pair on every hop of the chain.
     */
    hostVerifier?: (host: ResolvedConnectionHost, key: Buffer) => boolean;
    /**
     * Optional async host enrichment run before the chain opens (e.g. resolving
     * a keychain-backed password). The resolved hops replace the configured ones
     * for this attempt only; nothing is persisted.
     */
    resolveHosts?: (hosts: readonly ResolvedConnectionHost[]) => Promise<readonly ResolvedConnectionHost[]>;
    /**
     * Optional message redactor for errors leaving this session (connect
     * rewrap, environment-read failure). Applies to the transited message text
     * only — the error object's shape (name, code, cause) is preserved.
     */
    redactMessage?: (message: string) => string;
}
/**
 * One authenticated SSH session state shared by the aggregate runtime and the
 * registry-owned connections: the opened jump chain, the lazily shared SFTP
 * channel, and the cached remote login environment, plus disposal. Order and
 * failure semantics match the connection owner both callers used before the
 * extraction (target channel closed before the jump clients, partial chain
 * ended on failure, SFTP invalidated on close/end).
 */
export declare class SshSession {
    private readonly hosts;
    private readonly strict;
    private readonly knownHosts;
    private readonly options;
    private clients;
    private ready;
    private sftp;
    private sftpOpening;
    private remoteEnvironment;
    private disposed;
    private connected;
    constructor(hosts: readonly ResolvedConnectionHost[], strict: boolean, knownHosts: readonly string[], options?: SshSessionOptions);
    /**
     * Return the shared live connection after the jump chain and auth succeed.
     * @param signal - caller lifetime; absent for the service runtime (unchanged API).
     * @returns the authenticated target client.
     * @throws when connection, jump, or authentication fails, or when disposing.
     */
    getClient(signal?: AbortSignal): Promise<Client>;
    /**
     * Return the shared SFTP channel, opened lazily once per connection. A
     * closed connection invalidates it so the next call reopens.
     * @param signal - caller lifetime; absent for the service runtime.
     * @returns the live SFTP wrapper.
     */
    getSftp(signal?: AbortSignal): Promise<SFTPWrapper>;
    /**
     * Return the remote login environment, read once per connection and cached.
     * The login environment is stable for the connection lifetime, so adapters
     * avoid one control command per spawned process.
     * @param signal - caller lifetime; absent for the service runtime.
     * @returns the remote environment as name/value entries.
     */
    getRemoteEnvironment(signal?: AbortSignal): Promise<Record<string, string>>;
    /**
     * Run one control-plane command with collected output. Used by adapters for
     * executable lookup and canonical-path resolution, not for user work.
     * @param command - remote command text (already shell-quoted by the caller).
     * @param opts - optional working-directory override and cancellation.
     * @returns the collected exit facts and output.
     */
    exec(command: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<ExecOutcome>;
    /** Release the chain and the shared SFTP channel (idempotent). */
    dispose(): void;
    private disposedMessage;
    /** Whether the chain reached its ready state and has not been disposed. */
    isConnected(): boolean;
    private rewrapConnect;
    private openSftp;
    private readRemoteEnvironment;
    private open;
}
