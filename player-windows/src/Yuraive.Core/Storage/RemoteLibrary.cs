using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using SMBLibrary;
using SMBLibrary.Client;
using Yuraive.Core.Models;
using SmbFileAttributes = SMBLibrary.FileAttributes;

namespace Yuraive.Core.Storage;

public enum RemoteProtocol { Smb, WebDav }

public sealed record RemoteConnectionConfig
{
    public string Id { get; init; } = "";
    public required RemoteProtocol Protocol { get; init; }
    public string DisplayName { get; init; } = "";
    public string Host { get; init; } = "";
    public int Port { get; init; } = 445;
    public string Share { get; init; } = "";
    public string Domain { get; init; } = "";
    public string Endpoint { get; init; } = "";
    public string Username { get; init; } = "";
    public string Password { get; init; } = "";
    public string RootPath { get; init; } = "";

    public override string ToString() =>
        $"RemoteConnectionConfig(Id={Id}, Protocol={Protocol}, DisplayName={DisplayName}, Host={Host}, " +
        $"Port={Port}, Share={Share}, Domain={Domain}, Endpoint={Endpoint}, Username={Username}, " +
        $"Password={(Password.Length == 0 ? "" : "<redacted>")}, RootPath={RootPath})";
}

public sealed record RemoteFolder(string Name, string RelativePath);

internal sealed record RemoteNode(string Name, bool IsDirectory, long Size = 0, long ModifiedAt = 0);

internal sealed class RemoteRead(Stream stream, long totalLength) : IDisposable
{
    public Stream Stream { get; } = stream;
    public long TotalLength { get; } = totalLength;
    public void Dispose() => Stream.Dispose();
}

public static class RemotePaths
{
    private static readonly System.Text.RegularExpressions.Regex HostPattern = new("^[A-Za-z0-9._:-]+$");

    public static string? Validate(RemoteConnectionConfig config) => config.Protocol switch
    {
        RemoteProtocol.Smb when string.IsNullOrWhiteSpace(config.Host) => "サーバーを入力してください",
        RemoteProtocol.Smb when !HostPattern.IsMatch(config.Host.Trim()) => "サーバー名が正しくありません",
        RemoteProtocol.Smb when config.Port is < 1 or > 65_535 => "ポート番号は1〜65535で入力してください",
        RemoteProtocol.Smb when string.IsNullOrWhiteSpace(config.Share) => "共有名を入力してください",
        RemoteProtocol.Smb when config.Share.Contains('/') || config.Share.Contains('\\') => "共有名に / や \\ は使用できません",
        RemoteProtocol.Smb when config.Share.Trim() is "." or ".." => "共有名が正しくありません",
        RemoteProtocol.WebDav => ValidateWebDav(config.Endpoint),
        _ => null,
    };

    public static string NormalizeRelative(string path)
    {
        var value = path.Trim('/');
        if (value.Length == 0) return "";
        if (value.Contains('\\') || value.Contains('\0') || value.Split('/').Any(segment => segment == "." || segment.Any(char.IsControl))
            || !GraphValidator.IsSafeRelativePath(value))
            throw new ArgumentException("安全でないフォルダパスです", nameof(path));
        return value;
    }

    public static string Join(string left, string right) => string.Join('/',
        new[] { left.Trim('/'), right.Trim('/') }.Where(value => value.Length > 0));

    public static string NormalizeEndpoint(string value) => value.Trim().TrimEnd('/') + "/";

    public static bool IsSafeSegment(string value) => !string.IsNullOrWhiteSpace(value) && value is not "." and not ".."
        && !value.Any(character => character is '/' or '\\' or ':' or '\0' || char.IsControl(character));

    private static string? ValidateWebDav(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return "WebDAV URL が正しくありません";
        if (!uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return "WebDAV URL は https:// で入力してください";
        if (string.IsNullOrWhiteSpace(uri.Host)) return "WebDAV URL のホストがありません";
        if (!string.IsNullOrEmpty(uri.UserInfo)) return "ユーザー名とパスワードはURLではなく個別に入力してください";
        if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return "WebDAV URL にクエリやフラグメントは使用できません";
        return null;
    }
}

internal sealed class RemoteSourceManager
{
    private const string SmbRootPrefix = "yuraive+smb://";
    private const string WebDavRootPrefix = "yuraive+webdav://";
    private readonly EncryptedRemoteConfigStore _store;
    private readonly string _cacheRoot;
    private readonly HttpClient _httpClient;
    private readonly ConcurrentDictionary<string, RemoteConnectionConfig> _configs = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, RemoteListingCache> _listings = new(StringComparer.Ordinal);

    public RemoteSourceManager(AppDataPaths paths)
    {
        _store = new(paths.RemoteConnections);
        _cacheRoot = paths.RemoteCache;
        _httpClient = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(60),
        };
    }

    public bool IsRemoteRoot(string rootUri) => rootUri.StartsWith(SmbRootPrefix, StringComparison.Ordinal)
        || rootUri.StartsWith(WebDavRootPrefix, StringComparison.Ordinal);

    public IReadOnlyList<RemoteFolder> Browse(RemoteConnectionConfig config, string relativePath)
    {
        if (RemotePaths.Validate(config) is { } validation) throw new ArgumentException(validation);
        var normalized = RemotePaths.NormalizeRelative(relativePath);
        return Backend(config with { RootPath = "" }).List(normalized)
            .Where(node => node.IsDirectory)
            .Select(node => new RemoteFolder(node.Name, RemotePaths.Join(normalized, node.Name)))
            .OrderBy(folder => folder.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public RootGrant Save(RemoteConnectionConfig config, string selectedPath, string fallbackName)
    {
        if (RemotePaths.Validate(config) is { } validation) throw new ArgumentException(validation);
        var id = string.IsNullOrWhiteSpace(config.Id) ? Guid.NewGuid().ToString() : config.Id;
        var rootPath = RemotePaths.NormalizeRelative(selectedPath);
        var name = config.DisplayName.Trim();
        if (name.Length == 0) name = string.IsNullOrWhiteSpace(fallbackName) ? DefaultName(config, rootPath) : fallbackName.Trim();
        var saved = config with
        {
            Id = id,
            DisplayName = name,
            Endpoint = config.Protocol == RemoteProtocol.WebDav ? RemotePaths.NormalizeEndpoint(config.Endpoint) : "",
            Host = config.Host.Trim(),
            Share = config.Share.Trim(),
            Domain = config.Domain.Trim(),
            Username = config.Username.Trim(),
            RootPath = rootPath,
        };
        _store.Put(saved);
        _configs[id] = saved;
        return new RootGrant(RootUri(saved.Protocol, id), name);
    }

    public void Remove(string rootUri)
    {
        var id = RootId(rootUri);
        if (id is null) return;
        _configs.TryRemove(id, out _);
        _store.Remove(id);
        var directory = Path.Combine(_cacheRoot, id);
        try { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public void ClearListings() => _listings.Clear();

    public IReadOnlyList<RemoteNode> List(string rootUri, string relativePath)
    {
        var config = Config(rootUri);
        var normalized = RemotePaths.NormalizeRelative(relativePath);
        var cacheKey = $"{rootUri}::{normalized}";
        if (_listings.TryGetValue(cacheKey, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow) return cached.Nodes;
        var path = RemotePaths.Join(config.RootPath, normalized);
        var nodes = Backend(config).List(path);
        _listings[cacheKey] = new RemoteListingCache(DateTimeOffset.UtcNow.AddSeconds(8), nodes);
        return nodes;
    }

    public RemoteNode? Stat(string rootUri, string relativePath)
    {
        var normalized = RemotePaths.NormalizeRelative(relativePath);
        if (normalized.Length == 0) return new RemoteNode("", true);
        var parent = normalized.Contains('/') ? normalized[..normalized.LastIndexOf('/')] : "";
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        return List(rootUri, parent).FirstOrDefault(node => string.Equals(node.Name, name, StringComparison.Ordinal));
    }

    public RemoteRead Open(string rootUri, string relativePath, long offset = 0)
    {
        if (offset < 0) throw new ArgumentOutOfRangeException(nameof(offset));
        var config = Config(rootUri);
        var path = RemotePaths.Join(config.RootPath, RemotePaths.NormalizeRelative(relativePath));
        return Backend(config).Open(path, offset);
    }

    public string? CachedPath(string rootUri, string relativePath)
    {
        var node = Stat(rootUri, relativePath);
        if (node is null || node.IsDirectory) return null;
        var target = CacheTarget(rootUri, relativePath, node);
        return File.Exists(target) ? target : null;
    }

    public string Materialize(string rootUri, string relativePath, CancellationToken cancellationToken = default)
    {
        var path = RemotePaths.NormalizeRelative(relativePath);
        var node = Stat(rootUri, path) ?? throw new FileNotFoundException($"ファイルが見つかりません: {relativePath}");
        if (node.IsDirectory) throw new InvalidDataException($"ファイルではありません: {relativePath}");
        var target = CacheTarget(rootUri, path, node);
        if (File.Exists(target)) return target;
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temporary = $"{target}.{Guid.NewGuid():N}.tmp";
        try
        {
            using var read = Open(rootUri, path);
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
            {
                var buffer = new byte[64 * 1024];
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var count = read.Stream.Read(buffer, 0, buffer.Length);
                    if (count == 0) break;
                    output.Write(buffer, 0, count);
                }
                output.Flush(flushToDisk: true);
            }
            File.Move(temporary, target, overwrite: true);
            return target;
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private IRemoteBackend Backend(RemoteConnectionConfig config) => config.Protocol switch
    {
        RemoteProtocol.Smb => new SmbBackend(config),
        RemoteProtocol.WebDav => new WebDavBackend(config, _httpClient),
        _ => throw new ArgumentOutOfRangeException(nameof(config.Protocol)),
    };

    private RemoteConnectionConfig Config(string rootUri)
    {
        var id = RootId(rootUri) ?? throw new InvalidDataException("リモートフォルダIDが不正です");
        if (!_configs.TryGetValue(id, out var config))
        {
            config = _store.Get(id) ?? throw new InvalidDataException("接続情報が見つかりません。フォルダを追加し直してください");
            _configs[id] = config;
        }
        var protocol = rootUri.StartsWith(SmbRootPrefix, StringComparison.Ordinal) ? RemoteProtocol.Smb : RemoteProtocol.WebDav;
        if (config.Protocol != protocol) throw new InvalidDataException("リモートフォルダの種類が一致しません");
        return config;
    }

    private string CacheTarget(string rootUri, string path, RemoteNode node)
    {
        var id = RootId(rootUri) ?? throw new InvalidDataException("リモートフォルダIDが不正です");
        var suffix = Path.GetExtension(path);
        if (suffix.Length > 9 || suffix.Skip(1).Any(character => !char.IsLetterOrDigit(character))) suffix = "";
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{rootUri}\n{path}\n{node.ModifiedAt}\n{node.Size}"))).ToLowerInvariant();
        return Path.Combine(_cacheRoot, id, digest + suffix);
    }

    private static string RootUri(RemoteProtocol protocol, string id) => protocol == RemoteProtocol.Smb
        ? SmbRootPrefix + id : WebDavRootPrefix + id;

    private static string? RootId(string rootUri)
    {
        var id = rootUri.StartsWith(SmbRootPrefix, StringComparison.Ordinal) ? rootUri[SmbRootPrefix.Length..]
            : rootUri.StartsWith(WebDavRootPrefix, StringComparison.Ordinal) ? rootUri[WebDavRootPrefix.Length..] : null;
        return id is not null && id.Length is > 0 and <= 80 && id.All(character => char.IsAsciiLetterOrDigit(character) || character == '-') ? id : null;
    }

    private static string DefaultName(RemoteConnectionConfig config, string path) => path.Split('/').LastOrDefault() is { Length: > 0 } value
        ? value : config.Protocol == RemoteProtocol.Smb ? config.Share : new Uri(config.Endpoint).Host;

    private sealed record RemoteListingCache(DateTimeOffset ExpiresAt, IReadOnlyList<RemoteNode> Nodes);
}

internal interface IRemoteBackend
{
    IReadOnlyList<RemoteNode> List(string relativePath);
    RemoteRead Open(string relativePath, long offset = 0);
}

internal sealed class SmbBackend(RemoteConnectionConfig config) : IRemoteBackend
{
    public IReadOnlyList<RemoteNode> List(string relativePath)
    {
        try
        {
            using var resources = Connect();
            var path = SmbPath(relativePath);
            var status = resources.Store.CreateFile(out var handle, out _, path,
                (AccessMask)DirectoryAccessMask.FILE_LIST_DIRECTORY | (AccessMask)DirectoryAccessMask.FILE_READ_ATTRIBUTES | AccessMask.SYNCHRONIZE,
                0, ShareAccess.Read | ShareAccess.Write | ShareAccess.Delete, CreateDisposition.FILE_OPEN,
                CreateOptions.FILE_SYNCHRONOUS_IO_NONALERT | CreateOptions.FILE_DIRECTORY_FILE, null);
            Ensure(status, "SMBフォルダを開けません");
            try
            {
                status = resources.Store.QueryDirectory(out var entries, handle, "*", FileInformationClass.FileDirectoryInformation);
                if (status is not NTStatus.STATUS_SUCCESS and not NTStatus.STATUS_NO_MORE_FILES) Ensure(status, "SMBフォルダの一覧を取得できません");
                return entries.OfType<FileDirectoryInformation>()
                    .Where(entry => RemotePaths.IsSafeSegment(entry.FileName))
                    .Select(entry => new RemoteNode(
                        entry.FileName,
                        (entry.FileAttributes & SmbFileAttributes.Directory) != 0,
                        Math.Max(0, entry.EndOfFile),
                        Math.Max(0, new DateTimeOffset(entry.LastWriteTime).ToUnixTimeMilliseconds())))
                    .ToList();
            }
            finally { resources.Store.CloseFile(handle); }
        }
        catch (Exception error) when (error is not IOException)
        {
            throw new IOException("SMB共有に接続できません", error);
        }
    }

    public RemoteRead Open(string relativePath, long offset = 0)
    {
        SmbResources? resources = null;
        try
        {
            resources = Connect();
            var status = resources.Store.CreateFile(out var handle, out _, SmbPath(relativePath),
                AccessMask.GENERIC_READ | AccessMask.SYNCHRONIZE, SmbFileAttributes.Normal,
                ShareAccess.Read | ShareAccess.Write | ShareAccess.Delete, CreateDisposition.FILE_OPEN,
                CreateOptions.FILE_SYNCHRONOUS_IO_NONALERT | CreateOptions.FILE_NON_DIRECTORY_FILE, null);
            Ensure(status, "SMBファイルを開けません");
            status = resources.Store.GetFileInformation(out var information, handle, FileInformationClass.FileStandardInformation);
            Ensure(status, "SMBファイル情報を取得できません");
            var length = ((FileStandardInformation)information).EndOfFile;
            var stream = new SmbReadStream(resources, handle, length);
            stream.Position = Math.Min(offset, length);
            resources = null;
            return new RemoteRead(stream, length);
        }
        finally { resources?.Dispose(); }
    }

    private SmbResources Connect()
    {
        var client = new PortSmb2Client(15_000, enableSmb311Support: true);
        try
        {
            if (!client.Connect(config.Host, config.Port)) throw new IOException("SMBサーバーに接続できません");
            var status = client.Login(config.Domain, config.Username, config.Password);
            if (status != NTStatus.STATUS_SUCCESS) throw new IOException(status is NTStatus.STATUS_LOGON_FAILURE or NTStatus.STATUS_ACCESS_DENIED
                ? "SMBの認証に失敗しました" : $"SMBにログインできません ({status})");
            var store = client.TreeConnect(config.Share, out status);
            Ensure(status, "SMB共有を開けません");
            return new SmbResources(client, store);
        }
        catch { client.Disconnect(); throw; }
    }

    private static string SmbPath(string value) => RemotePaths.NormalizeRelative(value).Replace('/', '\\');

    private static void Ensure(NTStatus status, string message)
    {
        if (status != NTStatus.STATUS_SUCCESS) throw new IOException($"{message} ({status})");
    }
}

internal sealed class PortSmb2Client(int timeoutMs, bool enableSmb311Support) : SMB2Client(timeoutMs, enableSmb311Support)
{
    public bool Connect(string host, int port)
    {
        var addresses = Dns.GetHostAddresses(host);
        var address = addresses.FirstOrDefault(value => value.AddressFamily == AddressFamily.InterNetwork) ?? addresses.FirstOrDefault()
            ?? throw new IOException("SMBサーバー名を解決できません");
        return Connect(address, SMBTransportType.DirectTCPTransport, port);
    }
}

internal sealed class SmbResources(PortSmb2Client client, ISMBFileStore store) : IDisposable
{
    public PortSmb2Client Client { get; } = client;
    public ISMBFileStore Store { get; } = store;
    public void Dispose()
    {
        try { Store.Disconnect(); } catch { }
        try { Client.Logoff(); } catch { }
        try { Client.Disconnect(); } catch { }
    }
}

internal sealed class SmbReadStream(SmbResources resources, object handle, long length) : Stream
{
    private long _position;
    private bool _disposed;
    public override bool CanRead => !_disposed;
    public override bool CanSeek => !_disposed;
    public override bool CanWrite => false;
    public override long Length => length;
    public override long Position { get => _position; set => Seek(value, SeekOrigin.Begin); }
    public override void Flush() { }

    public override int Read(byte[] buffer, int offset, int count)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_position >= length) return 0;
        var requested = (int)Math.Min(Math.Min(count, resources.Store.MaxReadSize), length - _position);
        var status = resources.Store.ReadFile(out var data, handle, _position, requested);
        if (status == NTStatus.STATUS_END_OF_FILE) return 0;
        if (status != NTStatus.STATUS_SUCCESS) throw new IOException($"SMBファイルを読み込めません ({status})");
        var read = Math.Min(data?.Length ?? 0, count);
        if (read > 0) Buffer.BlockCopy(data!, 0, buffer, offset, read);
        _position += read;
        return read;
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
        var target = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => _position + offset, SeekOrigin.End => length + offset, _ => -1 };
        if (target < 0 || target > length) throw new IOException("ファイルの読み込み位置が不正です");
        return _position = target;
    }

    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            try { resources.Store.CloseFile(handle); } finally { resources.Dispose(); }
        }
        base.Dispose(disposing);
    }
}

internal sealed class WebDavBackend(RemoteConnectionConfig config, HttpClient client) : IRemoteBackend
{
    private const int MaxXmlBytes = 4 * 1024 * 1024;
    private const string PropFindBody = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>";
    private readonly string _endpoint = RemotePaths.NormalizeEndpoint(config.Endpoint);

    public IReadOnlyList<RemoteNode> List(string relativePath)
    {
        var requested = RemotePaths.NormalizeRelative(relativePath);
        using var request = Request(HttpMethod.Parse("PROPFIND"), Url(requested, directory: true));
        request.Headers.Add("Depth", "1");
        request.Content = new StringContent(PropFindBody, Encoding.UTF8, "application/xml");
        using var response = client.Send(request, HttpCompletionOption.ResponseHeadersRead);
        CheckResponse(response, "フォルダ一覧を取得できません");
        using var input = response.Content.ReadAsStream();
        using var limited = new MemoryStream();
        CopyLimited(input, limited, MaxXmlBytes, "WebDAVの応答が大きすぎます");
        limited.Position = 0;
        return ParseListing(limited, requested);
    }

    public RemoteRead Open(string relativePath, long offset = 0)
    {
        var request = Request(HttpMethod.Get, Url(RemotePaths.NormalizeRelative(relativePath), directory: false));
        if (offset > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
        var response = client.Send(request, HttpCompletionOption.ResponseHeadersRead);
        try
        {
            CheckResponse(response, "ファイルを開けません");
            var responseLength = response.Content.Headers.ContentLength ?? 0;
            var stream = response.Content.ReadAsStream();
            long length;
            if (offset > 0 && response.StatusCode != HttpStatusCode.PartialContent)
            {
                length = responseLength;
                Skip(stream, offset);
            }
            else
            {
                length = response.Content.Headers.ContentRange?.Length ?? offset + responseLength;
            }
            return new RemoteRead(new ResponseStream(stream, response), length);
        }
        catch { response.Dispose(); throw; }
    }

    private static void Skip(Stream stream, long count)
    {
        var buffer = new byte[64 * 1024];
        while (count > 0)
        {
            var read = stream.Read(buffer, 0, (int)Math.Min(buffer.Length, count));
            if (read == 0) break;
            count -= read;
        }
    }

    private HttpRequestMessage Request(HttpMethod method, string url)
    {
        var request = new HttpRequestMessage(method, url);
        if (config.Username.Length > 0 || config.Password.Length > 0)
        {
            var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{config.Username}:{config.Password}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        }
        return request;
    }

    private string Url(string relativePath, bool directory)
    {
        var encoded = string.Join('/', RemotePaths.NormalizeRelative(relativePath).Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.EscapeDataString));
        return _endpoint + encoded + (directory && encoded.Length > 0 ? "/" : "");
    }

    private IReadOnlyList<RemoteNode> ParseListing(Stream stream, string requestedPath)
    {
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxXmlBytes });
        var document = XDocument.Load(reader, LoadOptions.None);
        XNamespace dav = "DAV:";
        var endpointUri = new Uri(_endpoint);
        var endpointSegments = DecodeSegments(endpointUri.AbsolutePath);
        var requestedSegments = requestedPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var requestUri = new Uri(Url(requestedPath, directory: true));
        var result = new Dictionary<string, RemoteNode>(StringComparer.Ordinal);
        foreach (var response in document.Descendants(dav + "response"))
        {
            var href = response.Descendants(dav + "href").FirstOrDefault()?.Value.Trim();
            if (string.IsNullOrEmpty(href) || !Uri.TryCreate(requestUri, href, out var absolute)) continue;
            if (!absolute.Scheme.Equals(endpointUri.Scheme, StringComparison.OrdinalIgnoreCase)
                || !absolute.Host.Equals(endpointUri.Host, StringComparison.OrdinalIgnoreCase)
                || absolute.Port != endpointUri.Port) continue;
            string[] segments;
            try { segments = DecodeSegments(absolute.AbsolutePath); } catch { continue; }
            if (!segments.Take(endpointSegments.Length).SequenceEqual(endpointSegments, StringComparer.Ordinal)) continue;
            var relative = segments.Skip(endpointSegments.Length).ToArray();
            if (relative.Length != requestedSegments.Length + 1
                || !relative.Take(requestedSegments.Length).SequenceEqual(requestedSegments, StringComparer.Ordinal)) continue;
            var name = relative[^1];
            if (!RemotePaths.IsSafeSegment(name)) continue;
            var properties = response.Elements(dav + "propstat").FirstOrDefault(propStat =>
            {
                var status = propStat.Element(dav + "status")?.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries).ElementAtOrDefault(1);
                return int.TryParse(status, out var code) && code is >= 200 and < 300;
            })?.Element(dav + "prop");
            if (properties is null) continue;
            var directory = properties.Descendants(dav + "collection").Any();
            _ = long.TryParse(properties.Element(dav + "getcontentlength")?.Value.Trim(), out var size);
            var modified = DateTimeOffset.TryParse(properties.Element(dav + "getlastmodified")?.Value.Trim(), out var timestamp)
                ? timestamp.ToUnixTimeMilliseconds() : 0;
            result[name] = new RemoteNode(name, directory, Math.Max(0, size), Math.Max(0, modified));
        }
        return result.Values.ToList();
    }

    private static string[] DecodeSegments(string path) => path.Split('/', StringSplitOptions.RemoveEmptyEntries)
        .Select(segment => Uri.UnescapeDataString(segment))
        .Select(segment => segment is "." or ".." || segment.Contains('/') || segment.Contains('\\')
            ? throw new InvalidDataException("WebDAVのパスが不正です") : segment)
        .ToArray();

    private static void CheckResponse(HttpResponseMessage response, string message)
    {
        if (response.IsSuccessStatusCode) return;
        throw new IOException(response.StatusCode switch
        {
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "認証に失敗しました",
            HttpStatusCode.NotFound => "パスが見つかりません",
            _ => $"{message} (HTTP {(int)response.StatusCode})",
        });
    }

    private static void CopyLimited(Stream input, Stream output, int maximum, string message)
    {
        var buffer = new byte[16 * 1024];
        var total = 0;
        while (true)
        {
            var count = input.Read(buffer, 0, buffer.Length);
            if (count == 0) return;
            total += count;
            if (total > maximum) throw new InvalidDataException(message);
            output.Write(buffer, 0, count);
        }
    }
}

internal sealed class ResponseStream(Stream inner, HttpResponseMessage response) : Stream
{
    public override bool CanRead => inner.CanRead;
    public override bool CanSeek => inner.CanSeek;
    public override bool CanWrite => false;
    public override long Length => inner.Length;
    public override long Position { get => inner.Position; set => inner.Position = value; }
    public override void Flush() => inner.Flush();
    public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
    public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing)
    {
        if (disposing) { inner.Dispose(); response.Dispose(); }
        base.Dispose(disposing);
    }
}

internal sealed class EncryptedRemoteConfigStore
{
    private static readonly byte[] Entropy = "Yuraive remote connections v1"u8.ToArray();
    private readonly string _path;
    private readonly object _gate = new();

    public EncryptedRemoteConfigStore(string path) => _path = path;

    public void Put(RemoteConnectionConfig config)
    {
        lock (_gate)
        {
            var values = ReadAll();
            values[config.Id] = Convert.ToBase64String(Dpapi.Protect(Encoding.UTF8.GetBytes(YuraiveJson.Serialize(config)), Entropy));
            WriteAll(values);
        }
    }

    public RemoteConnectionConfig? Get(string id)
    {
        lock (_gate)
        {
            try
            {
                var values = ReadAll();
                return values.TryGetValue(id, out var encoded)
                    ? YuraiveJson.Deserialize<RemoteConnectionConfig>(Encoding.UTF8.GetString(Dpapi.Unprotect(Convert.FromBase64String(encoded), Entropy)))
                    : null;
            }
            catch { return null; }
        }
    }

    public void Remove(string id)
    {
        lock (_gate)
        {
            var values = ReadAll();
            if (values.Remove(id)) WriteAll(values);
        }
    }

    private Dictionary<string, string> ReadAll()
    {
        try { return File.Exists(_path) ? YuraiveJson.Deserialize<Dictionary<string, string>>(File.ReadAllText(_path)) : new(StringComparer.Ordinal); }
        catch { return new(StringComparer.Ordinal); }
    }

    private void WriteAll(Dictionary<string, string> values)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(temporary, YuraiveJson.Serialize(values), new UTF8Encoding(false));
            File.Move(temporary, _path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

internal static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public int Length; public IntPtr Data; }

    [DllImport("Crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input, string? description, ref DataBlob entropy, IntPtr reserved,
        IntPtr prompt, int flags, out DataBlob output);

    [DllImport("Crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, ref DataBlob entropy, IntPtr reserved,
        IntPtr prompt, int flags, out DataBlob output);

    [DllImport("Kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static byte[] Protect(byte[] value, byte[] entropy) => Transform(value, entropy, protect: true);
    public static byte[] Unprotect(byte[] value, byte[] entropy) => Transform(value, entropy, protect: false);

    private static byte[] Transform(byte[] value, byte[] entropy, bool protect)
    {
        var input = Blob(value);
        var optional = Blob(entropy);
        DataBlob output = default;
        try
        {
            var success = protect
                ? CryptProtectData(ref input, null, ref optional, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref input, IntPtr.Zero, ref optional, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!success) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "接続情報を暗号化できません");
            var result = new byte[output.Length];
            Marshal.Copy(output.Data, result, 0, result.Length);
            return result;
        }
        finally
        {
            if (input.Data != IntPtr.Zero) Marshal.FreeHGlobal(input.Data);
            if (optional.Data != IntPtr.Zero) Marshal.FreeHGlobal(optional.Data);
            if (output.Data != IntPtr.Zero) LocalFree(output.Data);
        }
    }

    private static DataBlob Blob(byte[] value)
    {
        var pointer = Marshal.AllocHGlobal(value.Length);
        Marshal.Copy(value, 0, pointer, value.Length);
        return new DataBlob { Length = value.Length, Data = pointer };
    }
}
