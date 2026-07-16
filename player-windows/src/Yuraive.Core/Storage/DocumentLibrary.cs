using System.Collections.Concurrent;
using System.Text;
using Yuraive.Core.Interop;
using Yuraive.Core.Models;

namespace Yuraive.Core.Storage;

public sealed record RootGrant(string Uri, string Name);

public sealed record LibraryGraph(
    GraphRef Ref,
    string DisplayName,
    string? Author = null,
    string? ThumbnailPath = null,
    string? ParseError = null,
    long ModifiedAt = 0);

public sealed record LibraryRoot(RootGrant Grant, LibraryDirectory? Directory = null, string? Error = null)
{
    public LibraryGraph? PreviewGraph => Directory?.Graphs.FirstOrDefault();
    public bool HasContent => Directory?.Graphs.Count > 0;
}

public sealed record LibraryFolder(string Name, string RelativePath);

public sealed record LibraryDirectory(
    RootGrant Grant,
    string Name,
    string RelativePath,
    IReadOnlyList<LibraryFolder> Folders,
    IReadOnlyList<LibraryGraph> Graphs,
    string? Error = null)
{
    public bool IsContent => Graphs.Count > 0;
}

public enum AssetInspectionProblem { UnsafePath, Missing }

public sealed record LibraryAssetInspection(
    string Path,
    bool Recognized,
    bool Embedded = false,
    AssetInspectionProblem? Problem = null);

public sealed record LibraryContentInspection(
    YuraiveGraph Graph,
    bool IsBundle,
    IReadOnlyList<LibraryAssetInspection> Assets);

public sealed class DocumentLibrary
{
    private const int MetadataPrefixLimit = 512 * 1024;
    private const int MetadataReadChunk = 16 * 1024;
    private readonly string _statePath;
    private readonly RemoteSourceManager _remote;
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private readonly ConcurrentDictionary<string, LibraryDirectory> _directoryCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, CachedGraph> _graphCache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, IReadOnlyDictionary<string, string>> _scriptCache = new(StringComparer.Ordinal);
    private LibraryState _state;
    private List<LibraryGraph> _knownGraphs = [];

    public DocumentLibrary(AppDataPaths paths)
    {
        _statePath = paths.Library;
        _remote = new RemoteSourceManager(paths);
        _state = ReadState();
    }

    public IReadOnlyList<RootGrant> Roots => _state.Roots;
    public IReadOnlyList<LibraryGraph> KnownGraphs => _knownGraphs;
    public IReadOnlySet<string> FavoriteIds => _state.FavoriteAt.Keys.ToHashSet(StringComparer.Ordinal);
    public event EventHandler? Changed;

    public async Task AddRootAsync(string folderPath, string? name = null, CancellationToken cancellationToken = default)
    {
        var canonical = Path.GetFullPath(folderPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!Directory.Exists(canonical)) throw new DirectoryNotFoundException("選択したフォルダが見つかりません");
        var root = new RootGrant(canonical, string.IsNullOrWhiteSpace(name) ? new DirectoryInfo(canonical).Name : name.Trim());
        await MutateStateAsync(state => state with
        {
            Roots = state.Roots.Where(value => !string.Equals(value.Uri, canonical, StringComparison.OrdinalIgnoreCase))
                .Append(root)
                .OrderBy(value => value.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
        }, cancellationToken);
        ClearCaches();
    }

    public Task<IReadOnlyList<RemoteFolder>> BrowseRemoteFoldersAsync(
        RemoteConnectionConfig config,
        string relativePath,
        CancellationToken cancellationToken = default) =>
        Task.Run(() => _remote.Browse(config, relativePath), cancellationToken);

    public async Task AddRemoteRootAsync(
        RemoteConnectionConfig config,
        string selectedPath,
        string? fallbackName = null,
        CancellationToken cancellationToken = default)
    {
        var grant = _remote.Save(config, selectedPath, fallbackName ?? "");
        try
        {
            await MutateStateAsync(state => state with
            {
                Roots = state.Roots.Where(value => !string.Equals(value.Uri, grant.Uri, StringComparison.Ordinal))
                    .Append(grant)
                    .OrderBy(value => value.Name, StringComparer.CurrentCultureIgnoreCase)
                    .ToList(),
            }, cancellationToken);
            ClearCaches();
        }
        catch
        {
            _remote.Remove(grant.Uri);
            throw;
        }
    }

    public async Task<LibraryGraph> ImportBundleAsync(string filePath, CancellationToken cancellationToken = default)
    {
        var canonical = Path.GetFullPath(filePath);
        if (!IsBundlePath(canonical)) throw new ArgumentException(".yuraive ファイルを指定してください", nameof(filePath));
        if (!File.Exists(canonical)) throw new FileNotFoundException("Yuraiveバンドルが見つかりません", canonical);
        var parent = Path.GetDirectoryName(canonical)
            ?? throw new ArgumentException("バンドルの親フォルダを確認できません", nameof(filePath));
        var grant = Roots.FirstOrDefault(value => string.Equals(value.Uri, parent, StringComparison.OrdinalIgnoreCase));
        if (grant is null)
        {
            await AddRootAsync(parent, cancellationToken: cancellationToken);
            grant = Roots.First(value => string.Equals(value.Uri, parent, StringComparison.OrdinalIgnoreCase));
        }

        var directory = await InspectDirectoryAsync(grant, "", cancellationToken);
        var fileName = Path.GetFileName(canonical);
        return directory.Graphs.FirstOrDefault(graph =>
                string.Equals(graph.Ref.RelativePath, fileName, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException("指定されたYuraiveバンドルをライブラリで読み込めません");
    }

    public async Task RemoveRootAsync(string uri, CancellationToken cancellationToken = default)
    {
        await MutateStateAsync(state => state with
        {
            Roots = state.Roots.Where(value => !string.Equals(value.Uri, uri, StringComparison.OrdinalIgnoreCase)).ToList(),
            FavoriteAt = state.FavoriteAt
                .Where(item => !item.Key.StartsWith(uri + "::", StringComparison.OrdinalIgnoreCase))
                .ToDictionary(StringComparer.Ordinal),
        }, cancellationToken);
        _knownGraphs = _knownGraphs.Where(graph => !string.Equals(graph.Ref.RootUri, uri, StringComparison.OrdinalIgnoreCase)).ToList();
        if (_remote.IsRemoteRoot(uri)) _remote.Remove(uri);
        ClearCaches();
    }

    public async Task ToggleFavoriteAsync(string graphId, CancellationToken cancellationToken = default)
    {
        await MutateStateAsync(state =>
        {
            var favorites = new Dictionary<string, long>(state.FavoriteAt, StringComparer.Ordinal);
            if (!favorites.Remove(graphId)) favorites[graphId] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return state with { FavoriteAt = favorites };
        }, cancellationToken);
    }

    public IReadOnlyList<string> FavoriteIdsByRecent() => _state.FavoriteAt
        .OrderByDescending(item => item.Value)
        .Select(item => item.Key)
        .ToList();

    public async Task<IReadOnlyList<LibraryRoot>> ScanAllAsync(CancellationToken cancellationToken = default)
    {
        ClearCaches();
        var scanned = await Task.Run(() => Roots.Select(grant =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return new LibraryRoot(grant, ScanDirectory(grant, "", cancellationToken));
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                return new LibraryRoot(grant, Error: error.Message);
            }
        }).ToList(), cancellationToken);
        _knownGraphs = scanned.SelectMany(root => root.Directory?.Graphs ?? []).ToList();
        Changed?.Invoke(this, EventArgs.Empty);
        return scanned;
    }

    public Task<LibraryDirectory> InspectDirectoryAsync(RootGrant grant, string relativePath, CancellationToken cancellationToken = default)
    {
        if (relativePath.Length > 0 && !GraphValidator.IsSafeRelativePath(relativePath))
            throw new ArgumentException("安全でないフォルダパスです", nameof(relativePath));
        var key = $"{grant.Uri}::{relativePath}";
        if (_directoryCache.TryGetValue(key, out var cached)) return Task.FromResult(cached);
        return Task.Run(() =>
        {
            var scanned = ScanDirectory(grant, relativePath, cancellationToken);
            _directoryCache[key] = scanned;
            MergeKnownGraphs(scanned.Graphs);
            return scanned;
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<LibraryGraph>> ResolveGraphsAsync(IEnumerable<string> graphIds, CancellationToken cancellationToken = default)
    {
        var known = _knownGraphs.ToDictionary(graph => graph.Ref.GraphId, StringComparer.Ordinal);
        var result = new List<LibraryGraph>();
        foreach (var graphId in graphIds.Distinct(StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (known.TryGetValue(graphId, out var graph))
            {
                result.Add(graph);
                continue;
            }
            var grant = Roots.FirstOrDefault(root => graphId.StartsWith(root.Uri + "::", StringComparison.OrdinalIgnoreCase));
            if (grant is null) continue;
            var relativePath = graphId[(grant.Uri.Length + 2)..];
            if (!GraphValidator.IsSafeRelativePath(relativePath)) continue;
            var directory = await InspectDirectoryAsync(grant, ParentPath(relativePath), cancellationToken);
            graph = directory.Graphs.FirstOrDefault(value => value.Ref.GraphId == graphId);
            if (graph is not null)
            {
                result.Add(graph);
                known[graphId] = graph;
            }
        }
        return result;
    }

    public async Task<YuraiveGraph> ReadGraphAsync(GraphRef reference, CancellationToken cancellationToken = default)
    {
        var remote = _remote.IsRemoteRoot(reference.RootUri);
        string file;
        long length;
        long modifiedAt;
        if (remote)
        {
            var bundlePath = BundleRelativePath(reference.RelativePath);
            var bundleNode = bundlePath is null ? null : await Task.Run(() => _remote.Stat(reference.RootUri, bundlePath), cancellationToken);
            file = bundleNode is { IsDirectory: false } ? bundlePath! : reference.RelativePath;
            var node = file == bundlePath ? bundleNode : await Task.Run(() => _remote.Stat(reference.RootUri, file), cancellationToken);
            if (node is null || node.IsDirectory) throw new FileNotFoundException("Yuraiveファイルが見つかりません", reference.RelativePath);
            length = node.Size;
            modifiedAt = node.ModifiedAt;
        }
        else
        {
            var preferredBundle = BundleRelativePath(reference.RelativePath) is { } bundlePath
                ? ResolveFromRoot(reference.RootUri, bundlePath, expectFile: true)
                : null;
            file = preferredBundle ?? ResolveFromRoot(reference.RootUri, reference.RelativePath, expectFile: true)
                ?? throw new FileNotFoundException("Yuraiveファイルが見つかりません", reference.RelativePath);
            var info = new FileInfo(file);
            length = info.Length;
            modifiedAt = info.LastWriteTimeUtc.Ticks;
        }
        var isBundle = IsBundlePath(file);
        if (_graphCache.TryGetValue(reference.GraphId, out var cached)
            && cached.IsBundle == isBundle && cached.Length == length && cached.ModifiedAt == modifiedAt)
            return cached.Graph;
        string text;
        IReadOnlyDictionary<string, BundledTextAsset> textAssets;
        if (isBundle)
        {
            var bytes = remote
                ? await ReadRemoteBytesAsync(reference.RootUri, file, 16 * 1024 * 1024, cancellationToken)
                : await ReadBytesAsync(file, 16 * 1024 * 1024, cancellationToken);
            var decoded = NativeRuntime.DecodeBundle(bytes);
            text = decoded.GraphJson;
            textAssets = decoded.TextAssets;
        }
        else
        {
            text = remote
                ? await ReadRemoteTextAsync(reference.RootUri, file, 8 * 1024 * 1024, cancellationToken)
                : await ReadTextAsync(file, 8 * 1024 * 1024, cancellationToken);
            textAssets = new Dictionary<string, BundledTextAsset>(StringComparer.Ordinal);
        }
        var graph = YuraiveJson.Deserialize<YuraiveGraph>(text);
        _graphCache[reference.GraphId] = new(graph, text, textAssets, isBundle, length, modifiedAt);
        return graph;
    }

    public async Task<string> ReadAssetTextAsync(
        GraphRef reference,
        string relativeAssetPath,
        int maxBytes = 2 * 1024 * 1024,
        CancellationToken cancellationToken = default)
    {
        if (!_graphCache.TryGetValue(reference.GraphId, out var bundle))
        {
            await ReadGraphAsync(reference, cancellationToken);
            bundle = _graphCache.GetValueOrDefault(reference.GraphId);
        }
        if (bundle?.IsBundle == true && bundle.TextAssets.GetValueOrDefault(relativeAssetPath) is { } embedded)
        {
            if (Encoding.UTF8.GetByteCount(embedded.Content) > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {relativeAssetPath}");
            return embedded.Content;
        }
        if (_remote.IsRemoteRoot(reference.RootUri))
        {
            var complete = RemotePaths.Join(reference.ParentPath, relativeAssetPath);
            return await ReadRemoteTextAsync(reference.RootUri, complete, maxBytes, cancellationToken);
        }
        var file = GetAssetPath(reference, relativeAssetPath)
            ?? throw new FileNotFoundException($"ファイルが見つかりません: {relativeAssetPath}");
        return await ReadTextAsync(file, maxBytes, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, string>> ReadScriptSourcesAsync(
        GraphRef reference,
        string entryPath,
        CancellationToken cancellationToken = default)
    {
        if (_scriptCache.TryGetValue(reference.GraphId, out var cached) && cached.ContainsKey(entryPath)) return cached;
        if (!GraphValidator.IsSafeRelativePath(entryPath)) throw new ArgumentException("安全でないスクリプトパスです", nameof(entryPath));
        if (!_graphCache.TryGetValue(reference.GraphId, out var bundle))
        {
            await ReadGraphAsync(reference, cancellationToken);
            bundle = _graphCache.GetValueOrDefault(reference.GraphId);
        }
        if (bundle?.IsBundle == true)
        {
            var embedded = bundle?.TextAssets
                .Where(item => string.Equals(item.Value.Kind, "starlark", StringComparison.Ordinal))
                .ToDictionary(item => item.Key, item => item.Value.Content, StringComparer.Ordinal)
                ?? new Dictionary<string, string>(StringComparer.Ordinal);
            if (!embedded.ContainsKey(entryPath)) throw new FileNotFoundException($"バンドル内にスクリプトが見つかりません: {entryPath}");
            _scriptCache[reference.GraphId] = embedded;
            return embedded;
        }
        if (_remote.IsRemoteRoot(reference.RootUri))
        {
            var remoteSources = new Dictionary<string, string>(StringComparer.Ordinal);
            var remoteTotalBytes = 0;

            async Task CollectRemoteAsync(string directory, string relativeDirectory, int depth)
            {
                if (depth > 16) throw new InvalidDataException("スクリプトフォルダの階層が深すぎます");
                var entries = await Task.Run(() => _remote.List(reference.RootUri, directory), cancellationToken);
                foreach (var entry in entries.OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var relative = relativeDirectory.Length == 0 ? entry.Name : $"{relativeDirectory}/{entry.Name}";
                    var complete = RemotePaths.Join(reference.ParentPath, relative);
                    if (entry.IsDirectory) await CollectRemoteAsync(complete, relative, depth + 1);
                    else if (entry.Name.EndsWith(".star", StringComparison.OrdinalIgnoreCase))
                    {
                        if (remoteSources.Count >= 256) throw new InvalidDataException("スクリプトファイルが多すぎます");
                        var source = await ReadRemoteTextAsync(reference.RootUri, complete, 2 * 1024 * 1024, cancellationToken);
                        remoteTotalBytes += Encoding.UTF8.GetByteCount(source);
                        if (remoteTotalBytes > 8 * 1024 * 1024) throw new InvalidDataException("スクリプト全体が大きすぎます");
                        remoteSources[relative] = source;
                    }
                }
            }

            await CollectRemoteAsync(reference.ParentPath, "", 0);
            if (!remoteSources.ContainsKey(entryPath)) remoteSources[entryPath] = await ReadAssetTextAsync(reference, entryPath, cancellationToken: cancellationToken);
            _scriptCache[reference.GraphId] = remoteSources;
            return remoteSources;
        }
        var contentRoot = ResolveFromRoot(reference.RootUri, reference.ParentPath, expectFile: false)
            ?? throw new DirectoryNotFoundException("コンテンツフォルダが見つかりません");
        var sources = new Dictionary<string, string>(StringComparer.Ordinal);
        var totalBytes = 0;

        async Task CollectAsync(string directory, string relativeDirectory, int depth)
        {
            if (depth > 16) throw new InvalidDataException("スクリプトフォルダの階層が深すぎます");
            foreach (var path in Directory.EnumerateFileSystemEntries(directory).OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var info = new FileInfo(path);
                if ((info.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                var name = Path.GetFileName(path);
                var relative = relativeDirectory.Length == 0 ? name : $"{relativeDirectory}/{name}";
                if (Directory.Exists(path)) await CollectAsync(path, relative, depth + 1);
                else if (name.EndsWith(".star", StringComparison.OrdinalIgnoreCase))
                {
                    if (sources.Count >= 256) throw new InvalidDataException("スクリプトファイルが多すぎます");
                    var source = await ReadTextAsync(path, 2 * 1024 * 1024, cancellationToken);
                    totalBytes += Encoding.UTF8.GetByteCount(source);
                    if (totalBytes > 8 * 1024 * 1024) throw new InvalidDataException("スクリプト全体が大きすぎます");
                    sources[relative] = source;
                }
            }
        }

        await CollectAsync(contentRoot, "", 0);
        if (!sources.ContainsKey(entryPath)) sources[entryPath] = await ReadAssetTextAsync(reference, entryPath, cancellationToken: cancellationToken);
        _scriptCache[reference.GraphId] = sources;
        return sources;
    }

    public string? GetAssetPath(GraphRef reference, string relativeAssetPath)
    {
        if (!GraphValidator.IsSafeRelativePath(relativeAssetPath)) return null;
        var complete = reference.ParentPath.Length == 0
            ? relativeAssetPath
            : $"{reference.ParentPath}/{relativeAssetPath}";
        if (_remote.IsRemoteRoot(reference.RootUri))
        {
            try { return _remote.Materialize(reference.RootUri, complete); }
            catch (Exception error) when (error is IOException or InvalidDataException or ArgumentException or HttpRequestException) { return null; }
        }
        return ResolveFromRoot(reference.RootUri, complete, expectFile: true);
    }

    public Task<string?> GetAssetPathAsync(GraphRef reference, string relativeAssetPath, CancellationToken cancellationToken = default) =>
        _remote.IsRemoteRoot(reference.RootUri)
            ? Task.Run(() => GetAssetPath(reference, relativeAssetPath), cancellationToken)
            : Task.FromResult(GetAssetPath(reference, relativeAssetPath));

    public async Task<LibraryContentInspection> InspectContentAsync(GraphRef reference, CancellationToken cancellationToken = default)
    {
        var graph = await ReadGraphAsync(reference, cancellationToken);
        var cached = _graphCache.GetValueOrDefault(reference.GraphId)
            ?? throw new InvalidDataException("Yuraiveファイルを読み込めません");
        var assets = await Task.Run(() => InspectGraphAssets(reference, graph, cached), cancellationToken);
        return new LibraryContentInspection(graph, cached.IsBundle, assets);
    }

    public async Task<IReadOnlyList<ValidationIssue>> ValidateAsync(
        GraphRef reference,
        YuraiveGraph graph,
        CancellationToken cancellationToken = default)
    {
        var source = _graphCache.GetValueOrDefault(reference.GraphId)?.SourceJson ?? YuraiveJson.Serialize(graph);
        var issues = GraphValidator.ValidateJson(source).ToList();
        var required = new HashSet<string>(StringComparer.Ordinal);
        AddRequired(graph.PlaybackStats?.Path);
        foreach (var node in graph.Nodes.Values)
        {
            AddRequired(node.Script?.Path);
            foreach (var media in node.Media)
            {
                AddRequired(media.Source.Audio);
                AddRequired(media.Source.Video);
            }
        }
        foreach (var button in graph.Buttons.Values) AddRequired(button.Render?.Path);
        foreach (var control in graph.PlayerControls.Values) AddRequired(control.Layout);

        foreach (var path in GraphValidator.AllAssetPaths(graph).Where(GraphValidator.IsSafeRelativePath))
        {
            var exists = _remote.IsRemoteRoot(reference.RootUri)
                ? await Task.Run(() => AssetExists(reference, path), cancellationToken)
                : AssetExists(reference, path);
            if (!exists)
                issues.Add(new(required.Contains(path) ? ValidationSeverity.Error : ValidationSeverity.Warning, $"ファイルが見つかりません: {path}", path));
        }

        var layouts = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var path in graph.PlayerControls.Values.Select(control => control.Layout).OfType<string>().Distinct(StringComparer.Ordinal).Where(GraphValidator.IsSafeRelativePath))
        {
            var exists = _remote.IsRemoteRoot(reference.RootUri)
                ? await Task.Run(() => AssetExists(reference, path), cancellationToken)
                : AssetExists(reference, path);
            if (!exists) continue;
            try
            {
                var layout = await ReadAssetTextAsync(reference, path, 512 * 1024, cancellationToken);
                layouts[path] = layout;
                issues.AddRange(YuraiveLayout.Validate(layout).Select(issue => new ValidationIssue(issue.Severity, $"{path}: {issue.Message}", path)));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                issues.Add(new(ValidationSeverity.Error, $"レイアウトを読み込めません: {error.Message}", path));
            }
        }

        foreach (var (nodeId, node) in graph.Nodes.Where(item => item.Value.Buttons.Count > 0))
        {
            var controlId = node.PlayerControl ?? graph.GlobalPlayerControl;
            if (controlId is null || !graph.PlayerControls.TryGetValue(controlId, out var control) || control.Layout is null || !layouts.TryGetValue(control.Layout, out var sourceLayout)) continue;
            var slots = YuraiveLayout.SlotIdentifiers(sourceLayout).ToHashSet(StringComparer.Ordinal);
            foreach (var buttonId in node.Buttons)
            {
                var target = graph.Buttons.GetValueOrDefault(buttonId)?.TargetSlot?.Trim() ?? "";
                if (!slots.Contains(target))
                    issues.Add(new(ValidationSeverity.Error, $"{nodeId}/{buttonId}: レイアウトにslot「{(target.Length == 0 ? "(default)" : target)}」がありません", control.Layout));
            }
        }
        return issues;

        void AddRequired(string? path) { if (path is not null) required.Add(path); }
    }

    private LibraryDirectory ScanDirectory(RootGrant grant, string relativePath, CancellationToken cancellationToken)
    {
        if (_remote.IsRemoteRoot(grant.Uri)) return ScanRemoteDirectory(grant, relativePath, cancellationToken);
        var directory = ResolveFromRoot(grant.Uri, relativePath, expectFile: false)
            ?? throw new DirectoryNotFoundException("フォルダが見つかりません");
        var entries = Directory.EnumerateFileSystemEntries(directory).Where(path =>
        {
            try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0; }
            catch { return false; }
        }).ToList();
        var files = entries.Where(File.Exists).ToList();
        var bundleFiles = files.Where(path => IsBundlePath(path)).ToList();
        var bundleNames = bundleFiles.Select(GraphBaseName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var graphFiles = bundleFiles.Concat(files
            .Where(path => path.EndsWith(".yuraive.json", StringComparison.OrdinalIgnoreCase))
            .Where(path => !bundleNames.Contains(GraphBaseName(path))))
            .ToList();
        var name = relativePath.Split('/').LastOrDefault() is { Length: > 0 } value ? value : grant.Name;
        LibraryDirectory result;
        if (graphFiles.Count > 0)
        {
            result = new(grant, name, relativePath, [], graphFiles
                .Select(path => ScanGraphPreview(grant, relativePath, path, cancellationToken))
                .OrderBy(graph => graph.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToList());
        }
        else
        {
            result = new(grant, name, relativePath, entries.Where(Directory.Exists)
                .Select(path => new LibraryFolder(Path.GetFileName(path), JoinRelative(relativePath, Path.GetFileName(path))))
                .OrderBy(folder => folder.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(), []);
        }
        _directoryCache[$"{grant.Uri}::{relativePath}"] = result;
        return result;
    }

    private LibraryDirectory ScanRemoteDirectory(RootGrant grant, string relativePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var entries = _remote.List(grant.Uri, relativePath);
        var files = entries.Where(node => !node.IsDirectory).ToList();
        var bundleFiles = files.Where(node => IsBundlePath(node.Name)).ToList();
        var bundleNames = bundleFiles.Select(node => GraphBaseName(node.Name)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var graphFiles = bundleFiles.Concat(files
            .Where(node => node.Name.EndsWith(".yuraive.json", StringComparison.OrdinalIgnoreCase))
            .Where(node => !bundleNames.Contains(GraphBaseName(node.Name))))
            .ToList();
        var name = relativePath.Split('/').LastOrDefault() is { Length: > 0 } value ? value : grant.Name;
        LibraryDirectory result;
        if (graphFiles.Count > 0)
        {
            result = new(grant, name, relativePath, [], graphFiles
                .Select(node => ScanRemoteGraphPreview(grant, relativePath, node, cancellationToken))
                .OrderBy(graph => graph.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToList());
        }
        else
        {
            result = new(grant, name, relativePath, entries.Where(node => node.IsDirectory)
                .Select(node => new LibraryFolder(node.Name, JoinRelative(relativePath, node.Name)))
                .OrderBy(folder => folder.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(), []);
        }
        _directoryCache[$"{grant.Uri}::{relativePath}"] = result;
        return result;
    }

    private LibraryGraph ScanGraphPreview(RootGrant grant, string parentPath, string file, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(file);
        var reference = new GraphRef { RootUri = grant.Uri, RootName = grant.Name, RelativePath = JoinRelative(parentPath, fileName) };
        try
        {
            var metadata = IsBundlePath(file) ? ReadBundleMetadata(file, cancellationToken) : ReadMetadataPrefix(file, cancellationToken);
            var baseName = GraphBaseName(fileName);
            return new(reference,
                string.IsNullOrWhiteSpace(metadata.DisplayName) ? baseName : metadata.DisplayName,
                string.IsNullOrWhiteSpace(metadata.Author) ? null : metadata.Author,
                string.IsNullOrWhiteSpace(metadata.Thumbnail) ? null : metadata.Thumbnail,
                ModifiedAt: new FileInfo(file).LastWriteTimeUtc.Ticks);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException)
        {
            return new(reference, GraphBaseName(fileName), ParseError: error.Message, ModifiedAt: new FileInfo(file).LastWriteTimeUtc.Ticks);
        }
    }

    private LibraryGraph ScanRemoteGraphPreview(RootGrant grant, string parentPath, RemoteNode node, CancellationToken cancellationToken)
    {
        var relativePath = JoinRelative(parentPath, node.Name);
        var reference = new GraphRef { RootUri = grant.Uri, RootName = grant.Name, RelativePath = relativePath };
        try
        {
            var metadata = IsBundlePath(node.Name)
                ? ReadRemoteBundleMetadata(grant.Uri, relativePath, cancellationToken)
                : ReadRemoteMetadataPrefix(grant.Uri, relativePath, cancellationToken);
            var graph = new LibraryGraph(
                reference,
                string.IsNullOrWhiteSpace(metadata.DisplayName) ? GraphBaseName(node.Name) : metadata.DisplayName,
                string.IsNullOrWhiteSpace(metadata.Author) ? null : metadata.Author,
                string.IsNullOrWhiteSpace(metadata.Thumbnail) ? null : metadata.Thumbnail,
                ModifiedAt: node.ModifiedAt);
            if (graph.ThumbnailPath is not null) _ = GetAssetPath(reference, graph.ThumbnailPath);
            return graph;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException or HttpRequestException)
        {
            return new(reference, GraphBaseName(node.Name), ParseError: error.Message, ModifiedAt: node.ModifiedAt);
        }
    }

    private static GraphMetadataPreview ReadBundleMetadata(string file, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var decoded = NativeRuntime.DecodeBundle(ReadBytes(file, 16 * 1024 * 1024));
        var graph = YuraiveJson.Deserialize<YuraiveGraph>(decoded.GraphJson);
        return new GraphMetadataPreview
        {
            DisplayName = graph.Metadata?.DisplayName,
            Author = graph.Metadata?.Author,
            Thumbnail = graph.Metadata?.Thumbnail,
        };
    }

    private GraphMetadataPreview ReadRemoteBundleMetadata(string rootUri, string relativePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var decoded = NativeRuntime.DecodeBundle(ReadRemoteBytes(rootUri, relativePath, 16 * 1024 * 1024, cancellationToken));
        var graph = YuraiveJson.Deserialize<YuraiveGraph>(decoded.GraphJson);
        return new GraphMetadataPreview
        {
            DisplayName = graph.Metadata?.DisplayName,
            Author = graph.Metadata?.Author,
            Thumbnail = graph.Metadata?.Thumbnail,
        };
    }

    private static GraphMetadataPreview ReadMetadataPrefix(string file, CancellationToken cancellationToken)
    {
        using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, MetadataReadChunk, FileOptions.SequentialScan);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var prefix = new StringBuilder();
        var buffer = new char[MetadataReadChunk];
        while (prefix.Length < MetadataPrefixLimit)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = reader.Read(buffer, 0, Math.Min(buffer.Length, MetadataPrefixLimit - prefix.Length));
            if (count > 0) prefix.Append(buffer, 0, count);
            var result = NativeRuntime.ExtractMetadataPrefix(prefix.ToString());
            switch (result.Status)
            {
                case "found": return result.Metadata ?? new();
                case "missing": return new();
                case "invalid": throw new InvalidDataException(result.Error ?? "JSONメタデータを解析できません");
                case "needMore" when count > 0: continue;
                case "needMore": throw new InvalidDataException("JSONが途中で終了しています");
                default: throw new InvalidDataException("JSONメタデータを解析できません");
            }
        }
        throw new InvalidDataException($"メタデータがJSONの先頭 {MetadataPrefixLimit / 1024} KiB以内にありません");
    }

    private GraphMetadataPreview ReadRemoteMetadataPrefix(string rootUri, string relativePath, CancellationToken cancellationToken)
    {
        using var read = _remote.Open(rootUri, relativePath);
        using var reader = new StreamReader(read.Stream, new UTF8Encoding(false, true), detectEncodingFromByteOrderMarks: true, MetadataReadChunk, leaveOpen: true);
        return ReadMetadataPrefix(reader, cancellationToken);
    }

    private static GraphMetadataPreview ReadMetadataPrefix(StreamReader reader, CancellationToken cancellationToken)
    {
        var prefix = new StringBuilder();
        var buffer = new char[MetadataReadChunk];
        while (prefix.Length < MetadataPrefixLimit)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = reader.Read(buffer, 0, Math.Min(buffer.Length, MetadataPrefixLimit - prefix.Length));
            if (count > 0) prefix.Append(buffer, 0, count);
            var result = NativeRuntime.ExtractMetadataPrefix(prefix.ToString());
            switch (result.Status)
            {
                case "found": return result.Metadata ?? new();
                case "missing": return new();
                case "invalid": throw new InvalidDataException(result.Error ?? "JSONメタデータを解析できません");
                case "needMore" when count > 0: continue;
                case "needMore": throw new InvalidDataException("JSONが途中で終了しています");
                default: throw new InvalidDataException("JSONメタデータを解析できません");
            }
        }
        throw new InvalidDataException($"メタデータがJSONの先頭 {MetadataPrefixLimit / 1024} KiB以内にありません");
    }

    private static async Task<string> ReadTextAsync(string file, int maxBytes, CancellationToken cancellationToken)
    {
        var info = new FileInfo(file);
        if (info.Length > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {info.Name}");
        await using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 16 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, true), detectEncodingFromByteOrderMarks: true);
        var text = await reader.ReadToEndAsync(cancellationToken);
        if (Encoding.UTF8.GetByteCount(text) > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {info.Name}");
        return text;
    }

    private static byte[] ReadBytes(string file, int maxBytes)
    {
        var info = new FileInfo(file);
        if (info.Length > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {info.Name}");
        return File.ReadAllBytes(file);
    }

    private static async Task<byte[]> ReadBytesAsync(string file, int maxBytes, CancellationToken cancellationToken)
    {
        var info = new FileInfo(file);
        if (info.Length > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {info.Name}");
        return await File.ReadAllBytesAsync(file, cancellationToken);
    }

    private Task<byte[]> ReadRemoteBytesAsync(string rootUri, string relativePath, int maxBytes, CancellationToken cancellationToken) =>
        Task.Run(() => ReadRemoteBytes(rootUri, relativePath, maxBytes, cancellationToken), cancellationToken);

    private byte[] ReadRemoteBytes(string rootUri, string relativePath, int maxBytes, CancellationToken cancellationToken)
    {
        using var read = _remote.Open(rootUri, relativePath);
        if (read.TotalLength > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {relativePath.Split('/').LastOrDefault()}");
        using var output = new MemoryStream(read.TotalLength is >= 0 and <= int.MaxValue ? (int)read.TotalLength : 0);
        var buffer = new byte[16 * 1024];
        var total = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = read.Stream.Read(buffer, 0, buffer.Length);
            if (count == 0) break;
            total += count;
            if (total > maxBytes) throw new InvalidDataException($"ファイルが大きすぎます: {relativePath.Split('/').LastOrDefault()}");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }

    private async Task<string> ReadRemoteTextAsync(string rootUri, string relativePath, int maxBytes, CancellationToken cancellationToken)
    {
        var bytes = await ReadRemoteBytesAsync(rootUri, relativePath, maxBytes, cancellationToken);
        using var stream = new MemoryStream(bytes, writable: false);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, true), detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync(cancellationToken);
    }

    private static string? ResolveFromRoot(string rootPath, string relativePath, bool expectFile)
    {
        var root = Path.GetFullPath(rootPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!Directory.Exists(root)) return null;
        if (relativePath.Length > 0 && !GraphValidator.IsSafeRelativePath(relativePath)) return null;
        var current = root;
        foreach (var segment in relativePath.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (!File.Exists(current) && !Directory.Exists(current)) return null;
            try { if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return null; }
            catch { return null; }
        }
        var full = Path.GetFullPath(current);
        var prefix = root + Path.DirectorySeparatorChar;
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) && !full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
        return expectFile ? File.Exists(full) ? full : null : Directory.Exists(full) ? full : null;
    }

    private async Task MutateStateAsync(Func<LibraryState, LibraryState> transform, CancellationToken cancellationToken)
    {
        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            var next = transform(_state);
            await DurableFile.WriteAtomicAsync(_statePath, YuraiveJson.Serialize(next), cancellationToken);
            _state = next;
        }
        finally { _stateGate.Release(); }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private LibraryState ReadState()
    {
        try { return File.Exists(_statePath) ? YuraiveJson.Deserialize<LibraryState>(File.ReadAllText(_statePath)) : new(); }
        catch { return new(); }
    }

    private void ClearCaches()
    {
        _directoryCache.Clear();
        _graphCache.Clear();
        _scriptCache.Clear();
        _remote.ClearListings();
    }

    private void MergeKnownGraphs(IEnumerable<LibraryGraph> graphs)
    {
        _knownGraphs = _knownGraphs.Concat(graphs).GroupBy(graph => graph.Ref.GraphId, StringComparer.Ordinal).Select(group => group.Last()).ToList();
    }

    private static string JoinRelative(string parent, string child) => parent.Length == 0 ? child : $"{parent}/{child}";
    private static string ParentPath(string path) => path.Contains('/') ? path[..path.LastIndexOf('/')] : "";
    private static bool IsBundlePath(string path) => path.EndsWith(".yuraive", StringComparison.OrdinalIgnoreCase);
    private static string? BundleRelativePath(string path) => path.EndsWith(".yuraive.json", StringComparison.OrdinalIgnoreCase)
        ? path[..^".yuraive.json".Length] + ".yuraive"
        : IsBundlePath(path) ? path : null;
    private static string GraphBaseName(string path)
    {
        var name = Path.GetFileName(path);
        return name.EndsWith(".yuraive.json", StringComparison.OrdinalIgnoreCase) ? name[..^".yuraive.json".Length]
            : name.EndsWith(".yuraive", StringComparison.OrdinalIgnoreCase) ? name[..^".yuraive".Length]
            : name;
    }

    private bool AssetExists(GraphRef reference, string relativeAssetPath)
    {
        if (_graphCache.TryGetValue(reference.GraphId, out var bundle) && bundle.TextAssets.ContainsKey(relativeAssetPath)) return true;
        if (!GraphValidator.IsSafeRelativePath(relativeAssetPath)) return false;
        if (_remote.IsRemoteRoot(reference.RootUri))
        {
            try
            {
                var node = _remote.Stat(reference.RootUri, RemotePaths.Join(reference.ParentPath, relativeAssetPath));
                return node is { IsDirectory: false };
            }
            catch { return false; }
        }
        return GetAssetPath(reference, relativeAssetPath) is not null;
    }

    private IReadOnlyList<LibraryAssetInspection> InspectGraphAssets(GraphRef reference, YuraiveGraph graph, CachedGraph cached)
    {
        var bundledTextPaths = new HashSet<string>(StringComparer.Ordinal);
        Add(graph.PlaybackStats?.Path);
        foreach (var node in graph.Nodes.Values) Add(node.Script?.Path);
        foreach (var button in graph.Buttons.Values) Add(button.Render?.Path);
        foreach (var control in graph.PlayerControls.Values) Add(control.Layout);

        return GraphValidator.AllAssetPaths(graph)
            .Where(path => path.Length > 0)
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path =>
            {
                var safe = GraphValidator.IsSafeRelativePath(path);
                var embedded = safe && cached.TextAssets.ContainsKey(path);
                var requiresEmbedding = cached.IsBundle && bundledTextPaths.Contains(path);
                var recognized = safe && (embedded || (!requiresEmbedding && AssetExists(reference, path)));
                return new LibraryAssetInspection(path, recognized, embedded, !safe
                    ? AssetInspectionProblem.UnsafePath
                    : !recognized ? AssetInspectionProblem.Missing : null);
            })
            .ToList();

        void Add(string? path) { if (path is not null) bundledTextPaths.Add(path); }
    }

    private sealed record LibraryState
    {
        public List<RootGrant> Roots { get; init; } = [];
        public Dictionary<string, long> FavoriteAt { get; init; } = new(StringComparer.Ordinal);
    }

    private sealed record CachedGraph(YuraiveGraph Graph, string SourceJson, IReadOnlyDictionary<string, BundledTextAsset> TextAssets, bool IsBundle, long Length, long ModifiedAt);
}
