#!/usr/bin/env node
// WP6 §E 验证件 2/2：**桩调用 harness**（不启动任何 web 服务、不加载真实 cordis、不写既有文件）。
//
// 它做的事：把 `p1/draft/dsh-remote-hosts/lib/client.js` 当作真实的
// `window.__ModuleLoader__.load({id, factory})` 客户端插件加载，注入一个
// **记录型 stub ctx**（实现官方契约里本插件用到的那几个面），然后：
//   1. 断言注册形状与官方 sidebar-right 契约逐项一致（slot 名、keyed key、类型定义字段）；
//   2. 用最小 hook 运行时**真的渲染一次 tab 正文**，并断言秘密字段不进入 DOM 树。
//
// 这不是"渲染正确性"的证明（没有真实 React / dockkit / 浏览器），而是**静态与接线正确性**的证明。
//
// 用法：node p1/verify/stub-harness.mjs
// 退出码 0 = 全通过。

import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const HERE = new globalThis.URL('.', import.meta.url).pathname;
const PLUGIN = resolve(HERE, '../draft/dsh-remote-hosts/lib/client.js');

const failures = [];
function assert(id, description, condition, detail = '') {
	if (condition) {
		process.stdout.write(`PASS  ${id.padEnd(4)} ${description}${detail ? `  [${detail}]` : ''}\n`);
	} else {
		failures.push(id);
		process.stdout.write(`FAIL  ${id.padEnd(4)} ${description}${detail ? `  [${detail}]` : ''}\n`);
	}
}
function eq(id, description, actual, expected) {
	assert(id, description, Object.is(actual, expected), `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ── 最小 hook 运行时（只为把正文渲染一次） ────────────────────────────────────
let hookCursor = 0;
let hookStore = [];
function resetHooks() { hookCursor = 0; }
function useState(initial) {
	const index = hookCursor++;
	if (!(index in hookStore)) hookStore[index] = { value: typeof initial === 'function' ? initial() : initial };
	const slot = hookStore[index];
	return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
}
function useEffect(effect, deps) {
	const index = hookCursor++;
	const prev = hookStore[index];
	const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((dep, i) => !Object.is(dep, prev.deps[i]));
	if (changed) {
		hookStore[index] = { deps: deps ?? null, cleanup: effect() };
	} else {
		hookStore[index] = prev;
	}
}
function useMemo(factory) { hookCursor += 1; return factory(); }
const reactStub = {
	createElement: (type, props, ...children) => ({ type, props: props ?? null, children }),
	Fragment: 'Fragment',
	useState,
	useEffect,
	useMemo,
};

// ── 记录型 stub ctx（面 = 官方契约里本插件用到的那几个） ───────────────────────
const record = { effects: [], locale: [], slots: [], tabs: [], injected: [], rpc: [] };
const rpcStub = (channel, endpoint, payload, signal) => {
	record.rpc.push({ channel, endpoint, payload, hasSignal: signal !== undefined });
	return Promise.resolve({
		ok: true,
		value: {
			nodes: [{ id: 'node-a', name: 'node-a', transport: 'ssh://', current: true, password: 'SECRET-SHOULD-NEVER-RENDER', keyRef: 'SECRET-KEYREF' }],
		},
	});
};
const stubCtx = {
	effect(fn, label) { record.effects.push(label); const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
	get(name) { return name === 'connection' ? { rpc: { call: rpcStub } } : undefined; },
	locale: {
		register(namespace, dictionaries) { record.locale.push({ namespace, zh: Object.keys(dictionaries.zh).sort().join(','), en: Object.keys(dictionaries.en).sort().join(',') }); },
		bind() { return (key) => key; },
	},
	slots: {
		inject(name, callback) { record.injected.push(name); const dispose = callback(); return () => { if (typeof dispose === 'function') dispose(); }; },
		register(options, component) { record.slots.push({ options, component }); return () => {}; },
	},
	sidebarRightTabs: { register(definition) { record.tabs.push(definition); return () => {}; } },
};

// ── 以真实载入形态加载草案插件 ─────────────────────────────────────────────────
let captured;
globalThis.window = { __ModuleLoader__: { load(definition) { captured = definition; } } };
await import(pathToFileURL(PLUGIN).href);
assert('H1', '插件以 window.__ModuleLoader__.load({id, factory}) 形态自注册', captured !== undefined && typeof captured.factory === 'function',
	`id=${captured?.id}`);
eq('H2', '插件 id 与目录名一致', captured.id, '@local/dsh-remote-hosts');

const plugin = captured.factory((name) => {
	if (name === 'react') return reactStub;
	throw new Error(`stub harness has no module "${name}"`);
});
assert('H3', 'exports.apply / exports.inject 齐备', typeof plugin.apply === 'function' && Array.isArray(plugin.inject),
	`inject=[${plugin.inject?.join(', ')}]`);
assert('H4', '客户端 inject 含 slots（slot 面的前提）与 connection（RPC 面的前提）',
	plugin.inject.includes('slots') && plugin.inject.includes('connection'));

// ── 执行 apply（等价于真实的客户端插件装配） ────────────────────────────────────
plugin.apply(stubCtx);
const internals = plugin.__internals;

assert('H5', 'apply 注册 4 个 effect（文案 / 类型 / 正文 / 标题各自可回滚）', record.effects.length === 4,
	record.effects.join(' | '));
eq('H6', 'localocale 只注册一个命名空间', record.locale.length, 1);
eq('H7', 'zh / en 的 key-set 完全一致（官方 locales 纪律）', record.locale[0].zh, record.locale[0].en);

// ── tab 类型定义（sidebarRightTabs.register 的入参形状） ────────────────────────
eq('H8', 'sidebarRightTabs.register 恰好一次', record.tabs.length, 1);
const definition = record.tabs[0];
const allowed = ['id', 'kind', 'patterns', 'priority', 'canOpen', 'title', 'guide', 'keepMounted', 'multiple'];
const extraKeys = Object.keys(definition).filter((key) => !allowed.includes(key));
eq('H9', '类型定义不含契约外字段', extraKeys.join(',') || '(none)', '(none)');
eq('H10', 'definition.id === 注册 key 的来源', definition.id, '@local/dsh-remote-hosts');
eq('H11', 'definition.kind 是页类型名', definition.kind, 'remote-hosts');
eq('H12', '页类型不给 patterns（页按 kind 打开，不做地址匹配）', definition.patterns, undefined);
assert('H13', 'definition.title 是函数（惰性文案，官方 idiom）', typeof definition.title === 'function');
assert('H14', 'definition.guide 是非空数组，入口带 id/order/title/description',
	Array.isArray(definition.guide) && definition.guide.length === 1 &&
	typeof definition.guide[0].id === 'string' && typeof definition.guide[0].order === 'number' &&
	typeof definition.guide[0].title === 'function' && typeof definition.guide[0].description === 'function');

// ── 席位注册（keyed）：名字 + key 必须严格照官方契约 ────────────────────────────
eq('H15', 'slots.inject 恰好两处（正文 + 标题）', record.injected.length, 2);
const bodyReg = record.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
const titleReg = record.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab.title');
assert('H16', '正文席位名 = sidebar.right.pane.tab（keyed）', bodyReg !== undefined);
assert('H17', '标题席位名 = sidebar.right.pane.tab.title（keyed）', titleReg !== undefined);
eq('H18', '正文席位 key = 类型 id（不是 kind）', bodyReg?.options.key, definition.id);
eq('H19', '标题席位 key = 类型 id', titleReg?.options.key, definition.id);
assert('H20', '正文 / 标题都是组件函数', typeof bodyReg?.component === 'function' && typeof titleReg?.component === 'function');
assert('H21', '没有任何注册落到已删除的旧席位 sidebar.workspaces.remoteHosts',
	record.slots.every((entry) => !String(entry.options.name).includes('sidebar.workspaces')) &&
	record.injected.every((name) => !name.includes('sidebar.workspaces')),
	`slots=[${record.slots.map((entry) => entry.options.name).join(',')}]`);

// ── 数据面接线：channel / endpoint 必须是 0.2.0 的真实 wire 身份 ────────────────
eq('H22', '节点表走 ssh-gui 自己的 /ssh-gui 通道', internals.CH_SSH, '/ssh-gui');
eq('H23', '底座通道 = /api（**不是** 0.1.x 的 /dsw）', internals.CH_DWS, '/api');
eq('H24', 'dsw 命名空间拼接', internals.dws('conn.probe'), 'dsw/conn.probe');
eq('H25', '节点的 transport 显示名映射', internals.transportLabel('serial-tcp://'), 'node.serialTcp');
eq('H26', '未知 transport 原样保留（不吞信息）', internals.transportLabel('weird://'), 'weird://');

// ── 秘密字段不得跨越客户端边界 ────────────────────────────────────────────────
const normalized = internals.normalizeNodes({ nodes: [{ id: 'n', name: 'N', transport: 'ssh://', current: true, password: 'P', keyRef: 'K', privateKey: 'X' }] });
eq('H27', 'normalizeNodes 白名单化（只留 id/name/transport/isCurrent）', Object.keys(normalized[0]).sort().join(','), 'id,isCurrent,name,transport');
const normalizedJson = JSON.stringify(normalized);
assert('H28', 'normalizeNodes 丢弃签名里的任何秘密字段值',
	!normalizedJson.includes('"P"') && !normalizedJson.includes('"K"') && !normalizedJson.includes('"X"') &&
	!/password|keyRef|privateKey/.test(normalizedJson),
	normalizedJson);
eq('H29', 'nodeSummary 只数条数', internals.nodeSummary(normalized).count, 1);
eq('H30', '空表 / 非对象输入不抛', internals.normalizeNodes(undefined).length, 0);

// ── 真渲染一次正文（含 effect 的数据回路） ─────────────────────────────────────
const tab = {
	title: '分布式节点',
	signal: new AbortController().signal,
	navigation: { address: 'remote-hosts', params: undefined, revision: 0 },
	visible: true,
};
const useTabInfo = () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane-1' }, tab });
resetHooks(); hookStore = [];
const bodyTree = bodyReg.component({ useTabInfo, rpc: rpcStub, sessionId: 'session-1' });
const loadingJson = JSON.stringify(bodyTree);
assert('H31', '正文可渲染（不抛），首帧是 loading 态', loadingJson.includes('rh_root') && loadingJson.includes('正在读取节点表'));
await new Promise((resolvePromise) => setImmediate(resolvePromise));
resetHooks();
const bodyTree2 = bodyReg.component({ useTabInfo, rpc: rpcStub, sessionId: 'session-1' });
const readyJson = JSON.stringify(bodyTree2);
assert('H32', 'effect 落地后渲染出节点行（数据回路接通）', readyJson.includes('node-a') && readyJson.includes('ssh://'));
assert('H33', '渲染树里没有秘密字段值（password / keyRef 均未泄出）',
	!readyJson.includes('SECRET-SHOULD-NEVER-RENDER') && !readyJson.includes('SECRET-KEYREF'));
eq('H34', 'RPC 调用只用了 /ssh-gui 通道', record.rpc.every((call) => call.channel === '/ssh-gui'), true);
eq('H35', 'RPC endpoint = nodes.list', record.rpc[0]?.endpoint, 'nodes.list');

// ── 汇总 ───────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.join(', ')}`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
