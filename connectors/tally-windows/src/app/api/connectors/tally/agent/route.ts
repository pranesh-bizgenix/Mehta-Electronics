import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

// Legacy endpoint retained only so old UI callers fail closed instead of
// exposing org-scoped secrets. New installs must use pairing codes.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "Legacy org token installs are disabled. Generate a pairing code from Connections and pair the connector once on the Tally PC.",
  }, { status: 410 });
}
