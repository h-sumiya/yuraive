import { LAYOUT_EXTENSION, layoutSlotNames, validateLayoutSource } from './layout'
import type {
  AssetEntry,
  GraphLayoutPlacement,
  LayoutDocument,
  MediaCandidate,
  PlayerControlSettings,
  ScriptDocument,
  ValidationIssue,
  YuraiveButton,
  YuraiveGraph,
  YuraiveMetadata,
  YuraiveNode,
} from './types'

const hslToHex = (hue: number, saturation = 55, lightness = 52) => {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - chroma / 2
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return `#${[r, g, b]
    .map((value) =>
      Math.round((value + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

const hexHue = (color?: string) => {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  const [r, g, b] = [1, 3, 5].map(
    (index) => Number.parseInt(color.slice(index, index + 2), 16) / 255,
  )
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (!delta) return 0
  const hue =
    max === r
      ? 60 * (((g - b) / delta) % 6)
      : max === g
        ? 60 * ((b - r) / delta + 2)
        : 60 * ((r - g) / delta + 4)
  return (hue + 360) % 360
}

const nextEditorColor = (items: Record<string, { editor?: { color?: string } }>) => {
  const hues = Object.values(items)
    .map((item) => hexHue(item.editor?.color))
    .filter((hue): hue is number => hue !== undefined)
    .sort((a, b) => a - b)
  let hue = Math.random() * 360
  if (hues.length) {
    let largestGap = -1
    for (let index = 0; index < hues.length; index++) {
      const start = hues[index]
      const end = index === hues.length - 1 ? hues[0] + 360 : hues[index + 1]
      if (end - start > largestGap) {
        largestGap = end - start
        hue = (start + largestGap / 2) % 360
      }
    }
    hue = (hue + (Math.random() - 0.5) * Math.min(12, largestGap * 0.12) + 360) % 360
  }
  return hslToHex(hue, 50 + Math.random() * 12, 47 + Math.random() * 8)
}

export const nextNodeColor = (nodes: Record<string, YuraiveNode>) => nextEditorColor(nodes)
export const nextButtonColor = (buttons: Record<string, YuraiveButton>) => nextEditorColor(buttons)
export const nextPlayerControlColor = (controls: Record<string, PlayerControlSettings>) =>
  nextEditorColor(controls)
export const nextLayoutColor = (layouts: Record<string, GraphLayoutPlacement>) =>
  nextEditorColor(
    Object.fromEntries(
      Object.entries(layouts).map(([path, placement]) => [path, { editor: placement }]),
    ),
  )

export type PlayerControlBooleanKey = Exclude<
  keyof PlayerControlSettings,
  'accentColor' | 'layout' | 'editor'
>

export const DEFAULT_PLAYER_CONTROLS: Pick<PlayerControlSettings, PlayerControlBooleanKey> = {
  allowStop: true,
  showSeekBar: true,
  showPlaybackTime: true,
  allowSeek: true,
  showSceneName: true,
  showFileName: false,
  allowNext: false,
  allowPrevious: false,
}

export const createGraph = (): YuraiveGraph => ({
  version: 1,
  metadata: { contentId: crypto.randomUUID() },
  globalPlayerControl: 'default',
  nodes: {
    start: {
      type: 'media',
      start: true,
      media: [],
      onEnd: [],
      buttons: [],
      editor: { x: 120, y: 220, label: 'Start', color: hslToHex(Math.random() * 360, 56, 52) },
    },
  },
  buttons: {},
  playerControls: {
    default: {
      ...DEFAULT_PLAYER_CONTROLS,
      layout: `default${LAYOUT_EXTENSION}`,
      editor: { x: 120, y: 110, color: '#4f8c78' },
    },
  },
  editor: { layouts: { [`default${LAYOUT_EXTENSION}`]: { x: 120, y: 20, color: '#4d8e9f' } } },
})

const normalizeMetadata = (value: unknown): YuraiveMetadata | undefined => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('metadataはオブジェクトで指定してください')
  const raw = value as Record<string, unknown>
  const metadata: YuraiveMetadata = {}
  for (const key of [
    'contentId',
    'displayName',
    'description',
    'author',
    'thumbnail',
    'createdAt',
    'updatedAt',
  ] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string') throw new Error(`metadata.${key}は文字列で指定してください`)
    if (raw[key].trim()) metadata[key] = raw[key]
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== 'string'))
      throw new Error('metadata.tagsは文字列の配列で指定してください')
    const tags = raw.tags.map((tag) => tag.trim()).filter(Boolean)
    if (tags.length) metadata.tags = tags
  }
  if (raw.socialLinks !== undefined) {
    if (!Array.isArray(raw.socialLinks))
      throw new Error('metadata.socialLinksは配列で指定してください')
    const links = raw.socialLinks
      .map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error(`metadata.socialLinks[${index}]はオブジェクトで指定してください`)
        const link = value as Record<string, unknown>
        if (typeof link.label !== 'string' || typeof link.url !== 'string')
          throw new Error(`metadata.socialLinks[${index}]にはlabelとurlが必要です`)
        return { label: link.label.trim(), url: link.url.trim() }
      })
      .filter((link) => link.label && link.url)
    if (links.length) metadata.socialLinks = links
  }
  return Object.keys(metadata).length ? metadata : undefined
}

export const normalizeGraph = (value: unknown): YuraiveGraph => {
  if (!value || typeof value !== 'object')
    throw new Error('JSONのルートがオブジェクトではありません')
  const raw = value as {
    version?: unknown
    metadata?: unknown
    nodes?: unknown
    buttons?: unknown
    playerControls?: unknown
    globalPlayerControl?: unknown
    playbackStats?: unknown
    editor?: unknown
  }
  if (raw.version !== 1) throw new Error('対応しているYuraiveバージョンは1です')
  if (!raw.nodes || typeof raw.nodes !== 'object' || Array.isArray(raw.nodes)) {
    throw new Error('nodesが見つかりません')
  }
  if (!raw.buttons || typeof raw.buttons !== 'object' || Array.isArray(raw.buttons)) {
    throw new Error('buttonsが見つかりません。独立ボタン形式のYuraiveを使用してください')
  }
  const nodes = raw.nodes as Record<string, YuraiveNode>
  const buttons = raw.buttons as Record<string, YuraiveButton>
  if (
    raw.playerControls !== undefined &&
    (!raw.playerControls ||
      typeof raw.playerControls !== 'object' ||
      Array.isArray(raw.playerControls))
  ) {
    throw new Error('playerControlsはオブジェクトで指定してください')
  }
  if (raw.globalPlayerControl !== undefined && typeof raw.globalPlayerControl !== 'string')
    throw new Error('globalPlayerControlは文字列で指定してください')
  let playbackStats: YuraiveGraph['playbackStats']
  if (raw.playbackStats !== undefined) {
    if (
      !raw.playbackStats ||
      typeof raw.playbackStats !== 'object' ||
      Array.isArray(raw.playbackStats)
    )
      throw new Error('playbackStatsはオブジェクトで指定してください')
    const stats = raw.playbackStats as Record<string, unknown>
    if (typeof stats.path !== 'string' || !stats.path.trim())
      throw new Error('playbackStats.pathは必須です')
    if (stats.function !== undefined && typeof stats.function !== 'string')
      throw new Error('playbackStats.functionは文字列で指定してください')
    playbackStats = {
      path: stats.path,
      ...(typeof stats.function === 'string' && stats.function.trim()
        ? { function: stats.function }
        : {}),
    }
  }
  const rawPlayerControls = (raw.playerControls ?? {}) as Record<string, unknown>
  const playerControls: Record<string, PlayerControlSettings> = {}
  const baseHue = Math.random() * 360
  Object.values(nodes).forEach((node, index) => {
    node.type ??= node.script ? 'script' : 'media'
    if (node.type === 'media') node.media ??= []
    else node.media = undefined
    node.onEnd ??= []
    if (node.type === 'media') node.buttons ??= []
    else node.buttons = undefined
    node.editor ??= { x: 100 + (index % 4) * 240, y: 100 + Math.floor(index / 4) * 170 }
    node.editor.color ??= hslToHex((baseHue + index * 137.508) % 360, 54, 51)
  })
  Object.values(buttons).forEach((button, index) => {
    delete (button as YuraiveButton & { layout?: unknown }).layout
    delete (button as YuraiveButton & { appearance?: unknown }).appearance
    button.onPress ??= []
    button.editor ??= { x: 180 + (index % 4) * 190, y: 360 + Math.floor(index / 4) * 90 }
    button.editor.color ??= hslToHex((baseHue + 70 + index * 137.508) % 360, 42, 56)
  })
  Object.entries(rawPlayerControls).forEach(([id, value], index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`playerControls.${id}はオブジェクトで指定してください`)
    const rawControl = value as Record<string, unknown>
    const control = { ...DEFAULT_PLAYER_CONTROLS } as PlayerControlSettings
    for (const [key, fallback] of Object.entries(DEFAULT_PLAYER_CONTROLS) as Array<
      [PlayerControlBooleanKey, boolean]
    >) {
      const candidate = rawControl[key]
      if (candidate !== undefined && typeof candidate !== 'boolean')
        throw new Error(`playerControls.${id}.${key}は真偽値で指定してください`)
      control[key] = candidate === undefined ? fallback : (candidate as boolean)
    }
    if (rawControl.accentColor !== undefined && typeof rawControl.accentColor !== 'string')
      throw new Error(`playerControls.${id}.accentColorは文字列で指定してください`)
    if (typeof rawControl.accentColor === 'string' && rawControl.accentColor.trim())
      control.accentColor = rawControl.accentColor.trim()
    if (rawControl.layout !== undefined && typeof rawControl.layout !== 'string')
      throw new Error(`playerControls.${id}.layoutは文字列で指定してください`)
    if (typeof rawControl.layout === 'string' && rawControl.layout.trim())
      control.layout = rawControl.layout.trim()
    if (
      rawControl.editor !== undefined &&
      (!rawControl.editor ||
        typeof rawControl.editor !== 'object' ||
        Array.isArray(rawControl.editor))
    ) {
      throw new Error(`playerControls.${id}.editorはオブジェクトで指定してください`)
    }
    const rawEditor = (rawControl.editor ?? {}) as Record<string, unknown>
    const editor: NonNullable<PlayerControlSettings['editor']> = {
      x:
        typeof rawEditor.x === 'number' && Number.isFinite(rawEditor.x)
          ? rawEditor.x
          : 100 + (index % 4) * 210,
      y:
        typeof rawEditor.y === 'number' && Number.isFinite(rawEditor.y)
          ? rawEditor.y
          : 20 + Math.floor(index / 4) * 80,
      color:
        typeof rawEditor.color === 'string'
          ? rawEditor.color
          : hslToHex((baseHue + 155 + index * 137.508) % 360, 40, 48),
    }
    control.editor = editor
    playerControls[id] = control
  })
  if (
    raw.editor !== undefined &&
    (!raw.editor || typeof raw.editor !== 'object' || Array.isArray(raw.editor))
  )
    throw new Error('editorはオブジェクトで指定してください')
  const rawGraphEditor = (raw.editor ?? {}) as Record<string, unknown>
  if (
    rawGraphEditor.layouts !== undefined &&
    (!rawGraphEditor.layouts ||
      typeof rawGraphEditor.layouts !== 'object' ||
      Array.isArray(rawGraphEditor.layouts))
  )
    throw new Error('editor.layoutsはオブジェクトで指定してください')
  const layoutPlacements: Record<string, GraphLayoutPlacement> = {}
  Object.entries((rawGraphEditor.layouts ?? {}) as Record<string, unknown>).forEach(
    ([path, value], index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`editor.layouts.${path}はオブジェクトで指定してください`)
      const placement = value as Record<string, unknown>
      layoutPlacements[path] = {
        x:
          typeof placement.x === 'number' && Number.isFinite(placement.x)
            ? placement.x
            : 320 + (index % 4) * 190,
        y:
          typeof placement.y === 'number' && Number.isFinite(placement.y)
            ? placement.y
            : 20 + Math.floor(index / 4) * 80,
        color:
          typeof placement.color === 'string'
            ? placement.color
            : hslToHex((baseHue + 235 + index * 137.508) % 360, 38, 50),
      }
    },
  )
  const referencedLayouts = [
    ...new Set(
      Object.values(playerControls)
        .map((control) => control.layout)
        .filter((path): path is string => Boolean(path)),
    ),
  ]
  referencedLayouts.forEach((path, index) => {
    if (!layoutPlacements[path])
      layoutPlacements[path] = {
        x: 320 + (index % 4) * 190,
        y: 20 + Math.floor(index / 4) * 80,
        color: hslToHex((baseHue + 235 + index * 137.508) % 360, 38, 50),
      }
  })
  const metadata = normalizeMetadata(raw.metadata)
  return {
    version: 1,
    ...(metadata ? { metadata } : {}),
    nodes,
    buttons,
    playerControls,
    ...(raw.globalPlayerControl ? { globalPlayerControl: raw.globalPlayerControl } : {}),
    ...(playbackStats ? { playbackStats } : {}),
    ...(Object.keys(layoutPlacements).length ? { editor: { layouts: layoutPlacements } } : {}),
  }
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
  return selectable.find((item) => (cursor -= item.weight) < 0) ?? selectable.at(-1)
}

const allNodePaths = (node: YuraiveNode) =>
  [
    ...(node.media ?? []).flatMap((candidate) => [
      candidate.source.audio,
      candidate.source.image,
      candidate.source.video,
      candidate.source.subtitle,
    ]),
  ].filter(Boolean) as string[]

export const validateGraph = (
  graph: YuraiveGraph,
  assets: AssetEntry[],
  scripts: ScriptDocument[] = [],
  layouts: LayoutDocument[] = [],
): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  for (const key of ['createdAt', 'updatedAt'] as const) {
    const value = graph.metadata?.[key]
    if (value && (!rfc3339.test(value) || Number.isNaN(Date.parse(value))))
      issues.push({
        severity: 'warning',
        message: `metadata.${key}はRFC 3339形式で指定してください`,
      })
  }
  if (graph.metadata?.tags && new Set(graph.metadata.tags).size !== graph.metadata.tags.length)
    issues.push({ severity: 'warning', message: 'metadata.tagsに重複があります' })
  graph.metadata?.socialLinks?.forEach((link, index) => {
    if (!link.label.trim())
      issues.push({ severity: 'error', message: `metadata.socialLinks[${index}].labelは必須です` })
    if (!/^https?:\/\//i.test(link.url))
      issues.push({
        severity: 'error',
        message: `metadata.socialLinks[${index}].urlはhttp(s) URLで指定してください`,
      })
  })
  if (graph.metadata?.contentId !== undefined && !graph.metadata.contentId.trim())
    issues.push({ severity: 'error', message: 'metadata.contentIdは空文字列にできません' })
  const entries = Object.entries(graph.nodes)
  const starts = entries.filter(([, node]) => node.start)
  if (starts.length !== 1)
    issues.push({ severity: 'error', message: `開始ノードは1件必要です（現在${starts.length}件）` })
  const nodeIds = new Set(entries.map(([id]) => id))
  const buttonEntries = Object.entries(graph.buttons)
  const buttonIds = new Set(buttonEntries.map(([id]) => id))
  const playerControlEntries = Object.entries(graph.playerControls ?? {})
  const playerControlIds = new Set(playerControlEntries.map(([id]) => id))
  const assetPaths = new Set(assets.map((asset) => asset.path))
  const scriptPaths = new Set(scripts.map((script) => script.path))
  const layoutByPath = new Map(layouts.map((layout) => [layout.path, layout]))
  const thumbnail = graph.metadata?.thumbnail
  if (thumbnail && (/^(?:[a-z]+:|\/)/i.test(thumbnail) || thumbnail.split('/').includes('..'))) {
    issues.push({ severity: 'error', message: `コンテンツ外を参照するパスです: ${thumbnail}` })
  } else if (thumbnail && assets.length && !assetPaths.has(thumbnail)) {
    issues.push({ severity: 'warning', message: `ファイルが見つかりません: ${thumbnail}` })
  }
  if (graph.globalPlayerControl && !playerControlIds.has(graph.globalPlayerControl))
    issues.push({
      severity: 'error',
      message: `グローバル再生設定「${graph.globalPlayerControl}」がありません`,
    })
  if (graph.playbackStats) {
    if (!graph.playbackStats.path.toLowerCase().endsWith('.star'))
      issues.push({
        severity: 'error',
        scriptPath: graph.playbackStats.path,
        message: 'playbackStats.pathは.starファイルを指定してください',
      })
    else if (!scriptPaths.has(graph.playbackStats.path))
      issues.push({
        severity: 'error',
        scriptPath: graph.playbackStats.path,
        message: `再生統計スクリプトが見つかりません: ${graph.playbackStats.path}`,
      })
  }

  for (const [nodeId, node] of entries) {
    if (!nodeId.trim())
      issues.push({ severity: 'error', nodeId, message: '空のノードIDは使用できません' })
    ;(node.onEnd ?? []).forEach((transition) => {
      if (!nodeIds.has(transition.to))
        issues.push({
          severity: 'error',
          nodeId,
          message: `遷移先「${transition.to}」がありません`,
        })
      if (transition.weight < 0)
        issues.push({ severity: 'error', nodeId, message: '遷移の重みは0以上にしてください' })
    })
    if (node.onEnd?.length && !node.onEnd.some((transition) => transition.weight > 0))
      issues.push({ severity: 'error', nodeId, message: '遷移候補の重みがすべて0です' })
    if (node.type === 'script') {
      if (node.terminal)
        issues.push({ severity: 'error', nodeId, message: 'スクリプトノードを終端にはできません' })
      if (!node.script?.path)
        issues.push({
          severity: 'error',
          nodeId,
          message: '実行するStarlarkファイルが設定されていません',
        })
      else if (!scriptPaths.has(node.script.path))
        issues.push({
          severity: 'error',
          nodeId,
          scriptPath: node.script.path,
          message: `スクリプトが見つかりません: ${node.script.path}`,
        })
      if (!node.onEnd?.length)
        issues.push({
          severity: 'error',
          nodeId,
          message: 'スクリプトノードには遷移候補が必要です',
        })
    }
    node.buttons?.forEach((buttonId) => {
      if (!buttonIds.has(buttonId))
        issues.push({ severity: 'error', nodeId, message: `ボタン「${buttonId}」がありません` })
    })
    if (new Set(node.buttons ?? []).size !== (node.buttons?.length ?? 0))
      issues.push({ severity: 'error', nodeId, message: '同じボタンが重複して接続されています' })
    if (node.playerControl && !playerControlIds.has(node.playerControl))
      issues.push({
        severity: 'error',
        nodeId,
        message: `再生設定「${node.playerControl}」がありません`,
      })
    if (node.type === 'script' && node.playerControl)
      issues.push({ severity: 'error', nodeId, message: 'Script Nodeには再生設定を接続できません' })
    if (node.terminal && ((node.onEnd?.length ?? 0) || (node.buttons?.length ?? 0))) {
      issues.push({
        severity: 'error',
        nodeId,
        message: '終端ノードには遷移やボタンを設定できません',
      })
    }
    if (node.terminal && node.media?.some((media) => media.source.loop)) {
      issues.push({ severity: 'error', nodeId, message: '終端ノードのメディアはループできません' })
    }
    if (node.type === 'media' && !node.terminal && !node.onEnd?.length && !node.buttons?.length) {
      issues.push({ severity: 'warning', nodeId, message: '終端ではないノードに遷移がありません' })
    }
    if (node.type === 'media' && node.buttons?.length) {
      const controlId = node.playerControl ?? graph.globalPlayerControl
      const layoutPath = controlId ? graph.playerControls[controlId]?.layout : undefined
      if (!layoutPath) {
        issues.push({
          severity: 'error',
          nodeId,
          playerControlId: controlId,
          message: 'ボタンを表示する再生設定にレイアウトが接続されていません',
        })
      } else {
        const layout = layoutByPath.get(layoutPath)
        if (layout) {
          const slots = new Set(layoutSlotNames(layout.content))
          node.buttons.forEach((buttonId) => {
            const slot = graph.buttons[buttonId]?.targetSlot?.trim() ?? ''
            if (!slots.has(slot))
              issues.push({
                severity: 'error',
                nodeId,
                buttonId,
                layoutPath,
                message: `レイアウト「${layoutPath}」にslot「${slot || '(default)'}」がありません`,
              })
          })
        }
      }
    }
    const mediaIds = new Set<string>()
    node.media?.forEach((media) => {
      if (mediaIds.has(media.id))
        issues.push({
          severity: 'error',
          nodeId,
          message: `メディアID「${media.id}」が重複しています`,
        })
      mediaIds.add(media.id)
      if (media.weight < 0)
        issues.push({ severity: 'error', nodeId, message: 'メディアの重みは0以上にしてください' })
      if ((media.source.volume ?? 1) < 0 || (media.source.volume ?? 1) > 1)
        issues.push({ severity: 'error', nodeId, message: '音量は0〜1で指定してください' })
    })
    allNodePaths(node).forEach((path) => {
      if (/^(?:[a-z]+:|\/)/i.test(path) || path.split('/').includes('..')) {
        issues.push({
          severity: 'error',
          nodeId,
          message: `コンテンツ外を参照するパスです: ${path}`,
        })
      } else if (assets.length && !assetPaths.has(path)) {
        issues.push({ severity: 'warning', nodeId, message: `ファイルが見つかりません: ${path}` })
      }
    })
  }

  for (const [buttonId, button] of buttonEntries) {
    if (!buttonId.trim())
      issues.push({ severity: 'error', buttonId, message: '空のボタンIDは使用できません' })
    ;(button.onPress ?? []).forEach((transition) => {
      if (!nodeIds.has(transition.to))
        issues.push({
          severity: 'error',
          buttonId,
          message: `遷移先「${transition.to}」がありません`,
        })
      if (transition.weight < 0)
        issues.push({ severity: 'error', buttonId, message: '遷移の重みは0以上にしてください' })
    })
    if (button.onPress?.length && !button.onPress.some((transition) => transition.weight > 0))
      issues.push({ severity: 'error', buttonId, message: '遷移候補の重みがすべて0です' })
    if (!entries.some(([, node]) => node.buttons?.includes(buttonId)))
      issues.push({
        severity: 'warning',
        buttonId,
        message: 'どのノードにも接続されていないボタンです',
      })
    if (button.render?.path && !scriptPaths.has(button.render.path))
      issues.push({
        severity: 'error',
        buttonId,
        scriptPath: button.render.path,
        message: `表示スクリプトが見つかりません: ${button.render.path}`,
      })
    if (button.order !== undefined && !Number.isInteger(button.order))
      issues.push({ severity: 'error', buttonId, message: 'orderは整数で指定してください' })
    if (button.zIndex !== undefined && !Number.isInteger(button.zIndex))
      issues.push({ severity: 'error', buttonId, message: 'zIndexは整数で指定してください' })
    if (
      button.style?.opacity !== undefined &&
      (!Number.isFinite(button.style.opacity) ||
        button.style.opacity < 0 ||
        button.style.opacity > 1)
    )
      issues.push({
        severity: 'error',
        buttonId,
        message: 'opacityは0〜1の有限値で指定してください',
      })
    for (const key of [
      'borderWidth',
      'borderRadius',
      'paddingHorizontal',
      'paddingVertical',
    ] as const) {
      const value = button.style?.[key]
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        issues.push({
          severity: 'error',
          buttonId,
          message: `${key}は0以上の有限値で指定してください`,
        })
    }
    if (
      button.style?.fontSize !== undefined &&
      (!Number.isFinite(button.style.fontSize) || button.style.fontSize <= 0)
    )
      issues.push({
        severity: 'error',
        buttonId,
        message: 'fontSizeは0より大きい有限値で指定してください',
      })
    if (
      button.style?.fontWeight !== undefined &&
      (!Number.isInteger(button.style.fontWeight) ||
        button.style.fontWeight < 1 ||
        button.style.fontWeight > 1000)
    )
      issues.push({
        severity: 'error',
        buttonId,
        message: 'fontWeightは1〜1000の整数で指定してください',
      })
    const path = button.style?.backgroundImage
    if (path && (/^(?:[a-z]+:|\/)/i.test(path) || path.split('/').includes('..')))
      issues.push({
        severity: 'error',
        buttonId,
        message: `コンテンツ外を参照するパスです: ${path}`,
      })
    else if (path && assets.length && !assetPaths.has(path))
      issues.push({ severity: 'warning', buttonId, message: `ファイルが見つかりません: ${path}` })
  }

  for (const [playerControlId, control] of playerControlEntries) {
    if (!playerControlId.trim())
      issues.push({ severity: 'error', playerControlId, message: '空の再生設定IDは使用できません' })
    const usedGlobally = graph.globalPlayerControl === playerControlId
    const usedByNode = entries.some(([, node]) => node.playerControl === playerControlId)
    if (!usedGlobally && !usedByNode)
      issues.push({
        severity: 'warning',
        playerControlId,
        message: 'どこにも接続されていない再生設定です',
      })
    if (control.accentColor && !isSafeAccentColor(control.accentColor))
      issues.push({
        severity: 'error',
        playerControlId,
        message: 'accentColorは白・黒に近すぎない#RRGGBB形式で指定してください',
      })
    if (control.layout) {
      if (!control.layout.toLowerCase().endsWith(LAYOUT_EXTENSION))
        issues.push({
          severity: 'error',
          playerControlId,
          layoutPath: control.layout,
          message: `layoutは${LAYOUT_EXTENSION}ファイルを指定してください`,
        })
      const layout = layoutByPath.get(control.layout)
      if (!layout)
        issues.push({
          severity: 'error',
          playerControlId,
          layoutPath: control.layout,
          message: `レイアウトファイルが見つかりません: ${control.layout}`,
        })
      else
        validateLayoutSource(layout.content).forEach((issue) =>
          issues.push({
            severity: issue.severity,
            playerControlId,
            layoutPath: control.layout,
            message: `${control.layout}: ${issue.message}`,
          }),
        )
    }
  }

  return issues
}

export const isSafeAccentColor = (color: string) => {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance >= 0.08 && luminance <= 0.9
}

export const defaultMedia = (index: number): MediaCandidate => ({
  id: `media-${index + 1}`,
  weight: 1,
  source: { type: 'audio', audio: '', visual: 'keep', volume: 1, loop: false },
})
