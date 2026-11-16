using TallyConnector.Core.Services;

namespace TallyConnector.Service;

internal static class IncrementalVerification
{
    public static void Run()
    {
        int passed = 0;
        string Collection(string value) => "<ENVELOPE><BODY><DATA><COLLECTION>" + value + "</COLLECTION></DATA></BODY></ENVELOPE>";
        string Voucher(string guid, string id) => $"<VOUCHER><GUID>{guid}</GUID><ALTERID>{id}</ALTERID></VOUCHER>";
        void Assert(bool valid) { if (!valid) throw new InvalidOperationException("Incremental verification failed."); passed++; }
        void Reject(Action action) { try { action(); } catch { passed++; return; } throw new InvalidOperationException("Unsafe incremental input was accepted."); }
        var source = VoucherIncremental.Identities(Collection(Voucher("a", "9007199254740993") + Voucher("b", "9007199254740994")));
        Assert(VoucherIncremental.UpperBound(source) == "9007199254740994");
        VoucherIncremental.Validate(Collection(Voucher("b", "9007199254740994")), source, "9007199254740993", "9007199254740994"); passed++;
        Reject(() => VoucherIncremental.Validate(Collection(""), source, "9007199254740993", "9007199254740994"));
        Reject(() => VoucherIncremental.Validate(Collection(Voucher("b", "9007199254740995")), source, "9007199254740993", "9007199254740994"));
        Reject(() => VoucherIncremental.Identities(Collection(Voucher("a", "1") + Voucher("a", "2"))));
        Reject(() => VoucherIncremental.Identities(Collection(Voucher("", "1"))));
        Reject(() => VoucherIncremental.Identities(Collection(Voucher("a", "0"))));
        Reject(() => VoucherIncremental.Identities(Collection(Voucher("a", "bad"))));
        Reject(() => VoucherIncremental.Identities("<!DOCTYPE ENVELOPE [<!ENTITY x 'bad'>]>" + Collection("")));
        Reject(() => VoucherIncremental.Identities("<ENVELOPE/>"));
        Reject(() => TallyXmlRequests.IncrementalVouchersRequest(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "ZZTEST_company", "0 OR 1", "2"));
        Assert(TallyXmlRequests.IncrementalVouchersRequest(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "ZZTEST_<&", "1", "2").Contains("$AlterID &gt; 1 AND $AlterID &lt;= 2"));
        Assert(VoucherIncremental.UpperBound(VoucherIncremental.Identities(Collection(""))) == "0");
        string logistics = TallyXmlRequests.LogisticsDocumentsRequest(new DateOnly(2026, 1, 1), new DateOnly(2026, 11, 4), "ZZTEST_<&");
        var logisticsXml = System.Xml.Linq.XDocument.Parse(logistics);
        Assert(logistics.Contains("Export") && !logistics.Contains("Import"));
        Assert(logistics.Contains("BATCHALLOCATIONS.LIST") && logistics.Contains("INVENTORYENTRIESIN.LIST") && logistics.Contains("BASICSHIPDOCUMENTNO"));
        Assert(logistics.Contains("Delivery Note") && logistics.Contains("Receipt Note") && logistics.Contains("Stock Journal") && logistics.Contains("Physical Stock"));
        Assert(logistics.Contains("$Date &gt;= ##SVFromDate") && logistics.Contains("$Date &lt;= ##SVToDate"));
        Assert(logisticsXml.Descendants("SVCURRENTCOMPANY").Single().Value == "ZZTEST_<&");
        Console.WriteLine($"PASS: {passed} pure incremental checks. No profile, service, network or database was accessed.");
    }
}
