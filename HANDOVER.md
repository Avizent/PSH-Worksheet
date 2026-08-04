# Marketing Budget Dashboard — Handover

Everything needed to take ownership of this application: what it is, what
state it's in, how to run it, and what's still outstanding.

**GitHub repository: `Avizent/PSH-Worksheet`**
https://github.com/Avizent/PSH-Worksheet

**Taking over the app for the first time?** Use `TRANSFER-RUNBOOK.md`
instead of this document — it's a step-by-step procedure written so an AI
agent (Claude Code, Claude Cowork, or similar) can execute the mechanical
parts directly and knows exactly which steps need your own action. This
document is the reference to come back to afterwards.

---

## What the app is

A budget tracker that replaces the FY26 marketing budget spreadsheet. It holds
the budget as a baseline, records spend against each line, and shows what
remains — per line and in total — as the year progresses.

It covers budget lines with monthly plan/actual figures, alerts, events, CSV
and Excel import, reforecasting, a board view, snapshots, and Excel/PDF
exports. Figures are stored in Swedish kronor, with an optional GBP display
lens driven by an admin-set exchange rate.

**Technology:** a pnpm monorepo. Express + Drizzle ORM API server
(`artifacts/api-server`), Expo / React Native Web frontend
(`artifacts/budget-tracker`), Electron desktop wrapper (`artifacts/desktop`),
shared packages in `lib/`. Data lives in Supabase (PostgreSQL).

---

## Current state of the data

As of 2 August 2026, for financial year 2026:

| | |
|---|---|
| Budget lines | 44 |
| Total budget | 2 823 149,06 kr |
| Total spend | 574 047,84 kr |
| Remaining | 2 249 101,22 kr |

**One line is over budget:** *Events and Conferences · Jobylon Dinner STKH* —
15 000 kr budgeted, 33 000 kr spent, 18 000 kr over. This was invisible until
recently (see below) and is worth reviewing.

---

## What was recently fixed

The application was originally built in Replit and then audited in depth. Two
audit reports are in the repository and worth reading before making changes:

- `audit/phase-5-data-integrity.md`
- `audit/phase-6-security.md`

### Security

The API had **no authentication at all** — anyone who could reach the server
could read the entire budget, and could wipe and reseed the database. That is
fixed: every endpoint now requires a signed-in session, destructive operations
require an admin account, and the login has rate limiting.

Related fixes: cross-origin access locked down (it previously allowed any
website to read and write the budget); a privileged API key removed from the
shipped web bundle; a hardcoded password removed from the source code; audit
log entries now record who made each change.

### Data integrity

A number of defects could silently corrupt figures:

- **Restarting the server resurrected deleted budget lines** with hardcoded
  figures. Disabled.
- **Exporting in GBP and re-importing** divided the entire budget by the
  exchange rate. The export is now stamped with its currency and the import
  refuses a converted file.
- **Re-importing a spreadsheet deleted every other year's** plans and actuals.
  Now scoped to the year being imported, inside a single transaction.
- **CSV import silently created new budget lines** for rows that matched
  nothing. This caused a real incident (below). Now opt-in.
- **Snapshot restore destroyed all forecasts** and unlinked every event. Now
  preserved.
- Money columns migrated from floating-point to exact decimals.

### The duplicate-line incident

The FY26 data load ran as two operations two minutes apart. The second created
new budget lines instead of matching the ones already there, producing 13
duplicates. Each real budget line ended up split across two rows — one holding
the budget, the other the spend — so **42% of lines showed a wrong remaining
figure**, and two lines were double-counted, overstating both budget and spend
by 110 249 kr.

This has been reconciled. The duplicates were merged onto their original rows
and the figures above reflect the corrected data. A pre-reconciliation backup
is at `scripts/backups/` (not in the repository — ask for a copy if needed).

`scripts/src/reconcile-duplicate-lines.ts` remains available if duplicates ever
recur. It is dry-run by default:

```bash
pnpm --filter @workspace/scripts reconcile-dupes           # preview
pnpm --filter @workspace/scripts reconcile-dupes --commit  # apply
```

---

## Check Integrity

There is a **Data Integrity** screen in the admin area (shield icon). Pressing
**Check Integrity** runs 21 checks over the budget data and reports anything
wrong, in plain language, grouped by severity.

It looks for duplicate and near-duplicate lines, budget and spend split across
two rows, orphaned data, figures that don't add up, currency problems, and
anything that would stop the spreadsheet export working.

**The checks never change anything.** They report what's wrong and suggest what
to do; you decide. Run it after any import, and before circulating figures to
directors.

The full specification of every check is in
`audit/integrity-checks-spec.md`.

---

## Getting set up

See `TRANSFER-RUNBOOK.md` for the full step-by-step procedure — accepting
the GitHub and Supabase transfers, resetting the database password, cloning,
building, and installing the desktop app. That document is written to be
followed by an AI agent directly, so hand it to Claude Code or Cowork rather
than working through it by hand.

---

## Working on the app with Claude Code

The repository includes `CLAUDE.md`, which describes the project's conventions,
engineering standards and testing requirements. Claude Code reads this
automatically, so it will follow the same standards without being told.

Useful commands:

```bash
pnpm run typecheck                        # check all packages compile
pnpm --filter @workspace/api-server test  # run the test suite (91 tests)
```

The test suite runs against an in-process database and needs no setup — it
cannot touch live data.

**One caution:** if you set `DATABASE_URL` in your shell, scripts run by Claude
Code can write directly to the live budget. For code work, consider using a
Supabase development branch rather than the production database.

---

## Still outstanding

### Needs a decision

**The `xlsx` dependency has two known security advisories** with no fix
available on npm — the maintainers moved distribution to their own CDN. Options
are to install the patched version from `https://cdn.sheetjs.com`, migrate the
spreadsheet-reading code to ExcelJS (already used for writing), or accept it,
noting the affected endpoints now require a login.

**The app's totals don't match the source spreadsheet.** The app shows
2 823 149,06 kr; the spreadsheet's own line-item detail totals 2 468 466 kr.
The spreadsheet contains three different budget totals in different sheets, so
the first question is which one is authoritative. There are also 12 budget
lines in the app with no counterpart in the spreadsheet's FY26 detail — they
may be legitimate lines recorded elsewhere, or they may not belong. This needs
a human judgement, not a code fix.

### Smaller items

- **Board View is greyed out** in the sidebar — parked, not removed. Director
  access was deferred in favour of a PowerPoint export that hasn't been built.
- **The app has no icon** — it shows the generic Electron icon. Adding one is a
  small change if you have a logo.
- **An empty artifact line** remains: *Other Costs · Website fixes* (id 135)
  has no budget and no spend, left over from the bad data load. The real line
  is *Other Costs for Marketing and PR · Website fixes*. Safe to delete.
- **The Excel export doesn't reproduce the original spreadsheet's layout.** It
  exports the same data in its own cleaner format. Matching the original's
  sections, subtotals and styling would be a separate piece of work.

### Ideas discussed but not built

- A PowerPoint export for board packs, using native editable charts.
- An AI panel inside the app for asking questions about the budget.
- Giving Claude direct access to the app's data through an MCP server.

---

## Where things are

| | |
|---|---|
| API server | `artifacts/api-server` |
| Frontend | `artifacts/budget-tracker` |
| Desktop app | `artifacts/desktop` |
| Database schema | `lib/db/src/schema` |
| Scripts | `scripts/src` |
| Audit reports | `audit/` |
| Project conventions | `CLAUDE.md` |
