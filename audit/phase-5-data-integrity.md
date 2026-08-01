# Phase 5 — Data Integrity Audit

Scope: `artifacts/api-server/src/**`, `lib/db/src/**`, with `lib/api-zod`, `lib/api-client-react` and spot checks of `artifacts/budget-tracker`.
Method: every file in `routes/`, `middleware/`, `lib/`, `lib/db/src/schema/` and every migration in `lib/db/drizzle/` was read in full. Findings-only — no code was modified.

---

## Summary

**What's solid.** The money-precision migration is genuinely done: no `real` columns remain anywhere in `lib/db/src/schema/` and migration `0005_oval_sunset_bain.sql` converts every monetary column to `numeric(14,2)` (rate to `numeric(12,6)`, projection to `numeric(7,4)`). Foreign keys are declared on every relationship with deliberate `onDelete` choices. Unique indexes on `monthly_plans` and `monthly_actuals` exist in both the schema and migration `0004`. SQL `SUM()` results are consistently wrapped in `Number(...)` in dashboard/analytics/charts/board, so no string-concatenation arithmetic. Snapshot restore and import-delete are both properly wrapped in `db.transaction`. Path-traversal guards are present on every snapshot-id route. The migration chain 0000→0006 is sequential, prevId-linked and contains no destructive `DROP`.

**What's not.** The integrity problems are concentrated in the write paths that touch the most money at once — startup seeding, Excel import/export, CSV import, rollover, and snapshot restore — and they are mostly *silent*: they produce wrong numbers rather than errors.

Three things stand out. First, `runStartupMigration` re-inserts seed budget lines on **every server restart** whenever a line's `lineItem|owner|region` no longer matches the hardcoded seed, so ordinary editing silently resurrects phantom budget lines with hardcoded figures. Second, the Excel round trip is not currency-safe: `/excel/export?currency=GBP` writes converted GBP numbers, and `/excel/import` unconditionally treats every number as SEK — a straight export→edit→import cycle divides the whole budget by the exchange rate. Third, `/excel/import` deletes **all** monthly plans and actuals for a line across **every year** before writing back only year 2026, so any prior-year history is destroyed by a routine re-import, with no transaction and no audit log entry.

Underneath those sit a set of structural gaps: `budget_lines` has no uniqueness on `(category, lineItem)` even though the Excel importer keys on exactly that pair (and the shipped seed data itself contains 8 duplicate line items); `monthly_actuals` enforces one row per line/month, which makes the common case of two invoices in one month un-importable; and the read-modify-write upsert pattern used for every plan/actual edit has no `onConflictDoUpdate`, while the client fires up to 12 of them in parallel.

Counts: **4 Critical, 9 High, 13 Medium, 6 Low.**

A note on scope overlap: several of the most destructive endpoints (`POST /seed`, `POST /imports/clear-all`, `POST /excel/import`, `POST /snapshots/:id/restore`) have no authentication middleware at all. Authentication itself is Phase 2's remit; this report covers only what those endpoints *do to the data* once reached.

---

## Critical

### P5-1 — Server restart silently resurrects deleted/edited budget lines with hardcoded figures

**Where:** `artifacts/api-server/src/lib/seedBudgetData.ts:597-651`, called unconditionally from `artifacts/api-server/src/index.ts:53`.

**What it does:** `runStartupMigration()` builds a key set from the live DB as `` `${lineItem}|${owner}|${region}` `` (line 601-603) and re-inserts any `SEED_LINES` entry whose key is absent, along with 12 hardcoded `monthlyPlans` rows and its hardcoded actuals:

```ts
const key = `${item.lineItem}|${item.owner}|${item.region}`;
if (existingKeys.has(key)) continue;
const [line] = await db.insert(budgetLinesTable).values({ ... }).returning();
```

The key deliberately excludes `category` and includes two freely-editable fields. The doc comment claims it is "Safe to run on every startup".

**Failure scenario:** The budget holder reassigns the *Adobe* line from owner `PH` to `JDT` (a one-field PATCH via `/budget-lines/:id`). Its key becomes `Adobe|JDT|Global`, so `Adobe|PH|Global` is now "missing". On the next restart — a deploy, a crash, or just closing the desktop app — a second *Adobe* line is inserted with owner `PH` and 12 seeded plan rows. `GET /dashboard/summary` sums `monthly_plans` unconditionally, so the total budget rises by the phantom line's annual plan. The same happens for any line the user renames or deletes outright: deletion is undone on the next boot. This directly violates the "baseline budget is read-only once set" standard, and the corruption compounds with every restart-after-edit.

**Fix:** Gate `runStartupMigration()` behind an explicit one-off flag (or drop it entirely now that `0000`–`0006` migrations exist); never re-derive "missing" rows from mutable user-editable fields.

---

### P5-2 — Excel export/import round trip is not currency-safe; a GBP export re-imported divides the budget by the rate

**Where:** export `artifacts/api-server/src/routes/excel.ts:48,173-177`; import `artifacts/api-server/src/routes/excel.ts:840-855`; client `artifacts/budget-tracker/app/(tabs)/excel.tsx:122`.

**What it does:** The export converts every monetary cell out of stored SEK when `?currency=GBP` is passed:

```ts
sheet.addRow(
  row.map((cell, i) =>
    monetaryIdx.has(i) && typeof cell === "number" ? money.convert(cell) : cell,
  ),
);
```

`money.convert` is `n / rate` (`lib/exportCurrency.ts:45`). The import path has no currency parameter at all and writes the parsed cell values straight through as SEK (`plannedAmount: amount`, `actualAmount: amount`). The only marker of the conversion is a free-text note appended as a trailing row (`excel.ts:210-213`), which the importer ignores.

**Failure scenario:** Display currency is set to GBP (persisted in `CurrencyContext`, so it survives reloads). The user clicks Export from the Excel tab → `/api/excel/export?currency=GBP`. A `1,000,000 kr` plan is written as `£78,740` (at rate 12.7). They tweak one cell in Excel and re-import via `/excel/import`. Every figure in the workbook is now stored as SEK: the annual budget drops from 10.9M kr to ~860k kr, across every line, in one action. There is no error and no warning; the dashboard simply shows a much smaller budget.

**Fix:** Either strip the currency option from `/excel/export` (export stored SEK only), or embed the currency+rate in a machine-readable cell and have `/excel/import` refuse or reverse-convert accordingly.

---

### P5-3 — `/excel/import` deletes every year's plans and actuals for a line, then writes back only 2026

**Where:** `artifacts/api-server/src/routes/excel.ts:839-855`.

**What it does:**

```ts
await db.delete(monthlyPlansTable).where(eq(monthlyPlansTable.budgetLineId, lineId));
const planValues = row.plans.map((amount, idx) => ({ budgetLineId: lineId, month: idx + 1, year: 2026, plannedAmount: amount })) ...
await db.delete(monthlyActualsTable).where(eq(monthlyActualsTable.budgetLineId, lineId));
const actualValues = row.actuals.map((amount, idx) => ({ budgetLineId: lineId, month: idx + 1, year: 2026, actualAmount: amount })) ...
```

The `DELETE` filters on `budgetLineId` only — no `year` predicate — while the re-insert hardcodes `year: 2026`. Three further problems compound it: (a) none of this is inside a `db.transaction`, so a mid-loop failure leaves some lines rewritten and others not; (b) rows whose amount is `0` are filtered out (`:842`, `:851`) so an explicit zero becomes an absent row rather than a zero row; (c) no `writeAuditLog`/`writeAuditDiff` call exists anywhere in this handler, so a bulk rewrite of every actual in the system produces no audit trail at all — contrary to the "immutable/auditable actuals" standard.

**Failure scenario:** After `POST /admin/rollover` from 2026 to 2027 (or once real 2027 data exists), the user re-imports the FY2026 workbook to correct a typo. Every 2027 plan and every 2027 actual for every line in that workbook is deleted and never restored, because the workbook only carries 2026 columns. The pre-import snapshot (`excel.ts:736`) is the only recovery path, and it is best-effort — a snapshot failure is logged as "non-fatal" and the import proceeds anyway (`:738-740`).

**Fix:** Add `and(eq(..., lineId), eq(..., 2026))` to both deletes, wrap the whole accepted-rows loop in one `db.transaction`, and emit audit entries for changed amounts.

---

### P5-4 — `POST /seed` and `POST /imports/clear-all` destroy the entire dataset, including the audit log

**Where:** `artifacts/api-server/src/routes/seed.ts:10-24`; `artifacts/api-server/src/routes/imports.ts:704-723`.

**What it does:** `POST /seed` issues 12 unqualified `db.delete(...)` calls — including `auditLogsTable` (`seed.ts:22`) — then re-seeds from the hardcoded array. It takes no body, no confirmation parameter, is not wrapped in a transaction, and takes no snapshot first. `POST /imports/clear-all` does the same set of deletes inside a transaction, again including `auditLogsTable` (`imports.ts:716`) and `budgetLinesTable` (`:718`). Neither appears in the `requireVpAuth` list (verified: only `reforecast`, `admin/rollover` and `board/*` carry it).

**Failure scenario:** Any request that reaches `POST /api/seed` — a mistyped URL in a script, a stale bookmark, a curl against the desktop build's local port — replaces a year of real expenditure with demo data and erases the audit log that would show it happened. The audit-log deletion is the part that makes this unrecoverable in principle: the record of what was destroyed is destroyed with it.

Secondary defect in `clear-all`: `res.json(...)` is called **inside** the transaction callback (`imports.ts:721`). If the commit subsequently fails, the client has already been told `{ success: true }`.

**Fix:** Require an explicit confirmation token plus auth on both; never delete `audit_logs`; take a `pre-clear` snapshot first; move `res.json` outside the transaction callback.

---

## High

### P5-5 — `monthly_actuals` allows only one row per line/month, so multi-invoice months cannot be imported

**Where:** `lib/db/src/schema/monthlyActuals.ts:17-19` (index also present in `lib/db/drizzle/0004_careful_morg.sql:68`); import confirm loop at `artifacts/api-server/src/routes/imports.ts:592-615`.

**What it does:** `uniqueIndex("monthly_actuals_line_month_year_uniq").on(t.budgetLineId, t.month, t.year)` permits exactly one actual per budget line per month — yet the table carries an `invoiceRef` column, and the CSV importer produces one candidate row per transactional CSV line. The confirm loop inserts with a plain `db.insert(...)`, no `onConflictDoNothing`/`onConflictDoUpdate`, and is not inside a transaction.

**Failure scenario:** A transactional CSV contains two March invoices against *LinkedIn ads/boosts* (`INV-101 / 40,000` and `INV-102 / 25,000`) — the normal case for a variable spend line. Both rows match, both get distinct `rowHash` values, so neither is treated as a duplicate. Row 1 inserts; row 2 raises `duplicate key value violates unique constraint "monthly_actuals_line_month_year_uniq"` → `asyncHandler` → 500 "Internal server error". Everything inserted before the failure is committed, the import's status is never set to `confirmed`, and the user sees only a generic error with a half-applied import.

**Fix:** Decide the model explicitly — either drop the unique index and treat `monthly_actuals` as a transaction ledger (aggregating in SQL), or keep it and have the importer sum same-month rows before insert. Either way the confirm loop needs a single transaction and a batch insert.

---

### P5-6 — CSV matrix import writes `monthly_plans` at upload time, un-transactionally, and delete never rolls them back

**Where:** `artifacts/api-server/src/routes/imports.ts:282-294` (auto-create budget lines), `:299-303` (import record), `:338-350` (plan inserts), `:426-435`; delete handler `:639-702`.

**What it does:** The "upload" step — nominally a preview before `POST /imports/:id/confirm` — already writes to the live budget: it auto-creates `budget_lines` rows (`:282`) and inserts `monthly_plans` rows one at a time inside a nested loop (`:343-348`), with no `onConflict` clause and no enclosing transaction. Only `monthly_actuals` are deferred to confirm.

**Failure scenario A (partial write):** The same matrix workbook is uploaded twice — a very ordinary user action after a failed first attempt. On the second upload the budget lines already exist, so `findOrCreateBudgetLine` returns them, and the first plan insert for `(lineId, Jan, 2026)` violates `monthly_plans_line_month_year_uniq` → 500. Left behind: a `csv_imports` row stuck in `pending`, plus every plan row written for rows processed before the failure.

**Failure scenario B (unrecoverable pollution):** A matrix upload with plan columns creates 30 budget lines and 360 monthly plans. The user reviews the preview, decides the mapping is wrong, and deletes the import. `DELETE /imports/:id` removes `monthly_actuals` linked by `importId` and the `csv_import_rows`, but touches neither the auto-created `budget_lines` nor the `monthly_plans` (`:659-690`). The baseline budget is now permanently polluted with lines the user explicitly rejected, and `enforceLimit`-protected snapshots are the only way back.

**Fix:** Wrap the whole upload handler in one `db.transaction`, batch the plan inserts with `onConflictDoUpdate`, and record auto-created line ids on the import so delete can reverse them — or defer all writes to confirm.

---

### P5-7 — `budget_lines` has no uniqueness on `(category, lineItem)` although the Excel importer keys on it — and the shipped seed data violates it

**Where:** `lib/db/src/schema/budgetLines.ts:5-19` (no unique index); `artifacts/api-server/src/routes/excel.ts:743,749-757,766-767`; duplicates in `artifacts/api-server/src/lib/seedBudgetData.ts` (e.g. `"PR"` at `:27-34` and `:76-84`).

**What it does:** The Excel import builds `existingMap` as `new Map(existingLines.map((l) => [`${l.category}||${l.lineItem}`, l]))` and treats that pair as the row identity for update-vs-insert and for computing deletes. A JS `Map` keeps only the **last** entry for a duplicated key. The DB has no constraint preventing duplicates, and the seed data ships 8 duplicated `lineItem` values, including two rows both in category `Ads` named `PR`.

**Failure scenario:** A fresh database is seeded, giving two `Ads||PR` lines — one with 25k/25k/25k plans and 27,000 Feb actual, one with no plans and 27,000 Feb actual. The user exports to Excel, edits the *PR* row, and re-imports. `existingMap.get("Ads||PR")` resolves to the second line only; the first line is never updated and its plans/actuals are never rewritten — but it is also never deleted, because `fileKeys` contains `Ads||PR`. Both rows continue to contribute to `SUM(actual_amount)`, so *PR* is double-counted at 54,000 in the dashboard and in every export, and the user's edit appears to have silently done nothing to half the data.

**Fix:** Add a unique index on `(category, line_item)` plus a data-cleanup migration, and de-duplicate `SEED_LINES`.

---

### P5-8 — `/exports/excel` silently ignores the `currency` parameter the client sends

**Where:** `artifacts/api-server/src/routes/board.ts:720-798`; query schema `lib/api-zod/src/generated/api.ts:1173-1175`; caller `artifacts/budget-tracker/app/(tabs)/board.tsx:145`.

**What it does:** The client builds `` `${baseUrl}/api/exports/${endpoint}?currency=${currency}` `` for both `pdf` and `excel`. `/exports/pdf` honours it (`board.ts:389` calls `resolveExportCurrency`). `/exports/excel` never calls `resolveExportCurrency` at all: it writes raw stored SEK values with a fixed `col.numFmt = '#,##0'` (`:790`) and no currency symbol, no conversion note. `ExportExcelQueryParams` doesn't even declare `currency`, so the parameter is dropped by validation without comment.

**Failure scenario:** A director sets the display toggle to GBP and downloads both the board PDF and the board Excel from the same screen. The PDF shows `£860k` with the conversion note; the workbook shows `10,900,000` with no unit, in a session where every other figure on screen is in GBP. The two artefacts disagree by a factor of ~12.7 and neither states its currency in the Excel case.

**Fix:** Route `/exports/excel` through `resolveExportCurrency` exactly as `/excel/export` already does, including `money.numFmt` and the conversion note row.

---

### P5-9 — `/admin/rollover` fabricates 12 zero-value actuals per budget line, which then block real imports

**Where:** `artifacts/api-server/src/routes/admin.ts:52-65`.

**What it does:**

```ts
const newActuals = budgetLines.flatMap(bl =>
  Array.from({ length: 12 }, (_, i) => ({ budgetLineId: bl.id, month: i + 1, year: targetYear, actualAmount: 0 }))
);
```

Every budget line gets 12 pre-created zero-spend rows for the target year. The handler is not wrapped in a transaction, and its idempotency guard (`existingPlans.length > 0` at `:30-34`) checks only `monthly_plans`.

**Failure scenario A:** Rollover 2026→2027 creates ~1,300 zero actuals. In January the user imports the first 2027 spend CSV. Confirm attempts `INSERT` for `(line, 1, 2027)` — a row already exists → unique-index violation → 500, and per P5-5 the loop is not transactional, so the import is left half-applied. The manual edit path is unaffected (it finds the existing row and updates it), so the failure appears only for imports.

**Failure scenario B:** The plans insert (`:48`) succeeds and the actuals insert (`:63`) fails — e.g. because a prior partial rollover left some rows. The rollover is now half-done, but the `existingPlans` guard at `:30` will reject every retry with 409 "Rollover has already been done."

**Fix:** Don't create zero-value actual rows at all (absence already means zero everywhere in the read paths); wrap the handler in a single transaction.

---

### P5-10 — Snapshot payload omits most of the database; restore silently destroys forecasts, imports and events linkage

**Where:** payload `artifacts/api-server/src/routes/snapshots.ts:256-271`; restore `:911-999`; exchange-rate claim `artifacts/api-server/src/routes/exchange-rate.ts:71-80`.

**What it does:** `createSnapshot` captures exactly six tables: `budget_lines`, `monthly_plans`, `monthly_actuals`, `owners`, `categories`, `budget_line_columns`. Not captured: `forecast_versions`, `forecast_plans`, `events`, `event_tasks`, `alerts`, `exchange_rates`, `audit_logs`, `csv_imports`, `csv_import_rows`, `board_settings`, `share_tokens`, `task_reminders`, `in_app_alerts`.

Restore then deletes `csv_import_rows`, `csv_imports`, `monthly_actuals`, `monthly_plans`, `budget_lines`, `owners`, `categories`, `budget_line_columns` (`:913-920`) — and `budget_lines` deletion cascades further, because `forecast_plans.budget_line_id` is `ON DELETE cascade` (`lib/db/src/schema/forecastVersions.ts:19`).

**Failure scenario A (forecast wipe):** The user builds reforecast v1 and v2 for next year, then restores yesterday's snapshot to undo an unrelated typo. `forecast_versions` rows survive (they are not deleted and hold no FK to budget lines), but every `forecast_plans` row is cascade-deleted and nothing restores them. `GET /reforecast/versions` still lists "Reforecast v2"; opening it shows an empty plan set. The forward-planning work is gone with no error.

**Failure scenario B (events orphaned):** `events.budget_line_id` is `ON DELETE set null`, so every event survives a restore with its budget-line association nulled. `alerts.budget_line_id` likewise.

**Failure scenario C (rate not rolled back):** `POST /exchange-rate` takes a snapshot first, with the comment "a rate change alters every GBP figure the directors see, so it gets the same restore point as any bulk data edit" (`exchange-rate.ts:72-75`). Because `exchange_rates` is not in the payload, restoring that very snapshot does **not** revert the rate — the promise made in the comment is not kept.

Additionally, `createSnapshot` at `exchange-rate.ts:76-80` is best-effort: a failure is logged as "continuing" and the rate change proceeds without a restore point.

**Fix:** Extend the snapshot payload (with a version field) to cover forecast versions/plans, events, exchange rates and board settings; or document explicitly, in the UI, what restore does not cover.

---

### P5-11 — Plan/actual upserts are SELECT-then-INSERT with no `onConflictDoUpdate`; the client fires 12 in parallel

**Where:** `artifacts/api-server/src/routes/monthly-plans.ts:105-140`; `artifacts/api-server/src/routes/monthly-actuals.ts:98-131`; client `artifacts/budget-tracker/app/(tabs)/budget.tsx:274-281`.

**What it does:** Both `PUT /budget-lines/:id/plans` and `PUT /budget-lines/:id/actuals` do:

```ts
const [existing] = await db.select().from(...).where(and(eq(budgetLineId), eq(month), eq(year)));
let row;
if (existing) { [row] = await db.update(...) } else { [row] = await db.insert(...) }
```

No row lock, no upsert, no transaction spanning the read and the write. The client's `handleSaveMonthly` issues one mutation per changed month without awaiting, so a 12-month edit becomes 12 simultaneous requests.

**Failure scenario A (500 instead of update):** Two people (or one person double-clicking Save, or a retried request) submit an amount for the same `(line, month, year)` at the same time. Both `SELECT` return empty; both take the `INSERT` branch; the second violates `monthly_plans_line_month_year_uniq` and returns 500. The correct behaviour — update the existing row — never happens.

**Failure scenario B (lost update):** Two users edit the same March actual concurrently. Both find the existing row, both `UPDATE`; the later write wins with no conflict detection. The audit trail records both changes with the same `oldValue`, so the log reads as though one change was applied twice.

**Fix:** Replace both with a single `db.insert(...).onConflictDoUpdate({ target: [budgetLineId, month, year], set: {...} }).returning()`, and derive the audit `oldValue` from the returned row or a `RETURNING`-based diff.

---

### P5-12 — Seeded rows carry `costStatus: ""`, which fails the app's own Excel validation — the export/re-import round trip is broken on a fresh database

**Where:** `artifacts/api-server/src/lib/seedBudgetData.ts:80,488` (and other entries with empty `owner`/`region`/`costStatus`); validator `artifacts/api-server/src/routes/excel.ts:480-486`.

**What it does:** Several `SEED_LINES` entries set `costStatus: ""`, `owner: ""`, `region: ""`. The DB column is `NOT NULL DEFAULT 'Variable'` but an explicit `""` satisfies NOT NULL, so the empty string is stored. The Excel validator requires exactness:

```ts
if (costStatus !== "Variable" && costStatus !== "Fixed Cost") {
  errors.push({ column: "Cost Status", row: rowNum, message: `Cost Status must be exactly "Variable" or "Fixed Cost", got "${costStatus}"` });
}
```

**Failure scenario:** On a freshly seeded database the user runs the primary documented workflow — `GET /excel/export`, then upload the unmodified file to `POST /excel/validate`. The server returns 422 rejecting its own export, one error per affected row. The "reproduce the original spreadsheet exactly" capability fails on a clean install.

Related inconsistency: `""` vs `null` for `owner`/`region` is not normalised at seed time, whereas `PATCH /budget-lines/:id` explicitly normalises `""` → `null` (`budget-lines.ts:91-97`), so the two write paths disagree about what "no owner" looks like — which then affects the `lineItem|owner|region` key in P5-1.

**Fix:** Normalise the seed data to `Variable`/`Fixed Cost` and `null` for blank owner/region; add a CHECK constraint or enum on `cost_status`.

---

### P5-13 — Deleting a budget line referenced by a live import row raises a raw FK error

**Where:** `lib/db/src/schema/csvImportRows.ts:18` — `.references(() => budgetLinesTable.id)` with **no** `onDelete`, i.e. `NO ACTION` (confirmed in `lib/db/drizzle/0001_windy_serpent_society.sql:53`); callers `artifacts/api-server/src/routes/budget-lines.ts:118` and `artifacts/api-server/src/routes/excel.ts:769-772`.

**What it does:** Every other FK to `budget_lines` uses `cascade` or `set null`; this one alone is `NO ACTION`, so Postgres refuses the delete while any `csv_import_rows` row points at the line.

**Failure scenario:** The user uploads a CSV (creating `csv_import_rows` with `budgetLineId` set), then — without deleting the import — runs an Excel import whose workbook omits one of those lines. `excel.ts:769` issues `db.delete(budgetLinesTable).where(inArray(...))` → `update or delete on table "budget_lines" violates foreign key constraint "csv_import_rows_budget_line_id_budget_lines_id_fk"` → 500 "Internal server error". By that point the newly-accepted custom columns have already been persisted at `:726-732`, leaving exactly the "orphan column definitions on a failed import" the comment at `:685-687` says it is avoiding.

**Fix:** Change the reference to `onDelete: "set null"` (matching how the row already tolerates a null `budgetLineId`), and move column creation inside the same transaction as the row writes.

---

## Medium

### P5-14 — `month`, `year` and money fields have no bounds in the generated zod schemas

**Where:** `lib/api-zod/src/generated/api.ts:216-220, 240-245, 459-465, 515-521` (and ~30 other `month: zod.number()` occurrences); source spec `lib/api-spec/openapi.yaml`.

Every month/year/amount field is a bare `zod.number()` — no `.int()`, no `.min(1).max(12)`, no year range, no amount bounds. Nothing downstream compensates: there is no CHECK constraint on `monthly_plans.month` or `monthly_actuals.month` in any migration.

**Failure scenario:** `PUT /budget-lines/7/plans` with `{"month": 13, "year": 2026, "plannedAmount": 500000}` is accepted and stored. It contributes to `SUM(planned_amount)` in `/dashboard/summary` (which filters only on year) so the headline total rises by 500k, but every per-month view iterates `for (let m = 1; m <= 12; m++)` (e.g. `charts.ts:46`, `projections.ts:54`), so month 13 is invisible. Planned total and the sum of the twelve monthly bars permanently disagree, with no way to see why in the UI. `{"month": 2.5}` behaves the same way; `{"plannedAmount": 1e13}` overflows `numeric(14,2)` and surfaces as a 500.

**Fix:** Add `minimum/maximum` and `type: integer` to the OpenAPI spec for month/year and regenerate; add DB CHECK constraints as the backstop.

### P5-15 — Boot-time migrations take no lock, and the server serves traffic before (and despite) them

**Where:** `artifacts/api-server/src/lib/runSchemaMigrations.ts:11-15`; `artifacts/api-server/src/index.ts:24-59`; drizzle's implementation at `node_modules/.../drizzle-orm/pg-core/dialect.js:44-72`.

Drizzle 0.45.2's `migrate()` executes `CREATE SCHEMA IF NOT EXISTS drizzle`, reads the last applied migration, then applies pending ones inside a transaction — with **no advisory lock**. Two processes starting against the same database both read the same "last applied" row and both attempt the same DDL. Separately, `app.listen(...)` is called first and migrations run inside its callback (`index.ts:24-33`), so requests are accepted while the schema may not exist; `markSchemaReady()` gates only `/healthz` (`routes/health.ts:10`), not the routers. And a migration failure is caught and merely logged (`:35-37`), after which seeding proceeds against a possibly-wrong schema.

**Failure scenario:** The desktop build and a separately-running API server both point at the same Supabase instance and start together. One applies `0006`; the other fails with `relation "exchange_rates" already exists`, logs the error, continues to `seedAuthUsers`/`seedBudgetData`, and serves traffic in an indeterminate state.

Related: drizzle compares `lastDbMigration.created_at < migration.folderMillis`, so a migration inserted with a back-dated `when` (as `0003_channel_flag` was — a hand-rounded `1776500000000`) is **permanently skipped** on any database that already applied a later one. The current chain is ordered correctly, but the pattern is a live hazard.

**Fix:** Take a `pg_advisory_lock` around `migrate()`; move `app.listen` after migrations, or gate the API router on `isSchemaReady()`; treat a migration failure as fatal.

### P5-16 — A GET endpoint creates rows; forecast version numbers are assigned by read-modify-write with no constraint

**Where:** `artifacts/api-server/src/routes/reforecast.ts:19-52` (GET with writes) and `:54-99` (version create).

`GET /reforecast/versions` inserts a "Original Plan" forecast version plus a full set of `forecast_plans` when none exist (`:30-44`). `POST /reforecast/versions` computes `nextVersion = existing[0].versionNumber + 1` from a prior SELECT (`:70`). There is no unique constraint on `forecast_versions(year, version_number)` or on `forecast_plans(version_id, budget_line_id, month, year)`, and neither handler is transactional.

**Failure scenario:** Two browser tabs open the reforecast screen simultaneously on a database with no versions. Both GETs find zero versions, both insert "Original Plan", both bulk-insert the full plan set — the year now has two v0 originals with duplicated plans. Similarly, two concurrent saves both compute `nextVersion = 2`, producing two distinct versions labelled v2; `GET /reforecast/versions` orders by `versionNumber` so which one a subsequent comparison picks is arbitrary. If the `forecast_plans` insert fails after the version insert, an empty version row is left behind permanently.

**Fix:** Move the auto-seed to an explicit POST, wrap version+plans in one transaction, and add unique constraints on `(year, version_number)` and the plan tuple.

### P5-17 — `mode: "number"` on numeric columns reintroduces binary floating point in application code

**Where:** all money columns, e.g. `lib/db/src/schema/monthlyPlans.ts:11-12`, `monthlyActuals.ts:12`, `budgetLines.ts:14-15`, `exchangeRates.ts:10`; drizzle mapper at `node_modules/.../pg-core/columns/numeric.js:63-67` (`mapFromDriverValue` = `Number(value)`, `mapToDriverValue` = `String`).

The storage fix from `0005` is real and holds — Postgres rounds every write back to 2 dp. But every read hands JS a binary float, and all cross-row arithmetic happens in JS: `cumPlanned += planned` (`charts.ts:49`), `totalPlan += pv` (`excel.ts:150`), `sum + p.plannedAmount` in snapshot totals (`snapshots.ts:184-189`), and `n / rate` for currency conversion (`exportCurrency.ts:45`).

For 2 dp values the accumulated error is on the order of 1e-10 over hundreds of rows — invisible in a `#,##0` cell. The concrete risk is comparison rather than display: `existing.plannedAmount !== plannedAmount` (`monthly-plans.ts:119`) and `if (av !== bv)` in the snapshot differ (`snapshots.ts:380,391`) are exact float equality, so a value that round-trips through JSON, a snapshot file, and back can compare unequal to itself and produce a spurious "changed" entry in a board-facing comparison PDF.

**Fix:** Either drop `mode: "number"` and handle values as strings/decimal.js at the boundary, or push all summation into SQL (`SUM()` on `numeric` is exact) and keep JS floats for presentation only.

### P5-18 — `category` and `owner` are free text with no FK to their lookup tables; rename is non-transactional

**Where:** `lib/db/src/schema/budgetLines.ts:7,10` (plain `text`) vs `categories.ts`/`owners.ts`; rename logic `artifacts/api-server/src/routes/categories.ts:80-95`; delete `:100-110`.

`budget_lines.category` is matched to `categories.name` by string equality (e.g. the join in `categories.ts:34`), with no referential integrity. The rename path updates the category row and then, as a separate statement, updates matching budget lines:

```ts
const [row] = await db.update(categoriesTable).set(updates)...
if (parsed.data.name && parsed.data.name !== existing.name) {
  await db.update(budgetLinesTable).set({ category: parsed.data.name }).where(eq(budgetLinesTable.category, existing.name));
```

**Failure scenario A:** The first update commits and the second fails (or the process dies between them). The category is now named "Events & Conferences" while every budget line still says "Events and Conferences" — `lineCount` shows 0, and the category-breakdown chart groups by the stale string, producing a phantom category.

**Failure scenario B:** `DELETE /categories/:id` removes the category row and leaves every budget line pointing at a name that no longer exists; `/categories` no longer lists it, but `/dashboard/charts` still emits it as a category. The same applies to `owners` (delete leaves `budget_lines.owner` dangling).

**Fix:** Wrap the rename in a transaction; either add a real FK (`category_id`) or block deletion of a category/owner that is still referenced.

### P5-19 — `invoiceRef` is overwritten with the internal dedupe hash, discarding the user's real invoice reference

**Where:** `artifacts/api-server/src/routes/imports.ts:404` (hash built), `:602-609` (insert), dedupe lookup at `:581-586`.

The confirm step writes `invoiceRef: row.rowHash` and never writes `row.rawInvoiceRef`, even though the CSV parser extracts it (`:375`) and stores it on the import row. Deduplication is then implemented by querying `monthlyActualsTable.invoiceRef` against the set of hashes.

**Failure scenario:** A CSV with an `Invoice` column is imported. The user opens the actuals list expecting `INV-2026-0412` and sees `a3f19c...` (32 hex chars). Worse, if they then correct that value manually via `PUT /budget-lines/:id/actuals` with a real reference, the dedupe key is destroyed — re-confirming the same import (or importing an overlapping file) no longer recognises the row as a duplicate.

**Fix:** Store `rawInvoiceRef` in `invoice_ref` and add a separate `import_row_hash` column for deduplication.

### P5-20 — `check-reminders` is a read-modify-write race producing duplicate alerts

**Where:** `artifacts/api-server/src/routes/event-tasks.ts:185-229`.

The handler selects reminders `WHERE fired_at IS NULL`, then for each one inserts an `alerts` row plus an `in_app_alerts` row, and only afterwards sets `firedAt` (`:222-225`). None of it is transactional and there is no conditional update.

**Failure scenario:** The screen polls this endpoint and the user also taps refresh (or two clients have the event open). Both requests read the same unfired reminder, both insert an alert and an in-app alert, and both then set `firedAt`. The user gets two identical "Task X is due in 3 days" notifications; `alerts` gains a duplicate that `runAlertEvaluation`'s dedupe key does not cover (it dedupes by `type|budgetLineId|month|year`, and these alerts have all-null budgetLineId/month/year).

**Fix:** `UPDATE task_reminders SET fired_at = now() WHERE id = ? AND fired_at IS NULL RETURNING *` first, and only create the alerts if a row came back.

### P5-21 — Year parameters are parsed with `parseInt(...) || fallback`; NaN ids reach the database

**Where:** `artifacts/api-server/src/routes/analytics.ts:9,40,99,158,208`; `reforecast.ts:20,102,113-114`; `audit-logs.ts:10-11,15-16`.

Two distinct problems. `parseInt(req.query.year as string) || 2026` maps `year=0`, `year=abc` and a repeated `?year=1&year=2` (an array, where the `as string` cast is a lie) all to 2026 without complaint. And `reforecast.ts:113-114` passes an unchecked `parseInt` straight into `eq(forecastVersionsTable.id, baseId)` — `NaN` is serialised to the driver and Postgres rejects it as invalid integer syntax, producing a 500 rather than a 400.

`audit-logs.ts:15-16` is the sharpest case: `gte(auditLogsTable.createdAt, new Date(startDate as string))`. `GET /api/audit-logs?startDate=yesterday` produces an `Invalid Date`, which throws inside the driver's date serialisation → 500 "Internal server error" on an audit query.

**Fix:** Use the same `zod.coerce.number()` param schemas already used elsewhere, and validate dates with `z.coerce.date()`.

### P5-22 — Fiscal year 2026 is hardcoded across server and client

**Where:** server — `artifacts/api-server/src/routes/board.ts:355,361,379,536` (`buildBoardViewData(2026)`), `excel.ts:55-56,841,850`; client — `artifacts/budget-tracker/app/(tabs)/budget.tsx:39`, `app/(tabs)/index.tsx:348`.

Board view, board preview, both PDF exports, and the entire Excel import/export path are pinned to 2026 with no parameter. `/admin/rollover` can create 2027 data, but nothing can display or export it.

**Failure scenario:** After the 2027 rollover, `GET /board/view` returns zeros for total budget and spend regardless of the data. The Excel export produces a blank FY2026 sheet, and re-importing that sheet triggers P5-3 against the 2027 data.

Separately, "fiscal year" and "calendar year" are conflated throughout: `year === now.getFullYear()` decides `monthsElapsed` (`dashboard.ts:18`), and month 1 always means January. A non-calendar fiscal year is not representable.

**Fix:** Thread the year through as a parameter (defaulting to a single configured `CURRENT_FY` constant shared by client and server) rather than a literal in nine places.

### P5-23 — Snapshot import accepts arbitrary JSON; restore inserts its fields without type validation

**Where:** `artifacts/api-server/src/routes/snapshots.ts:721-873` (import), `:951-968` (restore inserts).

Import validates that `budgetLines` is an array of objects with a numeric `id`, non-empty `lineItem`/`category`, and array `plans`/`actuals` whose entries have numeric `month`/`year`/amount. It does not validate `costStatus`, `projectionPct`, `boardApprovedAmount`, `customFields`, or any month range, and `flatBudgetLines` spreads every remaining key verbatim into the on-disk file (`:831-834`). Restore then inserts those values directly.

**Failure scenario:** An imported snapshot omits `costStatus`. Restore reaches `tx.insert(budgetLinesTable).values({ costStatus: bl.costStatus, ... })` with `undefined`; Drizzle omits the column and the DB default `'Variable'` applies — so a Fixed Cost line silently becomes Variable, changing every projection for that line. If `projectionPct` is the string `"high"`, the transaction aborts with a 500 (the DB is safe, but only by accident, and a `pre-restore` snapshot has already been written).

**Fix:** Validate the imported snapshot with a zod schema mirroring the DB column types, including month 1-12 and the `costStatus` enum.

### P5-24 — Excel import writes no audit entries for wholesale plan/actual replacement

**Where:** `artifacts/api-server/src/routes/excel.ts:783-856` — no `writeAuditLog`/`writeAuditDiff` import or call anywhere in the file.

Manual edits are audited (`monthly-actuals.ts:78,119`), budget-line field changes are audited (`budget-lines.ts:105`), CSV import status changes are audited (`imports.ts:622`). The one path that can rewrite every plan and actual in the system in a single request records nothing. Combined with P5-3 (which deletes across all years) there is no trail showing what a bad import destroyed.

**Fix:** Emit a summary audit entry per changed budget line, or at minimum one `entityType: "excel_import"` entry recording counts and the pre-import snapshot id.

### P5-25 — `res.json` inside a transaction callback in `clear-all`

**Where:** `artifacts/api-server/src/routes/imports.ts:704-723`, response sent at `:721` inside `db.transaction(async (tx) => { ... })`.

The response is written before the transaction commits. A commit failure (deadlock, connection loss) leaves the client having received `{ success: true, cleared: {...} }` for work that was rolled back — and Express cannot send a second response.

**Fix:** Compute the counts inside the transaction, return them from the callback, and call `res.json` after `await db.transaction(...)` resolves.

### P5-26 — `UpdateMonthlyActualBody.invoiceRef` cannot express "clear this field"

**Where:** `lib/api-zod/src/generated/api.ts:528-534` — `invoiceRef: zod.string().optional()`; DB column is nullable (`lib/db/src/schema/monthlyActuals.ts:13`); the response schema uses `.nullish()` (`:539`).

Request and response schemas disagree about nullability for the same column: a client can *receive* `null` but cannot *send* it. `PATCH /monthly-actuals/:id` with `{"invoiceRef": null}` is rejected with a 400; sending `""` stores an empty string rather than null, so the field can be blanked in appearance but never actually nulled. The same asymmetry exists for `subcategory`, `owner`, `region` on `UpdateBudgetLineBody` (`:143-160`) — partially worked around in `budget-lines.ts:89-97`, but only for `owner` and `channel`.

**Fix:** Make the nullable columns `.nullish()` in the request bodies in the OpenAPI spec and regenerate.

---

## Low

### P5-27 — `deleted_at` is written but never used as a filter

`lib/db/src/schema/csvImports.ts:15` defines `deletedAt`; `imports.ts:688` sets it. No query anywhere filters on it (verified by grep across `artifacts/api-server/src` and the frontend). `GET /imports` (`imports.ts:132`) returns deleted imports; the client relies on `status === "deleted"` to label them. The "soft delete" is also not soft: `imports.ts:684` hard-deletes all `csv_import_rows` for the import, leaving a tombstone header with no detail rows. Pick one model.

### P5-28 — Snapshot directory is resolved relative to `process.cwd()`

`artifacts/api-server/src/routes/snapshots.ts:25` — `path.join(process.cwd(), "snapshots")`. Backups land in a different directory depending on where the process was launched from (dev vs `artifacts/desktop` vs a service manager), so a restore may not see snapshots taken by an earlier run. Use an explicit configured absolute path.

### P5-29 — Seed events reference budget lines by a string that doesn't match

`artifacts/api-server/src/lib/seedBudgetData.ts:504` uses `lineItemMatch: "Early Careers Event 19th March"` while the line is defined at `:485` as `"Early Careers Event 19th march"` (lowercase m). `lineIdMap.get(...)` returns undefined, so the event is created with `budgetLineId: null`. Additionally `lineIdMap.set(item.lineItem, line.id)` is keyed on `lineItem` alone, so the 8 duplicate line items (P5-7) overwrite each other and the surviving link is whichever was inserted last — e.g. `StaffingPro Germany Oct` exists at both `:385` and `:475`.

### P5-30 — Date-only concepts stored as `timestamptz` and formatted in server-local time

`events.event_date` and `event_tasks.due_date` are `timestamp with time zone`. Seed values are constructed as `new Date("2026-03-19")` (`seedBudgetData.ts:504-511`), which JS parses as **UTC** midnight. They are then rendered with `new Date(e.eventDate).toLocaleDateString("en-GB")` in the board PDF (`board.ts:511`), which uses the server's local timezone — so a server west of UTC prints "18/03/2026" for an event dated the 19th. `runAlertEvaluation.ts:126` similarly builds `new Date(resolvedYear, plan.month - 1, 15)` in local time and compares it to `now`.

### P5-31 — `numeric(14,2)` silently rounds sub-cent input and 500s on overflow

Because zod imposes no bounds (P5-14), `plannedAmount: 1234.567` is accepted and Postgres rounds it to `1234.57` with no feedback to the user, while `plannedAmount: 1e13` exceeds `numeric(14,2)` and surfaces as a generic 500 rather than a validation message. Add `.multipleOf(0.01)` and a sane maximum at the API boundary.

### P5-32 — Mixed zod major versions across packages

`lib/db/src/schema/*.ts` all import `from "zod/v4"` while `lib/api-zod/src/generated/api.ts:8` imports `from "zod"` (v3 classic; catalog pin is `zod: 3.25.76` in `pnpm-workspace.yaml:30`). The two have different defaults — notably, v3's `z.number()` accepts `Infinity` while v4's does not. Nothing currently depends on the difference (JSON has no `Infinity` literal), but the drizzle-zod insert schemas and the API schemas are validating against different rule sets for the same columns.

### P5-33 — Migration metadata has a gap at 0003

`lib/db/drizzle/meta/` contains snapshots `0000, 0001, 0002, 0004, 0005, 0006` — `0003_snapshot.json` is absent, and `_journal.json` gives `0003_channel_flag` a hand-rounded `when: 1776500000000`. The applied state is nonetheless consistent: the `prevId` chain is unbroken (`0004.prevId === 0002.id`) and `0004_snapshot.json` does contain the `channel` column, so a database applying 0000→0006 in order ends up correct. Flagged only because the gap means `drizzle-kit generate` is diffing against a history that doesn't include the hand-written step — see also the back-dating hazard noted in P5-15.

---

## Verified clean

These were checked against the actual code and are correct as implemented:

- **No floating-point money columns remain.** `grep -rn "real(" lib/db/src/schema/` returns nothing. `0005_oval_sunset_bain.sql` converts `projection_pct`, `board_approved_amount`, `planned_amount`, `board_amount`, `actual_amount`, `estimated_cost`, `raw_amount` and `forecast_plans.planned_amount` to `numeric`. Postgres-side storage and rounding are exact. (The JS-side caveat is P5-17.)
- **Every foreign key is declared** via `references()` with a deliberate `onDelete`: `cascade` for `monthly_plans`, `monthly_actuals`, `forecast_plans`, `csv_import_rows→csv_imports`, `event_tasks`, `task_reminders`, `in_app_alerts`; `set null` for `alerts`, `events`, `monthly_actuals.import_id`, `task_reminders.alert_id`. Only `csv_import_rows.budget_line_id` is `NO ACTION` (P5-13). Deleting a budget line leaves no orphan plan or actual rows.
- **Unique indexes on `(budget_line_id, month, year)`** exist for both `monthly_plans` and `monthly_actuals`, in the schema (`monthlyPlans.ts:16`, `monthlyActuals.ts:18`) *and* in migration `0004_careful_morg.sql:67-68`. The constraint is real at the database level, not application-only. `board_settings.section_key`, `categories.name`, `budget_line_columns.name` and `share_tokens.token` are likewise uniquely constrained in both places.
- **SQL aggregate results are always coerced.** Every `sql<number>\`COALESCE(SUM(...))\`` result — which pg returns as a *string* for `numeric` — is wrapped in `Number(...)` before arithmetic, in `dashboard.ts:44-56`, `charts.ts:39-40,81,110-115`, `analytics.ts:29-33,73,81,133,140,179,186,228-232`, `board.ts:181,189-190,208-209,232,548-550`. No string-concatenation arithmetic exists.
- **Snapshot restore and import-delete are properly transactional.** `snapshots.ts:911-999` and `imports.ts:659-690` both wrap all their writes in a single `db.transaction`, and restore correctly deletes in FK order and remaps old→new budget-line ids via `lineIdMap`. Restore also refuses to proceed if the `pre-restore` snapshot fails (`:899-909`) — the right call.
- **Path traversal is guarded** on every snapshot route: `:408`, `:692`, `:882` (`/^[\w-]+$/`), `:1017`, `:1022`, `:1054`, `:1097`.
- **Migrations are sequential and non-destructive.** `_journal.json` lists 0000–0006 in ascending `when` order matching the files on disk; the snapshot `prevId` chain is unbroken; there is no `DROP TABLE` or `DROP COLUMN` in any migration. `0005`'s `ALTER COLUMN ... SET DATA TYPE numeric` preserves the existing `DEFAULT 0`.
- **`/excel/validate` is a true dry run** — it performs no writes and returns the `toAdd`/`toUpdate`/`toDelete` diff before anything is committed (`excel.ts:581-640`). The unknown-column handling is default-deny (`:712-719`), and new column definitions are only persisted after validation passes (`:721-732`).
- **CSV import deduplication works and is idempotent on re-confirm.** The `rowHash` set is seeded from existing rows and extended as it inserts (`imports.ts:579-613`), and a re-confirm of an already-`confirmed` import short-circuits (`:562-570`). (The column it stores the hash in is the objection — P5-19.)
- **`exchange_rates` is genuinely append-only** in code: `POST /exchange-rate` only inserts, and no route updates or deletes the table. Active rate resolution orders by `createdAt DESC, id DESC` consistently in both `exchange-rate.ts:23` and `exportCurrency.ts:36`, so a same-timestamp tie resolves deterministically.
- **`GBP` export falls back safely.** `resolveExportCurrency` requires `rate !== null && rate > 0` before converting (`exportCurrency.ts:41`) and otherwise reports SEK rather than inventing a conversion — the correct failure mode.
