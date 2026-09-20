//#region lib/serial.js
/**
 * dsh-workerspace 串口会话后端。
 *
 * 双后端（settings serial.backend）：
 * - `stty`（默认，零依赖）：用系统 `stty -F <port> <baud> raw -echo` 配置，然后
 *   `node:fs` 以 O_RDWR|O_NONBLOCK 打开字符设备，轮询读取（EAGAIN → 短睡）。
 *   仅依赖系统 GNU stty + POSIX 字符设备，Linux 目标 SoC 场景足够。
 * - `serialport`（可选）：profile 里装了 npm `serialport` 时可用（经 createRequire 解析，
 *   不写进 dependencies —— 保持零必装依赖）；未装则抛带安装提示的错误。
 *
 * 会话语义：每个端口同时最多一个会话；会话持有 ring 缓冲（上限 1 MiB，丢头保留尾）、
 * 收发字节计数与日志文件（logDir/serial-<port>-<ts>.log，追加 hex+可打印文本行）。
 * IO 全部可注入（runSubprocess / sleepMs），便于纯单测。
 * @module dsh-workerspace/serial
 */

import { open, appendFile, mkdir, readdir, realpath } from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { isValidBaudRate, isValidPortName, safeLogSegment } from "./core.js";

/** ring 缓冲上限（字节）。 */
export const RING_CAP = 1024 * 1024;
/** stty 轮询间隔（ms）。 */
export const POLL_MS = 15;
/** 读取块大小。 */
const READ_BLOCK = 4096;

const require_ = createRequire(import.meta.url);

/** 静默 sleep（可注入替换）。 */
function sleepMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 枚举本机串口：/dev/serial/by-id（Linux udev 别名，label 友好）+ /dev/ttyUSB* /dev/ttyACM*。
 * 失败静默降级为空列表（无权限/非 Linux 时工具返回空并说明）。
 * @returns {Promise<Array<{path: string, label?: string}>>}
 */
export async function listSerialPorts() {
	const found = new Map();
	const add = (path, label) => {
		if (!found.has(path)) found.set(path, { path, ...(label ? { label } : {}) });
	};
	try {
		const byId = await readdir("/dev/serial/by-id");
		for (const entry of byId.sort()) {
			try {
				const target = await realpath(`/dev/serial/by-id/${entry}`);
				add(target, entry);
			} catch {
				// 悬空别名，跳过
			}
		}
	} catch {
		// /dev/serial 不存在（非 Linux/无 udev），继续扫 /dev
	}
	for (const prefix of ["ttyUSB", "ttyACM"]) {
		try {
			for (const entry of await readdir("/dev")) {
				if (entry.startsWith(prefix)) add(`/dev/${entry}`);
			}
		} catch {
			// 不可读，忽略
		}
	}
	return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** 把字节流编码成日志行：`[+HH:MM:SS][R 8] 68 65 6c 6c 6f 20 77 6f  "hello wo"`。 */
export function formatLogLine(direction, chunk) {
	const hex = Buffer.from(chunk).toString("hex").replace(/(..)/g, "$1 ").trim();
	const ascii = Buffer.from(chunk)
		.toString("latin1")
		.replace(/[^\x20-\x7e]/g, ".")
		.slice(0, 64);
	return `[${direction} ${chunk.length}] ${hex}  "${ascii}"`;
}

/**
 * 串口会话。构造后调用 open()；close() 幂等。
 * @param {object} opts
 * @param {string} opts.port - 设备路径（/dev/ttyUSB0 等）。
 * @param {number} opts.baudRate - 波特率。
 * @param {string} opts.backend - 'stty' | 'serialport'。
 * @param {string} opts.logPath - 日志文件绝对路径（父目录已确保存在）。
 * @param {(argv: string[]) => Promise<{exitCode: number, stderr: string}>} opts.runSubprocess
 *        - 子进程执行器（index.js 注入 ctx.subprocess 封装）；stty 配置用。
 * @param {number} [opts.pollMs] - 轮询间隔覆盖（测试用）。
 */
export class SerialSession {
	constructor(opts) {
		this.port = opts.port;
		this.baudRate = opts.baudRate;
		this.backend = opts.backend;
		this.logPath = opts.logPath;
		this.runSubprocess = opts.runSubprocess;
		this.pollMs = opts.pollMs ?? POLL_MS;

		this.closed = false;
		this.opened = false;
		this.fd = null;
		this.portHandle = null;
		this.readerTask = null;
		this.readError = null;

		this.buffer = Buffer.alloc(0);
		this.bufferStart = 0; // buffer[0] 对应的全局字节偏移
		this.receivedBytes = 0;
		this.sentBytes = 0;
		this.logChain = Promise.resolve();
	}

	/** 日志写入（串行队列，防交错）。 */
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
		} else {
			this.buffer = next;
		}
		this.receivedBytes += chunk.length;
		this._log(formatLogLine("R", chunk));
	}

	/**
	 * 打开会话：stty 配置 + 打开 fd/端口 + 启动读循环。
	 * @returns {Promise<void>}
	 */
	async open() {
		if (!isValidPortName(this.port)) {
			throw new Error(`invalid serial port "${this.port}"; a device path like /dev/ttyUSB0 is expected`);
		}
		if (!isValidBaudRate(this.baudRate)) {
			throw new Error(`invalid baud rate ${this.baudRate} (must be an integer in [50, 4000000])`);
		}
		if (this.backend === "serialport") {
			await this._openSerialport();
		} else if (this.backend === "stty") {
			await this._openStty();
		} else {
			throw new Error(`unknown serial backend "${this.backend}" (expected "stty" or "serialport")`);
		}
		this.opened = true;
	}

	async _openStty() {
		const result = await this.runSubprocess([
			"stty",
			"-F",
			this.port,
			String(this.baudRate),
			"raw",
			"-echo",
		]);
		if (result.exitCode !== 0) {
			const detail = (result.stderr || "stty exited non-zero").trim();
			throw new Error(`stty configure failed for ${this.port}: ${detail}`);
		}
		try {
			this.fd = await open(this.port, FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_NONBLOCK);
		} catch (error) {
			throw new Error(`cannot open serial port ${this.port}: ${error instanceof Error ? error.message : String(error)}`);
		}
		this._startReader();
	}

	async _openSerialport() {
		let SerialPort;
		try {
			SerialPort = require_("serialport");
		} catch {
			throw new Error(
				'serial backend "serialport" is not installed; run `pnpm add serialport` in the profile, or switch settings serial.backend to "stty" (zero-dependency default)',
			);
		}
		await new Promise((resolve, reject) => {
			const port = new SerialPort(this.port, {
				baudRate: this.baudRate,
				autoOpen: true,
			});
			port.once("open", () => {
				this.portHandle = port;
				port.on("data", (chunk) => this._push(Buffer.from(chunk)));
				port.on("error", (error) => {
					this.readError = error;
				});
				resolve();
			});
			port.once("error", reject);
		});
	}

	/** 启动 stty 后端读循环（O_NONBLOCK + EAGAIN 轮询）。 */
	_startReader() {
		this.readerTask = (async () => {
			const block = Buffer.alloc(READ_BLOCK);
			while (!this.closed && this.fd !== null) {
				try {
					const { bytesRead } = await this.fd.read(block, 0, block.length, null);
					if (bytesRead > 0) {
						this._push(block.subarray(0, bytesRead));
					} else {
						await sleepMs(this.pollMs);
					}
				} catch (error) {
					if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
						await sleepMs(this.pollMs);
						continue;
					}
					if (this.closed) break;
					this.readError = error instanceof Error ? error : new Error(String(error));
					await this.close();
					break;
				}
			}
		})();
	}

	/**
	 * 写入字节。
	 * @param {Buffer} bytes
	 * @returns {Promise<number>} 写入字节数。
	 */
	async write(bytes) {
		if (this.closed || !this.opened) {
			throw new Error("serial session is not open (open it with ws_serial_open first)");
		}
		if (this.portHandle !== null) {
			await new Promise((resolve, reject) => {
				this.portHandle.write(Buffer.from(bytes), (error) => (error ? reject(error) : resolve()));
			});
		} else if (this.fd !== null) {
			let written = 0;
			while (written < bytes.length) {
				try {
					const { bytesWritten } = await this.fd.write(bytes, written, bytes.length - written, null);
					if (bytesWritten <= 0) {
						await sleepMs(this.pollMs);
						continue;
					}
					written += bytesWritten;
				} catch (error) {
					if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
						await sleepMs(this.pollMs);
						continue;
					}
					throw error instanceof Error ? error : new Error(String(error));
				}
			}
		} else {
			throw new Error("serial session has no writable handle");
		}
		this.sentBytes += bytes.length;
		this._log(formatLogLine("S", bytes));
		return bytes.length;
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

	/** 会话统计。 */
	stats() {
		return {
			port: this.port,
			baudRate: this.baudRate,
			backend: this.backend,
			receivedBytes: this.receivedBytes,
			sentBytes: this.sentBytes,
			logPath: this.logPath,
			readError: this.readError ? this.readError.message : undefined,
		};
	}

	/** 关闭（幂等）：停读循环、关 fd/端口、收尾日志。 */
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (this.readerTask !== null) {
			await this.readerTask.catch(() => {});
		}
		if (this.fd !== null) {
			await this.fd.close().catch(() => {});
			this.fd = null;
		}
		if (this.portHandle !== null) {
			await new Promise((resolve) => this.portHandle.close(() => resolve()));
			this.portHandle = null;
		}
		this._log(`[session closed] received=${this.receivedBytes} sent=${this.sentBytes}`);
		await this.logChain.catch(() => {});
	}
}

/**
 * 创建日志路径：<logDir>/serial-<safePort>-<ts>.log，确保目录存在。
 * @param {string} logDir
 * @param {string} port
 * @returns {Promise<string>} 日志绝对路径。
 */
export async function serialLogPath(logDir, port) {
	await mkdir(logDir, { recursive: true, mode: 0o700 });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	return join(logDir, `serial-${safeLogSegment(basename(port))}-${ts}.log`);
}
//#endregion
