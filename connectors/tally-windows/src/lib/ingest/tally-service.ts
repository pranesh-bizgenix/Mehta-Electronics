import { z } from "zod";
import { assessTallyDataQuality, buildDataset } from "@/lib/connectors/tally/parse";
import { companyKeyForDataset, identityForDataset } from "@/lib/company-workspace";
import { loadCompanyDataset, recordSyncReceipt } from "@/lib/db/repo";
import { setActiveDatasetForOrg } from "@/lib/store";
import { withDatasetVersion } from "@/lib/dataset-version";
import { parseTallyControlSnapshot } from "@/lib/reconciliation/tally-controls";
import { mergeTallyHistoryWindow } from "@/lib/ingest/tally-merge";

const xml = z.string().max(75_000_000).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const TallyIngestPayloadSchema = z.object({
  company: z.string().max(300).optional(),
  companyGuid: z.string().max(300).optional(),
  dayBookXml: xml,
  stockXml: xml,
  balanceSheetXml: xml,
  profitAndLossXml: xml,
  billsXml: xml,
  billsReceivableXml: xml,
  billsPayableXml: xml,
  ledgersXml: xml,
  groupsXml: xml,
  vouchersXml: xml,
  salesRegisterXml: xml,
  purchaseRegisterXml: xml,
  dayBookReportXml: xml,
  trialBalanceXml: xml,
  cashBankBooksXml: xml,
  cashBankControlXml: xml,
  stockSummaryReportXml: xml,
  expectedDatasetVersion: z.string().max(100).nullable().optional(),
  companyKey: z.string().max(100).optional(),
  from: isoDate.optional(),
  asOf: isoDate.optional(),
  to: isoDate.optional(),
  publicationMode: z.enum(["replace", "merge-window"]).optional(),
  historyCoveredFrom: isoDate.nullable().optional(),
});
export type TallyIngestPayload = z.infer<typeof TallyIngestPayloadSchema>;

export async function ingestTallyPayload(orgId: string, payload: TallyIngestPayload) {
  const exactName = payload.company?.trim() || "Tally Company";
  const voucherXml = payload.vouchersXml || payload.dayBookXml || "";
  const baseDataset = buildDataset(
    exactName,
    payload.dayBookXml || voucherXml,
    payload.stockXml || "",
    payload.profitAndLossXml || "",
    payload.billsXml || "",
    payload.asOf || payload.to,
    payload.ledgersXml || "",
    voucherXml,
    payload.billsReceivableXml || payload.billsPayableXml
      ? { receivableXml: payload.billsReceivableXml, payableXml: payload.billsPayableXml }
      : undefined,
    payload.groupsXml || "",
  );
  const guid = payload.companyGuid?.trim() || undefined;
  const parsedControls = parseTallyControlSnapshot({
    balanceSheetXml: payload.balanceSheetXml,
    salesRegisterXml: payload.salesRegisterXml,
    purchaseRegisterXml: payload.purchaseRegisterXml,
    dayBookReportXml: payload.dayBookReportXml,
    trialBalanceXml: payload.trialBalanceXml,
    billsReceivableXml: payload.billsReceivableXml,
    billsPayableXml: payload.billsPayableXml,
    cashBankBooksXml: payload.cashBankControlXml || payload.cashBankBooksXml,
    stockSummaryXml: payload.stockSummaryReportXml || payload.stockXml,
  });
  const dataset = withDatasetVersion({
    ...baseDataset,
    tallyControls: parsedControls,
    companyIdentity: {
      externalId: guid ? `guid:${guid}` : `name:${exactName.toLowerCase()}`,
      exactName,
      displayName: baseDataset.company,
      ...(guid ? { guid } : {}),
    },
    syncWindow: {
      ...(payload.from ? { from: payload.from } : {}),
      ...(payload.to ? { to: payload.to } : {}),
      receivedAt: new Date().toISOString(),
      channel: "agent" as const,
    },
  });
  if (!dataset.sales.length && !dataset.inventory.length && !(dataset.bills?.length ?? 0) && !(dataset.vouchers?.length ?? 0)) {
    return { status: 422, body: { ok: false, message: "Connected, but the agent sent no usable data - is a company open in Tally?" } };
  }

  const companyKey = companyKeyForDataset(dataset);
  if (payload.companyKey && payload.companyKey !== companyKey) {
    return {
      status: 409,
      body: {
        ok: false,
        message: "The Tally company identity changed during sync. Nothing was published; sync again from the connector.",
      },
    };
  }

  const published = payload.publicationMode === "merge-window"
    ? mergeTallyHistoryWindow(
        await loadCompanyDataset(orgId, payload.companyKey || companyKey),
        dataset,
        {
          from: payload.from || dataset.asOf,
          to: payload.to || dataset.asOf,
          historyCoveredFrom: payload.historyCoveredFrom || null,
        },
      )
    : dataset;

  const quality = assessTallyDataQuality(published);
  const identity = identityForDataset(published);
  const counts = {
    salesRows: published.sales.length,
    voucherRows: published.vouchers?.length ?? 0,
    billRows: published.bills?.length ?? 0,
    ledgerRows: published.ledgers?.length ?? 0,
    inventoryRows: published.inventory.length,
  };
  const receiptBase = {
    companyKey,
    exactName: identity.exactName,
    ...(identity.guid ? { sourceGuid: identity.guid } : {}),
    ...(payload.from ? { syncFrom: payload.from } : {}),
    ...(payload.to ? { syncTo: payload.to } : {}),
    dataAsOf: published.asOf,
    counts,
    quality,
  };
  if (!quality.ok) {
    const message = `Tally data reconciliation failed: ${quality.errors.join(" ")}`;
    await recordSyncReceipt(orgId, { ...receiptBase, status: "quarantined", message })
      .catch((error) => console.error("Failed to record quarantined agent receipt:", error));
    return { status: 422, body: { ok: false, message, quality } };
  }

  await setActiveDatasetForOrg(published, orgId, quality, {
    enforceVersion: true,
    expectedDatasetVersion: payload.expectedDatasetVersion ?? null,
  });
  await recordSyncReceipt(orgId, { ...receiptBase, status: "stored", message: `Stored ${counts.voucherRows} vouchers for ${identity.exactName}.` })
    .catch((error) => console.error("Failed to record stored agent receipt:", error));
  return {
    status: 200,
    body: {
      ok: true,
      company: published.company,
      exactCompany: identity.exactName,
      companyGuid: identity.guid ?? null,
      companyKey,
      datasetVersion: published.datasetVersion,
      ...counts,
      asOf: published.asOf,
      quality,
    },
  };
}
