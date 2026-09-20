// exec 纯逻辑单测：命令规范化 / 白名单 / 超时 / cwd / deadline / 输出截断。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_EXEC_TIMEOUT_MS,
	EXEC_TIMEOUT_CAP_MS,
	normalizeCommand,
	firstToken,
	commandAllowed,
	effectiveExecTimeout,
	effectiveExecCwd,
	defaultRemoteDir,
	makeDeadline,
	capOutput,
} from '../dsh-ssh-gui/lib/core.js';

test('normalizeCommand：trim + 非空', () => {
	assert.equal(normalizeCommand('  ls -la  '), 'ls -la');
	assert.throws(() => normalizeCommand(''), /bad-request/);
	assert.throws(() => normalizeCommand('   '), /bad-request/);
	assert.throws(() => normalizeCommand(undefined), /bad-request/);
});

test('firstToken：命令首 token', () => {
	assert.equal(firstToken('ls -la /tmp'), 'ls');
	assert.equal(firstToken('  df -h  '), 'df');
	assert.equal(firstToken(''), '');
	assert.equal(firstToken(undefined), '');
});

test('commandAllowed：空白名单放行；非空首 token 精确匹配', () => {
	assert.equal(commandAllowed('rm -rf /', []), true);
	assert.equal(commandAllowed('rm -rf /', undefined), true);
	assert.equal(commandAllowed('ls -la', ['ls', 'df']), true);
	assert.equal(commandAllowed('lsusb', ['ls']), false); // 前缀误放行被拒
	assert.equal(commandAllowed('rm -rf /', ['ls', 'df']), false);
	assert.equal(commandAllowed('', ['ls']), false);
});

test('effectiveExecTimeout：默认/覆盖/钳制/校验', () => {
	assert.equal(effectiveExecTimeout(undefined, undefined), DEFAULT_EXEC_TIMEOUT_MS);
	assert.equal(effectiveExecTimeout(undefined, 5000), 5000);
	assert.equal(effectiveExecTimeout(5000, 10000), 5000);
	assert.equal(effectiveExecTimeout(700000, 30000), EXEC_TIMEOUT_CAP_MS); // 钳到 600s
	assert.throws(() => effectiveExecTimeout(0, 30000), /bad-request/);
	assert.throws(() => effectiveExecTimeout(1.5, 30000), /bad-request/);
	assert.throws(() => effectiveExecTimeout(-1, 30000), /bad-request/);
});

test('effectiveExecCwd：默认机器目录 / 绝对路径 / 相对拒绝', () => {
	const spec = { workspace: '/data', cwd: '/root' };
	assert.equal(effectiveExecCwd(spec, undefined), '/data');
	assert.equal(effectiveExecCwd({ cwd: '/root' }, undefined), '/root');
	assert.equal(effectiveExecCwd({}, undefined), '/');
	assert.equal(effectiveExecCwd(spec, '/tmp'), '/tmp');
	assert.throws(() => effectiveExecCwd(spec, 'tmp'), /bad-request/);
	assert.throws(() => effectiveExecCwd(spec, 42), /bad-request/);
});

test('defaultRemoteDir：workspace 优先，其次 cwd，最后 /', () => {
	assert.equal(defaultRemoteDir({ workspace: '/w', cwd: '/c' }), '/w');
	assert.equal(defaultRemoteDir({ cwd: '/c' }), '/c');
	assert.equal(defaultRemoteDir({}), '/');
	assert.equal(defaultRemoteDir({ workspace: 'relative' }), '/'); // 非绝对 → /
	assert.equal(defaultRemoteDir(null), '/');
});

test('makeDeadline：超时置 timedOut 并 abort；正常完成不触发', async () => {
	const deadline = makeDeadline(20, undefined);
	assert.equal(deadline.timedOut(), false);
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
	assert.equal(deadline.timedOut(), true);
	deadline.dispose();

	const ok = makeDeadline(500, undefined);
	ok.dispose(); // dispose 后计时器清除，不会误触发
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
	assert.equal(ok.timedOut(), false);
});

test('makeDeadline：调用方 abort 传导', async () => {
	const controller = new AbortController();
	const deadline = makeDeadline(1000, controller.signal);
	let rejected = null;
	deadline.signal.addEventListener('abort', () => { rejected = deadline.signal.reason; });
	controller.abort(new Error('caller cancelled'));
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	assert.ok(rejected !== null);
	deadline.dispose();
});

test('capOutput：未超限原样，超限截尾标记', () => {
	assert.deepEqual(capOutput('hello', 1024), { text: 'hello', truncated: false });
	assert.deepEqual(capOutput('hello world', 5), { text: 'hello', truncated: true });
	assert.deepEqual(capOutput(undefined, 1024), { text: '', truncated: false });
	assert.deepEqual(capOutput('x', 0), { text: 'x', truncated: false }); // 0 = 不截
});
