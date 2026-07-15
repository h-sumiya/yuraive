using System.Text.Json;
using Yuraive.Core.Interop;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Playback;

public sealed class StarlarkRuntime(DocumentLibrary library)
{
    public async Task<JsonElement> RunAsync(
        GraphRef reference,
        ScriptCall call,
        string defaultFunction,
        JsonElement context,
        long timeoutMs,
        IReadOnlyDictionary<string, string>? loadedScripts = null,
        CancellationToken cancellationToken = default)
    {
        var scripts = loadedScripts ?? await library.ReadScriptSourcesAsync(reference, call.Path, cancellationToken);
        var request = new
        {
            path = call.Path,
            functionName = string.IsNullOrWhiteSpace(call.Function) ? defaultFunction : call.Function,
            args = new[] { context },
            scripts,
            timeoutMs = Math.Clamp(timeoutMs, 100, 10_000),
        };
        var responseJson = await Task.Run(
            () => NativeRuntime.RunStarlarkJson(JsonSerializer.Serialize(request, YuraiveJson.Options)),
            cancellationToken);
        using var response = JsonDocument.Parse(responseJson);
        var root = response.RootElement;
        if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String)
            throw new InvalidOperationException(error.GetString());
        return root.TryGetProperty("value", out var value)
            ? value.Clone()
            : JsonSerializer.SerializeToElement<object?>(null, YuraiveJson.Options);
    }
}
