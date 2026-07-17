@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.yuraive.player.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.RawRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yuraive.player.R

internal data class OpenSourceNotice(
    val name: String,
    val version: String,
    val license: String,
    @RawRes val licenseTextResources: List<Int>,
)

internal val openSourceNotices =
    listOf(
        OpenSourceNotice(
            "AndroidX・Jetpack Compose",
            "Compose BOM 2025.04.01",
            "Apache-2.0",
            listOf(R.raw.license_apache_2_0),
        ),
        OpenSourceNotice("Kotlin", "2.1.20", "Apache-2.0", listOf(R.raw.license_apache_2_0)),
        OpenSourceNotice(
            "kotlinx.coroutines",
            "1.10.2",
            "Apache-2.0",
            listOf(R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "kotlinx.serialization",
            "1.8.1",
            "Apache-2.0",
            listOf(R.raw.license_apache_2_0),
        ),
        OpenSourceNotice("OkHttp", "5.4.0", "Apache-2.0", listOf(R.raw.license_apache_2_0)),
        OpenSourceNotice("SMBJ", "0.14.0", "Apache-2.0", listOf(R.raw.license_apache_2_0)),
        OpenSourceNotice(
            "ZXing Android Embedded",
            "4.3.0",
            "Apache-2.0",
            listOf(R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "WebRTC Android SDK",
            "144.7559.09",
            "BSD-3-Clause",
            listOf(R.raw.license_bsd_3_clause_webrtc),
        ),
        OpenSourceNotice("SLF4J", "2.0.17", "MIT", listOf(R.raw.license_mit_slf4j)),
        OpenSourceNotice("Starlark Rust", "0.14.2", "Apache-2.0", listOf(R.raw.license_apache_2_0)),
        OpenSourceNotice("Taffy", "0.12.1", "MIT", listOf(R.raw.license_mit_taffy)),
        OpenSourceNotice(
            "anyhow",
            "1.0.103",
            "MIT OR Apache-2.0",
            listOf(R.raw.license_mit, R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "fastrand",
            "2.4.1",
            "Apache-2.0 OR MIT",
            listOf(R.raw.license_apache_2_0, R.raw.license_mit),
        ),
        OpenSourceNotice(
            "jni",
            "0.21.1",
            "MIT OR Apache-2.0",
            listOf(R.raw.license_mit, R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "serde",
            "1.0.228",
            "MIT OR Apache-2.0",
            listOf(R.raw.license_mit, R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "serde_json",
            "1.0.150",
            "MIT OR Apache-2.0",
            listOf(R.raw.license_mit, R.raw.license_apache_2_0),
        ),
        OpenSourceNotice(
            "unicode-width",
            "0.2.2",
            "MIT OR Apache-2.0",
            listOf(R.raw.license_mit, R.raw.license_apache_2_0),
        ),
    )

@Composable
internal fun LicensesScreen(modifier: Modifier, onBack: () -> Unit) {
    var selectedName by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedNotice = openSourceNotices.firstOrNull { it.name == selectedName }
    val navigateBack = { if (selectedNotice == null) onBack() else selectedName = null }

    BackHandler(enabled = selectedNotice != null) { selectedName = null }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (selectedNotice == null) "ライセンス" else "ライセンス詳細",
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = navigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (selectedNotice == null) {
                LicenseList(
                    modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth(),
                    onSelect = { selectedName = it.name },
                )
            } else {
                LicenseDetail(
                    notice = selectedNotice,
                    modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun LicenseList(modifier: Modifier, onSelect: (OpenSourceNotice) -> Unit) {
    val bottomContentPadding =
        12.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    LazyColumn(
        modifier.fillMaxHeight(),
        contentPadding =
            androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp,
                top = 12.dp,
                end = 20.dp,
                bottom = bottomContentPadding,
            ),
    ) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "Yuraive",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "Copyright © 2026 h-sumiya. All rights reserved.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text(
                "オープンソースソフトウェア",
                Modifier.padding(top = 24.dp, bottom = 8.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        items(openSourceNotices, key = OpenSourceNotice::name) { notice ->
            Row(
                Modifier.fillMaxWidth().clickable { onSelect(notice) }.padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(notice.name, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${notice.version} · ${notice.license}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    "ライセンス詳細を開く",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun LicenseDetail(notice: OpenSourceNotice, modifier: Modifier) {
    val resources = LocalContext.current.resources
    val bottomContentPadding =
        20.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val licenseText =
        remember(notice) {
            notice.licenseTextResources.joinToString("\n\n────────────────────\n\n") { resourceId ->
                resources.openRawResource(resourceId).bufferedReader().use { it.readText() }
            }
        }

    LazyColumn(
        modifier.fillMaxHeight(),
        contentPadding =
            androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp,
                top = 20.dp,
                end = 20.dp,
                bottom = bottomContentPadding,
            ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    notice.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "${notice.version} · ${notice.license}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            Text(
                licenseText,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}
