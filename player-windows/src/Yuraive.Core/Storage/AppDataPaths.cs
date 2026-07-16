namespace Yuraive.Core.Storage;

public sealed class AppDataPaths
{
    public AppDataPaths(string? root = null)
    {
        Root = Path.GetFullPath(root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Yuraive"));
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }
    public string History => EnsureDirectory("history");
    public string Cache => EnsureDirectory("cache");
    public string Snapshot => Path.Combine(Root, "playback-state.json");
    public string Settings => Path.Combine(Root, "settings.json");
    public string Library => Path.Combine(Root, "library.json");
    public string RemoteConnections => Path.Combine(Root, "remote-connections.dat");
    public string RemoteCache => EnsureDirectory("remote-cache");

    private string EnsureDirectory(string name)
    {
        var path = Path.Combine(Root, name);
        Directory.CreateDirectory(path);
        return path;
    }
}

internal static class DurableFile
{
    public static async Task WriteAtomicAsync(string path, string contents, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidOperationException("保存先が不正です"));
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            await using (var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false)))
            {
                await writer.WriteAsync(contents.AsMemory(), cancellationToken);
                await writer.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
