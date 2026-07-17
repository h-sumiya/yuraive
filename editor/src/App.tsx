import { lazy, Suspense } from 'react'
import './App.css'
import { Preview } from './Preview'
import { LayoutEditor, LayoutInspector } from './LayoutEditor'
import ScriptInspector from './ScriptInspector'
import { Icon } from './components/Icon'
import {
  ContentInspectionModal,
  AssetPreview,
  BundleExportNotice,
} from './components/ContentDialogs'
import { GraphCanvas } from './components/GraphCanvas'
import { Inspector } from './components/Inspector'
import { GraphLayoutInspector, PlayerControlInspector } from './components/PlayerControlInspector'
import { FileTree, InlineNameInput, Welcome } from './components/Workspace'
import { BUNDLE_NOTICE_HIDDEN_KEY, TAB_DRAG_TYPE } from './editor/workspace'
import { useEditorWorkspace } from './useEditorWorkspace'

const ScriptEditor = lazy(() =>
  import('./ScriptEditor').then((module) => ({ default: module.ScriptEditor })),
)

function App() {
  const {
    folderInput,
    treeInlineCommit,
    active,
    activeScript,
    activeLayout,
    probabilityMode,
    docAssets,
    docScripts,
    docLayouts,
    issues,
    statsSessions,
    notify,
    openGraphTab,
    openScriptTab,
    openLayoutTab,
    activateTab,
    closeTab,
    reorderTab,
    reloadDirectory,
    requestOpenDirectory,
    openFallback,
    updateGraph,
    updateNode,
    setSelectedNodeStart,
    setSelectedNodeTerminal,
    renameNode,
    deleteNodeById,
    deleteNode,
    updateSelectedButton,
    renameButton,
    deleteButtonById,
    attachButton,
    detachButton,
    updateSelectedPlayerControl,
    renamePlayerControl,
    deletePlayerControlById,
    attachPlayerControl,
    attachLayout,
    disconnectEdge,
    changeEdgeWeight,
    insertNodeOnEdge,
    addNode,
    addScriptNode,
    addButton,
    addLayout,
    removeLayoutNode,
    addPlayerControl,
    addNodeAtGraphCenter,
    addButtonAtGraphCenter,
    addLayoutAtGraphCenter,
    addScriptNodeAtGraphCenter,
    addPlayerControlAtGraphCenter,
    bindAssetToNode,
    dropAssetOnGraph,
    appendFolderToNode,
    dropFolderOnGraph,
    importDroppedHandles,
    newDocument,
    duplicateDocument,
    deleteDocument,
    saveScript,
    saveLayout,
    moveScript,
    moveLayout,
    beginTreeCreate,
    beginTreeRename,
    commitTreeInlineEdit,
    deleteWorkspaceTarget,
    save,
    saveCurrent,
    updateScriptContent,
    updateLayoutContent,
    testScript,
    beginResize,
    exportJson,
    exportBundle,
    root,
    rootName,
    documents,
    scripts,
    layouts,
    folders,
    assets,
    openTabs,
    activeTab,
    draggedTab,
    setDraggedTab,
    tabDropTarget,
    setTabDropTarget,
    treeExpansionCommand,
    setTreeExpansionCommand,
    selectedNode,
    setSelectedNode,
    selectedButton,
    setSelectedButton,
    selectedPlayerControl,
    setSelectedPlayerControl,
    selectedGraphLayout,
    setSelectedGraphLayout,
    busy,
    toast,
    weightDisplayMode,
    setWeightDisplayMode,
    view,
    setView,
    showPreview,
    setShowPreview,
    previewAsset,
    setPreviewAsset,
    inspectionTarget,
    setInspectionTarget,
    showProblems,
    setShowProblems,
    showFileMenu,
    setShowFileMenu,
    showBundleNotice,
    setShowBundleNotice,
    tabMenu,
    setTabMenu,
    treeMenu,
    setTreeMenu,
    treeInlineEdit,
    setTreeInlineEdit,
    scriptTests,
    previewHistories,
    setPreviewHistories,
    leftWidth,
    rightWidth,
  } = useEditorWorkspace()

  if (!rootName) {
    return (
      <Welcome
        busy={busy}
        onOpen={requestOpenDirectory}
        onFallback={(files) => void openFallback(files)}
      />
    )
  }

  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        const promises = Array.from(event.dataTransfer.items).map(
          (item) =>
            (
              item as DataTransferItem & {
                getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
              }
            ).getAsFileSystemHandle?.() ?? Promise.resolve(null),
        )
        void importDroppedHandles(promises)
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <img className="brand-logo" src="/favicon.svg" alt="" />
          <strong>Yuraive</strong>
          <span>Editor</span>
        </div>
        <nav>
          <div className="menu-anchor">
            <button
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setShowFileMenu(!showFileMenu)}
            >
              ファイル
            </button>
            {showFileMenu && (
              <div className="app-menu" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  disabled={!activeTab}
                  onClick={() => {
                    void saveCurrent()
                    setShowFileMenu(false)
                  }}
                >
                  <Icon name="save" size={13} />
                  <span>保存</span>
                  <kbd>Ctrl+S</kbd>
                </button>
                <div className="menu-separator" />
                <button
                  onClick={() => {
                    setShowFileMenu(false)
                    requestOpenDirectory()
                  }}
                >
                  <Icon name="folder" size={13} />
                  <span>新しいフォルダを開く</span>
                </button>
              </div>
            )}
          </div>
        </nav>
        <div className="title-actions">
          <span className="workspace-name">
            <Icon name="folder" size={13} />
            {rootName}
          </span>
          <button
            className="toolbar-button"
            disabled={!activeTab}
            onClick={() => void saveCurrent()}
          >
            <Icon name="save" size={14} />
            保存
          </button>
          <button
            className="primary-button compact"
            disabled={!active}
            onClick={() => setShowPreview(true)}
          >
            <Icon name="play" size={13} />
            プレビュー
          </button>
        </div>
      </header>
      <div
        className="workspace"
        style={{ gridTemplateColumns: `${leftWidth}px 4px minmax(360px, 1fr) 4px ${rightWidth}px` }}
      >
        <Suspense fallback={<div className="workspace-loading">エディタを読み込み中…</div>}>
          <aside className="explorer">
            <div className="panel-title">
              <span>ファイル</span>
              <div>
                <button
                  className="icon-button"
                  data-testid="tree-reload"
                  title="ファイルツリーを再読み込み"
                  disabled={!root || busy}
                  onClick={() => void reloadDirectory()}
                >
                  <Icon name="refresh" size={13} />
                </button>
                <button
                  className="icon-button"
                  data-testid="tree-expand-all"
                  title="すべて展開"
                  onClick={() =>
                    setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: true }))
                  }
                >
                  <Icon name="expandAll" size={13} />
                </button>
                <button
                  className="icon-button"
                  data-testid="tree-collapse-all"
                  title="すべて折りたたむ"
                  onClick={() =>
                    setTreeExpansionCommand((command) => ({ id: command.id + 1, expanded: false }))
                  }
                >
                  <Icon name="collapseAll" size={13} />
                </button>
                <button className="icon-button" title="新規グラフ" onClick={newDocument}>
                  <Icon name="plus" size={14} />
                </button>
                <button
                  className="icon-button"
                  title="新しいフォルダを開く"
                  onClick={requestOpenDirectory}
                >
                  <Icon name="folder" size={14} />
                </button>
              </div>
            </div>
            <div className="explorer-scroll">
              <FileTree
                documents={documents}
                scripts={scripts}
                layouts={layouts}
                folders={folders}
                assets={assets}
                activeTab={activeTab}
                inlineEdit={treeInlineEdit}
                expansionCommand={treeExpansionCommand}
                getAssetPath={(asset) =>
                  docAssets.find((item) => item.file === asset.file)?.path ?? asset.path
                }
                getLayoutPath={(layout) =>
                  docLayouts.find((item) => item.uid === layout.uid)?.path ?? layout.path
                }
                getFolderPath={(path) => {
                  const parent = active?.path.includes('/')
                    ? active.path.slice(0, active.path.lastIndexOf('/') + 1)
                    : ''
                  return parent && path.startsWith(parent) ? path.slice(parent.length) : path
                }}
                onOpenGraph={openGraphTab}
                onOpenScript={openScriptTab}
                onOpenLayout={openLayoutTab}
                onPreview={setPreviewAsset}
                onContextMenu={(target, event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTreeMenu({
                    target,
                    x: Math.min(event.clientX, window.innerWidth - 250),
                    y: Math.min(event.clientY, window.innerHeight - 210),
                  })
                }}
                onInlineChange={(name) =>
                  setTreeInlineEdit((edit) => (edit ? { ...edit, name } : edit))
                }
                onInlineCommit={commitTreeInlineEdit}
                onInlineCancel={() => {
                  treeInlineCommit.current = null
                  setTreeInlineEdit(null)
                }}
                onMoveScript={moveScript}
                onMoveLayout={moveLayout}
              />
            </div>
            <button
              className="add-file"
              onClick={(event) =>
                setTreeMenu({
                  target: { kind: 'root', path: '' },
                  x: event.clientX,
                  y: event.clientY - 120,
                })
              }
            >
              <Icon name="plus" size={13} />
              新規作成
            </button>
          </aside>
          <div
            className="resize-handle left"
            title="ファイルペインの幅を変更"
            onPointerDown={(event) => beginResize('left', event)}
          />
          <main className="editor-area">
            <div
              className="tabs"
              data-testid="editor-tabs"
              onDragOver={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.dataTransfer.types.includes(TAB_DRAG_TYPE)
                ) {
                  event.preventDefault()
                  setTabDropTarget(null)
                }
              }}
              onDrop={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.dataTransfer.types.includes(TAB_DRAG_TYPE)
                ) {
                  event.preventDefault()
                  reorderTab(event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '')
                }
              }}
            >
              {openTabs.flatMap((tab) => {
                const item =
                  tab.kind === 'graph'
                    ? documents.find((document) => document.uid === tab.uid)
                    : tab.kind === 'script'
                      ? scripts.find((script) => script.uid === tab.uid)
                      : layouts.find((layout) => layout.uid === tab.uid)
                if (!item) return []
                const key = `${tab.kind}:${tab.uid}`
                const renaming =
                  treeInlineEdit?.source === 'tab' &&
                  treeInlineEdit.mode === 'rename' &&
                  treeInlineEdit.target?.uid === tab.uid
                const dropSide = tabDropTarget?.key === key ? tabDropTarget.side : null
                return [
                  <div
                    className={`tab ${key === activeTab ? 'active' : ''} ${tab.kind} ${renaming ? 'renaming' : ''} ${draggedTab === key ? 'dragging' : ''} ${dropSide ? `drop-${dropSide}` : ''}`}
                    key={key}
                    data-tab-key={key}
                    draggable={!renaming}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TAB_DRAG_TYPE, key)
                      event.dataTransfer.setData('text/plain', item.name)
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggedTab(key)
                    }}
                    onDragEnd={() => {
                      setDraggedTab(null)
                      setTabDropTarget(null)
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE) || draggedTab === key)
                        return
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = 'move'
                      const rect = event.currentTarget.getBoundingClientRect()
                      setTabDropTarget({
                        key,
                        side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
                      })
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                        tabDropTarget?.key === key
                      )
                        setTabDropTarget(null)
                    }}
                    onDrop={(event) => {
                      if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
                      event.preventDefault()
                      event.stopPropagation()
                      reorderTab(
                        event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '',
                        key,
                        tabDropTarget?.key === key ? tabDropTarget.side : 'before',
                      )
                    }}
                    onClick={() => {
                      if (!renaming) activateTab(tab)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      if (!renaming)
                        setTabMenu({
                          kind: tab.kind,
                          uid: tab.uid,
                          x: Math.min(event.clientX, window.innerWidth - 260),
                          y: Math.min(event.clientY, window.innerHeight - 180),
                        })
                    }}
                  >
                    <Icon
                      name={
                        tab.kind === 'script' ? 'script' : tab.kind === 'layout' ? 'fit' : 'code'
                      }
                      size={13}
                    />
                    {renaming && treeInlineEdit ? (
                      <InlineNameInput
                        edit={treeInlineEdit}
                        testId="tab-rename-input"
                        onChange={(name) =>
                          setTreeInlineEdit((edit) => (edit ? { ...edit, name } : edit))
                        }
                        onCommit={commitTreeInlineEdit}
                        onCancel={() => {
                          treeInlineCommit.current = null
                          setTreeInlineEdit(null)
                        }}
                      />
                    ) : (
                      <>
                        <span>{item.name}</span>
                        {item.dirty && <i />}
                        <button
                          draggable={false}
                          aria-label={`${item.name}を閉じる`}
                          title="閉じる（ファイルは削除しません）"
                          onDragStart={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            closeTab(tab)
                          }}
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </>
                    )}
                  </div>,
                ]
              })}
              <button
                className={`new-tab ${draggedTab && !tabDropTarget ? 'drop-end' : ''}`}
                title="新規グラフ"
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(TAB_DRAG_TYPE)) {
                    event.preventDefault()
                    event.stopPropagation()
                    setTabDropTarget(null)
                  }
                }}
                onDrop={(event) => {
                  if (event.dataTransfer.types.includes(TAB_DRAG_TYPE)) {
                    event.preventDefault()
                    event.stopPropagation()
                    reorderTab(event.dataTransfer.getData(TAB_DRAG_TYPE) || draggedTab || '')
                  }
                }}
                onClick={newDocument}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
            {activeScript ? (
              <ScriptEditor
                key={activeScript.uid}
                script={activeScript}
                test={scriptTests[activeScript.uid] ?? { status: 'idle' }}
                statsSessions={statsSessions}
                onChange={(content) => updateScriptContent(activeScript, content)}
                onSave={() => void saveScript(activeScript)}
                onTest={(functionName, sessionRunId) =>
                  void testScript(activeScript, functionName, sessionRunId)
                }
              />
            ) : activeLayout ? (
              <LayoutEditor
                key={activeLayout.uid}
                layout={activeLayout}
                onChange={(content) => updateLayoutContent(activeLayout, content)}
                onSave={() => void saveLayout(activeLayout)}
              />
            ) : active && activeTab?.startsWith('graph:') ? (
              <>
                <div className="graph-toolbar">
                  <div>
                    <button className="tool-button" onClick={addNodeAtGraphCenter}>
                      <Icon name="plus" size={14} />
                      メディアNode
                    </button>
                    <button className="tool-button" onClick={addButtonAtGraphCenter}>
                      <span className="button-glyph">B</span>ボタン
                    </button>
                    <button
                      className="tool-button layout-tool"
                      data-testid="add-layout-node"
                      onClick={addLayoutAtGraphCenter}
                    >
                      <Icon name="fit" size={14} />
                      レイアウト
                    </button>
                    <button
                      className="tool-button script-tool"
                      onClick={addScriptNodeAtGraphCenter}
                    >
                      <Icon name="script" size={14} />
                      Script Node
                    </button>
                    <button
                      className="tool-button control-tool"
                      onClick={addPlayerControlAtGraphCenter}
                    >
                      <Icon name="controls" size={14} />
                      再生設定
                    </button>
                    <span className="toolbar-separator" />
                    <button
                      className={`segmented ${weightDisplayMode === 'weight' ? 'active' : ''}`}
                      onClick={() => setWeightDisplayMode('weight')}
                    >
                      重み
                    </button>
                    <button
                      className={`segmented ${weightDisplayMode === 'probability' ? 'active' : ''}`}
                      onClick={() => setWeightDisplayMode('probability')}
                    >
                      確率
                    </button>
                    <button
                      className={`segmented ${weightDisplayMode === 'hidden' ? 'active' : ''}`}
                      onClick={() => setWeightDisplayMode('hidden')}
                    >
                      非表示
                    </button>
                  </div>
                  <div>
                    <button
                      className="zoom-button"
                      onClick={() => setView({ ...view, zoom: Math.max(0.5, view.zoom - 0.1) })}
                    >
                      −
                    </button>
                    <button
                      className="zoom-value"
                      onClick={() => setView({ zoom: 1, x: 80, y: 65 })}
                    >
                      {Math.round(view.zoom * 100)}%
                    </button>
                    <button
                      className="zoom-button"
                      onClick={() => setView({ ...view, zoom: Math.min(1.6, view.zoom + 0.1) })}
                    >
                      ＋
                    </button>
                    <span className="toolbar-separator" />
                    <button
                      className="tool-button icon-only"
                      title="JSONをエクスポート"
                      onClick={exportJson}
                    >
                      <Icon name="code" size={14} />
                    </button>
                  </div>
                </div>
                <GraphCanvas
                  graph={active.graph}
                  layouts={docLayouts}
                  selectedNode={selectedNode}
                  selectedButton={selectedButton}
                  selectedPlayerControl={selectedPlayerControl}
                  selectedLayout={selectedGraphLayout}
                  probabilityMode={probabilityMode}
                  showWeights={weightDisplayMode !== 'hidden'}
                  view={view}
                  onView={setView}
                  onSelectNode={(id) => {
                    setSelectedNode(id)
                    setSelectedButton(null)
                    setSelectedPlayerControl(null)
                    setSelectedGraphLayout(null)
                  }}
                  onSelectButton={(id) => {
                    setSelectedButton(id)
                    setSelectedNode(null)
                    setSelectedPlayerControl(null)
                    setSelectedGraphLayout(null)
                  }}
                  onSelectPlayerControl={(id) => {
                    setSelectedPlayerControl(id)
                    setSelectedNode(null)
                    setSelectedButton(null)
                    setSelectedGraphLayout(null)
                  }}
                  onSelectLayout={(path) => {
                    setSelectedGraphLayout(path)
                    setSelectedNode(null)
                    setSelectedButton(null)
                    setSelectedPlayerControl(null)
                  }}
                  onMoveNode={(id, x, y) => {
                    const node = active.graph.nodes[id]
                    updateGraph({
                      ...active.graph,
                      nodes: {
                        ...active.graph.nodes,
                        [id]: {
                          ...node,
                          editor: { ...node.editor, x: Math.round(x), y: Math.round(y) },
                        },
                      },
                    })
                  }}
                  onMoveButton={(id, x, y) => {
                    const button = active.graph.buttons[id]
                    updateGraph({
                      ...active.graph,
                      buttons: {
                        ...active.graph.buttons,
                        [id]: {
                          ...button,
                          editor: { ...button.editor, x: Math.round(x), y: Math.round(y) },
                        },
                      },
                    })
                  }}
                  onMovePlayerControl={(id, x, y) => {
                    const control = active.graph.playerControls[id]
                    updateGraph({
                      ...active.graph,
                      playerControls: {
                        ...active.graph.playerControls,
                        [id]: {
                          ...control,
                          editor: { ...control.editor, x: Math.round(x), y: Math.round(y) },
                        },
                      },
                    })
                  }}
                  onMoveLayout={(path, x, y) => {
                    const placement = active.graph.editor?.layouts?.[path]
                    if (placement)
                      updateGraph({
                        ...active.graph,
                        editor: {
                          ...active.graph.editor,
                          layouts: {
                            ...active.graph.editor?.layouts,
                            [path]: { ...placement, x: Math.round(x), y: Math.round(y) },
                          },
                        },
                      })
                  }}
                  onAddNode={addNode}
                  onAddScriptNode={addScriptNode}
                  onAddButton={(x, y) => addButton(x, y)}
                  onAddLayout={addLayout}
                  onAddPlayerControl={addPlayerControl}
                  onConnectNode={(from, to) => {
                    const source = active.graph.nodes[from]
                    if (!source || source.terminal) return
                    if ((source.onEnd ?? []).some((transition) => transition.to === to)) {
                      notify('このノード間は既に接続されています')
                      return
                    }
                    updateGraph({
                      ...active.graph,
                      nodes: {
                        ...active.graph.nodes,
                        [from]: { ...source, onEnd: [...(source.onEnd ?? []), { to, weight: 1 }] },
                      },
                    })
                  }}
                  onConnectButton={(buttonId, to) => {
                    const button = active.graph.buttons[buttonId]
                    if (!button) return
                    if ((button.onPress ?? []).some((transition) => transition.to === to)) {
                      notify('このボタンから既に接続されています')
                      return
                    }
                    updateGraph({
                      ...active.graph,
                      buttons: {
                        ...active.graph.buttons,
                        [buttonId]: {
                          ...button,
                          onPress: [...(button.onPress ?? []), { to, weight: 1 }],
                        },
                      },
                    })
                  }}
                  onAttachButton={attachButton}
                  onAttachPlayerControl={attachPlayerControl}
                  onAttachLayout={attachLayout}
                  onAssetDrop={dropAssetOnGraph}
                  onFolderDrop={dropFolderOnGraph}
                  onLayoutDrop={(path, x, y) => addLayout(x - 82, y - 25, path)}
                  onExternalDrop={(promises, x, y) =>
                    void importDroppedHandles(promises, { forceNew: true, x, y })
                  }
                  onWeightChange={changeEdgeWeight}
                  onDisconnect={disconnectEdge}
                  onInsertNode={insertNodeOnEdge}
                  onDeleteNode={deleteNodeById}
                  onDeleteButton={deleteButtonById}
                  onDeleteLayout={removeLayoutNode}
                  onDeletePlayerControl={deletePlayerControlById}
                  onOpenLayout={(path) => {
                    const layout = layouts.find(
                      (item) =>
                        docLayouts.find((relative) => relative.path === path)?.uid === item.uid,
                    )
                    if (layout) openLayoutTab(layout)
                    else notify(`レイアウトが見つかりません: ${path}`)
                  }}
                  onSave={() => void save()}
                />
              </>
            ) : (
              <div className="no-document">
                <Icon name="code" size={42} />
                <strong>開いているタブがありません</strong>
                <span>ファイルツリーからグラフまたはスクリプトを開いてください</span>
                <button className="primary-button" onClick={newDocument}>
                  <Icon name="plus" size={14} />
                  新規グラフ
                </button>
              </div>
            )}
          </main>
          <div
            className="resize-handle right"
            title="インスペクターの幅を変更"
            onPointerDown={(event) => beginResize('right', event)}
          />
          {activeScript ? (
            <ScriptInspector
              script={activeScript}
              test={scriptTests[activeScript.uid] ?? { status: 'idle' }}
              assets={docAssets}
            />
          ) : activeLayout ? (
            <LayoutInspector layout={activeLayout} />
          ) : active && activeTab?.startsWith('graph:') ? (
            selectedGraphLayout && active.graph.editor?.layouts?.[selectedGraphLayout] ? (
              <GraphLayoutInspector
                path={selectedGraphLayout}
                placement={active.graph.editor.layouts[selectedGraphLayout]}
                layout={docLayouts.find((layout) => layout.path === selectedGraphLayout)}
                connectedControls={Object.entries(active.graph.playerControls)
                  .filter(([, control]) => control.layout === selectedGraphLayout)
                  .map(([id]) => id)}
                onChange={(placement) =>
                  updateGraph({
                    ...active.graph,
                    editor: {
                      ...active.graph.editor,
                      layouts: {
                        ...active.graph.editor?.layouts,
                        [selectedGraphLayout]: placement,
                      },
                    },
                  })
                }
                onOpen={() => {
                  const relative = docLayouts.find((layout) => layout.path === selectedGraphLayout)
                  const original = relative && layouts.find((layout) => layout.uid === relative.uid)
                  if (original) openLayoutTab(original)
                }}
                onRemove={() => removeLayoutNode(selectedGraphLayout)}
              />
            ) : selectedPlayerControl && active.graph.playerControls[selectedPlayerControl] ? (
              <PlayerControlInspector
                controlId={selectedPlayerControl}
                control={active.graph.playerControls[selectedPlayerControl]}
                layouts={docLayouts}
                issues={issues.filter((issue) => issue.playerControlId === selectedPlayerControl)}
                global={active.graph.globalPlayerControl === selectedPlayerControl}
                usedBy={Object.entries(active.graph.nodes)
                  .filter(([, node]) => node.playerControl === selectedPlayerControl)
                  .map(([id, node]) => node.editor?.label || id)}
                onChange={updateSelectedPlayerControl}
                onRename={renamePlayerControl}
                onGlobal={(enabled) =>
                  updateGraph({
                    ...active.graph,
                    globalPlayerControl: enabled
                      ? selectedPlayerControl
                      : active.graph.globalPlayerControl === selectedPlayerControl
                        ? undefined
                        : active.graph.globalPlayerControl,
                  })
                }
                onDelete={() => deletePlayerControlById(selectedPlayerControl)}
                onOpenLayout={(layout) => {
                  const original = layouts.find((item) => item.uid === layout.uid)
                  if (original) openLayoutTab(original)
                }}
              />
            ) : (
              <Inspector
                nodeId={selectedNode}
                buttonId={selectedButton}
                graph={active.graph}
                graphName={active.name}
                assets={docAssets}
                scripts={docScripts}
                probabilityMode={probabilityMode}
                issues={issues}
                onChangeGraph={updateGraph}
                onChange={updateNode}
                onChangeButton={updateSelectedButton}
                onSetStart={setSelectedNodeStart}
                onSetTerminal={setSelectedNodeTerminal}
                onRename={renameNode}
                onRenameButton={renameButton}
                onDelete={deleteNode}
                onDeleteButton={() => selectedButton && deleteButtonById(selectedButton)}
                onPick={(id) => {
                  setSelectedNode(id)
                  setSelectedButton(null)
                  setSelectedPlayerControl(null)
                  setSelectedGraphLayout(null)
                }}
                onPickButton={(id) => {
                  setSelectedButton(id)
                  setSelectedNode(null)
                  setSelectedPlayerControl(null)
                  setSelectedGraphLayout(null)
                }}
                onAddButton={(nodeId) => {
                  const node = active.graph.nodes[nodeId]
                  addButton((node.editor?.x ?? 0) + 17, (node.editor?.y ?? 0) + 110, nodeId)
                }}
                onDetachButton={detachButton}
                onAssetDrop={(path) => selectedNode && bindAssetToNode(selectedNode, path)}
                onFolderDrop={(path) => selectedNode && appendFolderToNode(selectedNode, path)}
                onOpenScript={openScriptTab}
                onExportBundle={() => void exportBundle()}
              />
            )
          ) : (
            <aside className="inspector">
              <div className="panel-title">
                <span>インスペクター</span>
              </div>
              <div className="blank-panel">
                <Icon name="target" size={30} />
              </div>
            </aside>
          )}
        </Suspense>
      </div>
      <footer className="statusbar">
        <button
          className={issues.some((issue) => issue.severity === 'error') ? 'has-error' : ''}
          onClick={() => setShowProblems(!showProblems)}
        >
          {issues.length ? <Icon name="warning" size={12} /> : <Icon name="check" size={12} />}{' '}
          {issues.filter((issue) => issue.severity === 'error').length} エラー　
          {issues.filter((issue) => issue.severity === 'warning').length} 警告
        </button>
        <div>
          <span>Yuraive v1</span>
          <span>
            {active
              ? `${Object.keys(active.graph.nodes).length} Node · ${Object.keys(active.graph.buttons).length} Button · ${Object.keys(active.graph.playerControls).length} Controls`
              : 'グラフなし'}
          </span>
          <span>
            {scripts.length} Script · {layouts.length} Layout · {assets.length} Assets
          </span>
        </div>
      </footer>
      {showProblems && (
        <div className="problems-panel" style={{ left: leftWidth + 4, right: rightWidth + 4 }}>
          <header>
            <strong>問題</strong>
            <button className="icon-button" onClick={() => setShowProblems(false)}>
              <Icon name="close" size={13} />
            </button>
          </header>
          {issues.length ? (
            issues.map((issue, index) => (
              <button
                key={index}
                onClick={() => {
                  const script = issue.scriptPath
                    ? docScripts.find((item) => item.path === issue.scriptPath)
                    : undefined
                  const layout = issue.layoutPath
                    ? docLayouts.find((item) => item.path === issue.layoutPath)
                    : undefined
                  if (script) openScriptTab(script)
                  else if (layout) {
                    const original = layouts.find((item) => item.uid === layout.uid)
                    if (original) openLayoutTab(original)
                  } else {
                    if (active) openGraphTab(active)
                    if (issue.nodeId) {
                      setSelectedNode(issue.nodeId)
                      setSelectedButton(null)
                      setSelectedPlayerControl(null)
                    } else if (issue.buttonId) {
                      setSelectedButton(issue.buttonId)
                      setSelectedNode(null)
                      setSelectedPlayerControl(null)
                    } else if (issue.playerControlId) {
                      setSelectedPlayerControl(issue.playerControlId)
                      setSelectedNode(null)
                      setSelectedButton(null)
                    }
                  }
                  setShowProblems(false)
                }}
              >
                <Icon name="warning" size={13} />
                <span>{issue.message}</span>
                <small>
                  {issue.scriptPath ??
                    issue.layoutPath ??
                    issue.nodeId ??
                    issue.buttonId ??
                    issue.playerControlId ??
                    'グラフ'}
                </small>
              </button>
            ))
          ) : (
            <div className="problems-empty">
              <Icon name="check" size={15} />
              問題は見つかりませんでした
            </div>
          )}
        </div>
      )}
      {showPreview && active && (
        <Preview
          graph={active.graph}
          graphId={active.path}
          assets={docAssets}
          scripts={docScripts}
          layouts={docLayouts}
          initialHistory={previewHistories[active.uid] ?? []}
          onHistoryChange={(history) =>
            setPreviewHistories((current) => ({ ...current, [active.uid]: history }))
          }
          onClose={() => setShowPreview(false)}
        />
      )}
      {previewAsset && <AssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
      {inspectionTarget && (
        <ContentInspectionModal
          target={inspectionTarget}
          workspacePaths={[...documents, ...scripts, ...layouts, ...assets].map(
            (item) => item.path,
          )}
          onClose={() => setInspectionTarget(null)}
        />
      )}
      {showBundleNotice && (
        <BundleExportNotice
          onClose={(hidePermanently) => {
            if (hidePermanently) localStorage.setItem(BUNDLE_NOTICE_HIDDEN_KEY, 'true')
            setShowBundleNotice(false)
          }}
        />
      )}
      {tabMenu && (
        <div
          className="tab-context-menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              closeTab({ kind: tabMenu.kind, uid: tabMenu.uid })
              setTabMenu(null)
            }}
          >
            <Icon name="close" size={13} />
            タブを閉じる
          </button>
          {tabMenu.kind === 'graph' && (
            <button
              onClick={() => {
                const target = documents.find((document) => document.uid === tabMenu.uid)
                if (target) setInspectionTarget({ kind: 'json', document: target })
                setTabMenu(null)
              }}
            >
              <Icon name="info" size={13} />
              作品情報とアセット
            </button>
          )}
          {tabMenu.kind === 'graph' && (
            <button
              onClick={() => {
                const target = documents.find((document) => document.uid === tabMenu.uid)
                if (target) duplicateDocument(target)
                setTabMenu(null)
              }}
            >
              <Icon name="copy" size={13} />
              複製
            </button>
          )}
          <button
            onClick={() => {
              const target =
                tabMenu.kind === 'graph'
                  ? documents.find((item) => item.uid === tabMenu.uid)
                  : tabMenu.kind === 'script'
                    ? scripts.find((item) => item.uid === tabMenu.uid)
                    : layouts.find((item) => item.uid === tabMenu.uid)
              if (target)
                beginTreeRename({ kind: tabMenu.kind, uid: target.uid, path: target.path }, 'tab')
            }}
          >
            <Icon name="file" size={13} />
            名前を変更
          </button>
          <button
            className="danger"
            onClick={() => {
              if (tabMenu.kind === 'graph') {
                const target = documents.find((document) => document.uid === tabMenu.uid)
                if (target) void deleteDocument(target)
              } else if (tabMenu.kind === 'script') {
                const target = scripts.find((script) => script.uid === tabMenu.uid)
                if (target)
                  void deleteWorkspaceTarget({ kind: 'script', uid: target.uid, path: target.path })
              } else {
                const target = layouts.find((layout) => layout.uid === tabMenu.uid)
                if (target)
                  void deleteWorkspaceTarget({ kind: 'layout', uid: target.uid, path: target.path })
              }
              setTabMenu(null)
            }}
          >
            <Icon name="trash" size={13} />
            ファイルを削除
          </button>
        </div>
      )}
      {treeMenu && (
        <div
          className="tab-context-menu tree-context-menu"
          style={{ left: treeMenu.x, top: treeMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {treeMenu.target.kind === 'root' || treeMenu.target.kind === 'folder' ? (
            <>
              <label>{treeMenu.target.path || rootName}</label>
              <button onClick={() => beginTreeCreate(treeMenu.target, 'file')}>
                <Icon name="file" size={13} />
                ファイルを作成
              </button>
              <button onClick={() => beginTreeCreate(treeMenu.target, 'folder')}>
                <Icon name="folder" size={13} />
                フォルダを作成
              </button>
              <button onClick={() => beginTreeCreate(treeMenu.target, 'script')}>
                <Icon name="script" size={13} />
                Starlarkスクリプトを作成
              </button>
              <button onClick={() => beginTreeCreate(treeMenu.target, 'layout')}>
                <Icon name="fit" size={13} />
                レイアウトファイルを作成
              </button>
              {treeMenu.target.kind === 'folder' && (
                <button
                  className="danger"
                  onClick={() => {
                    void deleteWorkspaceTarget(treeMenu.target)
                    setTreeMenu(null)
                  }}
                >
                  <Icon name="trash" size={13} />
                  フォルダを削除
                </button>
              )}
            </>
          ) : (
            <>
              {(treeMenu.target.kind === 'graph' ||
                (treeMenu.target.kind === 'asset' &&
                  treeMenu.target.path.toLowerCase().endsWith('.yuraive'))) && (
                <button
                  onClick={() => {
                    if (treeMenu.target.kind === 'graph') {
                      const target = documents.find((item) => item.uid === treeMenu.target.uid)
                      if (target) setInspectionTarget({ kind: 'json', document: target })
                    } else {
                      const target = assets.find((item) => item.path === treeMenu.target.path)
                      if (target) setInspectionTarget({ kind: 'bundle', asset: target })
                    }
                    setTreeMenu(null)
                  }}
                >
                  <Icon name="info" size={13} />
                  作品情報とアセット
                </button>
              )}
              {treeMenu.target.kind === 'graph' && (
                <button
                  onClick={() => {
                    const target = documents.find((item) => item.uid === treeMenu.target.uid)
                    if (target) duplicateDocument(target)
                    setTreeMenu(null)
                  }}
                >
                  <Icon name="copy" size={13} />
                  複製
                </button>
              )}
              <button onClick={() => beginTreeRename(treeMenu.target, 'tree')}>
                <Icon name="file" size={13} />
                名前を変更
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (treeMenu.target.kind === 'graph') {
                    const target = documents.find((item) => item.uid === treeMenu.target.uid)
                    if (target) void deleteDocument(target)
                  } else void deleteWorkspaceTarget(treeMenu.target)
                  setTreeMenu(null)
                }}
              >
                <Icon name="trash" size={13} />
                削除
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={(event) => event.target.files && void openFallback(event.target.files)}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default App
