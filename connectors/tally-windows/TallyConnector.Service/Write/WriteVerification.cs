using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TallyConnector.Core.Write;

namespace TallyConnector.Service.Write;

/// In-process fake handlers only: no sockets, service installation, config, DPAPI or real Tally.
public static class WriteVerification
{
    private sealed class MemoryJournal : IWriteJournal
    {
        public WriteJournal? Pending;
        public int Saves;
        public Task<WriteJournal?> LoadAsync(CancellationToken token) => Task.FromResult(Pending);
        public Task SaveAsync(WriteJournal journal, CancellationToken token) { Pending = journal; Saves++; return Task.CompletedTask; }
        public Task CompleteAsync(CancellationToken token) { Pending = null; return Task.CompletedTask; }
    }
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handle) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => handle(request);
    }
    private static HttpResponseMessage Reply(object value) => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { data = value })) };
    private static HttpResponseMessage Xml(string value) => new(HttpStatusCode.OK) { Content = new StringContent(value) };
    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }

    public static async Task RunAsync()
    {
        const string export = "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER></ENVELOPE>";
        const string create = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><VOUCHER ACTION=\"Create\"/></ENVELOPE>";
        const string companyXml = "<ENVELOPE><COLLECTION><COMPANY NAME=\"ZZTEST Company\"><GUID>ZZTEST_guid</GUID></COMPANY></COLLECTION></ENVELOPE>";
        int passed = 0;
        foreach (string scenario in new[] { "OFF", "OLD_SERVER", "HAPPY_REPLAY", "WRONG_COMPANY", "TIMEOUT_AFTER_SEND", "CRASH_RECOVERY", "READBACK_ONLY" })
        {
            int tallyCalls = 0, creates = 0, results = 0, authorizeCalls = 0;
            bool claimed = false;
            MemoryJournal journal = new();
            WriteLease job = new() { Id = "ZZTEST_job", CompanyId = "ZZTEST_company", CompanyName = "ZZTEST Company", CompanyGuid = "ZZTEST_guid", Category = "SALES_ORDER", Operation = scenario == "READBACK_ONLY" ? "VERIFY_ONLY" : "CREATE", LeaseToken = "ZZTEST_lease", LeaseExpiresAt = DateTimeOffset.UtcNow.AddMinutes(1), RequestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(create))).ToLowerInvariant(), CompanyProbeXml = export, ReadbackXml = export, IdentityProbeXml = export };
            using HttpClient api = new(new Handler(async request =>
            {
                string path = request.RequestUri!.AbsolutePath;
                if (scenario == "OLD_SERVER") return new HttpResponseMessage(HttpStatusCode.NotFound);
                if (path.EndsWith("/config")) return Reply(new { active = scenario != "OFF", companies = new[] { new { companyId = job.CompanyId, category = job.Category, dryRunOnly = false } } });
                if (path.EndsWith("/claim")) { if (claimed) return Reply(new { inactive = true }); claimed = true; return Reply(new { job }); }
                if (path.EndsWith("/authorize")) { authorizeCalls++; return Reply(new { authorized = true, xml = create, requestHash = job.RequestHash }); }
                if (path.EndsWith("/result")) { results++; string body = await request.Content!.ReadAsStringAsync(); if (scenario == "TIMEOUT_AFTER_SEND") Check(body.Contains("UNCERTAIN_SEND"), "Timeout must report uncertainty."); return Reply(new { status = scenario is "HAPPY_REPLAY" or "READBACK_ONLY" ? "CONFIRMED" : "UNKNOWN" }); }
                throw new InvalidOperationException("Unexpected API path.");
            })) { BaseAddress = new Uri("http://localhost/") };
            using HttpClient tally = new(new Handler(async request =>
            {
                tallyCalls++; string text = await request.Content!.ReadAsStringAsync();
                if (text.Contains("Import Data")) { creates++; if (scenario == "TIMEOUT_AFTER_SEND") throw new HttpRequestException("Synthetic response loss after stub accepted CREATE."); return Xml("<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>"); }
                return Xml(scenario == "WRONG_COMPANY" ? companyXml.Replace("ZZTEST_guid", "ZZTEST_wrong") : companyXml);
            })) { BaseAddress = new Uri("http://localhost/") };
            if (scenario == "CRASH_RECOVERY") { claimed = true; journal.Pending = new WriteJournal { Job = job, Phase = "AUTHORIZATION_REQUESTED" }; }
            WriteExecutor executor = new(api, tally, journal);
            for (int i = 0; i < 5; i++) await executor.CycleAsync(CancellationToken.None);
            if (scenario is "OFF" or "OLD_SERVER") Check(tallyCalls == 0 && journal.Saves == 0, "Disabled/old server must not touch Tally or journal.");
            else if (scenario == "CRASH_RECOVERY") Check(creates == 0 && results >= 1, "Crash recovery must never resend CREATE.");
            else if (scenario is "WRONG_COMPANY" or "READBACK_ONLY") Check(creates == 0 && authorizeCalls == 0, "Wrong company/readback-only must not authorize CREATE.");
            else Check(creates == 1 && results == 1 && authorizeCalls == 1, "Five cycles must create and report exactly once.");
            Console.WriteLine($"PASS {scenario}"); passed++;
        }
        Console.WriteLine($"Write verification: {passed} passed, 0 failed; in-process handlers, no network or services.");
    }
}
