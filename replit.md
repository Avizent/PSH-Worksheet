# Hubert Marketing Budget Tracker

## Overview

The Hubert Marketing Budget Tracker is a pnpm monorepo TypeScript application designed for Hubert's VP of Marketing. It provides a comprehensive solution for tracking and managing marketing budgets, offering both a desktop-optimized web application and a native iPhone experience.

Key capabilities include:
- Budget line item management with detailed financial tracking (planned vs. actuals).
- Advanced analytics and reporting, including KPIs, charts, and variance analysis.
- Projections engine and intelligent alert system for financial oversight.
- CSV/Excel import functionality for actual spend data with matching and deduplication.
- Event management with task tracking and reminders.
- Robust board view with shareable tokens for stakeholders and export capabilities (PDF, Excel).
- Versioning for reforecasts and an audit log for all changes.
- Dual layout system for optimal user experience across desktop and mobile devices.

The project aims to provide a clear, real-time financial overview, improve budget adherence, and streamline reporting processes for the marketing department.

## User Preferences

- I prefer clear, concise explanations.
- I appreciate iterative development with regular updates.
- I expect robust error handling and informative feedback.
- I like a consistent and intuitive user interface across devices.
- I prefer that you ask for confirmation before making any major structural changes or data modifications.
- Ensure all new features are thoroughly tested and documented.

## System Architecture

The application is built as a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

### Dual Layout System
The application adapts its layout based on screen width:
- **Desktop (width >= 768px)**: Features sidebar navigation and a multi-column content area.
- **Mobile (width < 768px)**: Utilizes a bottom tab bar and stacked cards for navigation and content display.
Layout detection is managed by a `useLayout()` hook.

### Core Technologies
- **API Framework**: Express 5.
- **Database**: PostgreSQL with Drizzle ORM for schema management and querying.
- **Validation**: Zod for data schema validation.
- **API Codegen**: Orval for generating API hooks and Zod schemas from an OpenAPI specification.
- **Build Tool**: esbuild for CommonJS bundling.
- **Frontend**: Expo (React Native + React Native Web) for cross-platform development.
- **State Management**: React Query for data fetching, caching, and synchronization.
- **File Uploads**: `multer` for multipart form data and `xlsx` for Excel parsing.

### UI/UX Decisions
- **Theming**: Supports `light`, `dark`, and `system` themes, persisted using `AsyncStorage`. A `useTheme()` hook manages theme preference and provides the resolved color scheme. Theme toggles are available in the desktop sidebar and mobile dashboard.
- **Error Handling**: Uses an `ErrorState` component for API query failures, a `WebRefreshButton` for web-specific refresh functionality, and a global `ToastProvider` for animated success, error, and info notifications on mutations.
- **Alert UX**: Desktop displays `AlertCard` components with severity badges, while mobile uses `SwipeableAlertCard` with a swipe-to-resolve gesture.
- **Chart Components**: SVG-based charts (`BarChart`, `LineChart`, `DonutChart`, `ProjectionBarChart`, `EventsGantt`, `RemainingBudgetChart`) provide cross-platform data visualization. Desktop uses tabbed chart panels, while mobile features a horizontally swipeable pager.

### Feature Specifications
- **Database Schema**: Comprises 16 tables covering users, budget lines, monthly plans/actuals, alerts, events, tasks, reminders, audit logs, CSV imports, board settings, share tokens, and forecast versions.
- **API Routes**: Over 50 RESTful endpoints covering CRUD operations for budget lines, monthly data, alerts, events, tasks, in-app notifications, dashboard summaries, projections, CSV imports, analytics, board settings, share tokens, exports, reforecasts, audit logs, and administrative functions (rollover, seed data, snapshots).
- **CSV Import Flow**: Supports upload of CSV/Excel files, automatic matching to budget lines, manual assignment of unmatched rows, and idempotent confirmation to create `MonthlyActual` records.
- **Alert Types**: Six distinct alert types are implemented: underspend, overspend, budget exhaustion, fixed cost variance, large payment, and unbooked event, each with specific triggers and severity.
- **App Screens**: Includes Dashboard, Budget Lines, Quarterly View, Annual View, Monthly View, Reports, Alerts, Events, Reforecast, Audit Log, Import, and Board View screens.
- **Auth Model**:
    - **User Login**: Email/password authentication gates the entire app. Sessions are in-memory with a 24h TTL, stored client-side in AsyncStorage.
    - **VP Session**: A separate flow for VP-level access, authenticated via an API key, providing a 24h session token for managing board settings, tokens, and accessing exports.
    - **Board View**: Accessible via share tokens for public viewing, with exports supporting both VP and share token authentication.

### Technical Implementations
- **Expo Web API Proxy**: Metro configuration includes middleware to proxy `/api/*` requests to the Express API server (port 8080) during development to avoid CORS issues. Native apps use an `EXPO_PUBLIC_DOMAIN` environment variable for direct API access.
- **Production Web Build**: A `build.js` script handles generating mobile bundles and a static web export, adjusting `app.json` for web-specific settings and using `serve.js` for SPA fallback.

## External Dependencies

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **API Client Generation**: Orval (uses OpenAPI specification)
- **Validation Library**: Zod
- **File Uploads**: `multer`
- **Excel Parsing**: `xlsx`
- **React Native Storage**: `AsyncStorage`
- **Charting Library**: React Query (`@tanstack/react-query`)
- **Third-Party APIs**: No external third-party APIs are explicitly mentioned beyond the core database and internal services.