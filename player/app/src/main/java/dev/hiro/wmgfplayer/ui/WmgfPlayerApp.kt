@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package dev.hiro.wmgfplayer.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Pause
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.toColorInt
import androidx.core.view.WindowCompat
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import dev.hiro.wmgfplayer.WmgfApplication
import dev.hiro.wmgfplayer.data.LibraryFolder
import dev.hiro.wmgfplayer.data.LibraryGraph
import dev.hiro.wmgfplayer.data.LibraryRoot
import dev.hiro.wmgfplayer.data.PlayerSettings
import dev.hiro.wmgfplayer.data.ThemeMode
import dev.hiro.wmgfplayer.data.isContent
import dev.hiro.wmgfplayer.data.previewGraph
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.PlaybackHistoryEntry
import dev.hiro.wmgfplayer.model.ValidationIssue
import dev.hiro.wmgfplayer.playback.PlaybackRuntime
import dev.hiro.wmgfplayer.playback.PlaybackStatus
import dev.hiro.wmgfplayer.playback.PlaybackUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToLong

private enum class Destination { LIBRARY, HISTORY, SETTINGS }

private data class GraphCollection(
    val title: String,
    val graphs: List<LibraryGraph> = emptyList(),
    val loading: Boolean = false,
)

private val accents = listOf(
    Color(0xFF8065C4),
    Color(0xFF6750A4),
    Color(0xFF955C9D),
    Color(0xFF5F6DB4),
)

@Composable
fun WmgfPlayerApp(
    addFolder: () -> Unit,
    exportHistory: () -> Unit,
    ensureNotificationPermission: () -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmgfApplication
    val settings by app.settings.state.collectAsStateWithLifecycle()
    val playback by PlaybackRuntime.state.collectAsStateWithLifecycle()
    val roots by app.library.roots.collectAsStateWithLifecycle()
    val knownGraphs by app.library.knownGraphs.collectAsStateWithLifecycle()
    val favoriteIds by app.library.favoriteIds.collectAsStateWithLifecycle()
    val player by PlaybackRuntime.player.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var destination by remember { mutableStateOf(Destination.LIBRARY) }
    var showPlayer by remember { mutableStateOf(false) }
    var browserRoot by remember { mutableStateOf<LibraryRoot?>(null) }
    var collection by remember { mutableStateOf<GraphCollection?>(null) }
    var libraryRoots by remember { mutableStateOf<List<LibraryRoot>>(emptyList()) }
    var scanning by remember { mutableStateOf(true) }
    var validation by remember { mutableStateOf<Pair<GraphRef, List<ValidationIssue>>?>(null) }
    var validating by remember { mutableStateOf(false) }
    var scanVersion by remember { mutableStateOf(0) }

    BackHandler(enabled = showPlayer) { showPlayer = false }
    BackHandler(enabled = !showPlayer && collection != null) { collection = null }
    BackHandler(enabled = !showPlayer && browserRoot != null) { browserRoot = null }
    BackHandler(enabled = !showPlayer && browserRoot == null && collection == null && destination != Destination.LIBRARY) {
        destination = Destination.LIBRARY
    }

    val dark = when (settings.themeMode) {
        ThemeMode.SYSTEM -> androidx.compose.foundation.isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? ComponentActivity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    LaunchedEffect(roots, scanVersion) {
        scanning = true
        libraryRoots = app.library.scanAll()
        scanning = false
    }

    val openGraph: (LibraryGraph) -> Unit = { item ->
        if (item.parseError == null) scope.launch {
            validating = true
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
            validating = false
        }
    }

    val showResolvedCollection: (String, List<String>) -> Unit = { title, graphIds ->
        collection = GraphCollection(title, loading = true)
        scope.launch {
            val resolved = app.library.resolveGraphs(graphIds)
            if (collection?.title == title && collection?.loading == true) {
                collection = GraphCollection(title, resolved)
            }
        }
    }

    WmgTheme(dark = dark, accent = accents[settings.accentIndex.mod(accents.size)]) {
        Surface(Modifier.fillMaxSize()) {
            if (showPlayer && playback.status != PlaybackStatus.IDLE) {
                PlayerScreen(
                    state = playback,
                    player = player,
                    onBack = { showPlayer = false },
                    onToggle = { PlaybackRuntime.toggle(context) },
                    onSeek = { PlaybackRuntime.seek(context, it) },
                    onRetry = { PlaybackRuntime.restart(context) },
                    onNext = { PlaybackRuntime.next(context) },
                    onPrevious = { PlaybackRuntime.previous(context) },
                    onStop = { PlaybackRuntime.stop(context); showPlayer = false },
                    onButton = { PlaybackRuntime.pressButton(context, it) },
                )
            } else if (collection != null) {
                GraphCollectionScreen(
                    collection = collection!!,
                    favoriteIds = favoriteIds,
                    onBack = { collection = null },
                    openGraph = openGraph,
                    toggleFavorite = app.library::toggleFavorite,
                )
            } else if (browserRoot != null) {
                DirectoryBrowserScreen(
                    root = browserRoot!!,
                    app = app,
                    favoriteIds = favoriteIds,
                    onBack = { browserRoot = null },
                    openGraph = openGraph,
                    toggleFavorite = app.library::toggleFavorite,
                )
            } else {
                MainScaffold(
                    playback = playback,
                    openPlayer = { showPlayer = true },
                    togglePlayback = { PlaybackRuntime.toggle(context) },
                ) { padding ->
                    when (destination) {
                        Destination.LIBRARY -> LibraryScreen(
                            modifier = Modifier.padding(padding),
                            roots = libraryRoots,
                            scanning = scanning || validating,
                            addFolder = addFolder,
                            refresh = { scanVersion++ },
                            removeRoot = { app.library.removeRoot(it) },
                            browseRoot = { root ->
                                if (root.directory?.isContent == true) {
                                    collection = GraphCollection(root.grant.name, root.directory.graphs)
                                } else {
                                    browserRoot = root
                                }
                            },
                            knownGraphs = knownGraphs,
                            favoriteIds = favoriteIds,
                            openHistory = { destination = Destination.HISTORY },
                            openSettings = { destination = Destination.SETTINGS },
                            openPlayed = {
                                collection = GraphCollection("再生した作品", loading = true)
                                scope.launch {
                                    val ids = app.history.readAll().map { it.graphId }.distinct()
                                    val graphs = app.library.resolveGraphs(ids)
                                    if (collection?.title == "再生した作品" && collection?.loading == true) {
                                        collection = GraphCollection("再生した作品", graphs)
                                    }
                                }
                            },
                            openRecent = {
                                collection = GraphCollection(
                                    "最近追加",
                                    knownGraphs.sortedByDescending(LibraryGraph::modifiedAt),
                                )
                            },
                            openFavorites = {
                                showResolvedCollection("最近のお気に入り", app.library.favoriteIdsByRecent())
                            },
                            shuffle = {
                                knownGraphs.filter { it.parseError == null }.randomOrNull()?.let(openGraph)
                                    ?: run { collection = GraphCollection("シャッフル", emptyList()) }
                            },
                            openGraph = openGraph,
                            toggleFavorite = app.library::toggleFavorite,
                        )
                        Destination.HISTORY -> HistoryScreen(
                            modifier = Modifier.padding(padding),
                            app = app,
                            export = exportHistory,
                            onBack = { destination = Destination.LIBRARY },
                        )
                        Destination.SETTINGS -> SettingsScreen(
                            modifier = Modifier.padding(padding),
                            settings = settings,
                            update = app.settings::update,
                            onBack = { destination = Destination.LIBRARY },
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
    }
}

@Composable
private fun MainScaffold(
    playback: PlaybackUiState,
    openPlayer: () -> Unit,
    togglePlayback: () -> Unit,
    content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit,
) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            AnimatedVisibility(playback.status != PlaybackStatus.IDLE) {
                Column(Modifier.navigationBarsPadding()) {
                    MiniPlayer(playback, openPlayer, togglePlayback)
                }
            }
        },
        content = content,
    )
}

@Composable
private fun MiniPlayer(state: PlaybackUiState, open: () -> Unit, toggle: () -> Unit) {
    Surface(
        tonalElevation = 3.dp,
        modifier = Modifier.fillMaxWidth().height(70.dp).clickable(onClick = open),
    ) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(state.visualUri, Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)), fallback = true)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
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
    scanning: Boolean,
    addFolder: () -> Unit,
    refresh: () -> Unit,
    removeRoot: (String) -> Unit,
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
    toggleFavorite: (String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmgfApplication
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    BackHandler(enabled = searching) {
        searching = false
        query = ""
    }
    val normalizedQuery = query.trim()
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
                    title = { Text("WMGF Player", fontWeight = FontWeight.Bold) },
                    actions = {
                        IconButton(onClick = openHistory) { Icon(Icons.Default.History, "履歴") }
                        IconButton(onClick = openSettings) { Icon(Icons.Default.Settings, "設定") }
                    },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!searching) {
                    item(key = "quick-played") { QuickActionCard("履歴", Icons.Default.History, openPlayed) }
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

                gridItems(filteredRoots, key = { "root:${it.grant.uri}" }) { root ->
                    RootGridCard(root, app, { browseRoot(root) }, { removeRoot(root.grant.uri) })
                }
                if (!searching) {
                    item(key = "add-folder") { AddFolderCard(addFolder) }
                } else {
                    gridItems(filteredGraphs, key = { "graph:${it.ref.graphId}" }) { graph ->
                        GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, toggleFavorite)
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
            if (scanning) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 28.dp).size(36.dp))
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
private fun RootGridCard(root: LibraryRoot, app: WmgfApplication, open: () -> Unit, remove: () -> Unit) {
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
                IconButton(
                    onClick = remove,
                    modifier = Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.surface.copy(alpha = .85f), CircleShape),
                ) { Icon(Icons.Default.DeleteOutline, "削除") }
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
    app: WmgfApplication,
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
    toggleFavorite: (String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmgfApplication
    val thumbnailUri = rememberThumbnailUri(graph, app)
    Card(
        onClick = { open(graph) },
        enabled = graph.parseError == null,
        modifier = Modifier.fillMaxWidth(),
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
}

@Composable
private fun rememberThumbnailUri(graph: LibraryGraph?, app: WmgfApplication): String? {
    var thumbnailUri by remember(graph?.ref?.graphId, graph?.thumbnailPath) { mutableStateOf<String?>(null) }
    LaunchedEffect(graph?.ref?.graphId, graph?.thumbnailPath) {
        thumbnailUri = if (graph == null) null else graph.thumbnailPath?.let {
            app.library.assetUri(graph.ref, it)?.toString()
        }
    }
    return thumbnailUri
}

@Composable
private fun GraphCollectionScreen(
    collection: GraphCollection,
    favoriteIds: Set<String>,
    onBack: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
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
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                gridItems(collection.graphs, key = { it.ref.graphId }) { graph ->
                    GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, toggleFavorite)
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
    app: WmgfApplication,
    favoriteIds: Set<String>,
    onBack: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var directories by remember(root.grant.uri) { mutableStateOf(root.directory?.let(::listOf).orEmpty()) }
    var loading by remember(root.grant.uri) { mutableStateOf(root.directory == null) }
    var error by remember(root.grant.uri) { mutableStateOf(root.error) }
    val current = directories.lastOrNull()

    fun load(path: String, replace: Boolean = false) {
        if (loading) return
        loading = true
        error = null
        scope.launch {
            runCatching { app.library.inspectDirectory(root.grant, path) }
                .onSuccess { directory ->
                    directories = if (replace) listOf(directory) else directories + directory
                }
                .onFailure { error = it.message ?: "フォルダを読み込めません" }
            loading = false
        }
    }

    LaunchedEffect(root.grant.uri) {
        if (directories.isEmpty()) {
            loading = false
            load("", replace = true)
        }
    }
    fun goBack() {
        if (directories.size > 1) directories = directories.dropLast(1) else onBack()
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
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (directory.isContent) {
                        gridItems(directory.graphs, key = { it.ref.graphId }) { graph ->
                            GraphGridCard(graph, graph.ref.graphId in favoriteIds, openGraph, toggleFavorite)
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

@Composable
private fun PlayerScreen(
    state: PlaybackUiState,
    player: androidx.media3.common.Player?,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
    onRetry: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onStop: () -> Unit,
    onButton: (String) -> Unit,
) {
    var showInfo by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (state.isVideo && player != null) {
            AndroidView(
                factory = { context -> PlayerView(context).apply { useController = false; this.player = player } },
                update = { view ->
                    view.player = player
                    view.resizeMode = when (state.fit) {
                        "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                        else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Crossfade(state.visualUri, animationSpec = tween(state.imageTransitionMs), label = "artwork") { uri ->
                Artwork(uri, Modifier.fillMaxSize(), fallback = true, scale = if (state.fit == "contain") ContentScale.Fit else ContentScale.Crop)
            }
        }

        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = if (state.isVideo) .16f else .25f)))

        BoxWithConstraints(Modifier.fillMaxSize()) {
            state.buttons.filter { it.visible }.forEach { button ->
                val color = parseColor(button.style.backgroundColor, MaterialTheme.colorScheme.primary)
                val textColor = parseColor(button.style.textColor, Color.White)
                val borderColor = parseColor(button.style.borderColor, Color.Transparent)
                val shape = RoundedCornerShape((button.style.borderRadius ?: 18f).dp)
                Surface(
                    onClick = { onButton(button.id) },
                    shape = shape,
                    color = color.copy(alpha = button.style.opacity ?: .94f),
                    contentColor = textColor,
                    border = androidx.compose.foundation.BorderStroke((button.style.borderWidth ?: 0f).dp, borderColor),
                    modifier = Modifier
                        .offset(maxWidth * button.layout.x, maxHeight * button.layout.y)
                        .size(maxWidth * button.layout.width, maxHeight * button.layout.height),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        button.style.backgroundImage?.let { Artwork(it, Modifier.fillMaxSize(), fallback = false) }
                        Box(Modifier.fillMaxSize().background(color.copy(alpha = if (button.style.backgroundImage == null) 0f else .38f)))
                        Text(button.text, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 10.dp), color = textColor)
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledIconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
            Spacer(Modifier.weight(1f))
            if (state.controls.allowStop) IconButton(onClick = onStop) { Icon(Icons.Default.Close, "再生を停止", tint = Color.White) }
        }

        PlayerControls(state, onToggle, onSeek, onNext, onPrevious, { showInfo = true }, Modifier.align(Alignment.BottomCenter))

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
private fun PlayerControls(
    state: PlaybackUiState,
    toggle: () -> Unit,
    seek: (Long) -> Unit,
    next: () -> Unit,
    previous: () -> Unit,
    showInfo: () -> Unit,
    modifier: Modifier,
) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1)
    val progress = dragging ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    Surface(modifier.fillMaxWidth(), color = Color.Black.copy(alpha = .64f)) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(state.title, Modifier.weight(1f), color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = showInfo, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.Info, "作品情報", tint = Color.White.copy(alpha = .82f)) }
            }
            if (state.status == PlaybackStatus.COMPLETED) {
                Text("再生完了", color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.bodySmall)
            } else {
                if (state.controls.showSceneName && state.sceneName.isNotBlank()) Text(state.sceneName, color = Color.White.copy(alpha = .78f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (state.controls.showFileName && state.fileName.isNotBlank()) Text(state.fileName, color = Color.White.copy(alpha = .58f), style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (state.controls.showSeekBar) Slider(
                value = progress,
                onValueChange = { dragging = it },
                onValueChangeFinished = { dragging?.let { seek((it * duration).roundToLong()) }; dragging = null },
                enabled = state.controls.allowSeek && state.durationMs > 0,
            )
            if (state.controls.showPlaybackTime) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatDuration((progress * duration).roundToLong()), color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.labelSmall)
                Text(formatDuration(state.durationMs), color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.labelSmall)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    if (state.controls.allowPrevious) IconButton(onClick = previous, enabled = state.canPrevious) { Icon(Icons.Default.SkipPrevious, "前のシーン", tint = Color.White.copy(alpha = if (state.canPrevious) 1f else .35f)) }
                }
                FilledIconButton(onClick = toggle, modifier = Modifier.size(58.dp), enabled = state.status != PlaybackStatus.LOADING) {
                    Icon(if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, if (state.isPlaying) "一時停止" else "再生", Modifier.size(30.dp))
                }
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    if (state.controls.allowNext) IconButton(onClick = next, enabled = state.canNext) { Icon(Icons.Default.SkipNext, "次のシーン", tint = Color.White.copy(alpha = if (state.canNext) 1f else .35f)) }
                }
            }
        }
    }
}

@Composable
private fun ContentInfoDialog(state: PlaybackUiState, close: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    AlertDialog(
        onDismissRequest = close,
        icon = { Icon(Icons.Default.Info, null) },
        title = { Text(state.title) },
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

@Composable
private fun HistoryScreen(modifier: Modifier, app: WmgfApplication, export: () -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<PlaybackHistoryEntry>>(emptyList()) }
    val expandedSessions = remember { mutableStateMapOf<String, Boolean>() }
    var clearDialog by remember { mutableStateOf(false) }
    var version by remember { mutableStateOf(0) }
    LaunchedEffect(version) { entries = app.history.readAll() }
    val sessions = entries
        .groupBy(PlaybackHistoryEntry::runId)
        .map { (runId, sessionEntries) -> PlaybackSession(runId, sessionEntries.sortedBy { it.startedAt }) }
        .sortedByDescending { it.endedAt }
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("履歴", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
                actions = {
                    IconButton(onClick = export, enabled = entries.isNotEmpty()) { Icon(Icons.Default.SaveAlt, "書き出し") }
                    IconButton(onClick = { clearDialog = true }, enabled = entries.isNotEmpty()) { Icon(Icons.Default.DeleteOutline, "削除") }
                },
            )
        },
    ) { padding ->
        if (entries.isEmpty()) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text("再生履歴はありません", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        else LazyColumn(Modifier.padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(sessions, key = PlaybackSession::runId) { session ->
                HistorySessionCard(
                    session = session,
                    expanded = expandedSessions[session.runId] == true,
                    toggle = { expandedSessions[session.runId] = expandedSessions[session.runId] != true },
                )
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

private data class PlaybackSession(
    val runId: String,
    val entries: List<PlaybackHistoryEntry>,
) {
    val graphId: String get() = entries.first().graphId
    val startedAt: String get() = entries.first().startedAt
    val endedAt: String get() = entries.last().endedAt
    val activePlayMs: Long get() = entries.sumOf(PlaybackHistoryEntry::activePlayMs)
}

@Composable
private fun HistorySessionCard(session: PlaybackSession, expanded: Boolean, toggle: () -> Unit) {
    Card(onClick = toggle, modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(42.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Default.History, null, tint = MaterialTheme.colorScheme.onSecondaryContainer) }
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(historyGraphName(session.graphId), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${formatDate(session.startedAt)} · ${session.entries.size}シーン",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(formatDuration(session.activePlayMs), style = MaterialTheme.typography.labelLarge)
                Text(endReasonLabel(session.entries.last().endReason), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(if (expanded) Icons.Default.ExpandMore else Icons.AutoMirrored.Filled.KeyboardArrowRight, if (expanded) "閉じる" else "詳細")
        }
        if (expanded) {
            HorizontalDivider(Modifier.padding(horizontal = 14.dp))
            session.entries.forEach { entry -> HistoryEntryRow(entry) }
        }
    }
}

@Composable
private fun HistoryEntryRow(entry: PlaybackHistoryEntry) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(entry.mediaId, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(entry.nodeId + " · " + endReasonLabel(entry.endReason), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(formatDuration(entry.activePlayMs), style = MaterialTheme.typography.labelLarge)
            Text(formatDate(entry.endedAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun historyGraphName(graphId: String): String = graphId
    .substringAfter("::", graphId)
    .substringAfterLast('/')
    .removeSuffix(".wmg.json")

@Composable
private fun SettingsScreen(
    modifier: Modifier,
    settings: PlayerSettings,
    update: ((PlayerSettings) -> PlayerSettings) -> Unit,
    onBack: () -> Unit,
) {
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
        LazyColumn(Modifier.padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(26.dp)) {
            item {
                SettingGroup("テーマ") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(ThemeMode.SYSTEM to Icons.Default.Settings, ThemeMode.LIGHT to Icons.Default.LightMode, ThemeMode.DARK to Icons.Default.DarkMode).forEach { (mode, icon) ->
                            val selected = settings.themeMode == mode
                            Surface(
                                onClick = { update { it.copy(themeMode = mode) } },
                                modifier = Modifier.weight(1f).aspectRatio(1.05f),
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
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("すべて表示・許可", fontWeight = FontWeight.SemiBold)
                            Text("作品側の表示・操作制限を一時的に無視します", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = settings.forceShowPlayerControls, onCheckedChange = { enabled -> update { it.copy(forceShowPlayerControls = enabled) } })
                    }
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
        }
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
private fun WmgTheme(dark: Boolean, accent: Color, content: @Composable () -> Unit) {
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

private fun endReasonLabel(value: String) = when (value) {
    "completed" -> "完了"
    "button" -> "選択"
    "stopped" -> "停止"
    "restarted" -> "再スタート"
    "error" -> "エラー"
    else -> "中断"
}

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
