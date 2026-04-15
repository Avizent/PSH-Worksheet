import { Router, type IRouter } from "express";
import { db, budgetLinesTable, monthlyPlansTable, monthlyActualsTable } from "@workspace/db";
import { SeedDataResponse } from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

const SEED_DATA = [
  { category: "Digital Marketing", subcategory: "Paid Search", lineItem: "Google Ads", owner: "PH", region: "UK", costStatus: "Variable", monthlyPlan: 15000, actualsMonths: [14200, 15800, 13900] },
  { category: "Digital Marketing", subcategory: "Paid Social", lineItem: "LinkedIn Ads", owner: "PH", region: "UK", costStatus: "Variable", monthlyPlan: 8000, actualsMonths: [7500, 8200, 7800] },
  { category: "Digital Marketing", subcategory: "Paid Social", lineItem: "Meta Ads", owner: "PH", region: "Global", costStatus: "Variable", monthlyPlan: 12000, actualsMonths: [11500, 12300, 11800] },
  { category: "Digital Marketing", subcategory: "SEO", lineItem: "SEO Agency Retainer", owner: "JDT", region: "UK", costStatus: "Fixed Cost", monthlyPlan: 5000, actualsMonths: [5000, 5000, 5000] },
  { category: "Digital Marketing", subcategory: "Content", lineItem: "Content Production", owner: "JDT", region: "UK", costStatus: "Variable", monthlyPlan: 6000, actualsMonths: [5500, 6200, 5800] },
  { category: "Brand", subcategory: "Creative", lineItem: "Brand Agency", owner: "VP Mktg", region: "UK", costStatus: "Fixed Cost", monthlyPlan: 10000, actualsMonths: [10000, 10000, 10000] },
  { category: "Brand", subcategory: "Creative", lineItem: "Photography & Video", owner: "VP Mktg", region: "UK", costStatus: "Variable", monthlyPlan: 4000, actualsMonths: [3200, 5100, 3800] },
  { category: "Events", subcategory: "Trade Shows", lineItem: "CES 2026", owner: "VP Mktg", region: "US", costStatus: "Variable", monthlyPlan: 25000, actualsMonths: [28000, 0, 0] },
  { category: "Events", subcategory: "Trade Shows", lineItem: "MWC Barcelona", owner: "VP Mktg", region: "EU", costStatus: "Variable", monthlyPlan: 20000, actualsMonths: [0, 22000, 0] },
  { category: "Events", subcategory: "Webinars", lineItem: "Webinar Platform (GoTo)", owner: "JDT", region: "Global", costStatus: "Fixed Cost", monthlyPlan: 1200, actualsMonths: [1200, 1200, 1200] },
  { category: "Technology", subcategory: "Marketing Tech", lineItem: "HubSpot License", owner: "PH", region: "Global", costStatus: "Fixed Cost", monthlyPlan: 3500, actualsMonths: [3500, 3500, 3500] },
  { category: "Technology", subcategory: "Marketing Tech", lineItem: "Salesforce Marketing Cloud", owner: "PH", region: "Global", costStatus: "Fixed Cost", monthlyPlan: 4500, actualsMonths: [4500, 4500, 4500] },
  { category: "Technology", subcategory: "Analytics", lineItem: "Google Analytics 360", owner: "JDT", region: "Global", costStatus: "Fixed Cost", monthlyPlan: 2000, actualsMonths: [2000, 2000, 2000] },
  { category: "PR & Comms", subcategory: "PR Agency", lineItem: "External PR Agency", owner: "VP Mktg", region: "UK", costStatus: "Fixed Cost", monthlyPlan: 8000, actualsMonths: [8000, 8000, 8000] },
  { category: "PR & Comms", subcategory: "Media", lineItem: "Media Monitoring", owner: "VP Mktg", region: "UK", costStatus: "Fixed Cost", monthlyPlan: 800, actualsMonths: [800, 800, 800] },
  { category: "People", subcategory: "Contractors", lineItem: "Freelance Designer", owner: "VP Mktg", region: "UK", costStatus: "Variable", monthlyPlan: 3000, actualsMonths: [2800, 3200, 3000] },
  { category: "People", subcategory: "Training", lineItem: "Team Training & Development", owner: "VP Mktg", region: "UK", costStatus: "Variable", monthlyPlan: 1500, actualsMonths: [0, 1500, 0] },
];

router.post("/seed", asyncHandler(async (_req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Seed endpoint is disabled in production" });
    return;
  }

  await db.delete(monthlyActualsTable);
  await db.delete(monthlyPlansTable);
  await db.delete(budgetLinesTable);

  let budgetLinesCreated = 0;
  let monthlyPlansCreated = 0;
  let monthlyActualsCreated = 0;

  for (const item of SEED_DATA) {
    const [line] = await db.insert(budgetLinesTable).values({
      category: item.category,
      subcategory: item.subcategory,
      lineItem: item.lineItem,
      owner: item.owner,
      region: item.region,
      costStatus: item.costStatus,
    }).returning();
    budgetLinesCreated++;

    for (let month = 1; month <= 12; month++) {
      await db.insert(monthlyPlansTable).values({
        budgetLineId: line.id,
        month,
        year: 2026,
        plannedAmount: item.monthlyPlan,
      });
      monthlyPlansCreated++;
    }

    for (let i = 0; i < item.actualsMonths.length; i++) {
      if (item.actualsMonths[i] > 0) {
        await db.insert(monthlyActualsTable).values({
          budgetLineId: line.id,
          month: i + 1,
          year: 2026,
          actualAmount: item.actualsMonths[i],
        });
        monthlyActualsCreated++;
      }
    }
  }

  const result = {
    success: true,
    message: `Seeded ${budgetLinesCreated} budget lines, ${monthlyPlansCreated} monthly plans, ${monthlyActualsCreated} monthly actuals`,
    budgetLinesCreated,
    monthlyPlansCreated,
    monthlyActualsCreated,
  };

  res.json(SeedDataResponse.parse(result));
}));

export default router;
