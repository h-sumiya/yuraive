type WebViewMessageEvent = MessageEvent & {
  additionalObjects?: ArrayLike<unknown>
}

type WebViewHost = {
  addEventListener(type: 'message', listener: (event: WebViewMessageEvent) => void): void
  postMessage(message: unknown): void
}

type NativeEntry = {
  path: string
  kind: 'file' | 'directory'
  size?: number
  lastModified?: number
}

type NativeDirectoryMessage = {
  type: 'yuraive-native-directory'
  name: string
  contentBaseUrl: string
  entries: NativeEntry[]
}

type NativeResponseMessage = {
  type: 'yuraive-native-response'
  id: number
  ok: boolean
  error?: string
}

type NativeFile = File & {
  __yuraiveNativePath?: string
  __yuraiveNativeUrl?: string
}

const webViewHost = () =>
  (
    window as Window & {
      chrome?: { webview?: WebViewHost }
    }
  ).chrome?.webview

let nativeDirectory: FileSystemDirectoryHandle | undefined
let resolveNativeDirectory: ((handle: FileSystemDirectoryHandle) => void) | undefined
let nativeDirectoryPromise: Promise<FileSystemDirectoryHandle | null> | undefined
let nextRequestId = 1
const pendingRequests = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()

const parentPath = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const leafName = (path: string) =>
  path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

const mimeType = (path: string) => {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (
    (
      {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        flac: 'audio/flac',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        json: 'application/json',
        star: 'text/plain',
        txt: 'text/plain',
        srt: 'text/plain',
        vtt: 'text/vtt',
      } as Record<string, string>
    )[extension] ?? ''
  )
}

const bytesToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const request = (action: string, values: Record<string, unknown>) => {
  const host = webViewHost()
  if (!host) return Promise.reject(new Error('Windows フォルダブリッジへ接続できません'))
  const id = nextRequestId++
  const promise = new Promise<void>((resolve, reject) =>
    pendingRequests.set(id, { resolve, reject }),
  )
  host.postMessage({ type: 'yuraive-native-request', id, action, ...values })
  return promise
}

const createBridgeDirectory = (message: NativeDirectoryMessage) => {
  const entries = new Map(message.entries.map((entry) => [entry.path, entry]))

  const createNativeFile = (path: string) => {
    const entry = entries.get(path)
    if (!entry || entry.kind !== 'file')
      throw new DOMException(`${path} が見つかりません`, 'NotFoundError')
    const url = `${message.contentBaseUrl}${encodePath(path)}?v=${entry.lastModified ?? 0}`
    const file = new File([], leafName(path), {
      type: mimeType(path),
      lastModified: entry.lastModified,
    }) as NativeFile
    Object.defineProperties(file, {
      size: { value: entry.size ?? 0, configurable: true },
      __yuraiveNativePath: { value: path, configurable: true },
      __yuraiveNativeUrl: { value: url, configurable: true },
      arrayBuffer: {
        value: async () => {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`${path} を読み込めませんでした`)
          return response.arrayBuffer()
        },
      },
      text: {
        value: async () => {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`${path} を読み込めませんでした`)
          return response.text()
        },
      },
    })
    return file
  }

  const createFileHandle = (path: string) =>
    ({
      kind: 'file' as const,
      name: leafName(path),
      getFile: async () => createNativeFile(path),
      createWritable: async () => {
        let content: FileSystemWriteChunkType = ''
        return {
          write: async (value: FileSystemWriteChunkType) => {
            content = value
          },
          close: async () => {
            const nativeSource =
              content instanceof File ? (content as NativeFile).__yuraiveNativePath : undefined
            if (nativeSource) {
              await request('copy', { path, sourcePath: nativeSource })
              const sourceEntry = entries.get(nativeSource)
              entries.set(path, { ...sourceEntry, path, kind: 'file', lastModified: Date.now() })
            } else {
              let buffer: ArrayBuffer
              if (typeof content === 'string') buffer = new TextEncoder().encode(content).buffer
              else if (content instanceof Blob) buffer = await content.arrayBuffer()
              else if (content instanceof ArrayBuffer) buffer = content
              else if (ArrayBuffer.isView(content))
                buffer = content.buffer.slice(
                  content.byteOffset,
                  content.byteOffset + content.byteLength,
                ) as ArrayBuffer
              else throw new Error('この書き込み形式には対応していません')
              await request('write', { path, data: bytesToBase64(buffer) })
              const current = entries.get(path)
              if (current)
                entries.set(path, { ...current, size: buffer.byteLength, lastModified: Date.now() })
            }
          },
          abort: async () => undefined,
          seek: async () => {
            throw new Error('部分書き込みには対応していません')
          },
          truncate: async () => {
            throw new Error('部分書き込みには対応していません')
          },
        } as unknown as FileSystemWritableFileStream
      },
    }) as unknown as FileSystemFileHandle

  const createDirectoryHandle = (path = ''): FileSystemDirectoryHandle =>
    ({
      kind: 'directory' as const,
      name: path ? leafName(path) : message.name,
      entries: async function* () {
        const children = [...entries.values()].filter((entry) => parentPath(entry.path) === path)
        for (const child of children) {
          yield [
            leafName(child.path),
            child.kind === 'directory'
              ? createDirectoryHandle(child.path)
              : createFileHandle(child.path),
          ] as [string, FileSystemDirectoryHandle | FileSystemFileHandle]
        }
      },
      getDirectoryHandle: async (name: string, options?: FileSystemGetDirectoryOptions) => {
        const childPath = joinPath(path, name)
        const current = entries.get(childPath)
        if (!current) {
          if (!options?.create)
            throw new DOMException(`${childPath} が見つかりません`, 'NotFoundError')
          await request('ensure-directory', { path: childPath })
          entries.set(childPath, { path: childPath, kind: 'directory' })
        } else if (current.kind !== 'directory')
          throw new DOMException(`${childPath} はフォルダではありません`, 'TypeMismatchError')
        return createDirectoryHandle(childPath)
      },
      getFileHandle: async (name: string, options?: FileSystemGetFileOptions) => {
        const childPath = joinPath(path, name)
        const current = entries.get(childPath)
        if (!current) {
          if (!options?.create)
            throw new DOMException(`${childPath} が見つかりません`, 'NotFoundError')
          await request('ensure-file', { path: childPath })
          entries.set(childPath, {
            path: childPath,
            kind: 'file',
            size: 0,
            lastModified: Date.now(),
          })
        } else if (current.kind !== 'file')
          throw new DOMException(`${childPath} はファイルではありません`, 'TypeMismatchError')
        return createFileHandle(childPath)
      },
      removeEntry: async (name: string, options?: FileSystemRemoveOptions) => {
        const childPath = joinPath(path, name)
        await request('remove', { path: childPath, recursive: options?.recursive ?? false })
        for (const candidate of [...entries.keys()]) {
          if (candidate === childPath || candidate.startsWith(`${childPath}/`))
            entries.delete(candidate)
        }
      },
    }) as unknown as FileSystemDirectoryHandle

  return createDirectoryHandle()
}

const receiveNativeMessage = (event: WebViewMessageEvent) => {
  let data = event.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return
    }
  }
  if (data?.type === 'yuraive-native-response') {
    const response = data as NativeResponseMessage
    const pending = pendingRequests.get(response.id)
    if (!pending) return
    pendingRequests.delete(response.id)
    if (response.ok) pending.resolve()
    else pending.reject(new Error(response.error || 'Windows フォルダ操作に失敗しました'))
    return
  }
  if (data?.type !== 'yuraive-native-directory') return

  const transferredHandle = event.additionalObjects?.[0]
  if (
    transferredHandle &&
    typeof transferredHandle === 'object' &&
    (transferredHandle as FileSystemHandle).kind === 'directory'
  ) {
    nativeDirectory = transferredHandle as FileSystemDirectoryHandle
  } else {
    nativeDirectory = createBridgeDirectory(data as NativeDirectoryMessage)
  }
  resolveNativeDirectory?.(nativeDirectory)
  resolveNativeDirectory = undefined
}

webViewHost()?.addEventListener('message', receiveNativeMessage)

export const isNativeDirectoryHost = () => Boolean(webViewHost())

export const nativeFileUrl = (file?: File) => (file as NativeFile | undefined)?.__yuraiveNativeUrl

export const requestNativeDirectory = () => {
  const host = webViewHost()
  if (!host) return Promise.resolve(null)
  if (nativeDirectory) return Promise.resolve(nativeDirectory)
  if (!nativeDirectoryPromise)
    nativeDirectoryPromise = new Promise((resolve) => {
      resolveNativeDirectory = resolve
    })
  host.postMessage({ type: 'yuraive-editor-ready' })
  return nativeDirectoryPromise
}
