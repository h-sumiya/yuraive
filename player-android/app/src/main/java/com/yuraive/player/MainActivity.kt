package com.yuraive.player

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.yuraive.player.playback.PlaybackRuntime
import com.yuraive.player.ui.YuraiveApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val openTree =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri == null) return@registerForActivityResult
            runCatching {
                contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            val name = DocumentFile.fromTreeUri(this, uri)?.name ?: "フォルダ"
            (application as YuraiveApplication).library.addRoot(uri, name)
        }

    private val createHistory =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-ndjson")) {
            uri ->
            if (uri == null) return@registerForActivityResult
            lifecycleScope.launch {
                val text = (application as YuraiveApplication).history.exportJsonl()
                contentResolver.openOutputStream(uri, "wt")?.bufferedWriter(Charsets.UTF_8)?.use {
                    it.write(text)
                }
            }
        }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private val scanWindows =
        registerForActivityResult(ScanContract()) { result ->
            val payload = result.contents ?: return@registerForActivityResult
            pairWindowsLibrary(payload)
        }

    private fun pairWindowsLibrary(payload: String) {
        lifecycleScope.launch {
            runCatching { (application as YuraiveApplication).library.addWindowsLibrary(payload) }
                .onSuccess {
                    Toast.makeText(this@MainActivity, "Windowsのライブラリを追加しました", Toast.LENGTH_SHORT)
                        .show()
                }
                .onFailure { error ->
                    Toast.makeText(
                            this@MainActivity,
                            error.message ?: "Windowsに接続できませんでした",
                            Toast.LENGTH_LONG,
                        )
                        .show()
                }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PlaybackRuntime.initialize(this)
        setContent {
            YuraiveApp(
                addFolder = { openTree.launch(null) },
                pairWindows = ::scanWindowsLibrary,
                exportHistory = { createHistory.launch("yuraive-history.jsonl") },
                ensureNotificationPermission = ::ensureNotificationPermission,
            )
        }
        intent?.dataString?.takeIf { it.startsWith("yuraive://pair?") }?.let(::pairWindowsLibrary)
    }

    private fun scanWindowsLibrary() {
        scanWindows.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Windows版Yuraiveに表示されたQRコードを読み取ります")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
        )
    }

    private fun ensureNotificationPermission() {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
