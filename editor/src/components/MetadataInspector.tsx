import { useEffect, useState } from 'react'
import { playerBundleName } from '../bundle'
import type { AssetEntry, ScriptDocument, YuraiveGraph, YuraiveMetadata } from '../types'
import { uid } from '../editor/workspace'
import { Field, PathPicker, Section } from './InspectorControls'
import { Icon } from './Icon'

function MetadataTagsInput({
  tags,
  onCommit,
}: {
  tags?: string[]
  onCommit: (tags: string[]) => void
}) {
  const joined = (tags ?? []).join(', ')
  const [draft, setDraft] = useState(joined)
  useEffect(() => setDraft(joined), [joined])
  const commit = () =>
    onCommit(
      draft
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    )
  return (
    <input
      aria-label="グラフのタグ"
      value={draft}
      placeholder="ASMR, 睡眠"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function SocialLinksEditor({
  links,
  onChange,
}: {
  links: NonNullable<YuraiveMetadata['socialLinks']>
  onChange: (links: NonNullable<YuraiveMetadata['socialLinks']>) => void
}) {
  return (
    <div className="social-links-editor">
      {links.map((link, index) => (
        <div className="social-link-row" key={index}>
          <input
            aria-label={`ソーシャルリンク${index + 1}の名前`}
            value={link.label}
            placeholder="X / Web"
            onChange={(event) =>
              onChange(
                links.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, label: event.target.value } : item,
                ),
              )
            }
          />
          <input
            aria-label={`ソーシャルリンク${index + 1}のURL`}
            value={link.url}
            placeholder="https://"
            onChange={(event) =>
              onChange(
                links.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, url: event.target.value } : item,
                ),
              )
            }
          />
          <button
            className="icon-button danger"
            title="リンクを削除"
            onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <button className="mini-button" onClick={() => onChange([...links, { label: '', url: '' }])}>
        + ソーシャルリンク
      </button>
    </div>
  )
}

export function GraphMetadataInspector({
  graph,
  graphName,
  assets,
  scripts,
  onChange,
  onExportBundle,
}: {
  graph: YuraiveGraph
  graphName: string
  assets: AssetEntry[]
  scripts: ScriptDocument[]
  onChange: (graph: YuraiveGraph) => void
  onExportBundle: () => void
}) {
  const metadata = graph.metadata ?? {}
  const commit = (next: YuraiveMetadata) => {
    const compact = Object.fromEntries(
      Object.entries(next).filter(([, value]) =>
        Array.isArray(value)
          ? value.length > 0
          : typeof value === 'string'
            ? value.trim().length > 0
            : value !== undefined,
      ),
    ) as YuraiveMetadata
    const nextGraph = { ...graph }
    delete nextGraph.metadata
    if (Object.keys(compact).length) nextGraph.metadata = compact
    onChange(nextGraph)
  }
  const text = (
    key: keyof Pick<
      YuraiveMetadata,
      'contentId' | 'displayName' | 'description' | 'author' | 'createdAt' | 'updatedAt'
    >,
    value: string,
  ) => commit({ ...metadata, [key]: value })
  const dateField = (key: 'createdAt' | 'updatedAt', label: string) => (
    <Field label={label} hint="RFC 3339 / ISO 8601">
      <div className="metadata-date-field">
        <input
          value={metadata[key] ?? ''}
          placeholder="2026-07-13T12:00:00+09:00"
          onChange={(event) => text(key, event.target.value)}
        />
        <button
          type="button"
          className="mini-button"
          onClick={() => text(key, new Date().toISOString())}
        >
          現在
        </button>
      </div>
    </Field>
  )
  return (
    <aside className="inspector graph-metadata-inspector" data-testid="graph-metadata-inspector">
      <div className="panel-title">
        <span>グラフ情報</span>
        <small>Yuraive v1</small>
      </div>
      <div className="inspector-scroll">
        <div className="graph-file-card">
          <span>
            <Icon name="code" size={15} />
          </span>
          <div>
            <strong>{metadata.displayName || graphName}</strong>
            <small>{graphName}</small>
          </div>
        </div>
        <Section title="一般情報">
          <Field
            label="コンテンツID"
            hint="同じIDのYuraiveは同じ作品の統計として集計されます。com.example.groupId形式を推奨します"
          >
            <div className="metadata-date-field">
              <input
                aria-label="コンテンツID"
                value={metadata.contentId ?? ''}
                placeholder="com.example.work"
                onChange={(event) => text('contentId', event.target.value)}
              />
              <button
                type="button"
                className="mini-button"
                onClick={() => text('contentId', crypto.randomUUID?.() ?? uid())}
              >
                新規ID
              </button>
            </div>
          </Field>
          <Field label="表示名">
            <input
              aria-label="グラフの表示名"
              value={metadata.displayName ?? ''}
              placeholder={graphName.replace(/\.yuraive\.json$/i, '')}
              onChange={(event) => text('displayName', event.target.value)}
            />
          </Field>
          <Field label="説明">
            <textarea
              aria-label="グラフの説明"
              rows={5}
              value={metadata.description ?? ''}
              placeholder="このグラフの用途や内容"
              onChange={(event) => text('description', event.target.value)}
            />
          </Field>
          <Field label="作者">
            <input
              aria-label="グラフの作者"
              value={metadata.author ?? ''}
              placeholder="作者名"
              onChange={(event) => text('author', event.target.value)}
            />
          </Field>
          <Field label="サムネイル">
            <PathPicker
              value={metadata.thumbnail ?? ''}
              assets={assets}
              kinds={['image']}
              placeholder="任意"
              onChange={(thumbnail) => commit({ ...metadata, thumbnail: thumbnail || undefined })}
            />
          </Field>
          <Field label="タグ" hint="カンマ区切り">
            <MetadataTagsInput
              tags={metadata.tags}
              onCommit={(tags) => commit({ ...metadata, tags })}
            />
          </Field>
          <Field label="ソーシャルリンク">
            <SocialLinksEditor
              links={metadata.socialLinks ?? []}
              onChange={(socialLinks) => commit({ ...metadata, socialLinks })}
            />
          </Field>
        </Section>
        <Section title="日時">
          {dateField('createdAt', '作成日時')}
          {dateField('updatedAt', '更新日時')}
        </Section>
        <Section title="再生統計">
          <label className="check-row">
            <input
              type="checkbox"
              checked={Boolean(graph.playbackStats)}
              onChange={(event) => {
                const next = { ...graph }
                if (event.target.checked)
                  next.playbackStats = { path: scripts[0]?.path ?? '', function: 'render_stats' }
                else delete next.playbackStats
                onChange(next)
              }}
            />
            <span>
              <strong>作者定義の再生統計を有効にする</strong>
            </span>
          </label>
          {graph.playbackStats && (
            <>
              <Field label="スクリプト">
                <select
                  aria-label="再生統計スクリプト"
                  value={graph.playbackStats.path}
                  onChange={(event) =>
                    onChange({
                      ...graph,
                      playbackStats: { ...graph.playbackStats!, path: event.target.value },
                    })
                  }
                >
                  <option value="">選択してください</option>
                  {scripts.map((script) => (
                    <option value={script.path} key={script.uid}>
                      {script.path}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="関数" hint="省略時 render_stats">
                <input
                  aria-label="再生統計関数"
                  value={graph.playbackStats.function ?? ''}
                  placeholder="render_stats"
                  onChange={(event) =>
                    onChange({
                      ...graph,
                      playbackStats: {
                        ...graph.playbackStats!,
                        function: event.target.value || undefined,
                      },
                    })
                  }
                />
              </Field>
            </>
          )}
        </Section>
        <Section title="配布">
          <button className="bundle-export-button" onClick={onExportBundle}>
            <Icon name="save" size={14} />
            <span>
              <strong>プレイヤー用バイナリを出力</strong>
              <small>{playerBundleName(graphName)} · スクリプトとレイアウトを同梱</small>
            </span>
          </button>
        </Section>
      </div>
    </aside>
  )
}
