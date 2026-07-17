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
    private async void RootGrid_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        ApplySettings();
        if (_settings.Current.ShareLibrary) _bridge.Start();
        else UpdatePairingStatus();
        await InitializeButtonLayoutAsync();
        if (!await HandleActivatedBundleAsync())
        {
            await RefreshRootsAsync();
            await _engine.RestoreAsync();
        }
        UpdateAdaptiveLayout();
    }

    private async Task<bool> HandleActivatedBundleAsync()
    {
        if (string.IsNullOrWhiteSpace(_activatedBundlePath)) return false;
        try
        {
            var graph = await _library.ImportBundleAsync(_activatedBundlePath);
            await RefreshRootsAsync();
            var root = _library.Roots.First(value =>
                string.Equals(value.Uri, graph.Ref.RootUri, StringComparison.OrdinalIgnoreCase));
            await OpenDirectoryAsync(root, "");
            await OpenGraphAsync(graph);
        }
        catch (Exception error)
        {
            await RefreshRootsAsync();
            await ShowMessageAsync("Yuraiveを開けません", error.Message);
        }
        return true;
    }

    private async Task InitializeButtonLayoutAsync()
    {
        try
        {
            await ButtonLayout.InitializeAsync();
        }
        catch (Exception error)
        {
            PlayerErrorBar.Title = "ボタンレイアウトを初期化できません";
            PlayerErrorBar.Message = error.Message;
            PlayerErrorBar.IsOpen = true;
        }
    }

    private async Task RefreshRootsAsync()
    {
        SetLibraryBusy(true);
        try
        {
            _rootScan = await _library.ScanAllAsync();
            if (_section == LibrarySection.Library)
            {
                if (_browserRoot is null) await ShowRootsAsync();
                else await OpenDirectoryAsync(_browserRoot, _browserPath);
            }
            else if (_section == LibrarySection.Favorites) await ShowFavoritesAsync();
        }
        finally { SetLibraryBusy(false); }
    }

    private async Task ShowRootsAsync()
    {
        _section = LibrarySection.Library;
        _browserRoot = null;
        _browserPath = "";
        _isSearching = false;
        SearchPanel.Visibility = Visibility.Collapsed;
        SearchBox.Text = "";
        _selectedRootUris.IntersectWith(_rootScan.Select(root => root.Grant.Uri));
        ShowListPanel();
        ConfigureLibraryHeader(home: true, "Yuraive");
        SectionTitle.Text = "ライブラリ";
        var items = new List<LibraryEntryViewModel>();
        foreach (var root in _rootScan)
        {
            var preview = root.Error is null ? await FindPreviewGraphAsync(root.Grant, root.Directory) : null;
            items.Add(new()
            {
                Kind = LibraryEntryKind.Root,
                Title = root.Grant.Name,
                Subtitle = root.Error ?? "",
                Glyph = root.Error is null ? "\uE8B7" : "\uE783",
                RootSelectionVisibility = Visibility.Visible,
                RootIsSelected = _selectedRootUris.Contains(root.Grant.Uri),
                Thumbnail = ThumbnailSource(preview),
                BlurredThumbnail = ThumbnailSource(preview, 48),
                Root = root.Grant,
            });
        }
        items.Add(new()
        {
            Kind = LibraryEntryKind.Add,
            Title = "フォルダを追加",
            Glyph = "\uE710",
        });
        ReplaceLibraryItems(items);
        UpdateRootSelectionActions();
        SetEmptyState(false, "", "", showAdd: false);
    }

    private async Task OpenDirectoryAsync(RootGrant root, string path)
    {
        SetLibraryBusy(true);
        try
        {
            var directory = await _library.InspectDirectoryAsync(root, path);
            _browserRoot = root;
            _browserPath = path;
            ShowListPanel();
            ConfigureLibraryHeader(home: false, directory.Name);
            var folders = new List<LibraryEntryViewModel>();
            foreach (var folder in directory.Folders)
            {
                var preview = await FindPreviewGraphAsync(root, await SafeInspectDirectoryAsync(root, folder.RelativePath));
                folders.Add(new()
                {
                    Kind = LibraryEntryKind.Folder,
                    Title = folder.Name,
                    Subtitle = "",
                    Glyph = "\uE8B7",
                    Thumbnail = ThumbnailSource(preview),
                    BlurredThumbnail = ThumbnailSource(preview, 48),
                    Folder = folder,
                });
            }
            var graphs = directory.Graphs.Select(graph => new LibraryEntryViewModel
            {
                Kind = LibraryEntryKind.Graph,
                Title = graph.DisplayName,
                Subtitle = graph.ParseError ?? graph.Author ?? graph.Ref.FileName,
                Glyph = graph.ParseError is null ? "\uE8D6" : "\uE783",
                ActionGlyph = _library.FavoriteIds.Contains(graph.Ref.GraphId) ? "\uE735" : "\uE734",
                ActionVisibility = Visibility.Visible,
                ActionForeground = FavoriteActionBrush(graph.Ref.GraphId),
                Thumbnail = ThumbnailSource(graph),
                BlurredThumbnail = ThumbnailSource(graph, 48),
                Graph = graph,
            });
            ReplaceLibraryItems(folders.Concat(graphs));
            SetEmptyState(_libraryItems.Count == 0, "このフォルダは空です", "サブフォルダまたは .yuraive / .yuraive.json ファイルがありません。", showAdd: false);
        }
        catch (Exception error)
        {
            ReplaceLibraryItems([]);
            SetEmptyState(true, "フォルダを開けません", error.Message, showAdd: false);
        }
        finally { SetLibraryBusy(false); }
    }

    private async Task ShowFavoritesAsync()
    {
        var graphs = await _library.ResolveGraphsAsync(_library.FavoriteIdsByRecent());
        await ShowCollectionAsync("最近のお気に入り", graphs, LibrarySection.Favorites);
    }

    private async Task ShowHistoryAsync()
    {
        LibraryScreen.Visibility = Visibility.Collapsed;
        EmptyLibraryPanel.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
        LicensesPanel.Visibility = Visibility.Collapsed;
        HistoryPanel.Visibility = Visibility.Visible;
        var entries = await _history.ReadAllAsync();
        var graphs = (await _library.ResolveGraphsAsync(entries.Select(entry => entry.GraphId)))
            .ToDictionary(graph => graph.Ref.GraphId, StringComparer.Ordinal);
        _historyItems.Clear();
        var sessions = entries
            .GroupBy(entry => string.IsNullOrWhiteSpace(entry.RunId) ? entry.Id : entry.RunId, StringComparer.Ordinal)
            .Select(group => new
            {
                Entries = group.OrderBy(entry => entry.StartedAt, StringComparer.Ordinal).ToList(),
                StartedAt = group.Min(entry => entry.StartedAt),
                ActivePlayMs = group.Sum(entry => entry.ActivePlayMs),
                Completed = group.Last().EndReason == "completed",
            })
            .OrderByDescending(session => session.StartedAt, StringComparer.Ordinal);
        foreach (var session in sessions)
        {
            var entry = session.Entries[0];
            graphs.TryGetValue(entry.GraphId, out var graph);
            _historyItems.Add(new()
            {
                Title = graph?.DisplayName ?? HistoryGraphName(entry.GraphId),
                Subtitle = $"{FormatDate(session.StartedAt ?? "")}  ·  再生 {FormatDuration(session.ActivePlayMs)}",
                Badge = session.Completed ? "完了" : "未完了",
                Thumbnail = ThumbnailSource(graph),
                Entry = entry,
                Graph = graph,
            });
        }
    }

    private void ShowSettings()
    {
        LibraryScreen.Visibility = Visibility.Collapsed;
        EmptyLibraryPanel.Visibility = Visibility.Collapsed;
        HistoryPanel.Visibility = Visibility.Collapsed;
        LicensesPanel.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Visible;
        UpdatePairingStatus();
        ApplySettingsControls();
    }

    private void ShowListPanel()
    {
        HistoryPanel.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
        LicensesPanel.Visibility = Visibility.Collapsed;
        LibraryScreen.Visibility = Visibility.Visible;
    }

    private void ShowLicenses()
    {
        _section = LibrarySection.Licenses;
        LibraryScreen.Visibility = Visibility.Collapsed;
        EmptyLibraryPanel.Visibility = Visibility.Collapsed;
        HistoryPanel.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
        LicensesPanel.Visibility = Visibility.Visible;
        ShowLicenseList();
    }

    private void ShowLicenseList()
    {
        LicensesTitle.Text = "ライセンス";
        LicenseDetailContent.Visibility = Visibility.Collapsed;
        LicenseListContent.Visibility = Visibility.Visible;
    }

    private void ShowLicenseDetail(OpenSourceNoticeViewModel notice)
    {
        LicensesTitle.Text = "ライセンス詳細";
        LicenseDetailName.Text = notice.Name;
        LicenseDetailSummary.Text = notice.Summary;
        LicenseDetailText.Text = string.Join(
            "\n\n────────────────────\n\n",
            notice.LicenseResourceNames.Select(ReadLicenseResource));
        LicenseListContent.Visibility = Visibility.Collapsed;
        LicenseDetailContent.Visibility = Visibility.Visible;
        LicenseDetailContent.ChangeView(null, 0, null, true);
    }

    private static string ReadLicenseResource(string name)
    {
        using var stream = typeof(MainWindow).Assembly.GetManifestResourceStream($"Yuraive.App.Licenses.{name}");
        if (stream is null) return $"ライセンス本文を読み込めませんでした ({name})";
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private async Task ShowCollectionAsync(string title, IEnumerable<LibraryGraph> graphs, LibrarySection section = LibrarySection.Collection)
    {
        _section = section;
        _browserRoot = null;
        _browserPath = "";
        ShowListPanel();
        ConfigureLibraryHeader(home: false, title);
        ReplaceLibraryItems(graphs.Select(graph => new LibraryEntryViewModel
        {
            Kind = LibraryEntryKind.Graph,
            Title = graph.DisplayName,
            Subtitle = graph.ParseError ?? graph.Author ?? graph.Ref.ContentFolderName,
            Glyph = graph.ParseError is null ? "\uE8D6" : "\uE783",
            ActionGlyph = _library.FavoriteIds.Contains(graph.Ref.GraphId) ? "\uE735" : "\uE734",
            ActionVisibility = Visibility.Visible,
            ActionForeground = FavoriteActionBrush(graph.Ref.GraphId),
            Thumbnail = ThumbnailSource(graph),
            BlurredThumbnail = ThumbnailSource(graph, 48),
            Graph = graph,
        }));
        SetEmptyState(_libraryItems.Count == 0, "作品はまだありません", "この一覧に表示できる作品はありません。", showAdd: false);
        await Task.CompletedTask;
    }

    private void ConfigureLibraryHeader(bool home, string title)
    {
        TopTitle.Text = title;
        HomeHeaderPanel.Visibility = home ? Visibility.Visible : Visibility.Collapsed;
        DetailHeaderPanel.Visibility = home ? Visibility.Collapsed : Visibility.Visible;
        LibraryHomeHeader.Visibility = home ? Visibility.Visible : Visibility.Collapsed;
        QuickActionsGrid.Visibility = home ? Visibility.Visible : Visibility.Collapsed;
        LibraryHeaderActions.Visibility = home ? Visibility.Visible : Visibility.Collapsed;
        SectionTitle.Text = "ライブラリ";
        SearchPanel.Visibility = Visibility.Collapsed;
        _isSearching = false;
        SearchBox.Text = "";
        UpdateQuickActionLayout();
    }

    private void ReplaceLibraryItems(IEnumerable<LibraryEntryViewModel> items)
    {
        _libraryItems.Clear();
        foreach (var item in items) _libraryItems.Add(item);
    }

    private void SetEmptyState(bool visible, string title, string text, bool showAdd)
    {
        EmptyLibraryPanel.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        EmptyLibraryTitle.Text = title;
        EmptyLibraryText.Text = text;
        EmptyAddFolderButton.Visibility = showAdd ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SetLibraryBusy(bool busy)
    {
        LibraryProgress.IsActive = busy;
        LibraryProgress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        LibraryList.IsEnabled = !busy;
        RefreshButton.IsEnabled = !busy;
        DeleteSelectedRootsButton.IsEnabled = !busy;
    }

    private void RootSelectionToggle_Changed(object sender, RoutedEventArgs e)
    {
        if (sender is not ToggleButton toggle) return;
        UpdateRootSelectionToggleVisual(toggle);
        UpdateRootSelectionToggleVisibility(toggle);
        if (toggle.DataContext is not LibraryEntryViewModel { Root: { } root } item) return;

        item.RootIsSelected = toggle.IsChecked == true;
        if (item.RootIsSelected) _selectedRootUris.Add(root.Uri);
        else _selectedRootUris.Remove(root.Uri);
        UpdateRootSelectionActions();
    }

    private void RootSelectionToggle_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleButton toggle) UpdateRootSelectionToggleVisibility(toggle);
    }

    private static void UpdateRootSelectionToggleVisual(ToggleButton toggle)
    {
        ToolTipService.SetToolTip(toggle, toggle.IsChecked == true ? "選択を解除" : "削除対象に選択");
    }

    private static void UpdateRootSelectionToggleVisibility(ToggleButton toggle)
    {
        toggle.Visibility = toggle.IsChecked == true || toggle.IsPointerOver ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateRootSelectionActions()
    {
        var count = _selectedRootUris.Count;
        SelectedRootCountText.Text = $"{count}件";
        DeleteSelectedRootsButton.Visibility = count > 0 && _section == LibrarySection.Library && _browserRoot is null && !_isSearching
            ? Visibility.Visible
            : Visibility.Collapsed;
        ToolTipService.SetToolTip(DeleteSelectedRootsButton, $"選択したフォルダをライブラリから削除（{count}件）");
    }

    private async void DeleteSelectedRootsButton_Click(object sender, RoutedEventArgs e)
    {
        var uris = _selectedRootUris.ToArray();
        if (uris.Length == 0) return;

        var failures = new List<(string Uri, Exception Error)>();
        SetLibraryBusy(true);
        try
        {
            foreach (var uri in uris)
            {
                try
                {
                    await _library.RemoveRootAsync(uri);
                    _selectedRootUris.Remove(uri);
                }
                catch (Exception error)
                {
                    failures.Add((uri, error));
                }
            }
            await RefreshRootsAsync();
        }
        finally
        {
            SetLibraryBusy(false);
        }

        if (failures.Count > 0)
        {
            var details = string.Join(Environment.NewLine, failures.Select(failure => $"{failure.Uri}: {failure.Error.Message}"));
            await ShowMessageAsync("一部のフォルダを削除できませんでした", details);
        }
    }

    private async void LibraryList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not LibraryEntryViewModel item) return;
        if (_selectedRootUris.Count > 0)
        {
            if (item.Kind == LibraryEntryKind.Root && item.Root is not null)
            {
                item.RootIsSelected = !item.RootIsSelected;
                if (item.RootIsSelected) _selectedRootUris.Add(item.Root.Uri);
                else _selectedRootUris.Remove(item.Root.Uri);
                UpdateRootSelectionActions();
            }
            return;
        }
        switch (item.Kind)
        {
            case LibraryEntryKind.Add:
                await PickAndAddFolderAsync();
                break;
            case LibraryEntryKind.Root when item.Root is not null:
                await OpenDirectoryAsync(item.Root, "");
                break;
            case LibraryEntryKind.Folder when item.Folder is not null && _browserRoot is not null:
                await OpenDirectoryAsync(_browserRoot, item.Folder.RelativePath);
                break;
            case LibraryEntryKind.Graph when item.Graph is not null:
                await OpenGraphAsync(item.Graph);
                break;
        }
    }

    private async Task OpenGraphAsync(LibraryGraph item)
    {
        if (item.ParseError is not null)
        {
            await ShowMessageAsync("Yuraiveを読み込めません", item.ParseError);
            return;
        }
        try
        {
            var graph = await _library.ReadGraphAsync(item.Ref);
            var issues = await _library.ValidateAsync(item.Ref, graph);
            var errors = issues.Where(issue => issue.Severity == ValidationSeverity.Error).ToList();
            if (errors.Count > 0)
            {
                await ShowValidationDialogAsync("再生できません", issues, allowPlayback: false);
                return;
            }
            if (issues.Count > 0 && !await ShowValidationDialogAsync("確認", issues, allowPlayback: true)) return;
            _showPlayerOnNarrow = true;
            UpdateAdaptiveLayout();
            await _engine.StartAsync(item.Ref);
        }
        catch (Exception error)
        {
            await ShowMessageAsync("Yuraiveを読み込めません", error.Message);
        }
    }

    private async Task<bool> ShowValidationDialogAsync(string title, IReadOnlyList<ValidationIssue> issues, bool allowPlayback)
    {
        var panel = new StackPanel { Spacing = 10, MaxWidth = 560 };
        foreach (var issue in issues)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            row.Children.Add(new FontIcon
            {
                Glyph = issue.Severity == ValidationSeverity.Error ? "\uE783" : "\uE7BA",
                Foreground = issue.Severity == ValidationSeverity.Error ? new SolidColorBrush(Colors.IndianRed) : new SolidColorBrush(Colors.Goldenrod),
            });
            row.Children.Add(new TextBlock { Text = issue.Message, TextWrapping = TextWrapping.Wrap, MaxWidth = 500 });
            panel.Children.Add(row);
        }
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = title,
            Content = new ScrollViewer { Content = panel, MaxHeight = 520 },
            PrimaryButtonText = allowPlayback ? "再生" : "",
            CloseButtonText = allowPlayback ? "キャンセル" : "閉じる",
            DefaultButton = allowPlayback ? ContentDialogButton.Primary : ContentDialogButton.Close,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }
}
