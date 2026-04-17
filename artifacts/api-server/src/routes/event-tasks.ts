import { Router, type IRouter } from "express";
import { eq, and, lte, isNull } from "drizzle-orm";
import {
  db,
  eventTasksTable,
  taskRemindersTable,
  inAppAlertsTable,
  alertsTable,
  eventsTable,
} from "@workspace/db";
import {
  ListEventTasksParams,
  CreateEventTaskBody,
  CreateEventTaskParams,
  UpdateEventTaskParams,
  UpdateEventTaskBody,
  DeleteEventTaskParams,
  ListEventTasksResponse,
  ListTaskRemindersParams,
  CreateTaskReminderParams,
  CreateTaskReminderBody,
  ListTaskRemindersResponse,
  CheckEventRemindersResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../middleware/asyncHandler";

const router: IRouter = Router();

router.get(
  "/events/:id/tasks",
  asyncHandler(async (req, res): Promise<void> => {
    const params = ListEventTasksParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tasks = await db
      .select()
      .from(eventTasksTable)
      .where(eq(eventTasksTable.eventId, params.data.id))
      .orderBy(eventTasksTable.dueDate, eventTasksTable.createdAt);
    res.json(ListEventTasksResponse.parse(tasks));
  })
);

router.post(
  "/events/:id/tasks",
  asyncHandler(async (req, res): Promise<void> => {
    const params = CreateEventTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateEventTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, params.data.id));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const [row] = await db
      .insert(eventTasksTable)
      .values({ ...parsed.data, eventId: params.data.id })
      .returning();
    res.status(201).json(row);
  })
);

router.patch(
  "/event-tasks/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const params = UpdateEventTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateEventTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = { ...parsed.data };
    if ("dueDate" in updates && updates.dueDate === null) {
      updates.dueDate = null;
    }
    const [row] = await db
      .update(eventTasksTable)
      .set(updates)
      .where(eq(eventTasksTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(row);
  })
);

router.delete(
  "/event-tasks/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const params = DeleteEventTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .delete(eventTasksTable)
      .where(eq(eventTasksTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.sendStatus(204);
  })
);

router.get(
  "/event-tasks/:id/reminders",
  asyncHandler(async (req, res): Promise<void> => {
    const params = ListTaskRemindersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const reminders = await db
      .select()
      .from(taskRemindersTable)
      .where(eq(taskRemindersTable.taskId, params.data.id))
      .orderBy(taskRemindersTable.daysBefore);
    res.json(ListTaskRemindersResponse.parse(reminders));
  })
);

router.post(
  "/event-tasks/:id/reminders",
  asyncHandler(async (req, res): Promise<void> => {
    const params = CreateTaskReminderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateTaskReminderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [task] = await db
      .select()
      .from(eventTasksTable)
      .where(eq(eventTasksTable.id, params.data.id));
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const [row] = await db
      .insert(taskRemindersTable)
      .values({ ...parsed.data, taskId: params.data.id })
      .returning();
    res.status(201).json(row);
  })
);

router.post(
  "/events/:id/check-reminders",
  asyncHandler(async (req, res): Promise<void> => {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const tasks = await db
      .select()
      .from(eventTasksTable)
      .where(and(eq(eventTasksTable.eventId, eventId), eq(eventTasksTable.status, "open")));

    const now = new Date();
    let fired = 0;

    for (const task of tasks) {
      if (!task.dueDate) continue;

      const reminders = await db
        .select()
        .from(taskRemindersTable)
        .where(and(eq(taskRemindersTable.taskId, task.id), isNull(taskRemindersTable.firedAt)));

      for (const reminder of reminders) {
        const triggerDate = new Date(task.dueDate);
        triggerDate.setDate(triggerDate.getDate() - reminder.daysBefore);

        if (triggerDate <= now) {
          const daysLeft = Math.ceil(
            (new Date(task.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          const message =
            daysLeft <= 0
              ? `Task "${task.title}" is past due`
              : `Task "${task.title}" is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

          const [alert] = await db
            .insert(alertsTable)
            .values({
              type: "event_task_reminder",
              severity: daysLeft <= 0 ? "critical" : "warning",
              message,
              budgetLineId: null,
            })
            .returning();

          const [inAppAlert] = await db
            .insert(inAppAlertsTable)
            .values({ taskId: task.id, message })
            .returning();
          void inAppAlert;

          await db
            .update(taskRemindersTable)
            .set({ firedAt: now, alertId: alert.id })
            .where(eq(taskRemindersTable.id, reminder.id));

          fired++;
        }
      }
    }

    const resp = CheckEventRemindersResponse.safeParse({ fired });
    res.json(resp.success ? resp.data : { fired });
  })
);

export default router;
