CREATE TABLE "owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#1b4f72' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "event_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"title" text NOT NULL,
	"due_date" timestamp with time zone,
	"assignee" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"days_before" integer NOT NULL,
	"label" text,
	"fired_at" timestamp with time zone,
	"alert_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_line_columns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"sortable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_line_columns_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_event_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."event_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_alerts" ADD CONSTRAINT "in_app_alerts_task_id_event_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."event_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_plans_line_month_year_uniq" ON "monthly_plans" USING btree ("budget_line_id","month","year");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_actuals_line_month_year_uniq" ON "monthly_actuals" USING btree ("budget_line_id","month","year");