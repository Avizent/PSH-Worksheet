# Session Context — August 2026

Reference for anyone (human or AI) picking this project up. Records what was
done, **why decisions were made**, what was deliberately not done, and the
practical gotchas discovered along the way.

Read alongside:
- `CLAUDE.md` — project conventions and engineering standards
- `HANDOVER.md` — ownership transfer and setup
- `audit/phase-5-data-integrity.md`, `audit/phase-6-security.md` — full findings
- `audit/integrity-checks-spec.md` — specification of the 21 integrity checks

---

## Where the project stands

**Repository:** `Avizent/PSH-Worksheet` · branch `main` · HEAD `9d2db98`

| Commit | What |
|---|---|
| `d86ac99` | Audit remediation — auth, currency safety, data integrity, desktop packaging |
| `aad8207` | Integrity check specification |
| `235231e` | Check Integrity feature (engine, API, screen, tests) |
| `9d2db98` | Handover document |

**Tests:** 91 passing across 5 files. **Typecheck:** clean across all 6 packages.

**Production data (FY2026, Supabase project `blsgxwvrhqptofbhzrml`):**
44 budget lines · 2 823 149,06 kr budget · 574 047,84 kr spend.

---

## What happened, in order

The app was built in Replit and inherited for review. The session ran roughly:

1. **Desktop packaging** — Electron wrapper so the app runs as a native macOS
   app rather than a dev server. Connection string stored in Keychain.
2. **FY26 reseed** — production data loaded from the source spreadsheet.
   *This load is the origin of the duplicate-line incident below.*
3. **Multi-currency** — SEK as the stored base, GBP as a display lens with an
   admin-set rate. Included migrating 8 money columns from floating-point
   `real` to exact `numeric`.
4. **Two-phase audit** — data integrity (Phase 5) and security (Phase 6),
   producing the two reports in `audit/`.
5. **Remediation** — every Critical and High finding except the `xlsx`
   dependency.
6. **Test infrastructure** — the suite couldn't run at all; made hermetic.
7. **Production data reconciliation** — the duplicate-line incident, found,
   quantified, and fixed.
8. **Check Integrity feature** — the audit's findings encoded as 21 repeatable
   checks with an admin screen.
9. **Handover preparation** — documentation and transfer planning.

---

## The duplicate-line incident

The single most important thing to understand about this project's data.

**What happened.** The FY26 load ran as two operations two minutes apart
(19:34 and 19:36 on 1 Aug 2026). The first created 42 budget lines carrying
the *plans*. The second created 17 more carrying the *actuals* — because the
CSV import path auto-created a budget line for any row it couldn't match,
rather than matching the lines that already existed.

**The effect.** 13 of those 17 duplicated an existing line. Each real budget
line ended up split across two rows: one with the budget and no spend, the
other with spend and no budget. **25 of 59 lines (42%) showed a wrong
remaining figure**, and 52.7% of all recorded spend sat on a line whose budget
lived elsewhere. Two lines were duplicated in *both* directions, overstating
budget and spend by 110 249 kr each.

Aggregate totals mostly survived the split, which is why it wasn't obvious.

**What it hid.** *Jobylon Dinner STKH* was 18 000 kr over budget — invisible,
because the 15 000 kr budget and 33 000 kr spend were on different rows.

**How it was fixed.** `scripts/src/reconcile-duplicate-lines.ts` merges each
group onto its oldest row. Applied to production in two passes: 12 groups
(59 → 45 lines), then the punctuation-variant *Video case study* pair
(45 → 44). Backup at `scripts/backups/` (gitignored).

**Why it can't recur.** CSV import no longer auto-creates budget lines — it's
opt-in per upload via `createMissingLines`, and unmatched rows are reported
for review instead.

---

## Decisions and their reasoning

Recorded so they aren't relitigated or accidentally reversed.

**Auto-create on import is off by default.** It caused the incident above and
contradicts CLAUDE.md's "baseline budget is read-only once set". Preserved as
an explicit opt-in rather than deleted, so the capability still exists when
genuinely wanted.

**Duplicate merging is two-tier.** Exact matches (case and whitespace
insensitive) merge automatically. Punctuation-insensitive matches are
*reported only*, never auto-merged — dropping punctuation can bucket
genuinely different lines together, and that isn't a call a script should make
about someone's budget.

**Zero is absence of data, not a competing value.** The reconciliation's first
version treated any differing amount as a conflict; because the bad load wrote
explicit zeros for all twelve months, this flagged every group and would have
merged nothing while appearing to work. The rule distinguishes: move an orphan
slot, fill a keeper's explicit zero, drop an empty row, drop an identical row,
and refuse only when both hold *different non-zero* values.

**GBP exports are reporting artefacts, not a round-trip format.** Rather than
removing GBP export, the workbook is stamped with its currency in a hidden
sheet and the importer refuses a converted file. An unstamped workbook is
still treated as SEK, so hand-made spreadsheets keep working — the protection
can be defeated by deleting a sheet, which was a deliberate trade for not
breaking legitimate imports.

**Integrity checks are read-only by construction.** Not by a rule they're
asked to follow — they simply have no write capability. Findings describe
remediation for a human to trigger separately.

**Destructive routes are admin-only, and reject the VP session.** The VP API
key shipped inside the web bundle, so treating it as an admin credential would
have put database-wiping behind a key every client could read.

**CORS defaults to same-origin.** The session travels in a header rather than
a cookie, so the previous wildcard let any page the user visited read and
write the budget. Deployments that split frontend and API must set
`CORS_ORIGINS`.

---

## Deliberately not done

**`xlsx` dependency (P6-11).** Two high advisories, no patched version on npm —
SheetJS moved distribution to their own CDN. Installing from a non-registry
URL changes the supply chain, and migrating the read path to ExcelJS is a
parser rewrite with real regression risk. Left for a human decision. Practical
severity dropped once the API stopped being unauthenticated.

**SI-1 full round-trip.** The spec describes generating the export and feeding
it back through the import validator. Implemented instead as a field-level
re-import readiness check, because a true round-trip needs the export's
workbook builder extracted from its route handler — a refactor of the export
path that had just been fixed. The field rules are what that round-trip would
actually fail on. The code says so.

**SI-6 spreadsheet diff.** Needs a file upload, so it belongs to its own
endpoint rather than the one-button run.

**Board View.** Greyed out in the sidebar, not removed — director access was
deferred in favour of a PowerPoint export that hasn't been built.

**The spreadsheet reconciliation.** The app's total (2 823 149,06 kr) doesn't
match the source workbook's line-item detail (2 468 466 kr). The workbook
contains *three different* budget totals across its sheets, and 12 app lines
have no counterpart in its FY26 detail. This needs a human judgement about
which total is authoritative, not a code fix.

---

## Environment constraints and gotchas

Practical things that cost time to discover.

**No local Postgres, no Docker, no `.env` on the development machine.** The
app's connection string lives encrypted in the macOS Keychain (via the
desktop app's setup screen), not in a file.

**The test suite uses in-process PGlite.** `artifacts/api-server/vitest.config.ts`
aliases `@workspace/db` to `src/__tests__/helpers/testDb.ts`, giving real
Postgres semantics with no server. Tests cannot reach production. The alias is
an anchored regex so `@workspace/db/schema` still resolves to the genuine
schema module.

**Adding PGlite duplicated `drizzle-orm`.** pnpm resolves a separate instance
per peer-dependency set, so `lib/db` and `api-server` ended up with
structurally identical but incompatible types. Fixed by giving `lib/db` the
same peer. The same class of problem `pnpm-workspace.yaml` already documents
for `@types/react`.

**`pglite-socket` can't handle concurrent queries.** It drops the connection
with `ECONNRESET` when two run at once — which the integrity engine does. Fine
for sequential work; use in-process PGlite (i.e. vitest) for anything
concurrent.

**Some operations are blocked by the session permission layer** — pushing to
`main`, writes through the Supabase connector, installing from a non-registry
URL. These need the user to act or to grant permission; they are not
capability limits and should not be worked around.

---

## The replica technique

Worth reusing. To validate something against production data without touching
production:

1. Export current rows read-only via the Supabase connector (compact
   `string_agg` format keeps it small — regenerate all-zero rows rather than
   exporting them).
2. Apply the repo's real migration files to a PGlite instance.
3. Load the exported rows.
4. Confirm the replica's opening totals match production exactly.
5. Run the real code against it.

This validated the reconciliation script end to end — including a `--commit`
run — before anything touched production, and caught two genuine bugs in the
process. Scratch harness files live in the session scratchpad, not the repo.

---

## Verification standard used

Claims in this project were checked, not assumed:

- The reconciliation was proven on a replica producing identical totals before
  being applied.
- The integrity checks were validated against a replica of production *as it
  stood before the reconciliation*, where they independently rediscovered all
  12 duplicate groups, the punctuation-variant pair, the blank cost status and
  the re-import blocker — in 31 ms.
- 15 integrity tests plant specific faults and assert each check detects its
  own.
- Every reported figure came from a query run at the time, not from memory.

---

## Open questions for the owner

1. **`xlsx`** — CDN install, migrate to ExcelJS, or accept?
2. **Which spreadsheet total is authoritative** — the FY26 detail
   (2 468 466 kr), the board-signed-off figure (2 420 427 kr), or the WIP
   model (2 985 700 kr)?
3. **The 12 app lines absent from the spreadsheet's FY26 detail** — legitimate
   or not?
4. **PowerPoint export** — build it? Scoped: `pptxgenjs` with native editable
   charts, reusing `buildBoardViewData` and `resolveExportCurrency`.
5. **AI access** — an MCP server giving Claude read/write access to the app was
   discussed and scoped; read-only first was recommended.
6. **Ownership transfer** — GitHub and Supabase project transfer, then the new
   owner resets the database password themselves.

---

## Immediate follow-ups

- Delete the empty artifact line *Other Costs · Website fixes* (id 135) — no
  budget, no spend, left from the bad load.
- Rename one of the *RecruiTech CEE May* lines if they're the same event.
- Add an application icon (currently the generic Electron one).
- Rotate the seeded account password via `SEED_PASSWORD_ADMIN` /
  `SEED_PASSWORD_EDITOR`; the original was committed to git history.
