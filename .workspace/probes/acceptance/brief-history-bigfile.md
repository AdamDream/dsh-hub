# dsh-hub 历史大文件核实 + 保留/重写成本裁决简报

- 生成时间：2026-09-17（会话内实测）
- 仓库：`/home/CNS2026495165/dsh`，分支 `main`，远端 `origin = git@github.com:AdamDream/dsh-hub.git`
- 纪律：全程只读（无 `gc` / `filter-repo` / `push` / 删文件）；本文件为唯一写入产物
- 待核声称来源：`.workspace/NEXT_SESSION_PROMPT.txt:138`
  > `| `dsh-hub` 历史里 51MB `.workspace/tmp-ppt-research/raw/mgr.tgz` | GitHub 持续告警；**保留 vs 重写历史待用户裁决** |`

---

## 顶部结论表：声称 vs 实测（逐条对照）

| # | 交接材料的声称 | 实测结果 | 原始证据 | 判定 |
|---|---|---|---|---|
| 1 | 路径 `.workspace/tmp-ppt-research/raw/mgr.tgz` 在**历史**里 | 存在。blob `15dcbf4818e5bb93956c2e826626923a41af405b`，blob 类型 `blob` | `git rev-list --objects --all \| grep 15dcbf48`；`git cat-file -t` | ✅ **成立** |
| 2 | 大小「51MB」 | `53,561,751` 字节 = **51.08 MiB**（= 53.56 MB 十进制） | `git cat-file -s 15dcbf48…` → `53561751`；`ls -la` 磁盘同为 `53561751` | ✅ **精确成立** |
| 3 | 「GitHub **持续**告警」 | 告警**真实存在**，但是 **push 时一次性**的 GH001 警告，**并非持续**。唯一原始输出：推送 `80ef4ec6..a5976993`（日志 mtime 9月15 18:19） | `.workspace/push-log3.txt` 全文（见 §1.6） | ⚠️ **半成立：事实为真、措辞不成立** |
| 4 | 是否真触发告警 | **真触发了**，GitHub 原文点名该文件与该大小 | `remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; …` | ✅ **成立** |
| 5 | 隐含前提「文件现在还在库里（所以要裁决保留/重写）」 | 文件**已不在 `HEAD`**（`5dc98a7e` 起删除），且**已被 `.gitignore:16` 忽略**；仅剩磁盘残留 + 历史对象 | `git ls-tree -r HEAD \| grep -c mgr.tgz` → `0`；`git check-ignore -v` → `IGNORED` | ⚠️ **前提已变（现状=已不跟踪）** |
| 6 | 隐含「只有这一个」这类大文件 | ❌ **不成立**：历史中 ≥1 MiB 的 blob 共 **59 个 / 202.25 MiB（原始）**；全部 blob **17,992 个 / 363.13 MiB（原始）**；而 `HEAD` 只承载 97.86 MiB → 约 265 MiB 是「死历史」 | 见 §1.2、§1.3 | ❌ **不成立** |
| 7 | 隐含的 clone 代价 | 全新 clone 的 pack = **189,383,980 B = 180.61 MiB**；仅去掉 mgr.tgz → **129.53 MiB**（省 28.3%） | `git pack-objects --stdout --revs`（见 §1.3） | ✅ 已量化 |
| 8 | GitHub 告警状态能否核实 | **无法核实 GitHub 侧告警状态**：无 `gh` CLI、无 token、`api.github.com` 返回 403 限流；公开仓库页 HTML 内**无**任何 large-file 告警字样 | §1.5 | ⛔ 无法核实 |

### 三处交接材料**未提及**的关键事实（本次新发现）

| 事实 | 数值 | 影响 |
|---|---|---|
| **`HEAD` 里仍在被跟踪的最大单文件** | `.workspace/deploy-pptmaster/.venv-ppt-test/…` 共 **1817 个文件 / 51.62 MiB**（最大单个 5.03 MiB），**未被 `.gitignore` 忽略** | 这才是「持续扩散」的真凶：`git add -A` 会继续把它塞进每个提交 |
| 引入 venv 的 commit | **`3028e624`——与 mgr.tgz 同一个 commit** | 二者同源，重写范围天然重合 |
| mgr.tgz 的真实 pack 成本 | packed `53,564,144 B` = **整包 188,819,865 B 的 28.4%**；`compressed == uncompressed`（tgz 不可再压） | 名义大小 1:1 转为 clone 字节，其余大 blob 多为可压文本，实际成本远低于名义值 |
| 重写会改多少 SHA | 仅删 mgr.tgz：**14 个 commit 中 9 个 SHA 改变**（`3028e624` + 8 个后代），5 个祖先 SHA 保持不变 | §2.B |
| 历史里有无 secret（重写后 push 保护是否会拦） | 无。`push-log.txt` 里被 GitHub secret-scanning 拒绝的 commit `a521d2d4` **在当前仓库中根本不存在**（`cat-file` 报 `could not get object info`） | 路线 B **不会**触发 push protection 重扫 |
| 其它 clone / CI / fork | 本机**仅 1 个 clone**；无 `.github/`、无 CI、无 tag、无 git notes、`git remote` 只有 `origin` | 爆炸半径极小 |

---

## 第一部分：事实核实

所有命令均为原样复制执行，输出为原样摘录。

### 1.1 路径在**当前工作树**与**历史**中的状态

```console
$ cd /home/CNS2026495165/dsh
$ git ls-tree -r HEAD --name-only | grep -i 'mgr\.tgz' || echo "(no mgr.tgz in HEAD)"
(no mgr.tgz in HEAD)

$ git ls-files '.workspace/*' | wc -l
3745

$ git log --all --oneline -- '.workspace/tmp-ppt-research/raw/mgr.tgz'
5dc98a7e 排除调研克隆目录（嵌套仓库，报告已提炼结论；skill 副本已入 deploy-pptmaster）
3028e624 分布式控制泛化 + 0.1.5 借鉴补丁 + 槽位 B + 终审

$ git log --all --pretty='%H %ad %s' --date=short -- '.workspace/tmp-ppt-research/raw/mgr.tgz'
5dc98a7e3ec5d5574bcfab26eba863c91ee1353e 2026-09-15 排除调研克隆目录（…）
3028e62425bf42fcb3849fd4031ee0732c33fc7f 2026-09-15 分布式控制泛化 + 0.1.5 借鉴补丁 + 槽位 B + 终审
```

**该 blob 存在于多少 commit 的 tree 中**（注意：`git log` 计入「新增」「删除」两个事件，但对象只活在 1 个 tree 里）：

```console
$ for c in 3028e624 5dc98a7e HEAD; do echo -n "$c: "; git ls-tree -r $c --name-only | grep -c 'tmp-ppt-research/raw/mgr.tgz'; done
3028e624: 1
5dc98a7e: 0
HEAD: 0
```

**结论表：**

| 项目 | 值 |
|---|---|
| 文件名 | `.workspace/tmp-ppt-research/raw/mgr.tgz` |
| blob sha | `15dcbf4818e5bb93956c2e826626923a41af405b` |
| 大小 | `53,561,751` 字节 = **51.08 MiB**（53.56 MB 十进制） |
| 类型 | `blob` |
| 出现在树的 commit 数 | **1**（`3028e624`） |
| 首次出现 commit | `3028e62425bf42fcb3849fd4031ee0732c33fc7f`（2026-09-15，新增） |
| 末次出现 commit | `5dc98a7e3ec5d5574bcfab26eba863c91ee1353e`（2026-09-15，删除；其父正是 `3028e624`，即**下一个提交就删了**） |
| 现在在工作树磁盘上？ | **是**，但**未被跟踪**：`-rw-rw-r-- 1 CNS… 53561751 9月 14 11:34 mgr.tgz` |
| 现在在本地对象库？ | **是**：`git cat-file -s 15dcbf48…` → `53561751` |
| 现在在远端历史？ | **是**：`git merge-base --is-ancestor 3028e624 origin/main` → YES |

```console
$ git merge-base --is-ancestor 3028e624 origin/main && echo "YES - mgr.tgz blob is in origin/main history"
YES - mgr.tgz blob is in origin/main history
```

### 1.2 全仓库历史大文件排名

生成方式：`git rev-list --objects --all | git cat-file --batch-check='%(objecttype)|%(objectname)|%(objectsize)|%(rest)'`

```console
$ git rev-list --objects --all | git cat-file --batch-check='%(objecttype)|%(objectname)|%(objectsize)|%(rest)' > .obj2.txt
$ wc -l < .obj2.txt
19186
```

**历史中最大的前 10 个对象：**

```console
$ awk -F'|' '$1=="blob"{printf "%d\t%s\n",$3,$4}' .obj2.txt | sort -k1 -nr | head -10
    53561751   51.08 MiB  .workspace/tmp-ppt-research/raw/mgr.tgz
     7019133    6.69 MiB  .workspace/research/tarballs/bs-0.18.1/lib/client-mermaid.js
     7014225    6.69 MiB  .workspace/research/tarballs/bs-0.19.1/lib/client-mermaid.js
     7013349    6.69 MiB  .workspace/research/tarballs/bs-0.18.0/lib/client-mermaid.js
     7011871    6.69 MiB  .workspace/research/tarballs/bs-0.17.1/lib/client-mermaid.js
     7009820    6.69 MiB  .workspace/research/tarballs/bs-0.16.0/lib/client-mermaid.js
     6996658    6.67 MiB  .workspace/research/tarballs/bs-0.15.0/lib/client-mermaid.js
     6977165    6.65 MiB  .workspace/research/tarballs/bs-0.14.0/lib/client-mermaid.js
     5276624    5.03 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/lib/python3.12/site-packages/lxml/etree.cpython-312-x86_64-linux-gnu.so
     5203513    4.96 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/lib/python3.12/site-packages/pillow.libs/libavif-8a7f9d56.so.16.4.2
```

**Top 11–20（延续）**：`plugin/dsh-pptmaster/lib/client.js` 3.91 MiB、`tmp-ppt-research/raw/zips/ppt-master.zip` 3.68 MiB、`plugin/dsh-pptmaster/lib/index.js` 3.39 MiB、`research/tarballs/bs-0.19.1.tgz` 3.32 MiB、`bs-0.18.1.tgz` 3.30、`bs-0.17.1.tgz` 3.26、`PIL/_imaging…so` 3.24、`bs-0.16.0.tgz` 3.22、`bs-0.18.0.tgz` 3.19、`lxml/objectify…so` 2.79 MiB。

**分布（历史中 ≥1 MiB 的 blob，按目录聚合）：**

```console
    85.95 MiB  25 files  .workspace/research/tarballs
    59.34 MiB   6 files  .workspace/tmp-ppt-research/raw
    21.70 MiB   7 files  .workspace/deploy-pptmaster/.venv-ppt-test
    18.53 MiB  13 files  .workspace/deploy-pptmaster/skills
     7.30 MiB   2 files  .workspace/deploy-pptmaster/plugin
     4.29 MiB   3 files  .workspace/research/tgz
     2.49 MiB   1 files  .workspace/deploy-pptmaster/wb-src.tgz
     1.44 MiB   1 files  dsh-btw/docs/assets
     1.22 MiB   1 files  .workspace/upstream-015-diff/pkgs
```

**总计：**

```console
$ awk -F'|' '$1=="blob"{s+=$3;n++} END{printf "BLOBS=%d TOTAL=%.2f MiB\n",n,s/1048576}' .obj2.txt
BLOBS=17992 TOTAL=363.13 MiB
$ awk -F'|' '$1=="blob" && $3>=1048576{s+=$3;n++} END{printf "GE1MiB count=%d sum=%.2f MiB\n",n,s/1048576}' .obj2.txt
GE1MiB count=59 sum=202.25 MiB
$ awk -F'|' '{if($3+0>m){m=$3+0;p=$4}} END{printf "MAX=%d bytes (%.2f MiB) %s\n", m, m/1048576, p}' .obj2.txt
MAX=53561751 bytes (51.08 MiB) .workspace/tmp-ppt-research/raw/mgr.tgz
```

> ⚠️ **重要纠正**：「363 MiB 历史 blob」不等于 clone 体积。实测整包只有 180 MiB，因为除 mgr.tgz 外的大 blob 多为**可压缩文本**（见 §1.3）。mgr.tgz 是**唯一**名义大小 1:1 转为 pack 字节的对象。

### 1.3 当前仓库体积

```console
$ du -sh .git
185M	.git
$ du -sh .git/objects
184M	.git/objects

$ git count-objects -vH
count: 227
size: 2.00 MiB          # 松散对象
in-pack: 18959
packs: 2
size-pack: 180.58 MiB   # ← clone 下载量级
prune-packable: 0
garbage: 0
size-garbage: 0 字节

$ git rev-list --objects --all | wc -l
19186
$ git rev-list --all --count
14
```

**packfile 情况：**

```console
$ ls -la .git/objects/pack/
pack-39b5ae0b566a8018a9585a5ee373ed697b2284df.pack     8,948,540   9月14 10:59
pack-c95bce435d51c5746dab8341e383207ceb0f45f6.pack   179,871,325   9月15 18:13
（含对应 .idx / .rev）
$ du -bc .git/objects/pack/*.pack | tail -1
188819865	总计
$ git fsck --no-progress --dangling
（无输出 → 无悬挂对象，pack 内对象全部可达）
```

**mgr.tgz 的 pack 真实占用（关键数字）：**

```console
$ git verify-pack -v .git/objects/pack/*.idx | grep -E '^(15dcbf48…|3a965250…)'
3a9652501e88f568b881ba54e419814a8c3e7955 blob   7019133 1385210 85536163
15dcbf4818e5bb93956c2e826626923a41af405b blob  53561751 53564144 113329504
#         格式：<sha> <type> <原始大小> <pack内大小> <offset>

$ awk '$1 ~ /^[0-9a-f]{40}$/ {n++; s+=$4} END{…}'   # 全对象 pack 内大小求和
objects=18959  sum(size-in-packfile)=188819801 B = 180.07 MiB
```

| 对象 | 原始 | pack 内 | 说明 |
|---|---|---|---|
| `mgr.tgz` | 53,561,751 B (51.08 MiB) | **53,564,144 B (51.08 MiB)** | 不可压，**占整包 28.4%** |
| `client-mermaid.js` (bs-0.18.1) | 7,019,133 B (6.69 MiB) | 1,385,210 B (1.32 MiB) | 文本，压缩 5× → 实际成本仅 1.32 MiB |

**全新 clone 的实际 pack 体积（只读测量，输出到 stdout，不写入仓库）：**

```console
$ printf 'refs/remotes/origin/main\n' | git pack-objects --stdout --revs > .clone.pack
$ stat -c%s .clone.pack
189383980        # = 180.61 MiB

# 各方案对比（后三行为 --filter 代理测量，用于估算「重写后」体积）
$ for f in "blob:limit=1m" "blob:limit=5m"; do printf 'refs/remotes/origin/main\n' \
    | git pack-objects --stdout --revs --filter="$f" > /tmp/p.pack; stat -c%s /tmp/p.pack; done
68832704         # 去掉所有 ≥1 MiB blob → 65.64 MiB
132857129        # 去掉所有 ≥5 MiB blob → 126.70 MiB
```

| 场景 | clone pack | 相对现状 |
|---|---|---|
| **现状（A 保留）** | **180.61 MiB** | — |
| 只 purge mgr.tgz（B-lite） | **129.53 MiB**（= 189,383,980 − 51.08 MiB） | **−28.3%** |
| purge 所有 ≥5 MiB 大对象 | 126.70 MiB（实测代理） | −29.8% |
| purge 所有 ≥1 MiB 大对象（B-full） | 65.64 MiB（实测代理） | **−63.6%** |

> 代理测量说明：`--filter=blob:limit=…` 产出的 pack 保留了全部 tree/commit 元数据、只省略超额 blob，与「重写历史删掉这些 blob」后的 clone 体量高度接近，但**不是**重写本身的执行结果，属**估算**（已在表中标注）。

**`HEAD` 里仍在跟踪的内容（含 12 个 ≥1 MiB 文件）：**

```console
$ git ls-tree -r -l HEAD | awk '{s+=$4} END{printf "%d bytes = %.2f MiB\n", s, s/1048576}'
102614623 bytes = 97.86 MiB

$ git ls-tree -r -l HEAD | awk '$4>=1048576{printf "%12d %6.2f MiB  %s\n",$4,$4/1048576,$5}' | sort -nr
     5276624   5.03 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/lxml/etree.cpython-312-x86_64-linux-gnu.so
     5203513   4.96 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/libavif-8a7f9d56.so.16.4.2
     4096050   3.91 MiB  .workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js
     3559243   3.39 MiB  .workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/index.js
     3402345   3.24 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/PIL/_imaging.cpython-312-x86_64-linux-gnu.so
     2920920   2.79 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/lxml/objectify.cpython-312-x86_64-linux-gnu.so
     2679264   2.56 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/yaml/_yaml.cpython-312-x86_64-linux-gnu.so
     2608867   2.49 MiB  .workspace/deploy-pptmaster/wb-src.tgz
     1800497   1.72 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/pillow.libs/libzstd-44be1190.so.1.5.7
     1510915   1.44 MiB  dsh-btw/docs/assets/installed.png
     1510915   1.44 MiB  dsh-btw/docs/assets/installed-overview-en.png
     1467713   1.40 MiB  .workspace/deploy-pptmaster/.venv-ppt-test/…/libfreetype-9fc94c80.so.6.20.6

$ git ls-tree -r -l HEAD | grep '\.venv-ppt-test' | awk '{s+=$4;n++} END{printf "venv: %d files %.2f MiB\n",n,s/1048576}'
venv: 1817 files 51.62 MiB     # ← 占 HEAD 全部跟踪内容的 52.8%，且未被 ignore
$ git ls-tree -r -l HEAD | awk '{split($5,a,"/"); k=a[1]"/"a[2]; s[k]+=$4} END{…}' | sort -nr | head -3
    61.65 MiB  1885 files  .workspace/deploy-pptmaster
     6.75 MiB    23 files  dsh-btw/docs
     5.96 MiB   384 files  .workspace/deploy-workerspace
```

**`HEAD` 里没有任何单文件超过 50 MB**（最大 5.03 MiB）→ **未来的普通 push 不会再生 GH001 大文件告警**；远端仓库总量 180 MiB，远低于 GitHub 1 GB 软限与 100 MB 单文件硬限。

### 1.4 远端状态

```console
$ git remote -v
origin	git@github.com:AdamDream/dsh-hub.git (fetch)
origin	git@github.com:AdamDream/dsh-hub.git (push)

$ cat .git/config
[core] … [lfs] repositoryformatversion = 0
[remote "origin"] url = git@github.com:AdamDream/dsh-hub.git
                 fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"] remote = origin / merge = refs/heads/main

$ git log --oneline origin/main -3
0c9affbf 交接提示词：事实基线（git 0a5b4476 + 落盘报告）+ 待办优先级 + 已裁决不得重开项 + 历史坑 + 文件索引
0a5b4476 三处模型统一 v4.1-flash + subagent 模型可配置热载 + 设置页
93d2ac79 vision: adam v4.1-flash 原生多模态实测→声明 input 直传 + vision-adam 换 adam 网关；…

$ git rev-parse HEAD origin/main
0c9affbf5289e1eca0f1239ed88799795be423fe
0c9affbf5289e1eca0f1239ed88799795be423fe

$ git rev-list --left-right --count HEAD...origin/main
0	0                     # ← 完全一致：0 ahead / 0 behind

$ git for-each-ref --format='%(refname) %(objectname:short)' refs/remotes refs/heads refs/tags
refs/heads/main 0c9affbf
refs/remotes/origin/main 0c9affbf   # 无任何 tag、无其它分支
```

**网络可达（只读 `ls-remote`，未做 fetch 以外的写操作）：**

```console
$ timeout 8 git ls-remote --heads origin
0c9affbf5289e1eca0f1239ed88799795be423fe	refs/heads/main
exit=0                     # 网络可用，远端 main == 本地 HEAD
```

**GitHub 告警状态可否核实 → 不能：**

```console
$ command -v gh            # 无输出 → gh CLI 未安装
$ timeout 10 curl -sS -H 'User-Agent: dsh-probe' https://api.github.com/repos/AdamDream/dsh-hub
{"message":"API rate limit exceeded for 69.17.5.83. …"}
$ timeout 10 curl -sS https://api.github.com/rate_limit
{"resources":{"core":{"limit":60,"remaining":0,"used":60}, …}}   # 未认证配额已耗尽
$ timeout 15 curl -sSL https://github.com/AdamDream/dsh-hub | grep -oiE '(exceeds|large file|100 MB|50 MB|too large|git-lfs)'
（无匹配；页面 HTTP 200，<title>GitHub - AdamDream/dsh-hub · GitHub</title>，是真实仓库页而非登录页）
```

> ⛔ **结论：无法核实 GitHub 侧告警状态。** 需要认证（`gh auth login` 或 PAT）才能读取仓库设置/通知。可核实的是：**公开仓库页 HTML 中没有持久性大文件告警横幅**——与 GitHub 机制一致（GH001 是 push 时对本次推送对象发出的一次性提示，不落成常驻告警）。

**无 LFS、无 `.gitattributes`：**

```console
$ cat .gitattributes                      → (none)
$ git lfs version                         → git：'lfs' 不是一个 git 命令（git-lfs 未安装）
$ ls -la .git/lfs                         → 没有那个文件或目录
```

### 1.5 「告警」的原始证据：`.workspace/push-log3.txt`

交接材料说「持续告警」，仓库里恰好留有**唯一一次**告警的原始输出：

```console
$ ls -la .workspace/push-log*.txt
-rw-rw-r-- 117  9月 14 11:00 .workspace/push-log2.txt
-rw-rw-r-- 469  9月 15 18:19 .workspace/push-log3.txt      # ← 大文件告警
-rw-rw-r-- 2189 9月 14 10:50 .workspace/push-log.txt       # ← 另一码事：secret 扫描拒绝

$ cat .workspace/push-log3.txt
remote: warning: See https://gh.io/lfs for more information.        
remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this is larger than GitHub's recommended maximum file size of 50.00 MB        
remote: warning: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.        
To github.com:AdamDream/dsh-hub.git
   80ef4ec6..a5976993  main -> main
分支 'main' 设置为跟踪 'origin/main'。
```

**告警发生的推送范围（决定「一次性」判定的关键）：**

```console
$ git rev-list --oneline 80ef4ec6..a5976993
a5976993 瘦身：排除参考缓存/冗余副本（tarballs/tgz/skill副本/备份/sim）…
5dc98a7e 排除调研克隆目录（嵌套仓库，报告已提炼结论；skill 副本已入 deploy-pptmaster）
3028e624 分布式控制泛化 + 0.1.5 借鉴补丁 + 槽位 B + 终审

$ git rev-list 80ef4ec6..a5976993 | grep -c 3028e62425bf42fcb3849fd4031ee0732c33fc7f
1
```

**机制解释（与实测一致）**：GitHub 只对**本次 push 携带的对象**发 GH001。该 blob 随 `3028e624` 首次推送到远端（同一次 push 还捎带了它的删除提交 `5dc98a7e` 与瘦身提交 `a5976993`）。对象一旦落到远端，后续 push 不会重复携带、**不会重复告警**。

- 现有证据中 **`push-log3.txt` 是唯一一次大文件告警**，此后无任何推送日志。
- `push-log.txt`（9/14）记录的是**另一个问题**：GitHub secret-scanning 因 `cc-switch-src/src-tauri/src/services/subscription.rs` 里的 Google OAuth Client Secret 拒绝推送（`! [remote rejected] main -> main (push declined due to repository rule violations)`）——该问题已由 `80ef4ec6`（gitignore `cc-switch-src`）处置，与本次大文件议题无关。

> 因此「**持续**告警」这一措辞不成立：实际是 2026-09-15 单次 push 时的一次性警告。**但无法排除** GitHub 后台通知/邮件仍留存该历史记录——无认证无法查证。

### 1.6 是否已删除 / 是否 ignored / 是否仍在扩散

**（a）已从版本控制删除并已忽略 —— 现状：**

```console
$ cat -n .gitignore
     1	# 依赖与链接（指向 DSH profile node_modules 的环境特定符号链接）
     2	node_modules
     3	**/node_modules/
     5	# 运行时产物
     6	*.log
     7	.DS_Store
     9	# 编辑器
    10	.idea/
    11	.vscode/
    12	*.swp
    13	cc-switch-src/
    14	.workspace/repos/
    15	.workspace/research-dsh-workerspace/repos/
    16	.workspace/tmp-ppt-research/        # ← mgr.tgz 就此被忽略
    17	.workspace/research/tarballs/
    18	.workspace/research/tgz/
    19	.workspace/research/tarballs/        # ← 与 17 行重复（可清理）
    20	.workspace/deploy-pptmaster/skills/
    21	.workspace/upstream-015-diff/pkgs/
    22	.workspace/backup-*/
    23	.workspace/deploy-lag/backup-*/
    24	.workspace/deploy-lag/sim/
    25	.workspace/research-luxweft-doc/

$ git check-ignore -v .workspace/tmp-ppt-research/raw/mgr.tgz
.gitignore:16:.workspace/tmp-ppt-research/	.workspace/tmp-ppt-research/raw/mgr.tgz
```

**（b）仍在扩散的路径 —— 现状：是，真正的风险在别处**

```console
$ for p in .workspace/deploy-pptmaster/.venv-ppt-test/ .workspace/deploy-pptmaster/wb-src.tgz \
           .workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js \
           dsh-btw/docs/assets/installed.png .workspace/tmp-ppt-research/raw/mgr.tgz; do
    printf '%-62s ' "$p"; git check-ignore -q "$p" && echo "IGNORED" || echo "NOT ignored"; done
.workspace/deploy-pptmaster/.venv-ppt-test/                    NOT ignored
.workspace/deploy-pptmaster/wb-src.tgz                         NOT ignored
.workspace/deploy-pptmaster/plugin/dsh-pptmaster/lib/client.js NOT ignored
dsh-btw/docs/assets/installed.png                              NOT ignored
.workspace/tmp-ppt-research/raw/mgr.tgz                        IGNORED
```

```console
$ git log --oneline --diff-filter=A -- .workspace/deploy-pptmaster/.venv-ppt-test
3028e624 分布式控制泛化 + 0.1.5 借鉴补丁 + 槽位 B + 终审
$ git log --oneline --diff-filter=A -- .workspace/deploy-pptmaster/wb-src.tgz
3028e624 分布式控制泛化 + 0.1.5 借鉴补丁 + 槽位 B + 终审
```

- `.venv-ppt-test/`（**1817 文件 / 51.62 MiB**，磁盘 57 MB）**被跟踪且未被 ignore**，与 mgr.tgz 同由 `3028e624` 引入 —— 这才是「持续往仓库里灌大文件」的活跃路径。
- 工作树当前是干净的（`git status --short` 仅 3 项 untracked，无 venv 变更），因此**下一次 `git add -A` 仍会继续包含它**。

**（c）其它风险核查**

```console
$ find / -maxdepth 6 -type d -name 'dsh-hub*' ; echo "---"
（无输出：本机不存在 dsh-hub 名称的其它目录）
$ # 本机所有带 origin 的 git 仓库中，指向 dsh-hub 的只有：
/home/CNS2026495165/dsh -> git@github.com:AdamDream/dsh-hub.git
$ ls -la .github  → 没有那个文件或目录（无 CI）
$ git notes list  → （无输出，无 note）
$ git fsck --no-progress --dangling  → （无输出，无悬挂对象）
```

**（d）secret 历史核查（决定路线 B 会不会被 push protection 拦）**

```console
$ git cat-file -t a521d2d4a896b3ba2f5aa763ff052f1ebed494e6
fatal: git cat-file: could not get object info
$ git rev-list --all | grep -c a521d2d4
0
$ git ls-tree -r HEAD --name-only | grep -c 'cc-switch-src'
0
```

→ 被 secret-scanning 拒绝的那个 commit **从未进入本仓库历史**，历史中**不含**该 secret。重写历史后 force-push **不会**因 push protection 被拦。

---

## 第二部分：三条路线的成本 / 风险对比

### 路线 A —— 保留历史不动（只做防扩散）

**影响面**：零 SHA 变动、零远端操作、零协作中断。mgr.tgz 继续留在 GitHub 历史与本地对象库；新 clone 永远付 51.08 MiB。

| 维度 | 实测值 |
|---|---|
| GitHub 侧会怎样 | 该 blob 已在远端（`3028e624` 是 `origin/main` 祖先）；**不再重复告警**（GH001 只对当次推送对象生效，且 `HEAD` 已无 >50 MB 文件，最大 5.03 MiB）。远端总量 180 MiB，**未触及** GitHub 1 GB 软限 / 100 MB 单文件硬限 |
| clone 体积代价 | **180.61 MiB**（实测 pack），其中 mgr.tgz 独占 **51.08 MiB / 28.4%**；clone 耗时约 +10~60 s（视带宽），磁盘永久 +51 MiB / 每个 clone |
| 历史可读性 | 无损；所有旧 SHA 永久有效 |
| 残留 | 工作树磁盘上仍有 53,561,751 B 的 mgr.tgz（现为 untracked+ignored，**不占仓库体积**） |
| 真正该做的防扩散 | `.venv-ppt-test/` 未被 ignore，仍是活跃扩散路径 |

**防扩散命令（可复制；**建议但未执行**——本档为只读档）：**

```bash
cd /home/CNS2026495165/dsh

# ① 先确认它确实未被忽略（应为 NOT ignored）
git check-ignore -q .workspace/deploy-pptmaster/.venv-ppt-test/ && echo IGNORED || echo "NOT ignored"

# ② 只从索引移除，不删磁盘文件（本地 venv 继续可用）
git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test

# ③ 追加 ignore 规则（注意：不要写全局 *.tgz —— HEAD 里有 27 个 .tgz 是有意入库的）
printf '\n# 本地 Python 虚拟环境（测试用，不入库）\n.workspace/deploy-pptmaster/.venv-ppt-test/\n' >> .gitignore

# ④ 顺手去掉 .gitignore 第 19 行的重复行
#    （第 17 行与第 19 行都是 .workspace/research/tarballs/）

git add .gitignore
git commit -m 'chore: 停止跟踪 .venv-ppt-test（1817 文件/51.6MiB 本地 venv）+ ignore'

# ⑤ 验证：应无输出（已不被跟踪）
git ls-files | grep -c '\.venv-ppt-test'
```

> ⚠️ 上面 ③ 刻意**只加 venv 一行**：`git ls-tree -r HEAD --name-only | grep -c '\.tgz$'` = **27**，全局 `*.tgz` 规则会误伤 `.workspace/baseline-011/*.tgz` 等有意入库的基线包。
> 该提交**不会**缩小历史（历史里的 venv blob 仍在）；它只阻止**未来**继续灌入。

**耗时**：< 5 分钟（含验证）。**风险：低**（可回滚：`git revert` 或 `git reset`）。

---

### 路线 B —— 重写历史移除该对象

#### B.0 前置事实（决定风险等级）

| 事实 | 实测 | 对 B 的含义 |
|---|---|---|
| 会变 SHA 的 commit 数 | 仅删 mgr.tgz：**9 / 14**（`3028e624` + 8 个后代）；5 个祖先（`13a296e7`→`80ef4ec6`）SHA **保持不变** | 见下 |
| 协作者 / 其它 clone | 本机**仅 1 个 clone**；无 CI、无 tag、无 fork 可见、无 `.github/` | 爆炸半径极小 |
| push protection | 历史无 secret（`a521d2d4` 不存在于仓库） | force-push 不会被拦 |
| 工具就绪度 | `git filter-repo` **未安装**；`bfg` 未装；`java` 有（`/usr/bin/java`）；`python3 3.12.3` + `pip 24.0` 有 | filter-repo 用**单文件脚本**方式最省事（`pip install` 在 Ubuntu 24.04 会因 PEP 668 externally-managed 报错） |
| git 版本 | `git version 2.43.0` | 支持 `--force-with-lease`、`pack-objects --filter` |
| ⚠️ GitHub 不保证回收 | GitHub 对 force-push 后的旧 commit 会保留一段时间（可按 SHA 访问）；**彻底清除存储需向 GitHub Support 提工单** | 「重写就一定拿回 51 MB 远端存储」**不成立**；但**新 clone 一定变小**（clone 只取可达对象） |

**SHA 变动的精确范围：**

```console
$ n_desc=$(git rev-list --all --ancestry-path 3028e624..HEAD | wc -l); echo "descendants=$n_desc"
descendants=8
$ git rev-list --all --count
14
# → 3028e624 + 8 后代 = 9 个 SHA 改变；5 个祖先（3028e624 之前）SHA 不变
```

**若同时清理其余死历史**（`.workspace/research/tarballs/`、`.venv-ppt-test/`、`skills/`、`wb-src.tgz` 等）：这些由 `88c68288`（初始同步）与 `3028e624` 引入，覆盖到几乎全部 14 个 commit → **全部 SHA 改变**，收益是 clone 降到 ≈65.64 MiB（实测代理，−63.6%）。

#### B.1 完整演练步骤（逐条可复制；**本档未执行任何一条**）

**Step 0 —— 整仓备份（必做，先于一切）**

```bash
# 备份目录建议放在仓库之外（避免被自己 ignore 影响）
BK=~/dsh-hub-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"

cd /home/CNS2026495165/dsh

# ① bundle：含全部 refs、可完整还原
git bundle create "$BK/dsh-hub-pre-rewrite.bundle" --all
sha256sum "$BK/dsh-hub-pre-rewrite.bundle" | tee "$BK/bundle.sha256"

# ② 镜像 clone：还原/回滚最省事（retain 所有旧 SHA）
git clone --mirror /home/CNS2026495165/dsh "$BK/dsh-hub-mirror.git"

# ③ 记录重写前基线，供事后对照
git rev-parse HEAD                                   | tee "$BK/baseline.txt"
git rev-list --all --count                          | tee -a "$BK/baseline.txt"
git count-objects -vH                               | tee -a "$BK/baseline.txt"
git ls-tree -r HEAD --name-only | wc -l             | tee -a "$BK/baseline.txt"
du -sh .git                                         | tee -a "$BK/baseline.txt"

# ④ 校验备份可用（在临时目录验证 bundle）
git clone --no-local "$BK/dsh-hub-pre-rewrite.bundle" /tmp/bundle-verify && \
  git -C /tmp/bundle-verify log --oneline | head -3
```

**Step 1 —— 取得 `git filter-repo`（单文件脚本，绕开 PEP 668）**

```bash
curl -fsSL -o /tmp/git-filter-repo \
  https://raw.githubusercontent.com/newren/git-filter-repo/main/git-filter-repo
chmod +x /tmp/git-filter-repo
/tmp/git-filter-repo --version
# 备选（若允许改系统 Python）：
#   pip install --user git-filter-repo
#   pip install --break-system-packages git-filter-repo
# 备选 2（无 filter-repo 时）：BFG 需 java（本机有 java）
#   curl -fsSL -o /tmp/bfg.jar https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
#   java -jar /tmp/bfg.jar --strip-blobs-bigger-than 50M /path/to/mirror.git
# 备选 3（最差）：git filter-branch --index-filter \
#   'git rm --cached --ignore-unmatch .workspace/tmp-ppt-research/raw/mgr.tgz' -- --all
```

**Step 2 —— 先在**临时克隆**上试跑（绝不先在真仓库上跑）**

```bash
git clone --no-local /home/CNS2026495165/dsh /tmp/dshhub-rewrite-test
cd /tmp/dshhub-rewrite-test

# 删除该 blob 的全部历史痕迹
/tmp/git-filter-repo --force \
  --path .workspace/tmp-ppt-research/raw/mgr.tgz --invert-paths

# 验证 ①：blob 应该彻底消失（期望 fatal: could not get object info）
git cat-file -t 15dcbf4818e5bb93956c2e826626923a41af405b
# 验证 ②：commit 数不变
git rev-list --all --count                 # 期望 14
# 验证 ③：工作树内容与重写前逐字节一致
git ls-tree -r HEAD --name-only | wc -l     # 期望与 baseline 相同
git log --oneline | head -3                 # 期望仍是同样 3 条提交信息（SHA 已变）
# 验证 ④：体积
git count-objects -vH                       # 期望 size-pack 明显下降
```

**Step 2-opt —— 若决定同时清理死历史（⚠️ 会让全部 14 个 SHA 改变）**

```bash
# 在 /tmp/dshhub-rewrite-test 内继续，或从 Step 2 重来
/tmp/git-filter-repo --force \
  --path .workspace/tmp-ppt-research/        --invert-paths \
  --path .workspace/research/tarballs/       --invert-paths \
  --path .workspace/research/tgz/            --invert-paths \
  --path .workspace/deploy-pptmaster/skills/ --invert-paths \
  --path .workspace/deploy-pptmaster/.venv-ppt-test/ --invert-paths \
  --path .workspace/deploy-pptmaster/wb-src.tgz      --invert-paths \
  --path .workspace/upstream-015-diff/pkgs/  --invert-paths
# 注意：这些路径中的 skills/ 与部分 .venv 内容在 HEAD 已不存在，
#       但 --path 会连同所有历史一并抹除；请确认「历史留档」需求可放弃
```

**Step 3 —— 在真实仓库执行（Step 2 验证通过后）**

```bash
cd /home/CNS2026495165/dsh

# 3.1 再次确认备份存在且非空
ls -la "$BK/dsh-hub-mirror.git" "$BK/dsh-hub-pre-rewrite.bundle"

# 3.2 确认工作树干净（有未提交改动会被 filter-repo 拒绝或造成混乱）
git status --short

# 3.3 执行重写（--force 因为这不是 fresh clone）
/tmp/git-filter-repo --force \
  --path .workspace/tmp-ppt-research/raw/mgr.tgz --invert-paths

# 3.4 filter-repo 会主动删除 origin（防误推），需要加回
git remote -v                       # 期望：无 origin
git remote add origin git@github.com:AdamDream/dsh-hub.git

# 3.5 回收旧对象（破坏性，但重写后必须做，否则体积不降）
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git count-objects -vH               # 期望 size-pack 大幅下降

# 3.6 记录重写后基线，与 baseline.txt 对照
git rev-parse HEAD
git log --oneline | head -14
```

**Step 4 —— 推送（force-with-lease 保证远端未被他人改动）**

```bash
cd /home/CNS2026495165/dsh

# 用重写前的远端值做租约：若远端 main 已不是 0c9affbf，推送会被拒绝（安全阀）
git push --force-with-lease=main:0c9affbf origin main

# 只在 main 一个分支时无需推其它 ref；若确有 tag：
# git push --force --tags origin
```

**Step 5 —— 推送后验证**

```bash
git ls-remote origin                       # 期望：远端 main == 新 HEAD
git rev-parse HEAD

# 从远端全新 clone 实测体积（关键验收指标）
rm -rf /tmp/verify-clone
git clone --no-local git@github.com:AdamDream/dsh-hub.git /tmp/verify-clone
du -sh /tmp/verify-clone/.git              # 期望 ≈ 129 MiB（目标 < 现状 185M）
git -C /tmp/verify-clone log --oneline | head -3
git -C /tmp/verify-clone cat-file -t 15dcbf4818e5bb93956c2e826626923a41af405b
                                           # 期望 fatal: could not get object info
```

**Step 6 —— 通知 / 处理其它机器上的旧 clone**

本机实测只有 1 个 clone（即本仓库）。**任何**别的机器/会话若持有旧 clone，其 `main` 会与新远端**分叉**：

```bash
# 在每台持有旧 clone 的机器上执行（二选一）
# 方案 ①（推荐，保留本地未提交工作）
cd <旧 clone 路径>
git stash -u                    # 若有未提交改动
git fetch origin
git reset --hard origin/main    # ⚠️ 丢弃旧 SHA 上的所有本地提交
git remote prune origin
git stash pop                   # 按需

# 方案 ②（更彻底，能回收旧对象占用的磁盘）
# 确认无未推送工作后直接删目录重 clone
rm -rf <旧 clone 路径>
git clone git@github.com:AdamDream/dsh-hub.git <旧 clone 路径>
```

**Step 7 —— 回滚路径（万一）**

```bash
# 最快回滚：从镜像备份把旧 main 推回去
cd "$BK/dsh-hub-mirror.git"
git push --force origin main
# 期望输出：[forced update] main -> main（回到 0c9affbf）

# 备选：从 bundle 还原
cd /home/CNS2026495165/dsh
rm -rf .git
git init -b main .
git fetch "$BK/dsh-hub-pre-rewrite.bundle" 'refs/heads/main:refs/heads/main'
git reset --hard main
git remote add origin git@github.com:AdamDream/dsh-hub.git
```

#### B.2 成本 / 风险汇总

| 维度 | 评估 |
|---|---|
| 直接收益 | clone **180.61 MiB → 129.53 MiB**（−28.3%）；
若做 B-full（连 venv / tarballs 一起清）→ **≈65.64 MiB**（实测代理，−63.6%） |
| SHA 后果 | 仅删 mgr.tgz：**9 / 14 个 commit SHA 全变**；B-full：**14 / 14 全变**。任何旧 SHA 引用（文档、会话记录、外部笔记、commit message 里提到的 hash）**全部失效**。⚠️ 注意：本仓库多处文档/交接提示词内**直接写着 commit hash**（如 `NEXT_SESSION_PROMPT.txt` 写「git 0a5b4476」、`0c9affbf`），这些引用**会被打断** |
| GitHub 侧 | 未 fork、无 tag、无 PR/issue 依赖（无 `.github/`）；**但 GitHub 不保证立即回收旧对象**——彻底清除需 Support 工单 |
| 协作中断 | 协作者数 = 0（单作者个人工作区）；本机 clone 数 = 1 → 实际中断面 ≈ 0 |
| 失败风险 | `filter-repo` 本身幂等性一般（**不可重复执行**，不能对已重写仓库再跑以「补删」）；`--force` 删 origin 是设计如此；`gc --prune=now` 不可逆 |
| 耗时估计 | 工具获取 1–2 min；bundle + mirror 备份 **3–6 min**（190 MB）；试跑 1–2 min；真仓重写 **< 1 min**（14 commits）；`gc --aggressive` **1–3 min**；force-push **1–5 min**（传 ~190 MB 新对象，视上行带宽）；验证 clone 1–3 min。**合计约 10–20 分钟**（不含试错） |
| 回滚 | 可用：mirror/bundle 完整还原，回滚耗时 **2–5 min**。**风险等级：中** |

---

### 路线 C —— 折中方案

| 方案 | 做法 | 收益 | 代价 / 风险 |
|---|---|---|---|
| **C1 只删 mgr.tgz（B-lite）** | `filter-repo --path …/mgr.tgz --invert-paths`，不动其余历史 | clone −51.08 MiB（−28.3%），命中「唯一不可压对象」这一最大单点 | 9/14 SHA 变；仍需 force-push；仍需备份+通知；~10 min。**性价比最高的一条重写路线** |
| **C2 保留历史 + 加 git note / 文档说明** | `git notes add -m '历史含 51MB mgr.tgz，已知并接受'` 或写入 README 排障章节 | 零风险、零 SHA 变动、可完整审计追溯 | clone 体积**毫无改善**；`git notes` 需 `git push origin refs/notes/*` 才会到远端 |
| **C3 新建干净起点仓库，旧库转归档** | 新库 `git init` + 当前 `HEAD` 单次提交导入；旧库改名 `dsh-hub-archive`（Archive/只读） | **clone ≈ 当前工作树体量**（HEAD 97.86 MiB 原始，pack 后更小），一次性彻底摆脱全部死历史；旧库完整保留可查 | 全量历史断代（14 commits 的演化、commit message 里的决策记录与 hash 引用全留在归档库）；两库并存易混淆；GitHub 上要新建仓库 |
| **C4 只做防扩散（= 路线 A）** | 停止跟踪 `.venv-ppt-test`，`.gitignore` 补齐 | 阻断**正在进行**的扩散（venv 51.62 MiB 仍在被跟踪）；零风险 | 不改善历史体积 |
| **C5 GitHub Support 工单** | 不重写，请 GitHub 清除不可达对象 | 理论最优（零 SHA 变动 + 回收远端存储） | 成功率/时效不可控，且**不改变本地与未来 clone 的历史**（blob 依然可达 → clone 依旧 180 MiB）→ **不解决问题** |

> 关键判断：**C5 无效**。因为 blob 在 `origin/main` 的**可达历史**中（`3028e624` 是祖先），GitHub「不可达对象清理」不会碰它；clone 仍会拉取。要缩小 clone，**必须**让该 blob 从可达历史中消失（= 重写），或换库（C3）。

---

## 第三部分：推荐

### 推荐：**路线 A（保留历史不动，只做防扩散）+ 立即修掉 `.venv-ppt-test`**

**一句话理由**：交接材料的紧迫前提「GitHub **持续**告警」经核实**不成立**（实测是 2026-09-15 单次 push 的一次性 GH001，且 `HEAD` 已无任何 >50 MB 文件、未来推送不会再触发），因此为省 51 MiB clone 体积去承担 9/14 SHA 全变 + force-push + 破坏性 `gc` 的代价**不划算**；而真正在持续扩散的是**未被 ignore 的 `.venv-ppt-test`（1817 文件 / 51.62 MiB，占 HEAD 跟踪内容的 52.8%）**，这个用一次普通 commit 就能堵住、零风险。

**推荐执行清单（全部为本档未执行、待用户授权的写操作）：**

1. `git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test` + 追加 `.gitignore` 一行（见 §2.A 命令块）；
2. 顺手清理 `.gitignore` 第 19 行重复项；
3. 可选零风险项：在 `NEXT_SESSION_PROMPT.txt` 第 138 行把「GitHub **持续**告警」更正为「**一次性** push 告警（`.workspace/push-log3.txt`），当前 HEAD 已无大文件」，避免后续会话沿用过时前提；
4. 什么都不做也**不会恶化**：历史已冻结，mgr.tgz 不会再增长。

**若用户仍希望瘦身 clone（时间安排上更从容时）**：走 **B-lite（C1）** —— 只 purge mgr.tgz 一个对象，拿到 28.3% 的收益而只影响 9 个提交；配合 B-full 可到 −63.6%，但会让全部 14 个 SHA 变化。

### 若选 B：风险等级与前置条件

**风险等级：中**（不是低：force-push + 9/14 甚至 14/14 SHA 变动 + `gc --prune=now` 不可逆 + GitHub 不保证回收远端存储，收益可能只体现在 clone 而不体现在仓库存储配额；也不是高：无协作者、无 CI、无 tag、无 fork、历史无 secret，且 bundle+mirror 可在 2–5 分钟内完整回滚）。

**前置条件（缺一不可）：**

1. **必须先确认哪些机器/会话持有旧 clone** —— 本机实测**仅 1 个**（`/home/CNS2026495165/dsh`），且已核对本机所有带 `origin` 的仓库中只有它指向 `dsh-hub`；**但本档无法探测其它物理机/其它会话**，需用户自行确认（据实：无 `.github/`、无 CI、无 tag、无 fork 可见，故预期为空集）。
2. **必须先做双备份**：`git bundle create --all` + `git clone --mirror`，并用 `sha256sum` 记录，且在临时目录验证 bundle 可正常 clone（Step 0 ④）。
3. **必须先在 `/tmp` 临时克隆上试跑并验证**（blob 消失 / commit 数仍为 14 / 工作树逐字节一致），验证通过才动真仓库。
4. **必须知道 `filter-repo` 不可重复执行**、且会删除 `origin`（需手动加回）。
5. **必须接受 SHA 失效的连带影响**：本仓库多份文档/交接提示词**直接引用 commit hash**（例：`NEXT_SESSION_PROMPT.txt` 写「git 0a5b4476」、多处引用 `0c9affbf`）——重写后这些引用全部失效，需同步更新或加映射表。
6. **必须接受远端存储可能不立即回收**：如需彻底清除 GitHub 上的对象，另需向 GitHub Support 提工单。

### 一句话结论

交接材料的**事实（51.08 MiB / 路径 / 真实告警）全部核实为真**，但**两处措辞/前提失真**：「**持续**告警」实为**一次性** push 告警；「只有这一个」实为**59 个 ≥1 MiB、死历史约 265 MiB**，且**真正在扩散的是未被 ignore 的 51.62 MiB `.venv-ppt-test`**。

---

## 附录：本档执行过的全部命令（均为只读）

```bash
# 仓库/远端
git status --short ; git branch -a ; git remote -v ; git log --oneline -3
git rev-parse HEAD origin/main ; git rev-list --left-right --count HEAD...origin/main
git for-each-ref --format='%(refname) %(objectname:short)' refs/remotes refs/heads refs/tags
git log --all --graph --pretty='%h %p %ad %s' --date=short
git merge-base --is-ancestor <sha> HEAD|origin/main
timeout 8 git ls-remote --heads origin
cat .git/config ; cat .gitattributes ; cat -n .gitignore
git notes list ; git fsck --no-progress --dangling

# 对象/大小
git rev-list --objects --all | git cat-file --batch-check='%(objecttype)|%(objectname)|%(objectsize)|%(rest)'
git ls-tree -r -l HEAD ; git ls-tree -r <commit> --name-only
git cat-file -s|-t <sha> ; git check-ignore -v <path>
git count-objects -vH ; du -sh .git .git/objects
git verify-pack -v .git/objects/pack/*.idx
printf 'refs/remotes/origin/main\n' | git pack-objects --stdout --revs [--filter=blob:limit=Nm]
git log --all --oneline|--diff-filter=A -- <path>
git rev-list --all --ancestry-path <sha>..HEAD | wc -l

# GitHub 探测（只读）
timeout 10 curl -sS -H 'User-Agent: dsh-probe' https://api.github.com/repos/AdamDream/dsh-hub
timeout 10 curl -sS https://api.github.com/rate_limit
timeout 15 curl -sSL -H 'User-Agent: Mozilla/5.0' https://github.com/AdamDream/dsh-hub

# 只读排查
find / -maxdepth 6 -type d -name 'dsh-hub*'
for d in $(find /home -maxdepth 5 -type d -name .git); do git -C "$(dirname $d)" remote get-url origin; done
```

**未执行（遵纪律）**：`git gc` / `git filter-repo` / `git filter-branch` / `git push` / `git rm` / 任何删除操作 / `sandbox_permissions`。
