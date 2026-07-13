package dev.hiro.wmgfplayer.playback

import dev.hiro.wmgfplayer.data.DocumentLibrary
import dev.hiro.wmgfplayer.model.GraphRef
import dev.hiro.wmgfplayer.model.ScriptCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.starlark.java.eval.Dict
import net.starlark.java.eval.Module
import net.starlark.java.eval.Mutability
import net.starlark.java.eval.Sequence
import net.starlark.java.eval.Starlark
import net.starlark.java.eval.StarlarkFloat
import net.starlark.java.eval.StarlarkInt
import net.starlark.java.eval.StarlarkList
import net.starlark.java.eval.StarlarkSemantics
import net.starlark.java.eval.StarlarkThread
import net.starlark.java.syntax.FileOptions
import net.starlark.java.syntax.ParserInput
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class StarlarkRuntime(private val library: DocumentLibrary) {
    private val executor = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "wmgf-starlark").apply { isDaemon = true }
    }

    suspend fun run(ref: GraphRef, call: ScriptCall, defaultFunction: String, context: JsonObject, timeoutMs: Long): JsonElement {
        val source = library.readAssetText(ref, call.path)
        return withContext(Dispatchers.IO) {
            val task = executor.submit<JsonElement> {
                Mutability.create("wmgf:${call.path}").use { mutability ->
                    val thread = StarlarkThread(mutability, StarlarkSemantics.DEFAULT).apply {
                        setMaxExecutionSteps(2_000_000)
                        setPrintHandler { _, _ -> Unit }
                    }
                    val module = Module.withPredeclared(StarlarkSemantics.DEFAULT, emptyMap())
                    Starlark.execFile(
                        ParserInput.fromString(source, call.path),
                        FileOptions.DEFAULT,
                        module,
                        thread,
                    )
                    val functionName = call.function?.takeIf(String::isNotBlank) ?: defaultFunction
                    val function = module.getGlobal(functionName) ?: error("${call.path} に $functionName() がありません")
                    val value = Starlark.call(thread, function, listOf(toStarlark(context, mutability)), emptyMap())
                    fromStarlark(value)
                }
            }
            try {
                task.get(timeoutMs.coerceIn(100, 10_000), TimeUnit.MILLISECONDS)
            } catch (_: TimeoutException) {
                task.cancel(true)
                error("Starlark の実行が ${timeoutMs}ms を超えたため停止しました")
            } catch (error: ExecutionException) {
                throw IllegalStateException(error.cause?.message ?: "Starlark の実行に失敗しました", error.cause)
            }
        }
    }

    private fun toStarlark(value: JsonElement, mutability: Mutability): Any = when (value) {
        JsonNull -> Starlark.NONE
        is JsonObject -> Dict.copyOf(mutability, value.mapValues { toStarlark(it.value, mutability) })
        is JsonArray -> StarlarkList.copyOf(mutability, value.map { toStarlark(it, mutability) })
        is JsonPrimitive -> when {
            value.isString -> value.content
            value.booleanOrNull != null -> value.booleanOrNull!!
            value.longOrNull != null -> StarlarkInt.of(value.longOrNull!!)
            value.doubleOrNull != null -> StarlarkFloat.of(value.doubleOrNull!!)
            else -> value.content
        }
    }

    private fun fromStarlark(value: Any?): JsonElement = when (value) {
        null, Starlark.NONE -> JsonNull
        is String -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is StarlarkInt -> JsonPrimitive(value.toBigInteger())
        is StarlarkFloat -> JsonPrimitive(value.toDouble())
        is Dict<*, *> -> JsonObject(value.entries.associate { (key, child) -> key.toString() to fromStarlark(child) })
        is Sequence<*> -> JsonArray(value.map(::fromStarlark))
        else -> error("Starlark が JSON 互換ではない ${Starlark.type(value)} を返しました")
    }
}
