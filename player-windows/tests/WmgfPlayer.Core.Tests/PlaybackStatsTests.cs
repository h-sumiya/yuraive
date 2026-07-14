using System.Text.Json;
using WmgfPlayer.Core.Models;
using WmgfPlayer.Core.Playback;
using WmgfPlayer.Core.Storage;
using Xunit;

namespace WmgfPlayer.Core.Tests;

public sealed class PlaybackStatsTests
{
    [Fact]
    public async Task StatsScriptReceivesSessionsAndProducesValidatedDisplayAndShareData()
    {
        using var temporary = new TemporaryDirectory();
        var content = temporary.Combine("content");
        var (reference, sourceGraph) = TestGraph.WriteTwoSceneGraph(content);
        var graph = sourceGraph with { PlaybackStats = new ScriptCall { Path = "stats.star" } };
        await File.WriteAllTextAsync(System.IO.Path.Combine(content, "story.wmg.json"), WmgJson.Serialize(graph));
        await File.WriteAllTextAsync(System.IO.Path.Combine(content, "stats.star"), """
            def render_stats(ctx):
                played = ctx['session']['activePlayMs']
                return {
                    'sortValue': played,
                    'display': {
                        'schemaVersion': 1,
                        'fallbackText': 'Played %s ms' % played,
                        'root': {'type': 'text', 'text': 'Played %s ms' % played},
                    },
                    'share': {
                        'text': 'Played %s ms' % played,
                        'url': 'https://example.com/work',
                        'hashtags': ['ASMR'],
                        'via': 'wmgf',
                    },
                }
            """);
        var paths = new AppDataPaths(temporary.Combine("state"));
        var history = new HistoryStore(paths);
        await history.AppendAsync(Entry("first", reference.GraphId, 1_500));
        await history.AppendAsync(Entry("second", reference.GraphId, 2_500));
        var evaluator = new PlaybackStatsEvaluator(new DocumentLibrary(paths), history, new SettingsStore(paths));

        var result = await evaluator.EvaluateAsync(reference, new PlaybackUiState { Status = PlaybackStatus.Completed });

        Assert.Equal("Windows player test", result.Title);
        Assert.Equal(new PlaybackStatsAggregate(1, 2, 4_000, "2026-01-01T00:00:00Z", "2026-01-01T00:01:30Z"), result.Aggregate);
        var item = Assert.Single(result.Items);
        Assert.Null(item.Error);
        Assert.Equal(4_000, item.SortValue);
        Assert.Equal("Played 4000 ms", item.Display?.FallbackText);
        Assert.Equal("Played 4000 ms", item.Display?.Root.Text);
        Assert.Contains("#ASMR", item.Share?.ComposedText());
        Assert.Contains("@wmgf", item.Share?.ComposedText());
    }

    [Fact]
    public void DisplayAndShareValidatorsRejectUnsafeOrUnboundedValues()
    {
        using var invalidDisplay = JsonDocument.Parse("""
            {"schemaVersion":1,"fallbackText":"image","root":{"type":"image","source":"../outside.png"}}
            """);
        Assert.Throws<InvalidDataException>(() => DisplayValidator.Validate(invalidDisplay.RootElement));

        using var invalidShare = JsonDocument.Parse("""
            {"text":"share","url":"http://example.com","hashtags":["bad tag"]}
            """);
        Assert.Throws<InvalidDataException>(() => ShareValidator.Validate(invalidShare.RootElement));
    }

    private static PlaybackHistoryEntry Entry(string id, string graphId, long activePlayMs) => new()
    {
        Id = id,
        RunId = "run-1",
        GraphId = graphId,
        ContentId = "dev.wmgf.windows-tests",
        NodeId = id == "first" ? "intro" : "ending",
        MediaId = id,
        StartedAt = id == "first" ? "2026-01-01T00:00:00Z" : "2026-01-01T00:01:00Z",
        EndedAt = id == "first" ? "2026-01-01T00:00:30Z" : "2026-01-01T00:01:30Z",
        ActivePlayMs = activePlayMs,
        EndReason = "completed",
    };
}
