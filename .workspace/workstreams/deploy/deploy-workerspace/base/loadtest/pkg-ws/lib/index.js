//#region lib/index.js
/**
 * dsh-workerspace —— DSH SoC/嵌入式薄插件（与底座 dsh-workspace-enhancement 分工）。
 *
 * 底座：远程主机登记 + 远端执行/文件（sw_* 工具 + ctx.subprocess/fs 缝路由）→
 *       交叉编译复用其远端 bash。本插件**不重复**主机管理/文件传输（hosts 键为引用性说明；
 *       远端烧录走底座 sw_exec）。
 * 本插件：SoC 本地面 ——
 *   - ws_serial_list / ws_serial_open / ws_serial_send / ws_serial_read / ws_serial_close
 *     （USB 串口会话式收发 + 日志落盘；stty 零依赖默认后端，serialport 可选后端）；
 *   - ws_flash（settings flash.templates 白名单模板 + 产物围栏 + 凭据槽 + 高危确认模态 +
 *     输出脱敏 + 日志落盘）。
 *
 * 安全边界（四道闸：本文件接线、core.js 纯逻辑）：
 *   1. 命令白名单（security.commandAllowlist，默认 esptool/esptool.py/openocd/dfu-util/uuu/fastboot）；
 *   2. 占位符强校验（{{artifact:<name>}} / {{credential:<ref>}} 整 token；字面 token 禁 shell 元字符；
 *      argv 直传 spawn、无 shell）；
 *   3. 高危确认模态（security.confirmDangerous → ctx.approval.request，非 allowed-once 一律 fail-closed）；
 *   4. 输出脱敏（凭据值/私钥路径在工具返回、错误、日志里一律 [redacted:<n>]）。
 * 密钥：一律 credential-ref（settings 只存引用，值经 dsh-credentials 槽解析，明文永不进模型上下文/浏览器）。
 *
 * @module dsh-workerspace
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DEFAULT_TOOL_ALLOWLIST, isValidBaudRate, isValidPortName, isValidSessionId, redact } from "./core.js";
import { listSerialPorts, SerialSession, serialLogPath } from "./serial.js";
import { planFlash, runFlashPlan, redactLogLines } from "./flash.js";

const name = "workerspace";
const inject = ["tools", "systemPrompt", "subprocess"];

/** settings 命名空间：dsh-workerspace（与需求键面一致）。 */
const WS_SETTINGS_NAMESPACE = settingsNamespace("dsh-workerspace");

/** 收集输出上限（本地一次性命令用）。 */
const LOCAL_COLLECT_MAX_BYTES = 64 * 1024;

const Config = z.object({
	serial: z
		.object({
			port: z.string().default(""),
			baudRate: z.number().default(115200),
			logDir: z.string().default(""),
			backend: z.string().default("stty"),
		})
		.default({}),
	flash: z
		.object({
			templates: z
				.array(
					z.object({
						id: z.string(),
						command: z.string(),
						dangerous: z.boolean().default(true),
						timeoutMs: z.number().default(600000),
					}),
				)
				.default([]),
		})
		.default({}),
	artifacts: z.object({ dir: z.string().default("") }).default({}),
	security: z
		.object({
			confirmDangerous: z.boolean().default(true),
			commandAllowlist: z.array(z.string()).default([...DEFAULT_TOOL_ALLOWLIST]),
		})
		.default({}),
	// 主机清单：**引用性说明键**。底座（dsh-workspace-enhancement）自带机器注册表
	// （sshRegistry / remote-workspaces/machines.json / TOFU / sw_connect），本插件不重复
	// 实现连接；keyRef 一律 credential-ref。远程烧录请用底座 sw_exec。
	hosts: z
		.array(
			z.object({
				id: z.string(),
				name: z.string().default(""),
				host: z.string().default(""),
				port: z.number().default(22),
				user: z.string().default(""),
				keyRef: z.string().role("credential-ref").default(""),
			}),
		)
		.default([]),
});

/** 产物根默认：$DSH_HOME/workerspace（~/.dsh/workerspace/）。 */
function defaultArtifactsDir() {
	return join(dshHomePath(), "workerspace");
}

/** 确保产物目录存在并返回其绝对路径。 */
async function ensureArtifactsDir(config) {
	const dir = (config.artifacts?.dir ?? "").trim() || defaultArtifactsDir();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	return dir;
}

/** 错误扁平化。 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

/** 把抛出的值脱敏后重新抛出。 */
function throwRedacted(error, secrets) {
	const { text } = redact(messageOf(error), secrets ?? []);
	throw new Error(text);
}

/**
 * 插件入口。
 * @param {object} ctx - cordis 上下文（tools/systemPrompt/subprocess 注入）。
 * @param {object} config - settings 校验后的配置。
 */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, WS_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
	});

	ctx.systemPrompt.section({
		name: "tool:ws-workerspace",
		order: 100,
		text: "For local Linux SoC / embedded boards attached over USB: use ws_serial_list/ws_serial_open/ws_serial_send/ws_serial_read/ws_serial_close for the serial console (stty backend by default; logs under the dsh-workerspace artifacts dir) and ws_flash to burn firmware through allowlisted templates (esptool/openocd/dfu-util/uuu/fastboot; high-risk flashes prompt for confirmation). Remote hosts and cross-compilation belong to the base workspace plugin (sw_* tools); this plugin only touches the local USB side.",
	});

	/** 串口会话表（插件生命周期内持有；卸载时全部关闭）。 */
	const sessions = new Map();

	/** ctx.subprocess 薄封装：跑一次性本地命令（stty 配置等）。 */
	const runLocal = async (argv, cwd = "/") => {
		const subprocess = ctx.get("subprocess", false);
		if (subprocess === undefined) {
			throw new Error("subprocess service unavailable");
		}
		const handle = subprocess.spawn({
			argv,
			cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: LOCAL_COLLECT_MAX_BYTES },
				stderr: { maxBytes: LOCAL_COLLECT_MAX_BYTES },
			},
			graceMs: 10_000,
		});
		const outcome = await handle.done;
		return {
			exitCode: outcome.exitCode,
			stderr: handle.collected.stderr?.readFrom(0).text ?? "",
		};
	};

	ctx.effect(
		() => () => {
			for (const session of sessions.values()) {
				void session.close().catch(() => {});
			}
			sessions.clear();
		},
		"dsh-workerspace: serial session lifecycle",
	);

	// ------------------------------------------------------------------ //
	// ws_serial_list
	// ------------------------------------------------------------------ //
	ctx.tools.register(
		defineTool({
			name: "ws_serial_list",
			description:
				"List local USB serial ports (Linux: /dev/serial/by-id aliases plus /dev/ttyUSB* and /dev/ttyACM*). Use it before ws_serial_open to discover the SoC console device.",
			parameters: {
				filter: {
					type: "string",
					description: "Optional substring filter on path or label.",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ports: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									path: { type: "string", required: true },
									label: { type: "string" },
								},
							},
						},
						backend: { type: "string", required: true },
					},
				},
				render: (_args, value) => [
					{
						type: "text",
						text:
							value.ports.length === 0
								? "No serial ports found."
								: value.ports.map((p) => (p.label ? `${p.path}  (${p.label})` : p.path)).join("\n"),
					},
				],
			},
			isConcurrencySafe: () => true,
			async execute(args) {
				const filter = (args.filter ?? "").trim();
				let ports = await listSerialPorts();
				if (filter.length > 0) {
					ports = ports.filter((p) => p.path.includes(filter) || (p.label ?? "").includes(filter));
				}
				return { ports, backend: "stty" };
			},
		}),
	);

	// ------------------------------------------------------------------ //
	// ws_serial_open
	// ------------------------------------------------------------------ //
	ctx.tools.register(
		defineTool({
			name: "ws_serial_open",
			description:
				"Open a serial console session on a local USB port (Linux SoC console). Configures the port via stty (raw, echo off) or the optional serialport backend. Returns a sessionId for ws_serial_send/ws_serial_read/ws_serial_close. Received and sent bytes are logged under the dsh-workerspace serial log dir.",
			parameters: {
				port: {
					type: "string",
					description: "Serial device path, e.g. /dev/ttyUSB0. Defaults to settings dsh-workerspace → serial.port.",
				},
				baudRate: {
					type: "number",
					description: "Baud rate (default 115200; integer in [50, 4000000]).",
				},
				backend: {
					type: "string",
					description: "stty (default, zero-dependency) or serialport (requires the npm package installed in the profile).",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						sessionId: { type: "string", required: true },
						port: { type: "string", required: true },
						baudRate: { type: "number", required: true },
						backend: { type: "string", required: true },
						logPath: { type: "string", required: true },
					},
				},
				render: (_args, value) => [
					{
						type: "text",
						text: `Serial session ${value.sessionId} open on ${value.port} @ ${value.baudRate} (${value.backend}); log: ${value.logPath}`,
					},
				],
			},
			isConcurrencySafe: () => true,
			async execute(args) {
				const cfg = current();
				const port = (args.port ?? "").trim() || (cfg.serial?.port ?? "").trim();
				if (port.length === 0 || !isValidPortName(port)) {
					throw new Error(`invalid serial port "${port}"; pass a device path like /dev/ttyUSB0 or set settings dsh-workerspace → serial.port`);
				}
				for (const [id, session] of sessions) {
					if (session.port === port && !session.closed) {
						throw new Error(`port ${port} is already open in session ${id}; close it first or reuse that sessionId`);
					}
				}
				const baudRate = args.baudRate ?? cfg.serial?.baudRate ?? 115200;
				if (!isValidBaudRate(baudRate)) {
					throw new Error(`invalid baud rate ${baudRate}; must be an integer in [50, 4000000]`);
				}
				const backend = args.backend ?? cfg.serial?.backend ?? "stty";
				const artifactsDir = await ensureArtifactsDir(cfg);
				const logDir = (cfg.serial?.logDir ?? "").trim() || join(artifactsDir, "serial");
				const logPath = await serialLogPath(logDir, port);
				const session = new SerialSession({ port, baudRate, backend, logPath, runSubprocess: runLocal });
				try {
					await session.open();
				} catch (error) {
					throw new Error(`failed to open serial port ${port}: ${messageOf(error)}`);
				}
				const sessionId = randomUUID();
				sessions.set(sessionId, session);
				return { sessionId, port, baudRate, backend, logPath };
			},
		}),
	);

	// ------------------------------------------------------------------ //
	// ws_serial_send
	// ------------------------------------------------------------------ //
	ctx.tools.register(
		defineTool({
			name: "ws_serial_send",
			description:
				"Send bytes to an open serial session (ws_serial_open). text sends UTF-8 with an optional line ending; hex sends raw bytes. Bytes are logged.",
			parameters: {
				sessionId: { type: "string", required: true, description: "Session id from ws_serial_open." },
				data: { type: "string", required: true, description: "Payload: UTF-8 text (encoding=text) or hex pairs like 41 42 43 (encoding=hex)." },
				encoding: { type: "string", description: "text (default) or hex." },
				lineEnding: { type: "string", description: "none (default), lf, cr, or crlf — appended after text payloads." },
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						sentBytes: { type: "number", required: true },
						encoding: { type: "string", required: true },
					},
				},
				render: (_args, value) => [{ type: "text", text: `Sent ${value.sentBytes} bytes (${value.encoding})` }],
			},
			isConcurrencySafe: () => false,
			async execute(args) {
				const key = String(args.sessionId ?? "").trim();
				const session = sessions.get(key);
				if (session === undefined || session.closed) {
					throw new Error("unknown or closed serial session; open one with ws_serial_open first");
				}
				const encoding = args.encoding ?? "text";
				let bytes;
				if (encoding === "hex") {
					const cleaned = String(args.data).replace(/\s+/g, "");
					if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
						throw new Error("hex payload must be pairs of hex digits (whitespace allowed)");
					}
					bytes = Buffer.from(cleaned, "hex");
				} else if (encoding === "text") {
					const ending = args.lineEnding ?? "none";
					const suffix = { none: "", lf: "\n", cr: "\r", crlf: "\r\n" }[ending];
					if (suffix === undefined) {
						throw new Error(`invalid lineEnding "${ending}" (none/lf/cr/crlf)`);
					}
					bytes = Buffer.from(String(args.data) + suffix, "utf8");
				} else {
					throw new Error(`invalid encoding "${encoding}" (text|hex)`);
				}
				if (bytes.length === 0) {
					throw new Error("nothing to send (empty payload)");
				}
				const sentBytes = await session.write(bytes);
				return { sentBytes, encoding };
			},
		}),
	);

	// ------------------------------------------------------------------ //
	// ws_serial_read
	// ------------------------------------------------------------------ //
	/** 每会话读游标（上次 ws_serial_read 的 nextOffset）。 */
	const readOffsets = new Map();
	ctx.tools.register(
		defineTool({
			name: "ws_serial_read",
			description:
				"Read pending output from an open serial session since the previous read. Empty with timeoutMs>0 polls until data or timeout. Encoding text returns UTF-8 text; hex returns space-separated hex bytes.",
			parameters: {
				sessionId: { type: "string", required: true, description: "Session id from ws_serial_open." },
				maxBytes: { type: "number", description: "Cap on returned bytes (default 4096)." },
				timeoutMs: { type: "number", description: "Wait for data up to this many ms when the buffer is empty (default 0 = return immediately)." },
				encoding: { type: "string", description: "text (default) or hex." },
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						data: { type: "string", required: true },
						encoding: { type: "string", required: true },
						moreAvailable: { type: "boolean", required: true },
						totalReceived: { type: "number", required: true },
						lossy: { type: "boolean", required: true },
					},
				},
				render: (_args, value) => [{ type: "text", text: value.data.length === 0 ? "(no new data)" : value.data }],
			},
			isConcurrencySafe: () => false,
			async execute(args) {
				const key = String(args.sessionId ?? "").trim();
				const session = sessions.get(key);
				if (session === undefined || session.closed) {
					throw new Error("unknown or closed serial session; open one with ws_serial_open first");
				}
				const encoding = args.encoding ?? "text";
				const maxBytes = Number.isFinite(args.maxBytes) && args.maxBytes > 0 ? args.maxBytes : 4096;
				const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 0;
				const deadline = Date.now() + timeoutMs;
				const from = readOffsets.get(session) ?? 0;
				let read = session.readSince(from);
				while (read.data.length === 0 && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 50));
					read = session.readSince(from);
				}
				readOffsets.set(session, read.nextOffset);
				let data = read.data;
				const moreAvailable = data.length > maxBytes;
				if (data.length > maxBytes) data = data.subarray(data.length - maxBytes);
				const rendered =
					encoding === "hex"
						? data.toString("hex").replace(/(..)/g, "$1 ").trim()
						: data.toString("utf8");
				return {
					data: rendered,
					encoding,
					moreAvailable,
					totalReceived: read.totalReceived,
					lossy: read.lossy,
				};
			},
		}),
	);

	// ------------------------------------------------------------------ //
	// ws_serial_close
	// ------------------------------------------------------------------ //
	ctx.tools.register(
		defineTool({
			name: "ws_serial_close",
			description: "Close a serial session opened by ws_serial_open. The session log file is finalized.",
			parameters: {
				sessionId: { type: "string", required: true, description: "Session id from ws_serial_open." },
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						closed: { type: "boolean", required: true },
						port: { type: "string", required: true },
						receivedBytes: { type: "number", required: true },
						sentBytes: { type: "number", required: true },
						logPath: { type: "string", required: true },
					},
				},
				render: (_args, value) => [
					{ type: "text", text: `Closed ${value.port}; received ${value.receivedBytes}, sent ${value.sentBytes} bytes; log: ${value.logPath}` },
				],
			},
			isConcurrencySafe: () => true,
			async execute(args) {
				const key = String(args.sessionId ?? "").trim();
				const session = sessions.get(key);
				if (session === undefined) {
					throw new Error("unknown serial session; nothing to close");
				}
				const stats = session.stats();
				await session.close();
				sessions.delete(key);
				return {
					closed: true,
					port: stats.port,
					receivedBytes: stats.receivedBytes,
					sentBytes: stats.sentBytes,
					logPath: stats.logPath,
				};
			},
		}),
	);

	// ------------------------------------------------------------------ //
	// ws_flash
	// ------------------------------------------------------------------ //
	ctx.tools.register(
		defineTool({
			name: "ws_flash",
			description:
				"Flash firmware to a local device through an allowlisted command template (settings dsh-workerspace → flash.templates; default allowlist: esptool/esptool.py/openocd/dfu-util/uuu/fastboot). Templates use {{artifact:<name>}} placeholders bound to files under the artifacts dir, and optionally {{credential:<ref>}} resolved through the credentials service (values are never echoed). High-risk (dangerous) flashes prompt for confirmation. Full command, exit code and redacted output are logged under the artifacts dir. Remote flashing is not implemented here — use the base plugin's sw_exec for that.",
			parameters: {
				templateId: {
					type: "string",
					required: true,
					description: "Id of a template configured under settings dsh-workerspace → flash.templates.",
				},
				artifacts: {
					type: "object",
					description: "Bindings name → file path for {{artifact:<name>}} placeholders; paths must resolve inside the artifacts dir (~/.dsh/workerspace/ by default).",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean", required: true },
						exitCode: { type: "number", required: true },
						durationMs: { type: "number", required: true },
						logPath: { type: "string", required: true },
						output: { type: "string", required: true },
					},
				},
				render: (_args, value) => [
					{
						type: "text",
						text: `Flash ok, exit ${value.exitCode} (${value.durationMs}ms). Log: ${value.logPath}\n${value.output}`,
					},
				],
			},
			isConcurrencySafe: () => false,
			async execute(args, exec) {
				const cfg = current();
				let plan = undefined;
				try {
					const artifactsDir = await ensureArtifactsDir(cfg);
					plan = await planFlash({
						templateId: args.templateId,
						templates: cfg.flash?.templates ?? [],
						allowlist:
							Array.isArray(cfg.security?.commandAllowlist) && cfg.security.commandAllowlist.length > 0
								? cfg.security.commandAllowlist
								: DEFAULT_TOOL_ALLOWLIST,
						artifacts: args.artifacts ?? {},
						artifactsDir,
						realpathFn: realpath,
						resolveCredential: async (ref) => {
							const credentials = ctx.get("credentials", false);
							if (credentials === undefined) return undefined;
							try {
								return await credentials.resolve(credentialRef(ref));
							} catch {
								return undefined;
							}
						},
					});

					/** 高危确认：ctx.approval.request，非 allowed-once 一律不放行。 */
					const ask = async (argv) => {
						if (!exec.agent) {
							throw new Error("no agent context for approval; refusing high-risk flash (fail-closed)");
						}
						const approval = ctx.get("approval", false);
						if (approval === undefined) {
							throw new Error("approval service unavailable; refusing high-risk flash (fail-closed)");
						}
						const outcome = await approval.request({
							agent: exec.agent,
							toolName: "ws_flash",
							reason: `Flash command: ${JSON.stringify(argv)}`,
							signal: exec.signal,
						});
						return outcome === "allowed-once";
					};

					const subprocess = ctx.get("subprocess", false);
					if (subprocess === undefined) {
						throw new Error("subprocess service unavailable");
					}
					const result = await runFlashPlan(plan, {
						spawn: (spec) => subprocess.spawn(spec),
						signal: exec.signal,
						cwd: artifactsDir,
						confirm: cfg.security?.confirmDangerous !== false,
						ask,
					});

					const logText = redactLogLines(result.logLines, plan.secrets);
					const ts = new Date().toISOString().replace(/[:.]/g, "-");
					const logPath = join(artifactsDir, `flash-${args.templateId}-${ts}.log`);
					await appendFile(logPath, logText + "\n", "utf8");

					const { text: outText } = redact((result.stdout + "\n" + result.stderr).trim(), plan.secrets);
					return {
						ok: true,
						exitCode: result.exitCode,
						durationMs: result.durationMs,
						logPath,
						output: outText.slice(-16_000),
					};
				} catch (error) {
					throwRedacted(error, plan?.secrets ?? []);
				}
			},
		}),
	);
}

export { Config, WS_SETTINGS_NAMESPACE, apply, inject, name };
//#endregion
