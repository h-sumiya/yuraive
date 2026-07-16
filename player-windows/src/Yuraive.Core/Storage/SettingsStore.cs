using Yuraive.Core.Models;

namespace Yuraive.Core.Storage;

public enum ThemeMode { System, Light, Dark }

public sealed record PlayerSettings
{
    public ThemeMode ThemeMode { get; init; } = ThemeMode.System;
    public int AccentIndex { get; init; }
    public long ScriptTimeoutMs { get; init; } = 1_200;
    public bool ShareLibrary { get; init; }
    public bool ForceShowPlayerControls { get; init; }
    public bool KeepScreenOnInPlayer { get; init; }
}

public sealed class SettingsStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public SettingsStore(AppDataPaths paths)
    {
        _path = paths.Settings;
        Current = Read();
    }

    public PlayerSettings Current { get; private set; }
    public event EventHandler<PlayerSettings>? Changed;

    public async Task UpdateAsync(Func<PlayerSettings, PlayerSettings> transform, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var transformed = transform(Current);
            var value = transformed with
            {
                ScriptTimeoutMs = Math.Clamp(transformed.ScriptTimeoutMs, 100, 10_000),
            };
            await DurableFile.WriteAtomicAsync(_path, YuraiveJson.Serialize(value), cancellationToken);
            Current = value;
        }
        finally
        {
            _gate.Release();
        }
        Changed?.Invoke(this, Current);
    }

    private PlayerSettings Read()
    {
        try
        {
            if (!File.Exists(_path)) return new();
            var value = YuraiveJson.Deserialize<PlayerSettings>(File.ReadAllText(_path));
            return value with { ScriptTimeoutMs = Math.Clamp(value.ScriptTimeoutMs, 100, 10_000) };
        }
        catch
        {
            return new();
        }
    }
}
