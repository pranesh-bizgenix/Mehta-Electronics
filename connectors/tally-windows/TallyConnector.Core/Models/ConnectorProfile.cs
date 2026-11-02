using TallyConnector.Core.Services;

namespace TallyConnector.Core.Models;

public sealed class ConnectorProfile
{
    public string Id { get; set; } = ConnectorPaths.DefaultProfileId;

    public string Name { get; set; } = "Default profile";

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
