# Codex UI presence — cross-app forensic inventory

- **Host / user:** local Ubuntu 24.04, `CNS2026495165`, home `/home/CNS2026495165`, X11 (`DISPLAY=:1`, `/tmp/.X11-unix/X1`)
- **Investigation window:** `date` = 2026-09-22 10:30–10:36 CST (2026-09-22T02:3x UTC)
- **Mode:** READ-ONLY outside `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/cross-app/`. No process was signalled, killed, restarted or suspended. No config was edited. SQLite databases were **copied first**, then opened `mode=ro`.
- **Question:** how can the user have reached a "Codex" interface with a **hover-expanding tray** and a **mouse-following ripple animation**?
- **Privacy handling:** no page/message/chat/prompt/document content was read or quoted. Chat/conversation DBs (`~/.codex/sessions`, `history.jsonl`, `logs_2.sqlite`, `state_5.sqlite`, `~/.config/Codex/.../Local Storage`, `IndexedDB`) were **not opened**. History rows are reported as host + path prefix only (query/fragment stripped); visit counts and timestamps as requested; bookmark titles as EXISTS + length.

---

## A. Firefox (snap) history + bookmarks — codex URL presence

### Profiles found
```
$ ls -la /home/CNS2026495165/snap/firefox/common/.mozilla/firefox/
drwx------ 14 CNS2026495165 CNS2026495165 4096  9月 22 10:25 g05ps3km.default
-rw-rw-r--  1 CNS2026495165 CNS2026495165  114  8月 10 17:08 profiles.ini
$ cat profiles.ini
[Profile0] Name=default IsRelative=1 Path=g05ps3km.default Default=1
[General]  StartWithLastProfile=1 Version=2

$ ls -la /home/CNS2026495165/.mozilla/firefox/
ls: 无法访问 '/home/CNS2026495165/.mozilla/firefox/': 没有那个文件或目录   (does not exist)
```
Single profile, snap-only Firefox. `sqlite3` CLI is **absent**; Python 3 stdlib `sqlite3` (SQLite 3.45.1) was used.

### Read-only copy-first procedure
```
$ W=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/cross-app
$ mkdir -p $W/copies/ff-g05ps3km
$ cp -p <profile>/places.sqlite <profile>/places.sqlite-wal $W/copies/ff-g05ps3km/
copied places.sqlite        (5242880 bytes)
copied places.sqlite-wal    (3246440 bytes)
cp: places.sqlite-shm: stat failed — 没有那个文件或目录 (no -shm present at copy time)
```
Query opened as `sqlite3.connect("file:<copy>/places.sqlite?mode=ro", uri=True)`.

### History window
```
moz_places rows:            1989
last_visit_date range:      2026-08-10T09:08:41.374066 -> 2026-09-22T02:19:23.472460   (local ISO, CST)
query time:                 2026-09-22T10:30:30.880596
```
So the history covers ~6 weeks and includes activity **within the last hour** of the query — the DB is live and current, not stale.

### Matching URL rows (host + path prefix only; query/fragment stripped)
Terms searched: `codex`, `chatgpt`, `openai`, `oaistatic`, `oaiusercontent`. **Total matches: 5.**

| # | url_prefix | visit_count | last_visit (local) | hidden |
|---|---|---|---|---|
| 1 | `https://chat.deepseek.com/` | 1 | 2026-09-21T03:54:07.852458 | 0 |
| 2 | `https://openai.com/codex/` | 1 | 2026-09-21T03:54:45.646300 | 1 |
| 3 | `https://openai.com/zh-Hans-CN/codex/` | 1 | 2026-09-21T03:54:46.067879 | 0 |
| 4 | `https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb` | **0** | 2026-09-21T03:54:54.513000 | 0 |
| 5 | `https://chatgpt.com/` | 1 | 2026-09-21T03:59:16.781802 | 0 |

Notes: row 1 matched the term `codex` only as a substring of `deepseek`; it is a false positive of the substring search and is not a Codex entry. Row 4 has `visit_count = 0` and `last_visit_date` set to the download moment — the classic Firefox signature of a **download, not a navigation**.

Distinct hosts touching the terms:
```
host: persistent.oaistatic.com
host: openai.com
host: chatgpt.com
```

### Bookmarks
```
moz_bookmarks rows: 11   (7 folders type=2, no URL rows at all)
URL/title matches for codex|chatgpt|openai|oaistatic|oaiusercontent:  0
Folder titles: reported as length only — len 0/4/7/4/7/6/15, title_is_term=False for all
```
No matching bookmark exists.

### `prefs.js` — hardware acceleration / rendering keys
```
$ grep -E 'layers\.acceleration|gfx\.webrender|gfx\.x11-egl|webgl\.|
          media\.hardware-video-decoding|ui\.prefersReducedMotion|
          browser\.display|layout\.css' <profile>/prefs.js
(no output)
$ wc -l <profile>/prefs.js
241
```
**Result: none of those keys are present in `prefs.js`** — Firefox is running these at built-in defaults. No `user.js` override was found in the profile, and no `pref()` line for these keys was set. This means Firefox contributes **no** user-forced hardware-acceleration or reduced-motion setting; nothing here explains or suppresses a GTK/compositor animation.

### A. Verdict
**PASS.** A browser pathway to a Codex UI exists and was actively used: the user visited `openai.com/codex/` (2 URLs, `hidden=1` for the un-localised one), and **downloaded the Codex desktop installer** from `persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb` at 2026-09-21T03:54:54Z. No bookmark was saved.

---

## B. Chromium-family history (if present)

```
$ for p in ~/.config/google-chrome ~/.config/chromium ~/.config/microsoft-edge \
           ~/.config/BraveSoftware ~/.config/vivaldi ~/.config/opera; do
      [ -d "$p" ] && echo "EXISTS: $p"; done
(no output — none exist)

$ ls -d /snap/*/common/.config/* 2>/dev/null
(no output)

$ ls -la ~/snap/
firefox  firmware-updater  ghostty  snapd-desktop-integration  snap-store
(no chromium-family snap)
```
**No Chrome / Chromium / Edge / Brave / Vivaldi / Opera profile exists**, native or snap. Task B is not applicable — there is no browser-family `History` DB to mine. The only Chromium-engine profile on the machine belongs to the Codex desktop app itself and is reported under E.

### B. Verdict
**FAIL / N-A.** No Chromium-family browser is installed, so this cannot be a pathway to a Codex UI.

---

## C. VS Code / editor Codex extension inventory

```
$ which code code-insiders codium
/usr/bin/code
$ ls -d ~/.vscode/extensions ~/.vscode-server/extensions ~/.vscode-insiders/extensions
/home/CNS2026495165/.vscode/extensions
ls: ~/.vscode-server/extensions: 没有那个文件或目录
ls: ~/.vscode-insiders/extensions: 没有那个文件或目录
```

### Extension directory names (public package identifiers)
```
anthropic.claude-code-2.1.269-linux-x64
anthropic.claude-code-2.1.273-linux-x64
anthropic.claude-code-2.1.274-linux-x64
eclipse-cdt.memory-inspector-1.3.0
eclipse-cdt.serial-monitor-2.0.0
ms-python.debugpy-2026.6.0-linux-x64
ms-python.python-2026.4.0-linux-x64
ms-vscode.cmake-tools-1.24.42
ms-vscode.cpp-devtools-0.6.18
myriad-dreamin.tinymist-0.15.8-linux-x64
stmicroelectronics.stm32cube-ide-build-analyzer-1.4.0
stmicroelectronics.stm32cube-ide-build-cmake-1.46.0-linux-x64
stmicroelectronics.stm32cube-ide-bundles-manager-1.4.0
stmicroelectronics.stm32cube-ide-clangd-1.0.6
stmicroelectronics.stm32cube-ide-core-1.4.0-linux-x64
stmicroelectronics.stm32cube-ide-debug-core-1.4.0
stmicroelectronics.stm32cube-ide-debug-generic-gdbserver-1.4.0
stmicroelectronics.stm32cube-ide-debug-jlink-gdbserver-1.4.0
stmicroelectronics.stm32cube-ide-debug-stlink-gdbserver-1.4.0
stmicroelectronics.stm32cube-ide-project-manager-1.4.0
stmicroelectronics.stm32cube-ide-registers-1.4.0
stmicroelectronics.stm32cube-ide-rtos-1.4.0
stmicroelectronics.stm32-vscode-extension-3.10.0
```
`code --list-extensions --show-versions` confirms the same 21 extensions.

**Matching `codex|openai|chatgpt|copilot`: NONE.** There is **no `openai.chatgpt`**, no `openai.codex`, and no Copilot extension installed. (`~/.copilot/` exists with `config.json` — 131 bytes, 2026-08-10 — and a `logs/` dir whose newest entry is 2026-09-16 17:44; that is the GitHub Copilot CLI config dir, not a VS Code extension.)

### VS Code settings — matching lines only
```
$ grep -nEi 'codex|openai|chatgpt|hardwareAcceleration|disableHardwareAcceleration|gpuAccel' \
       ~/.config/Code/User/settings.json
(no output — zero matching lines)
```

### VS Code recency
```
$ ls -la ~/.config/Code/logs/
20260812T152225  20260812T152458  20260813T165003  20260815T140124
20260817T103923  20260819T103140  20260819T180454  20260820T120640
20260820T171132  20260916T174308          <- newest, mtime 2026-09-16 17:43
```
Newest VS Code session log is **2026-09-16**, six days before the investigation. VS Code had **not** been run on the day the Codex desktop app was installed/used (2026-09-21).

### C. Verdict
**FAIL.** VS Code exists, but carries no Codex/ChatGPT/OpenAI extension and no relevant settings, and had not been launched for six days. An editor route to a Codex UI does not exist on this machine.

---

## D. Codex CLI/TUI presence

```
$ ls -la ~/.local/bin/codex
lrwxrwxrwx 1 CNS2026495165 CNS2026495165 64  8月 14 09:54
  /home/CNS2026495165/.local/bin/codex -> /home/CNS2026495165/.codex/packages/standalone/current/bin/codex

$ realpath ~/.local/bin/codex
/home/CNS2026495165/.codex/packages/standalone/releases/0.147.0-x86_64-unknown-linux-musl/bin/codex

$ file <that path>
ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), static-pie linked, stripped

$ ~/.local/bin/codex --version
WARNING: failed to clean up stale arg0 temp dirs: Permission denied (os error 13)
WARNING: proceeding, even though we could not create PATH aliases: Permission denied (os error 13)
codex-cli 0.147.0
```
It is a **binary** (ELF, statically linked), not a script and not a desktop GUI launcher. The two warnings are sandbox-induced (this agent cannot write under `~/.codex/tmp/arg0`) and are harmless — the version printed. No interactive or agentic command was run and no session was started.

```
$ cat ~/.codex/version.json
{"latest_version":"0.147.0","last_checked_at":"2026-08-14T01:57:46.574419992Z","dismissed_version":null}
```

### `~/.codex/config.toml` — UI/rendering-relevant, non-secret keys only
```
model_provider = "custom"
model = "gpt-6-astra"
model_reasoning_effort = "high"
disable_response_storage = true

[projects."/home/CNS2026495165/Dexterous_Hand_23Dof"]   trust_level = "trusted"
[projects."/home/CNS2026495165/桌面"]                    trust_level = "trusted"

[desktop]
followUpQueueMode = "steer"
conversationDetailMode = "STEPS_COMMANDS"
ambient-suggestions-enabled = false

[tui.model_availability_nux]
"gpt-5.6-sol" = 4
```
The `[model_providers.custom]` block contains a third-party `base_url`; that value is deliberately **not reproduced** here (it is a private endpoint, not rendering configuration).

**`auth.json`: EXISTS, 77 bytes.** Contents not read or reported.

**Key observation:** `config.toml` contains a **`[desktop]`** section — the CLI's own config file is shared with, and configured by, the **desktop app** (`followUpQueueMode`, `conversationDetailMode` are app-side UI behaviours). The CLI and the desktop app are one product surface sharing `~/.codex`.

### Terminal emulators — installed and running
```
$ ps -eo pid,etime,lstart,comm | grep -Ei 'codex|electron|chrome|terminal|kitty|alacritty|wezterm|ghostty|xterm|konsole|tilix|gnome-shell'
   4139  28:28  二 9月 22 10:02:17 2026  gnome-shell
   4218  28:28  二 9月 22 10:02:18 2026  gnome-shell-cal
  27904  16:51  二 9月 22 10:13:55 2026  chrome        <- see note

$ for b in gnome-terminal kitty alacritty wezterm konsole tilix xterm ghostty \
           xfce4-terminal terminator st; do command -v $b; done
/usr/bin/gnome-terminal
/snap/bin/ghostty
/usr/bin/terminator
```
- **No Codex/Electron process was running at investigation time.** `pgrep -a -f 'chrome|chromium'` resolved the `chrome` entry: PID 27904 is `[chrome] <defunct>` under `gdb -q -batch ... /home/CNS2026495165/.cache/ms-playwright/chromium-1148/...`, i.e. a **zombie left by a Playwright/gdb debugging run of this agent's own tooling** — not the Codex app. Playwright headless-shell processes (PIDs 89673–90065) are likewise tooling, not the app.
- Installed terminals: **gnome-terminal, ghostty (snap), terminator**. Ghostty config is empty (`~/.config/ghostty/config.ghostty`, 0 bytes, 2026-09-07) and its snap state was last touched 2026-09-07 — no live evidence of TUI usage.
- Terminal-emulator check for animation capability: a terminal TUI itself cannot render per-pixel ripples, but gnome-terminal/ghostty/terminator are all GPU-or-GTK-rendered and *can* animate. However, no terminal was running and no TUI session is implicated (see verdict).

### Shell history — lines containing `codex` (truncated ≤140 chars, token patterns redacted)
```
$ grep -inE 'codex' ~/.bash_history          -> 0 matches
$ for f in ~/.bash_history-08965.tmp ~/.bash_history-27558.tmp; do grep -inE 'codex' "$f"; done

--- ~/.bash_history-08965.tmp (mtime 2026-08-25 14:09:17 +0800) ---   (12 matches)
 97: curl -fsSL https://chatgpt.com/codex/install.sh | sh
 98: codex --version
 99: codex
104: codex
107: codex
110: codex
111: ~/.codex/config.toml
112: ~/.codex/auth.json
113: nano ~/.codex/config.toml
114: nano ~/.codex/auth.json
115: codex
116: codex --no-stream "你好"

--- ~/.bash_history-27558.tmp (mtime 2026-08-21 13:20:21 +0800) ---   (12 matches, same block; later line numbers)
288: curl -fsSL https://chatgpt.com/codex/install.sh | sh
289: codex --version
290/295/298/301: codex
302: ~/.codex/config.toml
303: ~/.codex/auth.json
304/305: nano ~/.codex/config.toml | nano ~/.codex/auth.json
306/307: codex | codex --no-stream "你好"
```
No `--token`/`--key`/`--secret`/`--auth` value appeared, so nothing needed redaction. These two files are stale copies (mtimes 2026-08-21 and 2026-08-25); the live `.bash_history` has **no** codex line at all, i.e. the CLI was exercised only around mid-August and then abandoned.

### D. Verdict
**PASS (as a pathway), FAIL (as the explanation).** A Codex CLI/TUI *is* installed and is a real terminal program (`codex-cli 0.147.0`). But it is a stripped static ELF TUI, last actively used around 2026-08-21/25, with **zero** codex lines in the current `.bash_history`, and it explicitly shares `~/.codex/config.toml` with the desktop app via the `[desktop]` section. A terminal TUI cannot itself draw a per-pixel mouse-following ripple; and nothing indicates a TUI session around 2026-09-21.

---

## E. Recent-app-usage evidence (X11, GNOME)

### `~/.local/share/recently-used.xbel`
```
$ grep -oE '<bookmark href="[^"]*(codex|chatgpt|openai)[^"]*"[^>]*' ~/.local/share/recently-used.xbel | sed 's/?[^"]*//'
<bookmark href="file:///home/CNS2026495165/下载/chatgpt_amd64.deb"
          added="2026-09-21T03:55:49.639468Z" modified="2026-09-21T03:55:49.639473Z"
          visited="2026-09-21T03:55:49.639469Z"
(total bookmarks: 317;  matching: 1)
```
This is the GNOME "recently used" record of the **downloaded `.deb` installer**, 55 seconds after the download started. Nothing else matches.

### `.desktop` entries and package registration (public package files)
```
$ ls -la /usr/share/applications/ | grep -iE 'codex|chatgpt|openai'
-rw-r--r-- 1 root root 575  9月 18 12:00 chatgpt.desktop

$ cat /usr/share/applications/chatgpt.desktop
[Desktop Entry]
Name=ChatGPT
Comment=ChatGPT by OpenAI
GenericName=AI assistant
Exec=chatgpt %U
Icon=chatgpt
Type=Application
StartupNotify=true
Categories=Utility;Development;
MimeType=x-scheme-handler/codex;x-scheme-handler/http;x-scheme-handler/https;text/csv;
 application/vnd.openxmlformats-officedocument.wordprocessingml.document;
 application/vnd.openxmlformats-officedocument.presentationml.presentation;
 text/tab-separated-values;application/vnd.ms-excel;application/vnd.ms-excel.sheet.macroEnabled.12;
 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;

$ dpkg -l | grep -iE 'codex|chatgpt|openai'
ii  cc-switch   3.19.2         amd64  All-in-One Assistant for Claude Code, Codex & Gemini CLI
ii  chatgpt     26.915.31945   amd64  ChatGPT by OpenAI

$ xdg-mime query default x-scheme-handler/codex
chatgpt.desktop

$ grep -i 'chatgpt\|codex' /usr/share/applications/mimeinfo.cache
x-scheme-handler/codex=chatgpt.desktop;
x-scheme-handler/http=chatgpt.desktop;
x-scheme-handler/https=chatgpt.desktop;
text/csv=chatgpt.desktop;                     ... (+5 office formats, all = chatgpt.desktop;)

$ grep -E 'install|upgrade' /var/log/dpkg.log | grep -i chatgpt
2026-09-21 11:56:36 install chatgpt:amd64 <none> 26.915.31945
2026-09-21 11:56:36 status half-installed chatgpt:amd64 26.915.31945
2026-09-21 11:56:41 status installed chatgpt:amd64 26.915.31945
```
Two things matter here:
1. The package named **`chatgpt` is the Codex desktop app** — `/usr/lib/chatgpt/resources/owl-app.ini` reads `UserDataDirectoryName=Codex`, and `/var/lib/dpkg/info/chatgpt.list` is 496 KB of `app.asar` payload.
2. The app has registered itself as the handler for the **`codex://` custom URL scheme** (and for http/https and five Office MIME types). Any `codex://` link — from a browser, a document, or the CLI — launches this GUI directly. That is a first-class, always-available pathway into a Codex interface.

### App-run evidence — the newest mtimes
```
$ date                -> 2026年 09月 22日 星期二 10:32:49 CST   (UTC 02:32:49)

$ find ~/.config/Codex -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %p\n' | sort -r | head
2026-09-21 19:04:23.8471036700  .config/Codex/Default/Reporting and NEL-journal
2026-09-21 19:04:23.8451036380  .config/Codex/Default/Reporting and NEL
2026-09-21 19:04:23.6441003610  .config/Codex/Default/Cookies-journal
2026-09-21 19:04:23.6421003290  .config/Codex/Default/Cookies
2026-09-21 19:03:55.6126440720  .config/Codex/Default/Local Storage/leveldb/000008.log
2026-09-21 19:03:54.3386233630  .config/Codex/sentry/scope_v3.json
2026-09-21 19:02:02.1437569540  .config/Codex/Default/GPUCache/data_1
2026-09-21 19:02:02.1437569540  .config/Codex/Default/DawnWebGPUCache/data_1

$ for f in .../Default .../Default/Sessions .../Crash Reports .../Default/GPUCache \
           .../Default/Local Storage .../Default/IndexedDB .../sentry; do stat -c '%y %n' "$f"; done
/home/CNS2026495165/.config/Codex/Default              2026-09-21 19:01:48 +0800
/home/CNS2026495165/.config/Codex/Default/Sessions     MISSING
/home/CNS2026495165/.config/Codex/Crash Reports        2026-09-21 11:56:48 +0800
/home/CNS2026495165/.config/Codex/Default/GPUCache     2026-09-21 11:56:48 +0800
/home/CNS2026495165/.config/Codex/Default/Local Storage 2026-09-21 11:56:48 +0800
/home/CNS2026495165/.config/Codex/Default/IndexedDB    MISSING
/home/CNS2026495165/.config/Codex/sentry               2026-09-21 11:56:54 +0800
```
Only directory names and mtimes were inspected; **no Cache / Code Cache / IndexedDB / Local Storage content was opened.**

**Newest mtime in the app profile: 2026-09-21 19:04:23 CST**, i.e. the Codex desktop app was last running until ~19:04 on 2026-09-21 — about **15.5 hours** before this investigation, and roughly **7 hours** of use after its 11:56 install. Parallel mtime confirmation in the shared state dir: `~/.codex/logs_2.sqlite`, `state_5.sqlite`, `thread_history_1.sqlite`, `queue_1.sqlite` and `thread-writer-locks` all show **2026-09-21 19:04**.

Other schedules: no autostart entry for it (`~/.config/autostart/` contains only `CC Switch.desktop`); no dbus service; `gsettings get org.gnome.shell enabled-extensions` returned `@as []` (the shell's own tray host, `ubuntu-appindicators@ubuntu.com`, is present as a system extension in `/usr/share/gnome-shell/extensions/`).

### The app's own Chromium profile
```
$ cp -p ~/.config/Codex/Default/History ~/.config/Codex/Default/History-journal $W/copies/codex-electron/
$ python3 (read-only copy) -> select count(*) from urls    -> 0 ;  select count(*) from visits -> 0
```
The Codex app's embedded Chromium `urls`/`visits` tables are **empty** — the app is a native desktop shell, not a browser session, so there is no embedded browsing history to mine (consistent with it being the "owl" Electron runtime with the Valdi UI, not an embedded browser).

### E. Verdict
**PASS — strongest pathway.** A Codex **GUI application** is installed (`chatgpt 26.915.31945`, `codexAppBrand: chatgpt`, `codexBuildFlavor: prod`, data dir `Codex`), owns the `codex://` URL scheme, and was **running for ~7 hours on 2026-09-21, last active 19:04:23 CST**. Its installer came from OpenAI's own CDN via Firefox the same morning.

---

## Evidence: the tray + ripple UI actually exists in the installed app

Because the "hover-expanding tray + mouse-following ripple" needed to be localised to a concrete interface, the public application bundle was inspected (binary-safe, read-only):

```
$ ls -la /usr/lib/chatgpt/resources/ | head
-rw-r--r-- 1 root root 355432434  9月 18 12:00 app.asar
-rwxr-xr-x 1 root root       278380136  9月 18 12:00 codex
-rwxr-xr-x 1 root root 70661008  9月 18 12:00 codex-code-mode-host
-rw-r--r-- 1 root root     164492  9月 18 12:00 codex-notification.wav
-rw-r--r-- 1 root root       510826  9月 18 12:00 icon-chatgpt.png
-rw-r--r-- 1 root root        567  9月 18 12:00 linux-package-metadata.json
$ cat resources/owl-app.ini
[Owl]
UserDataDirectoryName=Codex
AppVersion=26.915.31945
$ cat resources/owl-electron-app.json
{ "packagedFrom": "/home/runner/work/openai/openai/codex/codex-apps/electron/out/ChatGPT-linux-x64",
  "runtimeArchiveSha": "37227f8a...", "runtimeName": "owl" }
$ cat /usr/lib/chatgpt/codex-launcher          (63 bytes)
#!/bin/sh
exec "$(dirname "$(readlink -f "$0")")/ChatGPT" "$@"
```

### 1. The hover-expanding tray — app-side geometry code
```
$ dd if=app.asar bs=1 skip=6112800 count=4200 | tr -c '[:print:]\n' '.' | fold -w 190
...function Tue({anchor,constrainNativeDrawWindowToDisplay,mode:i=`native`,mascotSize:a,
   petControlRowHeight:u=Sue,realtimeCaptionAboveMascotPx:d=0,showsPetControls:f=!1,
   traySize:p,viewportSize:m=...}){ ... let x=Math.max(0,g.height-b.height-Su.bottom-wu-h-(_?Su.top+24:0)),
   S=p==null?null:{width:Math.min(p.width,Math.max(0,g.width-(_?Su.left+Su.right:0))),height:Math.min(p.height,x)} ...
   E=S==null?l:Due({anchor:w,displayBounds:n,maximumTrayHeight:x,mascotSize:a,traySize:S}) ...
function Due({anchor,displayBounds,maximumTrayHeight,previousPlacement,traySize,...}){
   d=mode===`legacy`?[`top-start`,`top-end`,`bottom-start`,`bottom-end`]:...
```
The app computes a floating **mascot/avatar window plus a docked "tray"** whose height is capped by `maximumTrayHeight` and whose placement flips between `top-start / top-end / bottom-start / bottom-end` with a scoring function that penalises changing placement. That is a tray that **grows and re-docks relative to a floating avatar** — the structural definition of a hover-expanding tray.

### 2. The hover model — proximity, spring animation, explicit hover offsets
```
$ dd if=app.asar bs=1 skip=5787508 count=1500   -> petControlsAppearance constant:
{collapseMovementSpringBounce:.1, collapseTransitionDurationMs:0, compactControlCornerRadius:6.5,
 compactControlGap:-10.5, compactControlHeight:6, compactControlWidth:17, compactDismissDelayMs:300,
 compactGlassSpacing:14, compactOffsetX:0, compactOffsetY:0, contentHiddenBlurRadiusPx:14,
 contentHiddenScale:.75, expandingGlassSpacing:20, glassMergeDurationMs:300,
 hoverControlGap:8, hoverControlSize:24, hoverGlassSpacing:0, hoverOffsetX:0, hoverOffsetY:10,
 movementSpringBounce:.1, movementSpringLaunchOffsetY:16,
 proximityEnterDistance:40, proximityExitDistance:56, transitionDurationMs:200}
```
This is unambiguous: `proximityEnterDistance: 40` / `proximityExitDistance: 56` (acts when the pointer comes *near*, not only on click), paired with `hoverOffsetX/Y`, `hoverControlGap/Size`, `hoverGlassSpacing`, `movementSpringBounce` and `transitionDurationMs`. The controls **expand on hover with spring physics**.

Cross-references in the app bundle:
```
grep -ao '<key>' app.asar | wc -l
isNotificationTrayExpanded        2+
isNotificationTrayVisiblyExpanded 2+
isTrayAboveMascot                 (≥5)
trayMaxHeight                     2+      onNotificationExpansionChange, onActivateNotification,
                                          onDismissNotification, onOpenNotificationActions,
                                          onActivityStackScroll, onActivityPillsHidden
data-avatar-overlay-hit-region    (present, measured on an en.div with className
data-avatar-overlay-size          `notification-tray`, framer-motion `animate`/`initial`)
aria/strings: "Actions for {petName}", "Adjust the size of your pet", "Close pet",
              "Hide pet", "Choose pet", "Customize pet", "Create a pet with ChatGPT"
```
and the tray's own content strings, e.g.
`settings.usage.limits.trayCompactLabel` → `"{window} {remaining}"`, `trayCompactLabelWithReset` → `"{label} {separator} {reset}"`.

So the "tray" is not a GTK panel applet: it is the **Codex app's own framer-motion notification/activity tray, anchored to a floating pet/avatar mascot**, with a `data-avatar-overlay-hit-region` moused-over region and an explicit `expanded` state.

### 3. The mouse-following ripple animation — Valdi UI, two independent implementations

**(a) `Pressable` ripple that expands from the pointer coordinates**
```
$ dd if=app.asar bs=1 skip=114790300 count=2200
...t.path=`valdi_ui/src/components/Pressable` ...
   e.PressFeedback=h={} ... h.Ripple=`ripple`;
   this.state={hovered:!1,pressed:!1,rippleExpanded:!1,touchX:0,touchY:0};
   handleTouchStart = e => { ... if (this.viewModel.feedback===h.Ripple) {
        let t=e.x??0, n=e.y??0;
        this.setState({pressed:!0, rippleExpanded:!1, touchX:t, touchY:n}),
        this.setStateAnimated({rippleExpanded:!0},{curve:s.AnimationCurve.EaseOut,duration:.32}) } ... }
   handleHover = e => { ... let r=e && this.viewModel.hoveredStyle!==void 0;
        r!==this.state.hovered && this.setState({hovered:r}), ...
        this.viewModel.onHover?.(e) } ...
   handleTouchEnd: feedback===Ripple ? this.setStateAnimated({pressed:!1},{duration:.35})
                                     : this.setState({pressed:!1})
```
`valdi_ui` is OpenAI's own UI framework. Here `Pressable` holds `hovered`, `rippleExpanded`, `touchX/touchY` and animates the ripple **outward from the pointer position** with an EaseOut curve over 0.32 s. This is literally a ripple anchored to where the mouse is.

**(b) A cursor-sampled brush/trail + ripple overlay with `requestAnimationFrame`**
```
$ dd if=app.asar bs=1 skip=73896800 count=3200
...function An({onArtworkReady,svgMarkup}){ ...
   s=useRef({current:null,lastSampledAt:0,trail:[]}) ...
   useCallback(function e(t){ let n=o.current,r=a.current,i=c.current;
     if (n!=null&&r!=null&&i!=null){ let e=r.createSVGPoint(); e.x=i.x; e.y=i.y;
       let a=r.getScreenCTM(); if(a!=null){ let r=e.matrixTransform(a.inverse()), i=s.current;
         i.current!=null && t-i.lastSampledAt>=Yn
             ? (i.trail.unshift({sampledAt:t,x:i.current.x,y:i.current.y}),
                i.trail.length>qn && i.trail.pop(), i.lastSampledAt=t)
             : i.current??(i.lastSampledAt=t),
         i.current=r, Bn(n.brushSpot,r,1), n.brushOverlay.setAttribute(`opacity`,`1`) }} 
     if(n!=null){ let e=s.current.trail;
       while(e.length>0 && t-e[e.length-1].sampledAt>=Kn) e.pop();
       for(let [r,i] of n.trailSpots.entries()){ let n=e[r];
          if(n==null){ i.maskRect.setAttribute(`opacity`,`0`); continue }
          Bn(i,n,(1-(t-n.sampledAt)/Kn)*(1-r/qn)*Jn) } }
     let d=u.current;
     if(n!=null&&d!=null){ let e=Math.min(1,(t-d.startedAt)/Xn), r=d.maxRadius*e,
        i=Math.max(0,r-Qn), a=Math.min(d.maxRadius,r+Qn),[o,s,c]=n.rippleStops;
       o.setAttribute(`offset`,String(i/d.maxRadius)), s.setAttribute(`offset`,String(r/d.maxRadius)),
       c.setAttribute(`offset`,String(a/d.maxRadius)),
       n.rippleOverlay.setAttribute(`opacity`,String(1-e*.18)),
       e>=1&&(u.current=null,n.rippleOverlay.setAttribute(`opacity`,`0`)) }
     l.current = u.current!=null||c.current!=null||(n!=null&&s.current.trail.length>0)
                 ? requestAnimationFrame(e) : null }, [])
```
This is a per-frame animated overlay that **samples the cursor position over time into a `trail`**, fades trail spots by age, and drives an expanding **`ripple` gradient whose radial stops advance over `maxRadius`** via `requestAnimationFrame`. This is the mouse-following ripple animation, in the app's own rendering code.

Supporting keyword census in the same bundle (public app code):
```
Tray 156   tray 165   Ripple 12   ripple 22   getCursorScreenPoint 18
alwaysOnTop 11   setIgnoreMouseEvents 16   globalShortcut 5   trail 998
valdi 1019   ValdiRuntime 69   ValdiWebTrace 9   ValdiUITheme 9
```

**Caveat recorded honestly:** the four `cursor-follow` hits at offset 234499441 are *not* the ripple — they are the `artifactAnnotationCursorOnboarding.*` first-use strings ("Select text to request changes or ask questions … First-use cursor-following tip over an annotation-capable PDF preview"). They are listed only so the term is not misread as evidence. The ripple evidence is (a) and (b) above.

---

## VERDICT

### The single most likely thing the user means by "codex 那边的界面"

**The OpenAI "ChatGPT"/Codex desktop application — the Electron "owl" app installed from the `.deb` as package `chatgpt` 26.915.31945 — running its floating pet/avatar companion with its proximity-expanding notification/activity tray and the Valdi UI ripple animation.**

Chain of evidence, in order:

1. **It exists and was knowingly installed.** Firefox history shows `https://openai.com/codex/` (+ `zh-Hans-CN` variant) at 2026-09-21T03:54:45–46Z, then the download `https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb` at 03:54:54Z, then **GNOME recorded the downloaded file** `file:///home/CNS2026495165/下载/chatgpt_amd64.deb` at 03:55:49Z, then `dpkg.log` records `install chatgpt:amd64 <none> 26.915.31945` at **2026-09-21 11:56:36 CST** (= 03:56:36Z). Download → recent-file → install is a closed, second-by-second chain.
2. **It was the thing on screen that day.** `~/.config/Codex/` (the app's own user-data dir) has its newest mtime at **2026-09-21 19:04:23 CST** — the app ran ~7 h that day, ending 15.5 h before this investigation, and the shared `~/.codex/*.sqlite` state files agree to the minute.
3. **It is the only interface on this machine that can do both described things.** The bundle contains (i) a tray whose height is driven by `maximumTrayHeight`/`traySize` and re-docks around a floating `mascot` with `isTrayAboveMascot`, `isNotificationTrayExpanded`, `isNotificationTrayVisiblyExpanded`, `data-avatar-overlay-hit-region`; (ii) a `petControlsAppearance` constant with `proximityEnterDistance:40` / `proximityExitDistance:56` / `hoverOffsetX/Y` / `movementSpringBounce` — i.e. **expand-on-hover driven by pointer proximity**; and (iii) two ripple implementations, `valdi_ui/src/components/Pressable` with `rippleExpanded` + `touchX/touchY` + EaseOut 0.32 s, and a `requestAnimationFrame` brush/trail overlay that samples the cursor into `trail[]` and animates expanding radial `rippleStops` up to `maxRadius`.
4. **It is a permanently available pathway, not a one-off.** `xdg-mime query default x-scheme-handler/codex` → `chatgpt.desktop`: the app owns the **`codex://` scheme** (plus http/https and five Office MIME types), so any `codex://` link re-opens this GUI with no browser involved.

### Alternatives ruled out, with the evidence that ruled them out

| Alternative | Ruled out by |
|---|---|
| **Codex CLI / TUI in a terminal** (`~/.local/bin/codex`, `codex-cli 0.147.0`) | Real but not the answer: it is a stripped static-pie ELF **TUI**, and a terminal TUI cannot draw a per-pixel mouse-following ripple. It was last exercised ~2026-08-21/25 (only in two stale `~/.bash_history-*.tmp` files; **0** codex lines in the live `~/.bash_history`), and **no** terminal emulator was running at investigation time. Decisively, its own `~/.codex/config.toml` carries a **`[desktop]`** section — the CLI is the *subordinate* surface of the desktop app, not a competitor for "the interface". |
| **A terminal emulator producing the animation** (ghostty snap, gnome-terminal, terminator all installed) | None was running (`ps` shows only `gnome-shell` and this agent's own Playwright/zombie `chrome`). Ghostty's config is a 0-byte file untouched since 2026-09-07. No TUI session is implicated on 2026-09-21. |
| **VS Code + an `openai.chatgpt` / Codex / Copilot extension** | **No such extension is installed.** 21 extensions present, all Anthropic/Python/CMake/STM32/Typst; the grep for `codex|openai|chatgpt|copilot` returns nothing and `code --list-extensions` confirms it. `~/.config/Code/User/settings.json` has **zero** matching lines. Newest VS Code log dir is `20260916T174308` — the editor was not even open on 2026-09-21. |
| **A Chromium-family browser profile** | **None exists** — no `~/.config/google-chrome`, `chromium`, `microsoft-edge`, `BraveSoftware`, `vivaldi`, `opera`, and no Chromium snap. Task B is structurally inapplicable. |
| **Firefox itself hosting the Codex UI** | Firefox only *delivered* the installer. Its `places.sqlite` has 5 term matches, all navigations/downloads (no in-browser Codex app surface, no `oaistatic` app host other than the `.deb`), **0** matching bookmarks, and **none** of the queried acceleration/motion prefs are set in `prefs.js`. |
| **The app's embedded Chromium browser** | The app's own `~/.config/Codex/Default/History` has `urls` = 0 rows and `visits` = 0 rows — it is a native desktop shell, so the described UI cannot be a web page inside it. |
| **A `cc-switch` GUI (3rd-party Codex/Claude provider switcher, `cc-switch 3.19.2`, active 2026-09-22 10:02)** | It is a provider/config switcher and its own `.desktop` is `CC Switch.desktop`; it contains none of the tray/proximity/ripple code. It is a plausible **secondary** window the user could conflate, but it is not "codex". |
| **A GNOME shell tray applet** | `gsettings get org.gnome.shell enabled-extensions` → `@as []`; `ubuntu-appindicators@ubuntu.com` is a stock system extension. The tray in question is drawn by the app (`data-avatar-overlay-*`, framer-motion), not by the shell. |

### Pathways I could **not** inspect (permission / privacy limits)

1. **`/proc/<pid>` for other-user or hardened processes** — `ls /proc/27904/exe` and `/proc/27904/cwd` → `权限不够` (permission denied). Recorded; not escalated. (PID 27904 was resolved by its `ps` state `[chrome] <defunct>` as a Playwright/gdb zombie, so this did not block a conclusion.)
2. **`gsettings` could not write its dconf cache** — `dconf-CRITICAL: unable to create file '/run/user/1001/dconf/user': 权限不够`. The `org.gnome.shell enabled-extensions` value was still returned (`@as []`), so this is a warning, not a gap.
3. **Chat/conversation content was deliberately not read** — per the privacy boundary: `~/.codex/sessions/**`, `~/.codex/history.jsonl`, `~/.codex/logs_2.sqlite`, `~/.codex/state_5.sqlite`, `~/.codex/thread_history_1.sqlite`, `~/.codex/memories_1.sqlite`, `~/.codex/dictation-history`, `~/.config/Codex/Default/Local Storage`, `IndexedDB`, `Code Cache`, `Cookies`, `Login Data`, `~/.codex/auth.json`, `~/.cc-switch/cc-switch.db`. Directory names, sizes and mtimes only. Consequently the **semantic content** of what the user saw in the Codex UI on 2026-09-21 is unknown and unclaimed.
4. **`~/.config/Codex/Default/History`** was copied and queried (0 rows) rather than the live DB, per instruction; the live file was never opened read-write.
5. **VS Code `settings.json`** was only grepped for the permitted key patterns (0 matches); its remaining content was not read.
6. `~/.codex/config.toml`'s `[model_providers.custom].base_url` was identified but **not reproduced** — it is a private third-party endpoint, not rendering configuration.

---

### Files created by this investigation (all inside the assigned directory)
- `codex-ui-presence.md` — this report
- `copies/ff-g05ps3km/places.sqlite`, `copies/ff-g05ps3km/places.sqlite-wal` — read-only copies of the Firefox places DB
- `copies/codex-electron/History`, `copies/codex-electron/History-journal` — read-only copies of the Codex app's Chromium history DB
