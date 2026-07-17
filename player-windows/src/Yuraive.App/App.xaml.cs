using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Windows.ApplicationModel.Activation;
using Windows.Storage;

namespace Yuraive.App;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, args) =>
        {
            System.Diagnostics.Debug.WriteLine(args.Exception);
        };
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        var activatedFilePath = activation.Kind == ExtendedActivationKind.File
            && activation.Data is FileActivatedEventArgs fileArgs
            ? fileArgs.Files.OfType<StorageFile>().FirstOrDefault()?.Path
            : null;

        _window = new MainWindow(activatedFilePath);
        _window.Activate();
    }
}
