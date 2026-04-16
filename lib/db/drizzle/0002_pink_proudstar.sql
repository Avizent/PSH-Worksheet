CREATE TABLE "forecast_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"budget_line_id" integer NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"planned_amount" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version_number" integer DEFAULT 0 NOT NULL,
	"year" integer DEFAULT 2026 NOT NULL,
	"is_original" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "board_approved_amount" real;--> statement-breakpoint
ALTER TABLE "monthly_actuals" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "action" text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forecast_plans" ADD CONSTRAINT "forecast_plans_version_id_forecast_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."forecast_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_plans" ADD CONSTRAINT "forecast_plans_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_actuals" ADD CONSTRAINT "monthly_actuals_import_id_csv_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."csv_imports"("id") ON DELETE set null ON UPDATE no action;