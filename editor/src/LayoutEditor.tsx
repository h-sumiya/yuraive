import { useEffect, useMemo, useRef, useState } from 'react'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { html } from '@codemirror/lang-html'
import { setDiagnostics } from '@codemirror/lint'
import { searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { LayoutFrame } from './LayoutFrame'
import { LAYOUT_CSS_PROPERTIES, LAYOUT_ELEMENTS, LAYOUT_VARIABLES, layoutSlotNames, validateLayoutSource } from './layout'
import type { LayoutDocument } from './types'

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#d8e0e8', backgroundColor: '#101419', fontSize: '13px' },
  '.cm-content': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', padding: '12px 0', caretColor: '#8bd8bd' },
  '.cm-line': { padding: '0 18px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#8bd8bd' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#244c40' },
  '.cm-activeLine': { backgroundColor: '#17231f' },
  '.cm-gutters': { backgroundColor: '#151a20', color: '#596672', border: 'none', borderRight: '1px solid #252d35' },
  '.cm-activeLineGutter': { backgroundColor: '#1d2b26', color: '#aebdca' },
  '.cm-tooltip': { border: '1px solid #303b45', backgroundColor: '#1a2027', color: '#d8e0e8' },
}, { dark: true })

export function LayoutEditor({ layout, onChange, onSave }: { layout: LayoutDocument; onChange: (content: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const initialContent = useRef(layout.content)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [showPreview, setShowPreview] = useState(true)
  const issues = useMemo(() => validateLayoutSource(layout.content), [layout.content])
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: initialContent.current,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(),
        html(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), EditorView.lineWrapping, editorTheme,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            setCursor({ line: line.number, column: head - line.from + 1 })
          }
        }),
        EditorView.domEventHandlers({ keydown: (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSaveRef.current(); return true }
          return false
        } }),
      ],
    })
    view.current = new EditorView({ state, parent: host.current })
    return () => { view.current?.destroy(); view.current = null }
  }, [layout.uid])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    editor.dispatch(setDiagnostics(editor.state, issues.map((issue) => ({ from: 0, to: Math.min(1, editor.state.doc.length), severity: issue.severity, message: issue.message }))))
  }, [issues])

  const sampleButtons = [
    { id: 'sample-primary', visible: true, targetSlot: 'actions', order: 10, zIndex: 0, text: '選択肢 A' },
    { id: 'sample-secondary', visible: true, targetSlot: 'actions', order: 20, zIndex: 0, text: '選択肢 B' },
  ]

  return <section className={`layout-editor-pane ${showPreview ? 'preview-open' : ''}`}>
    <header className="script-toolbar layout-toolbar">
      <div className="script-breadcrumb"><span>workspace</span><b>/</b><strong>{layout.path}</strong>{layout.dirty && <i>未保存</i>}</div>
      <div className="script-actions"><button className={`tool-button ${showPreview ? 'active' : ''}`} onClick={() => setShowPreview(!showPreview)}>プレビュー</button><button className="toolbar-button" disabled={!layout.dirty} onClick={onSave}>保存</button></div>
    </header>
    <div className="layout-editor-body"><div className="script-editor-host" ref={host}/>{showPreview && <div className="layout-live-preview"><header><strong>Canvas</strong><span>390 × 390</span></header><div><LayoutFrame source={layout.content} buttons={sampleButtons} className="layout-frame"/></div></div>}</div>
    <footer className={`script-status ${issues.some((issue) => issue.severity === 'error') ? 'error' : ''}`}><div><span>{issues.length ? `${issues.length}件のレイアウト診断` : 'Yuraive Layout · HTML/CSS · UTF-8'}</span></div><div><span>{layoutSlotNames(layout.content).length} slots</span><span>Ln {cursor.line}, Col {cursor.column}</span></div></footer>
  </section>
}

export function LayoutInspector({ layout }: { layout: LayoutDocument }) {
  const issues = validateLayoutSource(layout.content)
  const slots = layoutSlotNames(layout.content)
  return <aside className="inspector layout-inspector">
    <div className="panel-title"><span>レイアウト</span><small>HTML / CSS Grid</small></div>
    <div className="inspector-scroll">
      <div className="script-file-card layout-file-card"><span>▦</span><div><strong>{layout.name}</strong><small>{layout.path}</small></div></div>
      {issues.length > 0 && <div className="node-issues">{issues.map((issue, index) => <div className={issue.severity} key={index}>{issue.message}</div>)}</div>}
      <section className="script-side-section"><h3>Slots</h3>{slots.map((slot, index) => <div className="layout-slot-row" key={`${slot}-${index}`}><code>{slot || '(default)'}</code><span>{slot ? `targetSlot: "${slot}"` : 'targetSlot省略時'}</span></div>)}</section>
      <section className="script-side-section script-api"><h3>使用できる要素</h3>{LAYOUT_ELEMENTS.map((name) => <code key={name}>&lt;{name}&gt;</code>)}<span>属性: class / id / name / style / role / aria-label</span></section>
      <section className="script-side-section script-api"><h3>Canvas変数</h3>{LAYOUT_VARIABLES.map((name) => <code key={name}>var({name})</code>)}</section>
      <section className="script-side-section layout-property-list"><h3>対応CSS</h3><div>{LAYOUT_CSS_PROPERTIES.map((name) => <code key={name}>{name}</code>)}</div><p>Grid、絶対配置、calc()/min()/max()/clamp()、px/%/fr/cqw/cqhを利用できます。未対応要素・属性はプレイヤーが除去します。</p></section>
    </div>
  </aside>
}
