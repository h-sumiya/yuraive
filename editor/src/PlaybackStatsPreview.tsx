import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { nativeFileUrl } from './nativeDirectory'
import type { AssetEntry } from './types'

type JsonObject = Record<string, unknown>

const nodeTypes = new Set([
  'column',
  'row',
  'stack',
  'spacer',
  'divider',
  'text',
  'image',
  'icon',
  'surface',
  'badge',
  'progress',
])
const containerTypes = new Set(['column', 'row', 'stack', 'surface'])
const iconTypes = new Set([
  'play',
  'history',
  'timer',
  'star',
  'favorite',
  'sleep',
  'trophy',
  'stats',
])
const colorPattern = /^#[0-9a-f]{6}$/i
const MAX_TEXT_LENGTH = 4_096
const safePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes(':') &&
  !value.split('/').some((part) => !part || part === '..')
const object = (value: unknown): JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined

const validateNumber = (
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: string[],
  integer = false,
) => {
  if (value === undefined) return
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    errors.push(`${path}は${min}〜${max}${integer ? 'の整数' : ''}で指定してください`)
}

const validateStyle = (value: unknown, path: string, errors: string[]) => {
  if (value === undefined) return
  const style = object(value)
  if (!style) {
    errors.push(`${path}はオブジェクトで指定してください`)
    return
  }
  for (const key of ['width', 'height']) {
    const dimension = style[key]
    if (
      dimension !== undefined &&
      dimension !== 'fill' &&
      dimension !== 'wrap' &&
      (typeof dimension !== 'number' ||
        !Number.isFinite(dimension) ||
        dimension < 0 ||
        dimension > 2_048)
    )
      errors.push(`${path}.${key}は0〜2048の数値、fill、wrapのいずれかで指定してください`)
  }
  for (const [key, min, max] of [
    ['minHeight', 0, 1_024],
    ['aspectRatio', 0.05, 20],
    ['padding', 0, 128],
    ['gap', 0, 128],
    ['borderWidth', 0, 32],
    ['cornerRadius', 0, 128],
    ['opacity', 0, 1],
    ['fontSize', 8, 128],
    ['lineHeight', 8, 192],
    ['offsetX', -1_024, 1_024],
    ['offsetY', -1_024, 1_024],
  ] as Array<[string, number, number]>)
    validateNumber(style[key], `${path}.${key}`, min, max, errors)
  validateNumber(style.fontWeight, `${path}.fontWeight`, 100, 900, errors, true)
  validateNumber(style.maxLines, `${path}.maxLines`, 1, 100, errors, true)
  for (const key of ['backgroundColor', 'borderColor', 'color']) {
    const color = style[key]
    if (color !== undefined && (typeof color !== 'string' || !colorPattern.test(color)))
      errors.push(`${path}.${key}は16進カラーで指定してください`)
  }
  for (const [key, values] of [
    ['horizontalAlignment', new Set(['start', 'center', 'end'])],
    ['verticalAlignment', new Set(['top', 'center', 'bottom'])],
    ['textAlign', new Set(['start', 'center', 'end'])],
    [
      'align',
      new Set([
        'topStart',
        'topCenter',
        'topEnd',
        'centerStart',
        'center',
        'centerEnd',
        'bottomStart',
        'bottomCenter',
        'bottomEnd',
      ]),
    ],
  ] as Array<[string, Set<string>]>) {
    const candidate = style[key]
    if (candidate !== undefined && (typeof candidate !== 'string' || !values.has(candidate)))
      errors.push(`${path}.${key}が不正です`)
  }
}

const validateNode = (
  value: unknown,
  path: string,
  depth: number,
  state: { count: number },
  errors: string[],
) => {
  const node = object(value)
  if (!node) {
    errors.push(`${path}はオブジェクトで指定してください`)
    return
  }
  if (++state.count > 128) {
    errors.push('UI要素は128件以下にしてください')
    return
  }
  if (depth > 12) {
    errors.push(`${path}の階層が深すぎます`)
    return
  }
  if (typeof node.type !== 'string' || !nodeTypes.has(node.type)) {
    errors.push(`${path}.typeは未対応です`)
    return
  }
  validateStyle(node.style, `${path}.style`, errors)
  if (node.type === 'text') {
    const validText = typeof node.text === 'string' && node.text.length <= MAX_TEXT_LENGTH
    const validSpans =
      Array.isArray(node.spans) &&
      node.spans.length > 0 &&
      node.spans.length <= 32 &&
      node.spans.every((span, index) => {
        const item = object(span)
        if (!item || typeof item.text !== 'string' || item.text.length > MAX_TEXT_LENGTH)
          return false
        validateStyle(item.style, `${path}.spans[${index}].style`, errors)
        return true
      })
    if (validText === validSpans) errors.push(`${path}にはtextまたはspansのどちらか一方が必要です`)
  } else if (node.spans !== undefined) errors.push(`${path}.spansはtextだけに指定できます`)
  if (typeof node.text === 'string' && node.text.length > MAX_TEXT_LENGTH)
    errors.push(`${path}.textが長すぎます`)
  if (node.type === 'image' && (typeof node.source !== 'string' || !safePath(node.source)))
    errors.push(`${path}.sourceは安全な相対パスで指定してください`)
  if (node.type === 'icon' && (typeof node.icon !== 'string' || !iconTypes.has(node.icon)))
    errors.push(`${path}.iconは未対応です`)
  if (
    node.type === 'badge' &&
    (typeof node.text !== 'string' || !node.text.trim() || node.text.length > MAX_TEXT_LENGTH)
  )
    errors.push(`${path}.textは必須です`)
  if (
    node.type === 'progress' &&
    (typeof node.value !== 'number' ||
      !Number.isFinite(node.value) ||
      node.value < 0 ||
      node.value > 1)
  )
    errors.push(`${path}.valueは0〜1で指定してください`)
  if (
    node.label !== undefined &&
    (typeof node.label !== 'string' || node.label.length > MAX_TEXT_LENGTH)
  )
    errors.push(`${path}.labelが長すぎます`)
  if (node.children !== undefined) {
    if (!containerTypes.has(node.type) || !Array.isArray(node.children))
      errors.push(`${path}.childrenはコンテナだけに指定できます`)
    else if (node.children.length > 32) errors.push(`${path}.childrenは32件以下にしてください`)
    else
      node.children.forEach((child, index) =>
        validateNode(child, `${path}.children[${index}]`, depth + 1, state, errors),
      )
  }
}

const validateResult = (value: unknown) => {
  const errors: string[] = []
  const result = object(value)
  if (!result) return ['render_stats()はオブジェクトを返してください']
  if (typeof result.sortValue !== 'number' || !Number.isSafeInteger(result.sortValue))
    errors.push('sortValueは整数で指定してください')
  const display = object(result.display)
  if (!display) errors.push('displayは必須です')
  else {
    if (display.schemaVersion !== 1) errors.push('display.schemaVersionは1で指定してください')
    if (
      typeof display.fallbackText !== 'string' ||
      !display.fallbackText.trim() ||
      display.fallbackText.length > MAX_TEXT_LENGTH
    )
      errors.push('display.fallbackTextは1〜4096文字で指定してください')
    validateNode(display.root, 'display.root', 0, { count: 0 }, errors)
  }
  if (result.share !== undefined) {
    const share = object(result.share)
    if (!share || typeof share.text !== 'string' || !share.text.trim())
      errors.push('share.textは必須です')
    else if (share.text.length > 5_000) errors.push('share.textは5000文字以下にしてください')
    if (
      share?.url !== undefined &&
      (typeof share.url !== 'string' ||
        !share.url.startsWith('https://') ||
        share.url.length > 2_048)
    )
      errors.push('share.urlはHTTPS URLで指定してください')
    if (
      share?.hashtags !== undefined &&
      (!Array.isArray(share.hashtags) ||
        share.hashtags.length > 10 ||
        share.hashtags.some((tag) => typeof tag !== 'string' || !/^[^#\s]{1,50}$/.test(tag)))
    )
      errors.push('share.hashtagsが不正です')
    if (
      share?.via !== undefined &&
      (typeof share.via !== 'string' || !/^[a-z0-9_]{1,15}$/i.test(share.via))
    )
      errors.push('share.viaが不正です')
  }
  return errors
}

const px = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.max(0, value)}px` : undefined
const stackAlignment = (value: unknown) =>
  ({
    topStart: 'start start',
    topCenter: 'start center',
    topEnd: 'start end',
    centerStart: 'center start',
    center: 'center center',
    centerEnd: 'center end',
    bottomStart: 'end start',
    bottomCenter: 'end center',
    bottomEnd: 'end end',
  })[typeof value === 'string' ? value : 'topStart'] ?? 'start start'
const styleFor = (value: unknown): CSSProperties => {
  const style = object(value) ?? {}
  const maxLines = typeof style.maxLines === 'number' ? style.maxLines : undefined
  return {
    width:
      style.width === 'fill' ? '100%' : style.width === 'wrap' ? 'max-content' : px(style.width),
    height:
      style.height === 'fill' ? '100%' : style.height === 'wrap' ? 'max-content' : px(style.height),
    minHeight: px(style.minHeight),
    aspectRatio: typeof style.aspectRatio === 'number' ? String(style.aspectRatio) : undefined,
    padding: px(style.padding),
    gap: px(style.gap),
    background: typeof style.backgroundColor === 'string' ? style.backgroundColor : undefined,
    color: typeof style.color === 'string' ? style.color : undefined,
    borderColor: typeof style.borderColor === 'string' ? style.borderColor : undefined,
    borderWidth: px(style.borderWidth),
    borderStyle: style.borderWidth ? 'solid' : undefined,
    borderRadius: px(style.cornerRadius),
    opacity: typeof style.opacity === 'number' ? style.opacity : undefined,
    fontSize: px(style.fontSize),
    fontWeight: typeof style.fontWeight === 'number' ? style.fontWeight : undefined,
    lineHeight: px(style.lineHeight),
    WebkitBoxOrient: maxLines ? 'vertical' : undefined,
    WebkitLineClamp: maxLines,
    overflow: maxLines ? 'hidden' : undefined,
    display: maxLines ? '-webkit-box' : undefined,
    textAlign:
      style.textAlign === 'center' || style.textAlign === 'end' ? style.textAlign : 'start',
    transform: `translate(${typeof style.offsetX === 'number' ? style.offsetX : 0}px, ${typeof style.offsetY === 'number' ? style.offsetY : 0}px)`,
  }
}

const DisplayNodePreview = ({
  value,
  assetUrls,
}: {
  value: unknown
  assetUrls: Record<string, string>
}): ReactNode => {
  const node = object(value)
  if (!node || typeof node.type !== 'string') return null
  const style = styleFor(node.style)
  const children = Array.isArray(node.children) ? node.children : []
  const rawStyle = object(node.style) ?? {}
  const horizontal =
    rawStyle.horizontalAlignment === 'center'
      ? 'center'
      : rawStyle.horizontalAlignment === 'end'
        ? 'flex-end'
        : 'flex-start'
  const vertical =
    rawStyle.verticalAlignment === 'top'
      ? 'flex-start'
      : rawStyle.verticalAlignment === 'bottom'
        ? 'flex-end'
        : 'center'
  if (node.type === 'column' || node.type === 'surface')
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          flexDirection: 'column',
          alignItems: horizontal,
          justifyContent: vertical,
        }}
      >
        {children.map((child, index) => (
          <DisplayNodePreview value={child} assetUrls={assetUrls} key={index} />
        ))}
      </div>
    )
  if (node.type === 'row')
    return (
      <div style={{ ...style, display: 'flex', alignItems: vertical, justifyContent: horizontal }}>
        {children.map((child, index) => (
          <DisplayNodePreview value={child} assetUrls={assetUrls} key={index} />
        ))}
      </div>
    )
  if (node.type === 'stack')
    return (
      <div style={{ ...style, display: 'grid' }}>
        {children.map((child, index) => {
          const childStyle = object(object(child)?.style)
          return (
            <div
              style={{ gridArea: '1/1', placeSelf: stackAlignment(childStyle?.align) }}
              key={index}
            >
              <DisplayNodePreview value={child} assetUrls={assetUrls} />
            </div>
          )
        })}
      </div>
    )
  if (node.type === 'text') {
    if (typeof node.text === 'string') return <div style={style}>{node.text}</div>
    return (
      <div style={style}>
        {Array.isArray(node.spans) &&
          node.spans.map((span, index) => {
            const item = object(span)
            return (
              <span style={styleFor(item?.style)} key={index}>
                {typeof item?.text === 'string' ? item.text : ''}
              </span>
            )
          })}
      </div>
    )
  }
  if (node.type === 'image') {
    const source = typeof node.source === 'string' ? node.source : ''
    return assetUrls[source] ? (
      <img
        src={assetUrls[source]}
        alt={source}
        style={{ ...style, objectFit: 'contain', maxWidth: '100%' }}
      />
    ) : (
      <div className="stats-image-placeholder" style={style}>
        画像が見つかりません · {source}
      </div>
    )
  }
  if (node.type === 'icon') return <div style={style}>◆ {String(node.icon ?? '')}</div>
  if (node.type === 'badge')
    return (
      <span className="stats-badge-preview" style={style}>
        {String(node.text ?? '')}
      </span>
    )
  if (node.type === 'progress')
    return (
      <div style={style}>
        <small>{typeof node.label === 'string' ? node.label : ''}</small>
        <progress value={typeof node.value === 'number' ? node.value : 0} max={1} />
      </div>
    )
  if (node.type === 'divider') return <hr style={style} />
  return <div style={style} />
}

export function PlaybackStatsPreview({
  value,
  assets = [],
}: {
  value: unknown
  assets?: AssetEntry[]
}) {
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const next = Object.fromEntries(
      assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => [asset.path, nativeFileUrl(asset.file) ?? URL.createObjectURL(asset.file)]),
    )
    setAssetUrls(next)
    return () =>
      Object.values(next).forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      })
  }, [assets])
  const errors = validateResult(value)
  const result = object(value)
  const display = object(result?.display)
  return (
    <div className="stats-script-preview">
      <h3>Displayプレビュー</h3>
      {errors.length > 0 ? (
        <div className="stats-preview-errors">
          {errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      ) : (
        <>
          <div className="stats-preview-meta">
            <span>sortValue</span>
            <strong>{String(result?.sortValue)}</strong>
          </div>
          <div className="stats-display-canvas">
            <DisplayNodePreview value={display?.root} assetUrls={assetUrls} />
          </div>
          {object(result?.share) && (
            <div className="stats-share-preview">
              <strong>共有</strong>
              <span>{String(object(result?.share)?.text ?? '')}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
