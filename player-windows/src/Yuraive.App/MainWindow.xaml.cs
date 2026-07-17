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
}
