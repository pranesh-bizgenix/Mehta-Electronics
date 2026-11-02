"use client";

import { useState } from "react";
import { TallyPairingCard } from "./TallyPairingCard";

type ConnectorStatus = {
  id: string;
  machineName: string | null;
  agentVersion: string | null;
  status: "active" | "revoked" | "error";
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastTallyAvailable: boolean | null;
  selectedCompany: string | null;
  revokedAt: string | null;
  online: boolean;
};

type ConnectorSyncJob = {
  id: string;
  companyName: string | null;
  status: "running" | "stored" | "quarantined" | "failed";
  recordCount: number;
  syncFrom: string | null;
  syncTo: string | null;
  startedAt: string;
  completedAt: string | null;
};

export function TallyPairingPanel(props: {
  company: string;
  status: { connector: ConnectorStatus | null; connectorSyncJobs: ConnectorSyncJob[] } | null;
  onChanged: () => Promise<void> | void;
}) {
  const { company, status, onChanged } = props;
  const connector = status?.connector ?? null;
  const syncJobs = status?.connectorSyncJobs ?? [];
  const [busy, setBusy] = useState<"" | "pairing" | "revoke">("");
  const [copied, setCopied] = useState(false);
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const syncing = !connector?.lastSyncAt && syncJobs.some((job) => job.status === "running");

  async function generatePairingCode() {
    setBusy("pairing");
    setActionMessage(null);
    try {
      const response = await fetch("/api/connectors/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not generate a pairing code.");
      setPairing({ pairingCode: data.pairingCode, expiresAt: data.expiresAt });
      setActionMessage({ ok: true, text: "Pairing code generated. Enter it once on the Tally PC." });
      await onChanged();
    } catch (error) {
      setActionMessage({ ok: false, text: error instanceof Error ? error.message : "Could not generate a pairing code." });
    } finally {
      setBusy("");
    }
  }

  async function revokeConnector() {
    if (!connector) return;
    setBusy("revoke");
    setActionMessage(null);
    try {
      const response = await fetch("/api/connectors/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId: connector.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not revoke the connector.");
      setActionMessage({ ok: true, text: "Connector revoked. Generate a new pairing code to connect again." });
      await onChanged();
    } catch (error) {
      setActionMessage({ ok: false, text: error instanceof Error ? error.message : "Could not revoke the connector." });
    } finally {
      setBusy("");
    }
  }

  const connectorState = connector?.status === "revoked"
    ? "Revoked"
    : connector?.online
      ? "Online"
      : connector
        ? "Waiting for heartbeat"
        : "Not paired";

  return (
    <TallyPairingCard
      company={company}
      connector={connector}
      syncJobs={syncJobs}
      busy={busy}
      pairing={pairing}
      copied={copied}
      actionMessage={actionMessage}
      connectorState={connectorState}
      syncing={syncing}
      onGeneratePairingCode={generatePairingCode}
      onRevokeConnector={revokeConnector}
      onCopyPairingCode={() => {
        if (!pairing?.pairingCode) return;
        navigator.clipboard?.writeText(pairing.pairingCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
