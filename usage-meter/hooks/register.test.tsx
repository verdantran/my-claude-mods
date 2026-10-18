import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="below" />
  })
}

test('draws remaining usage per window after a measurement', async ($, on) => {
  bottom(on)
  const clock = mock.clock(on)
  const resetsAt = new Date(clock.now() + 2 * 3_600_000 + 15 * 60_000).toISOString()

  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [
      { kind: 'seven_day', percentUsed: 19 },
      { kind: 'five_hour', percentUsed: 38, resetsAt },
    ],
    changed: ['rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, ...BAND })
    const fiveHour = await ui.find({ key: 'five_hour' })
    expect(fiveHour?.text).toMatch(/38% used · resets 2h 15m/)
    expect((await ui.find({ key: 'seven_day' }))?.text).toMatch(/19% used/)
    await ui.unmount()
  }
})

test('stays out of the way before any reading', async ($, on) => {
  bottom(on)
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'five_hour' })).toBeUndefined()
  await ui.unmount()
})

test('bars take the session colour from /color, and drop it on reset', async ($, on) => {
  bottom(on)
  mock.clock(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('command.run', { command: 'color' }, (_$, e) => ({
    text: e.args === 'default' ? 'Session color reset to default' : `Session color set to: ${e.args}`,
  }))

  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
    changed: ['rateLimits'],
  })

  const barColor = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...BAND })
    const bar = await ui.find({ type: 'Text', text: /^━+$/ })
    await ui.unmount()
    return (bar?.props as { color?: string }).color
  }

  expect(await barColor()).toBe('claude')
  await $.command.run({ command: 'color', args: 'purple' } as never)
  expect(await barColor()).toBe('purple_FOR_SUBAGENTS_ONLY')
  await $.command.run({ command: 'color', args: 'default' } as never)
  expect(await barColor()).toBe('claude')
})

test('keeps the band beneath its own bars', async ($, on) => {
  bottom(on)
  mock.clock(on)
  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'five_hour' })).toBeDefined()
  expect(await ui.find({ key: 'below' })).toBeDefined()
  await ui.unmount()
})
