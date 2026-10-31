import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttachVerifier } from '../assets/qq-attach-guard.mjs'
const proc = { pid: 123, account: { uin: 'bot-fixture' } }
function fixture(overrides = {}) {
  const calls = []
  const settings = { alive: () => true, sleep: async () => {}, attempts: 2,
    api: async (path) => { calls.push(path); return path.endsWith('/load') ? { success: true, process: { status: 'available' } } : { list: [{ ...proc, status: 'connecting' }] } }, ...overrides }
  return { calls, guard: createAttachVerifier(settings) }
}
test('unknown or wrong identity cannot trigger loading', async () => {
  const { calls, guard } = fixture()
  assert.equal((await guard({ pid: 123 }, 'bot-fixture', true)).ok, false)
  assert.equal((await guard(proc, 'other')).ok, false)
  assert.equal(calls.length, 0)
})
test('known bad native release is blocked before loading', async () => {
  const { calls, guard } = fixture({ blockedReason: () => 'known bad native release' })
  assert.equal((await guard(proc, 'bot-fixture')).message, 'known bad native release')
  assert.equal(calls.length, 0)
})
test('HTTP success plus stale available/connecting is not connected', async () => {
  const { calls, guard } = fixture()
  const r = await guard(proc, 'bot-fixture')
  assert.equal(r.ok, false); assert.equal(r.pending, true)
  await guard(proc, 'bot-fixture')
  assert.equal(calls.filter(x => x.endsWith('/load')).length, 1)
})
test('crash after accepted response is failure and cannot loop', async () => {
  let alive = true
  const { calls, guard } = fixture({ alive: () => alive, sleep: async () => { alive = false } })
  assert.match((await guard(proc, 'bot-fixture')).message, /退出/)
  await guard(proc, 'bot-fixture')
  assert.equal(calls.filter(x => x.endsWith('/load')).length, 1)
})
test('asynchronous error state is not success', async () => {
  const { guard } = fixture({ api: async path => path.endsWith('/load') ? { success: true } : { list: [{ ...proc, error: 'COMPONENT_LOAD_FAILED' }] } })
  assert.equal((await guard(proc, 'bot-fixture')).ok, false)
})
test('only injected, connected, logged-in and matched identity pass', async () => {
  const { guard } = fixture({ api: async path => path.endsWith('/load') ? { success: true } : { list: [{ ...proc, injected: true, connected: true, loggedIn: true }] } })
  assert.equal((await guard(proc, 'bot-fixture')).ok, true)
})
test('negative load response and malformed process state fail', async () => {
  const a = fixture({ api: async () => ({ success: false }) })
  assert.equal((await a.guard(proc, 'bot-fixture')).ok, false)
  const b = fixture({ api: async path => path.endsWith('/load') ? { success: true } : {} })
  assert.equal((await b.guard(proc, 'bot-fixture')).ok, false)
})
test('concurrent attempts do not issue duplicate loads', async () => {
  const { calls, guard } = fixture()
  await Promise.all([guard(proc, 'bot-fixture'), guard(proc, 'bot-fixture')])
  assert.equal(calls.filter(x => x.endsWith('/load')).length, 1)
})
