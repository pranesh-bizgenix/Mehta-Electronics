import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getLatestConnectorForOrg, revokeConnector } from "@/lib/connectors/tally/connector-repo";
import { isSameOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RevokeRequest = z.object({
  connectorId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access is required to revoke a connector" }, { status: 403 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = RevokeRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid revoke request" }, { status: 400 });

  const current = parsed.data.connectorId
    ? { id: parsed.data.connectorId }
    : await getLatestConnectorForOrg(user.orgId || "default");
  if (!current?.id) {
    return NextResponse.json({ error: "No connector is available to revoke." }, { status: 404 });
  }

  const connector = await revokeConnector({
    connectorId: current.id,
    orgId: user.orgId || "default",
    actor: { type: "user", id: user.email, display: user.name },
    reason: parsed.data.reason?.trim() || "Revoked from the Connections page",
  });

  return NextResponse.json({ ok: true, connector });
}
