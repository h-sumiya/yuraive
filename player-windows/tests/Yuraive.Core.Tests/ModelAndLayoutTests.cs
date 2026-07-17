using Xunit;
using Yuraive.Core.Models;

namespace Yuraive.Core.Tests;

public sealed class ModelAndLayoutTests
{
    [Theory]
    [InlineData("audio/rain.ogg", true)]
    [InlineData("folder/scene one.mp3", true)]
    [InlineData("../secret.mp3", false)]
    [InlineData("https://example.com/a.mp3", false)]
    [InlineData("C:\\media\\a.mp3", false)]
    [InlineData("folder//a.mp3", false)]
    public void RelativePathSafetyMatchesYuraiveRules(string path, bool expected) =>
        Assert.Equal(expected, GraphValidator.IsSafeRelativePath(path));

    [Fact]
    public void LayoutSanitizesMarkupAndValidatesUniqueSlots()
    {
        const string source = """
            <style>.actions { display:grid }</style>
            <div class="actions" onclick="alert(1)"><slot></slot><slot name="choice"></slot><script>bad()</script></div>
            """;

        var (css, body) = YuraiveLayout.Sanitize(source);

        Assert.Contains("display:grid", css);
        Assert.Contains("<div class=\"actions\">", body);
        Assert.DoesNotContain("onclick", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<script", body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(["", "choice"], YuraiveLayout.SlotIdentifiers(source));
        Assert.DoesNotContain(YuraiveLayout.Validate(source), issue => issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void LayoutRejectsMissingDefaultAndDuplicateNamedSlots()
    {
        const string source = "<style></style><slot name='same'></slot><slot id='same'></slot>";
        var issues = YuraiveLayout.Validate(source);

        Assert.Contains(issues, issue => issue.Message.Contains("デフォルトslot", StringComparison.Ordinal));
        Assert.Contains(issues, issue => issue.Message.Contains("重複", StringComparison.Ordinal));
    }

    [Fact]
    public void WeightedChoiceIgnoresNonPositiveAndNonFiniteValues()
    {
        var only = WeightedChoice.Choose(
            new[] { (Name: "zero", Weight: 0d), (Name: "nan", Weight: double.NaN), (Name: "one", Weight: 1d) },
            item => item.Weight);

        Assert.Equal("one", only.Name);
        Assert.Null(WeightedChoice.Choose(new[] { "a", "b" }, _ => 0d));
    }
}
