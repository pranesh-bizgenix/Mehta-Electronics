using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TallyConnector.Core.Services;

namespace TallyConnector.Service;

public sealed class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<Worker> _logger;

    public Worker(IServiceScopeFactory scopeFactory, ILogger<Worker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Bizgenix Tally Connector started.");

        using PeriodicTimer timer = new(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                using IServiceScope scope = _scopeFactory.CreateScope();
                SyncService syncService = scope.ServiceProvider.GetRequiredService<SyncService>();
                await syncService.RunCycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Unexpected connector worker error.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
