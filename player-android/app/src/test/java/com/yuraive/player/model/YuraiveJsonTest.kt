package com.yuraive.player.model

import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YuraiveJsonTest {
    @Test
    fun parsesV1GraphAndThumbnailExtension() {
        val graph = YuraiveJson.format.decodeFromString<YuraiveGraph>(
            """{"version":1,"metadata":{"displayName":"Rain","thumbnail":"cover.webp"},"nodes":{"start":{"type":"media","start":true,"terminal":true,"media":[]}},"buttons":{}}""",
        )
        assertEquals("Rain", graph.metadata?.displayName)
        assertEquals("cover.webp", graph.metadata?.thumbnail)
        assertEquals("start", graph.nodes.keys.single())
    }

    @Test
    fun parsesPlayerControlsAndSocialLinks() {
        val graph = YuraiveJson.format.decodeFromString<YuraiveGraph>(
            """{
              "version": 1,
              "metadata": {"contentId":"com.example.rain","socialLinks":[{"label":"Web","url":"https://example.com"}]},
              "nodes": {"start":{"type":"media","start":true,"terminal":true,"playerControl":"locked"}},
              "buttons": {},
              "globalPlayerControl": "default",
              "playerControls": {
                "default": {},
                "locked": {"accentColor":"#944BF8","allowStop":false,"showPlaybackTime":false,"allowSeek":false,"showFileName":true,"allowNext":true,"allowPrevious":true}
              },
              "playbackStats": {"path":"scripts/stats.star","function":"render_stats"}
            }""",
        )
        val control = graph.playerControls.getValue("locked")
        assertFalse(control.allowStop)
        assertFalse(control.showPlaybackTime)
        assertFalse(control.allowSeek)
        assertTrue(control.showSeekBar)
        assertTrue(control.showFileName)
        assertTrue(control.allowNext)
        assertTrue(control.allowPrevious)
        assertEquals("#944BF8", control.accentColor)
        assertEquals("com.example.rain", graph.metadata?.contentId)
        assertEquals("scripts/stats.star", graph.playbackStats?.path)
        assertEquals("Web", graph.metadata?.socialLinks?.single()?.label)
    }

    @Test
    fun graphTitleFallbackUsesContentFolderThenRootName() {
        assertEquals("sleep", GraphRef("content://root", "Library", "asmr/sleep/rain.yuraive.json").contentFolderName)
        assertEquals("Library", GraphRef("content://root", "Library", "rain.yuraive.json").contentFolderName)
        assertEquals(
            GraphRef("content://root", "Library", "rain.yuraive.json").graphId,
            GraphRef("content://root", "Library", "rain.yuraive").graphId,
        )
    }
}
