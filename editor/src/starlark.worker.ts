/// <reference lib="webworker" />

type CompatibleValue = null | boolean | number | string | CompatibleValue[] | { [key: string]: CompatibleValue }

type RunRequest = {
  id: string
  path: string
  functionName: string
  args: CompatibleValue[]
  scripts: Record<string, string>
  timeoutMs: number
}

type RuntimeResponse = {
  value?: CompatibleValue
  prints?: string[]
  error?: string
}

let runtimeModule: Promise<typeof import('./wasm/yuraive-runtime/yuraive_runtime')> | undefined
let ready: Promise<unknown> | undefined

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  const request = event.data
  try {
    runtimeModule ??= import('./wasm/yuraive-runtime/yuraive_runtime')
    const runtime = await runtimeModule
    ready ??= runtime.default()
    await ready
    const response = JSON.parse(runtime.runStarlarkJson(JSON.stringify({
      path: request.path,
      functionName: request.functionName,
      args: request.args,
      scripts: request.scripts,
      timeoutMs: request.timeoutMs,
    }))) as RuntimeResponse
    if (response.error) {
      self.postMessage({ id: request.id, ok: false, error: response.error, prints: response.prints ?? [] })
    } else {
      self.postMessage({ id: request.id, ok: true, value: response.value ?? null, prints: response.prints ?? [] })
    }
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error), prints: [] })
  }
}
