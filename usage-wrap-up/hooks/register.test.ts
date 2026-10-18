import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HOUR = 3_600_000

const bottom = (on: On) => {
  const clock = mock.clock(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  return clock
}

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200_000 } as never, rateLimits, changed: ['rateLimits'] })

const callTool = ($: Engine) => $.tool.call({ tool: 'Read', file_path: 'a.md' } as never)

test('leaves tool results alone below the threshold', async ($, on) => {
  bottom(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 80 }])
  expect((await callTool($)).context).toBeUndefined()
})

test('asks Claude to wrap up once per window when the threshold is crossed mid-turn', async ($, on) => {
  const clock = bottom(on)
  const resetsAt = new Date(clock.now() + HOUR).toISOString()
  await measure($, [
    { kind: 'five_hour', percentUsed: 96, resetsAt },
    { kind: 'seven_day', percentUsed: 40 },
  ])

  const first = await callTool($)
  expect(first.context?.[0]).toMatch(/96% of the person's 5-hour limit is used, about 4% left, resetting in 1h 0m/)
  expect(first.context?.[0]).toMatch(/handover/)
  expect((await callTool($)).context).toBeUndefined()

  const nextWindow = new Date(clock.now() + 5 * HOUR).toISOString()
  await measure($, [{ kind: 'five_hour', percentUsed: 97, resetsAt: nextWindow }])
  expect((await callTool($)).context?.[0]).toMatch(/97%/)
})

test('a window that has already reset does not count', async ($, on) => {
  const clock = bottom(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(clock.now() + HOUR).toISOString() }])
  await clock.advance(2 * HOUR)
  expect((await callTool($)).context).toBeUndefined()
})

test('a new prompt near the limit carries the instruction', async ($, on) => {
  bottom(on)
  await measure($, [{ kind: 'seven_day', percentUsed: 95 }])
  const entered = await $.prompt.submit({ text: 'add a feature', wait: false, origin: 'user' } as never)
  expect(entered.context?.[0]).toMatch(/weekly limit/)
  expect((await callTool($)).context).toBeUndefined()
})

test('the threshold comes from the options', { options: { threshold: 85 } }, async ($, on) => {
  bottom(on)
  await measure($, [{ kind: 'five_hour', percentUsed: 88 }])
  expect((await callTool($)).context?.[0]).toMatch(/88%/)
})
