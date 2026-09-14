import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sideChatRemoteDescriptors } from '../src/remote-descriptors.ts'

describe('package contract', () => {
  it('publishes all Typert remotes', () => {
    expect(sideChatRemoteDescriptors.map(item => item.method)).toEqual([
      'start', 'read', 'send', 'answer', 'cancel', 'close', 'setModel', 'readImage', 'listTree', 'listProject',
    ])
    expect(new Set(sideChatRemoteDescriptors.map(item => item.id)).size).toBe(10)
    expect(sideChatRemoteDescriptors.every(item => item.id.startsWith('@local/dsh-btw#'))).toBe(true)
  })

  it('keeps the shared overlay root click-through without z-index competition', async () => {
    const css = await readFile(new URL('../src/client/side-chat.module.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.placementRoot\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/s)
    expect(css).toMatch(/\.drawer\s*\{[^}]*position: absolute;[^}]*var\(--side-chat-left\)[^}]*pointer-events: auto;/s)
    expect(css).not.toMatch(/z-index:\s*(?:79|80|9999)/)
    expect(css).not.toMatch(/\.drawer\s*\{[^}]*position: fixed;/s)
    expect(css).toContain('env(safe-area-inset-top')
    expect(css).toContain('env(safe-area-inset-right')
    expect(css).toContain('env(safe-area-inset-bottom')
    expect(css).toContain('env(safe-area-inset-left')
    expect(css).toMatch(/\.mobileScrim\s*\{[^}]*inset: 0;/s)
  })

  it('declares a web client and publishable artifacts', async () => {
    const json = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: string
      dsh?: { client?: { platform?: string } }
      files?: string[]
      exports?: Record<string, unknown>
      peerDependencies?: Record<string, string>
    }
    expect(json.name).toBe('@local/dsh-btw')
    expect(json.dsh?.client?.platform).toBe('web')
    expect(json.files).toContain('docs')
    expect(json.files).toContain('SECURITY.md')
    expect(json.exports).toHaveProperty('./client')
    expect(json.exports).toHaveProperty('./typert')
    for (const [name, range] of Object.entries(json.peerDependencies ?? {})) {
      if (name === '@deepseek-ai/cordis' || name === 'react') continue
      expect(range).toBe('>=0.1.1-rc.2 <0.2.0')
    }
    expect(json.peerDependencies).not.toHaveProperty('dsh-better-sidebar')
  })
})
