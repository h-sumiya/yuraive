using System.Collections.ObjectModel;
using System.Globalization;
using System.Numerics;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using QRCoder;
using Windows.Graphics;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using Windows.System;
using Windows.System.Display;
using WinRT.Interop;
using Yuraive.App.Playback;
using Yuraive.Core;
using Yuraive.Core.Bridge;
using Yuraive.Core.Models;
using Yuraive.Core.Playback;
using Yuraive.Core.Storage;

namespace Yuraive.App;

public sealed partial class MainWindow : Window
{
    private void Engine_StateChanged(object? sender, PlaybackUiState state)
    {
        DispatcherQueue.TryEnqueue(() => ApplyPlaybackState(state));
    }

    private void ApplyPlaybackState(PlaybackUiState state)
    {
        _lastPlaybackState = state;
        var hasSelection = state.GraphRef is not null;
        PlayerEmptyState.Visibility = hasSelection ? Visibility.Collapsed : Visibility.Visible;
        PlayerContent.Visibility = hasSelection ? Visibility.Visible : Visibility.Collapsed;
        if (!hasSelection)
        {
            _showPlayerOnNarrow = false;
            MiniPlayer.Visibility = Visibility.Collapsed;
            UpdateArtworkSources(state);
            UpdateAdaptiveLayout();
            UpdateDisplayRequest(false);
            return;
        }

        PlayerTitle.Text = state.Title;
        PortraitPlayerTitle.Text = state.Title;
        PlayerSceneName.Text = state.Controls.ShowSceneName ? HiddenOrValue(state.SceneName) : "???";
        PlayerFileName.Text = state.Controls.ShowFileName ? HiddenOrValue(state.FileName) : "???";
        MiniTitle.Text = state.Title;
        MiniSecondary.Text = state.Error ?? PlayerSecondaryLabel(state);
        var statusText = state.Status switch
        {
            PlaybackStatus.Loading => "読み込み中",
            PlaybackStatus.Completed => "再生完了",
            PlaybackStatus.Error => "エラー",
            _ when state.IsPlaying => "再生中",
            _ => "一時停止",
        };
        PlayerStatusText.Text = statusText;
        PortraitPlayerStatusText.Text = statusText;
        PlayerProgress.IsActive = state.Status == PlaybackStatus.Loading;
        PlayerProgress.Visibility = state.Status == PlaybackStatus.Loading ? Visibility.Visible : Visibility.Collapsed;
        PlayerErrorBar.IsOpen = state.Error is not null;
        PlayerErrorBar.Title = state.Status == PlaybackStatus.Error ? "再生エラー" : "一部を表示できません";
        PlayerErrorBar.Message = state.Error ?? "";
        MediaElement.Visibility = state.IsVideo ? Visibility.Visible : Visibility.Collapsed;
        ArtworkImageLayer.Visibility = state.IsVideo ? Visibility.Collapsed : Visibility.Visible;
        UpdateArtworkSources(state);

        if (!_sliderDragging)
        {
            _updatingSliderFromPlayback = true;
            try
            {
                PositionSlider.Maximum = Math.Max(1, state.DurationMs);
                PositionSlider.Value = Math.Clamp(state.PositionMs, 0, Math.Max(1, state.DurationMs));
            }
            finally { _updatingSliderFromPlayback = false; }
        }
        PositionSlider.IsEnabled = state.Controls.AllowSeek && state.DurationMs > 0;
        var showsWaveform = !state.Controls.ShowSeekBar || !state.Controls.AllowSeek;
        PositionSlider.Visibility = showsWaveform ? Visibility.Collapsed : Visibility.Visible;
        PlaybackWaveform.Visibility = showsWaveform ? Visibility.Visible : Visibility.Collapsed;
        SetPlaybackWaveformAnimation(showsWaveform && state.IsPlaying);
        PositionText.Visibility = state.Controls.ShowPlaybackTime ? Visibility.Visible : Visibility.Collapsed;
        DurationText.Visibility = state.Controls.ShowPlaybackTime ? Visibility.Visible : Visibility.Collapsed;
        PositionText.Text = FormatDuration(state.PositionMs);
        DurationText.Text = FormatDuration(state.DurationMs);
        PlayPauseIcon.Glyph = state.IsPlaying ? "\uE769" : "\uE768";
        MiniPlayPauseIcon.Glyph = PlayPauseIcon.Glyph;
        PlayPauseButton.IsEnabled = state.Status is PlaybackStatus.Ready or PlaybackStatus.Completed;
        MiniPlayPauseButton.IsEnabled = PlayPauseButton.IsEnabled;
        MiniStopButton.IsEnabled = state.Controls.AllowStop && state.Status != PlaybackStatus.Loading;
        PreviousButton.Visibility = Visibility.Visible;
        PreviousButton.IsEnabled = state.Controls.AllowPrevious && state.CanPrevious;
        NextButton.Visibility = Visibility.Visible;
        NextButton.IsEnabled = state.Controls.AllowNext && state.CanNext;
        StopButton.Visibility = Visibility.Collapsed;
        StatsButton.Visibility = Visibility.Visible;
        StatsButton.IsEnabled = state.HasPlaybackStats;
        ApplyAccent(_showPlayerOnNarrow ? state.Controls.AccentColor : null);
        UpdateFavoriteIcon(state);
        UpdateButtonLayout(state);
        UpdateDisplayRequest(_settings.Current.KeepScreenOnInPlayer && state.IsPlaying);
        UpdateAdaptiveLayout();
    }

    private void UpdateArtworkSources(PlaybackUiState state)
    {
        var artworkPath = ResolveArtworkPath(state);
        if (string.Equals(_artworkSourcePath, artworkPath, StringComparison.OrdinalIgnoreCase)) return;

        _artworkSourcePath = artworkPath;
        var loadVersion = ++_artworkLoadVersion;
        ArtworkBackgroundImage.Source = null;
        ArtworkImage.Source = null;
        MiniArtworkImage.Source = null;
        PlayerArtworkFallback.Visibility = state.IsVideo ? Visibility.Collapsed : Visibility.Visible;
        if (artworkPath is null)
            return;

        _ = LoadArtworkSourcesAsync(artworkPath, loadVersion);
    }

    private string? ResolveArtworkPath(PlaybackUiState state)
    {
        if (state.IsVideo || state.GraphRef is null) return null;
        if (state.VisualPath is not null && _library.GetAssetPath(state.GraphRef, state.VisualPath) is { } visual)
            return visual;
        var graph = _library.KnownGraphs.FirstOrDefault(value =>
            string.Equals(value.Ref.GraphId, state.GraphRef.GraphId, StringComparison.Ordinal));
        return graph?.ThumbnailPath is { } thumbnail ? _library.GetAssetPath(state.GraphRef, thumbnail) : null;
    }

    private async Task LoadArtworkSourcesAsync(string artworkPath, int loadVersion)
    {
        try
        {
            var file = await StorageFile.GetFileFromPathAsync(artworkPath);
            var foregroundTask = LoadBitmapAsync(file, 1_200);
            var backgroundTask = LoadBitmapAsync(file, 48);
            var miniTask = LoadBitmapAsync(file, 180);
            await Task.WhenAll(foregroundTask, backgroundTask, miniTask);
            if (loadVersion != _artworkLoadVersion) return;
            ArtworkImage.Source = foregroundTask.Result;
            ArtworkBackgroundImage.Source = backgroundTask.Result;
            MiniArtworkImage.Source = miniTask.Result;
            PlayerArtworkFallback.Visibility = Visibility.Collapsed;
        }
        catch
        {
            if (loadVersion != _artworkLoadVersion) return;
            ArtworkBackgroundImage.Source = null;
            ArtworkImage.Source = null;
            MiniArtworkImage.Source = null;
            PlayerArtworkFallback.Visibility = Visibility.Visible;
        }
    }

    private static async Task<BitmapImage> LoadBitmapAsync(StorageFile file, int decodePixelWidth)
    {
        using var stream = await file.OpenReadAsync();
        var source = new BitmapImage { DecodePixelWidth = decodePixelWidth };
        await source.SetSourceAsync(stream);
        return source;
    }

    private void InitializePlaybackWaveform()
    {
        var fill = Application.Current.Resources["PlayerAccentBrush"] as Brush;
        for (var index = 0; index < 32; index++)
        {
            var bar = new Microsoft.UI.Xaml.Shapes.Rectangle { Fill = fill, RadiusX = 2, RadiusY = 2 };
            _waveformBars.Add(bar);
            PlaybackWaveform.Children.Add(bar);
        }
        PlaybackWaveform.SizeChanged += (_, _) =>
        {
            LayoutPlaybackWaveform();
            if (_waveformAnimating) StartPlaybackWaveformAnimations();
        };
    }

    private void LayoutPlaybackWaveform()
    {
        var width = PlaybackWaveform.ActualWidth;
        var height = PlaybackWaveform.ActualHeight;
        if (width <= 0 || height <= 0) return;

        var step = width / _waveformBars.Count;
        var stroke = Math.Min(step * .32, 4);
        for (var index = 0; index < _waveformBars.Count; index++)
        {
            var seed = (index * 37 % 17) / 16d;
            var bar = _waveformBars[index];
            bar.Width = stroke;
            bar.Height = height;
            bar.Opacity = _waveformAnimating ? .58 + seed * .38 : .24 + seed * .14;
            Canvas.SetLeft(bar, step * (index + .5) - stroke / 2);
            Canvas.SetTop(bar, 0);
            var visual = ElementCompositionPreview.GetElementVisual(bar);
            visual.CenterPoint = new Vector3((float)(stroke / 2), (float)(height / 2), 0);
            if (!_waveformAnimating)
                visual.Scale = new Vector3(1, (float)(.18 + seed * .34), 1);
        }
    }

    private void SetPlaybackWaveformAnimation(bool active)
    {
        if (_waveformAnimating == active) return;
        _waveformAnimating = active;
        LayoutPlaybackWaveform();
        if (active) StartPlaybackWaveformAnimations();
        else StopPlaybackWaveformAnimations();
    }

    private void StartPlaybackWaveformAnimations()
    {
        if (PlaybackWaveform.ActualWidth <= 0 || PlaybackWaveform.ActualHeight <= 0) return;
        var compositor = ElementCompositionPreview.GetElementVisual(PlaybackWaveform).Compositor;
        for (var index = 0; index < _waveformBars.Count; index++)
        {
            var seed = (index * 37 % 17) / 16f;
            var low = .14f + seed * .12f;
            var high = .52f + seed * .40f;
            var visual = ElementCompositionPreview.GetElementVisual(_waveformBars[index]);
            visual.StopAnimation("Scale.Y");
            visual.Scale = new Vector3(1, low, 1);
            var animation = compositor.CreateScalarKeyFrameAnimation();
            animation.InsertKeyFrame(0, low);
            animation.InsertKeyFrame(.24f, high);
            animation.InsertKeyFrame(.52f, .22f + seed * .42f);
            animation.InsertKeyFrame(.78f, .42f + (1 - seed) * .42f);
            animation.InsertKeyFrame(1, low);
            animation.Duration = TimeSpan.FromMilliseconds(920 + index % 7 * 95);
            animation.DelayTime = TimeSpan.FromMilliseconds(index % 8 * 28);
            animation.IterationBehavior = AnimationIterationBehavior.Forever;
            visual.StartAnimation("Scale.Y", animation);
        }
    }

    private void StopPlaybackWaveformAnimations()
    {
        for (var index = 0; index < _waveformBars.Count; index++)
        {
            var seed = (index * 37 % 17) / 16f;
            var visual = ElementCompositionPreview.GetElementVisual(_waveformBars[index]);
            visual.StopAnimation("Scale.Y");
            visual.Scale = new Vector3(1, .18f + seed * .34f, 1);
            _waveformBars[index].Opacity = .24 + seed * .14;
        }
    }

    private void UpdateButtonLayout(PlaybackUiState state)
    {
        var reference = state.GraphRef;
        if (state.LayoutSource is null || reference is null)
        {
            ButtonLayout.Update(null, [], null, null);
            return;
        }
        ButtonLayout.Update(state.LayoutSource, state.Buttons, reference.GraphId, path => _library.GetAssetPath(reference, path));
    }

    private async void PlayPauseButton_Click(object sender, RoutedEventArgs e) => await _engine.ToggleAsync();
    private async void PreviousButton_Click(object sender, RoutedEventArgs e) => await _engine.PreviousAsync();
    private async void NextButton_Click(object sender, RoutedEventArgs e) => await _engine.NextAsync();
    private async void StopButton_Click(object sender, RoutedEventArgs e) => await _engine.StopAsync();
    private async void MiniPlayer_Click(object sender, RoutedEventArgs e)
    {
        if (_lastPlaybackState.GraphRef is null) return;
        if (RootGrid.ActualWidth >= AdaptiveLayoutPolicy.UltraWideThreshold && _section is not LibrarySection.Library)
            await ShowRootsAsync();
        _showPlayerOnNarrow = true;
        UpdateAdaptiveLayout();
    }

    private void ThemePlayerButton_Click(object sender, RoutedEventArgs e)
    {
        _showPlayerOnNarrow = false;
        _section = LibrarySection.Settings;
        ShowSettings();
        UpdateAdaptiveLayout();
    }

    private void PositionSlider_PointerPressed(object sender, PointerRoutedEventArgs e) => _sliderDragging = true;
    private async void PositionSlider_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        _sliderDragging = false;
        await _engine.SeekAsync((long)PositionSlider.Value);
    }
    private void PositionSlider_ValueChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_updatingSliderFromPlayback) return;
        PositionText.Text = FormatDuration((long)e.NewValue);
        if (!_sliderDragging) _ = _engine.SeekAsync((long)e.NewValue);
    }

    private async void FavoriteButton_Click(object sender, RoutedEventArgs e)
    {
        if (_lastPlaybackState.GraphRef is null) return;
        await _library.ToggleFavoriteAsync(_lastPlaybackState.GraphRef.GraphId);
        UpdateFavoriteIcon(_lastPlaybackState);
        if (_section == LibrarySection.Favorites) await ShowFavoritesAsync();
    }

    private void UpdateFavoriteIcon(PlaybackUiState state)
    {
        var favorite = state.GraphRef is not null && _library.FavoriteIds.Contains(state.GraphRef.GraphId);
        FavoriteIcon.Glyph = favorite ? "\uE735" : "\uE734";
        FavoriteButton.Foreground = favorite
            ? (Brush)Application.Current.Resources["PlayerAccentBrush"]
            : new SolidColorBrush(Colors.White);
    }

    private Brush? FavoriteActionBrush(string graphId) => _library.FavoriteIds.Contains(graphId)
        ? (Brush)Application.Current.Resources["PlayerAccentBrush"]
        : null;

    private void UpdateGraphFavoriteItem(LibraryEntryViewModel item)
    {
        if (item.Graph is null) return;
        item.ActionGlyph = _library.FavoriteIds.Contains(item.Graph.Ref.GraphId) ? "\uE735" : "\uE734";
        item.ActionForeground = FavoriteActionBrush(item.Graph.Ref.GraphId);
    }

    private async void InfoButton_Click(object sender, RoutedEventArgs e)
    {
        var state = _lastPlaybackState;
        var panel = new StackPanel { Spacing = 10, MaxWidth = 560 };
        if (!string.IsNullOrWhiteSpace(state.Description)) panel.Children.Add(new TextBlock { Text = state.Description, TextWrapping = TextWrapping.Wrap });
        if (!string.IsNullOrWhiteSpace(state.Author)) panel.Children.Add(new TextBlock { Text = $"作者: {state.Author}" });
        foreach (var link in state.SocialLinks)
        {
            var button = new HyperlinkButton { Content = link.Label, NavigateUri = Uri.TryCreate(link.Url, UriKind.Absolute, out var uri) ? uri : null, Padding = new Thickness(0) };
            panel.Children.Add(button);
        }
        if (panel.Children.Count == 0) panel.Children.Add(new TextBlock { Text = "追加情報はありません。" });
        var dialog = new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = state.Title, Content = panel, CloseButtonText = "閉じる" };
        await dialog.ShowAsync();
    }

    private async void StatsButton_Click(object sender, RoutedEventArgs e)
    {
        if (_lastPlaybackState.GraphRef is null) return;
        var progress = new ProgressRing { IsActive = true, Width = 36, Height = 36 };
        var contentWidth = Math.Clamp(RootGrid.ActualWidth - 96, 300, 496);
        var host = new StackPanel { Spacing = 12, Width = contentWidth, MaxWidth = 496 };
        host.Children.Add(progress);
        ShareData? requestedShare = null;
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = "再生統計",
            Content = new ScrollViewer
            {
                Content = host,
                MaxHeight = 680,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                HorizontalScrollMode = ScrollMode.Disabled,
            },
            CloseButtonText = "閉じる",
        };
        var show = dialog.ShowAsync();
        try
        {
            var data = await _stats.EvaluateAsync(_lastPlaybackState.GraphRef, _lastPlaybackState);
            host.Children.Clear();
            host.Children.Add(BuildStatsSummary(data.Aggregate));
            foreach (var item in data.Items.OrderByDescending(item => item.Session.IsActive).ThenByDescending(item => item.SortValue).ThenByDescending(item => item.Session.StartedAt, StringComparer.Ordinal))
                host.Children.Add(BuildStatsCard(item, _lastPlaybackState.GraphRef, share =>
                {
                    requestedShare = share;
                    dialog.Hide();
                }));
            if (data.Items.Count == 0) host.Children.Add(new TextBlock { Text = "統計に利用できる再生セッションはまだありません。", Margin = new Thickness(8, 20, 8, 20) });
        }
        catch (Exception error)
        {
            host.Children.Clear();
            host.Children.Add(new InfoBar { IsOpen = true, IsClosable = false, Severity = InfoBarSeverity.Error, Title = "統計を作成できません", Message = error.Message });
        }
        await show;
        if (requestedShare is not null) await ShowShareDialogAsync(requestedShare);
    }

    private FrameworkElement BuildStatsSummary(PlaybackStatsAggregate aggregate)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var values = new[] { ("セッション", aggregate.SessionCount.ToString()), ("履歴", aggregate.EntryCount.ToString()), ("実再生時間", FormatDuration(aggregate.ActivePlayMs)) };
        for (var index = 0; index < values.Length; index++)
        {
            var card = new Border { Background = Brush("#221D2E"), CornerRadius = new CornerRadius(12), Padding = new Thickness(12), Child = new StackPanel { Children = { new TextBlock { Text = values[index].Item1, Foreground = Brush("#B8ABC8"), TextWrapping = TextWrapping.Wrap }, new TextBlock { Text = values[index].Item2, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold } } } };
            Grid.SetColumn(card, index);
            grid.Children.Add(card);
        }
        return grid;
    }

    private FrameworkElement BuildStatsCard(PlaybackStatsItem item, GraphRef reference, Action<ShareData> requestShare)
    {
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(new TextBlock
        {
            Text = item.Session.IsActive ? $"再生中 · {FormatDate(item.Session.StartedAt)}" : FormatDate(item.Session.StartedAt),
            Foreground = Brush("#B8ABC8"),
        });
        if (item.Error is not null) panel.Children.Add(new InfoBar { IsOpen = true, IsClosable = false, Severity = InfoBarSeverity.Warning, Message = item.Error });
        else if (item.Display is not null) panel.Children.Add(RenderDisplayNode(item.Display.Root, reference));
        if (item.Share is not null)
        {
            var share = new Button { Content = "共有内容を確認", HorizontalAlignment = HorizontalAlignment.Right };
            share.Click += (_, _) => requestShare(item.Share);
            panel.Children.Add(share);
        }
        return new Border { Background = Brush("#1B1B26"), CornerRadius = new CornerRadius(14), Padding = new Thickness(14), Child = panel };
    }

    private FrameworkElement RenderDisplayNode(DisplayNode node, GraphRef reference)
    {
        FrameworkElement content = node.Type switch
        {
            "column" => BuildStack(node, Orientation.Vertical, reference),
            "row" => BuildStack(node, Orientation.Horizontal, reference),
            "stack" => BuildGrid(node, reference),
            "surface" => BuildStack(node, Orientation.Vertical, reference),
            "spacer" => new Border { MinHeight = 8 },
            "divider" => new Border { Height = 1, Background = Brush(node.Style.Color ?? "#4A4458") },
            "text" => BuildDisplayText(node),
            "image" => BuildDisplayImage(node, reference),
            "icon" => new FontIcon { Glyph = DisplayIcon(node.Icon), FontSize = node.Style.FontSize ?? 22 },
            "badge" => new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(8, 3, 8, 3), Child = new TextBlock { Text = node.Text } },
            "progress" => new ProgressBar { Minimum = 0, Maximum = 1, Value = node.Value ?? 0, Height = 6 },
            _ => new TextBlock { Text = node.Text ?? "" },
        };
        ApplyElementStyle(content, node.Style);
        if (node.Style.BackgroundColor is null && node.Style.BorderColor is null && node.Style.Padding is null && node.Type != "surface") return content;
        var wrapper = new Border { Child = content, CornerRadius = new CornerRadius(node.Style.CornerRadius ?? 0), Padding = new Thickness(node.Style.Padding ?? 0) };
        if (node.Style.BackgroundColor is not null) wrapper.Background = Brush(node.Style.BackgroundColor);
        if (node.Style.BorderColor is not null) wrapper.BorderBrush = Brush(node.Style.BorderColor);
        if (node.Style.BorderWidth is not null) wrapper.BorderThickness = new Thickness(node.Style.BorderWidth.Value);
        return wrapper;
    }

    private StackPanel BuildStack(DisplayNode node, Orientation orientation, GraphRef reference)
    {
        var panel = new StackPanel { Orientation = orientation, Spacing = node.Style.Gap ?? 0 };
        foreach (var child in node.Children) panel.Children.Add(RenderDisplayNode(child, reference));
        return panel;
    }

    private Grid BuildGrid(DisplayNode node, GraphRef reference)
    {
        var grid = new Grid();
        foreach (var child in node.Children) grid.Children.Add(RenderDisplayNode(child, reference));
        return grid;
    }

    private TextBlock BuildDisplayText(DisplayNode node)
    {
        var text = new TextBlock { TextWrapping = TextWrapping.Wrap };
        if (node.Text is not null) text.Text = node.Text;
        else foreach (var span in node.Spans)
            {
                var run = new Run { Text = span.Text };
                if (span.Style.FontSize is not null) run.FontSize = span.Style.FontSize.Value;
                if (span.Style.FontWeight is not null) run.FontWeight = new Windows.UI.Text.FontWeight { Weight = (ushort)span.Style.FontWeight.Value };
                if (span.Style.Color is not null) run.Foreground = Brush(span.Style.Color);
                text.Inlines.Add(run);
            }
        if (node.Style.FontSize is not null) text.FontSize = node.Style.FontSize.Value;
        if (node.Style.FontWeight is not null) text.FontWeight = new Windows.UI.Text.FontWeight { Weight = (ushort)node.Style.FontWeight.Value };
        if (node.Style.Color is not null) text.Foreground = Brush(node.Style.Color);
        text.TextAlignment = node.Style.TextAlign switch { "center" => TextAlignment.Center, "end" => TextAlignment.Right, _ => TextAlignment.Left };
        if (node.Style.MaxLines is not null) text.MaxLines = node.Style.MaxLines.Value;
        return text;
    }

    private FrameworkElement BuildDisplayImage(DisplayNode node, GraphRef reference)
    {
        var image = new Image { Stretch = Stretch.Uniform };
        if (node.Source is not null && _library.GetAssetPath(reference, node.Source) is { } path)
            try { image.Source = new BitmapImage(new Uri(path)); } catch { }
        return image;
    }

    private static void ApplyElementStyle(FrameworkElement element, DisplayStyle style)
    {
        if (style.Width is DisplayDimension.Fixed width) element.Width = width.Value;
        else if (style.Width is DisplayDimension.Fill) element.HorizontalAlignment = HorizontalAlignment.Stretch;
        if (style.Height is DisplayDimension.Fixed height) element.Height = height.Value;
        else if (style.Height is DisplayDimension.Fill) element.VerticalAlignment = VerticalAlignment.Stretch;
        if (style.MinHeight is not null) element.MinHeight = style.MinHeight.Value;
        if (style.Opacity is not null) element.Opacity = style.Opacity.Value;
        element.HorizontalAlignment = style.HorizontalAlignment switch { "center" => HorizontalAlignment.Center, "end" => HorizontalAlignment.Right, "start" => HorizontalAlignment.Left, _ => element.HorizontalAlignment };
        element.VerticalAlignment = style.VerticalAlignment switch { "top" => VerticalAlignment.Top, "bottom" => VerticalAlignment.Bottom, "center" => VerticalAlignment.Center, _ => element.VerticalAlignment };
        if (style.OffsetX is not null || style.OffsetY is not null) element.RenderTransform = new TranslateTransform { X = style.OffsetX ?? 0, Y = style.OffsetY ?? 0 };
    }

    private async Task ShowShareDialogAsync(ShareData share)
    {
        var box = new TextBox
        {
            Text = share.ComposedText(),
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            Width = Math.Clamp(RootGrid.ActualWidth - 96, 280, 480),
            MaxWidth = 480,
            MinHeight = 150,
        };
        var count = new TextBlock { Foreground = Brush("#B8ABC8") };
        void UpdateCount() => count.Text = $"X換算: {ShareWeightedLength(box.Text)} / 280";
        box.TextChanged += (_, _) => UpdateCount();
        UpdateCount();
        var panel = new StackPanel { Spacing = 8, Children = { box, count } };
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = "共有内容を確認",
            Content = panel,
            PrimaryButtonText = "Xで開く",
            SecondaryButtonText = "コピー",
            CloseButtonText = "キャンセル",
        };
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
            await Launcher.LaunchUriAsync(new Uri($"https://twitter.com/intent/tweet?text={Uri.EscapeDataString(box.Text)}"));
        else if (result == ContentDialogResult.Secondary)
        {
            var package = new Windows.ApplicationModel.DataTransfer.DataPackage();
            package.SetText(box.Text);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(package);
        }
    }

    private async void ExportHistoryButton_Click(object sender, RoutedEventArgs e)
    {
        var picker = new FileSavePicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary, SuggestedFileName = $"yuraive-history-{DateTime.Now:yyyyMMdd}" };
        picker.FileTypeChoices.Add("JSON Lines", [".jsonl"]);
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file is null) return;
        await FileIO.WriteTextAsync(file, await _history.ExportJsonlAsync());
    }

    private async void PairAndroidButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_settings.Current.ShareLibrary) return;
        while (true)
        {
            var qr = new Image
            {
                Width = 320,
                Height = 320,
                HorizontalAlignment = HorizontalAlignment.Center,
                Source = await CreateQrSourceAsync(_bridge.PairingUri),
            };
            var dialog = new ContentDialog
            {
                XamlRoot = RootGrid.XamlRoot,
                Title = "Androidと接続",
                Content = qr,
                PrimaryButtonText = "接続コードを更新",
                CloseButtonText = "閉じる",
                DefaultButton = ContentDialogButton.Close,
            };
            var result = await dialog.ShowAsync();
            if (result != ContentDialogResult.Primary) break;
            await _bridge.RegeneratePairingAsync();
        }
    }

    private static async Task<BitmapImage> CreateQrSourceAsync(string value)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(value, QRCodeGenerator.ECCLevel.Q);
        using var code = new PngByteQRCode(data);
        var bytes = code.GetGraphic(10);
        using var stream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(stream))
        {
            writer.WriteBytes(bytes);
            await writer.StoreAsync();
            writer.DetachStream();
        }
        stream.Seek(0);
        var source = new BitmapImage { DecodePixelWidth = 320 };
        await source.SetSourceAsync(stream);
        return source;
    }

    private void Bridge_StatusChanged(object? sender, EventArgs e) => DispatcherQueue.TryEnqueue(UpdatePairingStatus);

    private void UpdatePairingStatus()
    {
        PairingStatusText.Text = $"現在{_bridge.ConnectedDeviceCount}台のデバイスと共有しています";
        PairingStatusText.Foreground = (Brush)Application.Current.Resources["TextFillColorSecondaryBrush"];
        PairAndroidHeaderButton.Visibility = _settings.Current.ShareLibrary ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void ClearHistoryButton_Click(object sender, RoutedEventArgs e)
    {
        var confirm = new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = "再生履歴を消去しますか？", Content = "保存されているすべての確定済み履歴を削除します。この操作は元に戻せません。", PrimaryButtonText = "消去", CloseButtonText = "キャンセル", DefaultButton = ContentDialogButton.Close };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        await _history.ClearAsync();
        await ShowHistoryAsync();
    }
}
