package com.yuraive.player.data

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.FileProvider
import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.msfscc.FileAttributes
import com.hierynomus.msfscc.fileinformation.FileStandardInformation
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2CreateOptions
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.protocol.commons.EnumWithValue
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.SmbConfig
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.connection.Connection
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.DiskShare
import com.hierynomus.smbj.share.File as SmbFile
import com.yuraive.player.model.GraphValidator
import com.yuraive.player.model.YuraiveJson
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.StringReader
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.EnumSet
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.w3c.dom.Element
import org.xml.sax.InputSource

enum class RemoteProtocol {
    SMB,
    WEBDAV,
}

@Serializable
data class RemoteConnectionConfig(
    val id: String = "",
    val protocol: RemoteProtocol,
    val displayName: String = "",
    val host: String = "",
    val port: Int = 445,
    val share: String = "",
    val domain: String = "",
    val endpoint: String = "",
    val username: String = "",
    val password: String = "",
    val rootPath: String = "",
) {
    override fun toString(): String =
        "RemoteConnectionConfig(id=$id, protocol=$protocol, displayName=$displayName, host=$host, " +
            "port=$port, share=$share, domain=$domain, endpoint=$endpoint, username=$username, " +
            "password=${if (password.isEmpty()) "" else "<redacted>"}, rootPath=$rootPath)"
}

data class RemoteFolder(val name: String, val relativePath: String)

internal data class RemoteNode(
    val name: String,
    val isDirectory: Boolean,
    val size: Long = 0,
    val modifiedAt: Long = 0,
)

internal class RemoteRead(val input: InputStream, val totalLength: Long) : Closeable {
    override fun close() = input.close()
}

internal object RemotePaths {
    private val hostPattern = Regex("^[A-Za-z0-9._:-]+$")

    fun validate(config: RemoteConnectionConfig): String? =
        when (config.protocol) {
            RemoteProtocol.SMB ->
                when {
                    config.host.isBlank() -> "サーバーを入力してください"
                    !hostPattern.matches(config.host.trim()) -> "サーバー名が正しくありません"
                    config.port !in 1..65_535 -> "ポート番号は1〜65535で入力してください"
                    config.share.isBlank() -> "共有名を入力してください"
                    config.share.contains('/') || config.share.contains('\\') ->
                        "共有名に / や \\ は使用できません"
                    config.share.trim() == "." || config.share.trim() == ".." -> "共有名が正しくありません"
                    else -> null
                }
            RemoteProtocol.WEBDAV ->
                runCatching {
                        val uri = URI(config.endpoint.trim())
                        when {
                            uri.scheme?.lowercase() != "https" -> "WebDAV URL は https:// で入力してください"
                            uri.host.isNullOrBlank() -> "WebDAV URL のホストがありません"
                            uri.userInfo != null -> "ユーザー名とパスワードはURLではなく個別に入力してください"
                            uri.query != null || uri.fragment != null ->
                                "WebDAV URL にクエリやフラグメントは使用できません"
                            else -> null
                        }
                    }
                    .getOrElse { "WebDAV URL が正しくありません" }
        }

    fun normalizeRelative(path: String): String {
        val value = path.trim('/')
        if (value.isEmpty()) return ""
        require(!value.contains('\\') && !value.contains('\u0000')) { "安全でないフォルダパスです" }
        require(value.split('/').none { it == "." || it.any(Char::isISOControl) }) {
            "安全でないフォルダパスです"
        }
        require(GraphValidator.isSafeRelativePath(value)) { "安全でないフォルダパスです" }
        return value
    }

    fun join(left: String, right: String): String =
        listOf(left.trim('/'), right.trim('/')).filter(String::isNotEmpty).joinToString("/")

    fun normalizedEndpoint(value: String): String = value.trim().trimEnd('/') + "/"

    fun isSafeSegment(value: String): Boolean =
        value.isNotBlank() &&
            value != "." &&
            value != ".." &&
            value.none {
                it == '/' || it == '\\' || it == ':' || it == '\u0000' || it.isISOControl()
            }
}

internal class RemoteSourceManager(private val context: Context) {
    private val store = EncryptedRemoteConfigStore(context)
    private val windows = WindowsPeerSourceManager(context)
    private val configs = ConcurrentHashMap<String, RemoteConnectionConfig>()
    private val httpClient =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            // Authentication must never follow a redirect to another host.
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

    fun isRemoteRoot(rootUri: String): Boolean =
        rootUri.startsWith(SMB_ROOT_PREFIX) ||
            rootUri.startsWith(WEBDAV_ROOT_PREFIX) ||
            windows.isRoot(rootUri)

    suspend fun pairWindows(qrPayload: String): List<RootGrant> = windows.pair(qrPayload)

    val windowsConnectionStates: StateFlow<Map<String, WindowsConnectionStatus>>
        get() = windows.connectionStates

    fun windowsDevices(rootUris: List<String>): List<WindowsDeviceConnection> =
        windows.devices(rootUris)

    fun removeWindowsDevice(deviceId: String) = windows.removeDevice(deviceId)

    fun refreshWindowsDevice(deviceId: String) = windows.refreshDevice(deviceId)

    fun refreshWindowsDevices() = windows.refreshAll()

    suspend fun browse(config: RemoteConnectionConfig, relativePath: String): List<RemoteFolder> =
        withContext(Dispatchers.IO) {
            RemotePaths.validate(config)?.let(::error)
            val normalized = RemotePaths.normalizeRelative(relativePath)
            backend(config.copy(rootPath = ""))
                .list(normalized)
                .asSequence()
                .filter(RemoteNode::isDirectory)
                .map { RemoteFolder(it.name, RemotePaths.join(normalized, it.name)) }
                .sortedBy { it.name.lowercase() }
                .toList()
        }

    fun save(
        config: RemoteConnectionConfig,
        selectedPath: String,
        fallbackName: String,
    ): RootGrant {
        RemotePaths.validate(config)?.let(::error)
        val id = config.id.takeIf(String::isNotBlank) ?: UUID.randomUUID().toString()
        val rootPath = RemotePaths.normalizeRelative(selectedPath)
        val name =
            config.displayName.trim().ifBlank {
                fallbackName.ifBlank { defaultName(config, rootPath) }
            }
        val saved =
            config.copy(
                id = id,
                displayName = name,
                endpoint =
                    if (config.protocol == RemoteProtocol.WEBDAV)
                        RemotePaths.normalizedEndpoint(config.endpoint)
                    else "",
                host = config.host.trim(),
                share = config.share.trim(),
                domain = config.domain.trim(),
                username = config.username.trim(),
                rootPath = rootPath,
            )
        store.put(saved)
        configs[id] = saved
        return RootGrant(rootUri(saved.protocol, id), name)
    }

    fun remove(rootUri: String) {
        val id = rootId(rootUri) ?: return
        if (windows.isRoot(rootUri)) {
            windows.remove(rootUri)
            File(context.cacheDir, "remote-assets/$id").deleteRecursively()
            return
        }
        configs.remove(id)
        store.remove(id)
        File(context.cacheDir, "remote-assets/$id").deleteRecursively()
    }

    fun list(rootUri: String, relativePath: String): List<RemoteNode> {
        if (windows.isRoot(rootUri)) return windows.list(rootUri, relativePath)
        val config = config(rootUri)
        val path = RemotePaths.join(config.rootPath, RemotePaths.normalizeRelative(relativePath))
        return backend(config).list(path)
    }

    fun open(rootUri: String, relativePath: String, offset: Long = 0): RemoteRead {
        require(offset >= 0) { "読み込み位置が不正です" }
        if (windows.isRoot(rootUri)) return windows.open(rootUri, relativePath, offset)
        val config = config(rootUri)
        val path = RemotePaths.join(config.rootPath, RemotePaths.normalizeRelative(relativePath))
        return backend(config).open(path, offset)
    }

    fun mediaUri(rootUri: String, relativePath: String): Uri {
        val id = rootId(rootUri) ?: error("リモートフォルダIDが不正です")
        val builder = Uri.Builder().scheme(REMOTE_MEDIA_SCHEME).authority(id)
        RemotePaths.normalizeRelative(relativePath)
            .split('/')
            .filter(String::isNotEmpty)
            .forEach(builder::appendPath)
        return builder.build()
    }

    fun openMedia(uri: Uri, offset: Long): RemoteRead {
        require(uri.scheme == REMOTE_MEDIA_SCHEME) { "リモートメディアURIではありません" }
        val id = uri.host?.takeIf(ID_PATTERN::matches) ?: error("リモートメディアIDが不正です")
        windows.rootUriForId(id)?.let {
            return windows.open(it, uri.pathSegments.joinToString("/"), offset)
        }
        val config = configById(id)
        val rootUri = rootUri(config.protocol, id)
        val path = uri.pathSegments.joinToString("/")
        return open(rootUri, path, offset)
    }

    fun materialize(rootUri: String, relativePath: String, modifiedAt: Long, size: Long): Uri {
        val id = rootId(rootUri) ?: error("リモートフォルダIDが不正です")
        val path = RemotePaths.normalizeRelative(relativePath)
        val suffix =
            path
                .substringAfterLast('.')
                .takeIf { it.length in 1..8 && it.all(Char::isLetterOrDigit) }
                ?.let { ".$it" }
                .orEmpty()
        val digest = sha256("$rootUri\n$path\n$modifiedAt\n$size")
        val directory = File(context.cacheDir, "remote-assets/$id").apply { mkdirs() }
        val target = File(directory, "$digest$suffix")
        if (!target.isFile) {
            val temporary = File(directory, ".$digest-${UUID.randomUUID()}.tmp")
            try {
                open(rootUri, path).use { read ->
                    require(read.totalLength <= MAX_MATERIALIZED_BYTES || read.totalLength < 0) {
                        "画像ファイルが大きすぎます"
                    }
                    temporary.outputStream().buffered().use { output ->
                        copyLimited(read.input, output, MAX_MATERIALIZED_BYTES)
                    }
                }
                if (!temporary.renameTo(target)) {
                    temporary.copyTo(target, overwrite = true)
                    temporary.delete()
                }
            } finally {
                temporary.delete()
            }
        }
        return FileProvider.getUriForFile(context, "${context.packageName}.files", target)
    }

    private fun config(rootUri: String): RemoteConnectionConfig {
        val id = rootId(rootUri) ?: error("リモートフォルダIDが不正です")
        val value = configById(id)
        val expected =
            when {
                rootUri.startsWith(SMB_ROOT_PREFIX) -> RemoteProtocol.SMB
                rootUri.startsWith(WEBDAV_ROOT_PREFIX) -> RemoteProtocol.WEBDAV
                else -> error("リモートフォルダ形式が不正です")
            }
        require(value.protocol == expected) { "リモートフォルダの種類が一致しません" }
        return value
    }

    private fun configById(id: String): RemoteConnectionConfig =
        configs[id]
            ?: store.get(id)?.also { configs[id] = it }
            ?: error("接続情報が見つかりません。フォルダを追加し直してください")

    private fun backend(config: RemoteConnectionConfig): RemoteBackend =
        when (config.protocol) {
            RemoteProtocol.SMB -> SmbBackend(config)
            RemoteProtocol.WEBDAV -> WebDavBackend(config, httpClient)
        }

    private fun rootUri(protocol: RemoteProtocol, id: String): String =
        when (protocol) {
            RemoteProtocol.SMB -> "$SMB_ROOT_PREFIX$id"
            RemoteProtocol.WEBDAV -> "$WEBDAV_ROOT_PREFIX$id"
        }

    private fun rootId(rootUri: String): String? =
        when {
            rootUri.startsWith(SMB_ROOT_PREFIX) -> rootUri.removePrefix(SMB_ROOT_PREFIX)
            rootUri.startsWith(WEBDAV_ROOT_PREFIX) -> rootUri.removePrefix(WEBDAV_ROOT_PREFIX)
            rootUri.startsWith(WindowsPeerSourceManager.ROOT_PREFIX) ->
                rootUri.removePrefix(WindowsPeerSourceManager.ROOT_PREFIX)
            else -> null
        }?.takeIf(ID_PATTERN::matches)

    private fun defaultName(config: RemoteConnectionConfig, path: String): String =
        path.substringAfterLast('/').ifBlank {
            if (config.protocol == RemoteProtocol.SMB) config.share
            else URI(config.endpoint).host.orEmpty()
        }

    companion object {
        const val REMOTE_MEDIA_SCHEME = "yuraive-remote"
        private const val SMB_ROOT_PREFIX = "yuraive+smb://"
        private const val WEBDAV_ROOT_PREFIX = "yuraive+webdav://"
        private const val MAX_MATERIALIZED_BYTES = 64L * 1024 * 1024
        private val ID_PATTERN = Regex("^[A-Za-z0-9-]{1,80}$")

        private fun sha256(value: String): String =
            MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {
                "%02x".format(it)
            }

        private fun copyLimited(input: InputStream, output: java.io.OutputStream, maxBytes: Long) {
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                require(total <= maxBytes) { "画像ファイルが大きすぎます" }
                output.write(buffer, 0, count)
            }
        }
    }
}

private interface RemoteBackend {
    fun list(relativePath: String): List<RemoteNode>

    fun open(relativePath: String, offset: Long): RemoteRead
}

private class SmbBackend(private val config: RemoteConnectionConfig) : RemoteBackend {
    override fun list(relativePath: String): List<RemoteNode> =
        try {
            val resources = connect()
            try {
                resources.share.list(smbPath(relativePath)).mapNotNull { info ->
                    val name = info.fileName
                    if (!RemotePaths.isSafeSegment(name)) return@mapNotNull null
                    RemoteNode(
                        name = name,
                        isDirectory =
                            EnumWithValue.EnumUtils.isSet(
                                info.fileAttributes,
                                FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
                            ),
                        size = info.endOfFile.coerceAtLeast(0),
                        modifiedAt = info.lastWriteTime.toEpochMillis().coerceAtLeast(0),
                    )
                }
            } finally {
                resources.close()
            }
        } catch (error: Throwable) {
            throw friendlyError("SMB共有に接続できません", error)
        }

    override fun open(relativePath: String, offset: Long): RemoteRead {
        val resources =
            try {
                connect()
            } catch (error: Throwable) {
                throw friendlyError("SMB共有に接続できません", error)
            }
        try {
            val file =
                resources.share.openFile(
                    smbPath(relativePath),
                    EnumSet.of(AccessMask.GENERIC_READ),
                    null,
                    EnumSet.of(
                        SMB2ShareAccess.FILE_SHARE_READ,
                        SMB2ShareAccess.FILE_SHARE_WRITE,
                        SMB2ShareAccess.FILE_SHARE_DELETE,
                    ),
                    SMB2CreateDisposition.FILE_OPEN,
                    EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
                )
            resources.file = file
            val length = file.getFileInformation(FileStandardInformation::class.java).endOfFile
            require(offset <= length) { "ファイルの末尾を超えています" }
            val input = file.inputStream
            skipFully(input, offset)
            return RemoteRead(ResourceInputStream(input, resources), length)
        } catch (error: Throwable) {
            resources.close()
            throw friendlyError("SMBファイルを開けません", error)
        }
    }

    private fun connect(): SmbResources {
        val smbConfig =
            SmbConfig.builder()
                .withTimeout(30, TimeUnit.SECONDS)
                .withSoTimeout(15, TimeUnit.SECONDS)
                .build()
        val client = SMBClient(smbConfig)
        try {
            val connection = client.connect(config.host, config.port)
            val authentication =
                if (config.username.isBlank() && config.password.isBlank()) {
                    AuthenticationContext.guest()
                } else {
                    AuthenticationContext(
                        config.username,
                        config.password.toCharArray(),
                        config.domain.ifBlank { null },
                    )
                }
            val session = connection.authenticate(authentication)
            val share = session.connectShare(config.share) as? DiskShare ?: error("ディスク共有ではありません")
            return SmbResources(client, connection, session, share)
        } catch (error: Throwable) {
            client.close()
            throw error
        }
    }

    private fun smbPath(path: String): String =
        RemotePaths.normalizeRelative(path).replace('/', '\\')

    private fun friendlyError(fallback: String, error: Throwable): IOException {
        if (error is IOException && error.message in setOf(fallback, "SMBの認証に失敗しました")) return error
        val details =
            generateSequence(error) { it.cause }.mapNotNull(Throwable::message).joinToString(" ")
        val message =
            if (
                details.contains("STATUS_LOGON_FAILURE", ignoreCase = true) ||
                    details.contains("STATUS_ACCESS_DENIED", ignoreCase = true)
            ) {
                "SMBの認証に失敗しました"
            } else {
                fallback
            }
        return IOException(message, error)
    }
}

private class SmbResources(
    private val client: SMBClient,
    private val connection: Connection,
    private val session: Session,
    val share: DiskShare,
) : Closeable {
    var file: SmbFile? = null

    override fun close() {
        runCatching { file?.close() }
        runCatching { share.close() }
        runCatching { session.close() }
        runCatching { connection.close() }
        runCatching { client.close() }
    }
}

private class ResourceInputStream(input: InputStream, private val resources: Closeable) :
    FilterInputStream(input) {
    override fun close() {
        try {
            super.close()
        } finally {
            resources.close()
        }
    }
}

internal class WebDavBackend(
    private val config: RemoteConnectionConfig,
    private val client: OkHttpClient,
) : RemoteBackend {
    private val endpoint = RemotePaths.normalizedEndpoint(config.endpoint)

    override fun list(relativePath: String): List<RemoteNode> {
        val requested = RemotePaths.normalizeRelative(relativePath)
        val body = PROPFIND_BODY.toRequestBody(XML_MEDIA_TYPE)
        val request =
            requestBuilder(url(requested, directory = true))
                .header("Depth", "1")
                .header("Content-Type", "application/xml; charset=utf-8")
                .method("PROPFIND", body)
                .build()
        val call =
            client.newCall(request).apply {
                timeout().timeout(PROPFIND_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            }
        call.execute().use { response ->
            checkResponse(response, "フォルダ一覧を取得できません")
            val bytes = readLimited(response.body.byteStream(), MAX_XML_BYTES)
            return parseListing(bytes, requested)
        }
    }

    override fun open(relativePath: String, offset: Long): RemoteRead {
        val request =
            requestBuilder(url(RemotePaths.normalizeRelative(relativePath), directory = false))
                .apply { if (offset > 0) header("Range", "bytes=$offset-") }
                .get()
                .build()
        val response = client.newCall(request).execute()
        try {
            if (response.code == 416) {
                val total = response.header("Content-Range")?.substringAfter("*/")?.toLongOrNull()
                if (total != null && offset == total) {
                    response.close()
                    return RemoteRead(ByteArrayInputStream(ByteArray(0)), total)
                }
            }
            checkResponse(response, "ファイルを開けません")
            val body = response.body
            var input = body.byteStream()
            val contentRange = response.header("Content-Range")
            val rangeStart =
                contentRange?.substringAfter("bytes ", "")?.substringBefore('-')?.toLongOrNull()
            if (response.code == 206 && rangeStart != offset)
                throw IOException("WebDAVサーバーが異なるRangeを返しました")
            val rangeTotal = contentRange?.substringAfterLast('/', "")?.toLongOrNull()
            val totalLength =
                rangeTotal
                    ?: when {
                        body.contentLength() < 0 -> -1
                        response.code == 206 -> offset + body.contentLength()
                        else -> body.contentLength()
                    }
            if (offset > 0 && response.code == 200) skipFully(input, offset)
            input =
                object : FilterInputStream(input) {
                    override fun close() {
                        try {
                            super.close()
                        } finally {
                            response.close()
                        }
                    }
                }
            return RemoteRead(input, totalLength)
        } catch (error: Throwable) {
            response.close()
            throw error
        }
    }

    private fun requestBuilder(url: String): Request.Builder =
        Request.Builder().url(url).apply {
            if (config.username.isNotBlank() || config.password.isNotBlank()) {
                header(
                    "Authorization",
                    Credentials.basic(config.username, config.password, StandardCharsets.UTF_8),
                )
            }
        }

    private fun url(relativePath: String, directory: Boolean): String {
        val encoded =
            RemotePaths.normalizeRelative(relativePath)
                .split('/')
                .filter(String::isNotEmpty)
                .joinToString("/") { segment -> percentEncode(segment) }
        return endpoint + encoded + if (directory && encoded.isNotEmpty()) "/" else ""
    }

    private fun parseListing(bytes: ByteArray, requestedPath: String): List<RemoteNode> {
        val asciiProjection =
            buildString(bytes.size) {
                bytes.forEach { byte ->
                    val value = byte.toInt() and 0xff
                    if (value in 1..0x7f) append(value.toChar())
                }
            }
        require(
            !asciiProjection.contains("<!DOCTYPE", ignoreCase = true) &&
                !asciiProjection.contains("<!ENTITY", ignoreCase = true)
        ) {
            "WebDAVのXMLに許可されていない宣言があります"
        }
        val factory =
            DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                setExpandEntityReferences(false)
                // Android's platform parser does not expose every Xerces feature through
                // DocumentBuilderFactory. The encoding-independent declaration check above and
                // the rejecting EntityResolver below remain mandatory; these are extra hardening
                // where the parser supports them.
                runCatching {
                    setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                }
                runCatching {
                    setFeature("http://xml.org/sax/features/external-general-entities", false)
                }
                runCatching {
                    setFeature("http://xml.org/sax/features/external-parameter-entities", false)
                }
                runCatching {
                    setFeature(
                        "http://apache.org/xml/features/nonvalidating/load-external-dtd",
                        false,
                    )
                }
                runCatching {
                    setAttribute("http://javax.xml.XMLConstants/property/accessExternalDTD", "")
                }
                runCatching {
                    setAttribute("http://javax.xml.XMLConstants/property/accessExternalSchema", "")
                }
            }
        val document =
            factory
                .newDocumentBuilder()
                .apply { setEntityResolver { _, _ -> InputSource(StringReader("")) } }
                .parse(ByteArrayInputStream(bytes))
        val endpointSegments = decodedPathSegments(URI(endpoint).rawPath)
        val requestedSegments = requestedPath.split('/').filter(String::isNotEmpty)
        val requestUri = URI(url(requestedPath, directory = true))
        val responseNodes = document.getElementsByTagNameNS("DAV:", "response")
        val result = linkedMapOf<String, RemoteNode>()
        for (index in 0 until responseNodes.length) {
            val response = responseNodes.item(index) as? org.w3c.dom.Element ?: continue
            val href =
                response
                    .getElementsByTagNameNS("DAV:", "href")
                    .item(0)
                    ?.textContent
                    ?.trim()
                    .orEmpty()
            if (href.isEmpty()) continue
            val absolute = runCatching { requestUri.resolve(href) }.getOrNull() ?: continue
            if (
                absolute.host != null &&
                    !absolute.host.equals(URI(endpoint).host, ignoreCase = true)
            )
                continue
            val segments =
                runCatching { decodedPathSegments(absolute.rawPath) }.getOrNull() ?: continue
            if (segments.take(endpointSegments.size) != endpointSegments) continue
            val relative = segments.drop(endpointSegments.size)
            if (
                relative.size != requestedSegments.size + 1 ||
                    relative.take(requestedSegments.size) != requestedSegments
            )
                continue
            val name = relative.lastOrNull()?.takeIf(RemotePaths::isSafeSegment) ?: continue
            val properties = successfulProperties(response) ?: continue
            val isDirectory = properties.getElementsByTagNameNS("DAV:", "collection").length > 0
            val size =
                properties
                    .getElementsByTagNameNS("DAV:", "getcontentlength")
                    .item(0)
                    ?.textContent
                    ?.trim()
                    ?.toLongOrNull() ?: 0
            val modified =
                properties
                    .getElementsByTagNameNS("DAV:", "getlastmodified")
                    .item(0)
                    ?.textContent
                    ?.trim()
                    ?.let {
                        runCatching {
                                ZonedDateTime.parse(it, DateTimeFormatter.RFC_1123_DATE_TIME)
                                    .toInstant()
                                    .toEpochMilli()
                            }
                            .getOrDefault(0)
                    } ?: 0
            result[name] =
                RemoteNode(name, isDirectory, size.coerceAtLeast(0), modified.coerceAtLeast(0))
        }
        return result.values.toList()
    }

    private fun checkResponse(response: Response, message: String) {
        if (response.isSuccessful) return
        val detail =
            when (response.code) {
                401,
                403 -> "認証に失敗しました"
                404 -> "パスが見つかりません"
                else -> "$message (HTTP ${response.code})"
            }
        throw IOException(detail)
    }

    companion object {
        private val XML_MEDIA_TYPE = "application/xml; charset=utf-8".toMediaType()
        private const val MAX_XML_BYTES = 4 * 1024 * 1024
        private const val PROPFIND_TIMEOUT_SECONDS = 60L
        private const val PROPFIND_BODY =
            """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>"""

        private fun percentEncode(value: String): String =
            java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name())
                .replace("+", "%20")
                .replace("%7E", "~", ignoreCase = true)

        private fun decodedPathSegments(rawPath: String?): List<String> =
            rawPath
                .orEmpty()
                .split('/')
                .filter(String::isNotEmpty)
                .map { segment ->
                    URLDecoder.decode(segment.replace("+", "%2B"), StandardCharsets.UTF_8.name())
                }
                .also { segments ->
                    require(
                        segments.none {
                            it == "." || it == ".." || it.contains('/') || it.contains('\\')
                        }
                    )
                }

        private fun successfulProperties(response: Element): Element? {
            val propStats = response.getElementsByTagNameNS("DAV:", "propstat")
            for (index in 0 until propStats.length) {
                val propStat = propStats.item(index) as? Element ?: continue
                val status =
                    propStat
                        .getElementsByTagNameNS("DAV:", "status")
                        .item(0)
                        ?.textContent
                        ?.trim()
                        .orEmpty()
                val statusCode = status.split(Regex("\\s+")).getOrNull(1)?.toIntOrNull()
                if (statusCode !in 200..299) continue
                return propStat.getElementsByTagNameNS("DAV:", "prop").item(0) as? Element
            }
            return null
        }

        private fun readLimited(input: InputStream, maxBytes: Int): ByteArray =
            input.use {
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0
                while (true) {
                    val count = it.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= maxBytes) { "WebDAVの応答が大きすぎます" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
    }
}

private class EncryptedRemoteConfigStore(context: Context) {
    private val preferences = context.getSharedPreferences("remote_library", Context.MODE_PRIVATE)

    fun put(config: RemoteConnectionConfig) {
        require(config.id.isNotBlank())
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(config.id.toByteArray())
        val plaintext = YuraiveJson.format.encodeToString(config).toByteArray()
        val encrypted = cipher.doFinal(plaintext)
        val payload = ByteArray(1 + cipher.iv.size + encrypted.size)
        payload[0] = cipher.iv.size.toByte()
        cipher.iv.copyInto(payload, 1)
        encrypted.copyInto(payload, 1 + cipher.iv.size)
        preferences
            .edit()
            .putString(config.id, Base64.encodeToString(payload, Base64.NO_WRAP))
            .apply()
    }

    fun get(id: String): RemoteConnectionConfig? =
        preferences.getString(id, null)?.let { encoded ->
            runCatching {
                    val payload = Base64.decode(encoded, Base64.NO_WRAP)
                    val ivSize = payload.firstOrNull()?.toInt()?.and(0xff) ?: error("暗号化データが空です")
                    require(ivSize in 12..16 && payload.size > ivSize + 1) { "暗号化データが壊れています" }
                    val cipher = Cipher.getInstance(TRANSFORMATION)
                    cipher.init(
                        Cipher.DECRYPT_MODE,
                        key(),
                        GCMParameterSpec(128, payload.copyOfRange(1, ivSize + 1)),
                    )
                    cipher.updateAAD(id.toByteArray())
                    val plaintext = cipher.doFinal(payload.copyOfRange(ivSize + 1, payload.size))
                    YuraiveJson.format
                        .decodeFromString<RemoteConnectionConfig>(plaintext.decodeToString())
                        .also { require(it.id == id) }
                }
                .getOrNull()
        }

    fun remove(id: String) {
        preferences.edit().remove(id).apply()
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let {
            return it
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val KEY_ALIAS = "yuraive.remote-library.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

private fun skipFully(input: InputStream, amount: Long) {
    var remaining = amount
    while (remaining > 0) {
        val skipped = input.skip(remaining)
        if (skipped > 0) {
            remaining -= skipped
        } else {
            if (input.read() < 0) throw IOException("ファイルの末尾を超えています")
            remaining--
        }
    }
}
