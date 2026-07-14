package dev.hiro.wmgfplayer.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.IBinder
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionResult
import dev.hiro.wmgfplayer.MainActivity
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.PlayerControlSettings
import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val commandMutex = Mutex()
    private lateinit var player: ExoPlayer
    private lateinit var engine: GraphPlaybackEngine
    private var mediaSession: MediaSession? = null
    private val sessionCallback = object : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.accept(
                MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS,
                playerCommands(PlaybackRuntime.state.value.controls),
            )

        override fun onPlayerCommandRequest(session: MediaSession, controller: MediaSession.ControllerInfo, playerCommand: Int): Int {
            val controls = PlaybackRuntime.state.value.controls
            if (playerCommand == Player.COMMAND_STOP || playerCommand in navigationCommands) return SessionResult.RESULT_ERROR_PERMISSION_DENIED
            if (!controls.allowSeek && playerCommand in seekCommands) return SessionResult.RESULT_ERROR_PERMISSION_DENIED
            return SessionResult.RESULT_SUCCESS
        }
    }

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        engine = GraphPlaybackEngine(this, player, scope)
        PlaybackRuntime.attachPlayer(player)
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val session = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .setCallback(sessionCallback)
            .build()
        mediaSession = session
        // Commands arrive through explicit service intents rather than a MediaController. Register
        // the session eagerly so MediaSessionService can publish its notification and promote the
        // service to a mediaPlayback foreground service before the first controller connects.
        addSession(session)
        scope.launch {
            PlaybackRuntime.state.map { it.controls }.distinctUntilChanged().collect { controls ->
                mediaSession?.let { activeSession ->
                    activeSession.connectedControllers.forEach { controller ->
                        activeSession.setAvailableCommands(
                            controller,
                            MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS,
                            playerCommands(controls),
                        )
                    }
                }
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        scope.launch {
            commandMutex.withLock {
                when (intent?.action) {
                    ACTION_INITIALIZE -> engine.restore(autoPlay = false)
                    ACTION_PLAY_GRAPH -> intent.getStringExtra(EXTRA_GRAPH_REF)?.let {
                        engine.start(WmgJson.format.decodeFromString<GraphRef>(it))
                    }
                    ACTION_TOGGLE -> { engine.restore(false); engine.toggle() }
                    ACTION_SEEK -> { engine.restore(false); engine.seek(intent.getLongExtra(EXTRA_POSITION, 0)) }
                    ACTION_BUTTON -> { engine.restore(false); intent.getStringExtra(EXTRA_BUTTON_ID)?.let { engine.pressButton(it) } }
                    ACTION_RESTART -> { engine.restore(false); engine.restart() }
                    ACTION_NEXT -> { engine.restore(false); engine.next() }
                    ACTION_PREVIOUS -> { engine.restore(false); engine.previous() }
                    ACTION_STOP -> {
                        if (engine.stop()) stopSelf()
                    }
                    null -> engine.restore(autoPlay = true)
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        engine.release()
        mediaSession?.release()
        mediaSession = null
        PlaybackRuntime.attachPlayer(null)
        PlaybackRuntime.publish(PlaybackRuntime.state.value.copy(isPlaying = false))
        player.release()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private val navigationCommands = setOf(
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT,
        )
        private val seekCommands = navigationCommands + setOf(
            Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            Player.COMMAND_SEEK_BACK,
            Player.COMMAND_SEEK_FORWARD,
        )

        private fun playerCommands(controls: PlayerControlSettings): Player.Commands =
            MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                // Graph navigation and terminal stop have application-level semantics and must not
                // be bypassed by a generic MediaController command.
                .remove(Player.COMMAND_STOP)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS)
                .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_NEXT)
                .apply {
                    if (!controls.allowSeek) {
                        remove(Player.COMMAND_SEEK_TO_DEFAULT_POSITION)
                        remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                        remove(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
                        remove(Player.COMMAND_SEEK_BACK)
                        remove(Player.COMMAND_SEEK_FORWARD)
                    }
                }
                .build()

        const val ACTION_INITIALIZE = "dev.hiro.wmgfplayer.INITIALIZE"
        const val ACTION_PLAY_GRAPH = "dev.hiro.wmgfplayer.PLAY_GRAPH"
        const val ACTION_TOGGLE = "dev.hiro.wmgfplayer.TOGGLE"
        const val ACTION_SEEK = "dev.hiro.wmgfplayer.SEEK"
        const val ACTION_BUTTON = "dev.hiro.wmgfplayer.BUTTON"
        const val ACTION_RESTART = "dev.hiro.wmgfplayer.RESTART"
        const val ACTION_NEXT = "dev.hiro.wmgfplayer.NEXT"
        const val ACTION_PREVIOUS = "dev.hiro.wmgfplayer.PREVIOUS"
        const val ACTION_STOP = "dev.hiro.wmgfplayer.STOP"
        const val EXTRA_GRAPH_REF = "graphRef"
        const val EXTRA_POSITION = "position"
        const val EXTRA_BUTTON_ID = "buttonId"
    }
}
