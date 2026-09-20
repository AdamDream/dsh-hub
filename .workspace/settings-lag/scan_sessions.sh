#!/bin/bash
# READ-ONLY scan: classify every DSH session by whether it ever ran a turn.
cd "$HOME/.dsh/sessions" || exit 1
emit() {
  local d="$1" f sz
  f=$(ls "$d"/session.jsonl.zstd "$d"/session.v3.jsonl.zstd 2>/dev/null | head -1)
  if [ -z "$f" ]; then printf 'NOFILE\t0\t0\t0\n'; return; fi
  sz=$(stat -c%s "$f")
  # single streaming pass per file: count turn/start and user/message lines
  local counts
  counts=$(zstdcat -q "$f" 2>/dev/null | awk '
    /"type":"turn\/start"/{ts++}
    /"type":"user\/message"/{um++}
    END{printf "%d %d", ts+0, um+0}')
  printf '%s\t%s\t%s\t%s\n' "$sz" ${counts:-0 0} "$f"
}
export -f emit
find . -mindepth 2 -maxdepth 2 -type d -print0 | xargs -0 -P 8 -I{} bash -c 'emit "$@"' _ {}
