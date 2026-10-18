import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HOUR = 3_600_000
const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const bottom = (on: On) => {
  const clock = mock.clock(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="below" />
  })
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

test('shows a wrap-up row in the band while near the limit, keeping what is beneath', async ($, on) => {
  const clock = bottom(on)
  const resetsAt = new Date(clock.now() + HOUR).toISOString()

  for (const surface of ['terminal', 'desktop'] as const) {
    await measure($, [{ kind: 'five_hour', percentUsed: 50, resetsAt }])
    let ui = await $.ui.mount({ plugin: 'usage-wrap-up', surface, ...BAND })
    expect(await ui.find({ key: 'wrap-up' })).toBeUndefined()
    expect(await ui.find({ key: 'below' })).toBeDefined()
    await ui.unmount()

    await measure($, [{ kind: 'five_hour', percentUsed: 96, resetsAt }])
    ui = await $.ui.mount({ plugin: 'usage-wrap-up', surface, ...BAND })
    expect((await ui.find({ key: 'wrap-up' }))?.text).toMatch(/^wrap on · Claude will stop tidily/)
    expect(await ui.find({ key: 'below' })).toBeDefined()
    await ui.unmount()
  }
})
