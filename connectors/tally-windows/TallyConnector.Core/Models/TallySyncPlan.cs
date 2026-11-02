namespace TallyConnector.Core.Models;

public sealed class TallySyncPlan
{
    public DateOnly VoucherFrom { get; set; }

    public DateOnly VoucherTo { get; set; }

    public DateOnly FlowReportFrom { get; set; }

    public DateOnly FlowReportTo { get; set; }

    public DateOnly SnapshotFrom { get; set; }

    public DateOnly SnapshotTo { get; set; }

    public DateOnly AsOf { get; set; }

    public string PublicationMode { get; set; } = "replace";

    public DateOnly? HistoryCoveredFrom { get; set; }

    public DateOnly? NextHistoryFrom { get; set; }

    public bool InitialHistoryCompleteAfterUpload { get; set; }
}
