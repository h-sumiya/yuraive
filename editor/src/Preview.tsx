import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseWeighted } from './graph'
import { LayoutFrame } from './LayoutFrame'
import { createStarlarkContext } from './scriptContext'
import { resetStarlarkRuntime, runStarlark } from './starlark'
import type { AssetEntry, ButtonRenderResult, LayoutDocument, MediaCandidate, PlaybackHistoryEntry, PreviewTraceEntry, ScriptDocument, StarlarkCurrent, YuraiveButton, YuraiveGraph } from './types'

const PreviewIcon = ({ name }: { name: 'play' | 'pause' | 'close' | 'debug' | 'trash' | 'export' }) => {
  const path = name === 'play' ? 'm7 4 13 8-13 8z' : name === 'pause' ? 'M8 5v14M16 5v14' : name === 'close' ? 'm6 6 12 12M18 6 6 18' : name === 'trash' ? 'M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14' : name === 'export' ? 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4' : 'M8 9h8M9 4h6l1 3H8zM7 7l-2 3v8l3 3h8l3-3v-8l-2-3M3 13h4m10 0h4'
  return <svg className="icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg>
}

const formatPreviewTime = (valueMs: number) => {
  const seconds = Math.max(0, Math.floor(valueMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file) { setUrl(undefined); return }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => { window.setTimeout(() => URL.revokeObjectURL(next), 1000) }
  }, [file])
  return url
}

type CurrentMedia = { nodeId: string; candidate?: MediaCandidate }
type ActiveTracker = {
  id: string
  runId: string
  nodeId: string
  candidate: MediaCandidate
  startedAt: Date
  playingSince?: number
  activePlayMs: number
  startPositionMs: number
  positionMs: number
  durationMs: number
}

const safeRenderResult = (value: unknown): ButtonRenderResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const result: ButtonRenderResult = {}
  if (typeof raw.visible === 'boolean') result.visible = raw.visible
  if (typeof raw.text === 'string') result.text = raw.text.slice(0, 500)
  if (raw.style && typeof raw.style === 'object' && !Array.isArray(raw.style)) {
    const style = raw.style as Record<string, unknown>
    result.style = {}
    for (const key of ['backgroundColor', 'backgroundImage', 'textColor', 'borderColor'] as const) if (typeof style[key] === 'string') result.style[key] = String(style[key]).slice(0, 500)
    for (const key of ['opacity', 'borderWidth', 'borderRadius', 'fontSize', 'fontWeight', 'paddingHorizontal', 'paddingVertical'] as const) if (typeof style[key] === 'number' && Number.isFinite(style[key])) result.style[key] = style[key]
  }
  return result
}

export function Preview({ graph, graphId, assets, scripts, layouts, initialHistory = [], onHistoryChange, onClose }: { graph: YuraiveGraph; graphId: string; assets: AssetEntry[]; scripts: ScriptDocument[]; layouts: LayoutDocument[]; initialHistory?: PlaybackHistoryEntry[]; onHistoryChange?: (history: PlaybackHistoryEntry[]) => void; onClose: () => void }) {
  const start = Object.entries(graph.nodes).find(([, node]) => node.start)?.[0] ?? Object.keys(graph.nodes)[0]
  const [current, setCurrent] = useState<CurrentMedia | null>(null)
  const currentRef = useRef<CurrentMedia | null>(null)
  const [history, setHistory] = useState<PlaybackHistoryEntry[]>(initialHistory)
  const historyRef = useRef<PlaybackHistoryEntry[]>(initialHistory)
  const [trace, setTrace] = useState<PreviewTraceEntry[]>([])
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buttonResults, setButtonResults] = useState<Record<string, ButtonRenderResult>>({})
  const [resolving, setResolving] = useState(true)
  const [debugOpen, setDebugOpen] = useState(true)
  const [debugTab, setDebugTab] = useState<'trace' | 'history' | 'context'>('trace')
  const runId = useRef(crypto.randomUUID())
  const runStartedAt = useRef(new Date().toISOString())
  const tracker = useRef<ActiveTracker | null>(null)
  const mediaElement = useRef<HTMLMediaElement | null>(null)
  const finalizedCurrent = useRef<PlaybackHistoryEntry | null>(null)
  const mounted = useRef(true)
  const started = useRef(false)
  const asset = useCallback((path?: string) => assets.find((item) => item.path === path)?.file, [assets])
  const node = current ? graph.nodes[current.nodeId] : undefined
  const candidate = current?.candidate
  const mediaFile = candidate?.source.type === 'video' ? asset(candidate.source.video) : asset(candidate?.source.audio)
  const imageFile = candidate?.source.type === 'audioImage' ? asset(candidate.source.image) : undefined
  const mediaUrl = useObjectUrl(mediaFile)
  const imageUrl = useObjectUrl(imageFile)
  const [buttonImageUrls, setButtonImageUrls] = useState<Record<string, string>>({})

  const addTrace = useCallback((kind: PreviewTraceEntry['kind'], title: string, detail?: string, data?: unknown) => {
    if (!mounted.current) return
    setTrace((items) => [...items.slice(-499), { id: crypto.randomUUID(), at: new Date().toISOString(), kind, title, detail, data }])
  }, [])

  const setHistoryValue = useCallback((next: PlaybackHistoryEntry[]) => {
    historyRef.current = next.slice(-1000)
    if (mounted.current) setHistory(historyRef.current)
    onHistoryChange?.(historyRef.current)
  }, [onHistoryChange])

  const currentContext = useCallback((snapshot: PlaybackHistoryEntry[]): StarlarkCurrent | null => {
    const selected = currentRef.current
    if (!selected) return null
    const active = tracker.current
    if (active && active.nodeId === selected.nodeId && active.candidate.id === selected.candidate?.id) {
      const runningMs = active.playingSince === undefined ? 0 : performance.now() - active.playingSince
      return {
        nodeId: selected.nodeId,
        mediaId: active.candidate.id,
        source: active.candidate.source.video ?? active.candidate.source.audio ?? null,
        startedAt: active.startedAt.toISOString(),
        positionMs: Math.max(0, Math.round(active.positionMs)),
        mediaDurationMs: Math.max(0, Math.round(active.durationMs)),
        activePlayMs: Math.max(0, Math.round(active.activePlayMs + runningMs)),
      }
    }
    const completed = finalizedCurrent.current?.nodeId === selected.nodeId && finalizedCurrent.current.mediaId === selected.candidate?.id
      ? finalizedCurrent.current
      : snapshot.findLast((entry) => entry.nodeId === selected.nodeId && entry.mediaId === selected.candidate?.id)
    if (completed) return {
      nodeId: completed.nodeId,
      mediaId: completed.mediaId,
      source: completed.source,
      startedAt: completed.startedAt,
      positionMs: completed.endPositionMs,
      mediaDurationMs: completed.mediaDurationMs,
      activePlayMs: completed.activePlayMs,
    }
    return { nodeId: selected.nodeId, mediaId: selected.candidate?.id ?? null, source: selected.candidate?.source.video ?? selected.candidate?.source.audio ?? null, startedAt: null, positionMs: 0, mediaDurationMs: 0, activePlayMs: 0 }
  }, [])

  const scriptContext = useCallback((snapshot: PlaybackHistoryEntry[], trigger: Record<string, unknown>) => {
    const selected = currentRef.current
    const current = currentContext(snapshot)
    const currentIsFinalized = !tracker.current && Boolean(selected?.candidate && finalizedCurrent.current?.nodeId === selected.nodeId && finalizedCurrent.current.mediaId === selected.candidate.id)
    return createStarlarkContext({ graphId, runId: runId.current, runStartedAt: runStartedAt.current, history: snapshot, current, trigger, currentIsFinalized })
  }, [currentContext, graphId])

  const finalize = useCallback((reason: PlaybackHistoryEntry['endReason']) => {
    const active = tracker.current
    if (!active) return historyRef.current
    const now = performance.now()
    if (active.playingSince !== undefined) active.activePlayMs += now - active.playingSince
    const entry: PlaybackHistoryEntry = {
      schemaVersion: 1,
      id: active.id,
      runId: active.runId,
      graphId,
      contentId: graph.metadata?.contentId,
      nodeId: active.nodeId,
      mediaId: active.candidate.id,
      source: active.candidate.source.video ?? active.candidate.source.audio ?? null,
      startedAt: active.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      mediaDurationMs: Math.max(0, Math.round(active.durationMs)),
      activePlayMs: Math.max(0, Math.round(active.activePlayMs)),
      startPositionMs: Math.max(0, Math.round(active.startPositionMs)),
      endPositionMs: Math.max(0, Math.round(active.positionMs)),
      endReason: reason,
    }
    tracker.current = null
    finalizedCurrent.current = entry
    const next = [...historyRef.current, entry].slice(-1000)
    setHistoryValue(next)
    addTrace('history', `${entry.mediaId} を履歴へ追加`, `${entry.activePlayMs}ms · ${reason}`, entry)
    return next
  }, [addTrace, graph.metadata?.contentId, graphId, setHistoryValue])

  const enterMedia = useCallback((nodeId: string) => {
    const target = graph.nodes[nodeId]
    const selected = chooseWeighted(target.media ?? [])
    const next = { nodeId, candidate: selected }
    currentRef.current = next
    setCurrent(next)
    setPositionMs(0)
    setDurationMs(0)
    setPlaying(false)
    finalizedCurrent.current = null
    if (selected) {
      tracker.current = { id: crypto.randomUUID(), runId: runId.current, nodeId, candidate: selected, startedAt: new Date(), activePlayMs: 0, startPositionMs: 0, positionMs: 0, durationMs: 0 }
      addTrace('media', `メディアを選択: ${selected.id}`, nodeId, selected.source)
    } else tracker.current = null
    addTrace('node', `ノードへ遷移: ${nodeId}`, target.editor?.label)
    setResolving(false)
  }, [addTrace, graph.nodes])

  const resolveToMedia = useCallback(async (firstNodeId: string, trigger: Record<string, unknown>, snapshot = historyRef.current) => {
    setResolving(true)
    let nodeId = firstNodeId
    for (let hop = 0; hop < 32; hop++) {
      const target = graph.nodes[nodeId]
      if (!target) { addTrace('error', `遷移先がありません: ${nodeId}`); setResolving(false); return }
      if (target.type !== 'script') { enterMedia(nodeId); return }
      const call = target.script
      addTrace('script', `Script Node実行: ${nodeId}`, call ? `${call.path}#${call.function ?? 'jump'}` : '未設定')
      let nextId: string | undefined
      if (call?.path) {
        try {
          const context = scriptContext(snapshot, { ...trigger, scriptNodeId: nodeId })
          const result = await runStarlark({ scripts, path: call.path, functionName: call.function ?? 'jump', args: [context], timeoutMs: 1200 })
          result.prints.forEach((line) => addTrace('script', 'print', line))
          if (typeof result.value === 'string') nextId = result.value
          else if (result.value !== null) throw new Error('jump()はNode IDの文字列またはNoneを返してください')
          addTrace('script', `戻り値: ${nextId ?? 'None'}`, `${result.durationMs.toFixed(1)}ms`, result.value)
        } catch (error) { addTrace('error', `Script Nodeエラー: ${nodeId}`, error instanceof Error ? error.message : String(error)) }
      }
      const allowed = new Set((target.onEnd ?? []).map((transition) => transition.to))
      if (nextId && (!graph.nodes[nextId] || (allowed.size && !allowed.has(nextId)))) {
        addTrace('error', `許可されていない遷移先: ${nextId}`, `Script Node ${nodeId}`)
        nextId = undefined
      }
      if (!nextId) nextId = chooseWeighted(target.onEnd ?? [])?.to
      if (!nextId) { addTrace('error', `Script Node ${nodeId} から遷移できません`); setResolving(false); return }
      nodeId = nextId
    }
    addTrace('error', 'Script Nodeの連続実行が32回を超えました', '循環接続を確認してください')
    setResolving(false)
  }, [addTrace, enterMedia, graph.nodes, scriptContext, scripts])

  const transitionFromCurrent = useCallback(async (reason: PlaybackHistoryEntry['endReason'], trigger: Record<string, unknown>, transitions = node?.onEnd ?? []) => {
    const snapshot = finalize(reason)
    const next = chooseWeighted(transitions)
    if (next) await resolveToMedia(next.to, trigger, snapshot)
    else setResolving(false)
  }, [finalize, node?.onEnd, resolveToMedia])

  useEffect(() => {
    mounted.current = true
    if (!started.current) { started.current = true; void resolveToMedia(start, { type: 'start' }, []) }
    return () => { mounted.current = false }
  }, [resolveToMedia, start])

  useEffect(() => {
    const paths = new Set(Object.entries(graph.buttons).flatMap(([id, button]) => [button.style?.backgroundImage, buttonResults[id]?.style?.backgroundImage]).filter(Boolean) as string[])
    const next = Object.fromEntries([...paths].flatMap((path) => { const file = assets.find((item) => item.path === path)?.file; return file ? [[path, URL.createObjectURL(file)]] : [] }))
    setButtonImageUrls(next)
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url))
  }, [assets, buttonResults, graph.buttons])

  const evaluateButtons = useCallback(async () => {
    if (!node || node.type === 'script') return
    const next: Record<string, ButtonRenderResult> = {}
    await Promise.all((node.buttons ?? []).map(async (buttonId) => {
      const button = graph.buttons[buttonId]
      if (!button?.render?.path) return
      try {
        const context = scriptContext(historyRef.current, { type: 'render', buttonId })
        const result = await runStarlark({ scripts, path: button.render.path, functionName: button.render.function ?? 'render', args: [context], timeoutMs: 1200 })
        next[buttonId] = safeRenderResult(result.value)
        result.prints.forEach((line) => addTrace('script', `${buttonId}: print`, line))
        addTrace('script', `Button render: ${buttonId}`, `${result.durationMs.toFixed(1)}ms`, next[buttonId])
      } catch (error) { addTrace('error', `Button renderエラー: ${buttonId}`, error instanceof Error ? error.message : String(error)) }
    }))
    if (mounted.current) setButtonResults(next)
  }, [addTrace, graph.buttons, node, scriptContext, scripts])

  useEffect(() => { void evaluateButtons() }, [current?.nodeId, evaluateButtons, history.length])

  const exportHistory = () => {
    const content = historyRef.current.map((entry) => JSON.stringify(entry)).join('\n') + (historyRef.current.length ? '\n' : '')
    const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${graphId.replace(/\.yuraive\.json$/i, '')}-preview-history.jsonl`; anchor.click(); URL.revokeObjectURL(url)
  }

  const close = () => { finalize('stopped'); resetStarlarkRuntime(); onClose() }
  const restart = async () => { const snapshot = finalize('restarted'); runId.current = crypto.randomUUID(); runStartedAt.current = new Date().toISOString(); await resolveToMedia(start, { type: 'restart' }, snapshot) }
  const next = async () => { await transitionFromCurrent('completed', { type: 'next' }) }
  const toggleMedia = () => {
    const element = mediaElement.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }
  const seek = (value: number) => {
    const element = mediaElement.current
    if (!element || !Number.isFinite(value)) return
    element.currentTime = value / 1000
    if (tracker.current) tracker.current.positionMs = value
    setPositionMs(value)
  }
  const onButton = async (buttonId: string, button: YuraiveButton) => {
    addTrace('button', `ボタン押下: ${buttonId}`)
    const snapshot = finalize('button')
    const next = chooseWeighted(button.onPress ?? [])
    if (next) await resolveToMedia(next.to, { type: 'button', buttonId }, snapshot)
  }

  const contextPreview = scriptContext(history, { type: 'debug' })
  const controlId = node?.playerControl ?? graph.globalPlayerControl
  const layoutPath = controlId ? graph.playerControls[controlId]?.layout : undefined
  const layoutSource = layouts.find((layout) => layout.path === layoutPath)?.content
  const layoutButtons = !resolving && node?.type === 'media' ? (node.buttons ?? []).flatMap((buttonId) => {
    const button = graph.buttons[buttonId]
    if (!button) return []
    const rendered = buttonResults[buttonId] ?? {}
    const withinTime = !button.visibility?.length || button.visibility.some((interval) => positionMs >= interval.fromMs && (interval.toMs === null || positionMs <= interval.toMs))
    const style = { ...button.style, ...rendered.style }
    const backgroundImage = rendered.style?.backgroundImage ?? button.style?.backgroundImage
    return [{
      id: buttonId,
      visible: rendered.visible !== false && withinTime,
      targetSlot: button.targetSlot,
      order: button.order,
      zIndex: button.zIndex,
      text: rendered.text ?? button.text ?? buttonId,
      style,
      backgroundImageUrl: backgroundImage ? buttonImageUrls[backgroundImage] : undefined,
    }]
  }) : []

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <div className={`preview-modal ${debugOpen ? 'debug-open' : ''}`}>
      <header><div><PreviewIcon name="play"/><strong>プレビュー</strong><span>{node ? `${node.editor?.label || current?.nodeId} - ${current?.nodeId}` : resolving ? '遷移を解決中…' : '停止'}</span></div><div><button className={`icon-button ${debugOpen ? 'active' : ''}`} title="デバッグパネル" onClick={() => setDebugOpen(!debugOpen)}><PreviewIcon name="debug"/></button><button className="icon-button" onClick={close}><PreviewIcon name="close"/></button></div></header>
      <div className="preview-body">
        <div className="preview-stage">
          {imageUrl && <><img className="preview-artwork-cover" src={imageUrl} aria-hidden="true" alt=""/><span className="preview-artwork-shade"/><img className="preview-artwork-contain" src={imageUrl} alt=""/></>}
          {candidate?.source.type === 'video' && mediaUrl && <video ref={(element) => { mediaElement.current = element }} key={`${current?.nodeId}-${candidate.id}`} src={mediaUrl} autoPlay onLoadedMetadata={(event) => { const value = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 0; if (tracker.current) tracker.current.durationMs = value; setDurationMs(value) }} onPlay={() => { setPlaying(true); if (tracker.current && tracker.current.playingSince === undefined) tracker.current.playingSince = performance.now() }} onPause={() => { setPlaying(false); const item = tracker.current; if (item?.playingSince !== undefined) { item.activePlayMs += performance.now() - item.playingSince; item.playingSince = undefined } }} onTimeUpdate={(event) => { const value = event.currentTarget.currentTime * 1000; if (tracker.current) tracker.current.positionMs = value; setPositionMs(value) }} onEnded={() => void transitionFromCurrent('completed', { type: 'end' })}/>}
          {candidate?.source.type !== 'video' && mediaUrl && <audio ref={(element) => { mediaElement.current = element }} key={`${current?.nodeId}-${candidate?.id}`} src={mediaUrl} autoPlay onLoadedMetadata={(event) => { const value = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 0; if (tracker.current) tracker.current.durationMs = value; setDurationMs(value) }} onPlay={() => { setPlaying(true); if (tracker.current && tracker.current.playingSince === undefined) tracker.current.playingSince = performance.now() }} onPause={() => { setPlaying(false); const item = tracker.current; if (item?.playingSince !== undefined) { item.activePlayMs += performance.now() - item.playingSince; item.playingSince = undefined } }} onTimeUpdate={(event) => { const value = event.currentTarget.currentTime * 1000; if (tracker.current) tracker.current.positionMs = value; setPositionMs(value) }} onEnded={() => void transitionFromCurrent('completed', { type: 'end' })}/>}
          {!candidate && <div className="preview-empty"><PreviewIcon name="play"/><strong>{resolving ? '遷移を解決中…' : node?.terminal ? 'グラフが終了しました' : 'メディアなし'}</strong>{!resolving && node && !node.terminal && node.onEnd?.length ? <button className="primary-button" onClick={() => void transitionFromCurrent('completed', { type: 'empty' })}>即時遷移を実行</button> : null}</div>}
          {layoutSource && <LayoutFrame
            source={layoutSource}
            buttons={layoutButtons}
            className="preview-layout-frame"
            onPress={(buttonId) => { const button = graph.buttons[buttonId]; if (button) void onButton(buttonId, button) }}
          />}
          {!layoutSource && Boolean(node?.buttons?.length) && <div className="preview-layout-missing">レイアウトファイルが接続されていません</div>}
        </div>
        {debugOpen && <aside className="preview-debug">
          <header><div><button className={debugTab === 'trace' ? 'active' : ''} onClick={() => setDebugTab('trace')}>Trace <i>{trace.length}</i></button><button className={debugTab === 'history' ? 'active' : ''} onClick={() => setDebugTab('history')}>History <i>{history.length}</i></button><button className={debugTab === 'context' ? 'active' : ''} onClick={() => setDebugTab('context')}>Context</button></div><div><button title="JSONLをエクスポート" disabled={!history.length} onClick={exportHistory}><PreviewIcon name="export"/></button><button title="履歴とログをクリア" onClick={() => { setHistoryValue([]); setTrace([]) }}><PreviewIcon name="trash"/></button></div></header>
          <div className="preview-debug-content">{debugTab === 'trace' && (trace.length ? [...trace].reverse().map((entry) => <details className={`trace-row ${entry.kind}`} key={entry.id}><summary><time>{entry.at.slice(11, 23)}</time><span>{entry.kind}</span><strong>{entry.title}</strong></summary>{entry.detail && <p>{entry.detail}</p>}{entry.data !== undefined && <pre>{JSON.stringify(entry.data, null, 2)}</pre>}</details>) : <div className="debug-empty">実行ログはまだありません</div>)}{debugTab === 'history' && (history.length ? [...history].reverse().map((entry) => <details className="history-row" key={entry.id}><summary><strong>{entry.mediaId}</strong><span>{(entry.activePlayMs / 1000).toFixed(1)}秒</span><small>{entry.endReason}</small></summary><pre>{JSON.stringify(entry, null, 2)}</pre></details>) : <div className="debug-empty">プレビュー中の履歴はまだありません</div>)}{debugTab === 'context' && <pre className="context-json">{JSON.stringify(contextPreview, null, 2)}</pre>}</div>
          <footer><span>{resolving ? '● resolving' : '● ready'}</span><span>{scripts.length} scripts · max 32 hops</span></footer>
        </aside>}
      </div>
      <div className="preview-transport">
        <button type="button" aria-label={playing ? '一時停止' : '再生'} title={playing ? '一時停止' : '再生'} disabled={!mediaUrl} onClick={toggleMedia}><PreviewIcon name={playing ? 'pause' : 'play'}/></button>
        <span>{formatPreviewTime(positionMs)}</span>
        <input type="range" aria-label="再生位置" min={0} max={Math.max(durationMs, 1)} step={100} value={Math.min(positionMs, Math.max(durationMs, 1))} disabled={!mediaUrl || durationMs <= 0} onChange={(event) => seek(Number(event.currentTarget.value))}/>
        <span>{formatPreviewTime(durationMs)}</span>
      </div>
      <footer><span>履歴はこのプレビュー内のメモリにのみ保持されます</span><div><button className="text-button" onClick={() => void evaluateButtons()}>表示Scriptを再実行</button><button className="text-button" onClick={() => void restart()}>最初から</button><button className="text-button" disabled={resolving || !node?.onEnd?.length} onClick={() => void next()}>次へ</button><button className="primary-button" onClick={close}>終了</button></div></footer>
    </div>
  </div>
}
