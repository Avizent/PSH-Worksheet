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

## Architecture

### Dual Layout System
- **Desktop** (width >= 768px): Sidebar navigation + multi-column content area
- **Mobile** (width < 768px): Bottom tab bar + stacked cards
- Layout detection via `useLayout()` hook in `hooks/useLayout.ts`

### Artifacts
- `artifacts/api-server` — Express API server (port 8080, proxied at `/api`)
- `artifacts/budget-tracker` — Expo app (port 25099, Expo dev domain)
- `artifacts/mockup-sandbox` — Design sandbox

### Database Schema (7 tables)
- `users` — Auth-ready user table with role field
- `budgetLines` — Budget line items with category, owner, region, cost status, `projectionPct` (real, default 0)
- `monthlyPlans` — Monthly planned amounts per budget line
- `monthlyActuals` — Monthly actual spend per budget line
- `alerts` — Budget alerts with severity levels (critical/warning/info), deduplication by type+budgetLineId+month+year
- `events` — Marketing events with status tracking
- `auditLogs` — Change audit trail

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
- `POST /seed` — Seed sample data (clears existing first)

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
3. **Actuals Integration** (PENDING) — CSV/manual actuals import
4. **Board View** (PENDING) — Shareable token link, per-item visibility controls, exports
5. **Admin & Governance** (PENDING) — Reforecast, audit trail, admin settings

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
