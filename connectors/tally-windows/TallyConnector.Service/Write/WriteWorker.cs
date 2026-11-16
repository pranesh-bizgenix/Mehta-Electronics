using System.Net.Http.Headers;
using System.Text.Json;
using TallyConnector.Core.Models;
using TallyConnector.Core.Services;
using TallyConnector.Core.Write;

namespace TallyConnector.Service.Write;

public sealed class WriteWorker(ILogger<WriteWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Yield before any IO; the existing read worker has its own execution path.
        await Task.Yield();
        using PeriodicTimer timer = new(TimeSpan.FromSeconds(15));
        do
        {
            try
            {
                if (!File.Exists(ConnectorPaths.ConnectorConfigFile)) continue;
                // Read configuration only. Never save, refresh or rotate any read-side token.
                ConnectorConfiguration? config = JsonSerializer.Deserialize<ConnectorConfiguration>(await File.ReadAllTextAsync(ConnectorPaths.ConnectorConfigFile, stoppingToken), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (config is null || !config.IsPaired || config.AccessTokenExpiresAt <= DateTimeOffset.UtcNow || string.IsNullOrWhiteSpace(config.ProtectedAccessToken)) continue;
                using HttpClient api = new() { BaseAddress = new Uri(config.ApiBaseUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(20) };
                api.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CredentialProtector.UnprotectFromBase64(config.ProtectedAccessToken));
                using HttpClient tally = new() { BaseAddress = new Uri(config.TallyBaseUrl), Timeout = TimeSpan.FromSeconds(20) };
                WriteExecutor executor = new(api, tally, new WriteJournalStore(Path.Combine(ConnectorPaths.RootDirectory, "write")));
                await executor.CycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                // No payload/token/endpoint logging. This exception cannot escape into the read worker.
                logger.LogWarning("Tally write cycle paused ({FailureType}); read sync continues independently.", exception.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
