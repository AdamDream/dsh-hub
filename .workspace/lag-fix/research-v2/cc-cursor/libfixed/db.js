// 只做转发：让"修好的 source ingest-cc.js"跑在**真实 deployed db.js** 上
// （source 侧 db.js 依赖 @deepseek-ai/dsh-home-paths，源目录解析不到）。
export * from "file:///home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js";
