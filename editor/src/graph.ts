import type { AssetEntry, MediaCandidate, ValidationIssue, WmgButton, WmgGraph, WmgNode } from './types'

const hslToHex = (hue: number, saturation = 55, lightness = 52) => {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - chroma / 2
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

const hexHue = (color?: string) => {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (!delta) return 0
  const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  return (hue + 360) % 360
}

const nextEditorColor = (items: Record<string, { editor?: { color?: string } }>) => {
  const hues = Object.values(items).map((item) => hexHue(item.editor?.color)).filter((hue): hue is number => hue !== undefined).sort((a, b) => a - b)
  let hue = Math.random() * 360
  if (hues.length) {
    let largestGap = -1
    for (let index = 0; index < hues.length; index++) {
      const start = hues[index]
      const end = index === hues.length - 1 ? hues[0] + 360 : hues[index + 1]
      if (end - start > largestGap) { largestGap = end - start; hue = (start + largestGap / 2) % 360 }
    }
    hue = (hue + (Math.random() - .5) * Math.min(12, largestGap * .12) + 360) % 360
  }
  return hslToHex(hue, 50 + Math.random() * 12, 47 + Math.random() * 8)
}

export const nextNodeColor = (nodes: Record<string, WmgNode>) => nextEditorColor(nodes)
export const nextButtonColor = (buttons: Record<string, WmgButton>) => nextEditorColor(buttons)

export const createGraph = (): WmgGraph => ({
  version: 1,
  nodes: {
    start: {
      start: true,
      media: [],
      onEnd: [],
      buttons: [],
      editor: { x: 120, y: 160, label: 'Start', color: hslToHex(Math.random() * 360, 56, 52) },
    },
  },
  buttons: {},
})

export const normalizeGraph = (value: unknown): WmgGraph => {
  if (!value || typeof value !== 'object') throw new Error('JSONのルートがオブジェクトではありません')
  const raw = value as { version?: unknown; nodes?: unknown; buttons?: unknown }
  if (raw.version !== 1) throw new Error('対応しているWMGFバージョンは1です')
  if (!raw.nodes || typeof raw.nodes !== 'object' || Array.isArray(raw.nodes)) {
    throw new Error('nodesが見つかりません')
  }
  if (!raw.buttons || typeof raw.buttons !== 'object' || Array.isArray(raw.buttons)) {
    throw new Error('buttonsが見つかりません。独立ボタン形式のWMGFを使用してください')
  }
  const nodes = raw.nodes as Record<string, WmgNode>
  const buttons = raw.buttons as Record<string, WmgButton>
  const baseHue = Math.random() * 360
  Object.values(nodes).forEach((node, index) => {
    node.media ??= []
    node.onEnd ??= []
    node.buttons ??= []
    node.editor ??= { x: 100 + (index % 4) * 240, y: 100 + Math.floor(index / 4) * 170 }
    node.editor.color ??= hslToHex((baseHue + index * 137.508) % 360, 54, 51)
  })
  Object.values(buttons).forEach((button, index) => {
    button.onPress ??= []
    button.editor ??= { x: 180 + (index % 4) * 190, y: 360 + Math.floor(index / 4) * 90 }
    button.editor.color ??= hslToHex((baseHue + 70 + index * 137.508) % 360, 42, 56)
  })
  return { version: 1, nodes, buttons }
}

export const fileKind = (path: string): AssetEntry['kind'] => {
  const extension = path.split('.').pop()?.toLowerCase()
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension ?? '')) return 'audio'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(extension ?? '')) return 'video'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(extension ?? '')) return 'image'
  if (extension === 'vtt') return 'subtitle'
  return 'other'
}

export const probability = (weight: number, candidates: Array<{ weight: number }>) => {
  const total = candidates.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0)
  return total > 0 ? (Math.max(0, Number(weight) || 0) / total) * 100 : 0
}

export const chooseWeighted = <T extends { weight: number }>(items: T[]): T | undefined => {
  const selectable = items.filter((item) => item.weight > 0)
  const total = selectable.reduce((sum, item) => sum + item.weight, 0)
  if (!total) return undefined
  let cursor = Math.random() * total
  return selectable.find((item) => ((cursor -= item.weight) < 0)) ?? selectable.at(-1)
}

const allNodePaths = (node: WmgNode) => [
  ...(node.media ?? []).flatMap((candidate) => [
    candidate.source.audio,
    candidate.source.image,
    candidate.source.video,
    candidate.source.subtitle,
  ]),
].filter(Boolean) as string[]

export const validateGraph = (graph: WmgGraph, assets: AssetEntry[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  const entries = Object.entries(graph.nodes)
  const starts = entries.filter(([, node]) => node.start)
  if (starts.length !== 1) issues.push({ severity: 'error', message: `開始ノードは1件必要です（現在${starts.length}件）` })
  const nodeIds = new Set(entries.map(([id]) => id))
  const buttonEntries = Object.entries(graph.buttons)
  const buttonIds = new Set(buttonEntries.map(([id]) => id))
  const assetPaths = new Set(assets.map((asset) => asset.path))

  for (const [nodeId, node] of entries) {
    if (!nodeId.trim()) issues.push({ severity: 'error', nodeId, message: '空のノードIDは使用できません' })
    ;(node.onEnd ?? []).forEach((transition) => {
      if (!nodeIds.has(transition.to)) issues.push({ severity: 'error', nodeId, message: `遷移先「${transition.to}」がありません` })
      if (transition.weight < 0) issues.push({ severity: 'error', nodeId, message: '遷移の重みは0以上にしてください' })
    })
    if (node.onEnd?.length && !node.onEnd.some((transition) => transition.weight > 0)) issues.push({ severity: 'error', nodeId, message: '遷移候補の重みがすべて0です' })
    node.buttons?.forEach((buttonId) => { if (!buttonIds.has(buttonId)) issues.push({ severity: 'error', nodeId, message: `ボタン「${buttonId}」がありません` }) })
    if (new Set(node.buttons ?? []).size !== (node.buttons?.length ?? 0)) issues.push({ severity: 'error', nodeId, message: '同じボタンが重複して接続されています' })
    if (node.terminal && ((node.onEnd?.length ?? 0) || (node.buttons?.length ?? 0))) {
      issues.push({ severity: 'error', nodeId, message: '終端ノードには遷移やボタンを設定できません' })
    }
    if (node.terminal && node.media?.some((media) => media.source.loop)) {
      issues.push({ severity: 'error', nodeId, message: '終端ノードのメディアはループできません' })
    }
    if (!node.terminal && !(node.onEnd?.length) && !(node.buttons?.length)) {
      issues.push({ severity: 'warning', nodeId, message: '終端ではないノードに遷移がありません' })
    }
    const mediaIds = new Set<string>()
    node.media?.forEach((media) => {
      if (mediaIds.has(media.id)) issues.push({ severity: 'error', nodeId, message: `メディアID「${media.id}」が重複しています` })
      mediaIds.add(media.id)
      if (media.weight < 0) issues.push({ severity: 'error', nodeId, message: 'メディアの重みは0以上にしてください' })
      if ((media.source.volume ?? 1) < 0 || (media.source.volume ?? 1) > 1) issues.push({ severity: 'error', nodeId, message: '音量は0〜1で指定してください' })
    })
    allNodePaths(node).forEach((path) => {
      if (/^(?:[a-z]+:|\/)/i.test(path) || path.split('/').includes('..')) {
        issues.push({ severity: 'error', nodeId, message: `コンテンツ外を参照するパスです: ${path}` })
      } else if (assets.length && !assetPaths.has(path)) {
        issues.push({ severity: 'warning', nodeId, message: `ファイルが見つかりません: ${path}` })
      }
    })
  }

  for (const [buttonId, button] of buttonEntries) {
    if (!buttonId.trim()) issues.push({ severity: 'error', buttonId, message: '空のボタンIDは使用できません' })
    ;(button.onPress ?? []).forEach((transition) => {
      if (!nodeIds.has(transition.to)) issues.push({ severity: 'error', buttonId, message: `遷移先「${transition.to}」がありません` })
      if (transition.weight < 0) issues.push({ severity: 'error', buttonId, message: '遷移の重みは0以上にしてください' })
    })
    if (button.onPress?.length && !button.onPress.some((transition) => transition.weight > 0)) issues.push({ severity: 'error', buttonId, message: '遷移候補の重みがすべて0です' })
    if (!entries.some(([, node]) => node.buttons?.includes(buttonId))) issues.push({ severity: 'warning', buttonId, message: 'どのノードにも接続されていないボタンです' })
    const path = button.appearance?.backgroundImage
    if (path && (/^(?:[a-z]+:|\/)/i.test(path) || path.split('/').includes('..'))) issues.push({ severity: 'error', buttonId, message: `コンテンツ外を参照するパスです: ${path}` })
    else if (path && assets.length && !assetPaths.has(path)) issues.push({ severity: 'warning', buttonId, message: `ファイルが見つかりません: ${path}` })
  }

  return issues
}

export const defaultMedia = (index: number): MediaCandidate => ({
  id: `media-${index + 1}`,
  weight: 1,
  source: { type: 'audio', audio: '', visual: 'keep', volume: 1, loop: false },
})
