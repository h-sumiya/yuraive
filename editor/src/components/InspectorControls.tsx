import { useEffect, useMemo, useRef, useState } from 'react'
import { probability } from '../graph'
import type { AssetEntry, MediaCandidate, Transition } from '../types'
import { ASSET_DRAG_TYPE } from '../editor/workspace'
import { Icon } from './Icon'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number | undefined
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

export function DebouncedColorInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <input
      type="color"
      value={draft.slice(0, 7)}
      onInput={(event) => {
        const next = event.currentTarget.value
        setDraft(next)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => onCommit(next), 140)
      }}
      onBlur={() => {
        window.clearTimeout(timer.current)
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

const fuzzyPathScore = (query: string, candidate: string) => {
  const needle = query.toLowerCase().replaceAll('\\', '/')
  const haystack = candidate.toLowerCase()
  if (!needle) return 0
  let cursor = -1
  let score = 0
  let consecutive = 0
  for (const char of needle) {
    if (char === ' ') continue
    const index = haystack.indexOf(char, cursor + 1)
    if (index < 0) return -Infinity
    if (index === cursor + 1) {
      consecutive += 1
      score += 8 + consecutive * 2
    } else {
      consecutive = 0
      score -= Math.min(12, index - cursor - 1)
    }
    if (index === 0 || '/._-'.includes(haystack[index - 1] ?? '')) score += 12
    cursor = index
  }
  return score - candidate.length * 0.02
}

export function PathPicker({
  value,
  assets,
  kinds,
  placeholder = 'ファイルを選択',
  onChange,
}: {
  value: string
  assets: AssetEntry[]
  kinds?: AssetEntry['kind'][]
  placeholder?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const choices = useMemo(
    () =>
      assets
        .filter((asset) => !kinds || kinds.includes(asset.kind))
        .map((asset) => ({ asset, score: fuzzyPathScore(value, asset.path) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score || a.asset.path.localeCompare(b.asset.path))
        .slice(0, 10),
    [assets, kinds, value],
  )
  const choose = (path: string) => {
    onChange(path)
    setOpen(false)
    setActiveIndex(0)
  }
  return (
    <div
      className={`path-picker ${open ? 'open' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
        const asset = assets.find((item) => item.path === path)
        if (path && asset && (!kinds || kinds.includes(asset.kind))) {
          event.preventDefault()
          event.stopPropagation()
          choose(path)
        }
      }}
    >
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((index) => Math.min(choices.length - 1, index + 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index) => Math.max(0, index - 1))
          }
          if (event.key === 'Enter' && open && choices[activeIndex]) {
            event.preventDefault()
            choose(choices[activeIndex].asset.path)
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && choices.length > 0 && (
        <div className="path-suggestions">
          {choices.map(({ asset }, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'active' : ''}
              key={asset.path}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(asset.path)
              }}
            >
              <Icon
                name={
                  asset.kind === 'image'
                    ? 'image'
                    : ['audio', 'video'].includes(asset.kind)
                      ? 'media'
                      : 'file'
                }
                size={12}
              />
              <span>{asset.path}</span>
              <small>{asset.kind}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Section({
  title,
  count,
  action,
  children,
  defaultOpen = true,
}: {
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`inspector-section ${open ? 'open' : ''}`}>
      <header>
        <button className="section-toggle" onClick={() => setOpen(!open)}>
          <Icon name="chevron" size={14} />
          <strong>{title}</strong>
          {count !== undefined && <span className="count">{count}</span>}
        </button>
        {action}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function TransitionEditor({
  transitions,
  nodes,
  nodeLabels,
  probabilityMode,
  onChange,
  onPick,
}: {
  transitions: Transition[]
  nodes: string[]
  nodeLabels: Record<string, string>
  probabilityMode: boolean
  onChange: (next: Transition[]) => void
  onPick?: (id: string) => void
}) {
  const displayName = (id: string) => `${nodeLabels[id] || id} - ${id}`
  return (
    <div className="stack-list">
      {transitions.map((transition, index) => (
        <details className="item-editor transition-item" key={`${index}-${transition.to}`}>
          <summary>
            <Icon name="link" size={13} />
            <span>{transition.to ? displayName(transition.to) : '遷移先未設定'}</span>
            {transitions.length > 1 && (
              <span className="summary-meta">
                {probabilityMode
                  ? `${probability(transition.weight, transitions).toFixed(1)}%`
                  : `w ${transition.weight}`}
              </span>
            )}
            <button
              className="summary-delete"
              title="遷移を削除"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange(transitions.filter((_, itemIndex) => itemIndex !== index))
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </summary>
          <div className="item-editor-body transition-edit-body">
            <button
              className="target-dot"
              title="遷移先のノードを選択"
              onClick={() => onPick?.(transition.to)}
            >
              <Icon name="target" size={13} />
            </button>
            <select
              value={transition.to}
              onChange={(event) =>
                onChange(
                  transitions.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, to: event.target.value } : item,
                  ),
                )
              }
            >
              <option value="">遷移先を選択</option>
              {nodes.map((nodeId) => (
                <option
                  value={nodeId}
                  key={nodeId}
                  disabled={
                    nodeId !== transition.to &&
                    transitions.some((item, itemIndex) => itemIndex !== index && item.to === nodeId)
                  }
                >
                  {displayName(nodeId)}
                </option>
              ))}
            </select>
            {transitions.length > 1 && (
              <NumberInput
                min={0}
                step={0.1}
                value={transition.weight}
                onChange={(weight) =>
                  onChange(
                    transitions.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, weight } : item,
                    ),
                  )
                }
              />
            )}
          </div>
        </details>
      ))}
      {!transitions.length && <div className="empty-inline">遷移なし</div>}
    </div>
  )
}

export function MediaEditor({
  media,
  index,
  probabilityMode,
  assets,
  onChange,
  onRemove,
}: {
  media: MediaCandidate
  index: number
  probabilityMode: boolean
  assets: AssetEntry[]
  onChange: (media: MediaCandidate) => void
  onRemove: () => void
}) {
  const source = media.source
  const pathInput = (
    key: 'audio' | 'image' | 'video' | 'subtitle',
    kind: AssetEntry['kind'],
    label: string,
  ) => (
    <Field label={label}>
      <PathPicker
        value={source[key] ?? ''}
        assets={assets}
        kinds={[kind]}
        onChange={(value) => onChange({ ...media, source: { ...source, [key]: value } })}
      />
    </Field>
  )
  const changeType = (type: MediaCandidate['source']['type']) => {
    const common = {
      volume: source.volume ?? 1,
      loop: source.loop ?? false,
      subtitle: source.subtitle,
    }
    if (type === 'audio')
      onChange({
        ...media,
        source: { type, audio: source.audio ?? source.video ?? '', visual: 'keep', ...common },
      })
    if (type === 'audioImage')
      onChange({
        ...media,
        source: {
          type,
          audio: source.audio ?? '',
          image: source.image ?? '',
          fit: 'cover',
          ...common,
        },
      })
    if (type === 'video')
      onChange({
        ...media,
        source: { type, video: source.video ?? source.audio ?? '', fit: 'contain', ...common },
      })
  }
  const dropAsset = (path: string) => {
    const asset = assets.find((item) => item.path === path)
    if (!asset) return
    if (asset.kind === 'subtitle') onChange({ ...media, source: { ...source, subtitle: path } })
    if (asset.kind === 'audio')
      onChange({
        ...media,
        source:
          source.type === 'audioImage'
            ? { ...source, audio: path }
            : {
                type: 'audio',
                audio: path,
                visual: 'keep',
                volume: source.volume ?? 1,
                loop: source.loop ?? false,
                subtitle: source.subtitle,
              },
      })
    if (asset.kind === 'image')
      onChange({
        ...media,
        source: {
          type: 'audioImage',
          audio: source.audio ?? '',
          image: path,
          volume: source.volume ?? 1,
          loop: source.loop ?? false,
          subtitle: source.subtitle,
          fit: 'cover',
        },
      })
    if (asset.kind === 'video')
      onChange({
        ...media,
        source: {
          type: 'video',
          video: path,
          volume: source.volume ?? 1,
          loop: source.loop ?? false,
          subtitle: source.subtitle,
          fit: 'contain',
        },
      })
  }
  return (
    <details
      className="item-editor"
      open={index === 0}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
        if (path) {
          event.preventDefault()
          event.stopPropagation()
          dropAsset(path)
        }
      }}
    >
      <summary>
        <Icon name="media" size={14} />
        <span>{media.id || `メディア ${index + 1}`}</span>
        <span className="summary-meta">
          {probabilityMode ? '' : `w ${media.weight}`} · {source.type}
        </span>
        <button
          className="summary-delete"
          title="メディアを削除"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </summary>
      <div className="item-editor-body">
        <div className="two-col">
          <Field label="ID">
            <input
              value={media.id}
              onChange={(event) => onChange({ ...media, id: event.target.value })}
            />
          </Field>
          <Field label="重み">
            <NumberInput
              min={0}
              step={0.1}
              value={media.weight}
              onChange={(weight) => onChange({ ...media, weight })}
            />
          </Field>
        </div>
        <Field label="形式">
          <select
            value={source.type}
            onChange={(event) => changeType(event.target.value as MediaCandidate['source']['type'])}
          >
            <option value="audio">音声</option>
            <option value="audioImage">音声 + 画像</option>
            <option value="video">動画</option>
          </select>
        </Field>
        {source.type !== 'video' && pathInput('audio', 'audio', '音声')}
        {source.type === 'audioImage' && pathInput('image', 'image', '画像')}
        {source.type === 'video' && pathInput('video', 'video', '動画')}
        {pathInput('subtitle', 'subtitle', '字幕（任意）')}
        <div className="two-col">
          <Field label="音量">
            <NumberInput
              min={0}
              max={1}
              step={0.05}
              value={source.volume ?? 1}
              onChange={(volume) => onChange({ ...media, source: { ...source, volume } })}
            />
          </Field>
          {source.type === 'audio' ? (
            <Field label="画像">
              <select
                value={source.visual ?? 'keep'}
                onChange={(event) =>
                  onChange({
                    ...media,
                    source: { ...source, visual: event.target.value as 'keep' | 'clear' },
                  })
                }
              >
                <option value="keep">維持</option>
                <option value="clear">消去</option>
              </select>
            </Field>
          ) : (
            <Field label="表示方法">
              <select
                value={source.fit ?? 'contain'}
                onChange={(event) =>
                  onChange({
                    ...media,
                    source: {
                      ...source,
                      fit: event.target.value as 'contain' | 'cover' | 'stretch',
                    },
                  })
                }
              >
                <option value="contain">全体を表示</option>
                <option value="cover">領域を覆う</option>
                <option value="stretch">引き伸ばす</option>
              </select>
            </Field>
          )}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={source.loop ?? false}
            onChange={(event) =>
              onChange({ ...media, source: { ...source, loop: event.target.checked } })
            }
          />
          ループ再生
        </label>
        {source.type === 'audioImage' && (
          <div className="sub-options">
            <label className="check-row">
              <input
                type="checkbox"
                checked={Boolean(source.imageTransition)}
                onChange={(event) =>
                  onChange({
                    ...media,
                    source: {
                      ...source,
                      imageTransition: event.target.checked
                        ? { type: 'crossfade', durationMs: 1000 }
                        : undefined,
                    },
                  })
                }
              />
              画像をクロスフェード
            </label>
            {source.imageTransition && (
              <Field label="時間 (ms)">
                <NumberInput
                  min={0}
                  value={source.imageTransition.durationMs}
                  onChange={(durationMs) =>
                    onChange({
                      ...media,
                      source: { ...source, imageTransition: { type: 'crossfade', durationMs } },
                    })
                  }
                />
              </Field>
            )}
          </div>
        )}
        <button className="text-button danger" onClick={onRemove}>
          <Icon name="trash" size={14} />
          このメディアを削除
        </button>
      </div>
    </details>
  )
}
