//#region test/flash.test.mjs
/**
 * dsh-workerspace 烧录编排单测：模板查询 / 白名单 / 产物围栏 / 凭据槽 /
 * 高危确认门 / 退出码处理 / 脱敏日志。运行：node --test test/flash.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { planFlash, runFlashPlan, redactLogLines } from "../lib/flash.js";

const ARTIFACTS_DIR = "/srv/artifacts";
const realpathFn = async (p) => {
	if (p.endsWith("escaped.bin")) return "/etc/evil.bin";
	return join("/srv/artifacts", p.slice(ARTIFACTS_DIR.length).replace(/^\//, ""));
};
const resolveCredential = async (ref) => (ref === "PW" ? { value: "top-secret" } : undefined);
const templates = [
	{ id: "esp32-boot", command: "esptool.py --chip esp32 --port /dev/ttyUSB0 write_flash 0x1000 {{artifact:fw}}", dangerous: true, timeoutMs: 300000 },
	{ id: "safe-read", command: "esptool.py --chip esp32 read_flash 0x0 0x1000 {{artifact:dump}}", dangerous: false, timeoutMs: 120000 },
	{ id: "with-cred", command: "esptool.py --password {{credential:PW}} write_flash 0x0 {{artifact:fw}}", dangerous: true, timeoutMs: 60000 },
];
const allowlist = ["esptool", "esptool.py", "openocd", "dfu-util", "uuu", "fastboot"];

/** 假 subprocess handle。 */
function fakeHandle(exitCode, stdout, stderr) {
	const reader = (text) => ({ readFrom: () => ({ text: text ?? "" }) });
	return {
		done: Promise.resolve({ exitCode, signal: null }),
		collected: { stdout: reader(stdout), stderr: reader(stderr) },
	};
}

test("planFlash: 未知模板拒绝并列出已知 id", async () => {
	await assert.rejects(
		() => planFlash({ templateId: "nope", templates, allowlist, artifacts: {}, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential }),
		/unknown flash template "nope".*esp32-boot/,
	);
});

test("planFlash: 非白名单可执行名拒绝", async () => {
	const evil = [{ id: "rm-flash", command: "rm -rf {{artifact:fw}}", dangerous: true }];
	await assert.rejects(
		() => planFlash({ templateId: "rm-flash", templates: evil, allowlist, artifacts: { fw: "fw.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential }),
		/not in the command allowlist/,
	);
});

test("planFlash: 占位符混入/未知 kind 在 plan 前即被 parse 拒绝", async () => {
	const evil = [{ id: "t", command: "esptool.py {{artifact:fw}};rm -rf /", dangerous: true }];
	await assert.rejects(
		() => planFlash({ templateId: "t", templates: evil, allowlist, artifacts: { fw: "fw.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential }),
		/not a whole/,
	);
});

test("planFlash: 产物逃逸围栏拒绝", async () => {
	await assert.rejects(
		() => planFlash({ templateId: "esp32-boot", templates, allowlist, artifacts: { fw: "escaped.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential }),
		/escapes the artifacts directory/,
	);
});

test("planFlash: 缺少产物绑定拒绝", async () => {
	await assert.rejects(
		() => planFlash({ templateId: "esp32-boot", templates, allowlist, artifacts: {}, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential }),
		/needs artifact "fw"/,
	);
});

test("planFlash: 凭据未配置拒绝（值绝不内联）", async () => {
	await assert.rejects(
		() =>
			planFlash({
				templateId: "with-cred",
				templates,
				allowlist,
				artifacts: { fw: "fw.bin" },
				artifactsDir: ARTIFACTS_DIR,
				realpathFn,
				resolveCredential: async () => undefined,
			}),
		/credential "PW" but it is not stored/,
	);
});

test("planFlash: 成功计划 —— argv 构造 + secrets 收集 + dangerous 继承", async () => {
	const plan = await planFlash({
		templateId: "with-cred",
		templates,
		allowlist,
		artifacts: { fw: "fw.bin" },
		artifactsDir: ARTIFACTS_DIR,
		realpathFn,
		resolveCredential: async () => ({ value: "top-secret" }),
	});
	assert.deepEqual(plan.argv, ["esptool.py", "--password", "top-secret", "write_flash", "0x0", join(ARTIFACTS_DIR, "fw.bin")]);
	assert.deepEqual(plan.secrets, ["top-secret"]);
	assert.equal(plan.dangerous, true);
	assert.equal(plan.timeoutMs, 60000);
});

test("runFlashPlan: 确认门 —— ask=false 拒绝（fail-closed）", async () => {
	const plan = await planFlash({ templateId: "esp32-boot", templates, allowlist, artifacts: { fw: "fw.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential });
	await assert.rejects(
		() =>
			runFlashPlan(plan, {
				spawn: () => fakeHandle(0, "ok", ""),
				confirm: true,
				ask: async () => false,
				cwd: ARTIFACTS_DIR,
			}),
		/not approved/,
	);
});

test("runFlashPlan: 确认门 —— dangerous=false 不询问", async () => {
	let asked = 0;
	const plan = await planFlash({ templateId: "safe-read", templates, allowlist, artifacts: { dump: "dump.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential });
	const result = await runFlashPlan(plan, {
		spawn: (spec) => {
			assert.deepEqual(spec.argv, ["esptool.py", "--chip", "esp32", "read_flash", "0x0", "0x1000", join(ARTIFACTS_DIR, "dump.bin")]);
			assert.equal(spec.cwd, ARTIFACTS_DIR);
			return fakeHandle(0, "read done", "");
		},
		confirm: true,
		ask: async () => {
			asked += 1;
			return true;
		},
		cwd: ARTIFACTS_DIR,
	});
	assert.equal(asked, 0);
	assert.equal(result.exitCode, 0);
});

test("runFlashPlan: 成功执行返回输出", async () => {
	const plan = await planFlash({ templateId: "esp32-boot", templates, allowlist, artifacts: { fw: "fw.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential });
	const result = await runFlashPlan(plan, {
		spawn: () => fakeHandle(0, "esptool.py v4.7\nChip is ESP32", ""),
		confirm: false,
		ask: async () => true,
		cwd: ARTIFACTS_DIR,
	});
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Chip is ESP32/);
	assert.ok(result.durationMs >= 0);
});

test("runFlashPlan: 非零退出码抛脱敏错误", async () => {
	const plan = await planFlash({
		templateId: "with-cred",
		templates,
		allowlist,
		artifacts: { fw: "fw.bin" },
		artifactsDir: ARTIFACTS_DIR,
		realpathFn,
		resolveCredential: async () => ({ value: "top-secret" }),
	});
	await assert.rejects(
		() =>
			runFlashPlan(plan, {
				spawn: () => fakeHandle(1, "", "A fatal error occurred: password top-secret rejected"),
				confirm: false,
				ask: async () => true,
				cwd: ARTIFACTS_DIR,
			}),
		/flash with-cred failed \(exit 1\)/,
	);
});

test("runFlashPlan: spawn 级失败（reject）转清晰错误", async () => {
	const plan = await planFlash({ templateId: "safe-read", templates, allowlist, artifacts: { dump: "dump.bin" }, artifactsDir: ARTIFACTS_DIR, realpathFn, resolveCredential });
	await assert.rejects(
		() =>
			runFlashPlan(plan, {
				spawn: () => {
					throw new Error("ENOENT");
				},
				confirm: false,
				ask: async () => true,
				cwd: ARTIFACTS_DIR,
			}),
		/failed to spawn/,
	);
});

test("redactLogLines: 日志里的凭据值被替换", () => {
	const lines = [
		'[flash] template=with-cred argv=["esptool.py","--password","top-secret","write_flash","0x0","/srv/artifacts/fw.bin"]',
		"[flash] exit=0 signal=none durationMs=10",
	];
	const text = redactLogLines(lines, ["top-secret"]);
	assert.ok(!text.includes("top-secret"));
	assert.ok(text.includes("[redacted:1]"));
});
//#endregion
