using System.Reflection;

namespace TallyConnector.Core.Services;

public static class ConnectorMetadata
{
    public const string ServiceName = "BizgenixTallyConnector";

    public const string ServiceDisplayName = "Bizgenix Tally Connector";

    public const string DefaultApiBaseUrl = "https://gi.bizgenix.ai";

    public const string LocalApiBaseUrl = "http://127.0.0.1:3122";

    public const string DefaultTallyBaseUrl = "http://127.0.0.1:9000";

    public const int DefaultSyncIntervalSeconds = 60 * 60;

    public const int DefaultHeartbeatIntervalSeconds = 60;

    public const int DefaultHistoryFinancialYears = 6;

    public static int NormalizeHistoryFinancialYears(int value) =>
        value switch
        {
            2 or 4 or 6 => value,
            _ => DefaultHistoryFinancialYears,
        };

    public static string BuildServiceName(string? profileId)
    {
        string normalized = ConnectorPaths.NormalizeProfileId(profileId);
        return normalized == ConnectorPaths.DefaultProfileId
            ? ServiceName
            : $"{ServiceName}-{normalized}";
    }

    public static string BuildServiceDisplayName(string? profileId, string? profileName = null)
    {
        string normalized = ConnectorPaths.NormalizeProfileId(profileId);
        if (normalized == ConnectorPaths.DefaultProfileId)
        {
            return ServiceDisplayName;
        }

        string suffix = string.IsNullOrWhiteSpace(profileName)
            ? normalized
            : profileName.Trim();
        return $"{ServiceDisplayName} ({suffix})";
    }

    public static string CurrentVersion =>
        Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3)
        ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "1.0.0";
}
