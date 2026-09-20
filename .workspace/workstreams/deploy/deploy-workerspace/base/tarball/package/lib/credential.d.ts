/**
 * Optional OS-keychain password storage — ported from dsh-remote
 * (`lib/credential.js`). Machines keep their password in the OS credential
 * store instead of the plaintext machines.json when the operator asked to
 * encrypt it per machine.
 *
 * Every backend is best-effort: any failure resolves to `{ ok: false }` and the
 * caller falls back to plaintext — the feature must never block connecting.
 *
 * Backends:
 *   darwin  → `security` (login keychain, generic password)
 *   win32   → DPAPI via PowerShell (CurrentUser scope), files under
 *             `$DSH_HOME/remote-workspaces/.secrets/`
 *   linux   → `secret-tool` (libsecret / gnome-keyring), optional
 *   else    → unsupported (plain)
 * @module dsh-workspace-enhancement/credential
 */
/** Per-machine credential storage backend. */
export type CredentialBackend = 'plain' | 'keychain' | 'windows' | 'secret';
/** The backend the current platform should use when encryption is requested. */
export declare function platformBackend(): CredentialBackend;
/**
 * Save a password to the OS store. Resolves `{ ok, backend }`; `ok: false` on
 * any failure (the caller falls back to plaintext).
 */
export declare function saveSecret(machineId: string, password: string, secretsDir: string): Promise<{
    ok: boolean;
    backend: CredentialBackend;
}>;
/** Fetch a stored password. Resolves the password string, or `null`. */
export declare function getSecret(machineId: string, secretsDir: string): Promise<string | null>;
/** Delete a stored password (idempotent). */
export declare function deleteSecret(machineId: string, secretsDir: string): Promise<void>;
