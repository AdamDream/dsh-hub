/**
 * dsh-workspace-enhancement — unified SSH remote-execution engine for DeepSeek
 * Harness (ported from dsh-ssh).
 *
 * One package, two mounting styles:
 * - `name: dsh-workspace-enhancement` — aggregate plugin: mounts the shared
 *   connection owner (`ctx.ssh`) plus the remote subprocess (`ctx.subprocess`)
 *   and filesystem (`ctx.fs`) providers in one row.
 * - Subpath rows (`dsh-workspace-enhancement/ssh`,
 *   `dsh-workspace-enhancement/subprocess`, `dsh-workspace-enhancement/fs`)
 *   mount each service separately, for deployments that compose providers
 *   individually.
 * @module dsh-workspace-enhancement
 */
export { SshRuntime, quoteShellArg, wrapCwd } from "./runtime.js";
export { SshSubprocessRuntime } from "./subprocess.js";
export { SshFileSystem } from "./filesystem.js";
export { SshDirectoryPicker } from "./picker.js";
export { SshRegistry, parseSshRoute, loadMachinesState, normalizeMachine } from "./registry.js";
export { parseSshTargetKey, resolveSshCwd, resolveSshTargetKey, sshTargetKey } from "./transport.js";
export { SshConnection, resolveHostKeyPolicy } from "./connection.js";
export { dshHome, remoteWorkspacesRoot, defaultKnownHostsFile, defaultSecretsDir, HostKeyStore, HostKeyGuard, blobAlgorithm, keyFingerprint, makeKeyBlob } from "./hostkey.js";
export { platformBackend, saveSecret, getSecret, deleteSecret } from "./credential.js";
export { apply } from "./plugin.js";
//# sourceMappingURL=index.js.map