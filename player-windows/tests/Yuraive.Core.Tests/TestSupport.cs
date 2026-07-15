using Yuraive.Core.Models;

namespace Yuraive.Core.Tests;

internal sealed class TemporaryDirectory : IDisposable
{
    public TemporaryDirectory()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "yuraive-player-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }
    public string Combine(params string[] parts) => System.IO.Path.Combine([Path, .. parts]);

    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

internal static class TestGraph
{
    public static (GraphRef Reference, YuraiveGraph Graph) WriteTwoSceneGraph(string root)
    {
        Directory.CreateDirectory(root);
        File.WriteAllBytes(System.IO.Path.Combine(root, "intro.wav"), [0]);
        File.WriteAllBytes(System.IO.Path.Combine(root, "ending.wav"), [0]);
        File.WriteAllBytes(System.IO.Path.Combine(root, "cover.png"), [137, 80, 78, 71, 13, 10, 26, 10]);
        var graph = new YuraiveGraph
        {
            Version = 1,
            Metadata = new YuraiveMetadata
            {
                ContentId = "com.yuraive.player.windows-tests",
                DisplayName = "Windows player test",
                Author = "Yuraive",
                Thumbnail = "cover.png",
            },
            Nodes = new Dictionary<string, YuraiveNode>(StringComparer.Ordinal)
            {
                ["intro"] = new()
                {
                    Type = "media",
                    Start = true,
                    Media = [new()
                    {
                        Id = "intro-audio",
                        Weight = 1,
                        Source = new() { Type = "audio", Audio = "intro.wav" },
                    }],
                    OnEnd = [new() { To = "ending", Weight = 1 }],
                },
                ["ending"] = new()
                {
                    Type = "media",
                    Terminal = true,
                    Media = [new()
                    {
                        Id = "ending-audio",
                        Weight = 1,
                        Source = new() { Type = "audio", Audio = "ending.wav" },
                    }],
                },
            },
            PlayerControls = new Dictionary<string, PlayerControlSettings>(StringComparer.Ordinal)
            {
                ["desktop"] = new() { AllowNext = true, AllowPrevious = true },
            },
            GlobalPlayerControl = "desktop",
        };
        File.WriteAllText(System.IO.Path.Combine(root, "story.yuraive.json"), YuraiveJson.Serialize(graph));
        return (new GraphRef { RootUri = root, RootName = "test", RelativePath = "story.yuraive.json" }, graph);
    }
}
