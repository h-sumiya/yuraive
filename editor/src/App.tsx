import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { chooseWeighted, createGraph, defaultMedia, fileKind, nextButtonColor, nextNodeColor, normalizeGraph, probability, validateGraph } from './graph'
import type { AssetEntry, GraphDocument, MediaCandidate, Transition, ValidationIssue, WmgButton, WmgGraph, WmgNode } from './types'

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
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></>,
    link: <><path d="M10 14 8 16a4 4 0 0 1-6-6l3-3a4 4 0 0 1 6 0"/><path d="m14 10 2-2a4 4 0 1 1 6 6l-3 3a4 4 0 0 1-6 0M8 12h8"/></>,
    dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    fit: <><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const ASSET_DRAG_TYPE = 'application/x-wmgf-asset-path'
const FOLDER_DRAG_TYPE = 'application/x-wmgf-folder-path'
let activeTreeDrag: { label: string; kind: 'folder' | 'media' } | null = null
const draftKey = (workspace: string, path: string) => `wmgf-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(path)}`
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

const relativeAssets = (document: GraphDocument, assets: AssetEntry[]) => {
  const parent = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/') + 1) : ''
  return assets.map((asset) => ({ ...asset, path: parent && asset.path.startsWith(parent) ? asset.path.slice(parent.length) : asset.path }))
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
  const errors: string[] = []
  const walk = async (directory: FileSystemDirectoryHandle, prefix = '') => {
    for await (const [name, entry] of directory.entries()) {
      const path = `${prefix}${name}`
      if (entry.kind === 'directory') {
        await walk(entry, `${path}/`)
      } else {
        const file = await entry.getFile()
        if (name.toLowerCase().endsWith('.wmg.json')) {
          try {
            documents.push({ uid: uid(), name, path, graph: normalizeGraph(JSON.parse(await file.text())), dirty: false, handle: entry })
          } catch (error) {
            errors.push(`${path}: ${error instanceof Error ? error.message : '読み込めませんでした'}`)
          }
        } else {
          assets.push({ name, path, kind: fileKind(path), file })
        }
      }
    }
  }
  await walk(root)
  return { documents, assets, errors }
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

function ButtonEditor({ buttonId, button, nodes, nodeLabels, assets, onChange, onRename, onRemove, onPick }: { buttonId: string; button: WmgButton; nodes: string[]; nodeLabels: Record<string, string>; assets: AssetEntry[]; onChange: (button: WmgButton) => void; onRename: (next: string) => void; onRemove: () => void; onPick: (id: string) => void }) {
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

function Inspector({ nodeId, buttonId, graph, assets, probabilityMode, issues, onChange, onChangeButton, onSetStart, onSetTerminal, onRename, onRenameButton, onDelete, onDeleteButton, onPick, onPickButton, onAddButton, onDetachButton, onAssetDrop, onFolderDrop }: { nodeId: string | null; buttonId: string | null; graph: WmgGraph; assets: AssetEntry[]; probabilityMode: boolean; issues: ValidationIssue[]; onChange: (node: WmgNode) => void; onChangeButton: (button: WmgButton) => void; onSetStart: (enabled: boolean) => void; onSetTerminal: (enabled: boolean) => void; onRename: (next: string) => void; onRenameButton: (next: string) => void; onDelete: () => void; onDeleteButton: () => void; onPick: (id: string) => void; onPickButton: (id: string) => void; onAddButton: (nodeId: string) => void; onDetachButton: (nodeId: string, buttonId: string) => void; onAssetDrop: (path: string) => void; onFolderDrop: (path: string) => void }) {
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
        <div className="button-only-editor"><ButtonEditor buttonId={buttonId} button={button} nodes={nodeIds} nodeLabels={nodeLabels} assets={assets} onChange={onChangeButton} onRename={onRenameButton} onRemove={onDeleteButton} onPick={onPick}/></div>
      </div>
    </aside>
  }
  if (!node || !nodeId) return <aside className="inspector"><div className="panel-title"><span>インスペクター</span></div><div className="blank-panel"><Icon name="target" size={30}/><span>ノードを選択</span></div></aside>
  const updateMedia = (index: number, media: MediaCandidate) => onChange({ ...node, media: (node.media ?? []).map((item, itemIndex) => itemIndex === index ? media : item) })
  const nodeIssues = issues.filter((issue) => issue.nodeId === nodeId)
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
type GraphEdgeRef = { from: string; to: string; index: number; type: 'end' | 'button' | 'attachment' }
type ConnectionDraft = { from: string; type: 'end' | 'button' | 'attachment'; x: number; y: number }

type GraphCanvasProps = {
  graph: WmgGraph; selectedNode: string | null; selectedButton: string | null; probabilityMode: boolean; showWeights: boolean; view: View
  onView: (view: View) => void; onSelectNode: (id: string | null) => void; onSelectButton: (id: string) => void
  onMoveNode: (id: string, x: number, y: number) => void; onMoveButton: (id: string, x: number, y: number) => void
  onAddNode: (x: number, y: number) => void; onAddButton: (x: number, y: number) => void
  onConnectNode: (from: string, to: string) => void; onConnectButton: (buttonId: string, to: string) => void; onAttachButton: (nodeId: string, buttonId: string) => void
  onAssetDrop: (path: string, nodeId: string | null, x: number, y: number) => void; onFolderDrop: (path: string, nodeId: string | null, x: number, y: number) => void
  onExternalDrop: (promises: Array<Promise<FileSystemHandle | null>>, x: number, y: number) => void
  onWeightChange: (edge: GraphEdgeRef, value: number, asProbability: boolean) => void; onDisconnect: (edge: GraphEdgeRef) => void; onInsertNode: (edge: GraphEdgeRef) => void
  onDeleteNode: (nodeId: string, bridge: boolean) => void; onDeleteButton: (buttonId: string) => void; onSave: () => void
}

function GraphCanvas({ graph, selectedNode, selectedButton, probabilityMode, showWeights, view, onView, onSelectNode, onSelectButton, onMoveNode, onMoveButton, onAddNode, onAddButton, onConnectNode, onConnectButton, onAttachButton, onAssetDrop, onFolderDrop, onExternalDrop, onWeightChange, onDisconnect, onInsertNode, onDeleteNode, onDeleteButton, onSave }: GraphCanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ type: 'node' | 'button' | 'pan'; id?: string; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const draftRef = useRef<ConnectionDraft | null>(null)
  const connectionDragged = useRef(false)
  const [draft, setDraft] = useState<ConnectionDraft | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ edge: GraphEdgeRef; x: number; y: number } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [buttonMenu, setButtonMenu] = useState<{ buttonId: string; x: number; y: number } | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null)
  const [disconnectMenu, setDisconnectMenu] = useState<{ title: string; edges: GraphEdgeRef[]; x: number; y: number } | null>(null)
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number; label: string; kind: 'folder' | 'media' } | null>(null)
  const nodeEntries = Object.entries(graph.nodes)
  const buttonEntries = Object.entries(graph.buttons)
  const transitionEdges = [
    ...nodeEntries.flatMap(([from, node]) => (node.onEnd ?? []).map((transition, index) => ({ from, to: transition.to, transition, index, type: 'end' as const, set: node.onEnd ?? [] }))),
    ...buttonEntries.flatMap(([from, button]) => (button.onPress ?? []).map((transition, index) => ({ from, to: transition.to, transition, index, type: 'button' as const, set: button.onPress ?? [] }))),
  ].filter((edge) => graph.nodes[edge.to])
  const attachmentEdges = nodeEntries.flatMap(([from, node]) => (node.buttons ?? []).map((to, index) => ({ from, to, index, type: 'attachment' as const }))).filter((edge) => graph.buttons[edge.to])
  const edges = [...transitionEdges, ...attachmentEdges]
  const edgeRef = (edge: typeof edges[number]): GraphEdgeRef => ({ from: edge.from, to: edge.to, index: edge.index, type: edge.type })
  const isCompactNode = (node: WmgNode) => !(node.media?.length)
  const point = (id: string, side: 'in' | 'out') => {
    const node = graph.nodes[id]
    const compact = isCompactNode(node)
    return { x: (node.editor?.x ?? 0) + (side === 'in' ? 0 : compact ? 156 : 184), y: (node.editor?.y ?? 0) + (compact ? 24 : 35) }
  }
  const nodeButtonPoint = (id: string) => { const node = graph.nodes[id]; return { x: (node.editor?.x ?? 0) + (isCompactNode(node) ? 78 : 92), y: (node.editor?.y ?? 0) + (isCompactNode(node) ? 48 : 84) } }
  const buttonPoint = (id: string, side: 'in' | 'out') => { const button = graph.buttons[id]; return { x: (button.editor?.x ?? 0) + (side === 'in' ? 75 : 150), y: (button.editor?.y ?? 0) + (side === 'in' ? 0 : 23) } }
  const displayName = (id: string) => graph.nodes[id]?.editor?.label || id
  const buttonName = (id: string) => graph.buttons[id]?.appearance?.text || id
  const isDimmed = (edge: typeof edges[number]) => selectedNode ? edge.type === 'attachment' ? edge.from !== selectedNode : edge.type === 'end' ? edge.from !== selectedNode && edge.to !== selectedNode : edge.to !== selectedNode : selectedButton ? edge.type === 'attachment' ? edge.to !== selectedButton : edge.type === 'button' ? edge.from !== selectedButton : true : false
  const edgeStart = (edge: typeof edges[number]) => edge.type === 'attachment' ? nodeButtonPoint(edge.from) : edge.type === 'button' ? buttonPoint(edge.from, 'out') : point(edge.from, 'out')
  const edgeEnd = (edge: typeof edges[number]) => edge.type === 'attachment' ? buttonPoint(edge.to, 'in') : point(edge.to, 'in')
  const draftStart = (current: ConnectionDraft) => current.type === 'attachment' ? nodeButtonPoint(current.from) : current.type === 'button' ? buttonPoint(current.from, 'out') : point(current.from, 'out')
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
  }, [onMoveButton, onMoveNode, onView, view])
  useEffect(() => {
    const up = (event: PointerEvent) => {
      const currentDraft = draftRef.current
      if (currentDraft) {
        const targetElement = document.elementFromPoint(event.clientX, event.clientY)
        if (currentDraft.type === 'attachment') {
          const target = targetElement?.closest<HTMLElement>('.button-input-port')?.dataset.buttonId
          if (target) onAttachButton(currentDraft.from, target)
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
  }, [onAttachButton, onConnectButton, onConnectNode, pointerMove])
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
  return <div className={`graph-surface ${draft ? 'connecting' : ''}`} ref={surface} onPointerDown={(event) => { setEdgeMenu(null); setNodeMenu(null); setButtonMenu(null); setCanvasMenu(null); setDisconnectMenu(null); if (event.button !== 0 || (event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-menu, .wire-weight-editor')) return; drag.current = { type: 'pan', startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y }; onSelectNode(null) }} onContextMenu={(event) => { if ((event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-menu, .edge, .wire-weight-editor')) return; event.preventDefault(); const rect = surface.current?.getBoundingClientRect(); const local = localPoint(event.clientX, event.clientY); setCanvasMenu({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), nodeX: local.x - 78, nodeY: local.y - 24 }); setEdgeMenu(null); setNodeMenu(null); setButtonMenu(null); setDisconnectMenu(null) }} onDoubleClick={(event) => { if (!(event.target as Element).closest?.('.graph-node, .graph-button-node, .graph-menu, .wire-weight-editor')) { const local = localPoint(event.clientX, event.clientY); onAddNode(local.x - 78, local.y - 24) } }} onDragEnterCapture={(event) => { if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null) }} onDragOverCapture={(event) => { if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null) }} onDragOver={(event) => { if ((event.target as Element).closest?.('.graph-node')) { setDropPreview(null); return } if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; const local = localPoint(event.clientX, event.clientY); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); const rawLabel = path || folder; const fallbackLabel = rawLabel ? (rawLabel === '.' ? 'コンテンツフォルダ' : rawLabel.split('/').filter(Boolean).at(-1)?.replace(/\.[^.]+$/, '') ?? '新規ノード') : 'ドロップして追加'; setDropPreview({ x: local.x, y: local.y, label: activeTreeDrag?.label ?? fallbackLabel, kind: activeTreeDrag?.kind ?? (folder || event.dataTransfer.types.includes('Files') ? 'folder' : 'media') }) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(null) }} onDrop={(event) => { setDropPreview(null); const local = localPoint(event.clientX, event.clientY); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); if (path) { event.preventDefault(); onAssetDrop(path, null, local.x, local.y); return } if (folder) { event.preventDefault(); onFolderDrop(folder, null, local.x, local.y); return } if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); const promises = Array.from(event.dataTransfer.items).map((item) => (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null)); onExternalDrop(promises, local.x, local.y) } }}>
    <div className="graph-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}/>
    <div className="graph-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="edges" width="4000" height="3000" viewBox="0 0 4000 3000">
        <defs><marker id="arrow-end" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-end-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-button" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-button-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-attachment" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path className="arrow-attachment-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker><marker id="arrow-draft" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path className="arrow-draft-shape" d="M 1 1 L 11 6 L 1 11 z"/></marker></defs>
        {edges.map((edge) => { const a = edgeStart(edge); const b = edgeEnd(edge); const vertical = edge.type === 'attachment'; const bend = Math.max(45, Math.abs((vertical ? b.y - a.y : b.x - a.x)) * .45); const path = vertical ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${b.x} ${b.y - bend}, ${b.x} ${b.y}` : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`; const color = edge.type === 'button' ? graph.buttons[edge.from]?.editor?.color : graph.nodes[edge.from]?.editor?.color; return <g className={`edge ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`} style={{ '--edge-color': color ?? '#71808e' } as React.CSSProperties} data-from={edge.from} data-to={edge.to} key={`${edge.from}-${edge.type}-${edge.index}`}><path d={path} markerEnd={`url(#arrow-${edge.type})`}/><path className="edge-hit" d={path} onContextMenu={(event) => { event.preventDefault(); const rect = surface.current?.getBoundingClientRect(); setEdgeMenu({ edge: edgeRef(edge), x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setNodeMenu(null); setButtonMenu(null); setDisconnectMenu(null) }}/></g> })}
        {draft && (() => { const a = draftStart(draft); const vertical = draft.type === 'attachment'; const bend = Math.max(45, Math.abs((vertical ? draft.y - a.y : draft.x - a.x)) * .45); const path = vertical ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${draft.x} ${draft.y - bend}, ${draft.x} ${draft.y}` : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${draft.x - bend} ${draft.y}, ${draft.x} ${draft.y}`; const color = draft.type === 'button' ? graph.buttons[draft.from]?.editor?.color : graph.nodes[draft.from]?.editor?.color; return <path className="draft-edge" style={{ '--edge-color': color ?? '#55addd' } as React.CSSProperties} d={path} markerEnd="url(#arrow-draft)"/> })()}
      </svg>
      {showWeights && transitionEdges.filter((edge) => edge.set.length > 1).map((edge) => { const a = edgeStart(edge); const b = edgeEnd(edge); return <label className={`wire-weight-editor ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`} data-from={edge.from} data-to={edge.to} style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 - 8 }} key={`editor-${edge.from}-${edge.type}-${edge.index}`} title={probabilityMode ? '遷移確率' : '遷移の重み'} onPointerDown={(event) => event.stopPropagation()}><input type="number" min="0" max={probabilityMode ? 100 : undefined} step={probabilityMode ? .1 : 1} value={probabilityMode ? Number(probability(edge.transition.weight, edge.set).toFixed(1)) : edge.transition.weight} onChange={(event) => onWeightChange(edgeRef(edge), Number(event.target.value), probabilityMode)}/><span>{probabilityMode ? '%' : ''}</span></label> })}
      {nodeEntries.map(([id, node]) => <div key={id} data-node-id={id} className={`graph-node ${isCompactNode(node) ? 'compact' : ''} ${selectedNode === id ? 'selected' : ''} ${node.terminal ? 'terminal' : ''} ${draft?.from === id && draft.type !== 'button' ? 'source' : ''}`} style={{ left: node.editor?.x ?? 0, top: node.editor?.y ?? 0, '--node-color': node.editor?.color ?? '#4676a9' } as React.CSSProperties} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); onSelectNode(id); drag.current = { type: 'node', id, startX: event.clientX, startY: event.clientY, originX: node.editor?.x ?? 0, originY: node.editor?.y ?? 0 } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const rect = surface.current?.getBoundingClientRect(); setNodeMenu({ nodeId: id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setButtonMenu(null); setDisconnectMenu(null) }} onDragOver={(event) => { if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); setDropPreview(null); event.currentTarget.classList.add('drag-over') } }} onDragLeave={(event) => event.currentTarget.classList.remove('drag-over')} onDrop={(event) => { setDropPreview(null); const path = event.dataTransfer.getData(ASSET_DRAG_TYPE); const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE); event.currentTarget.classList.remove('drag-over'); if (path) { event.preventDefault(); event.stopPropagation(); onAssetDrop(path, id, node.editor?.x ?? 0, node.editor?.y ?? 0) } else if (folder) { event.preventDefault(); event.stopPropagation(); onFolderDrop(folder, id, node.editor?.x ?? 0, node.editor?.y ?? 0) } }}>
        <div className="node-header"><span className="node-type-icon">{node.start ? <Icon name="play" size={12}/> : node.terminal ? <Icon name="fit" size={12}/> : <Icon name={isCompactNode(node) ? 'link' : 'dots'} size={13}/>}</span><strong>{node.editor?.label || id}</strong>{isCompactNode(node) && <span className="compact-links"><Icon name="link" size={10}/>{(node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}</span>}<span className="node-badges">{node.start && 'START'}{node.terminal && 'END'}</span></div>
        {!isCompactNode(node) && <div className="node-body"><span><Icon name="media" size={12}/>{node.media?.length ?? 0}</span><span><Icon name="link" size={12}/>{(node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}</span><small>{id}</small></div>}
        {node.start
          ? <span className="port input disabled" title="開始ノードには入力できません"/>
          : <span className="port input node-input-port" data-node-id={id} title="クリックして接続を解除" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const incoming = transitionEdges.filter((edge) => edge.to === id).map(edgeRef); if (incoming.length === 1) onDisconnect(incoming[0]); else if (incoming.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} への接続`, edges: incoming, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null) } }}/>
        }
        {!node.terminal ? (
          <button className="port output" title="ドラッグで終了時遷移を接続" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectNode(id); const start = point(id, 'out'); const next: ConnectionDraft = { from: id, type: 'end', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } const outgoing = transitionEdges.filter((edge) => edge.type === 'end' && edge.from === id).map(edgeRef); if (outgoing.length === 1) onDisconnect(outgoing[0]); else if (outgoing.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} からの接続`, edges: outgoing, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null) } }}/>
        ) : <span className="port output disabled" title="終端ノードからは出力できません"/>}
        {!node.terminal &&
          <button className="port node-button-port" title="ドラッグでボタンを接続" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectNode(id); const start = nodeButtonPoint(id); const next: ConnectionDraft = { from: id, type: 'attachment', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } const attached = attachmentEdges.filter((edge) => edge.from === id).map(edgeRef); if (attached.length === 1) onDisconnect(attached[0]); else if (attached.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${displayName(id)} のボタン`, edges: attached, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
        }
      </div>)}
      {buttonEntries.map(([id, button]) => { const outgoing = transitionEdges.filter((edge) => edge.type === 'button' && edge.from === id).map(edgeRef); const incoming = attachmentEdges.filter((edge) => edge.to === id).map(edgeRef); return <div className={`graph-button-node ${selectedButton === id ? 'selected' : ''} ${draft?.from === id && draft.type === 'button' ? 'source' : ''}`} data-button-id={id} style={{ left: button.editor?.x ?? 0, top: button.editor?.y ?? 0, '--node-color': button.editor?.color ?? '#8b6fa3' } as React.CSSProperties} key={id} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); onSelectButton(id); drag.current = { type: 'button', id, startX: event.clientX, startY: event.clientY, originX: button.editor?.x ?? 0, originY: button.editor?.y ?? 0 } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const rect = surface.current?.getBoundingClientRect(); setButtonMenu({ buttonId: id, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); setEdgeMenu(null); setNodeMenu(null); setDisconnectMenu(null) }}>
        <button className="port button-input-port" data-button-id={id} title="ノードとの接続" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (incoming.length === 1) onDisconnect(incoming[0]); else if (incoming.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${buttonName(id)} を使用するノード`, edges: incoming, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
        <span className="button-glyph">B</span><div><strong>{button.appearance?.text || id}</strong><small>{id} · {incoming.length} ノード · {outgoing.length} 遷移</small></div>
        <button className="port output button-port" title="ドラッグで押下時遷移を作成" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); connectionDragged.current = false; onSelectButton(id); const start = buttonPoint(id, 'out'); const next: ConnectionDraft = { from: id, type: 'button', x: start.x, y: start.y }; draftRef.current = next; setDraft(next) }} onClick={(event) => { event.stopPropagation(); if (connectionDragged.current) { connectionDragged.current = false; return } if (outgoing.length === 1) onDisconnect(outgoing[0]); else if (outgoing.length > 1) { const rect = surface.current?.getBoundingClientRect(); setDisconnectMenu({ title: `${buttonName(id)} からの接続`, edges: outgoing, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }) } }}/>
      </div> })}
      {dropPreview && <div className="drop-node-preview" style={{ left: dropPreview.x - 92, top: dropPreview.y - 42 }}><span className="preview-node-icon"><Icon name={dropPreview.kind === 'folder' ? 'folder' : 'media'} size={14}/></span><div><strong>{dropPreview.label}</strong><small>{dropPreview.kind === 'folder' ? '音声・動画を一括追加' : 'メディアノードを追加'}</small></div></div>}
    </div>
    {draft && <div className="connect-hint"><Icon name="link" size={14}/>{draft.type === 'attachment' ? 'ボタン上部の入力ポートへドロップ' : 'ノード左側の入力ポートへドロップ'}</div>}
    {edgeMenu && <div className="graph-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{edgeMenu.edge.type !== 'attachment' && <button onClick={() => { onInsertNode(edgeMenu.edge); setEdgeMenu(null) }}><Icon name="plus" size={13}/>ノードを間に追加</button>}<button onClick={() => { onDisconnect(edgeMenu.edge); setEdgeMenu(null) }}><Icon name="close" size={13}/>接続を解除</button></div>}
    {nodeMenu && <div className="graph-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="danger" onClick={() => { onDeleteNode(nodeMenu.nodeId, false); setNodeMenu(null) }}><Icon name="trash" size={13}/>削除</button><button onClick={() => { onDeleteNode(nodeMenu.nodeId, true); setNodeMenu(null) }}><Icon name="link" size={13}/>前後を接続して削除</button></div>}
    {buttonMenu && <div className="graph-menu" style={{ left: buttonMenu.x, top: buttonMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="danger" onClick={() => { onDeleteButton(buttonMenu.buttonId); setButtonMenu(null) }}><Icon name="trash" size={13}/>ボタンを削除</button></div>}
    {canvasMenu && <div className="graph-menu canvas-menu" style={{ left: canvasMenu.x, top: canvasMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button onClick={() => { onAddNode(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><Icon name="plus" size={13}/>ノードを作成</button><button onClick={() => { onAddButton(canvasMenu.nodeX, canvasMenu.nodeY); setCanvasMenu(null) }}><span className="button-glyph">B</span>ボタンを作成</button><button onClick={() => { onSave(); setCanvasMenu(null) }}><Icon name="save" size={13}/>保存</button></div>}
    {disconnectMenu && <div className="graph-menu disconnect-menu" style={{ left: disconnectMenu.x, top: disconnectMenu.y }} onPointerDown={(event) => event.stopPropagation()}><strong>{disconnectMenu.title}</strong>{disconnectMenu.edges.map((edge) => <button key={`${edge.from}-${edge.type}-${edge.index}`} onClick={() => { onDisconnect(edge); setDisconnectMenu(null) }}><Icon name="close" size={12}/><span>{edge.type === 'attachment' ? `${displayName(edge.from)} → ${buttonName(edge.to)}` : edge.type === 'button' ? `${buttonName(edge.from)} → ${displayName(edge.to)}` : `${displayName(edge.from)} → ${displayName(edge.to)}`}</span><small>{edge.type === 'attachment' ? 'ボタン接続' : edge.type === 'button' ? '押下時' : '再生終了時'}</small></button>)}</div>}
  </div>
}

const resolvePreviewNode = (graph: WmgGraph, firstNodeId: string) => {
  let nodeId = firstNodeId
  const visited = new Set<string>()
  while (graph.nodes[nodeId] && !visited.has(nodeId)) {
    visited.add(nodeId)
    const node = graph.nodes[nodeId]
    const candidate = chooseWeighted(node.media ?? [])
    if (candidate || node.terminal || (node.buttons ?? []).some((buttonId) => graph.buttons[buttonId]) || !(node.onEnd?.length)) return { nodeId, candidate }
    const next = chooseWeighted(node.onEnd)
    if (!next || !graph.nodes[next.to]) return { nodeId, candidate }
    nodeId = next.to
  }
  return { nodeId, candidate: undefined }
}

function Preview({ graph, assets, onClose }: { graph: WmgGraph; assets: AssetEntry[]; onClose: () => void }) {
  const start = Object.entries(graph.nodes).find(([, node]) => node.start)?.[0] ?? Object.keys(graph.nodes)[0]
  const [current, setCurrent] = useState(() => resolvePreviewNode(graph, start))
  const { nodeId, candidate } = current
  const node = graph.nodes[nodeId]
  const asset = (path?: string) => assets.find((item) => item.path === path)?.file
  const mediaFile = candidate?.source.type === 'video' ? asset(candidate.source.video) : asset(candidate?.source.audio)
  const imageFile = candidate?.source.type === 'audioImage' ? asset(candidate.source.image) : undefined
  const mediaUrl = useObjectUrl(mediaFile)
  const imageUrl = useObjectUrl(imageFile)
  const [buttonImageUrls, setButtonImageUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const paths = new Set(Object.values(graph.buttons).map((button) => button.appearance?.backgroundImage).filter(Boolean) as string[])
    const next = Object.fromEntries([...paths].flatMap((path) => { const file = assets.find((item) => item.path === path)?.file; return file ? [[path, URL.createObjectURL(file)]] : [] }))
    setButtonImageUrls(next)
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url))
  }, [assets, graph.buttons])
  const enter = (next: string) => { if (graph.nodes[next]) setCurrent(resolvePreviewNode(graph, next)) }
  const onEnd = () => { if (node.terminal) return; const next = chooseWeighted(node.onEnd ?? []); if (next) enter(next.to) }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="preview-modal"><header><div><Icon name="play" size={15}/><strong>プレビュー</strong><span>{node.editor?.label || nodeId} - {nodeId}</span></div><button className="icon-button" onClick={onClose}><Icon name="close"/></button></header>
      <div className="preview-stage">
        {imageUrl && <img src={imageUrl} style={{ objectFit: candidate?.source.fit === 'stretch' ? 'fill' : candidate?.source.fit ?? 'cover' }} alt=""/>}
        {candidate?.source.type === 'video' && mediaUrl && <video src={mediaUrl} autoPlay controls style={{ objectFit: candidate.source.fit === 'stretch' ? 'fill' : candidate.source.fit ?? 'contain' }} onEnded={onEnd}/>}
        {candidate?.source.type !== 'video' && mediaUrl && <audio src={mediaUrl} autoPlay controls onEnded={onEnd}/>}
        {!candidate && <div className="preview-empty"><Icon name="media" size={38}/><strong>{node.terminal ? 'グラフが終了しました' : 'メディアなし'}</strong>{!node.terminal && node.onEnd?.length ? <button className="primary-button" onClick={onEnd}>即時遷移を実行</button> : null}</div>}
        {(node.buttons ?? []).flatMap((buttonId) => { const button = graph.buttons[buttonId]; return button ? [<button key={buttonId} className="preview-button" style={{ left: `${(button.layout?.x ?? .7) * 100}%`, top: `${(button.layout?.y ?? .8) * 100}%`, width: `${(button.layout?.width ?? .2) * 100}%`, height: `${(button.layout?.height ?? .1) * 100}%`, zIndex: button.layout?.z ?? 1, background: button.appearance?.backgroundColor ?? 'transparent', color: button.appearance?.textColor ?? '#fff', backgroundImage: button.appearance?.backgroundImage && buttonImageUrls[button.appearance.backgroundImage] ? `url(${buttonImageUrls[button.appearance.backgroundImage]})` : undefined }} onClick={() => { const next = chooseWeighted(button.onPress ?? []); if (next) enter(next.to) }}>{button.appearance?.text ?? buttonId}</button>] : [] })}
      </div>
      <footer><span>実ファイルを使った簡易プレビューです</span><div><button className="text-button" onClick={() => enter(start)}>最初から</button><button className="primary-button" onClick={onClose}>終了</button></div></footer>
    </div>
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

type TreeFile = { name: string; path: string; document?: GraphDocument; asset?: AssetEntry }
type TreeBranch = { folders: Map<string, TreeBranch>; files: TreeFile[] }

function FileTree({ documents, assets, activeUid, getAssetPath, getFolderPath, onOpenGraph, onPreview, onDeleteGraph }: { documents: GraphDocument[]; assets: AssetEntry[]; activeUid: string | null; getAssetPath: (asset: AssetEntry) => string; getFolderPath: (path: string) => string; onOpenGraph: (document: GraphDocument) => void; onPreview: (asset: AssetEntry) => void; onDeleteGraph: (document: GraphDocument) => void }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = normalizeSearchText(query)
  const matches = (name: string, path: string) => !normalizedQuery || normalizeSearchText(name).includes(normalizedQuery) || normalizeSearchText(path).includes(normalizedQuery)
  const matchCount = documents.filter((document) => matches(document.name, document.path)).length + assets.filter((asset) => matches(asset.name, asset.path)).length
  const tree = useMemo(() => {
    const rootBranch: TreeBranch = { folders: new Map(), files: [] }
    const entries: TreeFile[] = [
      ...documents.map((document) => ({ name: document.name, path: document.path, document })),
      ...assets.map((asset) => ({ name: asset.name, path: asset.path, asset })),
    ].filter((file) => !normalizedQuery || normalizeSearchText(file.name).includes(normalizedQuery) || normalizeSearchText(file.path).includes(normalizedQuery))
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
    return rootBranch
  }, [assets, documents, normalizedQuery])
  const fileIcon = (file: TreeFile) => file.document ? 'code' : file.asset?.kind === 'image' ? 'image' : ['audio', 'video'].includes(file.asset?.kind ?? '') ? 'media' : 'file'
  const renderBranch = (branch: TreeBranch, depth: number, parentPath = ''): React.ReactNode => <>
    {[...branch.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => { const path = parentPath ? `${parentPath}/${name}` : name; return <details className="tree-folder" open key={`${depth}-${path}`}>
      <summary draggable onDragStart={(event) => { const dragPath = getFolderPath(path) || '.'; activeTreeDrag = { label: name, kind: 'folder' }; event.dataTransfer.setData(FOLDER_DRAG_TYPE, dragPath); event.dataTransfer.setData('text/plain', dragPath); event.dataTransfer.effectAllowed = 'copy' }} onDragEnd={() => { activeTreeDrag = null }} style={{ paddingLeft: 8 + depth * 13 }}><Icon name="chevron" size={11}/><Icon name="folder" size={13}/><span>{name}</span></summary>
      {renderBranch(child, depth + 1, path)}
    </details> })}
    {[...branch.files].sort((a, b) => a.name.localeCompare(b.name)).map((file) => <div className={`tree-entry ${file.document?.uid === activeUid ? 'active' : ''}`} style={{ paddingLeft: 24 + depth * 13 }} key={file.path} draggable={Boolean(file.asset)} onDragStart={(event) => { if (!file.asset) return; const path = getAssetPath(file.asset); activeTreeDrag = { label: file.name.replace(/\.[^.]+$/, ''), kind: 'media' }; event.dataTransfer.setData(ASSET_DRAG_TYPE, path); event.dataTransfer.setData('text/plain', path); event.dataTransfer.effectAllowed = 'copy' }} onDragEnd={() => { activeTreeDrag = null }}>
      <button className="tree-entry-main" title={file.path} onClick={() => file.document ? onOpenGraph(file.document) : file.asset && onPreview(file.asset)}><Icon name={fileIcon(file)} size={13}/><span>{file.name}</span>{file.document?.dirty && <i/>}</button>
      {file.document && <button className="tree-entry-delete" title={`${file.name}を削除`} onClick={() => onDeleteGraph(file.document!)}><Icon name="trash" size={12}/></button>}
    </div>)}
  </>
  return <><label className="tree-search"><Icon name="search" size={13}/><input value={query} placeholder="ファイル名を検索" onChange={(event) => setQuery(event.target.value)}/>{query && <button title="検索をクリア" onClick={() => setQuery('')}><Icon name="close" size={11}/></button>}</label><div className="file-tree">{matchCount ? renderBranch(tree, 0) : <div className="tree-empty">一致するファイルはありません</div>}</div></>
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
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootName, setRootName] = useState('')
  const [documents, setDocuments] = useState<GraphDocument[]>([])
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedButton, setSelectedButton] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [weightDisplayMode, setWeightDisplayMode] = useState<'weight' | 'probability' | 'hidden'>('weight')
  const [view, setView] = useState<View>({ zoom: 1, x: 80, y: 65 })
  const [showPreview, setShowPreview] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<AssetEntry | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ uid: string; x: number; y: number; name: string; mode: 'menu' | 'rename' } | null>(null)
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem('wmgf-left-width')) || 220)
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem('wmgf-right-width')) || 330)
  const active = documents.find((document) => document.uid === activeUid)
  const probabilityMode = weightDisplayMode === 'probability'
  const docAssets = active ? relativeAssets(active, assets) : assets
  const issues = useMemo(() => active ? validateGraph(active.graph, docAssets) : [], [active, docAssets])

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3200) }
  const openDirectory = async () => {
    if (!window.showDirectoryPicker) return
    setBusy(true)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const result = await readDirectory(handle)
      const restored = restoreDrafts(handle.name, result.documents)
      setRoot(handle); setRootName(handle.name); setDocuments(restored); setAssets(result.assets)
      setActiveUid(restored[0]?.uid ?? null); setSelectedNode(null); setSelectedButton(null)
      if (result.errors.length) notify(`${result.errors.length}件のファイルを読み込めませんでした`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify(error instanceof Error ? error.message : 'フォルダを開けませんでした')
    } finally { setBusy(false) }
  }
  const requestOpenDirectory = () => {
    if (documents.some((document) => document.dirty) && !window.confirm('未保存の変更があります。保存せずに新しいフォルダを開きますか？')) return
    if (window.showDirectoryPicker) void openDirectory()
    else folderInput.current?.click()
  }
  const openFallback = async (files: FileList) => {
    setBusy(true)
    const docs: GraphDocument[] = []
    const nextAssets: AssetEntry[] = []
    const list = Array.from(files)
    const commonRoot = list[0]?.webkitRelativePath.split('/')[0] ?? 'content'
    for (const file of list) {
      const rawPath = file.webkitRelativePath || file.name
      const path = rawPath.startsWith(`${commonRoot}/`) ? rawPath.slice(commonRoot.length + 1) : rawPath
      if (path.toLowerCase().endsWith('.wmg.json')) {
        try { docs.push({ uid: uid(), name: file.name, path, graph: normalizeGraph(JSON.parse(await file.text())), dirty: false }) } catch { notify(`${path} を読み込めませんでした`) }
      } else nextAssets.push({ name: file.name, path, kind: fileKind(path), file })
    }
    const restored = restoreDrafts(commonRoot, docs)
    setRootName(commonRoot); setDocuments(restored); setAssets(nextAssets); setActiveUid(restored[0]?.uid ?? null); setSelectedButton(null); setBusy(false)
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
    if (!current || Boolean(current.terminal) === enabled) return
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
    if (!node || node.terminal || !active.graph.buttons[buttonId]) return
    if (node.buttons?.includes(buttonId)) { notify('このノードには既に接続されています'); return }
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, buttons: [...(node.buttons ?? []), buttonId] } } })
  }
  const detachButton = (nodeId: string, buttonId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (node) updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [nodeId]: { ...node, buttons: node.buttons?.filter((id) => id !== buttonId) } } })
  }

  const updateEdgeSet = (edge: GraphEdgeRef, updater: (transitions: Transition[]) => Transition[]) => {
    if (!active) return
    if (edge.type === 'attachment') return
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
    if (!active || edge.type === 'attachment') return
    const destination = active.graph.nodes[edge.to]
    const sourcePosition = edge.type === 'end' ? active.graph.nodes[edge.from]?.editor : active.graph.buttons[edge.from]?.editor
    if (!sourcePosition || !destination) return
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    const replace = (transitions: Transition[]) => transitions.map((transition, index) => index === edge.index ? { ...transition, to: id } : transition)
    const x = ((sourcePosition.x ?? 0) + (destination.editor?.x ?? 0)) / 2
    const y = ((sourcePosition.y ?? 0) + (destination.editor?.y ?? 0)) / 2
    const node: WmgNode = { media: [], onEnd: [{ to: edge.to, weight: 1 }], buttons: [], editor: { x: Math.round(x), y: Math.round(y), label: `Node ${number}`, color: nextNodeColor(active.graph.nodes) } }
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
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { media: [], onEnd: [], buttons: [], editor: { x: Math.max(20, Math.round(x)), y: Math.max(20, Math.round(y)), label: `Node ${number}`, color: nextNodeColor(active.graph.nodes) } } } })
    setSelectedNode(id)
    setSelectedButton(null)
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
  const bindAssetToNode = (nodeId: string, path: string) => {
    if (!active) return
    const asset = docAssets.find((item) => item.path === path)
    const node = active.graph.nodes[nodeId]
    if (!asset || !node) return
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
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { media: [media], onEnd: [], buttons: [], editor: { x: Math.round(x - 92), y: Math.round(y - 42), label: asset.name.replace(/\.[^.]+$/, ''), color: nextNodeColor(active.graph.nodes) } } } })
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
    if (!node || !folderMedia.length) { notify('このフォルダに音声・動画がありません'); return }
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
    updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { media, onEnd: [], buttons: [], editor: { x: Math.round(x - 92), y: Math.round(y - 42), label, color: nextNodeColor(active.graph.nodes) } } } })
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
        let targetId = !options?.forceNew && selectedNode && active.graph.nodes[selectedNode] ? selectedNode : ''
        const nodes = { ...active.graph.nodes }
        if (!targetId) {
          let number = Object.keys(nodes).length + 1
          while (nodes[`node-${number}`]) number++
          targetId = `node-${number}`
          const sourceName = handles[0]?.name ?? `Node ${number}`
          nodes[targetId] = { media: [], onEnd: [], buttons: [], editor: { x: Math.round(options?.forceNew ? (options.x ?? 252) - 92 : options?.x ?? 160), y: Math.round(options?.forceNew ? (options.y ?? 182) - 42 : options?.y ?? 140), label: sourceName.replace(/\.[^.]+$/, ''), color: nextNodeColor(nodes) } }
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
    setDocuments((current) => [...current, document]); setActiveUid(document.uid); setSelectedNode('start'); setSelectedButton(null)
  }
  const duplicateDocument = (target: GraphDocument) => {
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const stem = target.name.replace(/\.wmg\.json$/i, '')
    let number = 1
    let name = `${stem}-copy.wmg.json`
    while (documents.some((document) => document.path.toLowerCase() === `${parent}${name}`.toLowerCase())) name = `${stem}-copy-${++number}.wmg.json`
    const copy: GraphDocument = { uid: uid(), name, path: `${parent}${name}`, graph: structuredClone(target.graph), dirty: true }
    setDocuments((current) => current.flatMap((document) => document.uid === target.uid ? [document, copy] : [document]))
    setActiveUid(copy.uid)
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
      localStorage.removeItem(draftKey(rootName, target.path))
      if (activeUid === target.uid) { setActiveUid(remaining[0]?.uid ?? null); setSelectedNode(null); setSelectedButton(null) }
      notify(`${target.name} を削除しました`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'グラフを削除できませんでした')
    }
  }
  const renameDocument = async (target: GraphDocument, requestedName: string) => {
    let name = requestedName.trim()
    if (!name) { notify('ファイル名は空にできません'); return }
    if (name.includes('/') || name.includes('\\')) { notify('ファイル名にパス区切りは使用できません'); return }
    if (!name.toLowerCase().endsWith('.wmg.json')) name = `${name.replace(/\.json$/i, '')}.wmg.json`
    if (name === target.name) return
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/') + 1) : ''
    const nextPath = `${parent}${name}`
    if (documents.some((document) => document.uid !== target.uid && document.path.toLowerCase() === nextPath.toLowerCase())) { notify('同じ名前のグラフが既にあります'); return }
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
    } catch (error) { notify(error instanceof Error ? error.message : 'ファイル名を変更できませんでした') }
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newDocument() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        if (selectedButton) deleteButtonById(selectedButton)
        else if (selectedNode) deleteNode()
      }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => {
    const closeMenus = () => { setShowFileMenu(false); setTabMenu(null) }
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

  if (!rootName) return <><Welcome busy={busy} onOpen={() => void openDirectory()} onFallback={(files) => void openFallback(files)}/>{toast && <div className="toast">{toast}</div>}</>
  return <div className="app-shell" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); const promises = Array.from(event.dataTransfer.items).map((item) => (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null)); void importDroppedHandles(promises) }}>
    <header className="titlebar"><div className="brand"><div className="brand-mark"><span/><span/><span/></div><strong>WMGF</strong><span>Editor</span></div><nav><div className="menu-anchor"><button onPointerDown={(event) => event.stopPropagation()} onClick={() => setShowFileMenu(!showFileMenu)}>ファイル</button>{showFileMenu && <div className="app-menu" onPointerDown={(event) => event.stopPropagation()}><button disabled={!active} onClick={() => { void save(); setShowFileMenu(false) }}><Icon name="save" size={13}/><span>保存</span><kbd>Ctrl+S</kbd></button><div className="menu-separator"/><button onClick={() => { setShowFileMenu(false); requestOpenDirectory() }}><Icon name="folder" size={13}/><span>新しいフォルダを開く</span></button></div>}</div></nav><div className="title-actions"><span className="workspace-name"><Icon name="folder" size={13}/>{rootName}</span><button className="toolbar-button" disabled={!active} onClick={() => void save()}><Icon name="save" size={14}/>保存</button><button className="primary-button compact" disabled={!active} onClick={() => setShowPreview(true)}><Icon name="play" size={13}/>プレビュー</button></div></header>
    <div className="workspace" style={{ gridTemplateColumns: `${leftWidth}px 4px minmax(360px, 1fr) 4px ${rightWidth}px` }}>
      <aside className="explorer"><div className="panel-title"><span>ファイル</span><div><button className="icon-button" title="新規グラフ" onClick={newDocument}><Icon name="plus" size={14}/></button><button className="icon-button" title="新しいフォルダを開く" onClick={requestOpenDirectory}><Icon name="folder" size={14}/></button></div></div><div className="explorer-scroll">
        <FileTree documents={documents} assets={assets} activeUid={activeUid} getAssetPath={(asset) => docAssets.find((item) => item.file === asset.file)?.path ?? asset.path} getFolderPath={(path) => { const parent = active?.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/') + 1) : ''; return parent && path.startsWith(parent) ? path.slice(parent.length) : path }} onOpenGraph={(document) => { setActiveUid(document.uid); setSelectedNode(null); setSelectedButton(null) }} onPreview={setPreviewAsset} onDeleteGraph={(document) => void deleteDocument(document)}/>
      </div><button className="add-file" onClick={newDocument}><Icon name="plus" size={13}/>新規グラフ</button></aside>
      <div className="resize-handle left" title="ファイルペインの幅を変更" onPointerDown={(event) => beginResize('left', event)}/>
      <main className="editor-area">
        <div className="tabs">{documents.map((document) => <div className={`tab ${document.uid === activeUid ? 'active' : ''}`} key={document.uid} onClick={() => { setActiveUid(document.uid); setSelectedNode(null); setSelectedButton(null) }} onContextMenu={(event) => { event.preventDefault(); setTabMenu({ uid: document.uid, x: Math.min(event.clientX, window.innerWidth - 260), y: Math.min(event.clientY, window.innerHeight - 145), name: document.name, mode: 'menu' }) }}><Icon name="code" size={13}/><span>{document.name}</span>{document.dirty && <i/>}</div>)}<button className="new-tab" onClick={newDocument}><Icon name="plus" size={14}/></button></div>
        {active ? <><div className="graph-toolbar"><div><button className="tool-button" onClick={addNodeAtGraphCenter}><Icon name="plus" size={14}/>ノード</button><button className="tool-button" onClick={addButtonAtGraphCenter}><span className="button-glyph">B</span>ボタン</button><span className="toolbar-separator"/><button className={`segmented ${weightDisplayMode === 'weight' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('weight')}>重み</button><button className={`segmented ${weightDisplayMode === 'probability' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('probability')}>確率</button><button className={`segmented ${weightDisplayMode === 'hidden' ? 'active' : ''}`} onClick={() => setWeightDisplayMode('hidden')}>非表示</button></div><div><button className="zoom-button" onClick={() => setView({ ...view, zoom: Math.max(.5, view.zoom - .1) })}>−</button><button className="zoom-value" onClick={() => setView({ zoom: 1, x: 80, y: 65 })}>{Math.round(view.zoom * 100)}%</button><button className="zoom-button" onClick={() => setView({ ...view, zoom: Math.min(1.6, view.zoom + .1) })}>＋</button><span className="toolbar-separator"/><button className="tool-button icon-only" title="JSONをエクスポート" onClick={exportJson}><Icon name="code" size={14}/></button></div></div>
          <GraphCanvas graph={active.graph} selectedNode={selectedNode} selectedButton={selectedButton} probabilityMode={probabilityMode} showWeights={weightDisplayMode !== 'hidden'} view={view} onView={setView} onSelectNode={(id) => { setSelectedNode(id); setSelectedButton(null) }} onSelectButton={(id) => { setSelectedButton(id); setSelectedNode(null) }} onMoveNode={(id, x, y) => { const node = active.graph.nodes[id]; updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [id]: { ...node, editor: { ...node.editor, x: Math.round(x), y: Math.round(y) } } } }) }} onMoveButton={(id, x, y) => { const button = active.graph.buttons[id]; updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [id]: { ...button, editor: { ...button.editor, x: Math.round(x), y: Math.round(y) } } } }) }} onAddNode={addNode} onAddButton={(x, y) => addButton(x, y)} onConnectNode={(from, to) => { const source = active.graph.nodes[from]; if (!source || source.terminal) return; if ((source.onEnd ?? []).some((transition) => transition.to === to)) { notify('このノード間は既に接続されています'); return } updateGraph({ ...active.graph, nodes: { ...active.graph.nodes, [from]: { ...source, onEnd: [...(source.onEnd ?? []), { to, weight: 1 }] } } }) }} onConnectButton={(buttonId, to) => { const button = active.graph.buttons[buttonId]; if (!button) return; if ((button.onPress ?? []).some((transition) => transition.to === to)) { notify('このボタンから既に接続されています'); return } updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [buttonId]: { ...button, onPress: [...(button.onPress ?? []), { to, weight: 1 }] } } }) }} onAttachButton={attachButton} onAssetDrop={dropAssetOnGraph} onFolderDrop={dropFolderOnGraph} onExternalDrop={(promises, x, y) => void importDroppedHandles(promises, { forceNew: true, x, y })} onWeightChange={changeEdgeWeight} onDisconnect={disconnectEdge} onInsertNode={insertNodeOnEdge} onDeleteNode={deleteNodeById} onDeleteButton={deleteButtonById} onSave={() => void save()}/>
        </> : <div className="no-document"><Icon name="code" size={42}/><strong>グラフがありません</strong><span>新規グラフを作成するか、別のフォルダを開いてください</span><button className="primary-button" onClick={newDocument}><Icon name="plus" size={14}/>新規グラフ</button></div>}
      </main>
      <div className="resize-handle right" title="インスペクターの幅を変更" onPointerDown={(event) => beginResize('right', event)}/>
      {active ? <Inspector nodeId={selectedNode} buttonId={selectedButton} graph={active.graph} assets={docAssets} probabilityMode={probabilityMode} issues={issues} onChange={updateNode} onChangeButton={updateSelectedButton} onSetStart={setSelectedNodeStart} onSetTerminal={setSelectedNodeTerminal} onRename={renameNode} onRenameButton={renameButton} onDelete={deleteNode} onDeleteButton={() => selectedButton && deleteButtonById(selectedButton)} onPick={(id) => { setSelectedNode(id); setSelectedButton(null) }} onPickButton={(id) => { setSelectedButton(id); setSelectedNode(null) }} onAddButton={(nodeId) => { const node = active.graph.nodes[nodeId]; addButton((node.editor?.x ?? 0) + 17, (node.editor?.y ?? 0) + 110, nodeId) }} onDetachButton={detachButton} onAssetDrop={(path) => selectedNode && bindAssetToNode(selectedNode, path)} onFolderDrop={(path) => selectedNode && appendFolderToNode(selectedNode, path)}/> : <aside className="inspector"><div className="panel-title"><span>インスペクター</span></div><div className="blank-panel"><Icon name="target" size={30}/></div></aside>}
    </div>
    <footer className="statusbar"><button className={issues.some((issue) => issue.severity === 'error') ? 'has-error' : ''} onClick={() => setShowProblems(!showProblems)}>{issues.length ? <Icon name="warning" size={12}/> : <Icon name="check" size={12}/>} {issues.filter((issue) => issue.severity === 'error').length} エラー　{issues.filter((issue) => issue.severity === 'warning').length} 警告</button><div><span>WMGF v1</span><span>{active ? `${Object.keys(active.graph.nodes).length} ノード · ${Object.keys(active.graph.buttons).length} ボタン` : 'グラフなし'}</span><span>{assets.length} ファイル</span></div></footer>
    {showProblems && <div className="problems-panel" style={{ left: leftWidth + 4, right: rightWidth + 4 }}><header><strong>問題</strong><button className="icon-button" onClick={() => setShowProblems(false)}><Icon name="close" size={13}/></button></header>{issues.length ? issues.map((issue, index) => <button key={index} onClick={() => { if (issue.nodeId) { setSelectedNode(issue.nodeId); setSelectedButton(null) } else if (issue.buttonId) { setSelectedButton(issue.buttonId); setSelectedNode(null) } setShowProblems(false) }}><Icon name="warning" size={13}/><span>{issue.message}</span><small>{issue.nodeId ?? issue.buttonId ?? 'グラフ'}</small></button>) : <div className="problems-empty"><Icon name="check" size={15}/>問題は見つかりませんでした</div>}</div>}
    {showPreview && active && <Preview graph={active.graph} assets={docAssets} onClose={() => setShowPreview(false)}/>}
    {previewAsset && <AssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)}/>}
    {tabMenu && <div className={`tab-context-menu ${tabMenu.mode}`} style={{ left: tabMenu.x, top: tabMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{tabMenu.mode === 'menu' ? <><button onClick={() => { const target = documents.find((document) => document.uid === tabMenu.uid); if (target) duplicateDocument(target); setTabMenu(null) }}><Icon name="copy" size={13}/>複製</button><button onClick={() => setTabMenu({ ...tabMenu, mode: 'rename' })}><Icon name="file" size={13}/>名前を変更</button><button className="danger" onClick={() => { const target = documents.find((document) => document.uid === tabMenu.uid); if (target) void deleteDocument(target); setTabMenu(null) }}><Icon name="trash" size={13}/>削除</button></> : <><label>ファイル名を変更</label><input autoFocus value={tabMenu.name} onChange={(event) => setTabMenu({ ...tabMenu, name: event.target.value })} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === 'Escape') setTabMenu({ ...tabMenu, mode: 'menu' }); if (event.key === 'Enter') { const target = documents.find((document) => document.uid === tabMenu.uid); if (target) void renameDocument(target, tabMenu.name); setTabMenu(null) } }}/></>}</div>}
    <input ref={folderInput} type="file" multiple hidden onChange={(event) => event.target.files && void openFallback(event.target.files)}/>
    {toast && <div className="toast">{toast}</div>}
  </div>
}

export default App
