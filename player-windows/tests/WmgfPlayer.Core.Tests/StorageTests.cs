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
