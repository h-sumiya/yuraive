using System.Runtime.InteropServices;
using System.Text.Json;
using WmgfPlayer.Core.Models;

namespace WmgfPlayer.Core.Interop;

public static class NativeRuntime
{
    private const string LibraryName = "wmgf_runtime";

    public static IReadOnlyList<ValidationIssue> ValidateJson(string json)
    {
        var output = Call(json, NativeMethods.ValidateJson);
        var native = WmgJson.Deserialize<List<NativeValidationIssue>>(output);
        return native.Select(issue => new ValidationIssue(
            string.Equals(issue.Severity, "WARNING", StringComparison.Ordinal)
                ? ValidationSeverity.Warning
                : ValidationSeverity.Error,
            issue.Message,
            issue.Path)).ToList();
    }

    public static MetadataPrefixResult ExtractMetadataPrefix(string prefix) =>
        WmgJson.Deserialize<MetadataPrefixResult>(Call(prefix, NativeMethods.ExtractMetadataPrefix));

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
        var result = WmgJson.Deserialize<BundleDecodeResult>(Call(input, NativeMethods.DecodeBundle));
        if (!string.IsNullOrWhiteSpace(result.Error)) throw new InvalidDataException(result.Error);
        if (result.BundleVersion != 1 || result.GraphJson is null) throw new InvalidDataException("WMGFバンドルの内容が不正です");
        return new DecodedBundle(result.BundleVersion, result.GraphJson, result.TextAssets);
    }

    public static NativeLayoutResponse ResolveButtonLayout(
        string source,
        IReadOnlyList<RenderedButton> buttons,
        NativeLayoutCanvas canvas)
    {
        var request = JsonSerializer.Serialize(new { source, buttons, canvas }, WmgJson.Options);
        return WmgJson.Deserialize<NativeLayoutResponse>(Call(request, NativeMethods.ResolveButtonLayoutJson));
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

    private static class NativeMethods
    {
        [DllImport(LibraryName, EntryPoint = "wmgf_validate_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ValidateJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "wmgf_extract_metadata_prefix", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ExtractMetadataPrefix([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "wmgf_run_starlark_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint RunStarlarkJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "wmgf_resolve_button_layout_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint ResolveButtonLayoutJson([MarshalAs(UnmanagedType.LPUTF8Str)] string input);

        [DllImport(LibraryName, EntryPoint = "wmgf_decode_bundle", CallingConvention = CallingConvention.Cdecl)]
        internal static extern nint DecodeBundle([In] byte[] input, nuint length);

        [DllImport(LibraryName, EntryPoint = "wmgf_string_free", CallingConvention = CallingConvention.Cdecl)]
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
