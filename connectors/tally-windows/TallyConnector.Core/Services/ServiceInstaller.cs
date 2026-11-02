using System.Diagnostics;
using System.Text.RegularExpressions;

namespace TallyConnector.Core.Services;

public enum ServiceRuntimeState
{
    Missing,
    Stopped,
    StartPending,
    StopPending,
    Running,
    Unknown,
}

public sealed class ServiceInstaller
{
    private const int CopyRetryCount = 12;
    private static readonly TimeSpan CopyRetryDelay = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan ServiceStateTimeout = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan ServiceStopGracePeriod = TimeSpan.FromSeconds(15);

    private readonly string _profileId;
    private readonly string _profileName;

    public ServiceInstaller(string? profileId = null, string? profileName = null)
    {
        _profileId = ConnectorPaths.NormalizeProfileId(profileId);
        _profileName = string.IsNullOrWhiteSpace(profileName)
            ? (_profileId == ConnectorPaths.DefaultProfileId ? "Default profile" : _profileId)
            : profileName.Trim();
    }

    public string ServiceName => ConnectorMetadata.BuildServiceName(_profileId);

    public string ServiceDisplayName => ConnectorMetadata.BuildServiceDisplayName(_profileId, _profileName);

    public string InstallDirectory =>
        _profileId == ConnectorPaths.DefaultProfileId
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Bizgenix",
                "TallyConnector")
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Bizgenix",
                "TallyConnector",
                "profiles",
                _profileId);

    public string ServiceExecutablePath => Path.Combine(InstallDirectory, "TallyConnector.Service.exe");

    private string ServiceCommandLine =>
        _profileId == ConnectorPaths.DefaultProfileId
            ? $"\"{ServiceExecutablePath}\""
            : $"\"{ServiceExecutablePath}\" --profile \"{_profileId}\"";

    public async Task InstallOrUpdateAsync(CancellationToken cancellationToken)
    {
        string payloadDirectory = ResolvePayloadDirectory();
        bool exists = await ServiceExistsAsync(cancellationToken);
        if (exists)
        {
            await StopServiceIfNeededAsync(cancellationToken);
        }

        CopyDirectory(payloadDirectory, InstallDirectory);

        if (exists)
        {
            await RunScAsync(BuildConfigArguments(), allowFailure: false, cancellationToken);
        }
        else
        {
            await RunScAsync(BuildCreateArguments(), allowFailure: false, cancellationToken);
            await RunScAsync(
                ["description", ServiceName, "Pairs once and syncs Tally data to Growth Intelligence."],
                allowFailure: true,
                cancellationToken);
        }

        await StartServiceAndWaitAsync(cancellationToken);
    }

    public async Task<bool> ServiceExistsAsync(CancellationToken cancellationToken)
    {
        ServiceRuntimeState state = await GetServiceStateAsync(cancellationToken);
        return state != ServiceRuntimeState.Missing;
    }

    public async Task UninstallAsync(bool removeFiles, CancellationToken cancellationToken)
    {
        bool exists = await ServiceExistsAsync(cancellationToken);
        if (exists)
        {
            await StopServiceIfNeededAsync(cancellationToken);
            await RunScAsync(["delete", ServiceName], allowFailure: true, cancellationToken);
        }

        if (removeFiles)
        {
            DeleteInstallDirectory();
        }
    }

    public async Task<ServiceRuntimeState> GetServiceStateAsync(CancellationToken cancellationToken)
    {
        ScResult result = await RunScCaptureAsync(["query", ServiceName], allowFailure: true, cancellationToken);
        if (result.ExitCode != 0)
        {
            string detail = $"{result.Output} {result.Error}";
            if (detail.Contains("does not exist", StringComparison.OrdinalIgnoreCase))
            {
                return ServiceRuntimeState.Missing;
            }

            return ServiceRuntimeState.Unknown;
        }

        return ParseServiceState(result.Output);
    }

    public static string DescribeState(ServiceRuntimeState state) =>
        state switch
        {
            ServiceRuntimeState.Missing => "not installed",
            ServiceRuntimeState.Stopped => "stopped",
            ServiceRuntimeState.StartPending => "starting",
            ServiceRuntimeState.StopPending => "stopping",
            ServiceRuntimeState.Running => "running",
            _ => "unknown",
        };

    private async Task StopServiceIfNeededAsync(CancellationToken cancellationToken)
    {
        ServiceRuntimeState state = await GetServiceStateAsync(cancellationToken);
        if (state is ServiceRuntimeState.Missing or ServiceRuntimeState.Stopped)
        {
            return;
        }

        await RunScAsync(["stop", ServiceName], allowFailure: true, cancellationToken);
        if (await WaitForServiceStateAsync(ServiceRuntimeState.Stopped, ServiceStopGracePeriod, cancellationToken, throwOnTimeout: false))
        {
            return;
        }

        int? pid = await GetServiceProcessIdAsync(cancellationToken);
        if (pid is > 0)
        {
            await KillProcessAsync(pid.Value, cancellationToken);
        }

        await WaitForServiceStateAsync(ServiceRuntimeState.Stopped, cancellationToken);
    }

    private async Task StartServiceAndWaitAsync(CancellationToken cancellationToken)
    {
        ServiceRuntimeState current = await GetServiceStateAsync(cancellationToken);
        if (current == ServiceRuntimeState.Running)
        {
            return;
        }

        await RunScAsync(["start", ServiceName], allowFailure: false, cancellationToken);
        await WaitForServiceStateAsync(ServiceRuntimeState.Running, cancellationToken);
    }

    private async Task WaitForServiceStateAsync(ServiceRuntimeState desiredState, CancellationToken cancellationToken) =>
        await WaitForServiceStateAsync(desiredState, ServiceStateTimeout, cancellationToken, throwOnTimeout: true);

    private async Task<bool> WaitForServiceStateAsync(
        ServiceRuntimeState desiredState,
        TimeSpan timeout,
        CancellationToken cancellationToken,
        bool throwOnTimeout)
    {
        DateTimeOffset deadline = DateTimeOffset.UtcNow.Add(timeout);
        ServiceRuntimeState current = ServiceRuntimeState.Unknown;
        while (DateTimeOffset.UtcNow < deadline)
        {
            current = await GetServiceStateAsync(cancellationToken);
            if (current == desiredState)
            {
                return true;
            }

            await Task.Delay(500, cancellationToken);
        }

        if (!throwOnTimeout)
        {
            return false;
        }

        throw new InvalidOperationException(
            $"The Windows service did not reach the '{DescribeState(desiredState)}' state. Current state: {DescribeState(current)}.");
    }

    private async Task<int?> GetServiceProcessIdAsync(CancellationToken cancellationToken)
    {
        ScResult result = await RunScCaptureAsync(["queryex", ServiceName], allowFailure: true, cancellationToken);
        if (result.ExitCode != 0)
        {
            return null;
        }

        Match match = Regex.Match(result.Output, @"\bPID\s*:\s*(\d+)", RegexOptions.IgnoreCase);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out int pid) || pid <= 0)
        {
            return null;
        }

        return pid;
    }

    private static async Task KillProcessAsync(int pid, CancellationToken cancellationToken)
    {
        using Process process = new()
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "taskkill.exe",
                Arguments = $"/PID {pid} /T /F",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };

        process.Start();
        Task<string> outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        Task<string> errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        string output = await outputTask;
        string error = await errorTask;

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Could not terminate the running Windows service process (PID {pid}). {output} {error}".Trim());
        }
    }

    private static string ResolvePayloadDirectory()
    {
        foreach (string candidate in GetPayloadCandidates())
        {
            if (File.Exists(Path.Combine(candidate, "TallyConnector.Service.exe")))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException(
            "Could not find the published TallyConnector.Service payload next to setup. " +
            "Share the full publish folder to the client PC, including the service subfolder, not only the setup exe.");
    }

    private void DeleteInstallDirectory()
    {
        string target = Path.GetFullPath(InstallDirectory);
        string allowedRoot = Path.GetFullPath(
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Bizgenix",
                "TallyConnector"));

        if (!target.StartsWith(allowedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Install directory resolved outside the managed connector root.");
        }

        if (Directory.Exists(target))
        {
            Directory.Delete(target, recursive: true);
        }
    }

    private static IEnumerable<string> GetPayloadCandidates()
    {
        string baseDirectory = Path.GetFullPath(AppContext.BaseDirectory);
        yield return Path.Combine(baseDirectory, "service");
        yield return baseDirectory;

        string? current = baseDirectory;
        for (int i = 0; i < 6 && !string.IsNullOrWhiteSpace(current); i += 1)
        {
            yield return Path.Combine(current, "TallyConnector.Service", "bin", "Debug", "net8.0-windows");
            yield return Path.Combine(current, "TallyConnector.Service", "bin", "Release", "net8.0-windows");
            yield return Path.Combine(current, "TallyConnector.Service", "bin", "Release", "net8.0-windows", "publish");
            yield return Path.Combine(current, "TallyConnector.Service", "bin", "Release", "net8.0-windows", "publish", "win-x64");
            current = Directory.GetParent(current)?.FullName;
        }
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        Directory.CreateDirectory(destinationDirectory);
        foreach (string file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            string relative = Path.GetRelativePath(sourceDirectory, file);
            string target = Path.Combine(destinationDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            CopyFileWithRetry(file, target);
        }
    }

    private static void CopyFileWithRetry(string sourcePath, string destinationPath)
    {
        for (int attempt = 1; ; attempt += 1)
        {
            try
            {
                File.Copy(sourcePath, destinationPath, overwrite: true);
                return;
            }
            catch (Exception exception) when (
                attempt < CopyRetryCount
                && (exception is IOException or UnauthorizedAccessException))
            {
                Thread.Sleep(CopyRetryDelay);
            }
        }
    }

    private static ServiceRuntimeState ParseServiceState(string output)
    {
        if (output.Contains("RUNNING", StringComparison.OrdinalIgnoreCase))
        {
            return ServiceRuntimeState.Running;
        }

        if (output.Contains("START_PENDING", StringComparison.OrdinalIgnoreCase))
        {
            return ServiceRuntimeState.StartPending;
        }

        if (output.Contains("STOP_PENDING", StringComparison.OrdinalIgnoreCase))
        {
            return ServiceRuntimeState.StopPending;
        }

        if (output.Contains("STOPPED", StringComparison.OrdinalIgnoreCase))
        {
            return ServiceRuntimeState.Stopped;
        }

        return ServiceRuntimeState.Unknown;
    }

    private string[] BuildCreateArguments() =>
        ["create", ServiceName, "binPath=", ServiceCommandLine, "start=", "auto", "displayname=", ServiceDisplayName];

    private string[] BuildConfigArguments() =>
        ["config", ServiceName, "binPath=", ServiceCommandLine, "start=", "delayed-auto", "displayname=", ServiceDisplayName];

    private static async Task<int> RunScAsync(IReadOnlyList<string> arguments, bool allowFailure, CancellationToken cancellationToken)
    {
        ScResult result = await RunScCaptureAsync(arguments, allowFailure, cancellationToken);
        return result.ExitCode;
    }

    private static async Task<ScResult> RunScCaptureAsync(IReadOnlyList<string> arguments, bool allowFailure, CancellationToken cancellationToken)
    {
        using Process process = new()
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "sc.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };

        foreach (string argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }

        process.Start();
        Task<string> outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        Task<string> errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        string output = await outputTask;
        string error = await errorTask;

        if (!allowFailure && process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Service command failed ({string.Join(' ', arguments)}). {output} {error}".Trim());
        }

        return new ScResult(process.ExitCode, output, error);
    }

    private readonly record struct ScResult(int ExitCode, string Output, string Error);
}
