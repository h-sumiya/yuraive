using System.Text.Json;
using System.Text.Json.Serialization;

namespace Yuraive.Core.Models;

public static class YuraiveJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        AllowTrailingCommas = false,
    };

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new JsonException($"{typeof(T).Name}を読み込めません");

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}

public sealed record YuraiveGraph
{
    public int Version { get; init; }
    public YuraiveMetadata? Metadata { get; init; }
    public Dictionary<string, YuraiveNode> Nodes { get; init; } = [];
    public Dictionary<string, YuraiveButton> Buttons { get; init; } = [];
    public Dictionary<string, PlayerControlSettings> PlayerControls { get; init; } = [];
    public string? GlobalPlayerControl { get; init; }
    public ScriptCall? PlaybackStats { get; init; }
}

public sealed record YuraiveMetadata
{
    public string? ContentId { get; init; }
    public string? DisplayName { get; init; }
    public string? Description { get; init; }
    public string? Author { get; init; }
    public string? CreatedAt { get; init; }
    public string? UpdatedAt { get; init; }
    public List<string> Tags { get; init; } = [];
    public string? Thumbnail { get; init; }
    public List<SocialLink> SocialLinks { get; init; } = [];
}

public sealed record SocialLink
{
    public required string Label { get; init; }
    public required string Url { get; init; }
}

public sealed record PlayerControlSettings
{
    public string? AccentColor { get; init; }
    public string? Layout { get; init; }
    public bool AllowStop { get; init; } = true;
    public bool ShowSeekBar { get; init; } = true;
    public bool ShowPlaybackTime { get; init; } = true;
    public bool AllowSeek { get; init; } = true;
    public bool ShowSceneName { get; init; } = true;
    public bool ShowFileName { get; init; }
    public bool AllowNext { get; init; }
    public bool AllowPrevious { get; init; }
    public JsonElement? Editor { get; init; }

    public static PlayerControlSettings Default { get; } = new();
    public static PlayerControlSettings AllEnabled { get; } = new()
    {
        AllowStop = true,
        ShowSeekBar = true,
        ShowPlaybackTime = true,
        AllowSeek = true,
        ShowSceneName = true,
        ShowFileName = true,
        AllowNext = true,
        AllowPrevious = true,
    };
}

public sealed record YuraiveNode
{
    public required string Type { get; init; }
    public bool Start { get; init; }
    public bool Terminal { get; init; }
    public ScriptCall? Script { get; init; }
    public List<MediaCandidate> Media { get; init; } = [];
    public List<Transition> OnEnd { get; init; } = [];
    public List<string> Buttons { get; init; } = [];
    public string? PlayerControl { get; init; }
    public JsonElement? Editor { get; init; }
}

public sealed record ScriptCall
{
    public required string Path { get; init; }
    public string? Function { get; init; }
}

public sealed record MediaCandidate
{
    public required string Id { get; init; }
    public double Weight { get; init; }
    public required YuraiveMediaSource Source { get; init; }
}

public sealed record YuraiveMediaSource
{
    public required string Type { get; init; }
    public string? Audio { get; init; }
    public string? Image { get; init; }
    public string? Video { get; init; }
    public string? Subtitle { get; init; }
    public string? Visual { get; init; }
    public float Volume { get; init; } = 1f;
    public bool Loop { get; init; }
    public string Fit { get; init; } = "contain";
    public ImageTransition? ImageTransition { get; init; }
}

public sealed record ImageTransition
{
    public required string Type { get; init; }
    public long DurationMs { get; init; }
}

public sealed record Transition
{
    public required string To { get; init; }
    public double Weight { get; init; }
}

public sealed record YuraiveButton
{
    public List<VisibilityRange> Visibility { get; init; } = [];
    public string? TargetSlot { get; init; }
    public int Order { get; init; }
    public int ZIndex { get; init; }
    public string? Text { get; init; }
    public ButtonRenderStyle Style { get; init; } = new();
    public ScriptCall? Render { get; init; }
    public List<Transition> OnPress { get; init; } = [];
    public JsonElement? Editor { get; init; }
}

public sealed record VisibilityRange
{
    public long FromMs { get; init; }
    public long? ToMs { get; init; }
}

public sealed record ButtonRenderStyle
{
    public string? BackgroundColor { get; init; }
    public string? BackgroundImage { get; init; }
    public string? TextColor { get; init; }
    public float? Opacity { get; init; }
    public string? BorderColor { get; init; }
    public float? BorderWidth { get; init; }
    public float? BorderRadius { get; init; }
    public float? FontSize { get; init; }
    public int? FontWeight { get; init; }
    public float? PaddingHorizontal { get; init; }
    public float? PaddingVertical { get; init; }

    public ButtonRenderStyle Merge(ButtonRenderStyle? other) => other is null ? this : this with
    {
        BackgroundColor = other.BackgroundColor ?? BackgroundColor,
        BackgroundImage = other.BackgroundImage ?? BackgroundImage,
        TextColor = other.TextColor ?? TextColor,
        Opacity = other.Opacity ?? Opacity,
        BorderColor = other.BorderColor ?? BorderColor,
        BorderWidth = other.BorderWidth ?? BorderWidth,
        BorderRadius = other.BorderRadius ?? BorderRadius,
        FontSize = other.FontSize ?? FontSize,
        FontWeight = other.FontWeight ?? FontWeight,
        PaddingHorizontal = other.PaddingHorizontal ?? PaddingHorizontal,
        PaddingVertical = other.PaddingVertical ?? PaddingVertical,
    };
}

public sealed record ButtonRenderResult
{
    public bool? Visible { get; init; }
    public string? Text { get; init; }
    public ButtonRenderStyle? Style { get; init; }
}

public sealed record GraphRef
{
    public required string RootUri { get; init; }
    public required string RootName { get; init; }
    public required string RelativePath { get; init; }

    [JsonIgnore] public string FileName => RelativePath.Split('/').LastOrDefault() ?? RelativePath;
    [JsonIgnore] public string ParentPath => RelativePath.Contains('/') ? RelativePath[..RelativePath.LastIndexOf('/')] : "";
    [JsonIgnore] public string ContentFolderName => ParentPath.Split('/').LastOrDefault() is { Length: > 0 } name ? name : RootName;
    [JsonIgnore] public string GraphId => $"{RootUri}::{(RelativePath.EndsWith(".yuraive", StringComparison.OrdinalIgnoreCase) ? RelativePath[..^".yuraive".Length] + ".yuraive.json" : RelativePath)}";
}

public sealed record PlaybackHistoryEntry
{
    public int SchemaVersion { get; init; } = 1;
    public required string Id { get; init; }
    public required string RunId { get; init; }
    public required string GraphId { get; init; }
    public string? ContentId { get; init; }
    public required string NodeId { get; init; }
    public required string MediaId { get; init; }
    public string? Source { get; init; }
    public required string StartedAt { get; init; }
    public required string EndedAt { get; init; }
    public long MediaDurationMs { get; init; }
    public long ActivePlayMs { get; init; }
    public long StartPositionMs { get; init; }
    public long EndPositionMs { get; init; }
    public required string EndReason { get; init; }
}

public sealed record PlaybackSnapshot
{
    public int SchemaVersion { get; init; } = 1;
    public required GraphRef GraphRef { get; init; }
    public required string RunId { get; init; }
    public required string RunStartedAt { get; init; }
    public required string NodeId { get; init; }
    public string? MediaId { get; init; }
    public long PositionMs { get; init; }
    public long DurationMs { get; init; }
    public long NodeElapsedMs { get; init; }
    public string? StartedAt { get; init; }
    public long StartPositionMs { get; init; }
    public long ActivePlayMs { get; init; }
    public bool WasPlaying { get; init; }
    public string? VisualPath { get; init; }
    public bool Completed { get; init; }
    public required string SavedAt { get; init; }
}

public enum ValidationSeverity { Error, Warning }

public sealed record ValidationIssue(ValidationSeverity Severity, string Message, string? Path = null);

public sealed record RenderedButton
{
    public required string Id { get; init; }
    public bool Visible { get; init; }
    public string? TargetSlot { get; init; }
    public int Order { get; init; }
    public int ZIndex { get; init; }
    public required string Text { get; init; }
    public ButtonRenderStyle Style { get; init; } = new();
}

public sealed record NativeLayoutCanvas
{
    public double Width { get; init; }
    public double Height { get; init; }
    public double Density { get; init; } = 1;
    public double FontScale { get; init; } = 1;
    public double SafeTop { get; init; }
    public double SafeRight { get; init; }
    public double SafeBottom { get; init; }
    public double SafeLeft { get; init; }
}

public sealed record NativeLayoutResponse
{
    public IReadOnlyList<NativeLayoutButton> Buttons { get; init; } = [];
    public IReadOnlyList<string> Issues { get; init; } = [];
}

public sealed record NativeLayoutButton
{
    public required string Id { get; init; }
    public required string Text { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public int ZIndex { get; init; }
    public bool Enabled { get; init; }
    public NativeLayoutButtonStyle Style { get; init; } = new();
}

public sealed record NativeLayoutButtonStyle
{
    public string BackgroundColor { get; init; } = "#00000000";
    public string? BackgroundImage { get; init; }
    public string BackgroundSize { get; init; } = "cover";
    public string BackgroundPosition { get; init; } = "center";
    public string BackgroundRepeat { get; init; } = "no-repeat";
    public string TextColor { get; init; } = "#ff000000";
    public double Opacity { get; init; } = 1;
    public string BorderColor { get; init; } = "#00000000";
    public double BorderWidth { get; init; }
    public double BorderRadius { get; init; }
    public double FontSize { get; init; } = 16;
    public int FontWeight { get; init; } = 400;
    public double PaddingLeft { get; init; }
    public double PaddingTop { get; init; }
    public double PaddingRight { get; init; }
    public double PaddingBottom { get; init; }
    public string TextAlign { get; init; } = "center";
    public string VerticalAlign { get; init; } = "center";
    public double LineHeight { get; init; } = 19.2;
    public double LetterSpacing { get; init; }
    public string WhiteSpace { get; init; } = "normal";
    public string TextOverflow { get; init; } = "clip";
    public string Overflow { get; init; } = "visible";
    public string? BoxShadow { get; init; }
    public string? Filter { get; init; }
    public string? Transform { get; init; }
}

public static class WeightedChoice
{
    public static T? Choose<T>(IEnumerable<T> items, Func<T, double> weight, Random? random = null)
    {
        var selectable = items.Where(item => weight(item) is > 0 and var value && double.IsFinite(value)).ToList();
        var total = selectable.Sum(weight);
        if (total <= 0) return default;
        var cursor = (random ?? Random.Shared).NextDouble() * total;
        foreach (var item in selectable)
        {
            cursor -= weight(item);
            if (cursor < 0) return item;
        }
        return selectable.LastOrDefault();
    }
}
