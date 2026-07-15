using Yuraive.Core.Models;

namespace Yuraive.Core.Playback;

public enum PlaybackStatus { Idle, Loading, Ready, Completed, Error }

public sealed record PlaybackUiState
{
    public PlaybackStatus Status { get; init; } = PlaybackStatus.Idle;
    public GraphRef? GraphRef { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public string? Author { get; init; }
    public IReadOnlyList<SocialLink> SocialLinks { get; init; } = [];
    public string SceneName { get; init; } = "";
    public string FileName { get; init; } = "";
    public string? NodeId { get; init; }
    public string? MediaId { get; init; }
    public string? SourcePath { get; init; }
    public long PositionMs { get; init; }
    public long DurationMs { get; init; }
    public bool IsPlaying { get; init; }
    public bool IsVideo { get; init; }
    public string? VisualPath { get; init; }
    public string Fit { get; init; } = "contain";
    public int ImageTransitionMs { get; init; } = 300;
    public string? LayoutSource { get; init; }
    public IReadOnlyList<RenderedButton> Buttons { get; init; } = [];
    public PlayerControlSettings Controls { get; init; } = PlayerControlSettings.Default;
    public string? ContentId { get; init; }
    public bool HasPlaybackStats { get; init; }
    public string? RunId { get; init; }
    public string? RunStartedAt { get; init; }
    public string? CurrentStartedAt { get; init; }
    public long CurrentActivePlayMs { get; init; }
    public bool CurrentFinalized { get; init; } = true;
    public int HistoryEntryCount { get; init; }
    public bool CanNext { get; init; }
    public bool CanPrevious { get; init; }
    public string? Error { get; init; }
}

public sealed record MediaLoadRequest
{
    public required string SourcePath { get; init; }
    public string? SubtitlePath { get; init; }
    public required string MediaId { get; init; }
    public required string Title { get; init; }
    public string? Artist { get; init; }
    public string? ArtworkPath { get; init; }
    public float Volume { get; init; } = 1;
    public bool Loop { get; init; }
    public long PositionMs { get; init; }
    public bool AutoPlay { get; init; }
}

public interface IMediaPlaybackAdapter : IDisposable
{
    bool HasMedia { get; }
    bool IsPlaying { get; }
    long PositionMs { get; }
    long DurationMs { get; }
    event EventHandler<bool>? IsPlayingChanged;
    event EventHandler? MediaEnded;
    event EventHandler<string>? MediaFailed;
    Task LoadAsync(MediaLoadRequest request, CancellationToken cancellationToken = default);
    void Play();
    void Pause();
    void Stop();
    void Clear();
    void Seek(long positionMs);
}
