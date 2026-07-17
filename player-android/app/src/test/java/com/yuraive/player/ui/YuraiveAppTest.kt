package com.yuraive.player.ui

import com.yuraive.player.model.PlaybackHistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YuraiveAppTest {
    @Test
    fun buildPlaybackSessionsAggregatesRunsAndSortsNewestFirst() {
        val entries =
            listOf(
                historyEntry(
                    "a-2",
                    "run-a",
                    "graph-a",
                    "2026-07-14T01:02:00Z",
                    "2026-07-14T01:03:00Z",
                    20_000,
                    "stopped",
                ),
                historyEntry(
                    "b-1",
                    "run-b",
                    "graph-b",
                    "2026-07-14T02:00:00Z",
                    "2026-07-14T02:01:00Z",
                    30_000,
                    "completed",
                ),
                historyEntry(
                    "a-1",
                    "run-a",
                    "graph-a",
                    "2026-07-14T01:00:00Z",
                    "2026-07-14T01:01:00Z",
                    10_000,
                    "completed",
                ),
            )

        val sessions = buildPlaybackSessions(entries)

        assertEquals(listOf("run-b", "run-a"), sessions.map(PlaybackSession::runId))
        assertEquals(30_000L, sessions[0].activePlayMs)
        assertTrue(sessions[0].completed)
        assertEquals(30_000L, sessions[1].activePlayMs)
        assertFalse(sessions[1].completed)
        assertEquals("2026-07-14T01:00:00Z", sessions[1].startedAt)
        assertEquals("2026-07-14T01:03:00Z", sessions[1].endedAt)
    }

    @Test
    fun directoryPathChainBuildsBrowsableParents() {
        assertEquals(listOf(""), directoryPathChain(""))
        assertEquals(listOf("", "category", "category/work"), directoryPathChain("category/work"))
    }

    @Test
    fun adaptiveGridAddsColumnsAtTabletBreakpoints() {
        assertEquals(2, adaptiveGridColumnCount(411))
        assertEquals(3, adaptiveGridColumnCount(600))
        assertEquals(4, adaptiveGridColumnCount(840))
        assertEquals(5, adaptiveGridColumnCount(1_200))
    }

    @Test
    fun playerUsesTwoPanesOnlyWhenTheViewportIsWide() {
        assertFalse(isTwoPanePlayerLayout(widthDp = 411, heightDp = 891))
        assertTrue(isTwoPanePlayerLayout(widthDp = 891, heightDp = 411))
        assertFalse(isTwoPanePlayerLayout(widthDp = 800, heightDp = 1_280))
        assertTrue(isTwoPanePlayerLayout(widthDp = 1_280, heightDp = 800))
    }

    private fun historyEntry(
        id: String,
        runId: String,
        graphId: String,
        startedAt: String,
        endedAt: String,
        activePlayMs: Long,
        endReason: String,
    ) =
        PlaybackHistoryEntry(
            id = id,
            runId = runId,
            graphId = graphId,
            nodeId = "node",
            mediaId = "media",
            startedAt = startedAt,
            endedAt = endedAt,
            mediaDurationMs = 60_000,
            activePlayMs = activePlayMs,
            startPositionMs = 0,
            endPositionMs = activePlayMs,
            endReason = endReason,
        )
}
