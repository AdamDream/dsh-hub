#!/bin/bash
# Read-only forensics generator: presence/absence table + verbatim neighbour context
# for accessibility "force-on" environment-variable names in two browser binaries.
#
# Inputs are `strings -a -t x` dumps produced once with:
#   strings -a -t x /snap/firefox/8863/usr/lib/firefox/libxul.so > /tmp/a11y/libxul.strings
#   strings -a -t x /opt/google/chrome/chrome                     > /tmp/a11y/chrome.strings
# (format: "<hex-offset> <string>", one per line)

set -u
XUL=/tmp/a11y/libxul.strings
CHR=/tmp/a11y/chrome.strings
OUT="${1:?usage: gen_ff_binary_env_strings.sh <outfile>}"

PATTERNS=(
  ACCESSIBILITY_ENABLED
  GNOME_ACCESSIBILITY
  QT_ACCESSIBILITY
  GTK_MODULES
  atk-bridge
  gail
  force_disabled
  force-renderer-accessibility
  force_renderer_accessibility
  accessibility.force_disabled
  atspi
  AT_SPI_BUS
  org.a11y.Bus
  screen-reader
  accessibilitySupportEnabled
  enable-accessibility
  screen_reader
  atk_bridge
  libatk-bridge
  IsAccessibilityEnabled
  ax_mode
)

# exact   = dump lines whose WHOLE string equals the pattern (no substring, no context)
# substr  = dump lines CONTAINING the pattern as a substring (this is the raw grep -F -c)
# ci      = same as substr but case-insensitive (catches Atspi* / at-spi)
emit_table () {
  local label="$1" file="$2"
  printf '%-30s | %-8s | %-7s | %-6s | %-9s | %s\n' \
         "PATTERN" "verdict" "exact" "substr" "ci" "first-offset (of substr match)"
  printf '%s\n' "-------------------------------------------------------------------------------------------------------"
  for p in "${PATTERNS[@]}"; do
    c=$(grep -F -c -- "$p" "$file" 2>/dev/null || true); [ -z "$c" ] && c=0
    e=$(awk -v p="$p" '{ s=$0; sub(/^[ \t]*[0-9a-f]+[ \t]/,"",s); if (s==p) n++ } END{ print n+0 }' "$file")
    i=$(grep -F -i -c -- "$p" "$file" 2>/dev/null || true); [ -z "$i" ] && i=0
    if [ "$e" -gt 0 ]; then v="EXACT"; elif [ "$c" -gt 0 ]; then v="SUBSTR"; elif [ "$i" -gt 0 ]; then v="CI-ONLY"; else v="ABSENT"; fi
    if [ "$c" -gt 0 ]; then off="0x$(grep -F -m1 -- "$p" "$file" | awk '{print $1}')"; else off="-"; fi
    printf '%-30s | %-8s | %-7s | %-6s | %-9s | %s\n' "$p" "$v" "$e" "$c" "$i" "$off"
  done
  printf '%s\n' "verdict: EXACT = that exact string is a literal in the binary | SUBSTR = only occurs inside a longer"
  printf '%s\n' "         string | CI-ONLY = only different capitalisation | ABSENT = not present in any form"
}

# For SUBSTR-only hits, print the FULL host strings so a reader can see that the
# pattern is only a fragment of something else (e.g. libatk-bridge-2.0.so.0).
emit_hosts () {
  local label="$1" file="$2"
  printf '%-30s | %s\n' "PATTERN (SUBSTR only)" "distinct host strings containing it (up to 3)"
  printf '%s\n' "-------------------------------------------------------------------------------------------"
  local any=0
  for p in "${PATTERNS[@]}"; do
    local e c
    e=$(awk -v p="$p" '{ s=$0; sub(/^[ \t]*[0-9a-f]+[ \t]/,"",s); if (s==p) n++ } END{ print n+0 }' "$file")
    c=$(grep -F -c -- "$p" "$file" 2>/dev/null || true); [ -z "$c" ] && c=0
    if [ "$e" -eq 0 ] && [ "$c" -gt 0 ]; then
      any=1
      local hosts
      hosts=$(grep -F -- "$p" "$file" | sed -E 's/^[ \t]*[0-9a-f]+[ \t]//' | sort -u | head -3 | paste -sd' ;; ' -)
      printf '%-30s | %s\n' "$p" "$hosts"
    fi
  done
  [ "$any" -eq 0 ] && printf '(none - every present pattern is an exact standalone string)\n'
}

emit_context () {
  local file="$1"
  local pat="$2"
  local n
  n=$(grep -F -m1 -n -- "$pat" "$file" | cut -d: -f1)
  if [ -z "$n" ]; then
    printf '  [pattern "%s" ABSENT - no context]\n' "$pat"
    return
  fi
  local s=$(( n - 4 )); [ "$s" -lt 1 ] && s=1
  local e=$(( n + 4 ))
  printf '  --- first occurrence at dump line %s (match line shown in [ ]) ---\n' "$n"
  sed -n "${s},${e}p" "$file" | awk -v m="$n" -v s="$s" '{ ln=s+NR-1; if (ln==m) printf "  [%s] %s\n", ln, $0; else printf "   %s  %s\n", ln, $0 }'
}

{
  echo "================================================================================"
  echo " ACCESSIBILITY FORCE-ON ENV STRINGS: PRESENCE/ABSENCE + NEIGHBOUR CONTEXT"
  echo " host: Ubuntu 24.04 / X11 / uid 1001 / user CNS2026495165"
  echo " date: $(date -Is)"
  echo " method: strings -a -t x <binary>; literal fixed-string grep; neighbours = first"
  echo "         match dump line +/- 4 lines (9 lines total)"
  echo " dumps:"
  echo "   /tmp/a11y/libxul.strings  $(wc -l < "$XUL") lines  from /snap/firefox/8863/usr/lib/firefox/libxul.so"
  echo "   /tmp/a11y/chrome.strings  $(wc -l < "$CHR") lines  from /opt/google/chrome/chrome"
  echo " [NOTE: /tmp/a11y/ is worker-owned scratch holding ONLY these derived dumps;"
  echo "  every deliverable is written under the raw/ output directory.]"
  echo "================================================================================"
  echo
  echo "################################################################################"
  echo "# BINARY 1: /snap/firefox/8863/usr/lib/firefox/libxul.so  (Gecko, Firefox 155.0.1)"
  echo "################################################################################"
  echo
  echo "--- TABLE 1a: libxul.so ---"
  emit_table "libxul.so" "$XUL"
  echo
  echo "--- TABLE 1a-ii: libxul.so, what the SUBSTR hits really are ---"
  emit_hosts "libxul.so" "$XUL"
  echo
  echo "--- CONTEXT 1a: libxul.so, 9 dump lines around first occurrence of each PRESENT pattern ---"
  for p in "${PATTERNS[@]}"; do
    if grep -q -F -- "$p" "$XUL"; then
      echo
      echo "=== pattern: \"$p\" ==="
      emit_context "$XUL" "$p"
    fi
  done
  echo
  echo "################################################################################"
  echo "# BINARY 2: /opt/google/chrome/chrome  (Google Chrome 153.0.8010.52)"
  echo "################################################################################"
  echo
  echo "--- TABLE 1b: chrome ---"
  emit_table "chrome" "$CHR"
  echo
  echo "--- TABLE 1b-ii: chrome, what the SUBSTR hits really are ---"
  emit_hosts "chrome" "$CHR"
  echo
  echo "--- CONTEXT 1b: chrome, 9 dump lines around first occurrence of each PRESENT pattern ---"
  for p in "${PATTERNS[@]}"; do
    if grep -q -F -- "$p" "$CHR"; then
      echo
      echo "=== pattern: \"$p\" ==="
      emit_context "$CHR" "$p"
    fi
  done
  echo
  echo "################################################################################"
  echo "# ATTRIBUTION: which OTHER binaries on this host actually carry these names?"
  echo "# (answers 'consumed where' - neither browser binary hosts GTK_MODULES or"
  echo "#  ACCESSIBILITY_ENABLED; the GTK/AT-SPI stack does)"
  echo "################################################################################"
  echo
  printf '%-58s|%-12s|%-21s|%-21s|%-11s|%-6s|%s\n' "BINARY (path)" "GTK_MODULES" "ACCESSIBILITY_ENABLED" "GNOME_ACCESSIBILITY" "atk-bridge" "gail" "atspi"
  printf '%s\n' "------------------------------------------------------------------------------------------------------------------------------"
  for L in \
    /snap/gnome-46-2404/164/usr/lib/x86_64-linux-gnu/libgtk-3.so.0 \
    /snap/gnome-42-2204/263/usr/lib/x86_64-linux-gnu/libgtk-3.so.0 \
    /usr/lib/x86_64-linux-gnu/libgtk-3.so.0 \
    /usr/lib/x86_64-linux-gnu/libgtk-4.so.1 \
    /usr/lib/x86_64-linux-gnu/libatk-bridge-2.0.so.0 \
    /usr/libexec/at-spi2-registryd \
    /usr/libexec/at-spi-bus-launcher \
    /usr/bin/gnome-shell \
    /usr/libexec/gnome-session-binary ; do
    if [ -e "$L" ]; then
      printf '%-58s|' "$L"
      for spec in "GTK_MODULES:12" "ACCESSIBILITY_ENABLED:21" "GNOME_ACCESSIBILITY:21" "atk-bridge:11" "gail:6" "atspi:0"; do
        p="${spec%:*}"; w="${spec##*:}"
        c=$(strings -a "$L" 2>/dev/null | grep -F -c -- "$p")
        if [ "$w" = "0" ]; then printf '%s' "$c"; else printf "%-${w}s|" "$c"; fi
      done
      printf '\n'
    else
      printf '%-58s| NOT PRESENT\n' "$L"
    fi
  done
  echo
  echo "NOTE: snap firefox does NOT bundle GTK; its GTK3 comes from the gnome-46-2404 platform snap,"
  echo "      which is why GTK_MODULES consumption shows up there and not in libxul.so."
  echo
  echo "################################################################################"
  echo "# CAVEATS / IDENTIFIED FALSE POSITIVES  (read before using the tables above)"
  echo "################################################################################"
  echo
  cat <<'CAVEATS'
 (1) libxul.so "atspi" CI-ONLY count=3821 is a TOOL ARTEFACT, not strings.
     Every one of those hits is an x86-64 opcode byte run that happens to be
     printable, e.g. "AWAVATSPI" / "UAWAVAUATSPI" (0x41 'A' = REX prefix,
     0x54/0x53/0x50 = push %rsp/%rbx/%rax). Proof:
        grep -F 'ATSPI' /tmp/a11y/libxul.strings | head
     Case-SENSITIVE "atspi" is ABSENT from libxul.so. Firefox has no atspi_*
     string; it reaches AT-SPI through libatk-bridge-2.0.so.0 (see (3)).
     => treat libxul "atspi" as ABSENT.

 (2) libxul.so "gail" EXACT=1 at 0x13f45da is a FALSE POSITIVE.
     A bare 4-char run inside a random data blob; its neighbours are gibberish
     ("sApasfut", "lmaimontess", "-new-ener", "Ylay", "ennesymphon"). It is NOT
     the GTK accessibility module name. Firefox's GTK3 (the snap platform snap's)
     does carry the real "gail"/"atk-bridge" module names - see the ATTRIBUTION
     table at the end.

 (3) libxul.so "atk-bridge" / "libatk-bridge" are SUBSTR-only: the host string is
     "libatk-bridge-2.0.so.0". The standalone module name "atk-bridge" is ABSENT
     from libxul.so (it exists in GTK3, which is where GTK_MODULES is consumed).

 (4) chrome "ACCESSIBILITY_ENABLED" (EXACT=1) is NOT an environment-variable
     lookup site. It sits inside a pool of constant NAMES ending in
     _ENABLED/_DISABLED (USER_DISABLED, PROXY_OPTION_DISABLED,
     GL_VERTEX_ATTRIB_ARRAY_ENABLED, ATSPI_STATE_ENABLED, ...). Presence of the
     literal therefore does NOT establish that Chrome reads an env var of that
     name. Same for "SCREEN_READER", whose only hit is one entry inside a
     concatenated ui::AXMode flag-name blob:
       ANNOTATE_MAIN_NODE EXTENDED_PROPERTIES FROM_PLATFORM HTML HTML_METADATA
       INLINE_TEXT_BOXES LABEL_IMAGES NATIVE_APIS PDF_OCR PDF_PRINTING
       SCREEN_READER WEB_CONTENTS
     "screen-reader" (hyphenated) is ABSENT in chrome entirely.

 (5) chrome "GNOME_ACCESSIBILITY" / "QT_ACCESSIBILITY" (EXACT=1 each) lie in an
     ALPHABETICALLY SORTED merged constant pool (UNITY, POSITIVE_INFINITY,
     NEGATIVE_INFINITY, PROCESS_UTILITY, TOUCH_ACCESSIBILITY, ...
     _NET_WM_WINDOW_OPACITY, ADDRESS_HOME_*). A sorted merged pool is the normal
     result of linker string deduplication, so adjacency here is NOT evidence of
     an env-var read. Their role is recorded as INCONCLUSIVE, not proven.

 (6) chrome stores switch names WITHOUT the leading "--". That is why
     "force-renderer-accessibility" is EXACT=1 at 0x2c25520 while
     "--force-renderer-accessibility" is ABSENT. Chromium matches "--<name>" at
     runtime; the switch table neighbours are
     "enable-experimental-accessibility-labels-debugging" and
     "disable-renderer-accessibility", i.e. this IS the content-switches table.

 (7) GENERAL LIMIT: in a merged .rodata string pool, string adjacency is only a
     WEAK signal. It is treated as decisive here ONLY where neighbouring strings
     are semantically clustered and self-identifying: the Chromium switch table
     (0x2c254c0-0x2c25520), the nsIXULAppInfo attribute-name table in libxul.so
     (processType/processID/uniqueProcessID/is64Bit/accessibilityEnabled/
     accessibilityInstantiator at 0x11ea6f3-0x11ea75c), and the dlopen/DT_NEEDED
     library-name list (libatk-1.0.so.0, libatk-bridge-2.0.so.0, libgobject-2.0.so.0).
CAVEATS
  echo
  echo "================================================================================"
  echo "================================================================================"
} > "$OUT" 2>&1

echo "wrote $OUT ($(wc -l < "$OUT") lines)"
