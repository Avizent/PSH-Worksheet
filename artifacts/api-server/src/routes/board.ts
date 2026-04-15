import { Router, type IRouter } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  boardSettingsTable,
  shareTokensTable,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  alertsTable,
  eventsTable,
} from "@workspace/db";
import {
  ListBoardSettingsResponse,
  UpdateBoardSettingsBody,
  UpdateBoardSettingsResponse,
  ListShareTokensResponse,
  CreateShareTokenBody,
  RevokeShareTokenParams,
  GetBoardViewQueryParams,
  GetBoardViewResponse,
  GetBoardPreviewResponse,
  ExportPdfQueryParams,
  ExportExcelQueryParams,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

const DEFAULT_SECTIONS = [
  { sectionKey: "kpi_total_budget", label: "Total Budget", sortOrder: 0 },
  { sectionKey: "kpi_spent_ytd", label: "Spent YTD", sortOrder: 1 },
  { sectionKey: "kpi_remaining", label: "Remaining", sortOrder: 2 },
  { sectionKey: "kpi_fixed_run_rate", label: "Fixed Run Rate", sortOrder: 3 },
  { sectionKey: "chart_plan_vs_actual", label: "Plan vs Actual (Monthly)", sortOrder: 4 },
  { sectionKey: "chart_cumulative", label: "Cumulative Spend vs Plan", sortOrder: 5 },
  { sectionKey: "chart_categories", label: "Category Breakdown", sortOrder: 6 },
  { sectionKey: "chart_projections", label: "Projections", sortOrder: 7 },
  { sectionKey: "section_alerts", label: "Active Alerts", sortOrder: 8 },
  { sectionKey: "section_events", label: "Upcoming Events", sortOrder: 9 },
];

async function ensureDefaultSettings() {
  const existing = await db.select().from(boardSettingsTable);
  if (existing.length === 0) {
    for (const s of DEFAULT_SECTIONS) {
      await db.insert(boardSettingsTable).values(s);
    }
    return db.select().from(boardSettingsTable).orderBy(boardSettingsTable.sortOrder);
  }
  return existing;
}

router.get("/board/settings", asyncHandler(async (_req, res): Promise<void> => {
  const settings = await ensureDefaultSettings();
  res.json(ListBoardSettingsResponse.parse(settings));
}));

router.put("/board/settings", asyncHandler(async (req, res): Promise<void> => {
  const bodyParsed = UpdateBoardSettingsBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  await ensureDefaultSettings();

  for (const item of bodyParsed.data) {
    await db.update(boardSettingsTable)
      .set({ visible: item.visible })
      .where(eq(boardSettingsTable.sectionKey, item.sectionKey));
  }

  const updated = await db.select().from(boardSettingsTable).orderBy(boardSettingsTable.sortOrder);
  res.json(UpdateBoardSettingsResponse.parse(updated));
}));

router.get("/board/tokens", asyncHandler(async (_req, res): Promise<void> => {
  const tokens = await db.select().from(shareTokensTable).orderBy(shareTokensTable.createdAt);
  res.json(ListShareTokensResponse.parse(tokens));
}));

router.post("/board/tokens", asyncHandler(async (req, res): Promise<void> => {
  const bodyParsed = CreateShareTokenBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const token = crypto.randomUUID();
  const [created] = await db.insert(shareTokensTable).values({
    token,
    label: bodyParsed.data.label || "Board Link",
    expiresAt: bodyParsed.data.expiresAt ? new Date(bodyParsed.data.expiresAt) : null,
  }).returning();

  res.status(201).json(created);
}));

router.patch("/board/tokens/:id/revoke", asyncHandler(async (req, res): Promise<void> => {
  const paramsParsed = RevokeShareTokenParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }

  const [updated] = await db.update(shareTokensTable)
    .set({ revoked: true })
    .where(eq(shareTokensTable.id, paramsParsed.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Token not found" });
    return;
  }

  res.json(updated);
}));

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function buildBoardViewData(year: number) {
  const settings = await ensureDefaultSettings();
  const visibleSections = settings.filter(s => s.visible).map(s => s.sectionKey);

  const [planTotal] = await db
    .select({ total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable)
    .where(eq(monthlyPlansTable.year, year));

  const [actualTotal] = await db
    .select({ total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
    .from(monthlyActualsTable)
    .where(eq(monthlyActualsTable.year, year));

  const fixedLines = await db.select({ id: budgetLinesTable.id }).from(budgetLinesTable)
    .where(eq(budgetLinesTable.costStatus, "Fixed Cost"));

  let fixedRunRate = 0;
  if (fixedLines.length > 0) {
    const fixedIds = fixedLines.map(l => l.id);
    const [fixedActuals] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)`,
        count: sql<number>`COUNT(DISTINCT ${monthlyActualsTable.month})`,
      })
      .from(monthlyActualsTable)
      .where(sql`${monthlyActualsTable.budgetLineId} IN (${sql.join(fixedIds.map(id => sql`${id}`), sql`, `)}) AND ${monthlyActualsTable.year} = ${year}`);
    fixedRunRate = Number(fixedActuals.total) / (Number(fixedActuals.count) || 1);
  }

  const [alertCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(alertsTable).where(isNull(alertsTable.resolvedAt));

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const monthsElapsed = year === now.getFullYear() ? currentMonth : (year < now.getFullYear() ? 12 : 0);
  const totalBudget = Number(planTotal.total);
  const spentYtd = Number(actualTotal.total);

  const summary = {
    totalBudget,
    spentYtd,
    remaining: totalBudget - spentYtd,
    fixedRunRate: Math.round(fixedRunRate * 100) / 100,
    activeAlerts: Number(alertCount.count),
    budgetUtilisation: totalBudget > 0 ? Math.round((spentYtd / totalBudget) * 10000) / 100 : 0,
    monthsElapsed,
    totalMonths: 12,
  };

  const monthlyPlanned = await db.select({ month: monthlyPlansTable.month, total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year)).groupBy(monthlyPlansTable.month);
  const monthlyActual = await db.select({ month: monthlyActualsTable.month, total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
    .from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year)).groupBy(monthlyActualsTable.month);

  const plannedMap = new Map(monthlyPlanned.map(r => [r.month, Number(r.total)]));
  const actualMap = new Map(monthlyActual.map(r => [r.month, Number(r.total)]));

  let cumPlanned = 0, cumActual = 0;
  const monthly = [];
  for (let m = 1; m <= 12; m++) {
    const p = plannedMap.get(m) || 0;
    const a = actualMap.get(m) || 0;
    cumPlanned += p;
    cumActual += a;
    monthly.push({ month: m, monthLabel: MONTH_LABELS[m - 1], planned: p, actual: a, cumPlanned, cumActual });
  }

  const categoryData = await db.select({ category: budgetLinesTable.category })
    .from(budgetLinesTable).groupBy(budgetLinesTable.category);
  const categories = [];
  for (const cat of categoryData) {
    const blIds = await db.select({ id: budgetLinesTable.id }).from(budgetLinesTable).where(eq(budgetLinesTable.category, cat.category));
    const ids = blIds.map(b => b.id);
    if (ids.length === 0) continue;
    const [cp] = await db.select({ total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
      .from(monthlyPlansTable).where(sql`${monthlyPlansTable.budgetLineId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND ${monthlyPlansTable.year} = ${year}`);
    const [ca] = await db.select({ total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
      .from(monthlyActualsTable).where(sql`${monthlyActualsTable.budgetLineId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND ${monthlyActualsTable.year} = ${year}`);
    categories.push({ category: cat.category, planned: Number(cp.total), actual: Number(ca.total) });
  }

  const charts = { monthly, categories };

  const alerts = await db.select().from(alertsTable).where(isNull(alertsTable.resolvedAt));
  const events = await db.select().from(eventsTable);

  const allBudgetLines = await db.select().from(budgetLinesTable);
  const allPlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const allActuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));

  const projectionItems = allBudgetLines.map(bl => {
    const plans = allPlans.filter(p => p.budgetLineId === bl.id);
    const actuals = allActuals.filter(a => a.budgetLineId === bl.id);
    const planMap = new Map(plans.map(p => [p.month, Number(p.plannedAmount)]));
    const actualMap = new Map(actuals.map(a => [a.month, Number(a.actualAmount)]));

    let lastActual: number | null = null;
    for (let m = 1; m <= 12; m++) {
      if (actualMap.has(m)) lastActual = actualMap.get(m)!;
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const planned = planMap.get(m) || 0;
      const actual = actualMap.has(m) ? actualMap.get(m)! : null;
      let projected: number | null = null;
      if (bl.costStatus === "Fixed Cost" && m > currentMonth && lastActual !== null) {
        projected = lastActual * (1 + (bl.projectionPct || 0) / 100);
      }
      months.push({ month: m, planned, actual, projected });
    }

    return {
      budgetLineId: bl.id,
      lineItem: bl.lineItem,
      category: bl.category,
      costStatus: bl.costStatus,
      projectionPct: bl.projectionPct || 0,
      months,
    };
  });

  return {
    summary,
    charts,
    alerts,
    events,
    projections: { year, items: projectionItems },
    visibleSections,
  };
}

async function validateToken(tokenStr: string): Promise<boolean> {
  const [tokenRow] = await db.select().from(shareTokensTable)
    .where(and(eq(shareTokensTable.token, tokenStr), eq(shareTokensTable.revoked, false)));

  if (!tokenRow) return false;
  if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) return false;
  return true;
}

router.get("/board/view", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = GetBoardViewQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const valid = await validateToken(queryParsed.data.token);
  if (!valid) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const data = await buildBoardViewData(2026);
  res.json(GetBoardViewResponse.parse(data));
}));

router.get("/board/preview", asyncHandler(async (_req, res): Promise<void> => {
  const data = await buildBoardViewData(2026);
  res.json(GetBoardPreviewResponse.parse(data));
}));

router.get("/exports/pdf", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ExportPdfQueryParams.safeParse(req.query);
  if (queryParsed.data?.token) {
    const valid = await validateToken(queryParsed.data.token);
    if (!valid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  }

  const data = await buildBoardViewData(2026);
  const visible = new Set(data.visibleSections);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hubert Marketing Budget - Board Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a2e; background: #fff; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
  .kpi { flex: 1; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; }
  .kpi-value { font-size: 22px; font-weight: 700; }
  .kpi-label { font-size: 11px; color: #6b7280; text-transform: uppercase; margin-top: 4px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #f0f0f0; }
  th { background: #f9fafb; font-weight: 600; }
  .alert-row { padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .badge-critical { background: #fee2e2; color: #dc2626; }
  .badge-warning { background: #fef3c7; color: #d97706; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>Hubert Marketing Budget</h1>
<p class="subtitle">FY2026 Board Report \u2014 Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>

<div class="kpi-row">
${visible.has("kpi_total_budget") ? `<div class="kpi"><div class="kpi-value">\u00a3${(data.summary.totalBudget / 1000000).toFixed(2)}M</div><div class="kpi-label">Total Budget</div></div>` : ""}
${visible.has("kpi_spent_ytd") ? `<div class="kpi"><div class="kpi-value">\u00a3${(data.summary.spentYtd / 1000).toFixed(1)}k</div><div class="kpi-label">Spent YTD</div></div>` : ""}
${visible.has("kpi_remaining") ? `<div class="kpi"><div class="kpi-value">\u00a3${(data.summary.remaining / 1000000).toFixed(2)}M</div><div class="kpi-label">Remaining</div></div>` : ""}
${visible.has("kpi_fixed_run_rate") ? `<div class="kpi"><div class="kpi-value">\u00a3${(data.summary.fixedRunRate / 1000).toFixed(1)}k</div><div class="kpi-label">Fixed Run Rate /mo</div></div>` : ""}
</div>

${visible.has("chart_plan_vs_actual") ? `
<div class="section">
  <div class="section-title">Plan vs Actual (Monthly)</div>
  <table>
    <tr><th>Month</th><th>Planned</th><th>Actual</th><th>Variance</th></tr>
    ${data.charts.monthly.map(m => `<tr><td>${m.monthLabel}</td><td>\u00a3${Number(m.planned).toLocaleString("en-GB")}</td><td>\u00a3${Number(m.actual).toLocaleString("en-GB")}</td><td>${m.planned > 0 ? ((Number(m.actual) - Number(m.planned)) / Number(m.planned) * 100).toFixed(1) + "%" : "-"}</td></tr>`).join("\n    ")}
  </table>
</div>` : ""}

${visible.has("chart_categories") ? `
<div class="section">
  <div class="section-title">Category Breakdown</div>
  <table>
    <tr><th>Category</th><th>Planned</th><th>Actual</th><th>Utilisation</th></tr>
    ${data.charts.categories.map(c => `<tr><td>${c.category}</td><td>\u00a3${Number(c.planned).toLocaleString("en-GB")}</td><td>\u00a3${Number(c.actual).toLocaleString("en-GB")}</td><td>${Number(c.planned) > 0 ? ((Number(c.actual) / Number(c.planned)) * 100).toFixed(0) + "%" : "-"}</td></tr>`).join("\n    ")}
  </table>
</div>` : ""}

${visible.has("section_alerts") ? `
<div class="section">
  <div class="section-title">Active Alerts (${data.alerts.length})</div>
  ${data.alerts.map(a => `<div class="alert-row"><span class="badge ${a.severity === "critical" ? "badge-critical" : "badge-warning"}">${a.severity.toUpperCase()}</span> ${a.message}</div>`).join("\n  ")}
</div>` : ""}

${visible.has("section_events") ? `
<div class="section">
  <div class="section-title">Marketing Events</div>
  <table>
    <tr><th>Event</th><th>Date</th><th>Status</th><th>Est. Cost</th></tr>
    ${data.events.map(e => `<tr><td>${e.name}</td><td>${e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB") : "-"}</td><td>${e.status}</td><td>${e.estimatedCost ? "\u00a3" + Number(e.estimatedCost).toLocaleString("en-GB") : "-"}</td></tr>`).join("\n    ")}
  </table>
</div>` : ""}

</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.setHeader("Content-Disposition", 'attachment; filename="hubert-board-report.html"');
  res.send(html);
}));

router.get("/exports/excel", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ExportExcelQueryParams.safeParse(req.query);
  if (queryParsed.data?.token) {
    const valid = await validateToken(queryParsed.data.token);
    if (!valid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  }

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const budgetLines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, 2026));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, 2026));

  const sheet = workbook.addWorksheet("FY2026 Budget Tracker");

  const headerRow = ["Category", "Line Item", "Owner", "Cost Status"];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const ml of monthLabels) { headerRow.push(`${ml} Plan`, `${ml} Actual`); }
  headerRow.push("Total Plan", "Total Actual", "Variance");

  sheet.addRow(headerRow);
  const hRow = sheet.getRow(1);
  hRow.font = { bold: true, size: 10 };
  hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e3a5f" } };
  hRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };

  for (const bl of budgetLines) {
    const row: (string | number)[] = [bl.category, bl.lineItem, bl.owner || "", bl.costStatus];
    let totalPlan = 0, totalActual = 0;
    for (let m = 1; m <= 12; m++) {
      const p = plans.find(p => p.budgetLineId === bl.id && p.month === m);
      const a = actuals.find(a => a.budgetLineId === bl.id && a.month === m);
      const pv = p ? Number(p.plannedAmount) : 0;
      const av = a ? Number(a.actualAmount) : 0;
      totalPlan += pv;
      totalActual += av;
      row.push(pv, av);
    }
    row.push(totalPlan, totalActual, totalActual - totalPlan);
    sheet.addRow(row);
  }

  for (let i = 1; i <= sheet.columnCount; i++) {
    const col = sheet.getColumn(i);
    col.width = i <= 4 ? 18 : 12;
    if (i > 4) {
      col.numFmt = '#,##0';
    }
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="hubert-fy2026-budget.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}));

export default router;
