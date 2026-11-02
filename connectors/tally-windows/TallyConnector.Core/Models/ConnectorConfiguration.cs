using TallyConnector.Core.Services;

namespace TallyConnector.Core.Models;

public sealed class ConnectorConfiguration
{
    public string InstallationId { get; set; } = "";

    public string ConnectorId { get; set; } = "";

    public string? ProfileName { get; set; }

    public string MachineName { get; set; } = Environment.MachineName;

    public string ApiBaseUrl { get; set; } = "";

    public string ProtectedAccessToken { get; set; } = "";

    public DateTimeOffset? AccessTokenExpiresAt { get; set; }

    public string ProtectedRefreshToken { get; set; } = "";

    public int SyncIntervalSeconds { get; set; } = ConnectorMetadata.DefaultSyncIntervalSeconds;

    public int HeartbeatIntervalSeconds { get; set; } = ConnectorMetadata.DefaultHeartbeatIntervalSeconds;

    public int HistoryFinancialYears { get; set; } = ConnectorMetadata.DefaultHistoryFinancialYears;

    public string TallyBaseUrl { get; set; } = ConnectorMetadata.DefaultTallyBaseUrl;

    public string? PreferredCompany { get; set; }

    public DateTimeOffset? LastPairedAt { get; set; }

    public bool IsPaired =>
        !string.IsNullOrWhiteSpace(InstallationId)
        && !string.IsNullOrWhiteSpace(ConnectorId)
        && !string.IsNullOrWhiteSpace(ApiBaseUrl)
        && !string.IsNullOrWhiteSpace(ProtectedRefreshToken);
}
