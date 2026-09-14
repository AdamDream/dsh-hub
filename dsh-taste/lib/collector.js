/** Deterministic provenance-aware visible-text collection for taste learning. */
const CLIP_MARKER = "[...clipped...]";
const AUTOMATION = new Set(["plugin","tool","system","runtime-context","agent","rpc","subagent","automation","inbox","spliced"]);
const MODELS = new Set(["assistant","model","llm"]);
const plain = (x) => x && typeof x === "object" && !Array.isArray(x);
function sourceKind(data) {
 if (!Object.prototype.hasOwnProperty.call(data,"source")) {
  // Nested assistant envelope (design §8.1: assistant body lives in
  // data.message) carries its provenance inside the message record.
  if (plain(data.message) && Object.prototype.hasOwnProperty.call(data.message,"source")) {
   const m=data.message.source;
   if (typeof m === "string") return {present:true,kind:m};
   if (plain(m) && typeof m.kind === "string") return {present:true,kind:m.kind};
   return {present:true,kind:null};
  }
  return {present:false};
 }
 const s=data.source;
 if (typeof s === "string") return {present:true, kind:s};
 if (plain(s) && typeof s.kind === "string") return {present:true,kind:s.kind};
 return {present:true,kind:null};
}
function embeddedAutomation(value) {
 if (!value) return false;
 if (Array.isArray(value)) return value.some(embeddedAutomation);
 if (!plain(value)) return false;
 if (typeof value.type === "string" && (value.type === "agent/inbox" || value.type === "agent/inbox/spliced" || value.type.startsWith("tool/") || value.type.startsWith("rpc/") || value.type === "system" || value.type === "runtime-context")) return true;
 if (plain(value.source) && (typeof value.source.kind !== "string" || AUTOMATION.has(value.source.kind))) return true;
 return Object.values(value).some((v)=>plain(v)||Array.isArray(v) ? embeddedAutomation(v) : false);
}
export function classifyEventForTaste(event) {
 if (!plain(event)||!plain(event.data)||typeof event.type!=="string"||(event.type!=="user/message"&&event.type!=="assistant/message")) return {kind:"reject",reason:"event-shape-or-type"};
 const data=event.data, src=sourceKind(data);
 if (src.present && (typeof src.kind!=="string" || AUTOMATION.has(src.kind))) return {kind:"reject",reason:"unknown-or-automated-source"};
 const user=event.type==="user/message";
 if (data.role!==undefined && data.role!==(user?"user":"assistant")) return {kind:"reject",reason:"role-mismatch"};
 if (user) { if (src.present && src.kind!=="user") return {kind:"reject",reason:"unknown-or-automated-source"}; }
 else if (!src.present || !MODELS.has(src.kind)) return {kind:"reject",reason:"unknown-or-automated-source"};
 if (user && (embeddedAutomation(data.message)||embeddedAutomation(data.source))) return {kind:"reject",reason:"embedded-automation-record"};
 const content = !user && Object.prototype.hasOwnProperty.call(data,"message") ? data.message?.content : data.content;
 if (!Array.isArray(content)) return {kind:"reject",reason:"content-shape"};
 if (!content.some((b)=>b?.type==="text"&&typeof b.text==="string"&&b.text.trim())) return {kind:"reject",reason:"no-visible-text"};
 return {kind:user?"user-primary":"assistant-secondary",reason:user?"user-message":"assistant-message"};
}
export function isLearnableUserEvent(event){return classifyEventForTaste(event).kind==="user-primary";}
function turnSlice(events,turn){if(!Array.isArray(events)||!Number.isFinite(turn))return [];for(let i=events.length-1;i>=0;i--)if(events[i]?.type==="turn/start"&&events[i].data?.turn===turn)return events.slice(i+1);return [];}
function parts(content){return content.filter((b)=>b?.type==="text"&&typeof b.text==="string"&&b.text.trim()).map((b)=>b.text);}
function clip(v,n){if(typeof n!=="number"||!Number.isFinite(n)||n<0||v.length<=n)return v;if(n<64)return v.slice(0,Math.floor(n));const h=Math.floor(n*.35),t=n-h-(CLIP_MARKER.length+2);return `${v.slice(0,h)}\n${CLIP_MARKER}\n${v.slice(-t)}`;}
export function collectTurnEvidence(events,turn,opts={}){const user=[],assistant=[];for(const e of turnSlice(events,turn)){const c=classifyEventForTaste(e);if(c.kind==="reject")continue;const p=parts((e.type==="assistant/message"&&Object.prototype.hasOwnProperty.call(e.data,"message"))?e.data.message.content:e.data.content);if(!p.length)continue;const text=clip(typeof opts.redactFn==="function"?opts.redactFn(p.join("\n")):p.join("\n"),c.kind==="user-primary"?opts.userMaxChars:opts.assistantMaxChars);if(text)(c.kind==="user-primary"?user:assistant).push({role:c.kind==="user-primary"?"user":"assistant",provenance:c.kind,text});}return {user,assistant};}
export function collectTurnTexts(events,turn,opts={}){const e=collectTurnEvidence(events,turn,opts);return {userText:e.user.map(x=>x.text).join("\n"),assistantText:e.assistant.map(x=>x.text).join("\n")};}
