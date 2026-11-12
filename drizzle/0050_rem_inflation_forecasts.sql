CREATE TABLE "rem_inflation_forecasts" (
	"round_month" date NOT NULL,
	"target_month" date NOT NULL,
	"revision" smallint NOT NULL,
	"median_percent" numeric NOT NULL,
	"published_on" date NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "rem_inflation_forecasts_pkey" PRIMARY KEY("round_month","target_month","revision"),
	CONSTRAINT "rem_inflation_forecasts_revision_check" CHECK ("rem_inflation_forecasts"."revision" >= 0),
	CONSTRAINT "rem_inflation_forecasts_round_check" CHECK (extract(day from "rem_inflation_forecasts"."round_month") = 1),
	CONSTRAINT "rem_inflation_forecasts_target_check" CHECK (extract(day from "rem_inflation_forecasts"."target_month") = 1),
	CONSTRAINT "rem_inflation_forecasts_time_check" CHECK ("rem_inflation_forecasts"."superseded_at" is null or "rem_inflation_forecasts"."superseded_at" > "rem_inflation_forecasts"."available_at")
);
--> statement-breakpoint
ALTER TABLE "rem_inflation_forecasts" ADD CONSTRAINT "rem_inflation_forecasts_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rem_inflation_forecasts_open_uidx" ON "rem_inflation_forecasts" USING btree ("round_month","target_month") WHERE "rem_inflation_forecasts"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "rem_inflation_forecasts_target_idx" ON "rem_inflation_forecasts" USING btree ("target_month","available_at");