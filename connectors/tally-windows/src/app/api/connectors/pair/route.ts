import { NextResponse } from "next/server";
import { z } from "zod";
import { connectorTokenConfigured, generateRefreshToken, hashSecret, issueConnectorAccessToken } from "@/lib/connectors/tally/connector-crypto";
import { historyYearsForOrg } from "@/lib/connectors/tally/connector-plan";
import { pairConnectorWithCode } from "@/lib/connectors/tally/connector-repo";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PairRequest = z.object({
  pairingCode: z.string().min(4).max(32),
  machineName: z.string().min(1).max(255),
  installationId: z.string().uuid(),
  agentVersion: z.string().min(1).max(100),
});

function apiBaseUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim() || url.host;
  const proto = forwardedProto || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`.replace(/\/$/, "");
}

export async function POST(request: Request) {
  if (!connectorTokenConfigured()) {
    return NextResponse.json({ error: "Connector pairing is not configured on the server." }, { status: 503 });
  }
  const parsed = PairRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pairing request", issues: parsed.error.flatten() }, { status: 400 });
  }
  const limited = rateLimit(`connector-pair:${clientIp(request)}:${parsed.data.pairingCode.trim().toUpperCase()}`, 12, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many pairing attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }

  try {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString();
    const connector = await pairConnectorWithCode({
      pairingCode: parsed.data.pairingCode,
      installationId: parsed.data.installationId,
      machineName: parsed.data.machineName.trim(),
      agentVersion: parsed.data.agentVersion.trim(),
      refreshTokenHash: hashSecret(refreshToken),
      refreshTokenExpiresAt,
    });
    const access = issueConnectorAccessToken({
      connectorId: connector.id,
      orgId: connector.orgId,
      installationId: connector.installationId,
      machineName: connector.machineName || parsed.data.machineName.trim(),
    });
    if (!access) {
      return NextResponse.json({ error: "Connector access token issuance is not configured on the server." }, { status: 503 });
    }
    const historyFinancialYears = await historyYearsForOrg(connector.orgId);
    return NextResponse.json({
      ok: true,
      connectorId: connector.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      apiBaseUrl: apiBaseUrl(request),
      syncIntervalSeconds: connector.syncIntervalSeconds,
      heartbeatIntervalSeconds: 60,
      historyFinancialYears,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Pairing failed",
    }, { status: 400 });
  }
}
