# 接手方模拟 · 第二轮（验证上一轮 6 处修正是否真的落地）

- 角色：**全新继任会话**（干净上下文，未读对话历史），只读核对，不修改既有文件
- 交接件：`/home/CNS2026495165/dsh/handoff-skill_NEXT_SESSION_PROMPT.md`（223 行，mtime 12:10 之前）
- 已加载：`session-handoff` skill（接手模式）+ `references/resume-playbook.md`
- 本轮允许的唯一写盘：本报告 `receiver-sim-round2.md`（新建；跑 `§8 C` 段产生的 `tiers.json` 重写经比对**字节不变**，见第 1 条）

---

## 一、`§0` 前置核对（先跑，后信）

```text
$ cd /home/CNS2026495165/dsh && git rev-parse --short HEAD && git rev-parse --abbrev-ref HEAD
fa118d91
main
$ ls -d ~/.dsh/skills/session-handoff ~/.dsh/skills/session-handoff/references agent-skills/session-handoff
agent-skills/session-handoff
/home/CNS2026495165/.dsh/skills/session-handoff
/home/CNS2026495165/.dsh/skills/session-handoff/references
$ shasum -a 256 ~/.dsh/skills/session-handoff/SKILL.md agent-skills/session-handoff/SKILL.md
0ae65ae17f93d37a79ca86dec6672ab8e823ed9453ee609d88655413bae6593d  /home/.../.dsh/skills/session-handoff/SKILL.md
0ae65ae17f93d37a79ca86dec6672ab8e823ed9453ee609d88655413bae6593d  agent-skills/session-handoff/SKILL.md
```

`§0` 三件全通：`git_head=fa118d91` 与头部 YAML 一致、`git_branch=main` 一致、`repo_root=/home/CNS2026495165/dsh` 存在、两处 `SKILL.md` SHA 一致。

---

## 二、5 条特别验证项（原缺陷是否已消除）

### 1. `analyze.py` 末行判定 —— **是，已消除**

```text
$ python3 research/vision-probe/analyze.py | tail -6
=== 声明一致性判定（口径：A 级集合 == settings.yaml 中声明 image 的集合）===
  A 级 21 个；settings 已声明 21 个
  A 级但未声明（需补）: 0 []
  已声明但非 A 级（需移除）: 0 []
  >>> 一致性: PASS（相等）
exit=0
```

末行确为 `>>> 一致性: PASS（相等）`，"需补/需移除"两表均为空，**不会误导重复写入**。读源码复核根因也已修掉：
`research/vision-probe/analyze.py:27-54` 的 `live_declared()` 用 `yaml.safe_load` 直读 `~/.dsh/settings.yaml` 现况
（不再是 `models.json` 的写入前快照），并显式写明该历史坑（:30-32）；判定与输出在 :122-130。

副作用核对（因 C 段会重写 `tiers.json`）：运行前后 `shasum -a 256 research/vision-probe/tiers.json`
均为 `d99f7d077f1b785a613a2ac35c339d443b54b442e405be2dab6ac57079a03982` → 内容未变，本轮未污染工作区内容。
独立复核声明数：脚本扫 `settings.yaml` 得 **21** 个模型条目声明 `image`（`id:` 唯一值 53 个，与 `models.json` 一致）。

### 2. `§1` 的 `settings.yaml` 行数 —— **是，已消除**

```text
$ wc -l ~/.dsh/settings.yaml
212 /home/CNS2026495165/.dsh/settings.yaml
```

文档 `§1` 第 55 行「行数演变」现写 `158 → 215 → 212`，与实测 **212** 一致；并注明"212≠158 是本会话造成的"。
上一轮的 158/215 口径缺陷已不复现。

### 3. `§1` 的 `git status` 计数口径与"本仓无其他 *_NEXT_SESSION_PROMPT.md" —— **§1 已消除；附录 A 未同步（见新问题 N1）**

```text
$ git status --short | wc -l
387
$ git status --short | awk '{print $1}' | sort | uniq -c
    355 ??
      3 D
     29 M
$ git status --short | grep -n "NEXT_SESSION_PROMPT"
384:?? handoff-skill_NEXT_SESSION_PROMPT.md
$ find . -name "*_NEXT_SESSION_PROMPT*" -not -path "./.git/*"
./handoff-skill_NEXT_SESSION_PROMPT.md
```

- `§1` 第 50 行：`387 行（含本件自身 1 项）= 355 ?? + 29 M + 3 D` → **与实测逐项相等**（上一轮 385/386 的差 1 问题已修）。
- 计数口径警告（第 52 行"生成时刻快照…接手方重跑得到不同值是正常的，不要据此判定基线被改写"）→ **在位**。
- `§1` 第 58 行「除本件自身外，本仓无其他 `*_NEXT_SESSION_PROMPT.md`」→ `find` 实测**只有本件自身**，成立。
- 残留：`§附录 A` 第 196/198 行仍写「385 行（353 `??` + 29 `M` + 3 `D`）」，与 `§1`/实测（387/355+29+3）**自相矛盾**，修正未贯穿全文（详见 N1）。

### 4. `§8` Runbook 是否标注非只读段 —— **部分：C 段已标，D 段未标（见新问题 N2）**

```text
$ grep -n "只读\|可直接复制运行" handoff-skill_NEXT_SESSION_PROMPT.md
164:**Runbook（可直接复制运行）**
181:#    ！注意：C 段不是只读 —— analyze.py 会重写 research/vision-probe/tiers.json（重算，内容通常不变）
```

- C 段（`analyze.py`）已明确标 **非只读**，且标注准确（实测只重写 `tiers.json`，内容不变）。
- A 段（纯 `shasum`）、B 段（`check-sections.sh` / `probe-reachability.sh`）经源码核对**无写操作**
  （两脚本仅 `echo` 到 stdout，无重定向/`cp`/`mv`/`rm`；实测两段 `exit=0`，`counted=99 PASS`、`checked=33 missing=0`）。
- 残留：**总标题仍是无条件断言「可直接复制运行」**，而 **D 段会写新文件 `raw_responses_new.jsonl` 并重写 `tiers.json`**，未加非只读标注。

### 5. `§7` 关于 `/tmp` 与 `grep -E \b` 的说法 —— **是，已带前提/已更正（附录 A 未同步，见 N3）**

```text
$ grep -n ... §7 坑2/坑3 现值
2. **`/tmp` 的持久性取决于沙箱模式**：`workspace-write`（子代理默认）下**不跨 bash 调用持久**；
   `danger-full-access` 下**持久**（两者均已实测）…别赌 `/tmp`。
3. **`grep -E` 的坑**：**不支持 `(?:…)`**（实测成立）；`\b` 在 GNU grep 下**可用**，但 BSD/macOS grep 不支持…
   早期文档写成"两者都不支持"是**错的，已更正**。

$ printf 'a.md\nfoo bar\n' | grep -E '\bbar\b'; echo $?      → foo bar / 0        # \b 在 GNU grep 可用 ✔
$ printf 'x\n'        | grep -E '(?:a)'; echo $?             → 警告: 表达式以 ? 开头 / 1   # (?:…) 不支持 ✔
$ printf 'probe' > /tmp/round2_probe.txt   # 第 1 次 bash 调用
$ cat /tmp/round2_probe.txt                # 第 2 次 bash 调用 → round2-tmp-probe 121229   # 本模式(/tmp)持久 ✔
```

坑 3 的更正**与实测一致**（含"别把 `.md` 吃掉""路径含 `*` 断词"两条真坑）；坑 2 已补沙箱模式前提，本轮实测在本会话模式（`danger-full-access`）下 `/tmp` 确**跨调用持久**，与新版表述相符。
技能内同源说法也已同步：`~/.dsh/skills/session-handoff/references/generate-playbook.md:86,109` 现为「GNU grep 下 `\b` 可用，但 BSD/macOS 不支持」——**两处副本 SHA 一致，故 `agent-skills/` 快照同样已更正**（见"闸门·P0-1"）。
残留：**附录 A 第 203 行**仍无条件写「注意 `/tmp` 在 bash 调用间不持久」——与更正后的 `§7` 坑 2 矛盾（N3）。

> 另复核上一轮勘误第 6 条（源码引用已换成绝对路径+实测行号）：`dsh-skill-filesystem/lib/index.js:583-594`（`discoverRoot`）、`:756-764`（`entryFromFs` 类型判定）、`dsh-skill/lib/index.js:312-325`（`collectLayer`）**逐条实测落在正确位置**，该修正成立。

---

## 三、`§2` 两个闸门

**P0-1 闸门（skill 存在且与仓库快照 SHA 一致）—— 通过**

```text
$ bash §8 A 段（5 文件两处副本比对）
MATCH SKILL.md / MATCH references/handoff-spec.md / MATCH references/generate-playbook.md
MATCH references/resume-playbook.md / MATCH references/examples-and-pitfalls.md
```

**P0-2 闸门（`settings.yaml` 未被其他会话改写：`models.json` 的 53 个 id 与当前清单比对）—— 通过**

```text
models.json: 53 | settings.yaml: 53
only in models.json: []
only in settings.yaml: []
```

且 `§8 C` 段实跑末行 `>>> 一致性: PASS（相等）`（P0-2 判定标准本身即由此判定），两个前置闸门均无须追问即可判通。

---

## 四、是否仍被迫追问用户

**否 —— 就 `§0` / `§1` 前置核对与 `§2` 的 P0-1、P0-2 而言，本轮全程未追问即完成核对、复述与歧义标注。**
（本会话被上级明确禁止提问，故此处以"判据可由文档+实测独立判定"作为替代证据。）

唯一**按设计**需要用户裁决的是 `§2` P1（`.gitignore`/`agent-skills/` 是否入库）与 P2（22 个 E 级条目删/标/留）——两者已在 `§5`「需你裁决」1、2 条显式列出，属文档已声明的停手点，**不计为"被迫追问"**。

---

## 五、新问题（上一轮未提过）

**N1. 附录 A 未随 `§1` 同步（同一修正未贯穿全文）**
`§1` 已改为 387（355 `??` + 29 `M` + 3 `D`）并加口径警告，但**附录 A 第 196/198 行仍写「385 行（353 `??` + 29 `M` + 3 `D`）」**。
同一文件两个自相矛盾的计数，接手方若只读附录 A 仍会误判差 2。建议：附录 A 改为指向 `§1` 同一口径，或标注"生成时刻快照（先于本件自身与 `receiver-sim-report.md` 落盘）"。

**N2. `§8` 的「可直接复制运行」未覆盖 D 段写副作用**
C 段已标非只读，但 D 段（`sweep.py --out raw_responses_new.jsonl && python3 analyze.py`）会**新建文件 + 重写 `tiers.json`**，总标题仍无条件断言可复制运行。建议把总标题改为「A/B 段只读；C/D 段有写副作用」或给 D 段补同款标注。

**N3. 附录 A 第 203 行的 `/tmp` 断言与更正后的 `§7` 坑 2 矛盾**
该行仍写「注意 `/tmp` 在 bash 调用间不持久」，未带沙箱模式前提；本轮在 `danger-full-access` 下实测 `/tmp` **跨 bash 调用持久**（`round2_probe.txt` 第二次调用可读）。与 N1 同源：勘误只改了正文，没改附录。

**N4. `§7` 坑 8 的 `counted=96 PASS` 是历史快照，与本件现值不符**
本轮实跑 `check-sections.sh` 得 `budget(§0-§5+§9) counted=99 limit=100 PASS`。坑 8 的"96"描述的是当初修脚本时的数值，正文未标"当时"，易被读作对本件的断言（且余量只剩 1 行，下一轮再往 `§0`–`§5` 加两行就会 FAIL）。

**N5. `§1`「本会话改动（7 项）」口径含上一轮模拟档产物**
该行把 `?? receiver-sim-report.md` 记作"本会话改动"，但该文件是**上一轮接手方模拟**（另一子代理）的产物（实测存在，12:07，26173 B）。"本会话"一词在同节里既指生成档、又指交接流程整体，建议改为"本交接周期内新增"。

> 附带（非缺陷）：本轮新建本报告后，`git status --short` 会变 388 行（`§1` 的口径警告已预告此类漂移，不构成基线被改写）。

---

## 六、自裁决

**基本自足但有 3 处需补** ——
`§0` 前置核对、`§1` 事实基线、`§2` P0-1/P0-2 两个闸门**均可由文档+只读实测独立判定，无须追问用户**；
上一轮 6 处修正**核心已落地且经实测证实有效**（`analyze.py` 末行 PASS、`settings.yaml` 212、`§1` 387 含自身、C 段非只读、`§7` 坑 2/3 已更正、源码行号可复核）；
但修正**未贯穿到不编号附录与 Runbook 总标题**，留下 3 处需补：**N1（附录 A 计数 385/353 与 `§1` 387/355 矛盾）、N2（D 段写副作用未标）、N3（附录 A 的 `/tmp` 无条件断言与 `§7` 更正矛盾）**；N4/N5 为可读性/余量提醒，不阻断开工。
