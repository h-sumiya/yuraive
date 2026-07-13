package dev.hiro.wmgfplayer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import dev.hiro.wmgfplayer.playback.PlaybackRuntime
import dev.hiro.wmgfplayer.ui.WmgfPlayerApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val openTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@registerForActivityResult
        runCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val name = DocumentFile.fromTreeUri(this, uri)?.name ?: "フォルダ"
        (application as WmgfApplication).library.addRoot(uri, name)
    }

    private val createHistory = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-ndjson")) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val text = (application as WmgfApplication).history.exportJsonl()
            contentResolver.openOutputStream(uri, "wt")?.bufferedWriter(Charsets.UTF_8)?.use { it.write(text) }
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PlaybackRuntime.initialize(this)
        setContent {
            WmgfPlayerApp(
                addFolder = { openTree.launch(null) },
                exportHistory = { createHistory.launch("wmgf-history.jsonl") },
                ensureNotificationPermission = ::ensureNotificationPermission,
            )
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
