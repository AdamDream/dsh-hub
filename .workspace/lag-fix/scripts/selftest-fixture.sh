#!/usr/bin/env bash
# selftest-fixture.sh — end-to-end test of the B2 cleanup engine against a
# synthetic scaffold.  It NEVER touches the real ~/.dsh: everything lives in
# a temp dir and is wired in through DSH_HOME / SESSIONS_ROOT / WORKSPACE_DIR.
#
# Verifies: window filter, origin filter, parent exception, lock skip,
# backup gating, real deletion, and rollback.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

T="$(mktemp -d /tmp/b2-selftest-XXXXXX)"
export DSH_HOME="$T/dsh"
export SESSIONS_ROOT="$T/dsh/sessions"
export WORKSPACE_DIR="$T/ws"
mkdir -p "$SESSIONS_ROOT/--ws-A--" "$SESSIONS_ROOT/--ws-B--" \
         "$DSH_HOME/storages/usage" "$DSH_HOME/storages/session_projcache/sessions" \
         "$WORKSPACE_DIR/reports" "$WORKSPACE_DIR/scripts" "$WORKSPACE_DIR/backup"
cp "$HERE/cleanup-core.mjs" "$HERE/cleanup-sessions.sh" "$WORKSPACE_DIR/scripts/"

mk() { # mk <slug> <id> <createdAtMs> <origin|-> <parent|->
  local slug="$1" id="$2" ca="$3" origin="$4" parent="$5" d="$SESSIONS_ROOT/$1/$2"
  mkdir -p "$d"
  local o="" p=""
  [ "$origin" != "-" ] && o=",\"origin\":\"$origin\",\"delegationDepth\":1"
  [ "$parent" != "-" ] && p=",\"parentSession\":\"$parent\""
  printf '{"type":"session","version":0,"id":"%s","createdAt":%s,"cwd":"/home/x","agentPreset":"standard-glm"%s%s}\n{"type":"turn/start"}\n' \
    "$id" "$ca" "$p" "$o" > "$d/raw.jsonl"
  zstd -q -f "$d/raw.jsonl" -o "$d/session.jsonl.zstd" >/dev/null 2>&1
  rm -f "$d/raw.jsonl"
  touch -d "@$((ca/1000))" "$d/session.jsonl.zstd"
}

OLD=$(( $(date +%s000) - 30*86400000 ))      # 30 天前
REC=$(( $(date +%s000) - 1*86400000 ))       # 1 天前

# A: old subagent whose (old) top-level parent is on disk  -> MUST BE DELETED
mk "--ws-A--" "session-topA"     "$OLD" "-"        "-"
mk "--ws-A--" "sub-oldA1"        "$OLD" "subagent" "session-topA"
mk "--ws-A--" "sub-oldA2"        "$OLD" "subagent" "session-topA"
# B: old subagent whose top-level parent is RECENT       -> MUST BE KEPT
mk "--ws-B--" "session-topB"     "$REC" "-"        "-"
mk "--ws-B--" "sub-oldB1"        "$OLD" "subagent" "session-topB"
# C: recent subagent                                     -> MUST BE KEPT
mk "--ws-B--" "sub-recC1"        "$REC" "subagent" "session-topB"
# D: old subagent with NO parent pointer                 -> MUST BE KEPT (unverifiable)
mk "--ws-A--" "sub-noParentD1"   "$OLD" "subagent" "-"
# E: old subagent with a session.lock                    -> MUST BE KEPT
mk "--ws-A--" "sub-lockedE1"     "$OLD" "subagent" "session-topA"
touch "$SESSIONS_ROOT/--ws-A--/sub-lockedE1/session.lock"
# F: old TOP-LEVEL session                               -> MUST BE KEPT
mk "--ws-A--" "session-oldF1"    "$OLD" "-"        "-"

# projcache: one row per session, plus one row for a session that is gone
node -e '
const fs=require("fs");
const root=process.env.SESSIONS_ROOT, out=process.env.DSH_HOME+"/storages/session_projcache.json";
const ids=[];
for(const slug of fs.readdirSync(root)) for(const id of fs.readdirSync(root+"/"+slug)) ids.push(id);
const sessions={};
for(const id of ids) sessions[id]={identity:{createdAt:1,cwd:"/home/x"},rows:{sessionListMetadata:{ver:1,seq:1,val:{blank:false,lastPromptAt:1}}}};
sessions["ghost-row-no-dir"]={identity:{createdAt:1,cwd:"/home/x"},rows:{sessionListMetadata:{ver:1,seq:1,val:{blank:false,lastPromptAt:1}}}};
fs.writeFileSync(out,JSON.stringify({unit:{name:"session_projcache",version:3},global:null,tables:{sessions}}));
console.log("projcache rows:",Object.keys(sessions).length);
'
# legacy projcache leftovers
for i in 1 2 3; do printf '{"version":7,"record":{}}\n' > "$DSH_HOME/storages/session_projcache/sessions/legacy$i.json"; done
# usage.db with sync_state rows (2 for live sessions, 1 for a missing file)
node -e '
const {DatabaseSync}=require("node:sqlite");
const p=process.env.DSH_HOME+"/storages/usage/usage.db";
const db=new DatabaseSync(p);
db.exec("CREATE TABLE sync_state (source TEXT PRIMARY KEY, mtime INTEGER, size INTEGER, fingerprint TEXT, last_seq INTEGER, last_offset INTEGER) STRICT");
db.exec("CREATE TABLE usage_events (id INTEGER PRIMARY KEY, data_source TEXT NOT NULL, session_id TEXT NOT NULL, dedup_key TEXT NOT NULL, ts INTEGER NOT NULL, model TEXT, provider TEXT, project TEXT, turn INTEGER, step INTEGER, is_subagent INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL)");
const ins=db.prepare("insert into sync_state(source,mtime,size,fingerprint,last_seq,last_offset) values(?,?,?,?,?,?)");
ins.run("dsh:"+process.env.SESSIONS_ROOT+"/--ws-A--/session-topA/session.jsonl.zstd",1,1,null,1,1);
ins.run("dsh:"+process.env.SESSIONS_ROOT+"/--ws-A--/sub-oldA1/session.jsonl.zstd",1,1,null,1,1);
ins.run("dsh:"+process.env.SESSIONS_ROOT+"/--ws-A--/gone-file/session.jsonl.zstd",1,1,null,1,1);
ins.run("cc:/home/x/.claude/whatever.jsonl",1,1,null,1,1);
db.close(); console.log("sync_state rows: 4");
'
cp "$DSH_HOME/storages/session_projcache.json" "$DSH_HOME/storages/workspace.json"

echo "==================== fixture built at $T ===================="
echo "--- expect: deletable = sub-oldA1, sub-oldA2 (2 dirs) ---"
bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --dry-run --days 7
node -e '
const r=require(process.env.WORKSPACE_DIR+"/reports/cleanup-dry-run.json");
console.log("deletable:",r.counts.deletableSessions, r.deletableSessions.map(d=>d.id).sort().join(","));
console.log("exclusions:",JSON.stringify(Object.fromEntries(Object.entries(r.exclusionsByReason).map(([k,v])=>[k,v.sessions]))));
console.log("orphans a/b/c:",r.counts.projCacheOrphans,r.counts.syncStateTrulyDanglingNow,r.counts.legacyCacheFiles);
'
echo "--- expect: apply REFUSES without a backup ---"
set +e
GATE_OUT="$(bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --apply --phase 1 2>&1)"
GATE_RC=$?
set -e
printf '%s\n' "$GATE_OUT" | grep -E 'ERROR|refuses' || printf '%s\n' "$GATE_OUT" | head -2
if [ "$GATE_RC" != "0" ] && printf '%s' "$GATE_OUT" | grep -q 'refuses to run without a backup'; then
  echo "PASS: apply gated without backup (rc=$GATE_RC)"
else
  echo "FAIL: not gated (rc=$GATE_RC)"; exit 1
fi
echo "--- backup ---"
bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --backup --days 7
echo "--- count before apply (9 dirs): $(find "$SESSIONS_ROOT" -mindepth 2 -maxdepth 2 -type d | wc -l) ---"
echo "--- apply phase 1 ---"
bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --apply --phase 1 --days 7
echo "--- count after apply: $(find "$SESSIONS_ROOT" -mindepth 2 -maxdepth 2 -type d | wc -l) (expect 7: 9 total dirs, 2 deleted) ---"
find "$SESSIONS_ROOT" -mindepth 2 -maxdepth 2 -type d -printf '%f\n' | sort | sed 's/^/   /'
echo "--- legacy files after apply: $(find "$DSH_HOME/storages/session_projcache" -type f | wc -l) (expect 0) ---"
echo "--- apply phase 2 (simulating post-restart) ---"
bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --apply --phase 2 --days 7
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.env.DSH_HOME+"/storages/session_projcache.json","utf8"));
console.log("projcache rows after phase2:",Object.keys(j.tables.sessions).length,"(expect 7: 10 rows - 3 ids no longer on disk)");
console.log("ids:",Object.keys(j.tables.sessions).sort().join(","));
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.env.DSH_HOME+"/storages/usage/usage.db",{readOnly:true});
console.log("sync_state after phase2:",db.prepare("select count(*) c from sync_state").get().c,"(expect 2)");
console.log("remaining sources:",db.prepare("select source from sync_state").all().map(r=>r.source.split("/").slice(-2)[0]).join(","));
db.close();
'
echo "--- rollback ---"
BK="$(ls -d "$WORKSPACE_DIR"/backup/*/ | tail -1)"
bash "$WORKSPACE_DIR/scripts/cleanup-sessions.sh" --rollback --backup-dir "${BK%/}"
echo "--- count after rollback: $(find "$SESSIONS_ROOT" -mindepth 2 -maxdepth 2 -type d | wc -l) (expect 9: restored) ---"
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.env.DSH_HOME+"/storages/session_projcache.json","utf8"));
console.log("projcache rows after rollback:",Object.keys(j.tables.sessions).length,"(expect 10 = byte-identical restore)");
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.env.DSH_HOME+"/storages/usage/usage.db",{readOnly:true});
console.log("sync_state after rollback:",db.prepare("select count(*) c from sync_state").get().c,"(expect 4)");
db.close();
'
echo "==================== selftest done: $T ===================="
