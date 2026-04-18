import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, taskRemindersTable } from "@workspace/db";
import { asyncHandler } from "../middleware/asyncHandler";

const DeleteTaskReminderParams = z.object({
  id: z.coerce.number(),
});

const router: IRouter = Router();

router.delete(
  "/task-reminders/:id",
  asyncHandler(async (req, res): Promise<void> => {
    const params = DeleteTaskReminderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .delete(taskRemindersTable)
      .where(eq(taskRemindersTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }
    res.sendStatus(204);
  })
);

export default router;
