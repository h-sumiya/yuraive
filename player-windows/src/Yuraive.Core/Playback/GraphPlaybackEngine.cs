using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Playback;

public sealed class GraphPlaybackEngine : IAsyncDisposable
{
    private const int MaxLayoutBytes = 512 * 1024;
    private readonly DocumentLibrary _library;
    private readonly HistoryStore _historyStore;
    private readonly SnapshotStore _snapshotStore;
    private readonly SettingsStore _settings;
    private readonly StarlarkRuntime _starlark;
    private readonly IMediaPlaybackAdapter _player;
    private readonly SemaphoreSlim _operationGate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Task _ticker;
    private readonly Task _saver;

    private GraphRef? _graphRef;
    private YuraiveGraph? _graph;
    private List<PlaybackHistoryEntry> _history = [];
    private string _runId = "";
    private string _runStartedAt = "";
    private string? _currentNodeId;
    private MediaCandidate? _currentMedia;
    private string? _currentStartedAt;
    private long _currentStartPositionMs;
    private long _activePlayBaseMs;
    private long? _activePlayStartedTimestamp;
    private bool _currentFinalized = true;
    private string? _visualPath;
    private string? _layoutSource;
    private IReadOnlyList<RenderedButton> _baseButtons = [];
    private long _nodeElapsedBaseMs;
    private long _nodeEnteredTimestamp = Stopwatch.GetTimestamp();
    private bool _nodeClockRunning;
    private bool _transitionClaimed;
    private long _mediaGeneration;
    private string? _nonFatalError;

    public GraphPlaybackEngine(
        DocumentLibrary library,
        HistoryStore historyStore,
        SnapshotStore snapshotStore,
        SettingsStore settings,
        IMediaPlaybackAdapter player)
    {
        _library = library;
        _historyStore = historyStore;
        _snapshotStore = snapshotStore;
        _settings = settings;
        _starlark = new(library);
        _player = player;
        _player.IsPlayingChanged += OnIsPlayingChanged;
        _player.MediaEnded += OnMediaEnded;
        _player.MediaFailed += OnMediaFailed;
        _ticker = RunTickerAsync(_lifetime.Token);
        _saver = RunSaverAsync(_lifetime.Token);
    }

    public PlaybackUiState State { get; private set; } = new();
    public event EventHandler<PlaybackUiState>? StateChanged;

    public async Task<bool> RestoreAsync(bool autoPlay = false, CancellationToken cancellationToken = default)
    {
        await _operationGate.WaitAsync(cancellationToken);
        try
        {
            if (_graph is not null) return true;
            var snapshot = await _snapshotStore.LoadAsync(cancellationToken);
            if (snapshot is null) return false;
            try
            {
                var restored = await _library.ReadGraphAsync(snapshot.GraphRef, cancellationToken);
                var errors = (await _library.ValidateAsync(snapshot.GraphRef, restored, cancellationToken))
                    .Where(issue => issue.Severity == ValidationSeverity.Error).ToList();
                if (errors.Count > 0) throw new InvalidDataException(string.Join('\n', errors.Select(issue => issue.Message)));
                _graphRef = snapshot.GraphRef;
                _graph = restored;
                _history = (await _historyStore.ReadAsync(snapshot.GraphRef.GraphId, cancellationToken)).ToList();
                _runId = snapshot.RunId;
                _runStartedAt = snapshot.RunStartedAt;
                _currentNodeId = snapshot.NodeId;
                _currentStartedAt = snapshot.StartedAt;
                _currentStartPositionMs = snapshot.StartPositionMs;
                _activePlayBaseMs = snapshot.ActivePlayMs;
                _visualPath = snapshot.VisualPath;
                _nodeElapsedBaseMs = snapshot.NodeElapsedMs;
                _nodeEnteredTimestamp = Stopwatch.GetTimestamp();
                _nodeClockRunning = !snapshot.Completed;
                _currentFinalized = snapshot.MediaId is null || snapshot.Completed;
                var node = restored.Nodes.GetValueOrDefault(snapshot.NodeId)
                    ?? throw new InvalidDataException("保存されたノードが見つかりません");
                await LoadLayoutAsync(node, cancellationToken);
                _currentMedia = node.Media.FirstOrDefault(media => media.Id == snapshot.MediaId);
                _transitionClaimed = snapshot.Completed;
                if (snapshot.Completed)
                {
                    _player.Clear();
                    _baseButtons = [];
                    Publish(PlaybackStatus.Completed);
                }
                else
                {
                    if (_currentMedia is not null)
                        await PrepareMediaAsync(_currentMedia, snapshot.PositionMs, autoPlay && snapshot.WasPlaying, restoring: true, cancellationToken);
                    _baseButtons = await RenderButtonsAsync(node, cancellationToken);
                    Publish(PlaybackStatus.Ready);
                }
                return true;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                PublishError($"前回の再生状態を復元できません: {error.Message}");
                return false;
            }
        }
        finally { _operationGate.Release(); }
    }

    public Task StartAsync(GraphRef reference, CancellationToken cancellationToken = default) =>
        SerializedAsync(async () =>
        {
            try
            {
                if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("stopped", cancellationToken);
                PublishLoading(reference);
                var loaded = await _library.ReadGraphAsync(reference, cancellationToken);
                var errors = (await _library.ValidateAsync(reference, loaded, cancellationToken))
                    .Where(issue => issue.Severity == ValidationSeverity.Error).ToList();
                if (errors.Count > 0) throw new InvalidDataException(string.Join('\n', errors.Select(issue => issue.Message)));
                _player.Stop();
                _player.Clear();
                _graphRef = reference;
                _graph = loaded;
                _history = (await _historyStore.ReadAsync(reference.GraphId, cancellationToken)).ToList();
                BeginNewRun();
                var start = loaded.Nodes.SingleOrDefault(item => item.Value.Start);
                if (start.Key is null) throw new InvalidDataException("開始ノードが1件ではありません");
                await EnterNodeAsync(start.Key, Trigger("start"), new(StringComparer.Ordinal), null, cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                await FailAsync(error.Message.Length == 0 ? "再生を開始できません" : error.Message, cancellationToken);
            }
        }, cancellationToken);

    public Task RestartAsync(CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        if (_graphRef is null) return;
        try
        {
            if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("restarted", cancellationToken);
            _player.Stop();
            _player.Clear();
            BeginNewRun();
            var start = _graph?.Nodes.SingleOrDefault(item => item.Value.Start);
            if (start?.Key is null) throw new InvalidDataException("開始ノードがありません");
            await EnterNodeAsync(start.Value.Key, Trigger("restart"), new(StringComparer.Ordinal), null, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            await FailAsync(error.Message.Length == 0 ? "再スタートできません" : error.Message, cancellationToken);
        }
    }, cancellationToken);

    public Task NextAsync(CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        if (_graph is null || _currentNodeId is null || !_graph.Nodes.TryGetValue(_currentNodeId, out var node)) return;
        if (!ResolvedControls(node).AllowNext || _transitionClaimed || State.Status == PlaybackStatus.Completed) return;
        _transitionClaimed = true;
        try
        {
            if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("completed", cancellationToken);
            _player.Stop();
            if (node.Terminal)
            {
                FreezeNodeClock();
                _baseButtons = [];
                Publish(PlaybackStatus.Completed);
                await SaveSnapshotAsync(completed: true, cancellationToken);
            }
            else
            {
                var next = WeightedChoice.Choose(node.OnEnd, transition => transition.Weight)
                    ?? throw new InvalidDataException("終了遷移を選択できません");
                await EnterNodeAsync(next.To, Trigger("next"), new(StringComparer.Ordinal), null, cancellationToken);
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            await FailAsync(error.Message.Length == 0 ? "次のシーンへ進めません" : error.Message, cancellationToken);
        }
    }, cancellationToken);

    public Task PreviousAsync(CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        var reference = _graphRef;
        if (reference is null || _graph is null || _currentNodeId is null || !_graph.Nodes.TryGetValue(_currentNodeId, out var node) || !ResolvedControls(node).AllowPrevious) return;
        var runHistory = _history.Where(entry => entry.RunId == _runId).ToList();
        var currentEntry = _currentFinalized
            ? runHistory.LastOrDefault() is { } last && last.NodeId == _currentNodeId && last.MediaId == _currentMedia?.Id ? last : null
            : null;
        var candidates = currentEntry is null ? runHistory : runHistory.Take(Math.Max(0, runHistory.Count - 1)).ToList();
        var target = candidates.LastOrDefault();
        if (target is null) return;
        _transitionClaimed = true;
        try
        {
            DiscardCurrent();
            _player.Stop();
            _player.Clear();
            var removed = new HashSet<string>(StringComparer.Ordinal) { target.Id };
            if (currentEntry is not null) removed.Add(currentEntry.Id);
            await _historyStore.RemoveAsync(reference.GraphId, removed, cancellationToken);
            _history = _history.Where(entry => !removed.Contains(entry.Id)).ToList();
            await EnterNodeAsync(target.NodeId, Trigger("previous"), new(StringComparer.Ordinal), target.MediaId, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            await FailAsync(error.Message.Length == 0 ? "前のシーンへ戻れません" : error.Message, cancellationToken);
        }
    }, cancellationToken);

    public Task ToggleAsync(CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        if (State.Status == PlaybackStatus.Completed)
        {
            var start = _graph?.Nodes.SingleOrDefault(item => item.Value.Start);
            if (start?.Key is null) return;
            _player.Stop();
            _player.Clear();
            BeginNewRun();
            await EnterNodeAsync(start.Value.Key, Trigger("restart"), new(StringComparer.Ordinal), null, cancellationToken);
        }
        else if (_player.HasMedia)
        {
            if (_player.IsPlaying) _player.Pause(); else _player.Play();
        }
    }, cancellationToken);

    public Task SeekAsync(long positionMs, CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        if (!_player.HasMedia || !ResolvedControls().AllowSeek) return;
        _player.Seek(Math.Clamp(positionMs, 0, _player.DurationMs > 0 ? _player.DurationMs : long.MaxValue));
        await SaveSnapshotAsync(cancellationToken: cancellationToken);
    }, cancellationToken);

    public Task PressButtonAsync(string buttonId, CancellationToken cancellationToken = default) => SerializedAsync(async () =>
    {
        if (_graph is null || _currentNodeId is null || !_graph.Nodes.TryGetValue(_currentNodeId, out var node)
            || !node.Buttons.Contains(buttonId, StringComparer.Ordinal) || _transitionClaimed) return;
        if (!VisibleButtons().Any(button => button.Id == buttonId && button.Visible)) return;
        if (!_graph.Buttons.TryGetValue(buttonId, out var button)) return;
        var next = WeightedChoice.Choose(button.OnPress, transition => transition.Weight);
        if (next is null) return;
        _transitionClaimed = true;
        if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("button", cancellationToken);
        _player.Stop();
        await EnterNodeAsync(next.To, Trigger("button", ("buttonId", JsonValue.Create(buttonId)!)), new(StringComparer.Ordinal), null, cancellationToken);
    }, cancellationToken);

    public async Task<bool> StopAsync(CancellationToken cancellationToken = default)
    {
        var stopped = false;
        await SerializedAsync(async () =>
        {
            if (_graph is not null && !ResolvedControls().AllowStop) return;
            if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("stopped", cancellationToken);
            _player.Stop();
            _player.Clear();
            _graph = null;
            _graphRef = null;
            _currentNodeId = null;
            _currentMedia = null;
            _baseButtons = [];
            _layoutSource = null;
            await _snapshotStore.ClearAsync(cancellationToken);
            SetState(new());
            stopped = true;
        }, cancellationToken);
        return stopped;
    }

    private async Task EnterNodeAsync(
        string nodeId,
        JsonObject incomingTrigger,
        HashSet<string> visited,
        string? forcedMediaId,
        CancellationToken cancellationToken)
    {
        var loaded = _graph ?? throw new InvalidOperationException("グラフが読み込まれていません");
        if (!visited.Add(nodeId) || visited.Count > 128) throw new InvalidDataException("0秒遷移の循環を検出しました");
        var node = loaded.Nodes.GetValueOrDefault(nodeId) ?? throw new InvalidDataException($"ノード {nodeId} がありません");
        _transitionClaimed = false;
        _currentNodeId = nodeId;
        _nodeElapsedBaseMs = 0;
        _nodeEnteredTimestamp = Stopwatch.GetTimestamp();
        _nodeClockRunning = true;
        _baseButtons = [];
        _layoutSource = null;
        Publish(PlaybackStatus.Loading);
        if (node.Type == "script")
        {
            var call = node.Script ?? throw new InvalidDataException($"{nodeId} にスクリプトがありません");
            var scriptTrigger = new JsonObject(incomingTrigger.Select(item => KeyValuePair.Create(item.Key, item.Value?.DeepClone())))
            {
                ["scriptNodeId"] = nodeId,
            };
            var result = await RunScriptAsync(call, "jump", ContextJson(scriptTrigger), cancellationToken);
            string next;
            if (result.ValueKind == JsonValueKind.String)
            {
                next = result.GetString()!;
                if (!node.OnEnd.Any(transition => transition.To == next))
                    throw new InvalidDataException($"{nodeId} の jump() が許可されていない遷移先 {next} を返しました");
            }
            else
            {
                if (result.ValueKind != JsonValueKind.Null) throw new InvalidDataException($"{nodeId} の jump() はノードIDまたはNoneを返してください");
                next = WeightedChoice.Choose(node.OnEnd, transition => transition.Weight)?.To
                    ?? throw new InvalidDataException($"{nodeId} の遷移を選択できません");
            }
            await EnterNodeAsync(next, scriptTrigger, visited, null, cancellationToken);
            return;
        }

        _currentMedia = null;
        _currentStartedAt = null;
        _currentStartPositionMs = 0;
        _activePlayBaseMs = 0;
        _activePlayStartedTimestamp = null;
        _currentFinalized = true;
        await LoadLayoutAsync(node, cancellationToken);
        var validButtons = node.Buttons.Where(loaded.Buttons.ContainsKey).ToList();
        var media = forcedMediaId is null
            ? WeightedChoice.Choose(node.Media, value => value.Weight)
            : node.Media.FirstOrDefault(value => value.Id == forcedMediaId) ?? WeightedChoice.Choose(node.Media, value => value.Weight);
        if (media is not null)
        {
            _currentMedia = media;
            _currentStartedAt = Now();
            _currentStartPositionMs = 0;
            _currentFinalized = false;
            await PrepareMediaAsync(media, 0, autoPlay: true, restoring: false, cancellationToken);
            _baseButtons = await RenderButtonsAsync(node, cancellationToken);
            Publish(PlaybackStatus.Ready);
            await SaveSnapshotAsync(cancellationToken: cancellationToken);
            return;
        }

        _player.Stop();
        _player.Clear();
        if (validButtons.Count > 0)
        {
            _baseButtons = await RenderButtonsAsync(node, cancellationToken);
            Publish(PlaybackStatus.Ready);
            await SaveSnapshotAsync(cancellationToken: cancellationToken);
        }
        else if (node.Terminal)
        {
            FreezeNodeClock();
            Publish(PlaybackStatus.Completed);
            await SaveSnapshotAsync(completed: true, cancellationToken);
        }
        else
        {
            var next = WeightedChoice.Choose(node.OnEnd, transition => transition.Weight)
                ?? throw new InvalidDataException($"{nodeId} は再生・ボタン・有効な終了遷移を持ちません");
            await EnterNodeAsync(next.To, Trigger("empty"), visited, null, cancellationToken);
        }
    }

    private async Task PrepareMediaAsync(MediaCandidate media, long positionMs, bool autoPlay, bool restoring, CancellationToken cancellationToken)
    {
        var reference = _graphRef ?? throw new InvalidOperationException("グラフ参照がありません");
        var source = media.Source;
        var sourcePath = source.Video ?? source.Audio ?? throw new InvalidDataException($"{media.Id} に再生ソースがありません");
        var fullPath = _library.GetAssetPath(reference, sourcePath) ?? throw new FileNotFoundException($"ファイルが見つかりません: {sourcePath}");
        switch (source.Type)
        {
            case "audioImage": _visualPath = source.Image; break;
            case "audio" when source.Visual == "clear": _visualPath = null; break;
        }
        var metadata = _graph?.Metadata;
        await _player.LoadAsync(new()
        {
            SourcePath = fullPath,
            SubtitlePath = source.Subtitle is null ? null : _library.GetAssetPath(reference, source.Subtitle),
            MediaId = $"{_runId}:{++_mediaGeneration}:{reference.GraphId}#{_currentNodeId}/{media.Id}",
            Title = string.IsNullOrWhiteSpace(metadata?.DisplayName) ? reference.ContentFolderName : metadata.DisplayName,
            Artist = metadata?.Author,
            ArtworkPath = _visualPath is null ? null : _library.GetAssetPath(reference, _visualPath),
            Volume = Math.Clamp(source.Volume, 0, 1),
            Loop = source.Loop,
            PositionMs = Math.Max(0, positionMs),
            AutoPlay = autoPlay,
        }, cancellationToken);
        if (!restoring)
        {
            _activePlayBaseMs = 0;
            _activePlayStartedTimestamp = null;
        }
    }

    private void BeginNewRun()
    {
        _runId = Guid.NewGuid().ToString();
        _runStartedAt = Now();
        _currentNodeId = null;
        _currentMedia = null;
        _currentStartedAt = null;
        _currentStartPositionMs = 0;
        _activePlayBaseMs = 0;
        _activePlayStartedTimestamp = null;
        _currentFinalized = true;
        _visualPath = null;
        _layoutSource = null;
        _baseButtons = [];
        _nodeElapsedBaseMs = 0;
        _nodeClockRunning = false;
        _transitionClaimed = false;
        _mediaGeneration = 0;
        _nonFatalError = null;
    }

    private async Task<IReadOnlyList<RenderedButton>> RenderButtonsAsync(YuraiveNode node, CancellationToken cancellationToken)
    {
        if (_graph is null) return [];
        var rendered = new List<RenderedButton>();
        foreach (var id in node.Buttons)
        {
            if (!_graph.Buttons.TryGetValue(id, out var button)) continue;
            ButtonRenderResult? result = null;
            if (button.Render is not null)
            {
                try
                {
                    var value = await RunScriptAsync(button.Render, "render", ContextJson(Trigger("render", ("buttonId", JsonValue.Create(id)!))), cancellationToken);
                    result = JsonSerializer.Deserialize<ButtonRenderResult>(value.GetRawText(), YuraiveJson.Options);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    _nonFatalError = $"ボタン {id} の表示スクリプト: {error.Message}";
                    result = new() { Visible = false };
                }
            }
            rendered.Add(new()
            {
                Id = id,
                Visible = result?.Visible ?? true,
                TargetSlot = button.TargetSlot,
                Order = button.Order,
                ZIndex = button.ZIndex,
                Text = result?.Text ?? button.Text ?? id,
                Style = button.Style.Merge(result?.Style),
            });
        }
        return rendered;
    }

    private IReadOnlyList<RenderedButton> VisibleButtons()
    {
        if (_graph is null) return [];
        var elapsed = NodeElapsedNow();
        return _baseButtons.Select(rendered =>
        {
            var ranges = _graph.Buttons.GetValueOrDefault(rendered.Id)?.Visibility ?? [];
            var inRange = ranges.Count == 0 || ranges.Any(range => elapsed >= range.FromMs && (range.ToMs is null || elapsed < range.ToMs));
            return rendered with { Visible = rendered.Visible && inRange };
        }).OrderBy(button => button.Order).ThenBy(button => button.ZIndex).ToList();
    }

    private async Task FinalizeCurrentAsync(string reason, CancellationToken cancellationToken)
    {
        if (_graphRef is null || _currentNodeId is null || _currentMedia is null || _currentFinalized) return;
        AccumulateActiveTime();
        var entry = new PlaybackHistoryEntry
        {
            Id = Guid.NewGuid().ToString(),
            RunId = _runId,
            GraphId = _graphRef.GraphId,
            ContentId = string.IsNullOrWhiteSpace(_graph?.Metadata?.ContentId) ? null : _graph.Metadata.ContentId,
            NodeId = _currentNodeId,
            MediaId = _currentMedia.Id,
            Source = _currentMedia.Source.Video ?? _currentMedia.Source.Audio,
            StartedAt = _currentStartedAt ?? Now(),
            EndedAt = Now(),
            MediaDurationMs = Math.Max(0, _player.DurationMs),
            ActivePlayMs = _activePlayBaseMs,
            StartPositionMs = _currentStartPositionMs,
            EndPositionMs = CurrentPositionMs(),
            EndReason = reason,
        };
        await _historyStore.AppendAsync(entry, cancellationToken);
        _history = _history.Append(entry).TakeLast(HistoryStore.MaxEntries).ToList();
        _currentFinalized = true;
    }

    private JsonElement ContextJson(JsonObject trigger)
    {
        AccumulateActiveTime();
        JsonNode? current = null;
        if (_currentNodeId is not null)
        {
            current = new JsonObject
            {
                ["nodeId"] = _currentNodeId,
                ["mediaId"] = _currentMedia?.Id,
                ["source"] = _currentMedia?.Source.Video ?? _currentMedia?.Source.Audio,
                ["startedAt"] = _currentStartedAt,
                ["positionMs"] = CurrentPositionMs(),
                ["mediaDurationMs"] = Math.Max(0, _player.DurationMs),
                ["activePlayMs"] = _activePlayBaseMs,
            };
        }
        var historyActive = _history.Sum(entry => entry.ActivePlayMs);
        var value = new JsonObject
        {
            ["now"] = Now(),
            ["graphId"] = _graphRef?.GraphId ?? "",
            ["runId"] = _runId,
            ["runStartedAt"] = _runStartedAt,
            ["historyStartedAt"] = _history.FirstOrDefault()?.StartedAt,
            ["historyEndedAt"] = _history.LastOrDefault()?.EndedAt,
            ["historyCount"] = _history.Count,
            ["historyActivePlayMs"] = historyActive,
            ["totalActivePlayMs"] = historyActive + (_currentFinalized ? 0 : _activePlayBaseMs),
            ["history"] = JsonSerializer.SerializeToNode(_history, YuraiveJson.Options),
            ["current"] = current,
            ["trigger"] = trigger.DeepClone(),
        };
        return JsonSerializer.SerializeToElement(value, YuraiveJson.Options);
    }

    private Task<JsonElement> RunScriptAsync(ScriptCall call, string defaultFunction, JsonElement context, CancellationToken cancellationToken)
    {
        var reference = _graphRef ?? throw new InvalidOperationException("グラフ参照がありません");
        return _starlark.RunAsync(reference, call, defaultFunction, context, _settings.Current.ScriptTimeoutMs, cancellationToken: cancellationToken);
    }

    private void Publish(PlaybackStatus status)
    {
        var node = _graph is not null && _currentNodeId is not null ? _graph.Nodes.GetValueOrDefault(_currentNodeId) : null;
        var controls = ResolvedControls(node);
        var runHistory = _history.Where(entry => entry.RunId == _runId).ToList();
        var completedCurrentIsLast = _currentFinalized && runHistory.LastOrDefault() is { } last
            && last.NodeId == _currentNodeId && last.MediaId == _currentMedia?.Id;
        var previousCandidates = completedCurrentIsLast ? runHistory.Take(Math.Max(0, runHistory.Count - 1)) : runHistory;
        var metadata = _graph?.Metadata;
        SetState(new()
        {
            Status = status,
            GraphRef = _graphRef,
            Title = string.IsNullOrWhiteSpace(metadata?.DisplayName) ? _graphRef?.ContentFolderName ?? "" : metadata.DisplayName,
            Description = string.IsNullOrWhiteSpace(metadata?.Description) ? null : metadata.Description,
            Author = string.IsNullOrWhiteSpace(metadata?.Author) ? null : metadata.Author,
            SocialLinks = metadata?.SocialLinks ?? [],
            SceneName = SceneLabel(node) ?? _currentNodeId ?? "",
            FileName = (_currentMedia?.Source.Video ?? _currentMedia?.Source.Audio)?.Split('/').LastOrDefault() ?? "",
            NodeId = _currentNodeId,
            MediaId = _currentMedia?.Id,
            SourcePath = _currentMedia?.Source.Video ?? _currentMedia?.Source.Audio,
            PositionMs = _player.HasMedia ? CurrentPositionMs() : 0,
            DurationMs = _player.HasMedia ? Math.Max(0, _player.DurationMs) : 0,
            IsPlaying = _player.IsPlaying,
            IsVideo = _currentMedia?.Source.Type == "video",
            VisualPath = _currentMedia?.Source.Type == "video" ? null : _visualPath,
            Fit = _currentMedia?.Source.Fit ?? "contain",
            ImageTransitionMs = (int)Math.Clamp(_currentMedia?.Source.ImageTransition?.DurationMs ?? 300, 0, 10_000),
            LayoutSource = _layoutSource,
            Buttons = VisibleButtons(),
            Controls = controls,
            ContentId = string.IsNullOrWhiteSpace(metadata?.ContentId) ? null : metadata.ContentId,
            HasPlaybackStats = _graph?.PlaybackStats is not null,
            RunId = string.IsNullOrWhiteSpace(_runId) ? null : _runId,
            RunStartedAt = string.IsNullOrWhiteSpace(_runStartedAt) ? null : _runStartedAt,
            CurrentStartedAt = _currentStartedAt,
            CurrentActivePlayMs = _currentFinalized ? 0 : ActivePlayNow(),
            CurrentFinalized = _currentFinalized,
            HistoryEntryCount = _history.Count,
            CanNext = controls.AllowNext && status != PlaybackStatus.Completed && (node?.Terminal == true || node?.OnEnd.Count > 0),
            CanPrevious = controls.AllowPrevious && previousCandidates.Any(),
            Error = _nonFatalError,
        });
    }

    private void PublishLoading(GraphRef reference) => SetState(new()
    {
        Status = PlaybackStatus.Loading,
        GraphRef = reference,
        Title = reference.ContentFolderName,
    });

    private void PublishError(string message) => SetState(State with
    {
        Status = PlaybackStatus.Error,
        IsPlaying = false,
        Error = message,
        Buttons = [],
    });

    private async Task FailAsync(string message, CancellationToken cancellationToken)
    {
        try { if (_currentMedia is not null && !_currentFinalized) await FinalizeCurrentAsync("error", cancellationToken); }
        catch { }
        _player.Pause();
        _transitionClaimed = true;
        PublishError(message);
        await SaveSnapshotAsync(cancellationToken: cancellationToken);
    }

    private async Task SaveSnapshotAsync(bool? completed = null, CancellationToken cancellationToken = default)
    {
        if (_graphRef is null || _currentNodeId is null || State.Status is not (PlaybackStatus.Ready or PlaybackStatus.Completed or PlaybackStatus.Error)) return;
        if (_graph?.Nodes.GetValueOrDefault(_currentNodeId)?.Type != "media") return;
        AccumulateActiveTime();
        try
        {
            await _snapshotStore.SaveAsync(new()
            {
                GraphRef = _graphRef,
                RunId = _runId,
                RunStartedAt = _runStartedAt,
                NodeId = _currentNodeId,
                MediaId = _currentMedia?.Id,
                PositionMs = _player.HasMedia ? CurrentPositionMs() : 0,
                DurationMs = _player.HasMedia ? Math.Max(0, _player.DurationMs) : 0,
                NodeElapsedMs = NodeElapsedNow(),
                StartedAt = _currentStartedAt,
                StartPositionMs = _currentStartPositionMs,
                ActivePlayMs = _activePlayBaseMs,
                WasPlaying = _player.IsPlaying,
                VisualPath = _visualPath,
                Completed = completed ?? State.Status == PlaybackStatus.Completed,
                SavedAt = Now(),
            }, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            Debug.WriteLine($"Unable to persist playback snapshot: {error}");
        }
    }

    private PlayerControlSettings ResolvedControls(YuraiveNode? node = null)
    {
        if (_graph is null) return PlayerControlSettings.Default;
        node ??= _currentNodeId is null ? null : _graph.Nodes.GetValueOrDefault(_currentNodeId);
        var controlId = node?.PlayerControl ?? _graph.GlobalPlayerControl;
        var defined = controlId is not null && _graph.PlayerControls.TryGetValue(controlId, out var value)
            ? value
            : PlayerControlSettings.Default;
        return _settings.Current.ForceShowPlayerControls
            ? PlayerControlSettings.AllEnabled with { AccentColor = defined.AccentColor, Layout = defined.Layout }
            : defined;
    }

    private async Task LoadLayoutAsync(YuraiveNode node, CancellationToken cancellationToken)
    {
        if (_graphRef is null) throw new InvalidOperationException("グラフ参照がありません");
        var layout = ResolvedControls(node).Layout;
        _layoutSource = layout is null ? null : await _library.ReadAssetTextAsync(_graphRef, layout, MaxLayoutBytes, cancellationToken);
    }

    private void OnIsPlayingChanged(object? sender, bool isPlaying) => _ = SerializedAsync(async () =>
    {
        var now = Stopwatch.GetTimestamp();
        if (isPlaying)
        {
            _activePlayStartedTimestamp ??= now;
        }
        else
        {
            if (_activePlayStartedTimestamp is { } started) _activePlayBaseMs += ElapsedMs(started, now);
            _activePlayStartedTimestamp = null;
        }
        if (State.Status != PlaybackStatus.Idle && _graphRef is not null) Publish(State.Status);
        await SaveSnapshotAsync(cancellationToken: _lifetime.Token);
    }, _lifetime.Token);

    private void OnMediaEnded(object? sender, EventArgs args) => _ = SerializedAsync(async () =>
    {
        if (_transitionClaimed || _currentMedia?.Source.Loop == true) return;
        _transitionClaimed = true;
        try
        {
            if (_graph is null || _currentNodeId is null || !_graph.Nodes.TryGetValue(_currentNodeId, out var node)) return;
            await FinalizeCurrentAsync("completed", _lifetime.Token);
            if (node.Terminal)
            {
                FreezeNodeClock();
                _baseButtons = [];
                Publish(PlaybackStatus.Completed);
                await SaveSnapshotAsync(completed: true, _lifetime.Token);
            }
            else
            {
                var next = WeightedChoice.Choose(node.OnEnd, transition => transition.Weight)
                    ?? throw new InvalidDataException("終了遷移を選択できません");
                await EnterNodeAsync(next.To, Trigger("end"), new(StringComparer.Ordinal), null, _lifetime.Token);
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            await FailAsync(error.Message.Length == 0 ? "終了遷移に失敗しました" : error.Message, _lifetime.Token);
        }
    }, _lifetime.Token);

    private void OnMediaFailed(object? sender, string message) => _ = SerializedAsync(
        () => FailAsync($"メディアを再生できません: {message}", _lifetime.Token),
        _lifetime.Token);

    private async Task RunTickerAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await SerializedAsync(() =>
                {
                    if (State.Status != PlaybackStatus.Idle && _graphRef is not null) Publish(State.Status);
                    return Task.CompletedTask;
                }, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private async Task RunSaverAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await SerializedAsync(
                    () => State.Status == PlaybackStatus.Completed ? Task.CompletedTask : SaveSnapshotAsync(cancellationToken: cancellationToken),
                    cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private async Task SerializedAsync(Func<Task> operation, CancellationToken cancellationToken)
    {
        try
        {
            await _operationGate.WaitAsync(cancellationToken);
            try { await operation(); }
            finally { _operationGate.Release(); }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private void SetState(PlaybackUiState value)
    {
        State = value;
        StateChanged?.Invoke(this, value);
    }

    private void AccumulateActiveTime()
    {
        if (_activePlayStartedTimestamp is not { } started) return;
        var current = Stopwatch.GetTimestamp();
        _activePlayBaseMs += ElapsedMs(started, current);
        _activePlayStartedTimestamp = current;
    }

    private long ActivePlayNow() => _activePlayBaseMs + (_activePlayStartedTimestamp is { } started ? ElapsedMs(started, Stopwatch.GetTimestamp()) : 0);
    private long CurrentPositionMs() => Math.Clamp(_player.PositionMs, 0, _player.DurationMs >= 0 ? _player.DurationMs : long.MaxValue);
    private long NodeElapsedNow() => _nodeElapsedBaseMs + (_nodeClockRunning ? ElapsedMs(_nodeEnteredTimestamp, Stopwatch.GetTimestamp()) : 0);

    private void FreezeNodeClock()
    {
        _nodeElapsedBaseMs = NodeElapsedNow();
        _nodeEnteredTimestamp = Stopwatch.GetTimestamp();
        _nodeClockRunning = false;
    }

    private void DiscardCurrent()
    {
        AccumulateActiveTime();
        _activePlayStartedTimestamp = null;
        _currentFinalized = true;
    }

    private static long ElapsedMs(long start, long end) => Math.Max(0, (long)((end - start) * 1_000d / Stopwatch.Frequency));
    private static string Now() => DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);

    private static JsonObject Trigger(string type, params (string Key, JsonNode Value)[] values)
    {
        var result = new JsonObject { ["type"] = type };
        foreach (var (key, value) in values) result[key] = value.DeepClone();
        return result;
    }

    private static string? SceneLabel(YuraiveNode? node)
    {
        if (node?.Editor is not { ValueKind: JsonValueKind.Object } editor) return null;
        return editor.TryGetProperty("label", out var label) && label.ValueKind == JsonValueKind.String ? label.GetString() : null;
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        _player.IsPlayingChanged -= OnIsPlayingChanged;
        _player.MediaEnded -= OnMediaEnded;
        _player.MediaFailed -= OnMediaFailed;
        try { await Task.WhenAll(_ticker, _saver); } catch (OperationCanceledException) { }
        _player.Dispose();
        _operationGate.Dispose();
        _lifetime.Dispose();
    }
}
