//#region lib/serial-tcp.js
/**
 * serial-tcp:// 传输会话（ser2net / socat 式 TCP 串口服务器）。
 *
 * 语义与 dsh-workerspace 的 SerialSession（serial:// 后端）对齐——同一会话式接口
 * （open / write / readSince / stats / close），因此「分布式控制」的 console 适配器
 * 可以把 serial:// 与 serial-tcp:// 两类节点统一处理：
 *   - serial://        → 复用 @local/dsh-workerspace/lib/serial.js 的 SerialSession
 *                        （stty / serialport 后端，模块解析见 index.js）；
 *   - serial-tcp://    → 本模块：net.connect(host:port) → raw 字节收发。
 *
 * 会话：每个节点同时最多一个会话；持有 ring 缓冲（上限 1 MiB，丢头保留尾）、
 * 收发字节计数与日志文件（serial-tcp-<name>-<ts>.log，追加 hex+可打印文本行，
 * 与 SerialSession.formatLogLine 同格式）。
 * IO 全部可注入（connectFn 默认 node:net.connect，测试用假 socket），日志追加走
 * node:fs/promises（appendFile 直接依赖，与 SerialSession 一致）。
 *
 * 无凭据：serial-tcp 是 raw TCP，不携带任何用户名/口令/keyRef。
 * @module @local/dsh-ssh-gui/serial-tcp
 */

import { appendFile, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

/** ring 缓冲上限（字节，与 dsh-workerspace SerialSession 对齐）。 */
export const RING_CAP = 1024 * 1024;

/** 把字节流编码成日志行（与 dsh-workerspace serial.formatLogLine 同格式）。 */
export function formatLogLine(direction, chunk) {
	const hex = Buffer.from(chunk).toString("hex").replace(/(..)/gu, "$1 ").trim();
	const ascii = Buffer.from(chunk)
		.toString("latin1")
		.replace(/[^\x20-\x7e]/gu, ".")
		.slice(0, 64);
	return `[${direction} ${chunk.length}] ${hex}  "${ascii}"`;
}

/**
 * serial-tcp 会话。构造后调用 open()；close() 幂等。
 * @param {object} opts
 * @param {string} opts.host - TCP 串口服务器地址。
 * @param {number} opts.port - TCP 端口。
 * @param {string} [opts.tty] - 远端 /dev/tty 说明（仅展示，非连接参数）。
 * @param {string} opts.logPath - 日志文件绝对路径（父目录已确保存在）。
 * @param {(spec: {host: string, port: number}) => import('node:net').Socket} [opts.connectFn]
 *        - 连接工厂（默认 node:net.connect；测试注入假 socket）。
 * @param {number} [opts.timeoutMs] - 连接超时（默认 10s，0=禁用）。
 */
export class SerialTcpSession {
	constructor(opts) {
		this.host = opts.host;
		this.port = opts.port;
		this.tty = opts.tty;
		this.logPath = opts.logPath;
		this.connectFn = opts.connectFn ?? ((spec) => connect({ host: spec.host, port: spec.port }));
		this.timeoutMs = opts.timeoutMs ?? 10_000;

		this.closed = false;
		this.opened = false;
		this.socket = null;
		this.readError = null;

		this.buffer = Buffer.alloc(0);
		this.bufferStart = 0; // buffer[0] 对应的全局字节偏移
		this.receivedBytes = 0;
		this.sentBytes = 0;
		this.logChain = Promise.resolve();
	}

	/** 日志写入（串行队列，防交错；失败静默）。 */
	_log(line) {
		this.logChain = this.logChain
			.then(() => appendFile(this.logPath, line + "\n", "utf8"))
			.catch(() => {});
		return this.logChain;
	}

	/** 缓冲追加（含截断丢头）。 */
	_push(chunk) {
		if (chunk.length === 0) return;
		const next = Buffer.concat([this.buffer, chunk]);
		if (next.length > RING_CAP) {
			const drop = next.length - RING_CAP;
			this.buffer = next.subarray(drop);
			this.bufferStart += drop;
		}
		else {
			this.buffer = next;
		}
		this.receivedBytes += chunk.length;
		this._log(formatLogLine("R", chunk));
	}

	/**
	 * 打开会话：net.connect 到 host:port，noDelay，注册 data/error/close 处理。
	 * @returns {Promise<void>}
	 */
	open() {
		if (this.opened || this.socket !== null) {
			throw new Error("serial-tcp session is already open");
		}
		return new Promise((resolvePromise, reject) => {
			const socket = this.connectFn({ host: this.host, port: this.port });
			this.socket = socket;
			socket.setNoDelay?.(true);
			const onError = (error) => {
				this.readError = error instanceof Error ? error : new Error(String(error));
				if (!this.opened) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			};
			socket.once("error", onError);
			socket.on("data", (chunk) => this._push(Buffer.from(chunk)));
			if (this.timeoutMs > 0) socket.setTimeout(this.timeoutMs);
			socket.once("timeout", () => {
				this.readError = new Error(`serial-tcp connect/read timed out after ${this.timeoutMs}ms`);
			});
			socket.once("connect", () => {
				socket.setTimeout(0);
				socket.removeListener("error", onError);
				this.opened = true;
				this._log(`[session open] ${this.host}:${this.port}${this.tty ? ` (${this.tty})` : ""}`);
				resolvePromise();
			});
			socket.on("close", () => {
				if (!this.closed) this._log("[session closed by peer]");
			});
		});
	}

	/**
	 * 写入字节。
	 * @param {Buffer} bytes
	 * @returns {Promise<number>} 写入字节数。
	 */
	async write(bytes) {
		if (this.closed || !this.opened || this.socket === null) {
			throw new Error("serial-tcp session is not open");
		}
		const buf = Buffer.from(bytes);
		await new Promise((resolvePromise, reject) => {
			this.socket.write(buf, (error) => (error ? reject(error) : resolvePromise()));
		});
		this.sentBytes += buf.length;
		this._log(formatLogLine("S", buf));
		return buf.length;
	}

	/**
	 * 从全局字节偏移读取增量数据。
	 * @param {number} fromOffset - 上次读到的 nextOffset（0 起）。
	 * @returns {{ data: Buffer, nextOffset: number, lossy: boolean, totalReceived: number }}
	 */
	readSince(fromOffset) {
		const start = Math.max(fromOffset, this.bufferStart);
		const lossy = fromOffset < this.bufferStart;
		const end = this.bufferStart + this.buffer.length;
		const data = end > start ? this.buffer.subarray(start - this.bufferStart) : Buffer.alloc(0);
		return { data: Buffer.from(data), nextOffset: end, lossy, totalReceived: this.receivedBytes };
	}

	/** 会话统计（与 SerialSession.stats 同形态）。 */
	stats() {
		return {
			host: this.host,
			port: this.port,
			tty: this.tty,
			receivedBytes: this.receivedBytes,
			sentBytes: this.sentBytes,
			logPath: this.logPath,
			readError: this.readError ? this.readError.message : undefined,
		};
	}

	/** 关闭（幂等）：销毁 socket、收尾日志。 */
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (this.socket !== null) {
			this.socket.destroy();
			this.socket = null;
		}
		this._log(`[session closed] received=${this.receivedBytes} sent=${this.sentBytes}`);
		await this.logChain.catch(() => {});
	}
}

/**
 * 创建日志路径：<logDir>/serial-tcp-<safeName>-<ts>.log，确保目录存在。
 * @param {string} logDir
 * @param {string} name - 节点名（用于日志文件名片段）。
 * @returns {Promise<string>} 日志绝对路径。
 */
export async function serialTcpLogPath(logDir, name) {
	await mkdir(logDir, { recursive: true, mode: 0o700 });
	const safe = String(name).replace(/[^A-Za-z0-9_.-]+/gu, "_") || "node";
	const ts = new Date().toISOString().replace(/[:.]/gu, "-");
	return join(logDir, `serial-tcp-${safe}-${ts}.log`);
}
//#endregion
