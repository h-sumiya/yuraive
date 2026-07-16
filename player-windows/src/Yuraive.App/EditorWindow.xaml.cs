using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Graphics;
using WinRT.Interop;

namespace Yuraive.App;

public sealed partial class EditorWindow : Window
{
    private const string EditorHost = "appassets.example";
    private const string ContentHost = "contentassets.example";
    private readonly string _folderPath;
    private Task<string>? _directoryDescriptorTask;
    private bool _directoryDescriptorPosted;
    private bool _initialized;

    public EditorWindow(string folderPath, string folderName)
    {
        _folderPath = Path.GetFullPath(folderPath);
        InitializeComponent();
        Title = $"{folderName} を編集 - Yuraive";
        TitleText.Text = $"{folderName} · Editor";
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        var windowId = Win32Interop.GetWindowIdFromWindow(WindowNative.GetWindowHandle(this));
        AppWindow.GetFromWindowId(windowId).Resize(new SizeInt32(1_440, 900));
        RootGrid.Loaded += RootGrid_Loaded;
    }

    private async void RootGrid_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        try
        {
            if (!Directory.Exists(_folderPath)) throw new DirectoryNotFoundException("編集するフォルダが見つかりません");
            var editorPath = Path.Combine(AppContext.BaseDirectory, "Editor");
            if (!File.Exists(Path.Combine(editorPath, "index.html")))
                throw new FileNotFoundException("オフラインエディタがアプリに含まれていません");

            await EditorWebView.EnsureCoreWebView2Async();
            var core = EditorWebView.CoreWebView2;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
#if !DEBUG
            core.Settings.AreDevToolsEnabled = false;
#endif
            core.SetVirtualHostNameToFolderMapping(EditorHost, editorPath, CoreWebView2HostResourceAccessKind.Deny);
            core.SetVirtualHostNameToFolderMapping(ContentHost, _folderPath, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += CoreWebView2_WebMessageReceived;
            core.NavigationStarting += (_, args) =>
            {
                if (!IsEditorSource(args.Uri)) args.Cancel = true;
                else _directoryDescriptorPosted = false;
            };
            core.NavigationCompleted += async (_, args) =>
            {
                LoadingIndicator.IsActive = false;
                LoadingIndicator.Visibility = Visibility.Collapsed;
                if (args.IsSuccess) await PostDirectoryDescriptorAsync(core);
            };
            EditorWebView.Source = new Uri($"https://{EditorHost}/index.html");
        }
        catch (Exception error)
        {
            LoadingIndicator.IsActive = false;
            LoadingIndicator.Visibility = Visibility.Collapsed;
            ErrorBar.Title = "エディタを開けません";
            ErrorBar.Message = error.Message;
            ErrorBar.IsOpen = true;
        }
    }

    private async void CoreWebView2_WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!IsEditorSource(args.Source) || !IsEditorSource(sender.Source)) return;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            if (!message.RootElement.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "yuraive-editor-ready":
                    await PostDirectoryDescriptorAsync(sender);
                    break;
                case "yuraive-native-request":
                    HandleNativeRequest(sender, message.RootElement);
                    break;
            }
        }
        catch (JsonException)
        {
            // Ignore messages that are not part of the native editor protocol.
        }
        catch (Exception error)
        {
            ShowBridgeError(error);
        }
    }

    private async Task PostDirectoryDescriptorAsync(CoreWebView2 core)
    {
        if (!IsEditorSource(core.Source)) return;
        try
        {
            _directoryDescriptorTask ??= Task.Run(BuildDirectoryDescriptor);
            var descriptor = await _directoryDescriptorTask;
            if (!_directoryDescriptorPosted && IsEditorSource(core.Source))
            {
                core.PostWebMessageAsJson(descriptor);
                _directoryDescriptorPosted = true;
            }
        }
        catch (Exception error)
        {
            ShowBridgeError(error);
        }
    }

    private string BuildDirectoryDescriptor()
    {
        var entries = Directory.EnumerateDirectories(_folderPath, "*", SearchOption.AllDirectories)
                .Select(path => (object)new
                {
                    path = RelativePath(path),
                    kind = "directory"
                })
                .Concat(Directory.EnumerateFiles(_folderPath, "*", SearchOption.AllDirectories).Select(path =>
                {
                    var info = new FileInfo(path);
                    return (object)new
                    {
                        path = RelativePath(path),
                        kind = "file",
                        size = info.Length,
                        lastModified = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds()
                    };
                }))
                .ToArray();
        return JsonSerializer.Serialize(new
        {
            type = "yuraive-native-directory",
            name = GetFolderDisplayName(_folderPath),
            contentBaseUrl = $"https://{ContentHost}/",
            entries
        });
    }

    private static string GetFolderDisplayName(string folderPath)
    {
        var name = new DirectoryInfo(folderPath).Name;
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        return Path.GetPathRoot(folderPath)?.TrimEnd(Path.DirectorySeparatorChar) ?? folderPath;
    }

    private void HandleNativeRequest(CoreWebView2 core, JsonElement message)
    {
        var id = message.GetProperty("id").GetInt32();
        try
        {
            var action = message.GetProperty("action").GetString();
            var path = ResolvePath(message.GetProperty("path").GetString());
            switch (action)
            {
                case "ensure-directory":
                    Directory.CreateDirectory(path);
                    break;
                case "ensure-file":
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    using (File.Open(path, FileMode.OpenOrCreate, FileAccess.Write, FileShare.Read)) { }
                    break;
                case "remove":
                    if (File.Exists(path)) File.Delete(path);
                    else if (Directory.Exists(path)) Directory.Delete(path, message.TryGetProperty("recursive", out var recursive) && recursive.GetBoolean());
                    else throw new FileNotFoundException("削除する項目が見つかりません");
                    break;
                case "write":
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    File.WriteAllBytes(path, Convert.FromBase64String(message.GetProperty("data").GetString() ?? ""));
                    break;
                case "copy":
                    var source = ResolvePath(message.GetProperty("sourcePath").GetString());
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    if (!source.Equals(path, StringComparison.OrdinalIgnoreCase)) File.Copy(source, path, true);
                    break;
                default:
                    throw new InvalidOperationException("未対応のフォルダ操作です");
            }
            _directoryDescriptorTask = null;
            _directoryDescriptorPosted = false;
            PostNativeResponse(core, id, true, null);
        }
        catch (Exception error)
        {
            PostNativeResponse(core, id, false, error.Message);
        }
    }

    private static void PostNativeResponse(CoreWebView2 core, int id, bool ok, string? error) =>
        core.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "yuraive-native-response",
            id,
            ok,
            error
        }));

    private string ResolvePath(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath))
            throw new InvalidOperationException("無効な相対パスです");
        var candidate = Path.GetFullPath(Path.Combine(_folderPath, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        var rootPrefix = _folderPath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("編集フォルダの外にはアクセスできません");
        return candidate;
    }

    private string RelativePath(string path) => Path.GetRelativePath(_folderPath, path).Replace(Path.DirectorySeparatorChar, '/');

    private void ShowBridgeError(Exception error)
    {
        ErrorBar.Title = "フォルダをエディタへ渡せません";
        ErrorBar.Message = error.Message;
        ErrorBar.IsOpen = true;
    }

    private static bool IsEditorSource(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.Host.Equals(EditorHost, StringComparison.OrdinalIgnoreCase);
}
