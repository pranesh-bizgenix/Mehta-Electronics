using TallyConnector.Core.Services;
using TallyConnector.Service;

if (args.Contains("--verify-write", StringComparer.Ordinal))
{
    if (args.Length != 1) throw new ArgumentException("Use --verify-write alone.");
    await TallyConnector.Service.Write.WriteVerification.RunAsync();
    return;
}

if (args.Contains("--verify-incremental", StringComparer.Ordinal))
{
    if (args.Length != 1) throw new ArgumentException("Use --verify-incremental alone.");
    IncrementalVerification.Run();
    return;
}

string profileId = ResolveProfileId(args);
ConnectorPaths.SetCurrentProfile(profileId);

HostApplicationBuilder builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = ConnectorMetadata.BuildServiceName(profileId);
});

builder.Services.AddSingleton<ConnectorConfigurationService>();
builder.Services.AddSingleton<SyncStateService>();
builder.Services.AddSingleton<QueueService>();
builder.Services.AddSingleton<ApiService>();
builder.Services.AddSingleton<TallyService>();
builder.Services.AddSingleton<SyncService>();
builder.Services.AddHostedService<Worker>();
builder.Services.AddHostedService<TallyConnector.Service.Write.WriteWorker>();

IHost host = builder.Build();
host.Run();

static string ResolveProfileId(string[] arguments)
{
    for (int index = 0; index < arguments.Length - 1; index += 1)
    {
        if (string.Equals(arguments[index], "--profile", StringComparison.OrdinalIgnoreCase))
        {
            return ConnectorPaths.NormalizeProfileId(arguments[index + 1]);
        }
    }

    return ConnectorPaths.DefaultProfileId;
}
