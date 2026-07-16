using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.App;

public enum LibraryEntryKind { Root, Folder, Graph, Add }

public sealed class LibraryEntryViewModel : INotifyPropertyChanged
{
    private bool _rootIsSelected;
    private string _actionGlyph = "";
    private Brush? _actionForeground;

    public required LibraryEntryKind Kind { get; init; }
    public required string Title { get; init; }
    public string Subtitle { get; init; } = "";
    public Visibility SubtitleVisibility => string.IsNullOrWhiteSpace(Subtitle) ? Visibility.Collapsed : Visibility.Visible;
    public string Glyph { get; init; } = "\uE8B7";
    public string ActionGlyph
    {
        get => _actionGlyph;
        set { if (_actionGlyph != value) { _actionGlyph = value; OnPropertyChanged(); } }
    }
    public Visibility ActionVisibility { get; init; } = Visibility.Collapsed;
    public Brush? ActionForeground
    {
        get => _actionForeground;
        set { if (!ReferenceEquals(_actionForeground, value)) { _actionForeground = value; OnPropertyChanged(); } }
    }
    public Visibility RootSelectionVisibility { get; init; } = Visibility.Collapsed;
    public bool RootIsSelected
    {
        get => _rootIsSelected;
        set
        {
            if (_rootIsSelected == value) return;
            _rootIsSelected = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(RootSelectionCheckedVisibility));
            OnPropertyChanged(nameof(RootSelectionUncheckedVisibility));
        }
    }
    public Visibility RootSelectionCheckedVisibility => RootIsSelected ? Visibility.Visible : Visibility.Collapsed;
    public Visibility RootSelectionUncheckedVisibility => RootIsSelected ? Visibility.Collapsed : Visibility.Visible;
    public ImageSource? Thumbnail { get; init; }
    public ImageSource? BlurredThumbnail { get; init; }
    public RootGrant? Root { get; init; }
    public LibraryFolder? Folder { get; init; }
    public LibraryGraph? Graph { get; init; }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
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
