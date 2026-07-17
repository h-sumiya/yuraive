import type { YuraiveGraph } from './types'

export type ContentAssetKind = 'audio' | 'video' | 'image' | 'subtitle' | 'script' | 'layout'

export type ContentAssetInspection = {
  path: string
  kinds: ContentAssetKind[]
  recognized: boolean
  embedded: boolean
  problem?: 'unsafe' | 'missing'
}

const isSafeRelativePath = (path: string) =>
  Boolean(path) &&
  !path.startsWith('/') &&
  !path.includes(':') &&
  !path.includes('\\') &&
  path.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')

export const expectedContentAssets = (graph: YuraiveGraph) => {
  const expected = new Map<string, Set<ContentAssetKind>>()
  const add = (path: string | undefined, kind: ContentAssetKind) => {
    if (!path) return
    const kinds = expected.get(path) ?? new Set<ContentAssetKind>()
    kinds.add(kind)
    expected.set(path, kinds)
  }

  add(graph.metadata?.thumbnail, 'image')
  add(graph.playbackStats?.path, 'script')
  Object.values(graph.nodes).forEach((node) => {
    add(node.script?.path, 'script')
    node.media?.forEach((media) => {
      add(media.source.audio, 'audio')
      add(media.source.video, 'video')
      add(media.source.image, 'image')
      add(media.source.subtitle, 'subtitle')
    })
  })
  Object.values(graph.buttons).forEach((button) => {
    add(button.style?.backgroundImage, 'image')
    add(button.render?.path, 'script')
  })
  Object.values(graph.playerControls).forEach((control) => add(control.layout, 'layout'))

  return [...expected.entries()]
    .map(([path, kinds]) => ({ path, kinds: [...kinds].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export const inspectContentAssets = (
  graph: YuraiveGraph,
  exists: (path: string) => boolean,
  embeddedPaths: ReadonlySet<string> = new Set(),
  bundleMode = false,
): ContentAssetInspection[] =>
  expectedContentAssets(graph).map(({ path, kinds }) => {
    const safe = isSafeRelativePath(path)
    const embedded = safe && embeddedPaths.has(path)
    const requiresEmbedding =
      bundleMode && kinds.some((kind) => kind === 'script' || kind === 'layout')
    const recognized = safe && (embedded || (!requiresEmbedding && exists(path)))
    return {
      path,
      kinds,
      recognized,
      embedded,
      ...(!safe
        ? { problem: 'unsafe' as const }
        : !recognized
          ? { problem: 'missing' as const }
          : {}),
    }
  })
