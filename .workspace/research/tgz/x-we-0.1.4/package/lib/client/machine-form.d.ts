/**
 * The shared machine/connection form (R2 表单并集): the union of the settings
 * page「添加服务器」form and the add-workspace flow's「新建连接」form — one
 * component, one field set, one interaction set; only the submit action
 * differs by `mode`.
 *
 * Union surface (docs/ui-merge-design.md §2): 主机名/别名（失焦/粘贴自动解析 +
 * 「识别 ssh 配置 ▾」精确别名下拉）、端口、用户名（预填 root）、名称（默认
 * user@host，留空由宿主回退）、默认工作区、认证 tabs（私钥文件/密码；切换
 * 不清空对方）、私钥路径（编辑留空=保持不变，P2-④）、私钥口令、密码（编辑
 * 留空=不变）、高级折叠区（加密保存密码 checkbox——认证=密码时显示；HostKey
 * 模式 select；跳板链文本 + 实时校验摘要 + 清除 + 提交时坏段阻止保存，P2-②）、
 * 测试连接（loading + 结果）、保存（同步 busy 守卫防双击双发，P2-③）。
 *
 * `mode='settings'`：保存后清空表单 + 成功提示（banner 保留）；`mode='flow'`：
 * 保存按钮文案「保存并浏览」，成功后通过 `onSaved(view)` 交给外壳切换目录浏览。
 * Payload 唯一出口是 {@link module:dsh-workspace-enhancement/client/machine-payload}
 * 的 machinePayload（含跳板链）；测试连接走 machines.test；服务端零改动。
 * 全部样式内联、中文标签；无新依赖。
 * @module dsh-workspace-enhancement/client/machine-form
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { RpcCall } from './status.tsx';
import type { RemoteApprovalMode, RemoteSandboxMode } from './machine-payload.ts';
/** One manual or resolved ProxyJump hop. */
export interface JumpInput {
    host: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    agent?: string;
}
/** The Host's `~/.ssh/config` resolution result (wire shape of `connections.resolve`). */
export interface ResolvedSshConfigView {
    host: string;
    username: string;
    port: number;
    privateKeyPaths: string[];
    jump: JumpInput[];
    alias: string;
}
/** One `~/.ssh/config` Host alias row (`config.hosts`). */
export interface ConfigHostView {
    alias: string;
    host: string;
    username: string;
    port: number;
    identityFile: boolean;
    jump: boolean;
}
/** Prefilled form state (settings edit / flow config-host draft). */
export interface MachineFormInitial {
    id?: string;
    name?: string;
    host?: string;
    port?: string;
    username?: string;
    privateKeyPath?: string;
    passphrase?: string;
    workspace?: string;
    hostKeyMode?: '' | 'accept-new' | 'verify' | 'off';
    /** AUDIT-6 approval-gate mode (edit prefills the stored value). */
    remoteApproval?: RemoteApprovalMode;
    /** REQ-I9 remote sandbox fence mode (edit prefills the stored value). */
    remoteSandbox?: RemoteSandboxMode;
    encryptPassword?: boolean;
    jumpText?: string;
    /** Preferred auth tab ('password' when the machine records password auth). */
    auth?: 'password' | 'key';
    /** Focus the username field on open (config host missing its user). */
    focusUsername?: boolean;
}
/** The saved machine's minimal view handed back to the shell. */
export interface MachineSaveView {
    id: string;
    label: string;
    host: string;
    port: number;
    username: string;
    /** Encryption was requested but fell back to plaintext (honest marker). */
    encryptFallback?: boolean;
}
/** The shell's `/dsw` RPC face (same channel shape as the flow/settings inject). */
export type MachineFormRpc = RpcCall;
export interface MachineFormProps {
    mode: 'settings' | 'flow';
    rpc: MachineFormRpc;
    initial?: MachineFormInitial | undefined;
    /** Typed translate seat (threaded by the shells; defaults to the zh baseline). */
    t?: TranslateNS<'dsw'>;
    /** Save succeeded (the view's id drives the flow's browse switch / list refresh). */
    onSaved(view: MachineSaveView): void;
    /** Flow: the surrounding modal also offers 取消. */
    onCancel?: (() => void) | undefined;
}
type BusyTask = 'config' | 'resolve' | 'test' | 'save' | null;
/** Parse a `[user@]host[:port]` jump list (comma/space separated). */
export declare function parseJumpText(text: string): JumpInput[];
/** Render one resolved hop as `user@host:port` (defaults hidden). */
export declare function formatHop(hop: JumpInput): string;
/** Realtime jump summary: `3 · user@b1 → host:2202`, or the bad-input hint. */
export declare function jumpSummaryOf(text: string, t?: TranslateNS<'dsw'>): string;
/**
 * P2-②: submit-time jump validation. A non-empty jump text that cannot be
 * parsed into hosts is a hard error — the payload must never silently drop
 * the chain (the old code sent no `jump` when a segment was malformed while
 * the summary already warned). Returns the error text, or null when the jump
 * is absent or fully parseable.
 */
export declare function jumpErrorOf(text: string, t?: TranslateNS<'dsw'>): string | null;
/**
 * t8: the jump chain to put on the wire. A non-empty text parses to its hops.
 * An EMPTY text during an EDIT whose machine HAD a jump chain (the
 * secret-free initial knows only its `jumpText`) yields `[]` — the explicit
 * clear, because an omitted chain keeps the stored one and the operator must
 * be able to REMOVE the chain. A new machine, or an edit of one that never
 * had a chain, yields undefined (omit = no jump). The wire builder
 * (machinePayload) serializes `[]` as-is.
 */
export declare function jumpChainOf(text: string, isEdit: boolean, hadJumpText: string | undefined): JumpInput[] | undefined;
/**
 * P2-③: synchronous busy gate. `busy` state turns the buttons `disabled` only
 * after a re-render, so two clicks in one tick both pass the `disabled` check
 * and double-send; the gate flips synchronously on claim and clears in
 * `finally`, which closes that window. Only the current owner may release, so
 * an overlapping operation (resolve/test/save) can never clear another one's
 * busy state — the old code let a late resolve's `finally` re-enable the
 * buttons while a save was still in flight.
 */
export declare function createActionGate(): {
    /** Whether any action currently owns the form (sync — no re-render needed). */
    busy(): boolean;
    /** Claim the form; false when another action owns it. */
    claim(task: Exclude<BusyTask, null>): boolean;
    /** Release the form when this task still owns it; false otherwise. */
    release(task: Exclude<BusyTask, null>): boolean;
};
/** The one-line resolve summary: alias → user@host:port · identity · jumps. */
export declare function formatResolvedSummary(resolved: ResolvedSshConfigView, t?: TranslateNS<'dsw'>): string;
/** Structural check of one machine save result (`machines.add`/`saveMachine`). */
export declare function asSaveView(value: unknown): MachineSaveView | null;
/** The shared form body: fields + feedback + actions (no modal shell). */
export declare function MachineForm({ mode, rpc, initial, onSaved, onCancel, t: tSeat }: MachineFormProps): ReactNode;
export {};
