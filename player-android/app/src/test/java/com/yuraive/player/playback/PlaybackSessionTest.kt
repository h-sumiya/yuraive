package com.yuraive.player.playback

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSessionTest {
    @Test
    fun returningToTheSameMediaCreatesANewPlatformItem() {
        val firstA = playbackItemId("run-a", 1, "root::a.yuraive.json", "start", "voice")
        val b = playbackItemId("run-b", 1, "root::b.yuraive.json", "start", "voice")
        val secondA = playbackItemId("run-c", 1, "root::a.yuraive.json", "start", "voice")

        assertNotEquals(firstA, b)
        assertNotEquals(firstA, secondA)
        assertTrue(secondA.endsWith("root::a.yuraive.json#start/voice"))
    }

    @Test
    fun revisitingMediaWithinOneRunCreatesANewPlatformItem() {
        val first = playbackItemId("run-a", 1, "root::story.yuraive.json", "scene-a", "voice")
        val second = playbackItemId("run-a", 3, "root::story.yuraive.json", "scene-a", "voice")

        assertNotEquals(first, second)
    }
}
