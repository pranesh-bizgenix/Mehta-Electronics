namespace TallyConnector.Core.Models;

public sealed class PendingSyncPackage
{
    public string PackageId { get; set; } = Guid.NewGuid().ToString();

    public string SyncId { get; set; } = Guid.NewGuid().ToString();

    public string? SyncJobId { get; set; }

    public string CompanyName { get; set; } = "";

    public string? CompanyGuid { get; set; }

    public DateOnly From { get; set; }

    public DateOnly To { get; set; }

    public DateOnly AsOf { get; set; }

    public string PublicationMode { get; set; } = "replace";

    public DateOnly? HistoryCoveredFrom { get; set; }

    public DateOnly? NextHistoryFrom { get; set; }

    public bool InitialHistoryCompleteAfterUpload { get; set; }

    public Dictionary<string, string> Fields { get; set; } = new(StringComparer.Ordinal);

    public List<string> FieldNames { get; set; } = [];

    public int VoucherCount { get; set; }

    public DateTimeOffset GeneratedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? NextAttemptAt { get; set; }

    public int AttemptCount { get; set; }

    public string? LastError { get; set; }
}
