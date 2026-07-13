/// <reference lib="webworker" />

type CompatibleValue = null | boolean | number | string | CompatibleValue[] | { [key: string]: CompatibleValue }

type RunRequest = {
  id: string
  path: string
  functionName: string
  args: CompatibleValue[]
  scripts: Record<string, string>
  maxExecutionSeconds: number
}

(globalThis as unknown as { window: typeof globalThis }).window = globalThis

let runtimeModule: Promise<{ Starlark: typeof import('starlark-wasm')['Starlark'] }> | undefined
let ready: Promise<void> | undefined

const normalizePath = (path: string) => {
  const parts: string[] = []
  path.replaceAll('\\', '/').split('/').forEach((part) => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  const request = event.data
  const prints: string[] = []
  try {
    runtimeModule ??= import('starlark-wasm')
    const { Starlark } = await runtimeModule
    if (!ready) {
      ready = import('starlark-wasm/wasm?url').then(({ default: wasmUrl }) => Starlark.init(wasmUrl))
    }
    await ready
    const base = parentPath(request.path)
    const runtime = new Starlark({
      maxExecutionTime: request.maxExecutionSeconds,
      print: (message) => prints.push(message),
      load: async (filename) => {
        const exact = normalizePath(filename)
        const relative = normalizePath(`${base}${filename}`)
        const source = request.scripts[exact] ?? request.scripts[relative]
        if (source === undefined) throw new Error(`load先が見つかりません: ${filename}`)
        return source
      },
    })
    const value = await runtime.run(normalizePath(request.path), request.functionName, request.args, {}, request.maxExecutionSeconds)
    self.postMessage({ id: request.id, ok: true, value, prints })
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error), prints })
  }
}
