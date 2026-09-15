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
import { posix } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SshSession, resolvePrivateKey, resolveRemoteCwd as mapRemoteCwd } from "./ssh-core.js";
import { resolveHostKeyPolicy, redactValues } from "./connection.js";
import { HostKeyGuard, HostKeyStore, defaultKnownHostsFile } from "./hostkey.js";
export { quoteShellArg, wrapCwd } from "./ssh-core.js";
/** Resolve the target host's auth and defaults. */
function resolveHost(config) {
    const host = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: config.readyTimeout,
        keepaliveInterval: config.keepaliveInterval,
        keepaliveCountMax: config.keepaliveCountMax,
    };
    if (config.password !== undefined)
        host.password = config.password;
    if (config.privateKey !== undefined)
        host.privateKey = resolvePrivateKey(config.privateKey);
    if (config.passphrase !== undefined)
        host.passphrase = config.passphrase;
    if (config.agent !== undefined)
        host.agent = config.agent;
    return host;
}
/** Resolve one jump hop with auth and defaults falling back to the parent. */
function resolveJump(jump, parent) {
    const host = {
        host: jump.host ?? parent.host,
        port: jump.port ?? parent.port,
        username: jump.username ?? parent.username,
        readyTimeout: jump.readyTimeout ?? parent.readyTimeout,
        keepaliveInterval: jump.keepaliveInterval ?? parent.keepaliveInterval,
        keepaliveCountMax: jump.keepaliveCountMax ?? parent.keepaliveCountMax,
    };
    if (jump.password !== undefined)
        host.password = jump.password;
    if (jump.privateKey !== undefined)
        host.privateKey = resolvePrivateKey(jump.privateKey);
    if (jump.passphrase !== undefined)
        host.passphrase = jump.passphrase;
    if (jump.agent !== undefined)
        host.agent = jump.agent;
    return host;
}
/** SSH connection owner registered as `ctx.ssh`. */
export class SshRuntime extends Service {
    static Config = z.object({
        host: z.string().required(),
        port: z.number().default(22),
        username: z.string().required(),
        password: z.string(),
        privateKey: z.string(),
        passphrase: z.string(),
        agent: z.string(),
        jump: z.array(z.object({
            host: z.string().required(),
            port: z.number(),
            username: z.string(),
            password: z.string(),
            privateKey: z.string(),
            passphrase: z.string(),
            agent: z.string(),
            readyTimeout: z.number(),
            keepaliveInterval: z.number(),
            keepaliveCountMax: z.number(),
        })).default([]),
        cwd: z.string().required(),
        readyTimeout: z.number().default(45_000),
        keepaliveInterval: z.number().default(0),
        keepaliveCountMax: z.number().default(3),
        strictHostKeyChecking: z.boolean(),
        knownHosts: z.array(z.string()),
        hostKeyMode: z.string(),
    });
    /** Validated remote working directory shared by provider adapters. */
    cwd;
    /** Human-readable connection target for UI surfaces (`username@host`). */
    endpoint;
    session;
    /** Validate config, resolve the jump chain, and bind the disposal policy. */
    constructor(ctx, config) {
        super(ctx, 'ssh');
        const resolved = config;
        this.validate(resolved);
        this.cwd = resolved.cwd;
        this.endpoint = `${resolved.username}@${resolved.host}`;
        const hosts = [...resolved.jump.map(jump => resolveJump(jump, resolved)), resolveHost(resolved)];
        // Host-key policy: TOFU (default accept-new) unless the config opts into
        // the legacy manual known-hosts pair explicitly.
        const hostKeyMode = resolved.hostKeyMode;
        const mode = hostKeyMode === 'verify' || hostKeyMode === 'off'
            ? hostKeyMode
            : (hostKeyMode === undefined ? undefined : 'accept-new');
        const policy = resolveHostKeyPolicy({
            ...(mode !== undefined ? { hostKeyMode: mode } : {}),
            ...(resolved.strictHostKeyChecking !== undefined ? { strictHostKeyChecking: resolved.strictHostKeyChecking } : {}),
        }, 'accept-new');
        const hostKeyGuard = policy.kind === 'tofu'
            ? new HostKeyGuard(new HostKeyStore(defaultKnownHostsFile()), policy.mode)
            : undefined;
        const hostVerifier = hostKeyGuard === undefined
            ? undefined
            : (host, key) => hostKeyGuard.verifier(host.host, host.port)(key);
        // Credential values (private-key paths — target AND jump —, passwords,
        // passphrases) must never surface in a transited error message (ENOENT
        // quotes the key file path).
        const secretValues = [
            ...(resolved.password !== undefined && resolved.password !== '' ? [resolved.password] : []),
            ...(resolved.passphrase !== undefined && resolved.passphrase !== '' ? [resolved.passphrase] : []),
            ...(resolved.privateKey !== undefined && resolved.privateKey !== '' ? [resolved.privateKey] : []),
            ...resolved.jump.flatMap((jump) => [jump.password, jump.passphrase, jump.privateKey]
                .filter((value) => typeof value === 'string' && value !== '')),
        ];
        const redactMessage = secretValues.length === 0
            ? undefined
            : (message) => redactValues(message, secretValues);
        this.session = new SshSession(hosts, resolved.strictHostKeyChecking ?? false, resolved.knownHosts ?? [], {
            disposedMessage: 'SSH service is disposing',
            ...(hostVerifier !== undefined ? { hostVerifier } : {}),
            ...(redactMessage !== undefined ? { redactMessage } : {}),
            resolveRemoteCwd: (cwd) => mapRemoteCwd(this.cwd, cwd),
        });
        ctx.effect(() => () => { this.session.dispose(); }, 'ssh teardown');
    }
    /**
     * Return the shared live connection after the jump chain and auth succeed.
     * @returns the authenticated target client.
     * @throws when connection, jump, or authentication fails, or when disposing.
     */
    getClient() {
        return this.session.getClient();
    }
    /**
     * Return the shared SFTP channel, opened lazily once per connection. A
     * closed connection invalidates it so the next call reopens.
     * @returns the live SFTP wrapper.
     */
    getSftp() {
        return this.session.getSftp();
    }
    /**
     * Return the remote login environment, read once per connection and cached.
     * The login environment is stable for the connection lifetime, so adapters
     * avoid one control command per spawned process.
     * @returns the remote environment as name/value entries.
     */
    getRemoteEnvironment() {
        return this.session.getRemoteEnvironment();
    }
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
    resolveRemoteCwd(cwd) {
        return mapRemoteCwd(this.cwd, cwd);
    }
    /**
     * Run one control-plane command with collected output. Used by adapters for
     * executable lookup and canonical-path resolution, not for user work.
     * @param command - remote command text (already shell-quoted by the caller).
     * @param opts - optional working-directory override and cancellation.
     * @returns the collected exit facts and output.
     */
    exec(command, opts) {
        return this.session.exec(command, opts);
    }
    validate(config) {
        if (config.host.trim().length === 0)
            throw new Error('dsw: host must be a non-empty string');
        if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
            throw new Error(`dsw: port must be an integer in 1..65535: ${config.port}`);
        }
        if (config.username.trim().length === 0)
            throw new Error('dsw: username must be a non-empty string');
        if (!posix.isAbsolute(config.cwd))
            throw new Error(`dsw: cwd must be an absolute POSIX path: ${config.cwd}`);
        for (const [index, jump] of config.jump.entries()) {
            if ((jump.host ?? '').trim().length === 0)
                throw new Error(`dsw: jump[${index}].host must be a non-empty string`);
        }
    }
}
export default SshRuntime;
//# sourceMappingURL=runtime.js.map