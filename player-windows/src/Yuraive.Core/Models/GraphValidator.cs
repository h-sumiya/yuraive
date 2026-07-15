using Yuraive.Core.Interop;

namespace Yuraive.Core.Models;

public static class GraphValidator
{
    public static IReadOnlyList<ValidationIssue> ValidateJson(string json) => NativeRuntime.ValidateJson(json);
    public static IReadOnlyList<ValidationIssue> Validate(YuraiveGraph graph) => ValidateJson(YuraiveJson.Serialize(graph));

    public static HashSet<string> AllAssetPaths(YuraiveGraph graph)
    {
        var paths = new HashSet<string>(StringComparer.Ordinal);
        Add(graph.Metadata?.Thumbnail);
        Add(graph.PlaybackStats?.Path);
        foreach (var node in graph.Nodes.Values)
        {
            Add(node.Script?.Path);
            foreach (var media in node.Media)
            {
                Add(media.Source.Audio);
                Add(media.Source.Image);
                Add(media.Source.Video);
                Add(media.Source.Subtitle);
            }
        }
        foreach (var button in graph.Buttons.Values)
        {
            Add(button.Style.BackgroundImage);
            Add(button.Render?.Path);
        }
        foreach (var control in graph.PlayerControls.Values) Add(control.Layout);
        return paths;

        void Add(string? path) { if (path is not null) paths.Add(path); }
    }

    public static bool IsSafeRelativePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.StartsWith('/') || path.StartsWith('\\') || path.Contains(':')) return false;
        return path.Replace('\\', '/').Split('/').All(segment => segment is not ("" or "." or ".."));
    }
}
