//#region test/core.test.mjs
/**
 * dsh-workerspace 纯逻辑单测：模板解析 / 白名单 / 占位符强校验 / 路径围栏 / 脱敏 / 参数校验。
 * 运行：node --test test/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import {
	ARTIFACT_PLACEHOLDER_RE,
	CREDENTIAL_PLACEHOLDER_RE,
	DEFAULT_TOOL_ALLOWLIST,
	buildFlashArgv,
	escapeRegExp,
	isToolAllowlisted,
	isValidBaudRate,
	isValidPortName,
	isValidSessionId,
	isValidTemplateId,
	parseCommandTemplate,
	redact,
	resolveArtifactPath,
	safeLogSegment,
} from "../lib/core.js";

test("parseCommandTemplate: 合法模板切出 argv 与占位符名", () => {
	const { argv, artifactNames, credentialRefs } = parseCommandTemplate(
		"fastboot flash boot {{artifact:boot_img}} --erase-all",
	);
	assert.deepEqual(argv, ["fastboot", "flash", "boot", "{{artifact:boot_img}}", "--erase-all"]);
	assert.deepEqual(artifactNames, ["boot_img"]);
	assert.deepEqual(credentialRefs, []);
});

test("parseCommandTemplate: credential 占位符同样识别", () => {
	const { credentialRefs } = parseCommandTemplate("esptool.py --password {{credential:ESPHOME_API_KEY}} write_flash 0x0 {{artifact:fw}}");
	assert.deepEqual(credentialRefs, ["ESPHOME_API_KEY"]);
});

test("parseCommandTemplate: 空模板拒绝", () => {
	assert.throws(() => parseCommandTemplate("   "), /non-empty/);
	assert.throws(() => parseCommandTemplate(""), /non-empty/);
});

test("parseCommandTemplate: 混合占位符（前缀/后缀拼接）拒绝", () => {
	assert.throws(() => parseCommandTemplate("fastboot flash {{artifact:boot}}x"), /not a whole/);
	assert.throws(() => parseCommandTemplate("x{{artifact:boot}}"), /not a whole/);
	assert.throws(() => parseCommandTemplate("{{unknown:boot}}"), /not a whole/);
});

test("parseCommandTemplate: 字面 token 里的 shell 元字符拒绝", () => {
	for (const bad of ["fastboot;rm -rf /", "foo$(id)", "a|b", "x`y`", 'q"w', "s'p", "a&b", "c<d", "e>f", "p\\q"]) {
		assert.throws(() => parseCommandTemplate(`esptool.py ${bad}`), /shell-sensitive/, `token: ${bad}`);
	}
});

test("parseCommandTemplate: 合法字面量放行（含 -- 选项、十六进制地址）", () => {
	const { argv } = parseCommandTemplate("esptool.py --chip esp32 --baud 921600 write_flash 0x1000 {{artifact:firmware}}");
	assert.deepEqual(argv, ["esptool.py", "--chip", "esp32", "--baud", "921600", "write_flash", "0x1000", "{{artifact:firmware}}"]);
});

test("isToolAllowlisted: 白名单命中/拒绝", () => {
	assert.ok(isToolAllowlisted("fastboot", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(isToolAllowlisted("esptool.py", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(isToolAllowlisted("openocd", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(isToolAllowlisted("dfu-util", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(isToolAllowlisted("uuu", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(!isToolAllowlisted("rm", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(!isToolAllowlisted("", DEFAULT_TOOL_ALLOWLIST));
	assert.ok(!isToolAllowlisted("fastboot", ["openocd"]));
});

test("buildFlashArgv: 产物与凭据代入、secrets 收集", () => {
	const { argv, secrets } = buildFlashArgv(
		"esptool.py --password {{credential:PW}} write_flash 0x0 {{artifact:fw}}",
		{ fw: "/a/b/fw.bin" },
		{ PW: "s3cr3t-value" },
	);
	assert.deepEqual(argv, ["esptool.py", "--password", "s3cr3t-value", "write_flash", "0x0", "/a/b/fw.bin"]);
	assert.deepEqual(secrets, ["s3cr3t-value"]);
});

test("buildFlashArgv: 未提供的产物/凭据拒绝", () => {
	assert.throws(
		() => buildFlashArgv("fastboot flash boot {{artifact:boot}}", {}, {}),
		/not provided in the tool call/,
	);
	assert.throws(
		() => buildFlashArgv("fastboot flash boot {{credential:KEY}}", { boot: "/x" }, {}),
		/not configured/,
	);
});

test("resolveArtifactPath: 相对/绝对都在围栏内", async () => {
	const dir = "/srv/artifacts";
	const realpathFn = async (p) => resolve(p);
	const out = await resolveArtifactPath("fw.bin", dir, realpathFn);
	assert.equal(out, join("/srv/artifacts", "fw.bin"));
	const abs = await resolveArtifactPath("/srv/artifacts/out/fw.bin", dir, realpathFn);
	assert.equal(abs, "/srv/artifacts/out/fw.bin");
});

test("resolveArtifactPath: 逃逸围栏拒绝（.. 与目录外绝对路径）", async () => {
	const dir = "/srv/artifacts";
	const realpathFn = async (p) => resolve(p);
	await assert.rejects(() => resolveArtifactPath("../evil.bin", dir, realpathFn), /escapes the artifacts directory/);
	await assert.rejects(() => resolveArtifactPath("/etc/passwd", dir, realpathFn), /escapes the artifacts directory/);
	await assert.rejects(() => resolveArtifactPath("", dir, realpathFn), /non-empty/);
});

test("resolveArtifactPath: 不存在/不可解析拒绝；symlink 逃逸经 realpath 暴露", async () => {
	const dir = "/srv/artifacts";
	// fake realpath：模拟 symlink 把 /srv/artifacts/lnk 解析到 /etc
	const realpathFn = async (p) => {
		if (p.endsWith("lnk")) return "/etc/shadow";
		return resolve(p);
	};
	await assert.rejects(() => resolveArtifactPath("lnk", dir, realpathFn), /escapes the artifacts directory/);
	await assert.rejects(
		() => resolveArtifactPath("missing.bin", dir, async () => {
			throw new Error("ENOENT");
		}),
		/does not exist/,
	);
});

test("redact: 凭据值在文本中被替换且长值优先", () => {
	const { text, hits } = redact("key=alpha1 alpha1 secretbeta=beta7 end", ["alpha1", "beta7"]);
	assert.equal(hits, 3);
	assert.equal(text, "key=[redacted:1] [redacted:1] secretbeta=[redacted:2] end");
});

test("redact: 空/过短值不替换（防误伤）", () => {
	const { text, hits } = redact("abc def", ["ab", ""]);
	assert.equal(hits, 0);
	assert.equal(text, "abc def");
});

test("redact: 无 secret 时原样返回", () => {
	const { text, hits } = redact("hello world", []);
	assert.equal(hits, 0);
	assert.equal(text, "hello world");
});

test("escapeRegExp: 特殊字符安全", () => {
	assert.equal(escapeRegExp("a.b[1]"), "a\\.b\\[1\\]");
});

test("参数校验：波特率 / 端口 / 会话 id / 模板 id / 日志片段", () => {
	assert.ok(isValidBaudRate(115200));
	assert.ok(isValidBaudRate(921600));
	assert.ok(!isValidBaudRate(0));
	assert.ok(!isValidBaudRate(-1));
	assert.ok(!isValidBaudRate(12.5));
	assert.ok(!isValidBaudRate(99999999));
	assert.ok(isValidPortName("/dev/ttyUSB0"));
	assert.ok(isValidPortName("/dev/ttyACM0"));
	assert.ok(!isValidPortName("a b"));
	assert.ok(!isValidPortName(""));
	assert.ok(!isValidPortName("/dev/tty;rm"));
	assert.ok(isValidSessionId("3f6d9c2e-1111-2222-3333-444455556666"));
	assert.ok(!isValidSessionId("nope"));
	assert.ok(isValidTemplateId("esp32-flash"));
	assert.ok(!isValidTemplateId("a b"));
	assert.ok(!isValidTemplateId("x".repeat(65)));
	assert.equal(safeLogSegment("/dev/ttyUSB0"), "_dev_ttyUSB0"); // / 与非法字符替换为 _
	assert.equal(safeLogSegment("../x"), ".._x");
	assert.equal(safeLogSegment("ttyACM0"), "ttyACM0");
});

test("占位符正则：精确锚定", () => {
	assert.ok(ARTIFACT_PLACEHOLDER_RE.test("{{artifact:fw.bin}}"));
	assert.ok(!ARTIFACT_PLACEHOLDER_RE.test("x{{artifact:fw}}"));
	assert.ok(CREDENTIAL_PLACEHOLDER_RE.test("{{credential:REF_1}}"));
	assert.ok(!CREDENTIAL_PLACEHOLDER_RE.test("{{credential:bad ref}}"));
});

test("DEFAULT_TOOL_ALLOWLIST 与需求五项对齐", () => {
	for (const tool of ["esptool", "openocd", "dfu-util", "uuu", "fastboot"]) {
		assert.ok(DEFAULT_TOOL_ALLOWLIST.includes(tool), tool);
	}
});
//#endregion
