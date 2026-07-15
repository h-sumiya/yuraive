@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yuraive.player.playback

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import com.yuraive.player.data.DocumentLibrary
import com.yuraive.player.data.RemoteRead
import java.io.IOException

internal class LibraryDataSourceFactory(
    context: Context,
    private val library: DocumentLibrary,
) : DataSource.Factory {
    private val localFactory = DefaultDataSource.Factory(context)

    override fun createDataSource(): DataSource = LibraryDataSource(localFactory.createDataSource(), library)
}

private class LibraryDataSource(
    private val local: DataSource,
    private val library: DocumentLibrary,
) : BaseDataSource(true) {
    private var remote: RemoteRead? = null
    private var remoteUri: Uri? = null
    private var remaining = C.LENGTH_UNSET.toLong()
    private var remoteTransferStarted = false

    override fun open(dataSpec: DataSpec): Long {
        if (!library.isRemoteMediaUri(dataSpec.uri)) return local.open(dataSpec)
        transferInitializing(dataSpec)
        try {
            val opened = library.openRemoteMedia(dataSpec.uri, dataSpec.position)
            remote = opened
            remoteUri = dataSpec.uri
            remaining = when {
                dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.length
                opened.totalLength >= 0 -> (opened.totalLength - dataSpec.position).coerceAtLeast(0)
                else -> C.LENGTH_UNSET.toLong()
            }
            remoteTransferStarted = true
            transferStarted(dataSpec)
            return remaining
        } catch (error: IOException) {
            close()
            throw error
        } catch (error: Throwable) {
            close()
            throw IOException("リモートメディアを開けません", error)
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val opened = remote ?: return local.read(buffer, offset, length)
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val requested = if (remaining == C.LENGTH_UNSET.toLong()) length else minOf(length.toLong(), remaining).toInt()
        val count = try {
            opened.input.read(buffer, offset, requested)
        } catch (error: IOException) {
            throw error
        } catch (error: Throwable) {
            throw IOException("リモートメディアの読み込みに失敗しました", error)
        }
        if (count < 0) return C.RESULT_END_OF_INPUT
        if (remaining != C.LENGTH_UNSET.toLong()) remaining -= count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri? = remoteUri ?: local.uri

    override fun getResponseHeaders(): Map<String, List<String>> = if (remote != null) emptyMap() else local.responseHeaders

    override fun close() {
        val opened = remote
        remote = null
        remoteUri = null
        remaining = C.LENGTH_UNSET.toLong()
        if (opened != null) {
            try {
                opened.close()
            } finally {
                if (remoteTransferStarted) transferEnded()
                remoteTransferStarted = false
            }
        } else {
            local.close()
        }
    }
}
