// @local/dsh-remote-hosts —— host half【代码草案】
//
// 与 @deepseek-ai/dsh-client-ui-sidebar-right/lib/index.js 同构：纯客户端插件，
// host 侧不贡献任何内容（不注册服务、不开 RPC 通道）。节点数据仍由既有的
// @local/dsh-ssh-gui（/ssh-gui）与 dsh-workspace-enhancement（/api·dsw）提供。
//
// 这个空 apply 是必须的：profile 的 `- id: <row> / name: '@local/dsh-remote-hosts'`
// 会先 import 包的 main 入口，没有 apply 的包会在 include 阶段报错。
export function apply() {
	// no host-side contribution
}
