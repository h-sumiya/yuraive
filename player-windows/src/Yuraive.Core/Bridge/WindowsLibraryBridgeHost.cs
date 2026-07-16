using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SIPSorcery.Net;
using Yuraive.Core.Models;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Bridge;

public enum BridgeHostStatus { Starting, WaitingForAndroid, Connecting, Connected, Error, Stopped }

public sealed record WindowsPairingIdentity(
    string Room,
    string Secret,
    string DeviceId,
    string DeviceName);

public sealed class WindowsLibraryBridgeHost : IAsyncDisposable
{
    private const string SignalingBase = "wss://connect.yuraive.com/v1/rooms";
    private const string StunUrl = "stun:stun.cloudflare.com:3478";
    private static readonly byte[] PairingEntropy = "Yuraive Windows pairing v1"u8.ToArray();
    private readonly DocumentLibrary _library;
    private readonly string _pairingPath;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _peerGate = new(1, 1);
    private readonly SemaphoreSlim _signalSendGate = new(1, 1);
    private readonly SemaphoreSlim _dataSendGate = new(1, 1);
    private readonly object _identityGate = new();
    private readonly object _runGate = new();
    private ClientWebSocket? _socket;
    private RTCPeerConnection? _peer;
    private RTCDataChannel? _channel;
    private Task? _runTask;
    private CancellationTokenSource? _session;
    private WindowsPairingIdentity _identity;

    public WindowsLibraryBridgeHost(DocumentLibrary library, AppDataPaths paths)
    {
        _library = library;
        _pairingPath = paths.WindowsPairing;
        _identity = ReadIdentity() ?? CreateIdentity();
        PersistIdentity(_identity);
    }

    public WindowsPairingIdentity Identity { get { lock (_identityGate) return _identity; } }
    public BridgeHostStatus Status { get; private set; } = BridgeHostStatus.Starting;
    public string? StatusDetail { get; private set; }
    public int ConnectedDeviceCount => Status == BridgeHostStatus.Connected ? 1 : 0;
    public event EventHandler? StatusChanged;

    public string PairingUri
    {
        get
        {
            var identity = Identity;
            return $"yuraive://pair?v=1&endpoint={Uri.EscapeDataString(SignalingBase)}" +
                $"&room={identity.Room}&secret={identity.Secret}" +
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
            _runTask = RunAsync(_session.Token);
        }
    }

    public async Task StopAsync()
    {
        Task? runTask;
        CancellationTokenSource? session;
        lock (_runGate)
        {
            runTask = _runTask;
            session = _session;
            session?.Cancel();
            _socket?.Abort();
        }
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
        if (runTask is null) SetStatus(BridgeHostStatus.Stopped);
    }

    public async Task RegeneratePairingAsync()
    {
        lock (_identityGate)
        {
            _identity = new WindowsPairingIdentity(
                RandomToken(16),
                RandomToken(32),
                _identity.DeviceId,
                _identity.DeviceName);
        }
        PersistIdentity(Identity);
        _socket?.Abort();
        await ClosePeerAsync();
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var delay = TimeSpan.FromSeconds(1);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ConnectSignalingAsync(cancellationToken);
                delay = TimeSpan.FromSeconds(1);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                SetStatus(BridgeHostStatus.Error, error.Message);
                try { await Task.Delay(delay, cancellationToken); }
                catch (OperationCanceledException) { break; }
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 30));
            }
            finally
            {
                await ClosePeerAsync();
                _socket?.Dispose();
                _socket = null;
            }
        }
        SetStatus(BridgeHostStatus.Stopped);
    }

    private async Task ConnectSignalingAsync(CancellationToken cancellationToken)
    {
        var identity = Identity;
        var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        socket.Options.SetRequestHeader("Authorization", $"Bearer {identity.Secret}");
        _socket = socket;
        SetStatus(BridgeHostStatus.Starting);
        var url = new Uri($"{SignalingBase}/{identity.Room}?role=host");
        await socket.ConnectAsync(url, cancellationToken);
        SetStatus(BridgeHostStatus.WaitingForAndroid);

        var buffer = new byte[132 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "reconnect", CancellationToken.None);
                    return;
                }
                if (message.Length + result.Count > 128 * 1024) throw new InvalidDataException("シグナリング応答が大きすぎます");
                message.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);
            if (result.MessageType != WebSocketMessageType.Text) continue;
            await HandleSignalAsync(Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length), cancellationToken);
        }
    }

    private async Task HandleSignalAsync(string json, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var type = root.GetProperty("type").GetString();
        switch (type)
        {
            case "peer_ready":
                await CreateOfferAsync(cancellationToken);
                break;
            case "answer":
                var peer = _peer ?? throw new InvalidOperationException("Androidから予期しない応答を受信しました");
                var answer = root.GetProperty("sdp").GetString() ?? throw new InvalidDataException("SDP応答がありません");
                if (peer.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = answer }) != SetDescriptionResultEnum.OK)
                    throw new InvalidDataException("AndroidのSDP応答を適用できません");
                SetStatus(BridgeHostStatus.Connecting);
                break;
            case "candidate":
                var candidatePeer = _peer;
                if (candidatePeer is null) return;
                candidatePeer.addIceCandidate(new RTCIceCandidateInit
                {
                    candidate = root.GetProperty("candidate").GetString() ?? "",
                    sdpMid = root.TryGetProperty("sdpMid", out var mid) ? mid.GetString() ?? "0" : "0",
                    sdpMLineIndex = root.TryGetProperty("sdpMLineIndex", out var line) ? line.GetUInt16() : (ushort)0,
                });
                break;
            case "peer_left":
                await ClosePeerAsync();
                SetStatus(BridgeHostStatus.WaitingForAndroid);
                break;
        }
    }

    private async Task CreateOfferAsync(CancellationToken cancellationToken)
    {
        await _peerGate.WaitAsync(cancellationToken);
        try
        {
            ClosePeerUnsafe();
            var peer = new RTCPeerConnection(new RTCConfiguration
            {
                iceServers = [new RTCIceServer { urls = StunUrl }],
            });
            _peer = peer;
            peer.onicecandidate += candidate => _ = SendSignalAsync(new
            {
                type = "candidate",
                candidate = candidate.candidate,
                sdpMid = candidate.sdpMid,
                sdpMLineIndex = candidate.sdpMLineIndex,
            }, _lifetime.Token);
            peer.onconnectionstatechange += state =>
            {
                if (state == RTCPeerConnectionState.connected) SetStatus(BridgeHostStatus.Connected);
                else if (state is RTCPeerConnectionState.failed or RTCPeerConnectionState.disconnected)
                    SetStatus(BridgeHostStatus.Error, "AndroidとのP2P接続が切断されました");
            };
            var channel = await peer.createDataChannel("yuraive-library");
            _channel = channel;
            channel.onopen += () => SetStatus(BridgeHostStatus.Connected);
            channel.onclose += () => SetStatus(BridgeHostStatus.WaitingForAndroid);
            channel.onerror += error => SetStatus(BridgeHostStatus.Error, error);
            channel.onmessage += (dataChannel, protocol, data) =>
            {
                if (protocol == DataChannelPayloadProtocols.WebRTC_String)
                    _ = HandleDataRequestAsync(dataChannel, Encoding.UTF8.GetString(data), _lifetime.Token);
            };

            var offer = peer.createOffer();
            await peer.setLocalDescription(offer);
            await SendSignalAsync(new { type = "offer", sdp = offer.sdp }, cancellationToken);
            SetStatus(BridgeHostStatus.Connecting);
        }
        finally { _peerGate.Release(); }
    }

    private async Task HandleDataRequestAsync(RTCDataChannel channel, string json, CancellationToken cancellationToken)
    {
        string? id = null;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            id = root.GetProperty("id").GetString();
            if (id is null || id.Length != 32 || !id.All(Uri.IsHexDigit)) throw new InvalidDataException("リクエストIDが不正です");
            var method = root.GetProperty("method").GetString();
            switch (method)
            {
                case "roots":
                    var roots = _library.Roots.Select(grant => new { id = RootId(grant.Uri), name = grant.Name }).ToList();
                    await SendDataJsonAsync(channel, new { id, ok = true, roots }, cancellationToken);
                    break;
                case "list":
                    var listGrant = ResolveRoot(root.GetProperty("rootId").GetString());
                    var path = SafePath(root);
                    var nodes = await _library.ListFilesAsync(listGrant, path, cancellationToken);
                    await SendDataJsonAsync(channel, new { id, ok = true, nodes }, cancellationToken);
                    break;
                case "stat":
                    var statGrant = ResolveRoot(root.GetProperty("rootId").GetString());
                    var statPath = SafePath(root);
                    var parent = statPath.Contains('/') ? statPath[..statPath.LastIndexOf('/')] : "";
                    var name = statPath[(statPath.LastIndexOf('/') + 1)..];
                    var node = (await _library.ListFilesAsync(statGrant, parent, cancellationToken))
                        .FirstOrDefault(value => string.Equals(value.Name, name, StringComparison.Ordinal));
                    await SendDataJsonAsync(channel, new { id, ok = true, node }, cancellationToken);
                    break;
                case "read":
                    var readGrant = ResolveRoot(root.GetProperty("rootId").GetString());
                    var readPath = SafePath(root);
                    var offset = root.GetProperty("offset").GetInt64();
                    var count = root.GetProperty("count").GetInt32();
                    var chunk = await _library.ReadFileRangeAsync(readGrant, readPath, offset, count, cancellationToken);
                    await SendDataJsonAsync(channel, new
                    {
                        id,
                        ok = true,
                        data = Convert.ToBase64String(chunk.Data),
                        totalLength = chunk.TotalLength,
                    }, cancellationToken);
                    break;
                default:
                    throw new InvalidDataException("未対応のリクエストです");
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            if (id is not null) await SendDataJsonAsync(channel, new { id, ok = false, error = error.Message }, CancellationToken.None);
        }
    }

    private RootGrant ResolveRoot(string? rootId) => _library.Roots.FirstOrDefault(root => RootId(root.Uri) == rootId)
        ?? throw new DirectoryNotFoundException("Windows側のフォルダが見つかりません");

    private static string SafePath(JsonElement request)
    {
        var path = request.TryGetProperty("path", out var value) ? value.GetString() ?? "" : "";
        if (path.Length > 0 && !GraphValidator.IsSafeRelativePath(path)) throw new InvalidDataException("安全でないパスです");
        return path;
    }

    private static string RootId(string uri)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(uri));
        return Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
    }

    private async Task SendSignalAsync(object value, CancellationToken cancellationToken)
    {
        var socket = _socket;
        if (socket?.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, YuraiveJson.Options));
        await _signalSendGate.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
                await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally { _signalSendGate.Release(); }
    }

    private async Task SendDataJsonAsync(RTCDataChannel channel, object value, CancellationToken cancellationToken)
    {
        await _dataSendGate.WaitAsync(cancellationToken);
        try { channel.send(JsonSerializer.Serialize(value, YuraiveJson.Options)); }
        finally { _dataSendGate.Release(); }
    }

    private async Task ClosePeerAsync()
    {
        await _peerGate.WaitAsync();
        try { ClosePeerUnsafe(); }
        finally { _peerGate.Release(); }
    }

    private void ClosePeerUnsafe()
    {
        _channel?.close();
        _channel = null;
        _peer?.Close("reset");
        _peer = null;
    }

    private void SetStatus(BridgeHostStatus status, string? detail = null)
    {
        Status = status;
        StatusDetail = detail;
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private WindowsPairingIdentity? ReadIdentity()
    {
        try
        {
            if (!File.Exists(_pairingPath)) return null;
            var protectedBytes = Convert.FromBase64String(File.ReadAllText(_pairingPath));
            return YuraiveJson.Deserialize<WindowsPairingIdentity>(Encoding.UTF8.GetString(Dpapi.Unprotect(protectedBytes, PairingEntropy)));
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

    private static WindowsPairingIdentity CreateIdentity() => new(
        RandomToken(16),
        RandomToken(32),
        RandomToken(16),
        Environment.MachineName);

    private static string RandomToken(int byteCount) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(byteCount))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        await StopAsync();
        _lifetime.Dispose();
        _peerGate.Dispose();
        _signalSendGate.Dispose();
        _dataSendGate.Dispose();
    }
}
