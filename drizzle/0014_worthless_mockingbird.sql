CREATE TYPE "public"."ingestion_source_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TABLE "ingestion_source_budgets" (
	"source_id" varchar(64) NOT NULL,
	"usage_on" date NOT NULL,
	"requests" integer NOT NULL,
	"first_request_at" timestamp with time zone NOT NULL,
	"last_request_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_source_budgets_pkey" PRIMARY KEY("source_id","usage_on"),
	CONSTRAINT "ingestion_source_budgets_requests_check" CHECK ("ingestion_source_budgets"."requests" >= 0),
	CONSTRAINT "ingestion_source_budgets_timeline_check" CHECK ("ingestion_source_budgets"."last_request_at" >= "ingestion_source_budgets"."first_request_at")
);
--> statement-breakpoint
CREATE TABLE "ingestion_source_controls" (
	"control_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"status" "ingestion_source_status" NOT NULL,
	"daily_request_limit" integer,
	"reason" varchar(240) NOT NULL,
	"actor" varchar(128) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "ingestion_source_controls_limit_check" CHECK ("ingestion_source_controls"."daily_request_limit" is null or "ingestion_source_controls"."daily_request_limit" >= 0),
	CONSTRAINT "ingestion_source_controls_timeline_check" CHECK ("ingestion_source_controls"."superseded_at" is null or "ingestion_source_controls"."superseded_at" >= "ingestion_source_controls"."recorded_at"),
	CONSTRAINT "ingestion_source_controls_actor_check" CHECK ("ingestion_source_controls"."actor" ~ '^[A-Za-z0-9._:@/-]{1,128}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_source_controls_current_uidx" ON "ingestion_source_controls" USING btree ("source_id") WHERE "ingestion_source_controls"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "ingestion_source_controls_source_idx" ON "ingestion_source_controls" USING btree ("source_id","recorded_at");