/**
 * Machine-form payload builder of the settings page, extracted as a pure
 * function so the keychain↔plaintext backend switching rules are unit-testable
 * without mounting the React component (5.11-b).
 * @module dsh-workspace-enhancement/client/machine-payload
 */
/** One ProxyJump hop as the shared MachineForm assembles it. */
export interface PayloadJump {
    host: string;
    port?: number;
    username?: string;
}
/** Form state (password/passphrase live in memory only, never echoed). */
export interface MachineFormState {
    id: string;
    name: string;
    host: string;
    port: string;
    username: string;
    password: string;
    privateKeyPath: string;
    passphrase: string;
    workspace: string;
    hostKeyMode: '' | 'accept-new' | 'verify' | 'off';
    encryptPassword: boolean;
}
/** Cleared form state. */
export declare const EMPTY_MACHINE_FORM: MachineFormState;
/**
 * Build the `machines.add`/`machines.test` payload from the form state.
 *
 * 5.11-b: the host's backend resolution keeps the previous machine backend when
 * the payload carries neither `credentialBackend` nor `encryptPassword`, so
 * unchecking the keychain toggle and typing a NEW password alone would leave a
 * keychain machine keychain-backed. An explicit `credentialBackend: 'plain'`
 * opts it back into plaintext. With no new password the payload stays silent
 * (the machine keeps its current backend — no accidental switch).
 *
 * P2-④: `privateKeyPath` follows the 密码 convention — 编辑时留空 = 保持不变.
 * The machine view is secret-free (the form never sees the stored key path),
 * so an EDIT payload with an empty field must OMIT the key entirely
 * (undefined = the host keeps the stored value); a NEW machine sends the
 * trimmed value even when empty ('' = 未配置). A non-empty path is always
 * sent (a typed replacement applies to both new and edited machines).
 *
 * t8: `jump` follows the same wire contract — undefined OMITS the chain (the
 * host keeps the stored one), an EXPLICIT array (even empty) replaces it, so
 * `[]` is the "clear the chain" signal an edit needs (a cleared jump text
 * would otherwise silently keep the old chain). The caller decides which
 * state applies (see {@link jumpChainOf} in machine-form.tsx).
 * @param form - the current form state.
 * @param jump - the parsed ProxyJump chain: `[]` = clear an edited machine's
 *   chain; undefined = omit (unchanged/new); non-empty = replace.
 * @returns the wire payload.
 */
export declare function machinePayload(form: MachineFormState, jump?: readonly PayloadJump[]): Record<string, unknown>;
