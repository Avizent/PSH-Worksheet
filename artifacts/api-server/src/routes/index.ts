import { Router, type IRouter } from "express";
import healthRouter from "./health";
import budgetLinesRouter from "./budget-lines";
import budgetLinesWithMonthlyRouter from "./budget-lines-with-monthly";
import monthlyPlansRouter from "./monthly-plans";
import monthlyActualsRouter from "./monthly-actuals";
import alertsRouter from "./alerts";
import alertsEngineRouter from "./alerts-engine";
import eventsRouter from "./events";
import dashboardRouter from "./dashboard";
import chartsRouter from "./charts";
import projectionsRouter from "./projections";
import importsRouter from "./imports";
import boardRouter from "./board";
import seedRouter from "./seed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(chartsRouter);
router.use(projectionsRouter);
router.use(budgetLinesWithMonthlyRouter);
router.use(budgetLinesRouter);
router.use(monthlyPlansRouter);
router.use(monthlyActualsRouter);
router.use(alertsRouter);
router.use(alertsEngineRouter);
router.use(eventsRouter);
router.use(importsRouter);
router.use(boardRouter);
router.use(seedRouter);

export default router;
