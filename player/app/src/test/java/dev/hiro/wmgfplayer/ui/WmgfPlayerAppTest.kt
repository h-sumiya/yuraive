package dev.hiro.wmgfplayer.ui

import dev.hiro.wmgfplayer.model.PlaybackHistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WmgfPlayerAppTest {
    @Test
    fun buildPlaybackSessionsAggregatesRunsAndSortsNewestFirst() {
        val entries = listOf(
            historyEntry("a-2", "run-a", "graph-a", "2026-07-14T01:02:00Z", "2026-07-14T01:03:00Z", 20_000, "stopped"),
            historyEntry("b-1", "run-b", "graph-b", "2026-07-14T02:00:00Z", "2026-07-14T02:01:00Z", 30_000, "completed"),
            historyEntry("a-1", "run-a", "graph-a", "2026-07-14T01:00:00Z", "2026-07-14T01:01:00Z", 10_000, "completed"),
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

    private fun historyEntry(
        id: String,
        runId: String,
        graphId: String,
        startedAt: String,
        endedAt: String,
        activePlayMs: Long,
        endReason: String,
    ) = PlaybackHistoryEntry(
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
