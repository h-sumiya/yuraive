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
}
