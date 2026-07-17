package com.yuraive.player.data

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.yuraive.player.model.GraphValidator
import com.yuraive.player.model.YuraiveJson
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

@Serializable
private data class WindowsRootConfig(
    val id: String,
    val endpoint: String,
    val room: String,
    val secret: String,
    val deviceId: String,
    val deviceName: String,
    val rootId: String,
    val rootName: String,
)

private data class PairingPayload(
    val endpoint: String,
    val room: String,
    val secret: String,
    val deviceId: String,
    val deviceName: String,
) {
    companion object {
        private val roomPattern = Regex("^[A-Za-z0-9_-]{22,64}$")
        private val secretPattern = Regex("^[A-Za-z0-9_-]{43}$")
        private val devicePattern = Regex("^[A-Za-z0-9_-]{22,64}$")

        fun parse(value: String): PairingPayload {
            val uri = Uri.parse(value)
            require(uri.scheme == "yuraive" && uri.host == "pair") { "Yuraiveの接続用QRコードではありません" }
            require(uri.getQueryParameter("v") == "1") { "未対応の接続コードです" }
            val endpoint = uri.getQueryParameter("endpoint").orEmpty().trimEnd('/')
            require(endpoint == SIGNALING_ENDPOINT) { "接続先が正しくありません" }
            val room = uri.getQueryParameter("room").orEmpty()
            val secret = uri.getQueryParameter("secret").orEmpty()
            val deviceId = uri.getQueryParameter("device").orEmpty()
            require(
                roomPattern.matches(room) &&
                    secretPattern.matches(secret) &&
                    devicePattern.matches(deviceId)
            ) {
                "接続コードが壊れています"
            }
            return PairingPayload(
                endpoint = endpoint,
                room = room,
                secret = secret,
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
}

internal class WindowsPeerSourceManager(private val context: Context) {
    private val store = EncryptedWindowsRootStore(context)
    private val configs = ConcurrentHashMap<String, WindowsRootConfig>()
    private val clients = ConcurrentHashMap<String, WindowsPeerClient>()
    private val activeClients = ConcurrentHashMap<String, WindowsPeerClient>()
    private val clientLock = Any()
    private val connectionStatesMutable =
        MutableStateFlow<Map<String, WindowsConnectionStatus>>(emptyMap())
    val connectionStates: StateFlow<Map<String, WindowsConnectionStatus>> =
        connectionStatesMutable.asStateFlow()

    suspend fun pair(qrPayload: String): List<RootGrant> =
        withContext(Dispatchers.IO) {
            val pairing = PairingPayload.parse(qrPayload)
            val temporary =
                WindowsRootConfig(
                    id = "pairing",
                    endpoint = pairing.endpoint,
                    room = pairing.room,
                    secret = pairing.secret,
                    deviceId = pairing.deviceId,
                    deviceName = pairing.deviceName,
                    rootId = "",
                    rootName = "",
                )
            val roots = client(temporary).roots()
            require(roots.isNotEmpty()) { "Windowsのライブラリにフォルダがありません" }
            roots.map { (rootId, rootName) ->
                val id = stableId(pairing.deviceId, rootId)
                val config = temporary.copy(id = id, rootId = rootId, rootName = rootName)
                store.put(config)
                configs[id] = config
                RootGrant(rootUri(id), "${pairing.deviceName} · $rootName")
            }
        }

    fun isRoot(rootUri: String): Boolean = rootId(rootUri) != null

    fun hasConfig(id: String): Boolean = configById(id) != null

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
        val configuredDeviceIds =
            roots.filter(WindowsDeviceRoot::configured).associate { it.deviceName to it.deviceId }
        return roots
            .map { root ->
                root.takeIf(WindowsDeviceRoot::configured)
                    ?: root.copy(deviceId = configuredDeviceIds[root.deviceName] ?: root.deviceId)
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
            .sortedBy { it.name.lowercase() }
    }

    fun removeDevice(deviceId: String) {
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
        val path = normalize(relativePath)
        return client(config).list(config.rootId, path)
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

    private fun client(config: WindowsRootConfig): WindowsPeerClient {
        val key = "${config.endpoint}|${config.room}|${config.secret}"
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
        chunk =
            client.read(rootId, path, position, minOf(32 * 1024L, length - position).toInt()).first
        chunkOffset = 0
        position += chunk.size
        if (chunk.isEmpty() && position < length) throw IOException("Windowsからファイルを読み込めません")
        return chunk.isNotEmpty()
    }
}

private sealed interface PeerReply {
    data class Json(val value: JsonObject) : PeerReply

    data class Binary(val value: ByteArray, val totalLength: Long) : PeerReply
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

    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private val factory = factory(context)
    private val lock = Any()
    private val pending = ConcurrentHashMap<String, CompletableFuture<PeerReply>>()
    private var socket: WebSocket? = null
    private var peer: PeerConnection? = null
    private var channel: DataChannel? = null
    private var connection: CompletableFuture<DataChannel>? = null
    @Volatile private var closed = false
    private val activeRequests = AtomicInteger()
    private var remoteDescriptionReady = false
    private val queuedCandidates = mutableListOf<IceCandidate>()

    fun roots(): List<Pair<String, String>> = trackedRequest {
        val response = request("roots")
        response["roots"]!!.jsonArray.map { item ->
            val root = item.jsonObject
            root["id"]!!.jsonPrimitive.content to root["name"]!!.jsonPrimitive.content
        }
    }

    fun list(rootId: String, path: String): List<RemoteNode> = trackedRequest {
        val response = request("list", rootId, path)
        response["nodes"]!!.jsonArray.map { item ->
            val node = item.jsonObject
            RemoteNode(
                name = node["name"]!!.jsonPrimitive.content,
                isDirectory = node["isDirectory"]!!.jsonPrimitive.booleanOrNull == true,
                size = node["size"]?.jsonPrimitive?.long ?: 0,
                modifiedAt = node["modifiedAt"]?.jsonPrimitive?.long ?: 0,
            )
        }
    }

    fun stat(rootId: String, path: String): RemoteNode? = trackedRequest {
        val node = request("stat", rootId, path)["node"] ?: return@trackedRequest null
        if (node.toString() == "null") return@trackedRequest null
        node.jsonObject.let {
            RemoteNode(
                name = it["name"]!!.jsonPrimitive.content,
                isDirectory = it["isDirectory"]!!.jsonPrimitive.booleanOrNull == true,
                size = it["size"]?.jsonPrimitive?.long ?: 0,
                modifiedAt = it["modifiedAt"]?.jsonPrimitive?.long ?: 0,
            )
        }
    }

    fun read(rootId: String, path: String, offset: Long, count: Int): Pair<ByteArray, Long> =
        trackedRequest {
            val id = requestId()
            val future = CompletableFuture<PeerReply>()
            pending[id] = future
            val message = buildJsonObject {
                put("id", id)
                put("method", "read")
                put("rootId", rootId)
                put("path", path)
                put("offset", offset)
                put("count", count)
            }
            send(id, message)
            when (val reply = await(id, future)) {
                is PeerReply.Binary -> reply.value to reply.totalLength
                is PeerReply.Json -> {
                    val data =
                        reply.value["data"]?.jsonPrimitive?.contentOrNull
                            ?: throw IOException("Windowsからファイルデータが返されませんでした")
                    val totalLength =
                        reply.value["totalLength"]?.jsonPrimitive?.long
                            ?: throw IOException("Windowsからファイルサイズが返されませんでした")
                    Base64.decode(data, Base64.NO_WRAP) to totalLength
                }
            }
        }

    private inline fun <T> trackedRequest(block: () -> T): T {
        activeRequests.incrementAndGet()
        publishActivityState()
        return try {
            block()
        } finally {
            activeRequests.decrementAndGet()
            publishActivityState()
        }
    }

    private fun publishActivityState() {
        val status =
            synchronized(lock) {
                when {
                    closed -> null
                    channel?.state() == DataChannel.State.OPEN ->
                        if (activeRequests.get() > 0) WindowsConnectionStatus.LOADING
                        else WindowsConnectionStatus.CONNECTED
                    connection?.isDone == false -> WindowsConnectionStatus.CONNECTING
                    else -> null
                }
            }
        status?.let(connectionChanged)
    }

    private fun request(method: String, rootId: String? = null, path: String? = null): JsonObject {
        val id = requestId()
        val future = CompletableFuture<PeerReply>()
        pending[id] = future
        val message = buildJsonObject {
            put("id", id)
            put("method", method)
            rootId?.let { put("rootId", it) }
            path?.let { put("path", it) }
        }
        send(id, message)
        return when (val reply = await(id, future)) {
            is PeerReply.Json -> reply.value
            is PeerReply.Binary -> throw IOException("Windowsから不正な応答を受信しました")
        }
    }

    private fun send(id: String, value: JsonObject) {
        try {
            val dataChannel = ensureConnected()
            val bytes = value.toString().toByteArray()
            if (!dataChannel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false)))
                throw IOException("Windowsへリクエストを送信できません")
        } catch (error: Throwable) {
            val failure = error as? IOException ?: IOException("Windowsへリクエストを送信できません", error)
            failCurrentConnection(failure)
            pending.remove(id)?.completeExceptionally(failure)
        }
    }

    private fun await(id: String, future: CompletableFuture<PeerReply>): PeerReply =
        try {
            future.get(15, TimeUnit.SECONDS)
        } catch (error: TimeoutException) {
            val failure = IOException("Windowsから応答がありません", error)
            failCurrentConnection(failure)
            throw failure
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw IOException("Windowsからの応答待ちが中断されました", error)
        } catch (error: ExecutionException) {
            throw (error.cause as? IOException ?: IOException("Windowsから応答がありません", error.cause))
        } finally {
            pending.remove(id)
        }

    private fun ensureConnected(): DataChannel {
        val future =
            synchronized(lock) {
                if (closed) throw IOException("Windowsとの接続は再読み込みされました")
                channel
                    ?.takeIf { it.state() == DataChannel.State.OPEN }
                    ?.let {
                        return it
                    }
                connection?.takeIf { !it.isDone }
                    ?: CompletableFuture<DataChannel>().also {
                        connection = it
                        beginConnection(it)
                    }
            }
        return try {
            future.get(15, TimeUnit.SECONDS).takeIf { it.state() == DataChannel.State.OPEN }
                ?: throw IOException("Windowsとのデータ接続が閉じられました")
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            val failure = IOException("Windowsへの接続待ちが中断されました", error)
            failConnection(future, failure)
            throw failure
        } catch (error: Exception) {
            val cause = if (error is ExecutionException) error.cause else error
            val failure =
                cause as? IOException
                    ?: IOException("WindowsにP2P接続できません。両方のアプリとネットワークを確認してください", cause)
            failConnection(future, failure)
            throw failure
        }
    }

    private fun beginConnection(ready: CompletableFuture<DataChannel>) {
        connectionChanged(WindowsConnectionStatus.CONNECTING)
        var oldChannel: DataChannel? = null
        var oldPeer: PeerConnection? = null
        var oldSocket: WebSocket? = null
        synchronized(lock) {
            oldChannel = channel
            oldPeer = peer
            oldSocket = socket
            channel = null
            peer = null
            socket = null
            remoteDescriptionReady = false
            queuedCandidates.clear()
        }
        releaseTransport(oldChannel, oldPeer, oldSocket)
        val rtcConfig =
            PeerConnection.RTCConfiguration(
                listOf(PeerConnection.IceServer.builder(STUN_URL).createIceServer())
            )
        val createdPeer =
            factory.createPeerConnection(rtcConfig, PeerObserver(ready))
                ?: run {
                    ready.completeExceptionally(IOException("WebRTCを初期化できません"))
                    return
                }
        synchronized(lock) { peer = createdPeer }
        val request =
            Request.Builder()
                .url("${config.endpoint}/${config.room}?role=client")
                .header("Authorization", "Bearer ${config.secret}")
                .build()
        socket = http.newWebSocket(request, SignalListener(ready))
    }

    private inner class SignalListener(private val ready: CompletableFuture<DataChannel>) :
        WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isCurrentConnection(ready)) return
            runCatching {
                    val message = YuraiveJson.format.parseToJsonElement(text).jsonObject
                    when (message["type"]?.jsonPrimitive?.contentOrNull) {
                        "offer" -> applyOffer(message["sdp"]!!.jsonPrimitive.content, ready)
                        "candidate" -> {
                            val candidate =
                                IceCandidate(
                                    message["sdpMid"]?.jsonPrimitive?.contentOrNull ?: "0",
                                    message["sdpMLineIndex"]?.jsonPrimitive?.int ?: 0,
                                    message["candidate"]!!.jsonPrimitive.content,
                                )
                            synchronized(lock) {
                                if (!closed && connection === ready) {
                                    if (remoteDescriptionReady) peer?.addIceCandidate(candidate)
                                    else queuedCandidates += candidate
                                }
                            }
                        }
                        "peer_left" -> failConnection(ready, IOException("Windowsとの接続が閉じられました"))
                    }
                }
                .onFailure { failConnection(ready, it) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            failConnection(ready, t)
    }

    private fun applyOffer(sdp: String, ready: CompletableFuture<DataChannel>) {
        val current =
            synchronized(lock) { peer.takeIf { !closed && connection === ready } } ?: return
        current.setRemoteDescription(
            object : SimpleSdpObserver() {
                override fun onSetSuccess() {
                    if (!isCurrentConnection(ready)) return
                    synchronized(lock) {
                        if (closed || connection !== ready || peer !== current) return
                        remoteDescriptionReady = true
                        queuedCandidates.forEach(current::addIceCandidate)
                        queuedCandidates.clear()
                    }
                    current.createAnswer(
                        object : SimpleSdpObserver() {
                            override fun onCreateSuccess(description: SessionDescription) {
                                if (!isCurrentConnection(ready)) return
                                current.setLocalDescription(
                                    object : SimpleSdpObserver() {
                                        override fun onSetSuccess() {
                                            sendSignal(
                                                ready,
                                                buildJsonObject {
                                                    put("type", "answer")
                                                    put("sdp", description.description)
                                                },
                                            )
                                        }

                                        override fun onSetFailure(error: String) =
                                            failConnection(ready, IOException(error))
                                    },
                                    description,
                                )
                            }

                            override fun onCreateFailure(error: String) =
                                failConnection(ready, IOException(error))
                        },
                        org.webrtc.MediaConstraints(),
                    )
                }

                override fun onSetFailure(error: String) = failConnection(ready, IOException(error))
            },
            SessionDescription(SessionDescription.Type.OFFER, sdp),
        )
    }

    private inner class PeerObserver(private val ready: CompletableFuture<DataChannel>) :
        PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            sendSignal(
                ready,
                buildJsonObject {
                    put("type", "candidate")
                    put("candidate", candidate.sdp)
                    put("sdpMid", candidate.sdpMid ?: "0")
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                },
            )
        }

        override fun onDataChannel(value: DataChannel) {
            val accepted =
                synchronized(lock) {
                    if (closed || connection !== ready) false
                    else {
                        channel = value
                        true
                    }
                }
            if (!accepted) {
                releaseTransport(value, null, null)
                return
            }
            value.registerObserver(
                object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) = Unit

                    override fun onStateChange() {
                        if (value.state() == DataChannel.State.OPEN) {
                            publishConnected(ready, value)
                        }
                        if (value.state() == DataChannel.State.CLOSED) {
                            failConnection(ready, IOException("Windowsとのデータ接続が閉じられました"))
                        }
                    }

                    override fun onMessage(buffer: DataChannel.Buffer) = receiveData(buffer)
                }
            )
            if (value.state() == DataChannel.State.OPEN) {
                publishConnected(ready, value)
            }
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED -> Unit
                PeerConnection.PeerConnectionState.DISCONNECTED,
                PeerConnection.PeerConnectionState.FAILED,
                PeerConnection.PeerConnectionState.CLOSED -> {
                    failConnection(ready, IOException("WindowsとのP2P接続に失敗しました"))
                }
                else -> Unit
            }
        }

        override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit

        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) = Unit

        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit

        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit

        override fun onAddStream(stream: MediaStream) = Unit

        override fun onRemoveStream(stream: MediaStream) = Unit

        override fun onRenegotiationNeeded() = Unit

        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = Unit
    }

    private fun receiveData(buffer: DataChannel.Buffer) {
        val bytes = ByteArray(buffer.data.remaining())
        buffer.data.get(bytes)
        if (buffer.binary) {
            if (bytes.size < 40) return
            val id = bytes.copyOfRange(0, 32).toString(Charsets.US_ASCII)
            val total = ByteBuffer.wrap(bytes, 32, 8).order(ByteOrder.BIG_ENDIAN).long
            pending.remove(id)?.complete(PeerReply.Binary(bytes.copyOfRange(40, bytes.size), total))
        } else {
            runCatching {
                val value =
                    YuraiveJson.format.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject
                val id = value["id"]!!.jsonPrimitive.content
                if (value["ok"]?.jsonPrimitive?.booleanOrNull != true) {
                    pending
                        .remove(id)
                        ?.completeExceptionally(
                            IOException(
                                value["error"]?.jsonPrimitive?.contentOrNull
                                    ?: "Windowsで読み込みに失敗しました"
                            )
                        )
                } else pending.remove(id)?.complete(PeerReply.Json(value))
            }
        }
    }

    private fun sendSignal(ready: CompletableFuture<DataChannel>, value: JsonObject) {
        val currentSocket = synchronized(lock) { socket.takeIf { !closed && connection === ready } }
        currentSocket?.send(value.toString())
    }

    private fun isCurrentConnection(ready: CompletableFuture<DataChannel>): Boolean =
        synchronized(lock) { !closed && connection === ready }

    private fun publishConnected(ready: CompletableFuture<DataChannel>, value: DataChannel) {
        val status =
            synchronized(lock) {
                if (
                    closed ||
                        connection !== ready ||
                        channel !== value ||
                        value.state() != DataChannel.State.OPEN
                ) {
                    null
                } else if (activeRequests.get() > 0) {
                    WindowsConnectionStatus.LOADING
                } else {
                    WindowsConnectionStatus.CONNECTED
                }
            }
        if (status != null) {
            connectionChanged(status)
            ready.complete(value)
        }
    }

    private fun failCurrentConnection(error: Throwable) {
        val ready = synchronized(lock) { connection } ?: return
        failConnection(ready, error)
    }

    private fun failConnection(ready: CompletableFuture<DataChannel>, error: Throwable) {
        var oldChannel: DataChannel? = null
        var oldPeer: PeerConnection? = null
        var oldSocket: WebSocket? = null
        synchronized(lock) {
            if (closed || connection !== ready) return
            connectionChanged(WindowsConnectionStatus.OFFLINE)
            ready.completeExceptionally(error)
            pending.values.forEach { it.completeExceptionally(error) }
            pending.clear()
            oldChannel = channel
            oldPeer = peer
            oldSocket = socket
            channel = null
            peer = null
            socket = null
            connection = null
            remoteDescriptionReady = false
            queuedCandidates.clear()
        }
        releaseTransport(oldChannel, oldPeer, oldSocket)
    }

    fun close() {
        val error = IOException("Windowsとの接続は再読み込みされました")
        var oldChannel: DataChannel? = null
        var oldPeer: PeerConnection? = null
        var oldSocket: WebSocket? = null
        synchronized(lock) {
            if (closed) return
            closed = true
            connectionChanged(WindowsConnectionStatus.OFFLINE)
            connection?.completeExceptionally(error)
            pending.values.forEach { it.completeExceptionally(error) }
            pending.clear()
            oldChannel = channel
            oldPeer = peer
            oldSocket = socket
            channel = null
            peer = null
            socket = null
            connection = null
            remoteDescriptionReady = false
            queuedCandidates.clear()
        }
        releaseTransport(oldChannel, oldPeer, oldSocket)
    }

    companion object {
        private val factoryLock = Any()
        private val transportDisposer =
            Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "yuraive-webrtc-dispose").apply { isDaemon = true }
            }
        @Volatile private var sharedFactory: PeerConnectionFactory? = null

        private fun releaseTransport(
            channel: DataChannel?,
            peer: PeerConnection?,
            socket: WebSocket?,
        ) {
            if (channel == null && peer == null && socket == null) return
            transportDisposer.execute {
                runCatching { socket?.cancel() }
                runCatching { channel?.close() }
                runCatching { peer?.close() }
                runCatching { channel?.dispose() }
                runCatching { peer?.dispose() }
            }
        }

        private fun factory(context: Context): PeerConnectionFactory =
            sharedFactory
                ?: synchronized(factoryLock) {
                    sharedFactory
                        ?: run {
                            PeerConnectionFactory.initialize(
                                PeerConnectionFactory.InitializationOptions.builder(
                                        context.applicationContext
                                    )
                                    .setEnableInternalTracer(false)
                                    .createInitializationOptions()
                            )
                            PeerConnectionFactory.builder().createPeerConnectionFactory().also {
                                sharedFactory = it
                            }
                        }
                }

        private fun requestId(): String = UUID.randomUUID().toString().replace("-", "")
    }
}

private open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) = Unit

    override fun onSetSuccess() = Unit

    override fun onCreateFailure(error: String) = Unit

    override fun onSetFailure(error: String) = Unit
}

private class EncryptedWindowsRootStore(context: Context) {
    private val preferences = context.getSharedPreferences("windows_library", Context.MODE_PRIVATE)

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
        private const val KEY_ALIAS = "yuraive.windows-library.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

private const val SIGNALING_ENDPOINT = "wss://connect.yuraive.com/v1/rooms"
private const val STUN_URL = "stun:stun.cloudflare.com:3478"
