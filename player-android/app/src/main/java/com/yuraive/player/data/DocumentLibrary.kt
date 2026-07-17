package com.yuraive.player.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.yuraive.player.model.BundledTextAsset
import com.yuraive.player.model.GraphMetadataExtractor
import com.yuraive.player.model.GraphRef
import com.yuraive.player.model.GraphValidator
import com.yuraive.player.model.MetadataPrefixRead
import com.yuraive.player.model.NativeBundleDecoder
import com.yuraive.player.model.ValidationIssue
import com.yuraive.player.model.YuraiveGraph
import com.yuraive.player.model.YuraiveJson
import com.yuraive.player.model.YuraiveLayout
import java.io.IOException
import java.io.InputStream
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

@Serializable data class RootGrant(val uri: String, val name: String)

data class LibraryGraph(
    val ref: GraphRef,
    val displayName: String,
    val author: String? = null,
    val thumbnailPath: String? = null,
    val parseError: String? = null,
    val modifiedAt: Long = 0,
)

enum class AssetInspectionProblem {
    UNSAFE_PATH,
    MISSING,
}

data class LibraryAssetInspection(
    val path: String,
    val recognized: Boolean,
    val embedded: Boolean = false,
    val problem: AssetInspectionProblem? = null,
)

data class LibraryContentInspection(
    val graph: YuraiveGraph,
    val isBundle: Boolean,
    val assets: List<LibraryAssetInspection>,
)

internal fun inspectGraphAssets(
    graph: YuraiveGraph,
    isBundle: Boolean,
    embeddedPaths: Set<String>,
    exists: (String) -> Boolean,
): List<LibraryAssetInspection> {
    val bundledTextPaths = buildSet {
        graph.playbackStats?.path?.let(::add)
        graph.nodes.values.forEach { it.script?.path?.let(::add) }
        graph.buttons.values.forEach { it.render?.path?.let(::add) }
        graph.playerControls.values.forEach { it.layout?.let(::add) }
    }
    return GraphValidator.allAssetPaths(graph).filter(String::isNotEmpty).sorted().map { path ->
        val safe = GraphValidator.isSafeRelativePath(path)
        val embedded = safe && path in embeddedPaths
        val requiresEmbedding = isBundle && path in bundledTextPaths
        val recognized = safe && (embedded || (!requiresEmbedding && exists(path)))
        LibraryAssetInspection(
            path = path,
            recognized = recognized,
            embedded = embedded,
            problem =
                when {
                    !safe -> AssetInspectionProblem.UNSAFE_PATH
                    !recognized -> AssetInspectionProblem.MISSING
                    else -> null
                },
        )
    }
}

data class LibraryRoot(
    val grant: RootGrant,
    val directory: LibraryDirectory? = null,
    val error: String? = null,
)

data class LibraryFolder(val name: String, val relativePath: String)

data class LibraryDirectory(
    val grant: RootGrant,
    val name: String,
    val relativePath: String,
    val folders: List<LibraryFolder> = emptyList(),
    val graphs: List<LibraryGraph> = emptyList(),
    val error: String? = null,
)

val LibraryDirectory.isContent: Boolean
    get() = graphs.isNotEmpty()

val LibraryRoot.previewGraph: LibraryGraph?
    get() = directory?.graphs?.firstOrNull()

val LibraryRoot.hasContent: Boolean
    get() = directory?.isContent == true

private const val METADATA_PREFIX_LIMIT = 512 * 1024
private const val METADATA_READ_CHUNK = 16 * 1024

private data class PreviewMetadata(
    val displayName: String? = null,
    val author: String? = null,
    val thumbnail: String? = null,
)

private data class StoredFile(
    val rootUri: String,
    val relativePath: String,
    val name: String,
    val isDirectory: Boolean,
    val isFile: Boolean,
    val length: Long = 0,
    val lastModified: Long = 0,
    val localFile: DocumentFile? = null,
)

class DocumentLibrary(private val context: Context) {
    private val preferences = context.getSharedPreferences("library", Context.MODE_PRIVATE)
    private val rootsMutable = MutableStateFlow(readRoots())
    private val remoteSources = RemoteSourceManager(context)
    private val rootCache = ConcurrentHashMap<String, StoredFile>()
    private val childrenCache = ConcurrentHashMap<String, Map<String, StoredFile>>()
    private val directoryCache = ConcurrentHashMap<String, LibraryDirectory>()
    private val graphCache = ConcurrentHashMap<String, CachedGraph>()
    private val validationCache = ConcurrentHashMap<String, CachedValidation>()
    private val scriptCache = ConcurrentHashMap<String, Map<String, String>>()
    private val knownGraphsMutable = MutableStateFlow<List<LibraryGraph>>(emptyList())
    private val favoriteIdsMutable =
        MutableStateFlow(preferences.getStringSet("favorites", emptySet()).orEmpty().toSet())
    val roots: StateFlow<List<RootGrant>> = rootsMutable
    val knownGraphs: StateFlow<List<LibraryGraph>> = knownGraphsMutable
    val favoriteIds: StateFlow<Set<String>> = favoriteIdsMutable
    val windowsConnectionStates: StateFlow<Map<String, WindowsConnectionStatus>> =
        remoteSources.windowsConnectionStates

    fun addRoot(uri: Uri, name: String) {
        val updated =
            (rootsMutable.value.filterNot { it.uri == uri.toString() } +
                    RootGrant(uri.toString(), name))
                .sortedBy { it.name.lowercase() }
        persist(updated)
    }

    suspend fun browseRemoteFolders(
        config: RemoteConnectionConfig,
        relativePath: String,
    ): List<RemoteFolder> = remoteSources.browse(config, relativePath)

    fun addRemoteRoot(config: RemoteConnectionConfig, relativePath: String, fallbackName: String) {
        val grant = remoteSources.save(config, relativePath, fallbackName)
        val updated =
            (rootsMutable.value.filterNot { it.uri == grant.uri } + grant).sortedBy {
                it.name.lowercase()
            }
        persist(updated)
    }

    suspend fun addWindowsLibrary(qrPayload: String): List<RootGrant> =
        withContext(Dispatchers.IO) {
            val grants = remoteSources.pairWindows(qrPayload)
            val uris = grants.mapTo(mutableSetOf()) { it.uri }
            val updated =
                (rootsMutable.value.filterNot { it.uri in uris } + grants).sortedBy {
                    it.name.lowercase()
                }
            persist(updated)
            grants
        }

    fun removeRoot(uri: String) {
        if (remoteSources.isRemoteRoot(uri)) {
            remoteSources.remove(uri)
        } else {
            runCatching {
                context.contentResolver.releasePersistableUriPermission(
                    Uri.parse(uri),
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
        }
        knownGraphsMutable.value = knownGraphsMutable.value.filterNot { it.ref.rootUri == uri }
        persist(rootsMutable.value.filterNot { it.uri == uri })
    }

    fun windowsDevices(): List<WindowsDeviceConnection> =
        remoteSources.windowsDevices(rootsMutable.value.map(RootGrant::uri))

    fun refreshWindowsDevice(deviceId: String) = remoteSources.refreshWindowsDevice(deviceId)

    fun refreshWindowsDevices() = remoteSources.refreshWindowsDevices()

    fun removeWindowsDevice(deviceId: String) {
        val rootUris =
            windowsDevices().firstOrNull { it.id == deviceId }?.rootUris.orEmpty().toSet()
        if (rootUris.isEmpty()) return
        rootUris.forEach(remoteSources::remove)
        remoteSources.removeWindowsDevice(deviceId)
        knownGraphsMutable.value = knownGraphsMutable.value.filterNot { it.ref.rootUri in rootUris }
        persist(rootsMutable.value.filterNot { it.uri in rootUris })
    }

    fun toggleFavorite(graphId: String) {
        val updated = favoriteIdsMutable.value.toMutableSet()
        val added = updated.add(graphId)
        if (!added) updated.remove(graphId)
        preferences
            .edit()
            .putStringSet("favorites", updated)
            .apply {
                if (added) putLong(favoriteTimestampKey(graphId), System.currentTimeMillis())
                else remove(favoriteTimestampKey(graphId))
            }
            .apply()
        favoriteIdsMutable.value = updated
    }

    fun favoriteIdsByRecent(): List<String> =
        favoriteIdsMutable.value.sortedByDescending {
            preferences.getLong(favoriteTimestampKey(it), 0)
        }

    suspend fun scanAll(): List<LibraryRoot> =
        withContext(Dispatchers.IO) {
            rootCache.clear()
            childrenCache.clear()
            directoryCache.clear()
            graphCache.clear()
            validationCache.clear()
            scriptCache.clear()
            val scanned = coroutineScope {
                rootsMutable.value
                    .map { grant ->
                        async {
                            runCatching {
                                    val root = rootFile(grant)
                                    rootCache[grant.uri] = root
                                    LibraryRoot(grant, scanDirectory(grant, root, ""))
                                }
                                .getOrElse {
                                    LibraryRoot(grant, error = it.message ?: "フォルダを読み込めません")
                                }
                        }
                    }
                    .awaitAll()
            }
            knownGraphsMutable.value = scanned.flatMap { it.directory?.graphs.orEmpty() }
            scanned
        }

    suspend fun inspectDirectory(grant: RootGrant, relativePath: String): LibraryDirectory =
        withContext(Dispatchers.IO) {
            require(relativePath.isEmpty() || GraphValidator.isSafeRelativePath(relativePath)) {
                "安全でないフォルダパスです"
            }
            val key = directoryKey(grant.uri, relativePath)
            directoryCache[key]?.let {
                return@withContext it
            }
            val directory = resolveFromRoot(grant.uri, relativePath) ?: error("フォルダが見つかりません")
            require(directory.isDirectory) { "フォルダではありません" }
            scanDirectory(grant, directory, relativePath).also { scanned ->
                directoryCache[key] = scanned
                mergeKnownGraphs(scanned.graphs)
            }
        }

    suspend fun resolveGraphs(graphIds: List<String>): List<LibraryGraph> =
        withContext(Dispatchers.IO) {
            val known = knownGraphsMutable.value.associateBy { it.ref.graphId }.toMutableMap()
            graphIds.distinct().mapNotNull { graphId ->
                known[graphId]
                    ?: run {
                        val grant =
                            rootsMutable.value.firstOrNull { graphId.startsWith("${it.uri}::") }
                                ?: return@mapNotNull null
                        val relativePath = graphId.removePrefix("${grant.uri}::")
                        if (!GraphValidator.isSafeRelativePath(relativePath)) return@mapNotNull null
                        val parentPath = relativePath.substringBeforeLast('/', "")
                        runCatching { inspectDirectory(grant, parentPath) }
                            .getOrNull()
                            ?.graphs
                            ?.firstOrNull { it.ref.graphId == graphId }
                            ?.also { known[graphId] = it }
                    }
            }
        }

    suspend fun readGraph(ref: GraphRef): YuraiveGraph =
        withContext(Dispatchers.IO) {
            graphCache[ref.graphId]?.let {
                return@withContext it.graph
            }
            val file =
                bundleRelativePath(ref.relativePath)?.let { resolveFromRoot(ref, it) }
                    ?: resolveFromRoot(ref, ref.relativePath)
                    ?: error("Yuraive ファイルが見つかりません")
            val isBundle = isBundlePath(file.name)
            val decoded =
                if (isBundle) NativeBundleDecoder.decode(readBytes(file, 16 * 1024 * 1024))
                else null
            val text = decoded?.graphJson ?: readText(file, 8 * 1024 * 1024)
            YuraiveJson.format.decodeFromString<YuraiveGraph>(text).also {
                graphCache[ref.graphId] =
                    CachedGraph(it, text, decoded?.textAssets.orEmpty(), isBundle)
            }
        }

    suspend fun inspectContent(ref: GraphRef): LibraryContentInspection =
        withContext(Dispatchers.IO) {
            val graph = readGraph(ref)
            val cached = graphCache[ref.graphId] ?: error("Yuraive ファイルを読み込めません")
            val assets =
                inspectGraphAssets(graph, cached.isBundle, cached.textAssets.keys) { path ->
                    resolveAsset(ref, path) != null
                }
            LibraryContentInspection(graph, cached.isBundle, assets)
        }

    suspend fun readAssetText(
        ref: GraphRef,
        relativeAssetPath: String,
        maxBytes: Int = 2 * 1024 * 1024,
    ): String =
        withContext(Dispatchers.IO) {
            require(GraphValidator.isSafeRelativePath(relativeAssetPath)) { "安全でないアセットパスです" }
            if (!graphCache.containsKey(ref.graphId)) readGraph(ref)
            graphCache[ref.graphId]
                ?.takeIf(CachedGraph::isBundle)
                ?.textAssets
                ?.get(relativeAssetPath)
                ?.let { embedded ->
                    require(embedded.content.toByteArray(Charsets.UTF_8).size <= maxBytes) {
                        "ファイルが大きすぎます: $relativeAssetPath"
                    }
                    return@withContext embedded.content
                }
            val file =
                resolveAsset(ref, relativeAssetPath) ?: error("ファイルが見つかりません: $relativeAssetPath")
            readText(file, maxBytes)
        }

    suspend fun readScriptSources(ref: GraphRef, entryPath: String): Map<String, String> =
        withContext(Dispatchers.IO) {
            scriptCache[ref.graphId]
                ?.takeIf { entryPath in it }
                ?.let {
                    return@withContext it
                }
            require(GraphValidator.isSafeRelativePath(entryPath)) { "安全でないスクリプトパスです" }
            if (!graphCache.containsKey(ref.graphId)) readGraph(ref)
            if (graphCache[ref.graphId]?.isBundle == true) {
                val sources =
                    graphCache[ref.graphId]
                        ?.textAssets
                        ?.filterValues { it.kind == "starlark" }
                        ?.mapValues { it.value.content }
                        .orEmpty()
                require(entryPath in sources) { "バンドル内にスクリプトが見つかりません: $entryPath" }
                return@withContext sources.also { scriptCache[ref.graphId] = it }
            }
            val contentRoot =
                resolveFromRoot(ref, ref.parentPath)?.takeIf(StoredFile::isDirectory)
                    ?: error("コンテンツフォルダが見つかりません")
            val sources = linkedMapOf<String, String>()
            var totalBytes = 0

            fun collect(directory: StoredFile, relativeDirectory: String, depth: Int) {
                require(depth <= 16) { "スクリプトフォルダの階層が深すぎます" }
                children(directory).forEach { (name, file) ->
                    val path =
                        listOf(relativeDirectory, name).filter(String::isNotEmpty).joinToString("/")
                    if (file.isDirectory) {
                        collect(file, path, depth + 1)
                    } else if (file.isFile && name.endsWith(".star", ignoreCase = true)) {
                        require(sources.size < 256) { "スクリプトファイルが多すぎます" }
                        val source = readText(file, 2 * 1024 * 1024)
                        totalBytes += source.toByteArray(Charsets.UTF_8).size
                        require(totalBytes <= 8 * 1024 * 1024) { "スクリプト全体が大きすぎます" }
                        sources[path] = source
                    }
                }
            }

            collect(contentRoot, "", 0)
            if (entryPath !in sources) sources[entryPath] = readAssetText(ref, entryPath)
            sources.toMap().also { scriptCache[ref.graphId] = it }
        }

    suspend fun assetUri(ref: GraphRef, relativeAssetPath: String): Uri? =
        withContext(Dispatchers.IO) {
            if (!GraphValidator.isSafeRelativePath(relativeAssetPath)) return@withContext null
            val file = resolveAsset(ref, relativeAssetPath) ?: return@withContext null
            file.localFile?.uri
                ?: remoteSources.materialize(
                    file.rootUri,
                    file.relativePath,
                    file.lastModified,
                    file.length,
                )
        }

    suspend fun mediaUri(ref: GraphRef, relativeAssetPath: String): Uri? =
        withContext(Dispatchers.IO) {
            if (!GraphValidator.isSafeRelativePath(relativeAssetPath)) return@withContext null
            val file = resolveAsset(ref, relativeAssetPath) ?: return@withContext null
            file.localFile?.uri ?: remoteSources.mediaUri(file.rootUri, file.relativePath)
        }

    internal fun openRemoteMedia(uri: Uri, offset: Long): RemoteRead =
        remoteSources.openMedia(uri, offset)

    internal fun isRemoteMediaUri(uri: Uri): Boolean =
        uri.scheme == RemoteSourceManager.REMOTE_MEDIA_SCHEME

    suspend fun validate(ref: GraphRef, graph: YuraiveGraph): List<ValidationIssue> =
        withContext(Dispatchers.IO) {
            validationCache[ref.graphId]
                ?.takeIf { it.graph === graph }
                ?.let {
                    return@withContext it.issues
                }
            val sourceJson =
                graphCache[ref.graphId]?.takeIf { it.graph === graph }?.sourceJson
                    ?: YuraiveJson.format.encodeToString(YuraiveGraph.serializer(), graph)
            val issues = GraphValidator.validateJson(sourceJson).toMutableList()
            val required = buildSet {
                graph.playbackStats?.path?.let(::add)
                graph.nodes.values.forEach { node ->
                    node.script?.path?.let(::add)
                    node.media.forEach { media ->
                        media.source.audio?.let(::add)
                        media.source.video?.let(::add)
                    }
                }
                graph.buttons.values.forEach { it.render?.path?.let(::add) }
                graph.playerControls.values.forEach { it.layout?.let(::add) }
            }
            GraphValidator.allAssetPaths(graph)
                .filter(GraphValidator::isSafeRelativePath)
                .forEach { path ->
                    if (!assetExists(ref, path)) {
                        issues +=
                            ValidationIssue(
                                if (path in required) ValidationIssue.Severity.ERROR
                                else ValidationIssue.Severity.WARNING,
                                "ファイルが見つかりません: $path",
                                path,
                            )
                    }
                }
            val layoutSources = mutableMapOf<String, String>()
            graph.playerControls.values
                .mapNotNull { it.layout }
                .distinct()
                .filter(GraphValidator::isSafeRelativePath)
                .forEach { path ->
                    if (!YuraiveLayout.hasExpectedExtension(path)) {
                        issues +=
                            ValidationIssue(
                                ValidationIssue.Severity.ERROR,
                                "レイアウトの拡張子は ${YuraiveLayout.FILE_EXTENSION} である必要があります: $path",
                                path,
                            )
                        return@forEach
                    }
                    if (assetExists(ref, path)) {
                        val source =
                            runCatching { readAssetText(ref, path, 512 * 1024) }
                                .getOrElse { error ->
                                    issues +=
                                        ValidationIssue(
                                            ValidationIssue.Severity.ERROR,
                                            "レイアウトを読み込めません: ${error.message}",
                                            path,
                                        )
                                    return@forEach
                                }
                        layoutSources[path] = source
                        YuraiveLayout.validate(source).forEach { issue ->
                            issues +=
                                ValidationIssue(issue.severity, "$path: ${issue.message}", path)
                        }
                    }
                }
            graph.nodes.forEach { (nodeId, node) ->
                if (node.buttons.isEmpty()) return@forEach
                val controlId = node.playerControl ?: graph.globalPlayerControl
                val layoutPath = controlId?.let(graph.playerControls::get)?.layout ?: return@forEach
                val slots =
                    layoutSources[layoutPath]?.let(YuraiveLayout::slotIdentifiers)?.toSet()
                        ?: return@forEach
                node.buttons.forEach { buttonId ->
                    val target = graph.buttons[buttonId]?.targetSlot?.trim().orEmpty()
                    if (target !in slots) {
                        issues +=
                            ValidationIssue(
                                ValidationIssue.Severity.ERROR,
                                "$nodeId/$buttonId: レイアウトにslot「${target.ifEmpty { "(default)" }}」がありません",
                                layoutPath,
                            )
                    }
                }
            }
            issues.toList().also { validationCache[ref.graphId] = CachedValidation(graph, it) }
        }

    private fun scanDirectory(
        grant: RootGrant,
        directory: StoredFile,
        relativePath: String,
    ): LibraryDirectory {
        val files = children(directory).values.toList()
        val bundleFiles = files.filter { file -> file.isFile && isBundlePath(file.name) }
        val bundleNames = bundleFiles.map { graphBaseName(it.name).lowercase(Locale.ROOT) }.toSet()
        val graphFiles =
            bundleFiles +
                files.filter { file ->
                    file.isFile &&
                        file.name.endsWith(".yuraive.json", ignoreCase = true) &&
                        graphBaseName(file.name).lowercase(Locale.ROOT) !in bundleNames
                }
        val name = relativePath.substringAfterLast('/').ifBlank { grant.name }
        if (graphFiles.isNotEmpty()) {
            return LibraryDirectory(
                    grant = grant,
                    name = name,
                    relativePath = relativePath,
                    graphs = graphFiles.map { scanGraphPreview(grant, relativePath, it) },
                )
                .also { directoryCache[directoryKey(grant.uri, relativePath)] = it }
        }

        return LibraryDirectory(
                grant = grant,
                name = name,
                relativePath = relativePath,
                folders =
                    files
                        .mapNotNull { file ->
                            if (!file.isDirectory) return@mapNotNull null
                            LibraryFolder(
                                name = file.name,
                                relativePath =
                                    listOf(relativePath, file.name)
                                        .filter(String::isNotEmpty)
                                        .joinToString("/"),
                            )
                        }
                        .sortedBy { it.name.lowercase() },
            )
            .also { directoryCache[directoryKey(grant.uri, relativePath)] = it }
    }

    private fun scanGraphPreview(
        grant: RootGrant,
        parentPath: String,
        file: StoredFile,
    ): LibraryGraph {
        val fileName = file.name.ifBlank { "content.yuraive.json" }
        val relativePath = listOf(parentPath, fileName).filter(String::isNotEmpty).joinToString("/")
        val ref = GraphRef(grant.uri, grant.name, relativePath)
        return runCatching {
                val metadata =
                    if (isBundlePath(fileName)) readBundleMetadata(file)
                    else readMetadataPrefix(file)
                LibraryGraph(
                    ref = ref,
                    displayName =
                        metadata.displayName?.takeIf(String::isNotBlank) ?: graphBaseName(fileName),
                    author = metadata.author?.takeIf(String::isNotBlank),
                    thumbnailPath = metadata.thumbnail?.takeIf(String::isNotBlank),
                    modifiedAt = file.lastModified,
                )
            }
            .getOrElse {
                LibraryGraph(
                    ref = ref,
                    displayName = graphBaseName(fileName),
                    parseError = it.message ?: "JSON メタデータを解析できません",
                    modifiedAt = file.lastModified,
                )
            }
    }

    private fun readBundleMetadata(file: StoredFile): PreviewMetadata {
        val decoded = NativeBundleDecoder.decode(readBytes(file, 16 * 1024 * 1024))
        val metadata = YuraiveJson.format.decodeFromString<YuraiveGraph>(decoded.graphJson).metadata
        return PreviewMetadata(metadata?.displayName, metadata?.author, metadata?.thumbnail)
    }

    private fun readMetadataPrefix(file: StoredFile): PreviewMetadata {
        return openInput(file).bufferedReader(Charsets.UTF_8).use { reader ->
            val prefix = StringBuilder()
            val buffer = CharArray(METADATA_READ_CHUNK)
            while (prefix.length < METADATA_PREFIX_LIMIT) {
                val count =
                    reader.read(
                        buffer,
                        0,
                        minOf(buffer.size, METADATA_PREFIX_LIMIT - prefix.length),
                    )
                if (count < 0) {
                    return@use when (val result = GraphMetadataExtractor.read(prefix.toString())) {
                        is MetadataPrefixRead.Found -> result.metadata.toPreviewMetadata()
                        MetadataPrefixRead.Missing -> PreviewMetadata()
                        MetadataPrefixRead.NeedMore -> error("JSON が途中で終了しています")
                        is MetadataPrefixRead.Invalid -> error(result.message)
                    }
                }
                prefix.append(buffer, 0, count)
                when (val result = GraphMetadataExtractor.read(prefix.toString())) {
                    is MetadataPrefixRead.Found -> return@use result.metadata.toPreviewMetadata()
                    MetadataPrefixRead.Missing -> return@use PreviewMetadata()
                    MetadataPrefixRead.NeedMore -> Unit
                    is MetadataPrefixRead.Invalid -> error(result.message)
                }
            }
            error("メタデータがJSONの先頭 ${METADATA_PREFIX_LIMIT / 1024} KiB以内にありません")
        }
    }

    private fun com.yuraive.player.model.GraphMetadataPreview?.toPreviewMetadata() =
        PreviewMetadata(
            displayName = this?.displayName,
            author = this?.author,
            thumbnail = this?.thumbnail,
        )

    private fun mergeKnownGraphs(graphs: List<LibraryGraph>) {
        if (graphs.isEmpty()) return
        knownGraphsMutable.value =
            (knownGraphsMutable.value + graphs).associateBy { it.ref.graphId }.values.toList()
    }

    private fun directoryKey(rootUri: String, relativePath: String) = "$rootUri::$relativePath"

    private fun favoriteTimestampKey(graphId: String) = "favoriteAt:$graphId"

    private fun resolveAsset(ref: GraphRef, path: String): StoredFile? {
        val complete = listOf(ref.parentPath, path).filter(String::isNotEmpty).joinToString("/")
        return resolveFromRoot(ref, complete)
    }

    private fun resolveFromRoot(ref: GraphRef, path: String): StoredFile? {
        return resolveFromRoot(ref.rootUri, path)
    }

    private fun resolveFromRoot(rootUri: String, path: String): StoredFile? {
        var current =
            rootCache[rootUri]
                ?: rootsMutable.value
                    .firstOrNull { it.uri == rootUri }
                    ?.let(::rootFile)
                    ?.also { rootCache[rootUri] = it }
                ?: return null
        for (segment in path.split('/').filter(String::isNotEmpty)) {
            current = children(current)[segment] ?: return null
        }
        return current
    }

    private fun children(directory: StoredFile): Map<String, StoredFile> =
        childrenCache.computeIfAbsent(directoryKey(directory.rootUri, directory.relativePath)) {
            if (remoteSources.isRemoteRoot(directory.rootUri)) {
                remoteSources.list(directory.rootUri, directory.relativePath).associate { node ->
                    val path =
                        listOf(directory.relativePath, node.name)
                            .filter(String::isNotEmpty)
                            .joinToString("/")
                    node.name to
                        StoredFile(
                            rootUri = directory.rootUri,
                            relativePath = path,
                            name = node.name,
                            isDirectory = node.isDirectory,
                            isFile = !node.isDirectory,
                            length = node.size,
                            lastModified = node.modifiedAt,
                        )
                }
            } else {
                directory.localFile
                    ?.listFiles()
                    .orEmpty()
                    .mapNotNull { file ->
                        val name = file.name ?: return@mapNotNull null
                        val path =
                            listOf(directory.relativePath, name)
                                .filter(String::isNotEmpty)
                                .joinToString("/")
                        name to
                            StoredFile(
                                rootUri = directory.rootUri,
                                relativePath = path,
                                name = name,
                                isDirectory = file.isDirectory,
                                isFile = file.isFile,
                                length = file.length(),
                                lastModified = file.lastModified(),
                                localFile = file,
                            )
                    }
                    .toMap()
            }
        }

    private fun readText(file: StoredFile, maxBytes: Int): String {
        require(file.length <= maxBytes || file.length == 0L) { "ファイルが大きすぎます: ${file.name}" }
        return openInput(file).bufferedReader(Charsets.UTF_8).use { reader ->
            val result = StringBuilder()
            val buffer = CharArray(8_192)
            var total = 0
            while (true) {
                val count = reader.read(buffer)
                if (count < 0) break
                total += count
                require(total <= maxBytes) { "ファイルが大きすぎます: ${file.name}" }
                result.append(buffer, 0, count)
            }
            result.toString()
        }
    }

    private fun readBytes(file: StoredFile, maxBytes: Int): ByteArray {
        require(file.length <= maxBytes || file.length == 0L) { "ファイルが大きすぎます: ${file.name}" }
        return openInput(file).use { input ->
            val result = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8_192)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                require(total <= maxBytes) { "ファイルが大きすぎます: ${file.name}" }
                result.write(buffer, 0, count)
            }
            result.toByteArray()
        }
    }

    private fun rootFile(grant: RootGrant): StoredFile {
        if (remoteSources.isRemoteRoot(grant.uri)) {
            return StoredFile(grant.uri, "", grant.name, isDirectory = true, isFile = false)
        }
        val document =
            DocumentFile.fromTreeUri(context, Uri.parse(grant.uri)) ?: error("フォルダを開けません")
        return StoredFile(
            rootUri = grant.uri,
            relativePath = "",
            name = document.name ?: grant.name,
            isDirectory = document.isDirectory,
            isFile = document.isFile,
            length = document.length(),
            lastModified = document.lastModified(),
            localFile = document,
        )
    }

    private fun openInput(file: StoredFile): InputStream {
        val local = file.localFile
        if (local != null) {
            return context.contentResolver.openInputStream(local.uri)
                ?: throw IOException("ファイルを開けません: ${file.name}")
        }
        return remoteSources.open(file.rootUri, file.relativePath).input
    }

    private fun assetExists(ref: GraphRef, path: String): Boolean =
        graphCache[ref.graphId]?.textAssets?.containsKey(path) == true ||
            resolveAsset(ref, path) != null

    private fun isBundlePath(path: String): Boolean =
        path.endsWith(".yuraive", ignoreCase = true) &&
            !path.endsWith(".yuraive.json", ignoreCase = true)

    private fun bundleRelativePath(path: String): String? =
        when {
            path.endsWith(".yuraive.json", ignoreCase = true) ->
                path.dropLast(".yuraive.json".length) + ".yuraive"
            isBundlePath(path) -> path
            else -> null
        }

    private fun graphBaseName(path: String): String =
        when {
            path.endsWith(".yuraive.json", ignoreCase = true) ->
                path.dropLast(".yuraive.json".length)
            path.endsWith(".yuraive", ignoreCase = true) -> path.dropLast(".yuraive".length)
            else -> path
        }

    private fun readRoots(): List<RootGrant> =
        runCatching {
                YuraiveJson.format.decodeFromString(
                    ListSerializer(RootGrant.serializer()),
                    preferences.getString("roots", "[]") ?: "[]",
                )
            }
            .getOrDefault(emptyList())

    private fun persist(value: List<RootGrant>) {
        preferences
            .edit()
            .putString(
                "roots",
                YuraiveJson.format.encodeToString(ListSerializer(RootGrant.serializer()), value),
            )
            .apply()
        rootsMutable.value = value
    }

    private data class CachedGraph(
        val graph: YuraiveGraph,
        val sourceJson: String,
        val textAssets: Map<String, BundledTextAsset>,
        val isBundle: Boolean,
    )

    private data class CachedValidation(val graph: YuraiveGraph, val issues: List<ValidationIssue>)
}
