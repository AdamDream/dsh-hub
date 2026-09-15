//#region lib/index.js
/**
 * @local/dsh-ssh-gui —— 「分布式控制」薄插件（不改底座、不改 core、不改 dsh-workerspace）。
 *
 * 把 SSH + 本地 USB 串口 + TCP 串口服务器统一为「分布式控制节点」：
 *   节点 = { id, name, transport, target }，transport ∈ ssh:// / serial:// / serial-tcp://，
 *   命令/文件/状态经传输适配器分发。GUI 只做 连接管理/节点状态/命令执行（exec.run）/
 *   文件操作（file.get/put）/目录浏览——**不内嵌交互终端**（终端交外部）。
 *
 * host 侧：一条薄 cordis 行 + 自有 loopback RPC 通道 `/ssh-gui`（沿用既有通道名，
 * **绝不二次 handle('/dsw')**）。复用底座 dsh-workspace-enhancement 的全局 seam
 * （ctx.sshRegistry / ctx.credentials / machines.json / TOFU）与 dsh-workerspace 的
 * 串口后端（模块解析复用，见下）。端点语义与安全闸全部在 core.createDispatch（env
 * 注入，test 直测）；本文件只做 cordis 接线。
 *
 * 传输适配器：
 *  - ssh://：底座连接池（registry.get/getActive）的 connection.exec / getSftp（既有）；
 *  - serial://：**复用 @local/dsh-workerspace/lib/serial.js 的 SerialSession 后端**
 *    （stty 零依赖默认 / serialport 可选，同一后端逻辑）。跨插件复用走**模块解析**
 *    而非 cordis service：serial.js 是纯 node builtins 模块（无 DSH 依赖），经
 *    createRequire.resolve → import() 懒加载；dsh-workerspace 未装时 serial:// 节点
 *    报「workerspace plugin not installed」错误（可优雅降级，不影响 ssh/serial-tcp）；
 *  - serial-tcp://：本插件 lib/serial-tcp.js 的 SerialTcpSession（net.connect 到
 *    host:port，raw 字节收发 + 日志 + 会话式；**无凭据**）。
 *  会话式：每个 console 节点同时最多一个会话（本插件自有会话表；与 dsh-workerspace
 *  工具会话独立——同端口二次打开由 OS 拒绝，错误自然上抛）。
 *
 * 统一配置：~/.dsh/remote-workspaces/nodes.json（一张表：ssh 机器迁移 + serial +
 * serial-tcp；SSH 节点与底座 machines.json 双向同步，keyRef 侧表 ssh-keyrefs.json
 * 沿用——凭据仍是 credentials ref，无明文）。
 *
 * 安全四则（沿用 + 按传输适配）：
 *   1. TOFU accept-new 沿用底座（ssh 连接层自带；serial-tcp raw TCP 无指纹面）；
 *   2. PEM 0600 显式落盘（mkdir 0700 + write 0600 + chmod），密钥内容永不进模型/浏览器；
 *   3. 命令白名单（security.execAllowlist 对**所有传输**生效——首 token 精确匹配，
 *      host 侧硬闸）+ 客户端二次确认（confirmExec）；serial/serial-tcp 同为 console
 *      发送，确认模态展示目标节点 + 命令；
 *   4. 脱敏 + 日志落盘：会话收发日志（serial/serial-tcp hex+文本）与 exec.run 审计
 *      日志（~/.dsh/remote-workspaces/exec-audit.log，JSONL，命令/退出码/截断标记）。
 *
 * @module @local/dsh-ssh-gui
 */
import { appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { remoteWorkspacesRoot } from 'dsh-workspace-enhancement';
import {
	CONSOLE_READ_POLL_MS,
	DEFAULT_EXEC_MAX_OUTPUT_BYTES,
	DEFAULT_EXEC_TIMEOUT_MS,
	DEFAULT_FILE_MAX_BYTES,
	DEFAULT_FILE_OP_TIMEOUT_MS,
	createDispatch,
	sanitizeConfig,
	withTimeout,
} from './core.js';
import { SerialTcpSession, serialTcpLogPath } from './serial-tcp.js';

/** cordis 行名（与 profile patch 的 insert id 一致）。 */
const name = 'ssh-gui';
/** host 依赖：web transport（rpc.handle）。settings 由 installSettingsSection 自注入。 */
const inject = ['connection', 'subprocess'];
/** settings 命名空间：dsh-ssh-gui（settings.yaml 键同名）。 */
const NS = settingsNamespace('dsh-ssh-gui');
/** 密钥文件目录：~/.dsh/remote-workspaces/.secrets/keys（与底座明文密码同一信任域）。 */
const KEYS_DIR = () => join(remoteWorkspacesRoot(), '.secrets', 'keys');
/** keyRefs 侧表：~/.dsh/remote-workspaces/ssh-keyrefs.json（沿用）。 */
const KEYREFS_FILE = () => join(remoteWorkspacesRoot(), 'ssh-keyrefs.json');
/** 统一节点表：~/.dsh/remote-workspaces/nodes.json（ssh 迁移 + serial + serial-tcp）。 */
const NODES_FILE = () => join(remoteWorkspacesRoot(), 'nodes.json');
/** exec.run 审计日志（JSONL，落盘）。 */
const AUDIT_FILE = () => join(remoteWorkspacesRoot(), 'exec-audit.log');

const require_ = createRequire(import.meta.url);
/** dsh-workerspace serial.js 懒加载（跨插件模块解析，非 cordis service）。
 *  注意：@local/dsh-workerspace 的 exports 只导出 "." 与 "./package.json"，**不导出
 *  ./lib/serial.js**——故经其 package.json 位置推导 lib/serial.js 路径（"files" 含
 *  lib/，安装后必然存在），绕开 exports 白名单而无需改动 dsh-workerspace。 */
let wsSerialModulePromise = null;
function loadWsSerialModule() {
	if (wsSerialModulePromise === null) {
		wsSerialModulePromise = (async () => {
			const pkgJson = require_.resolve('@local/dsh-workerspace/package.json');
			const serialPath = join(dirname(pkgJson), 'lib', 'serial.js');
			return import(pathToFileURL(serialPath).href);
		})();
	}
	return wsSerialModulePromise;
}

/** settings schema（file 上限 / exec 超时与输出 / 安全开关 / serial 日志目录 / 节点种子）。 */
const Config = z.object({
	file: z
		.object({
			maxBytes: z.number().min(1).default(DEFAULT_FILE_MAX_BYTES),
		})
		.default({}),
	exec: z
		.object({
			timeoutMs: z.number().min(1000).default(DEFAULT_EXEC_TIMEOUT_MS),
			maxOutputBytes: z.number().min(1024).default(DEFAULT_EXEC_MAX_OUTPUT_BYTES),
		})
		.default({}),
	security: z
		.object({
			confirmExec: z.boolean().default(true),
			execAllowlist: z.array(z.string()).default([]),
		})
		.default({}),
	serial: z
		.object({
			// GUI 控制台会话日志目录（缺省 ~/.dsh/remote-workspaces/serial-logs）。
			logDir: z.string().default(''),
		})
		.default({}),
	nodes: z
		.object({
			seed: z
				.object({
					// 首启迁移种子：仅当 nodes.json 不存在时导入（此后 GUI CRUD 是权威）。
					serial: z
						.array(
							z.object({
								id: z.string().default(''),
								name: z.string().default(''),
								port: z.string(),
								baudRate: z.number().default(115200),
								backend: z.string().default('stty'),
							}),
						)
						.default([]),
					serialTcp: z
						.array(
							z.object({
								id: z.string().default(''),
								name: z.string().default(''),
								host: z.string(),
								port: z.number(),
								tty: z.string().default(''),
							}),
						)
						.default([]),
				})
				.default({}),
		})
		.default({}),
});

/** 把 ssh2 回调风格 SFTP 方法 promisify（不吞错误形状）。 */
function promisifySftp(method) {
	return (...args) =>
		new Promise((resolvePromise, reject) => {
			method(...args, (error, value) => {
				if (error !== undefined) reject(error);
				else resolvePromise(value);
			});
		});
}

/**
 * 插件入口：注册 settings 命名空间 + `/ssh-gui` loopback RPC 通道。
 * 所有底座服务（sshRegistry / credentials / subprocess）一律调用时懒取——行序无关
 * （web.js L191-196 同款；dsh-base patch 注释：激活按服务可用性，非行序）。
 * @param ctx - cordis 上下文。
 * @param config - settings 校验后的配置。
 */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, NS, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
	});
	const cfg = () => sanitizeConfig(current());
	const registryService = () => {
		const value = ctx.get('sshRegistry');
		if (value === undefined) {
			throw new Error('bad-request: sshRegistry service is not mounted (dsh-workspace-enhancement/web 未装配)');
		}
		return value;
	};
	const credentialsService = () => {
		const value = ctx.get('credentials', false);
		if (value === undefined) {
			throw new Error('bad-request: credentials service is not mounted');
		}
		return value;
	};
	/** exec/file 目标解析：显式 id（registry 条目）或活动机（getActive 回退链）。 */
	const resolveTarget = (id) => {
		if (id !== undefined) {
			const connection = registryService().get(id.trim());
			if (connection === undefined) {
				throw new Error(`bad-request: unknown machine id ${JSON.stringify(id.trim())}`);
			}
			return { spec: connection.spec, connection };
		}
		const active = registryService().getActive();
		if (active === null) {
			throw new Error('bad-request: no active machine');
		}
		return active;
	};
	/** 远程 HOME：登录环境 HOME，否则连接默认 cwd（与底座 listing.remoteHome 同语义）。 */
	const remoteHomeOf = async (connection, signal) => {
		await connection.getClient(signal);
		try {
			const environment = await connection.getRemoteEnvironment(signal);
			if (typeof environment?.HOME === 'string' && environment.HOME.trim() !== '') {
				return environment.HOME;
			}
		}
		catch {
			// alive transport whose env probe failed → fall back to the spec cwd
		}
		return connection.cwd;
	};
	/** SFTP 通道（懒取，带兜底超时）。 */
	const sftpOf = async (connection, signal) => {
		const sftp = await connection.getSftp(signal);
		return {
			stat: (path, sig) =>
				withTimeout(promisifySftp(sftp.stat.bind(sftp))(path), DEFAULT_FILE_OP_TIMEOUT_MS, sig),
			readFile: (path, sig) =>
				withTimeout(promisifySftp(sftp.readFile.bind(sftp))(path), DEFAULT_FILE_OP_TIMEOUT_MS, sig),
			writeFile: (path, buf, sig) =>
				withTimeout(promisifySftp(sftp.writeFile.bind(sftp))(path, buf), DEFAULT_FILE_OP_TIMEOUT_MS, sig),
			readdir: (path, sig) =>
				withTimeout(promisifySftp(sftp.readdir.bind(sftp))(path), DEFAULT_FILE_OP_TIMEOUT_MS, sig),
		};
	};

	/** ctx.subprocess 薄封装：跑一次性本地命令（stty 配置等；复用 dsh-workerspace 同款）。 */
	const runLocal = async (argv, cwd = '/') => {
		const subprocess = ctx.get('subprocess', false);
		if (subprocess === undefined) {
			throw new Error('subprocess service unavailable');
		}
		const handle = subprocess.spawn({
			argv,
			cwd,
			stdio: {
				stdin: 'ignore',
				stdout: { maxBytes: 64 * 1024 },
				stderr: { maxBytes: 64 * 1024 },
			},
			graceMs: 10_000,
		});
		const outcome = await handle.done;
		return {
			exitCode: outcome.exitCode,
			stderr: handle.collected.stderr?.readFrom(0).text ?? '',
		};
	};

	// ------------------------------------------------------------------ //
	// console 适配器（serial:// 与 serial-tcp:// 统一会话面）
	// ------------------------------------------------------------------ //
	/** GUI 控制台会话表：nodeId → { kind, session, cursor }（插件卸载时全部关闭）。 */
	const consoleSessions = new Map();
	const serialLogDir = () =>
		(current().serial?.logDir ?? '').trim() || join(remoteWorkspacesRoot(), 'serial-logs');
	const requireOpenConsole = (node) => {
		const record = consoleSessions.get(node.id);
		if (record === undefined || record.session.closed) {
			throw new Error(`bad-request: no open console session for node ${JSON.stringify(node.id)}; open it with serial.open first`);
		}
		return record;
	};
	const sleepMs = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
	const consoleAdapter = {
		async open(node, signal) {
			const existing = consoleSessions.get(node.id);
			if (existing !== undefined && !existing.session.closed) {
				return { logPath: existing.session.logPath, alreadyOpen: true };
			}
			let session;
			if (node.transport === 'serial://') {
				const mod = await loadWsSerialModule();
				const logPath = await mod.serialLogPath(serialLogDir(), node.target.port);
				session = new mod.SerialSession({
					port: node.target.port,
					baudRate: node.target.baudRate,
					backend: node.target.backend,
					logPath,
					runSubprocess: runLocal,
				});
				try {
					await session.open();
				}
				catch (error) {
					throw new Error(
						`failed to open serial port ${node.target.port} @ ${node.target.baudRate} ` +
						`(${node.target.backend}): ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			else {
				const logPath = await serialTcpLogPath(serialLogDir(), node.id);
				session = new SerialTcpSession({
					host: node.target.host,
					port: node.target.port,
					tty: node.target.tty,
					logPath,
				});
				try {
					await session.open();
				}
				catch (error) {
					throw new Error(
						`failed to connect serial-tcp ${node.target.host}:${node.target.port}` +
						`${node.target.tty ? ` (${node.target.tty})` : ''}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			consoleSessions.set(node.id, { kind: node.transport, session, cursor: 0 });
			return { logPath: session.logPath, alreadyOpen: false };
		},
		async send(node, bytes, signal) {
			const record = requireOpenConsole(node);
			const sentBytes = await record.session.write(bytes);
			return { sentBytes };
		},
		currentOffset(node) {
			const record = consoleSessions.get(node.id);
			return record ? record.session.bufferStart + record.session.buffer.length : 0;
		},
		async read(node, { fromOffset, timeoutMs, quietMs, maxBytes, signal }) {
			const record = requireOpenConsole(node);
			const start = fromOffset ?? record.cursor;
			let read = record.session.readSince(start);
			const begin = Date.now();
			const deadline = timeoutMs > 0 ? begin + timeoutMs : Infinity;
			let hasData = read.data.length > 0;
			let lastDataAt = hasData ? Date.now() : 0;
			let timedOut = false;
			while (true) {
				if (quietMs === 0 && hasData) break; // serial.read：有数据即返回
				if (quietMs > 0 && hasData && Date.now() - lastDataAt >= quietMs) break; // 静默窗口达成
				if (quietMs === 0 && Date.now() >= deadline) break; // serial.read 超时（空返回）
				if (quietMs > 0 && Date.now() >= deadline) {
					timedOut = true;
					break;
				}
				await sleepMs(CONSOLE_READ_POLL_MS);
				const next = record.session.readSince(start);
				if (next.data.length > 0) {
					hasData = true;
					lastDataAt = Date.now();
				}
				read = next;
			}
			record.cursor = read.nextOffset;
			let data = read.data;
			const moreAvailable = data.length > maxBytes;
			if (data.length > maxBytes) data = data.subarray(data.length - maxBytes);
			return {
				buf: Buffer.from(data),
				moreAvailable,
				nextOffset: read.nextOffset,
				totalReceived: read.totalReceived,
				lossy: read.lossy,
				timedOut,
			};
		},
		stats(node) {
			const record = consoleSessions.get(node.id);
			if (record === undefined || record.session.closed) {
				return {
					state: 'closed',
					transport: node.transport,
					logPath: record?.session.logPath,
				};
			}
			return {
				state: 'open',
				transport: node.transport,
				receivedBytes: record.session.receivedBytes,
				sentBytes: record.session.sentBytes,
				logPath: record.session.logPath,
				readError: record.session.readError ? record.session.readError.message : undefined,
			};
		},
		async close(node, signal) {
			const record = consoleSessions.get(node.id);
			if (record === undefined) {
				return { logPath: undefined, receivedBytes: 0, sentBytes: 0 };
			}
			const stats = record.session.stats();
			await record.session.close();
			consoleSessions.delete(node.id);
			return {
				logPath: stats.logPath,
				receivedBytes: stats.receivedBytes,
				sentBytes: stats.sentBytes,
			};
		},
		async ports() {
			try {
				const mod = await loadWsSerialModule();
				return await mod.listSerialPorts();
			}
			catch {
				return [];
			}
		},
	};

	/** exec.run 审计日志（JSONL 落盘；best-effort）。 */
	const auditLog = async (entry) => {
		try {
			await appendFile(
				AUDIT_FILE(),
				JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
				'utf8',
			);
		}
		catch {
			// best-effort：审计失败不阻断执行
		}
	};

	const dispatch = createDispatch({
		cfg,
		registry: {
			listMachines: () => registryService().listMachines(),
			get: (id) => registryService().get(id),
			getActive: () => registryService().getActive(),
			saveMachine: (input) => registryService().saveMachine(input),
		},
		registryStatus: (id) => registryService().statusOf(id),
		registryProbe: (id, signal) => registryService().probe(id, signal),
		registryRemove: (id) => registryService().remove(id),
		registrySetCurrent: (id) => registryService().setCurrent(id),
		credentials: {
			resolve: (refName) => credentialsService().resolve(credentialRef(refName)),
			describe: (refName) => credentialsService().describe(credentialRef(refName)),
		},
		keysDir: KEYS_DIR,
		keyrefsFile: KEYREFS_FILE,
		nodesFile: NODES_FILE,
		console: consoleAdapter,
		auditLog,
		resolveTarget,
		connectionExec: (connection, command, opts) => connection.exec(command, opts),
		sftpOf,
		remoteHomeOf,
		statFile: (sftp, path, signal) => sftp.stat(path, signal),
		readFileOf: (sftp, path, signal) => sftp.readFile(path, signal),
		writeFileOf: (sftp, path, buf, signal) => sftp.writeFile(path, buf, signal),
		readdirOf: (sftp, path, signal) => sftp.readdir(path, signal),
		listLimit: 1000,
	});

	const dispose = ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' });
	ctx.effect(
		() => {
			const closeAll = async () => {
				for (const record of consoleSessions.values()) {
					await record.session.close().catch(() => {});
				}
				consoleSessions.clear();
			};
			return () => {
				void closeAll();
				dispose();
			};
		},
		'ssh-gui: /ssh-gui rpc channel + console session lifecycle',
	);
}

export { apply, inject, name, Config };
export default { apply, inject, name, Config };
//#endregion
