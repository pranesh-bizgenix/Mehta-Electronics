using System.Text.Json;

namespace TallyConnector.Core.Write;

public sealed class WriteCapability
{
    public int Protocol { get; init; } = 1;
    public string Version { get; init; } = "1.0.0";
    public bool CreateOnly { get; init; } = true;
}

public sealed class WriteLease
{
    public string Id { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string CompanyName { get; set; } = "";
    public string CompanyGuid { get; set; } = "";
    public string Operation { get; set; } = "";
    public string Category { get; set; } = "";
    public string LeaseToken { get; set; } = "";
    public DateTimeOffset LeaseExpiresAt { get; set; }
    public string RequestHash { get; set; } = "";
    public string CompanyProbeXml { get; set; } = "";
    public string ReadbackXml { get; set; } = "";
    public string IdentityProbeXml { get; set; } = "";
}

public sealed class WriteJournal
{
    public WriteLease Job { get; set; } = new();
    public string Phase { get; set; } = "CLAIMED";
    public JsonElement? Result { get; set; }
}

public interface IWriteJournal
{
    Task<WriteJournal?> LoadAsync(CancellationToken token);
    Task SaveAsync(WriteJournal journal, CancellationToken token);
    Task CompleteAsync(CancellationToken token);
}
