import type { ScriptDocument } from './types'

type CompatibleValue = null | boolean | number | string | CompatibleValue[] | { [key: string]: CompatibleValue }

export type StarlarkRunResult = {
  value: CompatibleValue
  prints: string[]
  durationMs: number
}

type WorkerResponse = {
  id: string
  ok: boolean
  value?: CompatibleValue
  error?: string
  prints: string[]
}

type Pending = {
  startedAt: number
  resolve: (result: StarlarkRunResult) => void
  reject: (error: Error) => void
  timer: number
}

let worker: Worker | undefined
const pending = new Map<string, Pending>()
let recycleAfterIdle = false
let completedRuns = 0

const stopWorker = (reason: string) => {
  worker?.terminate()
  worker = undefined
  recycleAfterIdle = false
  completedRuns = 0
  for (const item of pending.values()) {
    window.clearTimeout(item.timer)
    item.reject(new Error(reason))
  }
  pending.clear()
}

const getWorker = () => {
  if (worker) return worker
  worker = new Worker(new URL('./starlark.worker.ts', import.meta.url), { type: 'module', name: 'wmgf-starlark' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const item = pending.get(event.data.id)
    if (!item) return
    window.clearTimeout(item.timer)
    pending.delete(event.data.id)
    completedRuns++
    if (!event.data.ok) {
      recycleAfterIdle = true
      item.reject(new Error(event.data.error || 'Starlarkの実行に失敗しました'))
    } else item.resolve({ value: event.data.value ?? null, prints: event.data.prints ?? [], durationMs: performance.now() - item.startedAt })
    if (completedRuns >= 100) recycleAfterIdle = true
    if (recycleAfterIdle && pending.size === 0) {
      worker?.terminate()
      worker = undefined
      recycleAfterIdle = false
      completedRuns = 0
    }
  }
  worker.onerror = (event) => stopWorker(event.message || 'Starlark Workerが停止しました')
  return worker
}

export const scriptsToRecord = (scripts: ScriptDocument[]) => Object.fromEntries(scripts.map((script) => [script.path, script.content]))

export const runStarlark = ({ scripts, path, functionName, args = [], timeoutMs = 1200 }: {
  scripts: ScriptDocument[]
  path: string
  functionName: string
  args?: unknown[]
  timeoutMs?: number
}) => new Promise<StarlarkRunResult>((resolve, reject) => {
  const id = crypto.randomUUID()
  const current = getWorker()
  const timer = window.setTimeout(() => {
    if (!pending.has(id)) return
    stopWorker(`Starlarkの実行が${timeoutMs}msを超えたため停止しました`)
  }, timeoutMs)
  pending.set(id, { resolve, reject, timer, startedAt: performance.now() })
  current.postMessage({
    id,
    path,
    functionName,
    args,
    scripts: scriptsToRecord(scripts),
    maxExecutionSeconds: Math.max(.05, timeoutMs / 1000),
  })
})

export const resetStarlarkRuntime = () => stopWorker('Starlark Workerをリセットしました')

export const parseStarlarkErrorLocation = (message: string) => {
  const match = message.match(/(?::|\s)(\d+):(\d+)(?::|\s)/) ?? message.match(/line\s+(\d+)(?:.*column\s+(\d+))?/i)
  return match ? { line: Number(match[1]), column: Number(match[2] ?? 1) } : undefined
}
