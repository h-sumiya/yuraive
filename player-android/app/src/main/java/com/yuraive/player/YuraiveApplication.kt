package com.yuraive.player

import android.app.Application
import com.yuraive.player.data.DocumentLibrary
import com.yuraive.player.data.HistoryStore
import com.yuraive.player.data.SettingsStore
import com.yuraive.player.playback.PlaybackStatsEvaluator
import com.yuraive.player.data.SnapshotStore

class YuraiveApplication : Application() {
    val settings by lazy { SettingsStore(this) }
    val library by lazy { DocumentLibrary(this) }
    val history by lazy { HistoryStore(this) }
    val playbackStats by lazy { PlaybackStatsEvaluator(library, history, settings) }
    val snapshots by lazy { SnapshotStore(this) }
}
