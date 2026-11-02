namespace TallyConnector.Core.Models;

public sealed class SyncState
{
    public bool InitialHistoryComplete { get; set; }

    public DateOnly? NextHistoryFrom { get; set; }

    public int? HistoryFinancialYears { get; set; }

    public int? HistoryBatchMonths { get; set; }

    public DateTimeOffset? LastSuccessfulSyncAt { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset? LastHeartbeatAt { get; set; }

    public bool? LastTallyAvailable { get; set; }

    public bool? LastCompanyAvailable { get; set; }

    public string? LastCompanyGuid { get; set; }

    public string? LastCompanyName { get; set; }

    public string? LastSyncId { get; set; }

    public DateTimeOffset? RefreshBackoffUntil { get; set; }

    public int PendingPackageCount { get; set; }

    public string? LastError { get; set; }
}
