import { useEffect, useMemo, useRef, useState } from 'react'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { python } from '@codemirror/lang-python'
import { searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import type { ScriptDocument } from './types'

export type ScriptTestState = {
  status: 'idle' | 'running' | 'success' | 'error'
  functionName?: string
  result?: unknown
  prints?: string[]
  durationMs?: number
  message?: string
  line?: number
  column?: number
}

const completions = [
  {
    label: 'def',
    type: 'keyword',
    apply: 'def ${name}(ctx):\n    return None',
    detail: '関数を定義',
  },
  {
    label: 'jump',
    type: 'function',
    apply: 'def jump(ctx):\n    return "node-id"',
    detail: 'Script Node entrypoint',
  },
  {
    label: 'render',
    type: 'function',
    apply:
      'def render(ctx):\n    return {\n        "visible": True,\n        "text": "Button",\n        "style": {},\n    }',
    detail: 'Button render entrypoint',
  },
  {
    label: 'render_stats',
    type: 'function',
    apply:
      'def render_stats(ctx):\n    return {\n        "sortValue": ctx["session"]["activePlayMs"],\n        "display": {"schemaVersion": 1, "fallbackText": "Stats", "root": {"type": "text", "text": "Stats"}},\n    }',
    detail: 'Playback stats entrypoint',
  },
  { label: 'random()', type: 'function', detail: '0以上1未満の乱数' },
  { label: 'randint', type: 'function', apply: 'randint(1, 10)', detail: '両端を含む整数乱数' },
  { label: 'choice', type: 'function', apply: 'choice(["a", "b"])', detail: '配列から1件を抽選' },
  {
    label: 'shuffled',
    type: 'function',
    apply: 'shuffled([1, 2, 3])',
    detail: 'シャッフルした新しい配列',
  },
  { label: 'ctx["history"]', type: 'property', detail: '再生履歴の全件配列' },
  { label: 'ctx["currentHistory"]', type: 'property', detail: '現在の実行IDに属する確定済み履歴' },
  { label: 'ctx["current"]', type: 'property', detail: '現在のノードと再生位置' },
  {
    label: 'ctx["trigger"]',
    type: 'property',
    detail: 'start / restart / end / button / empty / render / test / debug',
  },
  { label: 'ctx["now"]', type: 'property', detail: '実行時刻 (RFC 3339)' },
  { label: 'ctx["graphId"]', type: 'property', detail: '実行中のグラフID' },
  { label: 'ctx["runId"]', type: 'property', detail: '現在の実行ID' },
  { label: 'ctx["runStartedAt"]', type: 'property', detail: '現在の実行開始時刻' },
  { label: 'ctx["historyStartedAt"]', type: 'property', detail: '履歴の先頭開始時刻' },
  { label: 'ctx["historyEndedAt"]', type: 'property', detail: '履歴の末尾終了時刻' },
  { label: 'ctx["historyCount"]', type: 'property', detail: '確定済み履歴の件数' },
  {
    label: 'ctx["historyActivePlayMs"]',
    type: 'property',
    detail: '確定済み履歴の実再生時間合計 (ms)',
  },
  {
    label: 'ctx["totalActivePlayMs"]',
    type: 'property',
    detail: '履歴と現在の実再生時間合計 (ms)',
  },
  { label: 'ctx["session"]', type: 'property', detail: '再生統計で評価中のセッション' },
  { label: 'ctx["aggregate"]', type: 'property', detail: '再生統計の作品全体集計' },
  {
    label: 'ctx["session"]["activePlayMs"]',
    type: 'property',
    detail: '対象セッションの実再生時間 (ms)',
  },
  { label: 'ctx["aggregate"]["sessionCount"]', type: 'property', detail: '保持中のセッション数' },
  { label: 'ctx["current"]["nodeId"]', type: 'property', detail: '現在のノードID' },
  { label: 'ctx["current"]["mediaId"]', type: 'property', detail: '現在のメディアID' },
  { label: 'ctx["current"]["source"]', type: 'property', detail: '現在のメディアソース' },
  { label: 'ctx["current"]["startedAt"]', type: 'property', detail: '現在の再生開始時刻' },
  { label: 'ctx["current"]["positionMs"]', type: 'property', detail: '現在の再生位置 (ms)' },
  { label: 'ctx["current"]["mediaDurationMs"]', type: 'property', detail: '現在のメディア尺 (ms)' },
  { label: 'ctx["current"]["activePlayMs"]', type: 'property', detail: '現在の実再生時間 (ms)' },
  {
    label: 'ctx["history"][0]["schemaVersion"]',
    type: 'property',
    detail: '履歴スキーマバージョン',
  },
  { label: 'ctx["history"][0]["id"]', type: 'property', detail: '履歴エントリID' },
  { label: 'ctx["history"][0]["runId"]', type: 'property', detail: '履歴の実行ID' },
  { label: 'ctx["history"][0]["graphId"]', type: 'property', detail: '履歴のグラフID' },
  { label: 'ctx["history"][0]["nodeId"]', type: 'property', detail: '履歴のノードID' },
  { label: 'ctx["history"][0]["mediaId"]', type: 'property', detail: '履歴のメディアID' },
  { label: 'ctx["history"][0]["source"]', type: 'property', detail: '履歴のメディアソース' },
  { label: 'ctx["history"][0]["startedAt"]', type: 'property', detail: '履歴の開始時刻' },
  { label: 'ctx["history"][0]["endedAt"]', type: 'property', detail: '履歴の終了時刻' },
  {
    label: 'ctx["history"][0]["mediaDurationMs"]',
    type: 'property',
    detail: '履歴のメディア尺 (ms)',
  },
  { label: 'ctx["history"][0]["activePlayMs"]', type: 'property', detail: '履歴の実再生時間 (ms)' },
  {
    label: 'ctx["history"][0]["startPositionMs"]',
    type: 'property',
    detail: '履歴の開始位置 (ms)',
  },
  { label: 'ctx["history"][0]["endPositionMs"]', type: 'property', detail: '履歴の終了位置 (ms)' },
  { label: 'ctx["history"][0]["endReason"]', type: 'property', detail: '履歴の終了理由' },
  { label: 'True', type: 'keyword' },
  { label: 'False', type: 'keyword' },
  { label: 'None', type: 'keyword' },
]

const starlarkCompletion = (context: CompletionContext) => {
  const word = context.matchBefore(/[\w[\]".]+/)
  if (!context.explicit && (!word || word.from === word.to)) return null
  return { from: word?.from ?? context.pos, options: completions }
}

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', color: '#d8e0e8', backgroundColor: '#101419', fontSize: '13px' },
    '.cm-content': {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      padding: '12px 0',
      caretColor: '#70c7ef',
    },
    '.cm-line': { padding: '0 18px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#70c7ef' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#24465c',
    },
    '.cm-panels': { backgroundColor: '#171c21', color: '#d8e0e8' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #2a333c' },
    '.cm-searchMatch': { backgroundColor: '#6b5d1e88', outline: '1px solid #9e8731' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#3c667a' },
    '.cm-activeLine': { backgroundColor: '#172029' },
    '.cm-selectionMatch': { backgroundColor: '#24485b66' },
    '.cm-gutters': {
      backgroundColor: '#151a20',
      color: '#596672',
      border: 'none',
      borderRight: '1px solid #252d35',
    },
    '.cm-activeLineGutter': { backgroundColor: '#1d2730', color: '#aebdca' },
    '.cm-foldPlaceholder': { backgroundColor: '#252e37', border: 'none', color: '#9eabb7' },
    '.cm-tooltip': { border: '1px solid #303b45', backgroundColor: '#1a2027', color: '#d8e0e8' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#24516b',
      color: '#fff',
    },
  },
  { dark: true },
)

const findFunctions = (content: string) =>
  [...content.matchAll(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm)].map((match) => match[1])

export function ScriptEditor({
  script,
  test,
  onChange,
  onSave,
  onTest,
  statsSessions = [],
}: {
  script: ScriptDocument
  test: ScriptTestState
  onChange: (content: string) => void
  onSave: () => void
  onTest: (functionName: string, sessionRunId?: string) => void
  statsSessions?: Array<{ runId: string; label: string }>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onTestRef = useRef(onTest)
  const initialContent = useRef(script.content)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const functions = useMemo(() => findFunctions(script.content), [script.content])
  const [functionName, setFunctionName] = useState(() =>
    functions.includes('jump')
      ? 'jump'
      : functions.includes('render')
        ? 'render'
        : (functions[0] ?? 'main'),
  )
  const [sessionRunId, setSessionRunId] = useState(statsSessions[0]?.runId ?? '')
  const sessionRunIdRef = useRef(sessionRunId)
  const functionNameRef = useRef(functionName)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onTestRef.current = onTest
  functionNameRef.current = functionName
  sessionRunIdRef.current = sessionRunId

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: initialContent.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        highlightActiveLine(),
        python(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [starlarkCompletion], activateOnTyping: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            setCursor({ line: line.number, column: head - line.from + 1 })
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              onSaveRef.current()
              return true
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onTestRef.current(functionNameRef.current, sessionRunIdRef.current || undefined)
              return true
            }
            return false
          },
        }),
      ],
    })
    view.current = new EditorView({ state, parent: host.current })
    return () => {
      view.current?.destroy()
      view.current = null
    }
  }, [script.uid])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const diagnostics: Diagnostic[] =
      test.status === 'error'
        ? [
            {
              from: test.line
                ? editor.state.doc.line(Math.min(test.line, editor.state.doc.lines)).from +
                  Math.max(0, (test.column ?? 1) - 1)
                : 0,
              to: test.line
                ? editor.state.doc.line(Math.min(test.line, editor.state.doc.lines)).to
                : Math.min(1, editor.state.doc.length),
              severity: 'error',
              message: test.message ?? 'Starlark error',
            },
          ]
        : []
    editor.dispatch(setDiagnostics(editor.state, diagnostics))
  }, [test])

  useEffect(() => {
    if (!functions.includes(functionName) && functions.length)
      setFunctionName(
        functions.includes('jump')
          ? 'jump'
          : functions.includes('render')
            ? 'render'
            : functions[0],
      )
  }, [functionName, functions])

  useEffect(() => {
    if (statsSessions.length && !statsSessions.some((session) => session.runId === sessionRunId))
      setSessionRunId(statsSessions[0].runId)
  }, [sessionRunId, statsSessions])

  return (
    <section className="script-editor-pane">
      <header className="script-toolbar">
        <div className="script-breadcrumb">
          <span>workspace</span>
          <b>/</b>
          <strong>{script.path}</strong>
          {script.dirty && <i>未保存</i>}
        </div>
        <div className="script-actions">
          <select
            aria-label="テストする関数"
            value={functionName}
            onChange={(event) => setFunctionName(event.target.value)}
          >
            {functions.length ? (
              functions.map((name) => (
                <option value={name} key={name}>
                  {name}()
                </option>
              ))
            ) : (
              <option value="main">main()</option>
            )}
          </select>
          {functionName === 'render_stats' && statsSessions.length > 0 && (
            <select
              aria-label="統計テスト対象セッション"
              value={sessionRunId}
              onChange={(event) => setSessionRunId(event.target.value)}
            >
              {statsSessions.map((session) => (
                <option value={session.runId} key={session.runId}>
                  {session.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="tool-button"
            disabled={test.status === 'running'}
            onClick={() => onTest(functionName, sessionRunId || undefined)}
            title="サンプルコンテキストで実行 (Ctrl+Enter)"
          >
            {test.status === 'running' ? '実行中…' : '▶ テスト実行'}
          </button>
          <button className="toolbar-button" disabled={!script.dirty} onClick={onSave}>
            保存
          </button>
        </div>
      </header>
      <div className="script-editor-host" ref={host} />
      <footer className={`script-status ${test.status}`}>
        <div>
          {test.status === 'error' ? (
            <>
              <strong>エラー</strong>
              <span>{test.message}</span>
            </>
          ) : test.status === 'success' ? (
            <>
              <strong>成功</strong>
              <span>
                {test.durationMs?.toFixed(1)}ms · {JSON.stringify(test.result)}
              </span>
            </>
          ) : (
            <span>Starlark · UTF-8 · Space: 4</span>
          )}
        </div>
        <div>
          <span>{functions.length} functions</span>
          <span>
            Ln {cursor.line}, Col {cursor.column}
          </span>
        </div>
      </footer>
    </section>
  )
}
