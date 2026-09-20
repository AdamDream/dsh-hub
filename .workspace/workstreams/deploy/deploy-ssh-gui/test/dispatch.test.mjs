// /ssh-gui 端点分发单测：payload 守卫 / 端点语义 / 安全闸 / wire 错误映射。
// createDispatch(env) 全部外部面注入 fake，零网络、零 cordis、零 ~/.dsh。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch, sanitizeConfig, DEFAULT_FILE_MAX_BYTES } from '../dsh-ssh-gui/lib/core.js';

const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n';

function makeEnv(overrides = {}) {
	// `cfg` override 是“配置对象”而非 env 函数：先取出，避免被末尾 spread 覆盖成非法 env.cfg。
	const { cfg: cfgOverride, ...rest } = overrides;
	const dir = mkdtempSync(join(tmpdir(), 'ssh-gui-dispatch-'));
	const machines = [
		{ id: 'c1', label: 'm1', host: 'h1', username: 'u1', port: 22, privateKeyPath: undefined },
	];
	const savedCalls = [];
	const sftpFake = {
		stat: async (path) => ({ size: path.endsWith('/big.bin') ? DEFAULT_FILE_MAX_BYTES + 1 : 5, isFile: () => true }),
		readFile: async (path) => Buffer.from('hello ' + path),
		writeFile: async (path, buf) => { sftpFake.written = { path, buf }; },
		readdir: async (path) => [
			{ filename: 'a.txt', attrs: { isDirectory: () => false, size: 3 } },
			{ filename: 'sub', attrs: { isDirectory: () => true, size: 0 } },
			{ filename: '.', attrs: { isDirectory: () => true } },
			{ filename: '..', attrs: { isDirectory: () => true } },
		],
	};
	const creds = { MY_SSH_KEY: PEM, NOT_A_KEY: 's3cret-value' };
	const env = {
		cfg: () => sanitizeConfig(cfgOverride),
		registry: {
			listMachines: () => ({ machines }),
			get: (id) => (id === 'c1'
				? { spec: machines[0], exec: async (command, opts) => ({ exitCode: 0, stdout: 'out:' + command + (opts && opts.cwd ? '@' + opts.cwd : ''), stderr: '' }) }
				: undefined),
			getActive: () => ({ spec: machines[0], connection: { exec: async () => ({ exitCode: 0, stdout: 'active', stderr: '' }) } }),
			saveMachine: async (input) => { savedCalls.push(input); Object.assign(machines[0], input); return machines[0]; },
		},
		credentials: {
			resolve: async (ref) => (creds[ref] !== undefined ? { value: creds[ref], source: 'file' } : undefined),
			describe: async (ref) => ({ configured: creds[ref] !== undefined, source: 'file', writable: true }),
		},
		keysDir: () => join(dir, 'keys'),
		keyrefsFile: () => join(dir, 'ssh-keyrefs.json'),
		resolveTarget: (id) => {
			if (id !== undefined) {
				const connection = env.registry.get(id.trim());
				if (connection === undefined) throw new Error(`bad-request: unknown machine id ${JSON.stringify(id.trim())}`);
				return { spec: connection.spec, connection };
			}
			return env.registry.getActive();
		},
		connectionExec: (connection, command, opts) => connection.exec(command, opts),
		sftpOf: async () => sftpFake,
		remoteHomeOf: async () => '/home/u1',
		statFile: (sftp, path, signal) => sftp.stat(path),
		readFileOf: (sftp, path, signal) => sftp.readFile(path),
		writeFileOf: (sftp, path, buf, signal) => sftp.writeFile(path, buf),
		readdirOf: (sftp, path, signal) => sftp.readdir(path),
		...rest,
	};
	env.__savedCalls = savedCalls;
	env.__dir = dir;
	env.__sftpFake = sftpFake;
	return env;
}

test('config.get：返回 settings 投影（无秘密面）', async () => {
	const env = makeEnv({ cfg: { file: { maxBytes: 512 } } });
	const dispatch = createDispatch(env);
	const result = await dispatch('config.get', {});
	assert.equal(result.ok, true);
	assert.equal(result.value.file.maxBytes, 512);
	assert.equal(result.value.security.confirmExec, true);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('keyref.set：PEM 凭据绑定全链路（0600 文件 + 侧表 + saveMachine(privateKeyPath)）', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const result = await dispatch('keyref.set', { machineId: 'c1', refName: 'MY_SSH_KEY' });
	assert.equal(result.ok, true);
	const keyFile = join(env.__dir, 'keys', 'c1');
	assert.equal(readFileSync(keyFile, 'utf8'), PEM);
	assert.equal(statSync(keyFile).mode & 0o777, 0o600);
	assert.equal(statSync(join(env.__dir, 'keys')).mode & 0o777, 0o700);
	const side = JSON.parse(readFileSync(join(env.__dir, 'ssh-keyrefs.json'), 'utf8'));
	assert.equal(side.bindings.c1, 'MY_SSH_KEY');
	assert.ok(env.__savedCalls.some((call) => call.privateKeyPath === keyFile));
	rmSync(env.__dir, { recursive: true, force: true });
});

test('keyref.set：非 PEM 凭据 / 未知 ref / 未知机器 → bad-request（值不出 host）', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const notKey = await dispatch('keyref.set', { machineId: 'c1', refName: 'NOT_A_KEY' });
	assert.equal(notKey.ok, false);
	assert.equal(notKey.error.code, 'bad-request');
	assert.match(notKey.error.message, /not a PEM private key/);
	assert.doesNotMatch(notKey.error.message, /s3cret-value/); // 值绝不回显
	const missing = await dispatch('keyref.set', { machineId: 'c1', refName: 'MISSING_REF' });
	assert.equal(missing.ok, false);
	assert.equal(missing.error.code, 'bad-request');
	const unknown = await dispatch('keyref.set', { machineId: 'nope', refName: 'MY_SSH_KEY' });
	assert.equal(unknown.ok, false);
	assert.equal(unknown.error.code, 'bad-request');
	const malformed = await dispatch('keyref.set', { machineId: '../x', refName: 'MY_SSH_KEY' });
	assert.equal(malformed.ok, false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('keyref.unbind：解绑清侧表 + 删密钥文件 + saveMachine 清 privateKeyPath', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('keyref.set', { machineId: 'c1', refName: 'MY_SSH_KEY' });
	const keyFile = join(env.__dir, 'keys', 'c1');
	assert.equal(readFileSync(keyFile, 'utf8'), PEM);
	const result = await dispatch('keyref.unbind', { id: 'c1' });
	assert.equal(result.ok, true);
	assert.equal(result.value.had, true);
	assert.throws(() => readFileSync(keyFile)); // 文件已删
	const side = JSON.parse(readFileSync(join(env.__dir, 'ssh-keyrefs.json'), 'utf8'));
	assert.equal(side.bindings.c1, undefined);
	const clearCall = env.__savedCalls[env.__savedCalls.length - 1];
	assert.equal(clearCall.privateKeyPath, '');
	rmSync(env.__dir, { recursive: true, force: true });
});

test('keyref.list：绑定视图只含 ref 名 + configured', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	await dispatch('keyref.set', { machineId: 'c1', refName: 'MY_SSH_KEY' });
	const result = await dispatch('keyref.list', {});
	assert.equal(result.ok, true);
	assert.deepEqual(result.value.bindings, [{ machineId: 'c1', refName: 'MY_SSH_KEY', configured: true }]);
	assert.doesNotMatch(JSON.stringify(result.value), /BEGIN OPENSSH/); // 值永不出 host
	rmSync(env.__dir, { recursive: true, force: true });
});

test('exec.run：正常执行 + cwd 透传 + 输出截断标记', async () => {
	const env = makeEnv({ cfg: { exec: { maxOutputBytes: 4096 } } });
	const dispatch = createDispatch(env);
	const result = await dispatch('exec.run', { id: 'c1', command: 'ls -la', cwd: '/tmp' });
	assert.equal(result.ok, true);
	assert.equal(result.value.exitCode, 0);
	assert.equal(result.value.stdout, 'out:ls -la@/tmp'); // cwd 已透传给 connection.exec
	assert.equal(result.value.stderr, '');
	assert.equal(result.value.truncated, false);
	assert.equal(result.value.timedOut, false);
	rmSync(env.__dir, { recursive: true, force: true });

	// 输出上限：超出截尾并标记
	const capped = makeEnv({ cfg: { exec: { maxOutputBytes: 8 } } });
	const cappedResult = await createDispatch(capped)('exec.run', { id: 'c1', command: 'ls -la' });
	assert.equal(cappedResult.value.stdout, 'out:ls -');
	assert.equal(cappedResult.value.truncated, true);
	rmSync(capped.__dir, { recursive: true, force: true });
});

test('exec.run：白名单硬闸（空=放行；非空=首 token 精确）', async () => {
	const openEnv = makeEnv();
	const open = createDispatch(openEnv);
	assert.equal((await open('exec.run', { id: 'c1', command: 'rm -rf /' })).ok, true);
	const lockedEnv = makeEnv({ cfg: { security: { execAllowlist: ['ls', 'df'] } } });
	const locked = createDispatch(lockedEnv);
	const blocked = await locked('exec.run', { id: 'c1', command: 'rm -rf /' });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.error.code, 'bad-request');
	assert.match(blocked.error.message, /not in the exec allowlist/);
	const allowed = await locked('exec.run', { id: 'c1', command: 'ls -la' });
	assert.equal(allowed.ok, true);
	rmSync(openEnv.__dir, { recursive: true, force: true });
	rmSync(lockedEnv.__dir, { recursive: true, force: true });
});

test('exec.run：空命令 / 未知 id / 非法 cwd / 非法超时 → bad-request', async () => {
	const dispatch = createDispatch(makeEnv());
	assert.equal((await dispatch('exec.run', { id: 'c1', command: '   ' })).ok, false);
	assert.equal((await dispatch('exec.run', { id: 'nope', command: 'ls' })).ok, false);
	assert.equal((await dispatch('exec.run', { id: 'c1', command: 'ls', cwd: 'rel' })).ok, false);
	assert.equal((await dispatch('exec.run', { id: 'c1', command: 'ls', timeoutMs: 0 })).ok, false);
	assert.equal((await dispatch('exec.run', { command: 'ls' })).ok, true); // 缺 id → 活动机
});

test('exec.run：连接错误消息脱敏（私钥路径/口令 → <redacted>）', async () => {
	const env = makeEnv();
	env.registry.get = (id) => (id === 'c1'
		? { spec: { ...env.registry.listMachines().machines[0], password: 'hunter2-secret', privateKeyPath: '/secret/keys/c1' },
			exec: async () => { throw new Error('cannot read /secret/keys/c1 with hunter2-secret'); } }
		: undefined);
	const dispatch = createDispatch(env);
	const result = await dispatch('exec.run', { id: 'c1', command: 'ls' });
	assert.equal(result.ok, false);
	assert.doesNotMatch(result.error.message, /hunter2-secret/);
	assert.doesNotMatch(result.error.message, /\/secret\/keys\/c1/);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('file.list：含文件条目 + 目录/文件区分 + 过滤 . / ..', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const result = await dispatch('file.list', { id: 'c1' });
	assert.equal(result.ok, true);
	assert.equal(result.value.path, '/home/u1');
	assert.equal(result.value.home, '/home/u1');
	const names = result.value.entries.map((e) => e.name);
	assert.deepEqual(names, ['a.txt', 'sub']);
	const file = result.value.entries.find((e) => e.name === 'a.txt');
	assert.equal(file.isDir, false);
	assert.equal(file.size, 3);
	const dir = result.value.entries.find((e) => e.name === 'sub');
	assert.equal(dir.isDir, true);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('file.get：正常下载 base64；超限 → bad-request 提示 sw_*；非文件 → bad-request', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const ok = await dispatch('file.get', { id: 'c1', remotePath: '/home/u1/a.txt' });
	assert.equal(ok.ok, true);
	assert.equal(ok.value.name, 'a.txt');
	assert.equal(Buffer.from(ok.value.base64, 'base64').toString('utf8'), 'hello /home/u1/a.txt');
	const big = await dispatch('file.get', { id: 'c1', remotePath: '/home/u1/big.bin' });
	assert.equal(big.ok, false);
	assert.equal(big.error.code, 'bad-request');
	assert.match(big.error.message, /sw_\*/);
	const notFile = await dispatch('file.get', { id: 'c1', remotePath: 'rel/path' });
	assert.equal(notFile.ok, false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('file.put：解码写远端；超限/空载荷 → bad-request', async () => {
	const env = makeEnv();
	const dispatch = createDispatch(env);
	const buf = Buffer.from('payload-data');
	const ok = await dispatch('file.put', { id: 'c1', remotePath: '/home/u1/up.bin', base64: buf.toString('base64') });
	assert.equal(ok.ok, true);
	assert.equal(ok.value.size, buf.length);
	assert.ok(env.__sftpFake.written);
	assert.ok(env.__sftpFake.written.buf.equals(buf));
	const tooBig = await dispatch('file.put', { id: 'c1', remotePath: '/x', base64: Buffer.alloc(DEFAULT_FILE_MAX_BYTES + 1).toString('base64') });
	assert.equal(tooBig.ok, false);
	assert.equal(tooBig.error.code, 'bad-request');
	const empty = await dispatch('file.put', { id: 'c1', remotePath: '/x', base64: '' });
	assert.equal(empty.ok, false);
	rmSync(env.__dir, { recursive: true, force: true });
});

test('未知端点 / 坏载荷 → bad-request wire 词汇', async () => {
	const dispatch = createDispatch(makeEnv());
	const unknown = await dispatch('nope.endpoint', {});
	assert.equal(unknown.ok, false);
	assert.equal(unknown.error.code, 'bad-request');
	assert.deepEqual(unknown.error.details, { issues: [] });
	const badPayload = await dispatch('exec.run', { id: 42 });
	assert.equal(badPayload.ok, false);
	assert.equal(badPayload.error.code, 'bad-request');
});
