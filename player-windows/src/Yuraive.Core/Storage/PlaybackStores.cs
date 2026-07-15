using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Yuraive.Core.Models;

namespace Yuraive.Core.Storage;

public sealed class HistoryStore
{
    public const int MaxEntries = 1_000;
    private readonly string _directory;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public HistoryStore(AppDataPaths paths) => _directory = paths.History;

    public async Task AppendAsync(PlaybackHistoryEntry entry, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var file = FileFor(entry.GraphId);
            await using (var stream = new FileStream(
                file,
                FileMode.Append,
                FileAccess.Write,
                FileShare.Read,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            await using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                await writer.WriteLineAsync(YuraiveJson.Serialize(entry).AsMemory(), cancellationToken);
                await writer.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            var entries = await ReadFileAsync(file, cancellationToken);
            if (entries.Count > MaxEntries)
                await RewriteAsync(file, entries.TakeLast(MaxEntries), cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<PlaybackHistoryEntry>> ReadAsync(string graphId, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { return await ReadFileAsync(FileFor(graphId), cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<PlaybackHistoryEntry>> ReadAllAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return (await ReadAllUnsafeAsync(cancellationToken))
                .OrderByDescending(entry => entry.EndedAt, StringComparer.Ordinal)
                .ToList();
        }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<PlaybackHistoryEntry>> ReadForContentAsync(
        string? contentId,
        string graphId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return (await ReadAllUnsafeAsync(cancellationToken))
                .Where(entry => contentId is null
                    ? entry.GraphId == graphId
                    : entry.ContentId == contentId || entry.ContentId is null && entry.GraphId == graphId)
                .OrderBy(entry => entry.StartedAt, StringComparer.Ordinal)
                .TakeLast(MaxEntries)
                .ToList();
        }
        finally { _gate.Release(); }
    }

    public async Task RemoveAsync(string graphId, ISet<string> entryIds, CancellationToken cancellationToken = default)
    {
        if (entryIds.Count == 0) return;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var file = FileFor(graphId);
            var remaining = (await ReadFileAsync(file, cancellationToken))
                .Where(entry => !entryIds.Contains(entry.Id)).ToList();
            if (remaining.Count == 0)
            {
                if (File.Exists(file)) File.Delete(file);
            }
            else await RewriteAsync(file, remaining, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            foreach (var file in Directory.EnumerateFiles(_directory, "*.jsonl")) File.Delete(file);
        }
        finally { _gate.Release(); }
    }

    public async Task<string> ExportJsonlAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var entries = (await ReadAllUnsafeAsync(cancellationToken)).OrderBy(entry => entry.StartedAt, StringComparer.Ordinal);
            var result = string.Join('\n', entries.Select(YuraiveJson.Serialize));
            return result.Length == 0 ? "" : result + "\n";
        }
        finally { _gate.Release(); }
    }

    private async Task<List<PlaybackHistoryEntry>> ReadAllUnsafeAsync(CancellationToken cancellationToken)
    {
        var result = new List<PlaybackHistoryEntry>();
        foreach (var file in Directory.EnumerateFiles(_directory, "*.jsonl"))
            result.AddRange(await ReadFileAsync(file, cancellationToken));
        return result;
    }

    private static async Task<List<PlaybackHistoryEntry>> ReadFileAsync(string file, CancellationToken cancellationToken)
    {
        if (!File.Exists(file)) return [];
        var result = new List<PlaybackHistoryEntry>();
        using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 16 * 1024, FileOptions.Asynchronous);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try { result.Add(YuraiveJson.Deserialize<PlaybackHistoryEntry>(line)); }
            catch (Exception error) when (error is JsonException or NotSupportedException) { }
        }
        return result;
    }

    private static Task RewriteAsync(string file, IEnumerable<PlaybackHistoryEntry> entries, CancellationToken cancellationToken)
    {
        var text = string.Join('\n', entries.Select(YuraiveJson.Serialize));
        return DurableFile.WriteAtomicAsync(file, text.Length == 0 ? "" : text + "\n", cancellationToken);
    }

    private string FileFor(string graphId) => Path.Combine(_directory, $"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(graphId)))}.jsonl");
}

public sealed class SnapshotStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public SnapshotStore(AppDataPaths paths) => _path = paths.Snapshot;

    public async Task SaveAsync(PlaybackSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { await DurableFile.WriteAtomicAsync(_path, YuraiveJson.Serialize(snapshot), cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task<PlaybackSnapshot?> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path)) return null;
            try { return YuraiveJson.Deserialize<PlaybackSnapshot>(await File.ReadAllTextAsync(_path, cancellationToken)); }
            catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException) { return null; }
        }
        finally { _gate.Release(); }
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { if (File.Exists(_path)) File.Delete(_path); }
        finally { _gate.Release(); }
    }
}
