@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import androidx.core.graphics.*
import androidx.media3.ui.*
import com.yuraive.player.data.*
import com.yuraive.player.model.*
import com.yuraive.player.playback.*
import java.time.*
import java.time.format.DateTimeFormatter
import kotlin.math.*
import kotlinx.coroutines.*

@Composable
internal fun SettingsScreen(
    modifier: Modifier,
    settings: PlayerSettings,
    update: ((PlayerSettings) -> PlayerSettings) -> Unit,
    onBack: () -> Unit,
    openLicenses: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    val bottomContentPadding =
        20.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("設定", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
                },
            )
        },
    ) { padding ->
        CenteredContent(
            modifier = Modifier.fillMaxSize().padding(padding),
            maxContentWidth = MaxSettingsContentWidth,
        ) { listModifier ->
            LazyColumn(
                listModifier,
                contentPadding =
                    androidx.compose.foundation.layout.PaddingValues(
                        start = 20.dp,
                        top = 20.dp,
                        end = 20.dp,
                        bottom = bottomContentPadding,
                    ),
                verticalArrangement = Arrangement.spacedBy(26.dp),
            ) {
                item {
                    SettingGroup("テーマ") {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            listOf(
                                    ThemeMode.SYSTEM to Icons.Default.Settings,
                                    ThemeMode.LIGHT to Icons.Default.LightMode,
                                    ThemeMode.DARK to Icons.Default.DarkMode,
                                )
                                .forEach { (mode, icon) ->
                                    val selected = settings.themeMode == mode
                                    Surface(
                                        onClick = { update { it.copy(themeMode = mode) } },
                                        modifier = Modifier.weight(1f).height(112.dp),
                                        shape = RoundedCornerShape(18.dp),
                                        color =
                                            if (selected)
                                                MaterialTheme.colorScheme.secondaryContainer
                                            else MaterialTheme.colorScheme.surfaceContainer,
                                        border =
                                            androidx.compose.foundation.BorderStroke(
                                                if (selected) 2.dp else 1.dp,
                                                if (selected) MaterialTheme.colorScheme.primary
                                                else MaterialTheme.colorScheme.outlineVariant,
                                            ),
                                    ) {
                                        Column(
                                            Modifier.fillMaxSize().padding(8.dp),
                                            horizontalAlignment = Alignment.CenterHorizontally,
                                            verticalArrangement = Arrangement.Center,
                                        ) {
                                            Icon(
                                                if (selected) Icons.Default.Check else icon,
                                                null,
                                                Modifier.size(28.dp),
                                                tint =
                                                    if (selected)
                                                        MaterialTheme.colorScheme
                                                            .onSecondaryContainer
                                                    else MaterialTheme.colorScheme.primary,
                                            )
                                            Spacer(Modifier.height(8.dp))
                                            Text(
                                                when (mode) {
                                                    ThemeMode.SYSTEM -> "システム"
                                                    ThemeMode.LIGHT -> "ライト"
                                                    ThemeMode.DARK -> "ダーク"
                                                },
                                                style = MaterialTheme.typography.labelLarge,
                                                maxLines = 1,
                                            )
                                        }
                                    }
                                }
                        }
                    }
                }
                item {
                    SettingGroup("アクセント") {
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            accents.forEachIndexed { index, color ->
                                Surface(
                                    shape = CircleShape,
                                    color = color,
                                    modifier =
                                        Modifier.size(42.dp)
                                            .border(
                                                if (settings.accentIndex == index) 3.dp else 0.dp,
                                                MaterialTheme.colorScheme.onSurface,
                                                CircleShape,
                                            )
                                            .clickable { update { it.copy(accentIndex = index) } },
                                ) {
                                    if (settings.accentIndex == index)
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(Icons.Default.Check, null, tint = Color.White)
                                        }
                                }
                            }
                        }
                    }
                }
                item {
                    SettingGroup("プレイヤーコントロール") {
                        SettingSwitchRow(
                            title = "すべて表示・許可",
                            description = "作品側の表示・操作制限を一時的に無視します",
                            checked = settings.forceShowPlayerControls,
                            onCheckedChange = { enabled ->
                                update { it.copy(forceShowPlayerControls = enabled) }
                            },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SettingSwitchRow(
                            title = "画面を消灯しない",
                            description = "再生画面を表示している間、画面を点灯したままにします",
                            checked = settings.keepScreenOnInPlayer,
                            onCheckedChange = { enabled ->
                                update { it.copy(keepScreenOnInPlayer = enabled) }
                            },
                        )
                    }
                }
                item {
                    SettingGroup("スクリプトのタイムアウト") {
                        Text(
                            "${settings.scriptTimeoutMs} ms",
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Slider(
                            value = settings.scriptTimeoutMs.toFloat(),
                            onValueChange = { value ->
                                update {
                                    it.copy(scriptTimeoutMs = (value / 100).roundToLong() * 100)
                                }
                            },
                            valueRange = 100f..5_000f,
                            steps = 48,
                        )
                    }
                }
                item {
                    SettingGroup("アプリについて") {
                        SettingLinkRow(title = "ライセンス", external = false, onClick = openLicenses)
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SettingLinkRow(
                            title = "GitHub",
                            external = true,
                            onClick = {
                                runCatching {
                                    uriHandler.openUri("https://github.com/h-sumiya/yuraive")
                                }
                            },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SettingLinkRow(
                            title = "お問い合わせ",
                            external = true,
                            onClick = {
                                runCatching { uriHandler.openUri("https://hiro.red/contact") }
                            },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SettingLinkRow(
                            title = "プライバシーポリシー",
                            external = true,
                            onClick = {
                                runCatching { uriHandler.openUri("https://yuraive.com/privacy/") }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun SettingLinkRow(title: String, external: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        Icon(
            if (external) Icons.AutoMirrored.Filled.OpenInNew
            else Icons.AutoMirrored.Filled.KeyboardArrowRight,
            if (external) "外部サイトで開く" else "開く",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun SettingSwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(
            Modifier.weight(1f).padding(end = 20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
internal fun SettingGroup(
    title: String,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
internal fun Artwork(
    uri: String?,
    modifier: Modifier,
    fallback: Boolean,
    scale: ContentScale = ContentScale.Crop,
    blurredCover: Boolean = false,
) {
    val context = LocalContext.current
    var bitmap by remember(uri) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(uri) {
        bitmap =
            if (uri == null) null
            else
                withContext(Dispatchers.IO) {
                    runCatching { DocumentImageCache.load(context, uri) }.getOrNull()
                }
    }
    Box(
        modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        val current = bitmap
        if (current != null) {
            if (blurredCover) {
                Image(
                    current.asImageBitmap(),
                    null,
                    Modifier.fillMaxSize().blur(20.dp),
                    contentScale = ContentScale.Crop,
                )
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .18f)))
                Image(
                    current.asImageBitmap(),
                    null,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
            } else {
                Image(current.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = scale)
            }
        } else if (fallback) {
            Icon(
                Icons.Default.PlayArrow,
                null,
                Modifier.size(32.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
internal fun YuraiveTheme(dark: Boolean, accent: Color, content: @Composable () -> Unit) {
    val base =
        if (dark) androidx.compose.material3.darkColorScheme()
        else androidx.compose.material3.lightColorScheme()
    val container =
        Color(
            ColorUtils.blendARGB(accent.toArgb(), base.surface.toArgb(), if (dark) .64f else .82f)
        )
    val scheme =
        base.copy(
            primary = accent,
            onPrimary = Color.White,
            primaryContainer = container,
            secondary = Color(ColorUtils.blendARGB(accent.toArgb(), base.secondary.toArgb(), .42f)),
        )
    MaterialTheme(colorScheme = scheme, content = content)
}

internal fun parseColor(value: String?, fallback: Color): Color =
    runCatching { if (value == null) fallback else Color(value.toColorInt()) }
        .getOrDefault(fallback)

internal fun formatDuration(value: Long): String {
    val seconds = value.coerceAtLeast(0) / 1_000
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

internal fun formatDate(value: String): String =
    runCatching {
            DateTimeFormatter.ofPattern("M/d HH:mm")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(value))
        }
        .getOrDefault(value)

internal fun playerSecondaryLabel(state: PlaybackUiState): String =
    when {
        state.status == PlaybackStatus.COMPLETED -> "再生完了"
        state.controls.showSceneName && state.sceneName.isNotBlank() -> state.sceneName
        state.controls.showFileName && state.fileName.isNotBlank() -> state.fileName
        state.isPlaying -> "再生中"
        else -> "一時停止"
    }

private object DocumentImageCache {
    private val cache =
        object : LruCache<String, android.graphics.Bitmap>(32 * 1024) {
            override fun sizeOf(key: String, value: android.graphics.Bitmap): Int =
                value.allocationByteCount / 1024
        }

    fun load(context: android.content.Context, value: String): android.graphics.Bitmap? {
        cache.get(value)?.let {
            return it
        }
        val uri = Uri.parse(value)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > 2_048 || bounds.outHeight / sample > 2_048) sample *= 2
        val bitmap =
            context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(
                    it,
                    null,
                    BitmapFactory.Options().apply { inSampleSize = sample },
                )
            } ?: return null
        cache.put(value, bitmap)
        return bitmap
    }
}
