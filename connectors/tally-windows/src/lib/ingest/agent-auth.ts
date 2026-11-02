import { timingSafeEqual } from "crypto";
import { findConnectorById } from "@/lib/connectors/tally/connector-repo";
import { verifyConnectorAccessToken } from "@/lib/connectors/tally/connector-crypto";
import { agentTokenForOrg } from "@/lib/security";

export interface AuthenticatedAgentRequest {
  orgId: string;
  connectorId: string | null;
  installationId: string | null;
  machineName: string | null;
  legacy: boolean;
  error?: { status: number; message: string };
}

export async function authenticateAgent(req: Request): Promise<AuthenticatedAgentRequest> {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    const claims = verifyConnectorAccessToken(bearer);
    if (!claims) {
      return {
        orgId: "",
        connectorId: null,
        installationId: null,
        machineName: null,
        legacy: false,
        error: { status: 401, message: "Invalid or expired connector access token" },
      };
    }
    const connector = await findConnectorById(claims.connectorId);
    if (!connector || connector.orgId !== claims.orgId || connector.status !== "active" || connector.revokedAt) {
      return {
        orgId: claims.orgId,
        connectorId: claims.connectorId,
        installationId: claims.installationId,
        machineName: claims.machineName,
        legacy: false,
        error: { status: 401, message: "Connector is not active" },
      };
    }
    if (connector.installationId !== claims.installationId) {
      return {
        orgId: claims.orgId,
        connectorId: claims.connectorId,
        installationId: claims.installationId,
        machineName: claims.machineName,
        legacy: false,
        error: { status: 401, message: "Connector installation does not match the token" },
      };
    }
    return {
      orgId: claims.orgId,
      connectorId: claims.connectorId,
      installationId: claims.installationId,
      machineName: claims.machineName,
      legacy: false,
    };
  }

  const orgId = (req.headers.get("x-gi-org") || "").trim();
  const expected = agentTokenForOrg(orgId);
  if (!expected) {
    return {
      orgId,
      connectorId: null,
      installationId: null,
      machineName: null,
      legacy: true,
      error: { status: 503, message: "Ingest is not configured or the organization id is missing." },
    };
  }
  const provided = req.headers.get("x-gi-token") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      orgId,
      connectorId: null,
      installationId: null,
      machineName: null,
      legacy: true,
      error: { status: 401, message: "Invalid or missing agent token" },
    };
  }
  return { orgId, connectorId: null, installationId: null, machineName: null, legacy: true };
}
