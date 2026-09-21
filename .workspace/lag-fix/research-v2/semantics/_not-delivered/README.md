# 不纳入交付（NOT DELIVERED）

`harness-b1-cold-sort-and-counts.cjs`：由并行子档编写的一个更宽的 B 线 harness，**在作者修复过程中被中断**，
文件当前**语法不完整**（`node` 报 `SyntaxError: Unexpected end of input`），**未跑通、未产出 JSON、未自证**。
它的目标（冷路径排序键、201 场景 running 计数、与 live/回放规格交叉核对）已由本目录上层两个**已验证**的
harness 完整覆盖：

- `../crosscheck-b1-cold-sort.cjs`   → `../results/b1-cold-sort-crosscheck.json`
- `../crosscheck-b1-running-count.cjs` → `../results/b1-running-count-crosscheck.json`

保留此文件仅为审计可追溯（说明"这一路走过但没走完"），**不要运行它，也不要把它当作证据**。
