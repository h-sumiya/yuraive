using System.Runtime.InteropServices;
using System.Text.Json;
using Yuraive.Core.Models;

namespace Yuraive.Core.Interop;

public static class NativeRuntime
{
    private const string LibraryName = "yuraive_runtime";

    public static IReadOnlyList<ValidationIssue> ValidateJson(string json)
    {
        var output = Call(json, NativeMethods.ValidateJson);
        var native = YuraiveJson.Deserialize<List<NativeValidationIssue>>(output);
        return native.Select(issue => new ValidationIssue(
            string.Equals(issue.Severity, "WARNING", StringComparison.Ordinal)
                ? ValidationSeverity.Warning
                : ValidationSeverity.Error,
            issue.Message,
            issue.Path)).ToList();
    }

    public static MetadataPrefixResult ExtractMetadataPrefix(string prefix) =>
        YuraiveJson.Deserialize<MetadataPrefixResult>(Call(prefix, NativeMethods.ExtractMetadataPrefix));

    public static JsonElement RunStarlark(JsonElement request)
    {
        var output = Call(request.GetRawText(), NativeMethods.RunStarlarkJson);
        using var document = JsonDocument.Parse(output);
        return document.RootElement.Clone();
    }

    public static string RunStarlarkJson(string requestJson) =>
        Call(requestJson, NativeMethods.RunStarlarkJson);

    public static DecodedBundle DecodeBundle(byte[] input)
    {
        var result = YuraiveJson.Deserialize<BundleDecodeResult>(Call(input, NativeMethods.DecodeBundle));
        if (!string.IsNullOrWhiteSpace(result.Error)) throw new InvalidDataException(result.Error);
        if (result.BundleVersion != 1 || result.GraphJson is null) throw new InvalidDataException("Yuraiveバンドルの内容が不正です");
        return new DecodedBundle(result.BundleVersion, result.GraphJson, result.TextAssets);
    }

    public static NativeLayoutResponse ResolveButtonLayout(
        string source,
        IReadOnlyList<RenderedButton> buttons,
        NativeLayoutCanvas canvas)
    {
        var request = JsonSerializer.Serialize(new { source, buttons, canvas }, YuraiveJson.Options);
        return YuraiveJson.Deserialize<NativeLayoutResponse>(Call(request, NativeMethods.ResolveButtonLayoutJson));
    }

    public static P2pCertificateIdentity CreateP2pIdentity() =>
        Result<P2pCertificateIdentity>(Call(NativeMethods.P2pCreateIdentity));

    public static ulong StartP2pHost(P2pHostConfig config) =>
        Result<ulong>(Call(YuraiveJson.Serialize(config), NativeMethods.P2pHostCreate));

    public static P2pHostSnapshot P2pHostStatus(ulong handle) =>
        YuraiveJson.Deserialize<P2pHostSnapshot>(Call(handle, NativeMethods.P2pHostStatus));

    public static P2pProviderRequest? PollP2pHost(ulong handle, uint timeoutMs)
    {
        var output = Call(handle, timeoutMs, NativeMethods.P2pHostPoll);
        return output.Length == 0 ? null : YuraiveJson.Deserialize<P2pProviderRequest>(output);
    }

    public static bool RespondP2pHostJson(ulong handle, ulong requestId, string json) =>
        NativeMethods.P2pHostRespondJson(handle, requestId, json);

    public static bool RespondP2pHostBytes(ulong handle, ulong requestId, long totalSize, byte[] data) =>
        NativeMethods.P2pHostRespondBytes(handle, requestId, checked((ulong)totalSize), data, (nuint)data.Length);

    public static bool RespondP2pHostError(ulong handle, ulong requestId, string message) =>
        NativeMethods.P2pHostRespondError(handle, requestId, message);

    public static void CloseP2pHost(ulong handle) => NativeMethods.P2pHostClose(handle);

    private static T Result<T>(string json)
    {
        var result = YuraiveJson.Deserialize<NativeResult<T>>(json);
        if (!string.IsNullOrWhiteSpace(result.Error)) throw new InvalidOperationException(result.Error);
        return result.Value is not null
            ? result.Value
            : throw new InvalidOperationException("Rust P2Pランタイムから結果を取得できません");
    }

    private static string Call(string input, Func<string, nint> operation)
    {
        nint pointer = 0;
        try
        {
            pointer = operation(input);
            if (pointer == 0) throw new InvalidOperationException("Rustランタイムから結果を取得できません");
            return Marshal.PtrToStringUTF8(pointer)
                ?? throw new InvalidOperationException("Rustランタイムの結果がUTF-8ではありません");
        }
        finally
        {
            if (pointer != 0) NativeMethods.StringFree(pointer);
        }
    }

    private static string Call(Func<nint> operation)
    {
        nint pointer = 0;
        try
        {
            pointer = operation();
            if (pointer == 0) throw new InvalidOperationException("Rustランタイムから結果を取得できません");
            return Marshal.PtrToStringUTF8(pointer)
                ?? throw new InvalidOperationException("Rustランタイムの結果がUTF-8ではありません");
        }
        finally
        {
            if (pointer != 0) NativeMethods.StringFree(pointer);
        }
    }

    private static string Call(byte[] input, Func<byte[], nuint, nint> operation)
    {
        nint pointer = 0;
        try
        {
            pointer = operation(input, (nuint)input.Length);
            if (pointer == 0) throw new InvalidOperationException("Rustランタイムから結果を取得できません");
            return Marshal.PtrToStringUTF8(pointer)
                ?? throw new InvalidOperationException("Rustランタイムの結果がUTF-8ではありません");
        }
        finally
        {
            if (pointer != 0) NativeMethods.StringFree(pointer);
        }
    }

    private static string Call(ulong handle, Func<ulong, nint> operation)
    {
        nint pointer = 0;
        try
        {
            pointer = operation(handle);
            if (pointer == 0) throw new InvalidOperationException("Rustランタイムから結果を取得できません");
            return Marshal.PtrToStringUTF8(pointer)
                ?? throw new InvalidOperationException("Rustランタイムの結果がUTF-8ではありません");
        }
        finally
        {
            if (pointer != 0) NativeMethods.StringFree(pointer);
        }
    }

    private static string Call(ulong handle, uint timeoutMs, Func<ulong, uint, nint> operation)
    {
        nint pointer = 0;
        try
        {
            pointer = operation(handle, timeoutMs);
            if (pointer == 0) throw new InvalidOperationException("Rustランタイムから結果を取得できません");
            return Marshal.PtrToStringUTF8(pointer)
                ?? throw new InvalidOperationException("Rustランタイムの結果がUTF-8ではありません");
        }
        finally
        {
            if (pointer != 0) NativeMethods.StringFree(pointer);
        }
    }

    private static class NativeMethods
    {
        [DllImport(LibraryName, EntryPoint = "yuraive_validate_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ValidateJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "yuraive_extract_metadata_prefix", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ExtractMetadataPrefix([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "yuraive_run_starlark_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint RunStarlarkJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "yuraive_resolve_button_layout_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ResolveButtonLayoutJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "yuraive_decode_bundle", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint DecodeBundle([In] byte[] input, nuint length);

        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_create_identity", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint P2pCreateIdentity();

        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_create", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint P2pHostCreate([MarshalAs(UnmanagedType.LPUTF8Str)] string config);

        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_status", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint P2pHostStatus(ulong handle);

        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_poll", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint P2pHostPoll(ulong handle, uint timeoutMs);

        [return: MarshalAs(UnmanagedType.I1)]
        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_respond_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern bool P2pHostRespondJson(ulong handle, ulong requestId, [MarshalAs(UnmanagedType.LPUTF8Str)] string json);

        [return: MarshalAs(UnmanagedType.I1)]
        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_respond_bytes", CallingConvention = CallingConvention.Cdecl)]
        internal static extern bool P2pHostRespondBytes(ulong handle, ulong requestId, ulong totalSize, [In] byte[] data, nuint length);

        [return: MarshalAs(UnmanagedType.I1)]
        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_respond_error", CallingConvention = CallingConvention.Cdecl)]
        internal static extern bool P2pHostRespondError(ulong handle, ulong requestId, [MarshalAs(UnmanagedType.LPUTF8Str)] string message);

        [DllImport(LibraryName, EntryPoint = "yuraive_p2p_host_close", CallingConvention = CallingConvention.Cdecl)]
        internal static extern void P2pHostClose(ulong handle);

        [DllImport(LibraryName, EntryPoint = "yuraive_string_free", CallingConvention = CallingConvention.Cdecl)]
        internal static extern void StringFree(nint value);
    }

    private sealed record NativeValidationIssue
    {
        public required string Severity { get; init; }
        public required string Message { get; init; }
        public string? Path { get; init; }
    }

    private sealed record BundleDecodeResult
    {
        public int BundleVersion { get; init; }
        public string? GraphJson { get; init; }
        public Dictionary<string, BundledTextAsset> TextAssets { get; init; } = new(StringComparer.Ordinal);
        public string? Error { get; init; }
    }

    private sealed record NativeResult<T>
    {
        public T? Value { get; init; }
        public string? Error { get; init; }
    }
}

public sealed record P2pCertificateIdentity
{
    public required string Certificate { get; init; }
    public required string PrivateKey { get; init; }
    public required string Fingerprint { get; init; }
}

public sealed record P2pHostConfig
{
    public required string Endpoint { get; init; }
    public required string Room { get; init; }
    public required string Secret { get; init; }
    public required string CacheDirectory { get; init; }
    public required string Certificate { get; init; }
    public required string PrivateKey { get; init; }
    public required string Fingerprint { get; init; }
}

public sealed record P2pHostSnapshot
{
    public required string State { get; init; }
    public string? Detail { get; init; }
    public ulong Sequence { get; init; }
    public string? LocalAddress { get; init; }
    public string? RemoteAddress { get; init; }
    public ulong? RttMs { get; init; }
    public ulong BytesSent { get; init; }
    public ulong BytesReceived { get; init; }
    public IReadOnlyList<P2pCandidate> LocalCandidates { get; init; } = [];
    public IReadOnlyList<P2pCandidate> RemoteCandidates { get; init; } = [];
    public P2pCandidate? SelectedCandidate { get; init; }
}

public sealed record P2pCandidate
{
    public required string Kind { get; init; }
    public required string Address { get; init; }
}

public sealed record P2pProviderRequest
{
    public ulong Id { get; init; }
    public required string Method { get; init; }
    public string? RootId { get; init; }
    public string? Path { get; init; }
    public ulong? Offset { get; init; }
    public uint? Count { get; init; }
}

public sealed record DecodedBundle(int BundleVersion, string GraphJson, IReadOnlyDictionary<string, BundledTextAsset> TextAssets);

public sealed record BundledTextAsset
{
    public required string Kind { get; init; }
    public required string Content { get; init; }
}

public sealed record GraphMetadataPreview
{
    public string? DisplayName { get; init; }
    public string? Author { get; init; }
    public string? Thumbnail { get; init; }
}

public sealed record MetadataPrefixResult
{
    public required string Status { get; init; }
    public GraphMetadataPreview? Metadata { get; init; }
    public string? Error { get; init; }
}
