package com.yuraive.player.data

import com.yuraive.player.model.MediaCandidate
import com.yuraive.player.model.PlayerControlSettings
import com.yuraive.player.model.ScriptCall
import com.yuraive.player.model.YuraiveGraph
import com.yuraive.player.model.YuraiveMediaSource
import com.yuraive.player.model.YuraiveNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentLibraryInspectionTest {
    private val graph = YuraiveGraph(
        version = 1,
        nodes = mapOf(
            "start" to YuraiveNode(
                type = "media",
                start = true,
                media = listOf(MediaCandidate("rain", 1.0, YuraiveMediaSource(type = "audio", audio = "audio/rain.ogg"))),
            ),
            "route" to YuraiveNode(type = "script", script = ScriptCall("scripts/route.star")),
        ),
        buttons = emptyMap(),
        playerControls = mapOf("default" to PlayerControlSettings(layout = "ui/default.yuraive-layout.html")),
    )

    @Test
    fun jsonAcceptsReferencedFilesFromTheContentFolder() {
        val assets = inspectGraphAssets(graph, isBundle = false, embeddedPaths = emptySet()) { true }

        assertTrue(assets.all(LibraryAssetInspection::recognized))
        assertTrue(assets.none(LibraryAssetInspection::embedded))
    }

    @Test
    fun bundleRequiresScriptsAndLayoutsToBeEmbedded() {
        val assets = inspectGraphAssets(
            graph,
            isBundle = true,
            embeddedPaths = setOf("scripts/route.star"),
        ) { true }.associateBy(LibraryAssetInspection::path)

        assertTrue(assets.getValue("audio/rain.ogg").recognized)
        assertTrue(assets.getValue("scripts/route.star").embedded)
        assertFalse(assets.getValue("ui/default.yuraive-layout.html").recognized)
        assertEquals(AssetInspectionProblem.MISSING, assets.getValue("ui/default.yuraive-layout.html").problem)
    }
}
