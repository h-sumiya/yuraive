using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Yuraive.Core.Storage;

namespace Yuraive.App;

internal enum AddFolderDialogResult { Cancelled, Local, RemoteAdded }

internal sealed class RemoteFolderDialog
{
    private const double DialogContentWidth = 480;

    private enum Step { Source, Connection, Browser }

    private readonly DocumentLibrary _library;
    private readonly ContentDialog _dialog = new() { CloseButtonText = "キャンセル", DefaultButton = ContentDialogButton.Primary };
    private readonly ProgressRing _progress = new() { Width = 24, Height = 24, Visibility = Visibility.Collapsed };
    private readonly TextBlock _error = new()
    {
        Foreground = new SolidColorBrush(Microsoft.UI.Colors.IndianRed),
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };
    private readonly TextBox _smbHost = Field("サーバー", "nas.example.com または IP アドレス");
    private readonly TextBox _smbPort = Field("ポート", "445");
    private readonly TextBox _smbShare = Field("共有名", "media");
    private readonly TextBox _smbDomain = Field("ドメイン（任意）");
    private readonly TextBox _smbUsername = Field("ユーザー名（任意）");
    private readonly PasswordBox _smbPassword = PasswordField();
    private readonly TextBox _smbName = Field("ライブラリ表示名（任意）");
    private readonly TextBox _webDavEndpoint = Field("WebDAV URL（HTTPS）", "https://server.example/dav/");
    private readonly TextBox _webDavUsername = Field("ユーザー名（任意）");
    private readonly PasswordBox _webDavPassword = PasswordField();
    private readonly TextBox _webDavName = Field("ライブラリ表示名（任意）");
    private readonly TextBlock _currentPathText = new() { FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
    private readonly ListView _folderList = new()
    {
        Height = 390,
        IsItemClickEnabled = true,
        SelectionMode = ListViewSelectionMode.None,
        DisplayMemberPath = nameof(RemoteFolder.Name),
    };
    private Step _step;
    private RemoteProtocol _protocol;
    private string _currentPath = "";
    private bool _busy;
    private bool _navigationQueued;
    private AddFolderDialogResult _result;

    public RemoteFolderDialog(DocumentLibrary library)
    {
        _library = library;
        _smbPort.Text = "445";
        _dialog.PrimaryButtonClick += Dialog_PrimaryButtonClick;
        _dialog.SecondaryButtonClick += Dialog_SecondaryButtonClick;
        _folderList.ItemClick += FolderList_ItemClick;
        ShowSource();
    }

    public async Task<AddFolderDialogResult> ShowAsync(XamlRoot xamlRoot)
    {
        _dialog.XamlRoot = xamlRoot;
        await _dialog.ShowAsync();
        return _result;
    }

    private void ShowSource()
    {
        DetachConnectionControls();
        Detach(_currentPathText, _folderList);
        _step = Step.Source;
        _dialog.Title = "フォルダを追加";
        _dialog.PrimaryButtonText = "";
        _dialog.SecondaryButtonText = "";
        ClearError();
        var panel = new Grid { ColumnSpacing = 8, Width = DialogContentWidth };
        panel.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        panel.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        panel.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var local = SourceButton("この PC", "\uE8B7");
        var smb = SourceButton("SMB", "\uE968");
        var webDav = SourceButton("WebDAV", "\uE753");
        local.Click += (_, _) => QueueNavigation(() => { _result = AddFolderDialogResult.Local; _dialog.Hide(); });
        smb.Click += (_, _) => QueueNavigation(() => { _protocol = RemoteProtocol.Smb; ShowConnection(); });
        webDav.Click += (_, _) => QueueNavigation(() => { _protocol = RemoteProtocol.WebDav; ShowConnection(); });
        Grid.SetColumn(smb, 1);
        Grid.SetColumn(webDav, 2);
        panel.Children.Add(local);
        panel.Children.Add(smb);
        panel.Children.Add(webDav);
        _dialog.Content = new Border { Padding = new Thickness(0, 10, 0, 4), Child = panel };
    }

    private void ShowConnection()
    {
        DetachConnectionControls();
        Detach(_currentPathText, _folderList);
        _step = Step.Connection;
        _dialog.Title = _protocol == RemoteProtocol.Smb ? "SMB に接続" : "WebDAV に接続";
        _dialog.PrimaryButtonText = "接続";
        _dialog.SecondaryButtonText = "戻る";
        ClearError();
        var fields = new StackPanel { Spacing = 12 };
        if (_protocol == RemoteProtocol.Smb)
        {
            fields.Children.Add(_smbHost);
            fields.Children.Add(_smbPort);
            fields.Children.Add(_smbShare);
            fields.Children.Add(_smbDomain);
            fields.Children.Add(_smbUsername);
            fields.Children.Add(_smbPassword);
            fields.Children.Add(_smbName);
        }
        else
        {
            fields.Children.Add(_webDavEndpoint);
            fields.Children.Add(_webDavUsername);
            fields.Children.Add(_webDavPassword);
            fields.Children.Add(_webDavName);
        }
        fields.Children.Add(_error);
        fields.Children.Add(_progress);
        _dialog.Content = new ScrollViewer
        {
            Content = fields,
            MaxHeight = 520,
            Width = DialogContentWidth,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
    }

    private void ShowBrowser(IReadOnlyList<RemoteFolder> folders)
    {
        DetachConnectionControls();
        Detach(_currentPathText, _folderList);
        _step = Step.Browser;
        _dialog.Title = "フォルダを選択";
        _dialog.PrimaryButtonText = "このフォルダを追加";
        _dialog.SecondaryButtonText = _currentPath.Length == 0 ? "接続設定" : "上へ";
        _currentPathText.Text = _currentPath.Length == 0 ? "/" : $"/{_currentPath}";
        _folderList.ItemsSource = folders;
        var panel = new StackPanel { Spacing = 8, Width = DialogContentWidth };
        panel.Children.Add(new TextBlock { Text = "現在地", Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray), FontSize = 12 });
        panel.Children.Add(_currentPathText);
        panel.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Microsoft.UI.Colors.Gray), Opacity = .35 });
        panel.Children.Add(_folderList);
        panel.Children.Add(_error);
        panel.Children.Add(_progress);
        _dialog.Content = panel;
    }

    private async void Dialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (_busy || _step == Step.Source) return;
        args.Cancel = true;
        var deferral = args.GetDeferral();
        try
        {
            if (_step == Step.Connection)
            {
                _currentPath = "";
                await LoadFoldersAsync(openBrowser: true);
            }
            else
            {
                await SetBusyAsync(async () =>
                {
                    var config = CurrentConfig();
                    var fallback = _currentPath.Split('/').LastOrDefault() ?? (_protocol == RemoteProtocol.Smb ? config.Share : "");
                    await _library.AddRemoteRootAsync(config, _currentPath, fallback);
                    _result = AddFolderDialogResult.RemoteAdded;
                    _dialog.Hide();
                });
            }
        }
        finally { deferral.Complete(); }
    }

    private void Dialog_SecondaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (_busy) { args.Cancel = true; return; }
        args.Cancel = true;
        if (_step == Step.Connection) QueueNavigation(ShowSource);
        else if (_step == Step.Browser)
        {
            if (_currentPath.Length == 0) QueueNavigation(ShowConnection);
            else
            {
                QueueNavigation(() =>
                {
                    _currentPath = _currentPath.Contains('/') ? _currentPath[.._currentPath.LastIndexOf('/')] : "";
                    _ = LoadFoldersAsync(openBrowser: true);
                });
            }
        }
    }

    private async void FolderList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (_busy || e.ClickedItem is not RemoteFolder folder) return;
        _currentPath = folder.RelativePath;
        await LoadFoldersAsync(openBrowser: true);
    }

    private async Task LoadFoldersAsync(bool openBrowser)
    {
        await SetBusyAsync(async () =>
        {
            var config = CurrentConfig();
            var validation = RemotePaths.Validate(config);
            if (validation is not null) throw new ArgumentException(validation);
            var folders = await _library.BrowseRemoteFoldersAsync(config, _currentPath);
            if (openBrowser) ShowBrowser(folders);
            else _folderList.ItemsSource = folders;
        });
    }

    private async Task SetBusyAsync(Func<Task> action)
    {
        _busy = true;
        ClearError();
        _progress.Visibility = Visibility.Visible;
        _progress.IsActive = true;
        _dialog.IsPrimaryButtonEnabled = false;
        _dialog.IsSecondaryButtonEnabled = false;
        _folderList.IsEnabled = false;
        try { await action(); }
        catch (Exception error) { ShowError(error.Message.Length == 0 ? "接続できませんでした" : error.Message); }
        finally
        {
            _busy = false;
            _progress.IsActive = false;
            _progress.Visibility = Visibility.Collapsed;
            _dialog.IsPrimaryButtonEnabled = true;
            _dialog.IsSecondaryButtonEnabled = true;
            _folderList.IsEnabled = true;
        }
    }

    private RemoteConnectionConfig CurrentConfig() => _protocol == RemoteProtocol.Smb
        ? new RemoteConnectionConfig
        {
            Protocol = RemoteProtocol.Smb,
            Host = _smbHost.Text,
            Port = int.TryParse(_smbPort.Text, out var port) ? port : 0,
            Share = _smbShare.Text,
            Domain = _smbDomain.Text,
            Username = _smbUsername.Text,
            Password = _smbPassword.Password,
            DisplayName = _smbName.Text,
        }
        : new RemoteConnectionConfig
        {
            Protocol = RemoteProtocol.WebDav,
            Endpoint = _webDavEndpoint.Text,
            Username = _webDavUsername.Text,
            Password = _webDavPassword.Password,
            DisplayName = _webDavName.Text,
        };

    private void ShowError(string message)
    {
        _error.Text = message;
        _error.Visibility = Visibility.Visible;
    }

    private void ClearError()
    {
        _error.Text = "";
        _error.Visibility = Visibility.Collapsed;
    }

    private static TextBox Field(string header, string placeholder = "") => new()
    {
        Header = header,
        PlaceholderText = placeholder,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private static PasswordBox PasswordField() => new() { Header = "パスワード（任意）", PasswordRevealMode = PasswordRevealMode.Peek };

    private static Button SourceButton(string label, string glyph)
    {
        var content = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Spacing = 9 };
        content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 28 });
        content.Children.Add(new TextBlock { Text = label, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
        return new Button
        {
            Content = content,
            Height = 112,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            CornerRadius = new CornerRadius(18),
        };
    }

    private void QueueNavigation(Action action)
    {
        if (_navigationQueued) return;
        _navigationQueued = true;
        if (!_dialog.DispatcherQueue.TryEnqueue(() =>
        {
            try { if (!_busy) action(); }
            finally { _navigationQueued = false; }
        })) _navigationQueued = false;
    }

    private void DetachConnectionControls() => Detach(
        _smbHost, _smbPort, _smbShare, _smbDomain, _smbUsername, _smbPassword, _smbName,
        _webDavEndpoint, _webDavUsername, _webDavPassword, _webDavName, _error, _progress);

    private static void Detach(params FrameworkElement[] elements)
    {
        foreach (var element in elements)
            if (element.Parent is Panel panel) panel.Children.Remove(element);
    }
}
