package dev.hiro.wmgfplayer.model

import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WmgJsonTest {
    @Test
    fun parsesV1GraphAndThumbnailExtension() {
        val graph = WmgJson.format.decodeFromString<WmgGraph>(
            """{"version":1,"metadata":{"displayName":"Rain","thumbnail":"cover.webp"},"nodes":{"start":{"type":"media","start":true,"terminal":true,"media":[]}},"buttons":{}}""",
        )
        assertEquals("Rain", graph.metadata?.displayName)
        assertEquals("cover.webp", graph.metadata?.thumbnail)
        assertEquals("start", graph.nodes.keys.single())
    }

    @Test
    fun parsesPlayerControlsAndSocialLinks() {
        val graph = WmgJson.format.decodeFromString<WmgGraph>(
            """{
              "version": 1,
              "metadata": {"socialLinks":[{"label":"Web","url":"https://example.com"}]},
              "nodes": {"start":{"type":"media","start":true,"terminal":true,"playerControl":"locked"}},
              "buttons": {},
              "globalPlayerControl": "default",
              "playerControls": {
                "default": {},
                "locked": {"allowStop":false,"showPlaybackTime":false,"allowSeek":false,"showFileName":true,"allowNext":true,"allowPrevious":true}
              }
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
        assertEquals("Web", graph.metadata?.socialLinks?.single()?.label)
    }

    @Test
    fun graphTitleFallbackUsesContentFolderThenRootName() {
        assertEquals("sleep", GraphRef("content://root", "Library", "asmr/sleep/rain.wmg.json").contentFolderName)
        assertEquals("Library", GraphRef("content://root", "Library", "rain.wmg.json").contentFolderName)
    }
}
