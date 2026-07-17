@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import android.graphics.BitmapFactory
import android.content.Intent
import android.net.Uri
import android.util.LruCache
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Update
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.toColorInt
import androidx.core.view.WindowCompat
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.yuraive.player.R
import com.yuraive.player.YuraiveApplication
import com.yuraive.player.data.LibraryDirectory
import com.yuraive.player.data.AssetInspectionProblem
import com.yuraive.player.data.LibraryAssetInspection
import com.yuraive.player.data.LibraryContentInspection
import com.yuraive.player.data.LibraryFolder
import com.yuraive.player.data.LibraryGraph
import com.yuraive.player.data.LibraryRoot
import com.yuraive.player.data.PlayerSettings
import com.yuraive.player.data.RootGrant
import com.yuraive.player.data.ThemeMode
import com.yuraive.player.data.WindowsConnectionStatus
import com.yuraive.player.data.WindowsDeviceConnection
import com.yuraive.player.data.isContent
import com.yuraive.player.data.previewGraph
import com.yuraive.player.model.GraphRef
import com.yuraive.player.model.PlaybackHistoryEntry
import com.yuraive.player.model.ValidationIssue
import com.yuraive.player.playback.PlaybackRuntime
import com.yuraive.player.playback.PlaybackStatus
import com.yuraive.player.playback.PlaybackUiState
import com.yuraive.player.playback.DisplayDimension
import com.yuraive.player.playback.DisplayDocument
import com.yuraive.player.playback.DisplayNode
import com.yuraive.player.playback.DisplayStyle
import com.yuraive.player.playback.PlaybackStatsData
import com.yuraive.player.playback.PlaybackStatsItem
import com.yuraive.player.playback.ShareData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToLong
import kotlin.math.roundToInt
import kotlin.math.PI
import kotlin.math.sin

private enum class Destination { LIBRARY, HISTORY, SETTINGS, LICENSES }

private data class GraphCollection(
    val title: String,
    val graphs: List<LibraryGraph> = emptyList(),
    val loading: Boolean = false,
)

private val accents = listOf(
    Color(0xFF944BF8),
    Color(0xFF02A5FE),
    Color(0xFF3147D4),
    Color(0xFF574DE5),
)

private const val HiddenTextPlaceholder = "???"
private const val HiddenTimePlaceholder = "??:??"
private val MaxGridContentWidth = 1_200.dp
private val MaxListContentWidth = 900.dp
private val MaxSettingsContentWidth = 720.dp
private val MaxPortraitPlayerWidth = 560.dp

internal fun adaptiveGridColumnCount(widthDp: Int): Int = when {
    widthDp < 600 -> 2
    widthDp < 840 -> 3
    widthDp < 1_200 -> 4
    else -> 5
}

internal fun isTwoPanePlayerLayout(widthDp: Int, heightDp: Int): Boolean = widthDp > heightDp

@Composable
private fun AdaptiveGrid(
    modifier: Modifier = Modifier,
    content: LazyGridScope.() -> Unit,
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.TopCenter) {
        val gridWidth = maxWidth.coerceAtMost(MaxGridContentWidth)
        LazyVerticalGrid(
            columns = GridCells.Fixed(adaptiveGridColumnCount(gridWidth.value.toInt())),
            modifier = Modifier.fillMaxHeight().width(gridWidth),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun CenteredContent(
    modifier: Modifier,
    maxContentWidth: androidx.compose.ui.unit.Dp,
    content: @Composable (Modifier) -> Unit,
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.TopCenter) {
        content(Modifier.fillMaxHeight().width(maxWidth.coerceAtMost(maxContentWidth)))
    }
}

@Composable
fun YuraiveApp(
    addFolder: () -> Unit,
    pairWindows: () -> Unit,
    exportHistory: () -> Unit,
    ensureNotificationPermission: () -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as YuraiveApplication
    val settings by app.settings.state.collectAsStateWithLifecycle()
    val playback by PlaybackRuntime.state.collectAsStateWithLifecycle()
    val roots by app.library.roots.collectAsStateWithLifecycle()
    val knownGraphs by app.library.knownGraphs.collectAsStateWithLifecycle()
    val favoriteIds by app.library.favoriteIds.collectAsStateWithLifecycle()
    val windowsConnectionStates by app.library.windowsConnectionStates.collectAsStateWithLifecycle()
    val player by PlaybackRuntime.player.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var destination by rememberSaveable { mutableStateOf(Destination.LIBRARY) }
    var showPlayer by rememberSaveable { mutableStateOf(false) }
    var showStats by rememberSaveable { mutableStateOf(false) }
    var browserRoot by remember { mutableStateOf<LibraryRoot?>(null) }
    var browserRootUri by rememberSaveable { mutableStateOf<String?>(null) }
    var browserInitialPath by rememberSaveable { mutableStateOf<String?>(null) }
    var collection by remember { mutableStateOf<GraphCollection?>(null) }
    var savedCollectionTitle by rememberSaveable { mutableStateOf<String?>(null) }
    var savedCollectionGraphIds by rememberSaveable { mutableStateOf<ArrayList<String>?>(null) }
    var libraryRoots by remember { mutableStateOf<List<LibraryRoot>>(emptyList()) }
    var validation by remember { mutableStateOf<Pair<GraphRef, List<ValidationIssue>>?>(null) }
    var inspectedGraph by remember { mutableStateOf<LibraryGraph?>(null) }
    var scanVersion by remember { mutableStateOf(0) }
    var showAddFolderDialog by rememberSaveable { mutableStateOf(false) }
    val windowsDevices = remember(roots, windowsConnectionStates) { app.library.windowsDevices() }

    val activeBrowserRoot = browserRoot ?: browserRootUri?.let { uri ->
        libraryRoots.firstOrNull { it.grant.uri == uri }
            ?: roots.firstOrNull { it.uri == uri }?.let(::LibraryRoot)
    }

    fun updateCollection(value: GraphCollection?, graphIds: List<String>? = value?.graphs.orEmpty().map { it.ref.graphId }) {
        collection = value
        savedCollectionTitle = value?.title
        savedCollectionGraphIds = value?.let { graphIds?.let { ids -> ArrayList(ids) } }
    }

    fun updateBrowserRoot(value: LibraryRoot?) {
        browserRoot = value
        browserRootUri = value?.grant?.uri
    }

    BackHandler(enabled = showStats) { showStats = false }
    BackHandler(enabled = showPlayer && !showStats) { showPlayer = false }
    BackHandler(enabled = !showPlayer && collection != null) { updateCollection(null) }
    BackHandler(enabled = !showPlayer && activeBrowserRoot != null) {
        updateBrowserRoot(null)
        browserInitialPath = null
    }
    BackHandler(enabled = !showPlayer && activeBrowserRoot == null && collection == null && destination == Destination.LICENSES) {
        destination = Destination.SETTINGS
    }
    BackHandler(enabled = !showPlayer && activeBrowserRoot == null && collection == null && destination in setOf(Destination.HISTORY, Destination.SETTINGS)) {
        destination = Destination.LIBRARY
    }
    BackHandler(enabled = inspectedGraph != null) { inspectedGraph = null }

    val playerVisible = showPlayer && !showStats && playback.status != PlaybackStatus.IDLE
    val dark = when (settings.themeMode) {
        ThemeMode.SYSTEM -> androidx.compose.foundation.isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? ComponentActivity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark && !playerVisible
            isAppearanceLightNavigationBars = !dark && !playerVisible
        }
    }
    DisposableEffect(view, playerVisible, settings.keepScreenOnInPlayer) {
        view.keepScreenOn = playerVisible && settings.keepScreenOnInPlayer
        onDispose { view.keepScreenOn = false }
    }

    LaunchedEffect(roots, scanVersion) {
        libraryRoots = roots.map(::LibraryRoot)
        libraryRoots = app.library.scanAll()
    }

    LaunchedEffect(savedCollectionTitle, savedCollectionGraphIds) {
        val title = savedCollectionTitle ?: return@LaunchedEffect
        if (collection != null) return@LaunchedEffect
        val graphIds = savedCollectionGraphIds ?: if (title == "再生した作品") {
            app.history.readAll().map { it.graphId }.distinct()
        } else {
            emptyList()
        }
        savedCollectionGraphIds = ArrayList(graphIds)
        val resolved = app.library.resolveGraphs(graphIds)
        if (savedCollectionTitle == title && collection == null) {
            collection = GraphCollection(title, resolved)
        }
    }

    val openGraph: (LibraryGraph) -> Unit = { item ->
        if (item.parseError == null) scope.launch {
            runCatching {
                val graph = app.library.readGraph(item.ref)
                item.ref to app.library.validate(item.ref, graph)
            }.onSuccess { (ref, issues) ->
                if (issues.isEmpty()) {
                    ensureNotificationPermission()
                    PlaybackRuntime.play(context, ref)
                    showPlayer = true
                } else validation = ref to issues
            }.onFailure {
                validation = item.ref to listOf(ValidationIssue(ValidationIssue.Severity.ERROR, it.message ?: "読み込めません"))
            }
        }
    }

    val showResolvedCollection: (String, List<String>) -> Unit = { title, graphIds ->
        updateCollection(GraphCollection(title, loading = true), graphIds)
        scope.launch {
            val resolved = app.library.resolveGraphs(graphIds)
            if (collection?.title == title && collection?.loading == true) {
                updateCollection(GraphCollection(title, resolved))
            }
        }
    }

    val userAccent = accents[settings.accentIndex.mod(accents.size)]
    val activeAccent = if (showPlayer) playback.controls.accentColor?.let { parseColor(it, userAccent) } ?: userAccent else userAccent
    YuraiveTheme(dark = dark, accent = activeAccent) {
        Surface(Modifier.fillMaxSize()) {
            if (inspectedGraph != null) {
                ContentInspectionScreen(
                    graph = inspectedGraph!!,
                    app = app,
                    onBack = { inspectedGraph = null },
                )
            } else if (showStats && playback.graphRef != null) {
                PlaybackStatsScreen(
                    ref = playback.graphRef!!,
                    playback = playback,
                    app = app,
                    onBack = { showStats = false },
                    openHistory = {
                        showStats = false
                        showPlayer = false
                        destination = Destination.HISTORY
                    },
                )
            } else if (playerVisible) {
                PlayerScreen(
                    state = playback,
                    player = player,
                    favorite = playback.graphRef?.graphId in favoriteIds,
                    onBack = { showPlayer = false },
                    onToggle = { PlaybackRuntime.toggle(context) },
                    onSeek = { PlaybackRuntime.seek(context, it) },
                    onRetry = { PlaybackRuntime.restart(context) },
                    onNext = { PlaybackRuntime.next(context) },
                    onPrevious = { PlaybackRuntime.previous(context) },
                    onToggleFavorite = { playback.graphRef?.graphId?.let(app.library::toggleFavorite) },
                    onStats = { if (playback.hasPlaybackStats) showStats = true },
                    onTheme = {
                        showPlayer = false
                        updateCollection(null)
                        updateBrowserRoot(null)
                        destination = Destination.SETTINGS
                    },
                    onButton = { PlaybackRuntime.pressButton(context, it) },
                )
            } else {
                MainScaffold(
                    playback = playback,
                    openPlayer = { showPlayer = true },
                    togglePlayback = { PlaybackRuntime.toggle(context) },
                    stopPlayback = { PlaybackRuntime.stop(context) },
                ) { padding ->
                    when {
                        collection != null -> Box(Modifier.fillMaxSize().padding(padding)) {
                            GraphCollectionScreen(
                                collection = collection!!,
                                favoriteIds = favoriteIds,
                                onBack = { updateCollection(null) },
                                openGraph = openGraph,
                                inspectGraph = { inspectedGraph = it },
                                toggleFavorite = app.library::toggleFavorite,
                            )
                        }
                        activeBrowserRoot != null -> Box(Modifier.fillMaxSize().padding(padding)) {
                            DirectoryBrowserScreen(
                                root = activeBrowserRoot,
                                initialPath = browserInitialPath,
                                app = app,
                                favoriteIds = favoriteIds,
                                onBack = {
                                    updateBrowserRoot(null)
                                    browserInitialPath = null
                                },
                                openGraph = openGraph,
                                inspectGraph = { inspectedGraph = it },
                                toggleFavorite = app.library::toggleFavorite,
                            )
                        }
                        destination == Destination.LIBRARY -> LibraryScreen(
                            modifier = Modifier.padding(padding),
                            roots = libraryRoots,
                            windowsDevices = windowsDevices,
                            addFolder = { showAddFolderDialog = true },
                            refresh = {
                                app.library.refreshWindowsDevices()
                                scanVersion++
                            },
                            removeRoot = { app.library.removeRoot(it) },
                            removeWindowsDevice = app.library::removeWindowsDevice,
                            refreshWindowsDevice = { deviceId ->
                                app.library.refreshWindowsDevice(deviceId)
                                scanVersion++
                            },
                            browseRoot = { root ->
                                browserInitialPath = null
                                if (root.directory?.isContent == true) {
                                    updateCollection(GraphCollection(root.grant.name, root.directory.graphs))
                                } else {
                                    updateBrowserRoot(root)
                                }
                            },
                            knownGraphs = knownGraphs,
                            favoriteIds = favoriteIds,
                            openHistory = { destination = Destination.HISTORY },
                            openSettings = { destination = Destination.SETTINGS },
                            openPlayed = {
                                updateCollection(GraphCollection("再生した作品", loading = true), graphIds = null)
                                scope.launch {
                                    val ids = app.history.readAll().map { it.graphId }.distinct()
                                    val graphs = app.library.resolveGraphs(ids)
                                    if (collection?.title == "再生した作品" && collection?.loading == true) {
                                        updateCollection(GraphCollection("再生した作品", graphs))
                                    }
                                }
                            },
                            openRecent = {
                                updateCollection(GraphCollection(
                                    "最近追加",
                                    knownGraphs.sortedByDescending(LibraryGraph::modifiedAt),
                                ))
                            },
                            openFavorites = {
                                showResolvedCollection("最近のお気に入り", app.library.favoriteIdsByRecent())
                            },
                            shuffle = {
                                knownGraphs.filter { it.parseError == null }.randomOrNull()?.let(openGraph)
                                    ?: run { updateCollection(GraphCollection("シャッフル", emptyList())) }
                            },
                            openGraph = openGraph,
                            inspectGraph = { inspectedGraph = it },
                            toggleFavorite = app.library::toggleFavorite,
                        )
                        destination == Destination.HISTORY -> HistoryScreen(
                            modifier = Modifier.padding(padding),
                            app = app,
                            export = exportHistory,
                            onBack = { destination = Destination.LIBRARY },
                            openInLibrary = { graph ->
                                val root = libraryRoots.firstOrNull { it.grant.uri == graph.ref.rootUri }
                                    ?: LibraryRoot(RootGrant(graph.ref.rootUri, graph.ref.rootName))
                                destination = Destination.LIBRARY
                                updateCollection(null)
                                browserInitialPath = graph.ref.parentPath
                                updateBrowserRoot(root)
                            },
                        )
                        destination == Destination.SETTINGS -> SettingsScreen(
                            modifier = Modifier.padding(padding),
                            settings = settings,
                            update = app.settings::update,
                            onBack = { destination = Destination.LIBRARY },
                            openLicenses = { destination = Destination.LICENSES },
                        )
                        else -> LicensesScreen(
                            modifier = Modifier.padding(padding),
                            onBack = { destination = Destination.SETTINGS },
                        )
                    }
                }
            }
        }

        validation?.let { (ref, issues) ->
            val errors = issues.filter { it.severity == ValidationIssue.Severity.ERROR }
            AlertDialog(
                onDismissRequest = { validation = null },
                icon = { Icon(Icons.Default.WarningAmber, null) },
                title = { Text(if (errors.isEmpty()) "確認" else "再生できません") },
                text = {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(issues) { issue ->
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(if (issue.severity == ValidationIssue.Severity.ERROR) "●" else "△", color = if (issue.severity == ValidationIssue.Severity.ERROR) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary)
                                Text(issue.message, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                },
                confirmButton = {
                    if (errors.isEmpty()) Button(onClick = {
                        validation = null
                        ensureNotificationPermission()
                        PlaybackRuntime.play(context, ref)
                        showPlayer = true
                    }) { Text("再生") }
                    else TextButton(onClick = { validation = null }) { Text("閉じる") }
                },
                dismissButton = { if (errors.isEmpty()) TextButton(onClick = { validation = null }) { Text("キャンセル") } },
            )
        }

        if (showAddFolderDialog) {
            RemoteFolderDialog(
                library = app.library,
                onDismiss = { showAddFolderDialog = false },
                onSelectLocal = addFolder,
                onSelectWindows = pairWindows,
            )
        }
    }
}

@Composable
private fun MainScaffold(
    playback: PlaybackUiState,
    openPlayer: () -> Unit,
    togglePlayback: () -> Unit,
    stopPlayback: () -> Unit,
    content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit,
) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            AnimatedVisibility(playback.status != PlaybackStatus.IDLE) {
                Column(Modifier.navigationBarsPadding()) {
                    MiniPlayer(playback, openPlayer, togglePlayback, stopPlayback)
                }
            }
        },
        content = content,
    )
}

@Composable
private fun MiniPlayer(state: PlaybackUiState, open: () -> Unit, toggle: () -> Unit, stop: () -> Unit) {
    var rawDragOffset by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val swipeThreshold = with(LocalDensity.current) { 56.dp.toPx() }
    val dragOffset by animateFloatAsState(
        targetValue = if (dragging) rawDragOffset else 0f,
        animationSpec = if (dragging) snap() else tween(160),
        label = "mini player swipe offset",
    )
    Surface(
        tonalElevation = 3.dp,
        modifier = Modifier
            .fillMaxWidth()
            .height(70.dp)
            .graphicsLayer {
                translationY = dragOffset
                alpha = 1f - (dragOffset / size.height.coerceAtLeast(1f)).coerceIn(0f, .55f)
            }
            .pointerInput(swipeThreshold) {
                detectVerticalDragGestures(
                    onDragStart = { dragging = true },
                    onDragCancel = {
                        dragging = false
                        rawDragOffset = 0f
                    },
                    onDragEnd = {
                        val dismiss = rawDragOffset >= swipeThreshold
                        dragging = false
                        rawDragOffset = 0f
                        if (dismiss) stop()
                    },
                ) { change, amount ->
                    val nextOffset = (rawDragOffset + amount).coerceAtLeast(0f)
                    if (amount > 0f || rawDragOffset > 0f) change.consume()
                    rawDragOffset = nextOffset
                }
            }
            .clickable(onClick = open),
    ) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(state.visualUri, Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)), fallback = true)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    state.title.ifBlank { HiddenTextPlaceholder },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(state.error ?: playerSecondaryLabel(state), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = if (state.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = toggle, enabled = state.status != PlaybackStatus.LOADING) {
                Icon(if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, null)
            }
        }
    }
}

@Composable
private fun LibraryScreen(
    modifier: Modifier,
    roots: List<LibraryRoot>,
    windowsDevices: List<WindowsDeviceConnection>,
    addFolder: () -> Unit,
    refresh: () -> Unit,
    removeRoot: (String) -> Unit,
    removeWindowsDevice: (String) -> Unit,
    refreshWindowsDevice: (String) -> Unit,
    browseRoot: (LibraryRoot) -> Unit,
    knownGraphs: List<LibraryGraph>,
    favoriteIds: Set<String>,
    openHistory: () -> Unit,
    openSettings: () -> Unit,
    openPlayed: () -> Unit,
    openRecent: () -> Unit,
    openFavorites: () -> Unit,
    shuffle: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
    inspectGraph: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as YuraiveApplication
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    BackHandler(enabled = searching) {
        searching = false
        query = ""
    }
    val normalizedQuery = query.trim()
    val windowsRootUris = windowsDevices.flatMapTo(mutableSetOf(), WindowsDeviceConnection::rootUris)
    val localRoots = roots.filterNot { it.grant.uri in windowsRootUris }
    val filteredRoots = if (normalizedQuery.isEmpty()) roots else roots.filter {
        it.grant.name.contains(normalizedQuery, ignoreCase = true)
    }
    val filteredGraphs = if (normalizedQuery.isEmpty()) knownGraphs else knownGraphs.filter {
        it.displayName.contains(normalizedQuery, ignoreCase = true) ||
            it.author?.contains(normalizedQuery, ignoreCase = true) == true
    }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            if (searching) {
                TopAppBar(
                    title = {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            modifier = Modifier.fillMaxWidth().padding(end = 8.dp),
                            placeholder = { Text("ライブラリを検索") },
                            singleLine = true,
                            leadingIcon = {
                                IconButton(onClick = { searching = false; query = "" }) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "検索を閉じる")
                                }
                            },
                        )
                    },
                )
            } else {
                CenterAlignedTopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { searching = true }) { Icon(Icons.Default.Search, "検索") }
                    },
                    title = {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Image(
                                painter = painterResource(R.drawable.ic_launcher_foreground),
                                contentDescription = null,
                                modifier = Modifier.size(36.dp),
                            )
                            Text("Yuraive", fontWeight = FontWeight.Bold)
                        }
                    },
                    actions = {
                        IconButton(onClick = openHistory) { Icon(Icons.Default.History, "履歴") }
                        IconButton(onClick = openSettings) { Icon(Icons.Default.Settings, "設定") }
                    },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AdaptiveGrid(Modifier.fillMaxSize()) {
                if (!searching) {
                    item(key = "quick-played") { QuickActionCard("再生した作品", Icons.Default.History, openPlayed) }
                    item(key = "quick-recent") { QuickActionCard("最近追加", Icons.Default.Update, openRecent) }
                    item(key = "quick-favorite") { QuickActionCard("最近のお気に入り", Icons.Default.Favorite, openFavorites) }
                    item(key = "quick-shuffle") { QuickActionCard("シャッフル", Icons.Default.Shuffle, shuffle) }
                    item(key = "library-title", span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("ライブラリ", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            IconButton(onClick = refresh) { Icon(Icons.Default.Refresh, "更新") }
                            IconButton(onClick = addFolder) { Icon(Icons.Default.Add, "フォルダを追加") }
                        }
                    }
                } else {
                    item(key = "search-title", span = { GridItemSpan(maxLineSpan) }) {
                        Text("検索結果", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                }

                if (!searching) {
                    gridItems(localRoots, key = { "root:${it.grant.uri}" }) { root ->
                        RootGridCard(root, app, { browseRoot(root) }, { removeRoot(root.grant.uri) })
                    }
                    item(key = "add-folder") { AddFolderCard(addFolder) }
                    windowsDevices.forEach { device ->
                        item(key = "windows-device:${device.id}", span = { GridItemSpan(maxLineSpan) }) {
                            WindowsDeviceHeader(
                                device = device,
                                refresh = { refreshWindowsDevice(device.id) },
                                remove = { removeWindowsDevice(device.id) },
                            )
                        }
                        val deviceRoots = roots.filter { it.grant.uri in device.rootUris }.map { root ->
                            val prefix = "${device.name} · "
                            if (root.grant.name.startsWith(prefix)) {
                                root.copy(grant = root.grant.copy(name = root.grant.name.removePrefix(prefix)))
                            } else root
                        }
                        gridItems(deviceRoots, key = { "root:${it.grant.uri}" }) { root ->
                            RootGridCard(root, app, { browseRoot(root) }, {}, showDelete = false)
                        }
                    }
                } else {
                    gridItems(filteredRoots, key = { "root:${it.grant.uri}" }) { root ->
                        val isWindowsRoot = root.grant.uri in windowsRootUris
                        RootGridCard(root, app, { browseRoot(root) }, { removeRoot(root.grant.uri) }, showDelete = !isWindowsRoot)
                    }
                    gridItems(filteredGraphs, key = { "graph:${it.ref.graphId}" }) { graph ->
                        GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, inspectGraph, toggleFavorite)
                    }
                    if (filteredRoots.isEmpty() && filteredGraphs.isEmpty()) {
                        item(key = "no-results", span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                "一致する項目はありません",
                                Modifier.fillMaxWidth().padding(vertical = 48.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickActionCard(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(86.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Text(label, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun WindowsDeviceHeader(
    device: WindowsDeviceConnection,
    refresh: () -> Unit,
    remove: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(10.dp).clip(CircleShape).background(
                when (device.status) {
                    WindowsConnectionStatus.CONNECTED -> Color(0xFF34C759)
                    WindowsConnectionStatus.CONNECTING, WindowsConnectionStatus.LOADING -> Color(0xFFFF9500)
                    WindowsConnectionStatus.OFFLINE -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .4f)
                },
            ),
        )
        Text(
            device.name,
            Modifier.weight(1f).padding(start = 10.dp),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = refresh) { Icon(Icons.Default.Refresh, "再読み込み") }
        IconButton(onClick = remove) { Icon(Icons.Default.DeleteOutline, "削除") }
    }
}

@Composable
private fun RootGridCard(
    root: LibraryRoot,
    app: YuraiveApplication,
    open: () -> Unit,
    remove: () -> Unit,
    showDelete: Boolean = true,
) {
    val preview = root.previewGraph
    val thumbnailUri = rememberThumbnailUri(preview, app)
    Card(
        onClick = open,
        enabled = root.error == null,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (preview != null && thumbnailUri != null) {
                    Artwork(thumbnailUri, Modifier.fillMaxSize(), fallback = false, blurredCover = true)
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(
                            if (root.error == null) Icons.Default.Folder else Icons.Default.WarningAmber,
                            null,
                            Modifier.size(54.dp),
                            tint = if (root.error == null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        )
                    }
                }
                if (showDelete) {
                    IconButton(
                        onClick = remove,
                        modifier = Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.surface.copy(alpha = .85f), CircleShape),
                    ) { Icon(Icons.Default.DeleteOutline, "削除") }
                }
            }
            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().height(60.dp),
            ) {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.Center) {
                    Text(root.grant.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    root.error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, maxLines = 1) }
                }
            }
        }
    }
}

@Composable
private fun AddFolderCard(addFolder: () -> Unit) {
    Card(
        onClick = addFolder,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Add, null, Modifier.size(42.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Box(Modifier.fillMaxWidth().height(60.dp), contentAlignment = Alignment.CenterStart) {
                Text("フォルダを追加", Modifier.padding(horizontal = 12.dp), fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun FolderGridCard(
    folder: LibraryFolder,
    root: LibraryRoot,
    app: YuraiveApplication,
    open: () -> Unit,
) {
    var previewGraph by remember(root.grant.uri, folder.relativePath) { mutableStateOf<LibraryGraph?>(null) }
    LaunchedEffect(root.grant.uri, folder.relativePath) {
        // Only inspect a folder once its card is composed. This keeps traversal lazy while
        // allowing a direct child content folder to inherit its first JSON thumbnail.
        previewGraph = runCatching {
            app.library.inspectDirectory(root.grant, folder.relativePath).graphs.firstOrNull()
        }.getOrNull()
    }
    val thumbnailUri = rememberThumbnailUri(previewGraph, app)
    Card(
        onClick = open,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (thumbnailUri != null) {
                    Artwork(thumbnailUri, Modifier.fillMaxSize(), fallback = false, blurredCover = true)
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Folder, null, Modifier.size(52.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().height(60.dp),
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                    Text(
                        folder.name,
                        Modifier.padding(horizontal = 12.dp),
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun GraphGridCard(
    graph: LibraryGraph,
    favorite: Boolean,
    open: (LibraryGraph) -> Unit,
    inspect: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as YuraiveApplication
    val thumbnailUri = rememberThumbnailUri(graph, app)
    var menuExpanded by remember(graph.ref.graphId) { mutableStateOf(false) }
    var menuPosition by remember(graph.ref.graphId) { mutableStateOf(Offset.Zero) }
    Box(Modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier.fillMaxWidth().pointerInput(graph.ref.graphId) {
                awaitEachGesture {
                    menuPosition = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial).position
                }
            }.combinedClickable(
                enabled = graph.parseError == null,
                onClick = { open(graph) },
                onLongClick = { menuExpanded = true },
                onLongClickLabel = "作品メニューを開く",
            ),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        ) {
            Column {
                Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
                    Artwork(thumbnailUri, Modifier.fillMaxSize(), fallback = true, blurredCover = true)
                    IconButton(
                        onClick = { toggleFavorite(graph.ref.graphId) },
                        modifier = Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.surface.copy(alpha = .85f), CircleShape),
                    ) {
                        Icon(
                            if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            if (favorite) "お気に入りから削除" else "お気に入りに追加",
                            tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
                Column(Modifier.padding(12.dp)) {
                    Text(graph.displayName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        graph.parseError ?: graph.author ?: graph.ref.fileName,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (graph.parseError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Box(Modifier.offset { IntOffset(menuPosition.x.roundToInt(), menuPosition.y.roundToInt()) }.size(1.dp)) {
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                DropdownMenuItem(
                    text = { Text("作品情報とアセット") },
                    leadingIcon = { Icon(Icons.Default.Info, null) },
                    enabled = graph.parseError == null,
                    onClick = { menuExpanded = false; inspect(graph) },
                )
                DropdownMenuItem(
                    text = { Text(if (favorite) "お気に入りから削除" else "お気に入りに追加") },
                    leadingIcon = { Icon(if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, null) },
                    onClick = { menuExpanded = false; toggleFavorite(graph.ref.graphId) },
                )
                if (graph.parseError != null) {
                    DropdownMenuItem(
                        text = { Text(graph.parseError, color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Default.WarningAmber, null, tint = MaterialTheme.colorScheme.error) },
                        enabled = false,
                        onClick = {},
                    )
                }
            }
        }
    }
}

@Composable
private fun rememberThumbnailUri(graph: LibraryGraph?, app: YuraiveApplication): String? {
    var thumbnailUri by remember(graph?.ref?.graphId, graph?.thumbnailPath) { mutableStateOf<String?>(null) }
    LaunchedEffect(graph?.ref?.graphId, graph?.thumbnailPath) {
        thumbnailUri = if (graph == null) null else graph.thumbnailPath?.let {
            app.library.assetUri(graph.ref, it)?.toString()
        }
    }
    return thumbnailUri
}

private class InspectionTreeBranch {
    val folders = sortedMapOf<String, InspectionTreeBranch>()
    val files = mutableListOf<LibraryAssetInspection>()
}

private sealed interface InspectionTreeRow {
    val key: String
    val depth: Int

    data class Folder(
        val name: String,
        val path: String,
        override val depth: Int,
    ) : InspectionTreeRow {
        override val key: String = "folder:$path"
    }

    data class File(
        val name: String,
        val asset: LibraryAssetInspection,
        override val depth: Int,
    ) : InspectionTreeRow {
        override val key: String = "file:${asset.path}"
    }
}

private fun inspectionTreeRows(
    assets: List<LibraryAssetInspection>,
    collapsedFolders: Set<String>,
): List<InspectionTreeRow> {
    val root = InspectionTreeBranch()
    assets.forEach { asset ->
        val parts = if (asset.problem == AssetInspectionProblem.UNSAFE_PATH) {
            mutableListOf(asset.path)
        } else {
            asset.path.split('/').filter(String::isNotEmpty).toMutableList()
        }
        parts.removeLastOrNull() ?: return@forEach
        var branch = root
        parts.forEach { part -> branch = branch.folders.getOrPut(part, ::InspectionTreeBranch) }
        branch.files += asset
    }
    val result = mutableListOf<InspectionTreeRow>()
    fun append(branch: InspectionTreeBranch, depth: Int, parentPath: String) {
        branch.folders.forEach { (name, child) ->
            val path = listOf(parentPath, name).filter(String::isNotEmpty).joinToString("/")
            result += InspectionTreeRow.Folder(name, path, depth)
            if (path !in collapsedFolders) append(child, depth + 1, path)
        }
        branch.files.sortedBy(LibraryAssetInspection::path).forEach { asset ->
            val name = if (asset.problem == AssetInspectionProblem.UNSAFE_PATH) asset.path else asset.path.substringAfterLast('/')
            result += InspectionTreeRow.File(name, asset, depth)
        }
    }
    append(root, 0, "")
    return result
}

@Composable
private fun ContentInspectionScreen(
    graph: LibraryGraph,
    app: YuraiveApplication,
    onBack: () -> Unit,
) {
    var inspection by remember(graph.ref.graphId) { mutableStateOf<LibraryContentInspection?>(null) }
    var error by remember(graph.ref.graphId) { mutableStateOf<String?>(null) }
    var collapsedFolders by remember(graph.ref.graphId) { mutableStateOf<Set<String>>(emptySet()) }
    LaunchedEffect(graph.ref.graphId) {
        inspection = null
        error = null
        runCatching { app.library.inspectContent(graph.ref) }
            .onSuccess { inspection = it }
            .onFailure { error = it.message ?: "作品ファイルを解析できません" }
    }
    BackHandler(onBack = onBack)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("作品情報とアセット", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            )
        },
    ) { padding ->
        CenteredContent(Modifier.fillMaxSize().padding(padding), MaxListContentWidth) { contentModifier ->
            val content = inspection
            when {
                error != null -> Column(
                    contentModifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Default.WarningAmber, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.error)
                    Text("ファイルを解析できません", fontWeight = FontWeight.Bold)
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                }
                content == null -> Box(contentModifier, contentAlignment = Alignment.TopCenter) {
                    CircularProgressIndicator(Modifier.padding(top = 64.dp))
                }
                else -> {
                    val metadata = content.graph.metadata
                    val rows = inspectionTreeRows(content.assets, collapsedFolders)
                    val missing = content.assets.count { !it.recognized }
                    val metadataRows = listOfNotNull(
                        "ファイル" to graph.ref.fileName,
                        "形式" to if (content.isBundle) "バイナリ (.yuraive)" else "JSON (.yuraive.json)",
                        metadata?.author?.takeIf(String::isNotBlank)?.let { "作者" to it },
                        metadata?.contentId?.takeIf(String::isNotBlank)?.let { "Content ID" to it },
                        metadata?.createdAt?.takeIf(String::isNotBlank)?.let { "作成日時" to it },
                        metadata?.updatedAt?.takeIf(String::isNotBlank)?.let { "更新日時" to it },
                        metadata?.tags?.takeIf { it.isNotEmpty() }?.joinToString("、")?.let { "タグ" to it },
                    )
                    LazyColumn(
                        modifier = contentModifier,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    ) {
                        item(key = "metadata-title") {
                            Text(
                                metadata?.displayName?.takeIf(String::isNotBlank) ?: graph.displayName,
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            metadata?.description?.takeIf(String::isNotBlank)?.let { description ->
                                Text(
                                    description,
                                    Modifier.padding(top = 8.dp, bottom = 10.dp),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    lineHeight = 22.sp,
                                )
                            }
                        }
                        items(metadataRows, key = { "metadata:${it.first}" }) { (label, value) ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                                Text(label, Modifier.width(96.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(value, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
                        }
                        item(key = "asset-heading") {
                            Row(
                                Modifier.fillMaxWidth().padding(top = 26.dp, bottom = 10.dp),
                                verticalAlignment = Alignment.Bottom,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("参照アセット", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                    Text(
                                        "${content.assets.size - missing} / ${content.assets.size} 件を確認",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                if (missing > 0) Text("${missing}件を認識できません", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                            }
                            HorizontalDivider()
                        }
                        if (rows.isEmpty()) {
                            item(key = "asset-empty") {
                                Text(
                                    "参照アセットはありません",
                                    Modifier.fillMaxWidth().padding(vertical = 34.dp),
                                    textAlign = TextAlign.Center,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        } else {
                            items(rows, key = InspectionTreeRow::key) { row ->
                                when (row) {
                                    is InspectionTreeRow.Folder -> Row(
                                        Modifier.fillMaxWidth().height(42.dp).clickable {
                                            collapsedFolders = if (row.path in collapsedFolders) collapsedFolders - row.path else collapsedFolders + row.path
                                        }.padding(start = (row.depth * 16).dp, end = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(
                                            if (row.path in collapsedFolders) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Default.KeyboardArrowDown,
                                            null,
                                            Modifier.size(20.dp),
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        Icon(Icons.Default.Folder, null, Modifier.padding(horizontal = 7.dp).size(19.dp), tint = MaterialTheme.colorScheme.primary)
                                        Text(row.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                    is InspectionTreeRow.File -> {
                                        val color = if (row.asset.recognized) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error
                                        Row(
                                            Modifier.fillMaxWidth().defaultMinSize(minHeight = 42.dp).background(
                                                if (row.asset.recognized) Color.Transparent else MaterialTheme.colorScheme.errorContainer.copy(alpha = .35f),
                                            ).padding(start = (row.depth * 16 + 28).dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.size(18.dp), tint = color)
                                            Text(row.name, Modifier.weight(1f).padding(horizontal = 9.dp), color = color, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            val status = when (row.asset.problem) {
                                                AssetInspectionProblem.UNSAFE_PATH -> "不正なパス"
                                                AssetInspectionProblem.MISSING -> "見つかりません"
                                                null -> if (row.asset.embedded) "内蔵" else null
                                            }
                                            status?.let { Text(it, color = color, style = MaterialTheme.typography.labelSmall) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GraphCollectionScreen(
    collection: GraphCollection,
    favoriteIds: Set<String>,
    onBack: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
    inspectGraph: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(collection.title, fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AdaptiveGrid(Modifier.fillMaxSize()) {
                gridItems(collection.graphs, key = { it.ref.graphId }) { graph ->
                    GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, inspectGraph, toggleFavorite)
                }
            }
            when {
                collection.loading -> CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 64.dp))
                collection.graphs.isEmpty() -> Text(
                    "作品はまだありません",
                    Modifier.align(Alignment.TopCenter).padding(top = 64.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun DirectoryBrowserScreen(
    root: LibraryRoot,
    initialPath: String?,
    app: YuraiveApplication,
    favoriteIds: Set<String>,
    onBack: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
    inspectGraph: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    var currentPath by rememberSaveable(root.grant.uri, initialPath) { mutableStateOf(initialPath.orEmpty()) }
    var directories by remember(root.grant.uri) { mutableStateOf<List<LibraryDirectory>>(emptyList()) }
    var loading by remember(root.grant.uri) { mutableStateOf(true) }
    var error by remember(root.grant.uri) { mutableStateOf(root.error) }
    val current = directories.lastOrNull()

    fun load(path: String) {
        if (loading) return
        currentPath = path
    }

    LaunchedEffect(root.grant.uri, currentPath) {
        if (root.error != null) {
            loading = false
            return@LaunchedEffect
        }
        loading = true
        error = null
        runCatching {
            directoryPathChain(currentPath).map { path ->
                if (path.isEmpty()) root.directory ?: app.library.inspectDirectory(root.grant, path)
                else app.library.inspectDirectory(root.grant, path)
            }
        }.onSuccess { directories = it }
            .onFailure { error = it.message ?: "フォルダを読み込めません" }
        loading = false
    }
    fun goBack() {
        if (currentPath.isNotEmpty()) currentPath = currentPath.substringBeforeLast('/', "") else onBack()
    }
    BackHandler { goBack() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(current?.name ?: root.grant.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = ::goBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val directory = current
            if (directory != null) {
                AdaptiveGrid(Modifier.fillMaxSize()) {
                    if (directory.isContent) {
                        gridItems(directory.graphs, key = { it.ref.graphId }) { graph ->
                            GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, inspectGraph, toggleFavorite)
                        }
                    } else {
                        gridItems(directory.folders, key = { it.relativePath }) { folder ->
                            FolderGridCard(folder, root, app) { load(folder.relativePath) }
                        }
                    }
                }
            }
            if (!loading && directory != null && directory.graphs.isEmpty() && directory.folders.isEmpty()) {
                Text("フォルダは空です", Modifier.align(Alignment.TopCenter).padding(top = 64.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (loading) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 64.dp))
            error?.let { message ->
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                ) { Text(message, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer) }
            }
        }
    }
}

internal fun directoryPathChain(relativePath: String): List<String> {
    val segments = relativePath.split('/').filter(String::isNotEmpty)
    return buildList {
        add("")
        segments.indices.forEach { index -> add(segments.take(index + 1).joinToString("/")) }
    }
}

@Composable
private fun PlayerScreen(
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
    val dragOffset by animateFloatAsState(
        targetValue = if (draggingPlayer) rawDragOffset else 0f,
        animationSpec = if (draggingPlayer) snap() else tween(180),
        label = "player swipe offset",
    )
    val playerBackground = Color(0xFF101116)

    Box(
        Modifier
            .fillMaxSize()
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
            },
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

        if (state.status == PlaybackStatus.LOADING) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
        if (state.status == PlaybackStatus.ERROR) {
            Card(Modifier.align(Alignment.Center).padding(28.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("再生エラー", fontWeight = FontWeight.Bold)
                    Text(state.error.orEmpty())
                    OutlinedButton(onClick = onRetry) { Icon(Icons.Default.RestartAlt, null); Spacer(Modifier.width(8.dp)); Text("再試行") }
                }
            }
        }
    }
    if (showInfo) ContentInfoDialog(state = state, close = { showInfo = false })
}

@Composable
private fun PlayerPortraitContent(
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
        val minimumArtwork = when {
            veryCompactHeight -> 180.dp
            compactHeight -> 210.dp
            else -> 236.dp
        }.coerceAtMost(contentWidth)
        val artworkHeightLimit = maxHeight * when {
            veryCompactHeight -> .29f
            compactHeight -> .33f
            else -> .36f
        }
        val artworkSize = contentWidth
            .coerceAtMost(artworkHeightLimit)
            .coerceAtMost(420.dp)
            .coerceAtLeast(minimumArtwork)
        val headerToArtwork = when {
            veryCompactHeight -> 12.dp
            compactHeight -> 18.dp
            else -> 24.dp
        }
        val artworkToMetadata = when {
            veryCompactHeight -> 12.dp
            compactHeight -> 18.dp
            else -> 22.dp
        }
        val metadataToProgress = when {
            veryCompactHeight -> 6.dp
            compactHeight -> 10.dp
            else -> 14.dp
        }
        val progressToTransport = when {
            veryCompactHeight -> 8.dp
            compactHeight -> 14.dp
            else -> 18.dp
        }

        Column(
            Modifier.width(contentWidth).fillMaxHeight().padding(vertical = if (compactHeight) 8.dp else 12.dp),
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
private fun PlayerLandscapeContent(
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
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        val compactHeight = maxHeight < 480.dp
        val expandedWidth = maxWidth >= 840.dp
        val paneGap = if (expandedWidth) 28.dp else 12.dp
        Row(
            Modifier
                .fillMaxSize()
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
                Modifier.weight(1f).fillMaxHeight().padding(horizontal = if (expandedWidth) 20.dp else 4.dp),
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
private fun PlayerHeader(state: PlaybackUiState, compact: Boolean) {
    Text(
        "再生中",
        color = Color.White.copy(alpha = .72f),
        style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleMedium,
    )
    Text(
        state.title.ifBlank { HiddenTextPlaceholder },
        color = Color.White,
        style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun PlayerArtwork(
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
                factory = { context -> PlayerView(context).apply { useController = false; this.player = player } },
                update = { view ->
                    view.player = player
                    view.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Crossfade(state.visualUri, animationSpec = tween(state.imageTransitionMs), label = "artwork") { uri ->
                Artwork(uri, Modifier.fillMaxSize(), fallback = true, blurredCover = true)
            }
        }
        state.layoutSource?.let { source ->
            ButtonLayoutView(source, state.buttons, onButton, Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun PlayerMetadataActions(
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
                if (state.controls.showSceneName) state.sceneName.ifBlank { HiddenTextPlaceholder } else HiddenTextPlaceholder,
                color = Color.White,
                style = if (compact) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (state.controls.showFileName) state.fileName.ifBlank { HiddenTextPlaceholder } else HiddenTextPlaceholder,
                color = Color.White.copy(alpha = .62f),
                style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(
            onClick = onToggleFavorite,
            enabled = state.graphRef != null,
            modifier = Modifier
                .padding(start = if (compact) 6.dp else 10.dp)
                .size(actionSize)
                .background(Color.White.copy(alpha = .08f), RoundedCornerShape(if (compact) 14.dp else 16.dp)),
        ) {
            Icon(
                if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                if (favorite) "お気に入りから削除" else "お気に入りに追加",
                tint = when {
                    state.graphRef == null -> Color.White.copy(alpha = .24f)
                    favorite -> MaterialTheme.colorScheme.primary
                    else -> Color.White.copy(alpha = .9f)
                },
            )
        }
        IconButton(
            onClick = onStats,
            enabled = state.hasPlaybackStats,
            modifier = Modifier
                .padding(start = if (compact) 6.dp else 8.dp)
                .size(actionSize)
                .background(Color.White.copy(alpha = .08f), RoundedCornerShape(if (compact) 14.dp else 16.dp)),
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
private fun PlayerProgress(
    state: PlaybackUiState,
    seek: (Long) -> Unit,
) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1)
    val progress = dragging ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    Column(Modifier.fillMaxWidth()) {
        if (state.controls.showSeekBar) {
            Slider(
                value = progress,
                onValueChange = { dragging = it },
                onValueChangeFinished = { dragging?.let { seek((it * duration).roundToLong()) }; dragging = null },
                enabled = state.controls.allowSeek && state.durationMs > 0,
                modifier = Modifier.fillMaxWidth().height(38.dp),
            )
        } else {
            PlaybackWaveform(active = state.isPlaying)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                if (state.controls.showPlaybackTime) formatDuration((progress * duration).roundToLong()) else HiddenTimePlaceholder,
                color = Color.White.copy(alpha = .68f),
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                if (state.controls.showPlaybackTime) formatDuration(state.durationMs) else HiddenTimePlaceholder,
                color = Color.White.copy(alpha = .68f),
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun PlayerTransportControls(
    state: PlaybackUiState,
    toggle: () -> Unit,
    next: () -> Unit,
    previous: () -> Unit,
    compact: Boolean,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
        val previousEnabled = state.controls.allowPrevious && state.canPrevious
        IconButton(
            onClick = previous,
            enabled = previousEnabled,
            modifier = Modifier
                .size(if (compact) 50.dp else 54.dp)
                .background(Color.White.copy(alpha = .08f), RoundedCornerShape(18.dp)),
        ) {
            Icon(Icons.Default.SkipPrevious, "前のシーン", tint = Color.White.copy(alpha = if (previousEnabled) .9f else .24f))
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
            modifier = Modifier
                .size(if (compact) 50.dp else 54.dp)
                .background(Color.White.copy(alpha = .08f), RoundedCornerShape(18.dp)),
        ) {
            Icon(Icons.Default.SkipNext, "次のシーン", tint = Color.White.copy(alpha = if (nextEnabled) .9f else .24f))
        }
    }
}

@Composable
private fun PlayerBottomActions(
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
private fun PlayerBottomActionPill(
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
private fun PlaybackWaveform(active: Boolean) {
    val transition = rememberInfiniteTransition(label = "playback waveform")
    val activeColor = MaterialTheme.colorScheme.primary
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = (PI * 48).toFloat(),
        animationSpec = infiniteRepeatable(
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
            val secondary = (
                sin(runningPhase * .5f + phaseOffset * .7f + position * PI.toFloat() * 5f) + 1f
            ) * .5f
            val pulse = if (active) primary * .62f + secondary * .38f else primary * .35f + secondary * .25f
            val height = size.height * (.14f + pulse * (.42f + seed * .28f)).coerceIn(.14f, .94f)
            val drift = if (active) sin(runningPhase * .5f + phaseOffset) * size.height * .045f else 0f
            val centerY = size.height / 2f + drift
            val x = step * (index + .5f)
            drawLine(
                color = if (active) activeColor.copy(alpha = .58f + seed * .38f) else Color.White.copy(alpha = .24f + seed * .14f),
                start = Offset(x, centerY - height / 2f),
                end = Offset(x, centerY + height / 2f),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun ContentInfoDialog(state: PlaybackUiState, close: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    AlertDialog(
        onDismissRequest = close,
        icon = { Icon(Icons.Default.Info, null) },
        title = { Text(state.title.ifBlank { HiddenTextPlaceholder }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                state.author?.let { Text(it, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold) }
                Text(state.description ?: "説明は設定されていません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                state.socialLinks.forEach { link ->
                    OutlinedButton(onClick = { runCatching { uriHandler.openUri(link.url) } }, modifier = Modifier.fillMaxWidth()) {
                        Text(link.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("閉じる") } },
    )
}

private enum class StatsSort { NEWEST, DEFAULT }

@Composable
private fun PlaybackStatsScreen(
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

    LaunchedEffect(ref.graphId, playback.runId, playback.status, playback.historyEntryCount, refresh) {
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
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
                actions = { IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Default.Refresh, "再読み込み") } },
            )
        },
    ) { padding ->
        when {
            loading && data == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null && data == null -> Column(
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
                val currentItem = playback.runId
                    ?.let { runId -> stats.items.firstOrNull { it.session.runId == runId } }
                    ?: stats.items.firstOrNull { it.session.isActive }
                val currentRunId = currentItem?.session?.runId
                val ordered = stats.items
                    .filterNot { it.session.runId == currentRunId }
                    .sortedWith { left, right ->
                        val primary = when (sort) {
                            StatsSort.NEWEST -> right.session.startedAt.compareTo(left.session.startedAt)
                            StatsSort.DEFAULT -> compareNullableStatsDescending(left.sortValue, right.sortValue)
                        }
                        if (primary != 0) primary
                        else right.session.startedAt.compareTo(left.session.startedAt).takeIf { it != 0 }
                            ?: left.session.runId.compareTo(right.session.runId)
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
                            Text(stats.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                        currentItem?.let { item ->
                            item(key = "current:${item.session.runId}") {
                                PlaybackStatsCard(ref, item, app, onShare = { share = it })
                            }
                        }
                        item {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StatsSummaryCard("再生回数", stats.aggregate.sessionCount.toString(), Modifier.weight(1f))
                                StatsSummaryCard("累計再生", formatStatsDuration(stats.aggregate.activePlayMs), Modifier.weight(1f))
                                StatsSummaryCard("最終再生", stats.aggregate.lastEndedAt?.let(::formatDate) ?: "—", Modifier.weight(1f))
                            }
                        }
                        item {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StatsSort.entries.forEach { option ->
                                    val label = when (option) { StatsSort.NEWEST -> "新しい順"; StatsSort.DEFAULT -> "デフォルト" }
                                    Surface(
                                        onClick = { sort = option },
                                        shape = RoundedCornerShape(12.dp),
                                        color = if (sort == option) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                                        contentColor = if (sort == option) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.weight(1f),
                                    ) { Text(label, Modifier.padding(horizontal = 8.dp, vertical = 10.dp), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium) }
                                }
                            }
                        }
                        if (currentItem == null && ordered.isEmpty()) item {
                            Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                                Text("統計対象の再生セッションはありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        items(ordered, key = { it.session.runId }) { item ->
                            PlaybackStatsCard(ref, item, app, onShare = { share = it })
                        }
                        item {
                            OutlinedButton(onClick = openHistory, modifier = Modifier.fillMaxWidth()) {
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

private fun compareNullableStatsDescending(left: Long?, right: Long?): Int = when {
    left == null && right == null -> 0
    left == null -> 1
    right == null -> -1
    else -> right.compareTo(left)
}

@Composable
private fun StatsSummaryCard(label: String, value: String, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Text(value, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun PlaybackStatsCard(ref: GraphRef, item: PlaybackStatsItem, app: YuraiveApplication, onShare: (ShareData) -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (item.session.isActive) "再生中" else formatDate(item.session.startedAt),
                    fontWeight = FontWeight.SemiBold,
                    color = if (item.session.isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "${item.session.entryCount}シーン · ${formatStatsDuration(item.session.activePlayMs)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item.sortValue?.let { Text(it.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item.share?.let { content ->
                IconButton(onClick = { onShare(content) }) { Icon(Icons.Default.Share, "共有") }
            }
        }
        HorizontalDivider()
        if (item.error != null) {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.WarningAmber, null, tint = MaterialTheme.colorScheme.error)
                Text(item.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        } else item.display?.let { document ->
            DisplayDocumentView(document, ref, app, Modifier.fillMaxWidth().padding(14.dp))
        }
    }
}

@Composable
private fun DisplayDocumentView(document: DisplayDocument, ref: GraphRef, app: YuraiveApplication, modifier: Modifier = Modifier) {
    DisplayNodeView(document.root, ref, app, modifier)
}

@Composable
private fun DisplayNodeView(node: DisplayNode, ref: GraphRef, app: YuraiveApplication, modifier: Modifier = Modifier) {
    val styled = modifier.displayStyle(node.style)
    when (node.type) {
        "column", "surface" -> Box(styled) {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = node.style.horizontalAlignment.toHorizontalAlignment(),
                verticalArrangement = Arrangement.spacedBy(
                    (node.style.gap ?: 0f).dp,
                    node.style.verticalAlignment.toVerticalAlignment(),
                ),
            ) { node.children.forEach { DisplayNodeView(it, ref, app) } }
        }
        "row" -> Box(styled) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = node.style.verticalAlignment.toVerticalAlignment(),
                horizontalArrangement = Arrangement.spacedBy(
                    (node.style.gap ?: 0f).dp,
                    node.style.horizontalAlignment.toHorizontalAlignment(),
                ),
            ) { node.children.forEach { DisplayNodeView(it, ref, app) } }
        }
        "stack" -> Box(styled) {
            node.children.forEach { child -> DisplayNodeView(child, ref, app, Modifier.align(child.style.align.toBoxAlignment())) }
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
                        withStyle(SpanStyle(
                            color = parseColor(span.style.color, textColor),
                            fontSize = (span.style.fontSize ?: node.style.fontSize ?: 14f).sp,
                            fontWeight = displayFontWeight(span.style.fontWeight ?: node.style.fontWeight),
                        )) { append(span.text) }
                    }
                }
                Text(rich, styled, textAlign = textAlign, maxLines = node.style.maxLines ?: Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            }
        }
        "image" -> DisplayAssetImage(node.source.orEmpty(), ref, app, styled)
        "icon" -> Box(styled, contentAlignment = Alignment.Center) {
            Icon(displayIcon(node.icon), node.label, tint = parseColor(node.style.color, MaterialTheme.colorScheme.primary), modifier = Modifier.size((node.style.fontSize ?: 24f).dp))
        }
        "badge" -> Surface(
            modifier = styled,
            shape = RoundedCornerShape((node.style.cornerRadius ?: 999f).dp),
            color = parseColor(node.style.backgroundColor, MaterialTheme.colorScheme.secondaryContainer),
            contentColor = parseColor(node.style.color, MaterialTheme.colorScheme.onSecondaryContainer),
        ) { Text(node.text.orEmpty(), Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium) }
        "progress" -> Column(styled, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            node.label?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = parseColor(node.style.color, MaterialTheme.colorScheme.onSurfaceVariant)) }
            LinearProgressIndicator(progress = { node.value ?: 0f }, modifier = Modifier.fillMaxWidth())
        }
        "divider" -> HorizontalDivider(styled, thickness = (node.style.height as? DisplayDimension.Fixed)?.value?.dp ?: 1.dp, color = parseColor(node.style.color, MaterialTheme.colorScheme.outlineVariant))
        "spacer" -> Spacer(styled.then(if (node.style.height == null) Modifier.height(8.dp) else Modifier))
    }
}

@Composable
private fun DisplayAssetImage(path: String, ref: GraphRef, app: YuraiveApplication, modifier: Modifier) {
    var uri by remember(ref.graphId, path) { mutableStateOf<String?>(null) }
    LaunchedEffect(ref.graphId, path) { uri = app.library.assetUri(ref, path)?.toString() }
    Artwork(uri, modifier, fallback = true, blurredCover = false)
}

private fun Modifier.displayStyle(style: DisplayStyle): Modifier {
    var result = this
    result = when (val width = style.width) {
        is DisplayDimension.Fixed -> result.width(width.value.dp)
        DisplayDimension.Fill -> result.fillMaxWidth()
        DisplayDimension.Wrap -> result.wrapContentWidth()
        null -> result
    }
    result = when (val height = style.height) {
        is DisplayDimension.Fixed -> result.height(height.value.dp)
        DisplayDimension.Fill -> result.fillMaxHeight()
        DisplayDimension.Wrap -> result.wrapContentHeight()
        null -> result
    }
    style.minHeight?.let { result = result.defaultMinSize(minHeight = it.dp) }
    style.aspectRatio?.let { result = result.aspectRatio(it) }
    if (style.offsetX != null || style.offsetY != null) result = result.offset((style.offsetX ?: 0f).dp, (style.offsetY ?: 0f).dp)
    style.opacity?.let { alpha -> result = result.graphicsLayer { this.alpha = alpha } }
    val shape = RoundedCornerShape((style.cornerRadius ?: 0f).dp)
    if (style.cornerRadius != null) result = result.clip(shape)
    style.backgroundColor?.let { result = result.background(parseColor(it, Color.Transparent), shape) }
    if (style.borderWidth != null && style.borderWidth > 0 && style.borderColor != null) {
        result = result.border(style.borderWidth.dp, parseColor(style.borderColor, Color.Transparent), shape)
    }
    style.padding?.let { result = result.padding(it.dp) }
    return result
}

private fun String?.toHorizontalAlignment() = when (this) { "center" -> Alignment.CenterHorizontally; "end" -> Alignment.End; else -> Alignment.Start }
private fun String?.toVerticalAlignment() = when (this) { "top" -> Alignment.Top; "bottom" -> Alignment.Bottom; else -> Alignment.CenterVertically }
private fun String?.toTextAlign() = when (this) { "center" -> TextAlign.Center; "end" -> TextAlign.End; else -> TextAlign.Start }
private fun String?.toBoxAlignment() = when (this) {
    "topCenter" -> Alignment.TopCenter; "topEnd" -> Alignment.TopEnd; "centerStart" -> Alignment.CenterStart
    "center" -> Alignment.Center; "centerEnd" -> Alignment.CenterEnd; "bottomStart" -> Alignment.BottomStart
    "bottomCenter" -> Alignment.BottomCenter; "bottomEnd" -> Alignment.BottomEnd; else -> Alignment.TopStart
}
private fun displayFontWeight(value: Int?) = when ((value ?: 400)) {
    in 100..299 -> FontWeight.Light
    in 300..499 -> FontWeight.Normal
    in 500..699 -> FontWeight.SemiBold
    else -> FontWeight.Bold
}
private fun displayIcon(value: String?): ImageVector = when (value) {
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
private fun SharePreviewDialog(share: ShareData, close: () -> Unit) {
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
                    color = if (weightedLength > 280) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val intent = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, draft) }
                context.startActivity(Intent.createChooser(intent, "再生統計を共有"))
                close()
            }, enabled = draft.isNotBlank()) { Text("共有") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = {
                    val uri = Uri.parse("https://x.com/intent/post").buildUpon().appendQueryParameter("text", draft).build()
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                    close()
                }, enabled = draft.isNotBlank() && weightedLength <= 280) { Text("Xで開く") }
                TextButton(onClick = close) { Text("キャンセル") }
            }
        },
    )
}

private fun shareWeightedLength(value: String): Int {
    val url = Regex("https://\\S+")
    var total = 0
    var cursor = 0
    url.findAll(value).forEach { match ->
        total += value.substring(cursor, match.range.first).codePoints().toArray().fold(0) { sum, codePoint -> sum + xCodePointWeight(codePoint) }
        total += 23
        cursor = match.range.last + 1
    }
    return total + value.substring(cursor).codePoints().toArray().fold(0) { sum, codePoint -> sum + xCodePointWeight(codePoint) }
}

private fun xCodePointWeight(codePoint: Int): Int = if (
    codePoint in 0..0x10FF || codePoint in 0x2000..0x200D ||
    codePoint in 0x2010..0x201F || codePoint in 0x2032..0x2037
) 1 else 2

private fun formatStatsDuration(value: Long): String {
    val minutes = value.coerceAtLeast(0) / 60_000
    return if (minutes >= 60) "${minutes / 60}時間${minutes % 60}分" else "${minutes}分"
}

@Composable
private fun HistoryScreen(
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
            val graphs = app.library.resolveGraphs(sessions.map(PlaybackSession::graphId))
                .associateBy { it.ref.graphId }
            sessions.map { session -> HistoryListItem(session, graphs[session.graphId]) }
        }.onSuccess { items = it }
            .onFailure { loadError = it.message ?: "履歴を読み込めません" }
        loading = false
    }
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("履歴", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
                actions = {
                    IconButton(onClick = export, enabled = items.isNotEmpty()) { Icon(Icons.Default.SaveAlt, "書き出し") }
                    IconButton(onClick = { clearDialog = true }, enabled = items.isNotEmpty()) { Icon(Icons.Default.DeleteOutline, "削除") }
                },
            )
        },
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            loadError != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(loadError.orEmpty(), color = MaterialTheme.colorScheme.error)
            }
            items.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("再生履歴はありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> CenteredContent(
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
    if (clearDialog) AlertDialog(
        onDismissRequest = { clearDialog = false },
        title = { Text("履歴を削除") },
        text = { Text("すべての再生履歴を削除します。") },
        confirmButton = { TextButton(onClick = { scope.launch { app.history.clear(); version++ }; clearDialog = false }) { Text("削除") } },
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

internal fun buildPlaybackSessions(entries: List<PlaybackHistoryEntry>): List<PlaybackSession> = entries
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

private data class HistoryListItem(
    val session: PlaybackSession,
    val graph: LibraryGraph?,
)

@Composable
private fun HistorySessionCard(item: HistoryListItem, app: YuraiveApplication, open: () -> Unit) {
    val session = item.session
    val graph = item.graph
    val thumbnailUri = rememberThumbnailUri(graph, app)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 120.dp)
            .then(if (graph != null) Modifier.clickable(onClick = open) else Modifier),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
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
                        Icon(Icons.Default.WarningAmber, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
            Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
                    color = if (graph == null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (graph == null) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(Icons.Default.AccessTime, null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "ライブラリで開く", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryCompletionBadge(completed: Boolean) {
    Surface(
        shape = RoundedCornerShape(50),
        color = if (completed) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = if (completed) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (completed) Icon(Icons.Default.Check, null, Modifier.size(14.dp))
            Text(if (completed) "完了" else "未完了", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun historyGraphName(graphId: String): String = graphId
    .substringAfter("::", graphId)
    .substringAfterLast('/')
    .removeSuffix(".yuraive.json")
    .removeSuffix(".yuraive")

@Composable
private fun SettingsScreen(
    modifier: Modifier,
    settings: PlayerSettings,
    update: ((PlayerSettings) -> PlayerSettings) -> Unit,
    onBack: () -> Unit,
    openLicenses: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    val bottomContentPadding = 20.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("設定", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            )
        },
    ) { padding ->
        CenteredContent(
            modifier = Modifier.fillMaxSize().padding(padding),
            maxContentWidth = MaxSettingsContentWidth,
        ) { listModifier ->
        LazyColumn(
            listModifier,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp,
                top = 20.dp,
                end = 20.dp,
                bottom = bottomContentPadding,
            ),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            item {
                SettingGroup("テーマ") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(ThemeMode.SYSTEM to Icons.Default.Settings, ThemeMode.LIGHT to Icons.Default.LightMode, ThemeMode.DARK to Icons.Default.DarkMode).forEach { (mode, icon) ->
                            val selected = settings.themeMode == mode
                            Surface(
                                onClick = { update { it.copy(themeMode = mode) } },
                                modifier = Modifier.weight(1f).height(112.dp),
                                shape = RoundedCornerShape(18.dp),
                                color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                                border = androidx.compose.foundation.BorderStroke(
                                    if (selected) 2.dp else 1.dp,
                                    if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                                ),
                            ) {
                                Column(
                                    Modifier.fillMaxSize().padding(8.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    Icon(
                                        if (selected) Icons.Default.Check else icon,
                                        null,
                                        Modifier.size(28.dp),
                                        tint = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.primary,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Text(
                                        when (mode) { ThemeMode.SYSTEM -> "システム"; ThemeMode.LIGHT -> "ライト"; ThemeMode.DARK -> "ダーク" },
                                        style = MaterialTheme.typography.labelLarge,
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            item {
                SettingGroup("アクセント") {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        accents.forEachIndexed { index, color ->
                            Surface(
                                shape = CircleShape,
                                color = color,
                                modifier = Modifier.size(42.dp).border(if (settings.accentIndex == index) 3.dp else 0.dp, MaterialTheme.colorScheme.onSurface, CircleShape).clickable { update { it.copy(accentIndex = index) } },
                            ) { if (settings.accentIndex == index) Box(contentAlignment = Alignment.Center) { Icon(Icons.Default.Check, null, tint = Color.White) } }
                        }
                    }
                }
            }
            item {
                SettingGroup("プレイヤーコントロール") {
                    SettingSwitchRow(
                        title = "すべて表示・許可",
                        description = "作品側の表示・操作制限を一時的に無視します",
                        checked = settings.forceShowPlayerControls,
                        onCheckedChange = { enabled -> update { it.copy(forceShowPlayerControls = enabled) } },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SettingSwitchRow(
                        title = "画面を消灯しない",
                        description = "再生画面を表示している間、画面を点灯したままにします",
                        checked = settings.keepScreenOnInPlayer,
                        onCheckedChange = { enabled -> update { it.copy(keepScreenOnInPlayer = enabled) } },
                    )
                }
            }
            item {
                SettingGroup("スクリプトのタイムアウト") {
                    Text("${settings.scriptTimeoutMs} ms", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                    Slider(
                        value = settings.scriptTimeoutMs.toFloat(),
                        onValueChange = { value -> update { it.copy(scriptTimeoutMs = (value / 100).roundToLong() * 100) } },
                        valueRange = 100f..5_000f,
                        steps = 48,
                    )
                }
            }
            item {
                SettingGroup("アプリについて") {
                    SettingLinkRow(
                        title = "ライセンス",
                        external = false,
                        onClick = openLicenses,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SettingLinkRow(
                        title = "GitHub",
                        external = true,
                        onClick = { runCatching { uriHandler.openUri("https://github.com/h-sumiya/yuraive") } },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SettingLinkRow(
                        title = "お問い合わせ",
                        external = true,
                        onClick = { runCatching { uriHandler.openUri("https://hiro.red/contact") } },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SettingLinkRow(
                        title = "プライバシーポリシー",
                        external = true,
                        onClick = { runCatching { uriHandler.openUri("https://yuraive.com/privacy/") } },
                    )
                }
            }
        }
        }
    }
}

@Composable
private fun SettingLinkRow(
    title: String,
    external: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        Icon(
            if (external) Icons.AutoMirrored.Filled.OpenInNew else Icons.AutoMirrored.Filled.KeyboardArrowRight,
            if (external) "外部サイトで開く" else "開く",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SettingSwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(
            Modifier.weight(1f).padding(end = 20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun SettingGroup(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
private fun Artwork(
    uri: String?,
    modifier: Modifier,
    fallback: Boolean,
    scale: ContentScale = ContentScale.Crop,
    blurredCover: Boolean = false,
) {
    val context = LocalContext.current
    var bitmap by remember(uri) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(uri) {
        bitmap = if (uri == null) null else withContext(Dispatchers.IO) {
            runCatching { DocumentImageCache.load(context, uri) }.getOrNull()
        }
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        val current = bitmap
        if (current != null) {
            if (blurredCover) {
                Image(
                    current.asImageBitmap(),
                    null,
                    Modifier.fillMaxSize().blur(20.dp),
                    contentScale = ContentScale.Crop,
                )
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .18f)))
                Image(current.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            } else {
                Image(current.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = scale)
            }
        } else if (fallback) {
            Icon(Icons.Default.PlayArrow, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun YuraiveTheme(dark: Boolean, accent: Color, content: @Composable () -> Unit) {
    val base = if (dark) androidx.compose.material3.darkColorScheme() else androidx.compose.material3.lightColorScheme()
    val container = Color(ColorUtils.blendARGB(accent.toArgb(), base.surface.toArgb(), if (dark) .64f else .82f))
    val scheme = base.copy(
        primary = accent,
        onPrimary = Color.White,
        primaryContainer = container,
        secondary = Color(ColorUtils.blendARGB(accent.toArgb(), base.secondary.toArgb(), .42f)),
    )
    MaterialTheme(colorScheme = scheme, content = content)
}

private fun parseColor(value: String?, fallback: Color): Color = runCatching {
    if (value == null) fallback else Color(value.toColorInt())
}.getOrDefault(fallback)

private fun formatDuration(value: Long): String {
    val seconds = value.coerceAtLeast(0) / 1_000
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

private fun formatDate(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("M/d HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrDefault(value)

private fun playerSecondaryLabel(state: PlaybackUiState): String = when {
    state.status == PlaybackStatus.COMPLETED -> "再生完了"
    state.controls.showSceneName && state.sceneName.isNotBlank() -> state.sceneName
    state.controls.showFileName && state.fileName.isNotBlank() -> state.fileName
    state.isPlaying -> "再生中"
    else -> "一時停止"
}

private object DocumentImageCache {
    private val cache = object : LruCache<String, android.graphics.Bitmap>(32 * 1024) {
        override fun sizeOf(key: String, value: android.graphics.Bitmap): Int = value.allocationByteCount / 1024
    }

    fun load(context: android.content.Context, value: String): android.graphics.Bitmap? {
        cache.get(value)?.let { return it }
        val uri = Uri.parse(value)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > 2_048 || bounds.outHeight / sample > 2_048) sample *= 2
        val bitmap = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        cache.put(value, bitmap)
        return bitmap
    }
}
