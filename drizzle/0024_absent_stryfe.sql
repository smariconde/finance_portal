CREATE TYPE "public"."ai_spend_status" AS ENUM('reserved', 'charged', 'uncharged', 'unsettled');--> statement-breakpoint
CREATE TABLE "ai_spend_ledger" (
	"reservation_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"task_run_id" uuid NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"ladder_version" varchar(64) NOT NULL,
	"rung" integer NOT NULL,
	"requested_model" varchar(128) NOT NULL,
	"responded_model" varchar(128),
	"spend_on" date NOT NULL,
	"status" "ai_spend_status" NOT NULL,
	"reserved_nano_usd" bigint NOT NULL,
	"charged_nano_usd" bigint,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer,
	"outcome" varchar(64),
	"reserved_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_spend_ledger_reserved_check" CHECK ("ai_spend_ledger"."reserved_nano_usd" > 0),
	CONSTRAINT "ai_spend_ledger_rung_check" CHECK ("ai_spend_ledger"."rung" between 1 and 16),
	CONSTRAINT "ai_spend_ledger_settlement_check" CHECK (("ai_spend_ledger"."status" = 'reserved') = ("ai_spend_ledger"."settled_at" is null)),
	CONSTRAINT "ai_spend_ledger_charge_check" CHECK (("ai_spend_ledger"."status" = 'charged') = ("ai_spend_ledger"."charged_nano_usd" is not null) and ("ai_spend_ledger"."charged_nano_usd" is null or "ai_spend_ledger"."charged_nano_usd" >= 0)),
	CONSTRAINT "ai_spend_ledger_timeline_check" CHECK ("ai_spend_ledger"."settled_at" is null or "ai_spend_ledger"."settled_at" >= "ai_spend_ledger"."reserved_at"),
	CONSTRAINT "ai_spend_ledger_day_check" CHECK ("ai_spend_ledger"."spend_on" = ("ai_spend_ledger"."reserved_at" at time zone 'UTC')::date)
);
--> statement-breakpoint
ALTER TABLE "ingestion_source_controls" ADD COLUMN "daily_spend_limit_nano_usd" bigint;--> statement-breakpoint
CREATE INDEX "ai_spend_ledger_day_idx" ON "ai_spend_ledger" USING btree ("source_id","spend_on");--> statement-breakpoint
CREATE INDEX "ai_spend_ledger_task_idx" ON "ai_spend_ledger" USING btree ("task_run_id","reserved_at");--> statement-breakpoint
ALTER TABLE "ingestion_source_controls" ADD CONSTRAINT "ingestion_source_controls_spend_limit_check" CHECK ("ingestion_source_controls"."daily_spend_limit_nano_usd" is null or "ingestion_source_controls"."daily_spend_limit_nano_usd" >= 0);