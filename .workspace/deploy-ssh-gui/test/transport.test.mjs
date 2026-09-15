//#region test/transport.test.mjs
// 传输分发单测（createDispatch 全链路，env 含 nodesFile + console 假适配器）：
// nodes.list 首启迁移 / nodes.add(ssh→写穿底座+同步, serial/serial-tcp→仅 nodes.json) /
// nodes.remove(ssh→registryRemove+keyRef 清理, console→close) / nodes.setCurrent / nodes.test
// 按传输 / node.status 按传输 / exec.run 传输分发（ssh 既有路径零回归；console 走
// open→send→read-until-quiet，cwd 拒绝，lineEnding 生效）/ file.* 对 console 节点拒绝 /
// serial.* 端点 / keyref.set 同步 nodes.json keyRef / 审计行。
// 运行：node --test test/transport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch, sanitizeConfig, NODES_VERSION } from '../dsh-ssh-gui/lib/core.js';

const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n';

/** 假 console 适配器：会话表按 nodeId；send 写入 chunk，read 从偏移返回。 */
function makeConsole() {
	const sessions = new Map();
	return {
		sessions,
		opened: [],
		closed: [],
		async open(node) {
			this.opened.push(node.id);
			sessions.set(node.id, { chunks: [] });
			return { logPath: '/tmp/fake-console.log', alreadyOpen: false };
		},
		async send(node, bytes) {
			const s = sessions.get(node.id);
			if (s === undefined) throw new Error('no open session');
			s.chunks.push(Buffer.from(bytes));
			return { sentBytes: bytes.length };
		},
		currentOffset(node) {
			const s = sessions.get(node.id);
			if (s === undefined) return 0;
			return s.chunks.reduce((n, c) => n + c.length, 0);
		},
		async read(node, { fromOffset, timeoutMs, quietMs, maxBytes, signal }) {
			const s = sessions.get(node.id);
			if (s === undefined) throw new Error('no open session');
			const all = Buffer.concat(s.chunks);
			const start = fromOffset ?? s.cursor;
			const data = all.subarray(start);
			s.cursor = all.length;
			return { buf: Buffer.from(data), moreAvailable: false, nextOffset: all.length, totalReceived: all.length, lossy: false, timedOut: false };
		},
		stats(node) {
			return sessions.has(node.id)
				? { state: 'open', transport: 'serial://', receivedBytes: 0, sentBytes: 0, logPath: '/tmp/fake-console.log' }
				: { state: 'closed', transport: 'serial://' };
		},
		async close(node) {
			sessions.delete(node.id);
			this.closed.push(node.id);
			return { logPath: '/tmp/fake-console.log', receivedBytes: 0, sentBytes: 0 };
		},
		async ports() {
			return [{ path: '/dev/ttyUSB0', label: 'usb0' }];
		},
	};
}

function makeEnv(overrides = {}) {
	const { cfg: cfgOverride, ...rest } = overrides;
	const dir = mkdtempSync(join(tmpdir(), 'ssh-gui-transport-'));
	const machines = [
		{ id: 'c1', label: 'm1', host: 'h1', username: 'u1', port: 22, privateKeyPath: undefined },
	];
	const savedCalls = [];
	const removedIds = [];
	const probes = [];
	const auditLines = [];
	const creds = { MY_SSH_KEY: PEM };
	const console = makeConsole();
	const env = {
		cfg: () => sanitizeConfig(cfgOverride),
		registry: {
			listMachines: () => ({ machines, currentId: 'c1' }),
			get: (id) => (id === 'c1'
				? { spec: machines[0], exec: async (command, opts) => ({ exitCode: 0, stdout: 'out:' + command + (opts && opts.cwd ? '@' + opts.cwd : ''), stderr: '' }) }
				: undefined),
			getActive: () => ({ spec: machines[0], connection: { exec: async () => ({ exitCode: 0, stdout: 'active', stderr: '' }) } }),
			saveMachine: async (input) => {
				savedCalls.push(input);
				if (input.id === undefined) {
					const next = { id: 'c9', label: input.label ?? 'new', host: input.host, username: input.username, port: input.port };
					machines.push(next);
					return next;
				}
				const index = machines.findIndex((m) => m.id === input.id);
				if (index >= 0) Object.assign(machines[index], input);
				else machines.push({ id: input.id, ...input });
				return machines[index >= 0 ? index : machines.length - 1];
			},
			remove: (id) => { removedIds.push(id); return true; },
			setCurrent: () => true,
		},
		registryStatus: (id) => (id === 'c1' ? { state: 'active', hostKeyKnown: true } : { state: 'unknown' }),
		registryProbe: async (id) => ({ state: 'active', hostKeyKnown: true }),
		registryRemove: (id) => { removedIds.push(id); return true; },
		registrySetCurrent: () => true,
		credentials: {
			resolve: async (ref) => (creds[ref] !== undefined ? { value: creds[ref], source: 'file' } : undefined),
			describe: async (ref) => ({ configured: creds[ref] !== undefined, source: 'file', writable: true }),
		},
		keysDir: () => join(dir, 'keys'),
		keyrefsFile: () => join(dir, 'ssh-keyrefs.json'),
		nodesFile: () => join(dir, 'nodes.json'),
		console,
		auditLog: async (line) => { auditLines.push(line); },
		resolveTarget: (id) => {
			if (id !== undefined) {
				const connection = env.registry.get(id.trim());
				if (connection === undefined) throw new Error(`bad-request: unknown machine id ${JSON.stringify(id.trim())}`);
				return { spec: connection.spec, connection };
			}
			return env.registry.getActive();
		},
		connectionExec: (connection, command, opts) => connection.exec(command, opts),
		sftpOf: async () => ({
			stat: async () => ({ size: 5, isFile: () => true }),
			readFile: async () => Buffer.from('hello'),
			writeFile: async () => {},
			readdir: async () => [],
		}),
		remoteHomeOf: async () => '/home/u1',
		statFile: (sftp, path, signal) => sftp.stat(path),
		readFileOf: (sftp, path, signal) => sftp.readFile(path),
		writeFileOf: (sftp, path, buf, signal) => sftp.writeFile(path, buf),
		readdirOf: (sftp, path, signal) => sftp.readdir(path),
		...rest,
	};
	env.__dir = dir;
	env.__savedCalls = savedCalls;
	env.__removedIds = removedIds;
	env.__probes = probes;
	env.__auditLines = auditLines;
	env.__console = console;
	return env;
}

function nodesFileOf(env) {
	return JSON.parse(readFileSync(env.nodesFile(), 'utf8'));
}

test('nodes.list：首启迁移（machines→ssh + seeds→serial/serial-tcp）并落盘 nodes.json', async () => {
	const env = makeEnv({
		cfg: {
			nodes: {
				seed: {
					serial: [{ name: 'esp', port: '/dev/ttyUSB0' }],
					serialTcp: [{ name: 'rack', host: '10.0.0.5', port: 4001 }],
				},
			},
		},
	});
	const dispatch = createDispatch(env);
	const result = await dispatch('nodes.list', {});
	assert.equal(result.ok, true);
	const transports = result.value.nodes.map((n) => n.transport).sort();
	assert.deepEqual(transports, ['serial-tcp://', 'serial://', 'ssh://']);
	assert.equal(result.value.currentId, 'c1');
	assert.deepEqual(result.value.transports, ['ssh://', 'serial://', 'serial-tcp://']);
	// 已落盘
	const file = nodesFileOf(env);
	assert.equal(file.version, NODES_VERSION);
	assert.equal(file.nodes.length, 3);
	// ssh 节点 target 无秘密、name=label
	const c1 = file.nodes.find((n) => n.id === 'c1');
	assert.equal(c1.target.password, undefined);
	assert.equal(c1.name, 'm1');
	rmSync(env.__dir, { recursive: true, force: true });
});

test('nodes.add：ssh（无 id）→ 底座 saveMachine 生成 + 同步回 nodes.json；serial/serial-tcp → 本地生成 id', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	// ssh 新建（无 id）
	const ssh = await dispatch('nodes.add', { node: { name: 'host2', transport: 'ssh://', target: { host: 'h2', username: 'u2', port: 22 } } });
	assert.equal(ssh.ok, true);
	assert.equal(ssh.value.node.id, 'c9'); // 底座生成
	assert.ok(env.__savedCalls.some((c) => c.host === 'h2'));
	// serial 新建（无 id → s1）
	const serial = await dispatch('nodes.add', { node: { name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0', baudRate: 9600, backend: 'stty' } } });
	assert.equal(serial.ok, true);
	assert.equal(serial.value.node.id, 's1');
	// serial-tcp 新建（无 id → t1）
	const tcp = await dispatch('nodes.add', { node: { name: 'rack', transport: 'serial-tcp://', target: { host: '10.0.0.5', port: 4001 } } });
	assert.equal(tcp.ok, true);
	assert.equal(tcp.value.node.id, 't1');
	const file = nodesFileOf(env);
	assert.equal(file.nodes.length, 4); // c1 + c9 + s1 + t1
	rmSync(env.__dir, { recursive: true, force: true });
});

test('nodes.add：非法（坏传输 / 串口节点带 password / 坏 target）→ bad-request', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	assert.equal((await dispatch('nodes.add', { node: { transport: 'ftp://', target: {} } })).ok, false);
	assert.equal((await dispatch('nodes.add', { node: { transport: 'serial://', target: { port: '/dev/ttyUSB0' } }, password: 'x' })).ok, false);
	assert.equal((await dispatch('nodes.add', { node: { transport: 'ssh://', target: { host: 'h' } } })).ok, false); // 缺 username
	rmSync(env.__dir, { recursive: true, force: true });
});

test('nodes.remove：ssh → registryRemove + keyRef 清理；serial → console.close + nodes.json 修剪', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.add', { node: { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0' } } });
	await dispatch('keyref.set', { machineId: 'c1', refName: 'MY_SSH_KEY' });
	const keyFile = join(env.__dir, 'keys', 'c1');
	assert.ok(readFileSync(keyFile, 'utf8').length > 0); // 密钥已落
	const rm = await dispatch('nodes.remove', { id: 'c1' });
	assert.equal(rm.ok, true);
	assert.ok(env.__removedIds.includes('c1')); // 底座已删
	// keyRef 侧表 + 密钥文件已清
	const side = JSON.parse(readFileSync(join(env.__dir, 'ssh-keyrefs.json'), 'utf8'));
	assert.equal(side.bindings.c1, undefined);
	assert.throws(() => readFileSync(keyFile));
	// serial 节点删除 → console.close
	await dispatch('serial.open', { id: 's1' });
	const rmSerial = await dispatch('nodes.remove', { id: 's1' });
	assert.equal(rmSerial.ok, true);
	assert.ok(env.__console.closed.includes('s1'));
	const file = nodesFileOf(env);
	assert.equal(file.nodes.some((n) => n.id === 's1'), false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('nodes.setCurrent / nodes.test / node.status：按传输分发', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.add', { node: { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0' } } });
	// setCurrent
	const setc = await dispatch('nodes.setCurrent', { id: 's1' });
	assert.equal(setc.ok, true);
	assert.equal(nodesFileOf(env).currentId, 's1');
	assert.equal((await dispatch('nodes.setCurrent', { id: 'nope' })).ok, false);
	// test：ssh → registryProbe；serial → console open+close
	const tSsh = await dispatch('nodes.test', { id: 'c1' });
	assert.equal(tSsh.value.transport, 'ssh://');
	assert.equal(tSsh.value.ok, true);
	const tSerial = await dispatch('nodes.test', { id: 's1' });
	assert.equal(tSerial.value.transport, 'serial://');
	assert.equal(tSerial.value.ok, true);
	assert.ok(env.__console.closed.includes('s1'));
	// status：ssh → registryStatus；serial → console.stats
	const sSsh = await dispatch('node.status', { id: 'c1' });
	assert.equal(sSsh.value.state, 'active');
	const sSerial = await dispatch('node.status', { id: 's1' });
	assert.equal(sSerial.value.state, 'closed');
	assert.equal((await dispatch('node.status', { id: 'nope' })).ok, false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('exec.run：console 节点 → open→send→read-until-quiet，cwd 拒绝，lineEnding 生效；审计落行', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.add', { node: { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0' } } });
	const result = await dispatch('exec.run', { id: 's1', command: 'help', lineEnding: 'crlf' });
	assert.equal(result.ok, true);
	assert.equal(result.value.transport, 'serial://');
	assert.equal(result.value.exitCode, null); // console 无退出码
	assert.equal(result.value.stdout, 'help\r\n'); // 假 console 回显发送字节
	assert.ok(env.__console.opened.includes('s1'));
	// 审计行（console）
	assert.ok(env.__auditLines.some((l) => l.node === 's1' && l.transport === 'serial://' && l.command === 'help'));
	// cwd 对 console 节点拒绝
	const cwdRejected = await dispatch('exec.run', { id: 's1', command: 'x', cwd: '/tmp' });
	assert.equal(cwdRejected.ok, false);
	assert.match(cwdRejected.error.message, /cwd is only valid for ssh/);
	// 未知 console id → bad-request
	assert.equal((await dispatch('exec.run', { id: 'nope', command: 'x' })).ok, false);
	// 未开会话的 console 节点（close 后）→ 错误提示先 open
	await dispatch('serial.close', { id: 's1' });
	const closed = await dispatch('exec.run', { id: 's1', command: 'x' });
	assert.equal(closed.ok, true); // exec 会自动重开会话（console.open 幂等）
	rmSync(env.__dir, { recursive: true, force: true });
});

test('exec.run：ssh 路径零回归（cwd 透传 / 审计行 transport=ssh://）', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const result = await dispatch('exec.run', { id: 'c1', command: 'ls -la', cwd: '/tmp' });
	assert.equal(result.ok, true);
	assert.equal(result.value.stdout, 'out:ls -la@/tmp');
	assert.equal(result.value.exitCode, 0);
	assert.ok(env.__auditLines.some((l) => l.node === 'c1' && l.transport === 'ssh://'));
	rmSync(env.__dir, { recursive: true, force: true });
});

test('file.*：console 节点拒绝（传输不支持文件操作），ssh 节点正常', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.add', { node: { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0' } } });
	for (const endpoint of ['file.list', 'file.get', 'file.put']) {
		const payload = endpoint === 'file.list'
			? { id: 's1' }
			: endpoint === 'file.get'
				? { id: 's1', remotePath: '/etc/hostname' }
				: { id: 's1', remotePath: '/x', base64: 'aGk=' };
		const result = await dispatch(endpoint, payload);
		assert.equal(result.ok, false);
		assert.match(result.error.message, /does not support file operations/);
	}
	// ssh 节点不受影响
	const list = await dispatch('file.list', { id: 'c1' });
	assert.equal(list.ok, true);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('serial.* 端点：ports/open/send/read/close 全链路 + 非 console 节点拒绝', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.add', { node: { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0' } } });
	const ports = await dispatch('serial.ports', {});
	assert.equal(ports.value.ports.length, 1);
	assert.equal(ports.value.ports[0].path, '/dev/ttyUSB0');
	const opened = await dispatch('serial.open', { id: 's1' });
	assert.equal(opened.ok, true);
	assert.equal(opened.value.alreadyOpen, false);
	const sent = await dispatch('serial.send', { id: 's1', data: '41 42', encoding: 'hex' });
	assert.equal(sent.value.sentBytes, 2);
	const read = await dispatch('serial.read', { id: 's1', timeoutMs: 0, maxBytes: 16, encoding: 'text' });
	assert.equal(read.ok, true);
	assert.equal(read.value.data, 'AB'); // 0x41 0x42 utf8
	const closed = await dispatch('serial.close', { id: 's1' });
	assert.equal(closed.ok, true);
	// ssh 节点不是 console → serial.* 拒绝
	assert.equal((await dispatch('serial.open', { id: 'c1' })).ok, false);
	assert.equal((await dispatch('serial.send', { id: 'c1', data: 'x' })).ok, false);
	// 未开会话 read/send → bad-request
	assert.equal((await dispatch('serial.send', { id: 's1', data: 'x' })).ok, false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('keyref.set/unbind：同步 nodes.json 的 target.keyRef（ssh 节点）', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.list', {}); // 先建立 nodes.json（真实 GUI 流程：面板先 nodes.list）
	const file0 = nodesFileOf(env);
	assert.equal(file0.nodes.find((n) => n.id === 'c1').target.keyRef, undefined);
	await dispatch('keyref.set', { machineId: 'c1', refName: 'MY_SSH_KEY' });
	const file = nodesFileOf(env);
	assert.equal(file.nodes.find((n) => n.id === 'c1').target.keyRef, 'MY_SSH_KEY');
	await dispatch('keyref.unbind', { id: 'c1' });
	const file2 = nodesFileOf(env);
	assert.equal(file2.nodes.find((n) => n.id === 'c1').target.keyRef, undefined);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('nodes.list 同步：底座新增机器 → nodes.json 自动导入', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('nodes.list', {});
	assert.equal(nodesFileOf(env).nodes.some((n) => n.id === 'c1'), true);
	// 模拟底座侧新增（不经本插件）
	env.registry.listMachines = () => ({ machines: [{ id: 'c1', label: 'm1', host: 'h1', username: 'u1', port: 22 }, { id: 'c5', label: 'm5', host: 'h5', username: 'u5', port: 22 }], currentId: 'c1' });
	const again = await dispatch('nodes.list', {});
	assert.equal(again.ok, true);
	assert.ok(again.value.nodes.some((n) => n.id === 'c5' && n.transport === 'ssh://'));
	assert.equal(nodesFileOf(env).nodes.some((n) => n.id === 'c5'), true);
	rmSync(env.__dir, { recursive: true, force: true });
});
//#endregion
