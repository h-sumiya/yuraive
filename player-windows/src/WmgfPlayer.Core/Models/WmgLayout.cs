using System.Text.RegularExpressions;

namespace WmgfPlayer.Core.Models;

public sealed record WmgLayoutIssue(ValidationSeverity Severity, string Message);

public static partial class WmgLayout
{
    private static readonly HashSet<string> AllowedElements = ["div", "slot"];

    public static (string Css, string Body) Sanitize(string source)
    {
        var css = string.Join("\n", StyleElement().Matches(source).Select(match => match.Groups[1].Value));
        var withoutStyles = StyleElement().Replace(source, "");
        var body = Element().Replace(withoutStyles, match =>
        {
            var closing = match.Groups[1].Value.Length > 0;
            var name = match.Groups[2].Value.ToLowerInvariant();
            if (!AllowedElements.Contains(name)) return "";
            if (closing) return $"</{name}>";
            var attributes = string.Join(" ", Attribute().Matches(match.Groups[3].Value).Select(value => value.Value.Trim()));
            return attributes.Length == 0 ? $"<{name}>" : $"<{name} {attributes}>";
        });
        return (css, body);
    }

    public static IReadOnlyList<WmgLayoutIssue> Validate(string source)
    {
        var slots = SlotIdentifiers(source);
        var issues = new List<WmgLayoutIssue>();
        if (slots.Count(string.IsNullOrEmpty) != 1)
            issues.Add(new(ValidationSeverity.Error, "name/idのないデフォルトslotが1件必要です"));
        var duplicates = slots.GroupBy(value => value, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => group.Key).ToList();
        if (duplicates.Count > 0)
            issues.Add(new(ValidationSeverity.Error, $"slot識別子が重複しています: {string.Join(", ", duplicates.Select(value => value.Length == 0 ? "(default)" : value))}"));
        if (!StyleElement().IsMatch(source))
            issues.Add(new(ValidationSeverity.Warning, "style要素がありません。ボタンには暗黙の外観が適用されません"));
        return issues;
    }

    public static IReadOnlyList<string> SlotIdentifiers(string source)
    {
        var (_, body) = Sanitize(source);
        return Element().Matches(body)
            .Where(match => match.Groups[1].Value.Length == 0 && string.Equals(match.Groups[2].Value, "slot", StringComparison.OrdinalIgnoreCase))
            .Select(match =>
            {
                var attributes = Attribute().Matches(match.Groups[3].Value)
                    .ToDictionary(
                        value => value.Groups[1].Value.ToLowerInvariant(),
                        value => value.Groups[2].Value.Trim('"', '\'').Trim(),
                        StringComparer.Ordinal);
                return attributes.GetValueOrDefault("name") ?? attributes.GetValueOrDefault("id") ?? "";
            }).ToList();
    }

    public static string BuildDocument(string source)
    {
        var (css, body) = Sanitize(source);
        return $$"""
            <!doctype html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https://wmg.local">
            <style>
            html,body,#wmg-layout-root{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
            html{container:wmg-canvas / size}
            *,*::before,*::after{box-sizing:border-box}
            .wmg-button{all:unset;box-sizing:border-box;-webkit-tap-highlight-color:transparent;cursor:pointer}
            </style><style>{{css}}</style></head><body><div id="wmg-layout-root">{{body}}</div></body></html>
            """;
    }

    [GeneratedRegex(@"(?is)<style(?:\s[^>]*)?>(.*?)</style\s*>")]
    private static partial Regex StyleElement();

    [GeneratedRegex(@"(?is)<\s*(/?)\s*([a-z][a-z0-9-]*)([^>]*)>")]
    private static partial Regex Element();

    [GeneratedRegex("(?is)\\b(class|id|name|style|role|aria-label)\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+)")]
    private static partial Regex Attribute();
}
