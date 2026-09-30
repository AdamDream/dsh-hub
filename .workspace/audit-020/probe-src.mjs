const mods = ['@local/dsh-btw','@local/dsh-logfile','@local/dsh-pptmaster','@local/dsh-ssh-gui',
 '@local/dsh-subagent-model','@local/dsh-usage','@local/dsh-wallpaper','@local/dsh-web-search-sse',
 '@local/dsh-workerspace','@deepseek-ai/dsh-taste','@deepseek-ai/dsh-session-board',
 '@deepseek-ai/dsh-vision-adam','dsh-workspace-enhancement'];
for (const m of mods) {
  try { await import(m); console.log('OK    ' + m); }
  catch (e) { console.log('FAIL  ' + m.padEnd(38) + String(e&&e.message||e).replace(/\s+/g,' ').slice(0,105)); }
}
