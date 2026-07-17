using Xunit;
using Yuraive.Core;

namespace Yuraive.Core.Tests;

public sealed class AdaptiveLayoutPolicyTests
{
    [Theory]
    [InlineData(520, 820, false)]
    [InlineData(800, 1_280, false)]
    [InlineData(1_280, 800, true)]
    [InlineData(900, 520, true)]
    public void PlayerMatchesAndroidViewportOrientation(double width, double height, bool expected) =>
        Assert.Equal(expected, AdaptiveLayoutPolicy.UsesTwoPanePlayer(width, height));

    [Theory]
    [InlineData(1_649, 900, true, false)]
    [InlineData(1_650, 699, true, false)]
    [InlineData(1_650, 700, false, false)]
    [InlineData(1_650, 700, true, true)]
    [InlineData(2_000, 1_100, true, true)]
    public void LibraryIsAddedBesidePlayerOnlyWhenVeryWide(double width, double height, bool playerOpen, bool expected) =>
        Assert.Equal(expected, AdaptiveLayoutPolicy.ShowsSideLibrary(width, height, playerOpen));
}
