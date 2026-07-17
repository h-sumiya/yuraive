import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LAYOUT_EXTENSION } from '../layout'
import type {
  AssetEntry,
  GraphDocument,
  LayoutDocument,
  ScriptDocument,
  WorkspaceFolder,
} from '../types'
import {
  ASSET_DRAG_TYPE,
  FOLDER_DRAG_TYPE,
  LAYOUT_DRAG_TYPE,
  LAYOUT_UID_DRAG_TYPE,
  SCRIPT_DRAG_TYPE,
  activeTreeDrag,
  normalizeSearchText,
} from '../editor/workspace'
import { Icon } from './Icon'

export function Welcome({
  busy,
  onOpen,
  onFallback,
}: {
  busy: boolean
  onOpen: () => void
  onFallback: (files: FileList) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => {
    input.current?.setAttribute('webkitdirectory', '')
  }, [])
  return (
    <main className="welcome">
      <img className="welcome-logo" src="/favicon.svg" alt="" />
      <h1>Yuraive Editor</h1>
      <button
        className="open-folder"
        onClick={window.showDirectoryPicker ? onOpen : () => input.current?.click()}
        disabled={busy}
      >
        <Icon name="folder" size={19} />
        {busy ? 'フォルダを読み込み中…' : 'コンテンツフォルダを開く'}
      </button>
      <button
        className="welcome-help-button"
        aria-label="ヘルプ"
        title="ヘルプ"
        onClick={() => setShowHelp(!showHelp)}
      >
        ?
      </button>
      {showHelp && (
        <div className="welcome-help" role="dialog" aria-label="ヘルプ">
          <header>
            <strong>ヘルプ</strong>
            <button className="icon-button" aria-label="閉じる" onClick={() => setShowHelp(false)}>
              <Icon name="close" size={13} />
            </button>
          </header>
          <p>Yuraiveファイルを含むコンテンツフォルダを選択してください。</p>
          <p>
            {window.showDirectoryPicker
              ? 'グラフとメディアを読み込み、変更をフォルダへ保存します。'
              : 'このブラウザでは保存時にJSONファイルをダウンロードします。'}
          </p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => event.target.files && onFallback(event.target.files)}
      />
    </main>
  )
}

type TreeFile = {
  name: string
  path: string
  document?: GraphDocument
  script?: ScriptDocument
  layout?: LayoutDocument
  asset?: AssetEntry
}
type TreeBranch = { folders: Map<string, TreeBranch>; files: TreeFile[] }
export type TreeContextTarget = {
  kind: 'root' | 'folder' | 'graph' | 'script' | 'layout' | 'asset'
  path: string
  uid?: string
}
export type TreeExpansionCommand = { id: number; expanded: boolean }
export type TreeInlineEdit = {
  mode: 'create' | 'rename'
  kind: 'file' | 'folder' | 'graph' | 'script' | 'layout' | 'asset'
  parentPath: string
  name: string
  source: 'tree' | 'tab'
  target?: TreeContextTarget
}

export function InlineNameInput({
  edit,
  testId = 'tree-name-input',
  onChange,
  onCommit,
  onCancel,
}: {
  edit: TreeInlineEdit
  testId?: string
  onChange: (name: string) => void
  onCommit: () => Promise<boolean>
  onCancel: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const committing = useRef(false)
  const cancelled = useRef(false)
  const fixedExtension =
    edit.kind === 'script' ? '.star' : edit.kind === 'layout' ? LAYOUT_EXTENSION : ''
  const commit = async () => {
    if (committing.current || cancelled.current) return
    if (!edit.name.trim()) {
      onCancel()
      return
    }
    committing.current = true
    const completed = await onCommit()
    committing.current = false
    if (!completed)
      window.requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
  }
  return (
    <label
      className="tree-inline-control"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        ref={input}
        data-testid={testId}
        aria-label={edit.mode === 'create' ? '新しい項目の名前' : '新しいファイル名'}
        autoFocus
        value={edit.name}
        spellCheck={false}
        onChange={(event) =>
          onChange(
            edit.kind === 'script'
              ? event.target.value.replace(/(?:\.star)+$/i, '')
              : edit.kind === 'layout'
                ? event.target.value.replace(/(?:\.yuraive-layout\.html)+$/i, '')
                : event.target.value,
          )
        }
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            onCancel()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          }
        }}
      />
      {fixedExtension && (
        <span className="tree-fixed-extension" data-testid="tree-inline-extension">
          {fixedExtension}
        </span>
      )}
    </label>
  )
}

export function FileTree({
  documents,
  scripts,
  layouts,
  folders,
  assets,
  activeTab,
  inlineEdit,
  expansionCommand,
  getAssetPath,
  getLayoutPath,
  getFolderPath,
  onOpenGraph,
  onOpenScript,
  onOpenLayout,
  onPreview,
  onContextMenu,
  onInlineChange,
  onInlineCommit,
  onInlineCancel,
  onMoveScript,
  onMoveLayout,
}: {
  documents: GraphDocument[]
  scripts: ScriptDocument[]
  layouts: LayoutDocument[]
  folders: WorkspaceFolder[]
  assets: AssetEntry[]
  activeTab: string | null
  inlineEdit: TreeInlineEdit | null
  expansionCommand: TreeExpansionCommand
  getAssetPath: (asset: AssetEntry) => string
  getLayoutPath: (layout: LayoutDocument) => string
  getFolderPath: (path: string) => string
  onOpenGraph: (document: GraphDocument) => void
  onOpenScript: (script: ScriptDocument) => void
  onOpenLayout: (layout: LayoutDocument) => void
  onPreview: (asset: AssetEntry) => void
  onContextMenu: (target: TreeContextTarget, event: React.MouseEvent) => void
  onInlineChange: (name: string) => void
  onInlineCommit: () => Promise<boolean>
  onInlineCancel: () => void
  onMoveScript: (uid: string, parentPath: string) => Promise<boolean>
  onMoveLayout: (uid: string, parentPath: string) => Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())
  const [draggedScript, setDraggedScript] = useState<string | null>(null)
  const [draggedLayout, setDraggedLayout] = useState<string | null>(null)
  const [scriptDropTarget, setScriptDropTarget] = useState<string | null>(null)
  const treeItems = useRef({ documents, scripts, layouts, folders, assets })
  treeItems.current = { documents, scripts, layouts, folders, assets }
  useEffect(() => {
    if (inlineEdit?.source === 'tree') setQuery('')
  }, [inlineEdit])
  useEffect(() => {
    if (expansionCommand.expanded) {
      setCollapsedFolders(new Set())
      return
    }
    const paths = new Set(treeItems.current.folders.map((folder) => folder.path))
    ;[
      ...treeItems.current.documents,
      ...treeItems.current.scripts,
      ...treeItems.current.layouts,
      ...treeItems.current.assets,
    ].forEach((item) => {
      const parts = item.path.split('/').filter(Boolean)
      parts.pop()
      let parent = ''
      parts.forEach((part) => {
        parent = parent ? `${parent}/${part}` : part
        paths.add(parent)
      })
    })
    setCollapsedFolders(paths)
  }, [expansionCommand])
  const normalizedQuery = normalizeSearchText(query)
  const matches = useCallback(
    (name: string, path: string) =>
      !normalizedQuery ||
      normalizeSearchText(name).includes(normalizedQuery) ||
      normalizeSearchText(path).includes(normalizedQuery),
    [normalizedQuery],
  )
  const matchCount =
    documents.filter((item) => matches(item.name, item.path)).length +
    scripts.filter((item) => matches(item.name, item.path)).length +
    layouts.filter((item) => matches(item.name, item.path)).length +
    assets.filter((item) => matches(item.name, item.path)).length +
    folders.filter((item) => matches(item.path.split('/').at(-1) ?? item.path, item.path)).length
  const tree = useMemo(() => {
    const rootBranch: TreeBranch = { folders: new Map(), files: [] }
    const entries: TreeFile[] = [
      ...documents.map((document) => ({ name: document.name, path: document.path, document })),
      ...scripts.map((script) => ({ name: script.name, path: script.path, script })),
      ...layouts.map((layout) => ({ name: layout.name, path: layout.path, layout })),
      ...assets.map((asset) => ({ name: asset.name, path: asset.path, asset })),
    ].filter((file) => !normalizedQuery || matches(file.name, file.path))
    entries.forEach((file) => {
      const parts = file.path.split('/').filter(Boolean)
      parts.pop()
      let branch = rootBranch
      parts.forEach((part) => {
        if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), files: [] })
        branch = branch.folders.get(part)!
      })
      branch.files.push(file)
    })
    folders.forEach((folder) => {
      let branch = rootBranch
      folder.path
        .split('/')
        .filter(Boolean)
        .forEach((part) => {
          if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), files: [] })
          branch = branch.folders.get(part)!
        })
    })
    return rootBranch
  }, [assets, documents, folders, layouts, matches, normalizedQuery, scripts])
  const fileIcon = (file: TreeFile) =>
    file.document
      ? 'code'
      : file.script
        ? 'script'
        : file.layout
          ? 'fit'
          : file.asset?.kind === 'image'
            ? 'image'
            : ['audio', 'video'].includes(file.asset?.kind ?? '')
              ? 'media'
              : 'file'
  const inlineRow = (edit: TreeInlineEdit, depth: number) => (
    <div
      className={`tree-entry tree-inline-edit ${edit.kind}`}
      style={{ paddingLeft: 24 + depth * 13 }}
      data-tree-kind={edit.kind}
      data-tree-edit={edit.mode}
    >
      <Icon
        name={
          edit.kind === 'folder'
            ? 'folder'
            : edit.kind === 'script'
              ? 'script'
              : edit.kind === 'layout'
                ? 'fit'
                : edit.kind === 'graph'
                  ? 'code'
                  : 'file'
        }
        size={13}
      />
      <InlineNameInput
        edit={edit}
        onChange={onInlineChange}
        onCommit={onInlineCommit}
        onCancel={onInlineCancel}
      />
    </div>
  )
  const isTextDocumentDrag = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(SCRIPT_DRAG_TYPE) ||
    event.dataTransfer.types.includes(LAYOUT_UID_DRAG_TYPE)
  const acceptTextDocumentDrop = (parentPath: string, event: React.DragEvent) => {
    if (!isTextDocumentDrag(event)) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setScriptDropTarget(parentPath)
    return true
  }
  const dropTextDocument = (parentPath: string, event: React.DragEvent) => {
    if (!isTextDocumentDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    const scriptUid = event.dataTransfer.getData(SCRIPT_DRAG_TYPE)
    const layoutUid = event.dataTransfer.getData(LAYOUT_UID_DRAG_TYPE)
    setScriptDropTarget(null)
    setDraggedScript(null)
    setDraggedLayout(null)
    if (scriptUid) void onMoveScript(scriptUid, parentPath)
    else if (layoutUid) void onMoveLayout(layoutUid, parentPath)
  }
  const renderBranch = (branch: TreeBranch, depth: number, parentPath = ''): React.ReactNode => (
    <>
      {inlineEdit?.source === 'tree' &&
        inlineEdit.mode === 'create' &&
        inlineEdit.parentPath === parentPath &&
        inlineRow(inlineEdit, depth)}
      {[...branch.folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => {
          const path = parentPath ? `${parentPath}/${name}` : name
          const containsInlineEdit =
            inlineEdit?.source === 'tree' &&
            (inlineEdit.parentPath === path || inlineEdit.target?.path === path)
          return (
            <details
              className={`tree-folder ${containsInlineEdit ? 'has-inline-edit' : ''}`}
              open={containsInlineEdit || !collapsedFolders.has(path)}
              onToggle={(event) => {
                const shouldCollapse = !event.currentTarget.open
                setCollapsedFolders((current) => {
                  if (current.has(path) === shouldCollapse) return current
                  const next = new Set(current)
                  if (shouldCollapse) next.add(path)
                  else next.delete(path)
                  return next
                })
              }}
              key={`${depth}-${path}`}
            >
              <summary
                className={scriptDropTarget === path ? 'tree-drop-target' : ''}
                data-tree-kind="folder"
                data-tree-path={path}
                draggable
                onContextMenu={(event) => onContextMenu({ kind: 'folder', path }, event)}
                onDragStart={(event) => {
                  const dragPath = getFolderPath(path) || '.'
                  activeTreeDrag.current = { label: name, kind: 'folder' }
                  event.dataTransfer.setData(FOLDER_DRAG_TYPE, dragPath)
                  event.dataTransfer.setData('text/plain', dragPath)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => {
                  activeTreeDrag.current = null
                }}
                onDragOver={(event) => {
                  acceptTextDocumentDrop(path, event)
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                    scriptDropTarget === path
                  )
                    setScriptDropTarget(null)
                }}
                onDrop={(event) => dropTextDocument(path, event)}
                style={{ paddingLeft: 8 + depth * 13 }}
              >
                <Icon name="chevron" size={11} />
                <Icon name="folder" size={13} />
                <span>{name}</span>
              </summary>
              {renderBranch(child, depth + 1, path)}
            </details>
          )
        })}
      {[...branch.files]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((file) => {
          const key = file.document
            ? `graph:${file.document.uid}`
            : file.script
              ? `script:${file.script.uid}`
              : file.layout
                ? `layout:${file.layout.uid}`
                : ''
          const target: TreeContextTarget = file.document
            ? { kind: 'graph', path: file.path, uid: file.document.uid }
            : file.script
              ? { kind: 'script', path: file.path, uid: file.script.uid }
              : file.layout
                ? { kind: 'layout', path: file.path, uid: file.layout.uid }
                : { kind: 'asset', path: file.path }
          const fileParent = file.path.includes('/')
            ? file.path.slice(0, file.path.lastIndexOf('/'))
            : ''
          if (
            inlineEdit?.source === 'tree' &&
            inlineEdit.mode === 'rename' &&
            inlineEdit.target?.path === file.path
          )
            return <div key={`edit:${file.path}`}>{inlineRow(inlineEdit, depth)}</div>
          return (
            <div
              className={`tree-entry ${key === activeTab ? 'active' : ''} ${file.script ? 'script' : file.layout ? 'layout' : ''} ${file.script?.uid === draggedScript || file.layout?.uid === draggedLayout ? 'dragging' : ''}`}
              style={{ paddingLeft: 24 + depth * 13 }}
              key={file.path}
              data-tree-kind={target.kind}
              data-tree-path={file.path}
              onContextMenu={(event) => onContextMenu(target, event)}
              draggable={Boolean(file.asset || file.script || file.layout)}
              onDragOver={(event) => {
                acceptTextDocumentDrop(fileParent, event)
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                  scriptDropTarget === fileParent
                )
                  setScriptDropTarget(null)
              }}
              onDrop={(event) => dropTextDocument(fileParent, event)}
              onDragStart={(event) => {
                if (file.script) {
                  setDraggedScript(file.script.uid)
                  event.dataTransfer.setData(SCRIPT_DRAG_TYPE, file.script.uid)
                  event.dataTransfer.setData('text/plain', file.path)
                  event.dataTransfer.effectAllowed = 'move'
                  return
                }
                if (file.layout) {
                  setDraggedLayout(file.layout.uid)
                  activeTreeDrag.current = { label: file.name, kind: 'layout' }
                  event.dataTransfer.setData(LAYOUT_UID_DRAG_TYPE, file.layout.uid)
                  event.dataTransfer.setData(LAYOUT_DRAG_TYPE, getLayoutPath(file.layout))
                  event.dataTransfer.setData('text/plain', file.path)
                  event.dataTransfer.effectAllowed = 'copyMove'
                  return
                }
                if (!file.asset) return
                const path = getAssetPath(file.asset)
                activeTreeDrag.current = { label: file.name.replace(/\.[^.]+$/, ''), kind: 'media' }
                event.dataTransfer.setData(ASSET_DRAG_TYPE, path)
                event.dataTransfer.setData('text/plain', path)
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onDragEnd={() => {
                activeTreeDrag.current = null
                setDraggedScript(null)
                setDraggedLayout(null)
                setScriptDropTarget(null)
              }}
            >
              <button
                className="tree-entry-main"
                title={file.path}
                onClick={() =>
                  file.document
                    ? onOpenGraph(file.document)
                    : file.script
                      ? onOpenScript(file.script)
                      : file.layout
                        ? onOpenLayout(file.layout)
                        : file.asset && onPreview(file.asset)
                }
              >
                <Icon name={fileIcon(file)} size={13} />
                <span>{file.name}</span>
                {(file.document?.dirty || file.script?.dirty || file.layout?.dirty) && <i />}
              </button>
            </div>
          )
        })}
    </>
  )
  return (
    <>
      <label className="tree-search">
        <Icon name="search" size={13} />
        <input
          value={query}
          placeholder="ファイル名を検索"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button title="検索をクリア" onClick={() => setQuery('')}>
            <Icon name="close" size={11} />
          </button>
        )}
      </label>
      <div
        className={`file-tree ${scriptDropTarget === '' ? 'root-drop-target' : ''}`}
        data-testid="tree-root-zone"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) onContextMenu({ kind: 'root', path: '' }, event)
        }}
        onDragOver={(event) => {
          if (event.target === event.currentTarget) acceptTextDocumentDrop('', event)
        }}
        onDragLeave={(event) => {
          if (
            event.target === event.currentTarget &&
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          )
            setScriptDropTarget(null)
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) dropTextDocument('', event)
        }}
      >
        {matchCount || inlineEdit?.source === 'tree' ? (
          renderBranch(tree, 0)
        ) : (
          <div
            className="tree-empty"
            onContextMenu={(event) => onContextMenu({ kind: 'root', path: '' }, event)}
            onDragOver={(event) => {
              acceptTextDocumentDrop('', event)
            }}
            onDrop={(event) => dropTextDocument('', event)}
          >
            一致するファイルはありません
          </div>
        )}
      </div>
    </>
  )
}
