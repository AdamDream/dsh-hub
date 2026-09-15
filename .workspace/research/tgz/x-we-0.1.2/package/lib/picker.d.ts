/**
 * Directory-picker browse backend over the dsh-workspace-enhancement SSH
 * connection: the web GUI's "Select Workspace Directory" dialog — the
 * add-workspace flow — browses the remote host through the shared SFTP
 * channel, and picked remote paths become workspace paths the plugin's
 * providers already understand.
 *
 * Behavior facts:
 * - On a Windows host the picker is dual-root: local listings keep the
 *   drive-qualified paths of the host account (so the existing local browsing
 *   is unchanged), the remote host appears as one pinned entry on the local
 *   home level, and every POSIX-absolute path addresses the remote host —
 *   the same routing rule as {@link SshRuntime.resolveRemoteCwd}.
 * - On a POSIX host every absolute path addresses the remote host, so the
 *   picker is remote-only (the local filesystem is unreachable through it;
 *   it would share the remote path vocabulary).
 * - Remote listings return directories only, name-sorted, symlinks to
 *   directories followed, `hidden` means dot-prefixed, and one level is
 *   bounded at `maxEntries` rows with `truncated` flagging a cut. The remote
 *   level walk is shared with the `/dsw` browse channel
 *   ({@link module:dsh-workspace-enhancement/listing}).
 * - `createDirectory` is non-recursive SFTP mkdir with an existence probe.
 *
 * Mount as its own row (`dsh-workspace-enhancement/picker`): the
 * directory-picker seam registers one implementation per context, so this row
 * must REPLACE the deployment's existing `directory-picker` row (the web
 * bundle's `@deepseek-ai/dsh-host-directory-picker-auto`), not sit beside it,
 * and the shipped in-app browser surface
 * (`@deepseek-ai/dsh-client-ui-directory-picker-browse`) must be composed
 * separately because replacing `-auto` drops the surface it mounted.
 * @module dsh-workspace-enhancement/picker
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker';
import type { DirectoryListing, DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker';
/** Configuration for the directory-picker browse backend. */
export interface Config {
    /**
     * Complete-result bound for one remote or local level: at most this many
     * child-directory rows (hidden rows count toward the bound), with
     * `truncated` flagging a cut level. Defaults to 1000, the bound GitHub's
     * web UI applies to directory listings.
     */
    maxEntries?: number;
    /**
     * Name of the pinned remote-host entry shown on the local home level
     * (Windows hosts only). Defaults to `Remote host <username>@<host>`.
     */
    remoteLabel?: string;
    /**
     * Name of the pinned local-host entry shown on the remote home level
     * (Windows hosts only). Defaults to `Local host`.
     */
    localLabel?: string;
}
/** Directory-picker browse backend registered as `ctx.directoryPicker`. */
export declare class SshDirectoryPicker extends DirectoryPicker {
    static inject: string[];
    static Config: z<Config>;
    private readonly config;
    private readonly localHome;
    /**
     * The cached remote-home resolution, established lazily on the FIRST use
     * (never at mount time). Success is cached; a failure resets the cache so
     * the next browse retries — an eager resolve made the picker's construction
     * attempt a connection against the placeholder `ssh-remote` row, which
     * failed at load and killed the whole bundle.
     */
    private remoteHomePromise;
    private readonly browseCapability;
    constructor(ctx: Context, config: Config);
    /**
     * Resolve the remote home lazily: the first browse establishes the
     * connection — a dead placeholder row surfaces its error at browse time
     * (R1: transmit connection failures, never mask them), success is cached
     * for the service lifetime, and a failure is dropped so the next browse
     * retries.
     * @param signal - caller lifetime of the triggering browse.
     * @returns the remote home path.
     */
    private resolveRemoteHome;
    /** The browse interaction capability (stable for the service lifetime). */
    capability(): DirectoryPickerCapability;
    /**
     * List one directory level.
     * @param path - absolute directory to list; absent lists the local home on
     *   Windows hosts (the add-workspace dialog opens on the local machine) and
     *   the remote home elsewhere.
     * @param signal - caller lifetime; abort stops the scan and rejects.
     * @returns the level's listing with ancestry.
     */
    list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>;
    /**
     * Create one child directory under an existing parent.
     * @param path - absolute existing parent directory.
     * @param name - single non-blank path segment (no separators, not `.`/`..`).
     * @returns the created directory's absolute path.
     */
    createDirectory(path: string, name: string): Promise<string>;
    /** Whether the host platform keeps a reachable local filesystem beside the remote one. */
    private get dualMode();
    /** Whether `path` addresses the local filesystem (Windows hosts only). */
    private isLocalPath;
    /** The pinned remote entry's display name. */
    private remoteEntryLabel;
    /** The pinned local entry's display name. */
    private localEntryLabel;
    /** List one remote level through the shared {@link listRemoteLevel} walk. */
    private listRemote;
    /** List one local level over the host filesystem (Windows hosts only). */
    private listLocal;
    /** Create one child directory on the remote host (SFTP mkdir, non-recursive). */
    private createRemoteDirectory;
    /** Create one child directory on the local filesystem (Windows hosts only). */
    private createLocalDirectory;
}
export default SshDirectoryPicker;
