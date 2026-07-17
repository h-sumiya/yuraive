import { type PlayerControlBooleanKey } from '../graph'
import type {
  GraphLayoutPlacement,
  LayoutDocument,
  PlayerControlSettings,
  ValidationIssue,
} from '../types'
import { Field, DebouncedColorInput, Section } from './InspectorControls'
import { Icon } from './Icon'

const playerControlLabels: Array<[PlayerControlBooleanKey, string, 'visibility' | 'action']> = [
  ['showSeekBar', 'シークバーを表示', 'visibility'],
  ['showPlaybackTime', '再生時間を表示', 'visibility'],
  ['showSceneName', 'シーン名を表示', 'visibility'],
  ['showFileName', '再生ファイル名を表示', 'visibility'],
  ['allowStop', '再生停止を許可', 'action'],
  ['allowSeek', 'シークを許可', 'action'],
  ['allowNext', '次へを許可（End扱い）', 'action'],
  ['allowPrevious', '前へ戻ることを許可', 'action'],
]

export function PlayerControlInspector({
  controlId,
  control,
  layouts,
  issues,
  global,
  usedBy,
  onChange,
  onRename,
  onGlobal,
  onDelete,
  onOpenLayout,
}: {
  controlId: string
  control: PlayerControlSettings
  layouts: LayoutDocument[]
  issues: ValidationIssue[]
  global: boolean
  usedBy: string[]
  onChange: (control: PlayerControlSettings) => void
  onRename: (next: string) => void
  onGlobal: (enabled: boolean) => void
  onDelete: () => void
  onOpenLayout: (layout: LayoutDocument) => void
}) {
  const section = (kind: 'visibility' | 'action') =>
    playerControlLabels
      .filter(([, , group]) => group === kind)
      .map(([key, label]) => (
        <label className="check-row control-check" key={key}>
          <input
            type="checkbox"
            checked={control[key]}
            onChange={(event) => onChange({ ...control, [key]: event.target.checked })}
          />
          <span>{label}</span>
        </label>
      ))
  return (
    <aside className="inspector player-control-inspector" data-testid="player-control-inspector">
      <div className="panel-title">
        <span>再生コントロール</span>
        <button className="icon-button danger" title="設定を削除" onClick={onDelete}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="inspector-scroll">
        <div className="node-identity control-identity">
          <span className="control-glyph">
            <Icon name="controls" size={15} />
          </span>
          <div>
            <strong>{controlId}</strong>
            <small>
              {global ? 'グローバル · ' : ''}
              {usedBy.length ? `${usedBy.length} ノード` : '未接続'}
            </small>
          </div>
        </div>
        {issues.length > 0 && (
          <div className="node-issues">
            {issues.map((issue, index) => (
              <div className={issue.severity} key={index}>
                <Icon name="warning" size={13} />
                {issue.message}
              </div>
            ))}
          </div>
        )}
        <Section title="設定">
          <Field label="設定ID">
            <input
              aria-label="再生設定ID"
              key={controlId}
              defaultValue={controlId}
              onBlur={(event) => onRename(event.target.value.trim())}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </Field>
          <Field label="グラフカラー">
            <div className="color-field">
              <DebouncedColorInput
                value={control.editor?.color ?? '#4f8c78'}
                onCommit={(color) => onChange({ ...control, editor: { ...control.editor, color } })}
              />
              <input
                value={control.editor?.color ?? '#4f8c78'}
                onChange={(event) =>
                  onChange({ ...control, editor: { ...control.editor, color: event.target.value } })
                }
              />
            </div>
          </Field>
          <Field
            label="ボタンレイアウト"
            hint="ファイルツリーからノード上部のポートへドロップしても接続できます"
          >
            <div className="script-reference">
              <select
                value={control.layout ?? ''}
                onChange={(event) =>
                  onChange({ ...control, layout: event.target.value || undefined })
                }
              >
                <option value="">未接続</option>
                {layouts.map((layout) => (
                  <option value={layout.path} key={layout.uid}>
                    {layout.path}
                  </option>
                ))}
              </select>
              {control.layout && (
                <button
                  className="icon-button"
                  title="レイアウトを開く"
                  onClick={() => {
                    const layout = layouts.find((item) => item.path === control.layout)
                    if (layout) onOpenLayout(layout)
                  }}
                >
                  <Icon name="fit" size={13} />
                </button>
              )}
            </div>
          </Field>
          <label className="check-row global-control-check">
            <input
              type="checkbox"
              checked={global}
              onChange={(event) => onGlobal(event.target.checked)}
            />
            <span>
              <strong>グローバル設定</strong>
              <small>個別設定がない全Media Nodeへ適用</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={Boolean(control.accentColor)}
              onChange={(event) =>
                onChange({ ...control, accentColor: event.target.checked ? '#574de5' : undefined })
              }
            />
            <span>
              <strong>プレイヤーのアクセント色</strong>
              <small>白・黒に近すぎない#RRGGBBのみ使用できます</small>
            </span>
          </label>
          {control.accentColor && (
            <Field label="アクセントカラー">
              <div className="color-field">
                <DebouncedColorInput
                  value={control.accentColor}
                  onCommit={(accentColor) => onChange({ ...control, accentColor })}
                />
                <input
                  aria-label="アクセントカラー"
                  value={control.accentColor}
                  onChange={(event) => onChange({ ...control, accentColor: event.target.value })}
                />
              </div>
            </Field>
          )}
        </Section>
        <Section title="表示">{section('visibility')}</Section>
        <Section title="操作">{section('action')}</Section>
        <button className="text-button danger" onClick={onDelete}>
          <Icon name="trash" size={14} />
          この設定を削除
        </button>
      </div>
    </aside>
  )
}

export function GraphLayoutInspector({
  path,
  placement,
  layout,
  connectedControls,
  onChange,
  onOpen,
  onRemove,
}: {
  path: string
  placement: GraphLayoutPlacement
  layout?: LayoutDocument
  connectedControls: string[]
  onChange: (placement: GraphLayoutPlacement) => void
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <aside className="inspector graph-layout-inspector" data-testid="graph-layout-inspector">
      <div className="panel-title">
        <span>レイアウトノード</span>
        <button className="icon-button danger" title="グラフから取り除く" onClick={onRemove}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="inspector-scroll">
        <div className="node-identity layout-node-identity">
          <span className="layout-glyph">
            <Icon name="fit" size={15} />
          </span>
          <div>
            <strong>{path.split('/').at(-1)}</strong>
            <small>{path}</small>
          </div>
        </div>
        {!layout && (
          <div className="node-issues">
            <div className="error">
              <Icon name="warning" size={13} />
              レイアウトファイルが見つかりません
            </div>
          </div>
        )}
        <Section title="レイアウト">
          <Field label="ファイル">
            <div className="script-reference">
              <input value={path} readOnly />
              {layout && (
                <button className="icon-button" title="レイアウトを開く" onClick={onOpen}>
                  <Icon name="fit" size={13} />
                </button>
              )}
            </div>
          </Field>
          <Field label="グラフカラー">
            <div className="color-field">
              <DebouncedColorInput
                value={placement.color ?? '#4d8e9f'}
                onCommit={(color) => onChange({ ...placement, color })}
              />
              <input
                value={placement.color ?? '#4d8e9f'}
                onChange={(event) => onChange({ ...placement, color: event.target.value })}
              />
            </div>
          </Field>
        </Section>
        <Section title="接続中の再生設定" count={connectedControls.length}>
          {connectedControls.length ? (
            connectedControls.map((id) => (
              <div className="layout-control-reference" key={id}>
                <Icon name="controls" size={12} />
                <span>{id}</span>
              </div>
            ))
          ) : (
            <div className="empty-block">下部ポートから再生設定へ接続できます</div>
          )}
        </Section>
        <button className="text-button danger" onClick={onRemove}>
          <Icon name="trash" size={14} />
          グラフから取り除く
        </button>
      </div>
    </aside>
  )
}
