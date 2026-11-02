using TallyConnector.Core.Services;

namespace TallyConnector.Core.Models;

public sealed class PairingRequest
{
    public string PairingCode { get; set; } = "";

    public string? ProfileName { get; set; }

    public string InstallationId { get; set; } = "";

    public string MachineName { get; set; } = "";

    public string AgentVersion { get; set; } = "";
}

public sealed class PairingResponse
{
    public bool Ok { get; set; }

    public string ConnectorId { get; set; } = "";

    public string AccessToken { get; set; } = "";

    public DateTimeOffset AccessTokenExpiresAt { get; set; }

    public string RefreshToken { get; set; } = "";

    public string ApiBaseUrl { get; set; } = "";

    public int SyncIntervalSeconds { get; set; } = ConnectorMetadata.DefaultSyncIntervalSeconds;

    public int HeartbeatIntervalSeconds { get; set; } = ConnectorMetadata.DefaultHeartbeatIntervalSeconds;

    public int HistoryFinancialYears { get; set; } = ConnectorMetadata.DefaultHistoryFinancialYears;
}

public sealed class RefreshRequest
{
    public string RefreshToken { get; set; } = "";
}

public sealed class RefreshResponse
{
    public bool Ok { get; set; }

    public string ConnectorId { get; set; } = "";

    public string AccessToken { get; set; } = "";

    public DateTimeOffset AccessTokenExpiresAt { get; set; }

    public string RefreshToken { get; set; } = "";

    public int SyncIntervalSeconds { get; set; } = ConnectorMetadata.DefaultSyncIntervalSeconds;

    public int HeartbeatIntervalSeconds { get; set; } = ConnectorMetadata.DefaultHeartbeatIntervalSeconds;

    public int HistoryFinancialYears { get; set; } = ConnectorMetadata.DefaultHistoryFinancialYears;
}

public sealed class HeartbeatRequest
{
    public string AgentVersion { get; set; } = "";

    public string? ProfileName { get; set; }

    public string MachineName { get; set; } = "";

    public bool TallyAvailable { get; set; }

    public string? SelectedCompany { get; set; }

    public string? SelectedCompanyGuid { get; set; }

    public List<string> OpenCompanies { get; set; } = [];

    public List<OpenCompanyIdentity> OpenCompanyIdentities { get; set; } = [];

    public DateTimeOffset? LastSyncAt { get; set; }

    public bool HistorySyncInProgress { get; set; }

    public string? NextHistoryFrom { get; set; }
}

public sealed class OpenCompanyIdentity
{
    public string Name { get; set; } = "";

    public string? Guid { get; set; }
}

public sealed class HeartbeatResponse
{
    public bool Ok { get; set; }

    public string ConnectorId { get; set; } = "";

    public int SyncIntervalSeconds { get; set; } = ConnectorMetadata.DefaultSyncIntervalSeconds;

    public DateTimeOffset? LastSeenAt { get; set; }

    public DateTimeOffset? LastSyncAt { get; set; }

    public int HistoryFinancialYears { get; set; } = ConnectorMetadata.DefaultHistoryFinancialYears;
}
