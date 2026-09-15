/**
 * AUDIT-6 / ADR-0020: the remote-command approval gate — pure logic half.
 *
 * One gate sits on the mixed subprocess seam's remote branch (see
 * {@link module:dsh-workspace-enhancement/subprocess} for the wiring): before a
 * shell-shaped remote spawn (`bash -c …` / `pwsh -Command …`, after the
 * `remoteArgvOf` rewrite) or a remote `spawnTerminal` reaches SSH, the caller
 * asks the platform approval service (`ctx.approval`, `dsh-user-approval`) for
 * a decision. Per-machine mode `remoteApproval: 'off' | 'human' | 'ai'` lives
 * in machines.json (default `'off'` ⇒ zero behavior change on upgrade).
 *
 * Everything in this module is a pure function or a closure over tiny faceted
 * deps — no Cordis imports at runtime — so the whole decision surface is
 * unit-testable without a host. The plugin halves ({@link
 * module:dsh-workspace-enhancement/plugin}) only:
 *  - build {@link RemoteApprovalDeps} from `ctx` (`ctx.get('approval')` /
 *    `ctx.get('agents').currentInitiator()` / the machine registry), and
 *  - register the AI answerer (`ctx.effect(() => ctx.on('approval/request',
 *    …, { prepend: true }))`).
 *
 * Copy split (ADR-0014): the error texts below are MODEL-facing English
 * constants — they surface inside tool results via the seam's spawn-failure
 * wrapping, so they deliberately do NOT follow the UI language and do NOT live
 * in the `dsw` locale dictionary. Human-facing copy (settings form labels) is
 * in `src/locale/`.
 *
 * Deviation from ADR-0020 §3 row 10 (recorded in the round report):
 * `@deepseek-ai/dsh-user-approval` is NOT added as a devDependency — the
 * sandbox forbids `npm install` and the lockfile has no entry for it, so a
 * package.json row would desynchronize `npm ci`. The contract is consumed
 * through the structural faces below (verified byte-for-byte against the
 * 0.1.5-rc.1/rc.2 `lib/types/*.d.ts` disk sources) and the string service
 * name `'approval'`, exactly the "ctx.get by name" consumption the ADR
 * prescribes for runtime.
 * @module dsh-workspace-enhancement/remote-approval-gate
 */
import type { Context } from '@deepseek-ai/cordis';
/** Per-machine gate mode (ADR-0020 D2): default `'off'` = today's behavior. */
export type RemoteApprovalMode = 'off' | 'human' | 'ai';
/** Normalize an untrusted mode value onto {@link RemoteApprovalMode}. */
export declare function normalizeRemoteApproval(raw: unknown): RemoteApprovalMode;
/**
 * The closed approval-outcome vocabulary of `dsh-user-approval`
 * (`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`), mirrored
 * locally (see module doc for why the package is not a type dependency).
 */
export type RemoteApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
/** Stable pseudo tool name the gate asks as (presentation + audit only). */
export declare const REMOTE_EXEC_TOOL_NAME = "sw:remote-exec";
/**
 * Reason prefix that (a) lets the human answerer recognize our asks and
 * (b) anchors the AI answerer's filter — `ask` carries no tool arguments, so
 * the reason is the ONLY channel for the command preview (upstream known
 * limitation).
 */
export declare const GATE_MARKER = "[dsw-remote-gate]";
/**
 * The gate's coverage rule (ADR-0020 D1): a remote spawn is gated exactly when
 * it is shell-shaped — argv[0]'s basename ∈ {bash, sh, zsh, dash, pwsh,
 * powershell} AND an argument carries `-c` / `-Command`. Host-assembled argv
 * (remote LSP servers, probes, subagent processes) is deliberately not gated:
 * the threat surface is MODEL-authored command text, and fail-closed gating of
 * host-driven spawns outside an open turn would only cripple them.
 */
export declare function isRemoteShellShape(argv: readonly (string | undefined)[]): boolean;
/** Cap of the command preview carried in the reason (audit-friendly, short). */
export declare const COMMAND_PREVIEW_MAX_CHARS = 160;
/** Marker appended when the preview was truncated. */
export declare const COMMAND_PREVIEW_TRUNCATED = "\u2026";
/**
 * The preview is the argv joined with spaces — quoting boundaries are lost,
 * which is acceptable because every consumer (human card, AI whitelist) is
 * either display-only or refuses anything non-trivial (see {@link
 * isWhitelistedRemoteCommand}).
 */
export declare function commandPreviewOf(argv: readonly (string | undefined)[]): string;
/** Whether a preview was truncated (its invisible tail must never be trusted). */
export declare function isTruncatedPreview(preview: string): boolean;
/** The machine facts one gate reason carries. */
export interface GateReasonFacts {
    /** Registry machine id (`c1`, …). */
    machineId: string;
    /** `user@host` of the target machine. */
    target: string;
    /** Command preview (possibly truncated). */
    preview: string;
}
/**
 * Build the ask reason: `[dsw-remote-gate] machine=<id> target=<user@host>
 * cmd=<preview>`. Machine-parseable single spaces only — the preview is always
 * the tail, so spaces inside it are safe.
 */
export declare function gateReasonOf(facts: GateReasonFacts): string;
/** Strict inverse of {@link gateReasonOf}; `null` for any other reason text. */
export declare function parseGateReason(reason: string | undefined): GateReasonFacts | null;
/**
 * MODEL-facing English gate errors (ADR-0014: constants, not dictionary
 * entries). The four approval outcomes are pairwise distinguishable, mirroring
 * upstream `serviceAsk`'s "let the model tell a human denial from a missing
 * channel" design (ADR-0020 D3/D5).
 */
export declare const GATE_ERRORS: {
    /** Degradation 1: machine gated but no approval service composed. */
    readonly noApprovalService: "remote command blocked: machine {id} has the approval gate enabled but no approval service is composed in this deployment";
    /** Degradation 2: no initiating agent ⇒ no session to route/audit the ask. */
    readonly noAgent: "remote command blocked: no initiating agent could be resolved for the approval question (commands must run inside a tool call)";
    /** Outcome `rejected` (a human denial OR the `never` policy). */
    readonly rejected: "remote command rejected — the approval policy is `never` (unattended) or the answerer denied it; check /permission or disable the machine approval gate";
    /** Outcome `cancelled` (the request was withdrawn before a decision). */
    readonly cancelled: "remote command not run: the approval request was cancelled before a decision";
    /** Outcome `unavailable` (fail closed: no answerer / throwing answerer). */
    readonly unavailable: "remote command blocked: no approval answerer was available — failing closed";
    /** `request()` itself threw (typical: no open turn). */
    readonly requestFailed: "remote command blocked: the approval request failed — {detail}";
    /** Defensive: a value outside the closed outcome vocabulary. */
    readonly unexpectedOutcome: "remote command blocked: the approval service returned an unrecognized outcome ({outcome})";
};
/**
 * The gate's denial error. A distinct class so the asker can rethrow its own
 * mapped texts verbatim while wrapping upstream throws ({@link askRemoteApproval}).
 */
export declare class RemoteGateError extends Error {
    constructor(message: string);
}
/**
 * The AI answerer's auto-grant shortlist — READ-ONLY single commands only,
 * final list per ADR-0020 D4 ("实施轮定稿并独立成可评审常量").
 *
 * Matching is token-anchored on the `-c`/`-Command` payload (the preview's
 * quoting boundaries are already lost, so the matcher only ever sees a
 * whitespace-split token stream):
 *
 * | program            | allowed arguments                                   |
 * |--------------------|-----------------------------------------------------|
 * | `pwd` / `whoami`   | none                                                |
 * | `uname`            | dash flags only (`-a`, `--all`, …)                  |
 * | `ls` `cat` `head` `tail` `wc` `echo` | any (all read-only or print-only)    |
 * | `git status` / `git log` / `git diff` / `git show` | subcommand directly at argv[1] (no global git flags — `git -c …` etc. falls to the human), any arguments after |
 * | `node -v` / `node --version` | exact version flag                        |
 * | `rg --version` / `rg -V`     | exact version flag (`rg` proper is NOT allowlisted: `--pre` executes commands) |
 *
 * Not on the list is NOT a rejection — it just means the human decides.
 */
export declare const REMOTE_COMMAND_WHITELIST: Readonly<Record<string, string>>;
/**
 * The AI answerer's classifier: may this command preview be auto-granted?
 * Conservative by construction — every doubt answers `false` (the human
 * decides):
 *  - truncated previews (invisible tail) are never granted;
 *  - any shell metacharacter (incl. newline) is never granted;
 *  - only the `-c`/`-Command` payload is examined, so an interactive terminal
 *    spawn (`bash`, `bash -l`) has no payload and is never granted;
 *  - token match against {@link REMOTE_COMMAND_WHITELIST}.
 */
export declare function isWhitelistedRemoteCommand(preview: string): boolean;
/** Structural face of the platform approval service (`ctx.approval`). */
export interface RemoteApprovalServiceFace {
    request(req: RemoteApprovalRequestFace): Promise<RemoteApprovalOutcome>;
}
/**
 * One approval question. `agent` is the live initiator object obtained from
 * `agents.currentInitiator()` and handed straight to `approval.request()` —
 * an opaque conduit this module never inspects.
 */
export interface RemoteApprovalRequestFace {
    readonly agent: RemoteApprovalAgentFace;
    readonly toolName: string;
    readonly reason?: string;
    readonly signal?: AbortSignal;
}
/** Structural face of an `Agent` (identity is all the ask needs). */
export interface RemoteApprovalAgentFace {
    readonly id: unknown;
}
/** Structural face of the agent registry (`ctx.agents`) as the gate uses it. */
export interface RemoteAgentsServiceFace {
    currentInitiator(): RemoteApprovalAgentFace | undefined;
}
/** The machine facts the gate reads (registry `MachineView` satisfies this). */
export interface RemoteApprovalMachineFace {
    readonly id: string;
    readonly username: string;
    readonly host: string;
    readonly remoteApproval: RemoteApprovalMode;
}
/** The registry slice the gate/answerer read (secret-free views only). */
export interface RemoteApprovalRegistryFace {
    listMachines(): {
        machines: readonly RemoteApprovalMachineFace[];
    };
}
/** Faceted deps: everything the gate and the answerer need, injectable in tests. */
export interface RemoteApprovalDeps {
    /** The approval service, or `undefined` when not composed. */
    approval(): RemoteApprovalServiceFace | undefined;
    /** The initiating agent of this async chain, or `undefined`. */
    initiator(): RemoteApprovalAgentFace | undefined;
    /** The gated machine view, or `undefined` for an unknown target. */
    machine(id: string): RemoteApprovalMachineFace | undefined;
    /** Optional diagnostic sink (classifier exceptions; never blocks). */
    warn?(text: string): void;
}
/** One gate question: the final remote argv (post-`remoteArgvOf`) and context. */
export interface RemoteGateInput {
    /** Final remote argv of the spawn. */
    argv: readonly (string | undefined)[];
    /** Registry connection id of the route (`undefined` ⇒ no registry machine ⇒ no gate). */
    connectionId: string | undefined;
    /** Cancellation lifetime of the spawn (abort ⇒ the ask settles `cancelled`). */
    signal?: AbortSignal;
    /**
     * `spawnTerminal`: gated regardless of shell shape — an interactive shell is
     * itself an arbitrary-command entry (ADR-0020 D1).
     */
    terminal?: boolean;
}
/**
 * Ask the approval question for one remote spawn. Resolves on `'allowed-once'`;
 * throws {@link RemoteGateError} with a pairwise-distinguishable English text
 * for every other ending, including the two degradation ladder steps (missing
 * approval service, unresolvable agent) and an upstream `request()` throw
 * (typical: no open turn). All fail-closed (ADR-0020 D3).
 *
 * Shape/coverage rules:
 *  - unknown machine id, or `remoteApproval === 'off'` ⇒ no gate (pass);
 *  - non-shell-shaped spawn argv ⇒ no gate (D1's host-assembled-argv carve-out);
 *  - terminals (`terminal: true`) are always gated when the machine is.
 */
export declare function askRemoteApproval(deps: RemoteApprovalDeps, input: RemoteGateInput): Promise<void>;
/** The `approval/request` listener face (loose `this`: scope dispatch binds it). */
export type RemoteApprovalAnswerer = (this: unknown, req: {
    reason?: string;
}, next: () => Promise<RemoteApprovalOutcome>) => Promise<RemoteApprovalOutcome>;
/**
 * The AI answerer (ADR-0020 D4): a `prepend`-registered `approval/request`
 * waterfall listener that auto-grants ONLY
 *  - requests carrying our {@link GATE_MARKER} reason, for
 *  - machines whose `remoteApproval` is `'ai'`, with
 *  - a preview the {@link REMOTE_COMMAND_WHITELIST} classifier grants.
 *
 * Everything else — other tools' asks (`[dsw-remote-gate]`-less reasons),
 * `'human'` machines, unknown machines, non-granted commands — delegates via
 * `next()` unchanged. Failure semantics are an implementation red line: the
 * classification runs inside a full try/catch and ANY exception still
 * delegates (never grants on AI failure, never throws — a throwing listener
 * would collapse the whole waterfall to `'unavailable'` and starve the human
 * answerer). `next()` itself is called OUTSIDE the catch so a failure in the
 * rest of the chain stays the chain's own, exactly once.
 */
export declare function createRemoteApprovalAnswerer(deps: RemoteApprovalDeps): RemoteApprovalAnswerer;
/**
 * The gate closure the subprocess engine awaits. Built from live `ctx` deps:
 * services resolve by name at call time (optional, never injected), machines
 * via the secret-free `sshRegistry.listMachines()` view.
 */
export type RemoteSpawnGate = (input: RemoteGateInput) => Promise<void>;
/** Build {@link RemoteApprovalDeps} from a live Cordis context. */
export declare function remoteApprovalDepsOf(ctx: Context): RemoteApprovalDeps;
/** The asker-side gate for one context (engines await it before remote exec). */
export declare function createRemoteSpawnGate(ctx: Context): RemoteSpawnGate;
/**
 * Register the AI answerer on `approval/request` — `prepend` so it sees our
 * marked asks before the human UI answerer, effect-bound so an unloaded row
 * removes the listener (remounting registers a fresh listener; event
 * registrations are fiber-scoped and never throw "already registered").
 */
export declare function registerRemoteApprovalAnswerer(ctx: Context): void;
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * Local declaration of the `dsh-user-approval` answerer waterfall (that
         * package is not a type dependency of this repo — see module doc). The
         * host's own, richer augmentation (`Scoped<Agent>` `this`, full
         * `ApprovalRequestEvent`) applies wherever the real service is composed;
         * this loose mirror only lets this repo register/typecheck the listener.
         * @mode waterfall
         */
        'approval/request'(this: unknown, req: {
            reason?: string;
        }, next: () => Promise<RemoteApprovalOutcome>): Promise<RemoteApprovalOutcome>;
    }
}
