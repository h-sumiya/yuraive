package com.yuraive.player.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.yuraive.player.data.DocumentLibrary
import com.yuraive.player.data.RemoteConnectionConfig
import com.yuraive.player.data.RemoteFolder
import com.yuraive.player.data.RemoteProtocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class RemoteFolderStep {
    SOURCE,
    CONNECTION,
    BROWSER,
}

@Composable
internal fun RemoteFolderDialog(
    library: DocumentLibrary,
    onDismiss: () -> Unit,
    onSelectLocal: () -> Unit,
    onSelectWindows: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var step by rememberSaveable { mutableStateOf(RemoteFolderStep.SOURCE) }
    var protocol by rememberSaveable { mutableStateOf<RemoteProtocol?>(null) }

    var smbHost by rememberSaveable { mutableStateOf("") }
    var smbPort by rememberSaveable { mutableStateOf("445") }
    var smbShare by rememberSaveable { mutableStateOf("") }
    var smbDomain by rememberSaveable { mutableStateOf("") }
    var smbUsername by rememberSaveable { mutableStateOf("") }
    // Never place credentials in the Activity saved-state bundle.
    var smbPassword by remember { mutableStateOf("") }
    var smbName by rememberSaveable { mutableStateOf("") }

    var webDavEndpoint by rememberSaveable { mutableStateOf("") }
    var webDavUsername by rememberSaveable { mutableStateOf("") }
    var webDavPassword by remember { mutableStateOf("") }
    var webDavName by rememberSaveable { mutableStateOf("") }

    var currentPath by rememberSaveable { mutableStateOf("") }
    var loadedPath by remember { mutableStateOf<String?>(null) }
    var folders by remember { mutableStateOf<List<RemoteFolder>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun currentConfig(): RemoteConnectionConfig =
        when (protocol ?: RemoteProtocol.SMB) {
            RemoteProtocol.SMB ->
                RemoteConnectionConfig(
                    protocol = RemoteProtocol.SMB,
                    displayName = smbName,
                    host = smbHost,
                    port = smbPort.toIntOrNull() ?: 0,
                    share = smbShare,
                    domain = smbDomain,
                    username = smbUsername,
                    password = smbPassword,
                )
            RemoteProtocol.WEBDAV ->
                RemoteConnectionConfig(
                    protocol = RemoteProtocol.WEBDAV,
                    displayName = webDavName,
                    endpoint = webDavEndpoint,
                    username = webDavUsername,
                    password = webDavPassword,
                )
        }

    fun loadPath(path: String, openBrowser: Boolean = false) {
        if (loading) return
        val config = currentConfig()
        currentPath = path
        folders = emptyList()
        loading = true
        errorMessage = null
        scope.launch {
            try {
                val result = library.browseRemoteFolders(config, path)
                folders = result
                loadedPath = path
                if (openBrowser) step = RemoteFolderStep.BROWSER
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                errorMessage =
                    error.message?.takeIf(String::isNotBlank)
                        ?: if (openBrowser) "接続できませんでした" else "フォルダを読み込めませんでした"
            } finally {
                loading = false
            }
        }
    }

    fun navigateBack() {
        if (loading) return
        when (step) {
            RemoteFolderStep.SOURCE -> onDismiss()
            RemoteFolderStep.CONNECTION -> {
                errorMessage = null
                step = RemoteFolderStep.SOURCE
            }
            RemoteFolderStep.BROWSER -> {
                if (currentPath.isEmpty()) {
                    errorMessage = null
                    step = RemoteFolderStep.CONNECTION
                } else {
                    loadPath(currentPath.substringBeforeLast('/', ""))
                }
            }
        }
    }

    fun addCurrentFolder() {
        if (loading || loadedPath != currentPath) return
        val config = currentConfig()
        val fallbackName =
            currentPath.substringAfterLast('/').ifBlank {
                if (config.protocol == RemoteProtocol.SMB) config.share.trim() else ""
            }
        loading = true
        errorMessage = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    library.addRemoteRoot(config, currentPath, fallbackName)
                }
                onDismiss()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                errorMessage = error.message?.takeIf(String::isNotBlank) ?: "フォルダを追加できませんでした"
            } finally {
                loading = false
            }
        }
    }

    // The folder list itself is intentionally not saved. Reload it after a configuration
    // change or Activity recreation while keeping the selected path and form fields.
    LaunchedEffect(step, currentPath) {
        if (step == RemoteFolderStep.BROWSER && loadedPath != currentPath && !loading) {
            loading = true
            errorMessage = null
            try {
                folders = library.browseRemoteFolders(currentConfig(), currentPath)
                loadedPath = currentPath
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                errorMessage = error.message?.takeIf(String::isNotBlank) ?: "フォルダを読み込めませんでした"
            } finally {
                loading = false
            }
        }
    }

    BackHandler { navigateBack() }
    Dialog(
        onDismissRequest = { if (!loading) navigateBack() },
        properties =
            DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false),
    ) {
        Surface(
            modifier =
                Modifier.widthIn(max = 560.dp)
                    .fillMaxWidth(.94f)
                    .then(
                        if (step == RemoteFolderStep.SOURCE) Modifier.wrapContentHeight()
                        else Modifier.fillMaxHeight(.90f)
                    ),
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
        ) {
            Column(
                if (step == RemoteFolderStep.SOURCE) Modifier.fillMaxWidth()
                else Modifier.fillMaxSize()
            ) {
                RemoteDialogHeader(
                    title =
                        when (step) {
                            RemoteFolderStep.SOURCE -> "フォルダを追加"
                            RemoteFolderStep.CONNECTION ->
                                when (protocol) {
                                    RemoteProtocol.SMB -> "SMB に接続"
                                    RemoteProtocol.WEBDAV -> "WebDAV に接続"
                                    null -> "リモートに接続"
                                }
                            RemoteFolderStep.BROWSER -> "フォルダを選択"
                        },
                    onClose = onDismiss,
                )
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

                when (step) {
                    RemoteFolderStep.SOURCE ->
                        SourceSelection(
                            modifier = Modifier.fillMaxWidth(),
                            onLocal = {
                                onDismiss()
                                onSelectLocal()
                            },
                            onRemote = { selected ->
                                protocol = selected
                                errorMessage = null
                                step = RemoteFolderStep.CONNECTION
                            },
                            onWindows = {
                                onDismiss()
                                onSelectWindows()
                            },
                        )
                    RemoteFolderStep.CONNECTION ->
                        ConnectionForm(
                            modifier = Modifier.weight(1f),
                            protocol = protocol ?: RemoteProtocol.SMB,
                            smbHost = smbHost,
                            onSmbHostChange = {
                                smbHost = it
                                errorMessage = null
                            },
                            smbPort = smbPort,
                            onSmbPortChange = {
                                smbPort = it.filter(Char::isDigit)
                                errorMessage = null
                            },
                            smbShare = smbShare,
                            onSmbShareChange = {
                                smbShare = it
                                errorMessage = null
                            },
                            smbDomain = smbDomain,
                            onSmbDomainChange = {
                                smbDomain = it
                                errorMessage = null
                            },
                            smbUsername = smbUsername,
                            onSmbUsernameChange = {
                                smbUsername = it
                                errorMessage = null
                            },
                            smbPassword = smbPassword,
                            onSmbPasswordChange = {
                                smbPassword = it
                                errorMessage = null
                            },
                            smbName = smbName,
                            onSmbNameChange = {
                                smbName = it
                                errorMessage = null
                            },
                            webDavEndpoint = webDavEndpoint,
                            onWebDavEndpointChange = {
                                webDavEndpoint = it
                                errorMessage = null
                            },
                            webDavUsername = webDavUsername,
                            onWebDavUsernameChange = {
                                webDavUsername = it
                                errorMessage = null
                            },
                            webDavPassword = webDavPassword,
                            onWebDavPasswordChange = {
                                webDavPassword = it
                                errorMessage = null
                            },
                            webDavName = webDavName,
                            onWebDavNameChange = {
                                webDavName = it
                                errorMessage = null
                            },
                            errorMessage = errorMessage,
                        )
                    RemoteFolderStep.BROWSER ->
                        RemoteFolderBrowser(
                            modifier = Modifier.weight(1f),
                            currentPath = currentPath,
                            folders = folders,
                            loading = loading,
                            errorMessage = errorMessage,
                            onOpen = { loadPath(it.relativePath) },
                            onRetry = { loadPath(currentPath) },
                        )
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier =
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    when (step) {
                        RemoteFolderStep.SOURCE -> TextButton(onClick = onDismiss) { Text("キャンセル") }
                        RemoteFolderStep.CONNECTION -> {
                            TextButton(onClick = ::navigateBack, enabled = !loading) { Text("戻る") }
                            Button(
                                onClick = { loadPath("", openBrowser = true) },
                                enabled = !loading,
                            ) {
                                if (loading) {
                                    CircularProgressIndicator(
                                        Modifier.size(18.dp),
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.size(8.dp))
                                }
                                Text("接続")
                            }
                        }
                        RemoteFolderStep.BROWSER -> {
                            TextButton(onClick = ::navigateBack, enabled = !loading) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    null,
                                    Modifier.size(18.dp),
                                )
                                Spacer(Modifier.size(4.dp))
                                Text(if (currentPath.isEmpty()) "接続設定" else "上へ")
                            }
                            Button(
                                onClick = ::addCurrentFolder,
                                enabled = !loading && loadedPath == currentPath,
                            ) {
                                Icon(Icons.Default.Check, null, Modifier.size(18.dp))
                                Spacer(Modifier.size(6.dp))
                                Text("このフォルダを追加")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RemoteDialogHeader(title: String, onClose: () -> Unit) {
    Row(
        modifier =
            Modifier.fillMaxWidth()
                .padding(start = 22.dp, top = 18.dp, end = 12.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            title,
            Modifier.weight(1f),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        IconButton(onClick = onClose) { Icon(Icons.Default.Close, "閉じる") }
    }
}

@Composable
private fun SourceSelection(
    modifier: Modifier,
    onLocal: () -> Unit,
    onRemote: (RemoteProtocol) -> Unit,
    onWindows: () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SourceButton("端末", Icons.Default.PhoneAndroid, Modifier.weight(1f), onLocal)
            SourceButton("Windows", Icons.Default.Computer, Modifier.weight(1f), onWindows)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SourceButton("SMB", Icons.Default.Dns, Modifier.weight(1f)) {
                onRemote(RemoteProtocol.SMB)
            }
            SourceButton("WebDAV", Icons.Default.Cloud, Modifier.weight(1f)) {
                onRemote(RemoteProtocol.WEBDAV)
            }
        }
    }
}

@Composable
private fun SourceButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(112.dp),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border =
            androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(icon, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            Text(
                label,
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ConnectionForm(
    modifier: Modifier,
    protocol: RemoteProtocol,
    smbHost: String,
    onSmbHostChange: (String) -> Unit,
    smbPort: String,
    onSmbPortChange: (String) -> Unit,
    smbShare: String,
    onSmbShareChange: (String) -> Unit,
    smbDomain: String,
    onSmbDomainChange: (String) -> Unit,
    smbUsername: String,
    onSmbUsernameChange: (String) -> Unit,
    smbPassword: String,
    onSmbPasswordChange: (String) -> Unit,
    smbName: String,
    onSmbNameChange: (String) -> Unit,
    webDavEndpoint: String,
    onWebDavEndpointChange: (String) -> Unit,
    webDavUsername: String,
    onWebDavUsernameChange: (String) -> Unit,
    webDavPassword: String,
    onWebDavPasswordChange: (String) -> Unit,
    webDavName: String,
    onWebDavNameChange: (String) -> Unit,
    errorMessage: String?,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding =
            androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (protocol == RemoteProtocol.SMB) {
            item {
                OutlinedTextField(
                    value = smbHost,
                    onValueChange = onSmbHostChange,
                    label = { Text("サーバー") },
                    placeholder = { Text("nas.example.com または IP アドレス") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = smbPort,
                    onValueChange = onSmbPortChange,
                    label = { Text("ポート") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = smbShare,
                    onValueChange = onSmbShareChange,
                    label = { Text("共有名") },
                    placeholder = { Text("media") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = smbDomain,
                    onValueChange = onSmbDomainChange,
                    label = { Text("ドメイン（任意）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = smbUsername,
                    onValueChange = onSmbUsernameChange,
                    label = { Text("ユーザー名（任意）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item { PasswordField(smbPassword, onSmbPasswordChange) }
            item {
                OutlinedTextField(
                    value = smbName,
                    onValueChange = onSmbNameChange,
                    label = { Text("ライブラリ表示名（任意）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else {
            item {
                OutlinedTextField(
                    value = webDavEndpoint,
                    onValueChange = onWebDavEndpointChange,
                    label = { Text("WebDAV URL（HTTPS）") },
                    placeholder = { Text("https://server.example/dav/") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = webDavUsername,
                    onValueChange = onWebDavUsernameChange,
                    label = { Text("ユーザー名（任意）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item { PasswordField(webDavPassword, onWebDavPasswordChange) }
            item {
                OutlinedTextField(
                    value = webDavName,
                    onValueChange = onWebDavNameChange,
                    label = { Text("ライブラリ表示名（任意）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        errorMessage?.let { message -> item { RemoteError(message) } }
    }
}

@Composable
private fun PasswordField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text("パスワード（任意）") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RemoteFolderBrowser(
    modifier: Modifier,
    currentPath: String,
    folders: List<RemoteFolder>,
    loading: Boolean,
    errorMessage: String?,
    onOpen: (RemoteFolder) -> Unit,
    onRetry: () -> Unit,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp)) {
        Text(
            "現在地",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            if (currentPath.isEmpty()) "/" else "/$currentPath",
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(6.dp))
        errorMessage?.let { message ->
            RemoteError(message)
            OutlinedButton(
                onClick = onRetry,
                enabled = !loading,
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("再試行")
            }
            Spacer(Modifier.height(8.dp))
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            LazyColumn(Modifier.fillMaxSize()) {
                items(folders, key = RemoteFolder::relativePath) { folder ->
                    TextButton(
                        onClick = { onOpen(folder) },
                        enabled = !loading,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Folder, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.size(12.dp))
                        Text(
                            folder.name,
                            Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Start,
                        )
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            if (!loading && errorMessage == null && folders.isEmpty()) {
                Column(
                    Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Default.Folder,
                        null,
                        Modifier.size(38.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("サブフォルダはありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun RemoteError(message: String) {
    Text(
        message,
        Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
    )
}
