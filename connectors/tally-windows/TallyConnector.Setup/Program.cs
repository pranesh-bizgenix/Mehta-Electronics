using TallyConnector.Core.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace TallyConnector.Setup;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        ConnectorConfigurationService configurationService = new();
        ConnectorProfileCatalogService profileCatalogService = new();
        ApiService apiService = new(configurationService);
        TallyService tallyService = new(NullLogger<TallyService>.Instance);

        Application.Run(new PairingForm(configurationService, profileCatalogService, apiService, tallyService));
    }
}
