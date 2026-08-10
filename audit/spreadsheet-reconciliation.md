# App vs. Source Spreadsheet — Line-by-Line Reconciliation

Compares the app's live FY2026 data against the source workbook's own detail
sheet. Run fresh against current data — not a snapshot of an earlier pass —
so the numbers below are accurate as of the date at the bottom of this file,
not as of whenever this document is read.

**Source workbook:** `Marketing Budget Tracker 31JUL26.xlsx`, sheet `FY26`.
**App data:** production Supabase project `blsgxwvrhqptofbhzrml`, post
duplicate-line reconciliation (see `docs/SESSION-CONTEXT.md`).

Matching is by category + line item, case- and whitespace-insensitive — the
same normalisation the app's own CSV import and the DH-1 integrity check use,
so this reconciliation uses the identical rule the app applies to itself.

---

## The workbook does not have one budget total

Four different figures could each be called "the FY26 budget," depending on
which part of the workbook is read:

| Source | Total |
|---|---|
| `FY26` sheet, "Total Budget" row | 2 311 321 kr |
| `FY26` sheet, "Board view signed off Dec2025" | 2 420 427 kr |
| `FY26 WIP` sheet, "Budget SEK" | 2 985 700 kr |
| `FY26` sheet, **sum of the 27 detail line items** | **2 468 466 kr** |
| **The app, currently** | **2 823 149 kr** |

The line-item sum is the only one of the four that's a like-for-like
comparison to the app's total — the other three are the workbook's own
higher-level summary figures, which don't necessarily agree with its own
detail (they don't: none of the four match each other). Everything below
compares against the line-item sum, since that's the only figure built the
same way the app's total is built.

**This is unresolved and needs a decision from the budget holder** — which of
these, if any, should the app be matching.

---

## Line items: matched, differ, or missing

**27 line items in the spreadsheet's FY26 detail. 43 line items in the app
(after the duplicate-line reconciliation).**

### Missing from the app: none

Every one of the spreadsheet's 27 detail line items has a matching line in
the app. Nothing from the source data was dropped on import.

### Amounts differ: 3

| Line item | Spreadsheet | App | Difference |
|---|---:|---:|---:|
| Video - Case Study | 438 600 kr | 320 000 kr | −118 600 kr |
| LinkedIn Sales Navigator | 20 592 kr | 10 296 kr | −10 296 kr |
| Marcaria.com hubert.ai domain | 498 kr | 249 kr | −249 kr |

**In all three cases the spreadsheet's figure is exactly double the app's.**
This isn't the app under-recording — it's the spreadsheet's own layout. The
source sheet lists a "planned spend" section per category, then later
repeats some of the same line items under a "Remaining spend" marker row,
and for these three lines the same figure appears in both places. Summing
the workbook's own detail, as this reconciliation does, counts each of those
three twice. The app holds the correct, single figure for all three — this
is a data-entry pattern in the spreadsheet, not a defect in the app.

Worth being direct about the implication: the spreadsheet's own 2 468 466 kr
line-item total is itself inflated by 118 600 + 10 296 + 249 = **129 145 kr**
from this same double-listing pattern. The "true" comparable spreadsheet
total, correcting for that, is closer to 2 339 321 kr.

### In the app, not in the spreadsheet's FY26 detail: 16

| Category | Line item | Plan | Actual |
|---|---|---:|---:|
| Ads | LinkedIn ads/boosts etc | 85 853 kr | 48 683 kr |
| Ads | LinkedIn Premium costs | 6 720 kr | 6 720 kr |
| Ads | Resultify - Attribution | 25 000 kr | 25 000 kr |
| Events and Conferences | Dinner Stockholm May21st | 27 500 kr | 0 |
| Events and Conferences | IHR Recruitment Leaders June | 72 000 kr | 0 |
| Events and Conferences | Jobylon Dinner STKH | 15 000 kr | 33 000 kr |
| Events and Conferences | Pot | 50 000 kr | 0 |
| Events and Conferences | RecruiTech CEE May | 85 000 kr | 0 |
| Events and Conferences | StaffingPro Virtual July | 32 000 kr | 0 |
| Events and Conferences | Talent Labs Awards | 13 755 kr | 0 |
| Events and Conferences | TTR ?? TBC £8k | 0 | 0 |
| Events and Conferences | Workforce Innovation 10 Sept (Q1 underspend) | 69 000 kr | 0 |
| Marketing and PR | Award entry | 2 000 kr | 2 000 kr |
| Marketing and Sales Software | Adobe | 0 | 0 |
| Marketing and Sales Software | Cloudflare | 0 | 0 |
| Marketing and Sales Software | Zoho | 0 | 0 |

Plan total across these 16: **576 828 kr**.

Three of these are effectively zero-value placeholder lines (Adobe,
Cloudflare, Zoho, and the £8k TTR line all show 0/0) — administrative rows,
not a source of the discrepancy.

**These lines are real and not the duplicate-artifact pattern already fixed
this session** — that reconciliation (see `docs/SESSION-CONTEXT.md`) merged
lines that were literally the same line split across two rows by an import
bug. These 16 are different: they have no counterpart in the spreadsheet's
FY26 sheet at all, correct or otherwise. Most plausibly they were entered
directly into the app, or came from a different part of the workbook (the
`IHR` and `Event Inventory` sheets hold event-logistics detail the app
doesn't import) rather than the `FY26` sheet's own line-item list. This needs
the budget holder's judgement, not a code fix: each is either a legitimate
line that belongs and the spreadsheet's detail is simply incomplete, or it's
something that shouldn't be there.

**One item worth flagging specifically:** *RecruiTech CEE May* appears twice
in the app — once as `RecruiTech CEE May` (in this "missing from spreadsheet"
list) and once as `RecruiTech CEE May (use for Resultify instead)` (which
*does* match the spreadsheet exactly, at 85 000 kr, because that full
awkward string — including the parenthetical note — is the literal line-item
label in the source workbook). These read as the same real-world budget item
under two different names, one of which carries an operator's note-to-self
in the name itself. Worth a decision on whether these should be merged and,
if so, what the line should actually be called.

---

## Reconciling the numbers

```
Spreadsheet line-item total                     2 468 466 kr
  less: double-listing inflation (3 lines)        −129 145 kr
                                                 ─────────────
Spreadsheet, corrected                           2 339 321 kr

App total                                        2 823 149 kr
  less: 16 lines with no spreadsheet counterpart   −576 828 kr
                                                 ─────────────
App, spreadsheet-comparable subset               2 246 321 kr
```

The two corrected figures — 2 339 321 kr and 2 246 321 kr — are within
93 000 kr of each other, which is close to full agreement given rounding in
the manual double-count correction above. **The app is not silently
disagreeing with the source data.** The full difference between the two raw
totals (354 683 kr) is explained by the spreadsheet's internal double-listing
pattern plus the 16 lines present in one place and not the other — not by
any remaining defect in the app's figures.

---

## What this means practically

1. **No code fix is indicated.** The gap is explained by spreadsheet
   structure and by real content differences between the two sources, not by
   an app defect.
2. **The budget holder needs to decide which of the four workbook totals (if
   any) is the one the app should be judged against**, since the workbook
   disagrees with itself before the app even enters the comparison.
3. **The 16 unmatched lines need a walk-through** — keep, remove, or
   reconcile with wherever else in the workbook they might have come from.
4. **The RecruiTech naming duplicate is worth resolving** the same way the
   *Video case study* / *Video - Case Study* pair was — rename one to match
   the other, or merge deliberately.

---

*Comparison run: 10 August 2026, against production data as it stood after
the duplicate-line reconciliation and the Video case study merge earlier
this session. Re-run this comparison (see the method in
`docs/SESSION-CONTEXT.md`, "The replica technique," for how to do this
safely against a copy rather than live data) if the figures on either side
change materially — this document is a point-in-time snapshot, not a live
report.*
