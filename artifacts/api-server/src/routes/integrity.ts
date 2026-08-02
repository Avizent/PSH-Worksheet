import { Router, type IRouter } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { runIntegrityChecks } from "../lib/integrity";

const router: IRouter = Router();

const DEFAULT_YEAR = 2026;

/**
 * GET /integrity/check — runs the full check suite (see
 * audit/integrity-checks-spec.md) and returns the report.
 *
 * Read-only: the checks never write, so this stays a GET and needs no
 * confirmation step. It sits behind the standard session gate like every
 * other route; it is not admin-only, because reading what is wrong with the
 * data is exactly what a budget holder needs to be able to do.
 */
router.get(
  "/integrity/check",
  asyncHandler(async (req, res): Promise<void> => {
    const rawYear = req.query.year;
    const parsed = Number(rawYear);
    const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : DEFAULT_YEAR;

    const report = await runIntegrityChecks(year);
    res.json(report);
  }),
);

export default router;
