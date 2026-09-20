// 安全纯逻辑单测：脱敏（redact）/ 敏感值收集 / 配置投影（sanitizeConfig）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	REDACT_TOKEN,
	DEFAULT_FILE_MAX_BYTES,
	DEFAULT_EXEC_TIMEOUT_MS,
	DEFAULT_EXEC_MAX_OUTPUT_BYTES,
	redactText,
	sensitiveValuesOf,
	redactError,
	sanitizeConfig,
} from '../dsh-ssh-gui/lib/core.js';

test('redactText：长值/路径值替换，短值跳过（阈值与底座 redactValues 一致）', () => {
	const secrets = ['/home/u/.ssh/id_rsa', 's3cret-password', 'x'];
	const out = redactText('cannot read /home/u/.ssh/id_rsa with s3cret-password and x and y', secrets);
	assert.match(out, /cannot read <redacted>/);
	assert.match(out, /with <redacted> and x/); // 短值 'x' 不替换（避免误伤普通词）
	assert.doesNotMatch(out, /s3cret-password/);
});

test('redactText：空/非字符串敏感值跳过；消息空安全', () => {
	assert.equal(redactText('abc', [undefined, null, '', 42]), 'abc');
	assert.equal(redactText(undefined, ['secret']), '');
	assert.equal(redactText('hello secret', []), 'hello secret');
});

test('sensitiveValuesOf：收集 password/passphrase/privateKeyPath + 跳板链，缺省跳过', () => {
	const spec = {
		password: 'pw',
		passphrase: 'pp',
		privateKeyPath: '/keys/c1',
		jump: [{ password: 'jp', passphrase: 'jpp', privateKey: '/keys/jump' }],
	};
	const values = sensitiveValuesOf(spec);
	assert.ok(values.includes('pw'));
	assert.ok(values.includes('pp'));
	assert.ok(values.includes('/keys/c1'));
	assert.ok(values.includes('jp'));
	assert.ok(values.includes('/keys/jump'));
	assert.equal(sensitiveValuesOf(undefined).length, 0);
	assert.equal(sensitiveValuesOf({}).length, 0);
});

test('redactError：把抛出的值包装为脱敏 Error', () => {
	const spec = { privateKeyPath: '/secret/keys/c1', password: 'hunter2-secret' };
	const error = redactError(new Error('cannot read /secret/keys/c1 with hunter2-secret'), spec);
	assert.ok(error instanceof Error);
	assert.doesNotMatch(error.message, /hunter2-secret/);
	assert.doesNotMatch(error.message, /\/secret\/keys\/c1/);
	assert.match(error.message, new RegExp(REDACT_TOKEN));
	// 非 Error 抛值也可脱敏
	const other = redactError('raw value /secret/keys/c1', spec);
	assert.match(other.message, /raw value <redacted>/);
});

test('sanitizeConfig：默认值投影（无秘密面）', () => {
	const out = sanitizeConfig(undefined);
	assert.equal(out.file.maxBytes, DEFAULT_FILE_MAX_BYTES);
	assert.equal(out.exec.timeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
	assert.equal(out.exec.maxOutputBytes, DEFAULT_EXEC_MAX_OUTPUT_BYTES);
	assert.equal(out.security.confirmExec, true);
	assert.deepEqual(out.security.execAllowlist, []);
});

test('sanitizeConfig：显式配置投影 + 过滤', () => {
	const out = sanitizeConfig({
		file: { maxBytes: 512 },
		exec: { timeoutMs: 4000, maxOutputBytes: 2048 },
		security: { confirmExec: false, execAllowlist: ['ls', '', 42, 'df'] },
	});
	assert.equal(out.file.maxBytes, 512);
	assert.equal(out.exec.timeoutMs, 4000);
	assert.equal(out.exec.maxOutputBytes, 2048);
	assert.equal(out.security.confirmExec, false);
	assert.deepEqual(out.security.execAllowlist, ['ls', 'df']);
	// 非法数值回落默认
	const bad = sanitizeConfig({ file: { maxBytes: -1 }, exec: { timeoutMs: 'x' } });
	assert.equal(bad.file.maxBytes, DEFAULT_FILE_MAX_BYTES);
	assert.equal(bad.exec.timeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
});
