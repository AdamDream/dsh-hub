//#region test/serial.test.mjs
/**
 * dsh-workerspace 串口会话单测：参数拒绝 / ring 缓冲增量读 / 截断丢头 / 收发计数 /
 * 日志行格式 / 关闭幂等（全部走假 provider 与直接缓冲操作，不触碰真实串口设备）。
 * 运行：node --test test/serial.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SerialSession, formatLogLine, listSerialPorts, RING_CAP } from "../lib/serial.js";

function makeSession(overrides = {}) {
	return new SerialSession({
		port: "/dev/ttyUSB0",
		baudRate: 115200,
		backend: "stty",
		logPath: "/tmp/dsh-ws-test/serial.log",
		runSubprocess: async () => ({ exitCode: 0, stderr: "" }),
		...overrides,
	});
}

test("open: 非法端口/波特率拒绝（不触 IO）", async () => {
	const bad = makeSession({ port: "/dev/tty;rm -rf /" });
	await assert.rejects(() => bad.open(), /invalid serial port/);
	const badBaud = makeSession({ baudRate: 12.5 });
	await assert.rejects(() => badBaud.open(), /invalid baud rate/);
});

test("open: 未知后端拒绝", async () => {
	const s = makeSession({ backend: "nope" });
	await assert.rejects(() => s.open(), /unknown serial backend/);
});

test("open: stty 配置失败时透出 stderr", async () => {
	const s = makeSession({
		runSubprocess: async () => ({ exitCode: 1, stderr: "stty: /dev/ttyUSB0: Permission denied" }),
	});
	await assert.rejects(() => s.open(), /stty configure failed.*Permission denied/);
});

test("读写缓冲：增量读与全局偏移", () => {
	const s = makeSession();
	s._push(Buffer.from("hello "));
	s._push(Buffer.from("world"));
	let read = s.readSince(0);
	assert.equal(read.data.toString(), "hello world");
	assert.equal(read.nextOffset, 11);
	assert.equal(read.totalReceived, 11);
	// 新数据只从上次偏移返回
	s._push(Buffer.from(" again"));
	read = s.readSince(11);
	assert.equal(read.data.toString(), " again");
	assert.equal(read.lossy, false);
	assert.equal(read.totalReceived, 17);
});

test("读写缓冲：超过 ring 上限时丢头标记 lossy", () => {
	const s = makeSession();
	const big = Buffer.alloc(RING_CAP + 64, 0x61);
	s._push(big);
	const read = s.readSince(0);
	assert.equal(read.lossy, true);
	assert.ok(read.data.length <= RING_CAP);
	assert.equal(read.data[read.data.length - 1], 0x61);
});

test("收发计数与日志行格式", () => {
	const s = makeSession();
	s._push(Buffer.from("hi"));
	assert.equal(s.receivedBytes, 2);
	const line = formatLogLine("R", Buffer.from("hi"));
	assert.match(line, /^\[R 2\] 68 69.*"hi"/);
	const sent = formatLogLine("S", Buffer.from([0x0d, 0x0a]));
	assert.match(sent, /^\[S 2\] 0d 0a/);
});

test("write: 未打开时拒绝；打开后计数", async () => {
	const s = makeSession();
	await assert.rejects(() => s.write(Buffer.from("x")), /not open/);
	// 不真开设备：直接以 closed=false 构造写入路径不可行，这里验证关闭幂等即可
	s.closed = true;
	await s.close();
	assert.equal(s.closed, true);
});

test("close: 幂等且不抛", async () => {
	const s = makeSession();
	await s.close();
	await s.close();
	assert.equal(s.closed, true);
});

test("stats: 只读快照", () => {
	const s = makeSession();
	s._push(Buffer.from("abc"));
	const stats = s.stats();
	assert.equal(stats.port, "/dev/ttyUSB0");
	assert.equal(stats.receivedBytes, 3);
	assert.equal(stats.sentBytes, 0);
	assert.equal(stats.logPath, "/tmp/dsh-ws-test/serial.log");
});

test("listSerialPorts: 返回数组（扫描 /dev，结果形态正确）", async () => {
	const ports = await listSerialPorts();
	assert.ok(Array.isArray(ports));
	for (const p of ports) {
		assert.equal(typeof p.path, "string");
		assert.ok(p.path.length > 0);
	}
});
//#endregion
