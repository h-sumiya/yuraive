using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Yuraive.Core.Interop;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Bridge;

public enum BridgeHostStatus { Starting, WaitingForAndroid, Connecting, Connected, Error, Stopped }

public sealed record WindowsPairingIdentity(
    string Room,
    string Secret,
    string DeviceId,
    string DeviceName,
    string Certificate,
    string PrivateKey,
    string Fingerprint);

public sealed class WindowsLibraryBridgeHost : IAsyncDisposable
{
    private const string SignalingBase = "wss://connect.yuraive.com/v2/rooms";
    private static readonly byte[] PairingEntropy = "Yuraive Windows QUIC pairing v2"u8.ToArray();
    private readonly DocumentLibrary _library;
    private readonly string _pairingPath;
    private readonly string _cacheDirectory;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _identityGate = new();
    private readonly object _runGate = new();
    private readonly object _statusGate = new();
    private Task? _runTask;
    private CancellationTokenSource? _session;
    private ulong _hostHandle;
    private WindowsPairingIdentity _identity;
    private BridgeHostStatus _status = BridgeHostStatus.Starting;
    private string? _statusDetail;

    public WindowsLibraryBridgeHost(DocumentLibrary library, AppDataPaths paths)
    {
        _library = library;
        _pairingPath = paths.WindowsPairing;
        _cacheDirectory = paths.P2pHostCache;
        _identity = ReadIdentity() ?? CreateIdentity();
        PersistIdentity(_identity);
    }

    public WindowsPairingIdentity Identity { get { lock (_identityGate) return _identity; } }
    public BridgeHostStatus Status { get { lock (_statusGate) return _status; } }
    public string? StatusDetail { get { lock (_statusGate) return _statusDetail; } }
    public int ConnectedDeviceCount => Status == BridgeHostStatus.Connected ? 1 : 0;
    public event EventHandler? StatusChanged;

    public string PairingUri
    {
        get
        {
            var identity = Identity;
            return $"yuraive://pair?v=2&endpoint={Uri.EscapeDataString(SignalingBase)}" +
                $"&room={identity.Room}&secret={identity.Secret}&pin={identity.Fingerprint}" +
                $"&device={identity.DeviceId}&name={Uri.EscapeDataString(identity.DeviceName)}";
        }
    }

    public void Start()
    {
        lock (_runGate)
        {
            if (_runTask is { IsCompleted: false }) return;
            _session?.Dispose();
            _session = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            try
            {
                var identity = Identity;
                _hostHandle = NativeRuntime.StartP2pHost(new P2pHostConfig
                {
                    Endpoint = SignalingBase,
                    Room = identity.Room,
                    Secret = identity.Secret,
                    CacheDirectory = _cacheDirectory,
                    Certificate = identity.Certificate,
                    PrivateKey = identity.PrivateKey,
                    Fingerprint = identity.Fingerprint,
                });
                var handle = _hostHandle;
                _runTask = Task.Run(() => RunProviderLoopAsync(handle, _session.Token));
            }
            catch (Exception error)
            {
                _hostHandle = 0;
                SetStatus(BridgeHostStatus.Error, error.Message);
            }
        }
    }

    public async Task StopAsync()
    {
        Task? runTask;
        CancellationTokenSource? session;
        ulong handle;
        lock (_runGate)
        {
            runTask = _runTask;
            session = _session;
            handle = _hostHandle;
            _hostHandle = 0;
            session?.Cancel();
        }
        if (handle != 0) NativeRuntime.CloseP2pHost(handle);
        if (runTask is not null)
        {
            try { await runTask; }
            catch (OperationCanceledException) { }
        }
        lock (_runGate)
        {
            if (ReferenceEquals(_runTask, runTask)) _runTask = null;
            if (ReferenceEquals(_session, session)) _session = null;
        }
        session?.Dispose();
        SetStatus(BridgeHostStatus.Stopped);
    }

    public async Task RegeneratePairingAsync()
    {
        bool restart;
        lock (_runGate) restart = _runTask is { IsCompleted: false };
        if (restart) await StopAsync();
        var certificate = NativeRuntime.CreateP2pIdentity();
        lock (_identityGate)
        {
            _identity = new WindowsPairingIdentity(
                RandomToken(16),
                RandomToken(32),
                _identity.DeviceId,
                _identity.DeviceName,
                certificate.Certificate,
                certificate.PrivateKey,
                certificate.Fingerprint);
        }
        PersistIdentity(Identity);
        if (restart) Start();
    }

    private async Task RunProviderLoopAsync(ulong handle, CancellationToken cancellationToken)
    {
        var active = new ConcurrentDictionary<ulong, Task>();
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                UpdateNativeStatus(NativeRuntime.P2pHostStatus(handle));
                var request = NativeRuntime.PollP2pHost(handle, 100);
                if (request is null) continue;
                var task = Task.Run(() => HandleProviderRequestAsync(handle, request, cancellationToken), CancellationToken.None);
                active[request.Id] = task;
                _ = task.ContinueWith(
                    completed => active.TryRemove(request.Id, out var ignored),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
        }
        catch (Exception error) when (!cancellationToken.IsCancellationRequested)
        {
            SetStatus(BridgeHostStatus.Error, error.Message);
        }
        finally
        {
            try { await Task.WhenAll(active.Values); }
            catch (Exception) when (cancellationToken.IsCancellationRequested) { }
        }
    }

    private async Task HandleProviderRequestAsync(
        ulong handle,
        P2pProviderRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            switch (request.Method)
            {
                case "roots":
                    var roots = _library.Roots.Select(root => new { id = RootId(root.Uri), name = root.Name }).ToList();
                    RespondJson(handle, request.Id, roots);
                    break;
                case "list":
                    var listRoot = ResolveRoot(request.RootId);
                    var listPath = SafePath(request.Path, allowEmpty: true);
                    var nodes = await _library.ListFilesAsync(listRoot, listPath, cancellationToken);
                    RespondJson(handle, request.Id, nodes.Select(NodeResponse).ToList());
                    break;
                case "stat":
                    var statRoot = ResolveRoot(request.RootId);
                    var statPath = SafePath(request.Path, allowEmpty: false);
                    var parent = statPath.Contains('/') ? statPath[..statPath.LastIndexOf('/')] : "";
                    var name = statPath[(statPath.LastIndexOf('/') + 1)..];
                    var node = (await _library.ListFilesAsync(statRoot, parent, cancellationToken))
                        .FirstOrDefault(value => string.Equals(value.Name, name, StringComparison.Ordinal));
                    RespondJson(handle, request.Id, node is null ? null : NodeResponse(node));
                    break;
                case "read":
                    var readRoot = ResolveRoot(request.RootId);
                    var readPath = SafePath(request.Path, allowEmpty: false);
                    var offset = checked((long)(request.Offset ?? throw new InvalidDataException("読み込み位置がありません")));
                    var count = checked((int)(request.Count ?? throw new InvalidDataException("読み込みサイズがありません")));
                    var chunk = await _library.ReadFileRangeAsync(readRoot, readPath, offset, count, cancellationToken);
                    if (!NativeRuntime.RespondP2pHostBytes(handle, request.Id, chunk.TotalLength, chunk.Data))
                        throw new IOException("Rust P2Pホストが読み込み応答を受理しませんでした");
                    break;
                default:
                    throw new InvalidDataException("未対応のファイル要求です");
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            NativeRuntime.RespondP2pHostError(handle, request.Id, error.Message);
        }
        catch (OperationCanceledException)
        {
            NativeRuntime.RespondP2pHostError(handle, request.Id, "Windows側で読み込みが中断されました");
        }
    }

    private void RespondJson<T>(ulong handle, ulong requestId, T value)
    {
        var json = JsonSerializer.Serialize(value, YuraiveJson.Options);
        if (!NativeRuntime.RespondP2pHostJson(handle, requestId, json))
            throw new IOException("Rust P2Pホストがファイル応答を受理しませんでした");
    }

    private static object NodeResponse(LibraryFileNode node) => new
    {
        name = node.Name,
        isDirectory = node.IsDirectory,
        size = node.Size,
        modifiedAt = node.ModifiedAt,
    };

    private RootGrant ResolveRoot(string? rootId) =>
        _library.Roots.FirstOrDefault(root => RootId(root.Uri) == rootId)
            ?? throw new DirectoryNotFoundException("Windows側のフォルダが見つかりません");

    private static string SafePath(string? path, bool allowEmpty)
    {
        var value = path ?? "";
        if ((!allowEmpty && value.Length == 0) || (value.Length > 0 && !GraphValidator.IsSafeRelativePath(value)))
            throw new InvalidDataException("安全でないパスです");
        return value;
    }

    private static string RootId(string uri)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(uri));
        return Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
    }

    private void UpdateNativeStatus(P2pHostSnapshot snapshot)
    {
        var status = snapshot.State switch
        {
            "starting" => BridgeHostStatus.Starting,
            "waitingForPeer" => BridgeHostStatus.WaitingForAndroid,
            "punching" or "connecting" => BridgeHostStatus.Connecting,
            "connected" => BridgeHostStatus.Connected,
            "error" => BridgeHostStatus.Error,
            "stopped" => BridgeHostStatus.Stopped,
            _ => BridgeHostStatus.Error,
        };
        SetStatus(status, snapshot.Detail);
    }

    private void SetStatus(BridgeHostStatus status, string? detail = null)
    {
        bool changed;
        lock (_statusGate)
        {
            changed = _status != status || !string.Equals(_statusDetail, detail, StringComparison.Ordinal);
            _status = status;
            _statusDetail = detail;
        }
        if (changed) StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private WindowsPairingIdentity? ReadIdentity()
    {
        try
        {
            if (!File.Exists(_pairingPath)) return null;
            var protectedBytes = Convert.FromBase64String(File.ReadAllText(_pairingPath));
            var identity = YuraiveJson.Deserialize<WindowsPairingIdentity>(
                Encoding.UTF8.GetString(Dpapi.Unprotect(protectedBytes, PairingEntropy)));
            return identity.Fingerprint.Length == 43 ? identity : null;
        }
        catch { return null; }
    }

    private void PersistIdentity(WindowsPairingIdentity identity)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_pairingPath)!);
        var bytes = Encoding.UTF8.GetBytes(YuraiveJson.Serialize(identity));
        var encoded = Convert.ToBase64String(Dpapi.Protect(bytes, PairingEntropy));
        File.WriteAllText(_pairingPath, encoded, new UTF8Encoding(false));
    }

    private static WindowsPairingIdentity CreateIdentity()
    {
        var certificate = NativeRuntime.CreateP2pIdentity();
        return new(
            RandomToken(16),
            RandomToken(32),
            RandomToken(16),
            Environment.MachineName,
            certificate.Certificate,
            certificate.PrivateKey,
            certificate.Fingerprint);
    }

    private static string RandomToken(int byteCount) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(byteCount))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        await StopAsync();
        _lifetime.Dispose();
    }
}
