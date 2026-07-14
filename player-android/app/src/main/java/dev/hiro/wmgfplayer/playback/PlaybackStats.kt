package dev.hiro.wmgfplayer.playback

import dev.hiro.wmgfplayer.data.DocumentLibrary
import dev.hiro.wmgfplayer.data.HistoryStore
import dev.hiro.wmgfplayer.data.SettingsStore
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.GraphValidator
import dev.hiro.wmgfplayer.model.PlaybackHistoryEntry
import dev.hiro.wmgfplayer.model.ScriptCall
import dev.hiro.wmgfplayer.model.WmgGraph
import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

data class PlaybackStatsData(
    val title: String,
    val aggregate: PlaybackStatsAggregate,
    val items: List<PlaybackStatsItem>,
)

data class PlaybackStatsAggregate(
    val sessionCount: Int,
    val entryCount: Int,
    val activePlayMs: Long,
    val firstStartedAt: String?,
    val lastEndedAt: String?,
)

data class PlaybackStatsSession(
    val runId: String,
    val startedAt: String,
    val endedAt: String?,
    val isActive: Boolean,
    val entryCount: Int,
    val activePlayMs: Long,
    val entries: List<PlaybackHistoryEntry>,
)

data class PlaybackStatsItem(
    val session: PlaybackStatsSession,
    val sortValue: Long? = null,
    val display: DisplayDocument? = null,
    val share: ShareData? = null,
    val error: String? = null,
)

data class DisplayDocument(
    val fallbackText: String,
    val root: DisplayNode,
)

data class DisplayNode(
    val type: String,
    val text: String? = null,
    val spans: List<DisplaySpan> = emptyList(),
    val source: String? = null,
    val icon: String? = null,
    val value: Float? = null,
    val label: String? = null,
    val style: DisplayStyle = DisplayStyle(),
    val children: List<DisplayNode> = emptyList(),
)

data class DisplaySpan(
    val text: String,
    val style: DisplayStyle = DisplayStyle(),
)

data class DisplayStyle(
    val width: DisplayDimension? = null,
    val height: DisplayDimension? = null,
    val minHeight: Float? = null,
    val aspectRatio: Float? = null,
    val padding: Float? = null,
    val gap: Float? = null,
    val horizontalAlignment: String? = null,
    val verticalAlignment: String? = null,
    val textAlign: String? = null,
    val backgroundColor: String? = null,
    val borderColor: String? = null,
    val borderWidth: Float? = null,
    val cornerRadius: Float? = null,
    val opacity: Float? = null,
    val color: String? = null,
    val fontSize: Float? = null,
    val fontWeight: Int? = null,
    val lineHeight: Float? = null,
    val maxLines: Int? = null,
    val align: String? = null,
    val offsetX: Float? = null,
    val offsetY: Float? = null,
)

sealed interface DisplayDimension {
    data class Fixed(val value: Float) : DisplayDimension
    data object Fill : DisplayDimension
    data object Wrap : DisplayDimension
}

data class ShareData(
    val text: String,
    val url: String? = null,
    val hashtags: List<String> = emptyList(),
    val via: String? = null,
) {
    fun composedText(): String = buildList {
        add(text)
        url?.let(::add)
        if (hashtags.isNotEmpty()) add(hashtags.joinToString(" ") { "#$it" })
        via?.let { add("@$it") }
    }.joinToString("\n")
}

class PlaybackStatsEvaluator(
    private val library: DocumentLibrary,
    private val historyStore: HistoryStore,
    private val settings: SettingsStore,
) {
    private val cache = ConcurrentHashMap<String, PlaybackStatsItem>()
    private val starlark = StarlarkRuntime(library)

    suspend fun evaluate(ref: GraphRef, playback: PlaybackUiState): PlaybackStatsData = withContext(Dispatchers.Default) {
        val graph = library.readGraph(ref)
        val call = graph.playbackStats ?: error("この作品には再生統計が定義されていません")
        val evaluatedAt = Instant.now().toString()
        val contentId = graph.metadata?.contentId?.takeIf(String::isNotBlank)
        val history = historyStore.readForContent(contentId, ref.graphId)
        val activeRunId = playback.runId?.takeIf {
            playback.graphRef?.graphId == ref.graphId &&
                playback.status !in setOf(PlaybackStatus.IDLE, PlaybackStatus.COMPLETED, PlaybackStatus.ERROR)
        }
        val grouped = history.groupBy(PlaybackHistoryEntry::runId).toMutableMap()
        if (activeRunId != null && activeRunId !in grouped) grouped[activeRunId] = emptyList()
        val sessions = grouped.map { (runId, entries) ->
            val sorted = entries.sortedBy(PlaybackHistoryEntry::startedAt)
            val isActive = runId == activeRunId
            PlaybackStatsSession(
                runId = runId,
                startedAt = sorted.firstOrNull()?.startedAt
                    ?: playback.runStartedAt.takeIf { isActive }.orEmpty().ifBlank { evaluatedAt },
                endedAt = if (isActive) null else sorted.lastOrNull()?.endedAt,
                isActive = isActive,
                entryCount = sorted.size,
                activePlayMs = sorted.sumOf(PlaybackHistoryEntry::activePlayMs) +
                    if (isActive && !playback.currentFinalized) playback.currentActivePlayMs else 0,
                entries = sorted,
            )
        }
        val aggregate = PlaybackStatsAggregate(
            sessionCount = sessions.size,
            entryCount = history.size,
            activePlayMs = sessions.sumOf(PlaybackStatsSession::activePlayMs),
            firstStartedAt = sessions.minOfOrNull(PlaybackStatsSession::startedAt),
            lastEndedAt = sessions.mapNotNull(PlaybackStatsSession::endedAt).maxOrNull(),
        )
        val scripts = library.readScriptSources(ref, call.path)
        val graphSignature = signature(WmgJson.format.encodeToString(WmgGraph.serializer(), graph))
        val scriptSignature = signature(
            scripts.entries.sortedBy(Map.Entry<String, String>::key).joinToString(separator = "") { (path, source) ->
                "${path.length}:$path${source.length}:$source"
            },
        )
        val historySignature = signature(WmgJson.format.encodeToString(history))
        val items = sessions.map { session ->
            val sessionSignature = session.entries.joinToString("|") { "${it.id}:${it.activePlayMs}" }.hashCode()
            val cacheKey = listOf(
                contentId ?: ref.graphId,
                call.path,
                call.function ?: "render_stats",
                graphSignature,
                scriptSignature,
                historySignature,
                session.runId,
                sessionSignature,
                session.activePlayMs,
                session.isActive,
                aggregate.sessionCount,
                aggregate.entryCount,
                aggregate.activePlayMs,
            ).joinToString(":")
            cache[cacheKey] ?: evaluateSession(ref, graph, call, scripts, history, session, aggregate, playback, evaluatedAt)
                .also { result ->
                    if (result.error == null) {
                        if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
                        cache[cacheKey] = result
                    }
                }
        }
        PlaybackStatsData(
            title = graph.metadata?.displayName?.takeIf(String::isNotBlank) ?: ref.contentFolderName,
            aggregate = aggregate,
            items = items,
        )
    }

    private suspend fun evaluateSession(
        ref: GraphRef,
        graph: WmgGraph,
        call: ScriptCall,
        scripts: Map<String, String>,
        history: List<PlaybackHistoryEntry>,
        session: PlaybackStatsSession,
        aggregate: PlaybackStatsAggregate,
        playback: PlaybackUiState,
        evaluatedAt: String,
    ): PlaybackStatsItem = runCatching {
        val context = statsContext(ref, graph, history, session, aggregate, playback, evaluatedAt)
        val value = starlark.run(ref, call, "render_stats", context, settings.state.value.scriptTimeoutMs, scripts)
        parseResult(session, value)
    }.getOrElse { error ->
        PlaybackStatsItem(session = session, error = error.message ?: "統計スクリプトを実行できません")
    }

    private fun statsContext(
        ref: GraphRef,
        graph: WmgGraph,
        history: List<PlaybackHistoryEntry>,
        session: PlaybackStatsSession,
        aggregate: PlaybackStatsAggregate,
        playback: PlaybackUiState,
        evaluatedAt: String,
    ) = buildJsonObject {
        put("now", evaluatedAt)
        put("graphId", ref.graphId)
        graph.metadata?.contentId?.takeIf(String::isNotBlank)?.let { put("contentId", it) }
        put("runId", session.runId)
        put("runStartedAt", session.startedAt)
        put("historyStartedAt", history.firstOrNull()?.startedAt?.let(::JsonPrimitive) ?: JsonNull)
        put("historyEndedAt", history.lastOrNull()?.endedAt?.let(::JsonPrimitive) ?: JsonNull)
        put("historyCount", history.size)
        put("historyActivePlayMs", history.sumOf(PlaybackHistoryEntry::activePlayMs))
        put("totalActivePlayMs", aggregate.activePlayMs)
        put("history", historyArray(history))
        put("current", if (session.isActive) currentJson(playback) else JsonNull)
        put("trigger", buildJsonObject { put("type", "stats"); put("runId", session.runId) })
        put("session", buildJsonObject {
            put("runId", session.runId)
            put("startedAt", session.startedAt)
            put("endedAt", session.endedAt?.let(::JsonPrimitive) ?: JsonNull)
            put("isActive", session.isActive)
            put("entryCount", session.entryCount)
            put("activePlayMs", session.activePlayMs)
            put("entries", historyArray(session.entries))
        })
        put("aggregate", buildJsonObject {
            put("sessionCount", aggregate.sessionCount)
            put("entryCount", aggregate.entryCount)
            put("activePlayMs", aggregate.activePlayMs)
            put("firstStartedAt", aggregate.firstStartedAt?.let(::JsonPrimitive) ?: JsonNull)
            put("lastEndedAt", aggregate.lastEndedAt?.let(::JsonPrimitive) ?: JsonNull)
        })
    }

    private fun historyArray(entries: List<PlaybackHistoryEntry>) = buildJsonArray {
        entries.forEach { add(WmgJson.format.encodeToJsonElement(PlaybackHistoryEntry.serializer(), it)) }
    }

    private fun currentJson(playback: PlaybackUiState): JsonElement = playback.nodeId?.let { nodeId ->
        buildJsonObject {
            put("nodeId", nodeId)
            put("mediaId", playback.mediaId?.let(::JsonPrimitive) ?: JsonNull)
            put("source", playback.sourcePath?.let(::JsonPrimitive) ?: JsonNull)
            put("startedAt", playback.currentStartedAt?.let(::JsonPrimitive) ?: JsonNull)
            put("positionMs", playback.positionMs)
            put("mediaDurationMs", playback.durationMs)
            put("activePlayMs", playback.currentActivePlayMs)
        }
    } ?: JsonNull

    private fun parseResult(session: PlaybackStatsSession, value: JsonElement): PlaybackStatsItem {
        val result = value as? JsonObject ?: error("render_stats() はオブジェクトを返してください")
        val sortElement = result["sortValue"] as? JsonPrimitive ?: error("sortValue は必須です")
        val sortValue = sortElement.takeUnless { it.isString }?.longOrNull
            ?: error("sortValue は符号付き64 bit整数で指定してください")
        val rawDisplay = result["display"] as? JsonObject ?: error("display は必須です")
        val display = runCatching { DisplayValidator.validate(rawDisplay) }.getOrElse { displayError ->
            val fallback = rawDisplay["fallbackText"]?.jsonPrimitive?.contentOrNull
                ?.takeIf { it.isNotBlank() && it.length <= DisplayValidator.MAX_TEXT_LENGTH }
                ?: throw displayError
            DisplayDocument(fallback, DisplayNode(type = "text", text = fallback))
        }
        val share = (result["share"] as? JsonObject)?.let { runCatching { ShareValidator.validate(it) }.getOrNull() }
        return PlaybackStatsItem(session, sortValue, display, share)
    }

    private fun signature(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private companion object {
        const val MAX_CACHE_ENTRIES = 2_048
    }
}

internal object ShareValidator {
    private val hashtag = Regex("^[^#\\s]{1,50}$")
    private val via = Regex("^[A-Za-z0-9_]{1,15}$")

    fun validate(value: JsonObject): ShareData {
        val text = value.string("text")?.trim()?.takeIf(String::isNotEmpty)
            ?: error("share.text は必須です")
        require(text.length <= 5_000) { "share.text が長すぎます" }
        val url = value.string("url")?.trim()?.takeIf(String::isNotEmpty)
        require(url == null || (url.startsWith("https://") && url.length <= 2_048)) { "share.url はHTTPS URLで指定してください" }
        val hashtagArray = value["hashtags"]?.let { it as? JsonArray ?: error("share.hashtags は文字列配列で指定してください") }
        val hashtags = hashtagArray?.map { element ->
            element.jsonPrimitive.contentOrNull?.trim() ?: error("share.hashtags は文字列配列で指定してください")
        }.orEmpty()
        require(hashtags.size <= 10 && hashtags.all(hashtag::matches)) { "share.hashtags が不正です" }
        val viaValue = value.string("via")?.trim()?.takeIf(String::isNotEmpty)
        require(viaValue == null || via.matches(viaValue)) { "share.via が不正です" }
        return ShareData(text, url, hashtags, viaValue)
    }
}

internal object DisplayValidator {
    const val MAX_TEXT_LENGTH = 4_096
    private const val MAX_NODES = 128
    private const val MAX_DEPTH = 12
    private val containers = setOf("column", "row", "stack", "surface")
    private val leaves = setOf("spacer", "divider", "text", "image", "icon", "badge", "progress")
    private val colors = Regex("^#[0-9a-fA-F]{6}$")
    private var nodes = 0

    @Synchronized
    fun validate(value: JsonObject): DisplayDocument {
        require(value["schemaVersion"]?.jsonPrimitive?.intOrNull == 1) { "display.schemaVersion は1で指定してください" }
        val fallback = value.string("fallbackText")?.trim()?.takeIf(String::isNotEmpty)
            ?: error("display.fallbackText は必須です")
        require(fallback.length <= MAX_TEXT_LENGTH) { "display.fallbackText が長すぎます" }
        val root = value["root"] as? JsonObject ?: error("display.root は必須です")
        nodes = 0
        return DisplayDocument(fallback, node(root, 0, "display.root"))
    }

    private fun node(value: JsonObject, depth: Int, path: String): DisplayNode {
        require(depth <= MAX_DEPTH) { "$path の階層が深すぎます" }
        require(++nodes <= MAX_NODES) { "display の要素数が多すぎます" }
        val type = value.string("type") ?: error("$path.type は必須です")
        require(type in containers || type in leaves) { "$path.type は未対応です: $type" }
        val rawStyle = value["style"]?.let { it as? JsonObject ?: error("$path.style はオブジェクトで指定してください") }
        val style = style(rawStyle, "$path.style")
        val childArray = value["children"]?.let { it as? JsonArray ?: error("$path.children は配列で指定してください") }
        val children = childArray?.also {
            require(type in containers) { "$path は children を持てません" }
            require(it.size <= 32) { "$path.children が多すぎます" }
        }?.mapIndexed { index, child ->
            node(child as? JsonObject ?: error("$path.children[$index] はオブジェクトで指定してください"), depth + 1, "$path.children[$index]")
        }.orEmpty()
        val text = value.string("text")
        require(text == null || text.length <= MAX_TEXT_LENGTH) { "$path.text が長すぎます" }
        val spanArray = value["spans"]?.let { it as? JsonArray ?: error("$path.spans は配列で指定してください") }
        if (spanArray != null) require(type == "text") { "$path は spans を持てません" }
        val spans = spanArray?.also { require(it.size <= 32) { "$path.spans が多すぎます" } }
            ?.mapIndexed { index, spanElement ->
                val span = spanElement as? JsonObject ?: error("$path.spans[$index] はオブジェクトで指定してください")
                val spanText = span.string("text") ?: error("$path.spans[$index].text は必須です")
                require(spanText.length <= MAX_TEXT_LENGTH) { "$path.spans[$index].text が長すぎます" }
                val spanStyle = span["style"]?.let { it as? JsonObject ?: error("$path.spans[$index].style はオブジェクトで指定してください") }
                DisplaySpan(spanText, style(spanStyle, "$path.spans[$index].style"))
            }.orEmpty()
        if (type == "text") require((text != null) xor spans.isNotEmpty()) { "$path は text または spans のどちらか一方が必要です" }
        val source = value.string("source")
        if (type == "image") require(source != null && GraphValidator.isSafeRelativePath(source)) { "$path.source は安全な相対パスで指定してください" }
        val icon = value.string("icon")
        if (type == "icon") require(icon in setOf("play", "history", "timer", "star", "favorite", "sleep", "trophy", "stats")) { "$path.icon は未対応です" }
        val nodeValue = value["value"]?.jsonPrimitive?.doubleOrNull
        if (type == "progress") require(nodeValue != null && nodeValue.isFinite() && nodeValue in 0.0..1.0) { "$path.value は0〜1で指定してください" }
        val label = value.string("label")
        require(label == null || label.length <= MAX_TEXT_LENGTH) { "$path.label が長すぎます" }
        if (type == "badge") require(!text.isNullOrBlank()) { "$path.text は必須です" }
        return DisplayNode(type, text, spans, source, icon, nodeValue?.toFloat(), label, style, children)
    }

    private fun style(value: JsonObject?, path: String): DisplayStyle {
        if (value == null) return DisplayStyle()
        fun number(name: String, min: Double, max: Double): Float? = value[name]?.jsonPrimitive?.doubleOrNull?.also {
            require(it.isFinite() && it in min..max) { "$path.$name は$min〜${max}で指定してください" }
        }?.toFloat()
        fun integer(name: String, min: Int, max: Int): Int? = value[name]?.jsonPrimitive?.intOrNull?.also {
            require(it in min..max) { "$path.$name は$min〜${max}で指定してください" }
        }
        fun enum(name: String, allowed: Set<String>): String? = value.string(name)?.also {
            require(it in allowed) { "$path.$name が不正です" }
        }
        fun color(name: String): String? = value.string(name)?.also {
            require(colors.matches(it)) { "$path.$name は #RRGGBB で指定してください" }
        }
        return DisplayStyle(
            width = dimension(value["width"], "$path.width"),
            height = dimension(value["height"], "$path.height"),
            minHeight = number("minHeight", 0.0, 1_024.0),
            aspectRatio = number("aspectRatio", 0.05, 20.0),
            padding = number("padding", 0.0, 128.0),
            gap = number("gap", 0.0, 128.0),
            horizontalAlignment = enum("horizontalAlignment", setOf("start", "center", "end")),
            verticalAlignment = enum("verticalAlignment", setOf("top", "center", "bottom")),
            textAlign = enum("textAlign", setOf("start", "center", "end")),
            backgroundColor = color("backgroundColor"),
            borderColor = color("borderColor"),
            borderWidth = number("borderWidth", 0.0, 32.0),
            cornerRadius = number("cornerRadius", 0.0, 128.0),
            opacity = number("opacity", 0.0, 1.0),
            color = color("color"),
            fontSize = number("fontSize", 8.0, 128.0),
            fontWeight = integer("fontWeight", 100, 900),
            lineHeight = number("lineHeight", 8.0, 192.0),
            maxLines = integer("maxLines", 1, 100),
            align = enum("align", setOf("topStart", "topCenter", "topEnd", "centerStart", "center", "centerEnd", "bottomStart", "bottomCenter", "bottomEnd")),
            offsetX = number("offsetX", -1_024.0, 1_024.0),
            offsetY = number("offsetY", -1_024.0, 1_024.0),
        )
    }

    private fun dimension(value: JsonElement?, path: String): DisplayDimension? {
        if (value == null) return null
        val primitive = value as? JsonPrimitive ?: error("$path は数値、fill、wrapのいずれかで指定してください")
        primitive.doubleOrNull?.let {
            require(it.isFinite() && it in 0.0..2_048.0) { "$path は0〜2048で指定してください" }
            return DisplayDimension.Fixed(it.toFloat())
        }
        return when (primitive.contentOrNull) {
            "fill" -> DisplayDimension.Fill
            "wrap" -> DisplayDimension.Wrap
            else -> error("$path は数値、fill、wrapのいずれかで指定してください")
        }
    }
}

private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)
    ?.takeIf { it.isString }
    ?.contentOrNull
