import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireAuth } from "./middleware/requireAuth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
/**
 * Cross-origin policy.
 *
 * This was a bare `cors()`, i.e. `Access-Control-Allow-Origin: *`. Because the
 * session travels in the x-user-session header rather than a cookie, that let
 * any web page the budget holder happened to visit read and write the entire
 * budget through their browser.
 *
 * The desktop build serves the frontend and the API from one origin, so it
 * needs no cross-origin access at all. Deployments that split them should list
 * the frontend origin(s) in CORS_ORIGINS, comma-separated.
 */
const corsOrigins = (process.env["CORS_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
  logger.info({ corsOrigins }, "CORS enabled for configured origins");
} else {
  // Same-origin only: no Access-Control-Allow-Origin header is emitted.
  logger.info("CORS disabled (same-origin only). Set CORS_ORIGINS if the frontend is served elsewhere.");
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// requireAuth runs before every route in the API. See middleware/requireAuth.ts
// for the (short) list of endpoints that stay public.
app.use("/api", requireAuth, router);

// Set by the Electron desktop build so one process serves both the API and
// the Expo web export on a single origin (the frontend issues relative
// /api/... fetches that must resolve against the page's own origin).
const staticDir = process.env["SERVE_STATIC_DIR"];
if (staticDir) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

import { errorHandler } from "./middleware/errorHandler";
app.use(errorHandler);

export default app;
