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
internal fun rememberThumbnailUri(graph: LibraryGraph?, app: YuraiveApplication): String? {
    var thumbnailUri by
        remember(graph?.ref?.graphId, graph?.thumbnailPath) { mutableStateOf<String?>(null) }
    LaunchedEffect(graph?.ref?.graphId, graph?.thumbnailPath) {
        thumbnailUri =
            if (graph == null) null
            else graph.thumbnailPath?.let { app.library.assetUri(graph.ref, it)?.toString() }
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

    data class Folder(val name: String, val path: String, override val depth: Int) :
        InspectionTreeRow {
        override val key: String = "folder:$path"
    }

    data class File(val name: String, val asset: LibraryAssetInspection, override val depth: Int) :
        InspectionTreeRow {
        override val key: String = "file:${asset.path}"
    }
}

private fun inspectionTreeRows(
    assets: List<LibraryAssetInspection>,
    collapsedFolders: Set<String>,
): List<InspectionTreeRow> {
    val root = InspectionTreeBranch()
    assets.forEach { asset ->
        val parts =
            if (asset.problem == AssetInspectionProblem.UNSAFE_PATH) {
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
            val name =
                if (asset.problem == AssetInspectionProblem.UNSAFE_PATH) asset.path
                else asset.path.substringAfterLast('/')
            result += InspectionTreeRow.File(name, asset, depth)
        }
    }
    append(root, 0, "")
    return result
}

@Composable
internal fun ContentInspectionScreen(
    graph: LibraryGraph,
    app: YuraiveApplication,
    onBack: () -> Unit,
) {
    var inspection by
        remember(graph.ref.graphId) { mutableStateOf<LibraryContentInspection?>(null) }
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
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
                },
            )
        }
    ) { padding ->
        CenteredContent(Modifier.fillMaxSize().padding(padding), MaxListContentWidth) {
            contentModifier ->
            val content = inspection
            when {
                error != null ->
                    Column(
                        contentModifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            Icons.Default.WarningAmber,
                            null,
                            Modifier.size(36.dp),
                            tint = MaterialTheme.colorScheme.error,
                        )
                        Text("ファイルを解析できません", fontWeight = FontWeight.Bold)
                        Text(
                            error.orEmpty(),
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                        )
                    }
                content == null ->
                    Box(contentModifier, contentAlignment = Alignment.TopCenter) {
                        CircularProgressIndicator(Modifier.padding(top = 64.dp))
                    }
                else -> {
                    val metadata = content.graph.metadata
                    val rows = inspectionTreeRows(content.assets, collapsedFolders)
                    val missing = content.assets.count { !it.recognized }
                    val metadataRows =
                        listOfNotNull(
                            "ファイル" to graph.ref.fileName,
                            "形式" to
                                if (content.isBundle) "バイナリ (.yuraive)" else "JSON (.yuraive.json)",
                            metadata?.author?.takeIf(String::isNotBlank)?.let { "作者" to it },
                            metadata?.contentId?.takeIf(String::isNotBlank)?.let {
                                "Content ID" to it
                            },
                            metadata?.createdAt?.takeIf(String::isNotBlank)?.let { "作成日時" to it },
                            metadata?.updatedAt?.takeIf(String::isNotBlank)?.let { "更新日時" to it },
                            metadata
                                ?.tags
                                ?.takeIf { it.isNotEmpty() }
                                ?.joinToString("、")
                                ?.let { "タグ" to it },
                        )
                    LazyColumn(
                        modifier = contentModifier,
                        contentPadding =
                            androidx.compose.foundation.layout.PaddingValues(
                                horizontal = 20.dp,
                                vertical = 16.dp,
                            ),
                    ) {
                        item(key = "metadata-title") {
                            Text(
                                metadata?.displayName?.takeIf(String::isNotBlank)
                                    ?: graph.displayName,
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
                                Text(
                                    label,
                                    Modifier.width(96.dp),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    value,
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            HorizontalDivider(
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f)
                            )
                        }
                        item(key = "asset-heading") {
                            Row(
                                Modifier.fillMaxWidth().padding(top = 26.dp, bottom = 10.dp),
                                verticalAlignment = Alignment.Bottom,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        "参照アセット",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text(
                                        "${content.assets.size - missing} / ${content.assets.size} 件を確認",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                if (missing > 0)
                                    Text(
                                        "${missing}件を認識できません",
                                        color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.labelMedium,
                                    )
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
                                    is InspectionTreeRow.Folder ->
                                        Row(
                                            Modifier.fillMaxWidth()
                                                .height(42.dp)
                                                .clickable {
                                                    collapsedFolders =
                                                        if (row.path in collapsedFolders)
                                                            collapsedFolders - row.path
                                                        else collapsedFolders + row.path
                                                }
                                                .padding(start = (row.depth * 16).dp, end = 8.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(
                                                if (row.path in collapsedFolders)
                                                    Icons.AutoMirrored.Filled.KeyboardArrowRight
                                                else Icons.Default.KeyboardArrowDown,
                                                null,
                                                Modifier.size(20.dp),
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                            Icon(
                                                Icons.Default.Folder,
                                                null,
                                                Modifier.padding(horizontal = 7.dp).size(19.dp),
                                                tint = MaterialTheme.colorScheme.primary,
                                            )
                                            Text(
                                                row.name,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                        }
                                    is InspectionTreeRow.File -> {
                                        val color =
                                            if (row.asset.recognized)
                                                MaterialTheme.colorScheme.onSurface
                                            else MaterialTheme.colorScheme.error
                                        Row(
                                            Modifier.fillMaxWidth()
                                                .defaultMinSize(minHeight = 42.dp)
                                                .background(
                                                    if (row.asset.recognized) Color.Transparent
                                                    else
                                                        MaterialTheme.colorScheme.errorContainer
                                                            .copy(alpha = .35f)
                                                )
                                                .padding(
                                                    start = (row.depth * 16 + 28).dp,
                                                    end = 10.dp,
                                                    top = 6.dp,
                                                    bottom = 6.dp,
                                                ),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(
                                                Icons.AutoMirrored.Filled.InsertDriveFile,
                                                null,
                                                Modifier.size(18.dp),
                                                tint = color,
                                            )
                                            Text(
                                                row.name,
                                                Modifier.weight(1f).padding(horizontal = 9.dp),
                                                color = color,
                                                maxLines = 2,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            val status =
                                                when (row.asset.problem) {
                                                    AssetInspectionProblem.UNSAFE_PATH -> "不正なパス"
                                                    AssetInspectionProblem.MISSING -> "見つかりません"
                                                    null -> if (row.asset.embedded) "内蔵" else null
                                                }
                                            status?.let {
                                                Text(
                                                    it,
                                                    color = color,
                                                    style = MaterialTheme.typography.labelSmall,
                                                )
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
}

@Composable
internal fun GraphCollectionScreen(
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
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
                },
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AdaptiveGrid(Modifier.fillMaxSize()) {
                gridItems(collection.graphs, key = { it.ref.graphId }) { graph ->
                    GraphGridCard(
                        graph,
                        graph.ref.graphId in favoriteIds,
                        openGraph,
                        inspectGraph,
                        toggleFavorite,
                    )
                }
            }
            when {
                collection.loading ->
                    CircularProgressIndicator(
                        Modifier.align(Alignment.TopCenter).padding(top = 64.dp)
                    )
                collection.graphs.isEmpty() ->
                    Text(
                        "作品はまだありません",
                        Modifier.align(Alignment.TopCenter).padding(top = 64.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        }
    }
}

@Composable
internal fun DirectoryBrowserScreen(
    root: LibraryRoot,
    initialPath: String?,
    app: YuraiveApplication,
    favoriteIds: Set<String>,
    onBack: () -> Unit,
    openGraph: (LibraryGraph) -> Unit,
    inspectGraph: (LibraryGraph) -> Unit,
    toggleFavorite: (String) -> Unit,
) {
    var currentPath by
        rememberSaveable(root.grant.uri, initialPath) { mutableStateOf(initialPath.orEmpty()) }
    var directories by
        remember(root.grant.uri) { mutableStateOf<List<LibraryDirectory>>(emptyList()) }
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
                    if (path.isEmpty())
                        root.directory ?: app.library.inspectDirectory(root.grant, path)
                    else app.library.inspectDirectory(root.grant, path)
                }
            }
            .onSuccess { directories = it }
            .onFailure { error = it.message ?: "フォルダを読み込めません" }
        loading = false
    }
    fun goBack() {
        if (currentPath.isNotEmpty()) currentPath = currentPath.substringBeforeLast('/', "")
        else onBack()
    }
    BackHandler { goBack() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        current?.name ?: root.grant.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = ::goBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る")
                    }
                },
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val directory = current
            if (directory != null) {
                AdaptiveGrid(Modifier.fillMaxSize()) {
                    if (directory.isContent) {
                        gridItems(directory.graphs, key = { it.ref.graphId }) { graph ->
                            GraphGridCard(
                                graph,
                                graph.ref.graphId in favoriteIds,
                                openGraph,
                                inspectGraph,
                                toggleFavorite,
                            )
                        }
                    } else {
                        gridItems(directory.folders, key = { it.relativePath }) { folder ->
                            FolderGridCard(folder, root, app) { load(folder.relativePath) }
                        }
                    }
                }
            }
            if (
                !loading &&
                    directory != null &&
                    directory.graphs.isEmpty() &&
                    directory.folders.isEmpty()
            ) {
                Text(
                    "フォルダは空です",
                    Modifier.align(Alignment.TopCenter).padding(top = 64.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (loading)
                CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 64.dp))
            error?.let { message ->
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                ) {
                    Text(
                        message,
                        Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
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
