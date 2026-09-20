//#region test/nodes.test.mjs
// 统一节点注册表纯逻辑单测：三类传输 target 规范化 / 节点规范化 / machines→ssh 节点映射 /
// 首启迁移（machines + seeds）/ machines 双向同步 / nodes.json 读写 / 视图无秘密 /
// console 载荷编码（lineEnding / hex）。
// 运行：node --test test/nodes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	TRANSPORTS,
	isTransport,
	safeNodeId,
	normalizeSshTarget,
	normalizeSerialTarget,
	normalizeSerialTcpTarget,
	normalizeNode,
	sshNodeFromMachine,
	nextNodeId,
	migrateMachinesToNodes,
	syncNodesWithMachines,
	readNodesFile,
	writeNodesFile,
	nodeView,
	consoleLineEnding,
	encodeConsolePayload,
	NODES_VERSION,
} from '../dsh-ssh-gui/lib/core.js';

function tempDir() {
	return mkdtempSync(join(tmpdir(), 'ssh-gui-nodes-'));
}

test('TRANSPORTS 三态 + isTransport（scheme 形态）', () => {
	assert.deepEqual(TRANSPORTS, ['ssh://', 'serial://', 'serial-tcp://']);
	assert.equal(isTransport('ssh://'), true);
	assert.equal(isTransport('serial://'), true);
	assert.equal(isTransport('serial-tcp://'), true);
	assert.equal(isTransport('ssh'), false);
	assert.equal(isTransport('tcp://'), false);
	assert.equal(isTransport(undefined), false);
});

test('safeNodeId：与机器 id 同文法，拒路径穿越', () => {
	assert.equal(safeNodeId('c1'), true);
	assert.equal(safeNodeId('s1'), true);
	assert.equal(safeNodeId('tcp-rack-1'), true);
	assert.equal(safeNodeId('../x'), false);
	assert.equal(safeNodeId('a..b'), false);
	assert.equal(safeNodeId('.x'), false);
	assert.equal(safeNodeId(''), false);
});

test('normalizeSshTarget：host/username 必填、port 默认 22、可选字段透传、keyRef 只存 ref 名', () => {
	const out = normalizeSshTarget({ host: ' h1 ', username: 'u1', port: 2222, workspace: '/data', cwd: '/root', agent: '%default', keyRef: 'MY_SSH_KEY' });
	assert.deepEqual(out, { host: 'h1', port: 2222, username: 'u1', workspace: '/data', cwd: '/root', agent: '%default', keyRef: 'MY_SSH_KEY' });
	assert.equal(normalizeSshTarget({ host: 'h', username: 'u' }).port, 22);
	// 非法 keyRef 名不落 target（侧表才是权威）
	assert.equal(normalizeSshTarget({ host: 'h', username: 'u', keyRef: 'bad-ref' }).keyRef, undefined);
	assert.throws(() => normalizeSshTarget({ host: '', username: 'u' }), /bad-request/);
	assert.throws(() => normalizeSshTarget({ host: 'h', username: '' }), /bad-request/);
	assert.throws(() => normalizeSshTarget({ host: 'h', username: 'u', port: 70000 }), /bad-request/);
	assert.throws(() => normalizeSshTarget({ host: 'h', username: 'u', port: 22.5 }), /bad-request/);
	assert.throws(() => normalizeSshTarget(null), /bad-request/);
});

test('normalizeSerialTarget：设备路径/波特率/后端', () => {
	const out = normalizeSerialTarget({ port: ' /dev/ttyUSB0 ', baudRate: 9600, backend: 'serialport' });
	assert.deepEqual(out, { port: '/dev/ttyUSB0', baudRate: 9600, backend: 'serialport' });
	assert.equal(normalizeSerialTarget({ port: '/dev/ttyACM0' }).baudRate, 115200);
	assert.equal(normalizeSerialTarget({ port: '/dev/ttyACM0' }).backend, 'stty');
	assert.throws(() => normalizeSerialTarget({ port: '' }), /bad-request/);
	assert.throws(() => normalizeSerialTarget({ port: '/dev/tty;rm' }), /bad-request/);
	assert.throws(() => normalizeSerialTarget({ port: '/dev/ttyUSB0', baudRate: 12.5 }), /bad-request/);
	assert.throws(() => normalizeSerialTarget({ port: '/dev/ttyUSB0', baudRate: 99999999 }), /bad-request/);
	assert.throws(() => normalizeSerialTarget({ port: '/dev/ttyUSB0', backend: 'nope' }), /bad-request/);
});

test('normalizeSerialTcpTarget：host/port 必填、tty 可选、无凭据字段', () => {
	const out = normalizeSerialTcpTarget({ host: ' 10.0.0.5 ', port: 4001, tty: '/dev/ttyS0' });
	assert.deepEqual(out, { host: '10.0.0.5', port: 4001, tty: '/dev/ttyS0' });
	assert.deepEqual(normalizeSerialTcpTarget({ host: 'rack', port: 4001 }), { host: 'rack', port: 4001 });
	assert.equal(normalizeSerialTcpTarget({ host: 'rack', port: 4001 }).password, undefined);
	assert.throws(() => normalizeSerialTcpTarget({ host: '', port: 4001 }), /bad-request/);
	assert.throws(() => normalizeSerialTcpTarget({ host: 'rack', port: 0 }), /bad-request/);
	assert.throws(() => normalizeSerialTcpTarget({ host: 'rack', port: 65536 }), /bad-request/);
	assert.throws(() => normalizeSerialTcpTarget({ host: 'rack', port: 4001.5 }), /bad-request/);
});

test('normalizeNode：三类全通过；未知传输/坏 target/坏 id 拒绝', () => {
	const ssh = normalizeNode({ id: 'c1', name: '主控', transport: 'ssh://', target: { host: 'h1', username: 'u1' } });
	assert.equal(ssh.name, '主控');
	const serial = normalizeNode({ id: 's1', transport: 'serial://', target: { port: '/dev/ttyUSB0' } });
	assert.equal(serial.name, 's1'); // name 缺省回落 id
	assert.equal(serial.target.baudRate, 115200);
	const tcp = normalizeNode({ id: 't1', transport: 'serial-tcp://', target: { host: '10.0.0.5', port: 4001 } });
	assert.equal(tcp.transport, 'serial-tcp://');
	assert.throws(() => normalizeNode({ id: 'x', transport: 'ftp://', target: {} }), /unknown transport/);
	assert.throws(() => normalizeNode({ id: '../x', transport: 'ssh://', target: { host: 'h', username: 'u' } }), /invalid node id/);
	assert.throws(() => normalizeNode({ id: 'x', transport: 'ssh://', target: { host: 'h' } }), /bad-request/);
	assert.throws(() => normalizeNode(null), /bad-request/);
});

test('sshNodeFromMachine：机器 → ssh 节点（label→name，keyRef 名可选）', () => {
	const node = sshNodeFromMachine(
		{ id: 'c1', label: 'm1', host: 'h1', port: 2222, username: 'u1', workspace: '/data', cwd: '/root', agent: '%default' },
		'MY_SSH_KEY',
	);
	assert.deepEqual(node, {
		id: 'c1',
		name: 'm1',
		transport: 'ssh://',
		target: { host: 'h1', port: 2222, username: 'u1', workspace: '/data', cwd: '/root', agent: '%default', keyRef: 'MY_SSH_KEY' },
	});
	assert.equal(sshNodeFromMachine({ id: 'c2', host: 'h', username: 'u' }, undefined).name, 'c2'); // 无 label → id
});

test('nextNodeId：不与现有冲突', () => {
	const existing = new Set(['c1', 's1', 's2']);
	assert.equal(nextNodeId(existing, 's'), 's3');
	assert.equal(nextNodeId(new Set(), 's'), 's1');
	assert.equal(nextNodeId(new Set(['t1']), 't'), 't2');
});

test('migrateMachinesToNodes：machines 迁移 + seeds 导入（serial/serial-tcp）+ currentId', () => {
	const machines = [
		{ id: 'c1', label: 'm1', host: 'h1', username: 'u1', port: 22 },
		{ id: 'c2', host: 'h2', username: 'u2', port: 22 },
	];
	const bindings = { c1: 'MY_SSH_KEY' };
	const seeds = {
		serial: [{ name: 'esp', port: '/dev/ttyUSB0', baudRate: 115200, backend: 'stty' }],
		serialTcp: [{ name: 'rack', host: '10.0.0.5', port: 4001, tty: '/dev/ttyS0' }],
	};
	const state = migrateMachinesToNodes(machines, 'c1', bindings, seeds);
	assert.equal(state.version, NODES_VERSION);
	assert.equal(state.currentId, 'c1');
	assert.equal(state.nodes.length, 4);
	const c1 = state.nodes.find((n) => n.id === 'c1');
	assert.equal(c1.transport, 'ssh://');
	assert.equal(c1.target.keyRef, 'MY_SSH_KEY');
	assert.equal(c1.name, 'm1');
	const s1 = state.nodes.find((n) => n.transport === 'serial://');
	assert.deepEqual(s1, { id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0', baudRate: 115200, backend: 'stty' } });
	const t1 = state.nodes.find((n) => n.transport === 'serial-tcp://');
	assert.deepEqual(t1.target, { host: '10.0.0.5', port: 4001, tty: '/dev/ttyS0' });
	// 非法种子条目跳过
	const badSeeds = migrateMachinesToNodes([], null, {}, { serial: [{ port: '/dev/tty;x' }], serialTcp: [{ host: 'h', port: 99999 }] });
	assert.equal(badSeeds.nodes.length, 0);
});

test('syncNodesWithMachines：导入底座新增 / 修剪底座已删 / 更新 name/target/keyRef', () => {
	const nodes = [
		{ id: 'c1', name: 'old', transport: 'ssh://', target: { host: 'h1', port: 22, username: 'u1' } },
		{ id: 's1', name: 'esp', transport: 'serial://', target: { port: '/dev/ttyUSB0', baudRate: 115200, backend: 'stty' } },
	];
	const machines = [
		{ id: 'c1', label: 'new-label', host: 'h1', port: 22, username: 'u1' }, // 改名
		{ id: 'c9', host: 'h9', username: 'u9', port: 22 }, // 底座新增
	];
	const { nodes: out, changed } = syncNodesWithMachines(nodes, machines, { c1: 'NEW_REF' });
	assert.equal(changed, true);
	assert.equal(out.length, 3);
	assert.equal(out.find((n) => n.id === 'c1').name, 'new-label');
	assert.equal(out.find((n) => n.id === 'c1').target.keyRef, 'NEW_REF');
	assert.ok(out.some((n) => n.id === 'c9' && n.transport === 'ssh://'));
	assert.ok(out.some((n) => n.id === 's1')); // serial 节点不受影响
	// 底座删掉 c1 → 修剪（serial 保留）
	const pruned = syncNodesWithMachines(out, machines.filter((m) => m.id !== 'c1'), {});
	assert.equal(pruned.nodes.some((n) => n.id === 'c1'), false);
	assert.equal(pruned.nodes.some((n) => n.id === 's1'), true);
	// 无变化 → changed false
	const same = syncNodesWithMachines(pruned.nodes, machines.filter((m) => m.id !== 'c1'), {});
	assert.equal(same.changed, false);
});

test('readNodesFile / writeNodesFile：roundtrip、缺失/损坏回退空表、0600', () => {
	const dir = tempDir();
	const file = join(dir, 'nodes.json');
	// 缺失 → 空表
	assert.deepEqual(readNodesFile(file), { version: NODES_VERSION, currentId: null, nodes: [] });
	// 写 + 读回
	const state = { version: NODES_VERSION, currentId: 'c1', nodes: [{ id: 'c1', name: 'm1', transport: 'ssh://', target: { host: 'h1', port: 22, username: 'u1' } }] };
	writeNodesFile(file, state);
	assert.deepEqual(readNodesFile(file), state);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	// 损坏 → 空表（不抛）
	writeNodesFile(file, '{bad json');
	assert.deepEqual(readNodesFile(file), { version: NODES_VERSION, currentId: null, nodes: [] });
	// 非法条目过滤
	writeNodesFile(file, { version: 1, currentId: 'x', nodes: [{ id: 'ok', transport: 'ssh://', target: { host: 'h', username: 'u' } }, { id: '../bad', transport: 'ssh://', target: {} }] });
	assert.equal(readNodesFile(file).nodes.length, 1);
	rmSync(dir, { recursive: true, force: true });
});

test('nodeView：视图记录含 target 副本（无秘密面）', () => {
	const node = normalizeNode({ id: 'c1', name: 'm1', transport: 'ssh://', target: { host: 'h1', username: 'u1', keyRef: 'MY_SSH_KEY' } });
	const view = nodeView(node);
	assert.deepEqual(view, { id: 'c1', name: 'm1', transport: 'ssh://', target: { host: 'h1', port: 22, username: 'u1', keyRef: 'MY_SSH_KEY' } });
	assert.notEqual(view.target, node.target); // 副本
});

test('consoleLineEnding / encodeConsolePayload：text+后缀 / hex / 非法拒绝', () => {
	assert.equal(consoleLineEnding(undefined), '\n');
	assert.equal(consoleLineEnding('none'), '');
	assert.equal(consoleLineEnding('crlf'), '\r\n');
	assert.throws(() => consoleLineEnding('xx'), /bad-request/);
	assert.equal(encodeConsolePayload('ls -la', 'text', '\n').toString(), 'ls -la\n');
	assert.deepEqual(encodeConsolePayload('41 42', 'hex', ''), Buffer.from([0x41, 0x42]));
	assert.throws(() => encodeConsolePayload('', 'text', '\n'), /bad-request/);
	assert.throws(() => encodeConsolePayload('zz', 'hex', ''), /bad-request/);
	assert.throws(() => encodeConsolePayload('x', 'base64', ''), /bad-request/);
});
//#endregion
