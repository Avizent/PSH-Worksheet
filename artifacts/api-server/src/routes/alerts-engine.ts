import { Router, type IRouter } from "express";
import { EvaluateAlertsQueryParams, EvaluateAlertsResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { runAlertEvaluation } from "../lib/runAlertEvaluation";

const router: IRouter = Router();

router.post("/alerts/evaluate", asyncHandler(async (req, res): Promise<void> => {
  const queryParsed = EvaluateAlertsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }
  const year = queryParsed.data.year ?? new Date().getFullYear();
  const result = await runAlertEvaluation(year);
  res.json(EvaluateAlertsResponse.parse(result));
}));

export default router;
