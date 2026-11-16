using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;

namespace TallyConnector.Core.Write;

/// Separate HTTP clients and journal; never refreshes tokens or enters the read queue.
public sealed class WriteExecutor(HttpClient api, HttpClient tally, IWriteJournal journal)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private const int MaxBytes = 1024 * 1024;

    private async Task<JsonElement?> CallAsync(string path, object? body, CancellationToken token)
    {
        using HttpRequestMessage request = new(body is null ? HttpMethod.Get : HttpMethod.Post, path);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await api.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) return null;
        response.EnsureSuccessStatusCode();
        string text = await LimitedAsync(response, token);
        using JsonDocument parsed = JsonDocument.Parse(text);
        return parsed.RootElement.GetProperty("data").Clone();
    }
    private static async Task<string> LimitedAsync(HttpResponseMessage response, CancellationToken token)
    {
        if (response.Content.Headers.ContentLength > MaxBytes) throw new InvalidDataException("Write response exceeds size limit.");
        await using Stream input = await response.Content.ReadAsStreamAsync(token);
        using MemoryStream output = new();
        byte[] buffer = new byte[8192]; int count;
        while ((count = await input.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + count > MaxBytes) throw new InvalidDataException("Write response exceeds size limit.");
            output.Write(buffer, 0, count);
        }
        return Encoding.UTF8.GetString(output.ToArray());
    }
    private static XDocument Xml(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > MaxBytes) throw new InvalidDataException("XML exceeds size limit.");
        using XmlReader reader = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxBytes });
        return XDocument.Load(reader);
    }
    private async Task<string> TallyAsync(string xml, bool export, CancellationToken token)
    {
        XDocument document = Xml(xml);
        string? operation = document.Descendants("TALLYREQUEST").SingleOrDefault()?.Value;
        if (export ? operation != "Export Data" : operation != "Import Data") throw new InvalidDataException("Unsupported write-path operation.");
        if (!export)
        {
            XElement[] records = document.Descendants().Where(e => e.Name.LocalName is "VOUCHER" or "LEDGER").ToArray();
            if (records.Length != 1 || records[0].Attribute("ACTION")?.Value != "Create" || document.Descendants().Any(e => e.Attributes().Any(a => a.Name.LocalName == "ACTION" && a.Value != "Create"))) throw new InvalidDataException("Only a single Create is allowed.");
            if (records[0].Elements().Any(e => e.Name.LocalName is "GUID" or "MASTERID" or "REMOTEID" or "VCHKEY") || records[0].Attributes().Any(a => a.Name.LocalName is "GUID" or "MASTERID" or "REMOTEID" or "VCHKEY")) throw new InvalidDataException("Existing Tally record selectors are forbidden.");
        }
        using StringContent content = new(xml, Encoding.UTF8, "application/xml");
        using HttpResponseMessage response = await tally.PostAsync("", content, token);
        response.EnsureSuccessStatusCode();
        string result = await LimitedAsync(response, token); Xml(result); return result;
    }
    private static void Company(string xml, WriteLease job)
    {
        XDocument document = Xml(xml);
        XElement[] companies = document.Descendants("COMPANY").ToArray();
        if (companies.Length != 1 || (companies[0].Element("NAME")?.Value ?? companies[0].Attribute("NAME")?.Value) != job.CompanyName || companies[0].Element("GUID")?.Value != job.CompanyGuid) throw new InvalidDataException("COMPANY_MISMATCH");
    }
    private static object Body(WriteLease job, string? company = null, string? readback = null, string? response = null, string? code = null, string? identity = null) => new { jobId = job.Id, leaseToken = job.LeaseToken, companyProbeXml = company, readbackXml = readback, responseXml = response, code, identityProbeXml = identity };

    public async Task CycleAsync(CancellationToken token)
    {
        // Old server or flags OFF: no journal creation and no Tally HTTP/XML activity.
        JsonElement? configuration = await CallAsync("api/connectors/tally-write/config", null, token);
        if (configuration is null || !configuration.Value.GetProperty("active").GetBoolean()) return;
        WriteJournal? pending = await journal.LoadAsync(token);
        if (pending is not null)
        {
            if (pending.Result is not null)
            {
                JsonElement? receipt = await CallAsync("api/connectors/tally-write/result", pending.Result, token);
                if (receipt is not null) await journal.CompleteAsync(token);
                return;
            }
            // Any interrupted authorization/send is ambiguous. Never resend from a journal.
            if (pending.Phase != "CLAIMED")
            {
                JsonElement? receipt = await CallAsync("api/connectors/tally-write/result", Body(pending.Job, code: "CRASH_AFTER_AUTHORIZATION"), token);
                if (receipt is not null) await journal.CompleteAsync(token);
                return;
            }
            await journal.CompleteAsync(token); // server lease recovery decides whether it can be reclaimed.
        }
        foreach (JsonElement company in configuration.Value.GetProperty("companies").EnumerateArray())
        {
            JsonElement? claim = await CallAsync("api/connectors/tally-write/claim", new { companyId = company.GetProperty("companyId").GetString() }, token);
            if (claim is null || !claim.Value.TryGetProperty("job", out JsonElement raw)) continue;
            WriteLease job = raw.Deserialize<WriteLease>(Json) ?? throw new InvalidDataException("Missing lease.");
            WriteJournal state = new() { Job = job };
            await journal.SaveAsync(state, token);
            bool authorized = false;
            try
            {
                if (job.LeaseExpiresAt <= DateTimeOffset.UtcNow) throw new InvalidDataException("Expired lease.");
                string probe = await TallyAsync(job.CompanyProbeXml, true, token); Company(probe, job);
                string readback = await TallyAsync(job.ReadbackXml, true, token);
                if (job.Operation == "VERIFY_ONLY")
                    state.Result = JsonSerializer.SerializeToElement(Body(job, probe, readback), Json);
                else
                {
                    string identity = await TallyAsync(job.IdentityProbeXml, true, token);
                    state.Phase = "AUTHORIZATION_REQUESTED"; await journal.SaveAsync(state, token);
                    JsonElement? permission = await CallAsync("api/connectors/tally-write/authorize", Body(job, probe, readback, identity: identity), token);
                    if (permission is null) return;
                    if (permission.Value.TryGetProperty("confirmed", out JsonElement confirmed) && confirmed.GetBoolean()) { await journal.CompleteAsync(token); return; }
                    if (!permission.Value.TryGetProperty("authorized", out JsonElement allowed) || !allowed.GetBoolean()) { await journal.CompleteAsync(token); return; }
                    authorized = true;
                    string xml = permission.Value.GetProperty("xml").GetString() ?? "";
                    string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(xml))).ToLowerInvariant();
                    if (hash != job.RequestHash || hash != permission.Value.GetProperty("requestHash").GetString()) throw new InvalidDataException("Request hash mismatch.");
                    // Recheck physical company and server kill switch immediately before the one POST.
                    Company(await TallyAsync(job.CompanyProbeXml, true, token), job);
                    JsonElement? active = await CallAsync("api/connectors/tally-write/config", null, token);
                    if (active is null || !active.Value.GetProperty("active").GetBoolean() || !active.Value.GetProperty("companies").EnumerateArray().Any(c => c.GetProperty("companyId").GetString() == job.CompanyId && c.GetProperty("category").GetString() == job.Category && !c.GetProperty("dryRunOnly").GetBoolean()) || job.LeaseExpiresAt <= DateTimeOffset.UtcNow) throw new InvalidDataException("Write authorization no longer current.");
                    state.Phase = "AUTHORIZED"; await journal.SaveAsync(state, token);
                    string response = await TallyAsync(xml, false, token);
                    state.Result = JsonSerializer.SerializeToElement(Body(job, response: response), Json);
                    state.Phase = "RESPONSE_RECEIVED"; await journal.SaveAsync(state, token);
                    probe = await TallyAsync(job.CompanyProbeXml, true, token); Company(probe, job);
                    readback = await TallyAsync(job.ReadbackXml, true, token);
                    state.Result = JsonSerializer.SerializeToElement(Body(job, probe, readback, response), Json);
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception exception)
            {
                state.Result ??= JsonSerializer.SerializeToElement(Body(job, code: authorized || state.Phase != "CLAIMED" ? "UNCERTAIN_SEND" : exception.Message == "COMPANY_MISMATCH" ? "COMPANY_MISMATCH" : "PRE_SEND_FAILURE"), Json);
            }
            state.Phase = "REPORT_PENDING"; await journal.SaveAsync(state, token);
            JsonElement? reported = await CallAsync("api/connectors/tally-write/result", state.Result, token);
            if (reported is not null) await journal.CompleteAsync(token);
            return; // at most one leased operation per cycle.
        }
    }
}
