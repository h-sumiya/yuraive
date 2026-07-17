import { useEffect, useRef } from 'react'
import type { AssetEntry, ScriptDocument, YuraiveButton } from '../types'
import {
  Field,
  NumberInput,
  DebouncedColorInput,
  PathPicker,
  TransitionEditor,
} from './InspectorControls'
import { Icon } from './Icon'

export function ButtonEditor({
  buttonId,
  button,
  nodes,
  nodeLabels,
  assets,
  scripts,
  onChange,
  onRename,
  onRemove,
  onPick,
  onOpenScript,
}: {
  buttonId: string
  button: YuraiveButton
  nodes: string[]
  nodeLabels: Record<string, string>
  assets: AssetEntry[]
  scripts: ScriptDocument[]
  onChange: (button: YuraiveButton) => void
  onRename: (next: string) => void
  onRemove: () => void
  onPick: (id: string) => void
  onOpenScript: (script: ScriptDocument) => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const style = button.style ?? {}
  const intervals = button.visibility ?? []
  useEffect(() => {
    if (details.current) details.current.open = true
  }, [])
  return (
    <details className="item-editor" ref={details}>
      <summary>
        <span className="button-glyph">B</span>
        <span>{buttonId}</span>
        <span className="summary-meta">{button.onPress?.length ?? 0} 遷移</span>
        <button
          className="summary-delete"
          title="ボタンを削除"
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
        <Field label="ID">
          <input
            key={buttonId}
            defaultValue={buttonId}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          />
        </Field>
        <Field label="グラフカラー">
          <div className="color-field">
            <DebouncedColorInput
              value={button.editor?.color ?? '#8b6fa3'}
              onCommit={(color) => onChange({ ...button, editor: { ...button.editor, color } })}
            />
            <input
              value={button.editor?.color ?? '#8b6fa3'}
              onChange={(event) =>
                onChange({ ...button, editor: { ...button.editor, color: event.target.value } })
              }
            />
          </div>
        </Field>
        <div className="subheading">Slot配置</div>
        <Field label="対象slot" hint="空欄はデフォルトslot">
          <input
            value={button.targetSlot ?? ''}
            placeholder="default"
            onChange={(event) =>
              onChange({ ...button, targetSlot: event.target.value || undefined })
            }
          />
        </Field>
        <div className="two-col">
          <Field label="注入順 order">
            <NumberInput
              step={1}
              value={button.order ?? 0}
              onChange={(order) => onChange({ ...button, order })}
            />
          </Field>
          <Field label="重なり z-index">
            <NumberInput
              step={1}
              value={button.zIndex ?? 0}
              onChange={(zIndex) => onChange({ ...button, zIndex })}
            />
          </Field>
        </div>
        <div className="subheading">外観</div>
        <Field label="表示テキスト">
          <input
            value={button.text ?? ''}
            onChange={(event) => onChange({ ...button, text: event.target.value || undefined })}
          />
        </Field>
        <div className="two-col">
          <Field label="背景色">
            <DebouncedColorInput
              value={style.backgroundColor?.slice(0, 7) ?? '#574de5'}
              onCommit={(backgroundColor) =>
                onChange({ ...button, style: { ...style, backgroundColor } })
              }
            />
          </Field>
          <Field label="文字色">
            <DebouncedColorInput
              value={style.textColor?.slice(0, 7) ?? '#ffffff'}
              onCommit={(textColor) => onChange({ ...button, style: { ...style, textColor } })}
            />
          </Field>
        </div>
        <Field label="背景画像">
          <PathPicker
            value={style.backgroundImage ?? ''}
            assets={assets}
            kinds={['image']}
            placeholder="レイアウトCSSを使用"
            onChange={(value) =>
              onChange({ ...button, style: { ...style, backgroundImage: value || undefined } })
            }
          />
        </Field>
        <div className="three-col">
          <Field label="不透明度">
            <NumberInput
              min={0}
              max={1}
              step={0.05}
              value={style.opacity ?? 1}
              onChange={(opacity) => onChange({ ...button, style: { ...style, opacity } })}
            />
          </Field>
          <Field label="枠線幅">
            <NumberInput
              min={0}
              step={1}
              value={style.borderWidth ?? 0}
              onChange={(borderWidth) => onChange({ ...button, style: { ...style, borderWidth } })}
            />
          </Field>
          <Field label="角丸">
            <NumberInput
              min={0}
              step={1}
              value={style.borderRadius ?? 0}
              onChange={(borderRadius) =>
                onChange({ ...button, style: { ...style, borderRadius } })
              }
            />
          </Field>
        </div>
        <div className="two-col">
          <Field label="文字サイズ">
            <NumberInput
              min={1}
              step={1}
              value={style.fontSize ?? 16}
              onChange={(fontSize) => onChange({ ...button, style: { ...style, fontSize } })}
            />
          </Field>
          <Field label="文字ウェイト">
            <NumberInput
              min={1}
              max={1000}
              step={100}
              value={style.fontWeight ?? 600}
              onChange={(fontWeight) => onChange({ ...button, style: { ...style, fontWeight } })}
            />
          </Field>
        </div>
        <div className="two-col">
          <Field label="横padding">
            <NumberInput
              min={0}
              step={1}
              value={style.paddingHorizontal ?? 0}
              onChange={(paddingHorizontal) =>
                onChange({ ...button, style: { ...style, paddingHorizontal } })
              }
            />
          </Field>
          <Field label="縦padding">
            <NumberInput
              min={0}
              step={1}
              value={style.paddingVertical ?? 0}
              onChange={(paddingVertical) =>
                onChange({ ...button, style: { ...style, paddingVertical } })
              }
            />
          </Field>
        </div>
        <div className="subheading">動的表示（Starlark）</div>
        <Field label="表示スクリプト">
          <div className="script-reference">
            <select
              value={button.render?.path ?? ''}
              onChange={(event) =>
                onChange({
                  ...button,
                  render: event.target.value
                    ? { path: event.target.value, function: button.render?.function ?? 'render' }
                    : undefined,
                })
              }
            >
              <option value="">使用しない</option>
              {scripts.map((script) => (
                <option value={script.path} key={script.uid}>
                  {script.path}
                </option>
              ))}
            </select>
            {button.render?.path && (
              <button
                className="icon-button"
                title="スクリプトを開く"
                onClick={() => {
                  const script = scripts.find((item) => item.path === button.render?.path)
                  if (script) onOpenScript(script)
                }}
              >
                <Icon name="script" size={13} />
              </button>
            )}
          </div>
        </Field>
        {button.render && (
          <Field label="関数">
            <input
              value={button.render.function ?? 'render'}
              onChange={(event) =>
                onChange({ ...button, render: { ...button.render!, function: event.target.value } })
              }
            />
          </Field>
        )}
        <div className="subheading row-between">
          <span>表示タイミング</span>
          <button
            className="mini-button"
            onClick={() =>
              onChange({ ...button, visibility: [...intervals, { fromMs: 0, toMs: null }] })
            }
          >
            + 区間
          </button>
        </div>
        {intervals.length === 0 && <div className="empty-inline">常に表示</div>}
        {intervals.map((interval, intervalIndex) => (
          <div className="interval-row" key={intervalIndex}>
            <NumberInput
              min={0}
              value={interval.fromMs}
              onChange={(fromMs) =>
                onChange({
                  ...button,
                  visibility: intervals.map((item, i) =>
                    i === intervalIndex ? { ...item, fromMs } : item,
                  ),
                })
              }
            />
            <span>〜</span>
            <input
              type="number"
              min="0"
              value={interval.toMs ?? ''}
              placeholder="終了まで"
              onChange={(event) =>
                onChange({
                  ...button,
                  visibility: intervals.map((item, i) =>
                    i === intervalIndex
                      ? {
                          ...item,
                          toMs: event.target.value === '' ? null : Number(event.target.value),
                        }
                      : item,
                  ),
                })
              }
            />
            <button
              className="icon-button"
              onClick={() =>
                onChange({ ...button, visibility: intervals.filter((_, i) => i !== intervalIndex) })
              }
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <div className="subheading row-between">
          <span>押下時の遷移</span>
          <button
            className="mini-button"
            disabled={
              !nodes.some(
                (id) => !(button.onPress ?? []).some((transition) => transition.to === id),
              )
            }
            onClick={() => {
              const to = nodes.find(
                (id) => !(button.onPress ?? []).some((transition) => transition.to === id),
              )
              if (to)
                onChange({ ...button, onPress: [...(button.onPress ?? []), { to, weight: 1 }] })
            }}
          >
            + 遷移
          </button>
        </div>
        <TransitionEditor
          transitions={button.onPress ?? []}
          nodes={nodes}
          nodeLabels={nodeLabels}
          probabilityMode={false}
          onChange={(onPress) => onChange({ ...button, onPress })}
          onPick={onPick}
        />
        <button className="text-button danger" onClick={onRemove}>
          <Icon name="trash" size={14} />
          このボタンを削除
        </button>
      </div>
    </details>
  )
}
