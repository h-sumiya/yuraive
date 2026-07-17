@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import androidx.core.graphics.*
import androidx.media3.ui.*
import com.yuraive.player.R
import com.yuraive.player.YuraiveApplication
import com.yuraive.player.data.*
import com.yuraive.player.model.*
import com.yuraive.player.playback.*
import java.time.*
import kotlin.math.*
import kotlinx.coroutines.*

@Composable
internal fun MiniPlayer(
    state: PlaybackUiState,
    open: () -> Unit,
    toggle: () -> Unit,
    stop: () -> Unit,
) {
    var rawDragOffset by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val swipeThreshold = with(LocalDensity.current) { 56.dp.toPx() }
    val dragOffset by
        animateFloatAsState(
            targetValue = if (dragging) rawDragOffset else 0f,
            animationSpec = if (dragging) snap() else tween(160),
            label = "mini player swipe offset",
        )
    Surface(
        tonalElevation = 3.dp,
        modifier =
            Modifier.fillMaxWidth()
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
            Artwork(
                state.visualUri,
                Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)),
                fallback = true,
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    state.title.ifBlank { HiddenTextPlaceholder },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    state.error ?: playerSecondaryLabel(state),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color =
                        if (state.error != null) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = toggle, enabled = state.status != PlaybackStatus.LOADING) {
                Icon(if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, null)
            }
        }
    }
}

@Composable
internal fun LibraryScreen(
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
    val windowsRootUris =
        windowsDevices.flatMapTo(mutableSetOf(), WindowsDeviceConnection::rootUris)
    val localRoots = roots.filterNot { it.grant.uri in windowsRootUris }
    val filteredRoots =
        if (normalizedQuery.isEmpty()) roots
        else roots.filter { it.grant.name.contains(normalizedQuery, ignoreCase = true) }
    val filteredGraphs =
        if (normalizedQuery.isEmpty()) knownGraphs
        else
            knownGraphs.filter {
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
                                IconButton(
                                    onClick = {
                                        searching = false
                                        query = ""
                                    }
                                ) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "検索を閉じる")
                                }
                            },
                        )
                    }
                )
            } else {
                CenterAlignedTopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { searching = true }) {
                            Icon(Icons.Default.Search, "検索")
                        }
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
                    item(key = "quick-played") {
                        QuickActionCard("再生した作品", Icons.Default.History, openPlayed)
                    }
                    item(key = "quick-recent") {
                        QuickActionCard("最近追加", Icons.Default.Update, openRecent)
                    }
                    item(key = "quick-favorite") {
                        QuickActionCard("最近のお気に入り", Icons.Default.Favorite, openFavorites)
                    }
                    item(key = "quick-shuffle") {
                        QuickActionCard("シャッフル", Icons.Default.Shuffle, shuffle)
                    }
                    item(key = "library-title", span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "ライブラリ",
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            IconButton(onClick = refresh) { Icon(Icons.Default.Refresh, "更新") }
                            IconButton(onClick = addFolder) { Icon(Icons.Default.Add, "フォルダを追加") }
                        }
                    }
                } else {
                    item(key = "search-title", span = { GridItemSpan(maxLineSpan) }) {
                        Text(
                            "検索結果",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }

                if (!searching) {
                    gridItems(localRoots, key = { "root:${it.grant.uri}" }) { root ->
                        RootGridCard(
                            root,
                            app,
                            { browseRoot(root) },
                            { removeRoot(root.grant.uri) },
                        )
                    }
                    item(key = "add-folder") { AddFolderCard(addFolder) }
                    windowsDevices.forEach { device ->
                        item(
                            key = "windows-device:${device.id}",
                            span = { GridItemSpan(maxLineSpan) },
                        ) {
                            WindowsDeviceHeader(
                                device = device,
                                refresh = { refreshWindowsDevice(device.id) },
                                remove = { removeWindowsDevice(device.id) },
                            )
                        }
                        val deviceRoots =
                            roots
                                .filter { it.grant.uri in device.rootUris }
                                .map { root ->
                                    val prefix = "${device.name} · "
                                    if (root.grant.name.startsWith(prefix)) {
                                        root.copy(
                                            grant =
                                                root.grant.copy(
                                                    name = root.grant.name.removePrefix(prefix)
                                                )
                                        )
                                    } else root
                                }
                        gridItems(deviceRoots, key = { "root:${it.grant.uri}" }) { root ->
                            RootGridCard(root, app, { browseRoot(root) }, {}, showDelete = false)
                        }
                    }
                } else {
                    gridItems(filteredRoots, key = { "root:${it.grant.uri}" }) { root ->
                        val isWindowsRoot = root.grant.uri in windowsRootUris
                        RootGridCard(
                            root,
                            app,
                            { browseRoot(root) },
                            { removeRoot(root.grant.uri) },
                            showDelete = !isWindowsRoot,
                        )
                    }
                    gridItems(filteredGraphs, key = { "graph:${it.ref.graphId}" }) { graph ->
                        GraphGridCard(
                            graph,
                            graph.ref.graphId in favoriteIds,
                            openGraph,
                            inspectGraph,
                            toggleFavorite,
                        )
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
internal fun QuickActionCard(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(86.dp),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Text(
                label,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun WindowsDeviceHeader(
    device: WindowsDeviceConnection,
    refresh: () -> Unit,
    remove: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(10.dp)
                .clip(CircleShape)
                .background(
                    when (device.status) {
                        WindowsConnectionStatus.CONNECTED -> Color(0xFF34C759)
                        WindowsConnectionStatus.CONNECTING,
                        WindowsConnectionStatus.LOADING -> Color(0xFFFF9500)
                        WindowsConnectionStatus.OFFLINE ->
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .4f)
                    }
                )
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
internal fun RootGridCard(
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
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (preview != null && thumbnailUri != null) {
                    Artwork(
                        thumbnailUri,
                        Modifier.fillMaxSize(),
                        fallback = false,
                        blurredCover = true,
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(
                            if (root.error == null) Icons.Default.Folder
                            else Icons.Default.WarningAmber,
                            null,
                            Modifier.size(54.dp),
                            tint =
                                if (root.error == null) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.error,
                        )
                    }
                }
                if (showDelete) {
                    IconButton(
                        onClick = remove,
                        modifier =
                            Modifier.align(Alignment.TopEnd)
                                .background(
                                    MaterialTheme.colorScheme.surface.copy(alpha = .85f),
                                    CircleShape,
                                ),
                    ) {
                        Icon(Icons.Default.DeleteOutline, "削除")
                    }
                }
            }
            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().height(60.dp),
            ) {
                Column(
                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        root.grant.name,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    root.error?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun AddFolderCard(addFolder: () -> Unit) {
    Card(
        onClick = addFolder,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Add,
                    null,
                    Modifier.size(42.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Box(Modifier.fillMaxWidth().height(60.dp), contentAlignment = Alignment.CenterStart) {
                Text(
                    "フォルダを追加",
                    Modifier.padding(horizontal = 12.dp),
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
internal fun FolderGridCard(
    folder: LibraryFolder,
    root: LibraryRoot,
    app: YuraiveApplication,
    open: () -> Unit,
) {
    var previewGraph by
        remember(root.grant.uri, folder.relativePath) { mutableStateOf<LibraryGraph?>(null) }
    LaunchedEffect(root.grant.uri, folder.relativePath) {
        // Only inspect a folder once its card is composed. This keeps traversal lazy while
        // allowing a direct child content folder to inherit its first JSON thumbnail.
        previewGraph =
            runCatching {
                    app.library
                        .inspectDirectory(root.grant, folder.relativePath)
                        .graphs
                        .firstOrNull()
                }
                .getOrNull()
    }
    val thumbnailUri = rememberThumbnailUri(previewGraph, app)
    Card(
        onClick = open,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (thumbnailUri != null) {
                    Artwork(
                        thumbnailUri,
                        Modifier.fillMaxSize(),
                        fallback = false,
                        blurredCover = true,
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Folder,
                            null,
                            Modifier.size(52.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
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
internal fun GraphGridCard(
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
            modifier =
                Modifier.fillMaxWidth()
                    .pointerInput(graph.ref.graphId) {
                        awaitEachGesture {
                            menuPosition =
                                awaitFirstDown(
                                        requireUnconsumed = false,
                                        pass = PointerEventPass.Initial,
                                    )
                                    .position
                        }
                    }
                    .combinedClickable(
                        enabled = graph.parseError == null,
                        onClick = { open(graph) },
                        onLongClick = { menuExpanded = true },
                        onLongClickLabel = "作品メニューを開く",
                    ),
            colors =
                CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        ) {
            Column {
                Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
                    Artwork(
                        thumbnailUri,
                        Modifier.fillMaxSize(),
                        fallback = true,
                        blurredCover = true,
                    )
                    IconButton(
                        onClick = { toggleFavorite(graph.ref.graphId) },
                        modifier =
                            Modifier.align(Alignment.TopEnd)
                                .background(
                                    MaterialTheme.colorScheme.surface.copy(alpha = .85f),
                                    CircleShape,
                                ),
                    ) {
                        Icon(
                            if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            if (favorite) "お気に入りから削除" else "お気に入りに追加",
                            tint =
                                if (favorite) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
                Column(Modifier.padding(12.dp)) {
                    Text(
                        graph.displayName,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        graph.parseError ?: graph.author ?: graph.ref.fileName,
                        style = MaterialTheme.typography.bodySmall,
                        color =
                            if (graph.parseError != null) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Box(
            Modifier.offset { IntOffset(menuPosition.x.roundToInt(), menuPosition.y.roundToInt()) }
                .size(1.dp)
        ) {
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                DropdownMenuItem(
                    text = { Text("作品情報とアセット") },
                    leadingIcon = { Icon(Icons.Default.Info, null) },
                    enabled = graph.parseError == null,
                    onClick = {
                        menuExpanded = false
                        inspect(graph)
                    },
                )
                DropdownMenuItem(
                    text = { Text(if (favorite) "お気に入りから削除" else "お気に入りに追加") },
                    leadingIcon = {
                        Icon(
                            if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            null,
                        )
                    },
                    onClick = {
                        menuExpanded = false
                        toggleFavorite(graph.ref.graphId)
                    },
                )
                if (graph.parseError != null) {
                    DropdownMenuItem(
                        text = { Text(graph.parseError, color = MaterialTheme.colorScheme.error) },
                        leadingIcon = {
                            Icon(
                                Icons.Default.WarningAmber,
                                null,
                                tint = MaterialTheme.colorScheme.error,
                            )
                        },
                        enabled = false,
                        onClick = {},
                    )
                }
            }
        }
    }
}
