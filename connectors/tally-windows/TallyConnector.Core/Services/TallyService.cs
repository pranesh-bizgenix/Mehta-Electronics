using System.Text;
using System.Text.RegularExpressions;
using System.Globalization;
using Microsoft.Extensions.Logging;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed partial class TallyService
{
    private const string TallyRequestSemaphoreName = @"Local\BizgenixTallyConnector.TallyHttp";
    private static readonly TimeSpan TallyRequestSemaphoreTimeout = TimeSpan.FromMinutes(3);

    public sealed record PreparedSyncContext(
        string CompanyName,
        string? CompanyGuid,
        TallySyncPlan Plan,
        DateOnly SalesDocumentsFrom);

    public sealed record TallyCollectionProgress(
        string Step,
        int ProgressPct,
        int RecordCount,
        string Message);

    private readonly HttpClient _httpClient;
    private readonly ILogger<TallyService> _logger;

    public TallyService(ILogger<TallyService> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(2),
        };
    }

    public async Task<bool> IsAvailableAsync(ConnectorConfiguration configuration, CancellationToken cancellationToken)
    {
        try
        {
            string xml = await PostTallyAsync(configuration.TallyBaseUrl, TallyXmlRequests.CompaniesRequest(), cancellationToken);
            return xml.Contains("<ENVELOPE", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public async Task<IReadOnlyList<string>> ListOpenCompanyNamesAsync(string tallyBaseUrl, CancellationToken cancellationToken)
    {
        IReadOnlyList<OpenCompanyIdentity> companies = await ListOpenCompaniesAsync(tallyBaseUrl, cancellationToken);
        return companies
            .Select(company => company.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<OpenCompanyIdentity>> ListOpenCompaniesAsync(string tallyBaseUrl, CancellationToken cancellationToken)
    {
        ConnectorConfiguration configuration = new()
        {
            TallyBaseUrl = tallyBaseUrl.Trim(),
        };
        IReadOnlyList<TallyCompany> companies = await GetOpenCompaniesAsync(configuration, cancellationToken);
        return companies
            .Where(company => !string.IsNullOrWhiteSpace(company.Name))
            .Select(company => new OpenCompanyIdentity
            {
                Name = company.Name,
                Guid = company.Guid,
            })
            .ToList();
    }

    public async Task<TallySnapshot> CollectSnapshotAsync(
        ConnectorConfiguration configuration,
        SyncState state,
        CancellationToken cancellationToken)
    {
        PreparedSyncContext prepared = await PrepareSyncAsync(configuration, state, cancellationToken);
        return await CollectSnapshotAsync(configuration, prepared, cancellationToken);
    }

    public async Task<PreparedSyncContext> PrepareSyncAsync(
        ConnectorConfiguration configuration,
        SyncState state,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<TallyCompany> companies = await GetOpenCompaniesAsync(configuration, cancellationToken);
        TallyCompany selected = ResolveSelectedCompany(configuration, companies);
        TallySyncPlan plan = TallyXmlRequests.BuildSyncPlan(state, configuration.HistoryFinancialYears);
        return new PreparedSyncContext(selected.Name, selected.Guid, plan, selected.BooksFrom ?? plan.SnapshotFrom);
    }

    public async Task<TallySnapshot> CollectSnapshotAsync(
        ConnectorConfiguration configuration,
        PreparedSyncContext prepared,
        CancellationToken cancellationToken,
        Func<TallyCollectionProgress, CancellationToken, Task>? progressCallback = null)
    {
        string selectedCompany = prepared.CompanyName;
        TallySyncPlan plan = prepared.Plan;

        _logger.LogInformation(
            "Collecting Tally snapshot for {CompanyName}: vouchers {VoucherFrom} -> {VoucherTo}; flow reports {FlowFrom} -> {FlowTo}; snapshots {SnapshotFrom} -> {SnapshotTo}.",
            selectedCompany,
            plan.VoucherFrom,
            plan.VoucherTo,
            plan.FlowReportFrom,
            plan.FlowReportTo,
            plan.SnapshotFrom,
            plan.SnapshotTo);

        List<string> voucherNodes = [];
        List<(DateOnly From, DateOnly To)> voucherRanges = TallyXmlRequests.MonthRanges(plan.VoucherFrom, plan.VoucherTo).ToList();
        for (int index = 0; index < voucherRanges.Count; index++)
        {
            (DateOnly rangeFrom, DateOnly rangeTo) = voucherRanges[index];
            string xml = await PostTallyAsync(
                configuration.TallyBaseUrl,
                TallyXmlRequests.AllVouchersRequest(rangeFrom, rangeTo, selectedCompany),
                cancellationToken);

            int rangeVoucherCount = 0;
            foreach (Match match in VoucherRegex().Matches(xml))
            {
                voucherNodes.Add(match.Value);
                rangeVoucherCount++;
            }

            _logger.LogInformation(
                "Collected {VoucherCount} vouchers for {CompanyName} in {RangeFrom} -> {RangeTo}.",
                rangeVoucherCount,
                selectedCompany,
                rangeFrom,
                rangeTo);

            if (progressCallback is not null)
            {
                int progressPct = 5 + (int)Math.Round(((index + 1) / (double)Math.Max(1, voucherRanges.Count)) * 65);
                await progressCallback(
                    new TallyCollectionProgress(
                        "Reading vouchers",
                        Math.Min(70, progressPct),
                        voucherNodes.Count,
                        $"Read vouchers through {rangeTo:yyyy-MM-dd}."),
                    cancellationToken);
            }
        }

        string vouchersXml = $"<ENVELOPE><BODY><DATA><COLLECTION>{string.Join('\n', voucherNodes)}</COLLECTION></DATA></BODY></ENVELOPE>";
        if (progressCallback is not null)
        {
            await progressCallback(
                new TallyCollectionProgress(
                    "Reading reports",
                    75,
                    voucherNodes.Count,
                    "Voucher read complete. Reading ledgers, bills, stock and financial reports."),
                cancellationToken);
        }

        string stockXml = await RequireAsync("stock item collection", configuration.TallyBaseUrl, TallyXmlRequests.StockRequest(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string balanceSheetXml = await RequireAsync("balance sheet", configuration.TallyBaseUrl, TallyXmlRequests.ReportEnvelope("Balance Sheet", plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string profitAndLossXml = await RequireAsync("profit and loss", configuration.TallyBaseUrl, TallyXmlRequests.ReportEnvelope("Profit and Loss", plan.FlowReportFrom, plan.FlowReportTo, selectedCompany), cancellationToken);
        string billsReceivableXml = await RequireAsync("bills receivable", configuration.TallyBaseUrl, TallyXmlRequests.ReportEnvelope("Bills Receivable", plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string billsPayableXml = await RequireAsync("bills payable", configuration.TallyBaseUrl, TallyXmlRequests.ReportEnvelope("Bills Payable", plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string ledgersXml = await RequireAsync("ledgers", configuration.TallyBaseUrl, TallyXmlRequests.LedgersRequest(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string groupsXml = await RequireAsync("groups", configuration.TallyBaseUrl, TallyXmlRequests.GroupsRequest(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        string salesDocumentsXml = await RequireAsync("quotation and enquiry history", configuration.TallyBaseUrl, TallyXmlRequests.SalesDocumentsRequest(prepared.SalesDocumentsFrom, plan.SnapshotTo, selectedCompany), cancellationToken);
        bool includeControlReports = plan.InitialHistoryCompleteAfterUpload || plan.HistoryCoveredFrom is not null;
        string salesRegisterXml = includeControlReports
            ? await OptionalAsync("Sales Register", configuration.TallyBaseUrl, TallyXmlRequests.SalesRegisterRequest(plan.FlowReportFrom, plan.FlowReportTo, selectedCompany), cancellationToken)
            : "";
        string purchaseRegisterXml = includeControlReports
            ? await OptionalAsync("Purchase Register", configuration.TallyBaseUrl, TallyXmlRequests.PurchaseRegisterRequest(plan.FlowReportFrom, plan.FlowReportTo, selectedCompany), cancellationToken)
            : "";
        string dayBookReportXml = includeControlReports
            ? await OptionalAsync("Day Book", configuration.TallyBaseUrl, TallyXmlRequests.DayBookControlRequest(plan.FlowReportFrom, plan.FlowReportTo, selectedCompany), cancellationToken)
            : "";
        string trialBalanceXml = includeControlReports
            ? await OptionalAsync("Trial Balance", configuration.TallyBaseUrl, TallyXmlRequests.TrialBalanceRequest(plan.FlowReportFrom, plan.FlowReportTo, selectedCompany), cancellationToken)
            : "";
        string cashBankControlXml = includeControlReports
            ? await OptionalAsync("Cash/Bank ledger control", configuration.TallyBaseUrl, TallyXmlRequests.CashBankControlRequest(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken)
            : "";
        string stockSummaryReportXml = includeControlReports
            ? await OptionalAsync("Stock Summary", configuration.TallyBaseUrl, TallyXmlRequests.StockSummaryRequest(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany), cancellationToken)
            : "";

        TallySnapshot snapshot = new()
        {
            CompanyName = selectedCompany,
            CompanyGuid = prepared.CompanyGuid,
            From = plan.VoucherFrom,
            To = plan.VoucherTo,
            AsOf = plan.AsOf,
            PublicationMode = plan.PublicationMode,
            HistoryCoveredFrom = plan.HistoryCoveredFrom,
            NextHistoryFrom = plan.NextHistoryFrom,
            InitialHistoryCompleteAfterUpload = plan.InitialHistoryCompleteAfterUpload,
            VoucherCount = voucherNodes.Count,
            Fields = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["vouchersXml"] = vouchersXml,
                ["stockXml"] = stockXml,
                ["balanceSheetXml"] = balanceSheetXml,
                ["profitAndLossXml"] = profitAndLossXml,
                ["billsReceivableXml"] = billsReceivableXml,
                ["billsPayableXml"] = billsPayableXml,
                ["ledgersXml"] = ledgersXml,
                ["groupsXml"] = groupsXml,
                ["salesDocumentsXml"] = salesDocumentsXml,
                ["salesRegisterXml"] = salesRegisterXml,
                ["purchaseRegisterXml"] = purchaseRegisterXml,
                ["dayBookReportXml"] = dayBookReportXml,
                ["trialBalanceXml"] = trialBalanceXml,
                ["cashBankControlXml"] = cashBankControlXml,
                ["stockSummaryReportXml"] = stockSummaryReportXml,
            },
        };
        foreach ((string field, string request) in TallyXmlRequests.VisibilityMasterRequests(plan.SnapshotFrom, plan.SnapshotTo, selectedCompany))
        {
            string xml = await OptionalAsync(field, configuration.TallyBaseUrl, request, cancellationToken);
            if (!string.IsNullOrWhiteSpace(xml)) snapshot.Fields[field] = xml;
        }
        return snapshot;
    }

    private async Task<IReadOnlyList<TallyCompany>> GetOpenCompaniesAsync(
        ConnectorConfiguration configuration,
        CancellationToken cancellationToken)
    {
        string xml = await PostTallyAsync(configuration.TallyBaseUrl, TallyXmlRequests.CompaniesRequest(), cancellationToken);
        MatchCollection matches = CompanyRegex().Matches(xml);
        List<TallyCompany> companies = [];
        foreach (Match match in matches)
        {
            string attributes = match.Groups[1].Value;
            string body = match.Groups[2].Value;
            string name = DecodeXmlText(
                ExtractFirst(attributes, "\\bNAME=\"([^\"]+)\"")
                ?? ExtractFirst(body, "<NAME>([\\s\\S]*?)</NAME>")
                ?? ExtractFirst(body, "<SVCURRENTCOMPANY>([\\s\\S]*?)</SVCURRENTCOMPANY>")
                ?? ExtractFirst(body, "<REMOTECMPNAME>([\\s\\S]*?)</REMOTECMPNAME>")
                ?? ExtractFirst(body, "<COMPANYNAME>([\\s\\S]*?)</COMPANYNAME>")
                ?? ExtractFirst(body, "<CURRENTCOMPANY>([\\s\\S]*?)</CURRENTCOMPANY>")
                ?? "")
                .Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            string? guid = DecodeXmlText(ExtractFirst(body, "<GUID>([\\s\\S]*?)</GUID>") ?? "").Trim();
            if (string.IsNullOrWhiteSpace(guid))
            {
                string masterId = DecodeXmlText(ExtractFirst(body, "<MASTERID>([\\s\\S]*?)</MASTERID>") ?? "").Trim();
                string companyNumber = DecodeXmlText(ExtractFirst(body, "<COMPANYNUMBER>([\\s\\S]*?)</COMPANYNUMBER>") ?? "").Trim();
                string alterId = DecodeXmlText(ExtractFirst(body, "<ALTERID>([\\s\\S]*?)</ALTERID>") ?? "").Trim();
                guid = !string.IsNullOrWhiteSpace(masterId)
                    ? $"masterid:{masterId}"
                    : !string.IsNullOrWhiteSpace(companyNumber)
                        ? $"companynumber:{companyNumber}"
                        : !string.IsNullOrWhiteSpace(alterId)
                            ? $"alterid:{alterId}"
                            : null;
            }

            string booksFromText = DecodeXmlText(ExtractFirst(body, "<BOOKSFROM>([\\s\\S]*?)</BOOKSFROM>") ?? ExtractFirst(body, "<STARTINGFROM>([\\s\\S]*?)</STARTINGFROM>") ?? "").Trim();
            DateOnly? booksFrom = DateOnly.TryParseExact(booksFromText, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly parsedBooksFrom) ? parsedBooksFrom : null;
            companies.Add(new TallyCompany(name, string.IsNullOrWhiteSpace(guid) ? null : guid, booksFrom));
        }

        return companies;
    }

    private TallyCompany ResolveSelectedCompany(ConnectorConfiguration configuration, IReadOnlyList<TallyCompany> companies)
    {
        string preferred = configuration.PreferredCompany?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(preferred))
        {
            TallyCompany? exact = companies.FirstOrDefault(company => string.Equals(company.Name, preferred, StringComparison.OrdinalIgnoreCase));
            if (exact is not null)
            {
                return exact;
            }

            throw new InvalidOperationException($"Configured company \"{preferred}\" is not open in Tally.");
        }

        if (companies.Count == 1)
        {
            return companies[0];
        }

        throw new InvalidOperationException($"{companies.Count} companies are open in Tally. Set the preferred company in setup.");
    }

    private async Task<string> RequireAsync(string label, string tallyBaseUrl, string requestXml, CancellationToken cancellationToken)
    {
        try
        {
            return await PostTallyAsync(tallyBaseUrl, requestXml, cancellationToken);
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException($"{label} extraction failed; no partial snapshot was published: {exception.Message}", exception);
        }
    }

    private async Task<string> OptionalAsync(string label, string tallyBaseUrl, string requestXml, CancellationToken cancellationToken)
    {
        try
        {
            return await PostTallyAsync(tallyBaseUrl, requestXml, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Optional Tally control report {Label} was unavailable.", label);
            return "";
        }
    }

    private async Task<string> PostTallyAsync(string tallyBaseUrl, string requestXml, CancellationToken cancellationToken)
    {
        using Semaphore semaphore = new(1, 1, TallyRequestSemaphoreName);
        bool acquired = false;
        int signaled = WaitHandle.WaitAny([semaphore, cancellationToken.WaitHandle], TallyRequestSemaphoreTimeout);
        if (signaled == WaitHandle.WaitTimeout)
        {
            throw new TimeoutException("Timed out waiting for another connector profile to finish its Tally request.");
        }

        if (signaled == 1)
        {
            throw new OperationCanceledException(cancellationToken);
        }

        acquired = true;

        try
        {
            Exception? lastError = null;
            for (int attempt = 1; attempt <= 3; attempt += 1)
            {
                try
                {
                    using StringContent content = new(requestXml, Encoding.UTF8, "application/xml");
                    using HttpResponseMessage response = await _httpClient.PostAsync(tallyBaseUrl, content, cancellationToken);
                    byte[] bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
                    string xml = DecodeTallyResponse(bytes);

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new InvalidOperationException($"Tally HTTP {(int)response.StatusCode}");
                    }

                    if (!xml.Contains("<ENVELOPE", StringComparison.OrdinalIgnoreCase)
                        || !xml.Contains("</ENVELOPE>", StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("Tally closed the response before the XML was complete.");
                    }

                    string? lineError = ExtractFirst(xml, "<LINEERROR>([\\s\\S]*?)</LINEERROR>");
                    if (!string.IsNullOrWhiteSpace(lineError))
                    {
                        throw new InvalidOperationException($"Tally: {lineError.Trim()}");
                    }

                    return xml;
                }
                catch (Exception exception) when (attempt < 3 && !cancellationToken.IsCancellationRequested)
                {
                    lastError = exception;
                    await Task.Delay(TimeSpan.FromMilliseconds(attempt * 500), cancellationToken);
                }
                catch (Exception exception)
                {
                    lastError = exception;
                    break;
                }
            }

            throw lastError ?? new InvalidOperationException("Tally request failed.");
        }
        finally
        {
            if (acquired)
            {
                semaphore.Release();
            }
        }
    }

    private static string DecodeTallyResponse(byte[] buffer)
    {
        if (buffer.Length >= 2 && buffer[0] == 0xFF && buffer[1] == 0xFE)
        {
            return Encoding.Unicode.GetString(buffer);
        }

        if (buffer.Length >= 2 && buffer[0] == 0xFE && buffer[1] == 0xFF)
        {
            return Encoding.BigEndianUnicode.GetString(buffer);
        }

        int sampleLength = Math.Min(buffer.Length, 400);
        int nullCount = 0;
        for (int index = 0; index < sampleLength; index += 1)
        {
            if (buffer[index] == 0)
            {
                nullCount += 1;
            }
        }

        return nullCount > sampleLength * 0.2
            ? Encoding.Unicode.GetString(buffer)
            : Encoding.UTF8.GetString(buffer);
    }

    private static string DecodeXmlText(string value) =>
        value
            .Replace("&amp;", "&", StringComparison.OrdinalIgnoreCase)
            .Replace("&quot;", "\"", StringComparison.OrdinalIgnoreCase)
            .Replace("&apos;", "'", StringComparison.OrdinalIgnoreCase)
            .Replace("&lt;", "<", StringComparison.OrdinalIgnoreCase)
            .Replace("&gt;", ">", StringComparison.OrdinalIgnoreCase);

    private static string? ExtractFirst(string text, string pattern)
    {
        Match match = Regex.Match(text, pattern, RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : null;
    }

    [GeneratedRegex("<COMPANY\\b([^>]*)>([\\s\\S]*?)</COMPANY>", RegexOptions.IgnoreCase)]
    private static partial Regex CompanyRegex();

    [GeneratedRegex("<VOUCHER\\b[\\s\\S]*?</VOUCHER>", RegexOptions.IgnoreCase)]
    private static partial Regex VoucherRegex();

    private sealed record TallyCompany(string Name, string? Guid, DateOnly? BooksFrom);
}
