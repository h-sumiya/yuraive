import { defaultMedia } from '../graph'
import type {
  AssetEntry,
  MediaCandidate,
  ScriptDocument,
  ValidationIssue,
  YuraiveButton,
  YuraiveGraph,
  YuraiveNode,
} from '../types'
import { ASSET_DRAG_TYPE, FOLDER_DRAG_TYPE } from '../editor/workspace'
import {
  Field,
  DebouncedColorInput,
  Section,
  TransitionEditor,
  MediaEditor,
} from './InspectorControls'
import { ButtonEditor } from './ButtonInspector'
import { GraphMetadataInspector } from './MetadataInspector'
import { Icon } from './Icon'

export function Inspector({
  nodeId,
  buttonId,
  graph,
  graphName,
  assets,
  scripts,
  probabilityMode,
  issues,
  onChangeGraph,
  onChange,
  onChangeButton,
  onSetStart,
  onSetTerminal,
  onRename,
  onRenameButton,
  onDelete,
  onDeleteButton,
  onPick,
  onPickButton,
  onAddButton,
  onDetachButton,
  onAssetDrop,
  onFolderDrop,
  onOpenScript,
  onExportBundle,
}: {
  nodeId: string | null
  buttonId: string | null
  graph: YuraiveGraph
  graphName: string
  assets: AssetEntry[]
  scripts: ScriptDocument[]
  probabilityMode: boolean
  issues: ValidationIssue[]
  onChangeGraph: (graph: YuraiveGraph) => void
  onChange: (node: YuraiveNode) => void
  onChangeButton: (button: YuraiveButton) => void
  onSetStart: (enabled: boolean) => void
  onSetTerminal: (enabled: boolean) => void
  onRename: (next: string) => void
  onRenameButton: (next: string) => void
  onDelete: () => void
  onDeleteButton: () => void
  onPick: (id: string) => void
  onPickButton: (id: string) => void
  onAddButton: (nodeId: string) => void
  onDetachButton: (nodeId: string, buttonId: string) => void
  onAssetDrop: (path: string) => void
  onFolderDrop: (path: string) => void
  onOpenScript: (script: ScriptDocument) => void
  onExportBundle: () => void
}) {
  const node = nodeId ? graph.nodes[nodeId] : undefined
  const button = buttonId ? graph.buttons[buttonId] : undefined
  const nodeIds = Object.keys(graph.nodes)
  const nodeLabels = Object.fromEntries(
    Object.entries(graph.nodes).map(([id, item]) => [id, item.editor?.label || id]),
  )
  if (button && buttonId) {
    const buttonIssues = issues.filter((issue) => issue.buttonId === buttonId)
    const parents = Object.entries(graph.nodes)
      .filter(([, item]) => item.buttons?.includes(buttonId))
      .map(([id, item]) => item.editor?.label || id)
    return (
      <aside className="inspector button-only-inspector">
        <div className="panel-title">
          <span>ボタン</span>
          <button className="icon-button danger" title="ボタンを削除" onClick={onDeleteButton}>
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="inspector-scroll">
          <div className="node-identity button-identity">
            <span className="button-glyph">B</span>
            <div>
              <strong>{button.text || buttonId}</strong>
              <small>
                {parents.length ? parents.join(', ') : '未接続'} · {buttonId}
              </small>
            </div>
          </div>
          {buttonIssues.length > 0 && (
            <div className="node-issues">
              {buttonIssues.map((issue, index) => (
                <div className={issue.severity} key={index}>
                  <Icon name="warning" size={13} />
                  {issue.message}
                </div>
              ))}
            </div>
          )}
          <div className="button-only-editor">
            <ButtonEditor
              buttonId={buttonId}
              button={button}
              nodes={nodeIds}
              nodeLabels={nodeLabels}
              assets={assets}
              scripts={scripts}
              onChange={onChangeButton}
              onRename={onRenameButton}
              onRemove={onDeleteButton}
              onPick={onPick}
              onOpenScript={onOpenScript}
            />
          </div>
        </div>
      </aside>
    )
  }
  if (!node || !nodeId)
    return (
      <GraphMetadataInspector
        graph={graph}
        graphName={graphName}
        assets={assets}
        scripts={scripts}
        onChange={onChangeGraph}
        onExportBundle={onExportBundle}
      />
    )
  const updateMedia = (index: number, media: MediaCandidate) =>
    onChange({
      ...node,
      media: (node.media ?? []).map((item, itemIndex) => (itemIndex === index ? media : item)),
    })
  const nodeIssues = issues.filter((issue) => issue.nodeId === nodeId)
  if (node.type === 'script')
    return (
      <aside className="inspector script-node-inspector">
        <div className="panel-title">
          <span>Script Node</span>
          <button className="icon-button danger" title="ノードを削除" onClick={onDelete}>
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="inspector-scroll">
          <div className="node-identity script-node-identity">
            <span className="node-color" style={{ background: node.editor?.color ?? '#8d65b5' }}>
              <Icon name="script" size={13} />
            </span>
            <div>
              <strong>{node.editor?.label || nodeId}</strong>
              <small>0秒制御ノード · {nodeId}</small>
            </div>
          </div>
          {nodeIssues.length > 0 && (
            <div className="node-issues">
              {nodeIssues.map((issue, index) => (
                <div className={issue.severity} key={index}>
                  <Icon name="warning" size={13} />
                  {issue.message}
                </div>
              ))}
            </div>
          )}
          <Section title="ノード">
            <Field label="ノードID">
              <input
                key={nodeId}
                defaultValue={nodeId}
                onBlur={(event) => onRename(event.target.value.trim())}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
            </Field>
            <Field label="表示名">
              <input
                value={node.editor?.label ?? ''}
                placeholder={nodeId}
                onChange={(event) =>
                  onChange({ ...node, editor: { ...node.editor, label: event.target.value } })
                }
              />
            </Field>
            <Field label="カラー">
              <div className="color-field">
                <DebouncedColorInput
                  value={node.editor?.color ?? '#8d65b5'}
                  onCommit={(color) => onChange({ ...node, editor: { ...node.editor, color } })}
                />
                <input
                  value={node.editor?.color ?? '#8d65b5'}
                  onChange={(event) =>
                    onChange({ ...node, editor: { ...node.editor, color: event.target.value } })
                  }
                />
              </div>
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={node.start ?? false}
                onChange={(event) => onSetStart(event.target.checked)}
              />
              開始ノード
            </label>
          </Section>
          <Section title="Starlark">
            <Field label="スクリプト">
              <div className="script-reference">
                <select
                  value={node.script?.path ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      script: event.target.value
                        ? { path: event.target.value, function: node.script?.function ?? 'jump' }
                        : undefined,
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
                {node.script?.path && (
                  <button
                    className="icon-button"
                    title="スクリプトを開く"
                    onClick={() => {
                      const script = scripts.find((item) => item.path === node.script?.path)
                      if (script) onOpenScript(script)
                    }}
                  >
                    <Icon name="script" size={13} />
                  </button>
                )}
              </div>
            </Field>
            <Field label="関数">
              <input
                value={node.script?.function ?? 'jump'}
                onChange={(event) =>
                  onChange({
                    ...node,
                    script: { path: node.script?.path ?? '', function: event.target.value },
                  })
                }
              />
            </Field>
            <div className="script-node-hint">
              <Icon name="bug" size={14} />
              <span>
                戻り値は接続済みNodeのIDにしてください。エラーまたはNoneの場合は重み付き遷移へフォールバックします。
              </span>
            </div>
          </Section>
          <Section
            title="遷移可能な行き先"
            count={node.onEnd?.length ?? 0}
            action={
              <button
                className="mini-button"
                disabled={
                  !nodeIds.some(
                    (id) =>
                      id !== nodeId &&
                      !(node.onEnd ?? []).some((transition) => transition.to === id),
                  )
                }
                onClick={() => {
                  const to = nodeIds.find(
                    (id) =>
                      id !== nodeId &&
                      !(node.onEnd ?? []).some((transition) => transition.to === id),
                  )
                  if (to) onChange({ ...node, onEnd: [...(node.onEnd ?? []), { to, weight: 1 }] })
                }}
              >
                + 追加
              </button>
            }
          >
            <TransitionEditor
              transitions={node.onEnd ?? []}
              nodes={nodeIds}
              nodeLabels={nodeLabels}
              probabilityMode={probabilityMode}
              onChange={(onEnd) => onChange({ ...node, onEnd })}
              onPick={onPick}
            />
          </Section>
        </div>
      </aside>
    )
  return (
    <aside className="inspector">
      <div className="panel-title">
        <span>インスペクター</span>
        <button className="icon-button danger" title="ノードを削除" onClick={onDelete}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="inspector-scroll">
        <div className="node-identity">
          <span className="node-color" style={{ background: node.editor?.color ?? '#4676a9' }} />
          <div>
            <strong>{node.editor?.label || nodeId}</strong>
            <small>{nodeId}</small>
          </div>
        </div>
        {nodeIssues.length > 0 && (
          <div className="node-issues">
            {nodeIssues.map((issue, index) => (
              <div className={issue.severity} key={index}>
                <Icon name="warning" size={13} />
                {issue.message}
              </div>
            ))}
          </div>
        )}
        <Section title="ノード">
          <Field label="ノードID">
            <input
              key={nodeId}
              defaultValue={nodeId}
              onBlur={(event) => onRename(event.target.value.trim())}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </Field>
          <Field label="表示名">
            <input
              value={node.editor?.label ?? ''}
              placeholder={nodeId}
              onChange={(event) =>
                onChange({ ...node, editor: { ...node.editor, label: event.target.value } })
              }
            />
          </Field>
          <Field label="カラー">
            <div className="color-field">
              <DebouncedColorInput
                value={node.editor?.color ?? '#4676a9'}
                onCommit={(color) => onChange({ ...node, editor: { ...node.editor, color } })}
              />
              <input
                value={node.editor?.color ?? '#4676a9'}
                onChange={(event) =>
                  onChange({ ...node, editor: { ...node.editor, color: event.target.value } })
                }
              />
            </div>
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={node.start ?? false}
              onChange={(event) => onSetStart(event.target.checked)}
            />
            開始ノード
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={node.terminal ?? false}
              onChange={(event) => onSetTerminal(event.target.checked)}
            />
            終端ノード
          </label>
        </Section>
        <Section title="再生コントロール">
          <Field label="個別設定" hint="未指定時はグローバル設定を使用">
            <select
              aria-label="ノードの再生設定"
              value={node.playerControl ?? ''}
              onChange={(event) =>
                onChange({ ...node, playerControl: event.target.value || undefined })
              }
            >
              <option value="">グローバル（{graph.globalPlayerControl ?? '既定'}）</option>
              {Object.keys(graph.playerControls ?? {}).map((id) => (
                <option value={id} key={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <div className="empty-inline">上部ポートから設定ノードへ接続できます</div>
        </Section>
        <div
          className="asset-drop-zone"
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
              event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)
            ) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(event) => {
            const path = event.dataTransfer.getData(ASSET_DRAG_TYPE)
            const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE)
            if (path) {
              event.preventDefault()
              onAssetDrop(path)
            } else if (folder) {
              event.preventDefault()
              onFolderDrop(folder)
            }
          }}
        >
          <Section
            title="メディア"
            count={node.media?.length ?? 0}
            action={
              <button
                className="mini-button"
                onClick={() =>
                  onChange({
                    ...node,
                    media: [...(node.media ?? []), defaultMedia(node.media?.length ?? 0)],
                  })
                }
              >
                + 追加
              </button>
            }
          >
            {(node.media ?? []).map((media, index) => (
              <MediaEditor
                key={`${media.id}-${index}`}
                media={media}
                index={index}
                probabilityMode={probabilityMode}
                assets={assets}
                onChange={(next) => updateMedia(index, next)}
                onRemove={() =>
                  onChange({
                    ...node,
                    media: (node.media ?? []).filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              />
            ))}
            {!node.media?.length && (
              <div className="empty-block">このノードはメディアを再生しません</div>
            )}
          </Section>
        </div>
        {!node.terminal && (
          <Section
            title="再生終了時の遷移"
            count={node.onEnd?.length ?? 0}
            action={
              <button
                className="mini-button"
                disabled={
                  !nodeIds.some(
                    (id) =>
                      id !== nodeId &&
                      !(node.onEnd ?? []).some((transition) => transition.to === id),
                  )
                }
                onClick={() => {
                  const to = nodeIds.find(
                    (id) =>
                      id !== nodeId &&
                      !(node.onEnd ?? []).some((transition) => transition.to === id),
                  )
                  if (to) onChange({ ...node, onEnd: [...(node.onEnd ?? []), { to, weight: 1 }] })
                }}
              >
                + 追加
              </button>
            }
          >
            <TransitionEditor
              transitions={node.onEnd ?? []}
              nodes={nodeIds}
              nodeLabels={nodeLabels}
              probabilityMode={probabilityMode}
              onChange={(onEnd) => onChange({ ...node, onEnd })}
              onPick={onPick}
            />
          </Section>
        )}
        {!node.terminal && (
          <Section
            title="接続ボタン"
            count={node.buttons?.length ?? 0}
            action={
              <button className="mini-button" onClick={() => onAddButton(nodeId)}>
                + 作成
              </button>
            }
          >
            {(node.buttons ?? []).map((id) => (
              <div className="button-reference" key={id}>
                <button onClick={() => onPickButton(id)}>
                  <span className="button-glyph">B</span>
                  <span>{graph.buttons[id]?.text || id}</span>
                  <small>{id}</small>
                </button>
                <button
                  className="icon-button"
                  title="ノードから切断"
                  onClick={() => onDetachButton(nodeId, id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            {!node.buttons?.length && (
              <div className="empty-block">下部ポートからボタンへ接続できます</div>
            )}
          </Section>
        )}
      </div>
    </aside>
  )
}
