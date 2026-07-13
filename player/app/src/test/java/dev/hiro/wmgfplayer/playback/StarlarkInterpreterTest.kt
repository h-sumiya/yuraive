package dev.hiro.wmgfplayer.playback

import net.starlark.java.eval.Dict
import net.starlark.java.eval.Module
import net.starlark.java.eval.Mutability
import net.starlark.java.eval.Starlark
import net.starlark.java.eval.StarlarkSemantics
import net.starlark.java.eval.StarlarkThread
import net.starlark.java.syntax.FileOptions
import net.starlark.java.syntax.ParserInput
import org.junit.Assert.assertEquals
import org.junit.Test

class StarlarkInterpreterTest {
    @Test
    fun executesJumpWithJsonCompatibleContext() {
        Mutability.create("test").use { mutability ->
            val module = Module.withPredeclared(StarlarkSemantics.DEFAULT, emptyMap())
            val thread = StarlarkThread(mutability, StarlarkSemantics.DEFAULT).apply { setMaxExecutionSteps(10_000) }
            Starlark.execFile(
                ParserInput.fromString("def jump(ctx):\n  return ctx[\"target\"]\n", "route.star"),
                FileOptions.DEFAULT,
                module,
                thread,
            )
            val context = Dict.copyOf<String, Any>(mutability, mapOf("target" to "ending"))
            val result = Starlark.call(thread, module.getGlobal("jump"), listOf(context), emptyMap())
            assertEquals("ending", result)
        }
    }
}
