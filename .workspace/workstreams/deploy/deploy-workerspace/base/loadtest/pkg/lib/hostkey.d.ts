/**
 * Host-key fingerprint helpers and the TOFU (trust-on-first-use) host-key
 * registry — ported from dsh-remote (`lib/hostkey.js`) with the defensive
 * dual-shape handling kept intact.
 *
 * ssh2 v1.17 hands `hostVerifier` the RAW host-key blob Buffer (SSH wire format
 * `string(algo) string(keydata)`), not the old `{ algo, hash }` object; both
 * shapes are accepted so a contract drift fails closed instead of throwing a
 * crypto error on every connect.
 *
 * The persisted store reuses dsh-remote's path AND format —
 * `<dsh home>/remote-workspaces/known_hosts.json`, keyed `host:port` →
 * `{ algo, fingerprint, firstSeen }` — so an existing dsh-remote installation
 * hands its trust records over without conversion on first start.
 * @module dsh-workspace-enhancement/hostkey
 */
/** Host-key policy modes (dsh-remote's TOFU triple). */
export type HostKeyMode = 'accept-new' | 'verify' | 'off';
/** Resolve the harness home: `DSH_HOME` when set, else `~/.dsh`. */
export declare function dshHome(): string;
/** Root holding the machine registry, TOFU store, and keychain secrets. */
export declare function remoteWorkspacesRoot(): string;
/** Default TOFU store location (dsh-remote's path, kept for migration). */
export declare function defaultKnownHostsFile(): string;
/** Default OS-keychain secrets directory. */
export declare function defaultSecretsDir(): string;
/** One trusted host-key record (the dsh-remote known_hosts.json entry shape). */
export interface KnownHostEntry {
    algo: string;
    fingerprint: string;
    firstSeen: string;
}
/** Trusted host-key map, keyed `host:port` (dsh-remote spelling). */
export type KnownHosts = Record<string, KnownHostEntry>;
/**
 * Extract the SSH host-key algorithm name from a raw SSH host-key blob
 * (SSH wire format: `uint32 len` + algorithm string + key data). Older ssh2
 * `{ algo, hash }` objects are accepted as a defensive fallback.
 */
export declare function blobAlgorithm(blob: unknown): string;
/**
 * SHA-256 fingerprint (base64) of an ssh2 host-key blob. Accepts both the raw
 * wire blob and the legacy `{ hash }` shape; a missing key is a hard error so
 * a contract drift surfaces instead of silently accepting the host.
 */
export declare function keyFingerprint(key: unknown): string;
/** Build a fake-but-wire-shaped host-key blob for tests:
 * `string(algo) string(32 bytes)`. */
export declare function makeKeyBlob(algo: string, seed?: number): Buffer;
/** Persisted TOFU store: load/save/forget on one known_hosts.json file. */
export declare class HostKeyStore {
    private readonly file;
    constructor(file: string);
    /** The store file path. */
    get filePath(): string;
    /** Read the whole store; an absent or corrupt file reads as empty. */
    load(): KnownHosts;
    /** One entry, or `undefined` when the host:port was never recorded. */
    get(host: string, port: number): KnownHostEntry | undefined;
    /** Atomically-enough rewrite of the store (mkdir -p first). */
    save(entries: KnownHosts): void;
    /** Remove one host:port record. Returns whether it existed. */
    forget(host: string, port: number): boolean;
}
/**
 * TOFU host-key guard bound to one store and one mode. The verifier records a
 * never-seen key under `accept-new`, rejects a changed key always, rejects an
 * unknown key under `verify`, and accepts everything under `off`.
 */
export declare class HostKeyGuard {
    private readonly store;
    private readonly mode;
    /** Last verification failure detail; a connect rewriter may surface it. */
    lastError: string | null;
    constructor(store: HostKeyStore, mode: HostKeyMode);
    /** Whether the given host:port has a stored fingerprint. */
    isKnown(host: string, port: number): boolean;
    /** Drop the stored fingerprint; the next connect re-records it. */
    forget(host: string, port: number): boolean;
    /** Build the per-host ssh2 `hostVerifier` callback for one endpoint. */
    verifier(host: string, port: number): (key: Buffer) => boolean;
}
