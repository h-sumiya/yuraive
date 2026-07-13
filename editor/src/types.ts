export type Fit = 'contain' | 'cover' | 'stretch'

export type MediaSource = {
  type: 'audio' | 'audioImage' | 'video'
  audio?: string
  image?: string
  video?: string
  subtitle?: string
  visual?: 'keep' | 'clear'
  volume?: number
  loop?: boolean
  fit?: Fit
  imageTransition?: {
    type: 'crossfade'
    durationMs: number
  }
}

export type MediaCandidate = {
  id: string
  weight: number
  source: MediaSource
}

export type Transition = {
  to: string
  weight: number
}

export type ScriptCall = {
  path: string
  function?: string
}

export type ButtonRenderStyle = {
  backgroundColor?: string
  backgroundImage?: string
  textColor?: string
  opacity?: number
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
}

export type ButtonRenderResult = {
  visible?: boolean
  text?: string
  style?: ButtonRenderStyle
  layout?: Partial<{ x: number; y: number; width: number; height: number; z: number }>
}

export type WmgButton = {
  visibility?: Array<{ fromMs: number; toMs: number | null }>
  layout?: { x: number; y: number; width: number; height: number; z?: number }
  appearance?: {
    backgroundColor?: string
    backgroundImage?: string
    text?: string
    textColor?: string
  }
  render?: ScriptCall
  onPress?: Transition[]
  editor?: {
    x?: number
    y?: number
    color?: string
  }
}

export type WmgNode = {
  type: 'media' | 'script'
  start?: boolean
  terminal?: boolean
  script?: ScriptCall
  media?: MediaCandidate[]
  onEnd?: Transition[]
  buttons?: string[]
  editor?: {
    x?: number
    y?: number
    label?: string
    color?: string
    collapsed?: boolean
  }
}

export type WmgMetadata = {
  displayName?: string
  description?: string
  author?: string
  createdAt?: string
  updatedAt?: string
  tags?: string[]
}

export type WmgGraph = {
  version: 1
  metadata?: WmgMetadata
  nodes: Record<string, WmgNode>
  buttons: Record<string, WmgButton>
}

export type AssetEntry = {
  name: string
  path: string
  kind: 'audio' | 'video' | 'image' | 'subtitle' | 'other'
  file: File
}

export type ScriptDocument = {
  uid: string
  name: string
  path: string
  content: string
  dirty: boolean
  handle?: FileSystemFileHandle
}

export type WorkspaceFolder = {
  path: string
  handle?: FileSystemDirectoryHandle
}

export type EditorTab = {
  kind: 'graph' | 'script'
  uid: string
}

export type PlaybackHistoryEntry = {
  schemaVersion: 1
  id: string
  runId: string
  graphId: string
  nodeId: string
  mediaId: string
  source: string | null
  startedAt: string
  endedAt: string
  mediaDurationMs: number
  activePlayMs: number
  startPositionMs: number
  endPositionMs: number
  endReason: 'completed' | 'button' | 'stopped' | 'restarted' | 'error' | 'interrupted'
}

export type StarlarkCurrent = {
  nodeId: string
  mediaId: string | null
  source: string | null
  startedAt: string | null
  positionMs: number
  mediaDurationMs: number
  activePlayMs: number
}

export type StarlarkContext = {
  now: string
  graphId: string
  runId: string
  runStartedAt: string
  historyStartedAt: string | null
  historyEndedAt: string | null
  historyCount: number
  historyActivePlayMs: number
  totalActivePlayMs: number
  history: PlaybackHistoryEntry[]
  current: StarlarkCurrent | null
  trigger: Record<string, unknown>
}

export type PreviewTraceEntry = {
  id: string
  at: string
  kind: 'node' | 'media' | 'script' | 'button' | 'history' | 'error' | 'info'
  title: string
  detail?: string
  data?: unknown
}

export type GraphDocument = {
  uid: string
  name: string
  path: string
  graph: WmgGraph
  dirty: boolean
  handle?: FileSystemFileHandle
}

export type ValidationIssue = {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
  buttonId?: string
  scriptPath?: string
}

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
  }

  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}
