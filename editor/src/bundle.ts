import type { LayoutDocument, ScriptDocument, YuraiveGraph } from './types'

const encoder = new TextEncoder()
const MAGIC = encoder.encode('YURAIVE1')
const HEADER_SIZE = 16
const FORMAT_VERSION = 1
const BUNDLE_VERSION = 1
const MAX_BUNDLE_SIZE = 16 * 1024 * 1024
const MAX_GRAPH_SIZE = 8 * 1024 * 1024
const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024
const MAX_TEXT_TOTAL_SIZE = 8 * 1024 * 1024
const MAX_TEXT_FILES = 256

type BundleTextFile = {
  path: string
  content: string
  kind: 1 | 2
}

const concat = (parts: Uint8Array[]) => {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  parts.forEach((part) => { output.set(part, offset); offset += part.length })
  return output
}

const varint = (input: number) => {
  if (!Number.isSafeInteger(input) || input < 0) throw new Error('protobuf varintの値が不正です')
  const output: number[] = []
  let value = input
  do {
    const byte = value % 128
    value = Math.floor(value / 128)
    output.push(byte | (value > 0 ? 0x80 : 0))
  } while (value > 0)
  return Uint8Array.from(output)
}

const varintField = (field: number, value: number) => concat([varint(field << 3), varint(value)])
const bytesField = (field: number, value: Uint8Array) => concat([varint((field << 3) | 2), varint(value.length), value])

const isSafeTextPath = (path: string) => Boolean(path)
  && !path.startsWith('/')
  && !path.includes(':')
  && !path.includes('\\')
  && path.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')

const stripEditorState = (graph: YuraiveGraph): YuraiveGraph => JSON.parse(JSON.stringify(graph, (key, value) => key === 'editor' ? undefined : value)) as YuraiveGraph

const textFilesForGraph = (graphPath: string, scripts: ScriptDocument[], layouts: LayoutDocument[]): BundleTextFile[] => {
  const parent = graphPath.includes('/') ? graphPath.slice(0, graphPath.lastIndexOf('/') + 1) : ''
  const relative = (path: string) => parent && path.startsWith(parent) ? path.slice(parent.length) : path
  return [
    ...scripts.filter((script) => !parent || script.path.startsWith(parent)).map((script) => ({ path: relative(script.path), content: script.content, kind: 1 as const })),
    ...layouts.filter((layout) => !parent || layout.path.startsWith(parent)).map((layout) => ({ path: relative(layout.path), content: layout.content, kind: 2 as const })),
  ].sort((left, right) => left.path.localeCompare(right.path))
}

export const playerBundleName = (jsonName: string) => jsonName.replace(/\.yuraive\.json$/i, '') + '.yuraive'

export const createPlayerBundle = (graphPath: string, graph: YuraiveGraph, scripts: ScriptDocument[], layouts: LayoutDocument[]) => {
  const graphBytes = encoder.encode(JSON.stringify(stripEditorState(graph)))
  if (graphBytes.length > MAX_GRAPH_SIZE) throw new Error('グラフがバンドル上限の8 MiBを超えています')

  const files = textFilesForGraph(graphPath, scripts, layouts)
  if (files.length > MAX_TEXT_FILES) throw new Error(`テキストファイルが多すぎます（上限${MAX_TEXT_FILES}件）`)
  const availableScripts = new Set(files.filter((file) => file.kind === 1).map((file) => file.path))
  const availableLayouts = new Set(files.filter((file) => file.kind === 2).map((file) => file.path))
  const requiredScripts = [
    graph.playbackStats?.path,
    ...Object.values(graph.nodes).map((node) => node.script?.path),
    ...Object.values(graph.buttons).map((button) => button.render?.path),
  ].filter((path): path is string => Boolean(path))
  const requiredLayouts = Object.values(graph.playerControls).map((control) => control.layout).filter((path): path is string => Boolean(path))
  requiredScripts.forEach((path) => { if (!availableScripts.has(path)) throw new Error(`コンテンツルート内にスクリプトが見つかりません: ${path}`) })
  requiredLayouts.forEach((path) => { if (!availableLayouts.has(path)) throw new Error(`コンテンツルート内にレイアウトが見つかりません: ${path}`) })
  const seen = new Set<string>()
  let textTotalSize = 0
  const encodedFiles = files.map((file) => {
    if (!isSafeTextPath(file.path)) throw new Error(`安全でないテキストファイルパスです: ${file.path}`)
    const normalized = file.path.toLocaleLowerCase('en-US')
    if (seen.has(normalized)) throw new Error(`テキストファイルパスが重複しています: ${file.path}`)
    seen.add(normalized)
    const path = encoder.encode(file.path)
    const content = encoder.encode(file.content)
    if (path.length > 4096) throw new Error(`テキストファイルのパスが長すぎます: ${file.path}`)
    if (content.length > MAX_TEXT_FILE_SIZE) throw new Error(`テキストファイルが2 MiBを超えています: ${file.path}`)
    textTotalSize += content.length
    if (textTotalSize > MAX_TEXT_TOTAL_SIZE) throw new Error('テキストファイルの合計が8 MiBを超えています')
    return concat([bytesField(1, path), bytesField(2, content), varintField(3, file.kind)])
  })

  const payload = concat([
    varintField(1, BUNDLE_VERSION),
    bytesField(2, graphBytes),
    ...encodedFiles.map((file) => bytesField(3, file)),
  ])
  const output = new Uint8Array(HEADER_SIZE + payload.length)
  output.set(MAGIC, 0)
  const header = new DataView(output.buffer)
  header.setUint16(8, FORMAT_VERSION, true)
  header.setUint16(10, HEADER_SIZE, true)
  header.setUint32(12, payload.length, true)
  output.set(payload, HEADER_SIZE)
  if (output.length > MAX_BUNDLE_SIZE) throw new Error('バンドルが16 MiBを超えています')
  return output
}
