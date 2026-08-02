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
import { resolveExportCurrency } from "../lib/exportCurrency";
import { requireVpAuth, vpLogin, isValidVpSession } from "../middleware/vpAuth";
import { writeAuditLog } from "../middleware/auditLog";
import { isValidUserSession } from "./userAuth";

const router: IRouter = Router();

router.post("/auth/vp-login", vpLogin);

const DEFAULT_SECTIONS = [
  { sectionKey: "kpi_total_budget", label: "Total Budget", sortOrder: 0 },
  { sectionKey: "kpi_spent_ytd", label: "Spent YTD", sortOrder: 1 },
  { sectionKey: "kpi_remaining", label: "Remaining", sortOrder: 2 },
  { sectionKey: "kpi_fixed_run_rate", label: "Fixed Run Rate", sortOrder: 3 },
  { sectionKey: "chart_plan_vs_actual", label: "Plan vs Actual (Monthly)", sortOrder: 4 },
  { sectionKey: "chart_cumulative", label: "Cumulative Spend vs Plan", sortOrder: 5 },
  { sectionKey: "chart_categories", label: "Category Breakdown", sortOrder: 6 },
  { sectionKey: "chart_channels", label: "Channel Breakdown", sortOrder: 7 },
  { sectionKey: "chart_projections", label: "Projections", sortOrder: 8 },
  { sectionKey: "section_alerts", label: "Active Alerts", sortOrder: 9 },
  { sectionKey: "section_events", label: "Upcoming Events", sortOrder: 10 },
];

async function ensureDefaultSettings() {
  for (const s of DEFAULT_SECTIONS) {
    await db.insert(boardSettingsTable).values(s).onConflictDoNothing();
  }
  return db.select().from(boardSettingsTable).orderBy(boardSettingsTable.sortOrder);
}

router.get("/board/settings", requireVpAuth, asyncHandler(async (_req, res): Promise<void> => {
  const settings = await ensureDefaultSettings();
  res.json(ListBoardSettingsResponse.parse(settings));
}));

router.put("/board/settings", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
  const bodyParsed = UpdateBoardSettingsBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  await ensureDefaultSettings();

  for (const item of bodyParsed.data) {
    const [existing] = await db.select().from(boardSettingsTable).where(eq(boardSettingsTable.sectionKey, item.sectionKey));
    await db.update(boardSettingsTable)
      .set({ visible: item.visible })
      .where(eq(boardSettingsTable.sectionKey, item.sectionKey));
    if (existing && existing.visible !== item.visible) {
      await writeAuditLog({
        action: "update",
        entityType: "board_setting",
        entityId: existing.id,
        field: "visible",
        oldValue: String(existing.visible),
        newValue: String(item.visible),
      });
    }
  }

  const updated = await db.select().from(boardSettingsTable).orderBy(boardSettingsTable.sortOrder);
  res.json(UpdateBoardSettingsResponse.parse(updated));
}));

router.get("/board/tokens", requireVpAuth, asyncHandler(async (_req, res): Promise<void> => {
  const tokens = await db.select().from(shareTokensTable).orderBy(shareTokensTable.createdAt);
  res.json(ListShareTokensResponse.parse(tokens));
}));

router.post("/board/tokens", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
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

  await writeAuditLog({
    action: "create",
    entityType: "share_token",
    entityId: created.id,
    field: "label",
    newValue: created.label,
  });

  res.status(201).json(created);
}));

router.patch("/board/tokens/:id/revoke", requireVpAuth, asyncHandler(async (req, res): Promise<void> => {
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

  await writeAuditLog({
    action: "update",
    entityType: "share_token",
    entityId: updated.id,
    field: "revoked",
    oldValue: "false",
    newValue: "true",
  });

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

  const allBudgetLinesForCh = await db.select().from(budgetLinesTable);
  const normalizeChannel = (c: string | null): string => c && c.length > 0 ? c : "unassigned";
  const plansAll = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const actualsAll = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));
  const blChMap = new Map(allBudgetLinesForCh.map(b => [b.id, normalizeChannel(b.channel)]));
  const planByCh = new Map<string, number>();
  const actualByCh = new Map<string, number>();
  for (const p of plansAll) {
    const ch = blChMap.get(p.budgetLineId) ?? "unassigned";
    planByCh.set(ch, (planByCh.get(ch) ?? 0) + Number(p.plannedAmount));
  }
  for (const a of actualsAll) {
    const ch = blChMap.get(a.budgetLineId) ?? "unassigned";
    actualByCh.set(ch, (actualByCh.get(ch) ?? 0) + Number(a.actualAmount));
  }
  const channelKeys = new Set<string>([...planByCh.keys(), ...actualByCh.keys()]);
  const channels = Array.from(channelKeys).sort().map(ch => ({
    channel: ch,
    planned: planByCh.get(ch) ?? 0,
    actual: actualByCh.get(ch) ?? 0,
  }));

  const charts = { monthly, categories, channels };

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

function filterByVisibility(data: Awaited<ReturnType<typeof buildBoardViewData>>) {
  const visible = new Set(data.visibleSections);
  return {
    summary: {
      totalBudget: visible.has("kpi_total_budget") ? data.summary.totalBudget : 0,
      spentYtd: visible.has("kpi_spent_ytd") ? data.summary.spentYtd : 0,
      remaining: visible.has("kpi_remaining") ? data.summary.remaining : 0,
      fixedRunRate: visible.has("kpi_fixed_run_rate") ? data.summary.fixedRunRate : 0,
      activeAlerts: visible.has("section_alerts") ? data.summary.activeAlerts : 0,
      budgetUtilisation: visible.has("kpi_spent_ytd") ? data.summary.budgetUtilisation : 0,
      monthsElapsed: data.summary.monthsElapsed,
      totalMonths: data.summary.totalMonths,
    },
    charts: {
      monthly: visible.has("chart_plan_vs_actual") || visible.has("chart_cumulative") ? data.charts.monthly : [],
      categories: visible.has("chart_categories") ? data.charts.categories : [],
      channels: visible.has("chart_channels") ? data.charts.channels : [],
    },
    alerts: visible.has("section_alerts") ? data.alerts : [],
    events: visible.has("section_events") ? data.events : [],
    projections: visible.has("chart_projections") ? data.projections : { year: data.projections.year, items: [] },
    visibleSections: data.visibleSections,
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
  const filtered = filterByVisibility(data);
  res.json(GetBoardViewResponse.parse(filtered));
}));

router.get("/board/preview", requireVpAuth, asyncHandler(async (_req, res): Promise<void> => {
  const data = await buildBoardViewData(2026);
  res.json(GetBoardPreviewResponse.parse(data));
}));

router.get("/exports/pdf", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ExportPdfQueryParams.safeParse(req.query);
  const hasToken = !!queryParsed.data?.token;
  const vpSession = req.headers["x-vp-session"] as string | undefined;
  const hasVpSession = !!vpSession && isValidVpSession(vpSession);
  const userSession = req.headers["x-user-session"] as string | undefined;
  const hasUserSession = !!userSession && isValidUserSession(userSession);
  if (hasToken) {
    const valid = await validateToken(queryParsed.data!.token!);
    if (!valid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  } else if (!hasVpSession && !hasUserSession) {
    res.status(401).json({ error: "Authentication required" }); return;
  }

  const data = await buildBoardViewData(2026);
  const visible = new Set(data.visibleSections);

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="hubert-board-report.pdf"');
  doc.pipe(res);

  const money = await resolveExportCurrency(req.query.currency);
  const fmt = money.format;

  doc.fontSize(22).font("Helvetica-Bold").text("Hubert Marketing Budget", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(11).font("Helvetica").fillColor("#6b7280")
    .text(`FY2026 Board Report \u2014 Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, { align: "center" });
  if (money.conversionNote) {
    doc.fontSize(8).font("Helvetica-Oblique").fillColor("#6b7280").text(money.conversionNote, { align: "center" });
  }
  doc.moveDown(1);
  doc.fillColor("#1a1a2e");

  const kpis: { label: string; value: string; key: string }[] = [
    { key: "kpi_total_budget", label: "TOTAL BUDGET", value: fmt(data.summary.totalBudget) },
    { key: "kpi_spent_ytd", label: "SPENT YTD", value: fmt(data.summary.spentYtd) },
    { key: "kpi_remaining", label: "REMAINING", value: fmt(data.summary.remaining) },
    { key: "kpi_fixed_run_rate", label: "FIXED RUN RATE /MO", value: fmt(data.summary.fixedRunRate) },
  ];
  const visibleKpis = kpis.filter(k => visible.has(k.key));
  if (visibleKpis.length > 0) {
    const kpiW = (doc.page.width - 80 - (visibleKpis.length - 1) * 12) / visibleKpis.length;
    const startY = doc.y;
    visibleKpis.forEach((k, i) => {
      const x = 40 + i * (kpiW + 12);
      doc.rect(x, startY, kpiW, 50).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
      doc.fontSize(16).font("Helvetica-Bold").fillColor("#1a1a2e").text(k.value, x + 10, startY + 10, { width: kpiW - 20 });
      doc.fontSize(8).font("Helvetica").fillColor("#6b7280").text(k.label, x + 10, startY + 32, { width: kpiW - 20 });
    });
    doc.y = startY + 60;
    doc.fillColor("#1a1a2e");
  }

  const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
    const tableX = 40;
    const rowH = 18;
    let y = doc.y;
    doc.rect(tableX, y, colWidths.reduce((a, b) => a + b, 0), rowH).fill("#f3f4f6");
    let cx = tableX;
    headers.forEach((h, i) => {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#374151").text(h, cx + 4, y + 5, { width: colWidths[i] - 8 });
      cx += colWidths[i];
    });
    y += rowH;
    for (const row of rows) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
      cx = tableX;
      row.forEach((cell, i) => {
        doc.fontSize(8).font("Helvetica").fillColor("#1a1a2e").text(cell, cx + 4, y + 4, { width: colWidths[i] - 8 });
        cx += colWidths[i];
      });
      doc.moveTo(tableX, y + rowH - 1).lineTo(tableX + colWidths.reduce((a, b) => a + b, 0), y + rowH - 1).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
      y += rowH;
    }
    doc.y = y + 8;
  };

  if (visible.has("chart_plan_vs_actual")) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Plan vs Actual (Monthly)");
    doc.moveDown(0.3);
    const colW = [80, 100, 100, 100, 135];
    drawTable(
      ["Month", "Planned", "Actual", "Variance", "Var %"],
      data.charts.monthly.map(m => [
        m.monthLabel,
        fmt(Number(m.planned)),
        fmt(Number(m.actual)),
        fmt(Number(m.actual) - Number(m.planned)),
        Number(m.planned) > 0 ? ((Number(m.actual) - Number(m.planned)) / Number(m.planned) * 100).toFixed(1) + "%" : "-",
      ]),
      colW,
    );
  }

  if (visible.has("chart_categories")) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Category Breakdown");
    doc.moveDown(0.3);
    drawTable(
      ["Category", "Planned", "Actual", "Utilisation"],
      data.charts.categories.map(c => [
        c.category,
        fmt(Number(c.planned)),
        fmt(Number(c.actual)),
        Number(c.planned) > 0 ? ((Number(c.actual) / Number(c.planned)) * 100).toFixed(0) + "%" : "-",
      ]),
      [160, 110, 110, 135],
    );
  }

  if (visible.has("chart_channels") && data.charts.channels.length > 0) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Channel Breakdown");
    doc.moveDown(0.3);
    drawTable(
      ["Channel", "Planned", "Actual", "Utilisation"],
      data.charts.channels.map(c => [
        c.channel.charAt(0).toUpperCase() + c.channel.slice(1),
        fmt(Number(c.planned)),
        fmt(Number(c.actual)),
        Number(c.planned) > 0 ? ((Number(c.actual) / Number(c.planned)) * 100).toFixed(0) + "%" : "-",
      ]),
      [160, 110, 110, 135],
    );
  }

  if (visible.has("section_alerts") && data.alerts.length > 0) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text(`Active Alerts (${data.alerts.length})`);
    doc.moveDown(0.3);
    for (const a of data.alerts) {
      const sevColor = a.severity === "critical" ? "#dc2626" : "#d97706";
      doc.fontSize(8).font("Helvetica-Bold").fillColor(sevColor).text(a.severity.toUpperCase(), { continued: true });
      doc.font("Helvetica").fillColor("#1a1a2e").text("  " + a.message);
      doc.moveDown(0.2);
    }
  }

  if (visible.has("section_events") && data.events.length > 0) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Marketing Events");
    doc.moveDown(0.3);
    drawTable(
      ["Event", "Date", "Status", "Est. Cost"],
      data.events.map(e => [
        e.name,
        e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB") : "TBD",
        e.status,
        e.estimatedCost ? fmt(Number(e.estimatedCost)) : "-",
      ]),
      [180, 100, 90, 145],
    );
  }

  doc.moveDown(1);
  doc.fontSize(8).font("Helvetica").fillColor("#9ca3af").text("Hubert Marketing \u00b7 Confidential", { align: "center" });

  doc.end();
}));

router.get("/exports/reports-pdf", asyncHandler(async (req, res): Promise<void> => {
  const userSession = req.headers["x-user-session"] as string | undefined;
  const vpSession = req.headers["x-vp-session"] as string | undefined;
  const hasUser = !!userSession && isValidUserSession(userSession);
  const hasVp = !!vpSession && isValidVpSession(vpSession);
  if (!hasUser && !hasVp) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const year = 2026;
  const data = await buildBoardViewData(year);

  const ownerPlanned = await db
    .select({ owner: budgetLinesTable.owner, total: sql<number>`COALESCE(SUM(${monthlyPlansTable.plannedAmount}), 0)` })
    .from(budgetLinesTable)
    .leftJoin(monthlyPlansTable, sql`${monthlyPlansTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyPlansTable.year} = ${year}`)
    .groupBy(budgetLinesTable.owner);
  const ownerActual = await db
    .select({ owner: budgetLinesTable.owner, total: sql<number>`COALESCE(SUM(${monthlyActualsTable.actualAmount}), 0)` })
    .from(budgetLinesTable)
    .leftJoin(monthlyActualsTable, sql`${monthlyActualsTable.budgetLineId} = ${budgetLinesTable.id} AND ${monthlyActualsTable.year} = ${year}`)
    .groupBy(budgetLinesTable.owner);
  const ownerActualMap = new Map(ownerActual.map(o => [o.owner, Number(o.total)]));
  const owners = ownerPlanned
    .map(o => ({ owner: o.owner || "Unknown", planned: Number(o.total), actual: ownerActualMap.get(o.owner) ?? 0 }))
    .sort((a, b) => b.planned - a.planned);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const allLines = await db.select().from(budgetLinesTable);
  const allPlans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, year));
  const allActuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, year));
  const mirLines = allLines.map(bl => {
    const mp = allPlans.find(p => p.budgetLineId === bl.id && p.month === currentMonth);
    const ma = allActuals.find(a => a.budgetLineId === bl.id && a.month === currentMonth);
    const planned = mp ? Number(mp.plannedAmount) : 0;
    const actual = ma ? Number(ma.actualAmount) : 0;
    return { lineItem: bl.lineItem, category: bl.category, planned, actual, variance: actual - planned };
  }).filter(l => l.planned > 0 || l.actual > 0).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const money = await resolveExportCurrency(req.query.currency);
  const fmt = money.format;
  const fmtPct = (a: number, p: number) => p > 0 ? ((a / p) * 100).toFixed(0) + "%" : "-";
  const varPct = (a: number, p: number) => p > 0 ? ((a - p) / p * 100).toFixed(1) + "%" : "-";

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="hubert-marketing-reports.pdf"');
  doc.pipe(res);

  const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
    const tableX = 40;
    const rowH = 18;
    let y = doc.y;
    doc.rect(tableX, y, colWidths.reduce((a, b) => a + b, 0), rowH).fill("#f3f4f6");
    let cx = tableX;
    headers.forEach((h, i) => {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#374151").text(h, cx + 4, y + 5, { width: colWidths[i] - 8 });
      cx += colWidths[i];
    });
    y += rowH;
    for (const row of rows) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
      cx = tableX;
      row.forEach((cell, i) => {
        doc.fontSize(8).font("Helvetica").fillColor("#1a1a2e").text(cell, cx + 4, y + 4, { width: colWidths[i] - 8 });
        cx += colWidths[i];
      });
      doc.moveTo(tableX, y + rowH - 1).lineTo(tableX + colWidths.reduce((a, b) => a + b, 0), y + rowH - 1).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
      y += rowH;
    }
    doc.y = y + 8;
  };

  const MONTH_LABELS_PDF = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const genDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  doc.fontSize(22).font("Helvetica-Bold").text("Hubert Marketing Budget", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(11).font("Helvetica").fillColor("#6b7280")
    .text(`FY${year} Reports — Generated ${genDate}`, { align: "center" });
  if (money.conversionNote) {
    doc.fontSize(8).font("Helvetica-Oblique").fillColor("#6b7280").text(money.conversionNote, { align: "center" });
  }
  doc.moveDown(1);
  doc.fillColor("#1a1a2e");

  const kpis = [
    { label: "TOTAL BUDGET", value: fmt(data.summary.totalBudget) },
    { label: "SPENT YTD", value: fmt(data.summary.spentYtd) },
    { label: "REMAINING", value: fmt(data.summary.remaining) },
    { label: "UTILISATION", value: data.summary.budgetUtilisation.toFixed(1) + "%" },
  ];
  const kpiW = (doc.page.width - 80 - (kpis.length - 1) * 12) / kpis.length;
  const kpiY = doc.y;
  kpis.forEach((k, i) => {
    const x = 40 + i * (kpiW + 12);
    doc.rect(x, kpiY, kpiW, 50).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#1a1a2e").text(k.value, x + 10, kpiY + 10, { width: kpiW - 20 });
    doc.fontSize(8).font("Helvetica").fillColor("#6b7280").text(k.label, x + 10, kpiY + 32, { width: kpiW - 20 });
  });
  doc.y = kpiY + 60;
  doc.fillColor("#1a1a2e");

  doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Monthly Plan vs Actual");
  doc.moveDown(0.3);
  drawTable(
    ["Month", "Planned", "Actual", "Variance", "Var %", "Utilisation"],
    data.charts.monthly.map(m => [
      MONTH_LABELS_PDF[m.month - 1],
      fmt(Number(m.planned)),
      fmt(Number(m.actual)),
      fmt(Number(m.actual) - Number(m.planned)),
      varPct(Number(m.actual), Number(m.planned)),
      fmtPct(Number(m.actual), Number(m.planned)),
    ]),
    [55, 85, 85, 85, 60, 75],
  );

  doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Category Breakdown");
  doc.moveDown(0.3);
  drawTable(
    ["Category", "Planned", "Actual", "Variance", "Utilisation"],
    data.charts.categories.map(c => [
      c.category,
      fmt(Number(c.planned)),
      fmt(Number(c.actual)),
      fmt(Number(c.actual) - Number(c.planned)),
      fmtPct(Number(c.actual), Number(c.planned)),
    ]),
    [155, 95, 95, 95, 105],
  );

  if (owners.length > 0) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Owner Breakdown");
    doc.moveDown(0.3);
    drawTable(
      ["Owner", "Planned", "Actual", "Variance", "Utilisation"],
      owners.map(o => [
        o.owner,
        fmt(o.planned),
        fmt(o.actual),
        fmt(o.actual - o.planned),
        fmtPct(o.actual, o.planned),
      ]),
      [155, 95, 95, 95, 105],
    );
  }

  if (data.charts.channels.length > 0) {
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text("Channel Breakdown");
    doc.moveDown(0.3);
    drawTable(
      ["Channel", "Planned", "Actual", "Variance", "Utilisation"],
      data.charts.channels.map(c => [
        c.channel.charAt(0).toUpperCase() + c.channel.slice(1),
        fmt(Number(c.planned)),
        fmt(Number(c.actual)),
        fmt(Number(c.actual) - Number(c.planned)),
        fmtPct(Number(c.actual), Number(c.planned)),
      ]),
      [155, 95, 95, 95, 105],
    );
  }

  if (mirLines.length > 0) {
    const mirMonthName = MONTH_LABELS_PDF[currentMonth - 1];
    const mirTotalPlanned = mirLines.reduce((s, l) => s + l.planned, 0);
    const mirTotalActual = mirLines.reduce((s, l) => s + l.actual, 0);
    doc.moveDown(0.5).fontSize(13).font("Helvetica-Bold").fillColor("#1a1a2e").text(`${mirMonthName} in Review — Top Variances`);
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#6b7280")
      .text(`${mirMonthName} total: Planned ${fmt(mirTotalPlanned)} · Actual ${fmt(mirTotalActual)} · Variance ${fmt(mirTotalActual - mirTotalPlanned)} (${varPct(mirTotalActual, mirTotalPlanned)})`);
    doc.moveDown(0.4);
    drawTable(
      ["Line Item", "Category", "Planned", "Actual", "Variance", "Var %"],
      mirLines.slice(0, 15).map(l => [
        l.lineItem,
        l.category,
        fmt(l.planned),
        fmt(l.actual),
        fmt(l.variance),
        varPct(l.actual, l.planned),
      ]),
      [160, 80, 75, 75, 75, 80],
    );
  }

  doc.moveDown(1);
  doc.fontSize(8).font("Helvetica").fillColor("#9ca3af").text("Hubert Marketing · Confidential · Reports Export", { align: "center" });
  doc.end();
}));

router.get("/exports/excel", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = ExportExcelQueryParams.safeParse(req.query);
  const hasToken = !!queryParsed.data?.token;
  const vpSession = req.headers["x-vp-session"] as string | undefined;
  const hasVpSession = !!vpSession && isValidVpSession(vpSession);
  const userSession = req.headers["x-user-session"] as string | undefined;
  const hasUserSession = !!userSession && isValidUserSession(userSession);
  if (hasToken) {
    const valid = await validateToken(queryParsed.data!.token!);
    if (!valid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  } else if (!hasVpSession && !hasUserSession) {
    res.status(401).json({ error: "Authentication required" }); return;
  }

  const ExcelJS = (await import("exceljs")).default;
  // Read from req.query directly: ExportExcelQueryParams doesn't declare
  // `currency`, so the parsed object drops it. The board screen sends the same
  // ?currency= to this route and to /exports/pdf, and until now only the PDF
  // honoured it — the two downloads disagreed by the exchange rate.
  const money = await resolveExportCurrency(req.query.currency);
  const workbook = new ExcelJS.Workbook();

  const budgetLines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, 2026));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, 2026));

  const currentMonth = new Date().getMonth() + 1;

  const sheet = workbook.addWorksheet("FY2026 Budget Tracker");

  const headerRow = ["Category", "Line Item", "Owner", "Cost Status", "Projection %"];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const ml of monthLabels) { headerRow.push(`${ml} Plan`, `${ml} Actual`, `${ml} Projected`); }
  headerRow.push("Total Plan", "Total Actual", "Total Projected", "Variance (Actual)", "Variance (Projected)");

  sheet.addRow(headerRow);
  const hRow = sheet.getRow(1);
  hRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  hRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e3a5f" } };

  for (const bl of budgetLines) {
    const blPlans = plans.filter(p => p.budgetLineId === bl.id);
    const blActuals = actuals.filter(a => a.budgetLineId === bl.id);
    const planMap = new Map(blPlans.map(p => [p.month, Number(p.plannedAmount)]));
    const actualMap = new Map(blActuals.map(a => [a.month, Number(a.actualAmount)]));

    let lastActual: number | null = null;
    for (let m = 1; m <= 12; m++) {
      if (actualMap.has(m)) lastActual = actualMap.get(m)!;
    }

    const row: (string | number)[] = [bl.category, bl.lineItem, bl.owner || "", bl.costStatus, bl.projectionPct || 0];
    let totalPlan = 0, totalActual = 0, totalProjected = 0;
    for (let m = 1; m <= 12; m++) {
      const pv = planMap.get(m) || 0;
      const av = actualMap.get(m) || 0;
      let proj = 0;
      if (bl.costStatus === "Fixed Cost" && m > currentMonth && lastActual !== null) {
        proj = lastActual * (1 + (bl.projectionPct || 0) / 100);
      } else if (actualMap.has(m)) {
        proj = av;
      }
      totalPlan += pv;
      totalActual += av;
      totalProjected += proj;
      row.push(pv, av, proj);
    }
    row.push(totalPlan, totalActual, totalProjected, totalActual - totalPlan, totalProjected - totalPlan);
    // Columns 1-4 are text and column 5 is a percentage; everything from 6 on
    // is money and has to be converted, same as the PDF sibling route.
    sheet.addRow(row.map((cell, i) => (i >= 5 && typeof cell === "number" ? money.convert(cell) : cell)));
  }

  for (let i = 1; i <= sheet.columnCount; i++) {
    const col = sheet.getColumn(i);
    col.width = i <= 4 ? 18 : (i === 5 ? 12 : 11);
    if (i > 5) {
      col.numFmt = money.numFmt;
    } else if (i === 5) {
      col.numFmt = "0.0";
    }
  }

  if (money.conversionNote) {
    const note = sheet.addRow([money.conversionNote]);
    note.font = { italic: true, size: 10 };
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="hubert-fy2026-budget.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}));

export default router;
