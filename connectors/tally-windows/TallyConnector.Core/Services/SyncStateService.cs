using System.Text.Json;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class SyncStateService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public async Task<SyncState> LoadAsync(CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        if (!File.Exists(ConnectorPaths.SyncStateFile))
        {
            return new SyncState();
        }

        await using FileStream stream = File.OpenRead(ConnectorPaths.SyncStateFile);
        return await JsonSerializer.DeserializeAsync<SyncState>(stream, JsonOptions, cancellationToken)
            ?? new SyncState();
    }

    public async Task SaveAsync(SyncState state, CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        string tempPath = $"{ConnectorPaths.SyncStateFile}.tmp";
        await using (FileStream stream = File.Create(tempPath))
        {
            await JsonSerializer.SerializeAsync(stream, state, JsonOptions, cancellationToken);
        }

        File.Move(tempPath, ConnectorPaths.SyncStateFile, overwrite: true);
    }
}
