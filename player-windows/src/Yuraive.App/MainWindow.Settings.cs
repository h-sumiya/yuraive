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
    private void ApplySettings()
    {
        RootGrid.RequestedTheme = _settings.Current.ThemeMode switch { ThemeMode.Light => ElementTheme.Light, ThemeMode.Dark => ElementTheme.Dark, _ => ElementTheme.Default };
        ApplyAccent(_showPlayerOnNarrow ? _lastPlaybackState.Controls.AccentColor : null);
    }

    private void ApplySettingsControls()
    {
        _settingsInitializing = true;
        var themeButtons = new[] { ThemeSystemButton, ThemeLightButton, ThemeDarkButton };
        var themeIcons = new[] { ThemeSystemIcon, ThemeLightIcon, ThemeDarkIcon };
        var defaultGlyphs = new[] { "\uE713", "\uE706", "\uE708" };
        for (var index = 0; index < themeButtons.Length; index++)
        {
            var selected = (int)_settings.Current.ThemeMode == index;
            themeButtons[index].BorderBrush = selected ? (Brush)Application.Current.Resources["PlayerAccentBrush"] : (Brush)Application.Current.Resources["ControlStrokeColorDefaultBrush"];
            themeButtons[index].BorderThickness = new Thickness(selected ? 2 : 1);
            themeButtons[index].Background = selected ? (Brush)Application.Current.Resources["PlayerAccentContainerBrush"] : (Brush)Application.Current.Resources["ControlFillColorSecondaryBrush"];
            themeIcons[index].Glyph = selected ? "\uE73E" : defaultGlyphs[index];
        }
        var accentButtons = new[] { Accent0Button, Accent1Button, Accent2Button, Accent3Button };
        var accentChecks = new[] { Accent0Check, Accent1Check, Accent2Check, Accent3Check };
        var selectedAccent = Math.Clamp(_settings.Current.AccentIndex, 0, accentButtons.Length - 1);
        for (var index = 0; index < accentButtons.Length; index++)
        {
            accentButtons[index].BorderThickness = new Thickness(index == selectedAccent ? 3 : 0);
            accentChecks[index].Visibility = index == selectedAccent ? Visibility.Visible : Visibility.Collapsed;
        }
        ShareLibraryToggle.IsOn = _settings.Current.ShareLibrary;
        ForceControlsToggle.IsOn = _settings.Current.ForceShowPlayerControls;
        KeepScreenToggle.IsOn = _settings.Current.KeepScreenOnInPlayer;
        ScriptTimeoutSlider.Value = Math.Clamp(_settings.Current.ScriptTimeoutMs, 100, 5_000);
        ScriptTimeoutText.Text = $"{_settings.Current.ScriptTimeoutMs} ms";
        _settingsInitializing = false;
    }

    private async void ThemeChoiceButton_Click(object sender, RoutedEventArgs e)
    {
        if (_settingsInitializing || !int.TryParse((sender as FrameworkElement)?.Tag?.ToString(), out var index)) return;
        await _settings.UpdateAsync(value => value with { ThemeMode = (ThemeMode)Math.Clamp(index, 0, 2) });
        ApplySettings();
        ApplySettingsControls();
    }
    private async void AccentChoiceButton_Click(object sender, RoutedEventArgs e)
    {
        if (_settingsInitializing || !int.TryParse((sender as FrameworkElement)?.Tag?.ToString(), out var index)) return;
        await _settings.UpdateAsync(value => value with { AccentIndex = Math.Clamp(index, 0, 3) });
        ApplySettings();
        ApplySettingsControls();
    }
    private async void ForceControlsToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_settingsInitializing) return;
        await _settings.UpdateAsync(value => value with { ForceShowPlayerControls = ForceControlsToggle.IsOn });
    }
    private async void KeepScreenToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_settingsInitializing) return;
        await _settings.UpdateAsync(value => value with { KeepScreenOnInPlayer = KeepScreenToggle.IsOn });
        UpdateDisplayRequest(KeepScreenToggle.IsOn && _lastPlaybackState.IsPlaying);
    }
    private async void ScriptTimeoutSlider_ValueChanged(object sender, RangeBaseValueChangedEventArgs args)
    {
        var timeout = (long)Math.Round(args.NewValue / 100) * 100;
        ScriptTimeoutText.Text = $"{timeout} ms";
        if (_settingsInitializing || double.IsNaN(args.NewValue)) return;
        await _settings.UpdateAsync(value => value with { ScriptTimeoutMs = timeout });
    }

    private void ApplyAccent(string? playbackAccent)
    {
        var accents = new[] { "#574DE5", "#944BF8", "#02A5FE", "#314DCE" };
        var value = playbackAccent is { Length: > 0 } && TryColor(playbackAccent, out var parsed)
            ? parsed
            : ColorFromHex(accents[Math.Clamp(_settings.Current.AccentIndex, 0, accents.Length - 1)]);
        SetBrushColor("PlayerAccentBrush", value);
        SetBrushColor("AccentFillColorDefaultBrush", value);
        SetBrushColor("AccentTextFillColorPrimaryBrush", value);
        SetBrushColor("AccentFillColorSecondaryBrush", Windows.UI.Color.FromArgb(0xD9, value.R, value.G, value.B));
        SetBrushColor("AccentFillColorTertiaryBrush", Windows.UI.Color.FromArgb(0xA6, value.R, value.G, value.B));
        SetBrushColor("AccentTextFillColorSecondaryBrush", Windows.UI.Color.FromArgb(0xD9, value.R, value.G, value.B));
        SetBrushColor("PlayerAccentContainerBrush", Windows.UI.Color.FromArgb(0x52, value.R, value.G, value.B));
        SetBrushColor("PlayerAccentLowBrush", Windows.UI.Color.FromArgb(0x25, value.R, value.G, value.B));
    }

    private static void SetBrushColor(string key, Windows.UI.Color color)
    {
        if (Application.Current.Resources[key] is SolidColorBrush brush) brush.Color = color;
    }

    private static bool TryColor(string value, out Windows.UI.Color color)
    {
        try { color = ColorFromHex(value); return true; }
        catch { color = default; return false; }
    }

    private void UpdateDisplayRequest(bool active)
    {
        if (active == _displayRequestActive) return;
        try
        {
            if (active) _displayRequest.RequestActive(); else _displayRequest.RequestRelease();
            _displayRequestActive = active;
        }
        catch { _displayRequestActive = false; }
    }

    private void RootGrid_SizeChanged(object sender, SizeChangedEventArgs e) => UpdateAdaptiveLayout();
    private void PlayerBackButton_Click(object sender, RoutedEventArgs e) { _showPlayerOnNarrow = false; ApplyAccent(null); UpdateAdaptiveLayout(); }
    private void PlayerPane_SizeChanged(object sender, SizeChangedEventArgs e) => UpdatePlayerResponsiveLayout();

    private void UpdateAdaptiveLayout()
    {
        var hasSelection = _lastPlaybackState.GraphRef is not null;
        var playerOpen = _showPlayerOnNarrow && hasSelection;
        var ultraWide = AdaptiveLayoutPolicy.ShowsSideLibrary(RootGrid.ActualWidth, RootGrid.ActualHeight, playerOpen);
        if (playerOpen)
        {
            PlayerPane.Visibility = Visibility.Visible;
            if (ultraWide)
            {
                LibraryPane.Visibility = Visibility.Visible;
                PaneDivider.Visibility = Visibility.Visible;
                LibraryColumn.Width = new GridLength(Math.Clamp(RootGrid.ActualWidth * .31, 480, 560));
                DividerColumn.Width = new GridLength(1);
                PlayerColumn.Width = new GridLength(1, GridUnitType.Star);
            }
            else
            {
                LibraryPane.Visibility = Visibility.Collapsed;
                PaneDivider.Visibility = Visibility.Collapsed;
                LibraryColumn.Width = new GridLength(0);
                DividerColumn.Width = new GridLength(0);
                PlayerColumn.Width = new GridLength(1, GridUnitType.Star);
            }
        }
        else
        {
            LibraryPane.Visibility = Visibility.Visible;
            PaneDivider.Visibility = Visibility.Collapsed;
            PlayerPane.Visibility = Visibility.Collapsed;
            LibraryColumn.Width = new GridLength(1, GridUnitType.Star);
            DividerColumn.Width = new GridLength(0);
            PlayerColumn.Width = new GridLength(0);
        }
        MiniPlayer.Visibility = hasSelection && !playerOpen ? Visibility.Visible : Visibility.Collapsed;
        PlayerBackButton.Visibility = playerOpen ? Visibility.Visible : Visibility.Collapsed;
        UpdateQuickActionLayout();
        UpdatePlayerResponsiveLayout();
    }

    private void UpdateQuickActionLayout()
    {
        if (QuickActionsGrid is null) return;
        var metrics = LibraryGridMetrics(LibraryList.ActualWidth > 0 ? LibraryList.ActualWidth : LibraryPane.ActualWidth - 20);
        var activeColumns = Math.Min(4, metrics.Columns);
        var cardWidth = Math.Max(120, metrics.ItemWidth - 12);
        QuickActionsGrid.Width = activeColumns * cardWidth + 36;
        for (var index = 0; index < QuickActionsGrid.ColumnDefinitions.Count; index++)
            QuickActionsGrid.ColumnDefinitions[index].Width = index < activeColumns ? new GridLength(cardWidth) : new GridLength(0);
        QuickActionsGrid.RowDefinitions[1].Height = activeColumns == 4 ? new GridLength(0) : new GridLength(86);
        var buttons = new[] { PlayedQuickButton, RecentQuickButton, FavoritesQuickButton, ShuffleQuickButton };
        for (var index = 0; index < buttons.Length; index++)
        {
            Grid.SetColumn(buttons[index], index % activeColumns);
            Grid.SetRow(buttons[index], index / activeColumns);
        }
        UpdateLibraryGridLayout();
    }

    private void LibraryList_Loaded(object sender, RoutedEventArgs e) => UpdateLibraryGridLayout();

    private void UpdateLibraryGridLayout()
    {
        if (FindDescendant<ItemsWrapGrid>(LibraryList) is not { } panel || LibraryList.ActualWidth <= 0) return;
        var metrics = LibraryGridMetrics(LibraryList.ActualWidth);
        panel.ItemWidth = metrics.ItemWidth;
        panel.ItemHeight = metrics.ItemWidth;
    }

    private static (int Columns, double ItemWidth) LibraryGridMetrics(double width)
    {
        var available = Math.Max(320, width - 28);
        var columns = available switch { < 600 => 2, < 840 => 3, < 1_200 => 4, _ => 5 };
        var itemWidth = Math.Clamp(Math.Floor((available - columns * 12) / columns), 150, 240);
        return (columns, itemWidth);
    }

    private void UpdatePlayerResponsiveLayout()
    {
        if (PlayerPane.Visibility != Visibility.Visible || PlayerResponsiveGrid.ActualWidth <= 0 || PlayerResponsiveGrid.ActualHeight <= 0) return;
        var width = PlayerResponsiveGrid.ActualWidth;
        var height = PlayerResponsiveGrid.ActualHeight;
        var landscape = AdaptiveLayoutPolicy.UsesTwoPanePlayer(width, height);
        var artworkSize = 0d;
        if (landscape)
        {
            PlayerResponsiveGrid.ColumnDefinitions[0].Width = new GridLength(1, GridUnitType.Star);
            PlayerResponsiveGrid.ColumnDefinitions[1].Width = new GridLength(1, GridUnitType.Star);
            PlayerResponsiveGrid.RowDefinitions[0].Height = new GridLength(1, GridUnitType.Star);
            PlayerResponsiveGrid.RowDefinitions[1].Height = new GridLength(0);
            PlayerResponsiveGrid.RowDefinitions[2].Height = new GridLength(0);
            PortraitPlayerHeader.Visibility = Visibility.Collapsed;
            LandscapePlayerHeader.Visibility = Visibility.Visible;
            Grid.SetColumn(ArtworkBorder, 0);
            Grid.SetRow(ArtworkBorder, 0);
            Grid.SetColumn(ControlsPanel, 1);
            Grid.SetRow(ControlsPanel, 0);
            var horizontalInset = width >= 1_100 ? 28d : 16d;
            var verticalInset = height >= 560 ? 24d : 12d;
            ArtworkBorder.Margin = new Thickness(horizontalInset, verticalInset, horizontalInset, verticalInset);
            ControlsPanel.Margin = new Thickness(horizontalInset, 0, horizontalInset, 0);
            artworkSize = Math.Max(180, Math.Min(520, Math.Min(width / 2 - horizontalInset * 2, height - verticalInset * 2)));
            ArtworkBorder.Width = artworkSize;
            ArtworkBorder.Height = artworkSize;
            ControlsPanel.Width = Math.Max(280, Math.Min(560, width / 2 - horizontalInset * 2));
            ControlsPanel.Height = artworkSize;
            ControlsPanel.VerticalAlignment = VerticalAlignment.Center;
        }
        else
        {
            var compactPortrait = height < 700;
            PlayerResponsiveGrid.ColumnDefinitions[0].Width = new GridLength(1, GridUnitType.Star);
            PlayerResponsiveGrid.ColumnDefinitions[1].Width = new GridLength(0);
            PlayerResponsiveGrid.RowDefinitions[0].Height = GridLength.Auto;
            PlayerResponsiveGrid.RowDefinitions[1].Height = new GridLength(compactPortrait ? .39 : .42, GridUnitType.Star);
            PlayerResponsiveGrid.RowDefinitions[2].Height = new GridLength(compactPortrait ? .61 : .58, GridUnitType.Star);
            PortraitPlayerHeader.Visibility = Visibility.Visible;
            LandscapePlayerHeader.Visibility = Visibility.Collapsed;
            Grid.SetColumn(ArtworkBorder, 0);
            Grid.SetRow(ArtworkBorder, 1);
            Grid.SetColumn(ControlsPanel, 0);
            Grid.SetRow(ControlsPanel, 2);
            ArtworkBorder.Margin = new Thickness(20, compactPortrait ? 12 : 18, 20, compactPortrait ? 12 : 22);
            ControlsPanel.Margin = new Thickness(20, 0, 20, 12);
            artworkSize = Math.Max(150, Math.Min(420, Math.Min(width - 40, height * (compactPortrait ? .33 : .36))));
            ArtworkBorder.Width = artworkSize;
            ArtworkBorder.Height = artworkSize;
            ControlsPanel.Width = Math.Max(280, Math.Min(560, width - 40));
            ControlsPanel.Height = double.NaN;
            ControlsPanel.VerticalAlignment = VerticalAlignment.Stretch;
            PortraitPlayerHeader.Width = ControlsPanel.Width;
        }
        var compact = height < 670 || (!landscape && width < 420);
        PlayerTitle.FontSize = compact ? 21 : 24;
        PortraitPlayerTitle.FontSize = compact ? 22 : 27;
        PlayerSceneName.FontSize = compact ? 18 : 21;
        PlayerMetadataRow.Margin = new Thickness(8, landscape ? (compact ? 12 : 24) : 0, 8, 0);
        PlayerProgressRow.Margin = new Thickness(8, compact ? 4 : 10, 8, 0);
        PlayerTransportRow.Margin = new Thickness(8, compact ? 8 : 14, 8, 0);
        PlayerBottomActionsRow.Margin = new Thickness(8, compact ? 6 : 12, 8, 0);

        var playSize = landscape
            ? Math.Clamp(artworkSize * .14, 60, 76)
            : compact
                ? 60
                : Math.Clamp(width * .15, 64, 72);
        PlayPauseButton.Width = PlayPauseButton.Height = playSize;
        PlayPauseButton.CornerRadius = new CornerRadius(playSize / 2);
        PlayPauseIcon.FontSize = Math.Clamp(playSize * .46, 28, 35);
        var sideButtonSize = Math.Clamp(playSize * .70, 46, 52);
        PreviousButton.Width = PreviousButton.Height = sideButtonSize;
        NextButton.Width = NextButton.Height = sideButtonSize;
        PreviousButton.CornerRadius = NextButton.CornerRadius = new CornerRadius(sideButtonSize / 3.1);
    }

    private async Task ShowMessageAsync(string title, string message)
    {
        await new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = title, Content = message, CloseButtonText = "閉じる" }.ShowAsync();
    }

    private static T? FindDescendant<T>(DependencyObject element) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(element); index++)
        {
            var child = VisualTreeHelper.GetChild(element, index);
            if (child is T found) return found;
            if (FindDescendant<T>(child) is { } nested) return nested;
        }
        return null;
    }
    private async void ShareLibraryToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_settingsInitializing) return;
        var enabled = ShareLibraryToggle.IsOn;
        await _settings.UpdateAsync(value => value with { ShareLibrary = enabled });
        if (enabled) _bridge.Start();
        else await _bridge.StopAsync();
        UpdatePairingStatus();
    }

    private static T? FindDescendantByName<T>(DependencyObject element, string name) where T : FrameworkElement
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(element); index++)
        {
            var child = VisualTreeHelper.GetChild(element, index);
            if (child is T found && found.Name == name) return found;
            if (FindDescendantByName<T>(child, name) is { } nested) return nested;
        }
        return null;
    }

    private async void MainWindow_Closed(object sender, WindowEventArgs args)
    {
        UpdateDisplayRequest(false);
        _engine.StateChanged -= Engine_StateChanged;
        await _engine.DisposeAsync();
        _bridge.StatusChanged -= Bridge_StatusChanged;
        await _bridge.DisposeAsync();
    }

    private static string PlayerSecondaryLabel(PlaybackUiState state)
    {
        var parts = new List<string>();
        if (state.Controls.ShowSceneName && state.SceneName.Length > 0) parts.Add(state.SceneName);
        if (state.Controls.ShowFileName && state.FileName.Length > 0) parts.Add(state.FileName);
        if (parts.Count == 0 && state.Author is not null) parts.Add(state.Author);
        return string.Join("  ·  ", parts);
    }

    private static string HiddenOrValue(string value) => string.IsNullOrWhiteSpace(value) ? "???" : value;

    private static string FormatDuration(long value)
    {
        var totalSeconds = Math.Max(0, value) / 1_000;
        return totalSeconds >= 3_600
            ? $"{totalSeconds / 3_600}:{totalSeconds % 3_600 / 60:00}:{totalSeconds % 60:00}"
            : $"{totalSeconds / 60}:{totalSeconds % 60:00}";
    }

    private static string FormatDate(string value) => DateTimeOffset.TryParse(value, out var date)
        ? date.ToLocalTime().ToString("yyyy/MM/dd HH:mm", CultureInfo.CurrentCulture)
        : value;
    private static string HistoryGraphName(string graphId)
    {
        var name = graphId.Split("::").LastOrDefault()?.Split('/').LastOrDefault();
        if (name is null) return graphId;
        return name.EndsWith(".yuraive.json", StringComparison.OrdinalIgnoreCase) ? name[..^".yuraive.json".Length]
            : name.EndsWith(".yuraive", StringComparison.OrdinalIgnoreCase) ? name[..^".yuraive".Length]
            : name;
    }
    private static string DisplayIcon(string? value) => value switch { "play" => "\uE768", "history" => "\uE81C", "timer" => "\uE823", "star" or "favorite" => "\uE735", "sleep" => "\uE708", "trophy" => "\uE7C1", "stats" => "\uE9D9", _ => "\uE946" };
    private static SolidColorBrush Brush(string color) => new(ColorFromHex(color));
    private static Windows.UI.Color ColorFromHex(string value)
    {
        var hex = value.TrimStart('#');
        return hex.Length switch
        {
            6 => Windows.UI.Color.FromArgb(255, Convert.ToByte(hex[..2], 16), Convert.ToByte(hex[2..4], 16), Convert.ToByte(hex[4..6], 16)),
            8 => Windows.UI.Color.FromArgb(Convert.ToByte(hex[..2], 16), Convert.ToByte(hex[2..4], 16), Convert.ToByte(hex[4..6], 16), Convert.ToByte(hex[6..8], 16)),
            _ => throw new FormatException("色は #RRGGBB または #AARRGGBB で指定してください"),
        };
    }

    private static int ShareWeightedLength(string value)
    {
        var count = 0;
        for (var index = 0; index < value.Length;)
        {
            var code = char.ConvertToUtf32(value, index);
            count += code is >= 0x0000 and <= 0x10FF or >= 0x2000 and <= 0x200D or >= 0x2010 and <= 0x201F or >= 0x2032 and <= 0x2037 ? 1 : 2;
            index += char.IsSurrogatePair(value, index) ? 2 : 1;
        }
        return count;
    }

    private sealed class InspectionTreeBranch
    {
        public SortedDictionary<string, InspectionTreeBranch> Folders { get; } = new(StringComparer.CurrentCultureIgnoreCase);
        public List<(string Name, LibraryAssetInspection Asset)> Files { get; } = [];
    }

    private enum LibrarySection { Library, Favorites, Collection, History, Settings, Licenses }
}
