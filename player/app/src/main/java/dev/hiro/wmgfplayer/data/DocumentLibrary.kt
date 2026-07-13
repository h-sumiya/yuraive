package dev.hiro.wmgfplayer.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.GraphValidator
import dev.hiro.wmgfplayer.model.ValidationIssue
import dev.hiro.wmgfplayer.model.WmgGraph
import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class RootGrant(val uri: String, val name: String)

data class LibraryGraph(
    val ref: GraphRef,
    val displayName: String,
    val author: String? = null,
    val thumbnailPath: String? = null,
    val parseError: String? = null,
)

data class LibraryRoot(
    val grant: RootGrant,
    val graphs: List<LibraryGraph> = emptyList(),
    val error: String? = null,
)

data class LibraryFileEntry(
    val name: String,
    val relativePath: String,
    val isDirectory: Boolean,
)

class DocumentLibrary(private val context: Context) {
    private val preferences = context.getSharedPreferences("library", Context.MODE_PRIVATE)
    private val rootsMutable = MutableStateFlow(readRoots())
    private val rootCache = ConcurrentHashMap<String, DocumentFile>()
    private val childrenCache = ConcurrentHashMap<String, Map<String, DocumentFile>>()
    private val graphCache = ConcurrentHashMap<String, CachedGraph>()
    private val validationCache = ConcurrentHashMap<String, CachedValidation>()
    private val scriptCache = ConcurrentHashMap<String, Map<String, String>>()
    val roots: StateFlow<List<RootGrant>> = rootsMutable

    fun addRoot(uri: Uri, name: String) {
        val updated = (rootsMutable.value.filterNot { it.uri == uri.toString() } + RootGrant(uri.toString(), name)).sortedBy { it.name.lowercase() }
        persist(updated)
    }

    fun removeRoot(uri: String) {
        runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(uri), android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        persist(rootsMutable.value.filterNot { it.uri == uri })
    }

    suspend fun scanAll(): List<LibraryRoot> = withContext(Dispatchers.IO) {
        rootCache.clear()
        childrenCache.clear()
        graphCache.clear()
        validationCache.clear()
        scriptCache.clear()
        rootsMutable.value.map { grant ->
            runCatching {
                val root = DocumentFile.fromTreeUri(context, Uri.parse(grant.uri))
                    ?: error("フォルダを開けません")
                rootCache[grant.uri] = root
                LibraryRoot(grant, scanRoot(grant, root))
            }.getOrElse { LibraryRoot(grant, error = it.message ?: "フォルダを読み込めません") }
        }
    }

    suspend fun readGraph(ref: GraphRef): WmgGraph = withContext(Dispatchers.IO) {
        graphCache[ref.graphId]?.let { return@withContext it.graph }
        val file = resolveFromRoot(ref, ref.relativePath) ?: error("WMGF ファイルが見つかりません")
        val text = readText(file, 8 * 1024 * 1024)
        WmgJson.format.decodeFromString<WmgGraph>(text).also { graphCache[ref.graphId] = CachedGraph(it, text) }
    }

    suspend fun readAssetText(ref: GraphRef, relativeAssetPath: String, maxBytes: Int = 2 * 1024 * 1024): String = withContext(Dispatchers.IO) {
        require(GraphValidator.isSafeRelativePath(relativeAssetPath)) { "安全でないアセットパスです" }
        val file = resolveAsset(ref, relativeAssetPath) ?: error("ファイルが見つかりません: $relativeAssetPath")
        readText(file, maxBytes)
    }

    suspend fun readScriptSources(ref: GraphRef, entryPath: String): Map<String, String> = withContext(Dispatchers.IO) {
        scriptCache[ref.graphId]?.takeIf { entryPath in it }?.let { return@withContext it }
        require(GraphValidator.isSafeRelativePath(entryPath)) { "安全でないスクリプトパスです" }
        val contentRoot = resolveFromRoot(ref, ref.parentPath)
            ?.takeIf(DocumentFile::isDirectory)
            ?: error("コンテンツフォルダが見つかりません")
        val sources = linkedMapOf<String, String>()
        var totalBytes = 0

        fun collect(directory: DocumentFile, relativeDirectory: String, depth: Int) {
            require(depth <= 16) { "スクリプトフォルダの階層が深すぎます" }
            children(directory).forEach { (name, file) ->
                val path = listOf(relativeDirectory, name).filter(String::isNotEmpty).joinToString("/")
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

    suspend fun assetUri(ref: GraphRef, relativeAssetPath: String): Uri? = withContext(Dispatchers.IO) {
        if (!GraphValidator.isSafeRelativePath(relativeAssetPath)) return@withContext null
        resolveAsset(ref, relativeAssetPath)?.uri
    }

    suspend fun validate(ref: GraphRef, graph: WmgGraph): List<ValidationIssue> = withContext(Dispatchers.IO) {
        validationCache[ref.graphId]
            ?.takeIf { it.graph === graph }
            ?.let { return@withContext it.issues }
        val sourceJson = graphCache[ref.graphId]?.takeIf { it.graph === graph }?.sourceJson
            ?: WmgJson.format.encodeToString(WmgGraph.serializer(), graph)
        val issues = GraphValidator.validateJson(sourceJson).toMutableList()
        val required = buildSet {
            graph.nodes.values.forEach { node ->
                node.script?.path?.let(::add)
                node.media.forEach { media ->
                    media.source.audio?.let(::add)
                    media.source.video?.let(::add)
                }
            }
            graph.buttons.values.forEach { it.render?.path?.let(::add) }
        }
        GraphValidator.allAssetPaths(graph)
            .filter(GraphValidator::isSafeRelativePath)
            .forEach { path ->
                if (resolveAsset(ref, path) == null) {
                    issues += ValidationIssue(
                        if (path in required) ValidationIssue.Severity.ERROR else ValidationIssue.Severity.WARNING,
                        "ファイルが見つかりません: $path",
                        path,
                    )
                }
            }
        issues.toList().also { validationCache[ref.graphId] = CachedValidation(graph, it) }
    }

    suspend fun listDirectory(grant: RootGrant, relativePath: String): List<LibraryFileEntry> = withContext(Dispatchers.IO) {
        require(relativePath.isEmpty() || GraphValidator.isSafeRelativePath(relativePath)) { "安全でないフォルダパスです" }
        val directory = resolveFromRoot(grant.uri, relativePath) ?: error("フォルダが見つかりません")
        require(directory.isDirectory) { "フォルダではありません" }
        children(directory).values.mapNotNull { file ->
            val name = file.name ?: return@mapNotNull null
            LibraryFileEntry(
                name = name,
                relativePath = listOf(relativePath, name).filter(String::isNotEmpty).joinToString("/"),
                isDirectory = file.isDirectory,
            )
        }.sortedWith(compareBy<LibraryFileEntry> { !it.isDirectory }.thenBy { it.name.lowercase() })
    }

    private fun scanRoot(grant: RootGrant, directory: DocumentFile): List<LibraryGraph> {
        val graphs = mutableListOf<LibraryGraph>()
        val files = directory.listFiles()
        childrenCache[directory.uri.toString()] = files.mapNotNull { file ->
            file.name?.let { it to file }
        }.toMap()
        files.forEach { file ->
            val fileName = file.name ?: return@forEach
            if (!file.isFile || !fileName.endsWith(".wmg.json", ignoreCase = true)) return@forEach
            val ref = GraphRef(grant.uri, grant.name, fileName)
            graphs += runCatching {
                val sourceJson = readText(file, 8 * 1024 * 1024)
                val graph = WmgJson.format.decodeFromString<WmgGraph>(sourceJson)
                graphCache[ref.graphId] = CachedGraph(graph, sourceJson)
                LibraryGraph(
                    ref = ref,
                    displayName = graph.metadata?.displayName?.takeIf(String::isNotBlank) ?: fileName.removeSuffix(".wmg.json"),
                    author = graph.metadata?.author?.takeIf(String::isNotBlank),
                    thumbnailPath = graph.metadata?.thumbnail,
                )
            }.getOrElse {
                LibraryGraph(ref, fileName.removeSuffix(".wmg.json"), parseError = it.message ?: "JSON を解析できません")
            }
        }
        return graphs.sortedBy { it.displayName.lowercase() }
    }

    private fun resolveAsset(ref: GraphRef, path: String): DocumentFile? {
        val complete = listOf(ref.parentPath, path).filter(String::isNotEmpty).joinToString("/")
        return resolveFromRoot(ref, complete)
    }

    private fun resolveFromRoot(ref: GraphRef, path: String): DocumentFile? {
        return resolveFromRoot(ref.rootUri, path)
    }

    private fun resolveFromRoot(rootUri: String, path: String): DocumentFile? {
        var current = rootCache[rootUri] ?: DocumentFile.fromTreeUri(context, Uri.parse(rootUri))
            ?.also { rootCache[rootUri] = it }
            ?: return null
        for (segment in path.split('/').filter(String::isNotEmpty)) {
            current = children(current)[segment] ?: return null
        }
        return current
    }

    private fun children(directory: DocumentFile): Map<String, DocumentFile> =
        childrenCache.computeIfAbsent(directory.uri.toString()) {
            directory.listFiles().mapNotNull { file -> file.name?.let { it to file } }.toMap()
        }

    private fun readText(file: DocumentFile, maxBytes: Int): String {
        require(file.length() <= maxBytes || file.length() == 0L) { "ファイルが大きすぎます: ${file.name}" }
        return context.contentResolver.openInputStream(file.uri)?.bufferedReader(Charsets.UTF_8)?.use { reader ->
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
        } ?: error("ファイルを開けません: ${file.name}")
    }

    private fun readRoots(): List<RootGrant> = runCatching {
        WmgJson.format.decodeFromString(ListSerializer(RootGrant.serializer()), preferences.getString("roots", "[]") ?: "[]")
    }.getOrDefault(emptyList())

    private fun persist(value: List<RootGrant>) {
        preferences.edit().putString("roots", WmgJson.format.encodeToString(ListSerializer(RootGrant.serializer()), value)).apply()
        rootsMutable.value = value
    }

    private data class CachedGraph(val graph: WmgGraph, val sourceJson: String)
    private data class CachedValidation(val graph: WmgGraph, val issues: List<ValidationIssue>)
}
