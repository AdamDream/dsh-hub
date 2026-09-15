// settings Config schema 行为验证：默认值 / 结构 / role 标注
const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg-ws";
const { Config } = await import(`${root}/lib/index.js`);
const empty = Config({});
console.log("默认值:", JSON.stringify({
  serial: empty.serial,
  artifacts: empty.artifacts,
  security: { confirmDangerous: empty.security.confirmDangerous, allowlist: empty.security.commandAllowlist },
  templates: empty.flash.templates.length,
  hosts: empty.hosts.length,
}));
const sample = Config({
  serial: { port: "/dev/ttyUSB0", baudRate: 921600, backend: "serialport" },
  flash: { templates: [{ id: "esp32", command: "esptool.py write_flash 0x0 {{artifact:fw}}", dangerous: true }] },
  security: { confirmDangerous: false },
  hosts: [{ id: "soc", host: "192.168.1.10", user: "root", keyRef: "SSH_KEY_SOC" }],
});
console.log("样例:", JSON.stringify({ port: sample.serial.port, baud: sample.serial.baudRate, backend: sample.serial.backend,
  tpl: sample.flash.templates[0].command, confirm: sample.security.confirmDangerous, hostKeyRef: sample.hosts[0].keyRef }));
// 非法 host keyRef 形态（非 credential-ref）→ 拒绝
try {
  Config({ hosts: [{ id: "x", host: "1.2.3.4", keyRef: "BEGIN PRIVATE KEY-----" }] });
  console.log("非法 keyRef: 未拒绝 (!)");
} catch (e) {
  console.log("非法 keyRef 被拒:", e.message.split("\n")[0].slice(0, 80));
}
