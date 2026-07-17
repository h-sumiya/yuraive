import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createGraphOperations } from './graphOperations'
import { createPlayerBundle, playerBundleName } from './bundle'
import { createGraph, fileKind, nextNodeColor, normalizeGraph, validateGraph } from './graph'
import { DEFAULT_LAYOUT_SOURCE, LAYOUT_EXTENSION } from './layout'
import { isNativeDirectoryHost, requestNativeDirectory } from './nativeDirectory'
import { createStarlarkContext } from './scriptContext'
import type { ScriptTestState } from './ScriptEditor'
import { parseStarlarkErrorLocation, runStarlark } from './starlark'
import type {
  AssetEntry,
  EditorTab,
  GraphDocument,
  LayoutDocument,
  PlaybackHistoryEntry,
  ScriptDocument,
  YuraiveGraph,
  WorkspaceFolder,
} from './types'
import type { ContentInspectionTarget } from './components/ContentDialogs'
import type { View } from './components/GraphCanvas'
import type {
  TreeContextTarget,
  TreeExpansionCommand,
  TreeInlineEdit,
} from './components/Workspace'
import {
  BUNDLE_NOTICE_HIDDEN_KEY,
  collectDroppedFiles,
  defaultScriptSource,
  draftKey,
  layoutDraftKey,
  layoutFileName,
  mediaForAsset,
  readDirectory,
  relativeAssets,
  relativeLayouts,
  relativeScripts,
  scriptDraftKey,
  scriptFileName,
  scriptStem,
  layoutStem,
  restoreDrafts,
  restoreLayoutDrafts,
  restoreScriptDrafts,
  serialize,
  uid,
} from './editor/workspace'

export function useEditorWorkspace() {
  const folderInput = useRef<HTMLInputElement>(null)
  const treeInlineCommit = useRef<TreeInlineEdit | null>(null)
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootName, setRootName] = useState('')
  const [documents, setDocuments] = useState<GraphDocument[]>([])
  const [scripts, setScripts] = useState<ScriptDocument[]>([])
  const [layouts, setLayouts] = useState<LayoutDocument[]>([])
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [tabDropTarget, setTabDropTarget] = useState<{
    key: string
    side: 'before' | 'after'
  } | null>(null)
  const [treeExpansionCommand, setTreeExpansionCommand] = useState<TreeExpansionCommand>({
    id: 0,
    expanded: true,
  })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedButton, setSelectedButton] = useState<string | null>(null)
  const [selectedPlayerControl, setSelectedPlayerControl] = useState<string | null>(null)
  const [selectedGraphLayout, setSelectedGraphLayout] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [weightDisplayMode, setWeightDisplayMode] = useState<'weight' | 'probability' | 'hidden'>(
    'weight',
  )
  const [view, setView] = useState<View>({ zoom: 1, x: 80, y: 65 })
  const [showPreview, setShowPreview] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<AssetEntry | null>(null)
  const [inspectionTarget, setInspectionTarget] = useState<ContentInspectionTarget | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showBundleNotice, setShowBundleNotice] = useState(false)
  const bundleNoticeShown = useRef(false)
  const [tabMenu, setTabMenu] = useState<{
    kind: 'graph' | 'script' | 'layout'
    uid: string
    x: number
    y: number
  } | null>(null)
  const [treeMenu, setTreeMenu] = useState<{
    target: TreeContextTarget
    x: number
    y: number
  } | null>(null)
  const [treeInlineEdit, setTreeInlineEdit] = useState<TreeInlineEdit | null>(null)
  const [scriptTests, setScriptTests] = useState<Record<string, ScriptTestState>>({})
  const [previewHistories, setPreviewHistories] = useState<Record<string, PlaybackHistoryEntry[]>>(
    {},
  )
  const [leftWidth, setLeftWidth] = useState(
    () => Number(localStorage.getItem('yuraive-left-width')) || 220,
  )
  const [rightWidth, setRightWidth] = useState(
    () => Number(localStorage.getItem('yuraive-right-width')) || 330,
  )
  const active = documents.find((document) => document.uid === activeUid)
  const activeScriptUid = activeTab?.startsWith('script:') ? activeTab.slice(7) : null
  const activeScript = scripts.find((script) => script.uid === activeScriptUid)
  const activeLayoutUid = activeTab?.startsWith('layout:') ? activeTab.slice(7) : null
  const activeLayout = layouts.find((layout) => layout.uid === activeLayoutUid)
  const probabilityMode = weightDisplayMode === 'probability'
  const docAssets = useMemo(
    () => (active ? relativeAssets(active, assets) : assets),
    [active, assets],
  )
  const docScripts = useMemo(
    () => (active ? relativeScripts(active, scripts) : scripts),
    [active, scripts],
  )
  const docLayouts = useMemo(
    () => (active ? relativeLayouts(active, layouts) : layouts),
    [active, layouts],
  )
  const issues = useMemo(
    () => (active ? validateGraph(active.graph, docAssets, docScripts, docLayouts) : []),
    [active, docAssets, docLayouts, docScripts],
  )
  const statsSessions = useMemo(() => {
    const history = active ? (previewHistories[active.uid] ?? []) : []
    return [...new Set(history.map((entry) => entry.runId))]
      .map((runId) => {
        const entries = history.filter((entry) => entry.runId === runId)
        return {
          runId,
          label: `${new Date(entries[0]?.startedAt ?? 0).toLocaleString('ja-JP')} · ${entries.length}件`,
        }
      })
      .reverse()
  }, [active, previewHistories])
  useEffect(() => {
    if (selectedNode || selectedButton) setSelectedPlayerControl(null)
  }, [selectedButton, selectedNode])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3200)
  }
  const openGraphTab = (document: GraphDocument) => {
    setOpenTabs((tabs) =>
      tabs.some((tab) => tab.kind === 'graph' && tab.uid === document.uid)
        ? tabs
        : [...tabs, { kind: 'graph', uid: document.uid }],
    )
    setActiveTab(`graph:${document.uid}`)
    setActiveUid(document.uid)
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const openScriptTab = (script: ScriptDocument) => {
    setOpenTabs((tabs) =>
      tabs.some((tab) => tab.kind === 'script' && tab.uid === script.uid)
        ? tabs
        : [...tabs, { kind: 'script', uid: script.uid }],
    )
    setActiveTab(`script:${script.uid}`)
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const openLayoutTab = (layout: LayoutDocument) => {
    setOpenTabs((tabs) =>
      tabs.some((tab) => tab.kind === 'layout' && tab.uid === layout.uid)
        ? tabs
        : [...tabs, { kind: 'layout', uid: layout.uid }],
    )
    setActiveTab(`layout:${layout.uid}`)
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const activateTab = (tab: EditorTab) => {
    setActiveTab(`${tab.kind}:${tab.uid}`)
    if (tab.kind === 'graph') setActiveUid(tab.uid)
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const closeTab = (tab: EditorTab) => {
    const key = `${tab.kind}:${tab.uid}`
    setOpenTabs((tabs) => {
      const index = tabs.findIndex((item) => item.kind === tab.kind && item.uid === tab.uid)
      const next = tabs.filter((item) => item !== tabs[index])
      if (activeTab === key) {
        const successor = next[Math.min(index, next.length - 1)]
        setActiveTab(successor ? `${successor.kind}:${successor.uid}` : null)
        if (successor?.kind === 'graph') setActiveUid(successor.uid)
      }
      return next
    })
  }
  const reorderTab = (
    sourceKey: string,
    targetKey?: string,
    side: 'before' | 'after' = 'after',
  ) => {
    setOpenTabs((tabs) => {
      const sourceIndex = tabs.findIndex((tab) => `${tab.kind}:${tab.uid}` === sourceKey)
      if (sourceIndex < 0 || sourceKey === targetKey) return tabs
      const moving = tabs[sourceIndex]
      const remaining = tabs.filter((_, index) => index !== sourceIndex)
      if (!targetKey) return [...remaining, moving]
      const targetIndex = remaining.findIndex((tab) => `${tab.kind}:${tab.uid}` === targetKey)
      if (targetIndex < 0) return tabs
      const insertionIndex = targetIndex + (side === 'after' ? 1 : 0)
      return [...remaining.slice(0, insertionIndex), moving, ...remaining.slice(insertionIndex)]
    })
    setDraggedTab(null)
    setTabDropTarget(null)
  }
  const resolveDirectory = useCallback(
    async (path: string, create = false) => {
      if (!root) return undefined
      let directory = root
      for (const part of path.split('/').filter(Boolean))
        directory = await directory.getDirectoryHandle(part, { create })
      return directory
    },
    [root],
  )
  const openDirectory = async (providedHandle?: FileSystemDirectoryHandle) => {
    if (!providedHandle && !window.showDirectoryPicker) return
    setBusy(true)
    try {
      const handle = providedHandle ?? (await window.showDirectoryPicker!({ mode: 'readwrite' }))
      const result = await readDirectory(handle)
      const restored = restoreDrafts(handle.name, result.documents)
      const restoredScripts = restoreScriptDrafts(handle.name, result.scripts)
      const restoredLayouts = restoreLayoutDrafts(handle.name, result.layouts)
      const first = restored[0]
      treeInlineCommit.current = null
      setTreeInlineEdit(null)
      setTreeMenu(null)
      setTabMenu(null)
      setRoot(handle)
      setRootName(handle.name)
      setDocuments(restored)
      setScripts(restoredScripts)
      setLayouts(restoredLayouts)
      setFolders(result.folders)
      setAssets(result.assets)
      setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))
      setActiveUid(first?.uid ?? null)
      setOpenTabs(first ? [{ kind: 'graph', uid: first.uid }] : [])
      setActiveTab(first ? `graph:${first.uid}` : null)
      setSelectedNode(null)
      setSelectedButton(null)
      setSelectedPlayerControl(null)
      setSelectedGraphLayout(null)
      if (result.errors.length) notify(`${result.errors.length}件のファイルを読み込めませんでした`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify(error instanceof Error ? error.message : 'フォルダを開けませんでした')
    } finally {
      setBusy(false)
    }
  }
  const reloadDirectory = async () => {
    if (!root || busy) return
    const dirty =
      documents.some((document) => document.dirty) ||
      scripts.some((script) => script.dirty) ||
      layouts.some((layout) => layout.dirty)
    if (
      dirty &&
      !window.confirm('未保存の変更があります。破棄してファイルツリーを再読み込みしますか？')
    )
      return
    const describeTab = (tab: EditorTab) => {
      const item =
        tab.kind === 'graph'
          ? documents.find((document) => document.uid === tab.uid)
          : tab.kind === 'script'
            ? scripts.find((script) => script.uid === tab.uid)
            : layouts.find((layout) => layout.uid === tab.uid)
      return item ? { kind: tab.kind, path: item.path } : null
    }
    const tabDescriptors = openTabs
      .map(describeTab)
      .filter((item): item is { kind: EditorTab['kind']; path: string } => Boolean(item))
    const activeDescriptor = activeTab
      ? describeTab({
          kind: activeTab.startsWith('graph:')
            ? 'graph'
            : activeTab.startsWith('script:')
              ? 'script'
              : 'layout',
          uid: activeTab.slice(activeTab.indexOf(':') + 1),
        })
      : null
    const activeGraphPath = active?.path
    setBusy(true)
    try {
      const result = await readDirectory(root)
      if (dirty) {
        documents.forEach((document) => localStorage.removeItem(draftKey(rootName, document.path)))
        scripts.forEach((script) => localStorage.removeItem(scriptDraftKey(rootName, script.path)))
        layouts.forEach((layout) => localStorage.removeItem(layoutDraftKey(rootName, layout.path)))
      }
      const findTab = ({
        kind,
        path,
      }: {
        kind: EditorTab['kind']
        path: string
      }): EditorTab | undefined => {
        const item =
          kind === 'graph'
            ? result.documents.find((document) => document.path === path)
            : kind === 'script'
              ? result.scripts.find((script) => script.path === path)
              : result.layouts.find((layout) => layout.path === path)
        return item ? { kind, uid: item.uid } : undefined
      }
      const refreshedTabs = tabDescriptors
        .map(findTab)
        .filter((tab): tab is EditorTab => Boolean(tab))
      const activeMatch = activeDescriptor ? findTab(activeDescriptor) : undefined
      const fallback =
        refreshedTabs[0] ??
        (result.documents[0] ? { kind: 'graph' as const, uid: result.documents[0].uid } : undefined)
      const nextActive = activeMatch ?? fallback
      const graphContext =
        nextActive?.kind === 'graph'
          ? result.documents.find((document) => document.uid === nextActive.uid)
          : (result.documents.find((document) => document.path === activeGraphPath) ??
            result.documents[0])
      setDocuments(result.documents)
      setScripts(result.scripts)
      setLayouts(result.layouts)
      setFolders(result.folders)
      setAssets(result.assets)
      setOpenTabs(refreshedTabs.length ? refreshedTabs : fallback ? [fallback] : [])
      setActiveTab(nextActive ? `${nextActive.kind}:${nextActive.uid}` : null)
      setActiveUid(graphContext?.uid ?? null)
      setSelectedNode(null)
      setSelectedButton(null)
      setSelectedPlayerControl(null)
      setSelectedGraphLayout(null)
      setPreviewAsset(null)
      notify(
        result.errors.length
          ? `${result.errors.length}件のファイルを読み込めませんでした`
          : 'ファイルツリーを再読み込みしました',
      )
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ファイルツリーを再読み込みできませんでした')
    } finally {
      setBusy(false)
    }
  }
  const requestOpenDirectory = () => {
    if (
      (documents.some((document) => document.dirty) ||
        scripts.some((script) => script.dirty) ||
        layouts.some((layout) => layout.dirty)) &&
      !window.confirm('未保存の変更があります。保存せずに新しいフォルダを開きますか？')
    )
      return
    if (isNativeDirectoryHost())
      void requestNativeDirectory().then((handle) => handle && openDirectory(handle))
    else if (window.showDirectoryPicker) void openDirectory()
    else folderInput.current?.click()
  }
  useEffect(() => {
    let cancelled = false
    if (isNativeDirectoryHost())
      void requestNativeDirectory().then((handle) => {
        if (!cancelled && handle) void openDirectory(handle)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const openFallback = async (files: FileList) => {
    setBusy(true)
    const docs: GraphDocument[] = []
    const nextScripts: ScriptDocument[] = []
    const nextLayouts: LayoutDocument[] = []
    const folderPaths = new Set<string>()
    const nextAssets: AssetEntry[] = []
    const list = Array.from(files)
    const commonRoot = list[0]?.webkitRelativePath.split('/')[0] ?? 'content'
    for (const file of list) {
      const rawPath = file.webkitRelativePath || file.name
      const path = rawPath.startsWith(`${commonRoot}/`)
        ? rawPath.slice(commonRoot.length + 1)
        : rawPath
      const parts = path.split('/')
      parts.pop()
      let folder = ''
      parts.forEach((part) => {
        folder = folder ? `${folder}/${part}` : part
        if (folder) folderPaths.add(folder)
      })
      if (path.toLowerCase().endsWith('.yuraive.json')) {
        try {
          docs.push({
            uid: uid(),
            name: file.name,
            path,
            graph: normalizeGraph(JSON.parse(await file.text())),
            dirty: false,
          })
        } catch {
          notify(`${path} を読み込めませんでした`)
        }
      } else if (path.toLowerCase().endsWith('.star'))
        nextScripts.push({
          uid: uid(),
          name: file.name,
          path,
          content: await file.text(),
          dirty: false,
        })
      else if (path.toLowerCase().endsWith(LAYOUT_EXTENSION))
        nextLayouts.push({
          uid: uid(),
          name: file.name,
          path,
          content: await file.text(),
          dirty: false,
        })
      else nextAssets.push({ name: file.name, path, kind: fileKind(path), file })
    }
    const restored = restoreDrafts(commonRoot, docs)
    const restoredScripts = restoreScriptDrafts(commonRoot, nextScripts)
    const restoredLayouts = restoreLayoutDrafts(commonRoot, nextLayouts)
    const first = restored[0]
    treeInlineCommit.current = null
    setTreeInlineEdit(null)
    setTreeMenu(null)
    setTabMenu(null)
    setRootName(commonRoot)
    setDocuments(restored)
    setScripts(restoredScripts)
    setLayouts(restoredLayouts)
    setFolders([...folderPaths].map((path) => ({ path })))
    setAssets(nextAssets)
    setActiveUid(first?.uid ?? null)
    setOpenTabs(first ? [{ kind: 'graph', uid: first.uid }] : [])
    setActiveTab(first ? `graph:${first.uid}` : null)
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
    setBusy(false)
    setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))
  }
  const updateActive = useCallback(
    (updater: (document: GraphDocument) => GraphDocument) => {
      setDocuments((current) =>
        current.map((document) => (document.uid === activeUid ? updater(document) : document)),
      )
    },
    [activeUid],
  )
  const updateGraph = useCallback(
    (graph: YuraiveGraph) => updateActive((document) => ({ ...document, graph, dirty: true })),
    [updateActive],
  )
  const {
    updateNode,
    setSelectedNodeStart,
    setSelectedNodeTerminal,
    renameNode,
    deleteNodeById,
    deleteNode,
    updateSelectedButton,
    renameButton,
    deleteButtonById,
    attachButton,
    detachButton,
    updateSelectedPlayerControl,
    renamePlayerControl,
    deletePlayerControlById,
    attachPlayerControl,
    attachLayout,
    disconnectEdge,
    changeEdgeWeight,
    insertNodeOnEdge,
    addNode,
    addScriptNode,
    addButton,
    addLayout,
    removeLayoutNode,
    addPlayerControl,
    addNodeAtGraphCenter,
    addButtonAtGraphCenter,
    addLayoutAtGraphCenter,
    addScriptNodeAtGraphCenter,
    addPlayerControlAtGraphCenter,
    bindAssetToNode,
    dropAssetOnGraph,
    appendFolderToNode,
    dropFolderOnGraph,
  } = createGraphOperations({
    active,
    docAssets,
    docScripts,
    docLayouts,
    scripts,
    view,
    selectedNode,
    selectedButton,
    selectedPlayerControl,
    selectedGraphLayout,
    rootName,
    setSelectedNode,
    setSelectedButton,
    setSelectedPlayerControl,
    setSelectedGraphLayout,
    updateGraph,
    notify,
  })

  const importDroppedHandles = async (
    handlePromises: Array<Promise<FileSystemHandle | null>>,
    options?: { forceNew?: boolean; x?: number; y?: number },
  ) => {
    try {
      const handles = (await Promise.all(handlePromises)).filter(Boolean) as FileSystemHandle[]
      const collected = (
        await Promise.all(handles.map((handle) => collectDroppedFiles(handle)))
      ).flat()
      const mediaFiles = collected.filter((item) =>
        ['audio', 'video'].includes(fileKind(item.path)),
      )
      if (!mediaFiles.length) {
        notify('ドロップしたフォルダに音声・動画がありません')
        return
      }
      const parent = active?.path.includes('/')
        ? active.path.slice(0, active.path.lastIndexOf('/') + 1)
        : ''
      let baseDirectory = root
      if (baseDirectory && parent) {
        for (const part of parent.split('/').filter(Boolean))
          baseDirectory = await baseDirectory.getDirectoryHandle(part, { create: true })
      }
      const imported: AssetEntry[] = []
      for (const item of mediaFiles) {
        const relativePath = item.path.replaceAll('\\', '/')
        if (baseDirectory) {
          const parts = relativePath.split('/')
          const fileName = parts.pop()!
          let directory = baseDirectory
          for (const part of parts)
            directory = await directory.getDirectoryHandle(part, { create: true })
          const handle = await directory.getFileHandle(fileName, { create: true })
          const writable = await handle.createWritable()
          await writable.write(item.file)
          await writable.close()
        }
        imported.push({
          name: item.file.name,
          path: `${parent}${relativePath}`,
          kind: fileKind(relativePath),
          file: item.file,
        })
      }
      setAssets((current) => {
        const paths = new Set(imported.map((item) => item.path))
        return [...current.filter((item) => !paths.has(item.path)), ...imported]
      })
      if (active) {
        let targetId =
          !options?.forceNew && selectedNode && active.graph.nodes[selectedNode]?.type === 'media'
            ? selectedNode
            : ''
        const nodes = { ...active.graph.nodes }
        if (!targetId) {
          let number = Object.keys(nodes).length + 1
          while (nodes[`node-${number}`]) number++
          targetId = `node-${number}`
          const sourceName = handles[0]?.name ?? `Node ${number}`
          nodes[targetId] = {
            type: 'media',
            media: [],
            onEnd: [],
            buttons: [],
            editor: {
              x: Math.round(options?.forceNew ? (options.x ?? 252) - 92 : (options?.x ?? 160)),
              y: Math.round(options?.forceNew ? (options.y ?? 182) - 42 : (options?.y ?? 140)),
              label: sourceName.replace(/\.[^.]+$/, ''),
              color: nextNodeColor(nodes),
            },
          }
        }
        const target = nodes[targetId]
        const additions = imported
          .map((asset, index) =>
            mediaForAsset(
              asset,
              asset.path.slice(parent.length),
              (target.media?.length ?? 0) + index,
            )!,
          )
          .filter(Boolean)
        const used = new Set((target.media ?? []).map((item) => item.id))
        const unique = additions.map((item) => {
          const base = item.id
          let id = base
          let suffix = 2
          while (used.has(id)) id = `${base}-${suffix++}`
          used.add(id)
          return id === item.id ? item : { ...item, id }
        })
        nodes[targetId] = { ...target, media: [...(target.media ?? []), ...unique] }
        updateGraph({ ...active.graph, nodes })
        setSelectedNode(targetId)
      }
      notify(`${mediaFiles.length}件の音声・動画を登録しました`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'フォルダを読み込めませんでした')
    }
  }
  const newDocument = () => {
    let number = documents.length + 1
    while (documents.some((document) => document.name === `graph-${number}.yuraive.json`)) number++
    const document: GraphDocument = {
      uid: uid(),
      name: `graph-${number}.yuraive.json`,
      path: `graph-${number}.yuraive.json`,
      graph: createGraph(),
      dirty: true,
    }
    if (!layouts.some((layout) => layout.path === `default${LAYOUT_EXTENSION}`)) {
      setLayouts((current) => [
        ...current,
        {
          uid: uid(),
          name: `default${LAYOUT_EXTENSION}`,
          path: `default${LAYOUT_EXTENSION}`,
          content: DEFAULT_LAYOUT_SOURCE,
          dirty: true,
        },
      ])
    }
    setDocuments((current) => [...current, document])
    setOpenTabs((tabs) => [...tabs, { kind: 'graph', uid: document.uid }])
    setActiveTab(`graph:${document.uid}`)
    setActiveUid(document.uid)
    setSelectedNode('start')
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const duplicateDocument = (target: GraphDocument) => {
    const parent = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/') + 1)
      : ''
    const stem = target.name.replace(/\.yuraive\.json$/i, '')
    let number = 1
    let name = `${stem}-copy.yuraive.json`
    while (
      documents.some((document) => document.path.toLowerCase() === `${parent}${name}`.toLowerCase())
    )
      name = `${stem}-copy-${++number}.yuraive.json`
    const copy: GraphDocument = {
      uid: uid(),
      name,
      path: `${parent}${name}`,
      graph: structuredClone(target.graph),
      dirty: true,
    }
    setDocuments((current) =>
      current.flatMap((document) => (document.uid === target.uid ? [document, copy] : [document])),
    )
    setOpenTabs((tabs) => [...tabs, { kind: 'graph', uid: copy.uid }])
    setActiveTab(`graph:${copy.uid}`)
    setActiveUid(copy.uid)
    setSelectedNode(
      Object.entries(copy.graph.nodes).find(([, node]) => node.start)?.[0] ??
        Object.keys(copy.graph.nodes)[0] ??
        null,
    )
    setSelectedButton(null)
    notify(`${target.name} を ${name} として複製しました`)
  }
  const deleteDocument = async (target: GraphDocument) => {
    const unsaved = target.dirty ? '\n未保存の変更も失われます。' : ''
    if (!window.confirm(`「${target.path}」を削除しますか？${unsaved}\nこの操作は元に戻せません。`))
      return
    try {
      if (root && target.handle) {
        const parts = target.path.split('/').filter(Boolean)
        const fileName = parts.pop()
        let directory = root
        for (const part of parts) directory = await directory.getDirectoryHandle(part)
        if (fileName) await directory.removeEntry(fileName)
      }
      const remaining = documents.filter((document) => document.uid !== target.uid)
      setDocuments(remaining)
      closeTab({ kind: 'graph', uid: target.uid })
      localStorage.removeItem(draftKey(rootName, target.path))
      if (activeUid === target.uid && activeTab === `graph:${target.uid}`) {
        setActiveUid(remaining[0]?.uid ?? null)
        setSelectedNode(null)
        setSelectedButton(null)
        setSelectedPlayerControl(null)
        setSelectedGraphLayout(null)
      }
      notify(`${target.name} を削除しました`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'グラフを削除できませんでした')
    }
  }
  const renameDocument = async (target: GraphDocument, requestedName: string) => {
    let name = requestedName.trim()
    if (!name) {
      notify('ファイル名は空にできません')
      return false
    }
    if (name.includes('/') || name.includes('\\')) {
      notify('ファイル名にパス区切りは使用できません')
      return false
    }
    if (!name.toLowerCase().endsWith('.yuraive.json'))
      name = `${name.replace(/\.json$/i, '')}.yuraive.json`
    if (name === target.name) return true
    const parent = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/') + 1)
      : ''
    const nextPath = `${parent}${name}`
    if (workspacePathExists(nextPath, target.path)) {
      notify('同じ名前の項目が既にあります')
      return false
    }
    try {
      let handle = target.handle
      let dirty = target.dirty
      if (root && target.handle) {
        const parts = target.path.split('/').filter(Boolean)
        const oldName = parts.pop()
        let directory = root
        for (const part of parts) directory = await directory.getDirectoryHandle(part)
        handle = await directory.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        await writable.write(serialize(target.graph))
        await writable.close()
        if (oldName) await directory.removeEntry(oldName)
        dirty = false
      }
      setDocuments((current) =>
        current.map((document) =>
          document.uid === target.uid
            ? { ...document, name, path: nextPath, handle, dirty }
            : document,
        ),
      )
      localStorage.removeItem(draftKey(rootName, target.path))
      notify(`${target.name} を ${name} に変更しました`)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ファイル名を変更できませんでした')
      return false
    }
  }
  const workspacePathExists = (path: string, except?: string) =>
    [
      ...documents.map((item) => item.path),
      ...scripts.map((item) => item.path),
      ...layouts.map((item) => item.path),
      ...assets.map((item) => item.path),
      ...folders.map((item) => item.path),
    ].some((item) => item !== except && item.toLowerCase() === path.toLowerCase())
  const createWorkspaceEntry = async (
    parentPath: string,
    kind: 'file' | 'folder' | 'script' | 'layout',
    requestedName: string,
  ) => {
    let name = requestedName.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      notify('有効な名前を入力してください')
      return false
    }
    if (kind === 'script') name = scriptFileName(name)
    if (kind === 'layout') name = layoutFileName(name)
    if (!name) {
      notify('有効な名前を入力してください')
      return false
    }
    if (
      kind === 'file' &&
      (name.toLowerCase().endsWith('.star') || name.toLowerCase().endsWith(LAYOUT_EXTENSION))
    ) {
      notify('スクリプトとレイアウトは専用メニューから作成してください')
      return false
    }
    const path = parentPath ? `${parentPath}/${name}` : name
    if (workspacePathExists(path)) {
      notify('同じ名前の項目が既にあります')
      return false
    }
    try {
      const directory = await resolveDirectory(parentPath, true)
      if (kind === 'folder') {
        const handle = directory
          ? await directory.getDirectoryHandle(name, { create: true })
          : undefined
        setFolders((items) => [...items, { path, handle }])
        notify(`${path} を作成しました`)
        return true
      }
      const handle = directory ? await directory.getFileHandle(name, { create: true }) : undefined
      if (kind === 'script' || kind === 'layout') {
        const content =
          kind === 'script'
            ? defaultScriptSource(name.replace(/\.star$/i, ''))
            : DEFAULT_LAYOUT_SOURCE
        if (handle) {
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
        }
        if (kind === 'script') {
          const script: ScriptDocument = { uid: uid(), name, path, content, dirty: !handle, handle }
          setScripts((items) => [...items, script])
          openScriptTab(script)
        } else {
          const layout: LayoutDocument = { uid: uid(), name, path, content, dirty: !handle, handle }
          setLayouts((items) => [...items, layout])
          openLayoutTab(layout)
        }
      } else {
        if (handle) {
          const writable = await handle.createWritable()
          await writable.write('')
          await writable.close()
        }
        setAssets((items) => [
          ...items,
          { name, path, kind: fileKind(path), file: new File([''], name, { type: 'text/plain' }) },
        ])
      }
      notify(`${path} を作成しました`)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : '項目を作成できませんでした')
      return false
    }
  }
  const saveScript = useCallback(
    async (target: ScriptDocument) => {
      try {
        let handle = target.handle
        if (!handle && root) {
          const parent = target.path.includes('/')
            ? target.path.slice(0, target.path.lastIndexOf('/'))
            : ''
          const directory = await resolveDirectory(parent, true)
          handle = await directory?.getFileHandle(target.name, { create: true })
        }
        if (handle) {
          const writable = await handle.createWritable()
          await writable.write(target.content)
          await writable.close()
          setScripts((items) =>
            items.map((item) =>
              item.uid === target.uid ? { ...item, handle, dirty: false } : item,
            ),
          )
          localStorage.removeItem(scriptDraftKey(rootName, target.path))
          notify(`${target.name} を保存しました`)
        } else {
          const url = URL.createObjectURL(new Blob([target.content], { type: 'text/plain' }))
          const link = document.createElement('a')
          link.href = url
          link.download = target.name
          link.click()
          URL.revokeObjectURL(url)
          setScripts((items) =>
            items.map((item) => (item.uid === target.uid ? { ...item, dirty: false } : item)),
          )
          localStorage.removeItem(scriptDraftKey(rootName, target.path))
          notify(`${target.name} をダウンロードしました`)
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : 'スクリプトを保存できませんでした')
      }
    },
    [resolveDirectory, root, rootName],
  )
  const saveLayout = useCallback(
    async (target: LayoutDocument) => {
      try {
        let handle = target.handle
        if (!handle && root) {
          const parent = target.path.includes('/')
            ? target.path.slice(0, target.path.lastIndexOf('/'))
            : ''
          const directory = await resolveDirectory(parent, true)
          handle = await directory?.getFileHandle(target.name, { create: true })
        }
        if (handle) {
          const writable = await handle.createWritable()
          await writable.write(target.content)
          await writable.close()
          setLayouts((items) =>
            items.map((item) =>
              item.uid === target.uid ? { ...item, handle, dirty: false } : item,
            ),
          )
          localStorage.removeItem(layoutDraftKey(rootName, target.path))
          notify(`${target.name} を保存しました`)
        } else {
          const url = URL.createObjectURL(new Blob([target.content], { type: 'text/html' }))
          const link = document.createElement('a')
          link.href = url
          link.download = target.name
          link.click()
          URL.revokeObjectURL(url)
          setLayouts((items) =>
            items.map((item) => (item.uid === target.uid ? { ...item, dirty: false } : item)),
          )
          localStorage.removeItem(layoutDraftKey(rootName, target.path))
          notify(`${target.name} をダウンロードしました`)
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : 'レイアウトを保存できませんでした')
      }
    },
    [resolveDirectory, root, rootName],
  )
  const updateScriptReferences = (oldPath: string, nextPath: string) => {
    setDocuments((items) =>
      items.map((document) => {
        const graphParent = document.path.includes('/')
          ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
          : ''
        const oldReference =
          graphParent && oldPath.startsWith(graphParent)
            ? oldPath.slice(graphParent.length)
            : oldPath
        const newReference =
          graphParent && nextPath.startsWith(graphParent)
            ? nextPath.slice(graphParent.length)
            : nextPath
        let changed = false
        const nodes = Object.fromEntries(
          Object.entries(document.graph.nodes).map(([id, node]) => {
            if (node.script?.path !== oldReference) return [id, node]
            changed = true
            return [id, { ...node, script: { ...node.script, path: newReference } }]
          }),
        )
        const buttons = Object.fromEntries(
          Object.entries(document.graph.buttons).map(([id, button]) => {
            if (button.render?.path !== oldReference) return [id, button]
            changed = true
            return [id, { ...button, render: { ...button.render, path: newReference } }]
          }),
        )
        let playbackStats = document.graph.playbackStats
        if (playbackStats?.path === oldReference) {
          changed = true
          playbackStats = { ...playbackStats, path: newReference }
        }
        return changed
          ? {
              ...document,
              graph: { ...document.graph, nodes, buttons, playbackStats },
              dirty: true,
            }
          : document
      }),
    )
  }
  const updateLayoutReferences = (oldPath: string, nextPath: string) => {
    setDocuments((items) =>
      items.map((document) => {
        const graphParent = document.path.includes('/')
          ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
          : ''
        const oldReference =
          graphParent && oldPath.startsWith(graphParent)
            ? oldPath.slice(graphParent.length)
            : oldPath
        const newReference =
          graphParent && nextPath.startsWith(graphParent)
            ? nextPath.slice(graphParent.length)
            : nextPath
        let changed = false
        const playerControls = Object.fromEntries(
          Object.entries(document.graph.playerControls).map(([id, control]) => {
            if (control.layout !== oldReference) return [id, control]
            changed = true
            return [id, { ...control, layout: newReference }]
          }),
        )
        const layoutPlacements = { ...(document.graph.editor?.layouts ?? {}) }
        if (layoutPlacements[oldReference]) {
          layoutPlacements[newReference] = layoutPlacements[oldReference]
          delete layoutPlacements[oldReference]
          changed = true
        }
        return changed
          ? {
              ...document,
              graph: {
                ...document.graph,
                playerControls,
                editor: { ...document.graph.editor, layouts: layoutPlacements },
              },
              dirty: true,
            }
          : document
      }),
    )
    const activeParent = active?.path.includes('/')
      ? active.path.slice(0, active.path.lastIndexOf('/') + 1)
      : ''
    const activeOldReference =
      activeParent && oldPath.startsWith(activeParent)
        ? oldPath.slice(activeParent.length)
        : oldPath
    const activeNewReference =
      activeParent && nextPath.startsWith(activeParent)
        ? nextPath.slice(activeParent.length)
        : nextPath
    setSelectedGraphLayout((path) => (path === activeOldReference ? activeNewReference : path))
  }
  const relocateScript = async (
    target: ScriptDocument,
    destinationParent: string,
    requestedName: string,
    action: 'rename' | 'move',
  ) => {
    if (requestedName.includes('/') || requestedName.includes('\\')) {
      notify('有効なファイル名を入力してください')
      return false
    }
    const name = scriptFileName(requestedName)
    if (!name) {
      notify('有効なファイル名を入力してください')
      return false
    }
    const nextPath = destinationParent ? `${destinationParent}/${name}` : name
    if (nextPath === target.path) return true
    if (nextPath.toLowerCase() === target.path.toLowerCase()) {
      notify('大文字・小文字だけの名前変更には対応していません')
      return false
    }
    if (workspacePathExists(nextPath, target.path)) {
      notify('同じ名前の項目が既にあります')
      return false
    }
    try {
      let handle = target.handle
      let dirty = target.dirty
      if (root && target.handle) {
        const oldParent = target.path.includes('/')
          ? target.path.slice(0, target.path.lastIndexOf('/'))
          : ''
        const sourceDirectory = await resolveDirectory(oldParent)
        const destinationDirectory = await resolveDirectory(destinationParent, true)
        const nextHandle = await destinationDirectory?.getFileHandle(name, { create: true })
        if (!nextHandle || !sourceDirectory)
          throw new Error('移動先のファイルを作成できませんでした')
        const writable = await nextHandle.createWritable()
        await writable.write(target.content)
        await writable.close()
        try {
          await sourceDirectory.removeEntry(target.name)
        } catch (error) {
          try {
            await destinationDirectory?.removeEntry(name)
          } catch {
            /* Best-effort rollback. */
          }
          throw error
        }
        handle = nextHandle
        dirty = false
      } else if (!root) dirty = true
      setScripts((items) =>
        items.map((item) =>
          item.uid === target.uid ? { ...item, name, path: nextPath, handle, dirty } : item,
        ),
      )
      updateScriptReferences(target.path, nextPath)
      localStorage.removeItem(scriptDraftKey(rootName, target.path))
      if (dirty) {
        try {
          localStorage.setItem(
            scriptDraftKey(rootName, nextPath),
            JSON.stringify({ savedAt: Date.now(), content: target.content }),
          )
        } catch {
          /* Storage quota errors must not interrupt editing. */
        }
      }
      notify(
        action === 'move'
          ? `${target.path} を ${destinationParent || rootName} へ移動しました`
          : `${target.name} を ${name} に変更しました`,
      )
      return true
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : action === 'move'
            ? 'スクリプトを移動できませんでした'
            : 'スクリプト名を変更できませんでした',
      )
      return false
    }
  }
  const renameScript = (target: ScriptDocument, requestedName: string) => {
    const parent = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/'))
      : ''
    return relocateScript(target, parent, requestedName, 'rename')
  }
  const moveScript = async (scriptUid: string, destinationParent: string) => {
    const target = scripts.find((script) => script.uid === scriptUid)
    if (!target) return false
    return relocateScript(target, destinationParent, target.name, 'move')
  }
  const relocateLayout = async (
    target: LayoutDocument,
    destinationParent: string,
    requestedName: string,
    action: 'rename' | 'move',
  ) => {
    if (requestedName.includes('/') || requestedName.includes('\\')) {
      notify('有効なファイル名を入力してください')
      return false
    }
    const name = layoutFileName(requestedName)
    if (!name) {
      notify('有効なファイル名を入力してください')
      return false
    }
    const nextPath = destinationParent ? `${destinationParent}/${name}` : name
    if (nextPath === target.path) return true
    if (workspacePathExists(nextPath, target.path)) {
      notify('同じ名前の項目が既にあります')
      return false
    }
    try {
      let handle = target.handle
      let dirty = target.dirty
      if (root && target.handle) {
        const oldParent = target.path.includes('/')
          ? target.path.slice(0, target.path.lastIndexOf('/'))
          : ''
        const sourceDirectory = await resolveDirectory(oldParent)
        const destinationDirectory = await resolveDirectory(destinationParent, true)
        const nextHandle = await destinationDirectory?.getFileHandle(name, { create: true })
        if (!nextHandle || !sourceDirectory)
          throw new Error('移動先のファイルを作成できませんでした')
        const writable = await nextHandle.createWritable()
        await writable.write(target.content)
        await writable.close()
        try {
          await sourceDirectory.removeEntry(target.name)
        } catch (error) {
          try {
            await destinationDirectory?.removeEntry(name)
          } catch {
            /* best effort */
          }
          throw error
        }
        handle = nextHandle
        dirty = false
      } else if (!root) dirty = true
      setLayouts((items) =>
        items.map((item) =>
          item.uid === target.uid ? { ...item, name, path: nextPath, handle, dirty } : item,
        ),
      )
      updateLayoutReferences(target.path, nextPath)
      localStorage.removeItem(layoutDraftKey(rootName, target.path))
      if (dirty)
        try {
          localStorage.setItem(
            layoutDraftKey(rootName, nextPath),
            JSON.stringify({ savedAt: Date.now(), content: target.content }),
          )
        } catch {
          /* quota */
        }
      notify(
        action === 'move'
          ? `${target.path} を ${destinationParent || rootName} へ移動しました`
          : `${target.name} を ${name} に変更しました`,
      )
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'レイアウトを移動できませんでした')
      return false
    }
  }
  const renameLayout = (target: LayoutDocument, requestedName: string) =>
    relocateLayout(
      target,
      target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : '',
      requestedName,
      'rename',
    )
  const moveLayout = async (layoutUid: string, destinationParent: string) => {
    const target = layouts.find((layout) => layout.uid === layoutUid)
    return target ? relocateLayout(target, destinationParent, target.name, 'move') : false
  }
  const renameAsset = async (target: AssetEntry, requestedName: string) => {
    const name = requestedName.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      notify('有効なファイル名を入力してください')
      return false
    }
    const parent = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/') + 1)
      : ''
    const nextPath = `${parent}${name}`
    if (nextPath === target.path) return true
    if (workspacePathExists(nextPath, target.path)) {
      notify('同じ名前の項目が既にあります')
      return false
    }
    try {
      let nextHandle: FileSystemFileHandle | undefined
      if (root) {
        const directory = await resolveDirectory(parent)
        nextHandle = await directory?.getFileHandle(name, { create: true })
        if (nextHandle) {
          const writable = await nextHandle.createWritable()
          await writable.write(target.file)
          await writable.close()
          await directory?.removeEntry(target.name)
        }
      }
      const nextFile = nextHandle
        ? await nextHandle.getFile()
        : new File([target.file], name, {
            type: target.file.type,
            lastModified: target.file.lastModified,
          })
      setAssets((items) =>
        items.map((item) =>
          item.path === target.path
            ? { ...item, name, path: nextPath, kind: fileKind(nextPath), file: nextFile }
            : item,
        ),
      )
      setDocuments((items) =>
        items.map((document) => {
          const graphParent = document.path.includes('/')
            ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
            : ''
          const oldReference =
            graphParent && target.path.startsWith(graphParent)
              ? target.path.slice(graphParent.length)
              : target.path
          const newReference =
            graphParent && nextPath.startsWith(graphParent)
              ? nextPath.slice(graphParent.length)
              : nextPath
          let changed = false
          const replace = (value?: string) => {
            if (value !== oldReference) return value
            changed = true
            return newReference
          }
          const nodes = Object.fromEntries(
            Object.entries(document.graph.nodes).map(([id, node]) => [
              id,
              {
                ...node,
                media: node.media?.map((media) => ({
                  ...media,
                  source: {
                    ...media.source,
                    audio: replace(media.source.audio),
                    image: replace(media.source.image),
                    video: replace(media.source.video),
                    subtitle: replace(media.source.subtitle),
                  },
                })),
              },
            ]),
          )
          const buttons = Object.fromEntries(
            Object.entries(document.graph.buttons).map(([id, button]) => [
              id,
              {
                ...button,
                style: button.style
                  ? { ...button.style, backgroundImage: replace(button.style.backgroundImage) }
                  : undefined,
              },
            ]),
          )
          return changed
            ? { ...document, graph: { ...document.graph, nodes, buttons }, dirty: true }
            : document
        }),
      )
      notify(`${target.name} を ${name} に変更しました`)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ファイル名を変更できませんでした')
      return false
    }
  }
  const beginTreeCreate = (
    target: TreeContextTarget,
    kind: 'file' | 'folder' | 'script' | 'layout',
  ) => {
    const parentPath = target.kind === 'folder' ? target.path : ''
    treeInlineCommit.current = null
    setTreeInlineEdit({ mode: 'create', kind, parentPath, name: '', source: 'tree' })
    setTreeMenu(null)
  }
  const beginTreeRename = (target: TreeContextTarget, source: 'tree' | 'tab') => {
    if (target.kind === 'root' || target.kind === 'folder') return
    const fileName = target.path.split('/').at(-1) ?? ''
    const parentPath = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/'))
      : ''
    treeInlineCommit.current = null
    setTreeInlineEdit({
      mode: 'rename',
      kind: target.kind,
      parentPath,
      name:
        target.kind === 'script'
          ? scriptStem(fileName)
          : target.kind === 'layout'
            ? layoutStem(fileName)
            : fileName,
      source,
      target,
    })
    setTreeMenu(null)
    setTabMenu(null)
  }
  const commitTreeInlineEdit = async () => {
    const edit = treeInlineEdit
    if (!edit) return false
    if (treeInlineCommit.current === edit) return false
    treeInlineCommit.current = edit
    let completed = false
    if (
      edit.mode === 'create' &&
      (edit.kind === 'file' ||
        edit.kind === 'folder' ||
        edit.kind === 'script' ||
        edit.kind === 'layout')
    ) {
      completed = await createWorkspaceEntry(edit.parentPath, edit.kind, edit.name)
    } else if (edit.mode === 'rename' && edit.target) {
      if (edit.target.kind === 'graph') {
        const target = documents.find((item) => item.uid === edit.target?.uid)
        if (target) completed = await renameDocument(target, edit.name)
      } else if (edit.target.kind === 'script') {
        const target = scripts.find((item) => item.uid === edit.target?.uid)
        if (target) completed = await renameScript(target, edit.name)
      } else if (edit.target.kind === 'layout') {
        const target = layouts.find((item) => item.uid === edit.target?.uid)
        if (target) completed = await renameLayout(target, edit.name)
      } else if (edit.target.kind === 'asset') {
        const target = assets.find((item) => item.path === edit.target?.path)
        if (target) completed = await renameAsset(target, edit.name)
      }
    }
    if (completed) setTreeInlineEdit((current) => (current === edit ? null : current))
    else treeInlineCommit.current = null
    return completed
  }
  const deleteWorkspaceTarget = async (target: TreeContextTarget) => {
    const label = target.path || rootName
    if (!window.confirm(`「${label}」を削除しますか？\nこの操作は元に戻せません。`)) return
    try {
      if (target.kind === 'graph') {
        const document = documents.find((item) => item.uid === target.uid)
        if (document) await deleteDocument(document)
        return
      }
      if (root && target.path) {
        const parts = target.path.split('/')
        const name = parts.pop()!
        const directory = await resolveDirectory(parts.join('/'))
        await directory?.removeEntry(name, { recursive: target.kind === 'folder' })
      }
      if (target.kind === 'script') {
        const script = scripts.find((item) => item.uid === target.uid)
        if (script) {
          setScripts((items) => items.filter((item) => item.uid !== script.uid))
          closeTab({ kind: 'script', uid: script.uid })
          localStorage.removeItem(scriptDraftKey(rootName, script.path))
        }
      } else if (target.kind === 'layout') {
        const layout = layouts.find((item) => item.uid === target.uid)
        if (layout) {
          setLayouts((items) => items.filter((item) => item.uid !== layout.uid))
          closeTab({ kind: 'layout', uid: layout.uid })
          localStorage.removeItem(layoutDraftKey(rootName, layout.path))
          setDocuments((items) =>
            items.map((document) => {
              const parent = document.path.includes('/')
                ? document.path.slice(0, document.path.lastIndexOf('/') + 1)
                : ''
              const reference =
                parent && layout.path.startsWith(parent)
                  ? layout.path.slice(parent.length)
                  : layout.path
              const layouts = { ...(document.graph.editor?.layouts ?? {}) }
              const placed = Boolean(layouts[reference])
              delete layouts[reference]
              let changed = placed
              const playerControls = Object.fromEntries(
                Object.entries(document.graph.playerControls).map(([id, control]) => {
                  if (control.layout !== reference) return [id, control]
                  changed = true
                  return [id, { ...control, layout: undefined }]
                }),
              )
              return changed
                ? {
                    ...document,
                    graph: {
                      ...document.graph,
                      playerControls,
                      editor: { ...document.graph.editor, layouts },
                    },
                    dirty: true,
                  }
                : document
            }),
          )
          const activeParent = active?.path.includes('/')
            ? active.path.slice(0, active.path.lastIndexOf('/') + 1)
            : ''
          const activeReference =
            activeParent && layout.path.startsWith(activeParent)
              ? layout.path.slice(activeParent.length)
              : layout.path
          setSelectedGraphLayout((path) => (path === activeReference ? null : path))
        }
      } else if (target.kind === 'asset')
        setAssets((items) => items.filter((item) => item.path !== target.path))
      else if (target.kind === 'folder') {
        const prefix = `${target.path}/`
        const removedGraphIds = new Set(
          documents.filter((item) => item.path.startsWith(prefix)).map((item) => item.uid),
        )
        const removedScriptIds = new Set(
          scripts.filter((item) => item.path.startsWith(prefix)).map((item) => item.uid),
        )
        const removedLayoutIds = new Set(
          layouts.filter((item) => item.path.startsWith(prefix)).map((item) => item.uid),
        )
        setDocuments((items) => items.filter((item) => !item.path.startsWith(prefix)))
        setScripts((items) => items.filter((item) => !item.path.startsWith(prefix)))
        setLayouts((items) => items.filter((item) => !item.path.startsWith(prefix)))
        setAssets((items) => items.filter((item) => !item.path.startsWith(prefix)))
        setFolders((items) =>
          items.filter((item) => item.path !== target.path && !item.path.startsWith(prefix)),
        )
        const remainingTabs = openTabs.filter((tab) =>
          tab.kind === 'graph'
            ? !removedGraphIds.has(tab.uid)
            : tab.kind === 'script'
              ? !removedScriptIds.has(tab.uid)
              : !removedLayoutIds.has(tab.uid),
        )
        setOpenTabs(remainingTabs)
        const activeRemoved = activeTab
          ? activeTab.startsWith('graph:')
            ? removedGraphIds.has(activeTab.slice(6))
            : activeTab.startsWith('script:')
              ? removedScriptIds.has(activeTab.slice(7))
              : removedLayoutIds.has(activeTab.slice(7))
          : false
        if (activeRemoved) {
          const next = remainingTabs[0]
          setActiveTab(next ? `${next.kind}:${next.uid}` : null)
          if (next?.kind === 'graph') setActiveUid(next.uid)
        }
      }
      notify(`${label} を削除しました`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '削除できませんでした')
    }
  }
  const save = useCallback(async () => {
    if (!active) return
    try {
      let handle = active.handle
      if (!handle && root) handle = await root.getFileHandle(active.name, { create: true })
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(serialize(active.graph))
        await writable.close()
        updateActive((document) => ({ ...document, handle, dirty: false }))
        localStorage.removeItem(draftKey(rootName, active.path))
        notify(`${active.name} を保存しました`)
      } else {
        const blob = new Blob([serialize(active.graph)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = window.document.createElement('a')
        link.href = url
        link.download = active.name
        link.click()
        URL.revokeObjectURL(url)
        updateActive((document) => ({ ...document, dirty: false }))
        localStorage.removeItem(draftKey(rootName, active.path))
        notify(`${active.name} をダウンロードしました`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存できませんでした')
    }
  }, [active, root, rootName, updateActive])
  const saveCurrent = useCallback(async () => {
    if (activeScript && activeTab?.startsWith('script:')) await saveScript(activeScript)
    else if (activeLayout && activeTab?.startsWith('layout:')) await saveLayout(activeLayout)
    else await save()
  }, [activeLayout, activeScript, activeTab, save, saveLayout, saveScript])
  const updateScriptContent = (script: ScriptDocument, content: string) =>
    setScripts((items) =>
      items.map((item) => (item.uid === script.uid ? { ...item, content, dirty: true } : item)),
    )
  const updateLayoutContent = (layout: LayoutDocument, content: string) =>
    setLayouts((items) =>
      items.map((item) => (item.uid === layout.uid ? { ...item, content, dirty: true } : item)),
    )
  const testScript = async (
    script: ScriptDocument,
    functionName: string,
    sessionRunId?: string,
  ) => {
    setScriptTests((items) => ({ ...items, [script.uid]: { status: 'running', functionName } }))
    try {
      const now = new Date()
      const fallbackRunStartedAt = new Date(now.getTime() - 15_000).toISOString()
      const fallbackHistory: PlaybackHistoryEntry[] = [
        {
          schemaVersion: 1,
          id: 'sample-history-1',
          runId: 'test-run',
          graphId: active?.path ?? 'preview.yuraive.json',
          nodeId: 'previous-node',
          mediaId: 'previous-media',
          source: 'audio/sample.mp3',
          startedAt: new Date(now.getTime() - 14_000).toISOString(),
          endedAt: new Date(now.getTime() - 2_000).toISOString(),
          mediaDurationMs: 60_000,
          activePlayMs: 10_000,
          startPositionMs: 0,
          endPositionMs: 12_000,
          endReason: 'completed',
        },
      ]
      const previewHistory = active ? (previewHistories[active.uid] ?? []) : []
      const selectedHistory =
        functionName === 'render_stats' && sessionRunId
          ? previewHistory.filter((entry) => entry.runId === sessionRunId)
          : []
      const sampleHistory = selectedHistory.length ? selectedHistory : fallbackHistory
      const contextHistory = selectedHistory.length ? previewHistory : sampleHistory
      const runStartedAt = sampleHistory[0]?.startedAt ?? fallbackRunStartedAt
      const baseContext = createStarlarkContext({
        graphId: active?.path ?? 'preview.yuraive.json',
        runId: sampleHistory[0]?.runId ?? 'test-run',
        runStartedAt,
        history: contextHistory,
        current: selectedHistory.length
          ? null
          : {
              nodeId: 'preview-node',
              mediaId: 'preview-media',
              source: 'audio/preview.mp3',
              startedAt: new Date(now.getTime() - 1_500).toISOString(),
              positionMs: 1_250,
              mediaDurationMs: 60_000,
              activePlayMs: 1_000,
            },
        trigger: {
          type: functionName === 'render_stats' ? 'stats' : 'test',
          ...(functionName === 'render_stats'
            ? { runId: sampleHistory[0]?.runId ?? 'test-run' }
            : {}),
        },
        now,
      })
      const context =
        functionName === 'render_stats'
          ? {
              ...baseContext,
              session: {
                runId: sampleHistory[0]?.runId ?? 'test-run',
                startedAt: runStartedAt,
                endedAt: selectedHistory.length ? (sampleHistory.at(-1)?.endedAt ?? null) : null,
                isActive: !selectedHistory.length,
                entryCount: sampleHistory.length,
                activePlayMs: sampleHistory.reduce(
                  (sum, entry) => sum + entry.activePlayMs,
                  selectedHistory.length ? 0 : 1_000,
                ),
                entries: sampleHistory,
              },
              aggregate: {
                sessionCount: new Set(contextHistory.map((entry) => entry.runId)).size,
                entryCount: contextHistory.length,
                activePlayMs: contextHistory.reduce(
                  (sum, entry) => sum + entry.activePlayMs,
                  selectedHistory.length ? 0 : 1_000,
                ),
                firstStartedAt: contextHistory[0]?.startedAt ?? null,
                lastEndedAt: contextHistory.at(-1)?.endedAt ?? null,
              },
            }
          : baseContext
      const result = await runStarlark({
        scripts,
        path: script.path,
        functionName,
        args: [context],
        timeoutMs: 1200,
      })
      setScriptTests((items) => ({
        ...items,
        [script.uid]: {
          status: 'success',
          functionName,
          result: result.value,
          prints: result.prints,
          durationMs: result.durationMs,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const location = parseStarlarkErrorLocation(message)
      setScriptTests((items) => ({
        ...items,
        [script.uid]: { status: 'error', functionName, message, ...location },
      }))
    }
  }
  const beginResize = (side: 'left' | 'right', event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftWidth : rightWidth
    let latestWidth = startWidth
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      const width = Math.max(150, Math.min(520, startWidth + (side === 'left' ? delta : -delta)))
      latestWidth = width
      if (side === 'left') setLeftWidth(width)
      else setRightWidth(width)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      localStorage.setItem(`yuraive-${side}-width`, String(latestWidth))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const exportJson = () => {
    if (!active) return
    const blob = new Blob([serialize(active.graph)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = active.name
    link.click()
    URL.revokeObjectURL(url)
  }
  const exportBundle = async () => {
    if (!active) return
    const errors = issues.filter((issue) => issue.severity === 'error')
    if (errors.length) {
      notify(`${errors.length}件のエラーを解消してから出力してください`)
      setShowProblems(true)
      return
    }
    try {
      const bytes = createPlayerBundle(active.path, active.graph, scripts, layouts)
      const name = playerBundleName(active.name)
      const parent = active.path.includes('/')
        ? active.path.slice(0, active.path.lastIndexOf('/'))
        : ''
      if (root) {
        const directory = await resolveDirectory(parent)
        if (!directory) throw new Error('出力先フォルダを開けません')
        const handle = await directory.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        await writable.write(bytes)
        await writable.close()
        const file = await handle.getFile()
        const path = parent ? `${parent}/${name}` : name
        setAssets((items) => [
          ...items.filter((item) => item.path !== path),
          { name, path, kind: fileKind(path), file },
        ])
        notify(`${name} を出力しました`)
      } else {
        const blob = new Blob([bytes], { type: 'application/vnd.yuraive.bundle' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        URL.revokeObjectURL(url)
        notify(`${name} をダウンロードしました`)
      }
      if (!bundleNoticeShown.current && localStorage.getItem(BUNDLE_NOTICE_HIDDEN_KEY) !== 'true') {
        bundleNoticeShown.current = true
        setShowBundleNotice(true)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'バンドルを出力できませんでした')
    }
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveCurrent()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newDocument()
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        if (selectedButton) deleteButtonById(selectedButton)
        else if (selectedGraphLayout) removeLayoutNode(selectedGraphLayout)
        else if (selectedPlayerControl) deletePlayerControlById(selectedPlayerControl)
        else if (selectedNode) deleteNode()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => {
    const closeMenus = () => {
      setShowFileMenu(false)
      setTabMenu(null)
      setTreeMenu(null)
    }
    window.addEventListener('pointerdown', closeMenus)
    return () => window.removeEventListener('pointerdown', closeMenus)
  }, [])
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [rootName])
  useEffect(() => {
    if (!rootName) return
    const timer = window.setTimeout(() => {
      documents.forEach((document) => {
        const key = draftKey(rootName, document.path)
        try {
          if (document.dirty)
            localStorage.setItem(
              key,
              JSON.stringify({ savedAt: Date.now(), graph: document.graph }),
            )
          else localStorage.removeItem(key)
        } catch {
          /* Storage quota errors must not interrupt editing. */
        }
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [documents, rootName])
  useEffect(() => {
    if (!rootName) return
    const timer = window.setTimeout(() => {
      scripts.forEach((script) => {
        const key = scriptDraftKey(rootName, script.path)
        try {
          if (script.dirty)
            localStorage.setItem(
              key,
              JSON.stringify({ savedAt: Date.now(), content: script.content }),
            )
          else localStorage.removeItem(key)
        } catch {
          /* Storage quota errors must not interrupt editing. */
        }
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [rootName, scripts])
  useEffect(() => {
    if (!rootName) return
    const timer = window.setTimeout(() => {
      layouts.forEach((layout) => {
        const key = layoutDraftKey(rootName, layout.path)
        try {
          if (layout.dirty)
            localStorage.setItem(
              key,
              JSON.stringify({ savedAt: Date.now(), content: layout.content }),
            )
          else localStorage.removeItem(key)
        } catch {
          /* Storage quota errors must not interrupt editing. */
        }
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [layouts, rootName])

  return {
    folderInput,
    treeInlineCommit,
    active,
    activeScript,
    activeLayout,
    probabilityMode,
    docAssets,
    docScripts,
    docLayouts,
    issues,
    statsSessions,
    notify,
    openGraphTab,
    openScriptTab,
    openLayoutTab,
    activateTab,
    closeTab,
    reorderTab,
    reloadDirectory,
    requestOpenDirectory,
    openFallback,
    updateGraph,
    updateNode,
    setSelectedNodeStart,
    setSelectedNodeTerminal,
    renameNode,
    deleteNodeById,
    deleteNode,
    updateSelectedButton,
    renameButton,
    deleteButtonById,
    attachButton,
    detachButton,
    updateSelectedPlayerControl,
    renamePlayerControl,
    deletePlayerControlById,
    attachPlayerControl,
    attachLayout,
    disconnectEdge,
    changeEdgeWeight,
    insertNodeOnEdge,
    addNode,
    addScriptNode,
    addButton,
    addLayout,
    removeLayoutNode,
    addPlayerControl,
    addNodeAtGraphCenter,
    addButtonAtGraphCenter,
    addLayoutAtGraphCenter,
    addScriptNodeAtGraphCenter,
    addPlayerControlAtGraphCenter,
    bindAssetToNode,
    dropAssetOnGraph,
    appendFolderToNode,
    dropFolderOnGraph,
    importDroppedHandles,
    newDocument,
    duplicateDocument,
    deleteDocument,
    saveScript,
    saveLayout,
    moveScript,
    moveLayout,
    beginTreeCreate,
    beginTreeRename,
    commitTreeInlineEdit,
    deleteWorkspaceTarget,
    save,
    saveCurrent,
    updateScriptContent,
    updateLayoutContent,
    testScript,
    beginResize,
    exportJson,
    exportBundle,
    root,
    rootName,
    documents,
    scripts,
    layouts,
    folders,
    assets,
    openTabs,
    activeTab,
    draggedTab,
    setDraggedTab,
    tabDropTarget,
    setTabDropTarget,
    treeExpansionCommand,
    setTreeExpansionCommand,
    selectedNode,
    setSelectedNode,
    selectedButton,
    setSelectedButton,
    selectedPlayerControl,
    setSelectedPlayerControl,
    selectedGraphLayout,
    setSelectedGraphLayout,
    busy,
    toast,
    weightDisplayMode,
    setWeightDisplayMode,
    view,
    setView,
    showPreview,
    setShowPreview,
    previewAsset,
    setPreviewAsset,
    inspectionTarget,
    setInspectionTarget,
    showProblems,
    setShowProblems,
    showFileMenu,
    setShowFileMenu,
    showBundleNotice,
    setShowBundleNotice,
    tabMenu,
    setTabMenu,
    treeMenu,
    setTreeMenu,
    treeInlineEdit,
    setTreeInlineEdit,
    scriptTests,
    previewHistories,
    setPreviewHistories,
    leftWidth,
    rightWidth,
  }
}
