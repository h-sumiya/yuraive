import { fileKind, normalizeGraph } from '../graph'
import { LAYOUT_EXTENSION } from '../layout'
import type {
  AssetEntry,
  GraphDocument,
  LayoutDocument,
  MediaCandidate,
  ScriptDocument,
  WorkspaceFolder,
  YuraiveGraph,
} from '../types'

export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
export const ASSET_DRAG_TYPE = 'application/x-yuraive-asset-path'
export const FOLDER_DRAG_TYPE = 'application/x-yuraive-folder-path'
export const SCRIPT_DRAG_TYPE = 'application/x-yuraive-script-uid'
export const LAYOUT_DRAG_TYPE = 'application/x-yuraive-layout-path'
export const LAYOUT_UID_DRAG_TYPE = 'application/x-yuraive-layout-uid'
export const TAB_DRAG_TYPE = 'application/x-yuraive-editor-tab'
export const activeTreeDrag: {
  current: { label: string; kind: 'folder' | 'media' | 'layout' } | null
} = { current: null }
export const draftKey = (workspace: string, path: string) =>
  `yuraive-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
export const scriptDraftKey = (workspace: string, path: string) =>
  `yuraive-script-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
export const layoutDraftKey = (workspace: string, path: string) =>
  `yuraive-layout-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
export const BUNDLE_NOTICE_HIDDEN_KEY = 'yuraive-bundle-distribution-notice-hidden'
export const defaultScriptSource = (name = 'script') =>
  `# ${name}
# ctx["history"]: 確定済み再生履歴（最大1000件）
# ctx["currentHistory"]: 現在のrunIdに属する確定済み再生履歴
# ctx["current"]: 現在の再生状態 / ctx["totalActivePlayMs"]: 実再生時間の合計
# random(), randint(start, end), choice(items), shuffled(items) が利用できます。

def jump(ctx):
    """Script Nodeから遷移するNode IDを返します。"""
    return None

def render(ctx):
    """Buttonの表示内容を上書きします。"""
    return {
        "visible": True,
        "text": "Continue",
        "style": {},
    }

def render_stats(ctx):
    """1セッション分の再生統計を返します。"""
    minutes = ctx["session"]["activePlayMs"] // 60000
    return {
        "sortValue": minutes,
        "display": {
            "schemaVersion": 1,
            "fallbackText": "%s分再生" % minutes,
            "root": {"type": "text", "text": "%s分再生" % minutes},
        },
    }
`
export const scriptStem = (value: string) => value.trim().replace(/(?:\.star)+$/i, '')
export const scriptFileName = (value: string) => {
  const stem = scriptStem(value)
  return stem ? `${stem}.star` : ''
}
export const layoutStem = (value: string) =>
  value.trim().replace(/(?:\.yuraive-layout\.html)+$/i, '')
export const layoutFileName = (value: string) => {
  const stem = layoutStem(value)
  return stem ? `${stem}${LAYOUT_EXTENSION}` : ''
}
export const normalizeSearchText = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[\s　]+/g, '')

export const restoreDrafts = (workspace: string, documents: GraphDocument[]) =>
  documents.map((document) => {
    const key = draftKey(workspace, document.path)
    const stored = localStorage.getItem(key)
    if (!stored) return document
    try {
      const draft = JSON.parse(stored) as { graph?: YuraiveGraph; savedAt?: number }
      if (
        !draft.graph ||
        !window.confirm(
          `「${document.path}」にブラウザへ自動保存された未保存データがあります。\n復元しますか？`,
        )
      ) {
        localStorage.removeItem(key)
        return document
      }
      return { ...document, graph: normalizeGraph(draft.graph), dirty: true }
    } catch {
      localStorage.removeItem(key)
      return document
    }
  })

export const restoreScriptDrafts = (workspace: string, scripts: ScriptDocument[]) =>
  scripts.map((script) => {
    const stored = localStorage.getItem(scriptDraftKey(workspace, script.path))
    if (!stored) return script
    try {
      const draft = JSON.parse(stored) as { content?: string }
      if (
        typeof draft.content !== 'string' ||
        !window.confirm(
          `「${script.path}」にブラウザへ自動保存された未保存データがあります。\n復元しますか？`,
        )
      ) {
        localStorage.removeItem(scriptDraftKey(workspace, script.path))
        return script
      }
      return { ...script, content: draft.content, dirty: true }
    } catch {
      localStorage.removeItem(scriptDraftKey(workspace, script.path))
      return script
    }
  })

export const restoreLayoutDrafts = (workspace: string, layouts: LayoutDocument[]) =>
  layouts.map((layout) => {
    const stored = localStorage.getItem(layoutDraftKey(workspace, layout.path))
    if (!stored) return layout
    try {
      const draft = JSON.parse(stored) as { content?: string }
      if (
        typeof draft.content !== 'string' ||
        !window.confirm(
          `「${layout.path}」にブラウザへ自動保存された未保存データがあります。\n復元しますか？`,
        )
      ) {
        localStorage.removeItem(layoutDraftKey(workspace, layout.path))
        return layout
      }
      return { ...layout, content: draft.content, dirty: true }
    } catch {
      localStorage.removeItem(layoutDraftKey(workspace, layout.path))
      return layout
    }
  })

export const relativeAssets = (document: GraphDocument, assets: AssetEntry[]) => {
  const parent = document.path.includes('/')
    ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
    : ''
  return assets.map((asset) => ({
    ...asset,
    path: parent && asset.path.startsWith(parent) ? asset.path.slice(parent.length) : asset.path,
  }))
}

export const relativeScripts = (document: GraphDocument, scripts: ScriptDocument[]) => {
  const parent = document.path.includes('/')
    ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
    : ''
  return scripts.map((script) => ({
    ...script,
    path: parent && script.path.startsWith(parent) ? script.path.slice(parent.length) : script.path,
  }))
}

export const relativeLayouts = (document: GraphDocument, layouts: LayoutDocument[]) => {
  const parent = document.path.includes('/')
    ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
    : ''
  return layouts.map((layout) => ({
    ...layout,
    path: parent && layout.path.startsWith(parent) ? layout.path.slice(parent.length) : layout.path,
  }))
}

export const serialize = (graph: YuraiveGraph) => `${JSON.stringify(graph, null, 2)}\n`

export const mediaForAsset = (
  asset: AssetEntry,
  path: string,
  index: number,
): MediaCandidate | undefined => {
  const baseId =
    asset.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || `media-${index + 1}`
  if (asset.kind === 'audio')
    return {
      id: baseId,
      weight: 1,
      source: { type: 'audio', audio: path, visual: 'keep', volume: 1, loop: false },
    }
  if (asset.kind === 'video')
    return {
      id: baseId,
      weight: 1,
      source: { type: 'video', video: path, volume: 1, loop: false, fit: 'contain' },
    }
  if (asset.kind === 'image')
    return {
      id: baseId,
      weight: 1,
      source: { type: 'audioImage', audio: '', image: path, volume: 1, loop: false, fit: 'cover' },
    }
  return undefined
}

export async function readDirectory(root: FileSystemDirectoryHandle) {
  const documents: GraphDocument[] = []
  const assets: AssetEntry[] = []
  const scripts: ScriptDocument[] = []
  const layouts: LayoutDocument[] = []
  const folders: WorkspaceFolder[] = []
  const errors: string[] = []
  const walk = async (directory: FileSystemDirectoryHandle, prefix = '') => {
    for await (const [name, entry] of directory.entries()) {
      const path = `${prefix}${name}`
      if (entry.kind === 'directory') {
        folders.push({ path, handle: entry })
        await walk(entry, `${path}/`)
      } else {
        const file = await entry.getFile()
        if (name.toLowerCase().endsWith('.yuraive.json')) {
          try {
            documents.push({
              uid: uid(),
              name,
              path,
              graph: normalizeGraph(JSON.parse(await file.text())),
              dirty: false,
              handle: entry,
            })
          } catch (error) {
            errors.push(
              `${path}: ${error instanceof Error ? error.message : '読み込めませんでした'}`,
            )
          }
        } else if (name.toLowerCase().endsWith('.star')) {
          scripts.push({
            uid: uid(),
            name,
            path,
            content: await file.text(),
            dirty: false,
            handle: entry,
          })
        } else if (name.toLowerCase().endsWith(LAYOUT_EXTENSION)) {
          layouts.push({
            uid: uid(),
            name,
            path,
            content: await file.text(),
            dirty: false,
            handle: entry,
          })
        } else {
          assets.push({ name, path, kind: fileKind(path), file })
        }
      }
    }
  }
  await walk(root)
  return { documents, assets, scripts, layouts, folders, errors }
}

export async function collectDroppedFiles(
  handle: FileSystemHandle,
  prefix = '',
): Promise<Array<{ file: File; path: string }>> {
  const path = prefix ? `${prefix}/${handle.name}` : handle.name
  if (handle.kind === 'file')
    return [{ file: await (handle as FileSystemFileHandle).getFile(), path }]
  const files: Array<{ file: File; path: string }> = []
  for await (const [, child] of (handle as FileSystemDirectoryHandle).entries())
    files.push(...(await collectDroppedFiles(child, path)))
  return files
}
