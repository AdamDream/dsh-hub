// 2026-09-14 btw-ui: running-banner theme regression guard. The banner used to
// copy the official TurnStatus DeepSeek-blue gradient
// (--dsw-static-deepseek-500/200); the re-theme moves it to the side-chat lime
// (#b7e85b family) while keeping the shimmer mechanics. This spec asserts the
// actual CSS source (side-chat.module.css), because class-name identity alone
// cannot prove the color tokens.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const cssPath = new URL('../src/client/side-chat.module.css', import.meta.url)

function ruleOf(css: string, selector: string): string {
  const match = new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, 'u').exec(css)
  if (match === null) throw new Error(`rule .${selector} not found in side-chat.module.css`)
  return match[0]
}

describe('running banner theme (2026-09-14 btw-ui)', () => {
  it('borders the banner chip with the side-chat lime instead of DeepSeek blue', async () => {
    const css = await readFile(cssPath, 'utf8')
    const banner = ruleOf(css, 'runningBanner')
    expect(banner).toContain('#b7e85b')
    expect(banner).not.toContain('--dsw-static-deepseek')
  })

  it('shimmers the banner text in the lime family and keeps the mechanics', async () => {
    const css = await readFile(cssPath, 'utf8')
    const text = ruleOf(css, 'runningBannerText')
    expect(text).toContain('#b7e85b')
    expect(text).not.toContain('--dsw-static-deepseek')
    // shimmer mechanics stay: gradient text clipped over a transparent color.
    expect(text).toContain('background-clip: text')
    expect(text).toContain('background-size: 250% 100%')
    expect(text).toContain('animation:')
  })

  it('no longer references the official DeepSeek blue token in the banner rules', async () => {
    const css = await readFile(cssPath, 'utf8')
    const bannerZone = css.slice(css.indexOf('/* Running banner'), css.indexOf('/* Layer B ToolRow'))
    expect(bannerZone).not.toContain('--dsw-static-deepseek')
  })
})
