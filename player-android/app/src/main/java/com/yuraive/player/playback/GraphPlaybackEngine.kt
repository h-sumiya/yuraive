package com.yuraive.player.playback

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.yuraive.player.YuraiveApplication
import com.yuraive.player.model.ButtonRenderResult
import com.yuraive.player.model.GraphRef
import com.yuraive.player.model.MediaCandidate
import com.yuraive.player.model.PlaybackHistoryEntry
import com.yuraive.player.model.PlaybackSnapshot
import com.yuraive.player.model.PlayerControlSettings
import com.yuraive.player.model.RenderedButton
import com.yuraive.player.model.ScriptCall
import com.yuraive.player.model.Transition
import com.yuraive.player.model.ValidationIssue
import com.yuraive.player.model.YuraiveGraph
import com.yuraive.player.model.YuraiveJson
import com.yuraive.player.model.YuraiveLayout
import com.yuraive.player.model.YuraiveNode
import com.yuraive.player.model.chooseWeighted
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal fun playbackItemId(
    runId: String,
    generation: Long,
    graphId: String,
    nodeId: String?,
    mediaId: String,
): String = "$runId:$generation:$graphId#$nodeId/$mediaId"

class GraphPlaybackEngine(
    context: Context,
    private val player: Player,
    private val scope: CoroutineScope,
) : Player.Listener {
    private val app = context.applicationContext as YuraiveApplication
    private val library = app.library
    private val historyStore = app.history
    private val snapshotStore = app.snapshots
    private val starlark = StarlarkRuntime(library)

    private var graphRef: GraphRef? = null
    private var graph: YuraiveGraph? = null
    private var history = mutableListOf<PlaybackHistoryEntry>()
    private var runId = ""
    private var runStartedAt = ""
    private var currentNodeId: String? = null
    private var currentMedia: MediaCandidate? = null
    private var currentStartedAt: String? = null
    private var currentStartPositionMs = 0L
    private var activePlayBaseMs = 0L
    private var activePlayStartedRealtime: Long? = null
    private var currentFinalized = true
    private var visualPath: String? = null
    private var visualUri: String? = null
    private var layoutSource: String? = null
    private var baseButtons = emptyList<RenderedButton>()
    private var nodeElapsedBaseMs = 0L
    private var nodeEnteredRealtime = SystemClock.elapsedRealtime()
    private var nodeClockRunning = false
    private var transitionClaimed = false
    private var generation = 0L
    private var nonFatalError: String? = null
    private var ticker: Job? = null
    private var saver: Job? = null

    init {
        player.addListener(this)
        ticker =
            scope.launch {
                while (isActive) {
                    publishProgress()
                    delay(250)
                }
            }
        saver =
            scope.launch {
                while (isActive) {
                    delay(2_000)
                    if (PlaybackRuntime.state.value.status != PlaybackStatus.COMPLETED)
                        saveSnapshot()
                }
            }
    }

    suspend fun restore(autoPlay: Boolean = false): Boolean {
        if (graph != null) return true
        val snapshot = snapshotStore.load() ?: return false
        return runCatching {
                val restoredGraph = library.readGraph(snapshot.graphRef)
                val restoreErrors =
                    library.validate(snapshot.graphRef, restoredGraph).filter {
                        it.severity == ValidationIssue.Severity.ERROR
                    }
                if (restoreErrors.isNotEmpty())
                    error(restoreErrors.joinToString("\n") { it.message })
                graphRef = snapshot.graphRef
                graph = restoredGraph
                history = historyStore.read(snapshot.graphRef.graphId).toMutableList()
                runId = snapshot.runId
                runStartedAt = snapshot.runStartedAt
                currentNodeId = snapshot.nodeId
                currentStartedAt = snapshot.startedAt
                currentStartPositionMs = snapshot.startPositionMs
                activePlayBaseMs = snapshot.activePlayMs
                visualPath = snapshot.visualPath
                visualUri =
                    snapshot.visualPath?.let { library.assetUri(snapshot.graphRef, it)?.toString() }
                nodeElapsedBaseMs = snapshot.nodeElapsedMs
                nodeEnteredRealtime = SystemClock.elapsedRealtime()
                nodeClockRunning = !snapshot.completed
                currentFinalized = snapshot.mediaId == null || snapshot.completed
                val node = restoredGraph.nodes[snapshot.nodeId] ?: error("保存されたノードが見つかりません")
                loadLayout(node)
                val media = node.media.firstOrNull { it.id == snapshot.mediaId }
                currentMedia = media
                transitionClaimed = snapshot.completed
                generation++

                if (snapshot.completed) {
                    player.clearMediaItems()
                    baseButtons = emptyList()
                    publish(PlaybackStatus.COMPLETED)
                } else {
                    if (media != null)
                        prepareMedia(
                            media,
                            snapshot.positionMs,
                            autoPlay && snapshot.wasPlaying,
                            restoring = true,
                        )
                    baseButtons = renderButtons(node)
                    publish(PlaybackStatus.READY)
                }
                true
            }
            .getOrElse {
                publishError("前回の再生状態を復元できません: ${it.message}")
                false
            }
    }

    suspend fun start(ref: GraphRef) {
        runCatching {
                if (currentMedia != null && !currentFinalized) finalizeCurrent("stopped")
                publishLoading(ref)
                val loaded = library.readGraph(ref)
                val issues = library.validate(ref, loaded)
                val errors = issues.filter { it.severity == ValidationIssue.Severity.ERROR }
                if (errors.isNotEmpty()) error(errors.joinToString("\n") { it.message })

                player.stop()
                player.clearMediaItems()
                graphRef = ref
                graph = loaded
                history = historyStore.read(ref.graphId).toMutableList()
                beginNewRun()
                val start =
                    loaded.nodes.entries.singleOrNull { it.value.start }?.key
                        ?: error("開始ノードが 1 件ではありません")
                enterNode(start, trigger("start"), mutableSetOf())
            }
            .onFailure { fail(it.message ?: "再生を開始できません") }
    }

    suspend fun restart() {
        val ref = graphRef ?: return
        if (currentMedia != null && !currentFinalized) finalizeCurrent("restarted")
        runCatching {
                player.stop()
                player.clearMediaItems()
                beginNewRun()
                val start =
                    graph?.nodes?.entries?.singleOrNull { it.value.start }?.key
                        ?: error("開始ノードがありません")
                enterNode(start, trigger("restart"), mutableSetOf())
            }
            .onFailure { fail(it.message ?: "再スタートできません") }
    }

    suspend fun next() {
        val loadedGraph = graph ?: return
        val node = loadedGraph.nodes[currentNodeId] ?: return
        if (
            !resolvedControls(node).allowNext ||
                transitionClaimed ||
                PlaybackRuntime.state.value.status == PlaybackStatus.COMPLETED
        )
            return
        transitionClaimed = true
        runCatching {
                if (currentMedia != null && !currentFinalized) finalizeCurrent("completed")
                player.stop()
                if (node.terminal) {
                    freezeNodeClock()
                    baseButtons = emptyList()
                    publish(PlaybackStatus.COMPLETED)
                    saveSnapshot(completed = true)
                } else {
                    val next =
                        chooseWeighted(node.onEnd, Transition::weight) ?: error("終了遷移を選択できません")
                    enterNode(next.to, trigger("next"), mutableSetOf())
                }
            }
            .onFailure { fail(it.message ?: "次のシーンへ進めません") }
    }

    suspend fun previous() {
        val ref = graphRef ?: return
        val node = graph?.nodes?.get(currentNodeId) ?: return
        if (!resolvedControls(node).allowPrevious) return
        val runHistory = history.filter { it.runId == runId }
        val currentEntry =
            runHistory.lastOrNull()?.takeIf {
                currentFinalized && it.nodeId == currentNodeId && it.mediaId == currentMedia?.id
            }
        val target =
            (if (currentEntry == null) runHistory else runHistory.dropLast(1)).lastOrNull()
                ?: return
        transitionClaimed = true
        runCatching {
                discardCurrent()
                player.stop()
                player.clearMediaItems()
                val removedIds = setOfNotNull(currentEntry?.id, target.id)
                historyStore.remove(ref.graphId, removedIds)
                history = history.filterNot { it.id in removedIds }.toMutableList()
                enterNode(
                    target.nodeId,
                    trigger("previous"),
                    mutableSetOf(),
                    forcedMediaId = target.mediaId,
                )
            }
            .onFailure { fail(it.message ?: "前のシーンへ戻れません") }
    }

    fun toggle() {
        if (PlaybackRuntime.state.value.status == PlaybackStatus.COMPLETED) {
            scope.launch { restart() }
            return
        }
        if (player.mediaItemCount == 0) return
        if (player.isPlaying) player.pause() else player.play()
    }

    fun seek(positionMs: Long) {
        if (player.mediaItemCount == 0) return
        if (!resolvedControls().allowSeek) return
        player.seekTo(positionMs.coerceIn(0, player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE))
        scope.launch { saveSnapshot() }
    }

    suspend fun pressButton(buttonId: String) {
        val loadedGraph = graph ?: return
        val node = loadedGraph.nodes[currentNodeId] ?: return
        if (buttonId !in node.buttons || transitionClaimed) return
        val rendered = visibleButtons().firstOrNull { it.id == buttonId && it.visible } ?: return
        if (!rendered.visible) return
        val button = loadedGraph.buttons[buttonId] ?: return
        val next = chooseWeighted(button.onPress, Transition::weight) ?: return
        transitionClaimed = true
        if (currentMedia != null && !currentFinalized) finalizeCurrent("button")
        player.stop()
        enterNode(next.to, trigger("button", "buttonId" to JsonPrimitive(buttonId)), mutableSetOf())
    }

    suspend fun stop(): Boolean {
        if (graph != null && !resolvedControls().allowStop) return false
        if (currentMedia != null && !currentFinalized) finalizeCurrent("stopped")
        player.stop()
        player.clearMediaItems()
        graph = null
        graphRef = null
        currentNodeId = null
        currentMedia = null
        baseButtons = emptyList()
        layoutSource = null
        snapshotStore.clear()
        PlaybackRuntime.publish(PlaybackUiState())
        return true
    }

    fun release() {
        ticker?.cancel()
        saver?.cancel()
        player.removeListener(this)
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (isPlaying) {
            if (activePlayStartedRealtime == null) activePlayStartedRealtime = now
        } else {
            activePlayStartedRealtime?.let { activePlayBaseMs += (now - it).coerceAtLeast(0) }
            activePlayStartedRealtime = null
        }
        publishProgress()
        scope.launch { saveSnapshot() }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (
            playbackState != Player.STATE_ENDED ||
                transitionClaimed ||
                currentMedia?.source?.loop == true
        )
            return
        transitionClaimed = true
        scope.launch {
            runCatching {
                    val node = graph?.nodes?.get(currentNodeId) ?: return@runCatching
                    finalizeCurrent("completed")
                    if (node.terminal) {
                        freezeNodeClock()
                        baseButtons = emptyList()
                        publish(PlaybackStatus.COMPLETED)
                        saveSnapshot(completed = true)
                    } else {
                        val next =
                            chooseWeighted(node.onEnd, Transition::weight) ?: error("終了遷移を選択できません")
                        enterNode(next.to, trigger("end"), mutableSetOf())
                    }
                }
                .onFailure { fail(it.message ?: "終了遷移に失敗しました") }
        }
    }

    override fun onPlayerError(error: PlaybackException) {
        scope.launch {
            if (currentMedia != null && !currentFinalized) finalizeCurrent("error")
            fail("メディアを再生できません: ${error.errorCodeName}")
        }
    }

    private suspend fun enterNode(
        nodeId: String,
        incomingTrigger: JsonObject,
        visited: MutableSet<String>,
        forcedMediaId: String? = null,
    ) {
        val loadedGraph = graph ?: error("グラフが読み込まれていません")
        if (!visited.add(nodeId) || visited.size > 128) error("0 秒遷移の循環を検出しました")
        val node = loadedGraph.nodes[nodeId] ?: error("ノード $nodeId がありません")
        generation++
        transitionClaimed = false
        currentNodeId = nodeId
        nodeElapsedBaseMs = 0
        nodeEnteredRealtime = SystemClock.elapsedRealtime()
        nodeClockRunning = true
        baseButtons = emptyList()
        layoutSource = null
        publish(PlaybackStatus.LOADING)

        if (node.type == "script") {
            val call = node.script ?: error("$nodeId にスクリプトがありません")
            val scriptTrigger =
                JsonObject(incomingTrigger + ("scriptNodeId" to JsonPrimitive(nodeId)))
            val result = runScript(call, "jump", contextJson(scriptTrigger))
            val requested = (result as? JsonPrimitive)?.takeIf { it.isString }?.content
            val next =
                if (requested != null) {
                    require(node.onEnd.any { it.to == requested }) {
                        "$nodeId の jump() が許可されていない遷移先 $requested を返しました"
                    }
                    requested
                } else {
                    require(result == JsonNull) { "$nodeId の jump() はノード ID または None を返してください" }
                    chooseWeighted(node.onEnd, Transition::weight)?.to
                        ?: error("$nodeId の遷移を選択できません")
                }
            enterNode(next, scriptTrigger, visited)
            return
        }

        currentMedia = null
        currentStartedAt = null
        currentStartPositionMs = 0
        activePlayBaseMs = 0
        activePlayStartedRealtime = null
        currentFinalized = true
        loadLayout(node)
        val validButtons = node.buttons.filter(loadedGraph.buttons::containsKey)
        val media =
            forcedMediaId?.let { id -> node.media.firstOrNull { it.id == id } }
                ?: chooseWeighted(node.media, MediaCandidate::weight)

        if (media != null) {
            currentMedia = media
            currentStartedAt = now()
            currentStartPositionMs = 0
            currentFinalized = false
            prepareMedia(media, 0, autoPlay = true, restoring = false)
            baseButtons = renderButtons(node)
            publish(PlaybackStatus.READY)
            saveSnapshot()
            return
        }

        player.stop()
        player.clearMediaItems()
        applyVisualForEmptyNode()
        if (validButtons.isNotEmpty()) {
            baseButtons = renderButtons(node)
            publish(PlaybackStatus.READY)
            saveSnapshot()
        } else if (node.terminal) {
            freezeNodeClock()
            publish(PlaybackStatus.COMPLETED)
            saveSnapshot(completed = true)
        } else {
            val next =
                chooseWeighted(node.onEnd, Transition::weight)
                    ?: error("$nodeId は再生・ボタン・有効な終了遷移を持ちません")
            enterNode(next.to, trigger("empty"), visited)
        }
    }

    private suspend fun prepareMedia(
        media: MediaCandidate,
        positionMs: Long,
        autoPlay: Boolean,
        restoring: Boolean,
    ) {
        val ref = graphRef ?: error("グラフ参照がありません")
        val source = media.source
        val sourcePath = source.video ?: source.audio ?: error("${media.id} に再生ソースがありません")
        val sourceUri = library.mediaUri(ref, sourcePath) ?: error("ファイルが見つかりません: $sourcePath")
        when (source.type) {
            "audioImage" -> {
                visualPath = source.image
                visualUri = source.image?.let { library.assetUri(ref, it)?.toString() }
            }
            "audio" ->
                if (source.visual == "clear") {
                    visualPath = null
                    visualUri = null
                }
            "video" -> Unit
        }
        val artworkUri = visualPath?.let { library.assetUri(ref, it) }
        artworkUri?.let { uri ->
            runCatching {
                    // MediaSession metadata is rendered by System UI, which does not inherit this
                    // app's persisted Storage Access Framework grant.
                    app.grantUriPermission(
                        SYSTEM_UI_PACKAGE,
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                }
                .onFailure { error ->
                    Log.w(TAG, "Unable to grant notification artwork access", error)
                }
        }
        val metadata = graph?.metadata
        val itemBuilder =
            MediaItem.Builder()
                .setUri(sourceUri)
                .setMediaId(playbackItemId(runId, generation, ref.graphId, currentNodeId, media.id))
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(
                            metadata?.displayName?.takeIf(String::isNotBlank)
                                ?: ref.contentFolderName
                        )
                        .setArtist(metadata?.author)
                        .setArtworkUri(artworkUri)
                        .build()
                )
        source.subtitle?.let { subtitlePath ->
            library.mediaUri(ref, subtitlePath)?.let { subtitleUri ->
                itemBuilder.setSubtitleConfigurations(
                    listOf(
                        MediaItem.SubtitleConfiguration.Builder(subtitleUri)
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage("und")
                            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                            .build()
                    )
                )
            }
        }
        player.repeatMode = if (source.loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        player.volume = source.volume.coerceIn(0f, 1f)
        player.setMediaItem(itemBuilder.build(), positionMs.coerceAtLeast(0))
        player.prepare()
        if (autoPlay) player.play() else player.pause()
        if (!restoring) {
            activePlayBaseMs = 0
            activePlayStartedRealtime = null
        }
    }

    private fun beginNewRun() {
        runId = UUID.randomUUID().toString()
        runStartedAt = now()
        currentNodeId = null
        currentMedia = null
        currentStartedAt = null
        currentStartPositionMs = 0
        activePlayBaseMs = 0
        activePlayStartedRealtime = null
        currentFinalized = true
        visualPath = null
        visualUri = null
        layoutSource = null
        baseButtons = emptyList()
        nodeElapsedBaseMs = 0
        nodeClockRunning = false
        transitionClaimed = false
        nonFatalError = null
    }

    private suspend fun renderButtons(node: YuraiveNode): List<RenderedButton> {
        val loadedGraph = graph ?: return emptyList()
        return node.buttons.mapNotNull { id ->
            val button = loadedGraph.buttons[id] ?: return@mapNotNull null
            val baseStyle = button.style
            val result =
                button.render?.let { call ->
                    runCatching {
                            val value =
                                runScript(
                                    call,
                                    "render",
                                    contextJson(trigger("render", "buttonId" to JsonPrimitive(id))),
                                )
                            YuraiveJson.format.decodeFromJsonElement(
                                ButtonRenderResult.serializer(),
                                value,
                            )
                        }
                        .getOrElse {
                            nonFatalError = "ボタン $id の表示スクリプト: ${it.message}"
                            ButtonRenderResult(visible = false)
                        }
                }
            val styleOverride = result?.style
            val backgroundPath = styleOverride?.backgroundImage ?: baseStyle.backgroundImage
            val backgroundUri = backgroundPath?.let { library.assetUri(graphRef!!, it)?.toString() }
            RenderedButton(
                id = id,
                visible = result?.visible ?: true,
                targetSlot = button.targetSlot,
                order = button.order,
                zIndex = button.zIndex,
                text = result?.text ?: button.text ?: id,
                style =
                    baseStyle.copy(
                        backgroundColor =
                            styleOverride?.backgroundColor ?: baseStyle.backgroundColor,
                        backgroundImage = backgroundUri,
                        textColor = styleOverride?.textColor ?: baseStyle.textColor,
                        opacity = styleOverride?.opacity ?: baseStyle.opacity,
                        borderColor = styleOverride?.borderColor ?: baseStyle.borderColor,
                        borderWidth = styleOverride?.borderWidth ?: baseStyle.borderWidth,
                        borderRadius = styleOverride?.borderRadius ?: baseStyle.borderRadius,
                        fontSize = styleOverride?.fontSize ?: baseStyle.fontSize,
                        fontWeight = styleOverride?.fontWeight ?: baseStyle.fontWeight,
                        paddingHorizontal =
                            styleOverride?.paddingHorizontal ?: baseStyle.paddingHorizontal,
                        paddingVertical =
                            styleOverride?.paddingVertical ?: baseStyle.paddingVertical,
                    ),
            )
        }
    }

    private fun visibleButtons(): List<RenderedButton> {
        val loadedGraph = graph ?: return emptyList()
        val elapsed = nodeElapsedNow()
        return baseButtons
            .map { rendered ->
                val ranges = loadedGraph.buttons[rendered.id]?.visibility.orEmpty()
                val inRange =
                    ranges.isEmpty() ||
                        ranges.any {
                            elapsed >= it.fromMs && (it.toMs == null || elapsed < it.toMs)
                        }
                rendered.copy(visible = rendered.visible && inRange)
            }
            .sortedBy(RenderedButton::order)
    }

    private suspend fun finalizeCurrent(reason: String) {
        val ref = graphRef ?: return
        val nodeId = currentNodeId ?: return
        val media = currentMedia ?: return
        if (currentFinalized) return
        accumulateActiveTime()
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it >= 0 } ?: 0
        val entry =
            PlaybackHistoryEntry(
                id = UUID.randomUUID().toString(),
                runId = runId,
                graphId = ref.graphId,
                contentId = graph?.metadata?.contentId?.takeIf(String::isNotBlank),
                nodeId = nodeId,
                mediaId = media.id,
                source = media.source.video ?: media.source.audio,
                startedAt = currentStartedAt ?: now(),
                endedAt = now(),
                mediaDurationMs = duration,
                activePlayMs = activePlayBaseMs,
                startPositionMs = currentStartPositionMs,
                endPositionMs = currentPositionMs(),
                endReason = reason,
            )
        historyStore.append(entry)
        history = (history + entry).takeLast(1_000).toMutableList()
        currentFinalized = true
    }

    private fun contextJson(event: JsonObject): JsonObject {
        accumulateActiveTime()
        val current =
            currentNodeId?.let { nodeId ->
                buildJsonObject {
                    put("nodeId", nodeId)
                    put("mediaId", currentMedia?.id?.let(::JsonPrimitive) ?: JsonNull)
                    put(
                        "source",
                        (currentMedia?.source?.video ?: currentMedia?.source?.audio)?.let(
                            ::JsonPrimitive
                        ) ?: JsonNull,
                    )
                    put("startedAt", currentStartedAt?.let(::JsonPrimitive) ?: JsonNull)
                    put("positionMs", currentPositionMs())
                    put(
                        "mediaDurationMs",
                        player.duration.takeIf { it != C.TIME_UNSET && it >= 0 } ?: 0,
                    )
                    put("activePlayMs", activePlayBaseMs)
                }
            }
        val historyActive = history.sumOf { it.activePlayMs }
        return buildJsonObject {
            put("now", now())
            put("graphId", graphRef?.graphId ?: "")
            put("runId", runId)
            put("runStartedAt", runStartedAt)
            put(
                "historyStartedAt",
                history.firstOrNull()?.startedAt?.let(::JsonPrimitive) ?: JsonNull,
            )
            put("historyEndedAt", history.lastOrNull()?.endedAt?.let(::JsonPrimitive) ?: JsonNull)
            put("historyCount", history.size)
            put("historyActivePlayMs", historyActive)
            put("totalActivePlayMs", historyActive + if (currentFinalized) 0 else activePlayBaseMs)
            put(
                "history",
                buildJsonArray {
                    history.forEach {
                        add(
                            YuraiveJson.format.encodeToJsonElement(
                                PlaybackHistoryEntry.serializer(),
                                it,
                            )
                        )
                    }
                },
            )
            put("current", current ?: JsonNull)
            put("trigger", event)
        }
    }

    private suspend fun runScript(
        call: ScriptCall,
        defaultFunction: String,
        context: JsonObject,
    ): JsonElement {
        val ref = graphRef ?: error("グラフ参照がありません")
        return starlark.run(
            ref,
            call,
            defaultFunction,
            context,
            app.settings.state.value.scriptTimeoutMs,
        )
    }

    private fun publishProgress() {
        val state = PlaybackRuntime.state.value
        if (state.status == PlaybackStatus.IDLE || graphRef == null) return
        publish(state.status)
    }

    private fun publish(status: PlaybackStatus) {
        val loadedGraph = graph
        val ref = graphRef
        val node = loadedGraph?.nodes?.get(currentNodeId)
        val controls = resolvedControls(node)
        val runHistory = history.filter { it.runId == runId }
        val completedCurrentIsLast =
            currentFinalized &&
                runHistory.lastOrNull()?.let {
                    it.nodeId == currentNodeId && it.mediaId == currentMedia?.id
                } == true
        val previousCandidates = if (completedCurrentIsLast) runHistory.dropLast(1) else runHistory
        val metadata = loadedGraph?.metadata
        PlaybackRuntime.publish(
            PlaybackUiState(
                status = status,
                graphRef = ref,
                title =
                    metadata?.displayName?.takeIf(String::isNotBlank)
                        ?: ref?.contentFolderName.orEmpty(),
                description = metadata?.description?.takeIf(String::isNotBlank),
                author = metadata?.author?.takeIf(String::isNotBlank),
                socialLinks = metadata?.socialLinks.orEmpty(),
                sceneName =
                    node?.editor?.get("label")?.let { (it as? JsonPrimitive)?.content }
                        ?: currentNodeId.orEmpty(),
                fileName =
                    (currentMedia?.source?.video ?: currentMedia?.source?.audio)
                        .orEmpty()
                        .substringAfterLast('/'),
                nodeId = currentNodeId,
                mediaId = currentMedia?.id,
                sourcePath = currentMedia?.source?.video ?: currentMedia?.source?.audio,
                positionMs = if (player.mediaItemCount > 0) currentPositionMs() else 0,
                durationMs =
                    player.duration.takeIf {
                        player.mediaItemCount > 0 && it != C.TIME_UNSET && it >= 0
                    } ?: 0,
                isPlaying = player.isPlaying,
                isVideo = currentMedia?.source?.type == "video",
                visualUri = if (currentMedia?.source?.type == "video") null else visualUri,
                fit = currentMedia?.source?.fit ?: "contain",
                imageTransitionMs =
                    currentMedia?.source?.imageTransition?.durationMs?.coerceIn(0, 10_000)?.toInt()
                        ?: 300,
                layoutSource = layoutSource,
                buttons = visibleButtons(),
                controls = controls,
                contentId = metadata?.contentId?.takeIf(String::isNotBlank),
                hasPlaybackStats = loadedGraph?.playbackStats != null,
                runId = runId.takeIf(String::isNotBlank),
                runStartedAt = runStartedAt.takeIf(String::isNotBlank),
                currentStartedAt = currentStartedAt,
                currentActivePlayMs = if (currentFinalized) 0 else activePlayNow(),
                currentFinalized = currentFinalized,
                historyEntryCount = history.size,
                canNext =
                    controls.allowNext &&
                        status != PlaybackStatus.COMPLETED &&
                        (node?.terminal == true || !node?.onEnd.isNullOrEmpty()),
                canPrevious = controls.allowPrevious && previousCandidates.isNotEmpty(),
                error = nonFatalError,
            )
        )
    }

    private fun publishLoading(ref: GraphRef) {
        PlaybackRuntime.publish(
            PlaybackUiState(
                status = PlaybackStatus.LOADING,
                graphRef = ref,
                title = ref.contentFolderName,
            )
        )
    }

    private fun publishError(message: String) {
        PlaybackRuntime.publish(
            PlaybackRuntime.state.value.copy(
                status = PlaybackStatus.ERROR,
                isPlaying = false,
                error = message,
                buttons = emptyList(),
            )
        )
    }

    private suspend fun fail(message: String) {
        runCatching { if (currentMedia != null && !currentFinalized) finalizeCurrent("error") }
        player.pause()
        transitionClaimed = true
        publishError(message)
        saveSnapshot()
    }

    private suspend fun saveSnapshot(
        completed: Boolean = PlaybackRuntime.state.value.status == PlaybackStatus.COMPLETED
    ) {
        val ref = graphRef ?: return
        val nodeId = currentNodeId ?: return
        val status = PlaybackRuntime.state.value.status
        if (status !in setOf(PlaybackStatus.READY, PlaybackStatus.COMPLETED, PlaybackStatus.ERROR))
            return
        if (graph?.nodes?.get(nodeId)?.type != "media") return
        accumulateActiveTime()
        val snapshot =
            PlaybackSnapshot(
                graphRef = ref,
                runId = runId,
                runStartedAt = runStartedAt,
                nodeId = nodeId,
                mediaId = currentMedia?.id,
                positionMs = if (player.mediaItemCount > 0) currentPositionMs() else 0,
                durationMs =
                    player.duration.takeIf {
                        player.mediaItemCount > 0 && it != C.TIME_UNSET && it >= 0
                    } ?: 0,
                nodeElapsedMs = nodeElapsedNow(),
                startedAt = currentStartedAt,
                startPositionMs = currentStartPositionMs,
                activePlayMs = activePlayBaseMs,
                wasPlaying = player.isPlaying,
                visualPath = visualPath,
                completed = completed,
                savedAt = now(),
            )
        try {
            snapshotStore.save(snapshot)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(TAG, "Unable to persist playback snapshot", error)
        }
    }

    private fun accumulateActiveTime() {
        val started = activePlayStartedRealtime ?: return
        val current = SystemClock.elapsedRealtime()
        activePlayBaseMs += (current - started).coerceAtLeast(0)
        activePlayStartedRealtime = current
    }

    private fun activePlayNow(): Long =
        activePlayBaseMs +
            activePlayStartedRealtime
                ?.let { (SystemClock.elapsedRealtime() - it).coerceAtLeast(0) }
                .let { it ?: 0L }

    private fun discardCurrent() {
        accumulateActiveTime()
        activePlayStartedRealtime = null
        currentFinalized = true
    }

    private fun resolvedControls(
        node: YuraiveNode? = graph?.nodes?.get(currentNodeId)
    ): PlayerControlSettings {
        val loadedGraph = graph ?: return PlayerControlSettings.Default
        val controlId = node?.playerControl ?: loadedGraph.globalPlayerControl
        val defined =
            controlId?.let(loadedGraph.playerControls::get) ?: PlayerControlSettings.Default
        return if (app.settings.state.value.forceShowPlayerControls) {
            PlayerControlSettings.AllEnabled.copy(
                accentColor = defined.accentColor,
                layout = defined.layout,
            )
        } else defined
    }

    private fun currentPositionMs(): Long {
        val position = player.currentPosition.coerceAtLeast(0)
        val duration = player.duration
        return if (duration != C.TIME_UNSET && duration >= 0) position.coerceAtMost(duration)
        else position
    }

    private fun nodeElapsedNow(): Long =
        nodeElapsedBaseMs +
            if (nodeClockRunning) {
                (SystemClock.elapsedRealtime() - nodeEnteredRealtime).coerceAtLeast(0)
            } else 0

    private fun freezeNodeClock() {
        nodeElapsedBaseMs = nodeElapsedNow()
        nodeEnteredRealtime = SystemClock.elapsedRealtime()
        nodeClockRunning = false
    }

    private suspend fun loadLayout(node: YuraiveNode) {
        val ref = graphRef ?: error("グラフ参照がありません")
        layoutSource =
            resolvedControls(node).layout?.let { path ->
                require(YuraiveLayout.hasExpectedExtension(path)) {
                    "レイアウトの拡張子は ${YuraiveLayout.FILE_EXTENSION} である必要があります: $path"
                }
                library.readAssetText(ref, path, MAX_LAYOUT_BYTES)
            }
    }

    private fun applyVisualForEmptyNode() = Unit

    private fun trigger(type: String, vararg values: Pair<String, JsonElement>) = buildJsonObject {
        put("type", type)
        values.forEach { (key, value) -> put(key, value) }
    }

    private fun now(): String = Instant.now().toString()

    private companion object {
        const val TAG = "GraphPlaybackEngine"
        const val SYSTEM_UI_PACKAGE = "com.android.systemui"
        const val MAX_LAYOUT_BYTES = 512 * 1024
    }
}
