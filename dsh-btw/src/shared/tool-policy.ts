/**
 * Tool policy for btw side conversations.
 *
 * Two layers, mirroring the upstream design:
 * - `READ_ONLY_TOOL_CANDIDATES`: the visible read-only allow-list intersected
 *   with the parent agent's actually-registered tools at child creation time.
 * - `READ_ONLY_TOOL_SET`: the execution-guard layer; everything not in this
 *   set is denied with {@link READ_ONLY_DENIAL}.
 *
 * `btw_ask_user` is the plugin's own ask-back channel (U7): it is registered
 * inside the child's scoped world, so it is NOT a global tool and therefore
 * never appears in `READ_ONLY_TOOL_CANDIDATES` (whose members are validated
 * against the parent's global tool registry). It must still pass the
 * execution guard, so it joins the guard set here. The built-in
 * `ask_user_question` stays OUT on purpose: it is double-blocked for a
 * delegated child (DELEGATED_CALLER guard in dsh-user-questions plus the
 * hidden child session having no client answer scope), which is exactly why
 * btw ships its own channel.
 */
export const READ_ONLY_TOOL_CANDIDATES = Object.freeze([
  // 2026-09-18: `analyze_image` joins `read_image`. The vision tool is
  // read-only (it reads an attachment and asks the vision model about it), and
  // without it a side chat whose own model cannot see images had no fallback at
  // all, while the main conversation always had one. Candidates are still
  // intersected with the parent's registered tools, so this only adds the tool
  // where the deployment actually exposes it.
  'read', 'read_image', 'analyze_image', 'glob', 'grep', 'lsp', 'view_image', 'web_search', 'skill',
  'session_event_read', 'session_event_search', 'session_event_trace', 'session_search', 'session_trace',
  'job_list', 'job_output', 'terminal_list', 'terminal_read', 'list_agents', 'get_goal',
  'mnemon_document_search', 'mnemon_memory_bodies', 'mnemon_recall', 'mnemon_related', 'mnemon_status',
] as const)

export const READ_ONLY_TOOL_SET: ReadonlySet<string> = Object.freeze(new Set<string>([
  ...READ_ONLY_TOOL_CANDIDATES,
  'run_code',
  'btw_ask_user',
]))

export function isSideChatToolAllowed(name: string): boolean {
  return READ_ONLY_TOOL_SET.has(name)
}

export const READ_ONLY_DENIAL = 'btw is read-only. This tool could change external state, files, sessions, or processes. Answer using inherited context, read-only inspection, or the btw_ask_user tool instead.'
