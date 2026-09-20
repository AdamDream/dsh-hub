#!/usr/bin/env python3
"""Reference scanner: find every mention of to-be-moved paths in the repo.

Read-only. Excludes .git, node_modules, and the docs-reorg output dir.
Usage: python3 refscan.py <needle-file>   (one needle per line, literal substring)
       python3 refscan.py --auto          (auto: all root *.md basenames + top-level .workspace names)
"""
import os, re, sys, json

ROOT = "/home/CNS2026495165/dsh"
SKIP_DIRS = {".git", "node_modules", ".venv-ppt-test", "docs-reorg", ".review-tmp"}
TEXT_EXT = {".md", ".sh", ".js", ".mjs", ".cjs", ".ts", ".json", ".yml", ".yaml", ".txt", ".html", ".css", ".py", ".patch", ".diff", ".d.ts"}


def walk():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel = os.path.relpath(dirpath, ROOT)
        if rel != "." and rel.split(os.sep)[0] == "docs-reorg":
            continue
        for fn in filenames:
            ext = os.path.splitext(fn)[1]
            if ext in TEXT_EXT or fn.endswith(".d.ts"):
                yield os.path.join(dirpath, fn)


def main():
    if sys.argv[1] == "--auto":
        needles = []
        for fn in sorted(os.listdir(ROOT)):
            if fn.endswith(".md") and os.path.isfile(os.path.join(ROOT, fn)):
                needles.append(fn)  # basename; we will anchor on word boundary
    else:
        needles = [l.strip() for l in open(sys.argv[1]) if l.strip()]

    pats = {n: re.compile(r"(?<![A-Za-z0-9_./-])" + re.escape(n) + r"(?![A-Za-z0-9_-])") for n in needles}
    hits = {n: [] for n in needles}
    for path in walk():
        rel = os.path.relpath(path, ROOT)
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for i, line in enumerate(fh, 1):
                    for n, pat in pats.items():
                        if pat.search(line):
                            hits[n].append((rel, i, line.strip()[:220]))
        except (OSError, UnicodeDecodeError):
            pass
    print(json.dumps(hits, ensure_ascii=False, indent=1))


main()
