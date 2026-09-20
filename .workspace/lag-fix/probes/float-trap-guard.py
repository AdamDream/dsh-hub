#!/usr/bin/env python3
"""浮点日边界陷阱守卫。

背景（本次修复实测踩到 3 次）：JS 的 `Date.getTime()` 是 float。`midnight - 1`
会算成「次日 00:00:00.001」而不是「前一日 23:59:59.999」；`midnight + 1` 会算成
当天 `.001`。因此所有「用 ±1 毫秒取本地日边界」的写法，都必须**先把 Date 归一化成
整毫秒**（`new Date(y, m-1, d).getTime()` / `new Date(nextStart).getTime()`）再做算术；
一旦先做过时间戳算术（`x.getTime() - 1`、`now - 86400000 - 1`）或写成字面量
（`1798732799999.999`），边界就会漂到相邻毫秒上，日对齐守卫恒假、日粒度快速路径
静默失效。

判定规则（按「表达式接收者是不是新建 Date」判定，不做脆弱的字符串比对）：
  R1 `X.getTime() ± 1`：X 的文本必须以 `new Date(...)` 结尾才安全；
  R2 `... 86400000 ± 1` / `... 1000 ± 1`：浮点日长算术后再 ±1 → 危险；
  R3 硬编码 `.999` / `.001` 毫秒字面量 → 危险。

用法：float-trap-guard.py <file...>
退出：0 = 无命中；1 = 有命中（逐行打印）。
"""
import re
import sys

GETTIME_TRAP = re.compile(r"\.\s*getTime\(\)\s*[-+]\s*1\b")
DAYLEN_TRAP = re.compile(r"\b(?:86400000|86_400_000|1000)\s*[-+]\s*1\b")
LITERAL_TRAP = re.compile(r"\.(?:999|001)(?![\d.])")


def strip_comment(line: str) -> str:
    """去掉行尾注释，且不误伤字符串里的 //。"""
    out = []
    quote = None
    i = 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\":
                out.append(ch)
                i += 1
                if i < len(line):
                    out.append(line[i])
                    i += 1
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
            break
        out.append(ch)
        i += 1
    return "".join(out)


IDENT = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$")


def _is_ident_char(ch: str) -> bool:
    """ASCII 标识符字符（不能用 str.isalnum()：它会把中文注释也算进去）。"""
    return ch in IDENT


def _walk_back_ident(line: str, i: int) -> int:
    """从 i 向左吞掉标识符/成员访问，返回新的下标。"""
    j = i
    while j >= 0 and (_is_ident_char(line[j]) or line[j] in ".[]"):
        j -= 1
    return j


def receiver_is_fresh_date(line: str, dot_pos: int) -> bool:
    """判定 `…getTime()±1` 的接收者是否由 `new Date(...)` 产生（= 已归一化成整毫秒）。

    从 `.` 向前做括号配平取回整个成员表达式（不依赖正则的贪婪行为）：
    取回 `new Date(...)` 的实参括号后，再验证其函数名正是 `Date` 且前面是 `new`。
    因此 `new Date(y, 0, 1).getTime() - 1`、`new Date(nextStart).getTime() - 1` 安全；
    `nextDay.getTime() - 1`、`filters.to - 1`（变量上的浮点时间戳）不安全。
    """
    i = dot_pos - 1
    while i >= 0 and line[i].isspace():
        i -= 1
    if i < 0 or line[i] != ")":
        return False
    depth = 0
    j = i
    while j >= 0:
        if line[j] == ")":
            depth += 1
        elif line[j] == "(":
            depth -= 1
            if depth == 0:
                break
        j -= 1
    if j < 0:
        return False
    # j 指向 new Date(...) 的实参左括号；向左取函数名（可能是 Date / a.b.Date / [0]）
    k = _walk_back_ident(line, j - 1)
    callee = line[k + 1:j]
    if not callee.strip().endswith("Date"):
        return False
    pre = line[:k + 1].rstrip()
    return pre.endswith("new")


def check_line(line: str) -> list:
    hits = []
    m = GETTIME_TRAP.search(line)
    if m:
        if receiver_is_fresh_date(line, m.start()):
            return hits  # 安全形态：先把 Date 归一化成整毫秒再 ±1
        hits.append(f"[R1 非新建 Date 的 getTime()±1] {line.strip()[:120]}")
        return hits
    for pat, label in ((DAYLEN_TRAP, "[R2 日长算术后再 ±1]"), (LITERAL_TRAP, "[R3 硬编码 .999/.001 毫秒]")):
        if pat.search(line):
            hits.append(f"{label} {line.strip()[:120]}")
            break
    return hits


def main() -> int:
    bad = []
    for path in sys.argv[1:]:
        for n, raw in enumerate(open(path, encoding="utf-8"), 1):
            stripped = raw.strip()
            if not stripped or stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                continue
            for hit in check_line(strip_comment(raw)):
                bad.append(f"{path}:{n}: {hit}")
    if bad:
        print("\n".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--receiver":
        # 自检模式：打印每行 getTime()±1 的接收者判定
        for raw in open(sys.argv[2], encoding="utf-8"):
            code = strip_comment(raw)
            m = GETTIME_TRAP.search(code)
            if m:
                i = m.start() - 1
                while i >= 0 and code[i].isspace():
                    i -= 1
                print(f"{raw.strip()[:70]!r} -> receiver_end={i} fresh={receiver_is_fresh_date(code, m.start())}")
        sys.exit(0)
    sys.exit(main())
