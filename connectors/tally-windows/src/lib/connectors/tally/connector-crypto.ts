import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

const DEV_CONNECTOR_TOKEN_SECRET = "dev-connector-token-secret-change-in-prod";
const PRODUCTION_SECRET_ENV_KEYS = [
  "CONNECTOR_TOKEN_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "JWT_SECRET",
  "DATABASE_URL",
] as const;

export type ConnectorProvider = "tally";

export interface ConnectorAccessTokenClaims {
  kind: "connector-access";
  version: 1;
  provider: ConnectorProvider;
  connectorId: string;
  orgId: string;
  installationId: string;
  machineName: string;
  iat: number;
  exp: number;
}

function connectorTokenSecret(): string | null {
  if (process.env.NODE_ENV === "production") {
    for (const key of PRODUCTION_SECRET_ENV_KEYS) {
      const value = process.env[key]?.trim();
      if (value && value.length >= 32 && value !== DEV_CONNECTOR_TOKEN_SECRET) {
        return `${key}:${value}`;
      }
    }
    return null;
  }
  const value = process.env.CONNECTOR_TOKEN_SECRET?.trim();
  return value || DEV_CONNECTOR_TOKEN_SECRET;
}

function sign(body: string): string | null {
  const secret = connectorTokenSecret();
  return secret ? createHmac("sha256", secret).update(body).digest("base64url") : null;
}

export function connectorTokenConfigured(): boolean {
  return Boolean(connectorTokenSecret());
}

export function issueConnectorAccessToken(input: {
  connectorId: string;
  orgId: string;
  installationId: string;
  machineName: string;
  provider?: ConnectorProvider;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } | null {
  const ttlSeconds = Math.max(60, Math.min(input.ttlSeconds ?? 30 * 60, 60 * 60));
  const now = Math.floor(Date.now() / 1000);
  const claims: ConnectorAccessTokenClaims = {
    kind: "connector-access",
    version: 1,
    provider: input.provider ?? "tally",
    connectorId: input.connectorId,
    orgId: input.orgId,
    installationId: input.installationId,
    machineName: input.machineName,
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = sign(body);
  if (!mac) return null;
  return { token: `${body}.${mac}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export function verifyConnectorAccessToken(token: string): ConnectorAccessTokenClaims | null {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  if (!expected) return null;
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ConnectorAccessTokenClaims>;
    if (
      claims.kind !== "connector-access"
      || claims.version !== 1
      || claims.provider !== "tally"
      || typeof claims.connectorId !== "string"
      || typeof claims.orgId !== "string"
      || typeof claims.installationId !== "string"
      || typeof claims.machineName !== "string"
      || typeof claims.iat !== "number"
      || typeof claims.exp !== "number"
    ) {
      return null;
    }
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims as ConnectorAccessTokenClaims;
  } catch {
    return null;
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generatePairingCode(): string {
  const digits = Array.from(randomBytes(6)).map((byte) => String(byte % 10)).join("").slice(0, 6);
  return `BGX-${digits}`;
}

export function generateRefreshToken(): string {
  return `ctr_r_${randomBytes(32).toString("base64url")}`;
}

