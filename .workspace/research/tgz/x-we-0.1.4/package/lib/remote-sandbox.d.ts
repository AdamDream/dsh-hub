/**
 * REQ-I9 / ADR-0022: the remote sandbox fence — pure logic half.
 *
 * A per-machine axis `remoteSandbox: 'off' | 'read-only' | 'workspace-write'`
 * (default `'off'` ⇒ zero migration) asks the mixed subprocess seam's remote
 * branch to wrap every spawned command as
 * `<runner> <bwrap profile args> -- <original argv>` before it is serialised
 * into the single SSH exec string. This module owns the whole *decision* and
 * *shape* surface of that wrap; the wiring (the `resolveArgv` startup stage of
 * `SshSubprocessHandle`, the registry field, the settings form) lives in the
 * other halves and is deliberately absent here, so everything below is
 * unit-testable without a host — the same split AUDIT-6 uses (ADR-0014, and
 * see {@link module:dsh-workspace-enhancement/remote-approval-gate}).
 *
 * ## Provenance of the profile vector (this is the drift risk)
 *
 * The tokens below are a LOCAL RE-DERIVATION of `bwrapProfileArgs(policy)` from
 * the deployed upstream provider `@deepseek-ai/dsh-sandbox-local` (read on
 * 2026-09-13 from `…/profiles/node_modules/@deepseek-ai/dsh-sandbox-local/lib/
 * index.js`, bundle region `lib/types/profiles.js`, version `0.1.5-rc.2`; see
 * `.tmp/recon/A3-remote-runner.md` §Q1(c)). It cannot be imported:
 *
 *  - `bwrapProfileArgs` is **not exported** (the package's `exports` map has
 *    only `.`, `./src/*` and `./package.json`), and
 *  - `@deepseek-ai/dsh-sandbox-local` is **not a dependency of this repo** and
 *    has no `package-lock.json` entry — adding one would desynchronise `npm ci`
 *    (the same hazard recorded for `dsh-user-approval` in the R22 report).
 *
 * The re-derivation is pinned by `test/remote-sandbox-drift.test.ts`, which
 * reads that deployed file when it exists on the machine and asserts the token
 * arrays match; on a machine without it (CI) that test reports SKIP instead of
 * failing. Upstream changing the profile is therefore a visible red on the
 * machine that has the package, never a silent divergence.
 *
 * ## Fail-closed rules encoded here (ADR-0022 §2.3)
 *
 * The fence's failure mode is "refuse", never "run it anyway":
 *
 *  - a mode other than `'off'` without a *positive* probe verdict must be
 *    refused by the wiring ({@link REMOTE_SANDBOX_UNAVAILABLE}, and
 *    {@link REMOTE_SANDBOX_MESSAGES} carries the texts);
 *  - `workspace-write` without a usable absolute remote workspace root throws
 *    here, at argv-construction time, rather than degrading to `read-only`
 *    (a silent downgrade would be a lie: the user asked for a writable
 *    workspace and would get a command that cannot write);
 *  - the probe is **functional** — {@link buildRemoteProbeCommand} runs the
 *    real `read-only` profile around `true` and requires exit 0. A missing
 *    remote `bwrap` reports `env: 'bwrap': No such file or directory` (exit
 *    127) — which does NOT match upstream's `RUNNER_FAILURE_RULES.bwrap`
 *    (`'bwrap: '`), so post-hoc stderr matching cannot carry the remote case
 *    and is **not** the mechanism (A3 §Q2 finding 1).
 *
 * ## Honest boundaries (ADR-0022 §2.7)
 *
 *  - **The fs/SFTP write face is not fenced.** It travels the host-side SFTP
 *    channel and never becomes a remote process, so bwrap cannot confine it;
 *    the remote OS user's permissions are the only real bound there. This is
 *    reported truthfully by {@link remoteSandboxFactsOf}.
 *  - The profile is **file effects only**: no network namespace, no
 *    `--clearenv`, no `--chdir`, no syscall filtering, no process visibility
 *    outside the PID namespace.
 *  - {@link REMOTE_DENIAL_SIGNATURES} is an in-band STDERR dialect with no
 *    typed denial channel: **second-line evidence for reporting only, never
 *    enforcement.** Enforcement is the wrapped argv plus the probe.
 *
 * @module dsh-workspace-enhancement/remote-sandbox
 */
/**
 * Per-machine fence mode (ADR-0022 D1). This is an axis of its own and is NOT
 * a mirror of `ctx.sandboxPolicy`: remote sessions pin the session sandbox
 * mode to `danger-full-access` (`forceRemoteSandboxMode`) so that
 * `dsh-bash-sandbox` does not inject a LOCAL runner into a REMOTE command; the
 * remote mode axis therefore has to live in this plugin (ADR-0022 §2.1/D9).
 */
export type RemoteSandboxMode = 'off' | 'read-only' | 'workspace-write';
/** The subset of {@link RemoteSandboxMode} that actually builds a profile. */
export type RemoteSandboxConfinementMode = Exclude<RemoteSandboxMode, 'off'>;
/**
 * Normalize an untrusted mode value onto {@link RemoteSandboxMode}. Missing,
 * `undefined`, `null`, a wrong type, a wrong string, and even a
 * correctly-spelled-but-miscased value all normalize to `'off'` — the same
 * strictness as `normalizeRemoteApproval`, so an upgrade changes nothing until
 * a machine explicitly opts in.
 *
 * @param raw - any value read from a machine record, RPC payload or form.
 * @returns the mode to use; never throws.
 */
export declare function normalizeRemoteSandbox(raw: unknown): RemoteSandboxMode;
/** Whether this mode asks for a fence at all (the default of `'off'`). */
export declare function isRemoteSandboxEnabled(mode: RemoteSandboxMode): boolean;
/**
 * One file-effect policy, mirroring upstream `SandboxPolicy`'s shape as the
 * bwrap profile builder reads it (mode + workspace root).
 */
export interface RemoteSandboxPolicy {
    /** `'read-only'` or `'workspace-write'` (never `'off'` — no profile then). */
    mode: RemoteSandboxConfinementMode;
    /**
     * Absolute POSIX path bound read-write in `workspace-write` mode. Required
     * there and unused in `read-only` mode. Taken from the remote cwd of the
     * spawn, matching `sw_exec`'s workdir semantics (ADR-0022 §2.5).
     */
    workspaceRoot?: string;
}
/**
 * The `read-only` profile vector, byte-for-byte the tokens upstream
 * `bwrapProfileArgs({mode:'read-only'})` emits (see the module doc for
 * provenance): a read-only bind of the whole filesystem, a fresh `/dev`, a
 * private PID namespace, a `/proc` mount, and `--die-with-parent`.
 *
 * Deliberately absent (and they must not be "helpfully" added): `--unshare-net`
 * / `--unshare-all`, `--clearenv`, `--chdir`, `--new-session`, seccomp. The
 * vocabulary is file effects only, and the command's cwd/env are passed
 * through by the seam's own `cd -- … && exec env -i …` serialisation.
 */
export declare const REMOTE_BWRAP_PROFILE_READ_ONLY: readonly string[];
/**
 * The extra tokens `workspace-write` appends after the read-only prefix: a
 * fresh writable `/tmp`, then a read-write bind of the workspace root. Order
 * matters (upstream pushes `--tmpfs` first) and is pinned by the tests.
 */
export declare const REMOTE_BWRAP_PROFILE_WRITE_EXTRA: readonly string[];
/** The literal the reporting shape shows in place of a per-spawn workspace root. */
export declare const WORKSPACE_ROOT_PLACEHOLDER = "<workspace-root>";
/**
 * Whether one candidate is usable as a `--bind` source for the remote fence:
 * a non-empty, NUL-free, newline-free, `/`-rooted POSIX path. A relative path
 * is rejected because the profile is evaluated by the remote shell inside the
 * spawn's cwd — the same string would mean different mounts on different hosts.
 *
 * This is a shape guard, not a security boundary (the result still goes through
 * {@link quoteShellArg} when it reaches a shell); it exists so a `--bind` can
 * never be built from junk that would make bwrap fail with a confusing message.
 *
 * @param value - candidate remote path from the registry/route.
 */
export declare function isUsableRemoteWorkspaceRoot(value: unknown): value is string;
/**
 * Resolve the first usable candidate as the remote workspace root, else
 * `undefined`. The wiring calls this with the remote cwd candidates of one
 * spawn; the fence then throws
 * {@link REMOTE_SANDBOX_UNAVAILABLE} rather than running unwritable.
 *
 * @param candidates - remote path candidates in priority order.
 */
export declare function resolveRemoteWorkspaceRoot(...candidates: readonly (string | undefined)[]): string | undefined;
/**
 * Resolve the runner path from a machine record: a usable absolute path, or the
 * bare default. A non-absolute value cannot be honoured (the remote login shell
 * would resolve it against a `PATH` the plugin does not control), so it falls
 * back to `bwrap` — which the probe then either resolves or fails closed on.
 *
 * Note the shared shape guard: `..` segments are NOT rejected, because a
 * workspace routinely reaches its root through them; the value is quoted when
 * it reaches the shell and a wrong path fails the probe (never silently).
 *
 * @param raw - untrusted runner value (a machine-record field).
 * @param fallback - the runner to assume; defaults to
 *   {@link DEFAULT_REMOTE_RUNNER_PATH}.
 */
export declare function resolveRemoteRunnerPath(raw: unknown, fallback?: string): string;
/**
 * Build the bwrap profile vector for one policy — the local re-derivation of
 * upstream `bwrapProfileArgs(policy)` documented in the module docstring.
 *
 *  - `read-only` ⇒ {@link REMOTE_BWRAP_PROFILE_READ_ONLY};
 *  - `workspace-write` ⇒ that prefix, `--tmpfs /tmp`, then
 *    `--bind <root> <root>`.
 *
 * @param policy - the confinement mode and, for `workspace-write`, the remote
 *   workspace root.
 * @returns a fresh mutable token array (callers may concat it freely).
 * @throws {RemoteSandboxPolicyError} when `workspace-write` has no usable root
 *   — fail closed instead of silently degrading to a read-only fence.
 */
export declare function remoteProfileArgs(policy: RemoteSandboxPolicy): string[];
/**
 * Wrap one remote argv as `<runnerPath> <profile args> -- <original argv>`.
 *
 * Shape guarantees the wiring and the approval gate depend on:
 *  - the ORIGINAL argv is preserved verbatim after the `--` terminator, in
 *    order, with nothing inserted into it (the `--` is bwrap's own
 *    end-of-options separator, so an original argv token that begins with `-`
 *    cannot be mistaken for a runner flag);
 *  - `argv[0]` of the result is the runner, exactly like upstream
 *    `ConfinedArgv.argv` (A3 §Q1a);
 *  - the result is executed by the seam's existing serialiser
 *    (`spec.argv.map(quoteShellArg).join(' ')`, `src/process.ts`
 *    `buildCommand`), so every token — including the workspace root — is
 *    POSIX single-quote escaped at the single place that already does it
 *    (AGENTS.md §5.6). This function therefore performs NO quoting itself and
 *    must never be handed to a shell directly.
 *
 * @param argv - the final remote argv, BEFORE any wrapping (the approval gate
 *   keeps seeing this one, ADR-0022 §2.2).
 * @param policy - the confinement mode + workspace root.
 * @param runnerPath - remote runner program (`bwrap`, or an explicit path).
 * @throws {RemoteSandboxPolicyError} (via {@link remoteProfileArgs}) when
 *   `workspace-write` has no usable workspace root.
 */
export declare function remoteRunnerArgv(argv: readonly string[], policy: RemoteSandboxPolicy, runnerPath: string): string[];
/**
 * The runner program the fence assumes when a machine does not name one. The
 * upstream provider also defaults to the bare name `bwrap` and resolves it
 * through the remote login shell's `PATH`.
 */
export declare const DEFAULT_REMOTE_RUNNER_PATH = "bwrap";
/**
 * Build the POSITIVE functional probe command (ADR-0022 §2.3, A3 §Q4).
 *
 * It is run through the transport's **control channel** (`connection.exec`),
 * exactly like the existing fixed probes (`uname -s`, `cmd /c ver`) — its text
 * is a plugin constant, which is the same carve-out ADR-0020 D1 grants those
 * probes; it is NOT routed through the sandboxed spawn seam.
 *
 * One login shell, four steps:
 *  1. `command -v '<runner>'` — is it resolvable at all (this answers the
 *     "installed" question only, which is explicitly NOT sufficient);
 *  2. `'<runner>' --version` — the version/health fact, tolerated to fail;
 *  3. `'<runner>' <read-only profile> -- true` — the functional check: the
 *     REAL profile around `true`, which is what upstream `defaultProbeBwrap`
 *     does. This is the step that separates "present" from "usable" (no
 *     unprivileged user namespaces, seccomp/AppArmor blocking
 *     `clone(CLONE_NEWUSER)`, a denied `--proc`, …). It must exit 0.
 *
 * Exit status is the LAST step's: a runnable runner that cannot confine exits
 * non-zero. Deliberately NOT done: redirecting that failure to stderr. sshd
 * folds stderr into the channel's extended-data stream but `ExecOutcome`
 * collects it separately from stdout, and a channel dropped mid-flight can
 * lose it — the exit code is the part that cannot be lost. The explanatory
 * text is present when it survives, and {@link parseRemoteProbe} says so when
 * it did not.
 *
 * Injection posture: the only caller-supplied value is `runnerPath`, and it is
 * quoted with the repo's POSIX quoting helper at every one of its three
 * occurrences — no interpolation path reaches the shell unquoted. The profile
 * and `command -v`/`--version`/`true` are fixed tokens. The `--` terminator
 * keeps the runner from reading `--ro-bind` as its own option.
 *
 * **The functional step quotes each argv WORD SEPARATELY, never the joined
 * vector.** Joining first and quoting the result hands the shell ONE word, so a
 * perfectly healthy host tries to exec a program literally named
 * `bwrap --ro-bind / / … -- true` and exits 127 — and because every non-zero
 * exit reads as "runner unusable", fail-closed turns that into a fence that
 * refuses every command on every host, forever. `test/remote-sandbox.test.ts`
 * tokenizes this step back into the runner argv precisely so the two cannot
 * drift apart again (self-reviewer catch, 2026-09-13).
 *
 * @param runnerPath - remote runner program; defaults to
 *   {@link DEFAULT_REMOTE_RUNNER_PATH}.
 * @returns one POSIX shell command string requiring exit 0 for a usable fence.
 */
export declare function buildRemoteProbeCommand(runnerPath?: string): string;
/** What one probe round-trip reported. */
export interface RemoteProbeOutcome {
    /** Exit code of the probe command; `null` when it died from a signal. */
    exitCode: number | null;
    /** Collected standard output. */
    stdout: string;
    /** Collected standard error. */
    stderr: string;
    /** Terminating signal, when the transport reports one (`ExecOutcome` has it). */
    signal?: string | null;
}
/** The verdict of {@link parseRemoteProbe}. */
export interface RemoteProbeVerdict {
    /** `true` ONLY on exit 0 — the runnable verdict. Everything else fails closed. */
    ok: boolean;
    /** The runner's version text, when it was readable. */
    version?: string;
    /** Diagnostic detail (never a success signal; display/audit only). */
    detail?: string;
}
/** Cap of the diagnostic detail a verdict carries (audit-friendly, short). */
export declare const REMOTE_PROBE_DETAIL_MAX_CHARS = 240;
/**
 * Parse one probe round-trip into a verdict. **Exit status is the only success
 * signal** — output is never trusted to say "usable" (a page of help text on a
 * non-zero exit is still a failure). Fail-closed in every direction:
 *
 * | outcome                      | verdict                       |
 * |------------------------------|-------------------------------|
 * | `exitCode === 0`             | `ok` (+ `version` if readable) |
 * | non-zero exit, any output    | `!ok`, `detail` from stderr, else stdout |
 * | `exitCode === null` (signal) | `!ok`, detail names the signal/death |
 * | empty output on failure      | `!ok` with an explicit "no diagnostic" note |
 *
 * A readable `version` is attached to a FAILING verdict too — "bwrap 0.8.0 is
 * installed but cannot create a namespace" is exactly the fact an operator
 * needs. The version is read from stderr first on a non-zero exit (bwrap
 * diagnoses on stderr), so an unrelated version-shaped token on stdout cannot
 * masquerade as the runner's version.
 *
 * @param outcome - the control-channel result for
 *   {@link buildRemoteProbeCommand}.
 */
export declare function parseRemoteProbe(outcome: RemoteProbeOutcome): RemoteProbeVerdict;
/**
 * The version stdout/stderr reported for the runner, if readable. bwrap's own
 * wording wins; a lone semver token in output that did not match it is
 * accepted as a fallback because stdout and stderr share one exec channel and
 * can interleave. Returns `undefined` rather than a guess.
 */
export declare function remoteRunnerVersionOf(stdout: string, stderr: string): string | undefined;
/** A cached probe verdict, keyed by the identity of the connection it probed. */
export interface RemoteSandboxCache {
    /** The verdict for this exact connection object, or `undefined`. */
    get(connection: unknown): RemoteProbeVerdict | undefined;
    /** Record a verdict for this exact connection object. */
    set(connection: unknown, verdict: RemoteProbeVerdict): void;
}
/**
 * Create a process-local probe cache. Keyed by connection **object identity**
 * (not by id), so a rebuilt connection re-probes — the `createRemoteOsCache`
 * pattern from `src/exec-tools.ts`, which is the established precedent for a
 * capability probe with no persisted field (A3 §Q4).
 *
 * Deliberately not here: the probe **call** itself (it needs the live
 * connection and is async network I/O) and any in-flight deduplication. The
 * wiring slice owns both; this module stays pure.
 */
export declare function createRemoteSandboxCache(): RemoteSandboxCache;
/**
 * The read-only-filesystem denial signatures of the bwrap dialect: the
 * case-insensitive stderr substrings a DENIED file effect produces under the
 * profile above. Mirrors upstream `DENIAL_SIGNATURES.bwrap` exactly
 * (`['read-only file system']`).
 *
 * **Second-line evidence, NOT enforcement** (ADR-0022 D3, A3 §Q4): bwrap has no
 * typed denial channel, so a denial is only ever visible as in-band stderr
 * text. Nothing in this module decides whether a command runs based on this
 * list — the wrapped argv and the positive probe do that. The list exists so
 * the tool layer can report `[sandbox: file access denied under <mode> mode]`
 * honestly instead of showing a bare `EROFS` to the model.
 *
 * Deliberately narrow: the landlock/seatbelt/windows signatures
 * (`'permission denied'`, `'operation not permitted'`, `'access is denied'`) are
 * NOT merged in, because the fence wraps with a single named runner and a wide
 * dialect would mislabel ordinary application errors as sandbox denials.
 */
export declare const REMOTE_DENIAL_SIGNATURES: readonly string[];
/**
 * Whether one piece of remote output carries a denial signature. Case
 * insensitive, substring — the same matching rule upstream documents for
 * `ConfinedArgv.denialSignatures`.
 *
 * @param text - the command's stderr (or any output to inspect).
 * @returns `true` when the text looks like a fence denial; `false` is NOT
 *   evidence that the command ran unconfined.
 */
export declare function isRemoteDenialText(text: string): boolean;
/**
 * The fail-closed error code, copied from `@deepseek-ai/dsh-sandbox`
 * (`const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE"`, carried by
 * `SandboxUnavailableError extends HarnessError`). Copied rather than imported
 * so this module stays host-free and unit-testable; the wiring may raise the
 * real upstream error class with the same code and text.
 */
export declare const REMOTE_SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";
/**
 * MODEL-facing English constants (ADR-0014: model text is a constant, not a
 * locale-dictionary entry — it surfaces inside tool results and deliberately
 * does not follow the UI language; human-facing labels belong to
 * `src/locale/**`, which the wiring slice owns).
 */
export declare const REMOTE_SANDBOX_MESSAGES: {
    /**
     * The `{mode}` line, widened for the remote world: upstream
     * `SandboxUnavailableError` names local backends (bubblewrap on PATH, a
     * Landlock kernel, `sandbox-exec`, the Windows ACL runner), none of which is
     * actionable advice when the missing fence is on the far side of an SSH
     * connection. This module builds its own text; the wiring may instead pass
     * the detail below to the upstream error class and let that one compose.
     */
    readonly unavailable: "sandbox mode \"{mode}\" is requested but no remote sandbox runner is usable on this host; refusing to run the command unconfined.";
    /** Probe failed ⇒ the fence never ran a command. `{detail}` is the stderr. */
    readonly probeFailed: "Runner failure: remote sandbox probe failed; no command text was sent — {detail}";
    /** `workspace-write` without a usable absolute remote workspace root. */
    readonly workspaceRootRequired: "remote sandbox refused: mode \"workspace-write\" requires an absolute remote workspace root to bind, and none was resolved; refusing to run the command unconfined";
    /**
     * `spawnTerminal` under a fence (ADR-0022 §2.4): the interactive PTY path is
     * refused rather than left unfenced — `/dev/tty` under `--dev /dev` without
     * `--new-session` is unverified (A3 §Q2 caveat 3).
     */
    readonly terminalUnsupported: "remote sandbox refuses to open an interactive terminal: mode \"{mode}\" cannot fence a PTY session, and an unfenced terminal would be dishonest";
    /** The two coverage boundaries, quoted verbatim into tool/status output. */
    readonly boundaryFsWrites: "the remote sandbox fences spawned commands only: fs/SFTP writes travel the host-side channel and are NOT confined by it";
    readonly boundaryFileEffects: "the remote sandbox profile is file effects only: no network isolation, no environment scrubbing, no syscall filtering";
};
/**
 * The fence's refusal, carrying {@link REMOTE_SANDBOX_UNAVAILABLE}. Distinct
 * from the approval gate's `RemoteGateError` on purpose: "the approval policy
 * denied this" and "this host cannot confine the command" are different facts
 * for the model and the operator.
 */
export declare class RemoteSandboxError extends Error {
    /** Always {@link REMOTE_SANDBOX_UNAVAILABLE}. */
    readonly code: string;
    constructor(message: string, code?: string);
}
/**
 * The argv-construction refusal (a plugin-side policy failure, raised before
 * anything reaches SSH). Derived from {@link RemoteSandboxError} so one
 * `instanceof` catches every fence refusal.
 */
export declare class RemoteSandboxPolicyError extends RemoteSandboxError {
    constructor(message: string);
}
/**
 * The refusal the wiring raises when a fenced mode has no positive probe
 * verdict. Fail closed: the caller must not fall back to an unwrapped command.
 *
 * @param mode - the requested confinement mode.
 * @param detail - the probe's stderr/detail line, when there was one.
 */
export declare function remoteSandboxUnavailableError(mode: RemoteSandboxConfinementMode, detail?: string): RemoteSandboxError;
/** The tool-layer reporting shape of one mode (`sw_status`-style output). */
export interface RemoteSandboxFacts {
    /** The normalized mode. */
    mode: RemoteSandboxMode;
    /** Whether spawned commands get a runner wrapper at all. */
    wrapsSpawn: boolean;
    /** The profile tokens, or `[]` for `'off'`. */
    profileArgs: readonly string[];
    /** `'full'` for a wrapped mode (upstream asserts the same), `'none'` for `'off'`. */
    enforcement: 'full' | 'none';
    /**
     * The honest coverage booleans. Every one of these is part of the report so
     * a reader cannot mistake the fence for more than it is.
     */
    covers: {
        /** Model-initiated `spawn` commands. */
        readonly spawnedCommands: boolean;
        /** Interactive `spawnTerminal` sessions — refused under a fence in v1. */
        readonly interactiveTerminals: boolean;
        /** fs/SFTP writes — **never** covered (host-side channel). */
        readonly fsWrites: boolean;
        /** Network egress — never covered. */
        readonly network: boolean;
        /** The plugin's own fixed probes (control channel). */
        readonly hostProbes: boolean;
    };
    /** Denial dialect (second-line reporting only). */
    readonly denialSignatures: readonly string[];
    /** The human-readable boundary notes, ready to print. */
    readonly boundaries: readonly string[];
}
/**
 * Report what one mode does and does not cover. For `'workspace-write'` the
 * report carries the per-spawn `--bind` root as the literal placeholder
 * `<workspace-root>`, so this is a REPORTING shape and never a source of argv
 * — the only argv builder is {@link remoteRunnerArgv}, which refuses to guess a
 * root.
 *
 * @param mode - any normalized {@link RemoteSandboxMode}.
 */
export declare function remoteSandboxFactsOf(mode: RemoteSandboxMode): RemoteSandboxFacts;
