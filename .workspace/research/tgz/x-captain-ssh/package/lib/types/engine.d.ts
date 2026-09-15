/**
 * The SSH engine: a per-alias persistent connection pool (ssh2) with
 * multi-hop jump support, command execution, PTY shells, SFTP transfers,
 * local port-forward tunnels and cluster execution — the DSH counterpart of
 * ssh-skill's daemon + scripts, living entirely in the host process.
 */
import type { ClusterResult, ExecResult, SshHostSummary, TestResult, TransferProgress, TunnelInfo } from './protocol.ts';
import { type HostStore } from './store.ts';
/** Default engine knobs. */
export interface EngineOptions {
    /** Connections idle longer than this are closed (ms). */
    idleTimeoutMs?: number;
    /** SSH handshake timeout (ms). */
    connectTimeoutMs?: number;
    /** Keepalive ping interval (ms). */
    keepaliveIntervalMs?: number;
    /** Cap on captured stdout/stderr bytes per exec (ms). */
    maxOutputBytes?: number;
    /** Default exec timeout (ms). */
    defaultExecTimeoutMs?: number;
    /** Default cluster concurrency. */
    defaultMaxWorkers?: number;
    /** SFTP concurrent channel count for transfers. */
    sftpConcurrency?: number;
}
/** A live PTY shell session. */
export interface ShellSession {
    /** Assign to receive remote output. */
    onData?: (data: Buffer) => void;
    /** Assign to be notified when the channel closes. */
    onExit?: (code: number | null, error?: string) => void;
    /** Write raw input to the shell. */
    send(data: string): void;
    /** Resize the remote PTY. */
    resize(cols: number, rows: number): void;
    /** Close the session and its channel. */
    close(): void;
    /** Pause remote output delivery (transport backpressure). */
    pause(): void;
    /** Resume remote output delivery. */
    resume(): void;
}
/**
 * The engine. Owns the pool, tunnels, and all operations. One instance per
 * plugin apply; dispose() closes every connection.
 */
export declare class SshEngine {
    private readonly store;
    private readonly opts;
    private readonly pool;
    private readonly tunnels;
    private sweepTimer;
    private nextTunnelId;
    /**
     * @param store - the host config store.
     * @param options - engine knobs (defaults applied).
     */
    constructor(store: HostStore, options?: EngineOptions);
    /** Secret-free host list (filtered by the optional query). */
    list(query?: string): SshHostSummary[];
    /** One host summary by alias. */
    find(alias: string): SshHostSummary | undefined;
    /**
     * Run `fn` with a live client for `alias`, reconnecting (up to the
     * attempt budget) when the connection broke mid-flight.
     */
    private withClient;
    /**
     * Build one full jump chain for an entry: hop clients connected through in
     * order, each forwarding a stream to the next destination, ending with the
     * target client. Shared by the pool and standalone shell sessions.
     */
    private connectChain;
    /** In-flight acquire promises, deduped per alias (concurrent first use). */
    private readonly acquireQueue;
    /** Connect (or reuse) the pooled chain for one alias; pins nothing. */
    private acquire;
    private doAcquire;
    /**
     * Tear down one alias's record. When `record` is given and no longer the
     * pooled record for the alias (a concurrent acquire replaced it), nothing
     * is torn down — the connection belongs to someone else now.
     */
    private disposeRecord;
    /** Close connections idle beyond the threshold (skips pinned and in-flight). */
    private sweep;
    /** Run one command on `alias` (reusing the pooled connection). */
    exec(alias: string, command: string, timeoutMs?: number): Promise<ExecResult>;
    /** Run one command against many hosts concurrently. */
    cluster(options: {
        command: string;
        aliases?: string[];
        environment?: string;
        tags?: string[];
        timeoutMs?: number;
        maxWorkers?: number;
    }): Promise<ClusterResult[]>;
    /** Open a PTY shell session for the web terminal (standalone connection). */
    openShell(alias: string, size: {
        cols: number;
        rows: number;
    }): Promise<ShellSession>;
    /** Upload one local file (or directory tree) to a remote path. */
    upload(alias: string, localPath: string, remotePath: string, recursive: boolean, onProgress?: (progress: TransferProgress) => void): Promise<{
        bytes: number;
        files: number;
    }>;
    /** Download one remote file to a local path. */
    download(alias: string, remotePath: string, localPath: string, onProgress?: (progress: TransferProgress) => void): Promise<{
        bytes: number;
    }>;
    /** List a remote directory (file browser). */
    ls(alias: string, path: string): Promise<import('./protocol.ts').RemoteDirEntry[]>;
    private sftp;
    /** Create a remote directory chain (stat-then-mkdir per segment). */
    private ensureRemoteDir;
    private fastPut;
    private fastGet;
    /** Start a local port-forward tunnel (listens on 127.0.0.1 only). */
    startTunnel(alias: string, options: {
        remotePort: number;
        remoteHost?: string;
        localPort?: number;
    }): Promise<TunnelInfo>;
    /** All active tunnels. */
    listTunnels(): TunnelInfo[];
    /** Stop one tunnel (closes the listener, live sockets, and the pinned connection). */
    stopTunnel(id: string): boolean;
    /** Stop all tunnels (optionally for one alias). */
    stopAllTunnels(alias?: string): number;
    /** Probe connectivity: connect, run `true`, close. */
    test(alias: string): Promise<TestResult>;
    /** Close every pooled connection and tunnel. */
    dispose(): void;
}
