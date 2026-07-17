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

@Composable
internal fun HistoryScreen(
    modifier: Modifier,
    app: YuraiveApplication,
    export: () -> Unit,
    onBack: () -> Unit,
    openInLibrary: (LibraryGraph) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<HistoryListItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var clearDialog by remember { mutableStateOf(false) }
    var version by remember { mutableStateOf(0) }
    LaunchedEffect(version) {
        loading = true
        loadError = null
        runCatching {
                val entries = app.history.readAll()
                val sessions = withContext(Dispatchers.Default) { buildPlaybackSessions(entries) }
                val graphs =
                    app.library.resolveGraphs(sessions.map(PlaybackSession::graphId)).associateBy {
                        it.ref.graphId
                    }
                sessions.map { session -> HistoryListItem(session, graphs[session.graphId]) }
            }
            .onSuccess { items = it }
            .onFailure { loadError = it.message ?: "履歴を読み込めません" }
        loading = false
    }
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("履歴", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
                },
                actions = {
                    IconButton(onClick = export, enabled = items.isNotEmpty()) {
                        Icon(Icons.Default.SaveAlt, "書き出し")
                    }
                    IconButton(onClick = { clearDialog = true }, enabled = items.isNotEmpty()) {
                        Icon(Icons.Default.DeleteOutline, "削除")
                    }
                },
            )
        },
    ) { padding ->
        when {
            loading ->
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            loadError != null ->
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text(loadError.orEmpty(), color = MaterialTheme.colorScheme.error)
                }
            items.isEmpty() ->
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text("再生履歴はありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            else ->
                CenteredContent(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    maxContentWidth = MaxListContentWidth,
                ) { listModifier ->
                    LazyColumn(
                        listModifier,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(items, key = { it.session.runId }) { item ->
                            HistorySessionCard(item, app) { item.graph?.let(openInLibrary) }
                        }
                    }
                }
        }
    }
    if (clearDialog)
        AlertDialog(
            onDismissRequest = { clearDialog = false },
            title = { Text("履歴を削除") },
            text = { Text("すべての再生履歴を削除します。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            app.history.clear()
                            version++
                        }
                        clearDialog = false
                    }
                ) {
                    Text("削除")
                }
            },
            dismissButton = { TextButton(onClick = { clearDialog = false }) { Text("キャンセル") } },
        )
}

internal data class PlaybackSession(
    val runId: String,
    val graphId: String,
    val startedAt: String,
    val endedAt: String,
    val activePlayMs: Long,
    val completed: Boolean,
)

internal fun buildPlaybackSessions(entries: List<PlaybackHistoryEntry>): List<PlaybackSession> =
    entries
        .groupBy(PlaybackHistoryEntry::runId)
        .mapNotNull { (runId, sessionEntries) ->
            val sorted = sessionEntries.sortedBy(PlaybackHistoryEntry::startedAt)
            val first = sorted.firstOrNull() ?: return@mapNotNull null
            val last = sorted.last()
            PlaybackSession(
                runId = runId,
                graphId = first.graphId,
                startedAt = first.startedAt,
                endedAt = last.endedAt,
                activePlayMs = sorted.sumOf(PlaybackHistoryEntry::activePlayMs),
                completed = last.endReason == "completed",
            )
        }
        .sortedByDescending(PlaybackSession::endedAt)

internal data class HistoryListItem(val session: PlaybackSession, val graph: LibraryGraph?)

@Composable
internal fun HistorySessionCard(item: HistoryListItem, app: YuraiveApplication, open: () -> Unit) {
    val session = item.session
    val graph = item.graph
    val thumbnailUri = rememberThumbnailUri(graph, app)
    Card(
        modifier =
            Modifier.fillMaxWidth()
                .defaultMinSize(minHeight = 120.dp)
                .then(if (graph != null) Modifier.clickable(onClick = open) else Modifier),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (graph != null) {
                Artwork(
                    thumbnailUri,
                    Modifier.size(96.dp).clip(RoundedCornerShape(14.dp)),
                    fallback = true,
                    blurredCover = true,
                )
            } else {
                Surface(
                    modifier = Modifier.size(96.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.WarningAmber,
                            null,
                            Modifier.size(32.dp),
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }
            Column(
                Modifier.weight(1f).padding(start = 14.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        graph?.displayName ?: historyGraphName(session.graphId),
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    HistoryCompletionBadge(session.completed)
                }
                Text(
                    graph?.ref?.contentFolderName ?: "作品が削除されています",
                    style = MaterialTheme.typography.bodySmall,
                    color =
                        if (graph == null) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (graph == null) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        Icons.Default.AccessTime,
                        null,
                        Modifier.size(15.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        formatDate(session.startedAt),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "再生 ${formatDuration(session.activePlayMs)}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (graph != null) {
                        Spacer(Modifier.weight(1f))
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            "ライブラリで開く",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun HistoryCompletionBadge(completed: Boolean) {
    Surface(
        shape = RoundedCornerShape(50),
        color =
            if (completed) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor =
            if (completed) MaterialTheme.colorScheme.onPrimaryContainer
            else MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (completed) Icon(Icons.Default.Check, null, Modifier.size(14.dp))
            Text(
                if (completed) "完了" else "未完了",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

internal fun historyGraphName(graphId: String): String =
    graphId
        .substringAfter("::", graphId)
        .substringAfterLast('/')
        .removeSuffix(".yuraive.json")
        .removeSuffix(".yuraive")
