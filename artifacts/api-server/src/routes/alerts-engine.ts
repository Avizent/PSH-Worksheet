import { Router, type IRouter } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  alertsTable,
  eventsTable,
} from "@workspace/db";
import { EvaluateAlertsQueryParams, EvaluateAlertsResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

interface AlertCandidate {
  type: string;
  severity: string;
  message: string;
  month: number | null;
  year: number | null;
  budgetLineId: number | null;
}

const router: IRouter = Router();

router.post("/alerts/evaluate", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = EvaluateAlertsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year ?? 2026;

  const now = new Date();
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : (year < now.getFullYear() ? 12 : 0);

  const lines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));
  const events = await db.select().from(eventsTable);

  const candidates: AlertCandidate[] = [];

  for (const line of lines) {
    const linePlans = plans.filter(p => p.budgetLineId === line.id);
    const lineActuals = actuals.filter(a => a.budgetLineId === line.id);
    const planByMonth = new Map(linePlans.map(p => [p.month, Number(p.plannedAmount)]));
    const actualByMonth = new Map(lineActuals.map(a => [a.month, Number(a.actualAmount)]));

    for (let m = 1; m <= currentMonth; m++) {
      const plan = planByMonth.get(m) ?? 0;
      const actual = actualByMonth.get(m) ?? 0;
      if (plan <= 0) continue;

      const ratio = actual / plan;

      if (ratio < 0.7 && m < currentMonth) {
        candidates.push({
          type: "underspend",
          severity: "warning",
          message: `${line.lineItem}: spent only ${Math.round(ratio * 100)}% of plan in month ${m}`,
          month: m,
          year,
          budgetLineId: line.id,
        });
      }

      if (ratio > 1.1) {
        candidates.push({
          type: "overspend",
          severity: "critical",
          message: `${line.lineItem}: overspent by ${Math.round((ratio - 1) * 100)}% in month ${m}`,
          month: m,
          year,
          budgetLineId: line.id,
        });
      }
    }

    const totalPlan = linePlans.reduce((s, p) => s + Number(p.plannedAmount), 0);
    const totalActual = lineActuals.reduce((s, a) => s + Number(a.actualAmount), 0);
    const remaining = totalPlan - totalActual;

    if (totalPlan > 0 && remaining / totalPlan < 0.15) {
      const pctRemaining = Math.round((remaining / totalPlan) * 100);
      candidates.push({
        type: "budget_exhaustion",
        severity: "critical",
        message: remaining <= 0
          ? `${line.lineItem}: budget fully exhausted (${pctRemaining}% remaining)`
          : `${line.lineItem}: only ${pctRemaining}% budget remaining`,
        month: null,
        year,
        budgetLineId: line.id,
      });
    }

    if (line.costStatus === "Fixed Cost") {
      const sortedActuals = lineActuals
        .filter(a => a.month <= currentMonth)
        .sort((a, b) => a.month - b.month);

      for (let i = 1; i < sortedActuals.length; i++) {
        const prev = Number(sortedActuals[i - 1].actualAmount);
        const curr = Number(sortedActuals[i].actualAmount);
        if (prev > 0) {
          const variance = Math.abs(curr - prev) / prev;
          if (variance > 0.05) {
            candidates.push({
              type: "fixed_cost_variance",
              severity: "warning",
              message: `${line.lineItem}: fixed cost varied ${Math.round(variance * 100)}% between months ${sortedActuals[i - 1].month} and ${sortedActuals[i].month}`,
              month: sortedActuals[i].month,
              year,
              budgetLineId: line.id,
            });
          }
        }
      }
    }
  }

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 60);
  for (const line of lines) {
    const linePlans = plans.filter(p => p.budgetLineId === line.id);
    for (const plan of linePlans) {
      if (Number(plan.plannedAmount) > 200000) {
        const paymentDate = new Date(year, plan.month - 1, 15);
        if (paymentDate > now && paymentDate <= futureDate) {
          candidates.push({
            type: "large_payment",
            severity: "warning",
            message: `${line.lineItem}: large planned payment of £${(Number(plan.plannedAmount) / 1000).toFixed(0)}k in month ${plan.month}`,
            month: plan.month,
            year,
            budgetLineId: line.id,
          });
        }
      }
    }
  }

  const daysThreshold = new Date();
  daysThreshold.setDate(daysThreshold.getDate() + 45);
  for (const evt of events) {
    if (evt.eventDate && evt.status === "Planned") {
      const eventDate = new Date(evt.eventDate);
      if (eventDate <= daysThreshold && eventDate > now) {
        candidates.push({
          type: "unbooked_event",
          severity: "warning",
          message: `Event "${evt.name}" is within 45 days but still in Planned status`,
          month: eventDate.getMonth() + 1,
          year: eventDate.getFullYear(),
          budgetLineId: evt.budgetLineId,
        });
      }
    }
  }

  const existingAlerts = await db
    .select()
    .from(alertsTable)
    .where(isNull(alertsTable.resolvedAt));

  const dedupeKey = (type: string, budgetLineId: number | null, month: number | null, yr: number | null) =>
    `${type}|${budgetLineId ?? ""}|${month ?? ""}|${yr ?? ""}`;

  const existingKeys = new Set(
    existingAlerts.map(a => dedupeKey(a.type, a.budgetLineId, a.month, a.year))
  );

  let created = 0;
  let existing = 0;

  for (const candidate of candidates) {
    const key = dedupeKey(candidate.type, candidate.budgetLineId, candidate.month, candidate.year);

    if (existingKeys.has(key)) {
      existing++;
      continue;
    }

    existingKeys.add(key);

    await db.insert(alertsTable).values({
      type: candidate.type,
      severity: candidate.severity,
      message: candidate.message,
      month: candidate.month,
      year: candidate.year,
      budgetLineId: candidate.budgetLineId,
    });
    created++;
  }

  res.json(EvaluateAlertsResponse.parse({
    evaluated: candidates.length,
    created,
    existing,
  }));
}));

export default router;
