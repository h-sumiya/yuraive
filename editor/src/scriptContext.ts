import type { PlaybackHistoryEntry, StarlarkContext, StarlarkCurrent } from './types'

type StarlarkContextInput = {
  graphId: string
  runId: string
  runStartedAt: string
  history: PlaybackHistoryEntry[]
  current: StarlarkCurrent | null
  trigger: Record<string, unknown>
  now?: Date
  currentIsFinalized?: boolean
}

const nonNegativeInteger = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0))

export const createStarlarkContext = ({ graphId, runId, runStartedAt, history, current, trigger, now = new Date(), currentIsFinalized = false }: StarlarkContextInput): StarlarkContext => {
  const historyActivePlayMs = history.reduce((total, entry) => total + nonNegativeInteger(entry.activePlayMs), 0)
  const currentActivePlayMs = currentIsFinalized ? 0 : nonNegativeInteger(current?.activePlayMs ?? 0)
  return {
    now: now.toISOString(),
    graphId,
    runId,
    runStartedAt,
    historyStartedAt: history[0]?.startedAt ?? null,
    historyEndedAt: history.at(-1)?.endedAt ?? null,
    historyCount: history.length,
    historyActivePlayMs,
    totalActivePlayMs: historyActivePlayMs + currentActivePlayMs,
    history,
    current,
    trigger,
  }
}
