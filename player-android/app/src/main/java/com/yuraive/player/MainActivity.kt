package com.yuraive.player

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
import com.yuraive.player.playback.PlaybackRuntime
import com.yuraive.player.ui.YuraiveApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val openTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@registerForActivityResult
        runCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val name = DocumentFile.fromTreeUri(this, uri)?.name ?: "フォルダ"
        (application as YuraiveApplication).library.addRoot(uri, name)
    }

    private val createHistory = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-ndjson")) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val text = (application as YuraiveApplication).history.exportJsonl()
            contentResolver.openOutputStream(uri, "wt")?.bufferedWriter(Charsets.UTF_8)?.use { it.write(text) }
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PlaybackRuntime.initialize(this)
        setContent {
            YuraiveApp(
                addFolder = { openTree.launch(null) },
                exportHistory = { createHistory.launch("yuraive-history.jsonl") },
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
