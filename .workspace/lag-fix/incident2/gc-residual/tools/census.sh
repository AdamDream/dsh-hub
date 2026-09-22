#!/bin/bash
# Precise census of concurrent DSH/node browser instances.
# Uses /proc/<pid>/{cmdline,exe,comm}. The matching token lives in THIS FILE,
# never on the invoking command line, so the script cannot self-match.
# (pgrep -f is deliberately NOT used: it would match this script's own argv.)
set -u
HOST_PID="${1:-10806}"
TOKEN_DSH="dsh"
count_all=0; count_dsh=0; count_web=0; count_chrome=0; count_node=0
declare -a rows=()
for p in /proc/[0-9]*; do
  pid="${p#/proc/}"
  [ -r "$p/cmdline" ] || continue
  cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | sed 's/[[:space:]]*$//')
  [ -z "$cmd" ] && continue
  count_all=$((count_all+1))
  exe=$(readlink -f "$p/exe" 2>/dev/null); [ -z "$exe" ] && exe="(unreadable)"
  case "$cmd" in
    *"$TOKEN_DSH"*) count_dsh=$((count_dsh+1));;
  esac
  case "$cmd" in *" web"*|*" web "*) count_web=$((count_web+1));; esac
  case "$cmd" in *chrom*) count_chrome=$((count_chrome+1));; esac
  case "$cmd" in *node*) count_node=$((count_node+1));; esac
  case "$cmd" in
    *"$TOKEN_DSH"*|*chrom*)
      rss=$(awk '/^VmRSS/{print $2}' "$p/status" 2>/dev/null)
      rows+=("$pid|${rss:-?}|$exe|$(echo "$cmd" | cut -c1-110)")
      ;;
  esac
done
echo "CENSUS_TS=$(date -Is)"
echo "TOTAL_PROCS_WITH_CMDLINE=$count_all"
echo "MATCH_dsh=$count_dsh"
echo "MATCH_dsh_web=$count_web"
echo "MATCH_chrome=$count_chrome"
echo "MATCH_node=$count_node"
echo "HOST_PID=$HOST_PID alive=$([ -d /proc/$HOST_PID ] && echo yes || echo no)"
echo "HOST_PID_EXE=$(readlink -f /proc/$HOST_PID/exe 2>/dev/null || echo '(denied)')"
echo "--- rows (pid|rssKB|exe|cmdline) ---"
for r in "${rows[@]}"; do echo "$r"; done
