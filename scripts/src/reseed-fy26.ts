import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  ownersTable,
  categoriesTable,
  budgetLineColumnsTable,
  auditLogsTable,
} from "@workspace/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPREADSHEET_PATH = "/Users/richardpage/Dropbox/AAA Patricia/Marketing Budget Tracker 31JUL26.xlsx";
const YEAR = 2026;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

const COMMIT = process.argv.includes("--commit");

// Section-header rows: carry a stray GL code in the "Cost status" column and
// mark the start of a category. Not real budget lines.
const SECTION_HEADERS: Record<string, string> = {
  "Ads - planned spend": "Ads",
  "Marketing and Sales Software": "Marketing and Sales Software",
  "Other Costs for Marketing and PR": "Other Costs for Marketing and PR",
  "Marketing and PR - planned spend": "Marketing and PR",
  "Events and Conferences": "Events and Conferences",
};

// Subtotal/formula marker rows. Not real budget lines - used only for reconciliation.
const MARKER_ROWS = new Set(["Remaining spend", "Total Budget", "Total spent", "Delta"]);

type ParsedLine = {
  category: string;
  lineItem: string;
  owner: string | null;
  region: string | null;
  costStatus: string;
  monthly: (number | null)[]; // 12 entries, null = not yet populated by any occurrence
  notes: { month: number; text: string }[];
  duplicateFills: number; // count of months filled in from a later duplicate occurrence
};

function stripCurrency(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).replace(/[£$,]/g, "").trim();
  if (!s) return null;
  const val = parseFloat(s);
  return Number.isNaN(val) ? null : val;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type ParseResult = {
  lines: ParsedLine[];
  skipped: { row: number; label: string }[];
  freeformNotes: string[];
  sheetTotalBudgetByMonth: (number | null)[];
  sheetTotalSpentByMonth: (number | null)[];
};

function parseSheet(): ParseResult {
  const wb = XLSX.readFile(SPREADSHEET_PATH);
  const sheetName = wb.SheetNames[0];
  if (sheetName !== "FY26") {
    console.warn(`Warning: first sheet is "${sheetName}", expected "FY26". Proceeding anyway.`);
  }
  const ws = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const dataRows = rows.slice(1);

  let currentCategory = "Uncategorized";
  const linesByKey = new Map<string, ParsedLine>();
  const skipped: { row: number; label: string }[] = [];
  const freeformNotes: string[] = [];
  const sheetTotalBudgetByMonth: (number | null)[] = new Array(12).fill(null);
  const sheetTotalSpentByMonth: (number | null)[] = new Array(12).fill(null);

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    if (!r.some((c) => c !== null)) continue;

    const region = r[0] !== null ? String(r[0]).trim() : null;
    const costStatusRaw = r[1];
    const owner = r[2] !== null ? String(r[2]).trim() : null;
    const label = r[3] !== null ? String(r[3]).trim() : null;
    const monthCells = r.slice(4, 16);

    if (!label) {
      for (const cell of monthCells) {
        if (typeof cell === "string" && cell.trim()) freeformNotes.push(cell.trim());
      }
      continue;
    }

    if (label in SECTION_HEADERS) {
      currentCategory = SECTION_HEADERS[label];
      skipped.push({ row: i + 2, label: `[section header] ${label}` });
      continue;
    }

    if (MARKER_ROWS.has(label)) {
      if (label === "Total Budget") {
        monthCells.forEach((c, idx) => {
          const v = stripCurrency(c);
          if (v !== null) sheetTotalBudgetByMonth[idx] = v;
        });
      }
      if (label === "Total spent") {
        monthCells.forEach((c, idx) => {
          const v = stripCurrency(c);
          if (v !== null) sheetTotalSpentByMonth[idx] = v;
        });
      }
      skipped.push({ row: i + 2, label: `[marker] ${label}` });
      continue;
    }

    const key = normalise(label);
    let entry = linesByKey.get(key);
    if (!entry) {
      const costStatusStr =
        typeof costStatusRaw === "string"
          ? costStatusRaw.trim()
          : costStatusRaw === null
            ? ""
            : String(costStatusRaw);
      // Guard: a stray numeric GL code (section-header leakage) should never
      // reach here since section headers are matched by label above, but
      // don't let a bare number become a fake cost status either way.
      const costStatus = costStatusStr && !/^\d+(\.\d+)?$/.test(costStatusStr) ? costStatusStr : "Variable";

      entry = {
        category: currentCategory,
        lineItem: label,
        owner: owner || null,
        region: region || null,
        costStatus,
        monthly: new Array(12).fill(null),
        notes: [],
        duplicateFills: 0,
      };
      linesByKey.set(key, entry);
    }

    monthCells.forEach((cell, idx) => {
      if (cell === null || cell === "") return;
      const num = stripCurrency(cell);
      if (num === null) {
        entry!.notes.push({ month: idx + 1, text: String(cell) });
        return;
      }
      if (entry!.monthly[idx] === null) {
        entry!.monthly[idx] = num;
      } else {
        entry!.duplicateFills += 1;
      }
    });
  }

  const lines = [...linesByKey.values()];
  return { lines, skipped, freeformNotes, sheetTotalBudgetByMonth, sheetTotalSpentByMonth };
}

// Figures in this spreadsheet (and the app's chosen base currency) are SEK,
// not GBP - despite earlier analysis in this session assuming GBP from
// context. The raw cells carry no currency symbol at all; formatted here as
// "kr" (Swedish convention) rather than "£" to avoid mislabeling.
function fmt(n: number): string {
  return `${n.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
}

async function main(): Promise<void> {
  console.log(`Reading ${SPREADSHEET_PATH}`);
  const parsed = parseSheet();

  const monthlyTotals = new Array(12).fill(0);
  let grandTotal = 0;
  for (const line of parsed.lines) {
    for (let m = 0; m < 12; m++) {
      const v = line.monthly[m] ?? 0;
      monthlyTotals[m] += v;
      grandTotal += v;
    }
  }

  console.log(`\nParsed ${parsed.lines.length} real budget lines.`);
  console.log(`Skipped ${parsed.skipped.length} subtotal/section-header rows:`);
  for (const s of parsed.skipped) console.log(`  row ${s.row}: ${s.label}`);

  console.log(`\n--- Per-category breakdown ---`);
  const byCategory = new Map<string, ParsedLine[]>();
  for (const l of parsed.lines) {
    const arr = byCategory.get(l.category) ?? [];
    arr.push(l);
    byCategory.set(l.category, arr);
  }
  for (const [cat, lines] of byCategory) {
    const catTotal = lines.reduce((s, l) => s + l.monthly.reduce<number>((a, v) => a + (v ?? 0), 0), 0);
    console.log(`\n${cat} — ${fmt(catTotal)}`);
    for (const l of lines) {
      const total = l.monthly.reduce<number>((a, v) => a + (v ?? 0), 0);
      console.log(
        `  - ${l.lineItem} | owner=${l.owner ?? "-"} region=${l.region ?? "-"} status=${l.costStatus} | ${fmt(total)}`,
      );
    }
  }

  // The sheet's own "Total Budget" row is a formula-computed rollup, not raw
  // data - and an independent formula-level audit (Reconciliation Review,
  // see below) confirmed it has real bugs: at least one category subtotal's
  // SUM range silently excludes a real line item ("Pot") for three months.
  // This parser sums each real line item's actual cell values directly, so
  // it isn't subject to that bug class - the comparison below is kept for
  // audit visibility, but is informational only and does not block --commit.
  console.log(`\n--- Reconciliation (vs sheet's own "Total Budget" row - informational only) ---`);
  let maxVariance = 0;
  for (let m = 0; m < 12; m++) {
    const sheetVal = parsed.sheetTotalBudgetByMonth[m];
    if (sheetVal === null) continue;
    const variance = monthlyTotals[m] - sheetVal;
    maxVariance = Math.max(maxVariance, Math.abs(variance));
    console.log(
      `  ${MONTH_LABELS[m]}: parsed ${fmt(monthlyTotals[m])} vs sheet ${fmt(sheetVal)} (variance ${fmt(variance)})`,
    );
  }
  console.log(`  Grand total: parsed ${fmt(grandTotal)}`);
  if (maxVariance >= 100) {
    console.log(
      `  Variance vs sheet total exists (max monthly ${fmt(maxVariance)}) - expected, per the documented formula bugs in the sheet's own SUM ranges (see Reconciliation Review doc). The parsed figures above are the ones trusted for import.`,
    );
  } else {
    console.log(`  Matches sheet total closely (max monthly variance ${fmt(maxVariance)}).`);
  }

  console.log(`\n--- NEEDS YOUR ATTENTION ---`);
  const attentionLines = parsed.lines.filter(
    (l) =>
      l.lineItem.includes("(") ||
      l.owner?.includes("/") ||
      l.costStatus === "Booked" ||
      /tbc|\?\?/i.test(l.lineItem),
  );
  if (attentionLines.length === 0) console.log("  (none)");
  for (const l of attentionLines) {
    console.log(`  - "${l.lineItem}" (owner=${l.owner ?? "-"}, status=${l.costStatus}) — review before committing`);
  }
  for (const l of parsed.lines) {
    for (const n of l.notes) {
      console.log(`  - "${l.lineItem}" ${MONTH_LABELS[n.month - 1]}: non-numeric cell "${n.text}" -> treated as 0 kr`);
    }
    if (l.duplicateFills > 0) {
      console.log(`  - "${l.lineItem}": ${l.duplicateFills} month(s) filled from a duplicate later occurrence`);
    }
  }
  if (parsed.freeformNotes.length > 0) {
    console.log(`  Freeform notes found elsewhere in the sheet:`);
    for (const n of parsed.freeformNotes) console.log(`    "${n}"`);
  }
  const ihrJune = parsed.lines.find((l) => normalise(l.lineItem).includes(normalise("IHR Recruitment Leaders June")));
  if (ihrJune) {
    console.log(
      `  - "IHR Recruitment Leaders June": per the Reconciliation Review, this is labelled June but its value sits in the May column - imported as May (matches the actual cell, not the label). Confirm this is correct.`,
    );
  }

  const spentLine = parsed.lines.find((l) => l.costStatus === "Spent");
  if (spentLine) {
    const spentMonth = spentLine.monthly.findIndex((v) => v !== null && v > 0);
    console.log(
      `\nOne line marked "Spent": "${spentLine.lineItem}" — ${fmt(spentLine.monthly[spentMonth] ?? 0)} in ${MONTH_LABELS[spentMonth]}. Will also be recorded as an actual.`,
    );
  }

  const [existingLines, existingPlans] = await Promise.all([
    db.select().from(budgetLinesTable),
    db.select().from(monthlyPlansTable),
  ]);
  const existingLineCount = existingLines.length;
  const existingTotal = existingPlans.reduce((s, p) => s + p.plannedAmount, 0);
  console.log(`\n--- Current database state (before vs after) ---`);
  console.log(`  Current: ${existingLineCount} budget lines, ${fmt(existingTotal)} total planned.`);
  console.log(`  New:     ${parsed.lines.length} budget lines, ${fmt(grandTotal)} total planned.`);
  console.log(`  (Current data will be fully replaced if --commit is used.)`);

  if (!COMMIT) {
    console.log(`\nDry run only — no changes written. Re-run with --commit to write.`);
    return;
  }

  console.log(`\n--commit passed. Taking a snapshot first...`);
  const snapshotId = await createPreReseedSnapshot();
  console.log(`  Snapshot saved: ${snapshotId}`);

  console.log(`Deleting existing monthly_actuals, monthly_plans, budget_lines...`);
  await db.delete(monthlyActualsTable);
  await db.delete(monthlyPlansTable);
  await db.delete(budgetLinesTable);

  console.log(`Inserting ${parsed.lines.length} budget lines...`);
  let plansInserted = 0;
  let actualsInserted = 0;
  for (const line of parsed.lines) {
    const [created] = await db
      .insert(budgetLinesTable)
      .values({
        category: line.category,
        lineItem: line.lineItem,
        owner: line.owner,
        region: line.region,
        costStatus: line.costStatus,
      })
      .returning();

    for (let m = 0; m < 12; m++) {
      await db.insert(monthlyPlansTable).values({
        budgetLineId: created.id,
        month: m + 1,
        year: YEAR,
        plannedAmount: line.monthly[m] ?? 0,
      });
      plansInserted++;
    }

    if (line.costStatus === "Spent") {
      const spentMonth = line.monthly.findIndex((v) => v !== null && v > 0);
      if (spentMonth >= 0) {
        await db.insert(monthlyActualsTable).values({
          budgetLineId: created.id,
          month: spentMonth + 1,
          year: YEAR,
          actualAmount: line.monthly[spentMonth] ?? 0,
        });
        actualsInserted++;
      }
    }
  }

  await db.insert(auditLogsTable).values({
    action: "bulk_reseed",
    entityType: "budget_lines",
    entityId: 0,
    field: "reseed_fy26",
    oldValue: `${existingLineCount} lines, ${fmt(existingTotal)} planned`,
    newValue: JSON.stringify({
      lines: parsed.lines.length,
      plans: plansInserted,
      actuals: actualsInserted,
      grandTotal,
      snapshotId,
    }),
  });

  console.log(`\nDone. ${parsed.lines.length} budget lines, ${plansInserted} monthly plans, ${actualsInserted} actuals.`);
  console.log(`Grand total: ${fmt(grandTotal)}`);
  console.log(`Restore point if needed: snapshot "${snapshotId}"`);
}

// Self-contained equivalent of artifacts/api-server/src/routes/snapshots.ts's
// createSnapshot() - not imported directly since that file lives in an
// Express-app package this script doesn't otherwise depend on. Writes to
// artifacts/desktop/snapshots, matching where the currently-running desktop
// app (launched via `pnpm exec electron .` from artifacts/desktop) looks for
// its own snapshots, so this snapshot shows up in the app's own restore UI.
async function createPreReseedSnapshot(): Promise<string> {
  const snapshotsDir = path.join(repoRoot, "artifacts", "desktop", "snapshots");
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const [budgetLines, monthlyPlans, monthlyActuals, owners, categories, budgetLineColumns] = await Promise.all([
    db.select().from(budgetLinesTable),
    db.select().from(monthlyPlansTable),
    db.select().from(monthlyActualsTable),
    db.select().from(ownersTable),
    db.select().from(categoriesTable),
    db.select().from(budgetLineColumnsTable),
  ]);

  const now = new Date();
  const ts = now.toISOString().slice(0, 19).replace(/:/g, "-");
  const id = `snapshot_${ts}_pre-reseed-fy26`;
  const snap = {
    id,
    label: "pre-reseed-fy26",
    createdAt: now.toISOString(),
    pinned: true,
    data: { budgetLines, monthlyPlans, monthlyActuals, owners, categories, budgetLineColumns },
  };
  fs.writeFileSync(path.join(snapshotsDir, `${id}.json`), JSON.stringify(snap, null, 2), "utf-8");
  return id;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
