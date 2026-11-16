using System.Numerics;
using System.Xml;
using System.Xml.Linq;

namespace TallyConnector.Core.Services;

// Pure validation: no Tally writes, IO, HTTP or database connections.
public static class VoucherIncremental
{
    public static Dictionary<string, BigInteger> Identities(string xml)
    {
        using StringReader input = new(xml);
        using XmlReader reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        XDocument document = XDocument.Load(reader);
        if (document.Root?.Name.LocalName != "ENVELOPE" || !document.Descendants("COLLECTION").Any() || document.Descendants("LINEERROR").Any())
            throw new InvalidOperationException("A complete voucher collection is required for an alteration checkpoint.");
        Dictionary<string, BigInteger> result = new(StringComparer.Ordinal);
        foreach (XElement voucher in document.Descendants("VOUCHER"))
        {
            string guid = voucher.Element("GUID")?.Value.Trim() ?? "";
            string master = voucher.Element("MASTERID")?.Value.Trim() ?? "";
            string identity = guid.Length > 0 ? "guid:" + guid : master.Length > 0 ? "master:" + master : "";
            string alter = voucher.Element("ALTERID")?.Value.Trim() ?? "";
            if (identity.Length == 0 || alter.Length == 0 || alter.Length > 30 || alter.Any(c => c < '0' || c > '9') || !BigInteger.TryParse(alter, out BigInteger id) || id <= 0 || !result.TryAdd(identity, id))
                throw new InvalidOperationException("Stable voucher IDs and valid unique alteration IDs are required; use the date-window fallback.");
        }
        return result;
    }

    public static string UpperBound(Dictionary<string, BigInteger> source) => source.Count == 0 ? "0" : source.Values.Max().ToString(System.Globalization.CultureInfo.InvariantCulture);

    public static void Validate(string xml, Dictionary<string, BigInteger> probe, string after, string through)
    {
        BigInteger lower = BigInteger.Parse(after), upper = BigInteger.Parse(through);
        var expected = probe.Where(row => row.Value > lower && row.Value <= upper).ToDictionary(row => row.Key, row => row.Value, StringComparer.Ordinal);
        var actual = Identities(xml);
        if (actual.Count != expected.Count || actual.Any(row => !expected.TryGetValue(row.Key, out BigInteger id) || id != row.Value))
            throw new InvalidOperationException("Voucher identities changed during extraction or the alteration filter was not honoured; use the date-window fallback.");
    }
}
