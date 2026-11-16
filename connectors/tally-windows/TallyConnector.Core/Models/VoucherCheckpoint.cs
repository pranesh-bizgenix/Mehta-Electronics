namespace TallyConnector.Core.Models;

public sealed class VoucherCheckpoint
{
    public string CompanyGuid { get; set; } = "";
    public DateOnly From { get; set; }
    public DateOnly ThroughDate { get; set; }
    public string AlterId { get; set; } = "0";
}
