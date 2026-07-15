using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Playback;

public sealed record PlaybackStatsData(string Title, PlaybackStatsAggregate Aggregate, IReadOnlyList<PlaybackStatsItem> Items);
public sealed record PlaybackStatsAggregate(int SessionCount, int EntryCount, long ActivePlayMs, string? FirstStartedAt, string? LastEndedAt);
public sealed record PlaybackStatsSession(
    string RunId,
    string StartedAt,
    string? EndedAt,
    bool IsActive,
    int EntryCount,
    long ActivePlayMs,
    IReadOnlyList<PlaybackHistoryEntry> Entries);
public sealed record PlaybackStatsItem(
    PlaybackStatsSession Session,
    long? SortValue = null,
    DisplayDocument? Display = null,
    ShareData? Share = null,
    string? Error = null);
public sealed record DisplayDocument(string FallbackText, DisplayNode Root);
public sealed record DisplayNode
{
    public required string Type { get; init; }
    public string? Text { get; init; }
    public IReadOnlyList<DisplaySpan> Spans { get; init; } = [];
    public string? Source { get; init; }
    public string? Icon { get; init; }
    public float? Value { get; init; }
    public string? Label { get; init; }
    public DisplayStyle Style { get; init; } = new();
    public IReadOnlyList<DisplayNode> Children { get; init; } = [];
}
public sealed record DisplaySpan(string Text, DisplayStyle Style);
public sealed record DisplayStyle
{
    public DisplayDimension? Width { get; init; }
    public DisplayDimension? Height { get; init; }
    public float? MinHeight { get; init; }
    public float? AspectRatio { get; init; }
    public float? Padding { get; init; }
    public float? Gap { get; init; }
    public string? HorizontalAlignment { get; init; }
    public string? VerticalAlignment { get; init; }
    public string? TextAlign { get; init; }
    public string? BackgroundColor { get; init; }
    public string? BorderColor { get; init; }
    public float? BorderWidth { get; init; }
    public float? CornerRadius { get; init; }
    public float? Opacity { get; init; }
    public string? Color { get; init; }
    public float? FontSize { get; init; }
    public int? FontWeight { get; init; }
    public float? LineHeight { get; init; }
    public int? MaxLines { get; init; }
    public string? Align { get; init; }
    public float? OffsetX { get; init; }
    public float? OffsetY { get; init; }
}
public abstract record DisplayDimension
{
    private DisplayDimension() { }
    public sealed record Fixed(float Value) : DisplayDimension;
    public sealed record Fill : DisplayDimension;
    public sealed record Wrap : DisplayDimension;
}
public sealed record ShareData(string Text, string? Url = null, IReadOnlyList<string>? Hashtags = null, string? Via = null)
{
    public IReadOnlyList<string> SafeHashtags => Hashtags ?? [];
    public string ComposedText() => string.Join('\n', new[]
    {
        Text,
        Url,
        SafeHashtags.Count == 0 ? null : string.Join(' ', SafeHashtags.Select(value => $"#{value}")),
        Via is null ? null : $"@{Via}",
    }.Where(value => !string.IsNullOrEmpty(value)));
}

public sealed class PlaybackStatsEvaluator
{
    private const int MaxCacheEntries = 2_048;
    private readonly DocumentLibrary _library;
    private readonly HistoryStore _historyStore;
    private readonly SettingsStore _settings;
    private readonly StarlarkRuntime _starlark;
    private readonly ConcurrentDictionary<string, PlaybackStatsItem> _cache = new(StringComparer.Ordinal);

    public PlaybackStatsEvaluator(DocumentLibrary library, HistoryStore historyStore, SettingsStore settings)
    {
        _library = library;
        _historyStore = historyStore;
        _settings = settings;
        _starlark = new(library);
    }

    public async Task<PlaybackStatsData> EvaluateAsync(GraphRef reference, PlaybackUiState playback, CancellationToken cancellationToken = default)
    {
        var graph = await _library.ReadGraphAsync(reference, cancellationToken);
        var call = graph.PlaybackStats ?? throw new InvalidOperationException("この作品には再生統計が定義されていません");
        var evaluatedAt = DateTimeOffset.UtcNow.ToString("O");
        var contentId = string.IsNullOrWhiteSpace(graph.Metadata?.ContentId) ? null : graph.Metadata.ContentId;
        var history = (await _historyStore.ReadForContentAsync(contentId, reference.GraphId, cancellationToken)).ToList();
        var activeRunId = playback.GraphRef?.GraphId == reference.GraphId
            && playback.Status is not (PlaybackStatus.Idle or PlaybackStatus.Completed or PlaybackStatus.Error)
            ? playback.RunId
            : null;
        var grouped = history.GroupBy(entry => entry.RunId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
        if (activeRunId is not null && !grouped.ContainsKey(activeRunId)) grouped[activeRunId] = [];
        var sessions = grouped.Select(item =>
        {
            var entries = item.Value.OrderBy(entry => entry.StartedAt, StringComparer.Ordinal).ToList();
            var active = item.Key == activeRunId;
            var startedAt = entries.FirstOrDefault()?.StartedAt
                ?? (active ? playback.RunStartedAt : null)
                ?? evaluatedAt;
            return new PlaybackStatsSession(
                item.Key,
                startedAt,
                active ? null : entries.LastOrDefault()?.EndedAt,
                active,
                entries.Count,
                entries.Sum(entry => entry.ActivePlayMs) + (active && !playback.CurrentFinalized ? playback.CurrentActivePlayMs : 0),
                entries);
        }).ToList();
        var aggregate = new PlaybackStatsAggregate(
            sessions.Count,
            history.Count,
            sessions.Sum(session => session.ActivePlayMs),
            sessions.Select(session => session.StartedAt).Min(StringComparer.Ordinal),
            sessions.Select(session => session.EndedAt).OfType<string>().DefaultIfEmpty().Max(StringComparer.Ordinal));
        var scripts = await _library.ReadScriptSourcesAsync(reference, call.Path, cancellationToken);
        var graphSignature = Signature(YuraiveJson.Serialize(graph));
        var scriptSignature = Signature(string.Concat(scripts.OrderBy(item => item.Key, StringComparer.Ordinal)
            .Select(item => $"{item.Key.Length}:{item.Key}{item.Value.Length}:{item.Value}")));
        var historySignature = Signature(YuraiveJson.Serialize(history));
        var items = new List<PlaybackStatsItem>();
        foreach (var session in sessions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sessionSignature = Signature(string.Join('|', session.Entries.Select(entry => $"{entry.Id}:{entry.ActivePlayMs}")));
            var key = string.Join(':',
                contentId ?? reference.GraphId,
                call.Path,
                call.Function ?? "render_stats",
                graphSignature,
                scriptSignature,
                historySignature,
                session.RunId,
                sessionSignature,
                session.ActivePlayMs,
                session.IsActive,
                aggregate.SessionCount,
                aggregate.EntryCount,
                aggregate.ActivePlayMs);
            if (!_cache.TryGetValue(key, out var item))
            {
                item = await EvaluateSessionAsync(reference, graph, call, scripts, history, session, aggregate, playback, evaluatedAt, cancellationToken);
                if (item.Error is null)
                {
                    if (_cache.Count >= MaxCacheEntries) _cache.Clear();
                    _cache[key] = item;
                }
            }
            items.Add(item);
        }
        var title = string.IsNullOrWhiteSpace(graph.Metadata?.DisplayName) ? reference.ContentFolderName : graph.Metadata.DisplayName;
        return new(title, aggregate, items);
    }

    private async Task<PlaybackStatsItem> EvaluateSessionAsync(
        GraphRef reference,
        YuraiveGraph graph,
        ScriptCall call,
        IReadOnlyDictionary<string, string> scripts,
        IReadOnlyList<PlaybackHistoryEntry> history,
        PlaybackStatsSession session,
        PlaybackStatsAggregate aggregate,
        PlaybackUiState playback,
        string evaluatedAt,
        CancellationToken cancellationToken)
    {
        try
        {
            var context = StatsContext(reference, graph, history, session, aggregate, playback, evaluatedAt);
            var value = await _starlark.RunAsync(reference, call, "render_stats", context, _settings.Current.ScriptTimeoutMs, scripts, cancellationToken);
            return ParseResult(session, value);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return new(session, Error: error.Message.Length == 0 ? "統計スクリプトを実行できません" : error.Message);
        }
    }

    private static JsonElement StatsContext(
        GraphRef reference,
        YuraiveGraph graph,
        IReadOnlyList<PlaybackHistoryEntry> history,
        PlaybackStatsSession session,
        PlaybackStatsAggregate aggregate,
        PlaybackUiState playback,
        string evaluatedAt)
    {
        JsonNode? current = session.IsActive && playback.NodeId is not null ? new JsonObject
        {
            ["nodeId"] = playback.NodeId,
            ["mediaId"] = playback.MediaId,
            ["source"] = playback.SourcePath,
            ["startedAt"] = playback.CurrentStartedAt,
            ["positionMs"] = playback.PositionMs,
            ["mediaDurationMs"] = playback.DurationMs,
            ["activePlayMs"] = playback.CurrentActivePlayMs,
        } : null;
        var result = new JsonObject
        {
            ["now"] = evaluatedAt,
            ["graphId"] = reference.GraphId,
            ["runId"] = session.RunId,
            ["runStartedAt"] = session.StartedAt,
            ["historyStartedAt"] = history.FirstOrDefault()?.StartedAt,
            ["historyEndedAt"] = history.LastOrDefault()?.EndedAt,
            ["historyCount"] = history.Count,
            ["historyActivePlayMs"] = history.Sum(entry => entry.ActivePlayMs),
            ["totalActivePlayMs"] = aggregate.ActivePlayMs,
            ["history"] = JsonSerializer.SerializeToNode(history, YuraiveJson.Options),
            ["current"] = current,
            ["trigger"] = new JsonObject { ["type"] = "stats", ["runId"] = session.RunId },
            ["session"] = new JsonObject
            {
                ["runId"] = session.RunId,
                ["startedAt"] = session.StartedAt,
                ["endedAt"] = session.EndedAt,
                ["isActive"] = session.IsActive,
                ["entryCount"] = session.EntryCount,
                ["activePlayMs"] = session.ActivePlayMs,
                ["entries"] = JsonSerializer.SerializeToNode(session.Entries, YuraiveJson.Options),
            },
            ["aggregate"] = new JsonObject
            {
                ["sessionCount"] = aggregate.SessionCount,
                ["entryCount"] = aggregate.EntryCount,
                ["activePlayMs"] = aggregate.ActivePlayMs,
                ["firstStartedAt"] = aggregate.FirstStartedAt,
                ["lastEndedAt"] = aggregate.LastEndedAt,
            },
        };
        if (!string.IsNullOrWhiteSpace(graph.Metadata?.ContentId)) result["contentId"] = graph.Metadata.ContentId;
        return JsonSerializer.SerializeToElement(result, YuraiveJson.Options);
    }

    private static PlaybackStatsItem ParseResult(PlaybackStatsSession session, JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("render_stats() はオブジェクトを返してください");
        if (!value.TryGetProperty("sortValue", out var sortElement)) throw new InvalidDataException("sortValue は必須です");
        if (sortElement.ValueKind != JsonValueKind.Number || !sortElement.TryGetInt64(out var sortValue))
            throw new InvalidDataException("sortValue は符号付き64 bit整数で指定してください");
        if (!value.TryGetProperty("display", out var rawDisplay) || rawDisplay.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("display は必須です");
        DisplayDocument display;
        try { display = DisplayValidator.Validate(rawDisplay); }
        catch
        {
            var fallback = rawDisplay.TryGetProperty("fallbackText", out var text) && text.ValueKind == JsonValueKind.String
                ? text.GetString()?.Trim()
                : null;
            if (string.IsNullOrWhiteSpace(fallback) || fallback.Length > DisplayValidator.MaxTextLength) throw;
            display = new(fallback, new DisplayNode { Type = "text", Text = fallback });
        }
        ShareData? share = null;
        if (value.TryGetProperty("share", out var rawShare) && rawShare.ValueKind == JsonValueKind.Object)
        {
            try { share = ShareValidator.Validate(rawShare); } catch { }
        }
        return new(session, sortValue, display, share);
    }

    private static string Signature(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}

public static partial class ShareValidator
{
    public static ShareData Validate(JsonElement value)
    {
        var text = String(value, "text")?.Trim();
        if (string.IsNullOrEmpty(text)) throw new InvalidDataException("share.text は必須です");
        if (text.Length > 5_000) throw new InvalidDataException("share.text が長すぎます");
        var url = String(value, "url")?.Trim();
        if (url?.Length == 0) url = null;
        if (url is not null && (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || url.Length > 2_048))
            throw new InvalidDataException("share.url はHTTPS URLで指定してください");
        var hashtags = new List<string>();
        if (value.TryGetProperty("hashtags", out var rawHashtags))
        {
            if (rawHashtags.ValueKind != JsonValueKind.Array) throw new InvalidDataException("share.hashtags は文字列配列で指定してください");
            foreach (var element in rawHashtags.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.String) throw new InvalidDataException("share.hashtags は文字列配列で指定してください");
                hashtags.Add(element.GetString()!.Trim());
            }
        }
        if (hashtags.Count > 10 || hashtags.Any(tag => !Hashtag().IsMatch(tag))) throw new InvalidDataException("share.hashtags が不正です");
        var via = String(value, "via")?.Trim();
        if (via?.Length == 0) via = null;
        if (via is not null && !Via().IsMatch(via)) throw new InvalidDataException("share.via が不正です");
        return new(text, url, hashtags, via);
    }

    private static string? String(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind != JsonValueKind.String) throw new InvalidDataException($"share.{name} は文字列で指定してください");
        return property.GetString();
    }

    [GeneratedRegex("^[^#\\s]{1,50}$")]
    private static partial Regex Hashtag();
    [GeneratedRegex("^[A-Za-z0-9_]{1,15}$")]
    private static partial Regex Via();
}

public static partial class DisplayValidator
{
    public const int MaxTextLength = 4_096;
    private const int MaxNodes = 128;
    private const int MaxDepth = 12;
    private static readonly HashSet<string> Containers = ["column", "row", "stack", "surface"];
    private static readonly HashSet<string> Leaves = ["spacer", "divider", "text", "image", "icon", "badge", "progress"];
    private static readonly HashSet<string> Icons = ["play", "history", "timer", "star", "favorite", "sleep", "trophy", "stats"];

    public static DisplayDocument Validate(JsonElement value)
    {
        if (!value.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var versionNumber) || versionNumber != 1)
            throw new InvalidDataException("display.schemaVersion は1で指定してください");
        var fallback = String(value, "fallbackText")?.Trim();
        if (string.IsNullOrEmpty(fallback)) throw new InvalidDataException("display.fallbackText は必須です");
        if (fallback.Length > MaxTextLength) throw new InvalidDataException("display.fallbackText が長すぎます");
        if (!value.TryGetProperty("root", out var root) || root.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("display.root は必須です");
        var nodes = 0;
        return new(fallback, Node(root, 0, "display.root", ref nodes));
    }

    private static DisplayNode Node(JsonElement value, int depth, string path, ref int nodes)
    {
        if (depth > MaxDepth) throw new InvalidDataException($"{path} の階層が深すぎます");
        if (++nodes > MaxNodes) throw new InvalidDataException("display の要素数が多すぎます");
        var type = String(value, "type") ?? throw new InvalidDataException($"{path}.type は必須です");
        if (!Containers.Contains(type) && !Leaves.Contains(type)) throw new InvalidDataException($"{path}.type は未対応です: {type}");
        var style = value.TryGetProperty("style", out var rawStyle)
            ? rawStyle.ValueKind == JsonValueKind.Object ? Style(rawStyle, $"{path}.style") : throw new InvalidDataException($"{path}.style はオブジェクトで指定してください")
            : new DisplayStyle();
        var children = new List<DisplayNode>();
        if (value.TryGetProperty("children", out var rawChildren))
        {
            if (rawChildren.ValueKind != JsonValueKind.Array) throw new InvalidDataException($"{path}.children は配列で指定してください");
            if (!Containers.Contains(type)) throw new InvalidDataException($"{path} は children を持てません");
            if (rawChildren.GetArrayLength() > 32) throw new InvalidDataException($"{path}.children が多すぎます");
            var index = 0;
            foreach (var child in rawChildren.EnumerateArray())
            {
                if (child.ValueKind != JsonValueKind.Object) throw new InvalidDataException($"{path}.children[{index}] はオブジェクトで指定してください");
                children.Add(Node(child, depth + 1, $"{path}.children[{index}]", ref nodes));
                index++;
            }
        }
        var text = String(value, "text");
        if (text?.Length > MaxTextLength) throw new InvalidDataException($"{path}.text が長すぎます");
        var spans = new List<DisplaySpan>();
        if (value.TryGetProperty("spans", out var rawSpans))
        {
            if (rawSpans.ValueKind != JsonValueKind.Array) throw new InvalidDataException($"{path}.spans は配列で指定してください");
            if (type != "text") throw new InvalidDataException($"{path} は spans を持てません");
            if (rawSpans.GetArrayLength() > 32) throw new InvalidDataException($"{path}.spans が多すぎます");
            var index = 0;
            foreach (var rawSpan in rawSpans.EnumerateArray())
            {
                if (rawSpan.ValueKind != JsonValueKind.Object) throw new InvalidDataException($"{path}.spans[{index}] はオブジェクトで指定してください");
                var spanText = String(rawSpan, "text") ?? throw new InvalidDataException($"{path}.spans[{index}].text は必須です");
                if (spanText.Length > MaxTextLength) throw new InvalidDataException($"{path}.spans[{index}].text が長すぎます");
                var spanStyle = rawSpan.TryGetProperty("style", out var rawSpanStyle)
                    ? rawSpanStyle.ValueKind == JsonValueKind.Object ? Style(rawSpanStyle, $"{path}.spans[{index}].style") : throw new InvalidDataException($"{path}.spans[{index}].style はオブジェクトで指定してください")
                    : new DisplayStyle();
                spans.Add(new(spanText, spanStyle));
                index++;
            }
        }
        if (type == "text" && (text is null) == (spans.Count == 0)) throw new InvalidDataException($"{path} は text または spans のどちらか一方が必要です");
        var source = String(value, "source");
        if (type == "image" && !GraphValidator.IsSafeRelativePath(source)) throw new InvalidDataException($"{path}.source は安全な相対パスで指定してください");
        var icon = String(value, "icon");
        if (type == "icon" && (icon is null || !Icons.Contains(icon))) throw new InvalidDataException($"{path}.icon は未対応です");
        float? progress = null;
        if (value.TryGetProperty("value", out var rawValue))
        {
            if (rawValue.ValueKind != JsonValueKind.Number || !rawValue.TryGetSingle(out var number)) throw new InvalidDataException($"{path}.value は数値で指定してください");
            progress = number;
        }
        if (type == "progress" && (progress is null || !float.IsFinite(progress.Value) || progress is < 0 or > 1))
            throw new InvalidDataException($"{path}.value は0〜1で指定してください");
        var label = String(value, "label");
        if (label?.Length > MaxTextLength) throw new InvalidDataException($"{path}.label が長すぎます");
        if (type == "badge" && string.IsNullOrWhiteSpace(text)) throw new InvalidDataException($"{path}.text は必須です");
        return new()
        {
            Type = type, Text = text, Spans = spans, Source = source, Icon = icon, Value = progress,
            Label = label, Style = style, Children = children,
        };
    }

    private static DisplayStyle Style(JsonElement value, string path) => new()
    {
        Width = Dimension(value, "width", $"{path}.width"),
        Height = Dimension(value, "height", $"{path}.height"),
        MinHeight = Number(value, "minHeight", 0, 1_024, path),
        AspectRatio = Number(value, "aspectRatio", .05, 20, path),
        Padding = Number(value, "padding", 0, 128, path),
        Gap = Number(value, "gap", 0, 128, path),
        HorizontalAlignment = Enum(value, "horizontalAlignment", ["start", "center", "end"], path),
        VerticalAlignment = Enum(value, "verticalAlignment", ["top", "center", "bottom"], path),
        TextAlign = Enum(value, "textAlign", ["start", "center", "end"], path),
        BackgroundColor = Color(value, "backgroundColor", path),
        BorderColor = Color(value, "borderColor", path),
        BorderWidth = Number(value, "borderWidth", 0, 32, path),
        CornerRadius = Number(value, "cornerRadius", 0, 128, path),
        Opacity = Number(value, "opacity", 0, 1, path),
        Color = Color(value, "color", path),
        FontSize = Number(value, "fontSize", 8, 128, path),
        FontWeight = Integer(value, "fontWeight", 100, 900, path),
        LineHeight = Number(value, "lineHeight", 8, 192, path),
        MaxLines = Integer(value, "maxLines", 1, 100, path),
        Align = Enum(value, "align", ["topStart", "topCenter", "topEnd", "centerStart", "center", "centerEnd", "bottomStart", "bottomCenter", "bottomEnd"], path),
        OffsetX = Number(value, "offsetX", -1_024, 1_024, path),
        OffsetY = Number(value, "offsetY", -1_024, 1_024, path),
    };

    private static DisplayDimension? Dimension(JsonElement value, string name, string path)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind == JsonValueKind.Number && property.TryGetSingle(out var number))
        {
            if (!float.IsFinite(number) || number is < 0 or > 2_048) throw new InvalidDataException($"{path} は0〜2048で指定してください");
            return new DisplayDimension.Fixed(number);
        }
        if (property.ValueKind == JsonValueKind.String)
        {
            return property.GetString() switch
            {
                "fill" => new DisplayDimension.Fill(),
                "wrap" => new DisplayDimension.Wrap(),
                _ => throw new InvalidDataException($"{path} は数値、fill、wrapのいずれかで指定してください"),
            };
        }
        throw new InvalidDataException($"{path} は数値、fill、wrapのいずれかで指定してください");
    }

    private static float? Number(JsonElement value, string name, double min, double max, string path)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind != JsonValueKind.Number || !property.TryGetDouble(out var number) || !double.IsFinite(number) || number < min || number > max)
            throw new InvalidDataException($"{path}.{name} は{min}〜{max}で指定してください");
        return (float)number;
    }

    private static int? Integer(JsonElement value, string name, int min, int max, string path)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind != JsonValueKind.Number || !property.TryGetInt32(out var number) || number < min || number > max)
            throw new InvalidDataException($"{path}.{name} は{min}〜{max}で指定してください");
        return number;
    }

    private static string? Enum(JsonElement value, string name, HashSet<string> allowed, string path)
    {
        var result = String(value, name);
        if (result is not null && !allowed.Contains(result)) throw new InvalidDataException($"{path}.{name} が不正です");
        return result;
    }

    private static string? Color(JsonElement value, string name, string path)
    {
        var result = String(value, name);
        if (result is not null && !RgbColor().IsMatch(result)) throw new InvalidDataException($"{path}.{name} は #RRGGBB で指定してください");
        return result;
    }

    private static string? String(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind != JsonValueKind.String) throw new InvalidDataException($"{name} は文字列で指定してください");
        return property.GetString();
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex RgbColor();
}
