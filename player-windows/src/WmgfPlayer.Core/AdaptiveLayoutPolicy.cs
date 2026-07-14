namespace WmgfPlayer.Core;

public static class AdaptiveLayoutPolicy
{
    public const double UltraWideThreshold = 1_650;
    public const double SideLibraryMinimumHeight = 700;

    public static bool UsesTwoPanePlayer(double width, double height) => width > height;

    public static bool ShowsSideLibrary(double width, double height, bool playerOpen) =>
        playerOpen && width >= UltraWideThreshold && height >= SideLibraryMinimumHeight;
}
