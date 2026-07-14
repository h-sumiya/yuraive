using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using WmgfPlayer.Core.Models;
using WmgfPlayer.Core.Storage;

namespace WmgfPlayer.App;

public enum LibraryEntryKind { Root, Folder, Graph, Add }

public sealed class LibraryEntryViewModel
{
    public required LibraryEntryKind Kind { get; init; }
    public required string Title { get; init; }
    public string Subtitle { get; init; } = "";
    public Visibility SubtitleVisibility => string.IsNullOrWhiteSpace(Subtitle) ? Visibility.Collapsed : Visibility.Visible;
    public string Glyph { get; init; } = "\uE8B7";
    public string ActionGlyph { get; init; } = "";
    public Visibility ActionVisibility { get; init; } = Visibility.Collapsed;
    public Brush? ActionForeground { get; init; }
    public ImageSource? Thumbnail { get; init; }
    public ImageSource? BlurredThumbnail { get; init; }
    public RootGrant? Root { get; init; }
    public LibraryFolder? Folder { get; init; }
    public LibraryGraph? Graph { get; init; }
}

public sealed class HistoryEntryViewModel
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public string Badge { get; init; } = "";
    public ImageSource? Thumbnail { get; init; }
    public PlaybackHistoryEntry? Entry { get; init; }
    public LibraryGraph? Graph { get; init; }
}
