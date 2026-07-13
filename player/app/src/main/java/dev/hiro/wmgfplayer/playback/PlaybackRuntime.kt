package dev.hiro.wmgfplayer.playback

import android.content.Context
import android.content.Intent
import androidx.media3.common.Player
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.PlayerControlSettings
import dev.hiro.wmgfplayer.model.RenderedButton
import dev.hiro.wmgfplayer.model.SocialLink
import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString

enum class PlaybackStatus { IDLE, LOADING, READY, COMPLETED, ERROR }

data class PlaybackUiState(
    val status: PlaybackStatus = PlaybackStatus.IDLE,
    val graphRef: GraphRef? = null,
    val title: String = "",
    val description: String? = null,
    val author: String? = null,
    val socialLinks: List<SocialLink> = emptyList(),
    val sceneName: String = "",
    val fileName: String = "",
    val nodeId: String? = null,
    val mediaId: String? = null,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val isPlaying: Boolean = false,
    val isVideo: Boolean = false,
    val visualUri: String? = null,
    val fit: String = "contain",
    val imageTransitionMs: Int = 300,
    val buttons: List<RenderedButton> = emptyList(),
    val controls: PlayerControlSettings = PlayerControlSettings.Default,
    val canNext: Boolean = false,
    val canPrevious: Boolean = false,
    val error: String? = null,
)

object PlaybackRuntime {
    private val mutableState = MutableStateFlow(PlaybackUiState())
    val state = mutableState.asStateFlow()
    internal fun publish(value: PlaybackUiState) { mutableState.value = value }

    private val mutablePlayer = MutableStateFlow<Player?>(null)
    val player = mutablePlayer.asStateFlow()
    internal fun attachPlayer(value: Player?) { mutablePlayer.value = value }

    fun initialize(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_INITIALIZE), foreground = false)

    fun play(context: Context, ref: GraphRef) = send(
        context,
        Intent(context, PlaybackService::class.java)
            .setAction(PlaybackService.ACTION_PLAY_GRAPH)
            .putExtra(PlaybackService.EXTRA_GRAPH_REF, WmgJson.format.encodeToString(ref)),
        foreground = true,
    )

    fun toggle(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_TOGGLE), true)
    fun seek(context: Context, positionMs: Long) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_SEEK).putExtra(PlaybackService.EXTRA_POSITION, positionMs), true)
    fun pressButton(context: Context, buttonId: String) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_BUTTON).putExtra(PlaybackService.EXTRA_BUTTON_ID, buttonId), true)
    fun restart(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_RESTART), true)
    fun next(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_NEXT), true)
    fun previous(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_PREVIOUS), true)
    fun stop(context: Context) = send(context, Intent(context, PlaybackService::class.java).setAction(PlaybackService.ACTION_STOP), false)

    private fun send(context: Context, intent: Intent, @Suppress("UNUSED_PARAMETER") foreground: Boolean) {
        context.startService(intent)
    }
}
