// keyRef 纯逻辑单测：machineId 文法 / ref 名文法 / PEM 判定 / 侧表读写 / 0600 / 绑定视图。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	safeMachineId,
	isRefName,
	isPemPrivateKey,
	keyRefPathFor,
	readKeyrefsFile,
	writeKeyrefsFile,
	writePemFile,
	removeKeyFile,
	resolveBindings,
	validateKeyRefSet,
} from '../dsh-ssh-gui/lib/core.js';

function tempDir() {
	return mkdtempSync(join(tmpdir(), 'ssh-gui-test-'));
}

test('safeMachineId 文法（与底座 parseSshRoute 的 id 文法一致，拒路径穿越）', () => {
	assert.equal(safeMachineId('c1'), true);
	assert.equal(safeMachineId('tmp-a1b2c3'), true);
	assert.equal(safeMachineId('host.local-1_x'), true);
	assert.equal(safeMachineId('../x'), false);
	assert.equal(safeMachineId('a..b'), false);
	assert.equal(safeMachineId('.hidden'), false);
	assert.equal(safeMachineId(''), false);
	assert.equal(safeMachineId('a/b'), false);
	assert.equal(safeMachineId(42), false);
});

test('isRefName 文法（dsh-credentials REF_PATTERN）', () => {
	assert.equal(isRefName('MY_SSH_KEY'), true);
	assert.equal(isRefName('_PRIVATE'), true);
	assert.equal(isRefName('a1'), true);
	assert.equal(isRefName('1ABC'), false); // 数字开头
	assert.equal(isRefName('a-b'), false); // 连字符非法
	assert.equal(isRefName(''), false);
	assert.equal(isRefName(null), false);
});

test('isPemPrivateKey 只认 PEM 私钥文本', () => {
	assert.equal(isPemPrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'), true);
	assert.equal(isPemPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'), true);
	assert.equal(isPemPrivateKey('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'), false); // 无 PRIVATE KEY
	assert.equal(isPemPrivateKey('s3cret-password'), false);
	assert.equal(isPemPrivateKey(undefined), false);
	assert.equal(isPemPrivateKey(null), false);
});

test('keyRefPathFor 路径拼接 + 非法 id 拒绝', () => {
	const dir = tempDir();
	assert.equal(keyRefPathFor(dir, 'c1'), join(dir, 'c1'));
	assert.throws(() => keyRefPathFor(dir, '../etc'), /bad-request/);
	assert.throws(() => keyRefPathFor(dir, ''), /bad-request/);
	rmSync(dir, { recursive: true, force: true });
});

test('readKeyrefsFile：缺失/损坏/合法三种形态', () => {
	const dir = tempDir();
	const file = join(dir, 'ssh-keyrefs.json');
	// 缺失 → 空表
	assert.deepEqual(readKeyrefsFile(file), { version: 1, bindings: {} });
	// 损坏 → 空表（不抛）
	writeKeyrefsFile(file, '{not json');
	assert.deepEqual(readKeyrefsFile(file), { version: 1, bindings: {} });
	// 合法 → 保留，非法条目被过滤
	writeKeyrefsFile(file, { version: 1, bindings: { c1: 'MY_SSH_KEY', 'bad/../id': 'X', c2: '' } });
	assert.deepEqual(readKeyrefsFile(file), { version: 1, bindings: { c1: 'MY_SSH_KEY' } });
	rmSync(dir, { recursive: true, force: true });
});

test('writeKeyrefsFile / writePemFile 显式 0600（目录 0700）', () => {
	const dir = tempDir();
	const nested = join(dir, 'a', 'b');
	const refFile = join(nested, 'ssh-keyrefs.json');
	writeKeyrefsFile(refFile, { version: 1, bindings: { c1: 'MY_SSH_KEY' } });
	assert.equal(statSync(refFile).mode & 0o777, 0o600);
	assert.equal(statSync(nested).mode & 0o777, 0o700);
	const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n';
	const keyFile = join(nested, 'keys', 'c1');
	writePemFile(keyFile, pem);
	assert.equal(statSync(keyFile).mode & 0o777, 0o600);
	assert.equal(readFileSync(keyFile, 'utf8'), pem);
	rmSync(dir, { recursive: true, force: true });
});

test('removeKeyFile 幂等（不存在不抛）', () => {
	const dir = tempDir();
	const file = join(dir, 'gone');
	removeKeyFile(file); // 不存在 → 不抛
	writePemFile(file, '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----');
	assert.equal(existsSync(file), true);
	removeKeyFile(file);
	assert.equal(existsSync(file), false);
	rmSync(dir, { recursive: true, force: true });
});

test('resolveBindings：configured 状态来自 describeRef，失败降级 false，值不出视图', async () => {
	const state = { version: 1, bindings: { c1: 'MY_SSH_KEY', c2: 'MISSING_REF' } };
	const describeRef = async (refName) => {
		if (refName === 'MY_SSH_KEY') return { configured: true, source: 'file', writable: true };
		if (refName === 'MISSING_REF') return { configured: false, writable: true };
		throw new Error('boom');
	};
	const bindings = await resolveBindings(state, describeRef);
	assert.deepEqual(bindings, [
		{ machineId: 'c1', refName: 'MY_SSH_KEY', configured: true },
		{ machineId: 'c2', refName: 'MISSING_REF', configured: false },
	]);
	// 视图只含 ref 名，绝不含值
	assert.equal(JSON.stringify(bindings).includes('s3cret'), false);
});

test('validateKeyRefSet：合法通过，非法抛 bad-request', () => {
	assert.deepEqual(validateKeyRefSet('c1', 'MY_SSH_KEY'), { machineId: 'c1', refName: 'MY_SSH_KEY' });
	assert.throws(() => validateKeyRefSet('../x', 'MY_SSH_KEY'), /bad-request/);
	assert.throws(() => validateKeyRefSet('c1', 'not-a-ref'), /bad-request/);
	assert.throws(() => validateKeyRefSet('c1', ''), /bad-request/);
});
