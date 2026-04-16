import { db } from "@workspace/db";
import {
  budgetLinesTable,
  monthlyPlansTable,
  monthlyActualsTable,
  alertsTable,
  eventsTable,
} from "@workspace/db/schema";
import { count } from "drizzle-orm";
import { logger } from "./logger";

type SeedLine = {
  category: string;
  lineItem: string;
  owner: string;
  region: string;
  costStatus: string;
  plans: number[];
  actuals: number[];
  boardApproved: number;
};

const SEED_LINES: SeedLine[] = [
  {
    category: "Ads",
    lineItem: "PR",
    owner: "PH",
    region: "Global",
    costStatus: "Variable",
    plans:   [0, 25000, 0, 25000, 0, 0, 0, 0, 25000, 0, 0, 0],
    actuals: [0, 27000, 0, 25000, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 75000,
  },
  {
    category: "Ads",
    lineItem: "LinkedIn boosting & other social campaigns",
    owner: "JDT",
    region: "Global",
    costStatus: "Variable",
    plans:   [20000, 20000, 20000, 20000, 20000, 10000, 10000, 10000, 20000, 20000, 20000, 20000],
    actuals: [21184.27, 13830.98, 20387.59, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 240000,
  },

  {
    category: "Marketing and Sales Software",
    lineItem: "Amplemarket",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [5274, 5274, 5274, 5274, 5274, 5274, 5274, 5274, 5274, 5274, 5274, 5274],
    actuals: [5274, 5274, 5274, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 63282,
  },
  {
    category: "Marketing and Sales Software",
    lineItem: "GoDaddy",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290],
    actuals: [1290, 1290, 1290, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 15480,
  },
  {
    category: "Marketing and Sales Software",
    lineItem: "Google Workspace Domains (MKT)",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [4559, 4559, 4559, 4559, 4559, 4559, 4559, 4559, 4559, 4559, 4559, 4559],
    actuals: [4559, 4559, 4559, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 54707,
  },
  {
    category: "Marketing and Sales Software",
    lineItem: "Hubspot",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [22168, 22168, 22168, 22168, 22168, 22168, 22168, 22168, 22168, 22168, 22168, 22168],
    actuals: [22168, 22168, 22168, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 266012,
  },
  {
    category: "Marketing and Sales Software",
    lineItem: "Webflow",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [330, 330, 330, 330, 330, 330, 330, 330, 330, 330, 330, 330],
    actuals: [330, 330, 330, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 3960,
  },
  {
    category: "Marketing and Sales Software",
    lineItem: "Squarespace",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42],
    actuals: [42, 42, 42, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 500,
  },

  {
    category: "Other Costs",
    lineItem: "Zoom",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [745, 745, 745, 745, 745, 745, 745, 745, 745, 745, 745, 745],
    actuals: [745, 745, 745, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 8940,
  },
  {
    category: "Other Costs",
    lineItem: "Website fixes",
    owner: "PH",
    region: "Global",
    costStatus: "Variable",
    plans:   [0, 0, 0, 20000, 0, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 0,
  },
  {
    category: "Other Costs",
    lineItem: "Amplemarket upgrade",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [0, 0, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
    actuals: [0, 0, 10000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 120000,
  },

  {
    category: "Marketing and PR",
    lineItem: "Marcaria.com hubert.ai domain",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [0, 0, 0, 0, 249, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 249, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 249,
  },
  {
    category: "Marketing and PR",
    lineItem: "LinkedIn Sales Navigator",
    owner: "PH",
    region: "Global",
    costStatus: "Fixed Cost",
    plans:   [858, 858, 858, 858, 858, 858, 858, 858, 858, 858, 858, 858],
    actuals: [858, 858, 858, 858, 858, 858, 858, 858, 858, 858, 858, 858],
    boardApproved: 4292,
  },
  {
    category: "Marketing and PR",
    lineItem: "Video case study",
    owner: "PH",
    region: "Global",
    costStatus: "Planned",
    plans:   [0, 160000, 0, 0, 0, 0, 0, 0, 80000, 80000, 0, 0],
    actuals: [0, 118600, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 480000,
  },
  {
    category: "Marketing and PR",
    lineItem: "G2/Capterra/Reddit",
    owner: "JDT",
    region: "Global",
    costStatus: "Variable",
    plans:   [5000, 5000, 5000, 5000, 0, 0, 0, 0, 5000, 5000, 5000, 5000],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 60000,
  },
  {
    category: "Marketing and PR",
    lineItem: "Award entry",
    owner: "PH",
    region: "Global",
    costStatus: "Variable",
    plans:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 0,
  },

  {
    category: "Events and Conferences",
    lineItem: "Merch",
    owner: "PH",
    region: "Global",
    costStatus: "Variable",
    plans:   [0, 12000, 0, 12000, 0, 0, 12000, 0, 0, 12000, 0, 0],
    actuals: [0, 14500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 48000,
  },
  {
    category: "Events and Conferences",
    lineItem: "Early Careers Event 19th March",
    owner: "PH",
    region: "UK",
    costStatus: "Booked",
    plans:   [0, 0, 110000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 110000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 110000,
  },
  {
    category: "Events and Conferences",
    lineItem: "IHR Live Manchester 14 May",
    owner: "PH",
    region: "UK",
    costStatus: "Booked",
    plans:   [0, 0, 0, 0, 130000, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 130000,
  },
  {
    category: "Events and Conferences",
    lineItem: "IHR Live Manchester stand build",
    owner: "PH",
    region: "UK",
    costStatus: "Variable",
    plans:   [0, 0, 0, 0, 95000, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 0,
  },
  {
    category: "Events and Conferences",
    lineItem: "IHR Live London Sep",
    owner: "PH",
    region: "UK",
    costStatus: "Booked",
    plans:   [0, 0, 0, 0, 0, 0, 0, 0, 21000, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 21000,
  },
  {
    category: "Events and Conferences",
    lineItem: "StaffingPro Virtual Jul",
    owner: "PH",
    region: "DACH",
    costStatus: "Planned",
    plans:   [0, 0, 0, 0, 0, 0, 40000, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 32000, 0, 0, 0, 0, 0],
    boardApproved: 0,
  },
  {
    category: "Events and Conferences",
    lineItem: "StaffingPro Germany Oct",
    owner: "PH",
    region: "DACH",
    costStatus: "Planned",
    plans:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 130000, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 83000, 0, 0],
    boardApproved: 130000,
  },
  {
    category: "Events and Conferences",
    lineItem: "Zukunft Personal Europe Sept",
    owner: "PH",
    region: "EU",
    costStatus: "Planned",
    plans:   [0, 0, 0, 0, 0, 0, 0, 0, 13000, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 13000,
  },
  {
    category: "Events and Conferences",
    lineItem: "TalentPro June",
    owner: "PH",
    region: "DACH",
    costStatus: "Planned",
    plans:   [0, 0, 0, 0, 40000, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 33000, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 0,
  },
  {
    category: "Events and Conferences",
    lineItem: "RecruiTech CEE May",
    owner: "PH",
    region: "CEE",
    costStatus: "Planned",
    plans:   [0, 0, 0, 0, 85000, 0, 0, 0, 0, 0, 0, 0],
    actuals: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 180000,
  },
  {
    category: "Events and Conferences",
    lineItem: "Partner Events",
    owner: "PH/JDT",
    region: "EU",
    costStatus: "Variable",
    plans:   [33000, 33000, 33000, 33000, 33000, 33000, 33000, 33000, 33000, 33000, 33000, 33000],
    actuals: [0, 0, 33000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    boardApproved: 396000,
  },
];

type SeedEvent = {
  name: string;
  eventDate: Date;
  status: string;
  estimatedCost: number;
  lineItemMatch: string;
};

const SEED_EVENTS: SeedEvent[] = [
  { name: "Early Careers Event", eventDate: new Date("2026-03-19"), status: "Confirmed", estimatedCost: 110000, lineItemMatch: "Early Careers Event 19th March" },
  { name: "IHR Live Manchester", eventDate: new Date("2026-05-14"), status: "Confirmed", estimatedCost: 130000, lineItemMatch: "IHR Live Manchester 14 May" },
  { name: "TalentPro June", eventDate: new Date("2026-06-15"), status: "Planned", estimatedCost: 40000, lineItemMatch: "TalentPro June" },
  { name: "StaffingPro Virtual", eventDate: new Date("2026-07-10"), status: "Planned", estimatedCost: 40000, lineItemMatch: "StaffingPro Virtual Jul" },
  { name: "IHR Live London", eventDate: new Date("2026-09-18"), status: "Confirmed", estimatedCost: 21000, lineItemMatch: "IHR Live London Sep" },
  { name: "Zukunft Personal Europe", eventDate: new Date("2026-09-22"), status: "Planned", estimatedCost: 13000, lineItemMatch: "Zukunft Personal Europe Sept" },
  { name: "StaffingPro Germany", eventDate: new Date("2026-10-15"), status: "Planned", estimatedCost: 130000, lineItemMatch: "StaffingPro Germany Oct" },
  { name: "RecruiTech CEE", eventDate: new Date("2026-05-20"), status: "Planned", estimatedCost: 85000, lineItemMatch: "RecruiTech CEE May" },
];

async function insertSeedData() {
  let linesCreated = 0;
  let plansCreated = 0;
  let actualsCreated = 0;

  const lineIdMap = new Map<string, number>();

  for (const item of SEED_LINES) {
    const [line] = await db
      .insert(budgetLinesTable)
      .values({
        category: item.category,
        lineItem: item.lineItem,
        owner: item.owner,
        region: item.region,
        costStatus: item.costStatus,
        boardApprovedAmount: item.boardApproved ?? null,
      })
      .returning();
    linesCreated++;
    lineIdMap.set(item.lineItem, line.id);

    for (let m = 0; m < 12; m++) {
      await db.insert(monthlyPlansTable).values({
        budgetLineId: line.id,
        month: m + 1,
        year: 2026,
        plannedAmount: item.plans[m],
      });
      plansCreated++;
    }

    for (let m = 0; m < 12; m++) {
      if (item.actuals[m] > 0) {
        await db.insert(monthlyActualsTable).values({
          budgetLineId: line.id,
          month: m + 1,
          year: 2026,
          actualAmount: item.actuals[m],
        });
        actualsCreated++;
      }
    }
  }

  for (const evt of SEED_EVENTS) {
    const budgetLineId = lineIdMap.get(evt.lineItemMatch) ?? null;
    await db.insert(eventsTable).values({
      name: evt.name,
      eventDate: evt.eventDate,
      status: evt.status,
      estimatedCost: evt.estimatedCost,
      budgetLineId,
    });
  }

  return { linesCreated, plansCreated, actualsCreated, eventsCreated: SEED_EVENTS.length };
}

export async function seedBudgetData(): Promise<void> {
  const [{ value: lineCount }] = await db
    .select({ value: count() })
    .from(budgetLinesTable);

  if (lineCount > 0) {
    logger.info({ lineCount }, "Budget data already exists, skipping seed");
    return;
  }

  logger.info("Seeding budget data from spreadsheet...");

  await db.delete(alertsTable);
  await db.delete(eventsTable);
  await db.delete(monthlyActualsTable);
  await db.delete(monthlyPlansTable);
  await db.delete(budgetLinesTable);

  const stats = await insertSeedData();

  logger.info(stats, "Budget data seeded from spreadsheet");
}

export async function seedBudgetDataForce() {
  return insertSeedData();
}
