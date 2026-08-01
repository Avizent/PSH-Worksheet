/**
 * Reconciles duplicate budget lines.
 *
 * The FY26 load ran as two operations: the first created the budget lines with
 * their plans, the second created a *second* set of lines carrying the actuals
 * instead of matching the ones already there. The result is pairs of lines that
 * look identical to the user but split one real budget line's money across two
 * rows — plan on one, spend on the other — so the remaining figure is wrong on
 * both. In two cases (Marcaria domain, Early Careers Event) all copies carry
 * money, which double-counts the headline totals.
 *
 * This merges each group back onto its oldest row.
 *
 *   Dry run (default):  pnpm --filter @workspace/scripts reconcile-dupes
 *   Apply:              pnpm --filter @workspace/scripts reconcile-dupes --commit
 *
 * Needs DATABASE_URL, same as the other scripts here.
 *
 * Safety:
 *  - Dry run prints every decision and changes nothing.
 *  - --commit writes a full JSON backup of every affected table first, then
 *    does all the work in ONE transaction.
 *  - Where a slot (line, month, year) exists on both the keeper and a duplicate
 *    with DIFFERENT amounts, the script cannot know which is right. It refuses
 *    to guess: that whole group is skipped and reported for you to resolve.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  forecastPlansTable,
  csvImportRowsTable,
  eventsTable,
  alertsTable,
} from "@workspace/db";

const COMMIT = process.argv.includes("--commit");
const YEAR = 2026;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKUP_DIR = path.join(repoRoot, "scripts", "backups");

type Line = typeof budgetLinesTable.$inferSelect;
type PlanRow = typeof monthlyPlansTable.$inferSelect;
type ActualRow = typeof monthlyActualsTable.$inferSelect;

/** Case- and whitespace-insensitive, so "19th March" and "19th march" group together. */
function groupKey(line: Line): string {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(line.category)}||${norm(line.lineItem)}`;
}

/**
 * Looser key that also ignores punctuation — the same rule the CSV importer
 * uses to decide two rows are "the same line". Used only to REPORT likely
 * pairs ("Video case study" vs "Video - Case Study"), never to merge them:
 * dropping punctuation can put genuinely different lines in one bucket, and
 * that is not a call a script should make about someone's budget.
 */
function fuzzyKey(line: Line): string {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${norm(line.category)}||${norm(line.lineItem)}`;
}

function money(n: number): string {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** True when the keeper's field is empty and the duplicate has something better. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * What to do with one (line, month, year) slot on a duplicate row.
 *
 *  move           keeper has no row here → hand it over
 *  fill-keeper    keeper has an explicit 0 and the duplicate has a real figure
 *  drop-empty     duplicate holds 0, which is absence of data, not a rival figure
 *  drop-identical both hold the same non-zero figure → this is the double-count
 *  conflict       both hold DIFFERENT non-zero figures → only a human can say
 *
 * The zero handling matters: the second load wrote an explicit 0 for all twelve
 * months on every line it created, so treating 0 as a competing value would
 * mark every group conflicted and reconcile nothing.
 */
interface SlotDecision {
  table: "plans" | "actuals";
  month: number;
  year: number;
  action: "move" | "fill-keeper" | "drop-empty" | "drop-identical" | "conflict";
  fromId: number;
  amount: number;
  keeperAmount?: number;
}

interface GroupPlan {
  key: string;
  category: string;
  lineItem: string;
  keeper: Line;
  duplicates: Line[];
  decisions: SlotDecision[];
  metadataFills: string[];
  conflicts: SlotDecision[];
}

async function main(): Promise<void> {
  const lines = await db.select().from(budgetLinesTable);
  const plans = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.year, YEAR));
  const actuals = await db.select().from(monthlyActualsTable).where(eq(monthlyActualsTable.year, YEAR));

  const plansByLine = new Map<number, PlanRow[]>();
  for (const p of plans) {
    const list = plansByLine.get(p.budgetLineId) ?? [];
    list.push(p);
    plansByLine.set(p.budgetLineId, list);
  }
  const actualsByLine = new Map<number, ActualRow[]>();
  for (const a of actuals) {
    const list = actualsByLine.get(a.budgetLineId) ?? [];
    list.push(a);
    actualsByLine.set(a.budgetLineId, list);
  }

  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = groupKey(line);
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const planned: GroupPlan[] = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.id - b.id);
    const keeper = sorted[0];
    const duplicates = sorted.slice(1);

    const decisions: SlotDecision[] = [];
    const conflicts: SlotDecision[] = [];
    const metadataFills: string[] = [];

    // Slot maps for the keeper, updated as we claim slots so two duplicates
    // cannot both move into the same month.
    const keeperPlanSlots = new Map<string, number>();
    for (const p of plansByLine.get(keeper.id) ?? []) {
      keeperPlanSlots.set(`${p.month}|${p.year}`, Number(p.plannedAmount));
    }
    const keeperActualSlots = new Map<string, number>();
    for (const a of actualsByLine.get(keeper.id) ?? []) {
      keeperActualSlots.set(`${a.month}|${a.year}`, Number(a.actualAmount));
    }

    /** Shared rule for a plan or actual slot. Mutates the keeper's slot map. */
    function decide(
      table: "plans" | "actuals",
      month: number,
      year: number,
      amount: number,
      fromId: number,
      keeperSlots: Map<string, number>,
    ): void {
      const slot = `${month}|${year}`;
      const existing = keeperSlots.get(slot);
      const base = { table, month, year, fromId, amount } as const;

      if (existing === undefined) {
        if (amount === 0) {
          decisions.push({ ...base, action: "drop-empty" });
          return;
        }
        decisions.push({ ...base, action: "move" });
        keeperSlots.set(slot, amount);
        return;
      }
      if (amount === 0) {
        decisions.push({ ...base, action: "drop-empty" });
        return;
      }
      if (existing === 0) {
        decisions.push({ ...base, action: "fill-keeper", keeperAmount: existing });
        keeperSlots.set(slot, amount);
        return;
      }
      if (existing === amount) {
        decisions.push({ ...base, action: "drop-identical" });
        return;
      }
      const c: SlotDecision = { ...base, action: "conflict", keeperAmount: existing };
      decisions.push(c);
      conflicts.push(c);
    }

    for (const dup of duplicates) {
      for (const p of plansByLine.get(dup.id) ?? []) {
        decide("plans", p.month, p.year, Number(p.plannedAmount), dup.id, keeperPlanSlots);
      }
      for (const a of actualsByLine.get(dup.id) ?? []) {
        decide("actuals", a.month, a.year, Number(a.actualAmount), dup.id, keeperActualSlots);
      }

      // The later rows often carry owner/region the originals lack.
      for (const field of ["owner", "region", "costStatus", "channel", "subcategory"] as const) {
        if (isBlank(keeper[field]) && !isBlank(dup[field])) {
          metadataFills.push(`${field} = ${JSON.stringify(dup[field])} (from #${dup.id})`);
        }
      }
    }

    planned.push({
      key,
      category: keeper.category,
      lineItem: keeper.lineItem,
      keeper,
      duplicates,
      decisions,
      metadataFills,
      conflicts,
    });
  }

  // ─── Report ────────────────────────────────────────────────────────────────

  const grandPlanBefore = plans.reduce((s, p) => s + Number(p.plannedAmount), 0);
  const grandActualBefore = actuals.reduce((s, a) => s + Number(a.actualAmount), 0);

  console.log(`\nMode: ${COMMIT ? "COMMIT (will write)" : "DRY RUN (no changes)"}`);
  console.log(`Budget lines: ${lines.length}   Duplicate groups: ${planned.length}`);
  console.log(`Totals now:   plan ${money(grandPlanBefore)}   actual ${money(grandActualBefore)}\n`);

  let droppedPlan = 0;
  let droppedActual = 0;
  const skipped: GroupPlan[] = [];

  for (const g of planned) {
    const status = g.conflicts.length > 0 ? "SKIPPED (needs your decision)" : "will merge";
    console.log(`── ${g.category} | ${g.lineItem}  [${status}]`);
    console.log(`   keep  #${g.keeper.id}  owner=${JSON.stringify(g.keeper.owner)} costStatus=${JSON.stringify(g.keeper.costStatus)}`);
    for (const d of g.duplicates) {
      console.log(`   merge #${d.id}  owner=${JSON.stringify(d.owner)} costStatus=${JSON.stringify(d.costStatus)}`);
    }
    let emptyDropped = 0;
    for (const d of g.decisions) {
      const slot = `${d.table} ${d.year}-${String(d.month).padStart(2, "0")}`;
      if (d.action === "move") {
        console.log(`     move          ${slot}  ${money(d.amount)}  (from #${d.fromId})`);
      } else if (d.action === "fill-keeper") {
        console.log(`     fill zero     ${slot}  ${money(d.amount)}  (from #${d.fromId}, keeper had 0)`);
      } else if (d.action === "drop-empty") {
        emptyDropped++;
      } else if (d.action === "drop-identical") {
        console.log(`     drop dup      ${slot}  ${money(d.amount)}  (from #${d.fromId}, keeper already has the same figure)`);
        if (d.table === "plans") droppedPlan += g.conflicts.length ? 0 : d.amount;
        else droppedActual += g.conflicts.length ? 0 : d.amount;
      } else {
        console.log(`     CONFLICT      ${slot}  keeper ${money(d.keeperAmount ?? 0)} vs #${d.fromId} ${money(d.amount)}`);
      }
    }
    if (emptyDropped > 0) {
      console.log(`     drop empty    ${emptyDropped} zero-amount row(s) carrying no data`);
    }
    for (const f of g.metadataFills) console.log(`     fill blank    ${f}`);
    if (g.conflicts.length > 0) skipped.push(g);
    console.log();
  }

  // Pairs that only match once punctuation is ignored. Not merged — flagged.
  const fuzzyGroups = new Map<string, Line[]>();
  for (const line of lines) {
    const k = fuzzyKey(line);
    const list = fuzzyGroups.get(k) ?? [];
    list.push(line);
    fuzzyGroups.set(k, list);
  }
  const nearDupes = [...fuzzyGroups.values()].filter(
    (members) => members.length > 1 && new Set(members.map(groupKey)).size > 1,
  );
  if (nearDupes.length > 0) {
    console.log("─".repeat(70));
    console.log(`NOT MERGED — ${nearDupes.length} pair(s) that differ only by punctuation.`);
    console.log(`These look like the same line but are too fuzzy to merge automatically.`);
    console.log(`Rename one to match the other exactly, then re-run:\n`);
    for (const members of nearDupes) {
      for (const m of members) {
        const plan = (plansByLine.get(m.id) ?? []).reduce((s, p) => s + Number(p.plannedAmount), 0);
        const actual = (actualsByLine.get(m.id) ?? []).reduce((s, a) => s + Number(a.actualAmount), 0);
        console.log(`   #${m.id}  ${m.category} | ${m.lineItem}   plan ${money(plan)}   spent ${money(actual)}`);
      }
      console.log();
    }
  }

  console.log("─".repeat(70));
  console.log(`Groups to merge: ${planned.length - skipped.length}`);
  console.log(`Groups skipped:  ${skipped.length}`);
  console.log(`Double-counting removed:  plan ${money(droppedPlan)}   actual ${money(droppedActual)}`);
  console.log(`Totals after:             plan ${money(grandPlanBefore - droppedPlan)}   actual ${money(grandActualBefore - droppedActual)}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped groups keep both rows and are unchanged. Resolve the conflicting`);
    console.log(`months by hand (decide which figure is right), then re-run.`);
  }

  if (!COMMIT) {
    console.log(`\nDry run — nothing was written. Re-run with --commit to apply.\n`);
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────────────

  const toApply = planned.filter((g) => g.conflicts.length === 0);
  if (toApply.length === 0) {
    console.log(`\nNothing to apply.\n`);
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `pre-reconcile-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        year: YEAR,
        budgetLines: lines,
        monthlyPlans: plans,
        monthlyActuals: actuals,
      },
      null,
      2,
    ),
  );
  console.log(`\nBackup written: ${backupPath}`);

  await db.transaction(async (tx) => {
    for (const g of toApply) {
      const dupIds = g.duplicates.map((d) => d.id);

      for (const d of g.decisions) {
        if (d.table === "plans") {
          const t = monthlyPlansTable;
          const where = and(eq(t.budgetLineId, d.fromId), eq(t.month, d.month), eq(t.year, d.year));
          if (d.action === "move") {
            await tx.update(t).set({ budgetLineId: g.keeper.id }).where(where);
          } else if (d.action === "fill-keeper") {
            await tx
              .update(t)
              .set({ plannedAmount: d.amount })
              .where(and(eq(t.budgetLineId, g.keeper.id), eq(t.month, d.month), eq(t.year, d.year)));
            await tx.delete(t).where(where);
          } else if (d.action === "drop-identical" || d.action === "drop-empty") {
            await tx.delete(t).where(where);
          }
        } else {
          const t = monthlyActualsTable;
          const where = and(eq(t.budgetLineId, d.fromId), eq(t.month, d.month), eq(t.year, d.year));
          if (d.action === "move") {
            await tx.update(t).set({ budgetLineId: g.keeper.id }).where(where);
          } else if (d.action === "fill-keeper") {
            await tx
              .update(t)
              .set({ actualAmount: d.amount })
              .where(and(eq(t.budgetLineId, g.keeper.id), eq(t.month, d.month), eq(t.year, d.year)));
            await tx.delete(t).where(where);
          } else if (d.action === "drop-identical" || d.action === "drop-empty") {
            await tx.delete(t).where(where);
          }
        }
      }

      // Fill blanks on the keeper from the duplicates.
      const patch: Record<string, unknown> = {};
      for (const dup of g.duplicates) {
        for (const field of ["owner", "region", "costStatus", "channel", "subcategory"] as const) {
          if (isBlank(g.keeper[field]) && !isBlank(dup[field]) && patch[field] === undefined) {
            patch[field] = dup[field];
          }
        }
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(budgetLinesTable).set(patch).where(eq(budgetLinesTable.id, g.keeper.id));
      }

      // Repoint everything else that references the duplicates, so deleting
      // them cannot cascade away real data or null out a live linkage.
      // forecast_plans and monthly_* cascade on delete; events and alerts are
      // SET NULL; csv_import_rows is NO ACTION and would raise instead.
      await tx.update(forecastPlansTable).set({ budgetLineId: g.keeper.id }).where(inArray(forecastPlansTable.budgetLineId, dupIds));
      await tx.update(csvImportRowsTable).set({ budgetLineId: g.keeper.id }).where(inArray(csvImportRowsTable.budgetLineId, dupIds));
      await tx.update(eventsTable).set({ budgetLineId: g.keeper.id }).where(inArray(eventsTable.budgetLineId, dupIds));
      await tx.update(alertsTable).set({ budgetLineId: g.keeper.id }).where(inArray(alertsTable.budgetLineId, dupIds));

      // Any remaining plan/actual rows on the duplicates are ones the keeper
      // already covers; the cascade removes them with the line.
      await tx.delete(budgetLinesTable).where(inArray(budgetLinesTable.id, dupIds));

      console.log(`  merged ${g.category} | ${g.lineItem} → #${g.keeper.id} (removed ${dupIds.join(", ")})`);
    }
  });

  const [after] = await db
    .select({
      plan: sql<string>`COALESCE((SELECT SUM(planned_amount) FROM monthly_plans WHERE year = ${YEAR}), 0)`,
      actual: sql<string>`COALESCE((SELECT SUM(actual_amount) FROM monthly_actuals WHERE year = ${YEAR}), 0)`,
      lines: sql<number>`(SELECT count(*) FROM budget_lines)`,
    })
    .from(budgetLinesTable)
    .limit(1);

  console.log(`\nDone. Budget lines: ${after.lines}`);
  console.log(`Totals now: plan ${money(Number(after.plan))}   actual ${money(Number(after.actual))}`);
  console.log(`Backup: ${backupPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFailed:", err);
    process.exit(1);
  });
