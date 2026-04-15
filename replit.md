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
- **File uploads**: multer (multipart/form-data)

## Architecture

### Dual Layout System
- **Desktop** (width >= 768px): Sidebar navigation + multi-column content area
- **Mobile** (width < 768px): Bottom tab bar + stacked cards
- Layout detection via `useLayout()` hook in `hooks/useLayout.ts`

### Artifacts
- `artifacts/api-server` — Express API server (port 8080, proxied at `/api`)
- `artifacts/budget-tracker` — Expo app (port 25099, Expo dev domain)
- `artifacts/mockup-sandbox` — Design sandbox

### Database Schema (11 tables)
- `users` — Auth-ready user table with role field
- `budgetLines` — Budget line items with category, owner, region, cost status, `projectionPct` (real, default 0)
- `monthlyPlans` — Monthly planned amounts per budget line
- `monthlyActuals` — Monthly actual spend per budget line
- `alerts` — Budget alerts with severity levels (critical/warning/info), deduplication by type+budgetLineId+month+year
- `events` — Marketing events with status tracking
- `auditLogs` — Change audit trail
- `csvImports` — CSV import records (filename, status, row counts)
- `csvImportRows` — Individual parsed CSV rows (raw data, match status, budget line assignment, row hash for idempotency)
- `boardSettings` — Board visibility settings (sectionKey, label, visible toggle, sortOrder)
- `shareTokens` — Shareable access tokens (token UUID, label, expiresAt, revoked flag)

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
- `POST /imports/upload` — Upload CSV, parse, match rows to budget lines
- `GET /imports/:id` — Get import with all rows
- `PATCH /imports/rows/:id/assign` — Assign unmatched row to a budget line
- `POST /imports/:id/confirm` — Confirm import, create MonthlyActual records (idempotent by row hash)
- `GET /board/settings` — List board visibility settings
- `PUT /board/settings` — Update board visibility settings (batch toggle)
- `GET /board/tokens` — List share tokens
- `POST /board/tokens` — Create share token
- `PATCH /board/tokens/:id/revoke` — Revoke share token
- `GET /board/view?token=...` — Get board view data (token-authenticated)
- `GET /board/preview` — Get board preview data (VP Marketing, no token)
- `GET /exports/pdf` — Export board view as downloadable HTML report
- `GET /exports/excel` — Export actuals + projections as Excel spreadsheet
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

### Chart Components (SVG-based, cross-platform)
- `BarChart.tsx` — Plan vs Actual monthly comparison
- `LineChart.tsx` — Cumulative spend over time
- `DonutChart.tsx` — Category breakdown
- `ProjectionBarChart.tsx` — Stacked actual + projected spend with plan markers
- `EventsGantt.tsx` — Events timeline showing events across months
- Desktop: tabbed chart panel (5 tabs: Plan vs Actual, Cumulative, Categories, Projections, Events)
- Mobile: horizontally swipeable full-width chart pager with page dots

### Alert UX
- Desktop: AlertCard with severity badges and resolve button
- Mobile: SwipeableAlertCard with swipe-left-to-resolve gesture + "Swipe left to resolve" hint text

### Expo Web API Proxy
- Metro config includes middleware that proxies `/api/*` requests to the API server (port 8080)
- This avoids CORS issues between the Expo dev domain and the Replit dev domain
- Native apps use `EXPO_PUBLIC_DOMAIN` env var to reach the API directly

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
4. **Board View** (COMPLETE) — Board visibility settings, shareable token links, iPhone-optimized board view, PDF/Excel exports
5. **Admin & Governance** (PENDING) — Reforecast, audit trail, admin settings

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
