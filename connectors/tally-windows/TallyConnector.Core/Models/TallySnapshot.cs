namespace TallyConnector.Core.Models;

public sealed class TallySnapshot
{
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

    public int VoucherCount { get; set; }
}
