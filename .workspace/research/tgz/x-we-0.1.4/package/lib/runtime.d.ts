/**
 * Shared ownership of one SSH execution world. Capability adapters await the same
 * authenticated connection (reached through an optional ProxyJump chain), so
 * filesystem and process operations inhabit one remote host. Auth, keepalive,
 * host-key verification, and the jump chain mirror the portable subset of an
 * OpenSSH `~/.ssh/config` `Host` block.
 *
 * All connection mechanics (hop resolution to ssh2 config, the jump-chain
 * open, SFTP and remote-environment caching, exec channel collection) live in
 * {@link module:dsh-workspace-enhancement/ssh-core}; this module only resolves
 * the service config and owns one {@link SshSession}.
 * @module dsh-workspace-enhancement/ssh
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Client, SFTPWrapper } from 'ssh2';
import type { ExecOutcome } from './ssh-core.ts';
export { quoteShellArg, wrapCwd } from './ssh-core.ts';
export type { ExecOutcome } from './ssh-core.ts';
/** One hop in a ProxyJump chain. */
export interface JumpConfig {
    /** Remote hostname or address, resolved by the previous hop or the local host. */
    host?: string;
    /** Remote SSH port; defaults to the parent host's port (22 for the top level). */
    port?: number;
    /** Remote user; defaults to the parent host's username. */
    username?: string;
    /** Password authentication for this hop. */
    password?: string;
    /** PEM private key content or a local path to an identity file. */
    privateKey?: string;
    /** Passphrase for an encrypted private key. */
    passphrase?: string;
    /** SSH agent socket path or the `pageant` sentinel for Windows. */
    agent?: string;
    /** Socket connect timeout in milliseconds; defaults to the parent's. */
    readyTimeout?: number;
    /** TCP keepalive interval in milliseconds; 0 disables. */
    keepaliveInterval?: number;
    /** TCP keepalive retry budget before the connection is considered dead. */
    keepaliveCountMax?: number;
}
/** Configuration for the shared SSH connection owner. */
export interface Config {
    /** Target hostname or address. */
    host?: string;
    /** Target SSH port. */
    port?: number; /** Remote login user for the target host and default for unset jump users. */
    username?: string;
    /** Password authentication. */
    password?: string;
    /** PEM private key content or a local path to an identity file. */
    privateKey?: string;
    /** Passphrase for an encrypted private key. */
    passphrase?: string;
    /** SSH agent socket path or the `pageant` sentinel for Windows. */
    agent?: string;
    /**
     * Ordered ProxyJump chain. The first hop is reached from the local host;
     * each following hop is reached through the previous one; the target host is
     * reached through the last hop. Every hop's own auth defaults fall back to
     * the target's when omitted.
     */
    jump?: JumpConfig[];
    /** Remote working directory shared by provider adapters; must be an absolute POSIX path. */
    cwd?: string;
    /** Socket connect timeout in milliseconds. */
    readyTimeout?: number;
    /** TCP keepalive interval in milliseconds; 0 disables. */
    keepaliveInterval?: number;
    /** TCP keepalive retry budget before the connection is considered dead. */
    keepaliveCountMax?: number;
    /** When true, reject a host key that does not match an entry in {@link knownHosts}. */
    strictHostKeyChecking?: boolean;
    /** Trusted host keys as `SHA256:<base64>` fingerprints or raw base64 public keys. */
    knownHosts?: string[];
    /**
     * TOFU host-key policy for this runtime: `accept-new` (default) records a
     * host's key on first connect and verifies it afterwards, `verify` rejects
     * hosts never seen before, `off` skips verification entirely. Wins over
     * `strictHostKeyChecking`/`knownHosts` when set.
     */
    hostKeyMode?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        ssh: SshRuntime;
    }
}
/** SSH connection owner registered as `ctx.ssh`. */
export declare class SshRuntime extends Service {
    static Config: z<Config>;
    /** Validated remote working directory shared by provider adapters. */
    readonly cwd: string;
    /** Human-readable connection target for UI surfaces (`username@host`). */
    readonly endpoint: string;
    private readonly session;
    /** Validate config, resolve the jump chain, and bind the disposal policy. */
    constructor(ctx: Context, config: Config);
    /**
     * Return the shared live connection after the jump chain and auth succeed.
     * @returns the authenticated target client.
     * @throws when connection, jump, or authentication fails, or when disposing.
     */
    getClient(): Promise<Client>;
    /**
     * Return the shared SFTP channel, opened lazily once per connection. A
     * closed connection invalidates it so the next call reopens.
     * @returns the live SFTP wrapper.
     */
    getSftp(): Promise<SFTPWrapper>;
    /**
     * Return the remote login environment, read once per connection and cached.
     * The login environment is stable for the connection lifetime, so adapters
     * avoid one control command per spawned process.
     * @returns the remote environment as name/value entries.
     */
    getRemoteEnvironment(): Promise<Record<string, string>>;
    /**
     * Map a caller-supplied working directory onto the remote host. The harness
     * hands providers the session cwd, which is a local path when the harness
     * runs on the developer machine; a local absolute path (Windows drive, UNC)
     * or a relative path has no meaning on the remote host, so it is redirected
     * to the configured remote cwd. A POSIX absolute path is a remote path and
     * passes through unchanged.
     * @param cwd - the caller-supplied working directory, or `undefined` for the default.
     * @returns the remote working directory to execute in.
     */
    resolveRemoteCwd(cwd: string | undefined): string;
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
    private validate;
}
export default SshRuntime;
