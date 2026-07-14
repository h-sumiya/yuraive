using Microsoft.UI.Xaml.Controls;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Storage;
using Windows.Storage.Streams;
using WmgfPlayer.Core.Playback;

namespace WmgfPlayer.App.Playback;

public sealed class WindowsMediaPlaybackAdapter : IMediaPlaybackAdapter
{
    private readonly MediaPlayer _player = new();
    private TaskCompletionSource? _opening;
    private string? _failure;
    private bool _disposed;

    public WindowsMediaPlaybackAdapter(MediaPlayerElement element)
    {
        element.SetMediaPlayer(_player);
        element.AreTransportControlsEnabled = false;
        _player.CommandManager.IsEnabled = true;
        _player.AudioCategory = MediaPlayerAudioCategory.Media;
        _player.MediaOpened += PlayerOnMediaOpened;
        _player.MediaEnded += PlayerOnMediaEnded;
        _player.MediaFailed += PlayerOnMediaFailed;
        _player.PlaybackSession.PlaybackStateChanged += PlaybackSessionOnPlaybackStateChanged;
    }

    public bool HasMedia => _player.Source is not null;
    public bool IsPlaying => _player.PlaybackSession.PlaybackState == MediaPlaybackState.Playing;
    public long PositionMs => Math.Max(0, (long)_player.PlaybackSession.Position.TotalMilliseconds);
    public long DurationMs => Math.Max(0, (long)_player.PlaybackSession.NaturalDuration.TotalMilliseconds);
    public event EventHandler<bool>? IsPlayingChanged;
    public event EventHandler? MediaEnded;
    public event EventHandler<string>? MediaFailed;

    public async Task LoadAsync(MediaLoadRequest request, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Stop();
        _player.Source = null;
        _failure = null;
        _opening = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _player.IsLoopingEnabled = request.Loop;
        _player.Volume = Math.Clamp(request.Volume, 0, 1);
        var source = MediaSource.CreateFromUri(new Uri(request.SourcePath));
        if (request.SubtitlePath is not null)
        {
            try { source.ExternalTimedTextSources.Add(TimedTextSource.CreateFromUri(new Uri(request.SubtitlePath))); }
            catch { }
        }
        await UpdateDisplayAsync(request);
        _player.Source = source;
        try
        {
            await _opening.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
        }
        catch (TimeoutException)
        {
            throw new IOException("メディアの読み込みがタイムアウトしました");
        }
        if (_failure is not null) throw new IOException(_failure);
        var position = Math.Clamp(request.PositionMs, 0, DurationMs > 0 ? DurationMs : long.MaxValue);
        if (position > 0) _player.PlaybackSession.Position = TimeSpan.FromMilliseconds(position);
        if (request.AutoPlay) _player.Play(); else _player.Pause();
    }

    public void Play() { if (!_disposed && HasMedia) _player.Play(); }
    public void Pause() { if (!_disposed) _player.Pause(); }
    public void Stop() { if (!_disposed) _player.Pause(); }
    public void Clear() { if (!_disposed) _player.Source = null; }
    public void Seek(long positionMs)
    {
        if (!_disposed && HasMedia)
            _player.PlaybackSession.Position = TimeSpan.FromMilliseconds(Math.Clamp(positionMs, 0, DurationMs > 0 ? DurationMs : long.MaxValue));
    }

    private async Task UpdateDisplayAsync(MediaLoadRequest request)
    {
        var updater = _player.SystemMediaTransportControls.DisplayUpdater;
        updater.Type = MediaPlaybackType.Music;
        updater.MusicProperties.Title = request.Title;
        updater.MusicProperties.Artist = request.Artist ?? "";
        updater.Thumbnail = null;
        if (request.ArtworkPath is not null)
        {
            try
            {
                var file = await StorageFile.GetFileFromPathAsync(request.ArtworkPath);
                updater.Thumbnail = RandomAccessStreamReference.CreateFromFile(file);
            }
            catch { }
        }
        updater.Update();
    }

    private void PlayerOnMediaOpened(MediaPlayer sender, object args) => _opening?.TrySetResult();
    private void PlayerOnMediaEnded(MediaPlayer sender, object args) => MediaEnded?.Invoke(this, EventArgs.Empty);
    private void PlayerOnMediaFailed(MediaPlayer sender, MediaPlayerFailedEventArgs args)
    {
        _failure = string.IsNullOrWhiteSpace(args.ErrorMessage) ? args.Error.ToString() : args.ErrorMessage;
        _opening?.TrySetResult();
        MediaFailed?.Invoke(this, _failure);
    }
    private void PlaybackSessionOnPlaybackStateChanged(MediaPlaybackSession sender, object args) =>
        IsPlayingChanged?.Invoke(this, sender.PlaybackState == MediaPlaybackState.Playing);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _player.MediaOpened -= PlayerOnMediaOpened;
        _player.MediaEnded -= PlayerOnMediaEnded;
        _player.MediaFailed -= PlayerOnMediaFailed;
        _player.PlaybackSession.PlaybackStateChanged -= PlaybackSessionOnPlaybackStateChanged;
        _player.Dispose();
    }
}
