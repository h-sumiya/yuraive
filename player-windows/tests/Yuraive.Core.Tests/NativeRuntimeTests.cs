using System.Text.Json;
using Xunit;
using Yuraive.Core.Interop;
using Yuraive.Core.Models;

namespace Yuraive.Core.Tests;

public sealed class NativeRuntimeTests
{
    [Fact]
    public void NativeValidatorAcceptsValidGraphAndReportsInvalidAssets()
    {
        const string valid = """
            {"version":1,"nodes":{"start":{"type":"media","start":true,"terminal":true,"media":[{"id":"rain","weight":1,"source":{"type":"audio","audio":"audio/rain.ogg"}}]}},"buttons":{}}
            """;
        Assert.Empty(NativeRuntime.ValidateJson(valid));

        var issues = NativeRuntime.ValidateJson(valid.Replace("audio/rain.ogg", "../rain.ogg", StringComparison.Ordinal));
        Assert.Contains(issues, issue => issue.Severity == ValidationSeverity.Error && issue.Message.Contains("コンテンツ外", StringComparison.Ordinal));
    }

    [Fact]
    public void NativeMetadataReaderFinishesFromAJsonPrefix()
    {
        var result = NativeRuntime.ExtractMetadataPrefix(
            "{\"version\":1,\"metadata\":{\"displayName\":\"Rain\",\"author\":\"Hiro\"},\"nodes\":{");

        Assert.Equal("found", result.Status);
        Assert.Equal("Rain", result.Metadata?.DisplayName);
        Assert.Equal("Hiro", result.Metadata?.Author);
    }

    [Fact]
    public void NativeStarlarkExecutesWithJsonArguments()
    {
        var request = JsonSerializer.Serialize(new
        {
            path = "route.star",
            functionName = "jump",
            args = new object[]
            {
                new
                {
                    target = "ending",
                    runId = "run-a",
                    history = new[]
                    {
                        new { id = "a-1", runId = "run-a" },
                        new { id = "b-1", runId = "run-b" },
                    },
                },
            },
            scripts = new Dictionary<string, string>
            {
                ["route.star"] = "def jump(ctx):\n    return {'target': ctx['target'], 'ok': True, 'currentIds': [entry['id'] for entry in ctx['currentHistory']]}\n",
            },
            timeoutMs = 1_200,
        }, YuraiveJson.Options);
        using var response = JsonDocument.Parse(NativeRuntime.RunStarlarkJson(request));

        Assert.False(response.RootElement.TryGetProperty("error", out _));
        Assert.Equal("ending", response.RootElement.GetProperty("value").GetProperty("target").GetString());
        Assert.True(response.RootElement.GetProperty("value").GetProperty("ok").GetBoolean());
        Assert.Equal("a-1", response.RootElement.GetProperty("value").GetProperty("currentIds")[0].GetString());
    }

    [Fact]
    public void NativeLayoutEngineProducesResponsiveButtonGeometry()
    {
        const string source = """
            <style>
            .stage { position:absolute; inset:0; display:grid; grid-template-rows:1fr auto; padding:16px; }
            slot[name="actions"] { display:grid; grid-row:2; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
            .yuraive-button { min-height:52px; padding:12px 18px; border-radius:18px; background:#574de5; color:white; }
            @container yuraive-canvas (max-width:360px) { slot[name="actions"] { grid-template-columns:1fr; } }
            </style><div class="stage"><slot name="actions"></slot><slot></slot></div>
            """;
        var buttons = new[]
        {
            new RenderedButton { Id = "first", Visible = true, TargetSlot = "actions", Text = "First" },
            new RenderedButton { Id = "second", Visible = true, TargetSlot = "actions", Text = "Second" },
        };

        var wide = NativeRuntime.ResolveButtonLayout(source, buttons, new NativeLayoutCanvas { Width = 400, Height = 400 });
        var narrow = NativeRuntime.ResolveButtonLayout(source, buttons, new NativeLayoutCanvas { Width = 340, Height = 400 });

        Assert.Empty(wide.Issues);
        Assert.Equal(2, wide.Buttons.Count);
        Assert.NotEqual(wide.Buttons[0].X, wide.Buttons[1].X);
        Assert.Equal(narrow.Buttons[0].X, narrow.Buttons[1].X, 2);
        Assert.True(narrow.Buttons[1].Y > narrow.Buttons[0].Y);
        Assert.Equal("#574de5", wide.Buttons[0].Style.BackgroundColor);
    }
}
