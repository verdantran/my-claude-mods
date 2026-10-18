import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-wrap-up', key: 'limits' } as const, [])
const warned = atom({ plugin: 'usage-wrap-up', key: 'warned' } as const, [])
const now = atom({ plugin: 'usage-wrap-up', key: 'now' } as const, 0)

const MINUTE = 60_000
const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly', spend_limit: 'spend' }

const untilReset = (resetsAt: string, at: number) => {
  const minutes = Math.max(1, Math.round((Date.parse(resetsAt) - at) / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

// A window is identified by when it resets, so a fresh window can warn again
const windowKey = (limit: Limit) => `${limit.kind}@${limit.resetsAt ?? ''}`

type Thresholds = (kind: string) => number

const nearLimits = async ($: EngineInterface, thresholdFor: Thresholds, at?: number) => {
  at ??= await $.clock.now()
  const hot = (await read($, limits))
    .filter(l => (!l.resetsAt || Date.parse(l.resetsAt) > at) && l.percentUsed >= thresholdFor(l.kind))
    .sort((a, b) => b.percentUsed - a.percentUsed)
  return { hot, at }
}

const instruction = (limit: Limit, at: number) => {
  const used = Math.min(100, Math.round(limit.percentUsed))
  const label = LABELS[limit.kind] ?? limit.kind
  const reset = limit.resetsAt ? `, resetting in ${untilReset(limit.resetsAt, at)}` : ''
  return [
    `Claude Code usage: ${used}% of the person's ${label} limit is used, about ${100 - used}% left${reset}.`,
    'Judge whether you can finish the current task within what is left. If you can, carry on.',
    "If you can't, stop at the next safe point rather than starting new work: finish or undo any half-made change so nothing is left broken,",
    "then end your turn with a short handover: what's done, what's left, and how to pick it up again.",
  ].join(' ')
}

const remember = async ($: EngineInterface, raw: SessionRateLimit[]) => {
  if (raw.length === 0) return
  await update($, limits, () => raw.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
}

const markWarned = async ($: EngineInterface, limit: Limit) => {
  const key = windowKey(limit)
  const seen = await read($, warned)
  if (seen.includes(key)) return false
  await update($, warned, keys => [...keys, key].slice(-20))
  return true
}

export const register: Register = (on, options) => {
  const option = (name: string, fallback: number) => (typeof options[name] === 'number' ? options[name] : fallback)
  const fiveHour = option('fiveHourThreshold', 95)
  const weekly = option('weeklyThreshold', 95)
  const thresholdFor: Thresholds = kind => (kind === 'seven_day' ? weekly : fiveHour)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
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
    if (e.changed.includes('rateLimits')) await remember($, e.rateLimits)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const { hot, at } = await nearLimits($, thresholdFor)
    if (e.command || !hot[0]) return next(e)
    for (const limit of hot) await markWarned($, limit)
    return next({ ...e, context: [...(e.context ?? []), instruction(hot[0], at)] })
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    const { hot, at } = await nearLimits($, thresholdFor)
    const fresh: Limit[] = []
    for (const limit of hot) if (await markWarned($, limit)) fresh.push(limit)
    if (fresh.length === 0) return result

    for (const limit of fresh) {
      $.ui.toast(`${Math.round(limit.percentUsed)}% of your ${LABELS[limit.kind] ?? limit.kind} limit used: asked Claude to wrap up if it can't finish`)
    }
    return { ...result, context: [...(result.context ?? []), ...fresh.map(limit => instruction(limit, at))] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || (await read($, limits)).length === 0) return below
    const { hot } = await nearLimits($, thresholdFor, (await read($, now)) || undefined)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="wrap-up">
          {hot.length > 0 ? (
            <Text wrap="truncate">
              <Text dimColor>{'wrap '}</Text>
              <Text color="error" weight="semibold">{'on'}</Text>
              <Text dimColor>{" · Claude will stop tidily if it can't finish"}</Text>
            </Text>
          ) : (
            <Text wrap="truncate" dimColor>{`wrap at ${fiveHour}% 5h · ${weekly}% week`}</Text>
          )}
        </Box>
      </Box>
    )
  })
}
