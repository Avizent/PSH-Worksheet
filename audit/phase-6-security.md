# Phase 6 — Security Audit

**Scope:** `artifacts/api-server/src/**`, `lib/db/src/**`, auth/token handling in `artifacts/budget-tracker`, `lib/api-client-react/src/custom-fetch.ts`, root/workspace config.
**Method:** static review only. Every route file, middleware file and `lib/` file in the API server was read in full. No code was modified, no server was run, no live requests were made. The only command executed was `pnpm audit --prod` (read-only).
**Date:** 2026-08-01

---

## Summary

The application's **input handling is genuinely good** — every database query goes through Drizzle with bound parameters, uploads are size-limited and held in memory (no attacker-controlled filenames touch disk), the snapshot file handlers all reject `..` and `/`, the one outbound HTTP call uses a hardcoded URL with a timeout and a validated response, and passwords are hashed with bcrypt at cost 12. There is no SQL injection, no command injection, no path traversal, and no SSRF in this codebase.

The problem is **authorisation, not injection**. Of roughly 60 registered endpoints, **9 enforce any authentication at all**. Everything else — every budget figure, every actual, the full audit log, the CSV import pipeline, the Excel import that deletes budget lines, the exchange rate that rescales every number the directors see, the snapshot restore that replaces the entire database, and a `POST /api/seed` that truncates twelve tables — is reachable by anyone who can send an HTTP request to the hosted URL. `app.use(cors())` at `app.ts:29` sets `Access-Control-Allow-Origin: *`, so any web page in any browser can also drive these endpoints. The login screen in the Expo app is a client-side redirect (`app/_layout.tsx` `AuthGate`) and gates nothing on the server.

Separately, the two application accounts have their passwords hardcoded in plaintext in a committed source file, and that file is re-applied on **every server start**, so the password cannot be changed and is public to anyone with repository access.

### Overall risk posture

**Critical.** This is not a "harden it over the next quarter" posture. Any unauthenticated party who discovers the hosted URL can read the full company marketing budget and can destroy it with a single POST — and can then log in as the admin using a password that is checked into git. The correctness work from earlier phases is meaningfully undermined by the fact that the data it protects is currently public and unprotected. The recommended immediate action is a single global auth gate in front of `/api` (allow-listing only `/healthz`, `/auth/login` and the share-token board endpoints), plus rotating the two account passwords out of source.

**Counts:** 6 Critical · 6 High · 6 Medium · 2 Low

---

## Route inventory — authentication status

All routes are mounted under `/api` (`app.ts:33`). Registration order is `routes/index.ts:33-60`.

Legend: **None** = no authentication check of any kind in the handler or its middleware chain.

| Method & path | File:line | Auth required? | Notes |
|---|---|---|---|
| GET `/api/healthz` | `health.ts:9` | None | Returns `ok`/`migrating`/`error` only. Acceptable — no data exposed. |
| POST `/api/auth/login` | `userAuth.ts:29` | Public by design | No rate limiting (P6-12). |
| POST `/api/auth/logout` | `userAuth.ts:67` | Token in header | Deletes own session. Fine. |
| GET `/api/auth/me` | `userAuth.ts:73` | **Yes** (`x-user-session`) | |
| POST `/api/auth/vp-login` | `board.ts:35` → `vpAuth.ts:20` | API key (`x-api-key`) | Key is shipped in the web bundle (P6-9). |
| GET `/api/dashboard/summary` | `dashboard.ts:9` | **None** | Full budget totals. |
| GET `/api/dashboard/charts` | `charts.ts:11` | **None** | |
| GET `/api/projections` | `projections.ts:9` | **None** | |
| GET `/api/analytics/owner-breakdown` | `analytics.ts:8` | **None** | Names + spend per owner. |
| GET `/api/analytics/regional-investment` | `analytics.ts:39` | **None** | |
| GET `/api/analytics/fixed-vs-variable` | `analytics.ts:98` | **None** | |
| GET `/api/analytics/category-burndown` | `analytics.ts:157` | **None** | |
| GET `/api/analytics/board-variance` | `analytics.ts:207` | **None** | Board-approved vs actual. |
| GET `/api/budget-lines/with-monthly` | `budget-lines-with-monthly.ts:9` | **None** | Entire budget, line by line. |
| GET `/api/budget-lines` | `budget-lines.ts:21` | **None** | |
| POST `/api/budget-lines` | `budget-lines.ts:37` | **None** | Mutating. |
| GET `/api/budget-lines/categories` | `budget-lines.ts:55` | **None** | |
| GET `/api/budget-lines/:id` | `budget-lines.ts:64` | **None** | |
| PATCH `/api/budget-lines/:id` | `budget-lines.ts:78` | **None** | Mutating. |
| DELETE `/api/budget-lines/:id` | `budget-lines.ts:112` | **None** | Destructive. |
| GET `/api/monthly-plans` | `monthly-plans.ts:22` | **None** | |
| POST `/api/monthly-plans` | `monthly-plans.ts:42` | **None** | Mutating — writes the baseline. |
| PATCH `/api/monthly-plans/:id` | `monthly-plans.ts:60` | **None** | Mutating — edits the baseline. |
| PUT `/api/budget-lines/:id/plans` | `monthly-plans.ts:91` | **None** | Mutating. |
| GET `/api/monthly-actuals` | `monthly-actuals.ts:22` | **None** | |
| POST `/api/monthly-actuals` | `monthly-actuals.ts:42` | **None** | Mutating. |
| PATCH `/api/monthly-actuals/:id` | `monthly-actuals.ts:60` | **None** | Mutating. |
| PUT `/api/budget-lines/:id/actuals` | `monthly-actuals.ts:84` | **None** | Mutating. |
| GET `/api/alerts` | `alerts.ts:19` | **None** | |
| PATCH `/api/alerts/:id/resolve` | `alerts.ts:37` | **None** | Mutating — can silence overspend alerts. |
| POST `/api/alerts/evaluate` | `alerts-engine.ts:8` | **None** | Expensive; recomputes all alerts. |
| GET `/api/events` | `events.ts:18` | **None** | |
| POST `/api/events` | `events.ts:23` | **None** | Mutating. |
| PATCH `/api/events/:id` | `events.ts:40` | **None** | Mutating. |
| DELETE `/api/events/:id` | `events.ts:63` | **None** | Destructive. |
| GET `/api/imports` | `imports.ts:131` | **None** | |
| POST `/api/imports/upload` | `imports.ts:148` | **None** | Untrusted file → `xlsx` parser (P6-11). Auto-creates budget lines. |
| GET `/api/imports/:id` | `imports.ts:470` | **None** | |
| PATCH `/api/imports/rows/:id/assign` | `imports.ts:488` | **None** | Mutating. |
| POST `/api/imports/:id/confirm` | `imports.ts:544` | **None** | Mutating — writes actuals. |
| DELETE `/api/imports/:id` | `imports.ts:639` | **None** | Destructive — rolls back posted actuals. |
| POST `/api/imports/clear-all` | `imports.ts:704` | **None** | **Truncates 12 tables** (P6-3). |
| GET `/api/board/settings` | `board.ts:58` | **Yes** (`requireVpAuth`) | Any signed-in user passes (P6-8). |
| PUT `/api/board/settings` | `board.ts:63` | **Yes** (`requireVpAuth`) | |
| GET `/api/board/tokens` | `board.ts:93` | **Yes** (`requireVpAuth`) | Returns raw share tokens. |
| POST `/api/board/tokens` | `board.ts:98` | **Yes** (`requireVpAuth`) | Mints a board share link. |
| PATCH `/api/board/tokens/:id/revoke` | `board.ts:123` | **Yes** (`requireVpAuth`) | |
| GET `/api/board/view` | `board.ts:342` | Share token (query) | `validateToken()` at `board.ts:333`. Correct. |
| GET `/api/board/preview` | `board.ts:360` | **Yes** (`requireVpAuth`) | |
| GET `/api/exports/pdf` | `board.ts:365` | **Yes** (token OR session) | `board.ts:366-377`. Correct. |
| GET `/api/exports/reports-pdf` | `board.ts:525` | **Yes** (session only) | `board.ts:526-533`. Correct. |
| GET `/api/exports/excel` | `board.ts:720` | **Yes** (token OR session) | `board.ts:721-732`. Correct. |
| GET `/api/reforecast/versions` | `reforecast.ts:19` | **Yes** (`requireVpAuth`) | |
| POST `/api/reforecast/versions` | `reforecast.ts:54` | **Yes** (`requireVpAuth`) | |
| GET `/api/reforecast/versions/:id` | `reforecast.ts:101` | **Yes** (`requireVpAuth`) | |
| GET `/api/reforecast/compare` | `reforecast.ts:112` | **Yes** (`requireVpAuth`) | |
| GET `/api/audit-logs` | `audit-logs.ts:8` | **None** | Full change history (P6-17). |
| POST `/api/admin/rollover` | `admin.ts:16` | **Yes** (`requireVpAuth`) | |
| POST `/api/seed` | `seed.ts:10` | **None** | **Deletes and reseeds everything** (P6-2). |
| GET `/api/owners` | `owners.ts:18` | **None** | |
| POST `/api/owners` | `owners.ts:23` | **None** | Mutating. |
| PATCH `/api/owners/:id` | `owners.ts:44` | **None** | Mutating. |
| DELETE `/api/owners/:id` | `owners.ts:71` | **None** | Destructive. |
| GET `/api/categories` | `categories.ts:22` | **None** | |
| POST `/api/categories` | `categories.ts:47` | **None** | Mutating. |
| PATCH `/api/categories/:id` | `categories.ts:65` | **None** | Mutating. |
| DELETE `/api/categories/:id` | `categories.ts:100` | **None** | Destructive. |
| GET `/api/excel/export` | `excel.ts:47` | **None** | Full budget as .xlsx, no auth. |
| POST `/api/excel/validate` | `excel.ts:581` | **None** | Untrusted 10 MB file → `xlsx`. |
| POST `/api/excel/import` | `excel.ts:644` | **None** | **Deletes budget lines absent from the file** (P6-6). |
| GET `/api/snapshots` | `snapshots.ts:479` | **None** | Lists all restore points with totals. |
| GET `/api/snapshots/compare` | `snapshots.ts:490` | **None** | Full line-level diff. |
| GET `/api/snapshots/compare/pdf` | `snapshots.ts:510` | **Yes** (VP or user) | `snapshots.ts:513-521`. The only authed snapshot route. |
| GET `/api/snapshots/:id` | `snapshots.ts:688` | **None** | Full DB dump as JSON. |
| POST `/api/snapshots` | `snapshots.ts:708` | **None** | Writes a full DB dump to disk per call. |
| POST `/api/snapshots/import` | `snapshots.ts:721` | **None** | Injects an attacker-supplied snapshot (P6-4). |
| POST `/api/snapshots/:id/restore` | `snapshots.ts:878` | **None** | **Wipes and replaces the database** (P6-4). |
| DELETE `/api/snapshots/:id` | `snapshots.ts:1013` | **None** | Destroys restore points (P6-4). |
| PATCH `/api/snapshots/:id` | `snapshots.ts:1045` | **None** | Renames a snapshot. |
| PATCH `/api/snapshots/:id/pin` | `snapshots.ts:1093` | **None** | Un-pinning exposes a snapshot to auto-deletion. |
| GET `/api/events/:id/tasks` | `event-tasks.ts:29` | **None** | |
| POST `/api/events/:id/tasks` | `event-tasks.ts:46` | **None** | Mutating. |
| PATCH `/api/event-tasks/:id` | `event-tasks.ts:72` | **None** | Mutating. |
| DELETE `/api/event-tasks/:id` | `event-tasks.ts:102` | **None** | Destructive. |
| GET `/api/event-tasks/:id/reminders` | `event-tasks.ts:122` | **None** | |
| POST `/api/event-tasks/:id/reminders` | `event-tasks.ts:139` | **None** | Mutating. |
| POST `/api/events/:id/check-reminders` | `event-tasks.ts:168` | **None** | |
| DELETE `/api/task-reminders/:id` | `task-reminders.ts:13` | **None** | Destructive. |
| GET `/api/in-app-alerts` | `in-app-alerts.ts:16` | **None** | |
| POST `/api/in-app-alerts/mark-all-read` | `in-app-alerts.ts:57` | **None** | Mutating. |
| PATCH `/api/in-app-alerts/:id/read` | `in-app-alerts.ts:97` | **None** | Mutating. |
| GET `/api/budget-line-columns` | `budget-line-columns.ts:27` | **None** | |
| POST `/api/budget-line-columns` | `budget-line-columns.ts:35` | **None** | Mutating. |
| PATCH `/api/budget-line-columns/reorder` | `budget-line-columns.ts:73` | **None** | Mutating. |
| PATCH `/api/budget-line-columns/:id` | `budget-line-columns.ts:93` | **None** | Mutating — rewrites `custom_fields` on every line. |
| DELETE `/api/budget-line-columns/:id` | `budget-line-columns.ts:146` | **None** | Destructive — strips the field from every line. |
| GET `/api/exchange-rate` | `exchange-rate.ts:28` | **None** | |
| GET `/api/exchange-rate/lookup` | `exchange-rate.ts:37` | **None** | Outbound call, unauthenticated trigger. |
| POST `/api/exchange-rate` | `exchange-rate.ts:62` | **None** | **Rescales every GBP figure** in every export. |

**Totals: 9 routes enforce authentication (plus `/board/view` via share token and `/healthz` which exposes nothing). The remaining ~85 are open, including 33 mutating or destructive ones.**

---

## Critical

### P6-1 — No authentication on the majority of the API surface

**`artifacts/api-server/src/app.ts:33`, `artifacts/api-server/src/routes/index.ts:33-60`**

The router is mounted with no gate:

```ts
app.use("/api", router);
```

and `routes/index.ts` mounts 27 sub-routers without any middleware:

```ts
router.use(healthRouter);
router.use(userAuthRouter);
router.use(dashboardRouter);
...
```

Only 9 handlers perform their own check (`requireVpAuth` in `board.ts`/`reforecast.ts`/`admin.ts`, plus the inline dual-session checks at `board.ts:368-377`, `board.ts:526-533`, `board.ts:723-732`, `snapshots.ts:513-521`). Every other handler executes unconditionally. The login screen exists only in the client (`artifacts/budget-tracker/app/_layout.tsx`, `AuthGate` → `router.replace("/login")`), which is a UI redirect, not an access control.

**Attack scenario.** Anyone who learns the hosted URL — a former contractor, someone reading a shared board link's domain, a scanner sweeping the host — runs `curl https://<host>/api/budget-lines/with-monthly` and receives the complete FY2026 marketing budget: every line item, owner, region, planned amount, actual spend and board-approved figure. `curl https://<host>/api/audit-logs` then hands them the full history of every change. No credential, no token, no header is needed.

**Fix (one line):** mount a `requireAuth` middleware at `app.ts:33` before the router, with an explicit allow-list for `/healthz`, `/auth/login`, `/auth/vp-login` and `/board/view`.

---

### P6-2 — `POST /api/seed` destroys the entire database, unauthenticated

**`artifacts/api-server/src/routes/seed.ts:10-27`** (registered at `routes/index.ts:51`, with no middleware)

```ts
router.post("/seed", asyncHandler(async (_req, res): Promise<void> => {
  logger.info("Manual seed triggered — clearing all data and re-seeding...");

  await db.delete(forecastPlansTable);
  await db.delete(forecastVersionsTable);
  await db.delete(monthlyActualsTable);
  ...
  await db.delete(budgetLinesTable);
```

Twelve tables are unconditionally emptied — including `monthlyActualsTable` (a year of recorded spend), `auditLogsTable` (the record of who changed what), and `shareTokensTable` — and then replaced with demo seed data. There is no body, no confirmation parameter, and no auth check.

**Attack scenario.** `curl -X POST https://<host>/api/seed`. The budget holder's year of expenditure entries is gone, along with the audit log that would show it happened. The nightly snapshot at 02:00 (`lib/scheduler.ts`) would then capture the seeded state; if this goes unnoticed for a day, the pre-incident snapshots begin ageing out against `MAX_SNAPSHOTS = 50`.

**Fix:** gate behind `requireVpAuth` (or remove the route entirely and keep `scripts/src/reseed-fy26.ts` as the operator path).

---

### P6-3 — `POST /api/imports/clear-all` truncates 12 tables, unauthenticated

**`artifacts/api-server/src/routes/imports.ts:704-722`**

```ts
router.post("/imports/clear-all", asyncHandler(async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    const d = {
      forecastPlans: (await tx.delete(forecastPlansTable).returning()).length,
      ...
      auditLogs: (await tx.delete(auditLogsTable).returning()).length,
      monthlyPlans: (await tx.delete(monthlyPlansTable).returning()).length,
      budgetLines: (await tx.delete(budgetLinesTable).returning()).length,
    };
```

Unlike `/seed` this does not reseed — it leaves the database empty. It also deletes `auditLogsTable` and `shareTokensTable`, and unlike the snapshot restore path it takes **no pre-operation snapshot** first.

**Attack scenario.** `curl -X POST https://<host>/api/imports/clear-all` empties the application. Recovery depends entirely on the most recent nightly snapshot file on the server's disk; any work done since 02:00 is lost, and the audit log that would have shown the deletion is itself deleted.

**Fix:** gate behind `requireVpAuth` and take a `createSnapshot("pre-clear-all")` before the transaction, matching the pattern already used at `snapshots.ts:900`.

---

### P6-4 — Snapshot restore, import and delete are all unauthenticated

**`artifacts/api-server/src/routes/snapshots.ts:878` (restore), `:721` (import), `:1013` (delete)**

```ts
router.post(
  "/snapshots/:id/restore",
  asyncHandler(async (req, res): Promise<void> => {
```

The restore handler deletes eight tables inside a transaction and re-inserts from the snapshot file (`snapshots.ts:911-919`). `POST /snapshots/import` accepts an arbitrary attacker-supplied JSON body and writes it to disk as a new snapshot — the shape validation at `snapshots.ts:756-810` checks types, not provenance. `DELETE /snapshots/:id` removes restore points (it refuses only `pre-import`/`pre-restore` labels, `snapshots.ts:1031`). `PATCH /snapshots/:id/pin` can un-pin a protected snapshot so `enforceLimit()` will later delete it.

**Attack scenario.** Chained: `POST /api/snapshots/import` with a fabricated budget (inflated actuals, deleted lines), then `POST /api/snapshots/<that-id>/restore`. The live database is now the attacker's version. The pre-restore backup is created, but `DELETE /api/snapshots/:id` — also unauthenticated — removes any snapshot not labelled `pre-import`/`pre-restore`, so the attacker can prune the history around it. Directors then read fabricated figures in the board PDF.

**Fix:** gate all snapshot mutation routes (`POST`, `PATCH`, `DELETE`) behind `requireVpAuth`; `GET /snapshots*` behind `requireAuth`.

---

### P6-5 — Hardcoded plaintext passwords, committed to git, re-applied on every boot

**`artifacts/api-server/src/lib/seedAuthUsers.ts:7-20` and `:30-36`**

```ts
const AUTH_USERS = [
  {
    email: "rcp@avizent.com",
    name: "Patricia C.",
    password: "Patricia1!",
    role: "admin",
  },
  {
    email: "patricia.s.hyde@gmail.com",
    name: "Patricia H.",
    password: "Patricia1!",
    role: "editor",
  },
];
```

```ts
    const passwordHash = await bcrypt.hash(u.password, 12);

    if (existing) {
      await db
        .update(usersTable)
        .set({ passwordHash, name: u.name, role: u.role })
        .where(eq(usersTable.email, u.email));
```

Three compounding problems:

1. Both accounts share the same password, and it is a trivially guessable pattern (`Patricia1!` — the user's name plus `1!`).
2. It is in the git history. Anyone with repository access, past or present, has the production admin credential.
3. `seedAuthUsers()` is called unconditionally on **every** server start (`index.ts:40`) and **overwrites** the existing `passwordHash` for accounts that already exist. A password change made through any future UI would be silently reverted on the next deploy or restart. There is currently no password-change endpoint at all.

**Attack scenario.** The repository is on GitHub. Anyone with read access — or anyone who obtains a clone — logs in at the hosted URL as `rcp@avizent.com` with `Patricia1!` and has full application access. Even without repo access, `Patricia1!` is within reach of a short online guessing run, and there is no rate limiting on `/auth/login` (P6-12).

**Fix:** read the initial passwords from environment variables, seed only when the user row does not already exist, and rotate both passwords immediately (they must be treated as compromised).

---

### P6-6 — `POST /api/excel/import` deletes budget lines, unauthenticated

**`artifacts/api-server/src/routes/excel.ts:644`; the destructive delete at `excel.ts:769`**

```ts
router.post(
  "/excel/import",
  upload.single("file"),
  asyncHandler(async (req, res): Promise<void> => {
```

The handler takes a 10 MB uploaded workbook and reconciles the database against it — budget lines present in the DB but absent from the file are deleted (`db.delete(budgetLinesTable).where(...)`), and each surviving line's monthly plans and actuals are deleted and re-inserted (`excel.ts:840`, `:849`). There is no auth check. `POST /api/excel/validate` (`excel.ts:581`) is likewise open.

There is one mitigation: `createSnapshot("pre-import")` runs first (`excel.ts:736`). That makes the damage recoverable — but only if someone notices, and P6-4 means the attacker can delete that snapshot afterwards.

**Attack scenario.** An attacker uploads a one-row workbook in the export format. Every other budget line — and every actual attached to it — is deleted. The budget holder opens the app to an almost-empty budget.

**Fix:** require authentication on `/excel/import` and `/excel/validate`.

---

## High

### P6-7 — Wildcard CORS lets any website drive the API from a victim's browser

**`artifacts/api-server/src/app.ts:29`**

```ts
app.use(cors());
```

Bare `cors()` sets `Access-Control-Allow-Origin: *` for every route, with no origin allow-list and no method or header restriction. `credentials: true` is **not** set, which is the one thing keeping this from being worse.

On its own this would be a Medium — with `*` and no credentials, a cross-origin page cannot attach the victim's `x-user-session` header. But combined with P6-1 (no auth required in the first place), it means any web page, in any browser, can read and write the entire budget with plain `fetch()` and read the JSON response.

**Attack scenario.** A page at `https://anything.example` runs `fetch("https://<host>/api/budget-lines/with-monthly").then(r => r.json()).then(exfiltrate)`. The wildcard header permits the read; the missing auth permits the data. The same page can `POST /api/seed`.

**Fix:** `cors({ origin: [<the app's own origin>], credentials: false })`.

---

### P6-8 — The admin/VP distinction is not enforced server-side

**`artifacts/api-server/src/middleware/vpAuth.ts:61-73`, `lib/db/src/schema/users.ts:9`**

```ts
export function requireVpAuth(req: Request, res: Response, next: NextFunction): void {
  const vpSession = req.headers["x-vp-session"] as string | undefined;
  if (vpSession && isValidVpSession(vpSession)) {
    next();
    return;
  }
  const userSession = req.headers["x-user-session"] as string | undefined;
  if (userSession && isValidUserSession(userSession)) {
    next();
    return;
  }
```

`requireVpAuth` accepts **any** valid user session. The comment above it (`vpAuth.ts:50-60`) documents this as a deliberate fix for desktop builds, but the consequence is that "VP-protected" means "signed in".

The `users.role` column exists (`schema/users.ts:9`, values `admin`/`editor` set by `seedAuthUsers.ts:12,18`) but is **never read anywhere in the server**. A repo-wide grep for `role` in `artifacts/api-server/src` and `lib/db/src` returns only the seed file and the schema definition. `isValidUserSession` (`userAuth.ts:88`) returns a boolean and does not surface the user or their role, so no handler could check it even if it wanted to.

**Attack scenario.** The `editor` account signs in and calls `POST /api/board/tokens` to mint a permanent, never-expiring board share link, or `PUT /api/board/settings` to change what directors see, or `POST /api/admin/rollover` to create next year's budget. All are nominally admin-only; none check.

**Fix:** have `isValidUserSession` return the session (including `role`), and add a `requireRole("admin")` middleware for board settings, token minting, rollover and reforecast.

---

### P6-9 — The VP API key is shipped inside the web bundle

**`artifacts/budget-tracker/app/_layout.tsx:33-38`, `artifacts/api-server/src/middleware/vpAuth.ts:20-30`**

```ts
async function initVpSession(): Promise<void> {
  const vpApiKey = process.env.EXPO_PUBLIC_VP_API_KEY;
  if (!vpApiKey) return;
  try {
    const res = await fetch(`${apiUrl}/api/auth/vp-login`, {
      method: "POST",
      headers: { "x-api-key": vpApiKey, "content-type": "application/json" },
    });
```

`EXPO_PUBLIC_*` variables are inlined into the client bundle at build time by Expo — that is the entire meaning of the prefix. The value is therefore readable in the shipped JavaScript by anyone who loads the web app, or who fetches the bundle directly without loading the app.

The server side compares it with `!==` (`vpAuth.ts:27`), a non-constant-time comparison — a minor issue relative to the key simply being published, but worth noting since the fix is `crypto.timingSafeEqual`.

**Attack scenario.** An attacker fetches the JS bundle, greps for the key, and `POST /api/auth/vp-login`s to obtain a 24-hour VP session. This is the highest privilege tier the application defines. Combined with P6-8, the VP tier now grants nothing above a normal login — but it is still the credential that is supposed to gate board configuration.

**Fix:** remove the client-side VP key flow entirely and derive board/admin capability from the authenticated user's role (P6-8). If an external board-member login is genuinely needed, give board members real accounts.

---

### P6-10 — The audit log never records who made a change

**`artifacts/api-server/src/middleware/auditLog.ts:13-28`, `lib/db/src/schema/auditLogs.ts:12`**

```ts
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      ...
      userId: entry.userId ?? null,
    });
```

`userId` is optional on `AuditEntry` (`auditLog.ts:10`) and the column is nullable. A grep for `userId` across `artifacts/api-server/src/routes/` returns **only** `userAuth.ts:13` and `:57` (the session object) — **no route handler ever passes `userId` to `writeAuditLog` or `writeAuditDiff`.** Every audit row in the database has `user_id = NULL`.

This directly contradicts the project's own standard in `CLAUDE.md`: *"Edits or deletions of expenditure entries should be logged (who, when, old value, new value)"*. The "who" is structurally absent.

**Attack scenario.** Less an attack than a failure of the control that exists to detect attacks. After any of P6-2/P6-3/P6-4/P6-6, the audit log cannot say who did it — and after P6-1, since no request is authenticated, there is nothing to record even if the plumbing were wired up. A director asking "who changed this figure?" cannot be answered.

**Fix:** thread the authenticated session through `req` (via the auth middleware from P6-1) and pass `userId` at every `writeAuditLog`/`writeAuditDiff` call site.

---

### P6-11 — `xlsx@0.18.5` has unpatched high-severity advisories and is reachable unauthenticated

**`artifacts/api-server/package.json:29`** (`"xlsx": "^0.18.5"`)

`pnpm audit --prod` reports, for `artifacts__api-server>xlsx`:

- **High** — Prototype Pollution (`GHSA-4r6h-8v6p-xvw6`), vulnerable `<0.19.3`
- **High** — Regular Expression Denial of Service (`GHSA-5pgg-2g8v-p4x9`), vulnerable `<0.20.2`

Both report `Patched versions: <0.0.0` — SheetJS no longer publishes to the public npm registry, so **there is no npm upgrade path**. The package is reached from three unauthenticated endpoints that parse attacker-supplied files: `imports.ts:110` (`XLSX.read(buffer, ...)`), `excel.ts:301` and `excel.ts:321` (via `inspectWorkbook`).

**Attack scenario.** An unauthenticated `POST /api/excel/validate` with a crafted 10 MB workbook triggers the ReDoS and pins the single Node event loop, taking the API down for everyone. Prototype pollution in a parser running in-process is a plausible route to worse.

**Fix:** move to the SheetJS CDN distribution (which is maintained past 0.20.2) or replace `xlsx` with `exceljs`, which is already a dependency and is used for all exports.

---

### P6-12 — No rate limiting anywhere, including on login

**`artifacts/api-server/src/routes/userAuth.ts:29`; no rate-limit middleware exists in `app.ts`**

A repo-wide grep for `helmet`, `rateLimit` and `rate-limit` across `artifacts/api-server/src` and its `package.json` returns nothing. `POST /api/auth/login` accepts unlimited attempts against a two-account user table whose password is `Patricia1!`.

There is one accidental mitigation and one accidental amplification, from the same line. `bcrypt.hash`/`bcrypt.compare` at cost 12 (`seedAuthUsers.ts:30`, `userAuth.ts:47`) takes ~250 ms of CPU per attempt, which slows guessing — but it also means ~40 concurrent login requests saturate a single core. `bcryptjs` is a pure-JS implementation running on the main event loop, so this blocks the whole server, not just the login route.

**Attack scenario.** Two vectors from one gap: (a) an online guessing run against a weak, known-pattern password with no lockout; (b) a trivial denial of service — a few dozen concurrent `POST /auth/login` requests with junk passwords stall the event loop and the app becomes unresponsive. The expensive unauthenticated endpoints (`/alerts/evaluate`, `/board/view`, `POST /snapshots`) offer the same DoS with less effort.

**Fix:** add `express-rate-limit` — a strict limit on `/auth/*`, a looser global one — and consider `bcrypt` (native) or moving hashing off the event loop.

---

## Medium

### P6-13 — Database TLS certificate verification is disabled

**`lib/db/src/index.ts:17-32`**

```ts
function resolveSslOption(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  try {
    const { hostname } = new URL(connectionString);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return undefined;
    }
    return { rejectUnauthorized: false };
```

For every non-loopback host, TLS is enabled but the certificate is not verified. The comment explains the motivation (managed Postgres providers use CAs Node doesn't bundle), which is a real problem — but `rejectUnauthorized: false` solves it by accepting *any* certificate, including an attacker's.

**Attack scenario.** An attacker positioned on the network path between the app host and the database (a compromised hop, a hostile network in a self-hosted or laptop-run deployment) presents their own certificate. The connection succeeds, and they see and can alter every query — including the bcrypt hashes in `users`. Low likelihood on a managed cloud provider's internal network; high impact if it occurs.

**Fix:** supply the provider's CA bundle via `ssl: { ca: fs.readFileSync(...) }` and set `rejectUnauthorized: true`.

---

### P6-14 — No security headers, and no CSP on the desktop static-serve path

**`artifacts/api-server/src/app.ts:10-48`**

The middleware stack is `pinoHttp` → `cors()` → `express.json()` → `express.urlencoded()` → router → optional static → `errorHandler`. There is no `helmet` or equivalent: no `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` or `Content-Security-Policy`.

This matters most for the desktop/single-origin mode at `app.ts:38-48`, where the same Express process serves the Expo web export:

```ts
const staticDir = process.env["SERVE_STATIC_DIR"];
if (staticDir) {
  app.use(express.static(staticDir));
```

Here the API and the HTML app share an origin and there is no CSP restricting what the page may load or connect to. Note that the app is a React/React-Native-Web SPA with no server-rendered HTML anywhere — there is no reflected XSS sink in the server — so this is defence-in-depth, not an active hole.

**Attack scenario.** Absent HSTS, a first visit over `http://` can be downgraded and the session token intercepted. Absent `X-Frame-Options`/`frame-ancestors`, the app can be framed for clickjacking. Absent CSP, any future XSS (for example via a rendered budget line name) has no containment.

**Fix:** `app.use(helmet())` with a CSP appropriate to the Expo bundle, before the router.

---

### P6-15 — Share tokens do not expire by default and are stored in plaintext

**`artifacts/api-server/src/routes/board.ts:105-110`, `lib/db/src/schema/shareTokens.ts:9`, `board.ts:333-340`**

```ts
  const token = crypto.randomUUID();
  const [created] = await db.insert(shareTokensTable).values({
    token,
    label: bodyParsed.data.label || "Board Link",
    expiresAt: bodyParsed.data.expiresAt ? new Date(bodyParsed.data.expiresAt) : null,
  }).returning();
```

The generation itself is sound — `crypto.randomUUID()` is a CSPRNG v4 UUID with 122 bits of entropy, not guessable, and no `Math.random` appears anywhere in the codebase. Revocation works (`board.ts:130-133`, checked at `board.ts:335`). Expiry works when set (`board.ts:338`). The issues are around it:

1. `expiresAt` is nullable and defaults to `null` when the caller omits it — a token created without an explicit expiry **never expires**.
2. Tokens are stored in the database in plaintext, so `GET /api/board/tokens` and any database read return live, usable credentials.
3. They travel in the query string (`GET /api/board/view?token=...`, `board.ts:343`; also `/exports/pdf` and `/exports/excel`), so they land in browser history, in any intermediate proxy's access log, and in the `Referer` header of any outbound link.

Server-side logging is clean here — the pino serializer at `app.ts:18` does `url: req.url?.split("?")[0]`, so the token is stripped before it reaches the log.

**Attack scenario.** A board link is shared by email to a director in 2026. Two years later the director's mailbox is compromised, or the link is forwarded outside the company. The token still works and still returns the current budget, because nobody set an expiry and nobody remembered to revoke it.

**Fix:** default `expiresAt` to a bounded window (e.g. 90 days) when the caller omits it; store a SHA-256 of the token and show the raw value only once at creation.

---

### P6-16 — Unauthenticated expensive endpoints allow resource exhaustion

**`artifacts/api-server/src/routes/snapshots.ts:708`, `board.ts:342`, `alerts-engine.ts:8`**

```ts
router.post(
  "/snapshots",
  asyncHandler(async (req, res): Promise<void> => {
    const rawLabel = req.body?.label;
```

Each call to `createSnapshot` (`snapshots.ts:246`) selects **every row** from six tables and writes the whole thing to disk as pretty-printed JSON. `enforceLimit()` (`snapshots.ts:214`) caps the directory at 50 files — but it does so by calling `listSnapshotFiles()`, which reads and `JSON.parse`s all 50 files on every single snapshot creation.

`GET /board/view` (`board.ts:342`, share-token gated) calls `buildBoardViewData`, which contains an N+1 loop over categories (`board.ts:224-233`) issuing three queries per category. `POST /alerts/evaluate` (`alerts-engine.ts:8`) recomputes all alerts with no auth and no throttle.

**Attack scenario.** A loop of `POST /api/snapshots` calls forces repeated full-database reads plus 50-file parse-and-write cycles, consuming CPU and disk I/O until the app is unresponsive. No authentication is needed to start.

**Fix:** authenticate these routes (P6-1) and add a per-route rate limit; cache snapshot metadata rather than re-parsing all files on each write.

---

### P6-17 — The full audit log is readable without authentication

**`artifacts/api-server/src/routes/audit-logs.ts:8-35`**

```ts
router.get("/audit-logs", asyncHandler(async (req, res): Promise<void> => {
  const { entityType, startDate, endDate } = req.query;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
```

Pagination is bounded correctly (500 max) and the filters are properly parameterised via Drizzle's `eq`/`gte`/`lte`. The problem is solely the missing auth check: this endpoint returns the complete change history of the budget — old and new values for every planned amount, every actual, every board-approved figure — to anyone.

Called out separately from P6-1 because of what it exposes: the audit log is the most sensitive read in the system, showing not just the current budget but every revision and the direction of travel.

**Attack scenario.** `curl "https://<host>/api/audit-logs?limit=500"` yields the negotiation history of the marketing budget — what was proposed, what was cut, when.

**Fix:** `requireVpAuth` on this route at minimum.

---

### P6-18 — Full Zod error object returned to the client

**`artifacts/api-server/src/routes/admin.ts:19`**

```ts
    res.status(400).json({ error: "Invalid body", details: parsed.error });
```

Unlike the rest of the codebase (which returns `parsed.error.message`), this serialises the entire `ZodError` — including the full path structure and internal issue codes of the expected schema.

The central error handler is well-behaved by comparison (`middleware/errorHandler.ts:4-10`): it logs the error server-side and returns only `"Internal server error"` for any status ≥ 500, so stack traces, SQL text and environment values do not reach the client.

**Attack scenario.** Minor schema disclosure only. Included because it is inconsistent with the rest of the codebase and is a one-word fix.

**Fix:** `details: parsed.error.message`, matching every other handler.

---

## Low

### P6-19 — Export writes unsanitised user strings (not currently formula-executable)

**`artifacts/api-server/src/routes/excel.ts:120-140`, `board.ts:766`**

Values that originate in user-controlled CSV/Excel imports — `bl.category`, `bl.lineItem`, `bl.owner`, and arbitrary `customFields` values — are pushed into export rows with no sanitisation:

```ts
      } else {
        row.push(String(v));
      }
```

I checked whether this is exploitable as CSV/Excel formula injection and **it is not, as currently written**. ExcelJS types cell values by JavaScript type (`node_modules/.../exceljs/lib/doc/cell.js:1062-1081`): a `string` becomes `Cell.Types.String` and is written as a shared string (`t="s"`); only an object carrying `.formula` becomes a formula cell. Excel does not evaluate a string-typed cell, so a line item named `=cmd|'/c calc'!A0` is displayed as text, not executed. There is also **no CSV export path anywhere in the server** — I grepped for `text/csv` and CSV serialisation across `artifacts/api-server/src` and found only test fixtures.

**Attack scenario (conditional).** None today. But this becomes a real Medium the moment a CSV export is added — the audit brief anticipated exactly this, and the data is already flowing from untrusted import into export. A director opening the CSV would execute the formula.

**Fix:** prefix any exported cell whose first character is `=`, `+`, `-`, `@`, tab or CR with a `'`, at the point the row is built — cheap now, and it inoculates any future CSV path.

---

### P6-20 — Transitive advisories in build/tooling dependencies

**`pnpm audit --prod`, run from the repo root**

Beyond the two `xlsx` findings in P6-11, the audit reports 5 further issues, all transitive and none in the API server's request path:

| Severity | Package | Path | Advisory |
|---|---|---|---|
| High | `postcss` ≤8.5.11 | `budget-tracker>expo-document-picker>expo>@expo/metro-config>postcss` | `GHSA-6g55-p6wh-862q` — arbitrary file read via `sourceMappingURL` |
| High | `postcss` ≤8.5.17 | same | `GHSA-r28c-9q8g-f849` — path traversal in source-map auto-loading |
| Moderate | `postcss` <8.5.10 | same | `GHSA-qx2v-qp2m-jg93` — XSS via unescaped `</style>` |
| Moderate | `uuid` <11.1.1 | `api-server>exceljs>uuid` | `GHSA-w5hq-g745-h8pq` — missing buffer bounds check in v3/v5/v6 |

**Total: 7 vulnerabilities — 4 high, 3 moderate.**

The `postcss` chain is build-time only (Metro bundler) and processes the project's own CSS, not user input. The `uuid` issue affects v3/v5/v6 with a caller-supplied buffer; ExcelJS uses v4 without one.

**Fix:** `pnpm up postcss uuid --recursive` or a `pnpm.overrides` entry to pull both to patched versions.

---

## Verified clean

Each item below was checked against the actual code, not assumed.

**No SQL injection.** Every query in `artifacts/api-server/src` uses Drizzle's query builder or a tagged `sql` template with bound `${}` parameters. There is no `sql.raw` anywhere in the repository. The only two `db.execute()` calls with hand-written SQL are `budget-line-columns.ts:128-132` and `:156-160`, and both bind their interpolations as parameters:

```ts
    await db.execute(sql`
      UPDATE budget_lines
      SET custom_fields = (custom_fields - ${existing.name}) || jsonb_build_object(${parsed.data.name}::text, custom_fields->${existing.name})
      WHERE custom_fields ? ${existing.name}
    `);
```

The `IN (...)` constructions via `sql.join` (`board.ts:180`, `:229`, `:231`, `dashboard.ts:42`) build parameter lists from integer primary keys read out of the database, and each element is itself bound. No user input reaches an identifier or `ORDER BY` position.

**No command injection.** There is no `child_process`, `exec`, `spawn` or `eval` in `artifacts/api-server/src` or `lib/db/src`. The one `execFileSync` in the repo is `scripts/src/build-desktop.ts:1`, a developer build script with no request-derived input.

**No path traversal.** All six snapshot file handlers validate before touching the filesystem. `restore`, `delete` and `PATCH /snapshots/:id` use a strict allow-list regex (`snapshots.ts:881`, `:1015`, `:1049`):

```ts
    if (!id || !/^[\w-]+$/.test(id)) {
      res.status(400).json({ error: "Invalid snapshot id" });
```

`GET /snapshots/:id` (`:692`) and `PATCH /snapshots/:id/pin` (`:1095`) reject `..` and `/` after `idFromStem`, which correctly catches the URL-encoded `..%2f..%2fetc%2fpasswd` case since Express decodes params before the handler sees them. Snapshot filenames are server-generated from a timestamp plus a label sanitised to `[a-zA-Z0-9_-]` and truncated to 40 chars (`snapshots.ts:252`). Uploads never touch disk at all.

**No SSRF.** `exchange-rate.ts:41` is the only outbound request in the server, and the URL is a fixed string literal with no interpolation:

```ts
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=GBP&symbols=SEK", {
      signal: controller.signal,
    });
```

It has a 5-second `AbortController` timeout (`:38-39`), checks `response.ok`, and validates the parsed rate before use (`:47`): `typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0`. Correctly done.

**CSRF is not applicable.** The API authenticates via the custom headers `x-user-session` and `x-vp-session` (`vpAuth.ts:62,67`; `userAuth.ts:68,74`) — never via cookies. No handler reads `req.cookies`, and although `cookie-parser` is listed in `package.json`, it is never imported or mounted in `app.ts`. Because a custom header cannot be attached by a cross-origin form or image, and because credentials are not sent automatically, classic CSRF does not apply. (Note: this is moot for most routes anyway — P6-1 means a cross-origin request needs no credentials to succeed.)

**No XSS sink on the server.** There is no server-rendered HTML anywhere. The only non-JSON responses are PDF (pdfkit) and XLSX (ExcelJS) binary streams. The desktop mode's `res.sendFile` (`app.ts:46`) serves a static `index.html` with no templating.

**Password hashing is correct.** bcrypt with cost factor 12 (`seedAuthUsers.ts:30`), verified with `bcrypt.compare` (`userAuth.ts:47`), which is constant-time. The login response is identical for an unknown email and a wrong password — both return `"Invalid email or password"` (`userAuth.ts:43`, `:49`) — so there is no user enumeration. (The credentials themselves are the problem — see P6-5 — not the hashing.)

**Token entropy is sound.** Session tokens use `crypto.randomBytes(32)` (`userAuth.ts:54`, `vpAuth.ts:32`) = 256 bits. Share tokens use `crypto.randomUUID()` (`board.ts:105`) = 122 bits. There is no `Math.random` anywhere in the API server. Sessions carry a 24-hour TTL that is checked on every use and lazily swept (`userAuth.ts:88-96`, `vpAuth.ts:40-48`).

**Upload handling is careful.** Multer uses `memoryStorage` with hard size limits — 5 MB for CSV import (`imports.ts:34`), 10 MB for Excel (`excel.ts:20`) — so no attacker-controlled filename ever reaches the filesystem, and `LIMIT_FILE_SIZE` is translated to a clean 413 (`imports.ts:136-146`). `inspectWorkbook` (`excel.ts:269-306`) checks the `PK` magic bytes before parsing and rejects macro-enabled workbooks by looking for `xl/vbaProject.bin` in the zip. `express.json()`'s default 100 KB limit bounds the `POST /snapshots/import` body. Good defensive work throughout — it is only the missing auth on these routes that undermines it.

**Logging does not leak.** The pino-http serializer (`app.ts:14-26`) emits only request id, method and a query-stripped URL, and only a status code for responses — headers and bodies are never logged, so session tokens and share tokens stay out of the logs. `logger.ts:7-11` additionally redacts `authorization` and `cookie`.

**The error handler does not leak internals.** `middleware/errorHandler.ts:4-10` logs the error server-side and returns `"Internal server error"` for any status ≥ 500, exposing `err.message` only for explicitly-thrown 4xx errors. Stack traces, SQL text and environment values do not reach the client. Validation errors (400 from Zod `safeParse`) are cleanly distinguishable from internal errors (500).

**No secrets committed.** `git ls-files | grep -iE "\.env|secret|credential"` returns nothing — no `.env` file is tracked. `DATABASE_URL`, `PORT`, `VP_API_KEY` and `LOG_LEVEL` are all read from the environment with no fallback default; `lib/db/src/index.ts:7` and `index.ts:12` both throw at startup if the variable is missing, rather than silently using a development default. There is no `process.env.X || "dev-secret"` pattern anywhere. (The credentials in P6-5 are hardcoded in source, but they are not environment secrets.)

**IDOR is not applicable in the current data model.** The application is single-tenant: budget lines, plans, actuals, owners and categories are global, with no per-user or per-scope ownership column on any table in `lib/db/src/schema/`. Changing an `:id` in a URL reaches a different budget line, not a different user's data — because there is no such thing as another user's data. This is a reasonable design for one budget holder plus directors, and it should be re-examined only if the app ever becomes multi-tenant. The current exposure is total (P6-1), not selective.

---

## Recommended order of remediation

1. **P6-5** — rotate both passwords out of source and stop the boot-time overwrite. (Hours.)
2. **P6-1** — one `requireAuth` middleware at `app.ts:33` with a four-route allow-list. This single change also closes P6-2, P6-3, P6-4, P6-6, P6-17 and most of P6-16. (Hours.)
3. **P6-7** — replace `cors()` with an origin allow-list. (Minutes.)
4. **P6-8 / P6-9** — enforce `role` server-side and delete the client-side VP key flow. (Days.)
5. **P6-12, P6-11, P6-10** — rate limiting, `xlsx` replacement, audit actor attribution.
6. Medium and Low items as capacity allows.
