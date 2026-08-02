# CLAUDE.md

This file provides guidance to Claude Code when working on this repository.

## Start here

Before making changes, read `docs/SESSION-CONTEXT.md`. It records what has
already been done and — more importantly — **why decisions were made**, what
was deliberately not done, and the environment gotchas that otherwise cost
time to rediscover. Several choices in this codebase look odd without that
context and should not be reversed without reading it.

Related: `HANDOVER.md` (ownership and setup), `audit/` (the two audit reports
and the integrity check specification).

## Project Overview

This application takes an annual budget spreadsheet and replicates it as a web application. It is an independent, standalone project — not connected to any other budget, spreadsheet, or application work discussed previously.

The application was originally built in Replit. The source of truth going forward is the GitHub repository connected to this project; Claude Code is being used to review, improve, and extend that existing codebase — not to start from scratch.

## Purpose

The original spreadsheet budget needs to be held inside the application as the baseline. As the budget holder spends against budget lines, she records that expenditure in the app and can see, at any time:

- How much of each budget line remains  
- How much has been spent so far  
- Running analysis as she goes, rather than only at period-end

## Core Features

1. **Budget ingestion** — import/replicate the original annual budget spreadsheet as the baseline dataset inside the app.  
2. **Expenditure tracking** — the budget holder inputs actual spend against budget line items over the course of the year.  
3. **Live remaining/spent view** — real-time calculation and display of budget remaining vs. budget spent, per line item and in aggregate.  
4. **Director-facing analytics** — analytics and visualisations that communicate to company directors how the budget is being spent and how it is performing against plan.  
5. **Next year's budget creation** — generate next year's budget using this year's figures as a starting point, supporting forward planning and impact analysis (i.e. modelling the effect of proposed changes before committing to them).  
6. **Reports and graphs** — generate reports and graphical output summarising budget performance.  
7. **Original spreadsheet replication (export)** — produce, as an output of the application, a faithful replica of the original input spreadsheet (e.g. for audit, sign-off, or circulation to people who still work from the spreadsheet format).

## Design Standards

The application must follow Apple's design standards throughout:

- **Human Interface Guidelines (HIG)** compliance for layout, navigation patterns, and interaction design.  
- **Colour** — use Apple's system colour conventions and semantic colour usage (e.g. consistent, restrained palette; colour used meaningfully to convey state such as under/over budget, rather than decoratively).  
- **Navigation** — navigation structure and patterns should follow Apple conventions appropriate to the platform (e.g. clear hierarchy, standard navigation idioms, predictable placement of primary actions).  
- **Typography, spacing, and components** should follow Apple's conventions for clarity and consistency unless there is a specific functional reason to deviate.

When implementing or revising UI, default to Apple HIG-aligned choices rather than generic or ad hoc styling.

## Working Method

- Treat the GitHub repository as the current source of truth for the existing implementation.  
- Review existing code before proposing changes; improvements should build on what's there rather than assuming a greenfield rewrite.  
- Flag any area where the existing Replit-built implementation deviates significantly from the purpose/features above, or from Apple design standards, so it can be prioritised for improvement.

## Engineering Standards

- **Avoid inefficient loops.** Do not recalculate totals by looping over the full transaction/actuals set on every request or render. Prefer SQL aggregation (`SUM`, `GROUP BY`) over pulling raw rows into application code and summing in a loop. Where a running/cumulative figure is needed across a fixed small range (e.g. 12 months), accumulate once rather than re-summing from scratch for each step.  
- **No N+1 database queries.** Fetching a list of records and then issuing a separate query per record inside a loop (or inside `Promise.all(list.map(...))`) does not scale and must be replaced with a single batched query (fetch all related rows once, then group/join in memory using a `Map`).  
- **No per-row inserts in a loop.** Bulk operations (e.g. CSV import) must batch-insert rows in one statement rather than awaiting an individual `INSERT` for every row (and every sub-column) being processed.  
- **One shared calculation engine.** The "current year" actuals/remaining calculations and the "next year" forward-planning/impact-analysis calculations must not duplicate logic — implement once, reuse for both.  
- **Use exact/decimal arithmetic for money.** All monetary fields (planned amount, actual amount, board-approved amount, variance) must use a fixed-point/decimal/numeric type, never a binary floating-point type — floating-point rounding errors are unacceptable in a budget tool used by directors.  
- **Immutable/auditable actuals.** Edits or deletions of expenditure entries should be logged (who, when, old value, new value), not silent overwrites.  
- **Baseline budget is read-only once set.** The originally imported/replicated budget baseline must remain distinct from actuals and locked from casual edits, so the "reproduce the original spreadsheet" export is always reconstructable exactly.

## Testing Requirements

- Every calculation function (remaining \= budget − spent, variance, projections, rollovers, reforecast deltas) must have unit tests covering edge cases: zero budget, negative spend, overspend, empty year, partial-year data — not just the happy path.  
- No change is considered complete until existing tests pass and new logic has test coverage; "looks right" is not sufficient for a tool handling real financial figures.  
- Regression-test before/after behaviour whenever shared calculation code is touched, since a change to one screen's logic can silently break another (dashboard, analytics, and reforecast currently pull from the same plan/actual data).

## Non-Functional Requirements

- Remain responsive with multiple years of transaction history, not just a small demo dataset.  
- Accessibility: VoiceOver labels, Dynamic Type support, and sufficient contrast, in line with Apple HIG.  
- Input validation on all expenditure entries and imported spreadsheet data; no execution of arbitrary content from imported files.

## Definition of Success

A budget holder can enter spend and see remaining budget update in real time; directors get clear analytics on how the budget is performing; next year's budget can be forecast from this year's figures with impact analysis; reports and graphs are available; and the original spreadsheet can be reproduced exactly as an export. Flag any scope creep away from this goal rather than silently expanding it.

## Process / Workflow

- Pull the latest code from GitHub before making changes; do not push directly to `main` without review.  
- Run `pnpm run typecheck` and the API test suite (`pnpm --filter @workspace/api-server test`) before considering a change complete.  
- Do not break existing working functionality — verify calculation output before and after any change to shared logic.

---

## Code Review — Existing Replit Application (PSH-Worksheet)

This repo (`Avizent/PSH-Worksheet`, product name "Hubert Marketing Budget Tracker") is a pnpm monorepo: Express 5 \+ Drizzle ORM/PostgreSQL API (`artifacts/api-server`), Expo (React Native \+ React Native Web) frontend (`artifacts/budget-tracker`), shared packages in `lib/`. It is a working, reasonably mature implementation covering budget lines, monthly plans/actuals, alerts, events, CSV import, reforecasting, board view, and exports. The following are **optimisations to the existing code**, not new functionality, in priority order:

### High priority

1. **Money fields use floating-point (`real`), not fixed-point.** `plannedAmount`, `actualAmount`, `boardApprovedAmount`, `projectionPct` are all declared as `real` in `lib/db/src/schema/{budgetLines,monthlyPlans,monthlyActuals}.ts`. This risks rounding errors accumulating across thousands of transactions and quarters — the classic 0.1 \+ 0.2 problem, on real money figures directors will scrutinise. Recommend migrating these columns to `numeric`/`decimal` (Postgres) and handling them as fixed-point in application code, rather than native JS floats.  
     
2. **N+1 query pattern in `budget-lines-with-monthly.ts`.** For every budget line, the route issues two separate DB queries (plans, actuals) inside `Promise.all(lines.map(...))` — 2N round trips for N budget lines — and fetches *all* years' rows before filtering to the requested year in JS. This should be two queries total (one for all plans in the year, one for all actuals in the year, both `WHERE year = ?`), grouped into a `Map<budgetLineId, rows>` in memory, matching the pattern already used correctly elsewhere (e.g. `analytics.ts`, `reforecast.ts`).  
     
3. **Per-row (and per-month-column) inserts in the CSV import loop (`imports.ts`).** The matrix-format import path awaits an individual `db.insert(monthlyPlansTable)`/`db.insert(monthlyActualsTable)` call inside a nested loop — for a wide CSV (12 month columns × many rows) this can mean thousands of sequential round trips for a single upload. Collect the rows into arrays and batch-insert (`db.insert(table).values([...])`) the same way `reforecast.ts` already does for forecast plans.

### Medium priority

4. **No automated tests for the core financial calculations.** The existing test suite (`artifacts/api-server/src/__tests__`) covers CSV import and snapshot restore/compare well, but there are no tests for `dashboard.ts`, `analytics.ts`, `projections.ts`, or `reforecast.ts` — i.e. none of the figures directors will actually see are under test. This is the highest-value place to add coverage before further changes, per the Testing Requirements above.  
     
5. **Minor O(m²) recomputation in `analytics.ts` category-burndown.** The cumulative-actuals loop re-sums from month 1 every time (`for m: for pm ≤ m: sum`) instead of carrying a running total forward. Harmless at 12 months, but worth tidying as an example of the "avoid recomputation" standard — trivial fix, replace with a single running accumulator.  
     
6. **No lint script/config found** at the workspace or API-server level (only `typecheck`). Recommend adding ESLint (or equivalent) to catch exactly this class of loop/query issue automatically going forward, rather than relying on manual review each time.

### Lower priority / worth noting

7. **Colour palette is a custom hardcoded hex scheme** (`constants/colors.ts`), not Apple's semantic system colours (e.g. `systemBlue`, `systemRed`, `label`), and doesn't visibly account for increased-contrast accessibility settings. It does support light/dark theming already, which is a good foundation — bringing it closer to Apple HIG semantic colour usage would be a design refinement rather than a rebuild.  
8. Root `package.json` has no top-level `test` script tying the API test suite into a single command — minor workflow friction, easy fix.

None of the above require new features; they are corrections to how existing functionality is implemented, focused on correctness (money precision), performance (loops/queries), and safety (test coverage) as requested.  
