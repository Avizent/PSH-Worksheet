CREATE TABLE "exchange_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
