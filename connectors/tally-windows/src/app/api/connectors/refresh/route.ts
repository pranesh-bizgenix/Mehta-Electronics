import { NextResponse } from "next/server";
import { z } from "zod";
import { connectorTokenConfigured, generateRefreshToken, hashSecret, issueConnectorAccessToken } from "@/lib/connectors/tally/connector-crypto";
import { historyYearsForOrg } from "@/lib/connectors/tally/connector-plan";
import { findActiveRefreshToken, rotateRefreshToken } from "@/lib/connectors/tally/connector-repo";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RefreshRequest = z.object({
  refreshToken: z.string().min(20).max(256),
});

export async function POST(request: Request) {
  if (!connectorTokenConfigured()) {
    return NextResponse.json({ error: "Connector refresh is not configured on the server." }, { status: 503 });
  }
  const parsed = RefreshRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid refresh request" }, { status: 400 });
  }
  const limited = rateLimit(`connector-refresh:${clientIp(request)}`, 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many refresh attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }

  try {
    const { tokenId, connector } = await findActiveRefreshToken(parsed.data.refreshToken);
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString();
    await rotateRefreshToken({
      tokenId,
      connectorId: connector.id,
      orgId: connector.orgId,
      refreshTokenHash: hashSecret(refreshToken),
      refreshTokenExpiresAt,
    });
    const access = issueConnectorAccessToken({
      connectorId: connector.id,
      orgId: connector.orgId,
      installationId: connector.installationId,
      machineName: connector.machineName || "TALLY-PC",
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
      syncIntervalSeconds: connector.syncIntervalSeconds,
      heartbeatIntervalSeconds: 60,
      historyFinancialYears,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Refresh failed",
    }, { status: 401 });
  }
}

