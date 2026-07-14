using WmgfPlayer.Core.Playback;
using WmgfPlayer.Core.Storage;
using Xunit;

namespace WmgfPlayer.Core.Tests;

public sealed class PlaybackEngineTests
{
    [Fact]
    public async Task EngineMovesThroughGraphAndWritesExactHistoryReasons()
    {
        using var temporary = new TemporaryDirectory();
        var content = temporary.Combine("content");
        var (reference, _) = TestGraph.WriteTwoSceneGraph(content);
        var paths = new AppDataPaths(temporary.Combine("state"));
        var history = new HistoryStore(paths);
        var adapter = new FakeMediaPlaybackAdapter();
        await using var engine = CreateEngine(paths, adapter);

        await engine.StartAsync(reference);
        Assert.Equal(PlaybackStatus.Ready, engine.State.Status);
        Assert.Equal("intro", engine.State.NodeId);
        Assert.True(engine.State.IsPlaying);
        Assert.True(engine.State.CanNext);

        adapter.PositionMs = 3_000;
        await engine.NextAsync();
        Assert.Equal("ending", engine.State.NodeId);
        Assert.Equal("intro.wav", (await history.ReadAsync(reference.GraphId))[0].Source);

        adapter.PositionMs = 4_000;
        adapter.RaiseEnded();
        await WaitUntilAsync(() => engine.State.Status == PlaybackStatus.Completed);
        var entries = await history.ReadAsync(reference.GraphId);
        Assert.Equal(2, entries.Count);
        Assert.All(entries, entry => Assert.Equal("completed", entry.EndReason));
        Assert.Equal(["intro", "ending"], entries.Select(entry => entry.NodeId));
    }

    [Fact]
    public async Task SnapshotRestoresTheExactSceneAndPositionWithoutAutoplay()
    {
        using var temporary = new TemporaryDirectory();
        var content = temporary.Combine("content");
        var (reference, _) = TestGraph.WriteTwoSceneGraph(content);
        var paths = new AppDataPaths(temporary.Combine("state"));
        var firstAdapter = new FakeMediaPlaybackAdapter();
        await using (var first = CreateEngine(paths, firstAdapter))
        {
            await first.StartAsync(reference);
            await first.SeekAsync(3_210);
            firstAdapter.Pause();
        }

        var restoredAdapter = new FakeMediaPlaybackAdapter();
        await using var restored = CreateEngine(paths, restoredAdapter);
        Assert.True(await restored.RestoreAsync(autoPlay: false));
        Assert.Equal(PlaybackStatus.Ready, restored.State.Status);
        Assert.Equal("intro", restored.State.NodeId);
        Assert.Equal(3_210, restored.State.PositionMs);
        Assert.False(restored.State.IsPlaying);
        Assert.Equal(3_210, Assert.Single(restoredAdapter.Loads).PositionMs);
    }

    private static GraphPlaybackEngine CreateEngine(AppDataPaths paths, FakeMediaPlaybackAdapter adapter) => new(
        new DocumentLibrary(paths),
        new HistoryStore(paths),
        new SnapshotStore(paths),
        new SettingsStore(paths),
        adapter);

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition() && DateTime.UtcNow < deadline) await Task.Delay(20);
        Assert.True(condition(), "Timed out waiting for the playback engine state transition.");
    }

    private sealed class FakeMediaPlaybackAdapter : IMediaPlaybackAdapter
    {
        public bool HasMedia { get; private set; }
        public bool IsPlaying { get; private set; }
        public long PositionMs { get; set; }
        public long DurationMs { get; private set; } = 120_000;
        public List<MediaLoadRequest> Loads { get; } = [];
        public event EventHandler<bool>? IsPlayingChanged;
        public event EventHandler? MediaEnded;
        public event EventHandler<string>? MediaFailed;

        public Task LoadAsync(MediaLoadRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Loads.Add(request);
            HasMedia = true;
            PositionMs = request.PositionMs;
            if (request.AutoPlay) Play();
            return Task.CompletedTask;
        }

        public void Play()
        {
            if (!HasMedia || IsPlaying) return;
            IsPlaying = true;
            IsPlayingChanged?.Invoke(this, true);
        }

        public void Pause()
        {
            if (!IsPlaying) return;
            IsPlaying = false;
            IsPlayingChanged?.Invoke(this, false);
        }

        public void Stop() => Pause();

        public void Clear()
        {
            Pause();
            HasMedia = false;
            PositionMs = 0;
        }

        public void Seek(long positionMs) => PositionMs = Math.Clamp(positionMs, 0, DurationMs);

        public void RaiseEnded()
        {
            PositionMs = DurationMs;
            Pause();
            MediaEnded?.Invoke(this, EventArgs.Empty);
        }

        public void RaiseFailure(string message) => MediaFailed?.Invoke(this, message);
        public void Dispose() => Clear();
    }
}
