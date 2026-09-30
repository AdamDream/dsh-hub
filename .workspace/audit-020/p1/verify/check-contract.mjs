#!/usr/bin/env node
// WP6 §E 验证件 1/2：**源码级契约检查**（不启动任何 web 服务、不写任何既有文件）。
//
// 它把 WP6 报告里 A/B/C 三节的每一条断言变成可复跑的检查：全部是「读文件 + 断言」，
// 没有任何网络/进程动作。任一条失败 ⇒ 退出码 1。
//
// 用法：
//   node p1/verify/check-contract.mjs            # 人读输出
//   node p1/verify/check-contract.mjs --json     # 机器可读
//
// 路径可用环境变量覆盖：DSH_A / DSH_B / OLD011 / OLD017 / OLDWE / HOSTLOG

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const A = process.env.DSH_A ?? '/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020';
const B = process.env.DSH_B ?? join(A, 'prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai');
const OLD011 = process.env.OLD011 ?? '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai';
const OLD017 = process.env.OLD017 ?? '/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const LIVE_WE = process.env.LIVE_WE ?? '/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement';
const OLDWE = process.env.OLDWE ?? '/home/CNS2026495165/dsh/.workspace/audit-020/we-build/we-0.1.2-migrated-backup';
const HOSTLOG = process.env.HOSTLOG ?? join(A, 'home/logs/dsh-host.jsonl');
const JSON_OUT = process.argv.includes('--json');

const results = [];
function check(id, description, fn) {
	let ok = false, detail = '';
	try {
		const r = fn();
		if (r === true || r === undefined) { ok = true; }
		else if (r && typeof r === 'object') { ok = r.ok === true; detail = r.detail ?? ''; }
		else { ok = false; detail = `unexpected return ${String(r)}`; }
	} catch (error) {
		ok = false;
		detail = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
	}
	results.push({ id, description, ok, detail });
	return ok;
}
function read(path) { return readFileSync(path, 'utf8'); }
function has(path, needle) { return existsSync(path) && read(path).includes(needle); }
function countOf(path, needle) {
	if (!existsSync(path)) return -1;
	return read(path).split(needle).length - 1;
}
function versionOf(pkgDir) {
	try { return JSON.parse(read(join(pkgDir, 'package.json'))).version; } catch { return '(unreadable)'; }
}
/** 在一个 cordis.patch/dump 树里定位 `- id: <id>` 行，返回该行的键值块（到下一个顶层 `- ` 行为止）。 */
function yamlBlock(text, id) {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.trimEnd() === `- id: ${id}`);
	if (start === -1) return undefined;
	const block = [lines[start]];
	for (let i = start + 1; i < lines.length; i += 1) {
		if (/^- /.test(lines[i])) break;
		block.push(lines[i]);
	}
	return block.join('\n');
}

// ── B：右栏停靠面契约 ────────────────────────────────────────────────────────────
const SR = join(B, 'dsh-client-ui-sidebar-right');
check('B1', 'sidebar-right 包存在（0.2.0-rc.2 树）', () => {
	if (!existsSync(SR)) return { ok: false, detail: `${SR} 不存在` };
	return { ok: true, detail: `version=${versionOf(SR)}` };
});
check('B2', 'slots.d.ts 声明 sidebar.right.pane.tab / .title 且 kind=keyed', () => {
	const p = join(SR, 'lib/types/client/contract/slots.d.ts');
	const text = read(p);
	const ok = text.includes("'sidebar.right.pane.tab':") &&
		text.includes("'sidebar.right.pane.tab.title':") &&
		text.includes("kind: 'keyed';");
	return { ok, detail: ok ? 'both keyed seats declared' : 'declaration missing' };
});
check('B3', 'client.js 以 ctx.reflect.provide 提供 sidebarRight / sidebarRightTabs', () =>
	({ ok: has(join(SR, 'lib/client.js'), 'ctx.reflect.provide("sidebarRightTabs"') && has(join(SR, 'lib/client.js'), 'ctx.reflect.provide("sidebarRight"'), detail: 'reflect.provide x2' }));
check('B4', 'rightbar.session 注册声明了 pane.tab / .title 子席位（第三方 register 的前提）', () => {
	const text = read(join(SR, 'lib/client.js'));
	const ok = text.includes('"sidebar.right.pane.tab": {\n\t\t\t\t\t\t\t\tkind: "keyed"') || (countOf(join(SR, 'lib/client.js'), '"sidebar.right.pane.tab"') >= 3);
	return { ok, detail: `occurrences=${countOf(join(SR, 'lib/client.js'), 'sidebar.right.pane.tab')}` };
});
check('B5', 'dump020b.yaml：ui-sidebar-right 行存在且**未** disabled', () => {
	const text = read(join(A, 'logs/dump020b.yaml'));
	const block = yamlBlock(text, 'ui-sidebar-right');
	if (block === undefined) return { ok: false, detail: 'row not found' };
	const disabled = /(^|\n)\s*disabled:/.test(block);
	return { ok: !disabled, detail: disabled ? 'row carries disabled' : 'enabled (no disabled key)' };
});
check('B6', 'dsh-client-ui-workspace 0.2.0 树对 remoteHosts 命中数为 0（旧席位已消失）', () => {
	const dir = join(B, 'dsh-client-ui-workspace/lib/client.js');
	return { ok: countOf(dir, 'remoteHosts') === 0, detail: `hits=${countOf(dir, 'remoteHosts')} version=${versionOf(join(B, 'dsh-client-ui-workspace'))}` };
});
check('B7', '官方实现例：sidebar-files 在同一两个席位注册（可照抄的骨架）', () => {
	const text = read(join(B, 'dsh-client-ui-sidebar-files/lib/client.js'));
	const ok = text.includes('ctx.sidebarRightTabs.register(filesDefinition(t))') &&
		text.includes('"sidebar.right.pane.tab", () => ctx.slots.register({') &&
		text.includes('key: FILES_ID');
	return { ok, detail: 'register(type) + 2 keyed seats' };
});

// ── A：旧面在 0.1.1 / 0.1.7 的存亡 ─────────────────────────────────────────────
check('A1', '0.1.1-rc.2 ui-workspace 声明并渲染 sidebar.workspaces.remoteHosts', () => {
	const dir = join(OLD011, 'dsh-client-ui-workspace');
	const js = join(dir, 'lib/client.js');
	const dts = join(dir, 'lib/types/client/contract/slots.d.ts');
	const ok = countOf(js, 'sidebar.workspaces.remoteHosts') >= 2 && countOf(dts, 'sidebar.workspaces.remoteHosts') === 1;
	return { ok, detail: `version=${versionOf(dir)} clientHits=${countOf(js, 'sidebar.workspaces.remoteHosts')} dtsHits=${countOf(dts, 'sidebar.workspaces.remoteHosts')}` };
});
check('A2', '0.1.7-rc.2 ui-workspace 已删除该席位与渲染点（全树 0 命中）', () => {
	const dir = join(OLD017, 'dsh-client-ui-workspace');
	let hits = 0;
	for (const rel of ['lib/client.js', 'lib/types/client/contract/slots.d.ts']) hits += countOf(join(dir, rel), 'remoteHosts');
	return { ok: hits === 0, detail: `version=${versionOf(dir)} hits=${hits}` };
});
check('A3', '0.2.0-rc.2 ui-workspace 同样 0 命中（与 0.1.7 同构）', () =>
	({ ok: countOf(join(B, 'dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts'), 'remoteHosts') === 0,
	   detail: `version=${versionOf(join(B, 'dsh-client-ui-workspace'))}` }));
check('A4', '三份 ssh-gui client.js 逐字节相同（客户端从未改，改的是宿主侧环境）', () => {
	const a = join(A, 'home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js');
	const b = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js';
	const c = '/home/CNS2026495165/.dsh-017/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js';
	if (![a, b, c].every(existsSync)) return { ok: false, detail: 'one of the three copies is missing' };
	const [x, y, z] = [a, b, c].map((p) => readFileSync(p)); // Buffer 比较
	const ok = Buffer.compare(x, y) === 0 && Buffer.compare(y, z) === 0;
	return { ok, detail: ok ? `bytes=${x.length} identical` : 'copies differ' };
});
check('A5', 'ssh-gui 仍注册 sidebar.workspaces.remoteHosts（0.2.0 上该 inject 回调永不执行）', () => {
	const p = join(A, 'home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js');
	return { ok: has(p, 'ctx.slots.inject("sidebar.workspaces.remoteHosts"'), detail: 'one inject site' };
});
check('A6', 'slots.inject 语义：仅在槽被声明后才运行回调（静默失效的机制证据）', () => {
	const p = join(B, 'dsh-client-ui-renderer/lib/client.js');
	const text = read(p);
	const ok = text.includes('const spec = this._core.specDynamic(key);') && text.includes('if (spec === void 0) return;');
	return { ok, detail: 'inject() gates on specDynamic(key)' };
});

// ── C：数据面 / 通道对齐 ───────────────────────────────────────────────────────
check('C1', 'nodes.json 形状 = {version, currentId, nodes[]}（不打印任何明文值）', () => {
	const p = join(A, 'home/remote-workspaces/nodes.json');
	if (!existsSync(p)) return { ok: false, detail: 'missing' };
	const value = JSON.parse(read(p));
	const keys = Object.keys(value).sort().join(',');
	return { ok: keys === 'currentId,nodes,version' && Array.isArray(value.nodes),
		detail: `keys=${keys} nodesLen=${value.nodes.length} bytes=${statSync(p).size}` };
});
check('C2', 'WE 0.2.2 的 wire 身份：/api + 命名空间 dsw', () => {
	const p = join(A, 'home/profiles/node_modules/dsh-workspace-enhancement/lib/web-channel.js');
	const text = read(p);
	const ok = text.includes("export const API_CHANNEL = '/api';") && text.includes("export const CHANNEL_NAMESPACE = 'dsw';");
	return { ok, detail: `version=${versionOf(join(A, 'home/profiles/node_modules/dsh-workspace-enhancement'))}` };
});
check('C3', 'WE 0.2.2 **不再** mount 旧 /dsw 通道（rpc.handle 命中 0）', () => {
	const p = join(A, 'home/profiles/node_modules/dsh-workspace-enhancement/lib/web.js');
	return { ok: countOf(p, 'rpc.handle') === 0, detail: `hits=${countOf(p, 'rpc.handle')}` };
});
check('C4', 'WE 0.1.2（0.1.1/0.1.7 现役版）确实 mount /dsw', () => {
	const p = join(OLDWE, 'lib/web.js');
	const ok = has(p, "ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })");
	return { ok, detail: `version=${versionOf(OLDWE)} path=${p}` };
});
check('C5', 'ssh-gui 硬编码 CH_DWS="/dsw" ⇒ 与 C2 不对齐（判定：misaligned）', () => {
	const p = join(A, 'home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js');
	const text = read(p);
	const ok = text.includes('const CH_DWS = "/dsw";') && text.includes('const CH_SSH = "/ssh-gui";');
	return { ok, detail: 'CH_DWS=/dsw vs host /api·dsw ⇒ 旧通道调用 404' };
});
check('C6', '现役 0.1.1 根的 WE 仍是 0.1.2（⇒ /dsw 在 0.1.1 上活着，回归只在 0.2.0）', () =>
	({ ok: versionOf(LIVE_WE) === '0.1.2', detail: `liveWE=${versionOf(LIVE_WE)}` }));
check('C7', 'mixed-provider RCA：dump020b.yaml 里 subprocess / fs-sandbox 行**未** disabled', () => {
	const text = read(join(A, 'logs/dump020b.yaml'));
	const sub = yamlBlock(text, 'subprocess');
	const fsb = yamlBlock(text, 'fs-sandbox');
	if (sub === undefined || fsb === undefined) return { ok: false, detail: 'row missing' };
	const subDisabled = /(^|\n)\s*disabled:/.test(sub);
	const fsbDisabled = /(^|\n)\s*disabled:/.test(fsb);
	return { ok: !subDisabled && !fsbDisabled,
		detail: `subprocess.disabled=${subDisabled} fs-sandbox.disabled=${fsbDisabled}（WE 的 cordis.patch.yml 本意是两者都 true）` };
});
check('C8', 'cordis 重复服务错误来自 reflector.provide（lib/index.js:813）', () => {
	const p = join(B, 'cordis/lib/index.js');
	const text = read(p);
	const ok = text.includes('has been registered at <${this.store[key].fiber.name}>') && text.includes('provide(name, value, check)');
	return { ok, detail: 'provide() throws on duplicate service name' };
});
check('C9', 'WE plugin.js：先建 LocalSubprocessRuntime 再 ctx.set，失败即 warn + 纯 SSH 回退', () => {
	const text = read(join(A, 'home/profiles/node_modules/dsh-workspace-enhancement/lib/plugin.js'));
	const ok = text.includes('const localSubprocess = new LocalSubprocessRuntime(ctx);') &&
		text.includes('mixed provider install failed, falling back to pure-SSH providers');
	return { ok, detail: 'construct-then-set pattern' };
});
check('C10', '运行期日志确实出现 mixed 告警 + 回退路径自身也失败（ssh-subprocess-runtime / ssh-file-system）', () => {
	if (!existsSync(HOSTLOG)) return { ok: false, detail: 'host log missing' };
	const text = read(HOSTLOG);
	const tally = (needle) => text.split(needle).length - 1;
	const mixed = tally('mixed provider install failed, falling back to pure-SSH providers');
	const fallbackSub = tally('"name":"ssh-subprocess-runtime"');
	const fallbackFs = tally('"name":"ssh-file-system"');
	return { ok: mixed > 0 && fallbackSub > 0 && fallbackFs > 0,
		detail: `mixedWarn=${mixed} sshSubprocessFailures=${fallbackSub} sshFsFailures=${fallbackFs}` };
});
check('C11', 'WE 客户端自己走 /api + dsw/<endpoint>（与 C2 自洽）', () => {
	const text = read(join(A, 'home/profiles/node_modules/dsh-workspace-enhancement/lib/client.js'));
	const ok = text.includes('const API_CHANNEL = "/api";') && countOf(join(A, 'home/profiles/node_modules/dsh-workspace-enhancement/lib/client.js'), 'connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint)') >= 2;
	return { ok, detail: 'client half aligned with host half' };
});
check('C12', 'RCA 关键环：profile 的 dsh.profile.bundles 里**没有** dsh-workspace-enhancement', () => {
	const pkg = JSON.parse(read(join(A, 'home/profiles/web/package.json')));
	const bundles = pkg?.dsh?.profile?.bundles ?? [];
	const ok = Array.isArray(bundles) && !bundles.includes('dsh-workspace-enhancement');
	return { ok, detail: `bundles=[${bundles.join(', ')}]` };
});
check('C13', 'dsh-base bundle 层才是 subprocess / fs-sandbox 两行的来源（enabled）', () => {
	const p = join(B, 'dsh-base/cordis.patch.yml');
	const text = read(p);
	const sub = /-\s*id: subprocess\n\s*name: '@deepseek-ai\/dsh-subprocess-local'/.test(text);
	const fsb = /-\s*id: fs-sandbox\n\s*name: '@deepseek-ai\/dsh-fs-sandbox'/.test(text);
	return { ok: sub && fsb, detail: 'both provider rows declared without disabled' };
});
check('C14', 'app-boot 只在 dsh.profile.bundles 声明的 bundle 上套用 dsh.bundle.patch', () => {
	const text = read(join(B, 'dsh-app-boot/lib/index.js'));
	const ok = text.includes('applying each bundle') && text.includes('`dsh.profile.bundles` order') && text.includes('bundlePatchFiles(bundle)');
	return { ok, detail: 'bundle patch layer is bundle-list driven' };
});

// ── 报告 ───────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
if (JSON_OUT) {
	process.stdout.write(`${JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2)}\n`);
} else {
	for (const r of results) {
		const mark = r.ok ? 'PASS' : 'FAIL';
		process.stdout.write(`${mark}  ${r.id.padEnd(4)} ${r.description}${r.detail ? `  [${r.detail}]` : ''}\n`);
	}
	process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
}
process.exit(failed.length === 0 ? 0 : 1);
