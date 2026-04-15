CREATE TABLE "csv_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"unmatched_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"row_index" integer NOT NULL,
	"raw_category" text,
	"raw_line_item" text,
	"raw_month" integer,
	"raw_year" integer,
	"raw_amount" real,
	"raw_invoice_ref" text,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"budget_line_id" integer,
	"error_message" text,
	"row_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_key" text NOT NULL,
	"label" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_settings_section_key_unique" UNIQUE("section_key")
);
--> statement-breakpoint
CREATE TABLE "share_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"label" text DEFAULT 'Board Link' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "csv_import_rows" ADD CONSTRAINT "csv_import_rows_import_id_csv_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."csv_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_import_rows" ADD CONSTRAINT "csv_import_rows_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;