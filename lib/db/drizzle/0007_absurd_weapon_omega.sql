ALTER TABLE "csv_import_rows" DROP CONSTRAINT "csv_import_rows_budget_line_id_budget_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "csv_import_rows" ADD CONSTRAINT "csv_import_rows_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;