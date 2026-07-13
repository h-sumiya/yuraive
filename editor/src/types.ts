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

export type WmgButton = {
  visibility?: Array<{ fromMs: number; toMs: number | null }>
  layout?: { x: number; y: number; width: number; height: number; z?: number }
  appearance?: {
    backgroundColor?: string
    backgroundImage?: string
    text?: string
    textColor?: string
  }
  onPress?: Transition[]
  editor?: {
    x?: number
    y?: number
    color?: string
  }
}

export type WmgNode = {
  start?: boolean
  terminal?: boolean
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

export type WmgGraph = {
  version: 1
  nodes: Record<string, WmgNode>
  buttons: Record<string, WmgButton>
}

export type AssetEntry = {
  name: string
  path: string
  kind: 'audio' | 'video' | 'image' | 'subtitle' | 'other'
  file: File
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
}

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
  }

  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}
