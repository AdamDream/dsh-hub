// file 纯逻辑单测：大小上限 / base64 解码 / 路径校验 / 文件名提取。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_FILE_MAX_BYTES,
	validateFileSize,
	fileTooLargeMessage,
	decodeBase64Payload,
	remotePathName,
	validateRemotePath,
	withTimeout,
} from '../dsh-ssh-gui/lib/core.js';

test('validateFileSize：上限以内放行（含恰好等于），超出拒绝', () => {
	const max = DEFAULT_FILE_MAX_BYTES;
	assert.equal(validateFileSize(0, max), true);
	assert.equal(validateFileSize(1024, max), true);
	assert.equal(validateFileSize(max, max), true);
	assert.equal(validateFileSize(max + 1, max), false);
	assert.equal(validateFileSize(-1, max), false);
	assert.equal(validateFileSize(1.5, max), false); // 非整数
});

test('fileTooLargeMessage：带上限与 sw_* 提示', () => {
	const message = fileTooLargeMessage(DEFAULT_FILE_MAX_BYTES + 1, DEFAULT_FILE_MAX_BYTES);
	assert.match(message, /exceeding the 10485760-byte limit/);
	assert.match(message, /sw_\*/);
});

test('decodeBase64Payload：合法解码 / 空拒 / 超限拒', () => {
	const max = 1024;
	const buf = Buffer.from('hello ssh-gui');
	const encoded = buf.toString('base64');
	const decoded = decodeBase64Payload(encoded, max);
	assert.ok(decoded.equals(buf));
	assert.throws(() => decodeBase64Payload('', max), /bad-request/);
	assert.throws(() => decodeBase64Payload('   ', max), /bad-request/);
	assert.throws(() => decodeBase64Payload('!!!!', max), /empty buffer/); // 非法字符 → 空 buffer
	assert.throws(() => decodeBase64Payload(Buffer.alloc(max + 1).toString('base64'), max), /exceeding the 1024-byte limit/);
	assert.throws(() => decodeBase64Payload(undefined, max), /bad-request/);
});

test('remotePathName：basename 提取，根/空返回 null', () => {
	assert.equal(remotePathName('/etc/hostname'), 'hostname');
	assert.equal(remotePathName('/var/log/dmesg'), 'dmesg');
	assert.equal(remotePathName('/'), null);
	assert.equal(remotePathName(''), null);
	assert.equal(remotePathName('/a/b/'), 'b'); // 尾斜杠归一到目录名
});

test('validateRemotePath：绝对 POSIX 通过，其余拒绝', () => {
	assert.equal(validateRemotePath('/a/b.txt'), '/a/b.txt');
	assert.equal(validateRemotePath('//host/share'), '//host/share');
	assert.throws(() => validateRemotePath('rel/path'), /bad-request/);
	assert.throws(() => validateRemotePath(''), /bad-request/);
	assert.throws(() => validateRemotePath(42), /bad-request/);
});

test('withTimeout：正常完成放行，超时拒绝', async () => {
	const ok = await withTimeout(Promise.resolve('v'), 200, undefined);
	assert.equal(ok, 'v');
	await assert.rejects(
		withTimeout(new Promise(() => {}), 20, undefined),
		/timed out after 20ms/,
	);
});

test('withTimeout：调用方 abort 传导', async () => {
	const controller = new AbortController();
	const pending = withTimeout(new Promise(() => {}), 500, controller.signal);
	controller.abort(new Error('cancelled'));
	await assert.rejects(pending, /cancelled/);
});
