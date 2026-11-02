using System.Text;

namespace TallyConnector.Core.Services;

public static class ConnectorPaths
{
    public const string DefaultProfileId = "default";

    private static readonly object ProfileLock = new();

    private static string _currentProfileId = DefaultProfileId;

    public static string BaseRootDirectory =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Bizgenix",
            "TallyConnector");

    public static string ProfilesRootDirectory => Path.Combine(BaseRootDirectory, "profiles");

    public static string ProfileCatalogFile => Path.Combine(ProfilesRootDirectory, "catalog.json");

    public static string CurrentProfileId
    {
        get
        {
            lock (ProfileLock)
            {
                return _currentProfileId;
            }
        }
    }

    public static string RootDirectory => ProfileRootDirectory(CurrentProfileId);

    public static string ConfigDirectory => Path.Combine(RootDirectory, "config");

    public static string QueueDirectory => Path.Combine(RootDirectory, "queue");

    public static string LogsDirectory => Path.Combine(RootDirectory, "logs");

    public static string UpdatesDirectory => Path.Combine(RootDirectory, "updates");

    public static string BackupDirectory => Path.Combine(RootDirectory, "backup");

    public static string ConnectorConfigFile => Path.Combine(ConfigDirectory, "connector.json");

    public static string InstallationIdFile => Path.Combine(ConfigDirectory, "installation-id.txt");

    public static string SyncStateFile => Path.Combine(ConfigDirectory, "sync-state.json");

    public static void SetCurrentProfile(string? profileId)
    {
        lock (ProfileLock)
        {
            _currentProfileId = NormalizeProfileId(profileId);
        }
    }

    public static string NormalizeProfileId(string? profileId)
    {
        string normalized = (profileId ?? DefaultProfileId).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return DefaultProfileId;
        }

        StringBuilder builder = new(normalized.Length);
        foreach (char character in normalized)
        {
            if ((character >= 'a' && character <= 'z')
                || (character >= '0' && character <= '9')
                || character == '-')
            {
                builder.Append(character);
            }
        }

        return builder.Length == 0 ? DefaultProfileId : builder.ToString();
    }

    public static string ProfileRootDirectory(string? profileId)
    {
        string normalized = NormalizeProfileId(profileId);
        return normalized == DefaultProfileId
            ? BaseRootDirectory
            : Path.Combine(ProfilesRootDirectory, normalized);
    }

    public static string QueuePackageDirectory(string packageId) =>
        Path.Combine(QueueDirectory, packageId);

    public static string QueuePackageFile(string packageId) =>
        Path.Combine(QueueDirectory, $"{packageId}.json");

    public static string QueuePackageFieldFile(string packageId, string fieldName) =>
        Path.Combine(QueuePackageDirectory(packageId), $"{SanitizeFileName(fieldName)}.xml");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(BaseRootDirectory);
        Directory.CreateDirectory(ProfilesRootDirectory);
        Directory.CreateDirectory(ConfigDirectory);
        Directory.CreateDirectory(QueueDirectory);
        Directory.CreateDirectory(LogsDirectory);
        Directory.CreateDirectory(UpdatesDirectory);
        Directory.CreateDirectory(BackupDirectory);
    }

    private static string SanitizeFileName(string value)
    {
        StringBuilder builder = new(value.Length);
        foreach (char character in value)
        {
            builder.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), character) >= 0 ? '_' : character);
        }

        return builder.Length == 0 ? "field" : builder.ToString();
    }
}
