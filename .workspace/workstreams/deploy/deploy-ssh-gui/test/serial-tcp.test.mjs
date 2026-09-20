//#region test/serial-tcp.test.mjs
// serial-tcp 会话单测：连接构造（假 socket）/ ring 缓冲增量读 / 收发计数 / 日志行格式 /
// 关闭幂等 / stats。全部走假 socket 与直接缓冲操作，不触碰真实网络。
// 运行：node --test test/serial-tcp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SerialTcpSession, formatLogLine, RING_CAP, serialTcpLogPath } from '../dsh-ssh-gui/lib/serial-tcp.js';

/** 可编程假 socket（实现 open/write/destroy/setNoDelay/setTimeout/once/on/removeListener）。 */
function makeFakeSocket() {
	const handlers = new Map();
	const socket = {
		written: [],
		destroyed: false,
		noDelay: false,
		timeoutMs: 0,
		emit(event, ...args) {
			const list = handlers.get(event) || [];
			for (const fn of [...list]) fn(...args);
			return list.length > 0;
		},
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event).push(fn);
			return socket;
		},
		once(event, fn) {
			const wrapped = (...args) => { fn(...args); const list = handlers.get(event) || []; const i = list.indexOf(wrapped); if (i >= 0) list.splice(i, 1); };
			return socket.on(event, wrapped);
		},
		removeListener(event, fn) {
			const list = handlers.get(event) || [];
			const i = list.indexOf(fn);
			if (i >= 0) list.splice(i, 1);
			return socket;
		},
		setNoDelay(v) { socket.noDelay = v; return socket; },
		setTimeout(ms) { socket.timeoutMs = ms; return socket; },
		write(buf, cb) { socket.written.push(Buffer.from(buf)); if (cb) cb(); return true; },
		destroy() { socket.destroyed = true; },
	};
	return socket;
}

function makeSession(overrides = {}) {
	const socket = makeFakeSocket();
	const session = new SerialTcpSession({
		host: '10.0.0.5',
		port: 4001,
		tty: '/dev/ttyS0',
		logPath: '/tmp/dsh-serial-tcp-test/serial-tcp-node.log',
		connectFn: () => socket,
		...overrides,
	});
	session.__socket = socket;
	return session;
}

test('open：connect 前不可写；connect 后 opened；noDelay + 连接超时设置', async () => {
	const session = makeSession();
	assert.equal(session.opened, false);
	const pending = session.open(); // Promise executor 同步执行：connectFn/setNoDelay/setTimeout 立即生效
	assert.equal(session.__socket.noDelay, true);
	assert.equal(session.__socket.timeoutMs, 10000);
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	session.__socket.emit('connect');
	await pending;
	assert.equal(session.opened, true);
	// connect 后超时清零（TCP 连接已建立）
	assert.equal(session.__socket.timeoutMs, 0);
});

test('open：连接错误 reject（未 opened 时），且不落地 opened', async () => {
	const session = makeSession();
	const pending = session.open();
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	session.__socket.emit('error', new Error('ECONNREFUSED'));
	await assert.rejects(() => pending, /ECONNREFUSED/);
	assert.equal(session.opened, false);
});

test('读写缓冲：data 事件推入 → 增量读与全局偏移', async () => {
	const session = makeSession();
	const pending = session.open();
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	session.__socket.emit('connect');
	await pending;
	session.__socket.emit('data', Buffer.from('hello '));
	session.__socket.emit('data', Buffer.from('world'));
	let read = session.readSince(0);
	assert.equal(read.data.toString(), 'hello world');
	assert.equal(read.nextOffset, 11);
	session.__socket.emit('data', Buffer.from(' again'));
	read = session.readSince(11);
	assert.equal(read.data.toString(), ' again');
	assert.equal(read.lossy, false);
	assert.equal(read.totalReceived, 17);
	await session.close();
});

test('读写缓冲：超过 ring 上限时丢头标记 lossy', async () => {
	const session = makeSession();
	const big = Buffer.alloc(RING_CAP + 64, 0x61);
	session._push(big);
	const read = session.readSince(0);
	assert.equal(read.lossy, true);
	assert.ok(read.data.length <= RING_CAP);
	assert.equal(read.data[read.data.length - 1], 0x61);
	await session.close();
});

test('write：未打开拒绝；打开后 socket.write + 计数 + 日志', async () => {
	const session = makeSession();
	await assert.rejects(() => session.write(Buffer.from('x')), /not open/);
	const pending = session.open();
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	session.__socket.emit('connect');
	await pending;
	const sent = await session.write(Buffer.from('cmd\n'));
	assert.equal(sent, 4);
	assert.equal(session.sentBytes, 4);
	assert.deepEqual(session.__socket.written[0].toString(), 'cmd\n');
	await session.close();
});

test('日志行格式（与 dsh-workerspace serial.formatLogLine 同格式）', () => {
	const line = formatLogLine('R', Buffer.from('hi'));
	assert.match(line, /^\[R 2\] 68 69.*"hi"/);
	const sent = formatLogLine('S', Buffer.from([0x0d, 0x0a]));
	assert.match(sent, /^\[S 2\] 0d 0a/);
});

test('stats：只读快照', async () => {
	const session = makeSession();
	session._push(Buffer.from('abc'));
	const stats = session.stats();
	assert.equal(stats.host, '10.0.0.5');
	assert.equal(stats.port, 4001);
	assert.equal(stats.tty, '/dev/ttyS0');
	assert.equal(stats.receivedBytes, 3);
	assert.equal(stats.sentBytes, 0);
	assert.equal(stats.logPath, '/tmp/dsh-serial-tcp-test/serial-tcp-node.log');
	await session.close();
});

test('close：幂等且不抛（destroy socket + 收尾日志）', async () => {
	const session = makeSession();
	const pending = session.open();
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	session.__socket.emit('connect');
	await pending;
	await session.close();
	assert.equal(session.closed, true);
	assert.equal(session.__socket.destroyed, true);
	await session.close(); // 幂等
	assert.equal(session.closed, true);
});

test('serialTcpLogPath：目录确保（0700）+ 文件名形态（safe 段）', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ssh-gui-tcp-log-'));
	const path = await serialTcpLogPath(dir, 'rack node/1');
	assert.match(path, /serial-tcp-rack_node_1-/);
	assert.match(path, /\.log$/);
	// 目录已确保存在（文件由会话打开后追加）
	const parent = join(path, '..');
	assert.equal(statSync(parent).isDirectory(), true);
	assert.equal(statSync(parent).mode & 0o777, 0o700);
	rmSync(dir, { recursive: true, force: true });
});
//#endregion
