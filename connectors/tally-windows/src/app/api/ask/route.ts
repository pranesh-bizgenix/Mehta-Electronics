import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getActiveDataset, getActiveWorkspaceScope } from "@/lib/store";
import { analyseBusiness } from "@/lib/analyst/engine";
import { narrateVerifiedAnswer } from "@/lib/analyst/narrator";
import type { AnalystIntent, AnalystResponse } from "@/lib/analyst/types";
import { loadBudgetPlan } from "@/lib/budget-plan/repo";
import { loadFundingPlan } from "@/lib/funding-plan/repo";
import { loadScenarioPlan } from "@/lib/scenario-plan/repo";
import { applyAnalystDomainGates } from "@/lib/reconciliation/domain-gates";
import { filterDatasetForOrgPlan } from "@/lib/connectors/tally/plan-window";
 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Intent = z.enum(["revenue", "products", "regions", "customers", "receivables", "payables", "inventory", "salary", "cash_movement", "profitability", "expenses", "budget", "procurement", "growth_bridge", "customer_momentum", "funding", "scenario"]);
const PriorPeriod = z.object({
  id: z.enum(["current_fy", "previous_fy", "all", "custom"]),
  label: z.string().max(120),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestFlowDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  flowFreshness: z.enum(["current", "stale", "missing"]),
  balanceLabel: z.string().max(120),
});
const Body = z.object({
  question: z.string().trim().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  period: z.enum(["current_fy", "previous_fy", "all"]).default("all"),
  context: z.object({ intents: z.array(Intent).max(4).optional(), period: PriorPeriod.optional() }).optional(),
});

declare global {
  // eslint-disable-next-line no-var
  var __gi_ask_limits: Map<string, { started: number; count: number }> | undefined;
}

function withinLimit(key: string) {
  const now = Date.now();
  const limits = (globalThis.__gi_ask_limits ??= new Map());
  const current = limits.get(key);
  if (!current || now - current.started >= 60_000) {
    limits.set(key, { started: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

function cacheHeaders() {
  return { "cache-control": "no-store", "x-content-type-options": "nosniff" };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cacheHeaders() });
  const data = await filterDatasetForOrgPlan(await getActiveDataset(), user.orgId);
  const salesDates = data.sales.map((row) => row.date).filter(Boolean).sort();
  return NextResponse.json({
    company: data.company,
    source: data.source ?? "connected dataset",
    asOf: data.asOf,
    latestSalesDate: salesDates.at(-1) ?? null,
    coverage: {
      sales: data.sales.length,
      bills: data.bills?.length ?? 0,
      vouchers: data.vouchers?.length ?? 0,
      ledgers: data.ledgers?.length ?? 0,
      inventory: data.inventory.length,
    },
    starters: [
      "How much trade receivable is overdue, and who should I chase first?",
      "Show cash movement from receipt and payment vouchers.",
      "How much payroll cost is visible in all available history?",
      "What is the latest supported sales period, and which products drove it?",
      "What can you support about inventory value, and what needs reconciling?",
      "Which costs are over plan, and where are supplier prices moving?",
      "Why did sales change, and which customers went quiet in the connected history?",
      "What is our debt position, finance-cost burden and refinancing opportunity?",
      "What does the approved cash, cost and funding scenario show?",
    ],
  }, { headers: cacheHeaders() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cacheHeaders() });
  if (!withinLimit(`${user.orgId}:${user.email}`)) return NextResponse.json({ error: "Too many analyst requests. Try again in a minute." }, { status: 429, headers: cacheHeaders() });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a question up to 2,000 characters.", issues: parsed.error.flatten() }, { status: 400, headers: cacheHeaders() });
  }

  const data = await filterDatasetForOrgPlan(await getActiveDataset(), user.orgId);
  const scope = await getActiveWorkspaceScope();
  const budgetPlan = await loadBudgetPlan(scope, data.asOf);
  const fundingPlan = await loadFundingPlan(scope);
  const scenarioPlan = await loadScenarioPlan(scope);
  const calculated = analyseBusiness(data, parsed.data.question, {
    period: parsed.data.period,
    budgetPlan,
    fundingPlan,
    scenarioPlan,
    previous: { intents: parsed.data.context?.intents as AnalystIntent[] | undefined, period: parsed.data.context?.period },
  });
  const base = applyAnalystDomainGates(data, calculated);
  const narrated = await narrateVerifiedAnswer(user.orgId, parsed.data.question, base);
  const response: AnalystResponse = {
    ...base,
    id: randomUUID(),
    conversationId: parsed.data.conversationId ?? randomUUID(),
    ...(narrated ? { answer: narrated, mode: "ai_narrated", ai: { used: true, role: "narrator", verified: true } } : {}),
  };
  return NextResponse.json(response, { headers: cacheHeaders() });
}
