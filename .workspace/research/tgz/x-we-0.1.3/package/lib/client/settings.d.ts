/**
 * Minimal remote-machine management settings page (machine registry edition):
 * machine list (edit / delete / set current / forget host key) plus the shared
 * {@link MachineForm} (mode="settings") — one form component with the flow's
 * add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
 * audit / update sections — those belong to dsh-remote only and are
 * deliberately not ported.
 *
 * All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget);
 * all styles are inline.
 * @module dsh-workspace-enhancement/settings
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WireResult } from './index.ts';
import type { MachineSaveView } from './machine-form.tsx';
/** The `/dsw` RPC face injected by the client plugin. */
export interface SettingsInjected {
    rpc(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<WireResult>;
    /** Typed translate seat (slot-injected once the registration declares `locale`). */
    t?: TranslateNS<'dsw'>;
}
/** Owner share of a `settings.section` entry (the shell supplies `close`). */
export interface SettingsOwnerProps {
    close(): void;
}
/**
 * F2: the durable save acknowledgment. The machine form's success text cannot
 * persist — the form remounts when `key={editing?.id}` changes and any in-form
 * feedback vanishes with it — so the settings page owns the banner. The
 * honest fallback marker (encryption requested, OS backend failed) rides
 * along as pure text (no live data; a `MachineSaveView` leaf).
 */
export declare function savedBanner(view: MachineSaveView, t?: TranslateNS<'dsw'>): string;
/** The registers page component: machine list + shared form. */
export declare function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }: SettingsInjected & Partial<SettingsOwnerProps>): ReactNode;
export default RemoteWorkspaceSettingsPage;
