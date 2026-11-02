using System.Text.Json;
using System.Text;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class QueueService
{
    private static readonly Encoding FileEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public async Task EnqueueAsync(PendingSyncPackage package, CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        if (package.CreatedAt == default)
        {
            package.CreatedAt = DateTimeOffset.UtcNow;
        }

        package.NextAttemptAt ??= DateTimeOffset.UtcNow;
        await MaterializeFieldFilesAsync(package, cancellationToken);

        string path = ConnectorPaths.QueuePackageFile(package.PackageId);
        string tempPath = $"{path}.tmp";
        await using (FileStream stream = File.Create(tempPath))
        {
            await JsonSerializer.SerializeAsync(stream, package, JsonOptions, cancellationToken);
        }

        File.Move(tempPath, path, overwrite: true);
    }

    public async Task<IReadOnlyList<PendingSyncPackage>> GetDuePackagesAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        List<PendingSyncPackage> packages = [];
        foreach (string file in Directory.EnumerateFiles(ConnectorPaths.QueueDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            await using FileStream stream = File.OpenRead(file);
            PendingSyncPackage? package = await JsonSerializer.DeserializeAsync<PendingSyncPackage>(stream, JsonOptions, cancellationToken);
            if (package is null)
            {
                continue;
            }

            if ((package.NextAttemptAt ?? package.CreatedAt) <= now)
            {
                packages.Add(package);
            }
        }

        return packages
            .OrderBy(package => package.NextAttemptAt ?? package.CreatedAt)
            .ThenBy(package => package.CreatedAt)
            .ToList();
    }

    public async Task<IReadOnlyList<PendingSyncPackage>> GetAllPendingAsync(CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        List<PendingSyncPackage> packages = [];
        foreach (string file in Directory.EnumerateFiles(ConnectorPaths.QueueDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            await using FileStream stream = File.OpenRead(file);
            PendingSyncPackage? package = await JsonSerializer.DeserializeAsync<PendingSyncPackage>(stream, JsonOptions, cancellationToken);
            if (package is not null)
            {
                packages.Add(package);
            }
        }

        return packages
            .OrderBy(package => package.NextAttemptAt ?? package.CreatedAt)
            .ThenBy(package => package.CreatedAt)
            .ToList();
    }

    public async Task<int> DeleteLegacyOversizedPackagesAsync(CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        int deleted = 0;
        foreach (string file in Directory.EnumerateFiles(ConnectorPaths.QueueDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            PendingSyncPackage? package;
            await using (FileStream stream = File.OpenRead(file))
            {
                package = await JsonSerializer.DeserializeAsync<PendingSyncPackage>(stream, JsonOptions, cancellationToken);
            }

            if (package is null)
            {
                continue;
            }

            bool oversized = package.LastError?.Contains("300 MB", StringComparison.OrdinalIgnoreCase) == true
                || package.LastError?.Contains("10,000 chunk session safety budget", StringComparison.OrdinalIgnoreCase) == true;
            bool legacy = package.AsOf == default
                && package.HistoryCoveredFrom is null
                && package.NextHistoryFrom is null
                && !package.InitialHistoryCompleteAfterUpload;
            if (!oversized || !legacy)
            {
                continue;
            }

            await DeletePackageAsync(package.PackageId, cancellationToken);
            deleted += 1;
        }

        return deleted;
    }

    public Task<int> CountPendingAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ConnectorPaths.EnsureDirectories();
        int count = Directory.EnumerateFiles(ConnectorPaths.QueueDirectory, "*.json", SearchOption.TopDirectoryOnly).Count();
        return Task.FromResult(count);
    }

    public Task MarkSucceededAsync(string packageId, CancellationToken cancellationToken)
    {
        return DeletePackageAsync(packageId, cancellationToken);
    }

    public Task MarkFailedAsync(PendingSyncPackage package, string error, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        package.AttemptCount += 1;
        package.LastError = error;
        package.NextAttemptAt = DateTimeOffset.UtcNow.Add(ComputeRetryDelay(package.AttemptCount));
        return EnqueueAsync(package, cancellationToken);
    }

    private static string PackagePath(string packageId) =>
        ConnectorPaths.QueuePackageFile(packageId);

    private static Task DeletePackageAsync(string packageId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        string path = PackagePath(packageId);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        string packageDirectory = ConnectorPaths.QueuePackageDirectory(packageId);
        if (Directory.Exists(packageDirectory))
        {
            Directory.Delete(packageDirectory, recursive: true);
        }

        return Task.CompletedTask;
    }

    private static async Task MaterializeFieldFilesAsync(PendingSyncPackage package, CancellationToken cancellationToken)
    {
        if (package.Fields.Count == 0)
        {
            return;
        }

        string packageDirectory = ConnectorPaths.QueuePackageDirectory(package.PackageId);
        Directory.CreateDirectory(packageDirectory);
        List<string> fieldNames = [];
        foreach ((string fieldName, string content) in package.Fields)
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            string fieldPath = ConnectorPaths.QueuePackageFieldFile(package.PackageId, fieldName);
            string tempPath = $"{fieldPath}.tmp";
            await File.WriteAllTextAsync(tempPath, content, FileEncoding, cancellationToken);
            File.Move(tempPath, fieldPath, overwrite: true);
            fieldNames.Add(fieldName);
        }

        package.FieldNames = fieldNames;
        package.Fields = new Dictionary<string, string>(StringComparer.Ordinal);
    }

    private static TimeSpan ComputeRetryDelay(int attemptCount)
    {
        double minutes = Math.Min(20 * Math.Max(1, attemptCount), 6 * 60);
        return TimeSpan.FromMinutes(minutes);
    }
}
