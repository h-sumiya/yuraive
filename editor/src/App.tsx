import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createGraph, DEFAULT_PLAYER_CONTROLS, defaultMedia, fileKind, nextButtonColor, nextNodeColor, nextPlayerControlColor, normalizeGraph, probability, validateGraph, type PlayerControlBooleanKey } from './graph'
import { Preview } from './Preview'
import { createStarlarkContext } from './scriptContext'
import ScriptInspector from './ScriptInspector'
import type { ScriptTestState } from './ScriptEditor'
import { parseStarlarkErrorLocation, runStarlark } from './starlark'
import type { AssetEntry, EditorTab, GraphDocument, MediaCandidate, PlaybackHistoryEntry, PlayerControlSettings, ScriptDocument, Transition, ValidationIssue, WmgButton, WmgGraph, WmgMetadata, WmgNode, WorkspaceFolder } from './types'

const ScriptEditor = lazy(() => import('./ScriptEditor').then((module) => ({ default: module.ScriptEditor })))

const Icon = ({ name, size = 16 }: { name: string; size?: number }) => {
  const paths: Record<string, React.ReactNode> = {
    folder: <><path d="M3 5.5h6l1.8 2H21v10.5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z"/><path d="M1 9h20"/></>,
    file: <><path d="M5 2h9l5 5v15H5z"/><path d="M14 2v5h5"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    save: <><path d="M4 3h14l3 3v15H3V3z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/></>,
    play: <path d="m7 4 13 8-13 8z"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    warning: <><path d="M12 3 2 21h20z"/><path d="M12 9v5m0 3v.1"/></>,
    trash: <><path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    media: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 3 3 2-2 6 5"/></>,
    code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16"/>,
    script: <><path d="M5 3h11l3 3v18H5z"/><path d="M16 3v5h5M8 12h8M8 16h6"/></>,
    bug: <><path d="M8 9h8M9 4h6l1 3H8zM7 7l-2 3v8l3 3h8l3-3v-8l-2-3M3 13h4m10 0h4"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></>,
    link: <><path d="M10 14 8 16a4 4 0 0 1-6-6l3-3a4 4 0 0 1 6 0"/><path d="m14 10 2-2a4 4 0 1 1 6 6l-3 3a4 4 0 0 1-6 0M8 12h8"/></>,
    dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    fit: <><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></>,
    expandAll: <><path d="m7 5 5 5 5-5M7 14l5 5 5-5"/><path d="M4 1h16M4 23h16"/></>,
    collapseAll: <><path d="m7 10 5-5 5 5M7 14l5 5 5-5"/><path d="M4 12h16"/></>,
    controls: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const ASSET_DRAG_TYPE = 'application/x-wmgf-asset-path'
const FOLDER_DRAG_TYPE = 'application/x-wmgf-folder-path'
const SCRIPT_DRAG_TYPE = 'application/x-wmgf-script-uid'
const TAB_DRAG_TYPE = 'application/x-wmgf-editor-tab'
let activeTreeDrag: { label: string; kind: 'folder' | 'media' } | null = null
const draftKey = (workspace: string, path: string) => `wmgf-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
const scriptDraftKey = (workspace: string, path: string) => `wmgf-script-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
const defaultScriptSource = (name = 'script') => `# ${name}\n# ctx["history"]: 確定済み再生履歴（最大1000件）\n# ctx["current"]: 現在の再生状態 / ctx["totalActivePlayMs"]: 実再生時間の合計\n# random(), randint(start, end), choice(items), shuffled(items) が利用できます。\n\ndef jump(ctx):\n    """Script Nodeから遷移するNode IDを返します。"""\n    return None\n\ndef render(ctx):\n    """Buttonの表示内容を上書きします。"""\n    return {\n        "visible": True,\n        "text": "Continue",\n        "style": {},\n    }\n\ndef render_stats(ctx):\n    """1セッション分の再生統計を返します。"""\n    minutes = ctx["session"]["activePlayMs"] // 60000\n    return {\n        "sortValue": minutes,\n        "display": {\n            "schemaVersion": 1,\n            "fallbackText": "%s分再生" % minutes,\n            "root": {"type": "text", "text": "%s分再生" % minutes},\n        },\n    }\n`
const scriptStem = (value: string) => value.trim().replace(/(?:\.star)+$/i, '')
const scriptFileName = (value: string) => {
  const stem = scriptStem(value)
  return stem ? `${stem}.star` : ''
}
const normalizeSearchText = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('ja-JP')
  .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
  .replace(/[\s　]+/g, '')

const restoreDrafts = (workspace: string, documents: GraphDocument[]) => documents.map((document) => {
  const key = draftKey(workspace, document.path)
  const stored = localStorage.getItem(key)
  if (!stored) return document
  try {
    const draft = JSON.parse(stored) as { graph?: WmgGraph; savedAt?: number }
    if (!draft.graph || !window.confirm(`「${document.path}」にブラウザへ自動保存された未保存データがあります。\n復元しますか？`)) {
      localStorage.removeItem(key)
      return document
    }
    return { ...document, graph: normalizeGraph(draft.graph), dirty: true }
  } catch {
    localStorage.removeItem(key)
    return document
  }
})

const restoreScriptDrafts = (workspace: string, scripts: ScriptDocument[]) => scripts.map((script) => {
  const stored = localStorage.getItem(scriptDraftKey(workspace, script.path))
  if (!stored) return script
  try {
    const draft = JSON.parse(stored) as { content?: string }
    if (typeof draft.content !== 'string' || !window.confirm(`「${script.path}」にブラウザへ自動保存された未保存データがあります。\n復元しますか？`)) {
      localStorage.removeItem(scriptDraftKey(workspace, script.path))
      return script
    }
    return { ...script, content: draft.content, dirty: true }
  } catch {
    localStorage.removeItem(scriptDraftKey(workspace, script.path))
    return script
  }
})

const relativeAssets = (document: GraphDocument, assets: AssetEntry[]) => {
  const parent = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/') + 1) : ''
  return assets.map((asset) => ({ ...asset, path: parent && asset.path.startsWith(parent) ? asset.path.slice(parent.length) : asset.path }))
}

const relativeScripts = (document: GraphDocument, scripts: ScriptDocument[]) => {
  const parent = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/') + 1) : ''
  return scripts.map((script) => ({ ...script, path: parent && script.path.startsWith(parent) ? script.path.slice(parent.length) : script.path }))
}

const serialize = (graph: WmgGraph) => `${JSON.stringify(graph, null, 2)}\n`

const mediaForAsset = (asset: AssetEntry, path: string, index: number): MediaCandidate | undefined => {
  const baseId = asset.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || `media-${index + 1}`
  if (asset.kind === 'audio') return { id: baseId, weight: 1, source: { type: 'audio', audio: path, visual: 'keep', volume: 1, loop: false } }
  if (asset.kind === 'video') return { id: baseId, weight: 1, source: { type: 'video', video: path, volume: 1, loop: false, fit: 'contain' } }
  if (asset.kind === 'image') return { id: baseId, weight: 1, source: { type: 'audioImage', audio: '', image: path, volume: 1, loop: false, fit: 'cover' } }
  return undefined
}

async function readDirectory(root: FileSystemDirectoryHandle) {
  const documents: GraphDocument[] = []
  const assets: AssetEntry[] = []
  const scripts: ScriptDocument[] = []
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
        if (name.toLowerCase().endsWith('.wmg.json')) {
          try {
            documents.push({ uid: uid(), name, path, graph: normalizeGraph(JSON.parse(await file.text())), dirty: false, handle: entry })
          } catch (error) {
            errors.push(`${path}: ${error instanceof Error ? error.message : '読み込めませんでした'}`)
          }
        } else if (name.toLowerCase().endsWith('.star')) {
          scripts.push({ uid: uid(), name, path, content: await file.text(), dirty: false, handle: entry })
        } else {
          assets.push({ name, path, kind: fileKind(path), file })
        }
      }
    }
  }
  await walk(root)
  return { documents, assets, scripts, folders, errors }
}

async function collectDroppedFiles(handle: FileSystemHandle, prefix = ''): Promise<Array<{ file: File; path: string }>> {
  const path = prefix ? `${prefix}/${handle.name}` : handle.name
  if (handle.kind === 'file') return [{ file: await (handle as FileSystemFileHandle).getFile(), path }]
  const files: Array<{ file: File; path: string }> = []
  for await (const [, child] of (handle as FileSystemDirectoryHandle).entries()) files.push(...await collectDroppedFiles(child, path))
  return files
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number | undefined; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <input type="number" value={value ?? ''} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))}/>
}

function DebouncedColorInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <input type="color" value={draft.slice(0, 7)} onInput={(event) => { const next = event.currentTarget.value; setDraft(next); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onCommit(next), 140) }} onBlur={() => { window.clearTimeout(timer.current); if (draft !== value) onCommit(draft) }}/>
}

const fuzzyPathScore = (query: string, candidate: string) => {
  const needle = query.toLowerCase().replaceAll('\\', '/')
  const haystack = candidate.toLowerCase()
  if (!needle) return 0
  let cursor = -1
  let score = 0
  let consecutive = 0
  for (const char of needle) {
    if (char === ' ') continue
    const index = haystack.indexOf(char, cursor + 1)
    if (index < 0) return -Infinity
    if (index === cursor + 1) { consecutive += 1; score += 8 + consecutive * 2 }
    else { consecutive = 0; score -= Math.min(12, index - cursor - 1) }
    if (index === 0 || '/._-'.includes(haystack[index - 1] ?? '')) score += 12
    cursor = index
  }
  return score - candidate.length * .02
}

function PathPicker({ value, assets, kinds, placeholder = 'ファイルを選択', onChange }: { value: string; assets: AssetEntry[]; kinds?: AssetEntry['kind'][]; placeholder?: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const choices = useMemo(() => assets
    .filter((asset) => !kinds || kinds.includes(asset.kind))
    .map((asset) => ({ asset, score: fuzzyPathScore(value, asset.path) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.asset.path.localeCompare(b.asset.path))
    .slice(0, 10), [assets, kinds, value])
  const choose = (path: string) => { onChange(path); setOpen(false); setActiveIndex(0) }
  return <div className={`path-picker ${open ? 'open' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const asset = assets.find((item) => item.path === path); if (path && asset && (!kinds || kinds.includes(asset.kind))) { event.preventDefault(); event.stopPropagation(); choose(path) } }}>
    <input value={value} placeholder={placeholder} autoComplete="off" onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0) }} onBlur={() => window.setTimeout(() => setOpen(false), 100)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(choices.length - 1, index + 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)) }
      if (event.key === 'Enter' && open && choices[activeIndex]) { event.preventDefault(); choose(choices[activeIndex].asset.path) }
      if (event.key === 'Escape') setOpen(false)
    }}/>
    {open && choices.length > 0 && <div className="path-suggestions">{choices.map(({ asset }, index) => <button type="button" className={index === activeIndex ? 'active' : ''} key={asset.path} onMouseDown={(event) => { event.preventDefault(); choose(asset.path) }}><Icon name={asset.kind === 'image' ? 'image' : ['audio', 'video'].includes(asset.kind) ? 'media' : 'file'} size={12}/><span>{asset.path}</span><small>{asset.kind}</small></button>)}</div>}
  </div>
}

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file) { setUrl(undefined); return }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

function AudioFilePreview({ file, path, url }: { file: File; path: string; url: string }) {
  const [peaks, setPeaks] = useState<number[]>(Array.from({ length: 96 }, (_, index) => .18 + Math.abs(Math.sin(index * .73)) * .38))
  const [duration, setDuration] = useState(0)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let cancelled = false
    void file.arrayBuffer().then(async (buffer) => {
      try {
        const context = new AudioContext()
        const audio = await context.decodeAudioData(buffer.slice(0))
        const channel = audio.getChannelData(0)
        const block = Math.max(1, Math.floor(channel.length / 96))
        const next = Array.from({ length: 96 }, (_, index) => {
          let peak = 0
          const end = Math.min(channel.length, (index + 1) * block)
          for (let cursor = index * block; cursor < end; cursor++) peak = Math.max(peak, Math.abs(channel[cursor]))
          return Math.max(.04, peak)
        })
        if (!cancelled) { setPeaks(next); setDuration(audio.duration) }
        await context.close()
      } catch {
        const bytes = new Uint8Array(buffer)
        if (!cancelled && bytes.length) setPeaks(Array.from({ length: 96 }, (_, index) => .08 + (bytes[Math.floor(index / 96 * bytes.length)] ?? 0) / 255 * .82))
      }
    })
    return () => { cancelled = true }
  }, [file])
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
  return <div className="audio-preview-rich">
    <div className="audio-preview-heading"><span className="audio-disc"><Icon name="media" size={25}/></span><div><strong>{file.name}</strong><small>{path}</small></div><span className="duration-badge">{duration ? time(duration) : '解析中'}</span></div>
    <div className="waveform" aria-label="音声波形">{peaks.map((peak, index) => <i className={index / peaks.length <= progress ? 'played' : ''} style={{ height: `${Math.max(3, peak * 76)}px` }} key={index}/>)}</div>
    <div className="audio-time"><span>{time(progress * duration)}</span><span>{time(duration)}</span></div>
    <audio src={url} controls onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0)}/>
    <div className="audio-metadata"><div><small>形式</small><strong>{file.type || file.name.split('.').pop()?.toUpperCase() || 'Audio'}</strong></div><div><small>サイズ</small><strong>{file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : `${(file.size / 1024).toFixed(1)} KB`}</strong></div><div><small>チャンネル</small><strong>Audio Track</strong></div><div><small>更新日時</small><strong>{file.lastModified ? new Date(file.lastModified).toLocaleDateString('ja-JP') : '—'}</strong></div></div>
  </div>
}

function Section({ title, count, action, children, defaultOpen = true }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`inspector-section ${open ? 'open' : ''}`}>
    <header><button className="section-toggle" onClick={() => setOpen(!open)}><Icon name="chevron" size={14}/><strong>{title}</strong>{count !== undefined && <span className="count">{count}</span>}</button>{action}</header>
    {open && <div className="section-body">{children}</div>}
  </section>
}

function TransitionEditor({ transitions, nodes, nodeLabels, probabilityMode, onChange, onPick }: { transitions: Transition[]; nodes: string[]; nodeLabels: Record<string, string>; probabilityMode: boolean; onChange: (next: Transition[]) => void; onPick?: (id: string) => void }) {
  const displayName = (id: string) => `${nodeLabels[id] || id} - ${id}`
  return <div className="stack-list">
    {transitions.map((transition, index) => <details className="item-editor transition-item" key={`${index}-${transition.to}`}>
      <summary><Icon name="link" size={13}/><span>{transition.to ? displayName(transition.to) : '遷移先未設定'}</span>{transitions.length > 1 && <span className="summary-meta">{probabilityMode ? `${probability(transition.weight, transitions).toFixed(1)}%` : `w ${transition.weight}`}</span>}<button className="summary-delete" title="遷移を削除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(transitions.filter((_, itemIndex) => itemIndex !== index)) }}><Icon name="trash" size={12}/></button></summary>
      <div className="item-editor-body transition-edit-body">
        <button className="target-dot" title="遷移先のノードを選択" onClick={() => onPick?.(transition.to)}><Icon name="target" size={13}/></button>
        <select value={transition.to} onChange={(event) => onChange(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, to: event.target.value } : item))}>
        <option value="">遷移先を選択</option>{nodes.map((nodeId) => <option value={nodeId} key={nodeId} disabled={nodeId !== transition.to && transitions.some((item, itemIndex) => itemIndex !== index && item.to === nodeId)}>{displayName(nodeId)}</option>)}
        </select>
        {transitions.length > 1 && <NumberInput min={0} step={0.1} value={transition.weight} onChange={(weight) => onChange(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, weight } : item))}/>}
      </div>
    </details>)}
    {!transitions.length && <div className="empty-inline">遷移なし</div>}
  </div>
}

function MediaEditor({ media, index, probabilityMode, assets, onChange, onRemove }: { media: MediaCandidate; index: number; probabilityMode: boolean; assets: AssetEntry[]; onChange: (media: MediaCandidate) => void; onRemove: () => void }) {
  const source = media.source
  const pathInput = (key: 'audio' | 'image' | 'video' | 'subtitle', kind: AssetEntry['kind'], label: string) => <Field label={label}><PathPicker value={source[key] ?? ''} assets={assets} kinds={[kind]} onChange={(value) => onChange({ ...media, source: { ...source, [key]: value } })}/></Field>
  const changeType = (type: MediaCandidate['source']['type']) => {
    const common = { volume: source.volume ?? 1, loop: source.loop ?? false, subtitle: source.subtitle }
    if (type === 'audio') onChange({ ...media, source: { type, audio: source.audio ?? source.video ?? '', visual: 'keep', ...common } })
    if (type === 'audioImage') onChange({ ...media, source: { type, audio: source.audio ?? '', image: source.image ?? '', fit: 'cover', ...common } })
    if (type === 'video') onChange({ ...media, source: { type, video: source.video ?? source.audio ?? '', fit: 'contain', ...common } })
  }
  const dropAsset = (path: string) => {
    const asset = assets.find((item) => item.path === path)
    if (!asset) return
    if (asset.kind === 'subtitle') onChange({ ...media, source: { ...source, subtitle: path } })
    if (asset.kind === 'audio') onChange({ ...media, source: source.type === 'audioImage' ? { ...source, audio: path } : { type: 'audio', audio: path, visual: 'keep', volume: source.volume ?? 1, loop: source.loop ?? false, subtitle: source.subtitle } })
    if (asset.kind === 'image') onChange({ ...media, source: { type: 'audioImage', audio: source.audio ?? '', image: path, volume: source.volume ?? 1, loop: source.loop ?? false, subtitle: source.subtitle, fit: 'cover' } })
    if (asset.kind === 'video') onChange({ ...media, source: { type: 'video', video: path, volume: source.volume ?? 1, loop: source.loop ?? false, subtitle: source.subtitle, fit: 'contain' } })
  }
  return <details className="item-editor" open={index === 0} onDragOver={(event) => { if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); if (path) { event.preventDefault(); event.stopPropagation(); dropAsset(path) } }}>
    <summary><Icon name="media" size={14}/><span>{media.id || `メディア ${index + 1}`}</span><span className="summary-meta">{probabilityMode ? '' : `w ${media.weight}`} · {source.type}</span><button className="summary-delete" title="メディアを削除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove() }}><Icon name="trash" size={12}/></button></summary>
    <div className="item-editor-body">
      <div className="two-col"><Field label="ID"><input value={media.id} onChange={(event) => onChange({ ...media, id: event.target.value })}/></Field><Field label="重み"><NumberInput min={0} step={0.1} value={media.weight} onChange={(weight) => onChange({ ...media, weight })}/></Field></div>
      <Field label="形式"><select value={source.type} onChange={(event) => changeType(event.target.value as MediaCandidate['source']['type'])}><option value="audio">音声</option><option value="audioImage">音声 + 画像</option><option value="video">動画</option></select></Field>
      {source.type !== 'video' && pathInput('audio', 'audio', '音声')}
      {source.type === 'audioImage' && pathInput('image', 'image', '画像')}
      {source.type === 'video' && pathInput('video', 'video', '動画')}
      {pathInput('subtitle', 'subtitle', '字幕（任意）')}
      <div className="two-col"><Field label="音量"><NumberInput min={0} max={1} step={0.05} value={source.volume ?? 1} onChange={(volume) => onChange({ ...media, source: { ...source, volume } })}/></Field>{source.type === 'audio' ? <Field label="画像"><select value={source.visual ?? 'keep'} onChange={(event) => onChange({ ...media, source: { ...source, visual: event.target.value as 'keep' | 'clear' } })}><option value="keep">維持</option><option value="clear">消去</option></select></Field> : <Field label="表示方法"><select value={source.fit ?? 'contain'} onChange={(event) => onChange({ ...media, source: { ...source, fit: event.target.value as 'contain' | 'cover' | 'stretch' } })}><option value="contain">全体を表示</option><option value="cover">領域を覆う</option><option value="stretch">引き伸ばす</option></select></Field>}</div>
      <label className="check-row"><input type="checkbox" checked={source.loop ?? false} onChange={(event) => onChange({ ...media, source: { ...source, loop: event.target.checked } })}/>ループ再生</label>
      {source.type === 'audioImage' && <div className="sub-options"><label className="check-row"><input type="checkbox" checked={Boolean(source.imageTransition)} onChange={(event) => onChange({ ...media, source: { ...source, imageTransition: event.target.checked ? { type: 'crossfade', durationMs: 1000 } : undefined } })}/>画像をクロスフェード</label>{source.imageTransition && <Field label="時間 (ms)"><NumberInput min={0} value={source.imageTransition.durationMs} onChange={(durationMs) => onChange({ ...media, source: { ...source, imageTransition: { type: 'crossfade', durationMs } } })}/></Field>}</div>}
      <button className="text-button danger" onClick={onRemove}><Icon name="trash" size={14}/>このメディアを削除</button>
    </div>
  </details>
}

function ButtonEditor({ buttonId, button, nodes, nodeLabels, assets, scripts, onChange, onRename, onRemove, onPick, onOpenScript }: { buttonId: string; button: WmgButton; nodes: string[]; nodeLabels: Record<string, string>; assets: AssetEntry[]; scripts: ScriptDocument[]; onChange: (button: WmgButton) => void; onRename: (next: string) => void; onRemove: () => void; onPick: (id: string) => void; onOpenScript: (script: ScriptDocument) => void }) {
  const details = useRef<HTMLDetailsElement>(null)
  const layout = button.layout ?? { x: .7, y: .8, width: .2, height: .1, z: 10 }
  const appearance = button.appearance ?? {}
  const intervals = button.visibility ?? []
  useEffect(() => { if (details.current) details.current.open = true }, [])
  return <details className="item-editor" ref={details}>
    <summary><span className="button-glyph">B</span><span>{buttonId}</span><span className="summary-meta">{button.onPress?.length ?? 0} 遷移</span><button className="summary-delete" title="ボタンを削除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove() }}><Icon name="trash" size={12}/></button></summary>
    <div className="item-editor-body">
      <Field label="ID"><input key={buttonId} defaultValue={buttonId} onBlur={(event) => onRename(event.target.value.trim())} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/></Field>
      <Field label="グラフカラー"><div className="color-field"><DebouncedColorInput value={button.editor?.color ?? '#8b6fa3'} onCommit={(color) => onChange({ ...button, editor: { ...button.editor, color } })}/><input value={button.editor?.color ?? '#8b6fa3'} onChange={(event) => onChange({ ...button, editor: { ...button.editor, color: event.target.value } })}/></div></Field>
      <div className="subheading">外観</div>
      <Field label="表示テキスト"><input value={appearance.text ?? ''} onChange={(event) => onChange({ ...button, appearance: { ...appearance, text: event.target.value || undefined } })}/></Field>
      <div className="two-col"><Field label="背景色"><DebouncedColorInput value={appearance.backgroundColor?.slice(0, 7) ?? '#333333'} onCommit={(backgroundColor) => onChange({ ...button, appearance: { ...appearance, backgroundColor } })}/></Field><Field label="文字色"><DebouncedColorInput value={appearance.textColor?.slice(0, 7) ?? '#ffffff'} onCommit={(textColor) => onChange({ ...button, appearance: { ...appearance, textColor } })}/></Field></div>
      <Field label="背景画像"><PathPicker value={appearance.backgroundImage ?? ''} assets={assets} kinds={['image']} placeholder="任意" onChange={(value) => onChange({ ...button, appearance: { ...appearance, backgroundImage: value || undefined } })}/></Field>
      <div className="subheading">動的表示（Starlark）</div>
      <Field label="表示スクリプト"><div className="script-reference"><select value={button.render?.path ?? ''} onChange={(event) => onChange({ ...button, render: event.target.value ? { path: event.target.value, function: button.render?.function ?? 'render' } : undefined })}><option value="">使用しない</option>{scripts.map((script) => <option value={script.path} key={script.uid}>{script.path}</option>)}</select>{button.render?.path && <button className="icon-button" title="スクリプトを開く" onClick={() => { const script = scripts.find((item) => item.path === button.render?.path); if (script) onOpenScript(script) }}><Icon name="script" size={13}/></button>}</div></Field>
      {button.render && <Field label="関数"><input value={button.render.function ?? 'render'} onChange={(event) => onChange({ ...button, render: { ...button.render!, function: event.target.value } })}/></Field>}
      <div className="subheading">配置（表示領域に対する比率）</div>
      <div className="five-col">{(['x', 'y', 'width', 'height', 'z'] as const).map((key) => <Field label={key === 'width' ? '幅' : key === 'height' ? '高さ' : key.toUpperCase()} key={key}><NumberInput min={key === 'z' ? undefined : 0} max={key === 'z' ? undefined : 1} step={key === 'z' ? 1 : .05} value={layout[key]} onChange={(value) => onChange({ ...button, layout: { ...layout, [key]: value } })}/></Field>)}</div>
      <div className="subheading row-between"><span>表示タイミング</span><button className="mini-button" onClick={() => onChange({ ...button, visibility: [...intervals, { fromMs: 0, toMs: null }] })}>+ 区間</button></div>
      {intervals.length === 0 && <div className="empty-inline">常に表示</div>}
      {intervals.map((interval, intervalIndex) => <div className="interval-row" key={intervalIndex}><NumberInput min={0} value={interval.fromMs} onChange={(fromMs) => onChange({ ...button, visibility: intervals.map((item, i) => i === intervalIndex ? { ...item, fromMs } : item) })}/><span>〜</span><input type="number" min="0" value={interval.toMs ?? ''} placeholder="終了まで" onChange={(event) => onChange({ ...button, visibility: intervals.map((item, i) => i === intervalIndex ? { ...item, toMs: event.target.value === '' ? null : Number(event.target.value) } : item) })}/><button className="icon-button" onClick={() => onChange({ ...button, visibility: intervals.filter((_, i) => i !== intervalIndex) })}><Icon name="close" size={12}/></button></div>)}
      <div className="subheading row-between"><span>押下時の遷移</span><button className="mini-button" disabled={!nodes.some((id) => !(button.onPress ?? []).some((transition) => transition.to === id))} onClick={() => { const to = nodes.find((id) => !(button.onPress ?? []).some((transition) => transition.to === id)); if (to) onChange({ ...button, onPress: [...(button.onPress ?? []), { to, weight: 1 }] }) }}>+ 遷移</button></div>
      <TransitionEditor transitions={button.onPress ?? []} nodes={nodes} nodeLabels={nodeLabels} probabilityMode={false} onChange={(onPress) => onChange({ ...button, onPress })} onPick={onPick}/>
      <button className="text-button danger" onClick={onRemove}><Icon name="trash" size={14}/>このボタンを削除</button>
    </div>
  </details>
}

function MetadataTagsInput({ tags, onCommit }: { tags?: string[]; onCommit: (tags: string[]) => void }) {
  const joined = (tags ?? []).join(', ')
  const [draft, setDraft] = useState(joined)
  useEffect(() => setDraft(joined), [joined])
  const commit = () => onCommit(draft.split(',').map((tag) => tag.trim()).filter(Boolean))
  return <input aria-label="グラフのタグ" value={draft} placeholder="ASMR, 睡眠" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
}

function SocialLinksEditor({ links, onChange }: { links: NonNullable<WmgMetadata['socialLinks']>; onChange: (links: NonNullable<WmgMetadata['socialLinks']>) => void }) {
  return <div className="social-links-editor">
    {links.map((link, index) => <div className="social-link-row" key={index}>
      <input aria-label={`ソーシャルリンク${index + 1}の名前`} value={link.label} placeholder="X / Web" onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}/>
      <input aria-label={`ソーシャルリンク${index + 1}のURL`} value={link.url} placeholder="https://" onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}/>
      <button className="icon-button danger" title="リンクを削除" onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}><Icon name="close" size={12}/></button>
    </div>)}
    <button className="mini-button" onClick={() => onChange([...links, { label: '', url: '' }])}>+ ソーシャルリンク</button>
  </div>
}

function GraphMetadataInspector({ graph, graphName, assets, scripts, onChange }: { graph: WmgGraph; graphName: string; assets: AssetEntry[]; scripts: ScriptDocument[]; onChange: (graph: WmgGraph) => void }) {
  const metadata = graph.metadata ?? {}
  const commit = (next: WmgMetadata) => {
    const compact = Object.fromEntries(Object.entries(next).filter(([, value]) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : value !== undefined)) as WmgMetadata
    const nextGraph = { ...graph }
    delete nextGraph.metadata
    if (Object.keys(compact).length) nextGraph.metadata = compact
    onChange(nextGraph)
  }
  const text = (key: keyof Pick<WmgMetadata, 'contentId' | 'displayName' | 'description' | 'author' | 'createdAt' | 'updatedAt'>, value: string) => commit({ ...metadata, [key]: value })
  const dateField = (key: 'createdAt' | 'updatedAt', label: string) => <Field label={label} hint="RFC 3339 / ISO 8601"><div className="metadata-date-field"><input value={metadata[key] ?? ''} placeholder="2026-07-13T12:00:00+09:00" onChange={(event) => text(key, event.target.value)}/><button type="button" className="mini-button" onClick={() => text(key, new Date().toISOString())}>現在</button></div></Field>
  return <aside className="inspector graph-metadata-inspector" data-testid="graph-metadata-inspector">
    <div className="panel-title"><span>グラフ情報</span><small>WMGF v1</small></div>
    <div className="inspector-scroll">
      <div className="graph-file-card"><span><Icon name="code" size={15}/></span><div><strong>{metadata.displayName || graphName}</strong><small>{graphName}</small></div></div>
      <Section title="一般情報">
        <Field label="コンテンツID" hint="同じIDのWMGFは同じ作品の統計として集計されます。com.example.groupId形式を推奨します"><div className="metadata-date-field"><input aria-label="コンテンツID" value={metadata.contentId ?? ''} placeholder="com.example.work" onChange={(event) => text('contentId', event.target.value)}/><button type="button" className="mini-button" onClick={() => text('contentId', crypto.randomUUID?.() ?? uid())}>新規ID</button></div></Field>
        <Field label="表示名"><input aria-label="グラフの表示名" value={metadata.displayName ?? ''} placeholder={graphName.replace(/\.wmg\.json$/i, '')} onChange={(event) => text('displayName', event.target.value)}/></Field>
        <Field label="説明"><textarea aria-label="グラフの説明" rows={5} value={metadata.description ?? ''} placeholder="このグラフの用途や内容" onChange={(event) => text('description', event.target.value)}/></Field>
        <Field label="作者"><input aria-label="グラフの作者" value={metadata.author ?? ''} placeholder="作者名" onChange={(event) => text('author', event.target.value)}/></Field>
        <Field label="サムネイル"><PathPicker value={metadata.thumbnail ?? ''} assets={assets} kinds={['image']} placeholder="任意" onChange={(thumbnail) => commit({ ...metadata, thumbnail: thumbnail || undefined })}/></Field>
        <Field label="タグ" hint="カンマ区切り"><MetadataTagsInput tags={metadata.tags} onCommit={(tags) => commit({ ...metadata, tags })}/></Field>
        <Field label="ソーシャルリンク"><SocialLinksEditor links={metadata.socialLinks ?? []} onChange={(socialLinks) => commit({ ...metadata, socialLinks })}/></Field>
      </Section>
      <Section title="日時">
        {dateField('createdAt', '作成日時')}
        {dateField('updatedAt', '更新日時')}
      </Section>
      <Section title="再生統計">
        <label className="check-row"><input type="checkbox" checked={Boolean(graph.playbackStats)} onChange={(event) => { const next = { ...graph }; if (event.target.checked) next.playbackStats = { path: scripts[0]?.path ?? '', function: 'render_stats' }; else delete next.playbackStats; onChange(next) }}/><span><strong>作者定義の再生統計を有効にする</strong><small>セッションごとにStarlarkを1回実行します</small></span></label>
        {graph.playbackStats && <>
          <Field label="スクリプト"><select aria-label="再生統計スクリプト" value={graph.playbackStats.path} onChange={(event) => onChange({ ...graph, playbackStats: { ...graph.playbackStats!, path: event.target.value } })}><option value="">選択してください</option>{scripts.map((script) => <option value={script.path} key={script.uid}>{script.path}</option>)}</select></Field>
          <Field label="関数" hint="省略時 render_stats"><input aria-label="再生統計関数" value={graph.playbackStats.function ?? ''} placeholder="render_stats" onChange={(event) => onChange({ ...graph, playbackStats: { ...graph.playbackStats!, function: event.target.value || undefined } })}/></Field>
        </>}
      </Section>
    </div>
  </aside>
}

const playerControlLabels: Array<[PlayerControlBooleanKey, string, 'visibility' | 'action']> = [
  ['showSeekBar', 'シークバーを表示', 'visibility'],
  ['showPlaybackTime', '再生時間を表示', 'visibility'],
  ['showSceneName', 'シーン名を表示', 'visibility'],
  ['showFileName', '再生ファイル名を表示', 'visibility'],
  ['allowStop', '再生停止を許可', 'action'],
  ['allowSeek', 'シークを許可', 'action'],
  ['allowNext', '次へを許可（End扱い）', 'action'],
  ['allowPrevious', '前へ戻ることを許可', 'action'],
]

function PlayerControlInspector({ controlId, control, issues, global, usedBy, onChange, onRename, onGlobal, onDelete }: { controlId: string; control: PlayerControlSettings; issues: ValidationIssue[]; global: boolean; usedBy: string[]; onChange: (control: PlayerControlSettings) => void; onRename: (next: string) => void; onGlobal: (enabled: boolean) => void; onDelete: () => void }) {
  const section = (kind: 'visibility' | 'action') => playerControlLabels.filter(([, , group]) => group === kind).map(([key, label]) => <label className="check-row control-check" key={key}><input type="checkbox" checked={control[key]} onChange={(event) => onChange({ ...control, [key]: event.target.checked })}/><span>{label}</span></label>)
  return <aside className="inspector player-control-inspector" data-testid="player-control-inspector">
    <div className="panel-title"><span>再生コントロール</span><button className="icon-button danger" title="設定を削除" onClick={onDelete}><Icon name="trash" size={14}/></button></div>
    <div className="inspector-scroll">
      <div className="node-identity control-identity"><span className="control-glyph"><Icon name="controls" size={15}/></span><div><strong>{controlId}</strong><small>{global ? 'グローバル · ' : ''}{usedBy.length ? `${usedBy.length} ノード` : '未接続'}</small></div></div>
      {issues.length > 0 && <div className="node-issues">{issues.map((issue, index) => <div className={issue.severity} key={index}><Icon name="warning" size={13}/>{issue.message}</div>)}</div>}
      <Section title="設定">
        <Field label="設定ID"><input aria-label="再生設定ID" key={controlId} defaultValue={controlId} onBlur={(event) => onRename(event.target.value.trim())} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/></Field>
        <Field label="グラフカラー"><div className="color-field"><DebouncedColorInput value={control.editor?.color ?? '#4f8c78'} onCommit={(color) => onChange({ ...control, editor: { ...control.editor, color } })}/><input value={control.editor?.color ?? '#4f8c78'} onChange={(event) => onChange({ ...control, editor: { ...control.editor, color: event.target.value } })}/></div></Field>
        <label className="check-row global-control-check"><input type="checkbox" checked={global} onChange={(event) => onGlobal(event.target.checked)}/><span><strong>グローバル設定</strong><small>個別設定がない全Media Nodeへ適用</small></span></label>
        <label className="check-row"><input type="checkbox" checked={Boolean(control.accentColor)} onChange={(event) => onChange({ ...control, accentColor: event.target.checked ? '#8065c4' : undefined })}/><span><strong>プレイヤーのアクセント色</strong><small>白・黒に近すぎない#RRGGBBのみ使用できます</small></span></label>
        {control.accentColor && <Field label="アクセントカラー"><div className="color-field"><DebouncedColorInput value={control.accentColor} onCommit={(accentColor) => onChange({ ...control, accentColor })}/><input aria-label="アクセントカラー" value={control.accentColor} onChange={(event) => onChange({ ...control, accentColor: event.target.value })}/></div></Field>}
      </Section>
      <Section title="表示">{section('visibility')}</Section>
      <Section title="操作">{section('action')}</Section>
      <button className="text-button danger" onClick={onDelete}><Icon name="trash" size={14}/>この設定を削除</button>
    </div>
  </aside>
}

function Inspector({ nodeId, buttonId, graph, graphName, assets, scripts, probabilityMode, issues, onChangeGraph, onChange, onChangeButton, onSetStart, onSetTerminal, onRename, onRenameButton, onDelete, onDeleteButton, onPick, onPickButton, onAddButton, onDetachButton, onAssetDrop, onFolderDrop, onOpenScript }: { nodeId: string | null; buttonId: string | null; graph: WmgGraph; graphName: string; assets: AssetEntry[]; scripts: ScriptDocument[]; probabilityMode: boolean; issues: ValidationIssue[]; onChangeGraph: (graph: WmgGraph) => void; onChange: (node: WmgNode) => void; onChangeButton: (button: WmgButton) => void; onSetStart: (enabled: boolean) => void; onSetTerminal: (enabled: boolean) => void; onRename: (next: string) => void; onRenameButton: (next: string) => void; onDelete: () => void; onDeleteButton: () => void; onPick: (id: string) => void; onPickButton: (id: string) => void; onAddButton: (nodeId: string) => void; onDetachButton: (nodeId: string, buttonId: string) => void; onAssetDrop: (path: string) => void; onFolderDrop: (path: string) => void; onOpenScript: (script: ScriptDocument) => void }) {
  const node = nodeId ? graph.nodes[nodeId] : undefined
  const button = buttonId ? graph.buttons[buttonId] : undefined
  const nodeIds = Object.keys(graph.nodes)
  const nodeLabels = Object.fromEntries(Object.entries(graph.nodes).map(([id, item]) => [id, item.editor?.label || id]))
  if (button && buttonId) {
    const buttonIssues = issues.filter((issue) => issue.buttonId === buttonId)
    const parents = Object.entries(graph.nodes).filter(([, item]) => item.buttons?.includes(buttonId)).map(([id, item]) => item.editor?.label || id)
    return <aside className="inspector button-only-inspector">
      <div className="panel-title"><span>ボタン</span><button className="icon-button danger" title="ボタンを削除" onClick={onDeleteButton}><Icon name="trash" size={14}/></button></div>
      <div className="inspector-scroll">
        <div className="node-identity button-identity"><span className="button-glyph">B</span><div><strong>{button.appearance?.text || buttonId}</strong><small>{parents.length ? parents.join(', ') : '未接続'} · {buttonId}</small></div></div>
        {buttonIssues.length > 0 && <div className="node-issues">{buttonIssues.map((issue, index) => <div className={issue.severity} key={index}><Icon name="warning" size={13}/>{issue.message}</div>)}</div>}
        <div className="button-only-editor"><ButtonEditor buttonId={buttonId} button={button} nodes={nodeIds} nodeLabels={nodeLabels} assets={assets} scripts={scripts} onChange={onChangeButton} onRename={onRenameButton} onRemove={onDeleteButton} onPick={onPick} onOpenScript={onOpenScript}/></div>
      </div>
    </aside>
  }
  if (!node || !nodeId) return <GraphMetadataInspector graph={graph} graphName={graphName} assets={assets} scripts={scripts} onChange={onChangeGraph}/>
  const updateMedia = (index: number, media: MediaCandidate) => onChange({ ...node, media: (node.media ?? []).map((item, itemIndex) => itemIndex === index ? media : item) })
  const nodeIssues = issues.filter((issue) => issue.nodeId === nodeId)
  if (node.type === 'script') return <aside className="inspector script-node-inspector">
    <div className="panel-title"><span>Script Node</span><button className="icon-button danger" title="ノードを削除" onClick={onDelete}><Icon name="trash" size={14}/></button></div>
    <div className="inspector-scroll">
      <div className="node-identity script-node-identity"><span className="node-color" style={{ background: node.editor?.color ?? '#8d65b5' }}><Icon name="script" size={13}/></span><div><strong>{node.editor?.label || nodeId}</strong><small>0秒制御ノード · {nodeId}</small></div></div>
      {nodeIssues.length > 0 && <div className="node-issues">{nodeIssues.map((issue, index) => <div className={issue.severity} key={index}><Icon name="warning" size={13}/>{issue.message}</div>)}</div>}
      <Section title="ノード">
        <Field label="ノードID"><input key={nodeId} defaultValue={nodeId} onBlur={(event) => onRename(event.target.value.trim())} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/></Field>
        <Field label="表示名"><input value={node.editor?.label ?? ''} placeholder={nodeId} onChange={(event) => onChange({ ...node, editor: { ...node.editor, label: event.target.value } })}/></Field>
        <Field label="カラー"><div className="color-field"><DebouncedColorInput value={node.editor?.color ?? '#8d65b5'} onCommit={(color) => onChange({ ...node, editor: { ...node.editor, color } })}/><input value={node.editor?.color ?? '#8d65b5'} onChange={(event) => onChange({ ...node, editor: { ...node.editor, color: event.target.value } })}/></div></Field>
        <label className="check-row"><input type="checkbox" checked={node.start ?? false} onChange={(event) => onSetStart(event.target.checked)}/>開始ノード</label>
      </Section>
      <Section title="Starlark">
        <Field label="スクリプト"><div className="script-reference"><select value={node.script?.path ?? ''} onChange={(event) => onChange({ ...node, script: event.target.value ? { path: event.target.value, function: node.script?.function ?? 'jump' } : undefined })}><option value="">選択してください</option>{scripts.map((script) => <option value={script.path} key={script.uid}>{script.path}</option>)}</select>{node.script?.path && <button className="icon-button" title="スクリプトを開く" onClick={() => { const script = scripts.find((item) => item.path === node.script?.path); if (script) onOpenScript(script) }}><Icon name="script" size={13}/></button>}</div></Field>
        <Field label="関数"><input value={node.script?.function ?? 'jump'} onChange={(event) => onChange({ ...node, script: { path: node.script?.path ?? '', function: event.target.value } })}/></Field>
        <div className="script-node-hint"><Icon name="bug" size={14}/><span>戻り値は接続済みNodeのIDにしてください。エラーまたはNoneの場合は重み付き遷移へフォールバックします。</span></div>
      </Section>
      <Section title="遷移可能な行き先" count={node.onEnd?.length ?? 0} action={<button className="mini-button" disabled={!nodeIds.some((id) => id !== nodeId && !(node.onEnd ?? []).some((transition) => transition.to === id))} onClick={() => { const to = nodeIds.find((id) => id !== nodeId && !(node.onEnd ?? []).some((transition) => transition.to === id)); if (to) onChange({ ...node, onEnd: [...(node.onEnd ?? []), { to, weight: 1 }] }) }}>+ 追加</button>}>
        <TransitionEditor transitions={node.onEnd ?? []} nodes={nodeIds} nodeLabels={nodeLabels} probabilityMode={probabilityMode} onChange={(onEnd) => onChange({ ...node, onEnd })} onPick={onPick}/>
      </Section>
    </div>
  </aside>
  return <aside className="inspector">
    <div className="panel-title"><span>インスペクター</span><button className="icon-button danger" title="ノードを削除" onClick={onDelete}><Icon name="trash" size={14}/></button></div>
    <div className="inspector-scroll">
      <div className="node-identity"><span className="node-color" style={{ background: node.editor?.color ?? '#4676a9' }}/><div><strong>{node.editor?.label || nodeId}</strong><small>{nodeId}</small></div></div>
      {nodeIssues.length > 0 && <div className="node-issues">{nodeIssues.map((issue, index) => <div className={issue.severity} key={index}><Icon name="warning" size={13}/>{issue.message}</div>)}</div>}
      <Section title="ノード">
        <Field label="ノードID"><input key={nodeId} defaultValue={nodeId} onBlur={(event) => onRename(event.target.value.trim())} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/></Field>
        <Field label="表示名"><input value={node.editor?.label ?? ''} placeholder={nodeId} onChange={(event) => onChange({ ...node, editor: { ...node.editor, label: event.target.value } })}/></Field>
        <Field label="カラー"><div className="color-field"><DebouncedColorInput value={node.editor?.color ?? '#4676a9'} onCommit={(color) => onChange({ ...node, editor: { ...node.editor, color } })}/><input value={node.editor?.color ?? '#4676a9'} onChange={(event) => onChange({ ...node, editor: { ...node.editor, color: event.target.value } })}/></div></Field>
        <label className="check-row"><input type="checkbox" checked={node.start ?? false} onChange={(event) => onSetStart(event.target.checked)}/>開始ノード</label>
        <label className="check-row"><input type="checkbox" checked={node.terminal ?? false} onChange={(event) => onSetTerminal(event.target.checked)}/>終端ノード</label>
      </Section>
      <Section title="再生コントロール">
        <Field label="個別設定" hint="未指定時はグローバル設定を使用"><select aria-label="ノードの再生設定" value={node.playerControl ?? ''} onChange={(event) => onChange({ ...node, playerControl: event.target.value || undefined })}><option value="">グローバル（{graph.globalPlayerControl ?? '既定'}）</option>{Object.keys(graph.playerControls ?? {}).map((id) => <option value={id} key={id}>{id}</option>)}</select></Field>
        <div className="empty-inline">上部ポートから設定ノードへ接続できます</div>
      </Section>
      <div className="asset-drop-zone" onDragOver={(event) => { if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); if (path) { event.preventDefault(); onAssetDrop(path) } else if (folder) { event.preventDefault(); onFolderDrop(folder) } }}><Section title="メディア" count={node.media?.length ?? 0} action={<button className="mini-button" onClick={() => onChange({ ...node, media: [...(node.media ?? []), defaultMedia(node.media?.length ?? 0)] })}>+ 追加</button>}>
        {(node.media ?? []).map((media, index) => <MediaEditor key={`${media.id}-${index}`} media={media} index={index} probabilityMode={probabilityMode} assets={assets} onChange={(next) => updateMedia(index, next)} onRemove={() => onChange({ ...node, media: (node.media ?? []).filter((_, itemIndex) => itemIndex !== index) })}/>) }
        {!node.media?.length && <div className="empty-block">このノードはメディアを再生しません</div>}
      </Section></div>
      {!node.terminal && <Section title="再生終了時の遷移" count={node.onEnd?.length ?? 0} action={<button className="mini-button" disabled={!nodeIds.some((id) => id !== nodeId && !(node.onEnd ?? []).some((transition) => transition.to === id))} onClick={() => { const to = nodeIds.find((id) => id !== nodeId && !(node.onEnd ?? []).some((transition) => transition.to === id)); if (to) onChange({ ...node, onEnd: [...(node.onEnd ?? []), { to, weight: 1 }] }) }}>+ 追加</button>}>
        <TransitionEditor transitions={node.onEnd ?? []} nodes={nodeIds} nodeLabels={nodeLabels} probabilityMode={probabilityMode} onChange={(onEnd) => onChange({ ...node, onEnd })} onPick={onPick}/>
      </Section>}
      {!node.terminal && <Section title="接続ボタン" count={node.buttons?.length ?? 0} action={<button className="mini-button" onClick={() => onAddButton(nodeId)}>+ 作成</button>}>
        {(node.buttons ?? []).map((id) => <div className="button-reference" key={id}><button onClick={() => onPickButton(id)}><span className="button-glyph">B</span><span>{graph.buttons[id]?.appearance?.text || id}</span><small>{id}</small></button><button className="icon-button" title="ノードから切断" onClick={() => onDetachButton(nodeId, id)}><Icon name="close" size={12}/></button></div>)}
        {!node.buttons?.length && <div className="empty-block">下部ポートからボタンへ接続できます</div>}
      </Section>}
    </div>
  </aside>
}

type View = { zoom: number; x: number; y: number }
type GraphEdgeRef = { from: string; to: string; index: number; type: 'end' | 'button' | 'attachment' | 'control' }
type ConnectionDraft = { from: string; type: 'end' | 'button' | 'attachment' | 'control'; x: number; y: number }

type GraphCanvasProps = {
  graph: WmgGraph; selectedNode: string | null; selectedButton: string | null; selectedPlayerControl: string | null; probabilityMode: boolean; showWeights: boolean; view: View
  onView: (view: View) => void; onSelectNode: (id: string | null) => void; onSelectButton: (id: string) => void; onSelectPlayerControl: (id: string) => void
  onMoveNode: (id: string, x: number, y: number) => void; onMoveButton: (id: string, x: number, y: number) => void; onMovePlayerControl: (id: string, x: number, y: number) => void
  onAddNode: (x: number, y: number) => void; onAddScriptNode: (x: number, y: number) => void; onAddButton: (x: number, y: number) => void; onAddPlayerControl: (x: number, y: number) => void
  onConnectNode: (from: string, to: string) => void; onConnectButton: (buttonId: string, to: string) => void; onAttachButton: (nodeId: string, buttonId: string) => void; onAttachPlayerControl: (nodeId: string, controlId: string) => void
  onAssetDrop: (path: string, nodeId: string | null, x: number, y: number) => void; onFolderDrop: (path: string, nodeId: string | null, x: number, y: number) => void
  onExternalDrop: (promises: Array<Promise<FileSystemHandle | null>>, x: number, y: number) => void
  onWeightChange: (edge: GraphEdgeRef, value: number, asProbability: boolean) => void; onDisconnect: (edge: GraphEdgeRef) => void; onInsertNode: (edge: GraphEdgeRef) => void
  onDeleteNode: (nodeId: string, bridge: boolean) => void; onDeleteButton: (buttonId: string) => void; onDeletePlayerControl: (controlId: string) => void; onSave: () => void
}

function GraphCanvas({ graph, selectedNode, selectedButton, selectedPlayerControl, probabilityMode, showWeights, view, onView, onSelectNode, onSelectButton, onSelectPlayerControl, onMoveNode, onMoveButton, onMovePlayerControl, onAddNode, onAddScriptNode, onAddButton, onAddPlayerControl, onConnectNode, onConnectButton, onAttachButton, onAttachPlayerControl, onAssetDrop, onFolderDrop, onExternalDrop, onWeightChange, onDisconnect, onInsertNode, onDeleteNode, onDeleteButton, onDeletePlayerControl, onSave }: GraphCanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ type: 'node' | 'button' | 'control' | 'pan'; id?: string; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const draftRef = useRef<ConnectionDraft | null>(null)
  const connectionDragged = useRef(false)
  const [draft, setDraft] = useState<ConnectionDraft | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ edge: GraphEdgeRef; x: number; y: number } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [buttonMenu, setButtonMenu] = useState<{ buttonId: string; x: number; y: number } | null>(null)
  const [controlMenu, setControlMenu] = useState<{ controlId: string; x: number; y: number } | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null)
  const [disconnectMenu, setDisconnectMenu] = useState<{ title: string; edges: GraphEdgeRef[]; x: number; y: number } | null>(null)
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number; label: string; kind: 'folder' | 'media' } | null>(null)
  const nodeEntries = Object.entries(graph.nodes)
  const buttonEntries = Object.entries(graph.buttons)
  const playerControlEntries = Object.entries(graph.playerControls ?? {})
  const transitionEdges = [
    ...nodeEntries.flatMap(([from, node]) => (node.onEnd ?? []).map((transition, index) => ({ from, to: transition.to, transition, index, type: 'end' as const, set: node.onEnd ?? [] }))),
    ...buttonEntries.flatMap(([from, button]) => (button.onPress ?? []).map((transition, index) => ({ from, to: transition.to, transition, index, type: 'button' as const, set: button.onPress ?? [] }))),
  ].filter((edge) => graph.nodes[edge.to])
  const attachmentEdges = nodeEntries.flatMap(([from, node]) => (node.buttons ?? []).map((to, index) => ({ from, to, index, type: 'attachment' as const }))).filter((edge) => graph.buttons[edge.to])
  const controlEdges = nodeEntries.flatMap(([from, node]) => node.playerControl ? [{ from, to: node.playerControl, index: 0, type: 'control' as const }] : []).filter((edge) => graph.playerControls?.[edge.to])
  const edges = [...transitionEdges, ...attachmentEdges, ...controlEdges]
  const edgeRef = (edge: typeof edges[number]): GraphEdgeRef => ({ from: edge.from, to: edge.to, index: edge.index, type: edge.type })
  const isCompactNode = (node: WmgNode) => node.type === 'script' || !(node.media?.length)
  const point = (id: string, side: 'in' | 'out') => {
    const node = graph.nodes[id]
    const compact = isCompactNode(node)
    return { x: (node.editor?.x ?? 0) + (side === 'in' ? 0 : compact ? 156 : 184), y: (node.editor?.y ?? 0) + (compact ? 24 : 35) }
  }
  const nodeButtonPoint = (id: string) => { const node = graph.nodes[id]; return { x: (node.editor?.x ?? 0) + (isCompactNode(node) ? 78 : 92), y: (node.editor?.y ?? 0) + (isCompactNode(node) ? 48 : 84) } }
  const nodeControlPoint = (id: string) => { const node = graph.nodes[id]; return { x: (node.editor?.x ?? 0) + (isCompactNode(node) ? 78 : 92), y: node.editor?.y ?? 0 } }
  const buttonPoint = (id: string, side: 'in' | 'out') => { const button = graph.buttons[id]; return { x: (button.editor?.x ?? 0) + (side === 'in' ? 75 : 150), y: (button.editor?.y ?? 0) + (side === 'in' ? 0 : 23) } }
  const playerControlPoint = (id: string) => { const control = graph.playerControls[id]; return { x: (control.editor?.x ?? 0) + 82, y: (control.editor?.y ?? 0) + 54 } }
  const displayName = (id: string) => graph.nodes[id]?.editor?.label || id
  const buttonName = (id: string) => graph.buttons[id]?.appearance?.text || id
  const controlName = (id: string) => id
  const isDimmed = (edge: typeof edges[number]) => selectedNode ? ['attachment', 'control'].includes(edge.type) ? edge.from !== selectedNode : edge.type === 'end' ? edge.from !== selectedNode && edge.to !== selectedNode : edge.to !== selectedNode : selectedButton ? edge.type === 'attachment' ? edge.to !== selectedButton : edge.type === 'button' ? edge.from !== selectedButton : true : selectedPlayerControl ? edge.type !== 'control' || edge.to !== selectedPlayerControl : false
  const edgeStart = (edge: typeof edges[number]) => edge.type === 'attachment' ? nodeButtonPoint(edge.from) : edge.type === 'control' ? nodeControlPoint(edge.from) : edge.type === 'button' ? buttonPoint(edge.from, 'out') : point(edge.from, 'out')
  const edgeEnd = (edge: typeof edges[number]) => edge.type === 'attachment' ? buttonPoint(edge.to, 'in') : edge.type === 'control' ? playerControlPoint(edge.to) : point(edge.to, 'in')
  const draftStart = (current: ConnectionDraft) => current.type === 'attachment' ? nodeButtonPoint(current.from) : current.type === 'control' ? nodeControlPoint(current.from) : current.type === 'button' ? buttonPoint(current.from, 'out') : point(current.from, 'out')
  const pointerMove = useCallback((event: PointerEvent) => {
    if (draftRef.current) {
      connectionDragged.current = true
      const rect = surface.current?.getBoundingClientRect()
      const next = { ...draftRef.current, x: ((event.clientX - (rect?.left ?? 0)) - view.x) / view.zoom, y: ((event.clientY - (rect?.top ?? 0)) - view.y) / view.zoom }
      draftRef.current = next
      setDraft(next)
      return
    }
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.type === 'pan') onView({ ...view, x: current.originX + dx, y: current.originY + dy })
    else if (current.type === 'node' && current.id) onMoveNode(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
    else if (current.type === 'button' && current.id) onMoveButton(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
    else if (current.type === 'control' && current.id) onMovePlayerControl(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
  }, [onMoveButton, onMoveNode, onMovePlayerControl, onView, view])
  useEffect(() => {
    const up = (event: PointerEvent) => {
      const currentDraft = draftRef.current
      if (currentDraft) {
        const targetElement = document.elementFromPoint(event.clientX, event.clientY)
        if (currentDraft.type === 'attachment') {
          const target = targetElement?.closest<HTMLElement>('.button-input-port')?.dataset.buttonId
          if (target) onAttachButton(currentDraft.from, target)
        } else if (currentDraft.type === 'control') {
          const target = targetElement?.closest<HTMLElement>('.control-input-port')?.dataset.controlId
          if (target) onAttachPlayerControl(currentDraft.from, target)
        } else {
          const target = targetElement?.closest<HTMLElement>('.node-input-port')?.dataset.nodeId
          if (target && (currentDraft.type === 'button' || target !== currentDraft.from)) {
            if (currentDraft.type === 'button') onConnectButton(currentDraft.from, target)
            else onConnectNode(currentDraft.from, target)
          }
        }
        draftRef.current = null
        setDraft(null)
      }
      drag.current = null
    }
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', up) }
  }, [onAttachButton, onAttachPlayerControl, onConnectButton, onConnectNode, pointerMove])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { draftRef.current = null; setDraft(null) }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])
  useEffect(() => {
    const clearDropPreview = () => setDropPreview(null)
    window.addEventListener('drop', clearDropPreview)
    window.addEventListener('dragend', clearDropPreview)
    return () => { window.removeEventListener('drop', clearDropPreview); window.removeEventListener('dragend', clearDropPreview) }
  }, [])
  useEffect(() => {
    const element = surface.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      const worldX = (cursorX - view.x) / view.zoom
      const worldY = (cursorY - view.y) / view.zoom
      const zoom = Math.max(.35, Math.min(2.5, view.zoom * Math.exp(-event.deltaY * .0015)))
      onView({ zoom, x: cursorX - worldX * zoom, y: cursorY - worldY * zoom })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onView, view])
  const localPoint = (clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect()
    return { x: ((clientX - (rect?.left ?? 0)) - view.x) / view.zoom, y: ((clientY - (rect?.top ?? 0)) - view.y) / view.zoom }
  }
  return <div className={`graph-surface ${draft ? 'connecting' : ''}`} ref={surface} onPointerDown={(event) => { setEdgeMenu(null); setNodeMenu(null); setButtonMenu(null); setControlMenu(null); setCanvasMenu(null); setDisconnectMenu(null); if (event.button !== 0 || (event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-control-node, .graph-menu, .wire-weight-editor')) return; drag.current = { type: 'pan', startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y }; onSelectNode(null) }} onContextMenu={(event) => { if ((event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-control-node, .graph-menu, .edge, .wire-weight-editor')) return; event.preventDefault(); const rect = surface.current?.getBoundingClientRect(); const local = localPoint(event.clientX, event.clientY); setCanvasMenu({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), nodeX: local.x - 78, nodeY: local.y - 24 }); setEdgeMenu(null); setNodeMenu(null); setButtonMenu(null); setControlMenu(null); setDisconnectMenu(null) }} onDoubleClick={(event) => { if (!(event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-control-node, .graph-menu, .wire-weight-editor')) { const local = localPoint(event.clientX, event.clientY); onAddNode(local.x - 78, local.y - 24) } }} onDragEnterCapture={(event) => { if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null) }} onDragOverCapture={(event) => { if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null) }} onDragOver={(event) => { if ((event.target as Element).closest?.('.graph-node')) { setDropPreview(null); return } if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; const local = localPoint(event.clientX, event.clientY); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); const rawLabel = path || folder; const fallbackLabel = rawLabel ? (rawLabel === '.' ? 'コンテンツフォルダ' : rawLabel.split('/').filter(Boolean).at(-1)?.replace(/\.[^.]+$/, '') ?? '新規ノード') : 'ドロップして追加'; setDropPreview({ x: local.x, y: local.y, label: activeTreeDrag?.label ?? fallbackLabel, kind: activeTreeDrag?.kind ?? (folder || event.dataTransfer.types.includes('Files') ? 'folder' : 'media') }) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(null) }} onDrop={(event) => { setDropPreview(null); const local = localPoint(event.clientX, event.clientY); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); if (path) { event.preventDefault(); onAssetDrop(path, null, local.x, local.y); return } if (folder) { event.preventDefault(); onFolderDrop(folder, null, local.x, local.y); return } if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); const promises = Array.from(event.dataTransfer.items).map((item) => (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null)); onExternalDrop(promises, local.x, local.y) } }}>
    <div className="graph-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}/>
    <div className="graph-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="edges" width="4000" height="3000" viewBox="0 0 4000 3000">
        <defs><marker id="arrow-end" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-end-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-button" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-button-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-attachment" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path className="arrow-attachment-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-control" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path className="arrow-control-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-draft" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-draft-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker></defs>
        {edges.map((edge) => { const a = edgeStart(edge); const b = edgeEnd(edge); const vertical = edge.type === 'attachment' || edge.type === 'control'; const direction = b.y >= a.y ? 1 : -1; const bend = Math.max(45, Math.abs((vertical ? b.y - a.y : b.x - a.x)) * .45); const path = vertical ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend * direction}, ${b.x} ${b.y - bend * direction}, ${b.x} ${b.y}` : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`; const color = edge.type === 'button' ? graph.buttons[edge.from]?.editor?.color : edge.type === 'control' ? graph.playerControls[edge.to]?.editor?.color : graph.nodes[edge.from]?.editor?.color; return <g className={`edge ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`} style={{ '--edge-color': color ?? '#71808e' } as React.CSSProperties} data-from={edge.from} data-to={edge.to} key={`${edge.from}-${edge.type}-${edge.index}`}><path d={path} markerEnd={`url(#arrow-${edge.type})`}/><path className="edge-hit" d={path} onContextMenu={(event) => { event.preventDefault(); const rect = surface.current?.getBoundingClientRect(); setEdgeMenu({ edge: edgeRef(edge), x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setNodeMenu(null); setButtonMenu(null); setControlMenu(null); setDisconnectMenu(null) }}/></g> })}
        {draft && (() => { const a = draftStart(draft); const vertical = draft.type === 'attachment' || draft.type === 'control'; const direction = draft.y >= a.y ? 1 : -1; const bend = Math.max(45, Math.abs((vertical ? draft.y - a.y : draft.x - a.x)) * .45); const path = vertical ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend * direction}, ${draft.x} ${draft.y - bend * direction}, ${draft.x} ${draft.y}` : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${draft.x - bend} ${draft.y}, ${draft.x} ${draft.y}`; const color = graph.nodes[draft.from]?.editor?.color ?? (draft.type === 'button' ? graph.buttons[draft.from]?.editor?.color : undefined); return <path className="draft-edge" style={{ '--edge-color': color ?? '#55addd' } as React.CSSProperties} d={path} markerEnd="url(#arrow-draft)"/> })()}
      </svg>
      {showWeights && transitionEdges.filter((edge) => edge.set.length > 1).map((edge) => { const a = edgeStart(edge); const b = edgeEnd(edge); return <label className={`wire-weight-editor ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`} data-from={edge.from} data-to={edge.to} style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 - 8 }} key={`editor-${edge.from}-${edge.type}-${edge.index}`} title={probabilityMode ? '遷移確率' : '遷移の重み'} onPointerDown={(event) => event.stopPropagation()}><input type="number" min="0" max={probabilityMode ? 100 : undefined} step={probabilityMode ? .1 : 1} value={probabilityMode ? Number(probability(edge.transition.weight, edge.set).toFixed(1)) : edge.transition.weight} onChange={(event) => onWeightChange(edgeRef(edge), Number(event.target.value), probabilityMode)}/><span>{probabilityMode ? '%' : ''}</span></label> })}
      {nodeEntries.map(([id, node]) => <div key={id} data-node-id={id} className={`graph-node ${isCompactNode(node) ? 'compact' : ''} ${node.type === 'script' ? 'script-node' : ''} ${selectedNode === id ? 'selected' : ''} ${node.terminal ? 'terminal' : ''} ${draft?.from === id && draft.type !== 'button' ? 'source' : ''}`} style={{ left: node.editor?.x ?? 0, top: node.editor?.y ?? 0, '--node-color': node.editor?.color ?? '#4676a9' } as React.CSSProperties} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); onSelectNode(id); drag.current = { type: 'node', id, startX: event.clientX, startY: event.clientY, originX: node.editor?.x ?? 0, originY: node.editor?.y ?? 0 } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const rect = surface.current?.getBoundingClientRect(); setNodeMenu({ nodeId: id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setButtonMenu(null); setDisconnectMenu(null) }} onDragOver={(event) => { if (node.type === 'media' && (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE))) { event.preventDefault(); event.stopPropagation(); setDropPreview(null); event.currentTarget.classList.add('drag-over') } }} onDragLeave={(event) => event.currentTarget.classList.remove('drag-over')} onDrop={(event) => { if (node.type === 'script') return; setDropPreview(null); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); event.currentTarget.classList.remove('drag-over'); if (path) { event.preventDefault(); event.stopPropagation(); onAssetDrop(path, id, node.editor?.x ?? 0, node.editor?.y ?? 0) } else if (folder) { event.preventDefault(); event.stopPropagation(); onFolderDrop(folder, id, node.editor?.x ?? 0, node.editor?.y ?? 0) } }}>
        <div className="node-header"><span className="node-type-icon">{node.start ? <Icon name="play" size={12}/> : node.type === 'script' ? <Icon name="script" size={12}/> : node.terminal ? <Icon name="fit" size={12}/> : <Icon name={isCompactNode(node) ? 'link' : 'dots'} size={13}/>}</span><strong>{node.editor?.label || id}</strong>{isCompactNode(node) && <span className="compact-links"><Icon name={node.type === 'script' ? 'script' : 'link'} size={10}/>{node.type === 'script' ? '0s' : (node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}</span>}<span className="node-badges">{node.start && 'START'}{node.terminal && 'END'}</span></div>
        {!isCompactNode(node) && <div className="node-body"><span><Icon name="media" size={12}/>{node.media?.length ?? 0}</span><span><Icon name="link" size={12}/>{(node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}</span><small>{id}</small></div>}
        {node.type === 'media' && (
          <button className="port node-control-port" title="ドラッグで再生設定を接続" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectNode(id); const start = nodeControlPoint(id); const next: ConnectionDraft = { from: id, type: 'control', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } const attached = controlEdges.filter((edge) => edge.from === id).map(edgeRef); if (attached.length === 1) onDisconnect(attached[0]) }}/>
        )}
        {node.start
          ? <span className="port input disabled" title="開始ノードには入力できません"/>
          : <span className="port input node-input-port" data-node-id={id} title="クリックして接続を解除" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const incoming = transitionEdges.filter((edge) => edge.to === id).map(edgeRef); if (incoming.length === 1) onDisconnect(incoming[0]); else if (incoming.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} への接続`, edges: incoming, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null) } }}/>
        }
        {!node.terminal ? (
          <button className="port output" title="ドラッグで終了時遷移を接続" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectNode(id); const start = point(id, 'out'); const next: ConnectionDraft = { from: id, type: 'end', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } const outgoing = transitionEdges.filter((edge) => edge.type === 'end' && edge.from === id).map(edgeRef); if (outgoing.length === 1) onDisconnect(outgoing[0]); else if (outgoing.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} からの接続`, edges: outgoing, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null) } }}/>
        ) : <span className="port output disabled" title="終端ノードからは出力できません"/>}
        {node.type === 'media' && !node.terminal &&
          <button className="port node-button-port" title="ドラッグでボタンを接続" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectNode(id); const start = nodeButtonPoint(id); const next: ConnectionDraft = { from: id, type: 'attachment', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } const attached = attachmentEdges.filter((edge) => edge.from === id).map(edgeRef); if (attached.length === 1) onDisconnect(attached[0]); else if (attached.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} のボタン`, edges: attached, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
        }
      </div>)}
      {buttonEntries.map(([id, button]) => { const outgoing = transitionEdges.filter((edge) => edge.type === 'button' && edge.from === id).map(edgeRef); const incoming = attachmentEdges.filter((edge) => edge.to === id).map(edgeRef); return <div className={`graph-button-node ${selectedButton === id ? 'selected' : ''} ${draft?.from === id && draft.type === 'button' ? 'source' : ''}`} data-button-id={id} style={{ left: button.editor?.x ?? 0, top: button.editor?.y ?? 0, '--node-color': button.editor?.color ?? '#8b6fa3' } as React.CSSProperties} key={id} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); onSelectButton(id); drag.current = { type: 'button', id, startX: event.clientX, startY: event.clientY, originX: button.editor?.x ?? 0, originY: button.editor?.y ?? 0 } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const rect = surface.current?.getBoundingClientRect(); setButtonMenu({ buttonId: id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null); setDisconnectMenu(null) }}>
        <button className="port button-input-port" data-button-id={id} title="ノードとの接続" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (incoming.length === 1) onDisconnect(incoming[0]); else if (incoming.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${buttonName(id)} を使用するノード`, edges: incoming, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
        <span className="button-glyph">B</span><div><strong>{button.appearance?.text || id}</strong><small>{id} · {incoming.length} ノード · {outgoing.length} 遷移</small></div>
        <button className="port output button-port" title="ドラッグで押下時遷移を作成" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectButton(id); const start = buttonPoint(id, 'out'); const next: ConnectionDraft = { from: id, type: 'button', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } if (outgoing.length === 1) onDisconnect(outgoing[0]); else if (outgoing.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${buttonName(id)} からの接続`, edges: outgoing, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
      </div> })}
      {playerControlEntries.map(([id, control]) => { const incoming = controlEdges.filter((edge) => edge.to === id).map(edgeRef); return <div className={`graph-control-node ${selectedPlayerControl === id ? 'selected' : ''}`} data-control-id={id} style={{ left: control.editor?.x ?? 0, top: control.editor?.y ?? 0, '--node-color': control.editor?.color ?? '#4f8c78' } as React.CSSProperties} key={id} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); onSelectPlayerControl(id); drag.current = { type: 'control', id, startX: event.clientX, startY: event.clientY, originX: control.editor?.x ?? 0, originY: control.editor?.y ?? 0 } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const rect = surface.current?.getBoundingClientRect(); setControlMenu({ controlId: id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null); setButtonMenu(null); setDisconnectMenu(null) }}>
        <span className="control-glyph"><Icon name="controls" size={14}/></span><div><strong>{id}</strong><small>{graph.globalPlayerControl === id ? 'GLOBAL · ' : ''}{incoming.length} ノード</small></div>
        <button className="port control-input-port" data-control-id={id} title="ノードとの設定接続" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (incoming.length === 1) onDisconnect(incoming[0]); else if (incoming.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${controlName(id)} を使用するノード`, edges: incoming, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
      </div> })}
      {dropPreview && <div className="drop-node-preview" style={{ left: dropPreview.x - 92, top: dropPreview.y - 42 }}><span className="preview-node-icon"><Icon name={dropPreview.kind === 'folder' ? 'folder' : 'media'} size={14}/></span><div><strong>{dropPreview.label}</strong><small>{dropPreview.kind === 'folder' ? '音声・動画を一括追加' : 'メディアノードを追加'}</small></div></div>}
    </div>
    {draft && <div className="connect-hint"><Icon name="link" size={14}/>{draft.type === 'attachment' ? 'ボタン上部の入力ポートへドロップ' : draft.type === 'control' ? '上側にある再生設定ノードへドロップ' : 'ノード左側の入力ポートへドロップ'}</div>}
    {edgeMenu && <div className="graph-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{!['attachment', 'control'].includes(edgeMenu.edge.type) && <button onClick={() => { onInsertNode(edgeMenu.edge); setEdgeMenu(null) }}><Icon name="plus" size={13}/>ノードを間に追加</button>}<button onClick={() => { onDisconnect(edgeMenu.edge); setEdgeMenu(null) }}><Icon name="close" size={13}/>接続を解除</button></div>}
    {nodeMenu && <div className="graph-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="danger" onClick={() => { onDeleteNode(nodeMenu.nodeId, false); setNodeMenu(null) }}><Icon name="trash" size={13}/>削除</button><button onClick={() => { onDeleteNode(nodeMenu.nodeId, true); setNodeMenu(null) }}><Icon name="link" size={13}/>前後を接続して削除</button></div>}
    {buttonMenu && <div className="graph-menu" style={{ left: buttonMenu.x, top: buttonMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="danger" onClick={() => { onDeleteButton(buttonMenu.buttonId); setButtonMenu(null) }}><Icon name="trash" size={13}/>ボタンを削除</button></div>}
    {controlMenu && <div className="graph-menu" style={{ left: controlMenu.x, top: controlMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="danger" onClick={() => { onDeletePlayerControl(controlMenu.controlId); setControlMenu(null) }}><Icon name="trash" size={13}/>再生設定を削除</button></div>}
    {canvasMenu && <div className="graph-menu canvas-menu" style={{ left: canvasMenu.x, top: canvasMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button onClick={() => { onAddNode(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><Icon name="plus" size={13}/>メディアノードを作成</button><button onClick={() => { onAddButton(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><span className="button-glyph">B</span>ボタンを作成</button><button onClick={() => { onAddScriptNode(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><Icon name="script" size={13}/>Script Nodeを作成</button><button onClick={() => { onAddPlayerControl(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><Icon name="controls" size={13}/>再生設定を作成</button><button onClick={() => { onSave(); setCanvasMenu(null) }}><Icon name="save" size={13}/>保存</button></div>}
    {disconnectMenu && <div className="graph-menu disconnect-menu" style={{ left: disconnectMenu.x, top: disconnectMenu.y }} onPointerDown={(event) => event.stopPropagation()}><strong>{disconnectMenu.title}</strong>{disconnectMenu.edges.map((edge) => <button key={`${edge.from}-${edge.type}-${edge.index}`} onClick={() => { onDisconnect(edge); setDisconnectMenu(null) }}><Icon name="close" size={12}/><span>{edge.type === 'attachment' ? `${displayName(edge.from)} → ${buttonName(edge.to)}` : edge.type === 'control' ? `${displayName(edge.from)} → ${controlName(edge.to)}` : edge.type === 'button' ? `${buttonName(edge.from)} → ${displayName(edge.to)}` : `${displayName(edge.from)} → ${displayName(edge.to)}`}</span><small>{edge.type === 'attachment' ? 'ボタン接続' : edge.type === 'control' ? '再生設定' : edge.type === 'button' ? '押下時' : '再生終了時'}</small></button>)}</div>}
  </div>
}

function Welcome({ busy, onOpen, onFallback }: { busy: boolean; onOpen: () => void; onFallback: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => { input.current?.setAttribute('webkitdirectory', '') }, [])
  return <main className="welcome">
    <div className="welcome-mark"><span/><span/><span/></div>
    <h1>WMGF Editor</h1>
    <button className="open-folder" onClick={window.showDirectoryPicker ? onOpen : () => input.current?.click()} disabled={busy}><Icon name="folder" size={19}/>{busy ? 'フォルダを読み込み中…' : 'コンテンツフォルダを開く'}</button>
    <button className="welcome-help-button" aria-label="ヘルプ" title="ヘルプ" onClick={() => setShowHelp(!showHelp)}>?</button>
    {showHelp && <div className="welcome-help" role="dialog" aria-label="ヘルプ">
      <header><strong>ヘルプ</strong><button className="icon-button" aria-label="閉じる" onClick={() => setShowHelp(false)}><Icon name="close" size={13}/></button></header>
      <p>WMGFファイルを含むコンテンツフォルダを選択してください。</p>
      <p>{window.showDirectoryPicker ? 'グラフとメディアを読み込み、変更をフォルダへ保存します。' : 'このブラウザでは保存時にJSONファイルをダウンロードします。'}</p>
    </div>}
    <input ref={input} type="file" multiple hidden onChange={(event) => event.target.files && onFallback(event.target.files)}/>
  </main>
}

type TreeFile = { name: string; path: string; document?: GraphDocument; script?: ScriptDocument; asset?: AssetEntry }
type TreeBranch = { folders: Map<string, TreeBranch>; files: TreeFile[] }
type TreeContextTarget = { kind: 'root' | 'folder' | 'graph' | 'script' | 'asset'; path: string; uid?: string }
type TreeExpansionCommand = { id: number; expanded: boolean }
type TreeInlineEdit = {
  mode: 'create' | 'rename'
  kind: 'file' | 'folder' | 'graph' | 'script' | 'asset'
  parentPath: string
  name: string
  source: 'tree' | 'tab'
  target?: TreeContextTarget
}

function InlineNameInput({ edit, testId = 'tree-name-input', onChange, onCommit, onCancel }: { edit: TreeInlineEdit; testId?: string; onChange: (name: string) => void; onCommit: () => Promise<boolean>; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const committing = useRef(false)
  const cancelled = useRef(false)
  const fixedExtension = edit.kind === 'script' ? '.star' : ''
  const commit = async () => {
    if (committing.current || cancelled.current) return
    if (!edit.name.trim()) { onCancel(); return }
    committing.current = true
    const completed = await onCommit()
    committing.current = false
    if (!completed) window.requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
  }
  return <label className="tree-inline-control" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <input ref={input} data-testid={testId} aria-label={edit.mode === 'create' ? '新しい項目の名前' : '新しいファイル名'} autoFocus value={edit.name} spellCheck={false} onChange={(event) => onChange(edit.kind === 'script' ? event.target.value.replace(/(?:\.star)+$/i, '') : event.target.value)} onFocus={(event) => event.currentTarget.select()} onBlur={() => void commit()} onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; onCancel() }
      if (event.key === 'Enter') { event.preventDefault(); void commit() }
    }}/>
    {fixedExtension && <span className="tree-fixed-extension" data-testid="tree-inline-extension">{fixedExtension}</span>}
  </label>
}

function FileTree({ documents, scripts, folders, assets, activeTab, inlineEdit, expansionCommand, getAssetPath, getFolderPath, onOpenGraph, onOpenScript, onPreview, onContextMenu, onInlineChange, onInlineCommit, onInlineCancel, onMoveScript }: { documents: GraphDocument[]; scripts: ScriptDocument[]; folders: WorkspaceFolder[]; assets: AssetEntry[]; activeTab: string | null; inlineEdit: TreeInlineEdit | null; expansionCommand: TreeExpansionCommand; getAssetPath: (asset: AssetEntry) => string; getFolderPath: (path: string) => string; onOpenGraph: (document: GraphDocument) => void; onOpenScript: (script: ScriptDocument) => void; onPreview: (asset: AssetEntry) => void; onContextMenu: (target: TreeContextTarget, event: React.MouseEvent) => void; onInlineChange: (name: string) => void; onInlineCommit: () => Promise<boolean>; onInlineCancel: () => void; onMoveScript: (uid: string, parentPath: string) => Promise<boolean> }) {
  const [query, setQuery] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())
  const [draggedScript, setDraggedScript] = useState<string | null>(null)
  const [scriptDropTarget, setScriptDropTarget] = useState<string | null>(null)
  const treeItems = useRef({ documents, scripts, folders, assets })
  treeItems.current = { documents, scripts, folders, assets }
  useEffect(() => { if (inlineEdit?.source === 'tree') setQuery('') }, [inlineEdit])
  useEffect(() => {
    if (expansionCommand.expanded) { setCollapsedFolders(new Set()); return }
    const paths = new Set(treeItems.current.folders.map((folder) => folder.path))
    ;[...treeItems.current.documents, ...treeItems.current.scripts, ...treeItems.current.assets].forEach((item) => {
      const parts = item.path.split('/').filter(Boolean); parts.pop(); let parent = ''
      parts.forEach((part) => { parent = parent ? `${parent}/${part}` : part; paths.add(parent) })
    })
    setCollapsedFolders(paths)
  }, [expansionCommand])
  const normalizedQuery = normalizeSearchText(query)
  const matches = useCallback((name: string, path: string) => !normalizedQuery || normalizeSearchText(name).includes(normalizedQuery) || normalizeSearchText(path).includes(normalizedQuery), [normalizedQuery])
  const matchCount = documents.filter((item) => matches(item.name, item.path)).length + scripts.filter((item) => matches(item.name, item.path)).length + assets.filter((item) => matches(item.name, item.path)).length + folders.filter((item) => matches(item.path.split('/').at(-1) ?? item.path, item.path)).length
  const tree = useMemo(() => {
    const rootBranch: TreeBranch = { folders: new Map(), files: [] }
    const entries: TreeFile[] = [
      ...documents.map((document) => ({ name: document.name, path: document.path, document })),
      ...scripts.map((script) => ({ name: script.name, path: script.path, script })),
      ...assets.map((asset) => ({ name: asset.name, path: asset.path, asset })),
    ].filter((file) => !normalizedQuery || matches(file.name, file.path))
    entries.forEach((file) => {
      const parts = file.path.split('/').filter(Boolean); parts.pop(); let branch = rootBranch
      parts.forEach((part) => { if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), files: [] }); branch = branch.folders.get(part)! })
      branch.files.push(file)
    })
    folders.forEach((folder) => { let branch = rootBranch; folder.path.split('/').filter(Boolean).forEach((part) => { if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), files: [] }); branch = branch.folders.get(part)! }) })
    return rootBranch
  }, [assets, documents, folders, matches, normalizedQuery, scripts])
  const fileIcon = (file: TreeFile) => file.document ? 'code' : file.script ? 'script' : file.asset?.kind === 'image' ? 'image' : ['audio', 'video'].includes(file.asset?.kind ?? '') ? 'media' : 'file'
  const inlineRow = (edit: TreeInlineEdit, depth: number) => <div className={`tree-entry tree-inline-edit ${edit.kind}`} style={{ paddingLeft: 24 + depth * 13 }} data-tree-kind={edit.kind} data-tree-edit={edit.mode}>
    <Icon name={edit.kind === 'folder' ? 'folder' : edit.kind === 'script' ? 'script' : edit.kind === 'graph' ? 'code' : 'file'} size={13}/>
    <InlineNameInput edit={edit} onChange={onInlineChange} onCommit={onInlineCommit} onCancel={onInlineCancel}/>
  </div>
  const isScriptDrag = (event: React.DragEvent) => event.dataTransfer.types.includes(SCRIPT_DRAG_TYPE)
  const acceptScriptDrop = (parentPath: string, event: React.DragEvent) => {
    if (!isScriptDrag(event)) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setScriptDropTarget(parentPath)
    return true
  }
  const dropScript = (parentPath: string, event: React.DragEvent) => {
    if (!isScriptDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    const scriptUid = event.dataTransfer.getData(SCRIPT_DRAG_TYPE)
    setScriptDropTarget(null)
    setDraggedScript(null)
    if (scriptUid) void onMoveScript(scriptUid, parentPath)
  }
  const renderBranch = (branch: TreeBranch, depth: number, parentPath = ''): React.ReactNode => <>
    {inlineEdit?.source === 'tree' && inlineEdit.mode === 'create' && inlineEdit.parentPath === parentPath && inlineRow(inlineEdit, depth)}
    {[...branch.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => { const path = parentPath ? `${parentPath}/${name}` : name; const containsInlineEdit = inlineEdit?.source === 'tree' && (inlineEdit.parentPath === path || inlineEdit.target?.path === path); return <details className={`tree-folder ${containsInlineEdit ? 'has-inline-edit' : ''}`} open={containsInlineEdit || !collapsedFolders.has(path)} onToggle={(event) => { const shouldCollapse = !event.currentTarget.open; setCollapsedFolders((current) => { if (current.has(path) === shouldCollapse) return current; const next = new Set(current); if (shouldCollapse) next.add(path); else next.delete(path); return next }) }} key={`${depth}-${path}`}>
      <summary className={scriptDropTarget === path ? 'tree-drop-target' : ''} data-tree-kind="folder" data-tree-path={path} draggable onContextMenu={(event) => onContextMenu({ kind: 'folder', path }, event)} onDragStart={(event) => { const dragPath = getFolderPath(path) || '.'; activeTreeDrag = { label: name, kind: 'folder' }; event.dataTransfer.setData(FOLDER_DRAG_TYPE, dragPath); event.dataTransfer.setData('text/plain', dragPath); event.dataTransfer.effectAllowed = 'copy' }} onDragEnd={() => { activeTreeDrag = null }} onDragOver={(event) => { acceptScriptDrop(path, event) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && scriptDropTarget === path) setScriptDropTarget(null) }} onDrop={(event) => dropScript(path, event)} style={{ paddingLeft: 8 + depth * 13 }}><Icon name="chevron" size={11}/><Icon name="folder" size={13}/><span>{name}</span></summary>
      {renderBranch(child, depth + 1, path)}
    </details> })}
    {[...branch.files].sort((a, b) => a.name.localeCompare(b.name)).map((file) => { const key = file.document ? `graph:${file.document.uid}` : file.script ? `script:${file.script.uid}` : ''; const target: TreeContextTarget = file.document ? { kind: 'graph', path: file.path, uid: file.document.uid } : file.script ? { kind: 'script', path: file.path, uid: file.script.uid } : { kind: 'asset', path: file.path }; const fileParent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''; if (inlineEdit?.source === 'tree' && inlineEdit.mode === 'rename' && inlineEdit.target?.path === file.path) return <div key={`edit:${file.path}`}>{inlineRow(inlineEdit, depth)}</div>; return <div className={`tree-entry ${key === activeTab ? 'active' : ''} ${file.script ? 'script' : ''} ${file.script?.uid === draggedScript ? 'dragging' : ''}`} style={{ paddingLeft: 24 + depth * 13 }} key={file.path} data-tree-kind={target.kind} data-tree-path={file.path} onContextMenu={(event) => onContextMenu(target, event)} draggable={Boolean(file.asset || file.script)} onDragOver={(event) => { acceptScriptDrop(fileParent, event) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && scriptDropTarget === fileParent) setScriptDropTarget(null) }} onDrop={(event) => dropScript(fileParent, event)} onDragStart={(event) => { if (file.script) { setDraggedScript(file.script.uid); event.dataTransfer.setData(SCRIPT_DRAG_TYPE, file.script.uid); event.dataTransfer.setData('text/plain', file.path); event.dataTransfer.effectAllowed = 'move'; return } if (!file.asset) return; const path = getAssetPath(file.asset); activeTreeDrag = { label: file.name.replace(/\.[^.]+$/, ''), kind: 'media' }; event.dataTransfer.setData(ASSET_DRAG_TYPE, path); event.dataTransfer.setData('text/plain', path); event.dataTransfer.effectAllowed = 'copy' }} onDragEnd={() => { activeTreeDrag = null; setDraggedScript(null); setScriptDropTarget(null) }}>
      <button className="tree-entry-main" title={file.path} onClick={() => file.document ? onOpenGraph(file.document) : file.script ? onOpenScript(file.script) : file.asset && onPreview(file.asset)}><Icon name={fileIcon(file)} size={13}/><span>{file.name}</span>{(file.document?.dirty || file.script?.dirty) && <i/>}</button>
    </div> })}
  </>
  return <><label className="tree-search"><Icon name="search" size={13}/><input value={query} placeholder="ファイル名を検索" onChange={(event) => setQuery(event.target.value)}/>{query && <button title="検索をクリア" onClick={() => setQuery('')}><Icon name="close" size={11}/></button>}</label><div className={`file-tree ${scriptDropTarget === '' ? 'root-drop-target' : ''}`} data-testid="tree-root-zone" onContextMenu={(event) => { if (event.target === event.currentTarget) onContextMenu({ kind: 'root', path: '' }, event) }} onDragOver={(event) => { if (event.target === event.currentTarget) acceptScriptDrop('', event) }} onDragLeave={(event) => { if (event.target === event.currentTarget && !event.currentTarget.contains(event.relatedTarget as Node | null)) setScriptDropTarget(null) }} onDrop={(event) => { if (event.target === event.currentTarget) dropScript('', event) }}>{matchCount || inlineEdit?.source === 'tree' ? renderBranch(tree, 0) : <div className="tree-empty" onContextMenu={(event) => onContextMenu({ kind: 'root', path: '' }, event)} onDragOver={(event) => { acceptScriptDrop('', event) }} onDrop={(event) => dropScript('', event)}>一致するファイルはありません</div>}</div></>
}

function AssetPreview({ asset, onClose }: { asset: AssetEntry; onClose: () => void }) {
  const [textContent, setTextContent] = useState('')
  const url = useObjectUrl(asset.file)
  useEffect(() => {
    if (asset.kind === 'subtitle' || asset.kind === 'other') void asset.file.text().then(setTextContent)
  }, [asset])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="asset-preview-modal">
      <header><div><Icon name={asset.kind === 'image' ? 'image' : asset.kind === 'other' ? 'file' : 'media'} size={14}/><strong>{asset.name}</strong><span>{asset.path}</span></div><button className="icon-button" aria-label="閉じる" onClick={onClose}><Icon name="close" size={14}/></button></header>
      <div className={`asset-preview-body ${asset.kind}`}>
        {asset.kind === 'image' && url && <img src={url} alt={asset.name}/>}
        {asset.kind === 'video' && url && <video src={url} controls autoPlay/>}
        {asset.kind === 'audio' && url && <AudioFilePreview file={asset.file} path={asset.path} url={url}/>}
        {(asset.kind === 'subtitle' || asset.kind === 'other') && <pre>{textContent}</pre>}
      </div>
      <footer><span>{asset.file.type || '種類不明'}</span><span>{(asset.file.size / 1024).toFixed(asset.file.size > 1024 * 100 ? 0 : 1)} KB</span></footer>
    </div>
  </div>
}

function App() {
  const folderInput = useRef<HTMLInputElement>(null)
  const treeInlineCommit = useRef<TreeInlineEdit | null>(null)
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootName, setRootName] = useState('')
  const [documents, setDocuments] = useState<GraphDocument[]>([])
  const [scripts, setScripts] = useState<ScriptDocument[]>([])
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [tabDropTarget, setTabDropTarget] = useState<{ key: string; side: 'before' | 'after' } | null>(null)
  const [treeExpansionCommand, setTreeExpansionCommand] = useState<TreeExpansionCommand>({ id: 0, expanded: true })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedButton, setSelectedButton] = useState<string | null>(null)
  const [selectedPlayerControl, setSelectedPlayerControl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [weightDisplayMode, setWeightDisplayMode] = useState<'weight' | 'probability' | 'hidden'>('weight')
  const [view, setView] = useState<View>({ zoom: 1, x: 80, y: 65 })
  const [showPreview, setShowPreview] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<AssetEntry | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ kind: 'graph' | 'script'; uid: string; x: number; y: number } | null>(null)
  const [treeMenu, setTreeMenu] = useState<{ target: TreeContextTarget; x: number; y: number } | null>(null)
  const [treeInlineEdit, setTreeInlineEdit] = useState<TreeInlineEdit | null>(null)
  const [scriptTests, setScriptTests] = useState<Record<string, ScriptTestState>>({})
  const [previewHistories, setPreviewHistories] = useState<Record<string, PlaybackHistoryEntry[]>>({})
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem('wmgf-left-width')) || 220)
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem('wmgf-right-width')) || 330)
  const active = documents.find((document) => document.uid === activeUid)
  const activeScriptUid = activeTab?.startsWith('script:') ? activeTab.slice(7) : null
  const activeScript = scripts.find((script) => script.uid === activeScriptUid)
  const probabilityMode = weightDisplayMode === 'probability'
  const docAssets = useMemo(() => active ? relativeAssets(active, assets) : assets, [active, assets])
  const docScripts = useMemo(() => active ? relativeScripts(active, scripts) : scripts, [active, scripts])
  const issues = useMemo(() => active ? validateGraph(active.graph, docAssets, docScripts) : [], [active, docAssets, docScripts])
  const statsSessions = useMemo(() => {
    const history = active ? previewHistories[active.uid] ?? [] : []
    return [...new Set(history.map((entry) => entry.runId))].map((runId) => {
      const entries = history.filter((entry) => entry.runId === runId)
      return { runId, label: `${new Date(entries[0]?.startedAt ?? 0).toLocaleString('ja-JP')} · ${entries.length}件` }
    }).reverse()
  }, [active, previewHistories])
  useEffect(() => { if (selectedNode || selectedButton) setSelectedPlayerControl(null) }, [selectedButton, selectedNode])

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3200) }
  const openGraphTab = (document: GraphDocument) => {
    setOpenTabs((tabs) => tabs.some((tab) => tab.kind === 'graph' && tab.uid === document.uid) ? tabs : [...tabs, { kind: 'graph', uid: document.uid }])
    setActiveTab(`graph:${document.uid}`); setActiveUid(document.uid); setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null)
  }
  const openScriptTab = (script: ScriptDocument) => {
    setOpenTabs((tabs) => tabs.some((tab) => tab.kind === 'script' && tab.uid === script.uid) ? tabs : [...tabs, { kind: 'script', uid: script.uid }])
    setActiveTab(`script:${script.uid}`); setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null)
  }
  const activateTab = (tab: EditorTab) => {
    setActiveTab(`${tab.kind}:${tab.uid}`)
    if (tab.kind === 'graph') setActiveUid(tab.uid)
    setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null)
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
  const reorderTab = (sourceKey: string, targetKey?: string, side: 'before' | 'after' = 'after') => {
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
  const resolveDirectory = useCallback(async (path: string, create = false) => {
    if (!root) return undefined
    let directory = root
    for (const part of path.split('/').filter(Boolean)) directory = await directory.getDirectoryHandle(part, { create })
    return directory
  }, [root])
  const openDirectory = async () => {
    if (!window.showDirectoryPicker) return
    setBusy(true)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const result = await readDirectory(handle)
      const restored = restoreDrafts(handle.name, result.documents)
      const restoredScripts = restoreScriptDrafts(handle.name, result.scripts)
      const first = restored[0]
      treeInlineCommit.current = null; setTreeInlineEdit(null); setTreeMenu(null); setTabMenu(null)
      setRoot(handle); setRootName(handle.name); setDocuments(restored); setScripts(restoredScripts); setFolders(result.folders); setAssets(result.assets)
      setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))
      setActiveUid(first?.uid ?? null); setOpenTabs(first ? [{ kind: 'graph', uid: first.uid }] : []); setActiveTab(first ? `graph:${first.uid}` : null); setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null)
      if (result.errors.length) notify(`${result.errors.length}件のファイルを読み込めませんでした`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify(error instanceof Error ? error.message : 'フォルダを開けませんでした')
    } finally { setBusy(false) }
  }
  const requestOpenDirectory = () => {
    if ((documents.some((document) => document.dirty) || scripts.some((script) => script.dirty)) && !window.confirm('未保存の変更があります。保存せずに新しいフォルダを開きますか？')) return
    if (window.showDirectoryPicker) void openDirectory()
    else folderInput.current?.click()
  }
  const openFallback = async (files: FileList) => {
    setBusy(true)
    const docs: GraphDocument[] = []
    const nextScripts: ScriptDocument[] = []
    const folderPaths = new Set<string>()
    const nextAssets: AssetEntry[] = []
    const list = Array.from(files)
    const commonRoot = list[0]?.webkitRelativePath.split('/')[0] ?? 'content'
    for (const file of list) {
      const rawPath = file.webkitRelativePath || file.name
      const path = rawPath.startsWith(`${commonRoot}/`) ? rawPath.slice(commonRoot.length + 1) : rawPath
      const parts = path.split('/'); parts.pop(); let folder = ''; parts.forEach((part) => { folder = folder ? `${folder}/${part}` : part; if (folder) folderPaths.add(folder) })
      if (path.toLowerCase().endsWith('.wmg.json')) {
        try { docs.push({ uid: uid(), name: file.name, path, graph: normalizeGraph(JSON.parse(await file.text())), dirty: false }) } catch { notify(`${path} を読み込めませんでした`) }
      } else if (path.toLowerCase().endsWith('.star')) nextScripts.push({ uid: uid(), name: file.name, path, content: await file.text(), dirty: false })
      else nextAssets.push({ name: file.name, path, kind: fileKind(path), file })
    }
    const restored = restoreDrafts(commonRoot, docs)
    const restoredScripts = restoreScriptDrafts(commonRoot, nextScripts)
    const first = restored[0]
    treeInlineCommit.current = null; setTreeInlineEdit(null); setTreeMenu(null); setTabMenu(null)
    setRootName(commonRoot); setDocuments(restored); setScripts(restoredScripts); setFolders([...folderPaths].map((path) => ({ path }))); setAssets(nextAssets); setActiveUid(first?.uid ?? null); setOpenTabs(first ? [{ kind: 'graph', uid: first.uid }] : []); setActiveTab(first ? `graph:${first.uid}` : null); setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null); setBusy(false)
    setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))
  }
  const updateActive = useCallback((updater: (document: GraphDocument) => GraphDocument) => {
    setDocuments((current) => current.map((document) => document.uid === activeUid ? updater(document) : document))
  }, [activeUid])
  const updateGraph = useCallback((graph: WmgGraph) => updateActive((document) => ({ ...document, graph, dirty: true })), [updateActive])
  const updateNode = (node: WmgNode) => {
    if (!active || !selectedNode) return
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, current]) => [id, node.start && id !== selectedNode ? { ...current, start: false } : current]))
    nodes[selectedNode] = node
    updateGraph({ ...active.graph, nodes })
  }
  const setSelectedNodeStart = (enabled: boolean) => {
    if (!active || !selectedNode) return
    const current = active.graph.nodes[selectedNode]
    if (!current || Boolean(current.start) === enabled) return
    const incomingCount = Object.values(active.graph.nodes).reduce((count, node) => count + (node.onEnd ?? []).filter((transition) => transition.to === selectedNode).length, 0) + Object.values(active.graph.buttons).reduce((count, button) => count + (button.onPress ?? []).filter((transition) => transition.to === selectedNode).length, 0)
    if (enabled && incomingCount > 0 && !window.confirm('開始ノードにすると入力側の接続は強制的に解除されます。\n続行しますか？')) return
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, node]) => [id, {
      ...node,
      start: enabled ? id === selectedNode : id === selectedNode ? false : node.start,
      onEnd: enabled ? (node.onEnd ?? []).filter((transition) => transition.to !== selectedNode) : node.onEnd,
    }]))
    const buttons = enabled ? Object.fromEntries(Object.entries(active.graph.buttons).map(([id, button]) => [id, { ...button, onPress: (button.onPress ?? []).filter((transition) => transition.to !== selectedNode) }])) : active.graph.buttons
    updateGraph({ ...active.graph, nodes, buttons })
  }
  const setSelectedNodeTerminal = (enabled: boolean) => {
    if (!active || !selectedNode) return
    const current = active.graph.nodes[selectedNode]
    if (!current || current.type === 'script' || Boolean(current.terminal) === enabled) return
    const outgoingCount = (current.onEnd ?? []).length + (current.buttons?.length ?? 0)
    if (enabled && outgoingCount > 0 && !window.confirm('終端ノードにすると出力側の接続は強制的に解除されます。\n続行しますか？')) return
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [selectedNode]: { ...current, terminal: enabled, onEnd: enabled ? [] : current.onEnd, buttons: enabled ? [] : current.buttons } } })
  }
  const renameNode = (next: string) => {
    if (!active || !selectedNode || next === selectedNode) return
    if (!next || active.graph.nodes[next]) { notify(!next ? 'ノードIDは空にできません' : '同じノードIDが既にあります'); return }
    const nodes: Record<string, WmgNode> = {}
    Object.entries(active.graph.nodes).forEach(([id, node]) => { nodes[id === selectedNode ? next : id] = { ...node, onEnd: node.onEnd?.map((transition) => transition.to === selectedNode ? { ...transition, to: next } : transition) } })
    const buttons = Object.fromEntries(Object.entries(active.graph.buttons).map(([id, button]) => [id, { ...button, onPress: button.onPress?.map((transition) => transition.to === selectedNode ? { ...transition, to: next } : transition) }]))
    updateGraph({ ...active.graph, nodes, buttons }); setSelectedNode(next)
  }
  const deleteNodeById = (nodeId: string, bridge = false) => {
    if (!active || !active.graph.nodes[nodeId]) return
    const target = active.graph.nodes[nodeId]
    const outgoing = (target.onEnd ?? []).filter((transition) => transition.to !== nodeId && active.graph.nodes[transition.to])
    const outgoingTotal = outgoing.reduce((sum, transition) => sum + Math.max(0, transition.weight), 0)
    const reconnect = (transitions: Transition[] = []) => {
      const expanded = transitions.flatMap((transition) => {
        if (transition.to !== nodeId) return [transition]
        if (!bridge || !outgoing.length) return []
        return outgoing.map((next) => ({ to: next.to, weight: outgoingTotal > 0 ? transition.weight * Math.max(0, next.weight) / outgoingTotal : transition.weight / outgoing.length }))
      })
      const merged = new Map<string, number>()
      expanded.forEach((transition) => merged.set(transition.to, (merged.get(transition.to) ?? 0) + transition.weight))
      return [...merged].map(([to, weight]) => ({ to, weight: Number(weight.toFixed(4)) }))
    }
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).filter(([id]) => id !== nodeId).map(([id, node]) => [id, { ...node, onEnd: reconnect(node.onEnd) }]))
    const buttons = Object.fromEntries(Object.entries(active.graph.buttons).map(([id, button]) => [id, { ...button, onPress: reconnect(button.onPress) }]))
    if (bridge && target.start && outgoing[0] && nodes[outgoing[0].to]) nodes[outgoing[0].to] = { ...nodes[outgoing[0].to], start: true }
    updateGraph({ ...active.graph, nodes, buttons })
    if (selectedNode === nodeId) setSelectedNode(null)
  }
  const deleteNode = () => { if (selectedNode) deleteNodeById(selectedNode) }
  const updateSelectedButton = (button: WmgButton) => {
    if (!active || !selectedButton || !active.graph.buttons[selectedButton]) return
    updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [selectedButton]: button } })
  }
  const renameButton = (next: string) => {
    if (!active || !selectedButton || next === selectedButton) return
    if (!next || active.graph.buttons[next]) { notify(!next ? 'ボタンIDは空にできません' : '同じボタンIDが既にあります'); return }
    const buttons = Object.fromEntries(Object.entries(active.graph.buttons).map(([id, button]) => [id === selectedButton ? next : id, button]))
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, node]) => [id, { ...node, buttons: node.buttons?.map((buttonId) => buttonId === selectedButton ? next : buttonId) }]))
    updateGraph({ ...active.graph, nodes, buttons })
    setSelectedButton(next)
  }
  const deleteButtonById = (buttonId: string) => {
    if (!active || !active.graph.buttons[buttonId]) return
    const buttons = Object.fromEntries(Object.entries(active.graph.buttons).filter(([id]) => id !== buttonId))
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, node]) => [id, { ...node, buttons: node.buttons?.filter((id) => id !== buttonId) }]))
    updateGraph({ ...active.graph, nodes, buttons })
    if (selectedButton === buttonId) setSelectedButton(null)
  }
  const attachButton = (nodeId: string, buttonId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (!node || node.type === 'script' || node.terminal || !active.graph.buttons[buttonId]) return
    if (node.buttons?.includes(buttonId)) { notify('このノードには既に接続されています'); return }
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, buttons: [...(node.buttons ?? []), buttonId] } } })
  }
  const detachButton = (nodeId: string, buttonId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (node) updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, buttons: node.buttons?.filter((id) => id !== buttonId) } } })
  }

  const updateSelectedPlayerControl = (control: PlayerControlSettings) => {
    if (!active || !selectedPlayerControl || !active.graph.playerControls[selectedPlayerControl]) return
    updateGraph({ ...active.graph, playerControls: { ...active.graph.playerControls, [selectedPlayerControl]: control } })
  }
  const renamePlayerControl = (next: string) => {
    if (!active || !selectedPlayerControl || next === selectedPlayerControl) return
    if (!next || active.graph.playerControls[next]) { notify(!next ? '再生設定IDは空にできません' : '同じ再生設定IDが既にあります'); return }
    const playerControls = Object.fromEntries(Object.entries(active.graph.playerControls).map(([id, control]) => [id === selectedPlayerControl ? next : id, control]))
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, node]) => [id, node.playerControl === selectedPlayerControl ? { ...node, playerControl: next } : node]))
    updateGraph({ ...active.graph, playerControls, nodes, globalPlayerControl: active.graph.globalPlayerControl === selectedPlayerControl ? next : active.graph.globalPlayerControl })
    setSelectedPlayerControl(next)
  }
  const deletePlayerControlById = (controlId: string) => {
    if (!active || !active.graph.playerControls[controlId]) return
    const playerControls = Object.fromEntries(Object.entries(active.graph.playerControls).filter(([id]) => id !== controlId))
    const nodes = Object.fromEntries(Object.entries(active.graph.nodes).map(([id, node]) => [id, node.playerControl === controlId ? { ...node, playerControl: undefined } : node]))
    updateGraph({ ...active.graph, playerControls, nodes, globalPlayerControl: active.graph.globalPlayerControl === controlId ? undefined : active.graph.globalPlayerControl })
    if (selectedPlayerControl === controlId) setSelectedPlayerControl(null)
  }
  const attachPlayerControl = (nodeId: string, controlId: string) => {
    if (!active || !active.graph.playerControls[controlId]) return
    const node = active.graph.nodes[nodeId]
    if (!node || node.type !== 'media') return
    if (node.playerControl === controlId) { notify('このノードには既に接続されています'); return }
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, playerControl: controlId } } })
  }
  const detachPlayerControl = (nodeId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (node?.playerControl) updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, playerControl: undefined } } })
  }

  const updateEdgeSet = (edge: GraphEdgeRef, updater: (transitions: Transition[]) => Transition[]) => {
    if (!active) return
    if (edge.type === 'attachment' || edge.type === 'control') return
    if (edge.type === 'end') {
      const source = active.graph.nodes[edge.from]
      if (!source) return
      updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [edge.from]: { ...source, onEnd: updater(source.onEnd ?? []) } } })
      return
    }
    const button = active.graph.buttons[edge.from]
    if (button) updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [edge.from]: { ...button, onPress: updater(button.onPress ?? []) } } })
  }
  const disconnectEdge = (edge: GraphEdgeRef) => {
    if (edge.type === 'attachment') { detachButton(edge.from, edge.to); return }
    if (edge.type === 'control') { detachPlayerControl(edge.from); return }
    updateEdgeSet(edge, (transitions) => transitions.filter((_, index) => index !== edge.index))
  }
  const changeEdgeWeight = (edge: GraphEdgeRef, value: number, asProbability: boolean) => updateEdgeSet(edge, (transitions) => {
    if (!transitions[edge.index]) return transitions
    if (!asProbability) return transitions.map((transition, index) => index === edge.index ? { ...transition, weight: Math.max(0, value || 0) } : transition)
    if (transitions.length === 1) return [{ ...transitions[0], weight: 1 }]
    const percent = Math.max(0, Math.min(100, value || 0))
    const othersTotal = transitions.reduce((sum, transition, index) => index === edge.index ? sum : sum + Math.max(0, transition.weight), 0)
    return transitions.map((transition, index) => {
      if (index === edge.index) return { ...transition, weight: percent }
      const weight = othersTotal > 0 ? Math.max(0, transition.weight) / othersTotal * (100 - percent) : (100 - percent) / (transitions.length - 1)
      return { ...transition, weight: Number(weight.toFixed(4)) }
    })
  })
  const insertNodeOnEdge = (edge: GraphEdgeRef) => {
    if (!active || edge.type === 'attachment' || edge.type === 'control') return
    const destination = active.graph.nodes[edge.to]
    const sourcePosition = edge.type === 'end' ? active.graph.nodes[edge.from]?.editor : active.graph.buttons[edge.from]?.editor
    if (!sourcePosition || !destination) return
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    const replace = (transitions: Transition[]) => transitions.map((transition, index) => index === edge.index ? { ...transition, to: id } : transition)
    const x = ((sourcePosition.x ?? 0) + (destination.editor?.x ?? 0)) / 2
    const y = ((sourcePosition.y ?? 0) + (destination.editor?.y ?? 0)) / 2
    const node: WmgNode = { type: 'media', media: [], onEnd: [{ to: edge.to, weight: 1 }], buttons: [], editor: { x: Math.round(x), y: Math.round(y), label: `Node ${number}`, color: nextNodeColor(active.graph.nodes) } }
    if (edge.type === 'end') {
      const source = active.graph.nodes[edge.from]
      updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [edge.from]: { ...source, onEnd: replace(source.onEnd ?? []) }, [id]: node } })
    } else {
      const button = active.graph.buttons[edge.from]
      updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: node }, buttons: { ...active.graph.buttons, [edge.from]: { ...button, onPress: replace(button.onPress ?? []) } } })
    }
    setSelectedNode(id)
    setSelectedButton(null)
  }
  const addNode = (x = 160, y = 140) => {
    if (!active) return
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { type: 'media', media: [], onEnd: [], buttons: [], editor: { x: Math.max(20, Math.round(x)), y: Math.max(20, Math.round(y)), label: `Node ${number}`, color: nextNodeColor(active.graph.nodes) } } } })
    setSelectedNode(id)
    setSelectedButton(null)
  }
  const addScriptNode = (x = 160, y = 140) => {
    if (!active) return
    let number = 1
    while (active.graph.nodes[`script-${number}`]) number++
    const id = `script-${number}`
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { type: 'script', script: docScripts[0] ? { path: docScripts[0].path, function: 'jump' } : undefined, onEnd: [], editor: { x: Math.max(20, Math.round(x)), y: Math.max(20, Math.round(y)), label: `Script ${number}`, color: '#8d65b5' } } } })
    setSelectedNode(id); setSelectedButton(null)
    if (!scripts.length) notify('Script Nodeを作成しました。ファイルツリーの右クリックからStarlarkファイルを作成してください')
  }
  const addButton = (x = 210, y = 240, attachToNode?: string) => {
    if (!active) return
    let number = Object.keys(active.graph.buttons).length + 1
    while (active.graph.buttons[`button-${number}`]) number++
    const id = `button-${number}`
    const button: WmgButton = { layout: { x: .7, y: .8, width: .2, height: .1, z: 10 }, appearance: { backgroundColor: '#333333', text: `Button ${number}`, textColor: '#ffffff' }, onPress: [], editor: { x: Math.round(x), y: Math.round(y), color: nextButtonColor(active.graph.buttons) } }
    const nodes = attachToNode && active.graph.nodes[attachToNode] && !active.graph.nodes[attachToNode].terminal ? { ...active.graph.nodes, [attachToNode]: { ...active.graph.nodes[attachToNode], buttons: [...(active.graph.nodes[attachToNode].buttons ?? []), id] } } : active.graph.nodes
    updateGraph({ ...active.graph, nodes, buttons: { ...active.graph.buttons, [id]: button } })
    setSelectedNode(null)
    setSelectedButton(id)
  }
  const addPlayerControl = (x = 160, y = 40) => {
    if (!active) return
    let number = Object.keys(active.graph.playerControls ?? {}).length + 1
    while (active.graph.playerControls[`controls-${number}`]) number++
    const id = `controls-${number}`
    const control: PlayerControlSettings = { ...DEFAULT_PLAYER_CONTROLS, editor: { x: Math.max(20, Math.round(x)), y: Math.max(20, Math.round(y)), color: nextPlayerControlColor(active.graph.playerControls) } }
    updateGraph({ ...active.graph, playerControls: { ...active.graph.playerControls, [id]: control } })
    setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(id)
  }
  const addNodeAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) { addNode(); return }
    addNode((rect.width / 2 - view.x) / view.zoom - 78, (rect.height / 2 - view.y) / view.zoom - 24)
  }
  const addButtonAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) { addButton(); return }
    addButton((rect.width / 2 - view.x) / view.zoom - 75, (rect.height / 2 - view.y) / view.zoom - 21)
  }
  const addScriptNodeAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) { addScriptNode(); return }
    addScriptNode((rect.width / 2 - view.x) / view.zoom - 78, (rect.height / 2 - view.y) / view.zoom - 24)
  }
  const addPlayerControlAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) { addPlayerControl(); return }
    addPlayerControl((rect.width / 2 - view.x) / view.zoom - 82, (rect.height / 2 - view.y) / view.zoom - 27)
  }
  const bindAssetToNode = (nodeId: string, path: string) => {
    if (!active) return
    const asset = docAssets.find((item) => item.path === path)
    const node = active.graph.nodes[nodeId]
    if (!asset || !node || node.type === 'script') return
    const media = [...(node.media ?? [])]
    if (asset.kind === 'subtitle') {
      if (media[0]) media[0] = { ...media[0], source: { ...media[0].source, subtitle: path } }
      else media.push({ ...defaultMedia(0), source: { ...defaultMedia(0).source, subtitle: path } })
    } else if (asset.kind === 'image') {
      let converted = 0
      media.forEach((current, index) => {
        if (current.source.type !== 'audio') return
        media[index] = { ...current, source: { ...current.source, type: 'audioImage', image: path, fit: 'cover', visual: undefined } }
        converted++
      })
      if (!converted) { notify('画像未設定の音声はありません'); return }
    } else if (asset.kind === 'audio') {
      const emptyImageIndex = media.findIndex((item) => item.source.type === 'audioImage' && !item.source.audio)
      if (emptyImageIndex >= 0) media[emptyImageIndex] = { ...media[emptyImageIndex], source: { ...media[emptyImageIndex].source, audio: path } }
      else media.push(mediaForAsset(asset, path, media.length)!)
    } else if (asset.kind === 'video') media.push(mediaForAsset(asset, path, media.length)!)
    else { notify('このファイル形式はノードへ割り当てできません'); return }
    const used = new Set<string>()
    const uniqueMedia = media.map((item) => { const base = item.id; let id = base; let suffix = 2; while (used.has(id)) id = `${base}-${suffix++}`; used.add(id); return id === item.id ? item : { ...item, id } })
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, media: uniqueMedia } } })
    setSelectedNode(nodeId)
  }
  const dropAssetOnGraph = (path: string, nodeId: string | null, x: number, y: number) => {
    if (!active) return
    if (nodeId) { bindAssetToNode(nodeId, path); return }
    const asset = docAssets.find((item) => item.path === path)
    const media = asset ? mediaForAsset(asset, path, 0) : undefined
    if (!asset || !media) { notify('キャンバスへドロップできるのは音声・画像・動画です'); return }
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { type: 'media', media: [media], onEnd: [], buttons: [], editor: { x: Math.round(x - 92), y: Math.round(y - 42), label: asset.name.replace(/\.[^.]+$/, ''), color: nextNodeColor(active.graph.nodes) } } } })
    setSelectedNode(id)
  }
  const folderAssets = (folderPath: string) => {
    const normalized = folderPath === '.' ? '' : folderPath.replace(/\/$/, '')
    return docAssets.filter((asset) => ['audio', 'video'].includes(asset.kind) && (!normalized || asset.path === normalized || asset.path.startsWith(`${normalized}/`)))
  }
  const appendFolderToNode = (nodeId: string, folderPath: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    const folderMedia = folderAssets(folderPath)
    if (!node || node.type === 'script' || !folderMedia.length) { notify('このフォルダに音声・動画がありません'); return }
    const used = new Set((node.media ?? []).map((item) => item.id))
    const additions = folderMedia.map((asset, index) => mediaForAsset(asset, asset.path, (node.media?.length ?? 0) + index)!).map((item) => { const base = item.id; let id = base; let suffix = 2; while (used.has(id)) id = `${base}-${suffix++}`; used.add(id); return id === item.id ? item : { ...item, id } })
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, media: [...(node.media ?? []), ...additions] } } })
    setSelectedNode(nodeId)
    notify(`${additions.length}件の音声・動画を追加しました`)
  }
  const dropFolderOnGraph = (folderPath: string, nodeId: string | null, x: number, y: number) => {
    if (!active) return
    if (nodeId) { appendFolderToNode(nodeId, folderPath); return }
    const folderMedia = folderAssets(folderPath)
    if (!folderMedia.length) { notify('このフォルダに音声・動画がありません'); return }
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    const label = folderPath === '.' ? rootName : folderPath.split('/').filter(Boolean).at(-1) ?? `Node ${number}`
    const media = folderMedia.map((asset, index) => mediaForAsset(asset, asset.path, index)!)
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { type: 'media', media, onEnd: [], buttons: [], editor: { x: Math.round(x - 92), y: Math.round(y - 42), label, color: nextNodeColor(active.graph.nodes) } } } })
    setSelectedNode(id)
    notify(`${media.length}件の音声・動画を追加しました`)
  }
  const importDroppedHandles = async (handlePromises: Array<Promise<FileSystemHandle | null>>, options?: { forceNew?: boolean; x?: number; y?: number }) => {
    try {
      const handles = (await Promise.all(handlePromises)).filter(Boolean) as FileSystemHandle[]
      const collected = (await Promise.all(handles.map((handle) => collectDroppedFiles(handle)))).flat()
      const mediaFiles = collected.filter((item) => ['audio', 'video'].includes(fileKind(item.path)))
      if (!mediaFiles.length) { notify('ドロップしたフォルダに音声・動画がありません'); return }
      const parent = active?.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/') + 1) : ''
      let baseDirectory = root
      if (baseDirectory && parent) {
        for (const part of parent.split('/').filter(Boolean)) baseDirectory = await baseDirectory.getDirectoryHandle(part, { create: true })
      }
      const imported: AssetEntry[] = []
      for (const item of mediaFiles) {
        const relativePath = item.path.replaceAll('\\', '/')
        if (baseDirectory) {
          const parts = relativePath.split('/')
          const fileName = parts.pop()!
          let directory = baseDirectory
          for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
          const handle = await directory.getFileHandle(fileName, { create: true })
          const writable = await handle.createWritable()
          await writable.write(item.file)
          await writable.close()
        }
        imported.push({ name: item.file.name, path: `${parent}${relativePath}`, kind: fileKind(relativePath), file: item.file })
      }
      setAssets((current) => {
        const paths = new Set(imported.map((item) => item.path))
        return [...current.filter((item) => !paths.has(item.path)), ...imported]
      })
      if (active) {
        let targetId = !options?.forceNew && selectedNode && active.graph.nodes[selectedNode]?.type === 'media' ? selectedNode : ''
        const nodes = { ...active.graph.nodes }
        if (!targetId) {
          let number = Object.keys(nodes).length + 1
          while (nodes[`node-${number}`]) number++
          targetId = `node-${number}`
          const sourceName = handles[0]?.name ?? `Node ${number}`
          nodes[targetId] = { type: 'media', media: [], onEnd: [], buttons: [], editor: { x: Math.round(options?.forceNew ? (options.x ?? 252) - 92 : options?.x ?? 160), y: Math.round(options?.forceNew ? (options.y ?? 182) - 42 : options?.y ?? 140), label: sourceName.replace(/\.[^.]+$/, ''), color: nextNodeColor(nodes) } }
        }
        const target = nodes[targetId]
        const additions = imported.map((asset, index) => mediaForAsset(asset, asset.path.slice(parent.length), (target.media?.length ?? 0) + index)!).filter(Boolean)
        const used = new Set((target.media ?? []).map((item) => item.id))
        const unique = additions.map((item) => { const base = item.id; let id = base; let suffix = 2; while (used.has(id)) id = `${base}-${suffix++}`; used.add(id); return id === item.id ? item : { ...item, id } })
        nodes[targetId] = { ...target, media: [...(target.media ?? []), ...unique] }
        updateGraph({ ...active.graph, nodes })
        setSelectedNode(targetId)
      }
      notify(`${mediaFiles.length}件の音声・動画を登録しました`)
    } catch (error) { notify(error instanceof Error ? error.message : 'フォルダを読み込めませんでした') }
  }
  const newDocument = () => {
    let number = documents.length + 1
    while (documents.some((document) => document.name === `graph-${number}.wmg.json`)) number++
    const document: GraphDocument = { uid: uid(), name: `graph-${number}.wmg.json`, path: `graph-${number}.wmg.json`, graph: createGraph(), dirty: true }
    setDocuments((current) => [...current, document]); setOpenTabs((tabs) => [...tabs, { kind: 'graph', uid: document.uid }]); setActiveTab(`graph:${document.uid}`); setActiveUid(document.uid); setSelectedNode('start'); setSelectedButton(null)
  }
  const duplicateDocument = (target: GraphDocument) => {
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const stem = target.name.replace(/\.wmg\.json$/i, '')
    let number = 1
    let name = `${stem}-copy.wmg.json`
    while (documents.some((document) => document.path.toLowerCase() === `${parent}${name}`.toLowerCase())) name = `${stem}-copy-${++number}.wmg.json`
    const copy: GraphDocument = { uid: uid(), name, path: `${parent}${name}`, graph: structuredClone(target.graph), dirty: true }
    setDocuments((current) => current.flatMap((document) => document.uid === target.uid ? [document, copy] : [document]))
    setOpenTabs((tabs) => [...tabs, { kind: 'graph', uid: copy.uid }]); setActiveTab(`graph:${copy.uid}`); setActiveUid(copy.uid)
    setSelectedNode(Object.entries(copy.graph.nodes).find(([, node]) => node.start)?.[0] ?? Object.keys(copy.graph.nodes)[0] ?? null)
    setSelectedButton(null)
    notify(`${target.name} を ${name} として複製しました`)
  }
  const deleteDocument = async (target: GraphDocument) => {
    const unsaved = target.dirty ? '\n未保存の変更も失われます。' : ''
    if (!window.confirm(`「${target.path}」を削除しますか？${unsaved}\nこの操作は元に戻せません。`)) return
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
      if (activeUid === target.uid && activeTab === `graph:${target.uid}`) { setActiveUid(remaining[0]?.uid ?? null); setSelectedNode(null); setSelectedButton(null); setSelectedPlayerControl(null) }
      notify(`${target.name} を削除しました`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'グラフを削除できませんでした')
    }
  }
  const renameDocument = async (target: GraphDocument, requestedName: string) => {
    let name = requestedName.trim()
    if (!name) { notify('ファイル名は空にできません'); return false }
    if (name.includes('/') || name.includes('\\')) { notify('ファイル名にパス区切りは使用できません'); return false }
    if (!name.toLowerCase().endsWith('.wmg.json')) name = `${name.replace(/\.json$/i, '')}.wmg.json`
    if (name === target.name) return true
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const nextPath = `${parent}${name}`
    if (workspacePathExists(nextPath, target.path)) { notify('同じ名前の項目が既にあります'); return false }
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
      setDocuments((current) => current.map((document) => document.uid === target.uid ? { ...document, name, path: nextPath, handle, dirty } : document))
      localStorage.removeItem(draftKey(rootName, target.path))
      notify(`${target.name} を ${name} に変更しました`)
      return true
    } catch (error) { notify(error instanceof Error ? error.message : 'ファイル名を変更できませんでした'); return false }
  }
  const workspacePathExists = (path: string, except?: string) => [
    ...documents.map((item) => item.path), ...scripts.map((item) => item.path), ...assets.map((item) => item.path), ...folders.map((item) => item.path),
  ].some((item) => item !== except && item.toLowerCase() === path.toLowerCase())
  const createWorkspaceEntry = async (parentPath: string, kind: 'file' | 'folder' | 'script', requestedName: string) => {
    let name = requestedName.trim()
    if (!name || name.includes('/') || name.includes('\\')) { notify('有効な名前を入力してください'); return false }
    if (kind === 'script') name = scriptFileName(name)
    if (!name) { notify('有効な名前を入力してください'); return false }
    if (kind === 'file' && name.toLowerCase().endsWith('.star')) { notify('Starlarkスクリプトは専用メニューから作成してください'); return false }
    const path = parentPath ? `${parentPath}/${name}` : name
    if (workspacePathExists(path)) { notify('同じ名前の項目が既にあります'); return false }
    try {
      const directory = await resolveDirectory(parentPath, true)
      if (kind === 'folder') {
        const handle = directory ? await directory.getDirectoryHandle(name, { create: true }) : undefined
        setFolders((items) => [...items, { path, handle }])
        notify(`${path} を作成しました`)
        return true
      }
      const handle = directory ? await directory.getFileHandle(name, { create: true }) : undefined
      if (kind === 'script') {
        const content = defaultScriptSource(name.replace(/\.star$/i, ''))
        if (handle) { const writable = await handle.createWritable(); await writable.write(content); await writable.close() }
        const script: ScriptDocument = { uid: uid(), name, path, content, dirty: !handle, handle }
        setScripts((items) => [...items, script]); openScriptTab(script)
      } else {
        if (handle) { const writable = await handle.createWritable(); await writable.write(''); await writable.close() }
        setAssets((items) => [...items, { name, path, kind: fileKind(path), file: new File([''], name, { type: 'text/plain' }) }])
      }
      notify(`${path} を作成しました`)
      return true
    } catch (error) { notify(error instanceof Error ? error.message : '項目を作成できませんでした'); return false }
  }
  const saveScript = useCallback(async (target: ScriptDocument) => {
    try {
      let handle = target.handle
      if (!handle && root) {
        const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
        const directory = await resolveDirectory(parent, true)
        handle = await directory?.getFileHandle(target.name, { create: true })
      }
      if (handle) {
        const writable = await handle.createWritable(); await writable.write(target.content); await writable.close()
        setScripts((items) => items.map((item) => item.uid === target.uid ? { ...item, handle, dirty: false } : item))
        localStorage.removeItem(scriptDraftKey(rootName, target.path)); notify(`${target.name} を保存しました`)
      } else {
        const url = URL.createObjectURL(new Blob([target.content], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = target.name; link.click(); URL.revokeObjectURL(url)
        setScripts((items) => items.map((item) => item.uid === target.uid ? { ...item, dirty: false } : item)); localStorage.removeItem(scriptDraftKey(rootName, target.path)); notify(`${target.name} をダウンロードしました`)
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'スクリプトを保存できませんでした') }
  }, [resolveDirectory, root, rootName])
  const updateScriptReferences = (oldPath: string, nextPath: string) => {
    setDocuments((items) => items.map((document) => {
      const graphParent = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/') + 1) : ''
      const oldReference = graphParent && oldPath.startsWith(graphParent) ? oldPath.slice(graphParent.length) : oldPath
      const newReference = graphParent && nextPath.startsWith(graphParent) ? nextPath.slice(graphParent.length) : nextPath
      let changed = false
      const nodes = Object.fromEntries(Object.entries(document.graph.nodes).map(([id, node]) => { if (node.script?.path !== oldReference) return [id, node]; changed = true; return [id, { ...node, script: { ...node.script, path: newReference } }] }))
      const buttons = Object.fromEntries(Object.entries(document.graph.buttons).map(([id, button]) => { if (button.render?.path !== oldReference) return [id, button]; changed = true; return [id, { ...button, render: { ...button.render, path: newReference } }] }))
      let playbackStats = document.graph.playbackStats
      if (playbackStats?.path === oldReference) {
        changed = true
        playbackStats = { ...playbackStats, path: newReference }
      }
      return changed ? { ...document, graph: { ...document.graph, nodes, buttons, playbackStats }, dirty: true } : document
    }))
  }
  const relocateScript = async (target: ScriptDocument, destinationParent: string, requestedName: string, action: 'rename' | 'move') => {
    if (requestedName.includes('/') || requestedName.includes('\\')) { notify('有効なファイル名を入力してください'); return false }
    const name = scriptFileName(requestedName)
    if (!name) { notify('有効なファイル名を入力してください'); return false }
    const nextPath = destinationParent ? `${destinationParent}/${name}` : name
    if (nextPath === target.path) return true
    if (nextPath.toLowerCase() === target.path.toLowerCase()) { notify('大文字・小文字だけの名前変更には対応していません'); return false }
    if (workspacePathExists(nextPath, target.path)) { notify('同じ名前の項目が既にあります'); return false }
    try {
      let handle = target.handle
      let dirty = target.dirty
      if (root && target.handle) {
        const oldParent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
        const sourceDirectory = await resolveDirectory(oldParent)
        const destinationDirectory = await resolveDirectory(destinationParent, true)
        const nextHandle = await destinationDirectory?.getFileHandle(name, { create: true })
        if (!nextHandle || !sourceDirectory) throw new Error('移動先のファイルを作成できませんでした')
        const writable = await nextHandle.createWritable()
        await writable.write(target.content)
        await writable.close()
        try {
          await sourceDirectory.removeEntry(target.name)
        } catch (error) {
          try { await destinationDirectory?.removeEntry(name) } catch { /* Best-effort rollback. */ }
          throw error
        }
        handle = nextHandle
        dirty = false
      } else if (!root) dirty = true
      setScripts((items) => items.map((item) => item.uid === target.uid ? { ...item, name, path: nextPath, handle, dirty } : item))
      updateScriptReferences(target.path, nextPath)
      localStorage.removeItem(scriptDraftKey(rootName, target.path))
      if (dirty) {
        try { localStorage.setItem(scriptDraftKey(rootName, nextPath), JSON.stringify({ savedAt: Date.now(), content: target.content })) } catch { /* Storage quota errors must not interrupt editing. */ }
      }
      notify(action === 'move' ? `${target.path} を ${destinationParent || rootName} へ移動しました` : `${target.name} を ${name} に変更しました`)
      return true
    } catch (error) { notify(error instanceof Error ? error.message : action === 'move' ? 'スクリプトを移動できませんでした' : 'スクリプト名を変更できませんでした'); return false }
  }
  const renameScript = (target: ScriptDocument, requestedName: string) => {
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
    return relocateScript(target, parent, requestedName, 'rename')
  }
  const moveScript = async (scriptUid: string, destinationParent: string) => {
    const target = scripts.find((script) => script.uid === scriptUid)
    if (!target) return false
    return relocateScript(target, destinationParent, target.name, 'move')
  }
  const renameAsset = async (target: AssetEntry, requestedName: string) => {
    const name = requestedName.trim()
    if (!name || name.includes('/') || name.includes('\\')) { notify('有効なファイル名を入力してください'); return false }
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const nextPath = `${parent}${name}`
    if (nextPath === target.path) return true
    if (workspacePathExists(nextPath, target.path)) { notify('同じ名前の項目が既にあります'); return false }
    try {
      if (root) {
        const directory = await resolveDirectory(parent)
        const handle = await directory?.getFileHandle(name, { create: true })
        if (handle) { const writable = await handle.createWritable(); await writable.write(target.file); await writable.close(); await directory?.removeEntry(target.name) }
      }
      const nextFile = new File([target.file], name, { type: target.file.type, lastModified: target.file.lastModified })
      setAssets((items) => items.map((item) => item.path === target.path ? { ...item, name, path: nextPath, kind: fileKind(nextPath), file: nextFile } : item))
      setDocuments((items) => items.map((document) => {
        const graphParent = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/') + 1) : ''
        const oldReference = graphParent && target.path.startsWith(graphParent) ? target.path.slice(graphParent.length) : target.path
        const newReference = graphParent && nextPath.startsWith(graphParent) ? nextPath.slice(graphParent.length) : nextPath
        let changed = false
        const replace = (value?: string) => { if (value !== oldReference) return value; changed = true; return newReference }
        const nodes = Object.fromEntries(Object.entries(document.graph.nodes).map(([id, node]) => [id, { ...node, media: node.media?.map((media) => ({ ...media, source: { ...media.source, audio: replace(media.source.audio), image: replace(media.source.image), video: replace(media.source.video), subtitle: replace(media.source.subtitle) } })) }]))
        const buttons = Object.fromEntries(Object.entries(document.graph.buttons).map(([id, button]) => [id, { ...button, appearance: button.appearance ? { ...button.appearance, backgroundImage: replace(button.appearance.backgroundImage) } : undefined }]))
        return changed ? { ...document, graph: { ...document.graph, nodes, buttons }, dirty: true } : document
      }))
      notify(`${target.name} を ${name} に変更しました`)
      return true
    } catch (error) { notify(error instanceof Error ? error.message : 'ファイル名を変更できませんでした'); return false }
  }
  const beginTreeCreate = (target: TreeContextTarget, kind: 'file' | 'folder' | 'script') => {
    const parentPath = target.kind === 'folder' ? target.path : ''
    treeInlineCommit.current = null
    setTreeInlineEdit({ mode: 'create', kind, parentPath, name: '', source: 'tree' })
    setTreeMenu(null)
  }
  const beginTreeRename = (target: TreeContextTarget, source: 'tree' | 'tab') => {
    if (target.kind === 'root' || target.kind === 'folder') return
    const fileName = target.path.split('/').at(-1) ?? ''
    const parentPath = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
    treeInlineCommit.current = null
    setTreeInlineEdit({ mode: 'rename', kind: target.kind, parentPath, name: target.kind === 'script' ? scriptStem(fileName) : fileName, source, target })
    setTreeMenu(null)
    setTabMenu(null)
  }
  const commitTreeInlineEdit = async () => {
    const edit = treeInlineEdit
    if (!edit) return false
    if (treeInlineCommit.current === edit) return false
    treeInlineCommit.current = edit
    let completed = false
    if (edit.mode === 'create' && (edit.kind === 'file' || edit.kind === 'folder' || edit.kind === 'script')) {
      completed = await createWorkspaceEntry(edit.parentPath, edit.kind, edit.name)
    } else if (edit.mode === 'rename' && edit.target) {
      if (edit.target.kind === 'graph') {
        const target = documents.find((item) => item.uid === edit.target?.uid)
        if (target) completed = await renameDocument(target, edit.name)
      } else if (edit.target.kind === 'script') {
        const target = scripts.find((item) => item.uid === edit.target?.uid)
        if (target) completed = await renameScript(target, edit.name)
      } else if (edit.target.kind === 'asset') {
        const target = assets.find((item) => item.path === edit.target?.path)
        if (target) completed = await renameAsset(target, edit.name)
      }
    }
    if (completed) setTreeInlineEdit((current) => current === edit ? null : current)
    else treeInlineCommit.current = null
    return completed
  }
  const deleteWorkspaceTarget = async (target: TreeContextTarget) => {
    const label = target.path || rootName
    if (!window.confirm(`「${label}」を削除しますか？\nこの操作は元に戻せません。`)) return
    try {
      if (target.kind === 'graph') { const document = documents.find((item) => item.uid === target.uid); if (document) await deleteDocument(document); return }
      if (root && target.path) {
        const parts = target.path.split('/'); const name = parts.pop()!; const directory = await resolveDirectory(parts.join('/'))
        await directory?.removeEntry(name, { recursive: target.kind === 'folder' })
      }
      if (target.kind === 'script') {
        const script = scripts.find((item) => item.uid === target.uid)
        if (script) { setScripts((items) => items.filter((item) => item.uid !== script.uid)); closeTab({ kind: 'script', uid: script.uid }); localStorage.removeItem(scriptDraftKey(rootName, script.path)) }
      } else if (target.kind === 'asset') setAssets((items) => items.filter((item) => item.path !== target.path))
      else if (target.kind === 'folder') {
        const prefix = `${target.path}/`
        const removedGraphIds = new Set(documents.filter((item) => item.path.startsWith(prefix)).map((item) => item.uid))
        const removedScriptIds = new Set(scripts.filter((item) => item.path.startsWith(prefix)).map((item) => item.uid))
        setDocuments((items) => items.filter((item) => !item.path.startsWith(prefix))); setScripts((items) => items.filter((item) => !item.path.startsWith(prefix))); setAssets((items) => items.filter((item) => !item.path.startsWith(prefix))); setFolders((items) => items.filter((item) => item.path !== target.path && !item.path.startsWith(prefix)))
        const remainingTabs = openTabs.filter((tab) => tab.kind === 'graph' ? !removedGraphIds.has(tab.uid) : !removedScriptIds.has(tab.uid))
        setOpenTabs(remainingTabs)
        const activeRemoved = activeTab ? (activeTab.startsWith('graph:') ? removedGraphIds.has(activeTab.slice(6)) : removedScriptIds.has(activeTab.slice(7))) : false
        if (activeRemoved) { const next = remainingTabs[0]; setActiveTab(next ? `${next.kind}:${next.uid}` : null); if (next?.kind === 'graph') setActiveUid(next.uid) }
      }
      notify(`${label} を削除しました`)
    } catch (error) { notify(error instanceof Error ? error.message : '削除できませんでした') }
  }
  const save = useCallback(async () => {
    if (!active) return
    try {
      let handle = active.handle
      if (!handle && root) handle = await root.getFileHandle(active.name, { create: true })
      if (handle) {
        const writable = await handle.createWritable(); await writable.write(serialize(active.graph)); await writable.close()
        updateActive((document) => ({ ...document, handle, dirty: false })); localStorage.removeItem(draftKey(rootName, active.path)); notify(`${active.name} を保存しました`)
      } else {
        const blob = new Blob([serialize(active.graph)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url; link.download = active.name; link.click(); URL.revokeObjectURL(url)
        updateActive((document) => ({ ...document, dirty: false })); localStorage.removeItem(draftKey(rootName, active.path)); notify(`${active.name} をダウンロードしました`)
      }
    } catch (error) { notify(error instanceof Error ? error.message : '保存できませんでした') }
  }, [active, root, rootName, updateActive])
  const saveCurrent = useCallback(async () => {
    if (activeScript && activeTab?.startsWith('script:')) await saveScript(activeScript)
    else await save()
  }, [activeScript, activeTab, save, saveScript])
  const updateScriptContent = (script: ScriptDocument, content: string) => setScripts((items) => items.map((item) => item.uid === script.uid ? { ...item, content, dirty: true } : item))
  const testScript = async (script: ScriptDocument, functionName: string, sessionRunId?: string) => {
    setScriptTests((items) => ({ ...items, [script.uid]: { status: 'running', functionName } }))
    try {
      const now = new Date()
      const fallbackRunStartedAt = new Date(now.getTime() - 15_000).toISOString()
      const fallbackHistory: PlaybackHistoryEntry[] = [{
        schemaVersion: 1,
        id: 'sample-history-1',
        runId: 'test-run',
        graphId: active?.path ?? 'preview.wmg.json',
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
      }]
      const previewHistory = active ? previewHistories[active.uid] ?? [] : []
      const selectedHistory = functionName === 'render_stats' && sessionRunId ? previewHistory.filter((entry) => entry.runId === sessionRunId) : []
      const sampleHistory = selectedHistory.length ? selectedHistory : fallbackHistory
      const contextHistory = selectedHistory.length ? previewHistory : sampleHistory
      const runStartedAt = sampleHistory[0]?.startedAt ?? fallbackRunStartedAt
      const baseContext = createStarlarkContext({
        graphId: active?.path ?? 'preview.wmg.json',
        runId: sampleHistory[0]?.runId ?? 'test-run',
        runStartedAt,
        history: contextHistory,
        current: selectedHistory.length ? null : { nodeId: 'preview-node', mediaId: 'preview-media', source: 'audio/preview.mp3', startedAt: new Date(now.getTime() - 1_500).toISOString(), positionMs: 1_250, mediaDurationMs: 60_000, activePlayMs: 1_000 },
        trigger: { type: functionName === 'render_stats' ? 'stats' : 'test', ...(functionName === 'render_stats' ? { runId: sampleHistory[0]?.runId ?? 'test-run' } : {}) },
        now,
      })
      const context = functionName === 'render_stats' ? {
        ...baseContext,
        session: {
          runId: sampleHistory[0]?.runId ?? 'test-run', startedAt: runStartedAt,
          endedAt: selectedHistory.length ? sampleHistory.at(-1)?.endedAt ?? null : null, isActive: !selectedHistory.length,
          entryCount: sampleHistory.length, activePlayMs: sampleHistory.reduce((sum, entry) => sum + entry.activePlayMs, selectedHistory.length ? 0 : 1_000), entries: sampleHistory,
        },
        aggregate: {
          sessionCount: new Set(contextHistory.map((entry) => entry.runId)).size, entryCount: contextHistory.length,
          activePlayMs: contextHistory.reduce((sum, entry) => sum + entry.activePlayMs, selectedHistory.length ? 0 : 1_000),
          firstStartedAt: contextHistory[0]?.startedAt ?? null, lastEndedAt: contextHistory.at(-1)?.endedAt ?? null,
        },
      } : baseContext
      const result = await runStarlark({ scripts, path: script.path, functionName, args: [context], timeoutMs: 1200 })
      setScriptTests((items) => ({ ...items, [script.uid]: { status: 'success', functionName, result: result.value, prints: result.prints, durationMs: result.durationMs } }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const location = parseStarlarkErrorLocation(message)
      setScriptTests((items) => ({ ...items, [script.uid]: { status: 'error', functionName, message, ...location } }))
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
      localStorage.setItem(`wmgf-${side}-width`, String(latestWidth))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const exportJson = () => {
    if (!active) return
    const blob = new Blob([serialize(active.graph)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = active.name; link.click(); URL.revokeObjectURL(url)
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveCurrent() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newDocument() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        if (selectedButton) deleteButtonById(selectedButton)
        else if (selectedPlayerControl) deletePlayerControlById(selectedPlayerControl)
        else if (selectedNode) deleteNode()
      }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => {
    const closeMenus = () => { setShowFileMenu(false); setTabMenu(null); setTreeMenu(null) }
    window.addEventListener('pointerdown', closeMenus)
    return () => window.removeEventListener('pointerdown', closeMenus)
  }, [])
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', '') }, [rootName])
  useEffect(() => {
    if (!rootName) return
    const timer = window.setTimeout(() => {
      documents.forEach((document) => {
        const key = draftKey(rootName, document.path)
        try {
          if (document.dirty) localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), graph: document.graph }))
          else localStorage.removeItem(key)
        } catch { /* Storage quota errors must not interrupt editing. */ }
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
          if (script.dirty) localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), content: script.content }))
          else localStorage.removeItem(key)
        } catch { /* Storage quota errors must not interrupt editing. */ }
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [rootName, scripts])

  if (!rootName) return <><Welcome busy={busy} onOpen={() => void openDirectory()} onFallback={(files) => void openFallback(files)}/>{toast && <div className="toast">{toast}</div>}</>
  return <div className="app-shell" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); const promises = Array.from(event.dataTransfer.items).map((item) => (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null)); void importDroppedHandles(promises) }}>
    <header className="titlebar"><div className="brand"><div className="brand-mark"><span/><span/><span/></div><strong>WMGF</strong><span>Editor</span></div><nav><div className="menu-anchor"><button onPointerDown={(event) => event.stopPropagation()} onClick={() => setShowFileMenu(!showFileMenu)}>ファイル</button>{showFileMenu && <div className="app-menu" onPointerDown={(event) => event.stopPropagation()}><button disabled={!activeTab} onClick={() => { void saveCurrent(); setShowFileMenu(false) }}><Icon name="save" size={13}/><span>保存</span><kbd>Ctrl+S</kbd></button><div className="menu-separator"/><button onClick={() => { setShowFileMenu(false); requestOpenDirectory() }}><Icon name="folder" size={13}/><span>新しいフォルダを開く</span></button></div>}</div></nav><div className="title-actions"><span className="workspace-name"><Icon name="folder" size={13}/>{rootName}</span><button className="toolbar-button" disabled={!activeTab} onClick={() => void saveCurrent()}><Icon name="save" size={14}/>保存</button><button className="primary-button compact" disabled={!active} onClick={() => setShowPreview(true)}><Icon name="play" size={13}/>プレビュー</button></div></header>
    <div className="workspace" style={{ gridTemplateColumns: `${leftWidth}px 4px minmax(360px, 1fr) 4px ${rightWidth}px` }}><Suspense fallback={<div className="workspace-loading">エディタを読み込み中…</div>}>
      <aside className="explorer"><div className="panel-title"><span>ファイル</span><div><button className="icon-button" data-testid="tree-expand-all" title="すべて展開" onClick={() => setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))}><Icon name="expandAll" size={13}/></button><button className="icon-button" data-testid="tree-collapse-all" title="すべて折りたたむ" onClick={() => setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: false }))}><Icon name="collapseAll" size={13}/></button><button className="icon-button" title="新規グラフ" onClick={newDocument}><Icon name="plus" size={14}/></button><button className="icon-button" title="新しいフォルダを開く" onClick={requestOpenDirectory}><Icon name="folder" size={14}/></button></div></div><div className="explorer-scroll">
        <FileTree documents={documents} scripts={scripts} folders={folders} assets={assets} activeTab={activeTab} inlineEdit={treeInlineEdit} expansionCommand={treeExpansionCommand} getAssetPath={(asset) => docAssets.find((item) => item.file === asset.file)?.path ?? asset.path} getFolderPath={(path) => { const parent = active?.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/') + 1) : ''; return parent && path.startsWith(parent) ? path.slice(parent.length) : path }} onOpenGraph={openGraphTab} onOpenScript={openScriptTab} onPreview={setPreviewAsset} onContextMenu={(target, event) => { event.preventDefault(); event.stopPropagation(); setTreeMenu({ target, x: Math.min(event.clientX, window.innerWidth - 250), y: Math.min(event.clientY, window.innerHeight - 210) }) }} onInlineChange={(name) => setTreeInlineEdit((edit) => edit ? { ...edit, name } : edit)} onInlineCommit={commitTreeInlineEdit} onInlineCancel={() => { treeInlineCommit.current = null; setTreeInlineEdit(null) }} onMoveScript={moveScript}/>
      </div><button className="add-file" onClick={(event) => setTreeMenu({ target: { kind: 'root', path: '' }, x: event.clientX, y: event.clientY - 120 })}><Icon name="plus" size={13}/>新規作成</button></aside>
      <div className="resize-handle left" title="ファイルペインの幅を変更" onPointerDown={(event) => beginResize('left', event)}/>
      <main className="editor-area">
        <div className="tabs" data-testid="editor-tabs" onDragOver={(event) => { if (event.target === event.currentTarget && event.dataTransfer.types.includes(TAB_DRAG_TYPE)) { event.preventDefault(); setTabDropTarget(null) } }} onDrop={(event) => { if (event.target === event.currentTarget && event.dataTransfer.types.includes(TAB_DRAG_TYPE)) { event.preventDefault(); reorderTab(event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '') } }}>{openTabs.flatMap((tab) => {
          const item = tab.kind === 'graph' ? documents.find((document) => document.uid === tab.uid) : scripts.find((script) => script.uid === tab.uid)
          if (!item) return []
          const key = `${tab.kind}:${tab.uid}`
          const renaming = treeInlineEdit?.source === 'tab' && treeInlineEdit.mode === 'rename' && treeInlineEdit.target?.uid === tab.uid
          const dropSide = tabDropTarget?.key === key ? tabDropTarget.side : null
          return [<div className={`tab ${key === activeTab ? 'active' : ''} ${tab.kind} ${renaming ? 'renaming' : ''} ${draggedTab === key ? 'dragging' : ''} ${dropSide ? `drop-${dropSide}` : ''}`} key={key} data-tab-key={key} draggable={!renaming} onDragStart={(event) => { event.dataTransfer.setData(TAB_DRAG_TYPE, key); event.dataTransfer.setData('text/plain', item.name); event.dataTransfer.effectAllowed = 'move'; setDraggedTab(key) }} onDragEnd={() => { setDraggedTab(null); setTabDropTarget(null) }} onDragOver={(event) => { if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE) || draggedTab === key) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setTabDropTarget({ key, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' }) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && tabDropTarget?.key === key) setTabDropTarget(null) }} onDrop={(event) => { if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return; event.preventDefault(); event.stopPropagation(); reorderTab(event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '', key, tabDropTarget?.key === key ? tabDropTarget.side : 'before') }} onClick={() => { if (!renaming) activateTab(tab) }} onContextMenu={(event) => { event.preventDefault(); if (!renaming) setTabMenu({ kind: tab.kind, uid: tab.uid, x: Math.min(event.clientX, window.innerWidth - 260), y: Math.min(event.clientY, window.innerHeight - 180) }) }}><Icon name={tab.kind === 'script' ? 'script' : 'code'} size={13}/>{renaming && treeInlineEdit ? <InlineNameInput edit={treeInlineEdit} testId="tab-rename-input" onChange={(name) => setTreeInlineEdit((edit) => edit ? { ...edit, name } : edit)} onCommit={commitTreeInlineEdit} onCancel={() => { treeInlineCommit.current = null; setTreeInlineEdit(null) }}/> : <><span>{item.name}</span>{item.dirty && <i/>}<button draggable={false} aria-label={`${item.name}を閉じる`} title="閉じる（ファイルは削除しません）" onDragStart={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); closeTab(tab) }}><Icon name="close" size={11}/></button></>}</div>]
        })}<button className={`new-tab ${draggedTab && !tabDropTarget ? 'drop-end' : ''}`} title="新規グラフ" onDragOver={(event) => { if (event.dataTransfer.types.includes(TAB_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); setTabDropTarget(null) } }} onDrop={(event) => { if (event.dataTransfer.types.includes(TAB_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); reorderTab(event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '') } }} onClick={newDocument}><Icon name="plus" size={14}/></button></div>
        {activeScript ? <ScriptEditor key={activeScript.uid} script={activeScript} test={scriptTests[activeScript.uid] ?? { status: 'idle' }} statsSessions={statsSessions} onChange={(content) => updateScriptContent(activeScript, content)} onSave={() => void saveScript(activeScript)} onTest={(functionName, sessionRunId) => void testScript(activeScript, functionName, sessionRunId)}/> : active && activeTab?.startsWith('graph:') ? <><div className="graph-toolbar"><div><button className="tool-button" onClick={addNodeAtGraphCenter}><Icon name="plus" size={14}/>メディアNode</button><button className="tool-button" onClick={addButtonAtGraphCenter}><span className="button-glyph">B</span>ボタン</button><button className="tool-button script-tool" onClick={addScriptNodeAtGraphCenter}><Icon name="script" size={14}/>Script Node</button><button className="tool-button control-tool" onClick={addPlayerControlAtGraphCenter}><Icon name="controls" size={14}/>再生設定</button><span className="toolbar-separator"/><button className={`segmented ${weightDisplayMode === 'weight' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('weight')}>重み</button><button className={`segmented ${weightDisplayMode === 'probability' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('probability')}>確率</button><button className={`segmented ${weightDisplayMode === 'hidden' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('hidden')}>非表示</button></div><div><button className="zoom-button" onClick={() => setView({ ...view, zoom: Math.max(.5, view.zoom - .1) })}>−</button><button className="zoom-value" onClick={() => setView({ zoom: 1, x: 80, y: 65 })}>{Math.round(view.zoom * 100)}%</button><button className="zoom-button" onClick={() => setView({ ...view, zoom: Math.min(1.6, view.zoom + .1) })}>＋</button><span className="toolbar-separator"/><button className="tool-button icon-only" title="JSONをエクスポート" onClick={exportJson}><Icon name="code" size={14}/></button></div></div>
          <GraphCanvas
            graph={active.graph}
            selectedNode={selectedNode}
            selectedButton={selectedButton}
            selectedPlayerControl={selectedPlayerControl}
            probabilityMode={probabilityMode}
            showWeights={weightDisplayMode !== 'hidden'}
            view={view}
            onView={setView}
            onSelectNode={(id) => { setSelectedNode(id); setSelectedButton(null); setSelectedPlayerControl(null) }}
            onSelectButton={(id) => { setSelectedButton(id); setSelectedNode(null); setSelectedPlayerControl(null) }}
            onSelectPlayerControl={(id) => { setSelectedPlayerControl(id); setSelectedNode(null); setSelectedButton(null) }}
            onMoveNode={(id, x, y) => { const node = active.graph.nodes[id]; updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { ...node, editor: { ...node.editor, x: Math.round(x), y: Math.round(y) } } } }) }}
            onMoveButton={(id, x, y) => { const button = active.graph.buttons[id]; updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [id]: { ...button, editor: { ...button.editor, x: Math.round(x), y: Math.round(y) } } } }) }}
            onMovePlayerControl={(id, x, y) => { const control = active.graph.playerControls[id]; updateGraph({ ...active.graph, playerControls: { ...active.graph.playerControls, [id]: { ...control, editor: { ...control.editor, x: Math.round(x), y: Math.round(y) } } } }) }}
            onAddNode={addNode}
            onAddScriptNode={addScriptNode}
            onAddButton={(x, y) => addButton(x, y)}
            onAddPlayerControl={addPlayerControl}
            onConnectNode={(from, to) => { const source = active.graph.nodes[from]; if (!source || source.terminal) return; if ((source.onEnd ?? []).some((transition) => transition.to === to)) { notify('このノード間は既に接続されています'); return } updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [from]: { ...source, onEnd: [...(source.onEnd ?? []), { to, weight: 1 }] } } }) }}
            onConnectButton={(buttonId, to) => { const button = active.graph.buttons[buttonId]; if (!button) return; if ((button.onPress ?? []).some((transition) => transition.to === to)) { notify('このボタンから既に接続されています'); return } updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [buttonId]: { ...button, onPress: [...(button.onPress ?? []), { to, weight: 1 }] } } }) }}
            onAttachButton={attachButton}
            onAttachPlayerControl={attachPlayerControl}
            onAssetDrop={dropAssetOnGraph}
            onFolderDrop={dropFolderOnGraph}
            onExternalDrop={(promises, x, y) => void importDroppedHandles(promises, { forceNew: true, x, y })}
            onWeightChange={changeEdgeWeight}
            onDisconnect={disconnectEdge}
            onInsertNode={insertNodeOnEdge}
            onDeleteNode={deleteNodeById}
            onDeleteButton={deleteButtonById}
            onDeletePlayerControl={deletePlayerControlById}
            onSave={() => void save()}
          />
        </> : <div className="no-document"><Icon name="code" size={42}/><strong>開いているタブがありません</strong><span>ファイルツリーからグラフまたはスクリプトを開いてください</span><button className="primary-button" onClick={newDocument}><Icon name="plus" size={14}/>新規グラフ</button></div>}
      </main>
      <div className="resize-handle right" title="インスペクターの幅を変更" onPointerDown={(event) => beginResize('right', event)}/>
      {activeScript ? <ScriptInspector script={activeScript} test={scriptTests[activeScript.uid] ?? { status: 'idle' }} assets={docAssets}/> : active && activeTab?.startsWith('graph:') ? selectedPlayerControl && active.graph.playerControls[selectedPlayerControl] ? <PlayerControlInspector
        controlId={selectedPlayerControl}
        control={active.graph.playerControls[selectedPlayerControl]}
        issues={issues.filter((issue) => issue.playerControlId === selectedPlayerControl)}
        global={active.graph.globalPlayerControl === selectedPlayerControl}
        usedBy={Object.entries(active.graph.nodes).filter(([, node]) => node.playerControl === selectedPlayerControl).map(([id, node]) => node.editor?.label || id)}
        onChange={updateSelectedPlayerControl}
        onRename={renamePlayerControl}
        onGlobal={(enabled) => updateGraph({ ...active.graph, globalPlayerControl: enabled ? selectedPlayerControl : active.graph.globalPlayerControl === selectedPlayerControl ? undefined : active.graph.globalPlayerControl })}
        onDelete={() => deletePlayerControlById(selectedPlayerControl)}
      /> : <Inspector nodeId={selectedNode} buttonId={selectedButton} graph={active.graph} graphName={active.name} assets={docAssets} scripts={docScripts} probabilityMode={probabilityMode} issues={issues} onChangeGraph={updateGraph} onChange={updateNode} onChangeButton={updateSelectedButton} onSetStart={setSelectedNodeStart} onSetTerminal={setSelectedNodeTerminal} onRename={renameNode} onRenameButton={renameButton} onDelete={deleteNode} onDeleteButton={() => selectedButton && deleteButtonById(selectedButton)} onPick={(id) => { setSelectedNode(id); setSelectedButton(null); setSelectedPlayerControl(null) }} onPickButton={(id) => { setSelectedButton(id); setSelectedNode(null); setSelectedPlayerControl(null) }} onAddButton={(nodeId) => { const node = active.graph.nodes[nodeId]; addButton((node.editor?.x ?? 0) + 17, (node.editor?.y ?? 0) + 110, nodeId) }} onDetachButton={detachButton} onAssetDrop={(path) => selectedNode && bindAssetToNode(selectedNode, path)} onFolderDrop={(path) => selectedNode && appendFolderToNode(selectedNode, path)} onOpenScript={openScriptTab}/> : <aside className="inspector"><div className="panel-title"><span>インスペクター</span></div><div className="blank-panel"><Icon name="target" size={30}/></div></aside>}
    </Suspense></div>
    <footer className="statusbar"><button className={issues.some((issue) => issue.severity === 'error') ? 'has-error' : ''} onClick={() => setShowProblems(!showProblems)}>{issues.length ? <Icon name="warning" size={12}/> : <Icon name="check" size={12}/>} {issues.filter((issue) => issue.severity === 'error').length} エラー　{issues.filter((issue) => issue.severity === 'warning').length} 警告</button><div><span>WMGF v1</span><span>{active ? `${Object.keys(active.graph.nodes).length} Node · ${Object.keys(active.graph.buttons).length} Button · ${Object.keys(active.graph.playerControls).length} Controls` : 'グラフなし'}</span><span>{scripts.length} Script · {assets.length} Assets</span></div></footer>
    {showProblems && <div className="problems-panel" style={{ left: leftWidth + 4, right: rightWidth + 4 }}><header><strong>問題</strong><button className="icon-button" onClick={() => setShowProblems(false)}><Icon name="close" size={13}/></button></header>{issues.length ? issues.map((issue, index) => <button key={index} onClick={() => { const script = issue.scriptPath ? docScripts.find((item) => item.path === issue.scriptPath) : undefined; if (script) openScriptTab(script); else { if (active) openGraphTab(active); if (issue.nodeId) { setSelectedNode(issue.nodeId); setSelectedButton(null); setSelectedPlayerControl(null) } else if (issue.buttonId) { setSelectedButton(issue.buttonId); setSelectedNode(null); setSelectedPlayerControl(null) } else if (issue.playerControlId) { setSelectedPlayerControl(issue.playerControlId); setSelectedNode(null); setSelectedButton(null) } } setShowProblems(false) }}><Icon name="warning" size={13}/><span>{issue.message}</span><small>{issue.scriptPath ?? issue.nodeId ?? issue.buttonId ?? issue.playerControlId ?? 'グラフ'}</small></button>) : <div className="problems-empty"><Icon name="check" size={15}/>問題は見つかりませんでした</div>}</div>}
    {showPreview && active && <Preview graph={active.graph} graphId={active.path} assets={docAssets} scripts={docScripts} initialHistory={previewHistories[active.uid] ?? []} onHistoryChange={(history) => setPreviewHistories((current) => ({ ...current, [active.uid]: history }))} onClose={() => setShowPreview(false)}/>}
    {previewAsset && <AssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)}/>}
    {tabMenu && <div className="tab-context-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button onClick={() => { closeTab({ kind: tabMenu.kind, uid: tabMenu.uid }); setTabMenu(null) }}><Icon name="close" size={13}/>タブを閉じる</button>{tabMenu.kind === 'graph' && <button onClick={() => { const target = documents.find((document) => document.uid === tabMenu.uid); if (target) duplicateDocument(target); setTabMenu(null) }}><Icon name="copy" size={13}/>複製</button>}<button onClick={() => { const target = tabMenu.kind === 'graph' ? documents.find((item) => item.uid === tabMenu.uid) : scripts.find((item) => item.uid === tabMenu.uid); if (target) beginTreeRename({ kind: tabMenu.kind, uid: target.uid, path: target.path }, 'tab') }}><Icon name="file" size={13}/>名前を変更</button><button className="danger" onClick={() => { if (tabMenu.kind === 'graph') { const target = documents.find((document) => document.uid === tabMenu.uid); if (target) void deleteDocument(target) } else { const target = scripts.find((script) => script.uid === tabMenu.uid); if (target) void deleteWorkspaceTarget({ kind: 'script', uid: target.uid, path: target.path }) } setTabMenu(null) }}><Icon name="trash" size={13}/>ファイルを削除</button></div>}
    {treeMenu && <div className="tab-context-menu tree-context-menu" style={{ left: treeMenu.x, top: treeMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{treeMenu.target.kind === 'root' || treeMenu.target.kind === 'folder' ? <><label>{treeMenu.target.path || rootName}</label><button onClick={() => beginTreeCreate(treeMenu.target, 'file')}><Icon name="file" size={13}/>ファイルを作成</button><button onClick={() => beginTreeCreate(treeMenu.target, 'folder')}><Icon name="folder" size={13}/>フォルダを作成</button><button onClick={() => beginTreeCreate(treeMenu.target, 'script')}><Icon name="script" size={13}/>Starlarkスクリプトを作成</button>{treeMenu.target.kind === 'folder' && <button className="danger" onClick={() => { void deleteWorkspaceTarget(treeMenu.target); setTreeMenu(null) }}><Icon name="trash" size={13}/>フォルダを削除</button>}</> : <>{treeMenu.target.kind === 'graph' && <button onClick={() => { const target = documents.find((item) => item.uid === treeMenu.target.uid); if (target) duplicateDocument(target); setTreeMenu(null) }}><Icon name="copy" size={13}/>複製</button>}<button onClick={() => beginTreeRename(treeMenu.target, 'tree')}><Icon name="file" size={13}/>名前を変更</button><button className="danger" onClick={() => { if (treeMenu.target.kind === 'graph') { const target = documents.find((item) => item.uid === treeMenu.target.uid); if (target) void deleteDocument(target) } else void deleteWorkspaceTarget(treeMenu.target); setTreeMenu(null) }}><Icon name="trash" size={13}/>削除</button></>}</div>}
    <input ref={folderInput} type="file" multiple hidden onChange={(event) => event.target.files && void openFallback(event.target.files)}/>
    {toast && <div className="toast">{toast}</div>}
  </div>
}

export default App
