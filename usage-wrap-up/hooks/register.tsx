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

const nearLimit = async ($: EngineInterface, threshold: number, at?: number) => {
  at ??= await $.clock.now()
  const live = (await read($, limits)).filter(l => !l.resetsAt || Date.parse(l.resetsAt) > at)
  const worst = live.sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return worst && worst.percentUsed >= threshold ? { limit: worst, at } : undefined
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
  const threshold = typeof options.threshold === 'number' ? options.threshold : 95

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
    const near = e.command ? undefined : await nearLimit($, threshold)
    if (!near) return next(e)
    await markWarned($, near.limit)
    return next({ ...e, context: [...(e.context ?? []), instruction(near.limit, near.at)] })
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    const near = await nearLimit($, threshold)
    if (!near || !(await markWarned($, near.limit))) return result

    $.ui.toast(`${Math.round(near.limit.percentUsed)}% of your ${LABELS[near.limit.kind] ?? near.limit.kind} limit used: asked Claude to wrap up if it can't finish`)
    return { ...result, context: [...(result.context ?? []), instruction(near.limit, near.at)] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const near = e.props.hasSurvey ? undefined : await nearLimit($, threshold, (await read($, now)) || undefined)
    if (!near) return below

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="wrap-up">
          <Text wrap="truncate">
            <Text dimColor>{'wrap '}</Text>
            <Text color="error" weight="semibold">{'on'}</Text>
            <Text dimColor>{" · Claude will stop tidily if it can't finish"}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
