@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.*
import androidx.media3.ui.*
import com.yuraive.player.data.*
import com.yuraive.player.model.*
import com.yuraive.player.playback.*
import java.time.*
import kotlin.math.*
import kotlinx.coroutines.*

@Composable
internal fun PlayerScreen(
    state: PlaybackUiState,
    player: androidx.media3.common.Player?,
    favorite: Boolean,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
    onRetry: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
    onStats: () -> Unit,
    onTheme: () -> Unit,
    onButton: (String) -> Unit,
) {
    var showInfo by remember { mutableStateOf(false) }
    var rawDragOffset by remember { mutableFloatStateOf(0f) }
    var draggingPlayer by remember { mutableStateOf(false) }
    val swipeThreshold = with(LocalDensity.current) { 96.dp.toPx() }
    val dragOffset by
        animateFloatAsState(
            targetValue = if (draggingPlayer) rawDragOffset else 0f,
            animationSpec = if (draggingPlayer) snap() else tween(180),
            label = "player swipe offset",
        )
    val playerBackground = Color(0xFF101116)

    Box(
        Modifier.fillMaxSize()
            .background(Color.Black)
            .graphicsLayer {
                translationY = dragOffset
                alpha = 1f - (dragOffset / (size.height.coerceAtLeast(1f) * .8f)).coerceIn(0f, .45f)
            }
            .background(playerBackground)
            .pointerInput(swipeThreshold) {
                detectVerticalDragGestures(
                    onDragStart = { draggingPlayer = true },
                    onDragCancel = {
                        draggingPlayer = false
                        rawDragOffset = 0f
                    },
                    onDragEnd = {
                        val dismiss = rawDragOffset >= swipeThreshold
                        draggingPlayer = false
                        rawDragOffset = 0f
                        if (dismiss) onBack()
                    },
                ) { change, amount ->
                    val nextOffset = (rawDragOffset + amount).coerceAtLeast(0f)
                    if (amount > 0f || rawDragOffset > 0f) change.consume()
                    rawDragOffset = nextOffset
                }
            }
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            if (isTwoPanePlayerLayout(maxWidth.value.toInt(), maxHeight.value.toInt())) {
                PlayerLandscapeContent(
                    state = state,
                    player = player,
                    favorite = favorite,
                    onToggle = onToggle,
                    onSeek = onSeek,
                    onNext = onNext,
                    onPrevious = onPrevious,
                    onToggleFavorite = onToggleFavorite,
                    onStats = onStats,
                    onTheme = onTheme,
                    onInfo = { showInfo = true },
                    onButton = onButton,
                )
            } else {
                PlayerPortraitContent(
                    state = state,
                    player = player,
                    favorite = favorite,
                    onToggle = onToggle,
                    onSeek = onSeek,
                    onNext = onNext,
                    onPrevious = onPrevious,
                    onToggleFavorite = onToggleFavorite,
                    onStats = onStats,
                    onTheme = onTheme,
                    onInfo = { showInfo = true },
                    onButton = onButton,
                )
            }
        }

        if (state.status == PlaybackStatus.LOADING)
            CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
        if (state.status == PlaybackStatus.ERROR) {
            Card(
                Modifier.align(Alignment.Center).padding(28.dp),
                colors =
                    CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    ),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("再生エラー", fontWeight = FontWeight.Bold)
                    Text(state.error.orEmpty())
                    OutlinedButton(onClick = onRetry) {
                        Icon(Icons.Default.RestartAlt, null)
                        Spacer(Modifier.width(8.dp))
                        Text("再試行")
                    }
                }
            }
        }
    }
    if (showInfo) ContentInfoDialog(state = state, close = { showInfo = false })
}

@Composable
internal fun PlayerPortraitContent(
    state: PlaybackUiState,
    player: androidx.media3.common.Player?,
    favorite: Boolean,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
    onStats: () -> Unit,
    onTheme: () -> Unit,
    onInfo: () -> Unit,
    onButton: (String) -> Unit,
) {
    BoxWithConstraints(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        val compactHeight = maxHeight < 760.dp
        val veryCompactHeight = maxHeight < 700.dp
        val horizontalPadding = if (maxWidth < 380.dp) 16.dp else 20.dp
        val contentWidth = (maxWidth - horizontalPadding * 2).coerceAtMost(MaxPortraitPlayerWidth)
        val minimumArtwork =
            when {
                veryCompactHeight -> 180.dp
                compactHeight -> 210.dp
                else -> 236.dp
            }.coerceAtMost(contentWidth)
        val artworkHeightLimit =
            maxHeight *
                when {
                    veryCompactHeight -> .29f
                    compactHeight -> .33f
                    else -> .36f
                }
        val artworkSize =
            contentWidth
                .coerceAtMost(artworkHeightLimit)
                .coerceAtMost(420.dp)
                .coerceAtLeast(minimumArtwork)
        val headerToArtwork =
            when {
                veryCompactHeight -> 12.dp
                compactHeight -> 18.dp
                else -> 24.dp
            }
        val artworkToMetadata =
            when {
                veryCompactHeight -> 12.dp
                compactHeight -> 18.dp
                else -> 22.dp
            }
        val metadataToProgress =
            when {
                veryCompactHeight -> 6.dp
                compactHeight -> 10.dp
                else -> 14.dp
            }
        val progressToTransport =
            when {
                veryCompactHeight -> 8.dp
                compactHeight -> 14.dp
                else -> 18.dp
            }

        Column(
            Modifier.width(contentWidth)
                .fillMaxHeight()
                .padding(vertical = if (compactHeight) 8.dp else 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PlayerHeader(state, compact = false)
            Spacer(Modifier.height(headerToArtwork))
            PlayerArtwork(
                state = state,
                player = player,
                onButton = onButton,
                modifier = Modifier.size(artworkSize),
                compact = compactHeight,
            )
            Spacer(Modifier.height(artworkToMetadata))
            PlayerMetadataActions(state, favorite, onToggleFavorite, onStats, compact = false)
            Spacer(Modifier.height(metadataToProgress))
            PlayerProgress(state, onSeek)
            Spacer(Modifier.height(progressToTransport))
            PlayerTransportControls(state, onToggle, onNext, onPrevious, compactHeight)
            Spacer(Modifier.weight(1f))
            PlayerBottomActions(
                showInfo = onInfo,
                showTheme = onTheme,
                showLyrics = {},
                lyricsAvailable = false,
            )
            Spacer(Modifier.height(if (compactHeight) 4.dp else 8.dp))
        }
    }
}

@Composable
internal fun PlayerLandscapeContent(
    state: PlaybackUiState,
    player: androidx.media3.common.Player?,
    favorite: Boolean,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
    onStats: () -> Unit,
    onTheme: () -> Unit,
    onInfo: () -> Unit,
    onButton: (String) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        val compactHeight = maxHeight < 480.dp
        val expandedWidth = maxWidth >= 840.dp
        val paneGap = if (expandedWidth) 28.dp else 12.dp
        Row(
            Modifier.fillMaxSize()
                .padding(horizontal = if (expandedWidth) 28.dp else 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(paneGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BoxWithConstraints(
                Modifier.weight(1f).fillMaxHeight(),
                contentAlignment = Alignment.Center,
            ) {
                val artworkSize = minOf(maxWidth, maxHeight, 520.dp)
                PlayerArtwork(
                    state = state,
                    player = player,
                    onButton = onButton,
                    modifier = Modifier.size(artworkSize),
                    compact = compactHeight,
                )
            }
            Column(
                Modifier.weight(1f)
                    .fillMaxHeight()
                    .padding(horizontal = if (expandedWidth) 20.dp else 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                PlayerHeader(state, compact = true)
                Spacer(Modifier.height(if (compactHeight) 4.dp else 14.dp))
                PlayerMetadataActions(state, favorite, onToggleFavorite, onStats, compact = true)
                Spacer(Modifier.height(if (compactHeight) 2.dp else 12.dp))
                PlayerProgress(state, onSeek)
                Spacer(Modifier.height(if (compactHeight) 2.dp else 12.dp))
                PlayerTransportControls(state, onToggle, onNext, onPrevious, compact = true)
                Spacer(Modifier.weight(1f))
                PlayerBottomActions(
                    showInfo = onInfo,
                    showTheme = onTheme,
                    showLyrics = {},
                    lyricsAvailable = false,
                )
            }
        }
    }
}

@Composable
internal fun PlayerHeader(state: PlaybackUiState, compact: Boolean) {
    Text(
        "再生中",
        color = Color.White.copy(alpha = .72f),
        style =
            if (compact) MaterialTheme.typography.labelLarge
            else MaterialTheme.typography.titleMedium,
    )
    Text(
        state.title.ifBlank { HiddenTextPlaceholder },
        color = Color.White,
        style =
            if (compact) MaterialTheme.typography.titleLarge
            else MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
internal fun PlayerArtwork(
    state: PlaybackUiState,
    player: androidx.media3.common.Player?,
    onButton: (String) -> Unit,
    modifier: Modifier,
    compact: Boolean,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(if (compact) 22.dp else 28.dp))
            .background(Color.White.copy(alpha = .06f)),
        contentAlignment = Alignment.Center,
    ) {
        if (state.isVideo && player != null) {
            AndroidView(
                factory = { context ->
                    PlayerView(context).apply {
                        useController = false
                        this.player = player
                    }
                },
                update = { view ->
                    view.player = player
                    view.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Crossfade(
                state.visualUri,
                animationSpec = tween(state.imageTransitionMs),
                label = "artwork",
            ) { uri ->
                Artwork(uri, Modifier.fillMaxSize(), fallback = true, blurredCover = true)
            }
        }
        state.layoutSource?.let { source ->
            ButtonLayoutView(source, state.buttons, onButton, Modifier.fillMaxSize())
        }
    }
}

@Composable
internal fun PlayerMetadataActions(
    state: PlaybackUiState,
    favorite: Boolean,
    onToggleFavorite: () -> Unit,
    onStats: () -> Unit,
    compact: Boolean,
) {
    val actionSize = if (compact) 44.dp else 52.dp
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                if (state.controls.showSceneName) state.sceneName.ifBlank { HiddenTextPlaceholder }
                else HiddenTextPlaceholder,
                color = Color.White,
                style =
                    if (compact) MaterialTheme.typography.titleMedium
                    else MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (state.controls.showFileName) state.fileName.ifBlank { HiddenTextPlaceholder }
                else HiddenTextPlaceholder,
                color = Color.White.copy(alpha = .62f),
                style =
                    if (compact) MaterialTheme.typography.bodySmall
                    else MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(
            onClick = onToggleFavorite,
            enabled = state.graphRef != null,
            modifier =
                Modifier.padding(start = if (compact) 6.dp else 10.dp)
                    .size(actionSize)
                    .background(
                        Color.White.copy(alpha = .08f),
                        RoundedCornerShape(if (compact) 14.dp else 16.dp),
                    ),
        ) {
            Icon(
                if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                if (favorite) "お気に入りから削除" else "お気に入りに追加",
                tint =
                    when {
                        state.graphRef == null -> Color.White.copy(alpha = .24f)
                        favorite -> MaterialTheme.colorScheme.primary
                        else -> Color.White.copy(alpha = .9f)
                    },
            )
        }
        IconButton(
            onClick = onStats,
            enabled = state.hasPlaybackStats,
            modifier =
                Modifier.padding(start = if (compact) 6.dp else 8.dp)
                    .size(actionSize)
                    .background(
                        Color.White.copy(alpha = .08f),
                        RoundedCornerShape(if (compact) 14.dp else 16.dp),
                    ),
        ) {
            Icon(
                Icons.Default.BarChart,
                "再生統計",
                tint = Color.White.copy(alpha = if (state.hasPlaybackStats) .9f else .24f),
            )
        }
    }
}

@Composable
internal fun PlayerProgress(state: PlaybackUiState, seek: (Long) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1)
    val progress = dragging ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    Column(Modifier.fillMaxWidth()) {
        if (state.controls.showSeekBar) {
            Slider(
                value = progress,
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    dragging?.let { seek((it * duration).roundToLong()) }
                    dragging = null
                },
                enabled = state.controls.allowSeek && state.durationMs > 0,
                modifier = Modifier.fillMaxWidth().height(38.dp),
            )
        } else {
            PlaybackWaveform(active = state.isPlaying)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                if (state.controls.showPlaybackTime)
                    formatDuration((progress * duration).roundToLong())
                else HiddenTimePlaceholder,
                color = Color.White.copy(alpha = .68f),
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                if (state.controls.showPlaybackTime) formatDuration(state.durationMs)
                else HiddenTimePlaceholder,
                color = Color.White.copy(alpha = .68f),
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
internal fun PlayerTransportControls(
    state: PlaybackUiState,
    toggle: () -> Unit,
    next: () -> Unit,
    previous: () -> Unit,
    compact: Boolean,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        val previousEnabled = state.controls.allowPrevious && state.canPrevious
        IconButton(
            onClick = previous,
            enabled = previousEnabled,
            modifier =
                Modifier.size(if (compact) 50.dp else 54.dp)
                    .background(Color.White.copy(alpha = .08f), RoundedCornerShape(18.dp)),
        ) {
            Icon(
                Icons.Default.SkipPrevious,
                "前のシーン",
                tint = Color.White.copy(alpha = if (previousEnabled) .9f else .24f),
            )
        }
        FilledIconButton(
            onClick = toggle,
            modifier = Modifier.size(if (compact) 68.dp else 72.dp),
            enabled = state.status != PlaybackStatus.LOADING,
        ) {
            Icon(
                if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                if (state.isPlaying) "一時停止" else "再生",
                Modifier.size(if (compact) 34.dp else 36.dp),
            )
        }
        val nextEnabled = state.controls.allowNext && state.canNext
        IconButton(
            onClick = next,
            enabled = nextEnabled,
            modifier =
                Modifier.size(if (compact) 50.dp else 54.dp)
                    .background(Color.White.copy(alpha = .08f), RoundedCornerShape(18.dp)),
        ) {
            Icon(
                Icons.Default.SkipNext,
                "次のシーン",
                tint = Color.White.copy(alpha = if (nextEnabled) .9f else .24f),
            )
        }
    }
}

@Composable
internal fun PlayerBottomActions(
    showInfo: () -> Unit,
    showTheme: () -> Unit,
    showLyrics: () -> Unit,
    lyricsAvailable: Boolean,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerBottomActionPill(
            modifier = Modifier.weight(1f),
            icon = Icons.Default.Info,
            label = "情報",
            enabled = true,
            onClick = showInfo,
        )
        Surface(
            onClick = showTheme,
            shape = CircleShape,
            color = Color.White.copy(alpha = .09f),
            contentColor = Color.White,
            modifier = Modifier.size(48.dp),
        ) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Palette, "テーマ", Modifier.size(22.dp))
            }
        }
        PlayerBottomActionPill(
            modifier = Modifier.weight(1f),
            icon = Icons.Default.Lyrics,
            label = "歌詞",
            enabled = lyricsAvailable,
            onClick = showLyrics,
        )
    }
}

@Composable
internal fun PlayerBottomActionPill(
    modifier: Modifier,
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(16.dp),
        color = Color.White.copy(alpha = if (enabled) .09f else .04f),
        contentColor = Color.White.copy(alpha = if (enabled) .92f else .24f),
        modifier = modifier.height(48.dp),
    ) {
        Row(
            Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, Modifier.size(22.dp))
            Spacer(Modifier.width(8.dp))
            Text(label, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
internal fun PlaybackWaveform(active: Boolean) {
    val transition = rememberInfiniteTransition(label = "playback waveform")
    val activeColor = MaterialTheme.colorScheme.primary
    val phase by
        transition.animateFloat(
            initialValue = 0f,
            targetValue = (PI * 48).toFloat(),
            animationSpec =
                infiniteRepeatable(
                    animation = tween(18_000, easing = LinearEasing),
                    repeatMode = RepeatMode.Restart,
                ),
            label = "playback waveform phase",
        )
    Canvas(Modifier.fillMaxWidth().height(40.dp)) {
        val bars = 32
        val step = size.width / bars
        val stroke = minOf(step * .32f, 4.dp.toPx())
        val runningPhase = if (active) phase else 0f
        repeat(bars) { index ->
            val position = index.toFloat() / bars
            val seed = ((index * 37) % 17) / 16f
            val speed = .75f + ((index * 7) % 3) * .25f
            val phaseOffset = ((index * 13) % 31) / 31f * (PI * 2).toFloat()
            val primary = (sin(runningPhase * speed + phaseOffset) + 1f) * .5f
            val secondary =
                (sin(runningPhase * .5f + phaseOffset * .7f + position * PI.toFloat() * 5f) + 1f) *
                    .5f
            val pulse =
                if (active) primary * .62f + secondary * .38f else primary * .35f + secondary * .25f
            val height = size.height * (.14f + pulse * (.42f + seed * .28f)).coerceIn(.14f, .94f)
            val drift =
                if (active) sin(runningPhase * .5f + phaseOffset) * size.height * .045f else 0f
            val centerY = size.height / 2f + drift
            val x = step * (index + .5f)
            drawLine(
                color =
                    if (active) activeColor.copy(alpha = .58f + seed * .38f)
                    else Color.White.copy(alpha = .24f + seed * .14f),
                start = Offset(x, centerY - height / 2f),
                end = Offset(x, centerY + height / 2f),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
internal fun ContentInfoDialog(state: PlaybackUiState, close: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    AlertDialog(
        onDismissRequest = close,
        icon = { Icon(Icons.Default.Info, null) },
        title = { Text(state.title.ifBlank { HiddenTextPlaceholder }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                state.author?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Text(
                    state.description ?: "説明は設定されていません。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                state.socialLinks.forEach { link ->
                    OutlinedButton(
                        onClick = { runCatching { uriHandler.openUri(link.url) } },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(link.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("閉じる") } },
    )
}
