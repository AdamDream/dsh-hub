// client bundle 冒烟：槽位路径 B 接入后（.workspace/deploy-slots/slot-b-exec.md §3）：
//   1) 静态：entry id == 包名、恰好 3 处 slots.inject、注册 id 唯一；
//   2) 运行时：真实执行 bundle factory（stub window/react）+ 调用 apply(ctx)（stub slots），
//      捕获 3 条注册，断言 slot 名 / id / order / label / inject 面 / 组件函数。
// 零网络、零 cordis、零 ~/.dsh（纯读 client.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'dsh-ssh-gui', 'lib', 'client.js');
const src = readFileSync(clientPath, 'utf8');

test('entry id == 包名 @local/dsh-ssh-gui', () => {
	assert.match(src, /window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "@local\/dsh-ssh-gui"/);
});

test('恰好 3 处 slots.inject（settings.section + header.actions + sidebar.workspaces.remoteHosts）', () => {
	const injects = [...src.matchAll(/ctx\.slots\.inject\(\s*"([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual([...injects].sort(), [
		'conversation.session.header.actions',
		'settings.section',
		'sidebar.workspaces.remoteHosts',
	].sort());
});

test('注册 id 分布正确（entry id==包名出现 2 次：load 入口 + settings 注册；actions/remote-hosts 各 1 次）', () => {
	const count = (pat) => [...src.matchAll(new RegExp('id: "' + pat + '"', 'g'))].length;
	assert.equal(count('@local/dsh-ssh-gui'), 2);
	assert.equal(count('@local/dsh-ssh-gui-actions'), 1);
	assert.equal(count('@local/dsh-ssh-gui-remote-hosts'), 1);
});

test('运行时：factory 执行 + apply(ctx) 捕获 3 条注册（slot 名/id/order/label/inject/组件）', async () => {
	let captured;
	globalThis.window = {
		__ModuleLoader__: {
			load(opts) { captured = opts; },
		},
	};
	await import(pathToFileURL(clientPath).href);
	assert.ok(captured && typeof captured.factory === 'function', 'bundle 未经 __ModuleLoader__.load 注册 factory');
	const reactStub = new Proxy(function noop() {}, {
		get: (target, prop) => (prop === Symbol.toPrimitive ? () => 0 : target),
	});
	const out = captured.factory((id) => {
		if (id === 'react' || id === 'react/jsx-runtime') return reactStub;
		throw new Error('unexpected require: ' + id);
	});
	assert.equal(typeof out.apply, 'function');
	assert.deepEqual(out.inject, ['slots', 'connection', 'sessions', 'workspaces']);

	const registrations = [];
	const ctx = {
		slots: {
			inject(name, injectFn) {
				const opts = injectFn(); // () => ctx.slots.register({...}, Comp)
				registrations.push({ name, ...opts });
			},
			register(opts, comp) { return { ...opts, comp }; },
		},
		workspaces: {},
		sessions: {},
	};
	out.apply(ctx);

	assert.equal(registrations.length, 3, 'apply 后应有 3 条注册');
	const regIds = registrations.map((r) => r.id);
	assert.equal(new Set(regIds).size, 3, '3 条注册 id 必须两两唯一');

	const settings = registrations.find((r) => r.name === 'settings.section');
	assert.equal(settings.id, '@local/dsh-ssh-gui');
	assert.equal(settings.order, 50);
	assert.equal(typeof settings.comp, 'function');

	const actions = registrations.find((r) => r.name === 'conversation.session.header.actions');
	assert.equal(actions.id, '@local/dsh-ssh-gui-actions');
	assert.equal(actions.order, 26);
	assert.equal(typeof actions.comp, 'function');

	const remote = registrations.find((r) => r.name === 'sidebar.workspaces.remoteHosts');
	assert.equal(remote.id, '@local/dsh-ssh-gui-remote-hosts');
	assert.equal(remote.order, 10);
	assert.equal(typeof remote.label, 'function');
	assert.equal(remote.label(), '分布式节点');
	assert.equal(typeof remote.comp, 'function', 'SidebarDistributedNodesTree 组件必须存在');
	const face = remote.inject();
	assert.equal(typeof face.rpc, 'function');
	assert.equal(face.workspaces, ctx.workspaces);
	assert.equal(face.sessions, ctx.sessions);
});
