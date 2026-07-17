package com.yuraive.player.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GraphValidatorTest {
    @Test
    fun weightedChoiceHonorsBoundariesAndSkipsZero() {
        val items = listOf(Transition("never", 0.0), Transition("a", 1.0), Transition("b", 3.0))
        assertEquals("a", chooseWeighted(items, Transition::weight, 0.0)?.to)
        assertEquals("a", chooseWeighted(items, Transition::weight, 0.249)?.to)
        assertEquals("b", chooseWeighted(items, Transition::weight, 0.25)?.to)
        assertEquals("b", chooseWeighted(items, Transition::weight, 0.999)?.to)
    }

    @Test
    fun safePathsRejectEscapesAndUrls() {
        assertTrue(GraphValidator.isSafeRelativePath("audio/rain.ogg"))
        assertFalse(GraphValidator.isSafeRelativePath("../secret.mp3"))
        assertFalse(GraphValidator.isSafeRelativePath("https://example.com/a.mp3"))
        assertFalse(GraphValidator.isSafeRelativePath("/sdcard/a.mp3"))
        assertFalse(GraphValidator.isSafeRelativePath("audio\\rain.ogg"))
        assertFalse(GraphValidator.isSafeRelativePath("audio/./rain.ogg"))
    }
}
