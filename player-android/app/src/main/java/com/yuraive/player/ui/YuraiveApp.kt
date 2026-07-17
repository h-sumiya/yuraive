@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yuraive.player.YuraiveApplication
import com.yuraive.player.data.LibraryGraph
import com.yuraive.player.data.LibraryRoot
import com.yuraive.player.data.RootGrant
import com.yuraive.player.data.ThemeMode
import com.yuraive.player.data.isContent
import com.yuraive.player.model.GraphRef
import com.yuraive.player.model.ValidationIssue
import com.yuraive.player.playback.PlaybackRuntime
import com.yuraive.player.playback.PlaybackStatus
import com.yuraive.player.playback.PlaybackUiState
import kotlinx.coroutines.launch

private enum class Destination {
    LIBRARY,
    HISTORY,
    SETTINGS,
    LICENSES,
}

internal data class GraphCollection(
    val title: String,
    val graphs: List<LibraryGraph> = emptyList(),
    val loading: Boolean = false,
)

internal val accents =
    listOf(Color(0xFF944BF8), Color(0xFF02A5FE), Color(0xFF3147D4), Color(0xFF574DE5))

internal const val HiddenTextPlaceholder = "???"
internal const val HiddenTimePlaceholder = "??:??"
internal val MaxGridContentWidth = 1_200.dp
internal val MaxListContentWidth = 900.dp
internal val MaxSettingsContentWidth = 720.dp
internal val MaxPortraitPlayerWidth = 560.dp

internal fun adaptiveGridColumnCount(widthDp: Int): Int =
    when {
        widthDp < 600 -> 2
        widthDp < 840 -> 3
        widthDp < 1_200 -> 4
        else -> 5
    }

internal fun isTwoPanePlayerLayout(widthDp: Int, heightDp: Int): Boolean = widthDp > heightDp

@Composable
internal fun AdaptiveGrid(modifier: Modifier = Modifier, content: LazyGridScope.() -> Unit) {
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
internal fun CenteredContent(
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

    val activeBrowserRoot =
        browserRoot
            ?: browserRootUri?.let { uri ->
                libraryRoots.firstOrNull { it.grant.uri == uri }
                    ?: roots.firstOrNull { it.uri == uri }?.let(::LibraryRoot)
            }

    fun updateCollection(
        value: GraphCollection?,
        graphIds: List<String>? = value?.graphs.orEmpty().map { it.ref.graphId },
    ) {
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
    BackHandler(
        enabled =
            !showPlayer &&
                activeBrowserRoot == null &&
                collection == null &&
                destination == Destination.LICENSES
    ) {
        destination = Destination.SETTINGS
    }
    BackHandler(
        enabled =
            !showPlayer &&
                activeBrowserRoot == null &&
                collection == null &&
                destination in setOf(Destination.HISTORY, Destination.SETTINGS)
    ) {
        destination = Destination.LIBRARY
    }
    BackHandler(enabled = inspectedGraph != null) { inspectedGraph = null }

    val playerVisible = showPlayer && !showStats && playback.status != PlaybackStatus.IDLE
    val dark =
        when (settings.themeMode) {
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
        val graphIds =
            savedCollectionGraphIds
                ?: if (title == "再生した作品") {
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
        if (item.parseError == null)
            scope.launch {
                runCatching {
                        val graph = app.library.readGraph(item.ref)
                        item.ref to app.library.validate(item.ref, graph)
                    }
                    .onSuccess { (ref, issues) ->
                        if (issues.isEmpty()) {
                            ensureNotificationPermission()
                            PlaybackRuntime.play(context, ref)
                            showPlayer = true
                        } else validation = ref to issues
                    }
                    .onFailure {
                        validation =
                            item.ref to
                                listOf(
                                    ValidationIssue(
                                        ValidationIssue.Severity.ERROR,
                                        it.message ?: "読み込めません",
                                    )
                                )
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
    val activeAccent =
        if (showPlayer)
            playback.controls.accentColor?.let { parseColor(it, userAccent) } ?: userAccent
        else userAccent
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
                    onToggleFavorite = {
                        playback.graphRef?.graphId?.let(app.library::toggleFavorite)
                    },
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
                        collection != null ->
                            Box(Modifier.fillMaxSize().padding(padding)) {
                                GraphCollectionScreen(
                                    collection = collection!!,
                                    favoriteIds = favoriteIds,
                                    onBack = { updateCollection(null) },
                                    openGraph = openGraph,
                                    inspectGraph = { inspectedGraph = it },
                                    toggleFavorite = app.library::toggleFavorite,
                                )
                            }
                        activeBrowserRoot != null ->
                            Box(Modifier.fillMaxSize().padding(padding)) {
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
                        destination == Destination.LIBRARY ->
                            LibraryScreen(
                                modifier =
                                    Modifier.padding(padding)
                                        .then(
                                            if (playback.status == PlaybackStatus.IDLE) {
                                                Modifier.navigationBarsPadding()
                                            } else {
                                                Modifier
                                            }
                                        ),
                                roots = libraryRoots,
                                windowsDevices = windowsDevices,
                                addFolder = { showAddFolderDialog = true },
                                refresh = { scanVersion++ },
                                removeRoot = { app.library.removeRoot(it) },
                                removeWindowsDevice = { deviceId ->
                                    scope.launch { app.library.removeWindowsDevice(deviceId) }
                                },
                                refreshWindowsDevice = { deviceId ->
                                    scope.launch {
                                        runCatching { app.library.refreshWindowsDevice(deviceId) }
                                        scanVersion++
                                    }
                                },
                                browseRoot = { root ->
                                    browserInitialPath = null
                                    if (root.directory?.isContent == true) {
                                        updateCollection(
                                            GraphCollection(root.grant.name, root.directory.graphs)
                                        )
                                    } else {
                                        updateBrowserRoot(root)
                                    }
                                },
                                knownGraphs = knownGraphs,
                                favoriteIds = favoriteIds,
                                openHistory = { destination = Destination.HISTORY },
                                openSettings = { destination = Destination.SETTINGS },
                                openPlayed = {
                                    updateCollection(
                                        GraphCollection("再生した作品", loading = true),
                                        graphIds = null,
                                    )
                                    scope.launch {
                                        val ids =
                                            app.history.readAll().map { it.graphId }.distinct()
                                        val graphs = app.library.resolveGraphs(ids)
                                        if (
                                            collection?.title == "再生した作品" &&
                                                collection?.loading == true
                                        ) {
                                            updateCollection(GraphCollection("再生した作品", graphs))
                                        }
                                    }
                                },
                                openRecent = {
                                    updateCollection(
                                        GraphCollection(
                                            "最近追加",
                                            knownGraphs.sortedByDescending(LibraryGraph::modifiedAt),
                                        )
                                    )
                                },
                                openFavorites = {
                                    showResolvedCollection(
                                        "最近のお気に入り",
                                        app.library.favoriteIdsByRecent(),
                                    )
                                },
                                shuffle = {
                                    knownGraphs
                                        .filter { it.parseError == null }
                                        .randomOrNull()
                                        ?.let(openGraph)
                                        ?: run {
                                            updateCollection(GraphCollection("シャッフル", emptyList()))
                                        }
                                },
                                openGraph = openGraph,
                                inspectGraph = { inspectedGraph = it },
                                toggleFavorite = app.library::toggleFavorite,
                            )
                        destination == Destination.HISTORY ->
                            HistoryScreen(
                                modifier = Modifier.padding(padding),
                                app = app,
                                export = exportHistory,
                                onBack = { destination = Destination.LIBRARY },
                                openInLibrary = { graph ->
                                    val root =
                                        libraryRoots.firstOrNull {
                                            it.grant.uri == graph.ref.rootUri
                                        }
                                            ?: LibraryRoot(
                                                RootGrant(graph.ref.rootUri, graph.ref.rootName)
                                            )
                                    destination = Destination.LIBRARY
                                    updateCollection(null)
                                    browserInitialPath = graph.ref.parentPath
                                    updateBrowserRoot(root)
                                },
                            )
                        destination == Destination.SETTINGS ->
                            SettingsScreen(
                                modifier = Modifier.padding(padding),
                                settings = settings,
                                update = app.settings::update,
                                onBack = { destination = Destination.LIBRARY },
                                openLicenses = { destination = Destination.LICENSES },
                            )
                        else ->
                            LicensesScreen(
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
                                Text(
                                    if (issue.severity == ValidationIssue.Severity.ERROR) "●"
                                    else "△",
                                    color =
                                        if (issue.severity == ValidationIssue.Severity.ERROR)
                                            MaterialTheme.colorScheme.error
                                        else MaterialTheme.colorScheme.tertiary,
                                )
                                Text(issue.message, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                },
                confirmButton = {
                    if (errors.isEmpty())
                        Button(
                            onClick = {
                                validation = null
                                ensureNotificationPermission()
                                PlaybackRuntime.play(context, ref)
                                showPlayer = true
                            }
                        ) {
                            Text("再生")
                        }
                    else TextButton(onClick = { validation = null }) { Text("閉じる") }
                },
                dismissButton = {
                    if (errors.isEmpty())
                        TextButton(onClick = { validation = null }) { Text("キャンセル") }
                },
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
