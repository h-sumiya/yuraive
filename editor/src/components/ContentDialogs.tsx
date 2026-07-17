import { useEffect, useMemo, useState } from 'react'
import { decodePlayerBundle } from '../bundle'
import { normalizeGraph } from '../graph'
import { nativeFileUrl } from '../nativeDirectory'
import { inspectContentAssets, type ContentAssetInspection } from '../contentInspection'
import type { AssetEntry, GraphDocument, YuraiveGraph } from '../types'
import { Icon } from './Icon'

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file) {
      setUrl(undefined)
      return
    }
    const nativeUrl = nativeFileUrl(file)
    if (nativeUrl) {
      setUrl(nativeUrl)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

function AudioFilePreview({ file, path, url }: { file: File; path: string; url: string }) {
  const [peaks, setPeaks] = useState<number[]>(
    Array.from({ length: 96 }, (_, index) => 0.18 + Math.abs(Math.sin(index * 0.73)) * 0.38),
  )
  const [duration, setDuration] = useState(0)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let cancelled = false
    void file.arrayBuffer().then(async (buffer) => {
      try {
        const context = new AudioContext()
        const audio = await context.decodeAudioData(buffer.slice(0))
        const channel = audio.getChannelData(0)
        const block = Math.max(1, Math.floor(channel.length / 96))
        const next = Array.from({ length: 96 }, (_, index) => {
          let peak = 0
          const end = Math.min(channel.length, (index + 1) * block)
          for (let cursor = index * block; cursor < end; cursor++)
            peak = Math.max(peak, Math.abs(channel[cursor]))
          return Math.max(0.04, peak)
        })
        if (!cancelled) {
          setPeaks(next)
          setDuration(audio.duration)
        }
        await context.close()
      } catch {
        const bytes = new Uint8Array(buffer)
        if (!cancelled && bytes.length)
          setPeaks(
            Array.from(
              { length: 96 },
              (_, index) =>
                0.08 + ((bytes[Math.floor((index / 96) * bytes.length)] ?? 0) / 255) * 0.82,
            ),
          )
      }
    })
    return () => {
      cancelled = true
    }
  }, [file])
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`
  return (
    <div className="audio-preview-rich">
      <div className="audio-preview-heading">
        <span className="audio-disc">
          <Icon name="media" size={25} />
        </span>
        <div>
          <strong>{file.name}</strong>
          <small>{path}</small>
        </div>
        <span className="duration-badge">{duration ? time(duration) : '解析中'}</span>
      </div>
      <div className="waveform" aria-label="音声波形">
        {peaks.map((peak, index) => (
          <i
            className={index / peaks.length <= progress ? 'played' : ''}
            style={{ height: `${Math.max(3, peak * 76)}px` }}
            key={index}
          />
        ))}
      </div>
      <div className="audio-time">
        <span>{time(progress * duration)}</span>
        <span>{time(duration)}</span>
      </div>
      <audio
        src={url}
        controls
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) =>
          setProgress(
            event.currentTarget.duration
              ? event.currentTarget.currentTime / event.currentTarget.duration
              : 0,
          )
        }
      />
      <div className="audio-metadata">
        <div>
          <small>形式</small>
          <strong>{file.type || file.name.split('.').pop()?.toUpperCase() || 'Audio'}</strong>
        </div>
        <div>
          <small>サイズ</small>
          <strong>
            {file.size > 1024 * 1024
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
              : `${(file.size / 1024).toFixed(1)} KB`}
          </strong>
        </div>
        <div>
          <small>チャンネル</small>
          <strong>Audio Track</strong>
        </div>
        <div>
          <small>更新日時</small>
          <strong>
            {file.lastModified ? new Date(file.lastModified).toLocaleDateString('ja-JP') : '—'}
          </strong>
        </div>
      </div>
    </div>
  )
}

export function AssetPreview({ asset, onClose }: { asset: AssetEntry; onClose: () => void }) {
  const [textContent, setTextContent] = useState('')
  const url = useObjectUrl(asset.file)
  useEffect(() => {
    if (asset.kind === 'subtitle' || asset.kind === 'other')
      void asset.file.text().then(setTextContent)
  }, [asset])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="asset-preview-modal">
        <header>
          <div>
            <Icon
              name={asset.kind === 'image' ? 'image' : asset.kind === 'other' ? 'file' : 'media'}
              size={14}
            />
            <strong>{asset.name}</strong>
            <span>{asset.path}</span>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className={`asset-preview-body ${asset.kind}`}>
          {asset.kind === 'image' && url && <img src={url} alt={asset.name} />}
          {asset.kind === 'video' && url && <video src={url} controls autoPlay />}
          {asset.kind === 'audio' && url && (
            <AudioFilePreview file={asset.file} path={asset.path} url={url} />
          )}
          {(asset.kind === 'subtitle' || asset.kind === 'other') && <pre>{textContent}</pre>}
        </div>
        <footer>
          <span>{asset.file.type || '種類不明'}</span>
          <span>{(asset.file.size / 1024).toFixed(asset.file.size > 1024 * 100 ? 0 : 1)} KB</span>
        </footer>
      </div>
    </div>
  )
}

export type ContentInspectionTarget =
  { kind: 'json'; document: GraphDocument } | { kind: 'bundle'; asset: AssetEntry }

type InspectionTreeBranch = {
  folders: Map<string, InspectionTreeBranch>
  files: ContentAssetInspection[]
}

const inspectionKindLabel = (kinds: ContentAssetInspection['kinds']) =>
  kinds
    .map(
      (kind) =>
        ({
          audio: '音声',
          video: '動画',
          image: '画像',
          subtitle: '字幕',
          script: 'Script',
          layout: 'Layout',
        })[kind],
    )
    .join(' / ')

function InspectionAssetTree({ assets }: { assets: ContentAssetInspection[] }) {
  const tree = useMemo(() => {
    const root: InspectionTreeBranch = { folders: new Map(), files: [] }
    assets.forEach((asset) => {
      const parts =
        asset.problem === 'unsafe' ? [asset.path] : asset.path.split('/').filter(Boolean)
      const name = parts.pop()
      if (!name) return
      let branch = root
      parts.forEach((part) => {
        if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), files: [] })
        branch = branch.folders.get(part)!
      })
      branch.files.push(asset)
    })
    return root
  }, [assets])
  const render = (branch: InspectionTreeBranch, depth = 0): React.ReactNode => (
    <>
      {[...branch.folders.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, child]) => (
          <details className="inspection-tree-folder" open key={`${depth}:${name}`}>
            <summary style={{ paddingLeft: 8 + depth * 14 }}>
              <Icon name="chevron" size={11} />
              <Icon name="folder" size={13} />
              <span>{name}</span>
            </summary>
            {render(child, depth + 1)}
          </details>
        ))}
      {[...branch.files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((asset) => {
          const name =
            asset.problem === 'unsafe' ? asset.path : (asset.path.split('/').at(-1) ?? asset.path)
          const icon = asset.kinds.includes('image')
            ? 'image'
            : asset.kinds.some((kind) => kind === 'audio' || kind === 'video')
              ? 'media'
              : asset.kinds.includes('script')
                ? 'script'
                : asset.kinds.includes('layout')
                  ? 'fit'
                  : 'file'
          return (
            <div
              className={`inspection-tree-file ${asset.recognized ? '' : 'unrecognized'}`}
              style={{ paddingLeft: 26 + depth * 14 }}
              title={asset.path}
              key={asset.path}
            >
              <Icon name={icon} size={13} />
              <span>{name}</span>
              <small>
                {asset.problem === 'unsafe'
                  ? '不正なパス'
                  : asset.problem === 'missing'
                    ? '見つかりません'
                    : asset.embedded
                      ? '内蔵'
                      : inspectionKindLabel(asset.kinds)}
              </small>
            </div>
          )
        })}
    </>
  )
  return (
    <div className="inspection-file-tree">
      {assets.length ? (
        render(tree)
      ) : (
        <div className="inspection-tree-empty">参照アセットはありません</div>
      )}
    </div>
  )
}

export function ContentInspectionModal({
  target,
  workspacePaths,
  onClose,
}: {
  target: ContentInspectionTarget
  workspacePaths: string[]
  onClose: () => void
}) {
  const [decoded, setDecoded] = useState<{
    graph: YuraiveGraph
    embeddedPaths: Set<string>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setError(null)
    if (target.kind === 'json') {
      setDecoded({ graph: target.document.graph, embeddedPaths: new Set() })
      return () => {
        cancelled = true
      }
    }
    setDecoded(null)
    void target.asset.file
      .arrayBuffer()
      .then((buffer) => decodePlayerBundle(new Uint8Array(buffer)))
      .then((bundle) => {
        if (!cancelled)
          setDecoded({
            graph: normalizeGraph(JSON.parse(bundle.graphJson)),
            embeddedPaths: new Set(Object.keys(bundle.textAssets)),
          })
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'バイナリを読み込めませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [target])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])

  const source = target.kind === 'json' ? target.document : target.asset
  const parent = source.path.includes('/') ? source.path.slice(0, source.path.lastIndexOf('/')) : ''
  const knownPaths = useMemo(() => new Set(workspacePaths), [workspacePaths])
  const inspected = decoded
    ? inspectContentAssets(
        decoded.graph,
        (path) => knownPaths.has([parent, path].filter(Boolean).join('/')),
        decoded.embeddedPaths,
        target.kind === 'bundle',
      )
    : []
  const metadata = decoded?.graph.metadata
  const missing = inspected.filter((asset) => !asset.recognized).length
  const metadataRows = [
    ['作者', metadata?.author],
    ['Content ID', metadata?.contentId],
    ['作成日時', metadata?.createdAt],
    ['更新日時', metadata?.updatedAt],
    ['タグ', metadata?.tags?.join('、')],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="content-inspection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-inspection-title"
      >
        <header>
          <div>
            <Icon name="info" size={15} />
            <strong id="content-inspection-title">作品情報とアセット</strong>
            <span>{source.path}</span>
            <i>{target.kind === 'json' ? 'JSON' : 'バイナリ'}</i>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {error ? (
          <div className="inspection-load-error">
            <Icon name="warning" size={20} />
            <strong>ファイルを解析できません</strong>
            <span>{error}</span>
          </div>
        ) : !decoded ? (
          <div className="inspection-loading">バイナリを解析中…</div>
        ) : (
          <div className="content-inspection-body">
            <section className="inspection-metadata">
              <h2>{metadata?.displayName || source.name.replace(/\.yuraive(?:\.json)?$/i, '')}</h2>
              {metadata?.description && <p>{metadata.description}</p>}
              <dl>
                <div>
                  <dt>ファイル</dt>
                  <dd>{source.name}</dd>
                </div>
                {metadataRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="inspection-assets">
              <header>
                <div>
                  <h3>参照アセット</h3>
                  <span>
                    {inspected.length - missing} / {inspected.length} 件を確認
                  </span>
                </div>
                {missing > 0 && <strong>{missing} 件を認識できません</strong>}
              </header>
              <InspectionAssetTree assets={inspected} />
            </section>
          </div>
        )}
      </section>
    </div>
  )
}

export function BundleExportNotice({ onClose }: { onClose: (hidePermanently: boolean) => void }) {
  const [hidePermanently, setHidePermanently] = useState(false)
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose(hidePermanently)}
    >
      <section
        className="bundle-export-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bundle-export-title"
      >
        <header>
          <div>
            <Icon name="check" size={15} />
            <strong id="bundle-export-title">プレイヤー用バイナリを出力しました</strong>
          </div>
          <button
            className="icon-button"
            aria-label="閉じる"
            onClick={() => onClose(hidePermanently)}
          >
            <Icon name="close" size={13} />
          </button>
        </header>
        <div>
          <p>
            <code>.yuraive</code>{' '}
            にはグラフ、Starlarkスクリプト、ボタンレイアウトが含まれています。配布時に元の{' '}
            <code>.yuraive.json</code>、<code>.star</code>、<code>.yuraive-layout.html</code>{' '}
            を添える必要はありません。
          </p>
          <p>
            音声・動画・画像・字幕はバンドルに含まれません。相対パスを保ったまま一緒に配布してください。
          </p>
        </div>
        <footer>
          <label className="check-row">
            <input
              type="checkbox"
              checked={hidePermanently}
              onChange={(event) => setHidePermanently(event.target.checked)}
            />
            今後この案内を表示しない
          </label>
          <button className="primary-button compact" onClick={() => onClose(hidePermanently)}>
            閉じる
          </button>
        </footer>
      </section>
    </div>
  )
}
