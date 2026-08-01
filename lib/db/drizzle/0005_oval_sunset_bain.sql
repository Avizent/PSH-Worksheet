ALTER TABLE "budget_lines" ALTER COLUMN "projection_pct" SET DATA TYPE numeric(7, 4);--> statement-breakpoint
ALTER TABLE "budget_lines" ALTER COLUMN "board_approved_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "monthly_plans" ALTER COLUMN "planned_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "monthly_plans" ALTER COLUMN "board_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "monthly_actuals" ALTER COLUMN "actual_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "estimated_cost" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "csv_import_rows" ALTER COLUMN "raw_amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "forecast_plans" ALTER COLUMN "planned_amount" SET DATA TYPE numeric(14, 2);