ALTER TYPE "public"."ingestion_job_kind" ADD VALUE 'alpha_vantage_consensus_refresh';--> statement-breakpoint
CREATE TABLE "consensus_estimates" (
	"security_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"revision" smallint NOT NULL,
	"withdrawn" boolean NOT NULL,
	"eps_average" numeric,
	"eps_high" numeric,
	"eps_low" numeric,
	"eps_analyst_count" integer,
	"eps_average_7_days_ago" numeric,
	"eps_average_30_days_ago" numeric,
	"eps_average_60_days_ago" numeric,
	"eps_average_90_days_ago" numeric,
	"eps_revisions_up_7_days" integer,
	"eps_revisions_down_7_days" integer,
	"eps_revisions_up_30_days" integer,
	"eps_revisions_down_30_days" integer,
	"revenue_average" numeric,
	"revenue_high" numeric,
	"revenue_low" numeric,
	"revenue_analyst_count" integer,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "consensus_estimates_pkey" PRIMARY KEY("security_id","period_end","revision"),
	CONSTRAINT "consensus_estimates_revision_check" CHECK ("consensus_estimates"."revision" >= 0),
	CONSTRAINT "consensus_estimates_withdrawn_check" CHECK ("consensus_estimates"."withdrawn" = ("consensus_estimates"."eps_average" is null)),
	CONSTRAINT "consensus_estimates_withdrawn_values_check" CHECK (not "consensus_estimates"."withdrawn" or ("consensus_estimates"."eps_high" is null and "consensus_estimates"."eps_low" is null and "consensus_estimates"."eps_analyst_count" is null and "consensus_estimates"."revenue_average" is null)),
	CONSTRAINT "consensus_estimates_range_check" CHECK (("consensus_estimates"."eps_low" is null or "consensus_estimates"."eps_low" <= "consensus_estimates"."eps_average") and ("consensus_estimates"."eps_high" is null or "consensus_estimates"."eps_high" >= "consensus_estimates"."eps_average")),
	CONSTRAINT "consensus_estimates_counts_check" CHECK (coalesce("consensus_estimates"."eps_analyst_count", 0) >= 0 and coalesce("consensus_estimates"."revenue_analyst_count", 0) >= 0 and coalesce("consensus_estimates"."eps_revisions_up_7_days", 0) >= 0 and coalesce("consensus_estimates"."eps_revisions_down_7_days", 0) >= 0 and coalesce("consensus_estimates"."eps_revisions_up_30_days", 0) >= 0 and coalesce("consensus_estimates"."eps_revisions_down_30_days", 0) >= 0),
	CONSTRAINT "consensus_estimates_superseded_check" CHECK ("consensus_estimates"."superseded_at" is null or "consensus_estimates"."superseded_at" > "consensus_estimates"."available_at")
);
--> statement-breakpoint
CREATE TABLE "owner_multiple_thresholds" (
	"threshold_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"metric" varchar(32) NOT NULL,
	"value" numeric,
	"reason" varchar(280),
	"declared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "owner_multiple_thresholds_metric_check" CHECK ("owner_multiple_thresholds"."metric" in ('forward_pe')),
	CONSTRAINT "owner_multiple_thresholds_value_check" CHECK ("owner_multiple_thresholds"."value" is null or ("owner_multiple_thresholds"."value" > 0 and "owner_multiple_thresholds"."value" <= 1000))
);
--> statement-breakpoint
ALTER TABLE "consensus_estimates" ADD CONSTRAINT "consensus_estimates_security_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_estimates" ADD CONSTRAINT "consensus_estimates_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_multiple_thresholds" ADD CONSTRAINT "owner_multiple_thresholds_entity_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consensus_estimates_open_uidx" ON "consensus_estimates" USING btree ("security_id","period_end") WHERE "consensus_estimates"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_multiple_thresholds_declared_uidx" ON "owner_multiple_thresholds" USING btree ("legal_entity_id","metric","declared_at");