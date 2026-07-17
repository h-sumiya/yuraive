using Xunit;
using Yuraive.Core.Bridge;
using Yuraive.Core.Storage;

namespace Yuraive.Core.Tests;

public sealed class WindowsLibraryBridgeHostTests
{
    [Fact]
    public async Task RegeneratePairing_RotatesCredentialsButKeepsDeviceIdentity()
    {
        using var temporary = new TemporaryDirectory();
        var paths = new AppDataPaths(temporary.Combine("state"));
        await using var bridge = new WindowsLibraryBridgeHost(new DocumentLibrary(paths), paths);
        var before = bridge.Identity;

        await bridge.RegeneratePairingAsync();

        var after = bridge.Identity;
        Assert.NotEqual(before.Room, after.Room);
        Assert.NotEqual(before.Secret, after.Secret);
        Assert.NotEqual(before.Fingerprint, after.Fingerprint);
        Assert.Equal(before.DeviceId, after.DeviceId);
        Assert.Equal(before.DeviceName, after.DeviceName);
        Assert.Contains("v=2", bridge.PairingUri, StringComparison.Ordinal);
        Assert.Contains($"pin={after.Fingerprint}", bridge.PairingUri, StringComparison.Ordinal);
    }
}
