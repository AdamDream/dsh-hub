//#region lib/core.js
/**
 * @local/dsh-ssh-gui —— 纯逻辑核心（无 cordis / 无网络 / 无 ~/.dsh 硬依赖）。
 *
 * 与底座 dsh-workspace-enhancement 的分工：SSH 连接生命周期（注册表 / machines.json /
 * TOFU / sw_* 工具）全在底座；本模块提供「分布式控制」GUI 面的**纯函数与可注入存储**：
 *   1. keyRef 绑定（credentials ref → 0600 PEM 文件的路径/读写/侧表序列化）；
 *   2. exec 参数构造（白名单 / 超时 / cwd / 输出截断 / 期限合并；console 传输另有
 *      lineEnding / 载荷编码 / 静默读）；
 *   3. file 大小上限与 base64 解码（10MB 默认，settings 可配）；
 *   4. 脱敏（私钥路径/口令值 → <redacted>，阈值规则与底座 redactValues 一致）；
 *   5. **统一节点注册表**（nodes.json：ssh 迁移 + serial + serial-tcp 三类；machines.json
 *      双向同步；keyRef 侧表沿用）与三类传输的 target 规范化；
 *   6. **传输分发**（createDispatch：exec.run / file.* / node.status / nodes.* / serial.*
 *      端点按节点 transport 路由——ssh 走底座连接池，serial/serial-tcp 走 console 适配器）。
 *
 * 全部文件路径经参数注入（测试用 os.tmpdir()，host 端用 remoteWorkspacesRoot()），
 * 因此 test/ 可零依赖直跑；错误消息统一走底座的 wire 词汇（bad-request: 前缀）。
 * @module @local/dsh-ssh-gui/core
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/** 默认单文件传输上限（10MB）。 */
export const DEFAULT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** 默认单命令执行超时（30s）。 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
/** 每流（stdout/stderr）输出上限（1MB，超出截断并标记）。 */
export const DEFAULT_EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;
/** 文件操作（stat/read/write）单步兜底超时（120s，防挂死的 RPC 常驻）。 */
export const DEFAULT_FILE_OP_TIMEOUT_MS = 120_000;
/** exec 超时上限（10 分钟，与底座 sw_exec 的 600s 上限一致）。 */
export const EXEC_TIMEOUT_CAP_MS = 600_000;
/** keyRefs 侧表 schema 版本。 */
export const KEYREFS_VERSION = 1;
/** 脱敏替换 token。 */
export const REDACT_TOKEN = '<redacted>';
/** 底座 machine id 文法（parseSshRoute 同款：c1 / tmp-*）。 */
const MACHINE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
/** credentials ref 文法（dsh-credentials REF_PATTERN：POSIX 环境变量名）。 */
const REF_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 串口设备路径名（/dev/ttyUSB0 等）允许的字符（与 dsh-workerspace core 同规则）。 */
export const PORT_NAME_RE = /^[A-Za-z0-9._:/-]+$/;
/** 波特率合法区间（stty 词表覆盖 50–4000000；与 dsh-workerspace core 对齐）。 */
export const BAUD_MIN = 50;
export const BAUD_MAX = 4_000_000;

// ------------------------------------------------------------------ keyRef
/**
 * 校验 machine id 可安全用作密钥文件名（拒绝路径穿越 / 前导点）。
 * 与底座 parseSshRoute 的 id 文法一致；额外拒绝 '.'/'..' 片段。
 * @param id - registry 条目 id（c1、tmp-xxx 等）。
 * @returns 合法返回 true。
 */
export function safeMachineId(id) {
	return (
		typeof id === 'string' &&
		MACHINE_ID_PATTERN.test(id) &&
		!id.startsWith('.') &&
		!id.includes('..')
	);
}

/**
 * 校验 credentials ref 名（dsh-credentials REF_PATTERN，前置检查避免
 * credentialRef() 的 TypeError 以原始形态穿透 RPC 层）。
 * @param refName - 环境变量式引用名（如 MY_SSH_KEY）。
 * @returns 合法返回 true。
 */
export function isRefName(refName) {
	return typeof refName === 'string' && REF_NAME_PATTERN.test(refName);
}

/**
 * 判断解析出的凭据值是否为 PEM 私钥文本（keyRef 只接受私钥内容；
 * 密码类凭据不属于本绑定面，避免把口令写进 0600 文件造成语义错位）。
 * @param value - credentials.resolve() 的 value。
 * @returns 是否形如 PEM 私钥。
 */
export function isPemPrivateKey(value) {
	return (
		typeof value === 'string' &&
		value.includes('-----BEGIN') &&
		/PRIVATE KEY/u.test(value)
	);
}

/**
 * 计算某机器的 0600 密钥文件路径（keysDir/<machineId>）。
 * @param keysDir - 密钥目录（~/.dsh/remote-workspaces/.secrets/keys）。
 * @param machineId - 已校验的 registry 条目 id。
 * @returns 本地文件绝对路径。
 */
export function keyRefPathFor(keysDir, machineId) {
	if (!safeMachineId(machineId)) {
		throw new Error(`bad-request: invalid machine id ${JSON.stringify(machineId)}`);
	}
	return join(keysDir, machineId);
}

/**
 * 读取 keyRefs 侧表（machineId → refName）。缺失/损坏一律回退空表
 * （与底座 loadMachinesState 的容错哲学一致：坏文件留原地，只读新态）。
 * @param file - ssh-keyrefs.json 路径。
 * @returns { version, bindings: Record<machineId, refName> }。
 */
export function readKeyrefsFile(file) {
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8'));
		if (
			parsed !== null &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed) &&
			parsed.bindings !== null &&
			typeof parsed.bindings === 'object' &&
			!Array.isArray(parsed.bindings)
		) {
			const bindings = {};
			for (const [machineId, refName] of Object.entries(parsed.bindings)) {
				if (safeMachineId(machineId) && typeof refName === 'string' && refName !== '') {
					bindings[machineId] = refName;
				}
			}
			return { version: KEYREFS_VERSION, bindings };
		}
	}
	catch {
		// absent / corrupt → empty table
	}
	return { version: KEYREFS_VERSION, bindings: {} };
}

/**
 * 原子化写入 keyRefs 侧表（mkdir -p + 0600）。
 * @param file - ssh-keyrefs.json 路径。
 * @param state - { version, bindings }。
 */
export function writeKeyrefsFile(file, state) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

/**
 * 写入 PEM 密钥文件并显式 0600（umask 纠正：mkdir 0700、write 0600、再 chmod）。
 * @param path - 目标文件（keysDir/<machineId>）。
 * @param pem - PEM 私钥文本。
 */
export function writePemFile(path, pem) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, pem, { mode: 0o600 });
	chmodSync(path, 0o600);
}

/**
 * 删除密钥文件（不存在视为成功——幂等解绑）。
 * @param path - 目标文件。
 */
export function removeKeyFile(path) {
	try {
		unlinkSync(path);
	}
	catch {
		// absent is fine
	}
}

/**
 * 解析侧表绑定为 GUI 视图（含每个 ref 的 configured 状态，值永不出 host）。
 * @param state - readKeyrefsFile 的结果。
 * @param describeRef - async (refName) => { configured, ... }（host 注入 ctx.credentials.describe）。
 * @returns [{ machineId, refName, configured }]。
 */
export async function resolveBindings(state, describeRef) {
	const out = [];
	for (const [machineId, refName] of Object.entries(state.bindings ?? {})) {
		let configured = false;
		try {
			const description = await describeRef(refName);
			configured = description?.configured === true;
		}
		catch {
			configured = false;
		}
		out.push({ machineId, refName, configured });
	}
	return out;
}

/**
 * keyref.set 入参校验（machineId 文法 + refName 文法 + 非空）。
 * @param machineId - registry 条目 id。
 * @param refName - credentials ref 名。
 * @returns 规范化后的 { machineId, refName }。
 */
export function validateKeyRefSet(machineId, refName) {
	if (!safeMachineId(machineId)) {
		throw new Error(`bad-request: invalid machine id ${JSON.stringify(machineId)}`);
	}
	if (!isRefName(refName)) {
		throw new Error(`bad-request: invalid credential ref name ${JSON.stringify(refName)}`);
	}
	return { machineId, refName };
}

// ------------------------------------------------------------------ exec
/**
 * 取命令首 token（白名单判定的粒度：命令名）。
 * @param command - 原始命令文本。
 * @returns 首 token（空命令返回 ''）。
 */
export function firstToken(command) {
	const token = String(command ?? '').trim().split(/\s+/u)[0];
	return token ?? '';
}

/**
 * 命令白名单判定：allowlist 为空 = 不限制（客户端仍二次确认）；
 * 非空 = 首 token 必须在列表内（精确匹配，防 "ls" 放行 "lsusb" 之类的误放）。
 * @param command - 规范化后的命令文本。
 * @param allowlist - settings security.execAllowlist。
 * @returns 是否放行。
 */
export function commandAllowed(command, allowlist) {
	if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
	const token = firstToken(command);
	return allowlist.includes(token);
}

/**
 * 规范化命令：trim + 非空强校验。
 * @param command - 入参。
 * @returns 规范化命令文本。
 */
export function normalizeCommand(command) {
	const text = String(command ?? '').trim();
	if (text === '') {
		throw new Error('bad-request: command must be a non-empty string');
	}
	return text;
}

/**
 * 解析 exec 超时：未给用配置默认；给则须为正整数并钳制到
 * EXEC_TIMEOUT_CAP_MS（与底座 sw_exec 的 600s 上限对齐）。
 * @param requested - 客户端可选的 timeoutMs。
 * @param configDefaultMs - settings exec.timeoutMs。
 * @returns 生效超时毫秒数。
 */
export function effectiveExecTimeout(requested, configDefaultMs) {
	const base =
		Number.isFinite(configDefaultMs) && configDefaultMs > 0
			? configDefaultMs
			: DEFAULT_EXEC_TIMEOUT_MS;
	if (requested === undefined) return base;
	if (!Number.isInteger(requested) || requested <= 0) {
		throw new Error('bad-request: timeoutMs must be a positive integer');
	}
	return Math.min(requested, EXEC_TIMEOUT_CAP_MS);
}

/**
 * 解析 exec cwd：未给用机器的默认远程目录（workspace ?? cwd ?? '/'）；
 * 给了必须是绝对 POSIX 路径。
 * @param spec - registry 机器 spec。
 * @param requested - 客户端可选的 cwd。
 * @returns 生效的绝对远程目录。
 */
export function effectiveExecCwd(spec, requested) {
	if (requested === undefined) return defaultRemoteDir(spec);
	if (typeof requested !== 'string' || !posix.isAbsolute(requested)) {
		throw new Error('bad-request: cwd must be an absolute POSIX path');
	}
	return requested;
}

/**
 * 机器的默认远程目录（workspace 优先，其次 cwd，最后 '/'）。
 * @param spec - registry 机器 spec（可为空）。
 * @returns 绝对 POSIX 路径。
 */
export function defaultRemoteDir(spec) {
	const value = spec?.workspace ?? spec?.cwd ?? '/';
	return posix.isAbsolute(value) ? value : '/';
}

/**
 * 合并调用方 abort 与超时，构造可取消的 deadline（exec 用）。
 * @param timeoutMs - 超时毫秒。
 * @param caller - 调用方 AbortSignal（可缺省）。
 * @returns { signal, timedOut(), dispose() }。
 */
export function makeDeadline(timeoutMs, caller) {
	const controller = new AbortController();
	let timedOut = false;
	const onAbort = () => {
		controller.abort(caller?.reason ?? new Error('aborted'));
	};
	if (caller?.aborted === true) {
		onAbort();
	}
	else {
		caller?.addEventListener('abort', onAbort, { once: true });
	}
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error('exec timeout'));
	}, timeoutMs);
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose() {
			clearTimeout(timer);
			caller?.removeEventListener('abort', onAbort);
		},
	};
}

/**
 * 输出截断：超上限截尾并标记（GUI 面板回显用，防大输出撑爆浏览器）。
 * @param text - 原始输出。
 * @param maxBytes - settings exec.maxOutputBytes。
 * @returns { text, truncated }。
 */
export function capOutput(text, maxBytes) {
	const s = String(text ?? '');
	if (maxBytes <= 0 || s.length <= maxBytes) {
		return { text: s, truncated: false };
	}
	return { text: s.slice(0, maxBytes), truncated: true };
}

/**
 * 给一次异步操作套兜底超时 + 调用方 abort（file 操作防挂死）。
 * @param operation - Promise。
 * @param ms - 兜底毫秒。
 * @param caller - 调用方 AbortSignal（可缺省）。
 * @returns 操作结果，超时/abort 则 reject。
 */
export function withTimeout(operation, ms, caller) {
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`file operation timed out after ${ms}ms`));
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(caller?.reason ?? new Error('aborted'));
		};
		if (caller?.aborted === true) {
			onAbort();
			return;
		}
		caller?.addEventListener('abort', onAbort, { once: true });
		operation.then(
			(value) => {
				clearTimeout(timer);
				caller?.removeEventListener('abort', onAbort);
				resolvePromise(value);
			},
			(error) => {
				clearTimeout(timer);
				caller?.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

// ------------------------------------------------------------------ file
/**
 * 文件大小上限判定（get 前 stat 门 / put 前解码门共用）。
 * @param size - 字节数。
 * @param maxBytes - settings file.maxBytes。
 * @returns 是否放行。
 */
export function validateFileSize(size, maxBytes) {
	return Number.isInteger(size) && size >= 0 && size <= maxBytes;
}

/**
 * 超限错误消息（wire bad-request 前缀由 dispatch 统一剥壳）。
 * @param size - 实际字节数。
 * @param maxBytes - 上限。
 * @returns 错误消息。
 */
export function fileTooLargeMessage(size, maxBytes) {
	return `bad-request: file is ${size} bytes, exceeding the ${maxBytes}-byte limit; use the sw_* tools for large files`;
}

/**
 * 解码 base64 上传载荷并套大小上限（防把大文件整进内存）。
 * @param base64 - base64 文本。
 * @param maxBytes - settings file.maxBytes。
 * @returns Buffer（非空）。
 */
export function decodeBase64Payload(base64, maxBytes) {
	if (typeof base64 !== 'string' || base64.trim() === '') {
		throw new Error('bad-request: base64 payload must be a non-empty string');
	}
	const buf = Buffer.from(base64, 'base64');
	if (buf.length === 0) {
		throw new Error('bad-request: base64 payload decodes to an empty buffer');
	}
	if (!validateFileSize(buf.length, maxBytes)) {
		throw new Error(fileTooLargeMessage(buf.length, maxBytes));
	}
	return buf;
}

/**
 * 远程路径 basename（下载名用；根/尾斜杠等情况返回 null）。
 * @param remotePath - 绝对 POSIX 路径。
 * @returns 文件名或 null。
 */
export function remotePathName(remotePath) {
	const base = posix.basename(String(remotePath ?? ''));
	return base === '' || base === '/' || base === '.' ? null : base;
}

/**
 * 校验远程路径为绝对 POSIX 路径。
 * @param path - 入参。
 * @returns 原样返回。
 */
export function validateRemotePath(path) {
	if (typeof path !== 'string' || !posix.isAbsolute(path)) {
		throw new Error('bad-request: remotePath must be an absolute POSIX path');
	}
	return path;
}

// ------------------------------------------------------------------ redact
/**
 * 从消息中清除敏感值（私钥路径 / 口令 / 口令短语）。
 * 阈值规则与底座 connection.js redactValues 一致：长度 <4 且不含路径分隔符的值
 * 跳过（避免把 1–2 字符的口令误替换进普通文本）。
 * @param message - 待清理文本。
 * @param secrets - 敏感值列表。
 * @returns 清理后的文本。
 */
export function redactText(message, secrets) {
	let out = String(message ?? '');
	const values = Array.isArray(secrets) ? secrets : [];
	for (const value of values) {
		if (typeof value !== 'string' || value === '') continue;
		if (value.length < 4 && !/[\\/]/u.test(value)) continue;
		out = out.split(value).join(REDACT_TOKEN);
	}
	return out;
}

/**
 * 收集一个机器 spec 的敏感值（密码 / 口令短语 / 私钥路径；跳板链口令一并收集）。
 * @param spec - registry 机器 spec（secret-free 视图亦可——字段缺省即无）。
 * @returns 敏感值列表。
 */
export function sensitiveValuesOf(spec) {
	const values = [];
	const push = (value) => {
		if (typeof value === 'string' && value !== '') values.push(value);
	};
	push(spec?.password);
	push(spec?.passphrase);
	push(spec?.privateKeyPath);
	for (const hop of spec?.jump ?? []) {
		push(hop?.password);
		push(hop?.passphrase);
		push(hop?.privateKey);
	}
	return values;
}

/**
 * 把任意抛出的值包装为脱敏后的 Error（transit 层专用）。
 * @param error - 原始错误。
 * @param spec - 用于收集敏感值的机器 spec。
 * @returns 脱敏后的 Error。
 */
export function redactError(error, spec) {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(redactText(message, sensitiveValuesOf(spec)));
}

// ------------------------------------------------------------------ config
/**
 * 把 settings 配置投影为 GUI 安全面（无秘密；客户端经 config.get 读取以
 * 渲染上限/确认开关）。
 * @param config - installSettingsSection 的运行时配置。
 * @returns 规范化投影。
 */
export function sanitizeConfig(config) {
	const file = config?.file ?? {};
	const exec = config?.exec ?? {};
	const security = config?.security ?? {};
	const nodes = config?.nodes ?? {};
	const seed = nodes.seed ?? {};
	return {
		file: {
			maxBytes:
				Number.isFinite(file.maxBytes) && file.maxBytes > 0
					? file.maxBytes
					: DEFAULT_FILE_MAX_BYTES,
		},
		exec: {
			timeoutMs:
				Number.isFinite(exec.timeoutMs) && exec.timeoutMs > 0
					? exec.timeoutMs
					: DEFAULT_EXEC_TIMEOUT_MS,
			maxOutputBytes:
				Number.isFinite(exec.maxOutputBytes) && exec.maxOutputBytes > 0
					? exec.maxOutputBytes
					: DEFAULT_EXEC_MAX_OUTPUT_BYTES,
		},
		security: {
			confirmExec: security.confirmExec !== false,
			execAllowlist: Array.isArray(security.execAllowlist)
				? security.execAllowlist.filter((value) => typeof value === 'string' && value !== '')
				: [],
		},
		// 首启迁移用的 serial / serial-tcp 种子（settings dsh-ssh-gui.nodes.seed.*）。
		// 仅当 nodes.json 不存在时导入；此后 GUI CRUD 是权威。
		nodes: {
			seed: {
				serial: Array.isArray(seed.serial)
					? seed.serial.filter((item) => isRecordValue(item))
					: [],
				serialTcp: Array.isArray(seed.serialTcp)
					? seed.serialTcp.filter((item) => isRecordValue(item))
					: [],
			},
		},
	};
}

// ------------------------------------------------------------------ nodes registry（统一「分布式控制节点」表）
/**
 * 统一节点抽象：node = { id, name, transport, target }，
 * transport ∈ 'ssh://'（远端主机，经底座 sshRegistry）/ 'serial://'（本地 USB 串口，
 * 复用 dsh-workerspace 串口后端）/ 'serial-tcp://'（ser2net/socat 式 TCP 串口服务器，
 * host:port → 远端 /dev/tty，raw TCP）。
 * 持久化：~/.dsh/remote-workspaces/nodes.json（单表；SSH 节点与底座 machines.json 双向
 * 同步，serial / serial-tcp 节点只存在于本表；keyRef 侧表 ssh-keyrefs.json 沿用）。
 */
/** 三类传输（scheme 形态，与需求一致）。 */
export const TRANSPORTS = Object.freeze(['ssh://', 'serial://', 'serial-tcp://']);
/** nodes.json schema 版本。 */
export const NODES_VERSION = 1;
/** 串口控制台：静默判定窗口（无新数据即认为输出结束）。 */
export const CONSOLE_QUIET_MS = 400;
/** 串口控制台：读取轮询间隔。 */
export const CONSOLE_READ_POLL_MS = 50;
/** 串口默认波特率。 */
export const SERIAL_DEFAULT_BAUD = 115200;
/** serial-tcp 目标端口合法区间。 */
export const TCP_PORT_MIN = 1;
export const TCP_PORT_MAX = 65535;
/** serial / serial-tcp 控制台节点自动 id 前缀（避免与底座机器 id c1… 冲突）。 */
export const SERIAL_ID_PREFIX = 's';
export const SERIAL_TCP_ID_PREFIX = 't';

/**
 * 传输类型校验（scheme 形态，如 'ssh://'）。
 * @param value - 候选值。
 * @returns 合法返回 true。
 */
export function isTransport(value) {
	return TRANSPORTS.includes(value);
}

/**
 * 节点 id 文法（与底座机器 id 同规则：字母数字._-，拒前导点与路径穿越）。
 * @param id - 节点 id。
 * @returns 合法返回 true。
 */
export function safeNodeId(id) {
	return (
		typeof id === 'string' &&
		MACHINE_ID_PATTERN.test(id) &&
		!id.startsWith('.') &&
		!id.includes('..')
	);
}

/**
 * 规范化 ssh 目标（target 内只存引用与地址，绝无口令/私钥内容；keyRef 只存 ref 名）。
 * @param target - 候选 target。
 * @returns 规范化 target。
 * @throws {Error} bad-request: 非法。
 */
export function normalizeSshTarget(target) {
	if (!isRecordValue(target)) {
		throw new Error('bad-request: ssh:// node target must be an object');
	}
	if (typeof target.host !== 'string' || target.host.trim() === '') {
		throw new Error('bad-request: ssh:// target requires a non-empty host');
	}
	if (typeof target.username !== 'string' || target.username.trim() === '') {
		throw new Error('bad-request: ssh:// target requires a non-empty username');
	}
	const port = target.port === undefined ? 22 : target.port;
	if (!Number.isInteger(port) || port < TCP_PORT_MIN || port > TCP_PORT_MAX) {
		throw new Error('bad-request: ssh:// target port must be an integer in [1, 65535]');
	}
	const out = { host: target.host.trim(), port, username: target.username.trim() };
	for (const key of ['workspace', 'cwd', 'agent']) {
		if (typeof target[key] === 'string' && target[key] !== '') out[key] = target[key];
	}
	if (typeof target.keyRef === 'string' && isRefName(target.keyRef)) out.keyRef = target.keyRef;
	return out;
}

/**
 * 规范化 serial 目标（本地 USB 串口：设备路径 / 波特率 / 后端）。
 * @param target - 候选 target。
 * @returns 规范化 target。
 * @throws {Error} bad-request: 非法。
 */
export function normalizeSerialTarget(target) {
	if (!isRecordValue(target)) {
		throw new Error('bad-request: serial:// node target must be an object');
	}
	if (typeof target.port !== 'string' || target.port.trim() === '' || !PORT_NAME_RE.test(target.port.trim())) {
		throw new Error('bad-request: serial:// target requires a valid device path like /dev/ttyUSB0');
	}
	const baudRate = target.baudRate === undefined ? SERIAL_DEFAULT_BAUD : target.baudRate;
	if (!Number.isInteger(baudRate) || baudRate < BAUD_MIN || baudRate > BAUD_MAX) {
		throw new Error('bad-request: serial:// target baudRate must be an integer in [50, 4000000]');
	}
	const backend = target.backend ?? 'stty';
	if (backend !== 'stty' && backend !== 'serialport') {
		throw new Error('bad-request: serial:// target backend must be "stty" or "serialport"');
	}
	return { port: target.port.trim(), baudRate, backend };
}

/**
 * 规范化 serial-tcp 目标（TCP 串口服务器：host + 端口 + 可选远端 tty 名）。
 * serial-tcp 是 raw TCP，**无凭据**。
 * @param target - 候选 target。
 * @returns 规范化 target。
 * @throws {Error} bad-request: 非法。
 */
export function normalizeSerialTcpTarget(target) {
	if (!isRecordValue(target)) {
		throw new Error('bad-request: serial-tcp:// node target must be an object');
	}
	if (typeof target.host !== 'string' || target.host.trim() === '') {
		throw new Error('bad-request: serial-tcp:// target requires a non-empty host');
	}
	if (!Number.isInteger(target.port) || target.port < TCP_PORT_MIN || target.port > TCP_PORT_MAX) {
		throw new Error('bad-request: serial-tcp:// target port must be an integer in [1, 65535]');
	}
	const out = { host: target.host.trim(), port: target.port };
	if (typeof target.tty === 'string' && target.tty.trim() !== '') out.tty = target.tty.trim();
	return out;
}

/**
 * 规范化一个节点记录（GUI 输入 / 持久化记录通用）。name 缺省回落 id。
 * @param raw - { id, name?, transport, target }。
 * @returns 规范化节点。
 * @throws {Error} bad-request: 非法。
 */
export function normalizeNode(raw) {
	if (!isRecordValue(raw)) {
		throw new Error('bad-request: node must be an object');
	}
	if (!safeNodeId(raw.id)) {
		throw new Error(`bad-request: invalid node id ${JSON.stringify(raw.id)}`);
	}
	if (!isTransport(raw.transport)) {
		throw new Error(`bad-request: unknown transport ${JSON.stringify(raw.transport)} (expected ssh://, serial:// or serial-tcp://)`);
	}
	let target;
	if (raw.transport === 'ssh://') target = normalizeSshTarget(raw.target);
	else if (raw.transport === 'serial://') target = normalizeSerialTarget(raw.target);
	else target = normalizeSerialTcpTarget(raw.target);
	const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : raw.id;
	return { id: raw.id, name, transport: raw.transport, target };
}

/**
 * 把底座机器记录映射为 ssh 节点（迁移/同步用；keyRef 名来自侧表）。
 * @param machine - 底座 registry 机器 spec（label/host/port/username/workspace/cwd/agent）。
 * @param keyRefName - 侧表绑定（可缺省）。
 * @returns ssh 节点记录。
 */
export function sshNodeFromMachine(machine, keyRefName) {
	const target = {
		host: machine.host,
		port: machine.port,
		username: machine.username,
	};
	for (const key of ['workspace', 'cwd', 'agent']) {
		if (typeof machine[key] === 'string' && machine[key] !== '') target[key] = machine[key];
	}
	if (typeof keyRefName === 'string' && keyRefName !== '') target.keyRef = keyRefName;
	return {
		id: machine.id,
		name: typeof machine.label === 'string' && machine.label !== '' ? machine.label : machine.id,
		transport: 'ssh://',
		target,
	};
}

/** 生成不与现有 id 冲突的 serial/serial-tcp 节点 id（s1… / t1…）。 */
export function nextNodeId(existing, prefix) {
	let index = 1;
	while (existing.has(`${prefix}${index}`)) index += 1;
	return `${prefix}${index}`;
}

/**
 * 首启迁移：machines.json 全量 → ssh 节点 + settings 种子导入 serial / serial-tcp 节点。
 * 仅在 nodes.json 不存在（首启）时调用。
 * @param machines - 底座 machines 列表。
 * @param currentId - 底座 currentId（可 null）。
 * @param keyrefBindings - 侧表 { machineId: refName }。
 * @param seeds - settings 投影 { serial: [...], serialTcp: [...] }。
 * @returns { version, currentId, nodes }。
 */
export function migrateMachinesToNodes(machines, currentId, keyrefBindings, seeds) {
	const nodes = [];
	const ids = new Set();
	for (const machine of Array.isArray(machines) ? machines : []) {
		const node = sshNodeFromMachine(machine, keyrefBindings?.[machine.id]);
		nodes.push(node);
		ids.add(node.id);
	}
	for (const seed of seeds?.serial ?? []) {
		if (!isRecordValue(seed)) continue;
		try {
			const target = normalizeSerialTarget({
				port: seed.port,
				baudRate: seed.baudRate,
				backend: seed.backend,
			});
			const id = typeof seed.id === 'string' && safeNodeId(seed.id) && !ids.has(seed.id)
				? seed.id
				: nextNodeId(ids, SERIAL_ID_PREFIX);
			nodes.push({ id, name: seed.name || id, transport: 'serial://', target });
			ids.add(id);
		}
		catch {
			// 非法种子条目跳过（settings 错误不阻断迁移）
		}
	}
	for (const seed of seeds?.serialTcp ?? []) {
		if (!isRecordValue(seed)) continue;
		try {
			const target = normalizeSerialTcpTarget({ host: seed.host, port: seed.port, tty: seed.tty });
			const id = typeof seed.id === 'string' && safeNodeId(seed.id) && !ids.has(seed.id)
				? seed.id
				: nextNodeId(ids, SERIAL_TCP_ID_PREFIX);
			nodes.push({ id, name: seed.name || id, transport: 'serial-tcp://', target });
			ids.add(id);
		}
		catch {
			// 非法种子条目跳过
		}
	}
	const firstId = nodes[0]?.id ?? null;
	return {
		version: NODES_VERSION,
		currentId: typeof currentId === 'string' && currentId !== '' ? currentId : firstId,
		nodes,
	};
}

/**
 * 与底座 machines.json 同步：ssh 节点 ↔ 底座机器逐 id 对齐（导入缺失、修剪已删、
 * 更新 name/target/keyRef）；serial / serial-tcp 节点只存在于本表，不受影响。
 * @param nodes - 当前节点列表。
 * @param machines - 底座 machines 列表（已解析成功时）。
 * @param keyrefBindings - 侧表 { machineId: refName }。
 * @returns { nodes, changed } 同步后的列表与是否有变化。
 */
export function syncNodesWithMachines(nodes, machines, keyrefBindings) {
	const changed = { value: false };
	const machineById = new Map((Array.isArray(machines) ? machines : []).map((m) => [m.id, m]));
	const out = [];
	for (const node of nodes) {
		if (node.transport === 'ssh://') {
			const machine = machineById.get(node.id);
			if (machine === undefined) {
				changed.value = true; // 底座已删 → 修剪
				continue;
			}
			const updated = sshNodeFromMachine(machine, keyrefBindings?.[machine.id]);
			if (JSON.stringify(updated) !== JSON.stringify(node)) changed.value = true;
			out.push(updated);
			machineById.delete(node.id);
		}
		else {
			out.push(node);
		}
	}
	for (const machine of machineById.values()) {
		out.push(sshNodeFromMachine(machine, keyrefBindings?.[machine.id])); // 底座新增 → 导入
		changed.value = true;
	}
	return { nodes: out, changed: changed.value };
}

/**
 * 读取 nodes.json（缺失/损坏回退空表——与底座 loadMachinesState 容错哲学一致）。
 * @param file - nodes.json 路径。
 * @returns { version, currentId, nodes }。
 */
export function readNodesFile(file) {
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8'));
		if (isRecordValue(parsed) && Array.isArray(parsed.nodes)) {
			const nodes = [];
			for (const raw of parsed.nodes) {
				try {
					nodes.push(normalizeNode(raw));
				}
				catch {
					// 非法条目过滤
				}
			}
			return {
				version: NODES_VERSION,
				currentId: typeof parsed.currentId === 'string' ? parsed.currentId : null,
				nodes,
			};
		}
	}
	catch {
		// absent / corrupt → empty table
	}
	return { version: NODES_VERSION, currentId: null, nodes: [] };
}

/**
 * 原子化写入 nodes.json（mkdir -p + 0600）。
 * @param file - nodes.json 路径。
 * @param state - { version, currentId, nodes }。
 */
export function writeNodesFile(file, state) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

/**
 * 节点 GUI 视图（nodes.list 返回；ssh target 只含引用/地址，绝无秘密）。
 * @param node - 规范化节点。
 * @returns 视图记录。
 */
export function nodeView(node) {
	return { id: node.id, name: node.name, transport: node.transport, target: { ...node.target } };
}

// ------------------------------------------------------------------ console transports（serial:// 与 serial-tcp:// 共用语义）
/** lineEnding 词表（与 ws_serial_send 一致）。 */
const LINE_ENDING_SUFFIX = Object.freeze({ none: '', lf: '\n', cr: '\r', crlf: '\r\n' });

/**
 * 解析 console 传输的 lineEnding（exec.run 可选参数）。
 * @param value - 'none' | 'lf' | 'cr' | 'crlf'（缺省 'lf'）。
 * @returns 后缀字符串。
 * @throws {Error} bad-request: 非法。
 */
export function consoleLineEnding(value) {
	if (value === undefined) return LINE_ENDING_SUFFIX.lf;
	if (typeof value !== 'string' || !(value in LINE_ENDING_SUFFIX)) {
		throw new Error('bad-request: lineEnding must be one of none/lf/cr/crlf');
	}
	return LINE_ENDING_SUFFIX[value];
}

/**
 * 把 console 发送载荷编码为字节（text：UTF-8 + lineEnding；hex：raw）。
 * @param data - 载荷文本。
 * @param encoding - 'text'（默认）| 'hex'。
 * @param suffix - lineEnding 后缀（consoleLineEnding 的结果）。
 * @returns Buffer（非空）。
 * @throws {Error} bad-request: 非法。
 */
export function encodeConsolePayload(data, encoding, suffix) {
	const text = String(data ?? '');
	if (encoding === 'hex') {
		const cleaned = text.replace(/\s+/g, '');
		if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
			throw new Error('bad-request: hex payload must be pairs of hex digits (whitespace allowed)');
		}
		const buf = Buffer.from(cleaned, 'hex');
		if (buf.length === 0) throw new Error('bad-request: nothing to send (empty payload)');
		return buf;
	}
	if (encoding !== 'text' && encoding !== undefined) {
		throw new Error('bad-request: encoding must be "text" or "hex"');
	}
	if (text === '') throw new Error('bad-request: nothing to send (empty payload)');
	return Buffer.from(text + (suffix ?? ''), 'utf8');
}

/**
 * exec.run 的 console 传输入参校验：cwd 只对 ssh:// 有意义。
 * @param input - exec.run 载荷（已通过 isExecPayload）。
 * @param transport - 节点传输。
 * @throws {Error} bad-request: console 传输给了 cwd。
 */
export function assertConsoleExecCwd(input, transport) {
	if (input.cwd !== undefined) {
		throw new Error(`bad-request: cwd is only valid for ssh:// nodes, not ${transport}`);
	}
}

// ------------------------------------------------------------------ dispatch
/**
 * wire 词汇与载荷校验（与底座 web.js 同款，host 端 index.js 与 test 共用）。
 */
/** 未知抛值的消息提取。 */
export function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** guard 拒绝时抛 wire 词汇错误。 */
export function requirePayload(payload, guard, what) {
	if (!guard(payload)) {
		throw new Error(`bad-request: ${what} payload is invalid`);
	}
	return payload;
}
/** 把通道失败映射到底座的 wire 错误词汇（客户端 transport 校验 code/细节形状）。 */
export function wireError(code, message) {
	if (code === 'bad-request') {
		return { ok: false, error: { code, message, details: { issues: [] } } };
	}
	return { ok: false, error: { code: 'connection-failed', message, details: {} } };
}
export const isRecordValue = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringValue = (value) => typeof value === 'string';
/** `{ id }` 载荷。 */
function isIdPayload(value) {
	return isRecordValue(value) && isStringValue(value.id) && value.id.trim() !== '';
}
/** `{ id, path? }` 载荷（file.list）。 */
function isBrowsePayload(value) {
	return (
		isRecordValue(value) &&
		isStringValue(value.id) &&
		value.id.trim() !== '' &&
		(value.path === undefined || isStringValue(value.path))
	);
}
/** `{ id?, command, cwd?, timeoutMs?, lineEnding? }` 载荷（lineEnding 仅 console 传输用）。 */
function isExecPayload(value) {
	if (!isRecordValue(value)) return false;
	if (!isStringValue(value.command) || value.command.trim() === '') return false;
	if (value.id !== undefined && (!isStringValue(value.id) || value.id.trim() === '')) return false;
	if (value.cwd !== undefined && !isStringValue(value.cwd)) return false;
	if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || !Number.isInteger(value.timeoutMs))) {
		return false;
	}
	if (value.lineEnding !== undefined && !isStringValue(value.lineEnding)) return false;
	return true;
}
/** `{ id, remotePath }` 载荷（file.get）。 */
function isFileGetPayload(value) {
	return isRecordValue(value) && isStringValue(value.id) && value.id.trim() !== '' && isStringValue(value.remotePath);
}
/** `{ id, remotePath, base64 }` 载荷（file.put）。 */
function isFilePutPayload(value) {
	return (
		isRecordValue(value) &&
		isStringValue(value.id) &&
		value.id.trim() !== '' &&
		isStringValue(value.remotePath) &&
		isStringValue(value.base64)
	);
}
/** `{ machineId, refName }` 载荷（keyref.set）。 */
function isKeyRefSetPayload(value) {
	return (
		isRecordValue(value) &&
		isStringValue(value.machineId) &&
		value.machineId.trim() !== '' &&
		isStringValue(value.refName) &&
		value.refName.trim() !== ''
	);
}
/** `{ node, password?, keyRef? }` 载荷（nodes.add；node 含 id/transport/target）。 */
function isNodeAddPayload(value) {
	if (!isRecordValue(value)) return false;
	if (!isRecordValue(value.node)) return false;
	if (value.node.id !== undefined && (typeof value.node.id !== 'string' || value.node.id.trim() === '')) return false;
	if (typeof value.node.transport !== 'string' || value.node.transport.trim() === '') return false;
	if (value.password !== undefined && !isStringValue(value.password)) return false;
	if (value.keyRef !== undefined && !isStringValue(value.keyRef)) return false;
	return true;
}
/** `{ id, data, encoding?, lineEnding? }` 载荷（serial.send）。 */
function isSerialSendPayload(value) {
	return (
		isRecordValue(value) &&
		isStringValue(value.id) &&
		value.id.trim() !== '' &&
		isStringValue(value.data)
	);
}
/** `{ id, maxBytes?, timeoutMs?, encoding? }` 载荷（serial.read）。 */
function isSerialReadPayload(value) {
	if (!isRecordValue(value)) return false;
	if (!isStringValue(value.id) || value.id.trim() === '') return false;
	if (value.maxBytes !== undefined && !Number.isFinite(value.maxBytes)) return false;
	if (value.timeoutMs !== undefined && !Number.isFinite(value.timeoutMs)) return false;
	if (value.encoding !== undefined && !isStringValue(value.encoding)) return false;
	return true;
}

/**
 * 构造 `/ssh-gui` 端点分发器（unary，JSON；通道名沿用 /ssh-gui，现为「分布式控制」
 * 的统一通道）。全部外部面经 env 注入：
 *  - cfg()：settings 投影（sanitizeConfig 结果，含 nodes.seed）；
 *  - registry.{ listMachines, get, getActive, saveMachine }：底座 sshRegistry 薄封装；
 *  - credentials.{ resolve, describe }：dsh-credentials 薄封装；
 *  - keysDir() / keyrefsFile()：密钥目录与侧表路径；
 *  - nodesFile()：统一节点表 nodes.json 路径（**可选**；缺省时 nodes.* 端点报
 *    bad-request，exec/file 退化为纯 ssh 行为——legacy 测试/无节点表的部署兼容）；
 *  - console：串口/串口-TCP 控制台适配器（**可选**；serial:// 与 serial-tcp:// 节点
 *    的 exec/serial.* 端点需要）：{ open, send, currentOffset, read, stats, close,
 *    ports }；
 *  - resolveTarget(id)：ssh 路径 `{ spec, connection }`（id 缺省 → 活动机；未知抛错）；
 *  - connectionExec(connection, command, opts)：connection.exec 封装；
 *  - statFile / readFileOf / writeFileOf / readdirOf (sftp, path[, signal])：SFTP 读写；
 *  - remoteHomeOf(connection, signal)：远程 HOME；
 *  - registryStatus(id) / registryProbe(id) / registryRemove(id) /
 *    registrySetCurrent(id)（**可选**）：node.status / nodes.test / nodes.remove /
 *    nodes.setCurrent 的 ssh 分支；
 *  - auditLog(line)（**可选**）：exec.run 审计日志行（host 端落盘，test 注入收集器）；
 *  - listLimit / fileOpTimeoutMs：上限与兜底超时（可缺省走默认）。
 *
 * 因此 host 端 index.js 只做接线，test/ 用 fake 直测端点语义与安全闸。
 * @param env - 注入面。
 * @returns (endpoint, payload, signal) => Promise<wire result>。
 */
export function createDispatch(env) {
	const listLimit = Number.isFinite(env.listLimit) && env.listLimit > 0 ? env.listLimit : 1000;
	const nodesFileAvailable = typeof env.nodesFile === 'function';
	const audit = typeof env.auditLog === 'function' ? env.auditLog : async () => {};

	/** 统一节点表：machines.json（ssh 权威）→ nodes.json 同步/迁移（serial、serial-tcp 仅本表）。 */
	const loadUnifiedNodes = () => {
		if (!nodesFileAvailable) return undefined;
		const file = env.nodesFile();
		let state = readNodesFile(file);
		const machinesState =
			typeof env.registry?.listMachines === 'function'
				? env.registry.listMachines()
				: { machines: [], currentId: null };
		const machines = Array.isArray(machinesState.machines) ? machinesState.machines : [];
		const bindings = readKeyrefsFile(env.keyrefsFile()).bindings;
		if (!existsSync(file)) {
			// 首启：machines 迁移 + settings 种子导入 serial / serial-tcp
			state = migrateMachinesToNodes(machines, machinesState.currentId, bindings, env.cfg().nodes.seed);
			writeNodesFile(file, state);
			return state;
		}
		const { nodes, changed } = syncNodesWithMachines(state.nodes, machines, bindings);
		if (changed) {
			state = { ...state, nodes };
			writeNodesFile(file, state);
		}
		return state;
	};
	/** 按 id 查节点（nodes.json 只读；ssh 机器未同步时返回 undefined → 走 legacy ssh 路径）。 */
	const resolveNode = (id) => {
		if (!nodesFileAvailable || id === undefined) return undefined;
		return readNodesFile(env.nodesFile()).nodes.find((node) => node.id === id.trim());
	};
	/** exec.run 目标解析：显式 id 优先查统一表；缺省用统一表 current 节点；否则 legacy ssh 活动机。 */
	const resolveExecNode = (id) => {
		if (id !== undefined) {
			return resolveNode(id);
		}
		if (nodesFileAvailable) {
			const state = loadUnifiedNodes();
			if (state?.currentId !== null && state?.currentId !== undefined) {
				return state.nodes.find((node) => node.id === state.currentId);
			}
		}
		return undefined;
	};
	/** 人类可读的节点目标描述（nodes.test / node.status detail）。 */
	const describeNode = (node) => {
		if (node.transport === 'ssh://') {
			return `${node.target.username}@${node.target.host}:${node.target.port}`;
		}
		if (node.transport === 'serial://') {
			return `${node.target.port} @ ${node.target.baudRate} (${node.target.backend})`;
		}
		return `${node.target.host}:${node.target.port}${node.target.tty ? ` → ${node.target.tty}` : ''}`;
	};
	/** console 传输判定。 */
	const isConsoleNode = (node) => node?.transport === 'serial://' || node?.transport === 'serial-tcp://';
	/** serial.* 端点共用的节点解析（只接受 console 节点）。 */
	const requireConsoleNode = (id) => {
		const node = resolveNode(id);
		if (node === undefined) {
			throw new Error(`bad-request: unknown node id ${JSON.stringify(id)}`);
		}
		if (!isConsoleNode(node)) {
			throw new Error(`bad-request: node ${JSON.stringify(id)} is ${node.transport}, not a serial console node`);
		}
		if (env.console === undefined) {
			throw new Error('bad-request: console adapter unavailable (serial/serial-tcp transport not wired)');
		}
		return node;
	};
	/** exec.run 的 console 执行（serial:// 与 serial-tcp:// 共用：open → send → read-until-quiet）。 */
	const runConsoleExec = async (input, command, node, timeoutMs, signal) => {
		if (env.console === undefined) {
			throw new Error('bad-request: console adapter unavailable (serial/serial-tcp transport not wired)');
		}
		assertConsoleExecCwd(input, node.transport);
		const suffix = consoleLineEnding(input.lineEnding);
		const bytes = encodeConsolePayload(command, 'text', suffix);
		const deadline = makeDeadline(timeoutMs, signal);
		let read;
		try {
			await env.console.open(node, deadline.signal);
			const offset = env.console.currentOffset(node);
			await env.console.send(node, bytes, deadline.signal);
			read = await env.console.read(node, {
				fromOffset: offset,
				timeoutMs,
				quietMs: CONSOLE_QUIET_MS,
				maxBytes: env.cfg().exec.maxOutputBytes,
				signal: deadline.signal,
			});
		}
		catch (error) {
			if (error?.name === 'AbortError') {
				throw new Error(
					deadline.timedOut()
						? `connection-failed: console command timed out after ${timeoutMs}ms`
						: 'connection-failed: console command aborted',
				);
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
		finally {
			deadline.dispose();
		}
		const stdout = capOutput(read.buf.toString('utf8'), env.cfg().exec.maxOutputBytes);
		return {
			exitCode: null,
			signal: null,
			stdout: stdout.text,
			stderr: '',
			truncated: stdout.truncated || read.moreAvailable,
			timedOut: read.timedOut,
			timeoutMs,
			transport: node.transport,
		};
	};

	const dispatch = async (endpoint, payload, signal) => {
		try {
			switch (endpoint) {
				case 'config.get': {
					return { ok: true, value: env.cfg() };
				}
				case 'nodes.list': {
					const state = loadUnifiedNodes();
					if (state === undefined) {
						throw new Error('bad-request: nodes registry is unavailable (nodesFile not wired)');
					}
					return {
						ok: true,
						value: {
							nodes: state.nodes.map(nodeView),
							currentId: state.currentId,
							transports: TRANSPORTS,
						},
					};
				}
				case 'nodes.add': {
					const input = requirePayload(payload, isNodeAddPayload, 'nodes.add');
					const state = loadUnifiedNodes();
					if (state === undefined) {
						throw new Error('bad-request: nodes registry is unavailable (nodesFile not wired)');
					}
					// id 缺省 = 新建：serial/serial-tcp 本地生成（s1…/t1…），ssh 交给底座
					// saveMachine 生成（id 在 saveMachine 后回填）。
					let node;
					if (input.node.transport !== 'ssh://' || input.node.id !== undefined) {
						let id = input.node.id;
						if (id === undefined) {
							const existing = new Set(state.nodes.map((item) => item.id));
							id = input.node.transport === 'serial://'
								? nextNodeId(existing, SERIAL_ID_PREFIX)
								: nextNodeId(existing, SERIAL_TCP_ID_PREFIX);
						}
						node = normalizeNode({ ...input.node, id });
					}
					else {
						node = {
							id: '',
							name: typeof input.node.name === 'string' && input.node.name.trim() !== '' ? input.node.name.trim() : '',
							transport: 'ssh://',
							target: normalizeSshTarget(input.node.target),
						};
					}
					if (input.password !== undefined && node.transport !== 'ssh://') {
						throw new Error('bad-request: password is only valid for ssh:// nodes');
					}
					if (input.keyRef !== undefined && node.transport !== 'ssh://') {
						throw new Error('bad-request: keyRef is only valid for ssh:// nodes');
					}
					let created = node;
					if (node.transport === 'ssh://') {
						// 写穿底座 machines.json（sw_* / 底座目录流保持一致），再同步进 nodes.json
						const machineSpec = {
							...(node.id !== '' ? { id: node.id } : {}),
							...(node.name !== '' && node.name !== node.id ? { label: node.name } : {}),
							host: node.target.host,
							username: node.target.username,
							port: node.target.port,
						};
						for (const key of ['workspace', 'cwd', 'agent']) {
							if (node.target[key] !== undefined) machineSpec[key] = node.target[key];
						}
						if (input.password) machineSpec.password = input.password;
						const saved = await env.registry.saveMachine(machineSpec);
						const machineId = saved?.id ?? node.id;
						if (input.keyRef) {
							await dispatch('keyref.set', { machineId, refName: input.keyRef });
						}
						const synced = loadUnifiedNodes();
						created = synced.nodes.find((item) => item.id === machineId);
						if (created === undefined) {
							throw new Error('connection-failed: machine saved but node sync failed');
						}
						if (synced.currentId === null) {
							writeNodesFile(env.nodesFile(), { ...synced, currentId: created.id });
						}
					}
					else {
						const existing = state.nodes.find((item) => item.id === node.id);
						const next = existing
							? state.nodes.map((item) => (item.id === node.id ? node : item))
							: [...state.nodes, node];
						writeNodesFile(env.nodesFile(), {
							version: NODES_VERSION,
							currentId: state.currentId ?? node.id,
							nodes: next,
						});
					}
					return { ok: true, value: { node: nodeView(created) } };
				}
				case 'nodes.remove': {
					const input = requirePayload(payload, isIdPayload, 'nodes.remove');
					const id = input.id.trim();
					const state = loadUnifiedNodes();
					if (state === undefined) {
						throw new Error('bad-request: nodes registry is unavailable (nodesFile not wired)');
					}
					const node = state.nodes.find((item) => item.id === id);
					if (node === undefined) {
						throw new Error(`bad-request: unknown node id ${JSON.stringify(id)}`);
					}
					if (node.transport === 'ssh://') {
						if (typeof env.registryRemove === 'function') {
							await env.registryRemove(id);
						}
						else if (typeof env.registry?.remove === 'function') {
							await env.registry.remove(id);
						}
						// keyRef 生命周期清理（侧表 + 密钥文件 + machines.json privateKeyPath）
						await dispatch('keyref.unbind', { id });
					}
					else if (env.console !== undefined) {
						try {
							await env.console.close(node, signal);
						}
						catch {
							// best-effort：会话已坏也照常删除节点
						}
					}
					const next = state.nodes.filter((item) => item.id !== id);
					writeNodesFile(env.nodesFile(), {
						...state,
						nodes: next,
						currentId: state.currentId === id ? (next[0]?.id ?? null) : state.currentId,
					});
					return { ok: true, value: { ok: true, id, transport: node.transport } };
				}
				case 'nodes.setCurrent': {
					const input = requirePayload(payload, isIdPayload, 'nodes.setCurrent');
					const id = input.id.trim();
					const state = loadUnifiedNodes();
					if (state === undefined) {
						throw new Error('bad-request: nodes registry is unavailable (nodesFile not wired)');
					}
					if (!state.nodes.some((item) => item.id === id)) {
						throw new Error(`bad-request: unknown node id ${JSON.stringify(id)}`);
					}
					if (typeof env.registrySetCurrent === 'function') {
						try {
							await env.registrySetCurrent(id);
						}
						catch {
							// best-effort：面板 current 以 nodes.json 为准
						}
					}
					writeNodesFile(env.nodesFile(), { ...state, currentId: id });
					return { ok: true, value: { ok: true, currentId: id } };
				}
				case 'nodes.test': {
					const input = requirePayload(payload, isIdPayload, 'nodes.test');
					const id = input.id.trim();
					const node = resolveNode(id);
					if (node === undefined) {
						throw new Error(`bad-request: unknown node id ${JSON.stringify(id)}`);
					}
					if (node.transport === 'ssh://') {
						if (typeof env.registryProbe !== 'function') {
							throw new Error('bad-request: registry probe unavailable for ssh:// nodes');
						}
						try {
							const probe = await env.registryProbe(id);
							const ok = probe?.state === 'active';
							return {
								ok: true,
								value: {
									transport: 'ssh://',
									ok,
									state: probe?.state ?? 'unknown',
									detail: ok ? `ssh ${describeNode(node)} 可达` : `ssh ${describeNode(node)} 不可达`,
								},
							};
						}
						catch (error) {
							return { ok: true, value: { transport: 'ssh://', ok: false, detail: `probe failed: ${messageOf(error)}` } };
						}
					}
					if (env.console === undefined) {
						throw new Error('bad-request: console adapter unavailable (serial/serial-tcp transport not wired)');
					}
					try {
						const opened = await env.console.open(node, signal);
						const stats = env.console.stats(node);
						await env.console.close(node, signal);
						return {
							ok: true,
							value: {
								transport: node.transport,
								ok: true,
								state: 'open',
								detail: `${node.transport} ${describeNode(node)} 连通${opened.logPath ? `；日志 ${opened.logPath}` : ''}`,
								logPath: opened.logPath,
								receivedBytes: stats.receivedBytes,
								sentBytes: stats.sentBytes,
							},
						};
					}
					catch (error) {
						return { ok: true, value: { transport: node.transport, ok: false, detail: messageOf(error) } };
					}
				}
				case 'node.status': {
					const input = requirePayload(payload, isIdPayload, 'node.status');
					const id = input.id.trim();
					const node = resolveNode(id);
					if (node === undefined) {
						throw new Error(`bad-request: unknown node id ${JSON.stringify(id)}`);
					}
					if (node.transport === 'ssh://') {
						const status = typeof env.registryStatus === 'function' ? await env.registryStatus(id) : undefined;
						return { ok: true, value: { id, transport: 'ssh://', state: status?.state ?? 'unknown', ...(status ?? {}) } };
					}
					const stats = env.console !== undefined ? env.console.stats(node) : { state: 'unknown' };
					return { ok: true, value: { id, transport: node.transport, ...stats } };
				}
				case 'keyref.list': {
					const state = readKeyrefsFile(env.keyrefsFile());
					const bindings = await resolveBindings(state, async (refName) => {
						try {
							return await env.credentials.describe(refName);
						}
						catch {
							return undefined;
						}
					});
					return { ok: true, value: { bindings } };
				}
				case 'keyref.set': {
					const input = requirePayload(payload, isKeyRefSetPayload, 'keyref.set');
					const { machineId, refName } = validateKeyRefSet(input.machineId, input.refName);
					const machine = env.registry
						.listMachines()
						.machines.find((item) => item.id === machineId);
					if (machine === undefined) {
						throw new Error('bad-request: unknown machine id');
					}
					const resolved = await env.credentials.resolve(refName);
					const pem = resolved?.value;
					if (typeof pem !== 'string' || !isPemPrivateKey(pem)) {
						throw new Error(
							`bad-request: credential ref ${JSON.stringify(refName)} is not a PEM private key ` +
							'(configure ~/.dsh/.credentials.yaml and retry)',
						);
					}
					const keyFile = keyRefPathFor(env.keysDir(), machineId);
					writePemFile(keyFile, pem);
					const state = readKeyrefsFile(env.keyrefsFile());
					state.bindings[machineId] = refName;
					writeKeyrefsFile(env.keyrefsFile(), state);
					// 绑定 privateKeyPath：upsert 从 prev 全量出发，其余字段保持。
					const saved = await env.registry.saveMachine({
						id: machineId,
						host: machine.host,
						username: machine.username,
						port: machine.port,
						privateKeyPath: keyFile,
					});
					if (nodesFileAvailable) {
						const ns = readNodesFile(env.nodesFile());
						const index = ns.nodes.findIndex((item) => item.id === machineId);
						if (index >= 0) {
							ns.nodes[index].target.keyRef = refName;
							writeNodesFile(env.nodesFile(), ns);
						}
					}
					return { ok: true, value: { ok: true, machine: saved } };
				}
				case 'keyref.unbind': {
					const input = requirePayload(payload, isIdPayload, 'keyref.unbind');
					const machineId = input.id.trim();
					const state = readKeyrefsFile(env.keyrefsFile());
					const had = state.bindings[machineId] !== undefined;
					if (had) {
						delete state.bindings[machineId];
						writeKeyrefsFile(env.keyrefsFile(), state);
					}
					removeKeyFile(keyRefPathFor(env.keysDir(), machineId));
					if (nodesFileAvailable) {
						const ns = readNodesFile(env.nodesFile());
						const index = ns.nodes.findIndex((item) => item.id === machineId);
						if (index >= 0 && ns.nodes[index].target.keyRef !== undefined) {
							delete ns.nodes[index].target.keyRef;
							writeNodesFile(env.nodesFile(), ns);
						}
					}
					const machine = env.registry
						.listMachines()
						.machines.find((item) => item.id === machineId);
					if (machine !== undefined) {
						// 显式 '' = 清除 privateKeyPath（applyInputFieldsInto 语义）。
						await env.registry.saveMachine({
							id: machineId,
							host: machine.host,
							username: machine.username,
							port: machine.port,
							privateKeyPath: '',
						});
					}
					return { ok: true, value: { ok: true, had } };
				}
				case 'exec.run': {
					const input = requirePayload(payload, isExecPayload, 'exec.run');
					const command = normalizeCommand(input.command);
					const allowlist = env.cfg().security.execAllowlist;
					if (!commandAllowed(command, allowlist)) {
						throw new Error(
							`bad-request: command is not in the exec allowlist ` +
							`(allowed: ${allowlist.join(', ') || '(none configured)'})`,
						);
					}
					const timeoutMs = effectiveExecTimeout(input.timeoutMs, env.cfg().exec.timeoutMs);
					const node = resolveExecNode(input.id);
					if (isConsoleNode(node)) {
						const value = await runConsoleExec(input, command, node, timeoutMs, signal);
						await audit({
							node: node.id,
							transport: node.transport,
							command,
							exitCode: null,
							timedOut: value.timedOut,
							truncated: value.truncated,
						});
						return { ok: true, value };
					}
					const target = env.resolveTarget(input.id);
					const cwd = effectiveExecCwd(target.spec, input.cwd);
					const deadline = makeDeadline(timeoutMs, signal);
					let outcome;
					try {
						outcome = await env.connectionExec(target.connection, command, {
							signal: deadline.signal,
							cwd,
						});
					}
					catch (error) {
						if (error?.name === 'AbortError') {
							throw new Error(
								deadline.timedOut()
									? `connection-failed: command timed out after ${timeoutMs}ms`
									: 'connection-failed: command aborted',
							);
						}
						throw redactError(error, target.spec);
					}
					finally {
						deadline.dispose();
					}
					const maxOut = env.cfg().exec.maxOutputBytes;
					const stdout = capOutput(outcome.stdout, maxOut);
					const stderr = capOutput(outcome.stderr, maxOut);
					await audit({
						node: target.spec?.id ?? input.id,
						transport: 'ssh://',
						command,
						exitCode: outcome.exitCode,
						timedOut: deadline.timedOut(),
						truncated: stdout.truncated || stderr.truncated,
					});
					return {
						ok: true,
						value: {
							exitCode: outcome.exitCode,
							signal: outcome.signal ?? null,
							stdout: stdout.text,
							stderr: stderr.text,
							truncated: stdout.truncated || stderr.truncated,
							timedOut: deadline.timedOut(),
							timeoutMs,
						},
					};
				}
				case 'serial.ports': {
					const ports = env.console !== undefined && typeof env.console.ports === 'function'
						? await env.console.ports()
						: [];
					return { ok: true, value: { ports } };
				}
				case 'serial.open': {
					const input = requirePayload(payload, isIdPayload, 'serial.open');
					const node = requireConsoleNode(input.id.trim());
					const opened = await env.console.open(node, signal);
					return { ok: true, value: { ok: true, id: node.id, transport: node.transport, ...opened } };
				}
				case 'serial.send': {
					const input = requirePayload(payload, isSerialSendPayload, 'serial.send');
					const node = requireConsoleNode(input.id.trim());
					const suffix = consoleLineEnding(input.lineEnding);
					const bytes = encodeConsolePayload(input.data, input.encoding ?? 'text', suffix);
					const sent = await env.console.send(node, bytes, signal);
					return { ok: true, value: { ok: true, sentBytes: sent.sentBytes, encoding: input.encoding ?? 'text' } };
				}
				case 'serial.read': {
					const input = requirePayload(payload, isSerialReadPayload, 'serial.read');
					const node = requireConsoleNode(input.id.trim());
					const encoding = input.encoding ?? 'text';
					const maxBytes = Number.isFinite(input.maxBytes) && input.maxBytes > 0 ? input.maxBytes : 4096;
					const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 0;
					const read = await env.console.read(node, {
						fromOffset: null,
						timeoutMs,
						quietMs: 0,
						maxBytes,
						signal,
					});
					const rendered =
						encoding === 'hex'
							? read.buf.toString('hex').replace(/(..)/gu, '$1 ').trim()
							: read.buf.toString('utf8');
					return {
						ok: true,
						value: {
							data: rendered,
							encoding,
							moreAvailable: read.moreAvailable,
							totalReceived: read.totalReceived,
							lossy: read.lossy,
						},
					};
				}
				case 'serial.close': {
					const input = requirePayload(payload, isIdPayload, 'serial.close');
					const node = requireConsoleNode(input.id.trim());
					const closed = await env.console.close(node, signal);
					return { ok: true, value: { ok: true, id: node.id, transport: node.transport, ...closed } };
				}
				case 'file.list': {
					const input = requirePayload(payload, isBrowsePayload, 'file.list');
					const node = resolveNode(input.id.trim());
					if (isConsoleNode(node)) {
						throw new Error(
							`bad-request: transport ${node.transport} does not support file operations; use an ssh:// node for file transfer`,
						);
					}
					const connection = env.registry.get(input.id.trim());
					if (connection === undefined) {
						throw new Error(`bad-request: unknown machine id ${JSON.stringify(input.id.trim())}`);
					}
					const sftp = await env.sftpOf(connection, signal);
					const home = await env.remoteHomeOf(connection, signal);
					const target = input.path ?? home;
					if (!posix.isAbsolute(target)) {
						throw new Error(`bad-request: cannot list a non-absolute path ${JSON.stringify(target)}`);
					}
					const listed = await env.readdirOf(sftp, target, signal);
					const entries = listed
						.filter((entry) => entry.filename !== '.' && entry.filename !== '..')
						.slice(0, listLimit)
						.map((entry) => ({
							name: entry.filename,
							path: posix.join(target, entry.filename),
							isDir: entry.attrs?.isDirectory?.() === true,
							size: entry.attrs?.size ?? 0,
							hidden: entry.filename.startsWith('.'),
						}));
					return {
						ok: true,
						value: { path: target, home, entries, truncated: listed.length > listLimit },
					};
				}
				case 'file.get': {
					const input = requirePayload(payload, isFileGetPayload, 'file.get');
					const node = resolveNode(input.id.trim());
					if (isConsoleNode(node)) {
						throw new Error(
							`bad-request: transport ${node.transport} does not support file operations; use an ssh:// node for file transfer`,
						);
					}
					const connection = env.registry.get(input.id.trim());
					if (connection === undefined) {
						throw new Error(`bad-request: unknown machine id ${JSON.stringify(input.id.trim())}`);
					}
					const remotePath = validateRemotePath(input.remotePath);
					const sftp = await env.sftpOf(connection, signal);
					const stat = await env.statFile(sftp, remotePath, signal);
					if (stat?.isFile?.() !== true) {
						throw new Error('bad-request: remotePath is not a regular file');
					}
					const maxBytes = env.cfg().file.maxBytes;
					if (!validateFileSize(stat.size, maxBytes)) {
						throw new Error(fileTooLargeMessage(stat.size, maxBytes));
					}
					const buf = await env.readFileOf(sftp, remotePath, signal);
					return {
						ok: true,
						value: {
							name: remotePathName(remotePath) ?? remotePath,
							size: buf.length,
							base64: buf.toString('base64'),
						},
					};
				}
				case 'file.put': {
					const input = requirePayload(payload, isFilePutPayload, 'file.put');
					const node = resolveNode(input.id.trim());
					if (isConsoleNode(node)) {
						throw new Error(
							`bad-request: transport ${node.transport} does not support file operations; use an ssh:// node for file transfer`,
						);
					}
					const connection = env.registry.get(input.id.trim());
					if (connection === undefined) {
						throw new Error(`bad-request: unknown machine id ${JSON.stringify(input.id.trim())}`);
					}
					const remotePath = validateRemotePath(input.remotePath);
					const buf = decodeBase64Payload(input.base64, env.cfg().file.maxBytes);
					const sftp = await env.sftpOf(connection, signal);
					await env.writeFileOf(sftp, remotePath, buf, signal);
					return { ok: true, value: { ok: true, size: buf.length, path: remotePath } };
				}
				default:
					throw new Error(`bad-request: unknown endpoint ${JSON.stringify(endpoint)}`);
			}
		}
		catch (error) {
			const message = messageOf(error);
			const code = message.startsWith('bad-request:') ? 'bad-request' : 'connection-failed';
			return wireError(code, message.replace(/^bad-request: /u, ''));
		}
	};
	return dispatch;
}
//#endregion
