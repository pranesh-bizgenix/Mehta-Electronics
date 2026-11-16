using System.Text.Json;
using TallyConnector.Core.Services;

namespace TallyConnector.Core.Write;

/// Own directory only. Lease token and response are protected with the existing DPAPI helper.
public sealed class WriteJournalStore(string directory) : IWriteJournal
{
    private string JournalPath => Path.Combine(directory, "pending.dpapi");
    public async Task<WriteJournal?> LoadAsync(CancellationToken token)
    {
        if (!File.Exists(JournalPath)) return null;
        return JsonSerializer.Deserialize<WriteJournal>(CredentialProtector.UnprotectFromBase64(await File.ReadAllTextAsync(JournalPath, token)));
    }
    public async Task SaveAsync(WriteJournal journal, CancellationToken token)
    {
        Directory.CreateDirectory(directory);
        string protectedValue = CredentialProtector.ProtectToBase64(JsonSerializer.Serialize(journal));
        string staging = JournalPath + ".new";
        await File.WriteAllTextAsync(staging, protectedValue, token);
        using (FileStream file = new(staging, FileMode.Open, FileAccess.Write, FileShare.None)) file.Flush(true);
        File.Move(staging, JournalPath, true);
    }
    public Task CompleteAsync(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        // Retain an encrypted receipt; never reuse read-side queue/checkpoint files.
        if (File.Exists(JournalPath)) File.Move(JournalPath, Path.Combine(directory, $"completed-{Guid.NewGuid():N}.dpapi"));
        return Task.CompletedTask;
    }
}
