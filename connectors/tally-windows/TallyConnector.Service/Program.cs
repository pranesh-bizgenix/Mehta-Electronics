using TallyConnector.Core.Services;
using TallyConnector.Service;

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
