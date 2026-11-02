using System.Text;
using System.Text.Json;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class ConnectorProfileCatalogService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public async Task<IReadOnlyList<ConnectorProfile>> ListAsync(CancellationToken cancellationToken)
    {
        List<ConnectorProfile> profiles = await LoadCatalogAsync(cancellationToken);
        EnsureDefaultProfile(profiles);
        SortProfiles(profiles);
        return profiles;
    }

    public async Task<ConnectorProfile?> FindAsync(string? profileId, CancellationToken cancellationToken)
    {
        string normalized = ConnectorPaths.NormalizeProfileId(profileId);
        IReadOnlyList<ConnectorProfile> profiles = await ListAsync(cancellationToken);
        return profiles.FirstOrDefault((profile) => string.Equals(profile.Id, normalized, StringComparison.Ordinal));
    }

    public async Task<ConnectorProfile> CreateProfileAsync(string name, CancellationToken cancellationToken)
    {
        string trimmedName = name.Trim();
        if (string.IsNullOrWhiteSpace(trimmedName))
        {
            throw new InvalidOperationException("Enter a profile name.");
        }

        List<ConnectorProfile> profiles = await LoadCatalogAsync(cancellationToken);
        EnsureDefaultProfile(profiles);

        string id = BuildUniqueProfileId(trimmedName, profiles);
        ConnectorProfile profile = new()
        {
            Id = id,
            Name = trimmedName,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        profiles.Add(profile);
        SortProfiles(profiles);
        await SaveCatalogAsync(profiles, cancellationToken);
        Directory.CreateDirectory(ConnectorPaths.ProfileRootDirectory(profile.Id));
        return profile;
    }

    public async Task DeleteProfileAsync(string profileId, CancellationToken cancellationToken)
    {
        string normalized = ConnectorPaths.NormalizeProfileId(profileId);
        if (normalized == ConnectorPaths.DefaultProfileId)
        {
            throw new InvalidOperationException("The default profile cannot be deleted.");
        }

        List<ConnectorProfile> profiles = await LoadCatalogAsync(cancellationToken);
        ConnectorProfile? existing = profiles.FirstOrDefault((profile) => string.Equals(profile.Id, normalized, StringComparison.Ordinal));
        if (existing is null)
        {
            return;
        }

        profiles.Remove(existing);
        EnsureDefaultProfile(profiles);
        SortProfiles(profiles);
        await SaveCatalogAsync(profiles, cancellationToken);
        DeleteProfileDirectory(normalized);
    }

    private static async Task<List<ConnectorProfile>> LoadCatalogAsync(CancellationToken cancellationToken)
    {
        EnsureCatalogDirectory();
        if (!File.Exists(ConnectorPaths.ProfileCatalogFile))
        {
            return [];
        }

        await using FileStream stream = File.OpenRead(ConnectorPaths.ProfileCatalogFile);
        return await JsonSerializer.DeserializeAsync<List<ConnectorProfile>>(stream, JsonOptions, cancellationToken)
            ?? [];
    }

    private static async Task SaveCatalogAsync(IReadOnlyList<ConnectorProfile> profiles, CancellationToken cancellationToken)
    {
        EnsureCatalogDirectory();
        string tempPath = $"{ConnectorPaths.ProfileCatalogFile}.tmp";
        await using (FileStream stream = File.Create(tempPath))
        {
            await JsonSerializer.SerializeAsync(stream, profiles, JsonOptions, cancellationToken);
        }

        File.Move(tempPath, ConnectorPaths.ProfileCatalogFile, overwrite: true);
    }

    private static void EnsureCatalogDirectory()
    {
        Directory.CreateDirectory(ConnectorPaths.BaseRootDirectory);
        Directory.CreateDirectory(ConnectorPaths.ProfilesRootDirectory);
    }

    private static void EnsureDefaultProfile(ICollection<ConnectorProfile> profiles)
    {
        if (profiles.Any((profile) => string.Equals(profile.Id, ConnectorPaths.DefaultProfileId, StringComparison.Ordinal)))
        {
            return;
        }

        profiles.Add(new ConnectorProfile
        {
            Id = ConnectorPaths.DefaultProfileId,
            Name = "Default profile",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
    }

    private static void SortProfiles(List<ConnectorProfile> profiles)
    {
        profiles.Sort((left, right) =>
        {
            if (left.Id == ConnectorPaths.DefaultProfileId && right.Id != ConnectorPaths.DefaultProfileId)
            {
                return -1;
            }

            if (left.Id != ConnectorPaths.DefaultProfileId && right.Id == ConnectorPaths.DefaultProfileId)
            {
                return 1;
            }

            return StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name);
        });
    }

    private static string BuildUniqueProfileId(string name, IEnumerable<ConnectorProfile> profiles)
    {
        string baseId = Slugify(name);
        if (string.IsNullOrWhiteSpace(baseId) || baseId == ConnectorPaths.DefaultProfileId)
        {
            baseId = "profile";
        }

        string candidate = baseId;
        int suffix = 2;
        HashSet<string> existing = profiles
            .Select((profile) => ConnectorPaths.NormalizeProfileId(profile.Id))
            .ToHashSet(StringComparer.Ordinal);

        while (existing.Contains(candidate))
        {
            candidate = $"{baseId}-{suffix}";
            suffix += 1;
        }

        return candidate;
    }

    private static string Slugify(string value)
    {
        StringBuilder builder = new(value.Length);
        bool previousWasDash = false;
        foreach (char character in value.Trim().ToLowerInvariant())
        {
            if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9'))
            {
                builder.Append(character);
                previousWasDash = false;
                continue;
            }

            if (!previousWasDash && builder.Length > 0)
            {
                builder.Append('-');
                previousWasDash = true;
            }
        }

        string slug = builder.ToString().Trim('-');
        if (slug.Length > 32)
        {
            slug = slug[..32].Trim('-');
        }

        return slug;
    }

    private static void DeleteProfileDirectory(string profileId)
    {
        string path = Path.GetFullPath(ConnectorPaths.ProfileRootDirectory(profileId));
        string root = Path.GetFullPath(ConnectorPaths.ProfilesRootDirectory);
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Profile directory resolved outside the managed connector root.");
        }

        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }
    }
}
