import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import {
  CreateEventBody,
  UpdateEventBody,
  UpdateEventParams,
  DeleteEventParams,
  ListEventsResponse,
  ListEventsResponseItem,
  UpdateEventResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get("/events", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(eventsTable.eventDate);
  res.json(ListEventsResponse.parse(rows));
}));

router.post("/events", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(eventsTable).values(parsed.data).returning();
  res.status(201).json(ListEventsResponseItem.parse(row));
}));

router.patch("/events/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(eventsTable).set(parsed.data).where(eq(eventsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(UpdateEventResponse.parse(row));
}));

router.delete("/events/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(eventsTable).where(eq(eventsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.sendStatus(204);
}));

export default router;
