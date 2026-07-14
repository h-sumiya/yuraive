package dev.hiro.wmgfplayer.playback

import dev.hiro.wmgfplayer.data.DocumentLibrary
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.ScriptCall
import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

class StarlarkRuntime(private val library: DocumentLibrary) {
    suspend fun run(
        ref: GraphRef,
        call: ScriptCall,
        defaultFunction: String,
        context: JsonObject,
        timeoutMs: Long,
        loadedScripts: Map<String, String>? = null,
    ): JsonElement {
        val scripts = loadedScripts ?: library.readScriptSources(ref, call.path)
        val request = NativeStarlarkRequest(
            path = call.path,
            functionName = call.function?.takeIf(String::isNotBlank) ?: defaultFunction,
            args = listOf(context),
            scripts = scripts,
            timeoutMs = timeoutMs.coerceIn(100, 10_000),
        )
        return withContext(Dispatchers.Default) {
            val response = WmgJson.format.decodeFromString<NativeStarlarkResponse>(
                NativeStarlarkEngine.run(WmgJson.format.encodeToString(request)),
            )
            response.error?.let(::error)
            response.value ?: JsonNull
        }
    }
}

@Serializable
private data class NativeStarlarkRequest(
    val path: String,
    val functionName: String,
    val args: List<JsonElement>,
    val scripts: Map<String, String>,
    val timeoutMs: Long,
)

@Serializable
private data class NativeStarlarkResponse(
    val value: JsonElement? = null,
    val prints: List<String> = emptyList(),
    val error: String? = null,
)

private object NativeStarlarkEngine {
    init { System.loadLibrary("wmgf_runtime") }

    fun run(requestJson: String): String = runJsonNative(requestJson)

    private external fun runJsonNative(requestJson: String): String
}
