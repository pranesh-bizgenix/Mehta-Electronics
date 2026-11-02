import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createPairingCodeForOrg } from "@/lib/connectors/tally/connector-repo";
import { isSameOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access is required to generate a pairing code" }, { status: 403 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  try {
    const result = await createPairingCodeForOrg({
      orgId: user.orgId || "default",
      createdByEmail: user.email,
      createdByName: user.name,
    });

    return NextResponse.json({ ok: true, ...result }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to generate pairing code", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate a pairing code." },
      { status: 500 },
    );
  }
}
