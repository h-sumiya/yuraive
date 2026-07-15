using System.Globalization;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Yuraive.Core.Interop;
using Yuraive.Core.Models;
using Windows.UI;

namespace Yuraive.App;

/// <summary>
/// Native WinUI projection of the render model produced by the shared Rust layout engine.
/// The artwork remains in the XAML compositor; there is no opaque WebView surface above it.
/// </summary>
public sealed partial class ButtonLayoutView : UserControl
{
    private IReadOnlyList<RenderedButton> _buttons = [];
    private string? _source;
    private string? _contentFolder;
    private string? _renderKey;

    public ButtonLayoutView()
    {
        InitializeComponent();
        Visibility = Visibility.Collapsed;
        SizeChanged += (_, _) => RenderIfNeeded();
        Loaded += (_, _) => RenderIfNeeded();
    }

    public event EventHandler<string>? ButtonPressed;

    // Kept as an async-compatible API so MainWindow startup does not need a platform special case.
    public Task InitializeAsync() => Task.CompletedTask;

    public void Update(string? source, IReadOnlyList<RenderedButton> buttons, string? contentFolder)
    {
        _source = source;
        _buttons = buttons;
        _contentFolder = contentFolder;
        var visible = source is not null && contentFolder is not null && buttons.Any(button => button.Visible);
        Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (!visible)
        {
            _renderKey = null;
            LayoutCanvas.Children.Clear();
            return;
        }
        RenderIfNeeded();
    }

    private void RenderIfNeeded()
    {
        if (Visibility != Visibility.Visible || _source is null || _contentFolder is null
            || ActualWidth <= 0 || ActualHeight <= 0) return;

        // Playback state is published frequently. Geometry is recomputed only if the source,
        // button render result, content root, or logical canvas size actually changed.
        var width = Math.Round(ActualWidth, 2);
        var height = Math.Round(ActualHeight, 2);
        var buttonJson = JsonSerializer.Serialize(_buttons, YuraiveJson.Options);
        var key = $"{width:F2}|{height:F2}|{_contentFolder}|{_source}|{buttonJson}";
        if (string.Equals(key, _renderKey, StringComparison.Ordinal)) return;

        try
        {
            var model = NativeRuntime.ResolveButtonLayout(_source, _buttons, new NativeLayoutCanvas
            {
                Width = width,
                Height = height,
                Density = XamlRoot?.RasterizationScale ?? 1,
                FontScale = 1,
            });
            LayoutCanvas.Children.Clear();
            foreach (var item in model.Buttons) AddButton(item, _contentFolder);
            _renderKey = key;
        }
        catch
        {
            // A malformed third-party layout must not take down playback. Leave artwork visible.
            LayoutCanvas.Children.Clear();
            _renderKey = key;
        }
    }

    private void AddButton(NativeLayoutButton item, string contentFolder)
    {
        var style = item.Style;
        var text = new TextBlock
        {
            Text = item.Text,
            Foreground = Brush(style.TextColor, Colors.Black),
            FontSize = Math.Max(1, style.FontSize),
            FontWeight = new Windows.UI.Text.FontWeight { Weight = (ushort)Math.Clamp(style.FontWeight, 1, 999) },
            TextAlignment = ResolveTextAlignment(style.TextAlign),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = ResolveVerticalAlignment(style.VerticalAlign),
            TextWrapping = style.WhiteSpace.Equals("nowrap", StringComparison.OrdinalIgnoreCase)
                ? TextWrapping.NoWrap : TextWrapping.Wrap,
            TextTrimming = style.TextOverflow.Equals("ellipsis", StringComparison.OrdinalIgnoreCase)
                ? TextTrimming.CharacterEllipsis : TextTrimming.None,
            Margin = new Thickness(style.PaddingLeft, style.PaddingTop, style.PaddingRight, style.PaddingBottom),
            IsHitTestVisible = false,
        };
        if (style.FontSize > 0)
            text.CharacterSpacing = (int)Math.Round(style.LetterSpacing / style.FontSize * 1000);

        var content = new Grid();
        if (SafeAssetPath(contentFolder, style.BackgroundImage) is { } imagePath)
        {
            content.Children.Add(new Image
            {
                Source = new BitmapImage(new Uri(imagePath, UriKind.Absolute)),
                Stretch = BackgroundStretch(style.BackgroundSize),
                HorizontalAlignment = BackgroundHorizontalAlignment(style.BackgroundPosition),
                VerticalAlignment = BackgroundVerticalAlignment(style.BackgroundPosition),
                IsHitTestVisible = false,
            });
        }
        content.Children.Add(text);

        var button = new Button
        {
            Tag = item.Id,
            Content = content,
            Width = Math.Max(0, item.Width),
            Height = Math.Max(0, item.Height),
            Padding = new Thickness(0),
            Background = Brush(style.BackgroundColor, Colors.Transparent),
            Foreground = Brush(style.TextColor, Colors.Black),
            BorderBrush = Brush(style.BorderColor, Colors.Transparent),
            BorderThickness = new Thickness(Math.Max(0, style.BorderWidth)),
            CornerRadius = new CornerRadius(Math.Max(0, style.BorderRadius)),
            Opacity = Math.Clamp(style.Opacity, 0, 1),
            IsEnabled = item.Enabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = Microsoft.UI.Xaml.VerticalAlignment.Stretch,
        };
        ApplyTransform(button, style.Transform);
        button.Click += (_, _) => ButtonPressed?.Invoke(this, item.Id);
        Canvas.SetLeft(button, item.X);
        Canvas.SetTop(button, item.Y);
        Canvas.SetZIndex(button, item.ZIndex);
        LayoutCanvas.Children.Add(button);
    }

    private static string? SafeAssetPath(string root, string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Uri.TryCreate(relative, UriKind.Absolute, out _)) return null;
        try
        {
            var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var fullPath = Path.GetFullPath(Path.Combine(fullRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
            return fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase) && File.Exists(fullPath) ? fullPath : null;
        }
        catch { return null; }
    }

    private static SolidColorBrush Brush(string? css, Color fallback) => new(ParseColor(css, fallback));

    private static Color ParseColor(string? css, Color fallback)
    {
        if (string.IsNullOrWhiteSpace(css)) return fallback;
        var value = css.Trim().ToLowerInvariant();
        if (value == "transparent") return Colors.Transparent;
        var names = new Dictionary<string, Color>(StringComparer.OrdinalIgnoreCase)
        {
            ["black"] = Colors.Black, ["white"] = Colors.White, ["red"] = Colors.Red,
            ["green"] = Colors.Green, ["blue"] = Colors.Blue,
        };
        if (names.TryGetValue(value, out var named)) return named;
        if (value.StartsWith('#'))
        {
            var hex = value[1..];
            if (hex.Length is 3 or 4) hex = string.Concat(hex.Select(character => new string(character, 2)));
            if (hex.Length is 6 or 8 && uint.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var raw))
            {
                var r = (byte)(raw >> (hex.Length == 8 ? 24 : 16));
                var g = (byte)(raw >> (hex.Length == 8 ? 16 : 8));
                var b = (byte)(raw >> (hex.Length == 8 ? 8 : 0));
                var a = hex.Length == 8 ? (byte)raw : (byte)255; // CSS #RRGGBBAA
                return Color.FromArgb(a, r, g, b);
            }
        }
        if ((value.StartsWith("rgb(") || value.StartsWith("rgba(")) && value.EndsWith(')'))
        {
            var parts = value[(value.IndexOf('(') + 1)..^1].Split(',').Select(part => part.Trim()).ToArray();
            if (parts.Length >= 3 && byte.TryParse(parts[0], out var r) && byte.TryParse(parts[1], out var g) && byte.TryParse(parts[2], out var b))
            {
                var a = (byte)255;
                if (parts.Length == 4 && double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var alpha)) a = (byte)Math.Round(Math.Clamp(alpha, 0, 1) * 255);
                return Color.FromArgb(a, r, g, b);
            }
        }
        return fallback;
    }

    private static TextAlignment ResolveTextAlignment(string value) => value.Trim().ToLowerInvariant() switch
    {
        "left" or "start" => Microsoft.UI.Xaml.TextAlignment.Left,
        "right" or "end" => Microsoft.UI.Xaml.TextAlignment.Right,
        "justify" => Microsoft.UI.Xaml.TextAlignment.Justify,
        _ => Microsoft.UI.Xaml.TextAlignment.Center,
    };

    private static VerticalAlignment ResolveVerticalAlignment(string value) => value.Trim().ToLowerInvariant() switch
    {
        "start" or "flex-start" => Microsoft.UI.Xaml.VerticalAlignment.Top,
        "end" or "flex-end" => Microsoft.UI.Xaml.VerticalAlignment.Bottom,
        "stretch" => Microsoft.UI.Xaml.VerticalAlignment.Stretch,
        _ => Microsoft.UI.Xaml.VerticalAlignment.Center,
    };

    private static Stretch BackgroundStretch(string value) => value.Trim().ToLowerInvariant() switch
    {
        "contain" => Stretch.Uniform,
        "auto" => Stretch.None,
        var size when size.Contains("100% 100%", StringComparison.Ordinal) => Stretch.Fill,
        _ => Stretch.UniformToFill,
    };

    private static HorizontalAlignment BackgroundHorizontalAlignment(string value) => value.ToLowerInvariant() switch
    {
        var position when position.Contains("left", StringComparison.Ordinal) => Microsoft.UI.Xaml.HorizontalAlignment.Left,
        var position when position.Contains("right", StringComparison.Ordinal) => Microsoft.UI.Xaml.HorizontalAlignment.Right,
        _ => Microsoft.UI.Xaml.HorizontalAlignment.Center,
    };

    private static VerticalAlignment BackgroundVerticalAlignment(string value) => value.ToLowerInvariant() switch
    {
        var position when position.Contains("top", StringComparison.Ordinal) => Microsoft.UI.Xaml.VerticalAlignment.Top,
        var position when position.Contains("bottom", StringComparison.Ordinal) => Microsoft.UI.Xaml.VerticalAlignment.Bottom,
        _ => Microsoft.UI.Xaml.VerticalAlignment.Center,
    };

    private static void ApplyTransform(UIElement element, string? css)
    {
        if (string.IsNullOrWhiteSpace(css) || css.Equals("none", StringComparison.OrdinalIgnoreCase)) return;
        var transform = new CompositeTransform { CenterX = 0.5, CenterY = 0.5 };
        foreach (System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(css, @"([a-zA-Z]+)\(([^)]*)\)"))
        {
            var name = match.Groups[1].Value.ToLowerInvariant();
            var values = match.Groups[2].Value.Split([',', ' '], StringSplitOptions.RemoveEmptyEntries)
                .Select(value => double.TryParse(value.Trim().TrimEnd('p', 'x', 'd', 'e', 'g'), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0).ToArray();
            if (name == "translate" && values.Length > 0) { transform.TranslateX = values[0]; transform.TranslateY = values.ElementAtOrDefault(1); }
            else if (name == "translatex" && values.Length > 0) transform.TranslateX = values[0];
            else if (name == "translatey" && values.Length > 0) transform.TranslateY = values[0];
            else if (name == "scale" && values.Length > 0) { transform.ScaleX = values[0]; transform.ScaleY = values.ElementAtOrDefault(1) is 0 ? values[0] : values[1]; }
            else if (name == "rotate" && values.Length > 0) transform.Rotation = values[0];
        }
        element.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        element.RenderTransform = transform;
    }
}
