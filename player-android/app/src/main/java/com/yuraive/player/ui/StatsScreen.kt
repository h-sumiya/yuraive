@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import android.content.Intent
import android.net.Uri
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
import androidx.core.graphics.*
import androidx.media3.ui.*
import com.yuraive.player.YuraiveApplication
import com.yuraive.player.data.*
import com.yuraive.player.model.*
import com.yuraive.player.playback.*
import java.time.*
import kotlin.math.*
import kotlinx.coroutines.*

internal enum class StatsSort {
    NEWEST,
    DEFAULT,
}

@Composable
internal fun PlaybackStatsScreen(
    ref: GraphRef,
    playback: PlaybackUiState,
    app: YuraiveApplication,
    onBack: () -> Unit,
    openHistory: () -> Unit,
) {
    var data by remember(ref.graphId) { mutableStateOf<PlaybackStatsData?>(null) }
    var error by remember(ref.graphId) { mutableStateOf<String?>(null) }
    var loading by remember(ref.graphId) { mutableStateOf(true) }
    var refresh by remember { mutableStateOf(0) }
    var sort by remember { mutableStateOf(StatsSort.DEFAULT) }
    var share by remember { mutableStateOf<ShareData?>(null) }

    LaunchedEffect(
        ref.graphId,
        playback.runId,
        playback.status,
        playback.historyEntryCount,
        refresh,
    ) {
        loading = true
        error = null
        runCatching { app.playbackStats.evaluate(ref, playback) }
            .onSuccess { data = it }
            .onFailure { error = it.message ?: "再生統計を読み込めません" }
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("再生統計", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
                },
                actions = {
                    IconButton(onClick = { refresh++ }, enabled = !loading) {
                        Icon(Icons.Default.Refresh, "再読み込み")
                    }
                },
            )
        }
    ) { padding ->
        when {
            loading && data == null ->
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            error != null && data == null ->
                Column(
                    Modifier.fillMaxSize().padding(padding).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Default.WarningAmber, null, tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(12.dp))
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = { refresh++ }) { Text("再試行") }
                }
            data != null -> {
                val stats = data!!
                val currentItem =
                    playback.runId?.let { runId ->
                        stats.items.firstOrNull { it.session.runId == runId }
                    } ?: stats.items.firstOrNull { it.session.isActive }
                val currentRunId = currentItem?.session?.runId
                val ordered =
                    stats.items
                        .filterNot { it.session.runId == currentRunId }
                        .sortedWith { left, right ->
                            val primary =
                                when (sort) {
                                    StatsSort.NEWEST ->
                                        right.session.startedAt.compareTo(left.session.startedAt)
                                    StatsSort.DEFAULT ->
                                        compareNullableStatsDescending(
                                            left.sortValue,
                                            right.sortValue,
                                        )
                                }
                            if (primary != 0) primary
                            else
                                right.session.startedAt.compareTo(left.session.startedAt).takeIf {
                                    it != 0
                                } ?: left.session.runId.compareTo(right.session.runId)
                        }
                CenteredContent(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    maxContentWidth = MaxListContentWidth,
                ) { listModifier ->
                    LazyColumn(
                        listModifier,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        item {
                            Text(
                                stats.title,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        currentItem?.let { item ->
                            item(key = "current:${item.session.runId}") {
                                PlaybackStatsCard(ref, item, app, onShare = { share = it })
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                StatsSummaryCard(
                                    "再生回数",
                                    stats.aggregate.sessionCount.toString(),
                                    Modifier.weight(1f),
                                )
                                StatsSummaryCard(
                                    "累計再生",
                                    formatStatsDuration(stats.aggregate.activePlayMs),
                                    Modifier.weight(1f),
                                )
                                StatsSummaryCard(
                                    "最終再生",
                                    stats.aggregate.lastEndedAt?.let(::formatDate) ?: "—",
                                    Modifier.weight(1f),
                                )
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                StatsSort.entries.forEach { option ->
                                    val label =
                                        when (option) {
                                            StatsSort.NEWEST -> "新しい順"
                                            StatsSort.DEFAULT -> "デフォルト"
                                        }
                                    Surface(
                                        onClick = { sort = option },
                                        shape = RoundedCornerShape(12.dp),
                                        color =
                                            if (sort == option)
                                                MaterialTheme.colorScheme.secondaryContainer
                                            else MaterialTheme.colorScheme.surfaceContainer,
                                        contentColor =
                                            if (sort == option)
                                                MaterialTheme.colorScheme.onSecondaryContainer
                                            else MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Text(
                                            label,
                                            Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
                                            textAlign = TextAlign.Center,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                    }
                                }
                            }
                        }
                        if (currentItem == null && ordered.isEmpty())
                            item {
                                Box(
                                    Modifier.fillMaxWidth().padding(vertical = 48.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "統計対象の再生セッションはありません",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        items(ordered, key = { it.session.runId }) { item ->
                            PlaybackStatsCard(ref, item, app, onShare = { share = it })
                        }
                        item {
                            OutlinedButton(
                                onClick = openHistory,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.History, null)
                                Spacer(Modifier.width(8.dp))
                                Text("再生履歴を見る")
                            }
                        }
                    }
                }
            }
        }
    }
    share?.let { SharePreviewDialog(it, close = { share = null }) }
}

internal fun compareNullableStatsDescending(left: Long?, right: Long?): Int =
    when {
        left == null && right == null -> 0
        left == null -> 1
        right == null -> -1
        else -> right.compareTo(left)
    }

@Composable
internal fun StatsSummaryCard(label: String, value: String, modifier: Modifier) {
    Surface(
        modifier,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            Text(
                value,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun PlaybackStatsCard(
    ref: GraphRef,
    item: PlaybackStatsItem,
    app: YuraiveApplication,
    onShare: (ShareData) -> Unit,
) {
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (item.session.isActive) "再生中" else formatDate(item.session.startedAt),
                    fontWeight = FontWeight.SemiBold,
                    color =
                        if (item.session.isActive) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "${item.session.entryCount}シーン · ${formatStatsDuration(item.session.activePlayMs)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item.sortValue?.let {
                Text(
                    it.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item.share?.let { content ->
                IconButton(onClick = { onShare(content) }) { Icon(Icons.Default.Share, "共有") }
            }
        }
        HorizontalDivider()
        if (item.error != null) {
            Row(
                Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Default.WarningAmber, null, tint = MaterialTheme.colorScheme.error)
                Text(
                    item.error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        } else
            item.display?.let { document ->
                DisplayDocumentView(document, ref, app, Modifier.fillMaxWidth().padding(14.dp))
            }
    }
}

@Composable
internal fun DisplayDocumentView(
    document: DisplayDocument,
    ref: GraphRef,
    app: YuraiveApplication,
    modifier: Modifier = Modifier,
) {
    DisplayNodeView(document.root, ref, app, modifier)
}

@Composable
internal fun DisplayNodeView(
    node: DisplayNode,
    ref: GraphRef,
    app: YuraiveApplication,
    modifier: Modifier = Modifier,
) {
    val styled = modifier.displayStyle(node.style)
    when (node.type) {
        "column",
        "surface" ->
            Box(styled) {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = node.style.horizontalAlignment.toHorizontalAlignment(),
                    verticalArrangement =
                        Arrangement.spacedBy(
                            (node.style.gap ?: 0f).dp,
                            node.style.verticalAlignment.toVerticalAlignment(),
                        ),
                ) {
                    node.children.forEach { DisplayNodeView(it, ref, app) }
                }
            }
        "row" ->
            Box(styled) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = node.style.verticalAlignment.toVerticalAlignment(),
                    horizontalArrangement =
                        Arrangement.spacedBy(
                            (node.style.gap ?: 0f).dp,
                            node.style.horizontalAlignment.toHorizontalAlignment(),
                        ),
                ) {
                    node.children.forEach { DisplayNodeView(it, ref, app) }
                }
            }
        "stack" ->
            Box(styled) {
                node.children.forEach { child ->
                    DisplayNodeView(
                        child,
                        ref,
                        app,
                        Modifier.align(child.style.align.toBoxAlignment()),
                    )
                }
            }
        "text" -> {
            val textColor = parseColor(node.style.color, MaterialTheme.colorScheme.onSurface)
            val textAlign = node.style.textAlign.toTextAlign()
            if (node.spans.isEmpty()) {
                Text(
                    node.text.orEmpty(),
                    styled,
                    color = textColor,
                    fontSize = (node.style.fontSize ?: 14f).sp,
                    fontWeight = displayFontWeight(node.style.fontWeight),
                    lineHeight = (node.style.lineHeight ?: (node.style.fontSize ?: 14f) * 1.25f).sp,
                    maxLines = node.style.maxLines ?: Int.MAX_VALUE,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = textAlign,
                )
            } else {
                val rich = buildAnnotatedString {
                    node.spans.forEach { span ->
                        withStyle(
                            SpanStyle(
                                color = parseColor(span.style.color, textColor),
                                fontSize = (span.style.fontSize ?: node.style.fontSize ?: 14f).sp,
                                fontWeight =
                                    displayFontWeight(
                                        span.style.fontWeight ?: node.style.fontWeight
                                    ),
                            )
                        ) {
                            append(span.text)
                        }
                    }
                }
                Text(
                    rich,
                    styled,
                    textAlign = textAlign,
                    maxLines = node.style.maxLines ?: Int.MAX_VALUE,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        "image" -> DisplayAssetImage(node.source.orEmpty(), ref, app, styled)
        "icon" ->
            Box(styled, contentAlignment = Alignment.Center) {
                Icon(
                    displayIcon(node.icon),
                    node.label,
                    tint = parseColor(node.style.color, MaterialTheme.colorScheme.primary),
                    modifier = Modifier.size((node.style.fontSize ?: 24f).dp),
                )
            }
        "badge" ->
            Surface(
                modifier = styled,
                shape = RoundedCornerShape((node.style.cornerRadius ?: 999f).dp),
                color =
                    parseColor(
                        node.style.backgroundColor,
                        MaterialTheme.colorScheme.secondaryContainer,
                    ),
                contentColor =
                    parseColor(node.style.color, MaterialTheme.colorScheme.onSecondaryContainer),
            ) {
                Text(
                    node.text.orEmpty(),
                    Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        "progress" ->
            Column(styled, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                node.label?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelMedium,
                        color =
                            parseColor(node.style.color, MaterialTheme.colorScheme.onSurfaceVariant),
                    )
                }
                LinearProgressIndicator(
                    progress = { node.value ?: 0f },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        "divider" ->
            HorizontalDivider(
                styled,
                thickness = (node.style.height as? DisplayDimension.Fixed)?.value?.dp ?: 1.dp,
                color = parseColor(node.style.color, MaterialTheme.colorScheme.outlineVariant),
            )
        "spacer" ->
            Spacer(styled.then(if (node.style.height == null) Modifier.height(8.dp) else Modifier))
    }
}

@Composable
internal fun DisplayAssetImage(
    path: String,
    ref: GraphRef,
    app: YuraiveApplication,
    modifier: Modifier,
) {
    var uri by remember(ref.graphId, path) { mutableStateOf<String?>(null) }
    LaunchedEffect(ref.graphId, path) { uri = app.library.assetUri(ref, path)?.toString() }
    Artwork(uri, modifier, fallback = true, blurredCover = false)
}

internal fun Modifier.displayStyle(style: DisplayStyle): Modifier {
    var result = this
    result =
        when (val width = style.width) {
            is DisplayDimension.Fixed -> result.width(width.value.dp)
            DisplayDimension.Fill -> result.fillMaxWidth()
            DisplayDimension.Wrap -> result.wrapContentWidth()
            null -> result
        }
    result =
        when (val height = style.height) {
            is DisplayDimension.Fixed -> result.height(height.value.dp)
            DisplayDimension.Fill -> result.fillMaxHeight()
            DisplayDimension.Wrap -> result.wrapContentHeight()
            null -> result
        }
    style.minHeight?.let { result = result.defaultMinSize(minHeight = it.dp) }
    style.aspectRatio?.let { result = result.aspectRatio(it) }
    if (style.offsetX != null || style.offsetY != null)
        result = result.offset((style.offsetX ?: 0f).dp, (style.offsetY ?: 0f).dp)
    style.opacity?.let { alpha -> result = result.graphicsLayer { this.alpha = alpha } }
    val shape = RoundedCornerShape((style.cornerRadius ?: 0f).dp)
    if (style.cornerRadius != null) result = result.clip(shape)
    style.backgroundColor?.let {
        result = result.background(parseColor(it, Color.Transparent), shape)
    }
    if (style.borderWidth != null && style.borderWidth > 0 && style.borderColor != null) {
        result =
            result.border(
                style.borderWidth.dp,
                parseColor(style.borderColor, Color.Transparent),
                shape,
            )
    }
    style.padding?.let { result = result.padding(it.dp) }
    return result
}

internal fun String?.toHorizontalAlignment() =
    when (this) {
        "center" -> Alignment.CenterHorizontally
        "end" -> Alignment.End
        else -> Alignment.Start
    }

internal fun String?.toVerticalAlignment() =
    when (this) {
        "top" -> Alignment.Top
        "bottom" -> Alignment.Bottom
        else -> Alignment.CenterVertically
    }

internal fun String?.toTextAlign() =
    when (this) {
        "center" -> TextAlign.Center
        "end" -> TextAlign.End
        else -> TextAlign.Start
    }

internal fun String?.toBoxAlignment() =
    when (this) {
        "topCenter" -> Alignment.TopCenter
        "topEnd" -> Alignment.TopEnd
        "centerStart" -> Alignment.CenterStart
        "center" -> Alignment.Center
        "centerEnd" -> Alignment.CenterEnd
        "bottomStart" -> Alignment.BottomStart
        "bottomCenter" -> Alignment.BottomCenter
        "bottomEnd" -> Alignment.BottomEnd
        else -> Alignment.TopStart
    }

internal fun displayFontWeight(value: Int?) =
    when ((value ?: 400)) {
        in 100..299 -> FontWeight.Light
        in 300..499 -> FontWeight.Normal
        in 500..699 -> FontWeight.SemiBold
        else -> FontWeight.Bold
    }

internal fun displayIcon(value: String?): ImageVector =
    when (value) {
        "history" -> Icons.Default.History
        "timer" -> Icons.Default.AccessTime
        "star" -> Icons.Default.Star
        "favorite" -> Icons.Default.Favorite
        "sleep" -> Icons.Default.Bedtime
        "trophy" -> Icons.Default.EmojiEvents
        "stats" -> Icons.Default.BarChart
        else -> Icons.Default.PlayArrow
    }

@Composable
internal fun SharePreviewDialog(share: ShareData, close: () -> Unit) {
    val context = LocalContext.current
    var draft by remember(share) { mutableStateOf(share.composedText()) }
    val weightedLength = shareWeightedLength(draft)
    AlertDialog(
        onDismissRequest = close,
        icon = { Icon(Icons.Default.Share, null) },
        title = { Text("共有内容を確認") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 5,
                    maxLines = 8,
                    label = { Text("共有するテキスト") },
                )
                Text(
                    "X換算: $weightedLength / 280" + if (weightedLength > 280) "（上限を超えています）" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color =
                        if (weightedLength > 280) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val intent =
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, draft)
                        }
                    context.startActivity(Intent.createChooser(intent, "再生統計を共有"))
                    close()
                },
                enabled = draft.isNotBlank(),
            ) {
                Text("共有")
            }
        },
        dismissButton = {
            Row {
                TextButton(
                    onClick = {
                        val uri =
                            Uri.parse("https://x.com/intent/post")
                                .buildUpon()
                                .appendQueryParameter("text", draft)
                                .build()
                        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                        close()
                    },
                    enabled = draft.isNotBlank() && weightedLength <= 280,
                ) {
                    Text("Xで開く")
                }
                TextButton(onClick = close) { Text("キャンセル") }
            }
        },
    )
}

internal fun shareWeightedLength(value: String): Int {
    val url = Regex("https://\\S+")
    var total = 0
    var cursor = 0
    url.findAll(value).forEach { match ->
        total +=
            value.substring(cursor, match.range.first).codePoints().toArray().fold(0) {
                sum,
                codePoint ->
                sum + xCodePointWeight(codePoint)
            }
        total += 23
        cursor = match.range.last + 1
    }
    return total +
        value.substring(cursor).codePoints().toArray().fold(0) { sum, codePoint ->
            sum + xCodePointWeight(codePoint)
        }
}

internal fun xCodePointWeight(codePoint: Int): Int =
    if (
        codePoint in 0..0x10FF ||
            codePoint in 0x2000..0x200D ||
            codePoint in 0x2010..0x201F ||
            codePoint in 0x2032..0x2037
    )
        1
    else 2

internal fun formatStatsDuration(value: Long): String {
    val minutes = value.coerceAtLeast(0) / 60_000
    return if (minutes >= 60) "${minutes / 60}時間${minutes % 60}分" else "${minutes}分"
}
