package dev.hiro.wmgfplayer

import android.app.Application
import dev.hiro.wmgfplayer.data.DocumentLibrary
import dev.hiro.wmgfplayer.data.HistoryStore
import dev.hiro.wmgfplayer.data.SettingsStore
import dev.hiro.wmgfplayer.data.SnapshotStore

class WmgfApplication : Application() {
    val settings by lazy { SettingsStore(this) }
    val library by lazy { DocumentLibrary(this) }
    val history by lazy { HistoryStore(this) }
    val snapshots by lazy { SnapshotStore(this) }
}
