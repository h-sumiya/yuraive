package com.yuraive.player.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.yuraive.player.model.GraphValidator
import com.yuraive.player.model.YuraiveJson
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

@Serializable
private data class WindowsRootConfig(
    val id: String,
    val endpoint: String,
    val room: String,
    val secret: String,
    val fingerprint: String,
    val deviceId: String,
    val deviceName: String,
    val rootId: String,
    val rootName: String,
)

private data class PairingPayload(
    val endpoint: String,
    val room: String,
    val secret: String,
    val fingerprint: String,
    val deviceId: String,
    val deviceName: String,
) {
    companion object {
        private val roomPattern = Regex("^[A-Za-z0-9_-]{22,64}$")
        private val tokenPattern = Regex("^[A-Za-z0-9_-]{43}$")
        private val devicePattern = Regex("^[A-Za-z0-9_-]{22,64}$")

        fun parse(value: String): PairingPayload {
            val uri = Uri.parse(value)
            require(uri.scheme == "yuraive" && uri.host == "pair") { "Yuraiveの接続用QRコードではありません" }
            require(uri.getQueryParameter("v") == "2") { "未対応の接続コードです" }
            val endpoint = uri.getQueryParameter("endpoint").orEmpty().trimEnd('/')
            require(endpoint == SIGNALING_ENDPOINT) { "接続先が正しくありません" }
            val room = uri.getQueryParameter("room").orEmpty()
            val secret = uri.getQueryParameter("secret").orEmpty()
            val fingerprint = uri.getQueryParameter("pin").orEmpty()
            val deviceId = uri.getQueryParameter("device").orEmpty()
            require(
                roomPattern.matches(room) &&
                    tokenPattern.matches(secret) &&
                    tokenPattern.matches(fingerprint) &&
                    devicePattern.matches(deviceId)
            ) {
                "接続コードが壊れています"
            }
            return PairingPayload(
                endpoint = endpoint,
                room = room,
                secret = secret,
                fingerprint = fingerprint,
                deviceId = deviceId,
                deviceName =
                    uri.getQueryParameter("name")?.take(80)?.ifBlank { "Windows" } ?: "Windows",
            )
        }
    }
}

data class WindowsDeviceConnection(
    val id: String,
    val name: String,
    val rootUris: List<String>,
    val status: WindowsConnectionStatus,
)

enum class WindowsConnectionStatus {
    OFFLINE,
    CONNECTING,
    LOADING,
    CONNECTED,
    ERROR,
}

internal class WindowsPeerSourceManager(private val context: Context) {
    private val store = EncryptedWindowsRootStore(context)
    private val configs = ConcurrentHashMap<String, WindowsRootConfig>()
    private val pendingConfigs = ConcurrentHashMap<String, WindowsRootConfig>()
    private val clients = ConcurrentHashMap<String, WindowsPeerClient>()
    private val activeClients = ConcurrentHashMap<String, WindowsPeerClient>()
    private val clientLock = Any()
    private val connectionStatesMutable =
        MutableStateFlow<Map<String, WindowsConnectionStatus>>(emptyMap())
    val connectionStates: StateFlow<Map<String, WindowsConnectionStatus>> =
        connectionStatesMutable.asStateFlow()

    init {
        val connectivity =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        var activeNetwork = connectivity.activeNetwork
        connectivity.registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    val previous = activeNetwork
                    activeNetwork = network
                    if (previous != null && previous != network) refreshAll()
                }

                override fun onLost(network: Network) {
                    if (activeNetwork == network) {
                        activeNetwork = null
                        refreshAll()
                    }
                }
            }
        )
    }

    suspend fun pair(qrPayload: String): List<RootGrant> =
        withContext(Dispatchers.IO) {
            val pairing = PairingPayload.parse(qrPayload)
            val temporary =
                WindowsRootConfig(
                    id = "pairing",
                    endpoint = pairing.endpoint,
                    room = pairing.room,
                    secret = pairing.secret,
                    fingerprint = pairing.fingerprint,
                    deviceId = pairing.deviceId,
                    deviceName = pairing.deviceName,
                    rootId = "",
                    rootName = "",
                )
            pendingConfigs[pairing.deviceId] = temporary
            connectionStatesMutable.update {
                it + (pairing.deviceId to WindowsConnectionStatus.CONNECTING)
            }
            connectDevice(temporary)
        }

    fun retryDevice(deviceId: String): List<RootGrant> {
        val config =
            pendingConfigs[deviceId]
                ?: configs.values.firstOrNull { it.deviceId == deviceId }
                ?: error("Windowsとの接続情報がありません")
        refreshDevice(deviceId)
        connectionStatesMutable.update { it + (deviceId to WindowsConnectionStatus.CONNECTING) }
        return connectDevice(config)
    }

    fun isRoot(rootUri: String): Boolean = rootId(rootUri) != null

    fun hasConfig(rootUri: String): Boolean = rootId(rootUri)?.let(::configById) != null

    fun remove(rootUri: String) {
        val id = rootId(rootUri) ?: return
        configs.remove(id)
        store.remove(id)
    }

    fun devices(rootGrants: List<RootGrant>): List<WindowsDeviceConnection> {
        val roots =
            rootGrants.mapNotNull { grant ->
                val id = rootId(grant.uri) ?: return@mapNotNull null
                val config = configById(id)
                val deviceName =
                    config?.deviceName
                        ?: grant.name.substringBefore(DEVICE_NAME_SEPARATOR).ifBlank { "Windows" }
                WindowsDeviceRoot(
                    deviceId = config?.deviceId ?: "missing:${stableId("missing", deviceName)}",
                    deviceName = deviceName,
                    rootUri = grant.uri,
                    configured = config != null,
                )
            }
        val configuredIdsByName =
            roots.filter(WindowsDeviceRoot::configured).associate { it.deviceName to it.deviceId }
        val configuredDevices =
            roots
                .map { root ->
                    root.takeIf(WindowsDeviceRoot::configured)
                        ?: root.copy(
                            deviceId = configuredIdsByName[root.deviceName] ?: root.deviceId
                        )
                }
                .groupBy(WindowsDeviceRoot::deviceId)
                .map { (deviceId, deviceRoots) ->
                    WindowsDeviceConnection(
                        id = deviceId,
                        name = deviceRoots.first().deviceName,
                        rootUris = deviceRoots.map(WindowsDeviceRoot::rootUri),
                        status =
                            if (deviceRoots.any(WindowsDeviceRoot::configured)) {
                                connectionStatesMutable.value[deviceId]
                                    ?: WindowsConnectionStatus.OFFLINE
                            } else {
                                WindowsConnectionStatus.OFFLINE
                            },
                    )
                }
        val configuredDeviceIds =
            configuredDevices.mapTo(mutableSetOf(), WindowsDeviceConnection::id)
        val pendingDevices =
            pendingConfigs.values
                .distinctBy(WindowsRootConfig::deviceId)
                .filterNot { it.deviceId in configuredDeviceIds }
                .map { config ->
                    WindowsDeviceConnection(
                        id = config.deviceId,
                        name = config.deviceName,
                        rootUris = emptyList(),
                        status =
                            connectionStatesMutable.value[config.deviceId]
                                ?: WindowsConnectionStatus.CONNECTING,
                    )
                }
        return (configuredDevices + pendingDevices).sortedBy { it.name.lowercase() }
    }

    fun removeDevice(deviceId: String) {
        pendingConfigs.remove(deviceId)
        refreshDevice(deviceId)
    }

    fun refreshDevice(deviceId: String) {
        val removed =
            synchronized(clientLock) {
                activeClients.remove(deviceId)
                connectionStatesMutable.update { it - deviceId }
                clients.entries
                    .filter { it.value.deviceId == deviceId }
                    .mapNotNull { (key, client) -> client.takeIf { clients.remove(key, client) } }
            }
        removed.forEach(WindowsPeerClient::close)
    }

    fun refreshAll() {
        val removed =
            synchronized(clientLock) {
                activeClients.clear()
                connectionStatesMutable.value = emptyMap()
                clients.values.toList().also { clients.clear() }
            }
        removed.forEach(WindowsPeerClient::close)
    }

    fun list(rootUri: String, relativePath: String): List<RemoteNode> {
        val config = config(rootUri)
        return client(config).list(config.rootId, normalize(relativePath))
    }

    fun open(rootUri: String, relativePath: String, offset: Long = 0): RemoteRead {
        require(offset >= 0) { "読み込み位置が不正です" }
        val config = config(rootUri)
        val path = normalize(relativePath)
        val node =
            client(config).stat(config.rootId, path)
                ?: throw IOException("ファイルが見つかりません: $relativePath")
        require(!node.isDirectory) { "フォルダは開けません" }
        return RemoteRead(
            PeerRangeInputStream(client(config), config.rootId, path, offset, node.size),
            node.size,
        )
    }

    fun rootUriForId(id: String): String? = configById(id)?.let { rootUri(id) }

    private fun connectDevice(config: WindowsRootConfig): List<RootGrant> =
        try {
            val roots = client(config).roots()
            require(roots.isNotEmpty()) { "Windowsのライブラリにフォルダがありません" }
            roots
                .map { (rootId, rootName) ->
                    val id = stableId(config.deviceId, rootId)
                    val rootConfig = config.copy(id = id, rootId = rootId, rootName = rootName)
                    store.put(rootConfig)
                    configs[id] = rootConfig
                    RootGrant(rootUri(id), "${config.deviceName} · $rootName")
                }
                .also { pendingConfigs.remove(config.deviceId) }
        } catch (error: Exception) {
            connectionStatesMutable.update {
                it + (config.deviceId to WindowsConnectionStatus.ERROR)
            }
            throw error
        }

    private fun client(config: WindowsRootConfig): WindowsPeerClient {
        val key = "${config.endpoint}|${config.room}|${config.secret}|${config.fingerprint}"
        return synchronized(clientLock) {
            val client =
                clients[key]
                    ?: run {
                        lateinit var created: WindowsPeerClient
                        created =
                            WindowsPeerClient(context, config) { status ->
                                if (activeClients[config.deviceId] === created) {
                                    connectionStatesMutable.update { states ->
                                        states + (config.deviceId to status)
                                    }
                                }
                            }
                        clients[key] = created
                        created
                    }
            activeClients[config.deviceId] = client
            client
        }
    }

    private fun config(rootUri: String): WindowsRootConfig {
        val id = rootId(rootUri) ?: error("WindowsフォルダIDが不正です")
        return configById(id) ?: error("Windowsとの接続情報がありません")
    }

    private fun configById(id: String): WindowsRootConfig? =
        configs[id] ?: store.get(id)?.also { configs[id] = it }

    private fun normalize(path: String): String {
        val value = path.trim('/')
        require(value.isEmpty() || GraphValidator.isSafeRelativePath(value)) { "安全でないパスです" }
        return value
    }

    companion object {
        const val ROOT_PREFIX = "yuraive+windows://"
        private const val DEVICE_NAME_SEPARATOR = " · "
        private val idPattern = Regex("^[a-f0-9]{32}$")

        fun rootId(uri: String): String? =
            uri.removePrefix(ROOT_PREFIX).takeIf {
                uri.startsWith(ROOT_PREFIX) && idPattern.matches(it)
            }

        private fun rootUri(id: String) = "$ROOT_PREFIX$id"

        private fun stableId(deviceId: String, rootId: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest("$deviceId\u0000$rootId".toByteArray())
                .take(16)
                .joinToString("") { "%02x".format(it) }
    }
}

private class PeerRangeInputStream(
    private val client: WindowsPeerClient,
    private val rootId: String,
    private val path: String,
    offset: Long,
    private val length: Long,
) : InputStream() {
    private var position = offset.coerceAtMost(length)
    private var chunk = ByteArray(0)
    private var chunkOffset = 0

    override fun read(): Int {
        if (!ensureChunk()) return -1
        return chunk[chunkOffset++].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
        require(offset >= 0 && count >= 0 && offset + count <= buffer.size)
        if (count == 0) return 0
        if (!ensureChunk()) return -1
        val copied = minOf(count, chunk.size - chunkOffset)
        chunk.copyInto(buffer, offset, chunkOffset, chunkOffset + copied)
        chunkOffset += copied
        return copied
    }

    override fun available(): Int =
        minOf(Int.MAX_VALUE.toLong(), length - position + chunk.size - chunkOffset).toInt()

    private fun ensureChunk(): Boolean {
        if (chunkOffset < chunk.size) return true
        if (position >= length) return false
        chunk = client.read(rootId, path, position, minOf(128 * 1024L, length - position).toInt())
        chunkOffset = 0
        position += chunk.size
        if (chunk.isEmpty() && position < length) {
            throw IOException("Windowsからファイルを読み込めません")
        }
        return chunk.isNotEmpty()
    }
}

private data class WindowsDeviceRoot(
    val deviceId: String,
    val deviceName: String,
    val rootUri: String,
    val configured: Boolean,
)

private class WindowsPeerClient(
    context: Context,
    private val config: WindowsRootConfig,
    private val connectionChanged: (WindowsConnectionStatus) -> Unit,
) {
    val deviceId: String
        get() = config.deviceId

    private val activeRequests = AtomicInteger()
    private val requestBatchFailed = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val handle: Long

    init {
        val cacheDirectory = File(context.cacheDir, "p2p/${config.deviceId}").apply { mkdirs() }
        val request = buildJsonObject {
            put("endpoint", config.endpoint)
            put("room", config.room)
            put("secret", config.secret)
            put("fingerprint", config.fingerprint)
            put("cacheDirectory", cacheDirectory.absolutePath)
            put("maximumCacheBytes", MAXIMUM_CACHE_BYTES)
        }
        handle = NativeP2pClient.create(request.toString())
    }

    fun roots(): List<Pair<String, String>> = trackedRequest {
        NativeP2pClient.roots(handle).map { root ->
            root["id"]!!.jsonPrimitive.content to root["name"]!!.jsonPrimitive.content
        }
    }

    fun list(rootId: String, path: String): List<RemoteNode> = trackedRequest {
        NativeP2pClient.list(handle, rootId, path).map(::remoteNode)
    }

    fun stat(rootId: String, path: String): RemoteNode? = trackedRequest {
        NativeP2pClient.stat(handle, rootId, path)?.get("node")?.jsonObject?.let(::remoteNode)
    }

    fun read(rootId: String, path: String, offset: Long, count: Int): ByteArray = trackedRequest {
        NativeP2pClient.read(handle, rootId, path, offset, count)
    }

    private inline fun <T> trackedRequest(block: () -> T): T {
        check(!closed.get()) { "Windowsとの接続は再読み込みされました" }
        if (activeRequests.incrementAndGet() == 1) {
            requestBatchFailed.set(false)
            connectionChanged(WindowsConnectionStatus.LOADING)
        }
        return try {
            block()
        } catch (error: Throwable) {
            requestBatchFailed.set(true)
            connectionChanged(WindowsConnectionStatus.ERROR)
            Log.e("YuraiveP2P", NativeP2pClient.status(handle), error)
            throw (error as? IOException
                ?: IOException(error.message ?: "WindowsとのP2P通信に失敗しました", error))
        } finally {
            if (activeRequests.decrementAndGet() == 0 && !requestBatchFailed.get()) {
                connectionChanged(WindowsConnectionStatus.CONNECTED)
            }
        }
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        NativeP2pClient.close(handle)
        connectionChanged(WindowsConnectionStatus.OFFLINE)
    }

    companion object {
        private const val MAXIMUM_CACHE_BYTES = 2L * 1024 * 1024 * 1024

        private fun remoteNode(value: JsonObject) =
            RemoteNode(
                name = value["name"]!!.jsonPrimitive.content,
                isDirectory = value["isDirectory"]!!.jsonPrimitive.content == "true",
                size = value["size"]?.jsonPrimitive?.long ?: 0,
                modifiedAt = value["modifiedAt"]?.jsonPrimitive?.long ?: 0,
            )
    }
}

internal object NativeP2pClient {
    init {
        System.loadLibrary("yuraive_runtime")
    }

    fun create(config: String): Long = value(createNative(config)).jsonPrimitive.long

    fun roots(handle: Long): List<JsonObject> =
        value(rootsNative(handle)).jsonArray.map(JsonElement::jsonObject)

    fun list(handle: Long, rootId: String, path: String): List<JsonObject> =
        value(listNative(handle, rootId, path)).jsonArray.map(JsonElement::jsonObject)

    fun stat(handle: Long, rootId: String, path: String): JsonObject? {
        val result = value(statNative(handle, rootId, path))
        return if (result is JsonNull) null else result.jsonObject
    }

    fun read(handle: Long, rootId: String, path: String, offset: Long, count: Int): ByteArray =
        readNative(handle, rootId, path, offset, count)

    fun close(handle: Long) = closeNative(handle)

    fun status(handle: Long): String = statusNative(handle)

    private fun value(json: String): JsonElement {
        val result = YuraiveJson.format.parseToJsonElement(json).jsonObject
        result["error"]?.jsonPrimitive?.contentOrNull?.let { throw IOException(it) }
        return result["value"] ?: throw IOException("Rust P2Pランタイムから応答がありません")
    }

    private external fun createNative(config: String): String

    private external fun rootsNative(handle: Long): String

    private external fun listNative(handle: Long, rootId: String, path: String): String

    private external fun statNative(handle: Long, rootId: String, path: String): String

    private external fun statusNative(handle: Long): String

    private external fun readNative(
        handle: Long,
        rootId: String,
        path: String,
        offset: Long,
        count: Int,
    ): ByteArray

    private external fun closeNative(handle: Long)
}

private class EncryptedWindowsRootStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("windows_library_v2", Context.MODE_PRIVATE)

    init {
        context.getSharedPreferences("windows_library", Context.MODE_PRIVATE).edit().clear().apply()
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply {
                load(null)
                if (containsAlias(LEGACY_KEY_ALIAS)) deleteEntry(LEGACY_KEY_ALIAS)
            }
        }
    }

    fun put(config: WindowsRootConfig) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(config.id.toByteArray())
        val encrypted = cipher.doFinal(YuraiveJson.format.encodeToString(config).toByteArray())
        val payload = ByteArray(1 + cipher.iv.size + encrypted.size)
        payload[0] = cipher.iv.size.toByte()
        cipher.iv.copyInto(payload, 1)
        encrypted.copyInto(payload, 1 + cipher.iv.size)
        preferences
            .edit()
            .putString(config.id, Base64.encodeToString(payload, Base64.NO_WRAP))
            .apply()
    }

    fun get(id: String): WindowsRootConfig? =
        preferences.getString(id, null)?.let { encoded ->
            runCatching {
                    val payload = Base64.decode(encoded, Base64.NO_WRAP)
                    val ivSize = payload.first().toInt() and 0xff
                    require(ivSize in 12..16 && payload.size > ivSize + 1)
                    val cipher = Cipher.getInstance(TRANSFORMATION)
                    cipher.init(
                        Cipher.DECRYPT_MODE,
                        key(),
                        GCMParameterSpec(128, payload.copyOfRange(1, ivSize + 1)),
                    )
                    cipher.updateAAD(id.toByteArray())
                    YuraiveJson.format
                        .decodeFromString<WindowsRootConfig>(
                            cipher
                                .doFinal(payload.copyOfRange(ivSize + 1, payload.size))
                                .decodeToString()
                        )
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
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            KEY_ALIAS,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
            }
            .generateKey()
    }

    companion object {
        private const val KEY_ALIAS = "yuraive.windows-library.v2"
        private const val LEGACY_KEY_ALIAS = "yuraive.windows-library.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

private const val SIGNALING_ENDPOINT = "wss://connect.yuraive.com/v2/rooms"
