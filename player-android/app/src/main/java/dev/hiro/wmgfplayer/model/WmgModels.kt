package dev.hiro.wmgfplayer.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject

@Serializable
data class WmgGraph(
    val version: Int,
    val metadata: WmgMetadata? = null,
    val nodes: Map<String, WmgNode>,
    val buttons: Map<String, WmgButton>,
    val playerControls: Map<String, PlayerControlSettings> = emptyMap(),
    val globalPlayerControl: String? = null,
    val playbackStats: ScriptCall? = null,
)

@Serializable
data class WmgMetadata(
    val contentId: String? = null,
    val displayName: String? = null,
    val description: String? = null,
    val author: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val tags: List<String> = emptyList(),
    val thumbnail: String? = null,
    val socialLinks: List<SocialLink> = emptyList(),
)

@Serializable
data class SocialLink(
    val label: String,
    val url: String,
)

@Serializable
data class PlayerControlSettings(
    val accentColor: String? = null,
    val layout: String? = null,
    val allowStop: Boolean = true,
    val showSeekBar: Boolean = true,
    val showPlaybackTime: Boolean = true,
    val allowSeek: Boolean = true,
    val showSceneName: Boolean = true,
    val showFileName: Boolean = false,
    val allowNext: Boolean = false,
    val allowPrevious: Boolean = false,
    val editor: JsonObject? = null,
) {
    companion object {
        val Default = PlayerControlSettings()
        val AllEnabled = PlayerControlSettings(
            allowStop = true,
            showSeekBar = true,
            showPlaybackTime = true,
            allowSeek = true,
            showSceneName = true,
            showFileName = true,
            allowNext = true,
            allowPrevious = true,
        )
    }
}

@Serializable
data class WmgNode(
    val type: String,
    val start: Boolean = false,
    val terminal: Boolean = false,
    val script: ScriptCall? = null,
    val media: List<MediaCandidate> = emptyList(),
    val onEnd: List<Transition> = emptyList(),
    val buttons: List<String> = emptyList(),
    val playerControl: String? = null,
    val editor: JsonObject? = null,
)

@Serializable
data class ScriptCall(val path: String, val function: String? = null)

@Serializable
data class MediaCandidate(
    val id: String,
    val weight: Double,
    val source: WmgMediaSource,
)

@Serializable
data class WmgMediaSource(
    val type: String,
    val audio: String? = null,
    val image: String? = null,
    val video: String? = null,
    val subtitle: String? = null,
    val visual: String? = null,
    val volume: Float = 1f,
    val loop: Boolean = false,
    val fit: String = "contain",
    val imageTransition: ImageTransition? = null,
)

@Serializable
data class ImageTransition(val type: String, val durationMs: Long)

@Serializable
data class Transition(val to: String, val weight: Double)

@Serializable
data class WmgButton(
    val visibility: List<VisibilityRange> = emptyList(),
    val targetSlot: String? = null,
    val order: Int = 0,
    val zIndex: Int = 0,
    val text: String? = null,
    val style: ButtonRenderStyle = ButtonRenderStyle(),
    val render: ScriptCall? = null,
    val onPress: List<Transition> = emptyList(),
    val editor: JsonObject? = null,
)

@Serializable
data class VisibilityRange(val fromMs: Long, val toMs: Long? = null)

@Serializable
data class ButtonRenderStyle(
    val backgroundColor: String? = null,
    val backgroundImage: String? = null,
    val textColor: String? = null,
    val opacity: Float? = null,
    val borderColor: String? = null,
    val borderWidth: Float? = null,
    val borderRadius: Float? = null,
    val fontSize: Float? = null,
    val fontWeight: Int? = null,
    val paddingHorizontal: Float? = null,
    val paddingVertical: Float? = null,
)

@Serializable
data class ButtonRenderResult(
    val visible: Boolean? = null,
    val text: String? = null,
    val style: ButtonRenderStyle? = null,
)

@Serializable
data class GraphRef(
    val rootUri: String,
    val rootName: String,
    val relativePath: String,
) {
    val fileName: String get() = relativePath.substringAfterLast('/')
    val parentPath: String get() = relativePath.substringBeforeLast('/', "")
    val contentFolderName: String get() = parentPath.substringAfterLast('/').ifBlank { rootName }
    val graphId: String get() = "$rootUri::$relativePath"
}

@Serializable
data class PlaybackHistoryEntry(
    val schemaVersion: Int = 1,
    val id: String,
    val runId: String,
    val graphId: String,
    val contentId: String? = null,
    val nodeId: String,
    val mediaId: String,
    val source: String? = null,
    val startedAt: String,
    val endedAt: String,
    val mediaDurationMs: Long,
    val activePlayMs: Long,
    val startPositionMs: Long,
    val endPositionMs: Long,
    val endReason: String,
)

@Serializable
data class PlaybackSnapshot(
    val schemaVersion: Int = 1,
    val graphRef: GraphRef,
    val runId: String,
    val runStartedAt: String,
    val nodeId: String,
    val mediaId: String? = null,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val nodeElapsedMs: Long = 0,
    val startedAt: String? = null,
    val startPositionMs: Long = 0,
    val activePlayMs: Long = 0,
    val wasPlaying: Boolean = false,
    val visualPath: String? = null,
    val completed: Boolean = false,
    val savedAt: String,
)

data class ValidationIssue(
    val severity: Severity,
    val message: String,
    val path: String? = null,
) {
    enum class Severity { ERROR, WARNING }
}

@Serializable
data class RenderedButton(
    val id: String,
    val visible: Boolean,
    val targetSlot: String? = null,
    val order: Int = 0,
    val zIndex: Int = 0,
    val text: String,
    val style: ButtonRenderStyle,
)

object WmgJson {
    val format = kotlinx.serialization.json.Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = false
    }
}

@Serializable
data class GraphMetadataPreview(
    val displayName: String? = null,
    val author: String? = null,
    val thumbnail: String? = null,
)

@Serializable
private data class MetadataPrefixResult(
    val status: String,
    val metadata: GraphMetadataPreview? = null,
    val error: String? = null,
)

internal sealed interface MetadataPrefixRead {
    data class Found(val metadata: GraphMetadataPreview?) : MetadataPrefixRead
    data object Missing : MetadataPrefixRead
    data object NeedMore : MetadataPrefixRead
    data class Invalid(val message: String) : MetadataPrefixRead
}

internal object GraphMetadataExtractor {
    fun read(prefix: String): MetadataPrefixRead {
        val result = runCatching {
            WmgJson.format.decodeFromString(
                MetadataPrefixResult.serializer(),
                NativeGraphMetadataExtractor.extractNative(prefix),
            )
        }.getOrElse { return MetadataPrefixRead.Invalid(it.message ?: "メタデータを解析できません") }
        return when (result.status) {
            "found" -> MetadataPrefixRead.Found(result.metadata)
            "missing" -> MetadataPrefixRead.Missing
            "needMore" -> MetadataPrefixRead.NeedMore
            else -> MetadataPrefixRead.Invalid(result.error ?: "メタデータを解析できません")
        }
    }
}

private object NativeGraphMetadataExtractor {
    init { System.loadLibrary("wmgf_runtime") }

    external fun extractNative(prefix: String): String
}

object GraphValidator {
    fun validate(graph: WmgGraph): List<ValidationIssue> =
        validateJson(WmgJson.format.encodeToString(WmgGraph.serializer(), graph))

    fun validateJson(json: String): List<ValidationIssue> = NativeGraphValidator.validate(json)

    fun allAssetPaths(graph: WmgGraph): Set<String> = buildSet {
        graph.metadata?.thumbnail?.let(::add)
        graph.playbackStats?.path?.let(::add)
        graph.nodes.values.forEach { node ->
            node.script?.path?.let(::add)
            node.media.forEach { media ->
                media.source.audio?.let(::add)
                media.source.image?.let(::add)
                media.source.video?.let(::add)
                media.source.subtitle?.let(::add)
            }
        }
        graph.buttons.values.forEach { button ->
            button.style.backgroundImage?.let(::add)
            button.render?.path?.let(::add)
        }
        graph.playerControls.values.forEach { control -> control.layout?.let(::add) }
    }

    fun isSafeRelativePath(path: String): Boolean = path.isNotBlank() &&
        !path.startsWith('/') && ':' !in path && path.split('/').none { it == ".." || it.isBlank() }
}

private object NativeGraphValidator {
    init { System.loadLibrary("wmgf_runtime") }

    fun validate(json: String): List<ValidationIssue> = WmgJson.format.decodeFromString(
        ListSerializer(NativeValidationIssue.serializer()),
        validateJsonNative(json),
    ).map { issue ->
        ValidationIssue(
            severity = if (issue.severity == "WARNING") ValidationIssue.Severity.WARNING else ValidationIssue.Severity.ERROR,
            message = issue.message,
            path = issue.path,
        )
    }

    private external fun validateJsonNative(json: String): String
}

@Serializable
private data class NativeValidationIssue(
    val severity: String,
    val message: String,
    val path: String? = null,
)

fun <T> chooseWeighted(items: List<T>, weight: (T) -> Double, random: Double = Math.random()): T? {
    val selectable = items.filter { weight(it) > 0 && weight(it).isFinite() }
    val total = selectable.sumOf(weight)
    if (total <= 0) return null
    var cursor = random.coerceIn(0.0, 0.999999999999) * total
    return selectable.firstOrNull { item ->
        cursor -= weight(item)
        cursor < 0
    } ?: selectable.lastOrNull()
}
