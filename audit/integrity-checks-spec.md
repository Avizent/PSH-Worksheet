# Integrity Check Specification

Reference document for the "Check Integrity" feature. This is the exact set of
checks to run when the button is pressed — read this file before implementing
or executing that feature; do not infer additional checks or omit any listed
here without updating this spec first.

Each check specifies what to query, the pass/fail condition, severity, and
what to tell the user. Checks are read-only. None of them may write, delete,
or modify data. Where a check identifies a fixable condition, the response
is a described remediation action for a human to review and trigger
separately — never an automatic write performed by the check itself.

Severity tiers:
- **Critical** — the condition means a figure currently shown in the app is
  provably wrong. Surface prominently, do not bury among other findings.
- **Warning** — needs a human decision; not necessarily wrong on its own.
- **Info** — hygiene. Worth listing, not urgent.

Schema references below use table/column names as they exist in
`lib/db/src/schema/`: `budget_lines`, `monthly_plans`, `monthly_actuals`,
`forecast_plans`, `forecast_versions`, `events`, `alerts`, `csv_import_rows`,
`budget_line_columns`, `exchange_rates`, `audit_logs`.

---

## Data health checks

Structural integrity of the budget-line entity model.

### DH-1 — Duplicate budget lines
Group `budget_lines` by `(lower(trim(category)), lower(trim(line_item)))`
with internal whitespace collapsed to single spaces. Any group with more
than one row is a duplicate group.
**Severity:** Critical.
**Remediation:** merge onto the lowest `id` in the group, following the
same slot-by-slot policy as the reconciliation logic (move an orphan slot,
fill a keeper's explicit zero, drop an empty duplicate row, drop an
identical duplicate row, and refuse to auto-resolve a slot where both rows
hold different non-zero values).

### DH-2 — Near-duplicate budget lines
Same grouping as DH-1, but with all non-alphanumeric characters stripped
(punctuation, whitespace) before lowercasing. Report any group that has
more than one member under this looser key but was not already caught by
DH-1.
**Severity:** Warning.
**Remediation:** never auto-merge. Present both rows side by side with
their current plan/actual totals and require the user to either rename one
line to match the other exactly (which promotes it to a DH-1 duplicate on
the next check, at which point it merges normally) or confirm they are
genuinely distinct lines.

### DH-3 — Split plan/actual pairs
Among `budget_lines` in the same category, find pairs where the
line-item names are similar (e.g., share a normalized DH-2 key after
stripping a small set of common qualifier words, or pass a configurable
string-similarity threshold) and one line has a non-zero plan total with
zero actual for the year while the other has zero plan with a non-zero
actual.
**Severity:** Warning.
**Remediation:** surface as a suggested merge candidate; requires human
confirmation, same as DH-2.

### DH-4 — Inconsistent blank representation
For each of `owner`, `region`, `cost_status`, `channel`, `subcategory`,
check whether both `NULL` and `''` (empty string) values are present
across `budget_lines`. If both forms exist, flag the field.
**Severity:** Warning.
**Remediation:** normalize on write going forward (empty string → NULL);
report the count of rows affected per field for a one-time backfill.

### DH-5 — Orphaned child rows
For each of `monthly_plans`, `monthly_actuals`, `forecast_plans`,
`events`, `alerts`, `csv_import_rows`: count rows whose `budget_line_id`
does not match any row in `budget_lines`.
**Severity:** Critical (should be structurally impossible given current
foreign-key constraints; a non-zero count indicates either a constraint
regression or data written outside the application).
**Remediation:** for `events`/`alerts`/`csv_import_rows` (nullable FK,
`ON DELETE SET NULL`), set to NULL. For `monthly_plans`/`monthly_actuals`/
`forecast_plans` (non-null FK, `ON DELETE CASCADE`), the row cannot
legitimately exist orphaned — flag for manual investigation rather than
auto-deleting.

### DH-6 — Category name drift
Group `budget_lines` by `lower(trim(category))` with punctuation and
whitespace normalized (same rule as DH-2). Flag any case where more than
one distinct raw `category` value maps to the same normalized key.
**Severity:** Warning.
**Remediation:** report the distinct spellings and their row counts; a
human picks the canonical spelling and the fix is a bulk rename, not a
line-level merge.

### DH-7 — Non-standard cost status
Compare the distinct values present in `budget_lines.cost_status` against
the recognized set used by validation elsewhere in the app (currently:
Fixed Cost, Variable, Planned, Booked, Spent). Flag any row whose value is
blank or outside that set.
**Severity:** Warning (Critical if the blank/invalid value is already
known to break export or import validation, which it currently does).
**Remediation:** report affected rows; a human assigns a valid status.

### DH-8 — Empty lines
`budget_lines` rows where the sum of `monthly_plans.planned_amount` and
the sum of `monthly_actuals.actual_amount` for the active year are both
zero.
**Severity:** Info.
**Remediation:** none required; list for optional cleanup.

---

## Spreadsheet integrity checks

Does the export/import boundary still hold.

### SI-1 — Round-trip check
Generate the current Excel export (in SEK; the export's own currency
guard already refuses a converted round-trip, so this check operates on
the SEK path). Run the generated file back through the import validator
in dry-run mode (validate only, no write). The result must report zero
differences from current state and zero validation errors.
**Severity:** Critical if it fails — it means the export and import
schemas have diverged, and any real import cycle would silently corrupt
data.
**Remediation:** not automatable; requires a code fix to whichever side
drifted. This check exists to catch that drift immediately rather than
via a corrupted production import.

### SI-2 — Header schema check
Compare the column header row the export currently produces against a
stored baseline of the expected header set and order (the same
`BASE_HEADERS_LEFT` / `MONTH_HEADERS` construction the import validator
checks against). Any mismatch is a hard fail.
**Severity:** Critical.
**Remediation:** code fix; this should not occur without a deliberate,
reviewed schema change, in which case the baseline is updated alongside
that change.

### SI-3 — Month coverage
For the active year, count `monthly_plans` rows per `budget_line_id`.
Every line should have exactly 12. Flag any with fewer.
**Severity:** Warning.
**Remediation:** backfill missing months as zero-value rows, following
the same convention as new-line creation.

### SI-4 — Custom column type consistency
For each key present in `budget_lines.custom_fields`, look up its
declared `type` in `budget_line_columns`. Flag any stored value that does
not match its declared type (a non-numeric string stored under a
`number`-typed column, or vice versa).
**Severity:** Warning.
**Remediation:** report affected rows and columns; correction is a
data-entry fix, not automatable generically.

### SI-5 — Snapshot staleness
Compare the most recent snapshot's recorded totals (`totalBudget`,
`totalSpent`, `lineCount`) against the current live totals. Report the
age of the most recent snapshot and the magnitude of the difference.
**Severity:** Info, unless no snapshot exists at all or the most recent
one is older than a configurable threshold (e.g., 30 days), in which case
Warning.
**Remediation:** suggest taking a new snapshot.

### SI-6 — Source-spreadsheet reconciliation (optional, file input required)
Given an uploaded source workbook, parse its line-item detail the same
way the import validator does, and diff against current `budget_lines` +
`monthly_plans` totals per line: amounts that differ, lines present in
one side and not the other.
**Severity:** Info (this is a comparison against an external document, not
an internal consistency check — findings require human judgment on which
side is correct).
**Remediation:** none automatic; presents a diff for review.

---

## Calculation checks

Is the app's own arithmetic internally consistent — every check here
recomputes independently from raw rows and compares against what the
relevant API/screen currently returns.

### CC-1 — Remaining recomputation
For every budget line, every category, and the grand total: independently
compute `sum(planned_amount) - sum(actual_amount)` from `monthly_plans`
and `monthly_actuals` for the active year, and compare against the value
currently returned by the dashboard/analytics endpoints.
**Severity:** Critical on any mismatch.
**Remediation:** code fix — indicates a screen or export has diverged from
the shared calculation path.

### CC-2 — Category subtotal consistency
Sum of per-category totals (as computed by CC-1's category-level pass)
must equal the grand total (CC-1's overall pass). A mismatch indicates a
line is being excluded from category grouping while still counted in the
total, or the reverse (most commonly caused by a NULL or unrecognized
`category` value).
**Severity:** Critical.
**Remediation:** code fix; also cross-reference DH-6/DH-7 for a likely
root cause.

### CC-3 — Currency round-trip
Using the currently active exchange rate, convert a representative SEK
figure to GBP and back to SEK. The result must equal the original within
the numeric column's rounding precision.
**Severity:** Critical on failure.
**Remediation:** code fix to the conversion function.

### CC-4 — Money-column precision
Query `information_schema.columns` for every column expected to be
`numeric` (all monetary columns across `budget_lines`, `monthly_plans`,
`monthly_actuals`, `forecast_plans`, `events`, `exchange_rates`,
`csv_import_rows`). Flag any that report a different underlying type
(e.g., `real`/`double precision`).
**Severity:** Critical.
**Remediation:** schema migration to restore `numeric`.

### CC-5 — Projection formula consistency
For every line with `cost_status = 'Fixed Cost'` and months past the
current month, independently recompute the projected figure as
`last_actual * (1 + projection_pct / 100)` and compare against what the
projections endpoint currently returns.
**Severity:** Critical on mismatch.
**Remediation:** code fix.

### CC-6 — Board-approved vs. planned variance
For each budget line, compare `board_approved_amount` against the sum of
`monthly_plans.planned_amount` for the year. Flag lines where the
difference exceeds a configurable threshold (absolute amount or
percentage).
**Severity:** Info (this is a governance signal, not a code-correctness
issue).
**Remediation:** none automatic; a data-entry or approval-process
question for a human.

### CC-7 — Rollover integrity
For the most recent rollover (identified via `audit_logs` entries with
`entity_type = 'annual_rollover'`), confirm the target year's total
planned amount exactly equals the source year's total planned amount at
the time of rollover.
**Severity:** Critical on mismatch.
**Remediation:** indicates a partial or failed rollover; requires manual
investigation of which lines are missing before any corrective write.

### CC-8 — Exchange-rate sanity
Check the currently active row in `exchange_rates`: rate must be
non-null, greater than zero, and within a configurable plausible band
(e.g., reject if outside roughly 5–25 SEK per GBP, adjustable as real
rates move).
**Severity:** Critical if null/zero/negative (every GBP-displayed figure
is currently wrong); Warning if outside the plausible band but positive
(possible fat-finger, needs confirmation rather than certain error).
**Remediation:** prompt for a corrected rate entry through the normal
exchange-rate admin flow; do not auto-correct.

### CC-9 — Reforecast delta consistency
For each `forecast_version`, independently recompute the delta between
its `forecast_plans` totals and the original version's totals, and
compare against what the reforecast comparison endpoint currently
returns.
**Severity:** Critical on mismatch.
**Remediation:** code fix.

---

## Output contract

Each check returns: check ID, severity, a human-readable finding
description, the specific rows/entities affected (with enough identifying
detail — category, line item, year/month — to locate them in the app
without a database query), and, where applicable, a suggested remediation
action for the user to review and separately confirm. No check result
implies or triggers a write on its own.
