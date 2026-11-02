using System.Globalization;
using System.Text;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public static class TallyXmlRequests
{
    private static readonly string[] VoucherFetch =
    [
        "ISOPTIONAL", "ISCANCELLED", "ISDELETED", "ISINVOICE", "PARTYGSTIN", "CURRENCYNAME",
        "GUID", "ALTERID", "MASTERID",
        "DATE", "EFFECTIVEDATE", "BASICVOUCHERDATE", "BASICINVOICEDATE", "BILLDATE", "REFERENCEDATE",
        "VOUCHERTYPENAME", "VOUCHERNUMBER", "REFERENCE", "PARTYLEDGERNAME", "PARTYNAME",
        "BASICBUYERNAME", "BASICBUYERSTATE", "PLACEOFSUPPLY", "NARRATION", "AMOUNT",
        "ALLLEDGERENTRIES.LIST",
        "ALLLEDGERENTRIES.LIST.LEDGERNAME",
        "ALLLEDGERENTRIES.LIST.ISDEEMEDPOSITIVE",
        "ALLLEDGERENTRIES.LIST.AMOUNT",
        "ALLLEDGERENTRIES.LIST.BILLALLOCATIONS.LIST",
        "ALLLEDGERENTRIES.LIST.COSTCENTREALLOCATIONS.LIST",
        "ALLINVENTORYENTRIES.LIST",
        "ALLINVENTORYENTRIES.LIST.STOCKITEMNAME",
        "ALLINVENTORYENTRIES.LIST.ACTUALQTY",
        "ALLINVENTORYENTRIES.LIST.BILLEDQTY",
        "ALLINVENTORYENTRIES.LIST.RATE",
        "ALLINVENTORYENTRIES.LIST.AMOUNT",
    ];

    private static readonly string[] CompanyFetch =
    [
        "NAME", "GUID", "MASTERID", "ALTERID", "COMPANYNUMBER",
        "SVCURRENTCOMPANY", "REMOTECMPNAME", "COMPANYNAME", "CURRENTCOMPANY", "BOOKSFROM", "STARTINGFROM",
    ];

    private static readonly string[] LedgerFetch =
    [
        "*", // All delivered methods and nested collections, including custom fields.
        "NAME", "PARENT", "OPENINGBALANCE", "CLOSINGBALANCE", "CURRENCYNAME", "ISBILLWISEON",
        "GUID", "ALTERID", "MASTERID", "CREATEDDATE", "MODIFYDATE",
        "LEDGERMOBILE", "LEDGERMOBILENO", "LEDGERMOBILENUMBER", "LEDMOBILE", "LEDMOBILENO",
        "MOBILENUMBER", "MOBILE", "PRIMARYMOBILE", "PRIMARYMOBILENO", "PRIMARYMOBILENUMBER",
        "LEDGERPHONE", "LEDGERPHONENO", "LEDPHONE", "LEDPHONENO", "PHONENUMBER", "PHONE",
        "EMAIL", "EMAILID", "LEDGERCONTACT", "CONTACTPERSON",
        "CONTACTDETAILS.LIST", "CONTACTDETAILS.LIST.MOBILE", "CONTACTDETAILS.LIST.PHONE", "CONTACTDETAILS.LIST.EMAIL",
        "ADDRESS", "ADDRESS.LIST", "ADDRESS.LIST.ADDRESS",
    ];

    public static TallySyncPlan BuildSyncPlan(SyncState state, int historyFinancialYears)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Today);
        DateOnly historyStart = InitialHistoryStart(today, historyFinancialYears);
        DateOnly currentFinancialYearStart = StartOfFinancialYear(today);
        if (!state.InitialHistoryComplete)
        {
            DateOnly from = state.NextHistoryFrom ?? historyStart;
            if (from < historyStart)
            {
                from = historyStart;
            }
            else if (!state.NextHistoryFrom.HasValue)
            {
                from = StartOfFinancialYear(from);
            }

            if (from > today)
            {
                from = today;
            }

            DateOnly to = EndOfHistoricalBatch(from, today, state.HistoryBatchMonths);
            bool completesInitialHistory = to >= today;
            return new TallySyncPlan
            {
                VoucherFrom = from,
                VoucherTo = to,
                FlowReportFrom = from,
                FlowReportTo = to,
                SnapshotFrom = historyStart,
                SnapshotTo = today,
                AsOf = today,
                PublicationMode = "merge-window",
                HistoryCoveredFrom = completesInitialHistory ? historyStart : null,
                NextHistoryFrom = completesInitialHistory ? null : to.AddDays(1),
                InitialHistoryCompleteAfterUpload = completesInitialHistory,
            };
        }

        return new TallySyncPlan
        {
            VoucherFrom = currentFinancialYearStart,
            VoucherTo = today,
            FlowReportFrom = currentFinancialYearStart,
            FlowReportTo = today,
            SnapshotFrom = historyStart,
            SnapshotTo = today,
            AsOf = today,
            PublicationMode = "merge-window",
            HistoryCoveredFrom = historyStart,
            NextHistoryFrom = null,
            InitialHistoryCompleteAfterUpload = true,
        };
    }

    public static IEnumerable<(DateOnly From, DateOnly To)> MonthRanges(DateOnly from, DateOnly to)
    {
        DateOnly cursor = new(from.Year, from.Month, 1);
        while (cursor <= to)
        {
            DateOnly rangeFrom = cursor == new DateOnly(from.Year, from.Month, 1) ? from : cursor;
            DateOnly rangeTo = new DateOnly(cursor.Year, cursor.Month, DateTime.DaysInMonth(cursor.Year, cursor.Month));
            if (rangeTo > to)
            {
                rangeTo = to;
            }

            yield return (rangeFrom, rangeTo);
            cursor = cursor.AddMonths(1);
        }
    }

    private static DateOnly EndOfHistoricalBatch(DateOnly from, DateOnly maxTo, int? batchMonths)
    {
        int normalizedBatchMonths = NormalizeHistoryBatchMonths(batchMonths);
        if (normalizedBatchMonths > 0)
        {
            DateOnly rangeEnd = from.AddMonths(normalizedBatchMonths).AddDays(-1);
            return rangeEnd > maxTo ? maxTo : rangeEnd;
        }

        int financialYearEnd = from.Month >= 4 ? from.Year + 1 : from.Year;
        DateOnly candidate = new(financialYearEnd, 3, 31);
        return candidate > maxTo ? maxTo : candidate;
    }

    private static int NormalizeHistoryBatchMonths(int? value) =>
        value switch
        {
            1 => 1,
            3 => 3,
            _ => 0,
        };

    public static DateOnly InitialHistoryStart(DateOnly today, int historyFinancialYears) =>
        StartOfFinancialYear(today).AddYears(-(ConnectorMetadata.NormalizeHistoryFinancialYears(historyFinancialYears) - 1));

    private static DateOnly StartOfFinancialYear(DateOnly value) =>
        value.Month >= 4
            ? new DateOnly(value.Year, 4, 1)
            : new DateOnly(value.Year - 1, 4, 1);

    public static string CompaniesRequest() =>
        CollectionRequest("GISCompanies", "Company", CompanyFetch, null, null, null);

    public static string AllVouchersRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest(
            "GISAllVouchers",
            "Voucher",
            VoucherFetch,
            from,
            to,
            company,
            "<FILTER>GISVoucherDateFilter</FILTER>",
            "<SYSTEM TYPE=\"Formulae\" NAME=\"GISVoucherDateFilter\">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>");

    public static string LedgersRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest(
            "GISLedgers",
            "Ledger",
            LedgerFetch,
            from,
            to,
            company);

    // Refresh from the company's books-start date on every cycle: older quotations can be altered.
    // Sales documents remain read-only source records, separate from CRM approval workflows.
    public static string SalesDocumentsRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest("GISSalesDocuments", "Voucher", ["*", .. VoucherFetch], from, to, company,
            "<FILTER>GISSalesDocumentFilter</FILTER>",
            "<SYSTEM TYPE=\"Formulae\" NAME=\"GISSalesDocumentFilter\">" +
            "$VoucherTypeName = &quot;Sales Quotation&quot; OR $VoucherTypeName = &quot;Quotation1&quot; OR " +
            "$VoucherTypeName = &quot;Quotation&quot; OR $VoucherTypeName = &quot;Enquiry&quot; OR " +
            "$VoucherTypeName = &quot;Inquiry&quot; OR ($VoucherTypeName = &quot;Sales Order&quot; AND $IsOptional)" +
            "</SYSTEM>");

    public static string GroupsRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest(
            "GISGroups",
            "Group",
            ["*", "NAME", "PARENT", "OPENINGBALANCE", "CLOSINGBALANCE", "GUID", "ALTERID", "MASTERID", "CREATEDDATE", "MODIFYDATE"],
            from,
            to,
            company);

    public static string StockRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest(
            "GISStock",
            "StockItem",
            ["*", "NAME", "GUID", "MASTERID", "ALTERID", "PARENT", "BASEUNITS", "CLOSINGBALANCE", "CLOSINGVALUE", "CLOSINGRATE"],
            from,
            to,
            company);

    // Export-only collections. No import/create/alter request is sent to Tally.
    public static IEnumerable<(string Field, string Request)> VisibilityMasterRequests(DateOnly from, DateOnly to, string company)
    {
        (string Field, string Type)[] masters =
        [
            ("companiesXml", "Company"), ("stockGroupsXml", "StockGroup"),
            ("stockCategoriesXml", "StockCategory"), ("unitsXml", "Unit"),
            ("godownsXml", "Godown"), ("priceLevelsXml", "PriceLevel"),
            ("costCentresXml", "CostCentre"),
        ];
        foreach ((string field, string type) in masters)
            yield return (field, CollectionRequest("GISVisibility" + type, type, ["*"], from, to, company));
    }

    public static string CashBankControlRequest(DateOnly from, DateOnly to, string company) =>
        CollectionRequest(
            "GISCashBankControl",
            "Ledger",
            ["NAME", "PARENT", "CLOSINGBALANCE"],
            from,
            to,
            company,
            "<FILTER>GISCashBankFilter</FILTER>",
            "<SYSTEM TYPE=\"Formulae\" NAME=\"GISCashBankFilter\">$$IsLedOfGrp:$Name:$$GroupBank OR $$IsLedOfGrp:$Name:$$GroupCash</SYSTEM>");

    public static string SalesRegisterRequest(DateOnly from, DateOnly to, string company) =>
        ReportEnvelope("Sales Register", from, to, company, explode: true);

    public static string PurchaseRegisterRequest(DateOnly from, DateOnly to, string company) =>
        ReportEnvelope("Purchase Register", from, to, company, explode: true);

    public static string DayBookControlRequest(DateOnly from, DateOnly to, string company) =>
        ReportEnvelope("Day Book", from, to, company, explode: true);

    public static string TrialBalanceRequest(DateOnly from, DateOnly to, string company) =>
        ReportEnvelope("Trial Balance", from, to, company);

    public static string StockSummaryRequest(DateOnly from, DateOnly to, string company) =>
        ReportEnvelope("Stock Summary", from, to, company);

    public static string ReportEnvelope(string reportId, DateOnly from, DateOnly to, string company, bool explode = false)
    {
        StringBuilder builder = new();
        builder.Append("<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>");
        builder.Append(reportId);
        builder.Append("</ID></HEADER><BODY><DESC><STATICVARIABLES>");
        builder.Append(StaticVariables(from, to, company));
        if (explode)
        {
            builder.Append("<EXPLODEFLAG>Yes</EXPLODEFLAG>");
        }

        builder.Append("</STATICVARIABLES></DESC></BODY></ENVELOPE>");
        return builder.ToString();
    }

    private static string CollectionRequest(
        string id,
        string type,
        IEnumerable<string> fetchFields,
        DateOnly? from,
        DateOnly? to,
        string? company,
        string filterXml = "",
        string systemXml = "")
    {
        StringBuilder builder = new();
        builder.Append("<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>");
        builder.Append(id);
        builder.Append("</ID></HEADER><BODY><DESC><STATICVARIABLES>");
        builder.Append(StaticVariables(from, to, company));
        builder.Append("</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME=\"");
        builder.Append(id);
        builder.Append("\" ISMODIFY=\"No\" ISINITIALIZE=\"Yes\"><TYPE>");
        builder.Append(type);
        builder.Append("</TYPE>");
        builder.Append(filterXml);
        builder.Append("<FETCH>");
        builder.Append(string.Join(",", fetchFields));
        builder.Append("</FETCH></COLLECTION>");
        builder.Append(systemXml);
        builder.Append("</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
        return builder.ToString();
    }

    private static string StaticVariables(DateOnly? from, DateOnly? to, string? company)
    {
        StringBuilder builder = new();
        builder.Append("<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>");
        if (from.HasValue && to.HasValue)
        {
            builder.Append("<SVFROMDATE TYPE=\"Date\">");
            builder.Append(Ymd(from.Value));
            builder.Append("</SVFROMDATE><SVTODATE TYPE=\"Date\">");
            builder.Append(Ymd(to.Value));
            builder.Append("</SVTODATE>");
        }

        if (!string.IsNullOrWhiteSpace(company))
        {
            builder.Append("<SVCURRENTCOMPANY>");
            builder.Append(XmlEscape(company));
            builder.Append("</SVCURRENTCOMPANY>");
        }

        return builder.ToString();
    }

    private static string XmlEscape(string value) =>
        value
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal)
            .Replace("'", "&apos;", StringComparison.Ordinal);

    private static string Ymd(DateOnly value) =>
        value.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
}
