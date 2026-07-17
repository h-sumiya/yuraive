import type { Dispatch, SetStateAction } from 'react'
import {
  DEFAULT_PLAYER_CONTROLS,
  defaultMedia,
  nextButtonColor,
  nextLayoutColor,
  nextNodeColor,
  nextPlayerControlColor,
} from './graph'
import type { GraphEdgeRef, View } from './components/GraphCanvas'
import type {
  AssetEntry,
  GraphDocument,
  LayoutDocument,
  PlayerControlSettings,
  ScriptDocument,
  Transition,
  YuraiveButton,
  YuraiveGraph,
  YuraiveNode,
} from './types'
import { mediaForAsset } from './editor/workspace'

type NullableSelectionSetter = Dispatch<SetStateAction<string | null>>

type GraphOperationsOptions = {
  active: GraphDocument | undefined
  docAssets: AssetEntry[]
  docScripts: ScriptDocument[]
  docLayouts: LayoutDocument[]
  scripts: ScriptDocument[]
  view: View
  selectedNode: string | null
  selectedButton: string | null
  selectedPlayerControl: string | null
  selectedGraphLayout: string | null
  rootName: string
  setSelectedNode: NullableSelectionSetter
  setSelectedButton: NullableSelectionSetter
  setSelectedPlayerControl: NullableSelectionSetter
  setSelectedGraphLayout: NullableSelectionSetter
  updateGraph: (graph: YuraiveGraph) => void
  notify: (message: string) => void
}

export function createGraphOperations({
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
}: GraphOperationsOptions) {
  const updateNode = (node: YuraiveNode) => {
    if (!active || !selectedNode) return
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, current]) => [
        id,
        node.start && id !== selectedNode ? { ...current, start: false } : current,
      ]),
    )
    nodes[selectedNode] = node
    updateGraph({ ...active.graph, nodes })
  }
  const setSelectedNodeStart = (enabled: boolean) => {
    if (!active || !selectedNode) return
    const current = active.graph.nodes[selectedNode]
    if (!current || Boolean(current.start) === enabled) return
    const incomingCount =
      Object.values(active.graph.nodes).reduce(
        (count, node) =>
          count + (node.onEnd ?? []).filter((transition) => transition.to === selectedNode).length,
        0,
      ) +
      Object.values(active.graph.buttons).reduce(
        (count, button) =>
          count +
          (button.onPress ?? []).filter((transition) => transition.to === selectedNode).length,
        0,
      )
    if (
      enabled &&
      incomingCount > 0 &&
      !window.confirm('開始ノードにすると入力側の接続は強制的に解除されます。\n続行しますか？')
    )
      return
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          start: enabled ? id === selectedNode : id === selectedNode ? false : node.start,
          onEnd: enabled
            ? (node.onEnd ?? []).filter((transition) => transition.to !== selectedNode)
            : node.onEnd,
        },
      ]),
    )
    const buttons = enabled
      ? Object.fromEntries(
          Object.entries(active.graph.buttons).map(([id, button]) => [
            id,
            {
              ...button,
              onPress: (button.onPress ?? []).filter(
                (transition) => transition.to !== selectedNode,
              ),
            },
          ]),
        )
      : active.graph.buttons
    updateGraph({ ...active.graph, nodes, buttons })
  }
  const setSelectedNodeTerminal = (enabled: boolean) => {
    if (!active || !selectedNode) return
    const current = active.graph.nodes[selectedNode]
    if (!current || current.type === 'script' || Boolean(current.terminal) === enabled) return
    const outgoingCount = (current.onEnd ?? []).length + (current.buttons?.length ?? 0)
    if (
      enabled &&
      outgoingCount > 0 &&
      !window.confirm('終端ノードにすると出力側の接続は強制的に解除されます。\n続行しますか？')
    )
      return
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [selectedNode]: {
          ...current,
          terminal: enabled,
          onEnd: enabled ? [] : current.onEnd,
          buttons: enabled ? [] : current.buttons,
        },
      },
    })
  }
  const renameNode = (next: string) => {
    if (!active || !selectedNode || next === selectedNode) return
    if (!next || active.graph.nodes[next]) {
      notify(!next ? 'ノードIDは空にできません' : '同じノードIDが既にあります')
      return
    }
    const nodes: Record<string, YuraiveNode> = {}
    Object.entries(active.graph.nodes).forEach(([id, node]) => {
      nodes[id === selectedNode ? next : id] = {
        ...node,
        onEnd: node.onEnd?.map((transition) =>
          transition.to === selectedNode ? { ...transition, to: next } : transition,
        ),
      }
    })
    const buttons = Object.fromEntries(
      Object.entries(active.graph.buttons).map(([id, button]) => [
        id,
        {
          ...button,
          onPress: button.onPress?.map((transition) =>
            transition.to === selectedNode ? { ...transition, to: next } : transition,
          ),
        },
      ]),
    )
    updateGraph({ ...active.graph, nodes, buttons })
    setSelectedNode(next)
  }
  const deleteNodeById = (nodeId: string, bridge = false) => {
    if (!active || !active.graph.nodes[nodeId]) return
    const target = active.graph.nodes[nodeId]
    const outgoing = (target.onEnd ?? []).filter(
      (transition) => transition.to !== nodeId && active.graph.nodes[transition.to],
    )
    const outgoingTotal = outgoing.reduce(
      (sum, transition) => sum + Math.max(0, transition.weight),
      0,
    )
    const reconnect = (transitions: Transition[] = []) => {
      const expanded = transitions.flatMap((transition) => {
        if (transition.to !== nodeId) return [transition]
        if (!bridge || !outgoing.length) return []
        return outgoing.map((next) => ({
          to: next.to,
          weight:
            outgoingTotal > 0
              ? (transition.weight * Math.max(0, next.weight)) / outgoingTotal
              : transition.weight / outgoing.length,
        }))
      })
      const merged = new Map<string, number>()
      expanded.forEach((transition) =>
        merged.set(transition.to, (merged.get(transition.to) ?? 0) + transition.weight),
      )
      return [...merged].map(([to, weight]) => ({ to, weight: Number(weight.toFixed(4)) }))
    }
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes)
        .filter(([id]) => id !== nodeId)
        .map(([id, node]) => [id, { ...node, onEnd: reconnect(node.onEnd) }]),
    )
    const buttons = Object.fromEntries(
      Object.entries(active.graph.buttons).map(([id, button]) => [
        id,
        { ...button, onPress: reconnect(button.onPress) },
      ]),
    )
    if (bridge && target.start && outgoing[0] && nodes[outgoing[0].to])
      nodes[outgoing[0].to] = { ...nodes[outgoing[0].to], start: true }
    updateGraph({ ...active.graph, nodes, buttons })
    if (selectedNode === nodeId) setSelectedNode(null)
  }
  const deleteNode = () => {
    if (selectedNode) deleteNodeById(selectedNode)
  }
  const updateSelectedButton = (button: YuraiveButton) => {
    if (!active || !selectedButton || !active.graph.buttons[selectedButton]) return
    updateGraph({ ...active.graph, buttons: { ...active.graph.buttons, [selectedButton]: button } })
  }
  const renameButton = (next: string) => {
    if (!active || !selectedButton || next === selectedButton) return
    if (!next || active.graph.buttons[next]) {
      notify(!next ? 'ボタンIDは空にできません' : '同じボタンIDが既にあります')
      return
    }
    const buttons = Object.fromEntries(
      Object.entries(active.graph.buttons).map(([id, button]) => [
        id === selectedButton ? next : id,
        button,
      ]),
    )
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          buttons: node.buttons?.map((buttonId) => (buttonId === selectedButton ? next : buttonId)),
        },
      ]),
    )
    updateGraph({ ...active.graph, nodes, buttons })
    setSelectedButton(next)
  }
  const deleteButtonById = (buttonId: string) => {
    if (!active || !active.graph.buttons[buttonId]) return
    const buttons = Object.fromEntries(
      Object.entries(active.graph.buttons).filter(([id]) => id !== buttonId),
    )
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, node]) => [
        id,
        { ...node, buttons: node.buttons?.filter((id) => id !== buttonId) },
      ]),
    )
    updateGraph({ ...active.graph, nodes, buttons })
    if (selectedButton === buttonId) setSelectedButton(null)
  }
  const attachButton = (nodeId: string, buttonId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (!node || node.type === 'script' || node.terminal || !active.graph.buttons[buttonId]) return
    if (node.buttons?.includes(buttonId)) {
      notify('このノードには既に接続されています')
      return
    }
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [nodeId]: { ...node, buttons: [...(node.buttons ?? []), buttonId] },
      },
    })
  }
  const detachButton = (nodeId: string, buttonId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (node)
      updateGraph({
        ...active.graph,
        nodes: {
          ...active.graph.nodes,
          [nodeId]: { ...node, buttons: node.buttons?.filter((id) => id !== buttonId) },
        },
      })
  }

  const updateSelectedPlayerControl = (control: PlayerControlSettings) => {
    if (!active || !selectedPlayerControl || !active.graph.playerControls[selectedPlayerControl])
      return
    updateGraph({
      ...active.graph,
      playerControls: { ...active.graph.playerControls, [selectedPlayerControl]: control },
    })
  }
  const renamePlayerControl = (next: string) => {
    if (!active || !selectedPlayerControl || next === selectedPlayerControl) return
    if (!next || active.graph.playerControls[next]) {
      notify(!next ? '再生設定IDは空にできません' : '同じ再生設定IDが既にあります')
      return
    }
    const playerControls = Object.fromEntries(
      Object.entries(active.graph.playerControls).map(([id, control]) => [
        id === selectedPlayerControl ? next : id,
        control,
      ]),
    )
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, node]) => [
        id,
        node.playerControl === selectedPlayerControl ? { ...node, playerControl: next } : node,
      ]),
    )
    updateGraph({
      ...active.graph,
      playerControls,
      nodes,
      globalPlayerControl:
        active.graph.globalPlayerControl === selectedPlayerControl
          ? next
          : active.graph.globalPlayerControl,
    })
    setSelectedPlayerControl(next)
  }
  const deletePlayerControlById = (controlId: string) => {
    if (!active || !active.graph.playerControls[controlId]) return
    const playerControls = Object.fromEntries(
      Object.entries(active.graph.playerControls).filter(([id]) => id !== controlId),
    )
    const nodes = Object.fromEntries(
      Object.entries(active.graph.nodes).map(([id, node]) => [
        id,
        node.playerControl === controlId ? { ...node, playerControl: undefined } : node,
      ]),
    )
    updateGraph({
      ...active.graph,
      playerControls,
      nodes,
      globalPlayerControl:
        active.graph.globalPlayerControl === controlId
          ? undefined
          : active.graph.globalPlayerControl,
    })
    if (selectedPlayerControl === controlId) setSelectedPlayerControl(null)
  }
  const attachPlayerControl = (nodeId: string, controlId: string) => {
    if (!active || !active.graph.playerControls[controlId]) return
    const node = active.graph.nodes[nodeId]
    if (!node || node.type !== 'media') return
    if (node.playerControl === controlId) {
      notify('このノードには既に接続されています')
      return
    }
    updateGraph({
      ...active.graph,
      nodes: { ...active.graph.nodes, [nodeId]: { ...node, playerControl: controlId } },
    })
  }
  const attachLayout = (controlId: string, layoutPath?: string) => {
    if (!active || !active.graph.playerControls[controlId]) return
    if (layoutPath && !docLayouts.some((layout) => layout.path === layoutPath)) {
      notify(`レイアウトが見つかりません: ${layoutPath}`)
      return
    }
    const control = active.graph.playerControls[controlId]
    const layouts = { ...(active.graph.editor?.layouts ?? {}) }
    if (layoutPath && !layouts[layoutPath]) {
      const controlX = control.editor?.x ?? 160
      const controlY = control.editor?.y ?? 120
      layouts[layoutPath] = {
        x: controlY < 90 ? controlX + 190 : controlX,
        y: controlY < 90 ? controlY : Math.max(20, controlY - 90),
        color: nextLayoutColor(layouts),
      }
    }
    updateGraph({
      ...active.graph,
      playerControls: {
        ...active.graph.playerControls,
        [controlId]: { ...control, layout: layoutPath },
      },
      editor: { ...active.graph.editor, layouts },
    })
  }
  const detachPlayerControl = (nodeId: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    if (node?.playerControl)
      updateGraph({
        ...active.graph,
        nodes: { ...active.graph.nodes, [nodeId]: { ...node, playerControl: undefined } },
      })
  }

  const updateEdgeSet = (
    edge: GraphEdgeRef,
    updater: (transitions: Transition[]) => Transition[],
  ) => {
    if (!active) return
    if (edge.type === 'attachment' || edge.type === 'control' || edge.type === 'layout') return
    if (edge.type === 'end') {
      const source = active.graph.nodes[edge.from]
      if (!source) return
      updateGraph({
        ...active.graph,
        nodes: {
          ...active.graph.nodes,
          [edge.from]: { ...source, onEnd: updater(source.onEnd ?? []) },
        },
      })
      return
    }
    const button = active.graph.buttons[edge.from]
    if (button)
      updateGraph({
        ...active.graph,
        buttons: {
          ...active.graph.buttons,
          [edge.from]: { ...button, onPress: updater(button.onPress ?? []) },
        },
      })
  }
  const disconnectEdge = (edge: GraphEdgeRef) => {
    if (edge.type === 'attachment') {
      detachButton(edge.from, edge.to)
      return
    }
    if (edge.type === 'control') {
      detachPlayerControl(edge.from)
      return
    }
    if (edge.type === 'layout') {
      attachLayout(edge.to, undefined)
      return
    }
    updateEdgeSet(edge, (transitions) => transitions.filter((_, index) => index !== edge.index))
  }
  const changeEdgeWeight = (edge: GraphEdgeRef, value: number, asProbability: boolean) =>
    updateEdgeSet(edge, (transitions) => {
      if (!transitions[edge.index]) return transitions
      if (!asProbability)
        return transitions.map((transition, index) =>
          index === edge.index ? { ...transition, weight: Math.max(0, value || 0) } : transition,
        )
      if (transitions.length === 1) return [{ ...transitions[0], weight: 1 }]
      const percent = Math.max(0, Math.min(100, value || 0))
      const othersTotal = transitions.reduce(
        (sum, transition, index) =>
          index === edge.index ? sum : sum + Math.max(0, transition.weight),
        0,
      )
      return transitions.map((transition, index) => {
        if (index === edge.index) return { ...transition, weight: percent }
        const weight =
          othersTotal > 0
            ? (Math.max(0, transition.weight) / othersTotal) * (100 - percent)
            : (100 - percent) / (transitions.length - 1)
        return { ...transition, weight: Number(weight.toFixed(4)) }
      })
    })
  const insertNodeOnEdge = (edge: GraphEdgeRef) => {
    if (!active || edge.type === 'attachment' || edge.type === 'control' || edge.type === 'layout')
      return
    const destination = active.graph.nodes[edge.to]
    const sourcePosition =
      edge.type === 'end'
        ? active.graph.nodes[edge.from]?.editor
        : active.graph.buttons[edge.from]?.editor
    if (!sourcePosition || !destination) return
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    const replace = (transitions: Transition[]) =>
      transitions.map((transition, index) =>
        index === edge.index ? { ...transition, to: id } : transition,
      )
    const x = ((sourcePosition.x ?? 0) + (destination.editor?.x ?? 0)) / 2
    const y = ((sourcePosition.y ?? 0) + (destination.editor?.y ?? 0)) / 2
    const node: YuraiveNode = {
      type: 'media',
      media: [],
      onEnd: [{ to: edge.to, weight: 1 }],
      buttons: [],
      editor: {
        x: Math.round(x),
        y: Math.round(y),
        label: `Node ${number}`,
        color: nextNodeColor(active.graph.nodes),
      },
    }
    if (edge.type === 'end') {
      const source = active.graph.nodes[edge.from]
      updateGraph({
        ...active.graph,
        nodes: {
          ...active.graph.nodes,
          [edge.from]: { ...source, onEnd: replace(source.onEnd ?? []) },
          [id]: node,
        },
      })
    } else {
      const button = active.graph.buttons[edge.from]
      updateGraph({
        ...active.graph,
        nodes: { ...active.graph.nodes, [id]: node },
        buttons: {
          ...active.graph.buttons,
          [edge.from]: { ...button, onPress: replace(button.onPress ?? []) },
        },
      })
    }
    setSelectedNode(id)
    setSelectedButton(null)
  }
  const addNode = (x = 160, y = 140) => {
    if (!active) return
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [id]: {
          type: 'media',
          media: [],
          onEnd: [],
          buttons: [],
          editor: {
            x: Math.max(20, Math.round(x)),
            y: Math.max(20, Math.round(y)),
            label: `Node ${number}`,
            color: nextNodeColor(active.graph.nodes),
          },
        },
      },
    })
    setSelectedNode(id)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const addScriptNode = (x = 160, y = 140) => {
    if (!active) return
    let number = 1
    while (active.graph.nodes[`script-${number}`]) number++
    const id = `script-${number}`
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [id]: {
          type: 'script',
          script: docScripts[0] ? { path: docScripts[0].path, function: 'jump' } : undefined,
          onEnd: [],
          editor: {
            x: Math.max(20, Math.round(x)),
            y: Math.max(20, Math.round(y)),
            label: `Script ${number}`,
            color: '#8d65b5',
          },
        },
      },
    })
    setSelectedNode(id)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
    if (!scripts.length)
      notify(
        'Script Nodeを作成しました。ファイルツリーの右クリックからStarlarkファイルを作成してください',
      )
  }
  const addButton = (x = 210, y = 240, attachToNode?: string) => {
    if (!active) return
    let number = Object.keys(active.graph.buttons).length + 1
    while (active.graph.buttons[`button-${number}`]) number++
    const id = `button-${number}`
    const button: YuraiveButton = {
      targetSlot: 'actions',
      order: number * 10,
      zIndex: 0,
      text: `Button ${number}`,
      style: {
        backgroundColor: '#574de5',
        textColor: '#ffffff',
        opacity: 1,
        borderWidth: 0,
        borderRadius: 18,
        fontSize: 16,
        fontWeight: 600,
        paddingHorizontal: 20,
        paddingVertical: 12,
      },
      onPress: [],
      editor: { x: Math.round(x), y: Math.round(y), color: nextButtonColor(active.graph.buttons) },
    }
    const nodes =
      attachToNode && active.graph.nodes[attachToNode] && !active.graph.nodes[attachToNode].terminal
        ? {
            ...active.graph.nodes,
            [attachToNode]: {
              ...active.graph.nodes[attachToNode],
              buttons: [...(active.graph.nodes[attachToNode].buttons ?? []), id],
            },
          }
        : active.graph.nodes
    updateGraph({ ...active.graph, nodes, buttons: { ...active.graph.buttons, [id]: button } })
    setSelectedNode(null)
    setSelectedButton(id)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(null)
  }
  const addLayout = (x = 210, y = 80, requestedPath?: string) => {
    if (!active) return
    const current = active.graph.editor?.layouts ?? {}
    const path = requestedPath ?? docLayouts.find((layout) => !current[layout.path])?.path
    if (!path) {
      notify(
        docLayouts.length
          ? 'すべてのレイアウトがグラフ上に配置済みです'
          : '先にレイアウトファイルを作成してください',
      )
      return
    }
    if (!docLayouts.some((layout) => layout.path === path)) {
      notify(`レイアウトが見つかりません: ${path}`)
      return
    }
    const placement = current[path]
    const layouts = {
      ...current,
      [path]: {
        ...placement,
        x: Math.max(20, Math.round(x)),
        y: Math.max(20, Math.round(y)),
        color: placement?.color ?? nextLayoutColor(current),
      },
    }
    updateGraph({ ...active.graph, editor: { ...active.graph.editor, layouts } })
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(null)
    setSelectedGraphLayout(path)
  }
  const removeLayoutNode = (path: string) => {
    if (!active || !active.graph.editor?.layouts?.[path]) return
    const layouts = Object.fromEntries(
      Object.entries(active.graph.editor.layouts).filter(([candidate]) => candidate !== path),
    )
    const playerControls = Object.fromEntries(
      Object.entries(active.graph.playerControls).map(([id, control]) => [
        id,
        control.layout === path ? { ...control, layout: undefined } : control,
      ]),
    )
    updateGraph({ ...active.graph, playerControls, editor: { ...active.graph.editor, layouts } })
    if (selectedGraphLayout === path) setSelectedGraphLayout(null)
  }
  const addPlayerControl = (x = 160, y = 40) => {
    if (!active) return
    let number = Object.keys(active.graph.playerControls ?? {}).length + 1
    while (active.graph.playerControls[`controls-${number}`]) number++
    const id = `controls-${number}`
    const control: PlayerControlSettings = {
      ...DEFAULT_PLAYER_CONTROLS,
      layout: docLayouts[0]?.path,
      editor: {
        x: Math.max(20, Math.round(x)),
        y: Math.max(20, Math.round(y)),
        color: nextPlayerControlColor(active.graph.playerControls),
      },
    }
    updateGraph({
      ...active.graph,
      playerControls: { ...active.graph.playerControls, [id]: control },
    })
    setSelectedNode(null)
    setSelectedButton(null)
    setSelectedPlayerControl(id)
    setSelectedGraphLayout(null)
  }
  const addNodeAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) {
      addNode()
      return
    }
    addNode((rect.width / 2 - view.x) / view.zoom - 78, (rect.height / 2 - view.y) / view.zoom - 24)
  }
  const addButtonAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) {
      addButton()
      return
    }
    addButton(
      (rect.width / 2 - view.x) / view.zoom - 75,
      (rect.height / 2 - view.y) / view.zoom - 21,
    )
  }
  const addLayoutAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) {
      addLayout()
      return
    }
    addLayout(
      (rect.width / 2 - view.x) / view.zoom - 82,
      (rect.height / 2 - view.y) / view.zoom - 25,
    )
  }
  const addScriptNodeAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) {
      addScriptNode()
      return
    }
    addScriptNode(
      (rect.width / 2 - view.x) / view.zoom - 78,
      (rect.height / 2 - view.y) / view.zoom - 24,
    )
  }
  const addPlayerControlAtGraphCenter = () => {
    const rect = document.querySelector('.graph-surface')?.getBoundingClientRect()
    if (!rect) {
      addPlayerControl()
      return
    }
    addPlayerControl(
      (rect.width / 2 - view.x) / view.zoom - 82,
      (rect.height / 2 - view.y) / view.zoom - 27,
    )
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
        media[index] = {
          ...current,
          source: {
            ...current.source,
            type: 'audioImage',
            image: path,
            fit: 'cover',
            visual: undefined,
          },
        }
        converted++
      })
      if (!converted) {
        notify('画像未設定の音声はありません')
        return
      }
    } else if (asset.kind === 'audio') {
      const emptyImageIndex = media.findIndex(
        (item) => item.source.type === 'audioImage' && !item.source.audio,
      )
      if (emptyImageIndex >= 0)
        media[emptyImageIndex] = {
          ...media[emptyImageIndex],
          source: { ...media[emptyImageIndex].source, audio: path },
        }
      else media.push(mediaForAsset(asset, path, media.length)!)
    } else if (asset.kind === 'video') media.push(mediaForAsset(asset, path, media.length)!)
    else {
      notify('このファイル形式はノードへ割り当てできません')
      return
    }
    const used = new Set<string>()
    const uniqueMedia = media.map((item) => {
      const base = item.id
      let id = base
      let suffix = 2
      while (used.has(id)) id = `${base}-${suffix++}`
      used.add(id)
      return id === item.id ? item : { ...item, id }
    })
    updateGraph({
      ...active.graph,
      nodes: { ...active.graph.nodes, [nodeId]: { ...node, media: uniqueMedia } },
    })
    setSelectedNode(nodeId)
  }
  const dropAssetOnGraph = (path: string, nodeId: string | null, x: number, y: number) => {
    if (!active) return
    if (nodeId) {
      bindAssetToNode(nodeId, path)
      return
    }
    const asset = docAssets.find((item) => item.path === path)
    const media = asset ? mediaForAsset(asset, path, 0) : undefined
    if (!asset || !media) {
      notify('キャンバスへドロップできるのは音声・画像・動画です')
      return
    }
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [id]: {
          type: 'media',
          media: [media],
          onEnd: [],
          buttons: [],
          editor: {
            x: Math.round(x - 92),
            y: Math.round(y - 42),
            label: asset.name.replace(/\.[^.]+$/, ''),
            color: nextNodeColor(active.graph.nodes),
          },
        },
      },
    })
    setSelectedNode(id)
  }
  const folderAssets = (folderPath: string) => {
    const normalized = folderPath === '.' ? '' : folderPath.replace(/\/$/, '')
    return docAssets.filter(
      (asset) =>
        ['audio', 'video'].includes(asset.kind) &&
        (!normalized || asset.path === normalized || asset.path.startsWith(`${normalized}/`)),
    )
  }
  const appendFolderToNode = (nodeId: string, folderPath: string) => {
    if (!active) return
    const node = active.graph.nodes[nodeId]
    const folderMedia = folderAssets(folderPath)
    if (!node || node.type === 'script' || !folderMedia.length) {
      notify('このフォルダに音声・動画がありません')
      return
    }
    const used = new Set((node.media ?? []).map((item) => item.id))
    const additions = folderMedia
      .map((asset, index) => mediaForAsset(asset, asset.path, (node.media?.length ?? 0) + index)!)
      .map((item) => {
        const base = item.id
        let id = base
        let suffix = 2
        while (used.has(id)) id = `${base}-${suffix++}`
        used.add(id)
        return id === item.id ? item : { ...item, id }
      })
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [nodeId]: { ...node, media: [...(node.media ?? []), ...additions] },
      },
    })
    setSelectedNode(nodeId)
    notify(`${additions.length}件の音声・動画を追加しました`)
  }
  const dropFolderOnGraph = (folderPath: string, nodeId: string | null, x: number, y: number) => {
    if (!active) return
    if (nodeId) {
      appendFolderToNode(nodeId, folderPath)
      return
    }
    const folderMedia = folderAssets(folderPath)
    if (!folderMedia.length) {
      notify('このフォルダに音声・動画がありません')
      return
    }
    let number = Object.keys(active.graph.nodes).length + 1
    while (active.graph.nodes[`node-${number}`]) number++
    const id = `node-${number}`
    const label =
      folderPath === '.'
        ? rootName
        : (folderPath.split('/').filter(Boolean).at(-1) ?? `Node ${number}`)
    const media = folderMedia.map((asset, index) => mediaForAsset(asset, asset.path, index)!)
    updateGraph({
      ...active.graph,
      nodes: {
        ...active.graph.nodes,
        [id]: {
          type: 'media',
          media,
          onEnd: [],
          buttons: [],
          editor: {
            x: Math.round(x - 92),
            y: Math.round(y - 42),
            label,
            color: nextNodeColor(active.graph.nodes),
          },
        },
      },
    })
    setSelectedNode(id)
    notify(`${media.length}件の音声・動画を追加しました`)
  }

  return {
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
  }
}
