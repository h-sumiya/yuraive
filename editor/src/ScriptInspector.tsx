import type { ScriptTestState } from './ScriptEditor'
import type { AssetEntry, ScriptDocument } from './types'
import { PlaybackStatsPreview } from './PlaybackStatsPreview'

const findFunctions = (content: string) =>
  [...content.matchAll(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm)].map((match) => match[1])

const historyType = `PlaybackHistoryEntry = {
  "schemaVersion": 1,
  "id": string,
  "runId": string,
  "graphId": string,
  "contentId": string | None,
  "nodeId": string,
  "mediaId": string,
  "source": string | None,
  "startedAt": string,
  "endedAt": string,
  "mediaDurationMs": int,
  "activePlayMs": int,
  "startPositionMs": int,
  "endPositionMs": int,
  "endReason": "completed" | "button" | "stopped"
             | "restarted" | "error" | "interrupted",
}`

export default function ScriptInspector({
  script,
  test,
  assets = [],
}: {
  script: ScriptDocument
  test: ScriptTestState
  assets?: AssetEntry[]
}) {
  const functions = findFunctions(script.content)
  return (
    <aside className="inspector script-inspector">
      <div className="panel-title">
        <span>スクリプト</span>
        <small>Starlark</small>
      </div>
      <div className="inspector-scroll">
        <div className="script-file-card">
          <span>★</span>
          <div>
            <strong>{script.name}</strong>
            <small>{script.path}</small>
          </div>
        </div>
        <section className="script-side-section">
          <h3>アウトライン</h3>
          {functions.length ? (
            functions.map((name) => (
              <div className="outline-function" key={name}>
                <span>ƒ</span>
                <strong>{name}</strong>
                <small>(ctx)</small>
              </div>
            ))
          ) : (
            <div className="empty-inline">関数がありません</div>
          )}
        </section>
        <section className="script-side-section">
          <h3>実行結果</h3>
          {test.status === 'idle' && <div className="empty-inline">Ctrl+Enterでテスト実行</div>}
          {test.status === 'running' && (
            <div className="script-running">Workerを起動しています…</div>
          )}
          {test.status === 'error' && (
            <div className="script-test-error">
              <strong>{test.line ? `${test.line}:${test.column ?? 1}` : 'Runtime'}</strong>
              <span>{test.message}</span>
            </div>
          )}
          {test.status === 'success' && (
            <>
              <pre>{JSON.stringify(test.result, null, 2)}</pre>
              {Boolean(test.prints?.length) && (
                <div className="script-prints">
                  {test.prints?.map((line, index) => (
                    <code key={index}>{line}</code>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        {test.status === 'success' && test.functionName === 'render_stats' && (
          <PlaybackStatsPreview value={test.result} assets={assets} />
        )}
        <section className="script-side-section script-api">
          <h3>利用できるコンテキスト</h3>
          <code>ctx["history"]</code>
          <span>確定済みの PlaybackHistoryEntry 配列</span>
          <code>ctx["currentHistory"]</code>
          <span>現在の runId に属する確定済み履歴。同じ履歴要素への参照配列</span>
          <code>ctx["current"]</code>
          <span>現在または直前のMedia再生情報。未再生時は None</span>
          <code>ctx["trigger"]</code>
          <span>start / restart / end / button / empty / render / test / debug</span>
          <code>ctx["now"]</code>
          <span>実行時刻（RFC 3339）</span>
          <code>ctx["graphId"]</code>
          <span>実行中のグラフID</span>
          <code>ctx["runId"]</code>
          <span>現在の実行ID</span>
          <code>ctx["runStartedAt"]</code>
          <span>現在の実行開始時刻</span>
          <code>ctx["historyStartedAt"]</code>
          <span>履歴の先頭開始時刻。履歴なしは None</span>
          <code>ctx["historyEndedAt"]</code>
          <span>履歴の末尾終了時刻。履歴なしは None</span>
          <code>ctx["historyCount"]</code>
          <span>確定済み履歴の件数</span>
          <code>ctx["historyActivePlayMs"]</code>
          <span>確定済み履歴の実再生時間合計</span>
          <code>ctx["totalActivePlayMs"]</code>
          <span>確定履歴と未確定の現在再生の合計</span>
          <code>ctx["session"]</code>
          <span>再生統計で評価中のセッション。通常スクリプトでは未設定</span>
          <code>ctx["aggregate"]</code>
          <span>再生統計の作品全体集計。通常スクリプトでは未設定</span>
          <h3>current のフィールド</h3>
          <code>ctx["current"]["nodeId"]</code>
          <span>現在のノードID</span>
          <code>ctx["current"]["mediaId"]</code>
          <span>現在のメディアID</span>
          <code>ctx["current"]["source"]</code>
          <span>現在のメディアソース</span>
          <code>ctx["current"]["startedAt"]</code>
          <span>現在の再生開始時刻</span>
          <code>ctx["current"]["positionMs"]</code>
          <span>現在の再生位置（ms）</span>
          <code>ctx["current"]["mediaDurationMs"]</code>
          <span>現在のメディア尺（ms）</span>
          <code>ctx["current"]["activePlayMs"]</code>
          <span>現在の実再生時間（ms）</span>
          <h3>戻り値</h3>
          <code>jump(ctx) → "node-id"</code>
          <code>render(ctx) → {'{ visible, text, style }'}</code>
          <code>render_stats(ctx) → {'{ sortValue, display, share? }'}</code>
          <h3>乱数</h3>
          <code>random()</code>
          <span>0以上1未満の浮動小数点数</span>
          <code>randint(start, end)</code>
          <span>両端を含む整数</span>
          <code>choice(items)</code>
          <span>配列・タプルから1件を抽選</span>
          <code>shuffled(items)</code>
          <span>シャッフルした新しい配列</span>
          <h3>再生履歴の型</h3>
          <pre>{historyType}</pre>
        </section>
      </div>
    </aside>
  )
}
