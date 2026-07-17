package com.yuraive.player.data

import android.content.Context
import android.util.AtomicFile
import com.yuraive.player.model.PlaybackHistoryEntry
import com.yuraive.player.model.PlaybackSnapshot
import com.yuraive.player.model.YuraiveJson
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

class HistoryStore(context: Context) {
    private val directory = File(context.filesDir, "history").apply { mkdirs() }
    private val lock = Any()

    suspend fun append(entry: PlaybackHistoryEntry) =
        withContext(Dispatchers.IO) {
            synchronized(lock) {
                val file = fileFor(entry.graphId)
                FileOutputStream(file, true).use { stream ->
                    stream.write(
                        (YuraiveJson.format.encodeToString(entry) + "\n").toByteArray(
                            Charsets.UTF_8
                        )
                    )
                    stream.flush()
                    stream.fd.sync()
                }
                val entries = readFile(file)
                if (entries.size > MAX_ENTRIES) rewrite(file, entries.takeLast(MAX_ENTRIES))
            }
        }

    suspend fun read(graphId: String): List<PlaybackHistoryEntry> =
        withContext(Dispatchers.IO) { synchronized(lock) { readFile(fileFor(graphId)) } }

    suspend fun readAll(): List<PlaybackHistoryEntry> =
        withContext(Dispatchers.IO) {
            synchronized(lock) {
                directory.listFiles().orEmpty().flatMap(::readFile).sortedByDescending {
                    it.endedAt
                }
            }
        }

    suspend fun readForContent(contentId: String?, graphId: String): List<PlaybackHistoryEntry> =
        withContext(Dispatchers.IO) {
            synchronized(lock) {
                directory
                    .listFiles()
                    .orEmpty()
                    .flatMap(::readFile)
                    .filter { entry ->
                        if (contentId == null) entry.graphId == graphId
                        else
                            entry.contentId == contentId ||
                                (entry.contentId == null && entry.graphId == graphId)
                    }
                    .sortedBy { it.startedAt }
                    .takeLast(MAX_ENTRIES)
            }
        }

    suspend fun clear() =
        withContext(Dispatchers.IO) {
            synchronized(lock) { directory.listFiles().orEmpty().forEach(File::delete) }
        }

    suspend fun remove(graphId: String, entryIds: Set<String>) =
        withContext(Dispatchers.IO) {
            if (entryIds.isEmpty()) return@withContext
            synchronized(lock) {
                val file = fileFor(graphId)
                val remaining = readFile(file).filterNot { it.id in entryIds }
                if (remaining.isEmpty()) file.delete() else rewrite(file, remaining)
            }
        }

    suspend fun exportJsonl(): String =
        withContext(Dispatchers.IO) {
            val entries = readAll().sortedBy { it.startedAt }
            entries.joinToString("\n", postfix = if (entries.isEmpty()) "" else "\n") {
                YuraiveJson.format.encodeToString(it)
            }
        }

    private fun readFile(file: File): List<PlaybackHistoryEntry> {
        if (!file.exists()) return emptyList()
        return file.useLines(Charsets.UTF_8) { lines ->
            lines
                .mapNotNull { line ->
                    runCatching { YuraiveJson.format.decodeFromString<PlaybackHistoryEntry>(line) }
                        .getOrNull()
                }
                .toList()
        }
    }

    private fun rewrite(file: File, entries: List<PlaybackHistoryEntry>) {
        val temporary = File(file.parentFile, "${file.name}.tmp")
        FileOutputStream(temporary).use { stream ->
            entries.forEach {
                stream.write(
                    (YuraiveJson.format.encodeToString(it) + "\n").toByteArray(Charsets.UTF_8)
                )
            }
            stream.flush()
            stream.fd.sync()
        }
        if (!temporary.renameTo(file)) {
            file.delete()
            check(temporary.renameTo(file)) { "履歴を更新できません" }
        }
    }

    private fun fileFor(graphId: String): File = File(directory, "${sha256(graphId)}.jsonl")

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {
            "%02x".format(it)
        }

    companion object {
        const val MAX_ENTRIES = 1_000
    }
}

class SnapshotStore(context: Context) {
    private val file = File(context.filesDir, "playback-state.json")
    private val atomicFile = AtomicFile(file)
    private val mutex = Mutex()

    suspend fun save(snapshot: PlaybackSnapshot) =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val stream = atomicFile.startWrite()
                try {
                    stream.write(
                        YuraiveJson.format.encodeToString(snapshot).toByteArray(Charsets.UTF_8)
                    )
                    atomicFile.finishWrite(stream)
                } catch (error: Throwable) {
                    atomicFile.failWrite(stream)
                    throw error
                }
            }
        }

    suspend fun load(): PlaybackSnapshot? =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                if (!file.exists()) null
                else
                    runCatching {
                            atomicFile.openRead().bufferedReader(Charsets.UTF_8).use { reader ->
                                YuraiveJson.format.decodeFromString<PlaybackSnapshot>(
                                    reader.readText()
                                )
                            }
                        }
                        .getOrNull()
            }
        }

    suspend fun clear() = withContext(Dispatchers.IO) { mutex.withLock { atomicFile.delete() } }
}
