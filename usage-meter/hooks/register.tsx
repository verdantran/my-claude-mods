import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [])
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)
const accent = atom({ plugin: 'usage-meter', key: 'accent' } as const, null)

const STORE_KEY = 'limits'
const COLORS_KEY = 'sessionColors'
const SESSION_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
const MINUTE = 60_000
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }
const ORDER = ['five_hour', 'seven_day']

const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length)

const tidy = (raw: SessionRateLimit[]): Limit[] =>
  raw
    .map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))

const percentUsed = (limit: Limit, at: number) => {
  const hasReset = limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= at
  return hasReset ? 0 : Math.max(0, Math.min(100, limit.percentUsed))
}

const untilReset = (resetsAt: string | undefined, at: number) => {
  if (resetsAt === undefined) return ''
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - at) / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return mins > 0 ? `${mins}m` : '<1m'
}

// /color's palette lives in the theme under these keys, so it tracks /theme too
const accentKey = (color: string | null) => (color ? `${color}_FOR_SUBAGENTS_ONLY` : 'claude')

const tone = (used: number, color: string | null) =>
  used < 75 ? accentKey(color) : used < 90 ? 'warning' : 'error'

const pickedColor = (text: string | undefined, args: string) => {
  if (text?.includes('reset to default')) return null
  const named = text?.match(/color set to:? (\w+)/i)?.[1]?.toLowerCase() ?? args.trim().toLowerCase()
  if (named === 'default') return null
  return SESSION_COLORS.includes(named) ? named : undefined
}

const remember = async ($: EngineInterface, raw: SessionRateLimit[]) => {
  if (raw.length === 0) return
  const next = tidy(raw)
  await update($, limits, () => next)
  await $.store.set(STORE_KEY, next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const stored = (await $.store.get(STORE_KEY)) as Limit[] | undefined
    if (stored?.length) await update($, limits, () => stored)
    const colors = ((await $.store.get(COLORS_KEY)) ?? {}) as Record<string, string>
    const saved = colors[await $.session.id()] ?? null
    await update($, accent, () => saved)
    await remember($, (await $.session.usage()).rateLimits)

    const tick = async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
    }
    await tick()
    $.clock.every(MINUTE, () => void tick())

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await remember($, e.rateLimits)
      const at = await $.clock.now()
      await update($, now, () => at)
    }
    return next(e)
  })

  on('command.run', { command: 'color' }, async ($, e, next) => {
    const result = await next(e)
    const color = pickedColor(result.text, e.args)
    if (color === undefined) return result

    await update($, accent, () => color)
    const id = await $.session.id()
    const colors = ((await $.store.get(COLORS_KEY)) ?? {}) as Record<string, string>
    delete colors[id]
    if (color) colors[id] = color
    await $.store.set(COLORS_KEY, Object.fromEntries(Object.entries(colors).slice(-50)))

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const windows = await read($, limits)
    if (e.props.hasSurvey || windows.length === 0) return next(e)

    const at = (await read($, now)) || (await $.clock.now())
    const color = await read($, accent)
    const { Box, Text } = $.ui.resolve(e)

    const columns = e.props.bodyColumns
    const isStacked = columns < 34 * windows.length
    const perWindow = isStacked ? columns : Math.floor((columns - 3 * (windows.length - 1)) / windows.length)
    const barWidth = Math.max(6, Math.min(24, perWindow - 28))

    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection={isStacked ? 'column' : 'row'} columnGap={3}>
          {windows.map(limit => {
            const used = percentUsed(limit, at)
            const filled = Math.round((used / 100) * barWidth)
            const reset = untilReset(limit.resetsAt, at)
            const label = (LABELS[limit.kind] ?? limit.kind).padEnd(5)

            return (
              <Box key={limit.kind}>
                <Text wrap="truncate">
                  <Text dimColor>{label}</Text>
                  <Text color={tone(used, color)}>{'━'.repeat(filled)}</Text>
                  <Text color="subtle">{'─'.repeat(barWidth - filled)}</Text>
                  <Text color={used < 75 ? 'text' : tone(used, color)} weight="semibold">
                    {` ${Math.round(used)}%`}
                  </Text>
                  <Text dimColor>{' used'}</Text>
                  {reset && <Text dimColor>{` · resets ${reset}`}</Text>}
                </Text>
              </Box>
            )
          })}
        </Box>
        {below}
      </Box>
    )
  })
}
