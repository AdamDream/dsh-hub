#!/usr/bin/env python3
"""Read-only ASAR indexer.

Parses the Electron ASAR header of a (possibly 355MB) archive without extracting
it, and answers byte-offset -> member-path lookups. Pure stdlib, opens the file
read-only ('rb').

ASAR layout:
  0  : 4 bytes  UInt32LE  = 4
  4  : 4 bytes  UInt32LE  = headerPickleSize
  8  : 4 bytes  UInt32LE  = headerStringPickleSize
  12 : 4 bytes  UInt32LE  = headerJsonSize
  16 : headerJsonSize bytes = UTF-8 JSON directory tree
  then: headerPickleSize bytes of padding/other pickle fields, then file bodies
       (a member's data starts at 8 + headerPickleSize + <offset field>)
"""
import json
import struct
import sys

ASAR = sys.argv[1] if len(sys.argv) > 1 else "/usr/lib/chatgpt/resources/app.asar"


def load(asar=ASAR):
    with open(asar, "rb") as fh:
        head = fh.read(16)
    _u1, header_pickle_size, _u2, header_json_size = struct.unpack("<4I", head)
    with open(asar, "rb") as fh:
        fh.seek(16)
        raw = fh.read(header_json_size)
    tree = json.loads(raw.decode("utf-8", "replace"))
    base = 8 + header_pickle_size
    return tree, base


def walk(node, prefix=""):
    for name, meta in node.get("files", {}).items():
        path = prefix + "/" + name
        if "files" in meta:
            yield from walk(meta, path)
        else:
            yield path, meta


def all_files():
    tree, base = load()
    out = []
    for path, meta in walk(tree):
        size = meta.get("size")
        off = meta.get("offset")
        abs_off = base + int(off) if off is not None else None
        out.append((path, size if size is not None else 0, abs_off, "unpacked" in meta))
    return out, base


if __name__ == "__main__":
    files, base = all_files()
    print(f"base={base} members={len(files)}")
    total = sum(s for _, s, _, _ in files) if False else 0
    for p, s, o, u in sorted(files, key=lambda r: -(r[1] or 0))[:20]:
        print(f"{s:>12} {'UNPACKED' if u else 'packed  '} {o} {p}")
