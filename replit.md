# Hubert Marketing Budget Tracker

## Overview

pnpm workspace monorepo using TypeScript. Marketing budget tracker for Hubert's VP of Marketing with dual-layout architecture: desktop-optimised web app and native iPhone experience.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: Expo (React Native + React Native Web)
- **State management**: React Query (@tanstack/react-query)
- **File uploads**: multer (multipart/form-data), xlsx (Excel parsing)

## Architecture

### Dual Layout System
- **Desktop** (width >= 768px): Sidebar navigation + multi-column content area
- **Mobile** (width < 768px): Bottom tab bar + stacked cards
- Layout detection via `useLayout()` hook in `hooks/useLayout.ts`

### Artifacts
- `artifacts/api-server` — Express API server (port 8080, proxied at `/api`)
- `artifacts/budget-tracker` — Expo app (port 25099, Expo dev domain)
- `artifacts/mockup-sandbox` — Design sandbox

### Database Schema (13 tables)
- `users` — Auth-ready user table with role field
- `budgetLines` — Budget line items with category, owner, region, cost status, `projectionPct` (real, default 0), `boardApprovedAmount` (real, nullable — Dec 2025 board sign-off amounts)
- `monthlyPlans` — Monthly planned amounts per budget line
- `monthlyActuals` — Monthly actual spend per budget line, `importId` FK to csvImports for rollback tracking
- `alerts` — Budget alerts with severity levels (critical/warning/info), deduplication by type+budgetLineId+month+year
- `events` — Marketing events with status tracking
- `auditLogs` — Change audit trail (entityType, entityId, field, oldValue, newValue, action: create/update/delete/rollover)
- `csvImports` — CSV/Excel import records (filename, status, row counts, `deletedAt` timestamp for soft-delete)
- `csvImportRows` — Individual parsed CSV rows (raw data, match status, budget line assignment, row hash for idempotency)
- `boardSettings` — Board visibility settings (sectionKey, label, visible toggle, sortOrder)
- `shareTokens` — Shareable access tokens (token UUID, label, expiresAt, revoked flag)
- `forecastVersions` — Forecast version records (versionNumber, name, year, isOriginal flag)
- `forecastPlans` — Per-version monthly planned amounts (versionId, budgetLineId, month, year, plannedAmount)

### API Routes (mounted at `/api`)
- `GET/POST /budget-lines` — CRUD budget lines
- `PATCH /budget-lines/:id` — Update budget line (including projectionPct)
- `GET /budget-lines/with-monthly` — Budget lines with monthly plan/actual data
- `GET/POST /monthly-plans`, `GET/POST /monthly-actuals` — Monthly data
- `GET /alerts`, `PATCH /alerts/:id/resolve` — Alert management
- `POST /alerts/evaluate` — Trigger server-side alert evaluation (6 alert types)
- `GET/POST /events` — Event management
- `GET /dashboard/summary` — KPI dashboard aggregation
- `GET /dashboard/charts` — Monthly + category chart data
- `GET /projections` — Fixed cost forward projection with % adjustment
- `GET /imports` — List CSV imports with summary counts
- `POST /imports/upload` — Upload CSV or Excel (.xlsx/.xls), parse, match rows to budget lines
- `GET /imports/:id` — Get import with all rows
- `PATCH /imports/rows/:id/assign` — Assign unmatched row to a budget line
- `POST /imports/:id/confirm` — Confirm import, create MonthlyActual records (idempotent by row hash, tracks importId)
- `DELETE /imports/:id` — Soft-delete import (transactional: removes actuals if confirmed, marks as deleted)
- `GET /analytics/owner-breakdown` — Budget/spend grouped by owner
- `GET /analytics/regional-investment` — Budget/spend grouped by region
- `GET /analytics/fixed-vs-variable` — Monthly fixed vs variable cost split
- `GET /analytics/category-burndown` — Remaining budget per category over time
- `GET /analytics/board-variance` — Current plan vs board-approved amounts variance
- `GET /board/settings` — List board visibility settings
- `PUT /board/settings` — Update board visibility settings (batch toggle)
- `GET /board/tokens` — List share tokens
- `POST /board/tokens` — Create share token
- `PATCH /board/tokens/:id/revoke` — Revoke share token
- `GET /board/view?token=...` — Get board view data (token-authenticated)
- `GET /board/preview` — Get board preview data (VP Marketing, no token)
- `GET /exports/pdf` — Export board view as downloadable HTML report
- `GET /exports/excel` — Export actuals + projections as Excel spreadsheet
- `GET /reforecast/versions` — List forecast versions (year filter)
- `POST /reforecast/versions` — Create new forecast version with plan entries
- `GET /reforecast/versions/:id` — Get version with all plan entries
- `GET /reforecast/compare` — Compare two forecast versions side-by-side
- `GET /audit-logs` — List audit log entries (filters: entityType, startDate, endDate, limit, offset)
- `POST /admin/rollover` — Annual budget rollover (sourceYear → targetYear, idempotent)
- `POST /seed` — Seed sample data (clears existing first)

### CSV Import Flow
1. Upload CSV with columns: Category, Line Item, Month, Year, Amount, Invoice Ref
2. Server parses rows, matches to budget lines by normalised category+lineItem name
3. Matched rows get green status; unmatched rows get amber status with "Assign" button
4. User assigns unmatched rows to budget lines via searchable dropdown modal
5. User confirms import → creates MonthlyActual records
6. Row hash (SHA-256 of category|lineItem|month|year|amount|invoiceRef) prevents duplicate imports
7. Re-confirming a confirmed import returns 0 created, N skipped

### Alert Types (6)
- `underspend` — Spending below 70% of plan in closed months (warning)
- `overspend` — Spending above 110% of plan (critical)
- `budget_exhaustion` — Less than 15% budget remaining (critical)
- `fixed_cost_variance` — Fixed cost varies >5% month-over-month (warning)
- `large_payment` — Planned payment >£200k within 60 days (warning)
- `unbooked_event` — Event within 45 days still in "planned" status (warning)

### App Tabs (12 screens)
- `index.tsx` — Dashboard with KPIs, charts (Plan vs Actual, Cumulative, Categories, Remaining Budget, Projections, Events)
- `budget.tsx` — Budget Lines with category/month filters, Var % column, projection editing
- `quarterly.tsx` — Quarterly View with Q1-Q4 picker, KPIs, horizontal bar chart, region table
- `annual.tsx` — Annual View with By Category/Region tables (Var %), quarterly bar chart
- `monthly.tsx` — Monthly View with spend trend line chart, month-by-month breakdown, quarterly roll-up
- `reports.tsx` — Reports with 8 charts: 3 spend pie charts (Category/Region/Cost Type), 2 owner pie charts, quarterly bar, monthly trend, fixed-vs-variable stacked bar, category burn-down multi-line, board sign-off variance table
- `alerts.tsx` — Alert management with resolve/swipe-to-resolve
- `events.tsx` — Marketing events with status tracking
- `reforecast.tsx` — Forecast versioning and comparison
- `audit.tsx` — Audit log with filters
- `import.tsx` — CSV import flow with delete confirmation, history management (newest-first, deleted badge)
- `board.tsx` — Board view with share tokens

### Chart Components (SVG-based, cross-platform)
- `BarChart.tsx` — Plan vs Actual monthly comparison
- `LineChart.tsx` — Cumulative spend over time
- `DonutChart.tsx` — Category breakdown
- `ProjectionBarChart.tsx` — Stacked actual + projected spend with plan markers
- `EventsGantt.tsx` — Events timeline showing events across months
- `RemainingBudgetChart` (inline in index.tsx) — Horizontal bar chart showing remaining budget by category
- Desktop: tabbed chart panel (5 tabs: Plan vs Actual, Cumulative, Categories, Projections, Events)
- Mobile: horizontally swipeable full-width chart pager with page dots (6 pages including Remaining)

### Error Handling & Refresh UX
- `ErrorState` component (`components/ErrorState.tsx`) — shown when API queries fail, with alert-triangle icon, error message, and "Try Again" retry button
- `WebRefreshButton` component (`components/WebRefreshButton.tsx`) — floating circular refresh button visible only on web (since RefreshControl is native-only), positioned top-right on all main screens
- `ToastProvider` (`contexts/ToastContext.tsx`) — global toast/snackbar notification system for mutation failures (seed, resolve alert, import, projection updates). Animated slide-in toasts with auto-dismiss after 4 seconds. Supports error, success, and info types.
- All main tab screens (Dashboard, Alerts, Budget, Events, Import, Reports) check `isError` from React Query and show ErrorState when data fails to load
- All mutations include `onError` callbacks that trigger toast notifications

### Alert UX
- Desktop: AlertCard with severity badges and resolve button
- Mobile: SwipeableAlertCard with swipe-left-to-resolve gesture + "Swipe left to resolve" hint text

### Theming
- `constants/colors.ts` defines `light` and `dark` palettes (background, foreground, card, primary, secondary, muted, accent, destructive, success, warning, border, input + matching `*Foreground`)
- `contexts/ThemeContext.tsx` exposes `useTheme()` with `preference: "light" | "dark" | "system"`, `resolvedScheme`, and `cyclePreference()`. Persisted to AsyncStorage key `"theme-preference"`. App root gates rendering on `isLoaded` to avoid first-paint flicker.
- `useColors()` reads `resolvedScheme` from context and returns the active palette
- Theme toggle UI: cycle button in `DesktopSidebar` footer (sun/moon/monitor) and a pill-shaped button at the top of the mobile dashboard

### Expo Web API Proxy
- Metro config includes middleware that proxies `/api/*` requests to the API server (port 8080)
- This avoids CORS issues between the Expo dev domain and the Replit dev domain
- Native apps use `EXPO_PUBLIC_DOMAIN` env var to reach the API directly

### Production Web Build
- `build.js` creates both mobile (iOS/Android) bundles and a static web export
- Web export: `expo export --platform web` with `experiments.baseUrl` temporarily set to `/budget-tracker`
- `app.json` is modified before web export and restored afterward (mobile builds unaffected)
- `serve.js` serves web build files with SPA fallback (all unmatched routes → `index.html`)
- Mobile manifest requests (with `expo-platform` header) continue to serve iOS/Android manifests

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Project Phases

1. **Foundation** (COMPLETE) — DB schema, API, app shell with dual layout
2. **Intelligence Layer** (COMPLETE) — Charts (bar/line/donut), projections engine, 6-type alert engine, projection editing
3. **Actuals Integration** (COMPLETE) — CSV import with auto-matching, manual assignment, idempotent confirmation
4. **Board View** (COMPLETE) — Board visibility settings, shareable token links, iPhone-optimized board view, PDF/Excel exports, token-based export downloads
5. **Admin & Governance** (COMPLETE) — Reforecast versioning (create/compare/view), audit log with filters, annual budget rollover with confirmation dialog

### Data Source
- Budget data sourced from the real FY26 marketing budget spreadsheet
- 27 budget lines across 5 categories: Ads, Marketing and Sales Software, Other Costs, Marketing and PR, Events and Conferences
- Data seeded automatically on server startup via `seedBudgetData.ts` (only if no budget lines exist)
- Total planned budget: £2,296,441 | Actual spend: £657,272
- Actuals cover Jan-Mar for most items, plus event-specific actuals for later months
- 8 events seeded from the Events and Conferences category

### Auth Model

#### User Login (App Gate)
- Email + password login screen gates the entire app (`app/login.tsx`)
- Two allowed users seeded on server startup: `rcp@avizent.com` and `patricia.s.hyde@gmail.com`
- No registration — users are seeded in `artifacts/api-server/src/lib/seedAuthUsers.ts`
- Passwords stored as bcrypt hashes (cost factor 12) in `users.password_hash` column
- Sessions: in-memory `userSessions` Map, 24h TTL, `x-user-session` header
- Client stores session token in AsyncStorage (`lib/authSession.ts`)
- `AuthProvider` context (`contexts/AuthContext.tsx`) provides `user`, `login`, `logout`, `isAuthenticated`
- `AuthGate` component in `_layout.tsx` redirects unauthenticated users to `/login`
- Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`

#### VP Session (Board/Export Auth)
- VP session flow: client calls `POST /auth/vp-login` with `x-api-key` header → receives a 24h session token
- VP Management routes (`/board/settings`, `/board/tokens`, `/board/preview`, exports) require `x-vp-session` header with valid session token
- Board members access `/board/view` and public board-view screen via share token URL param
- Exports (`/exports/pdf`, `/exports/excel`) accept either VP session token or share token for auth
- `VP_API_KEY` is a Replit secret (server-only, used only to verify VP login)
- `EXPO_PUBLIC_VP_API_KEY` is a Replit secret used once at app startup to obtain a VP session token
- Session tokens are stored in-memory on the server (ephemeral, 24h TTL)
- `utils/vpSession.ts` stores session token client-side for use by export download functions

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
