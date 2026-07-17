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
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Hosting;
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
using Yuraive.Core;
using Yuraive.Core.Bridge;
using Yuraive.App.Playback;
using Yuraive.Core.Models;
using Yuraive.Core.Playback;
using Yuraive.Core.Storage;

namespace Yuraive.App;

public sealed partial class MainWindow : Window
{
    private static readonly IReadOnlyList<OpenSourceNoticeViewModel> OpenSourceNotices =
    [
        new("Windows App SDK", "2.2.0", "Microsoft Software License Terms", ["windows_app_sdk_license.txt", "windows_app_sdk_notice.txt"]),
        new("Microsoft Edge WebView2 SDK", "1.0.3719.77", "BSD-3-Clause", ["webview2_license.txt", "webview2_notice.txt"]),
        new("QRCoder", "1.7.0", "MIT", ["license_mit.txt"]),
        new("Starlark Rust", "0.14.2", "Apache-2.0", ["license_apache_2_0.txt"]),
        new("Taffy", "0.12.1", "MIT", ["license_mit_taffy.txt"]),
        new("anyhow", "1.0.103", "MIT OR Apache-2.0", ["license_mit.txt", "license_apache_2_0.txt"]),
        new("fastrand", "2.4.1", "Apache-2.0 OR MIT", ["license_apache_2_0.txt", "license_mit.txt"]),
        new("jni", "0.21.1", "MIT OR Apache-2.0", ["license_mit.txt", "license_apache_2_0.txt"]),
        new("serde", "1.0.228", "MIT OR Apache-2.0", ["license_mit.txt", "license_apache_2_0.txt"]),
        new("serde_json", "1.0.150", "MIT OR Apache-2.0", ["license_mit.txt", "license_apache_2_0.txt"]),
        new("unicode-width", "0.2.2", "MIT OR Apache-2.0", ["license_mit.txt", "license_apache_2_0.txt"]),
    ];

    private readonly Yuraive.Core.Storage.AppDataPaths _paths = new();
    private readonly DocumentLibrary _library;
    private readonly HistoryStore _history;
    private readonly SnapshotStore _snapshots;
    private readonly SettingsStore _settings;
    private readonly GraphPlaybackEngine _engine;
    private readonly PlaybackStatsEvaluator _stats;
    private readonly WindowsLibraryBridgeHost _bridge;
    private readonly string? _activatedBundlePath;
    private readonly ObservableCollection<LibraryEntryViewModel> _libraryItems = [];
    private readonly ObservableCollection<HistoryEntryViewModel> _historyItems = [];
    private readonly Dictionary<string, EditorWindow> _editorWindows = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _selectedRootUris = new(StringComparer.OrdinalIgnoreCase);
    private readonly DisplayRequest _displayRequest = new();
    private IReadOnlyList<LibraryRoot> _rootScan = [];
    private RootGrant? _browserRoot;
    private string _browserPath = "";
    private LibrarySection _section = LibrarySection.Library;
    private bool _initialized;
    private bool _settingsInitializing;
    private bool _sliderDragging;
    private bool _updatingSliderFromPlayback;
    private bool _waveformAnimating;
    private bool _showPlayerOnNarrow;
    private bool _isSearching;
    private bool _addingFolder;
    private bool _displayRequestActive;
    private string? _artworkSourcePath;
    private int _artworkLoadVersion;
    private PlaybackUiState _lastPlaybackState = new();
    private readonly List<Microsoft.UI.Xaml.Shapes.Rectangle> _waveformBars = [];

    public MainWindow(string? activatedBundlePath = null)
    {
        _activatedBundlePath = activatedBundlePath;
        InitializeComponent();
        InitializePlaybackWaveform();
        Title = "Yuraive";
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        var windowId = Win32Interop.GetWindowIdFromWindow(WindowNative.GetWindowHandle(this));
        AppWindow.GetFromWindowId(windowId).Resize(new SizeInt32(1_280, 820));

        _library = new(_paths);
        _bridge = new(_library, _paths);
        _bridge.StatusChanged += Bridge_StatusChanged;
        _history = new(_paths);
        _snapshots = new(_paths);
        _settings = new(_paths);
        _engine = new(_library, _history, _snapshots, _settings, new WindowsMediaPlaybackAdapter(MediaElement));
        _stats = new(_library, _history, _settings);
        _engine.StateChanged += Engine_StateChanged;
        LibraryList.ItemsSource = _libraryItems;
        HistoryList.ItemsSource = _historyItems;
        LicensesList.ItemsSource = OpenSourceNotices;
        RootGrid.Loaded += RootGrid_Loaded;
        RootGrid.SizeChanged += RootGrid_SizeChanged;
        RootGrid.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(RootGrid_PointerPressed), true);
        RootGrid.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(RootGrid_KeyDown), true);
        PositionSlider.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(PositionSlider_PointerPressed), true);
        PositionSlider.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler(PositionSlider_PointerReleased), true);
        ButtonLayout.ButtonPressed += (_, buttonId) => _ = _engine.PressButtonAsync(buttonId);
        Closed += MainWindow_Closed;
    }

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

    private async Task ShowContentInspectionAsync(LibraryGraph item)
    {
        SetLibraryBusy(true);
        try
        {
            var content = await _library.InspectContentAsync(item.Ref);
            var metadata = content.Graph.Metadata;
            var panel = new StackPanel { Spacing = 0, MinWidth = 600 };
            panel.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(metadata?.DisplayName) ? item.DisplayName : metadata.DisplayName,
                FontSize = 24,
                FontWeight = Microsoft.UI.Text.FontWeights.Bold,
                TextWrapping = TextWrapping.Wrap,
            });
            if (!string.IsNullOrWhiteSpace(metadata?.Description))
            {
                panel.Children.Add(new TextBlock
                {
                    Text = metadata.Description,
                    Margin = new Thickness(0, 8, 0, 12),
                    Foreground = new SolidColorBrush(Colors.Gray),
                    TextWrapping = TextWrapping.Wrap,
                });
            }
            AddInspectionMetadataRow(panel, "ファイル", item.Ref.FileName);
            AddInspectionMetadataRow(panel, "形式", content.IsBundle ? "バイナリ (.yuraive)" : "JSON (.yuraive.json)");
            AddInspectionMetadataRow(panel, "作者", metadata?.Author);
            AddInspectionMetadataRow(panel, "Content ID", metadata?.ContentId);
            AddInspectionMetadataRow(panel, "作成日時", metadata?.CreatedAt);
            AddInspectionMetadataRow(panel, "更新日時", metadata?.UpdatedAt);
            AddInspectionMetadataRow(panel, "タグ", metadata?.Tags is { Count: > 0 } tags ? string.Join("、", tags) : null);

            var missing = content.Assets.Count(asset => !asset.Recognized);
            var heading = new Grid { Margin = new Thickness(0, 26, 0, 8) };
            heading.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            heading.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var headingText = new StackPanel { Spacing = 2 };
            headingText.Children.Add(new TextBlock { Text = "参照アセット", FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.Bold });
            headingText.Children.Add(new TextBlock
            {
                Text = $"{content.Assets.Count - missing} / {content.Assets.Count} 件を確認",
                FontSize = 12,
                Foreground = new SolidColorBrush(Colors.Gray),
            });
            heading.Children.Add(headingText);
            if (missing > 0)
            {
                var missingText = new TextBlock
                {
                    Text = $"{missing}件を認識できません",
                    Foreground = new SolidColorBrush(Colors.IndianRed),
                    VerticalAlignment = VerticalAlignment.Bottom,
                };
                Grid.SetColumn(missingText, 1);
                heading.Children.Add(missingText);
            }
            panel.Children.Add(heading);
            panel.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Colors.Gray), Opacity = .35 });

            if (content.Assets.Count == 0)
            {
                panel.Children.Add(new TextBlock
                {
                    Text = "参照アセットはありません",
                    Margin = new Thickness(0, 28, 0, 20),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Foreground = new SolidColorBrush(Colors.Gray),
                });
            }
            else
            {
                var tree = new TreeView
                {
                    SelectionMode = TreeViewSelectionMode.None,
                    MaxHeight = 380,
                    ItemTemplate = (DataTemplate)Application.Current.Resources["InspectionTreeNodeTemplate"],
                };
                foreach (var node in BuildInspectionTree(content.Assets)) tree.RootNodes.Add(node);
                panel.Children.Add(tree);
            }

            var dialog = new ContentDialog
            {
                XamlRoot = RootGrid.XamlRoot,
                Title = "作品情報とアセット",
                Content = new ScrollViewer
                {
                    Content = panel,
                    MaxHeight = 650,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                },
                CloseButtonText = "閉じる",
                DefaultButton = ContentDialogButton.Close,
            };
            await dialog.ShowAsync();
        }
        catch (Exception error)
        {
            await ShowMessageAsync("作品ファイルを解析できません", error.Message);
        }
        finally { SetLibraryBusy(false); }
    }

    private static void AddInspectionMetadataRow(Panel panel, string label, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var row = new Grid { Padding = new Thickness(0, 9, 0, 9) };
        row.ColumnDefinitions.Add(new() { Width = new GridLength(110) });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        row.Children.Add(new TextBlock { Text = label, FontSize = 12, Foreground = new SolidColorBrush(Colors.Gray) });
        var text = new TextBlock { Text = value, TextWrapping = TextWrapping.Wrap };
        Grid.SetColumn(text, 1);
        row.Children.Add(text);
        panel.Children.Add(row);
        panel.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Colors.Gray), Opacity = .25 });
    }

    private static IReadOnlyList<TreeViewNode> BuildInspectionTree(IReadOnlyList<LibraryAssetInspection> assets)
    {
        var root = new InspectionTreeBranch();
        foreach (var asset in assets)
        {
            var parts = asset.Problem == AssetInspectionProblem.UnsafePath
                ? new[] { asset.Path }
                : asset.Path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;
            var branch = root;
            foreach (var folder in parts.Take(parts.Length - 1))
            {
                if (!branch.Folders.TryGetValue(folder, out var child)) branch.Folders[folder] = child = new();
                branch = child;
            }
            branch.Files.Add((parts[^1], asset));
        }

        IReadOnlyList<TreeViewNode> Convert(InspectionTreeBranch branch)
        {
            var result = new List<TreeViewNode>();
            foreach (var (name, child) in branch.Folders)
            {
                var node = new TreeViewNode { Content = InspectionTreeRow(name, "\uE8B7", null, recognized: true), IsExpanded = true };
                foreach (var nested in Convert(child)) node.Children.Add(nested);
                result.Add(node);
            }
            foreach (var (name, asset) in branch.Files.OrderBy(value => value.Asset.Path, StringComparer.Ordinal))
            {
                var status = asset.Problem switch
                {
                    AssetInspectionProblem.UnsafePath => "不正なパス",
                    AssetInspectionProblem.Missing => "見つかりません",
                    _ => asset.Embedded ? "内蔵" : null,
                };
                result.Add(new TreeViewNode { Content = InspectionTreeRow(name, "\uE8A5", status, asset.Recognized) });
            }
            return result;
        }

        return Convert(root);
    }

    private static FrameworkElement InspectionTreeRow(string name, string glyph, string? status, bool recognized)
    {
        var color = recognized ? new SolidColorBrush(Colors.Transparent) : new SolidColorBrush(Colors.IndianRed);
        var row = new Grid { MinHeight = 36 };
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 17,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!recognized) icon.Foreground = color;
        row.Children.Add(icon);
        var text = new TextBlock
        {
            Text = name,
            Margin = new Thickness(9, 0, 10, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!recognized) text.Foreground = color;
        Grid.SetColumn(text, 1);
        row.Children.Add(text);
        if (status is not null)
        {
            var badge = new TextBlock { Text = status, FontSize = 11, Foreground = recognized ? new SolidColorBrush(Colors.Gray) : color, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(badge, 2);
            row.Children.Add(badge);
        }
        return row;
    }

    private async void LibraryItemAction_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not LibraryEntryViewModel item) return;
        if (item.Kind == LibraryEntryKind.Graph && item.Graph is not null)
        {
            await _library.ToggleFavoriteAsync(item.Graph.Ref.GraphId);
            UpdateGraphFavoriteItem(item);
            UpdateFavoriteIcon(_lastPlaybackState);
            if (_section == LibrarySection.Favorites) _libraryItems.Remove(item);
        }
    }

    private async void QuickActionButton_Click(object sender, RoutedEventArgs e)
    {
        var action = (sender as FrameworkElement)?.Tag?.ToString();
        switch (action)
        {
            case "played":
                var playedIds = (await _history.ReadAllAsync()).Select(entry => entry.GraphId).Distinct(StringComparer.Ordinal);
                await ShowCollectionAsync("再生した作品", await _library.ResolveGraphsAsync(playedIds));
                break;
            case "recent":
                await ShowCollectionAsync("最近追加", _library.KnownGraphs.OrderByDescending(graph => graph.ModifiedAt));
                break;
            case "favorites":
                await ShowFavoritesAsync();
                break;
            case "shuffle":
                var candidates = _library.KnownGraphs.Where(graph => graph.ParseError is null).ToList();
                if (candidates.Count == 0) await ShowCollectionAsync("シャッフル", []);
                else await OpenGraphAsync(candidates[Random.Shared.Next(candidates.Count)]);
                break;
        }
    }

    private void SearchButton_Click(object sender, RoutedEventArgs e)
    {
        _isSearching = true;
        HomeHeaderPanel.Visibility = Visibility.Collapsed;
        DetailHeaderPanel.Visibility = Visibility.Collapsed;
        SearchPanel.Visibility = Visibility.Visible;
        QuickActionsGrid.Visibility = Visibility.Collapsed;
        LibraryHeaderActions.Visibility = Visibility.Collapsed;
        SectionTitle.Text = "検索結果";
        SearchBox.Focus(FocusState.Programmatic);
    }

    private async void SearchBackButton_Click(object sender, RoutedEventArgs e) => await ShowRootsAsync();

    private async void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_isSearching) await UpdateSearchResultsAsync();
    }

    private async Task UpdateSearchResultsAsync()
    {
        var query = SearchBox.Text.Trim();
        var roots = _rootScan.Where(root => query.Length == 0 || root.Grant.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase));
        var items = new List<LibraryEntryViewModel>();
        foreach (var root in roots)
        {
            var preview = await FindPreviewGraphAsync(root.Grant, root.Directory);
            items.Add(new()
            {
                Kind = LibraryEntryKind.Root,
                Title = root.Grant.Name,
                Subtitle = root.Error ?? "",
                Glyph = root.Error is null ? "\uE8B7" : "\uE783",
                Thumbnail = ThumbnailSource(preview),
                BlurredThumbnail = ThumbnailSource(preview, 48),
                Root = root.Grant,
            });
        }
        items.AddRange(_library.KnownGraphs
            .Where(graph => query.Length == 0
                || graph.DisplayName.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || graph.Author?.Contains(query, StringComparison.CurrentCultureIgnoreCase) == true)
            .Select(graph => new LibraryEntryViewModel
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
            }));
        ReplaceLibraryItems(items);
        SetEmptyState(items.Count == 0, "一致する項目はありません", "別のキーワードを試してください。", showAdd: false);
    }

    private async void TopBackButton_Click(object sender, RoutedEventArgs e) => await GoBackAsync();

    private async void RootGrid_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (!e.GetCurrentPoint(RootGrid).Properties.IsXButton1Pressed) return;
        e.Handled = true;
        await GoBackAsync();
    }

    private async void RootGrid_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Escape) return;
        e.Handled = true;
        await GoBackAsync();
    }

    private async Task GoBackAsync()
    {
        if (_showPlayerOnNarrow)
        {
            _showPlayerOnNarrow = false;
            UpdateAdaptiveLayout();
            return;
        }
        if (_isSearching)
        {
            await ShowRootsAsync();
            return;
        }
        if (_section == LibrarySection.Licenses)
        {
            if (LicenseDetailContent.Visibility == Visibility.Visible)
            {
                ShowLicenseList();
                return;
            }
            _section = LibrarySection.Settings;
            ShowSettings();
            return;
        }
        if (_section is LibrarySection.History or LibrarySection.Settings or LibrarySection.Favorites or LibrarySection.Collection)
        {
            await ShowRootsAsync();
            return;
        }
        if (_browserRoot is null)
        {
            await ShowRootsAsync();
            return;
        }
        if (_browserPath.Length == 0)
        {
            await ShowRootsAsync();
            return;
        }
        var parent = _browserPath.Contains('/') ? _browserPath[.._browserPath.LastIndexOf('/')] : "";
        await OpenDirectoryAsync(_browserRoot, parent);
    }

    private async void HistoryList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not HistoryEntryViewModel { Graph: { } graph }) return;
        var root = _rootScan.FirstOrDefault(item => string.Equals(item.Grant.Uri, graph.Ref.RootUri, StringComparison.OrdinalIgnoreCase))?.Grant
            ?? new RootGrant(graph.Ref.RootUri, graph.Ref.RootName);
        _section = LibrarySection.Library;
        await OpenDirectoryAsync(root, graph.Ref.ParentPath);
    }

    private void LicensesList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is OpenSourceNoticeViewModel notice) ShowLicenseDetail(notice);
    }

    private async void LicenseBackButton_Click(object sender, RoutedEventArgs e) => await GoBackAsync();

    private async Task<LibraryDirectory?> SafeInspectDirectoryAsync(RootGrant root, string path)
    {
        try { return await _library.InspectDirectoryAsync(root, path); }
        catch { return null; }
    }

    private async Task<LibraryGraph?> FindPreviewGraphAsync(RootGrant root, LibraryDirectory? directory, int depth = 0)
    {
        if (directory?.Graphs.FirstOrDefault() is { } graph) return graph;
        if (directory is null || depth >= 3) return null;
        foreach (var folder in directory.Folders.Take(16))
        {
            var nested = await SafeInspectDirectoryAsync(root, folder.RelativePath);
            if (await FindPreviewGraphAsync(root, nested, depth + 1) is { } preview) return preview;
        }
        return null;
    }

    private ImageSource? ThumbnailSource(LibraryGraph? graph, int decodePixelWidth = 720)
    {
        if (graph?.ThumbnailPath is null || _library.GetAssetPath(graph.Ref, graph.ThumbnailPath) is not { } path) return null;
        try { return new BitmapImage(new Uri(path)) { DecodePixelWidth = decodePixelWidth }; }
        catch { return null; }
    }

    private void LibraryItem_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        if (sender is FrameworkElement item) UpdateLibraryItemHoverActions(item, true);
    }

    private void LibraryItem_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (sender is FrameworkElement item) UpdateLibraryItemHoverActions(item, false);
    }

    private static void UpdateLibraryItemHoverActions(FrameworkElement item, bool hovered)
    {
        if (FindDescendantByName<ToggleButton>(item, "RootSelectionButton") is { } selection)
            selection.Visibility = hovered || selection.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        if (FindDescendantByName<Button>(item, "LibraryItemActionButton") is { } action)
            action.Visibility = hovered ? Visibility.Visible : Visibility.Collapsed;
    }

    private void LibraryItem_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: LibraryEntryViewModel item } anchor) return;
        var point = e.GetCurrentPoint(anchor);
        if (point.Properties.PointerUpdateKind != Microsoft.UI.Input.PointerUpdateKind.RightButtonReleased) return;
        e.Handled = true;
        ShowLibraryItemMenu(item, anchor, point.Position);
    }

    private void LibraryItem_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (e.PointerDeviceType == Microsoft.UI.Input.PointerDeviceType.Mouse) return;
        if (sender is not FrameworkElement { DataContext: LibraryEntryViewModel item } anchor) return;
        e.Handled = true;
        ShowLibraryItemMenu(item, anchor, e.GetPosition(anchor));
    }

    private void ShowLibraryItemMenu(LibraryEntryViewModel item, FrameworkElement anchor, Windows.Foundation.Point position)
    {
        var menu = new MenuFlyout();
        if (item.Kind == LibraryEntryKind.Root && item.Root is not null)
        {
            var edit = new MenuFlyoutItem
            {
                Text = "エディタで開く",
                Icon = new FontIcon { Glyph = "\uE70F" },
                IsEnabled = CanEditRoot(item.Root),
            };
            edit.Click += async (_, _) => await OpenEditorAsync(item.Root);
            menu.Items.Add(edit);
            var remove = new MenuFlyoutItem { Text = "フォルダを削除", Icon = new FontIcon { Glyph = "\uE74D" } };
            remove.Click += async (_, _) =>
            {
                _selectedRootUris.Remove(item.Root.Uri);
                await _library.RemoveRootAsync(item.Root.Uri);
                await RefreshRootsAsync();
            };
            menu.Items.Add(remove);
        }
        if (item.Kind == LibraryEntryKind.Graph && item.Graph is not null)
        {
            var inspect = new MenuFlyoutItem
            {
                Text = "作品情報とアセット",
                Icon = new FontIcon { Glyph = "\uE946" },
                IsEnabled = item.Graph.ParseError is null,
            };
            inspect.Click += async (_, _) => await ShowContentInspectionAsync(item.Graph);
            menu.Items.Add(inspect);
            var favorite = new MenuFlyoutItem
            {
                Text = _library.FavoriteIds.Contains(item.Graph.Ref.GraphId) ? "お気に入りから削除" : "お気に入りに追加",
                Icon = new FontIcon { Glyph = "\uE734" },
            };
            favorite.Click += async (_, _) =>
            {
                await _library.ToggleFavoriteAsync(item.Graph.Ref.GraphId);
                UpdateGraphFavoriteItem(item);
                if (_section == LibrarySection.Favorites) _libraryItems.Remove(item);
                UpdateFavoriteIcon(_lastPlaybackState);
            };
            menu.Items.Add(favorite);
        }
        if (menu.Items.Count > 0) menu.ShowAt(anchor, position);
    }

    private async Task OpenEditorAsync(RootGrant root)
    {
        try
        {
            if (!CanEditRoot(root)) throw new InvalidOperationException("ローカルフォルダだけをエディタで開けます");
            if (_editorWindows.TryGetValue(root.Uri, out var existing))
            {
                existing.Activate();
                return;
            }

            var editor = new EditorWindow(root.Uri, root.Name);
            _editorWindows[root.Uri] = editor;
            editor.Closed += (_, _) => _editorWindows.Remove(root.Uri);
            editor.Activate();
        }
        catch (Exception error)
        {
            await ShowMessageAsync("エディタを開けません", error.Message);
        }
    }

    private static bool CanEditRoot(RootGrant root)
    {
        try { return Path.IsPathFullyQualified(root.Uri) && Directory.Exists(root.Uri); }
        catch { return false; }
    }

    private async void AddFolderButton_Click(object sender, RoutedEventArgs e)
        => await PickAndAddFolderAsync();

    private async Task PickAndAddFolderAsync()
    {
        if (_addingFolder) return;
        _addingFolder = true;
        AddFolderButton.IsEnabled = false;
        EmptyAddFolderButton.IsEnabled = false;
        try
        {
            var result = await new RemoteFolderDialog(_library).ShowAsync(RootGrid.XamlRoot);
            if (result == AddFolderDialogResult.Local) await PickLocalAndAddFolderAsync();
            else if (result == AddFolderDialogResult.RemoteAdded)
            {
                _section = LibrarySection.Library;
                _browserRoot = null;
                await RefreshRootsAsync();
            }
        }
        catch (Exception error)
        {
            _section = LibrarySection.Library;
            _browserRoot = null;
            try { await RefreshRootsAsync(); }
            catch
            {
                _rootScan = [];
                await ShowRootsAsync();
            }
            await ShowMessageAsync("フォルダを追加できません", error.Message);
        }
        finally
        {
            _addingFolder = false;
            AddFolderButton.IsEnabled = true;
            EmptyAddFolderButton.IsEnabled = true;
        }
    }

    private async Task PickLocalAndAddFolderAsync()
    {
        var windowId = Win32Interop.GetWindowIdFromWindow(WindowNative.GetWindowHandle(this));
        var picker = new Microsoft.Windows.Storage.Pickers.FolderPicker(windowId)
        {
            SuggestedStartLocation = Microsoft.Windows.Storage.Pickers.PickerLocationId.MusicLibrary,
            CommitButtonText = "このフォルダーを追加",
            Title = "ライブラリに追加するフォルダーを選択",
        };
        var folder = await picker.PickSingleFolderAsync();
        if (folder is null || string.IsNullOrWhiteSpace(folder.Path)) return;
        var path = Path.GetFullPath(folder.Path);
        await _library.AddRootAsync(path, new DirectoryInfo(path).Name);
        _section = LibrarySection.Library;
        _browserRoot = null;
        await RefreshRootsAsync();
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await RefreshRootsAsync();

    private async void HistoryNavButton_Click(object sender, RoutedEventArgs e) { _section = LibrarySection.History; await ShowHistoryAsync(); }
    private void SettingsNavButton_Click(object sender, RoutedEventArgs e) { _section = LibrarySection.Settings; ShowSettings(); }
    private void LicensesLink_Click(object sender, RoutedEventArgs e) => ShowLicenses();
    private async void GitHubLink_Click(object sender, RoutedEventArgs e) => await OpenExternalUriAsync("https://github.com/h-sumiya/yuraive");
    private async void ContactLink_Click(object sender, RoutedEventArgs e) => await OpenExternalUriAsync("https://hiro.red/contact");
    private async void PrivacyLink_Click(object sender, RoutedEventArgs e) => await OpenExternalUriAsync("https://yuraive.com/privacy/");

    private async Task OpenExternalUriAsync(string uri)
    {
        try
        {
            if (!await Launcher.LaunchUriAsync(new Uri(uri)))
                await ShowMessageAsync("リンクを開けません", uri);
        }
        catch (Exception error)
        {
            await ShowMessageAsync("リンクを開けません", error.Message);
        }
    }

    private async Task RefreshCurrentSectionAsync()
    {
        if (_section == LibrarySection.Favorites) await ShowFavoritesAsync();
        else if (_section == LibrarySection.Library)
        {
            if (_browserRoot is null) await ShowRootsAsync(); else await OpenDirectoryAsync(_browserRoot, _browserPath);
        }
        else if (_section == LibrarySection.History) await ShowHistoryAsync();
    }

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
            XamlRoot = RootGrid.XamlRoot, Title = "共有内容を確認", Content = panel,
            PrimaryButtonText = "Xで開く", SecondaryButtonText = "コピー", CloseButtonText = "キャンセル",
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
