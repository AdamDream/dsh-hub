# Accessibility force-on forensics — Firefox 155 (snap) vs Chrome 153 (`.deb`)

Read-only worker pass. Nothing outside `raw/` was written; no process was signalled,
no config edited, no browser launched, no `pgrep -f`, no sandbox escalation.
`/proc/303448/environ` was unreadable (yama `ptrace_scope=1`) and was not retried.
Scratch: `/tmp/a11y/` holds only the two derived `strings` dumps (~75 MB) used by the
generators in `raw/`; every deliverable is under `raw/`.

## Verdict table

| # | Claim | Verdict | Exact command that produced the evidence |
|---|---|---|---|
| A1 | libxul.so contains the literal `GNOME_ACCESSIBILITY` (1×, @0x130e8c0) | **PROVEN** | `strings -a -t x /snap/firefox/8863/usr/lib/firefox/libxul.so > /tmp/a11y/libxul.strings` then `grep -F -c GNOME_ACCESSIBILITY /tmp/a11y/libxul.strings` → `1` |
| A2 | libxul.so contains `accessibility.force_disabled` (1×, @0x1def0c) | **PROVEN** | `grep -F -c 'accessibility.force_disabled' /tmp/a11y/libxul.strings` → `1` |
| A3 | libxul.so does **not** contain `ACCESSIBILITY_ENABLED`, `QT_ACCESSIBILITY`, `GTK_MODULES`, `AT_SPI_BUS`, `force-renderer-accessibility`, `screen-reader` | **PROVEN** | `for p in ACCESSIBILITY_ENABLED QT_ACCESSIBILITY GTK_MODULES AT_SPI_BUS force-renderer-accessibility screen-reader; do grep -F -c -- "$p" /tmp/a11y/libxul.strings; done` → all `0` |
| A4 | libxul.so contains `atspi` | **NOT FOUND** (the 3821 case-insensitive hits are x86 opcode bytes) | `grep -F 'ATSPI' /tmp/a11y/libxul.strings \| head` → `UAWAVAUATSPI`, `AWAVATSPI`; `grep -F -c atspi` → `0` |
| A5 | libxul.so `gail` is the GTK accessibility module | **NOT FOUND** (false positive: lone 4-char run in a data blob, gibberish neighbours) | `sed -n '239722,239730p' /tmp/a11y/libxul.strings` |
| A6 | Firefox reaches a11y via the ATK bridge library | **PROVEN** | `grep -n -F -C4 GNOME_ACCESSIBILITY /tmp/a11y/libxul.strings` → neighbours `libatk-1.0.so.0`, `atk_hyperlink_impl_get_type`, `libatk-bridge-2.0.so.0`, `org.a11y.Bus`, `atk_bridge_adaptor_init` |
| A7 | about:support's Accessibility rows are fed by `Services.appinfo.accessibilityEnabled`, `Services.prefs.getIntPref("accessibility.force_disabled")`, `Services.appinfo.accessibilityInstantiator` | **PROVEN** | `unzip -p omni.ja modules/Troubleshoot.sys.mjs \| sed -n '922,933p'` |
| A8 | the default of `accessibility.force_disabled` is `0` | **PROVEN** | `unzip -p omni.ja greprefs.js \| grep -n accessibility.force_disabled` → `220:pref("accessibility.force_disabled", 0);` |
| A9 | no Firefox JS reads a force-on environment variable for a11y | **PROVEN (no hits)** | per-member `unzip -p <jar> <member> \| grep -n -E 'GNOME_ACCESSIBILITY\|ACCESSIBILITY_ENABLED\|GTK_MODULES\|AT_SPI_BUS'` over both jars → 0 hits in any JS/FTL/XHTML member |
| A10 | **which** libxul function does `getenv("GNOME_ACCESSIBILITY")` | **INCONCLUSIVE** | needs disassembly/symbol mapping; only the subsystem (GTK/ATK region) is established |
| B1 | Chrome contains the real switch `force-renderer-accessibility` | **PROVEN** | `grep -F -m1 -n -- 'force-renderer-accessibility' /tmp/a11y/chrome.strings` @0x2c25520, neighbours are switch names |
| B2 | Chrome reads `ACCESSIBILITY_ENABLED` / `GNOME_ACCESSIBILITY` / `SCREEN_READER` as env vars | **INCONCLUSIVE** (literals present but sit in enum/name pools, not env lookups) | `sed -n '300275,300295p'` / `163197,163213p` / `150039,150055p` `/tmp/a11y/chrome.strings` |
| B3 | Chrome does **not** consume `GTK_MODULES` | **PROVEN** | `grep -F -c GTK_MODULES /tmp/a11y/chrome.strings` → `0` |
| B4 | Chrome can speak AT-SPI (browser process imports the bridge) | **PROVEN** | `sed -n '1047,1055p'` and `1105,1113p` `/tmp/a11y/chrome.strings` → `atk_bridge_adaptor_init`, `atspi_init`, `libatk-bridge-2.0.so.0` |
| B5 | Chrome `Local State` / `Default/Preferences` record a forced-a11y decision | **NOT FOUND** | `grep -o -i -E '"[a-z_]*(accessib\|screen_reader\|force_renderer\|a11y)[a-z_]*"[^,}]{0,60}' ~/.config/google-chrome/'Local State'` → no match; `Preferences` → only `"accessibility":{"captions":{"headless_caption_enabled":false` |
| B6 | A Chrome/Chromium policy file exists | **NOT FOUND** | `ls -la /etc/opt/chrome/ /etc/chromium/policies/` → both "No such file or directory" |
| B7 | A Chrome `.desktop` Exec carries the flag | **NOT FOUND** | `grep -n -E 'Exec\|Name=' /usr/share/applications/google-chrome.desktop` → `Exec=/usr/bin/google-chrome-stable %U` (L108), plain (L171), `--incognito` (L223) |
| B8 | A native messaging host or user desktop entry launches Chrome | **NOT FOUND** | `ls -la ~/.config/google-chrome/NativeMessagingHosts/` → empty; `grep -rln -i chrome ~/.local/share/applications/ /etc/xdg/autostart/` → nothing |
| B9 | **`/opt/google/chrome/google-chrome` was modified from the shipped package** | **PROVEN** | `dpkg -V google-chrome-stable` → `??5??????  /opt/google/chrome/google-chrome`; recorded `eecca240162aa8b7b6531304438ba7e6` vs actual `b53a1c87f2de81b09e99c4491b1c3ffb` |
| B10 | that wrapper appends `--force-renderer-accessibility` to every launch | **PROVEN** | `cat -n /opt/google/chrome/google-chrome` → L30 `exec -a "$0" "$HERE/chrome" "$@" --force-renderer-accessibility`; mtime 10:50 vs 09-17 11:47 for the rest of `/opt/google/chrome` |
| B11 | pid 303448 got its flag from an **environment variable** | **NOT SUPPORTED** | argv cannot be set by an env var; the wrapper has no expansion; `GTK_MODULES` absent from Chrome (`grep -F -c`) |
| B12 | pid 303448 got its flag from a **policy file** | **NOT SUPPORTED** | B6 absent; `grep -ril -E 'chrome\|accessib\|renderer-accessibility' /etc/.OCular/Policy/ /etc/.OCular/policy.xml /etc/.OCular/config.xml` → nothing |
| B13 | pid 303448 got its flag from a **desktop-file Exec** | **NOT SUPPORTED** | B7 plain Exec; and argv shape contradicts the wrapper path: flag is argv[1], `--ozone-platform=x11` is argv[2], `argv[0]` is the real binary — the wrapper appends **last** and forces `argv[0]` to the invoking path |
| B14 | pid 303448 was spawned by gnome-shell as `/opt/google/chrome/chrome --force-renderer-accessibility --ozone-platform=x11` | **PROVEN (the argv + the parent)** | `/proc/303448/cmdline`; `PPid` walk `303448 → 4139 (/usr/bin/gnome-shell) → 3736 (systemd --user) → 1` |
| B15 | the **specific human/automated action** behind B14 | **INCONCLUSIVE** | no log, history or file records it; `.bash_history` has 0 matches for the switch; `find … -newermt '2026-09-22 09:30'` found only the two launcher scripts |
| B16 | `/usr/bin/firefox` was modified to force `GNOME_ACCESSIBILITY=1` | **PROVEN** | `dpkg -V firefox` → `??5??????  /usr/bin/firefox`; recorded `df16e16833ffbb4a160531651b801a49` vs actual `2ee34784f247a3149b3c9a3acc4f526e`; L72 `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"` |
| B17 | the actor that rewrote both launcher scripts | **INCONCLUSIVE** | only correlation: `/etc/environment` + `/etc/profile` carry `##TEC_BEGIN##` blocks, and that literal is inside the managed agent binaries `/usr/local/.OCular/TAUninstall` (`strings -a … \| grep -n TEC_BEGIN` → lines 800-801). No process or log proves the writer |

## The 5 most decision-relevant verbatim quotes

1. `/opt/google/chrome/google-chrome` L30 — **the Chrome force-on**:
   `exec -a "$0" "$HERE/chrome" "$@" --force-renderer-accessibility`
2. `/usr/bin/firefox` L72 — **the Firefox force-on**:
   `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`
3. `modules/Troubleshoot.sys.mjs` L924/927-929/931 — **what about:support reads**:
   `data.isActive = Services.appinfo.accessibilityEnabled;` /
   `data.forceDisabled = Services.prefs.getIntPref("accessibility.force_disabled");` /
   `data.instantiator = Services.appinfo.accessibilityInstantiator;`
4. `localization/en-US/toolkit/about/aboutSupport.ftl` L121-123 — **the user-visible labels**:
   `a11y-title = Accessibility` / `a11y-activated = Activated` / `a11y-force-disabled = Prevent Accessibility`
5. `/tmp/a11y/chrome.strings` @0x2c25520 — **Chrome's switch table** (proves the switch is real):
   `enable-experimental-accessibility-labels-debugging` / `disable-renderer-accessibility` / `force-renderer-accessibility`

## Things I could NOT establish (no speculation offered)

- Which libxul.so function performs `getenv("GNOME_ACCESSIBILITY")` (subsystem only).
- Whether Chrome consumes `ACCESSIBILITY_ENABLED`, `GNOME_ACCESSIBILITY` or
  `SCREEN_READER` as environment variables — **INCONCLUSIVE**; the literals exist but
  in enum/name pools, and the control set shows real env literals look identical, so
  presence alone cannot decide.
- The action that produced pid 303448's argv — **INCONCLUSIVE**.
- The writer of the two launcher edits — **INCONCLUSIVE**; only the marker-based
  correlation with the managed endpoint agent, which is not proof.
- Whether the running Firefox (pid 9042) actually took the `/usr/bin/firefox` path
  (the snap's own desktop entry uses `/snap/bin/firefox`, which bypasses it).

## Deliverables

- `ff_binary_env_strings.txt` — presence/absence table (verdict + exact/substr/ci counts +
  first offset), SUBSTR-host breakdown, verbatim 9-line contexts, false-positive caveats,
  and a system-library attribution table. Generated by `gen_ff_binary_env_strings.sh`.
- `ff_aboutsupport_source.txt` — about:support evidence, all quotes produced by
  `unzip -p` (verbatim, not transcribed) + the user self-verification procedure.
  Generated by `gen_ff_aboutsupport_source.sh`.
- `chrome_launch_forensics.txt` — PART B findings.
- `forensic-findings.md` — this file.
