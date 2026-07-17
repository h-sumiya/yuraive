import { useCallback, useEffect, useRef, useState } from 'react'
import { probability } from '../graph'
import type { LayoutDocument, YuraiveGraph, YuraiveNode } from '../types'
import {
  ASSET_DRAG_TYPE,
  FOLDER_DRAG_TYPE,
  LAYOUT_DRAG_TYPE,
  activeTreeDrag,
} from '../editor/workspace'
import { Icon } from './Icon'

export type View = { zoom: number; x: number; y: number }
export type GraphEdgeRef = {
  from: string
  to: string
  index: number
  type: 'end' | 'button' | 'attachment' | 'control' | 'layout'
}
type ConnectionDraft = {
  from: string
  type: 'end' | 'button' | 'attachment' | 'control' | 'layout'
  x: number
  y: number
}

type GraphCanvasProps = {
  graph: YuraiveGraph
  layouts: LayoutDocument[]
  selectedNode: string | null
  selectedButton: string | null
  selectedPlayerControl: string | null
  selectedLayout: string | null
  probabilityMode: boolean
  showWeights: boolean
  view: View
  onView: (view: View) => void
  onSelectNode: (id: string | null) => void
  onSelectButton: (id: string) => void
  onSelectPlayerControl: (id: string) => void
  onSelectLayout: (path: string) => void
  onMoveNode: (id: string, x: number, y: number) => void
  onMoveButton: (id: string, x: number, y: number) => void
  onMovePlayerControl: (id: string, x: number, y: number) => void
  onMoveLayout: (path: string, x: number, y: number) => void
  onAddNode: (x: number, y: number) => void
  onAddScriptNode: (x: number, y: number) => void
  onAddButton: (x: number, y: number) => void
  onAddLayout: (x: number, y: number, path?: string) => void
  onAddPlayerControl: (x: number, y: number) => void
  onConnectNode: (from: string, to: string) => void
  onConnectButton: (buttonId: string, to: string) => void
  onAttachButton: (nodeId: string, buttonId: string) => void
  onAttachPlayerControl: (nodeId: string, controlId: string) => void
  onAttachLayout: (controlId: string, layoutPath?: string) => void
  onAssetDrop: (path: string, nodeId: string | null, x: number, y: number) => void
  onFolderDrop: (path: string, nodeId: string | null, x: number, y: number) => void
  onLayoutDrop: (path: string, x: number, y: number) => void
  onExternalDrop: (promises: Array<Promise<FileSystemHandle | null>>, x: number, y: number) => void
  onWeightChange: (edge: GraphEdgeRef, value: number, asProbability: boolean) => void
  onDisconnect: (edge: GraphEdgeRef) => void
  onInsertNode: (edge: GraphEdgeRef) => void
  onDeleteNode: (nodeId: string, bridge: boolean) => void
  onDeleteButton: (buttonId: string) => void
  onDeleteLayout: (path: string) => void
  onDeletePlayerControl: (controlId: string) => void
  onOpenLayout: (path: string) => void
  onSave: () => void
}

export function GraphCanvas({
  graph,
  layouts,
  selectedNode,
  selectedButton,
  selectedPlayerControl,
  selectedLayout,
  probabilityMode,
  showWeights,
  view,
  onView,
  onSelectNode,
  onSelectButton,
  onSelectPlayerControl,
  onSelectLayout,
  onMoveNode,
  onMoveButton,
  onMovePlayerControl,
  onMoveLayout,
  onAddNode,
  onAddScriptNode,
  onAddButton,
  onAddLayout,
  onAddPlayerControl,
  onConnectNode,
  onConnectButton,
  onAttachButton,
  onAttachPlayerControl,
  onAttachLayout,
  onAssetDrop,
  onFolderDrop,
  onLayoutDrop,
  onExternalDrop,
  onWeightChange,
  onDisconnect,
  onInsertNode,
  onDeleteNode,
  onDeleteButton,
  onDeleteLayout,
  onDeletePlayerControl,
  onOpenLayout,
  onSave,
}: GraphCanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    type: 'node' | 'button' | 'control' | 'layout' | 'pan'
    id?: string
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const draftRef = useRef<ConnectionDraft | null>(null)
  const connectionDragged = useRef(false)
  const [draft, setDraft] = useState<ConnectionDraft | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ edge: GraphEdgeRef; x: number; y: number } | null>(
    null,
  )
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [buttonMenu, setButtonMenu] = useState<{ buttonId: string; x: number; y: number } | null>(
    null,
  )
  const [layoutMenu, setLayoutMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [controlMenu, setControlMenu] = useState<{
    controlId: string
    x: number
    y: number
  } | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<{
    x: number
    y: number
    nodeX: number
    nodeY: number
  } | null>(null)
  const [disconnectMenu, setDisconnectMenu] = useState<{
    title: string
    edges: GraphEdgeRef[]
    x: number
    y: number
  } | null>(null)
  const [dropPreview, setDropPreview] = useState<{
    x: number
    y: number
    label: string
    kind: 'folder' | 'media' | 'layout'
  } | null>(null)
  const nodeEntries = Object.entries(graph.nodes)
  const buttonEntries = Object.entries(graph.buttons)
  const playerControlEntries = Object.entries(graph.playerControls ?? {})
  const layoutEntries = Object.entries(graph.editor?.layouts ?? {})
  const transitionEdges = [
    ...nodeEntries.flatMap(([from, node]) =>
      (node.onEnd ?? []).map((transition, index) => ({
        from,
        to: transition.to,
        transition,
        index,
        type: 'end' as const,
        set: node.onEnd ?? [],
      })),
    ),
    ...buttonEntries.flatMap(([from, button]) =>
      (button.onPress ?? []).map((transition, index) => ({
        from,
        to: transition.to,
        transition,
        index,
        type: 'button' as const,
        set: button.onPress ?? [],
      })),
    ),
  ].filter((edge) => graph.nodes[edge.to])
  const attachmentEdges = nodeEntries
    .flatMap(([from, node]) =>
      (node.buttons ?? []).map((to, index) => ({ from, to, index, type: 'attachment' as const })),
    )
    .filter((edge) => graph.buttons[edge.to])
  const controlEdges = nodeEntries
    .flatMap(([from, node]) =>
      node.playerControl
        ? [{ from, to: node.playerControl, index: 0, type: 'control' as const }]
        : [],
    )
    .filter((edge) => graph.playerControls?.[edge.to])
  const layoutEdges = playerControlEntries.flatMap(([to, control]) =>
    control.layout && graph.editor?.layouts?.[control.layout]
      ? [{ from: control.layout, to, index: 0, type: 'layout' as const }]
      : [],
  )
  const edges = [...transitionEdges, ...attachmentEdges, ...controlEdges, ...layoutEdges]
  const edgeRef = (edge: (typeof edges)[number]): GraphEdgeRef => ({
    from: edge.from,
    to: edge.to,
    index: edge.index,
    type: edge.type,
  })
  const isCompactNode = (node: YuraiveNode) => node.type === 'script' || !node.media?.length
  const point = (id: string, side: 'in' | 'out') => {
    const node = graph.nodes[id]
    const compact = isCompactNode(node)
    return {
      x: (node.editor?.x ?? 0) + (side === 'in' ? 0 : compact ? 156 : 184),
      y: (node.editor?.y ?? 0) + (compact ? 24 : 35),
    }
  }
  const nodeButtonPoint = (id: string) => {
    const node = graph.nodes[id]
    return {
      x: (node.editor?.x ?? 0) + (isCompactNode(node) ? 78 : 92),
      y: (node.editor?.y ?? 0) + (isCompactNode(node) ? 48 : 84),
    }
  }
  const nodeControlPoint = (id: string) => {
    const node = graph.nodes[id]
    return { x: (node.editor?.x ?? 0) + (isCompactNode(node) ? 78 : 92), y: node.editor?.y ?? 0 }
  }
  const buttonPoint = (id: string, side: 'in' | 'out') => {
    const button = graph.buttons[id]
    return {
      x: (button.editor?.x ?? 0) + (side === 'in' ? 75 : 150),
      y: (button.editor?.y ?? 0) + (side === 'in' ? 0 : 23),
    }
  }
  const playerControlPoint = (id: string) => {
    const control = graph.playerControls[id]
    return { x: (control.editor?.x ?? 0) + 82, y: (control.editor?.y ?? 0) + 54 }
  }
  const controlLayoutPoint = (id: string) => {
    const control = graph.playerControls[id]
    return { x: (control.editor?.x ?? 0) + 82, y: control.editor?.y ?? 0 }
  }
  const layoutPoint = (path: string) => {
    const placement = graph.editor?.layouts?.[path]
    return { x: (placement?.x ?? 0) + 82, y: (placement?.y ?? 0) + 50 }
  }
  const displayName = (id: string) => graph.nodes[id]?.editor?.label || id
  const buttonName = (id: string) => graph.buttons[id]?.text || id
  const controlName = (id: string) => id
  const isDimmed = (edge: (typeof edges)[number]) =>
    selectedNode
      ? ['attachment', 'control'].includes(edge.type)
        ? edge.from !== selectedNode
        : edge.type === 'end'
          ? edge.from !== selectedNode && edge.to !== selectedNode
          : true
      : selectedButton
        ? edge.type === 'attachment'
          ? edge.to !== selectedButton
          : edge.type === 'button'
            ? edge.from !== selectedButton
            : true
        : selectedPlayerControl
          ? !['control', 'layout'].includes(edge.type) || edge.to !== selectedPlayerControl
          : selectedLayout
            ? edge.type !== 'layout' || edge.from !== selectedLayout
            : false
  const edgeStart = (edge: (typeof edges)[number]) =>
    edge.type === 'attachment'
      ? nodeButtonPoint(edge.from)
      : edge.type === 'control'
        ? nodeControlPoint(edge.from)
        : edge.type === 'layout'
          ? layoutPoint(edge.from)
          : edge.type === 'button'
            ? buttonPoint(edge.from, 'out')
            : point(edge.from, 'out')
  const edgeEnd = (edge: (typeof edges)[number]) =>
    edge.type === 'attachment'
      ? buttonPoint(edge.to, 'in')
      : edge.type === 'control'
        ? playerControlPoint(edge.to)
        : edge.type === 'layout'
          ? controlLayoutPoint(edge.to)
          : point(edge.to, 'in')
  const draftStart = (current: ConnectionDraft) =>
    current.type === 'attachment'
      ? nodeButtonPoint(current.from)
      : current.type === 'control'
        ? nodeControlPoint(current.from)
        : current.type === 'layout'
          ? layoutPoint(current.from)
          : current.type === 'button'
            ? buttonPoint(current.from, 'out')
            : point(current.from, 'out')
  const pointerMove = useCallback(
    (event: PointerEvent) => {
      if (draftRef.current) {
        connectionDragged.current = true
        const rect = surface.current?.getBoundingClientRect()
        const next = {
          ...draftRef.current,
          x: (event.clientX - (rect?.left ?? 0) - view.x) / view.zoom,
          y: (event.clientY - (rect?.top ?? 0) - view.y) / view.zoom,
        }
        draftRef.current = next
        setDraft(next)
        return
      }
      const current = drag.current
      if (!current) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      if (current.type === 'pan')
        onView({ ...view, x: current.originX + dx, y: current.originY + dy })
      else if (current.type === 'node' && current.id)
        onMoveNode(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
      else if (current.type === 'button' && current.id)
        onMoveButton(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
      else if (current.type === 'control' && current.id)
        onMovePlayerControl(
          current.id,
          current.originX + dx / view.zoom,
          current.originY + dy / view.zoom,
        )
      else if (current.type === 'layout' && current.id)
        onMoveLayout(current.id, current.originX + dx / view.zoom, current.originY + dy / view.zoom)
    },
    [onMoveButton, onMoveLayout, onMoveNode, onMovePlayerControl, onView, view],
  )
  useEffect(() => {
    const up = (event: PointerEvent) => {
      const currentDraft = draftRef.current
      if (currentDraft) {
        const targetElement = document.elementFromPoint(event.clientX, event.clientY)
        if (currentDraft.type === 'attachment') {
          const target = targetElement?.closest<HTMLElement>('.button-input-port')?.dataset.buttonId
          if (target) onAttachButton(currentDraft.from, target)
        } else if (currentDraft.type === 'control') {
          const target =
            targetElement?.closest<HTMLElement>('.control-input-port')?.dataset.controlId
          if (target) onAttachPlayerControl(currentDraft.from, target)
        } else if (currentDraft.type === 'layout') {
          const target =
            targetElement?.closest<HTMLElement>('.control-layout-port')?.dataset.controlId
          if (target) onAttachLayout(target, currentDraft.from)
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
    return () => {
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', up)
    }
  }, [
    onAttachButton,
    onAttachLayout,
    onAttachPlayerControl,
    onConnectButton,
    onConnectNode,
    pointerMove,
  ])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        draftRef.current = null
        setDraft(null)
      }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])
  useEffect(() => {
    const clearDropPreview = () => setDropPreview(null)
    window.addEventListener('drop', clearDropPreview)
    window.addEventListener('dragend', clearDropPreview)
    return () => {
      window.removeEventListener('drop', clearDropPreview)
      window.removeEventListener('dragend', clearDropPreview)
    }
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
      const zoom = Math.max(0.35, Math.min(2.5, view.zoom * Math.exp(-event.deltaY * 0.0015)))
      onView({ zoom, x: cursorX - worldX * zoom, y: cursorY - worldY * zoom })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onView, view])
  const localPoint = (clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect()
    return {
      x: (clientX - (rect?.left ?? 0) - view.x) / view.zoom,
      y: (clientY - (rect?.top ?? 0) - view.y) / view.zoom,
    }
  }
  const graphItemSelector =
    '.graph-node, .graph-button-node, .graph-layout-node, .graph-control-node, .graph-menu, .wire-weight-editor'
  return (
    <div
      className={`graph-surface ${draft ? 'connecting' : ''}`}
      ref={surface}
      onPointerDown={(event) => {
        setEdgeMenu(null)
        setNodeMenu(null)
        setButtonMenu(null)
        setLayoutMenu(null)
        setControlMenu(null)
        setCanvasMenu(null)
        setDisconnectMenu(null)
        if (event.button !== 0 || (event.target as Element).closest?.(graphItemSelector)) return
        drag.current = {
          type: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          originX: view.x,
          originY: view.y,
        }
        onSelectNode(null)
      }}
      onContextMenu={(event) => {
        if ((event.target as Element).closest?.(`${graphItemSelector}, .edge`)) return
        event.preventDefault()
        const rect = surface.current?.getBoundingClientRect()
        const local = localPoint(event.clientX, event.clientY)
        setCanvasMenu({
          x: event.clientX - (rect?.left ?? 0),
          y: event.clientY - (rect?.top ?? 0),
          nodeX: local.x - 78,
          nodeY: local.y - 24,
        })
        setEdgeMenu(null)
        setNodeMenu(null)
        setButtonMenu(null)
        setLayoutMenu(null)
        setControlMenu(null)
        setDisconnectMenu(null)
      }}
      onDoubleClick={(event) => {
        if (!(event.target as Element).closest?.(graphItemSelector)) {
          const local = localPoint(event.clientX, event.clientY)
          onAddNode(local.x - 78, local.y - 24)
        }
      }}
      onDragEnterCapture={(event) => {
        if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null)
      }}
      onDragOverCapture={(event) => {
        if ((event.target as Element).closest?.('.graph-node')) setDropPreview(null)
      }}
      onDragOver={(event) => {
        if ((event.target as Element).closest?.('.graph-node')) {
          setDropPreview(null)
          return
        }
        const hasLayout = event.dataTransfer.types.includes(LAYOUT_DRAG_TYPE)
        if (
          event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
          event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) ||
          hasLayout ||
          event.dataTransfer.types.includes('Files')
        ) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          const local = localPoint(event.clientX, event.clientY)
          const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
          const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE)
          const layout = event.dataTransfer.getData(LAYOUT_DRAG_TYPE)
          const rawLabel = path || folder || layout
          const fallbackLabel = rawLabel
            ? rawLabel === '.'
              ? 'コンテンツフォルダ'
              : (rawLabel
                  .split('/')
                  .filter(Boolean)
                  .at(-1)
                  ?.replace(/\.[^.]+$/, '') ?? '新規ノード')
            : 'ドロップして追加'
          setDropPreview({
            x: local.x,
            y: local.y,
            label: activeTreeDrag.current?.label ?? fallbackLabel,
            kind:
              activeTreeDrag.current?.kind ??
              (hasLayout
                ? 'layout'
                : folder || event.dataTransfer.types.includes('Files')
                  ? 'folder'
                  : 'media'),
          })
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(null)
      }}
      onDrop={(event) => {
        setDropPreview(null)
        const local = localPoint(event.clientX, event.clientY)
        const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
        const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE)
        const layout = event.dataTransfer.getData(LAYOUT_DRAG_TYPE)
        if (layout) {
          event.preventDefault()
          event.stopPropagation()
          onLayoutDrop(layout, local.x, local.y)
          return
        }
        if (path) {
          event.preventDefault()
          onAssetDrop(path, null, local.x, local.y)
          return
        }
        if (folder) {
          event.preventDefault()
          onFolderDrop(folder, null, local.x, local.y)
          return
        }
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.stopPropagation()
          const promises = Array.from(event.dataTransfer.items).map(
            (item) =>
              (
                item as DataTransferItem & {
                  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
                }
              ).getAsFileSystemHandle?.() ?? Promise.resolve(null),
          )
          onExternalDrop(promises, local.x, local.y)
        }
      }}
    >
      <div
        className="graph-grid"
        style={{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
        }}
      />
      <div
        className="graph-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="edges" width="4000" height="3000" viewBox="0 0 4000 3000">
          <defs>
            <marker
              id="arrow-end"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="9"
              markerHeight="9"
              orient="auto"
            >
              <path className="arrow-end-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
            <marker
              id="arrow-button"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="9"
              markerHeight="9"
              orient="auto"
            >
              <path className="arrow-button-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
            <marker
              id="arrow-attachment"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path className="arrow-attachment-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
            <marker
              id="arrow-control"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path className="arrow-control-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
            <marker
              id="arrow-layout"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path className="arrow-layout-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
            <marker
              id="arrow-draft"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="9"
              markerHeight="9"
              orient="auto"
            >
              <path className="arrow-draft-shape" d="M 1 1 L 11 6 L 1 11 z" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const a = edgeStart(edge)
            const b = edgeEnd(edge)
            const vertical =
              edge.type === 'attachment' || edge.type === 'control' || edge.type === 'layout'
            const direction = b.y >= a.y ? 1 : -1
            const bend = Math.max(45, Math.abs(vertical ? b.y - a.y : b.x - a.x) * 0.45)
            const path = vertical
              ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend * direction}, ${b.x} ${b.y - bend * direction}, ${b.x} ${b.y}`
              : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`
            const color =
              edge.type === 'button'
                ? graph.buttons[edge.from]?.editor?.color
                : edge.type === 'control'
                  ? graph.playerControls[edge.to]?.editor?.color
                  : edge.type === 'layout'
                    ? graph.editor?.layouts?.[edge.from]?.color
                    : graph.nodes[edge.from]?.editor?.color
            return (
              <g
                className={`edge ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`}
                style={{ '--edge-color': color ?? '#71808e' } as React.CSSProperties}
                data-from={edge.from}
                data-to={edge.to}
                key={`${edge.from}-${edge.type}-${edge.index}`}
              >
                <path d={path} markerEnd={`url(#arrow-${edge.type})`} />
                <path
                  className="edge-hit"
                  d={path}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    const rect = surface.current?.getBoundingClientRect()
                    setEdgeMenu({
                      edge: edgeRef(edge),
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                    setNodeMenu(null)
                    setButtonMenu(null)
                    setLayoutMenu(null)
                    setControlMenu(null)
                    setDisconnectMenu(null)
                  }}
                />
              </g>
            )
          })}
          {draft &&
            (() => {
              const a = draftStart(draft)
              const vertical =
                draft.type === 'attachment' || draft.type === 'control' || draft.type === 'layout'
              const direction = draft.y >= a.y ? 1 : -1
              const bend = Math.max(45, Math.abs(vertical ? draft.y - a.y : draft.x - a.x) * 0.45)
              const path = vertical
                ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend * direction}, ${draft.x} ${draft.y - bend * direction}, ${draft.x} ${draft.y}`
                : `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${draft.x - bend} ${draft.y}, ${draft.x} ${draft.y}`
              const color =
                graph.nodes[draft.from]?.editor?.color ??
                (draft.type === 'button'
                  ? graph.buttons[draft.from]?.editor?.color
                  : draft.type === 'layout'
                    ? graph.editor?.layouts?.[draft.from]?.color
                    : undefined)
              return (
                <path
                  className="draft-edge"
                  style={{ '--edge-color': color ?? '#55addd' } as React.CSSProperties}
                  d={path}
                  markerEnd="url(#arrow-draft)"
                />
              )
            })()}
        </svg>
        {showWeights &&
          transitionEdges
            .filter((edge) => edge.set.length > 1)
            .map((edge) => {
              const a = edgeStart(edge)
              const b = edgeEnd(edge)
              return (
                <label
                  className={`wire-weight-editor ${edge.type} ${isDimmed(edge) ? 'dimmed' : ''}`}
                  data-from={edge.from}
                  data-to={edge.to}
                  style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 - 8 }}
                  key={`editor-${edge.from}-${edge.type}-${edge.index}`}
                  title={probabilityMode ? '遷移確率' : '遷移の重み'}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="number"
                    min="0"
                    max={probabilityMode ? 100 : undefined}
                    step={probabilityMode ? 0.1 : 1}
                    value={
                      probabilityMode
                        ? Number(probability(edge.transition.weight, edge.set).toFixed(1))
                        : edge.transition.weight
                    }
                    onChange={(event) =>
                      onWeightChange(edgeRef(edge), Number(event.target.value), probabilityMode)
                    }
                  />
                  <span>{probabilityMode ? '%' : ''}</span>
                </label>
              )
            })}
        {nodeEntries.map(([id, node]) => (
          <div
            key={id}
            data-node-id={id}
            className={`graph-node ${isCompactNode(node) ? 'compact' : ''} ${node.type === 'script' ? 'script-node' : ''} ${selectedNode === id ? 'selected' : ''} ${node.terminal ? 'terminal' : ''} ${draft?.from === id && draft.type !== 'button' ? 'source' : ''}`}
            style={
              {
                left: node.editor?.x ?? 0,
                top: node.editor?.y ?? 0,
                '--node-color': node.editor?.color ?? '#4676a9',
              } as React.CSSProperties
            }
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              onSelectNode(id)
              drag.current = {
                type: 'node',
                id,
                startX: event.clientX,
                startY: event.clientY,
                originX: node.editor?.x ?? 0,
                originY: node.editor?.y ?? 0,
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const rect = surface.current?.getBoundingClientRect()
              setNodeMenu({
                nodeId: id,
                x: event.clientX - (rect?.left ?? 0),
                y: event.clientY - (rect?.top ?? 0),
              })
              setEdgeMenu(null)
              setButtonMenu(null)
              setDisconnectMenu(null)
            }}
            onDragOver={(event) => {
              if (
                node.type === 'media' &&
                (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
                  event.dataTransfer.types.includes(FOLDER_DRAG_TYPE))
              ) {
                event.preventDefault()
                event.stopPropagation()
                setDropPreview(null)
                event.currentTarget.classList.add('drag-over')
              }
            }}
            onDragLeave={(event) => event.currentTarget.classList.remove('drag-over')}
            onDrop={(event) => {
              if (node.type === 'script') return
              setDropPreview(null)
              const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
              const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE)
              event.currentTarget.classList.remove('drag-over')
              if (path) {
                event.preventDefault()
                event.stopPropagation()
                onAssetDrop(path, id, node.editor?.x ?? 0, node.editor?.y ?? 0)
              } else if (folder) {
                event.preventDefault()
                event.stopPropagation()
                onFolderDrop(folder, id, node.editor?.x ?? 0, node.editor?.y ?? 0)
              }
            }}
          >
            <div className="node-header">
              <span className="node-type-icon">
                {node.start ? (
                  <Icon name="play" size={12} />
                ) : node.type === 'script' ? (
                  <Icon name="script" size={12} />
                ) : node.terminal ? (
                  <Icon name="fit" size={12} />
                ) : (
                  <Icon name={isCompactNode(node) ? 'link' : 'dots'} size={13} />
                )}
              </span>
              <strong>{node.editor?.label || id}</strong>
              {isCompactNode(node) && (
                <span className="compact-links">
                  <Icon name={node.type === 'script' ? 'script' : 'link'} size={10} />
                  {node.type === 'script'
                    ? '0s'
                    : (node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}
                </span>
              )}
              <span className="node-badges">
                {node.start && 'START'}
                {node.terminal && 'END'}
              </span>
            </div>
            {!isCompactNode(node) && (
              <div className="node-body">
                <span>
                  <Icon name="media" size={12} />
                  {node.media?.length ?? 0}
                </span>
                <span>
                  <Icon name="link" size={12} />
                  {(node.onEnd?.length ?? 0) + (node.buttons?.length ?? 0)}
                </span>
                <small>{id}</small>
              </div>
            )}
            {node.type === 'media' && (
              <button
                className="port node-control-port"
                title="ドラッグで再生設定を接続"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  connectionDragged.current = false
                  onSelectNode(id)
                  const start = nodeControlPoint(id)
                  const next: ConnectionDraft = {
                    from: id,
                    type: 'control',
                    x: start.x,
                    y: start.y,
                  }
                  draftRef.current = next
                  setDraft(next)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (connectionDragged.current) {
                    connectionDragged.current = false
                    return
                  }
                  const attached = controlEdges.filter((edge) => edge.from === id).map(edgeRef)
                  if (attached.length === 1) onDisconnect(attached[0])
                }}
              />
            )}
            {node.start ? (
              <span className="port input disabled" title="開始ノードには入力できません" />
            ) : (
              <span
                className="port input node-input-port"
                data-node-id={id}
                title="クリックして接続を解除"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  const incoming = transitionEdges.filter((edge) => edge.to === id).map(edgeRef)
                  if (incoming.length === 1) onDisconnect(incoming[0])
                  else if (incoming.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${displayName(id)} への接続`,
                      edges: incoming,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                    setEdgeMenu(null)
                    setNodeMenu(null)
                  }
                }}
              />
            )}
            {!node.terminal ? (
              <button
                className="port output"
                title="ドラッグで終了時遷移を接続"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  connectionDragged.current = false
                  onSelectNode(id)
                  const start = point(id, 'out')
                  const next: ConnectionDraft = { from: id, type: 'end', x: start.x, y: start.y }
                  draftRef.current = next
                  setDraft(next)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (connectionDragged.current) {
                    connectionDragged.current = false
                    return
                  }
                  const outgoing = transitionEdges
                    .filter((edge) => edge.type === 'end' && edge.from === id)
                    .map(edgeRef)
                  if (outgoing.length === 1) onDisconnect(outgoing[0])
                  else if (outgoing.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${displayName(id)} からの接続`,
                      edges: outgoing,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                    setEdgeMenu(null)
                    setNodeMenu(null)
                  }
                }}
              />
            ) : (
              <span className="port output disabled" title="終端ノードからは出力できません" />
            )}
            {node.type === 'media' && !node.terminal && (
              <button
                className="port node-button-port"
                title="ドラッグでボタンを接続"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  connectionDragged.current = false
                  onSelectNode(id)
                  const start = nodeButtonPoint(id)
                  const next: ConnectionDraft = {
                    from: id,
                    type: 'attachment',
                    x: start.x,
                    y: start.y,
                  }
                  draftRef.current = next
                  setDraft(next)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (connectionDragged.current) {
                    connectionDragged.current = false
                    return
                  }
                  const attached = attachmentEdges.filter((edge) => edge.from === id).map(edgeRef)
                  if (attached.length === 1) onDisconnect(attached[0])
                  else if (attached.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${displayName(id)} のボタン`,
                      edges: attached,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }
                }}
              />
            )}
          </div>
        ))}
        {buttonEntries.map(([id, button]) => {
          const outgoing = transitionEdges
            .filter((edge) => edge.type === 'button' && edge.from === id)
            .map(edgeRef)
          const incoming = attachmentEdges.filter((edge) => edge.to === id).map(edgeRef)
          return (
            <div
              className={`graph-button-node ${selectedButton === id ? 'selected' : ''} ${draft?.from === id && draft.type === 'button' ? 'source' : ''}`}
              data-button-id={id}
              style={
                {
                  left: button.editor?.x ?? 0,
                  top: button.editor?.y ?? 0,
                  '--node-color': button.editor?.color ?? '#8b6fa3',
                } as React.CSSProperties
              }
              key={id}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                onSelectButton(id)
                drag.current = {
                  type: 'button',
                  id,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: button.editor?.x ?? 0,
                  originY: button.editor?.y ?? 0,
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const rect = surface.current?.getBoundingClientRect()
                setButtonMenu({
                  buttonId: id,
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                })
                setEdgeMenu(null)
                setNodeMenu(null)
                setDisconnectMenu(null)
              }}
            >
              <button
                className="port button-input-port"
                data-button-id={id}
                title="ノードとの接続"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (incoming.length === 1) onDisconnect(incoming[0])
                  else if (incoming.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${buttonName(id)} を使用するノード`,
                      edges: incoming,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }
                }}
              />
              <span className="button-glyph">B</span>
              <div>
                <strong>{button.text || id}</strong>
                <small>
                  {id} · {incoming.length} ノード · {outgoing.length} 遷移
                </small>
              </div>
              <button
                className="port output button-port"
                title="ドラッグで押下時遷移を作成"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  connectionDragged.current = false
                  onSelectButton(id)
                  const start = buttonPoint(id, 'out')
                  const next: ConnectionDraft = { from: id, type: 'button', x: start.x, y: start.y }
                  draftRef.current = next
                  setDraft(next)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (connectionDragged.current) {
                    connectionDragged.current = false
                    return
                  }
                  if (outgoing.length === 1) onDisconnect(outgoing[0])
                  else if (outgoing.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${buttonName(id)} からの接続`,
                      edges: outgoing,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }
                }}
              />
            </div>
          )
        })}
        {layoutEntries.map(([path, placement]) => {
          const outgoing = layoutEdges.filter((edge) => edge.from === path).map(edgeRef)
          const layout = layouts.find((item) => item.path === path)
          return (
            <div
              className={`graph-layout-node ${selectedLayout === path ? 'selected' : ''} ${draft?.from === path && draft.type === 'layout' ? 'source' : ''} ${layout ? '' : 'missing'}`}
              data-layout-path={path}
              style={
                {
                  left: placement.x ?? 0,
                  top: placement.y ?? 0,
                  '--node-color': placement.color ?? '#4d8e9f',
                } as React.CSSProperties
              }
              key={path}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                onSelectLayout(path)
                drag.current = {
                  type: 'layout',
                  id: path,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: placement.x ?? 0,
                  originY: placement.y ?? 0,
                }
              }}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (layout) onOpenLayout(path)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const rect = surface.current?.getBoundingClientRect()
                setLayoutMenu({
                  path,
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                })
                setEdgeMenu(null)
                setNodeMenu(null)
                setButtonMenu(null)
                setControlMenu(null)
                setDisconnectMenu(null)
              }}
            >
              <span className="layout-glyph">
                <Icon name="fit" size={14} />
              </span>
              <div>
                <strong>{path.split('/').at(-1)}</strong>
                <small>{layout ? `${outgoing.length} 再生設定` : 'ファイルが見つかりません'}</small>
              </div>
              <button
                className="port layout-output-port"
                title="ドラッグで再生設定の上部ポートへ接続"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  connectionDragged.current = false
                  onSelectLayout(path)
                  const start = layoutPoint(path)
                  const next: ConnectionDraft = {
                    from: path,
                    type: 'layout',
                    x: start.x,
                    y: start.y,
                  }
                  draftRef.current = next
                  setDraft(next)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (connectionDragged.current) {
                    connectionDragged.current = false
                    return
                  }
                  if (outgoing.length === 1) onDisconnect(outgoing[0])
                  else if (outgoing.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${path.split('/').at(-1)} の接続`,
                      edges: outgoing,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }
                }}
              />
            </div>
          )
        })}
        {playerControlEntries.map(([id, control]) => {
          const incoming = controlEdges.filter((edge) => edge.to === id).map(edgeRef)
          return (
            <div
              className={`graph-control-node ${selectedPlayerControl === id ? 'selected' : ''} ${control.layout ? 'has-layout' : ''}`}
              data-control-id={id}
              style={
                {
                  left: control.editor?.x ?? 0,
                  top: control.editor?.y ?? 0,
                  '--node-color': control.editor?.color ?? '#4f8c78',
                } as React.CSSProperties
              }
              key={id}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                onSelectPlayerControl(id)
                drag.current = {
                  type: 'control',
                  id,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: control.editor?.x ?? 0,
                  originY: control.editor?.y ?? 0,
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const rect = surface.current?.getBoundingClientRect()
                setControlMenu({
                  controlId: id,
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                })
                setEdgeMenu(null)
                setNodeMenu(null)
                setButtonMenu(null)
                setDisconnectMenu(null)
              }}
            >
              <span className="control-glyph">
                <Icon name="controls" size={14} />
              </span>
              <div>
                <strong>{id}</strong>
                <small>
                  {control.layout
                    ? control.layout.split('/').at(-1)
                    : graph.globalPlayerControl === id
                      ? 'GLOBAL · レイアウト未接続'
                      : `${incoming.length} ノード · レイアウト未接続`}
                </small>
              </div>
              <button
                className="port control-layout-port"
                data-control-id={id}
                title={
                  control.layout
                    ? `${control.layout}（クリックで解除）`
                    : 'レイアウトノードを接続、またはファイルをドロップ'
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (control.layout) onAttachLayout(id, undefined)
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(LAYOUT_DRAG_TYPE)) {
                    event.preventDefault()
                    event.stopPropagation()
                    event.dataTransfer.dropEffect = 'copy'
                    event.currentTarget.classList.add('drag-over')
                  }
                }}
                onDragLeave={(event) => event.currentTarget.classList.remove('drag-over')}
                onDrop={(event) => {
                  const path = event.dataTransfer.getData(LAYOUT_DRAG_TYPE)
                  event.currentTarget.classList.remove('drag-over')
                  if (path) {
                    event.preventDefault()
                    event.stopPropagation()
                    onAttachLayout(id, path)
                  }
                }}
              />
              <button
                className="port control-input-port"
                data-control-id={id}
                title="ノードとの設定接続"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (incoming.length === 1) onDisconnect(incoming[0])
                  else if (incoming.length > 1) {
                    const rect = surface.current?.getBoundingClientRect()
                    setDisconnectMenu({
                      title: `${controlName(id)} を使用するノード`,
                      edges: incoming,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }
                }}
              />
            </div>
          )
        })}
        {dropPreview && (
          <div
            className={`drop-node-preview ${dropPreview.kind}`}
            style={{ left: dropPreview.x - 92, top: dropPreview.y - 42 }}
          >
            <span className="preview-node-icon">
              <Icon
                name={
                  dropPreview.kind === 'folder'
                    ? 'folder'
                    : dropPreview.kind === 'layout'
                      ? 'fit'
                      : 'media'
                }
                size={14}
              />
            </span>
            <div>
              <strong>{dropPreview.label}</strong>
              <small>
                {dropPreview.kind === 'folder'
                  ? '音声・動画を一括追加'
                  : dropPreview.kind === 'layout'
                    ? 'レイアウトノードを配置'
                    : 'メディアノードを追加'}
              </small>
            </div>
          </div>
        )}
      </div>
      {draft && (
        <div className="connect-hint">
          <Icon name="link" size={14} />
          {draft.type === 'attachment'
            ? 'ボタン上部の入力ポートへドロップ'
            : draft.type === 'control'
              ? '上側にある再生設定ノードへドロップ'
              : draft.type === 'layout'
                ? '再生設定上部のレイアウトポートへドロップ'
                : 'ノード左側の入力ポートへドロップ'}
        </div>
      )}
      {edgeMenu && (
        <div
          className="graph-menu"
          style={{ left: edgeMenu.x, top: edgeMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {!['attachment', 'control', 'layout'].includes(edgeMenu.edge.type) && (
            <button
              onClick={() => {
                onInsertNode(edgeMenu.edge)
                setEdgeMenu(null)
              }}
            >
              <Icon name="plus" size={13} />
              ノードを間に追加
            </button>
          )}
          <button
            onClick={() => {
              onDisconnect(edgeMenu.edge)
              setEdgeMenu(null)
            }}
          >
            <Icon name="close" size={13} />
            接続を解除
          </button>
        </div>
      )}
      {nodeMenu && (
        <div
          className="graph-menu"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="danger"
            onClick={() => {
              onDeleteNode(nodeMenu.nodeId, false)
              setNodeMenu(null)
            }}
          >
            <Icon name="trash" size={13} />
            削除
          </button>
          <button
            onClick={() => {
              onDeleteNode(nodeMenu.nodeId, true)
              setNodeMenu(null)
            }}
          >
            <Icon name="link" size={13} />
            前後を接続して削除
          </button>
        </div>
      )}
      {buttonMenu && (
        <div
          className="graph-menu"
          style={{ left: buttonMenu.x, top: buttonMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="danger"
            onClick={() => {
              onDeleteButton(buttonMenu.buttonId)
              setButtonMenu(null)
            }}
          >
            <Icon name="trash" size={13} />
            ボタンを削除
          </button>
        </div>
      )}
      {layoutMenu && (
        <div
          className="graph-menu"
          style={{ left: layoutMenu.x, top: layoutMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              onOpenLayout(layoutMenu.path)
              setLayoutMenu(null)
            }}
          >
            <Icon name="fit" size={13} />
            レイアウトを開く
          </button>
          <button
            className="danger"
            onClick={() => {
              onDeleteLayout(layoutMenu.path)
              setLayoutMenu(null)
            }}
          >
            <Icon name="trash" size={13} />
            グラフから取り除く
          </button>
        </div>
      )}
      {controlMenu && (
        <div
          className="graph-menu"
          style={{ left: controlMenu.x, top: controlMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="danger"
            onClick={() => {
              onDeletePlayerControl(controlMenu.controlId)
              setControlMenu(null)
            }}
          >
            <Icon name="trash" size={13} />
            再生設定を削除
          </button>
        </div>
      )}
      {canvasMenu && (
        <div
          className="graph-menu canvas-menu"
          style={{ left: canvasMenu.x, top: canvasMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              onAddNode(canvasMenu.nodeX, canvasMenu.nodeY)
              setCanvasMenu(null)
            }}
          >
            <Icon name="plus" size={13} />
            メディアノードを作成
          </button>
          <button
            onClick={() => {
              onAddButton(canvasMenu.nodeX, canvasMenu.nodeY)
              setCanvasMenu(null)
            }}
          >
            <span className="button-glyph">B</span>ボタンを作成
          </button>
          <button
            onClick={() => {
              onAddLayout(canvasMenu.nodeX, canvasMenu.nodeY)
              setCanvasMenu(null)
            }}
          >
            <Icon name="fit" size={13} />
            レイアウトを配置
          </button>
          <button
            onClick={() => {
              onAddScriptNode(canvasMenu.nodeX, canvasMenu.nodeY)
              setCanvasMenu(null)
            }}
          >
            <Icon name="script" size={13} />
            Script Nodeを作成
          </button>
          <button
            onClick={() => {
              onAddPlayerControl(canvasMenu.nodeX, canvasMenu.nodeY)
              setCanvasMenu(null)
            }}
          >
            <Icon name="controls" size={13} />
            再生設定を作成
          </button>
          <button
            onClick={() => {
              onSave()
              setCanvasMenu(null)
            }}
          >
            <Icon name="save" size={13} />
            保存
          </button>
        </div>
      )}
      {disconnectMenu && (
        <div
          className="graph-menu disconnect-menu"
          style={{ left: disconnectMenu.x, top: disconnectMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{disconnectMenu.title}</strong>
          {disconnectMenu.edges.map((edge) => (
            <button
              key={`${edge.from}-${edge.type}-${edge.index}`}
              onClick={() => {
                onDisconnect(edge)
                setDisconnectMenu(null)
              }}
            >
              <Icon name="close" size={12} />
              <span>
                {edge.type === 'attachment'
                  ? `${displayName(edge.from)} → ${buttonName(edge.to)}`
                  : edge.type === 'control'
                    ? `${displayName(edge.from)} → ${controlName(edge.to)}`
                    : edge.type === 'layout'
                      ? `${edge.from.split('/').at(-1)} → ${controlName(edge.to)}`
                      : edge.type === 'button'
                        ? `${buttonName(edge.from)} → ${displayName(edge.to)}`
                        : `${displayName(edge.from)} → ${displayName(edge.to)}`}
              </span>
              <small>
                {edge.type === 'attachment'
                  ? 'ボタン接続'
                  : edge.type === 'control'
                    ? '再生設定'
                    : edge.type === 'layout'
                      ? 'レイアウト'
                      : edge.type === 'button'
                        ? '押下時'
                        : '再生終了時'}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
