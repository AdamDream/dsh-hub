import { describe, expect, it } from 'vitest'
import { isSideChatToolAllowed, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET } from '../src/shared/tool-policy.ts'

describe('btw tool policy', () => {
  it.each(['read', 'glob', 'grep', 'web_search', 'run_code'])('allows read capability %s', name => {
    expect(isSideChatToolAllowed(name)).toBe(true)
  })

  it('allows the plugin-owned ask-back channel btw_ask_user', () => {
    expect(isSideChatToolAllowed('btw_ask_user')).toBe(true)
    expect(READ_ONLY_TOOL_SET.has('btw_ask_user')).toBe(true)
  })

  it.each(['write', 'edit', 'bash', 'ssh_exec', 'subagent', 'mnemon_remember', 'ask_user_question'])('denies mutating or blocked interactive capability %s', name => {
    expect(isSideChatToolAllowed(name)).toBe(false)
  })

  it('keeps btw_ask_user out of the global visible candidates (it is a scoped registration)', () => {
    expect(READ_ONLY_TOOL_CANDIDATES).not.toContain('btw_ask_user')
  })

  it('has no duplicate candidate names', () => {
    expect(new Set(READ_ONLY_TOOL_CANDIDATES).size).toBe(READ_ONLY_TOOL_CANDIDATES.length)
  })
})
