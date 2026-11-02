using System.Text.Json;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class ConnectorConfigurationService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public async Task<ConnectorConfiguration?> LoadAsync(CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        if (!File.Exists(ConnectorPaths.ConnectorConfigFile))
        {
            return null;
        }

        await using FileStream stream = File.OpenRead(ConnectorPaths.ConnectorConfigFile);
        ConnectorConfiguration? configuration = await JsonSerializer.DeserializeAsync<ConnectorConfiguration>(stream, JsonOptions, cancellationToken);
        if (configuration is not null)
        {
            ConnectorProfile? profile = await new ConnectorProfileCatalogService().FindAsync(ConnectorPaths.CurrentProfileId, cancellationToken);
            configuration.ProfileName = profile?.Name ?? configuration.ProfileName;
        }
        return configuration;
    }

    public async Task<string> GetOrCreateInstallationIdAsync(CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();

        if (File.Exists(ConnectorPaths.InstallationIdFile))
        {
            string existing = (await File.ReadAllTextAsync(ConnectorPaths.InstallationIdFile, cancellationToken)).Trim();
            if (!string.IsNullOrWhiteSpace(existing))
            {
                return existing;
            }
        }

        string installationId = Guid.NewGuid().ToString();
        await File.WriteAllTextAsync(ConnectorPaths.InstallationIdFile, installationId, cancellationToken);
        return installationId;
    }

    public async Task<ConnectorConfiguration> SavePairingAsync(
        PairingResponse response,
        string installationId,
        string machineName,
        string apiBaseUrl,
        string? preferredCompany,
        string? tallyBaseUrl,
        CancellationToken cancellationToken,
        string? profileName = null)
    {
        ConnectorConfiguration? existing = await LoadAsync(cancellationToken);
        ConnectorConfiguration configuration = existing ?? new ConnectorConfiguration();
        configuration.InstallationId = installationId;
        configuration.ConnectorId = response.ConnectorId;
        configuration.ProfileName = profileName?.Trim() ?? configuration.ProfileName;
        configuration.MachineName = machineName;
        configuration.ApiBaseUrl = NormalizeBaseUrl(string.IsNullOrWhiteSpace(apiBaseUrl) ? response.ApiBaseUrl : apiBaseUrl);
        configuration.ProtectedAccessToken = CredentialProtector.ProtectToBase64(response.AccessToken);
        configuration.AccessTokenExpiresAt = response.AccessTokenExpiresAt;
        configuration.ProtectedRefreshToken = CredentialProtector.ProtectToBase64(response.RefreshToken);
        configuration.SyncIntervalSeconds = Math.Max(60, response.SyncIntervalSeconds);
        configuration.HeartbeatIntervalSeconds = Math.Max(30, response.HeartbeatIntervalSeconds);
        configuration.HistoryFinancialYears = ConnectorMetadata.NormalizeHistoryFinancialYears(response.HistoryFinancialYears);
        configuration.TallyBaseUrl = string.IsNullOrWhiteSpace(tallyBaseUrl)
            ? (string.IsNullOrWhiteSpace(existing?.TallyBaseUrl) ? ConnectorMetadata.DefaultTallyBaseUrl : existing.TallyBaseUrl)
            : tallyBaseUrl.Trim();
        configuration.PreferredCompany = string.IsNullOrWhiteSpace(preferredCompany)
            ? existing?.PreferredCompany?.Trim()
            : preferredCompany.Trim();
        configuration.LastPairedAt = DateTimeOffset.UtcNow;

        await SaveAsync(configuration, cancellationToken);
        return configuration;
    }

    public async Task<ConnectorConfiguration?> SaveManualSettingsAsync(
        string? apiBaseUrl,
        string? preferredCompany,
        string? tallyBaseUrl,
        string? profileName,
        CancellationToken cancellationToken)
    {
        ConnectorConfiguration? configuration = await LoadAsync(cancellationToken);
        if (configuration is null)
        {
            configuration = new ConnectorConfiguration
            {
                ApiBaseUrl = ConnectorMetadata.DefaultApiBaseUrl,
                TallyBaseUrl = ConnectorMetadata.DefaultTallyBaseUrl,
                MachineName = Environment.MachineName,
            };
        }

        configuration.ProfileName = profileName?.Trim() ?? configuration.ProfileName;

        if (!string.IsNullOrWhiteSpace(apiBaseUrl))
        {
            configuration.ApiBaseUrl = NormalizeBaseUrl(apiBaseUrl);
        }

        if (!string.IsNullOrWhiteSpace(tallyBaseUrl))
        {
            configuration.TallyBaseUrl = NormalizeBaseUrl(tallyBaseUrl);
        }

        configuration.PreferredCompany = string.IsNullOrWhiteSpace(preferredCompany)
            ? null
            : preferredCompany.Trim();

        await SaveAsync(configuration, cancellationToken);
        return configuration;
    }

    public async Task<ConnectorConfiguration> SaveRefreshAsync(
        ConnectorConfiguration configuration,
        RefreshResponse response,
        CancellationToken cancellationToken)
    {
        configuration.ProtectedAccessToken = CredentialProtector.ProtectToBase64(response.AccessToken);
        configuration.AccessTokenExpiresAt = response.AccessTokenExpiresAt;
        configuration.ProtectedRefreshToken = CredentialProtector.ProtectToBase64(response.RefreshToken);
        configuration.SyncIntervalSeconds = Math.Max(60, response.SyncIntervalSeconds);
        configuration.HeartbeatIntervalSeconds = Math.Max(30, response.HeartbeatIntervalSeconds);
        configuration.HistoryFinancialYears = ConnectorMetadata.NormalizeHistoryFinancialYears(response.HistoryFinancialYears);
        await SaveAsync(configuration, cancellationToken);
        return configuration;
    }

    public async Task<ConnectorConfiguration> ClearPairingAsync(
        ConnectorConfiguration configuration,
        CancellationToken cancellationToken)
    {
        configuration.ConnectorId = "";
        configuration.ProtectedAccessToken = "";
        configuration.AccessTokenExpiresAt = null;
        configuration.ProtectedRefreshToken = "";
        configuration.LastPairedAt = null;
        await SaveAsync(configuration, cancellationToken);
        return configuration;
    }

    public Task<string?> GetAccessTokenAsync(ConnectorConfiguration configuration, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(
            string.IsNullOrWhiteSpace(configuration.ProtectedAccessToken)
                ? null
                : CredentialProtector.UnprotectFromBase64(configuration.ProtectedAccessToken));
    }

    public Task<string?> GetRefreshTokenAsync(ConnectorConfiguration configuration, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(
            string.IsNullOrWhiteSpace(configuration.ProtectedRefreshToken)
                ? null
                : CredentialProtector.UnprotectFromBase64(configuration.ProtectedRefreshToken));
    }

    public async Task SaveAsync(ConnectorConfiguration configuration, CancellationToken cancellationToken)
    {
        ConnectorPaths.EnsureDirectories();
        string tempPath = $"{ConnectorPaths.ConnectorConfigFile}.tmp";
        await using (FileStream stream = File.Create(tempPath))
        {
            await JsonSerializer.SerializeAsync(stream, configuration, JsonOptions, cancellationToken);
        }

        File.Move(tempPath, ConnectorPaths.ConnectorConfigFile, overwrite: true);
    }

    private static string NormalizeBaseUrl(string value) => value.Trim().TrimEnd('/');
}
