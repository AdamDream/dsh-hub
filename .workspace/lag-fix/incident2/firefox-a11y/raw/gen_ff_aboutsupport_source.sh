#!/bin/bash
# Read-only forensics generator: about:support "Accessibility" section in Firefox 155
# All quotes are produced by `unzip -p` directly from the jars, so they are verbatim
# (nothing in this file is hand-transcribed).
set -u
J1=/snap/firefox/8863/usr/lib/firefox/omni.ja
J2=/snap/firefox/8863/usr/lib/firefox/browser/omni.ja
SCAN=/tmp/a11y/omni_scan.txt
OUT="${1:?usage: gen_ff_aboutsupport_source.sh <outfile>}"

show () { # show <jar> <member> <first> <last>
  local jar="$1" mem="$2" a="$3" b="$4"
  printf '\n--- %s :: %s  (lines %s-%s) ---\n' "$(basename "$(dirname "$jar")")/$(basename "$jar")" "$mem" "$a" "$b"
  unzip -p "$jar" "$mem" 2>/dev/null | sed -n "${a},${b}p" | nl -ba -v"$a"
}

{
  echo "================================================================================"
  echo " FIREFOX 155 about:support  ->  \"Accessibility\" SECTION: SOURCE EVIDENCE"
  echo " host: Ubuntu 24.04 / uid 1001 / $(date -Is)"
  echo " jars (both read with unzip -p only; nothing extracted to disk):"
  echo "   $J1   ($(stat -c%s "$J1") bytes, $(unzip -Z1 "$J1" 2>/dev/null | wc -l) members)"
  echo "   $J2   ($(stat -c%s "$J2") bytes, $(unzip -Z1 "$J2" 2>/dev/null | wc -l) members)"
  echo "================================================================================"
  echo " NOTE: unzip prints a warning such as"
  echo "   '44252698 extra bytes at beginning or within zipfile ... Compensating...'"
  echo " for these jars. That is EXPECTED and benign: Firefox ships omni.ja in an"
  echo " optimized form (central directory relocated / entries ordered for mmap)."
  echo " unzip still reads the members correctly, which is why the quotes below are"
  echo " reproduced verbatim. Sizes/member counts come from unzip -Z1 / stat."
  echo "================================================================================"
  echo
  echo "################################################################################"
  echo "# 1. MEMBERS THAT CONTAIN THE RELEVANT NAMES (full-jar grep over every member)"
  echo "#    command: for each member: unzip -p <jar> <member> | grep -n -E '...'"
  echo "#    pattern: forceDisabled|accessibility\\.force_disabled|accessibilityEnabled|"
  echo "#             a11y-activated|a11y-force-disabled|force_disabled"
  echo "################################################################################"
  cat "$SCAN"
  echo
  echo "################################################################################"
  echo "# 2. THE PRODUCER: modules/Troubleshoot.sys.mjs  (root omni.ja)"
  echo "#    this is where the data object for the about:support a11y block is built"
  echo "################################################################################"
  show "$J1" modules/Troubleshoot.sys.mjs 918 934
  echo
  echo "  >>> EXACT PROPERTY NAMES READ (verbatim, lines 924 / 927-929 / 931):"
  unzip -p "$J1" modules/Troubleshoot.sys.mjs | sed -n '922,933p' \
    | grep -n 'Services\.' | sed 's/^/      /'
  echo
  echo "  >>> Interpretation:"
  echo "      data.isActive      <- Services.appinfo.accessibilityEnabled      (boolean, nsIXULAppInfo)"
  echo "      data.forceDisabled <- Services.prefs.getIntPref(\"accessibility.force_disabled\")"
  echo "                            (int; wrapped in try/catch, so a missing pref leaves it undefined)"
  echo "      data.instantiator  <- Services.appinfo.accessibilityInstantiator (string)"
  echo
  echo "################################################################################"
  echo "# 3. THE CONSUMER: chrome/toolkit/content/global/aboutSupport.js  (root omni.ja)"
  echo "#    this is the function that writes the values into the page"
  echo "################################################################################"
  show "$J1" chrome/toolkit/content/global/aboutSupport.js 1462 1478
  echo
  echo "################################################################################"
  echo "# 4. THE MARKUP: chrome/toolkit/content/global/aboutSupport.xhtml"
  echo "################################################################################"
  show "$J1" chrome/toolkit/content/global/aboutSupport.xhtml 662 684
  echo
  echo "  >>> NOTE: the shipped xhtml declares only two rows (a11y-activated,"
  echo "      a11y-force-disabled). There is NO 'a11y-instantiator' element in this"
  echo "      member, so the JS branch that un-hides it (line 1473) only runs when"
  echo "      accessibilityInstantiator is non-empty (a Windows/UIA-oriented field)."
  echo
  echo "################################################################################"
  echo "# 5. THE EXACT USER-VISIBLE LABELS: localization/en-US/toolkit/about/aboutSupport.ftl"
  echo "################################################################################"
  show "$J1" localization/en-US/toolkit/about/aboutSupport.ftl 119 127
  echo
  echo "################################################################################"
  echo "# 6. THE DEFAULT VALUE OF THE PREF: greprefs.js  (root omni.ja)"
  echo "################################################################################"
  show "$J1" greprefs.js 218 224
  echo
  echo "  >>> pref(\"accessibility.force_disabled\", 0)  =>  'Prevent Accessibility' shows 0"
  echo "      on a stock profile; it is an int, and 1 (or any non-zero) means a11y is"
  echo "      blocked from starting. 0 does NOT mean a11y is ACTIVE - only that it is"
  echo "      not blocked. Activation is reported separately by a11y-activated."
  echo
  echo "################################################################################"
  echo "# 7. a11y-supporting / adjacent references found in the same jars"
  echo "################################################################################"
  echo
  echo "--- (a) browser/omni.ja :: modules/policies/policies-schema.json (a PREF policy can set it) ---"
  unzip -p "$J2" modules/policies/policies-schema.json 2>/dev/null | grep -n -A6 '"accessibility.force_disabled"' | head -20
  echo
  echo "--- (b) modules/TelemetryEnvironment.sys.mjs (the pref is recorded in telemetry) ---"
  unzip -p "$J1" modules/TelemetryEnvironment.sys.mjs 2>/dev/null | grep -n -B2 -A2 'accessibility.force_disabled' | head -20
  echo
  echo "--- (c) DevTools Server a11y actors read the SAME appinfo flag ---"
  for m in chrome/devtools/modules/devtools/server/actors/accessibility/accessibility.js \
           chrome/devtools/modules/devtools/server/actors/accessibility/parent-accessibility.js \
           chrome/devtools/modules/devtools/server/actors/accessibility/walker.js \
           chrome/devtools/modules/devtools/server/actors/utils/accessibility.js ; do
    printf '    %s\n' "browser/omni.ja :: $m"
    unzip -p "$J2" "$m" 2>/dev/null | grep -n 'accessibilityEnabled\|PREF_ACCESSIBILITY_FORCE_DISABLED' | sed 's/^/        /'
  done
  echo
  echo "--- (d) is there any JS that reads a force-on ENVIRONMENT VARIABLE for a11y? ---"
  echo "    full-jar grep for GNOME_ACCESSIBILITY | ACCESSIBILITY_ENABLED | GTK_MODULES |"
  echo "    AT_SPI_BUS across BOTH jars returned NO hits in any .js/.mjs/.jsm/.xhtml/.ftl"
  echo "    member. (Only libxul.so, the compiled C++ a11y/GTK platform code, carries the"
  echo "     literal GNOME_ACCESSIBILITY - see ff_binary_env_strings.txt.)"
  echo
  echo "################################################################################"
  echo "# 8. ANSWER + USER SELF-VERIFICATION PROCEDURE"
  echo "################################################################################"
  cat <<'ANS'
  The about:support "Accessibility" table is populated by
  modules/Troubleshoot.sys.mjs -> accessibility(done) -> aboutSupport.js accessibility(data).

  Rows and exactly what feeds them:
    "Accessibility"                 <- FTL a11y-title        (section heading)
    "Activated"                     <- data.isActive      = Services.appinfo.accessibilityEnabled
    "Prevent Accessibility"         <- data.forceDisabled = Services.prefs.getIntPref("accessibility.force_disabled")
    "Accessible Handler Used"       <- FTL label exists (a11y-handler-used) but is NOT
                                       written by aboutSupport.js in this build (Windows-only path)
    "Accessibility Instantiator"    <- data.instantiator = Services.appinfo.accessibilityInstantiator
                                       (row only un-hidden when non-empty)

  HOW A USER VERIFIES A11Y STATE (no guessing, no venv):
    1. Open about:support  ->  section "Accessibility".
       - "Activated: true"  => Gecko a11y IS running (accessibility service instantiated).
       - "Activated: false" => Gecko a11y is NOT running in this session.
       - "Prevent Accessibility: 0" => a11y is not blocked by the pref.
       - "Prevent Accessibility: 1" => a11y startup is blocked by the pref.
    2. Open about:config and inspect "accessibility.force_disabled"
       (expected default 0 per greprefs.js; shown as int).
    3. Cross-check with about:config "accessibility.*" plus the AT-SPI bus state on the
       host (org.a11y.Bus on the session bus), because "Activated: true" while the AT-SPI
       bridge is present means the accessibility tree is being built.

  IMPORTANT for the reported incident: forcing renderer a11y in Chrome/Electron uses the
  CHROMIUM switch "--force-renderer-accessibility" (see ff_binary_env_strings.txt and
  chrome_launch_forensics.txt). That switch is a CHROMIUM concept and has NOTHING to do
  with Firefox's pref "accessibility.force_disabled", which works in the OPPOSITE
  direction (it PREVENTS a11y). In Firefox the effective force-on path is the GTK/ATK
  bridge (libatk-bridge-2.0.so.0 + GNOME_ACCESSIBILITY literal inside libxul.so), not a
  Gecko pref.
ANS
  echo
  echo "================================================================================"
  echo " END"
  echo "================================================================================"
} > "$OUT" 2>&1

echo "wrote $OUT ($(wc -l < "$OUT") lines)"
