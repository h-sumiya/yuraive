using System.Text;
using WmgfPlayer.Core.Models;
using WmgfPlayer.Core.Storage;
using Xunit;

namespace WmgfPlayer.Core.Tests;

public sealed class StorageTests
{
    [Fact]
    public async Task SettingsAreClampedAndPersistedAtomically()
    {
        using var temporary = new TemporaryDirectory();
        var paths = new AppDataPaths(temporary.Combine("state"));
        var store = new SettingsStore(paths);

        await store.UpdateAsync(value => value with { ThemeMode = ThemeMode.Dark, ScriptTimeoutMs = 99_999 });
        var reloaded = new SettingsStore(paths);

        Assert.Equal(ThemeMode.Dark, reloaded.Current.ThemeMode);
        Assert.Equal(10_000, reloaded.Current.ScriptTimeoutMs);
        Assert.Empty(Directory.EnumerateFiles(paths.Root, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task HistoryToleratesCorruptLinesAndSupportsExportRemovalAndClear()
    {
        using var temporary = new TemporaryDirectory();
        var paths = new AppDataPaths(temporary.Combine("state"));
        var store = new HistoryStore(paths);
        var first = Entry("one", "graph-a", "2026-01-01T00:00:00.0000000+00:00");
        var second = Entry("two", "graph-a", "2026-01-01T00:01:00.0000000+00:00");
        await store.AppendAsync(first);
        await store.AppendAsync(second);
        var historyFile = Assert.Single(Directory.EnumerateFiles(paths.History, "*.jsonl"));
        await File.AppendAllTextAsync(historyFile, "{broken json\n", Encoding.UTF8);

        var read = await store.ReadAsync("graph-a");
        Assert.Equal(["one", "two"], read.Select(entry => entry.Id));
        Assert.Equal(2, (await store.ExportJsonlAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Length);

        await store.RemoveAsync("graph-a", new HashSet<string>(StringComparer.Ordinal) { "one" });
        Assert.Equal("two", Assert.Single(await store.ReadAsync("graph-a")).Id);
        await store.ClearAsync();
        Assert.Empty(await store.ReadAllAsync());
    }

    [Fact]
    public async Task SnapshotRoundTripsAndIgnoresCorruption()
    {
        using var temporary = new TemporaryDirectory();
        var paths = new AppDataPaths(temporary.Combine("state"));
        var store = new SnapshotStore(paths);
        var snapshot = new PlaybackSnapshot
        {
            GraphRef = new() { RootUri = temporary.Path, RootName = "test", RelativePath = "story.wmg.json" },
            RunId = "run",
            RunStartedAt = "2026-01-01T00:00:00Z",
            NodeId = "intro",
            PositionMs = 42,
            SavedAt = "2026-01-01T00:00:01Z",
        };

        await store.SaveAsync(snapshot);
        Assert.Equal(snapshot, await store.LoadAsync());
        await File.WriteAllTextAsync(paths.Snapshot, "not-json");
        Assert.Null(await store.LoadAsync());
        await store.ClearAsync();
        Assert.False(File.Exists(paths.Snapshot));
    }

    [Fact]
    public async Task LibraryScansNestedContentAndKeepsAssetsInsideTheGrantedRoot()
    {
        using var temporary = new TemporaryDirectory();
        var state = new AppDataPaths(temporary.Combine("state"));
        var root = temporary.Combine("library");
        var content = System.IO.Path.Combine(root, "Rain");
        var (reference, _) = TestGraph.WriteTwoSceneGraph(content);
        var library = new DocumentLibrary(state);
        await library.AddRootAsync(root, "Works");

        var roots = await library.ScanAllAsync();
        var granted = Assert.Single(roots).Grant;
        var rootDirectory = Assert.Single(roots).Directory!;
        Assert.Equal("Rain", Assert.Single(rootDirectory.Folders).Name);
        var contentDirectory = await library.InspectDirectoryAsync(granted, "Rain");
        var preview = Assert.Single(contentDirectory.Graphs);
        Assert.Equal("Windows player test", preview.DisplayName);
        Assert.Equal("WMGF", preview.Author);
        Assert.Equal("cover.png", preview.ThumbnailPath);
        Assert.NotNull(library.GetAssetPath(preview.Ref, preview.ThumbnailPath!));

        var loaded = await library.ReadGraphAsync(reference);
        Assert.DoesNotContain(await library.ValidateAsync(reference, loaded), issue => issue.Severity == ValidationSeverity.Error);
        Assert.NotNull(library.GetAssetPath(reference, "intro.wav"));
        Assert.Null(library.GetAssetPath(reference, "../outside.wav"));
        await Assert.ThrowsAsync<ArgumentException>(() => library.InspectDirectoryAsync(granted, "../outside"));
    }

    [Fact]
    public async Task LibraryPrefersBundleAndReadsEmbeddedTextAssets()
    {
        using var temporary = new TemporaryDirectory();
        var state = new AppDataPaths(temporary.Combine("state"));
        var root = temporary.Combine("library");
        Directory.CreateDirectory(root);
        await File.WriteAllTextAsync(System.IO.Path.Combine(root, "story.wmg.json"),
            """{"version":1,"metadata":{"displayName":"JSON"},"nodes":{"start":{"type":"media","start":true,"terminal":true}},"buttons":{},"playerControls":{}}""");
        var bundledJson = """{"version":1,"metadata":{"displayName":"Bundle"},"playbackStats":{"path":"route.star"},"nodes":{"start":{"type":"media","start":true,"terminal":true}},"buttons":{},"playerControls":{"default":{"layout":"default.wmg-layout.html"}},"globalPlayerControl":"default"}""";
        await File.WriteAllBytesAsync(System.IO.Path.Combine(root, "story.wmg"), EncodeBundle(bundledJson,
            ("route.star", "def render_stats(ctx):\n    return None\n", 1),
            ("default.wmg-layout.html", "<style></style><slot></slot>", 2)));
        var library = new DocumentLibrary(state);
        await library.AddRootAsync(root, "Works");

        var scanned = Assert.Single(await library.ScanAllAsync());
        var preview = Assert.Single(scanned.Directory!.Graphs);
        Assert.Equal("story.wmg", preview.Ref.FileName);
        Assert.Equal($"{root}::story.wmg.json", preview.Ref.GraphId);
        Assert.Equal("Bundle", preview.DisplayName);
        var graph = await library.ReadGraphAsync(preview.Ref);
        Assert.Equal("Bundle", graph.Metadata?.DisplayName);
        Assert.Contains("route.star", await library.ReadScriptSourcesAsync(preview.Ref, "route.star"));
        Assert.Equal("<style></style><slot></slot>", await library.ReadAssetTextAsync(preview.Ref, "default.wmg-layout.html"));
        Assert.DoesNotContain(await library.ValidateAsync(preview.Ref, graph), issue => issue.Severity == ValidationSeverity.Error);
    }

    private static byte[] EncodeBundle(string graphJson, params (string Path, string Content, byte Kind)[] assets)
    {
        using var payload = new MemoryStream();
        WriteVarintField(payload, 1, 1);
        WriteBytesField(payload, 2, Encoding.UTF8.GetBytes(graphJson));
        foreach (var asset in assets)
        {
            using var message = new MemoryStream();
            WriteBytesField(message, 1, Encoding.UTF8.GetBytes(asset.Path));
            WriteBytesField(message, 2, Encoding.UTF8.GetBytes(asset.Content));
            WriteVarintField(message, 3, asset.Kind);
            WriteBytesField(payload, 3, message.ToArray());
        }
        using var output = new MemoryStream();
        output.Write("WMGFBNDL"u8);
        output.Write(BitConverter.GetBytes((ushort)1));
        output.Write(BitConverter.GetBytes((ushort)16));
        output.Write(BitConverter.GetBytes((uint)payload.Length));
        payload.Position = 0;
        payload.CopyTo(output);
        return output.ToArray();

        static void WriteVarintField(Stream stream, int field, ulong value)
        {
            WriteVarint(stream, (ulong)(field << 3));
            WriteVarint(stream, value);
        }

        static void WriteBytesField(Stream stream, int field, byte[] value)
        {
            WriteVarint(stream, (ulong)((field << 3) | 2));
            WriteVarint(stream, (ulong)value.Length);
            stream.Write(value);
        }

        static void WriteVarint(Stream stream, ulong value)
        {
            do
            {
                var next = (byte)(value & 0x7f);
                value >>= 7;
                stream.WriteByte(value == 0 ? next : (byte)(next | 0x80));
            } while (value != 0);
        }
    }

    private static PlaybackHistoryEntry Entry(string id, string graphId, string startedAt) => new()
    {
        Id = id,
        RunId = "run",
        GraphId = graphId,
        NodeId = "scene",
        MediaId = "media",
        StartedAt = startedAt,
        EndedAt = startedAt,
        EndReason = "completed",
    };
}
