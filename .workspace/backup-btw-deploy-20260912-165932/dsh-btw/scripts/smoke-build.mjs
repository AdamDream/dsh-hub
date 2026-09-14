import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const hostSource = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.equal(hostSource.includes('@Remote('), false)
assert.equal(/require\((['"])zod\1\)/u.test(clientSource), false)
assert.equal(clientSource.includes('require("@deepseek-ai/dsh-workspace")'), false)
assert.equal(clientSource.includes('dsh-side-chat'), false)

const host = await import('../lib/index.js')
const typert = await import('../lib/typert.host.js')
const remote = await import('../lib/typert.remote-client.js')
assert.equal(host.name, 'dsh-btw')
assert.equal(typert.TYPERT.package, '@local/dsh-btw')
assert.equal(typert.TYPERT.invocations.length, 6)
assert.equal(typert.TYPERT.invocations.map(item => item.method).includes('answer'), true)
assert.equal(remote.TYPERT_REMOTE.package, '@local/dsh-btw')
assert.equal(remote.TYPERT_REMOTE.descriptors.length, 6)
assert.equal(host.isSideChatToolAllowed('btw_ask_user'), true)
assert.equal(host.isSideChatToolAllowed('ask_user_question'), false)
console.log('smoke ok: @local/dsh-btw build artifacts consistent')
