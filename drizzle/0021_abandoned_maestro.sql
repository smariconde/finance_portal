CREATE TABLE "benchmark_prices" (
	"benchmark_id" varchar(64) NOT NULL,
	"market_date" date NOT NULL,
	"close" numeric NOT NULL,
	"currency" varchar(3) NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "benchmark_prices_pkey" PRIMARY KEY("benchmark_id","market_date"),
	CONSTRAINT "benchmark_prices_close_check" CHECK ("benchmark_prices"."close" >= 0),
	CONSTRAINT "benchmark_prices_currency_check" CHECK ("benchmark_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "benchmark_prices_benchmark_id_check" CHECK ("benchmark_prices"."benchmark_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "benchmark_prices" ADD CONSTRAINT "benchmark_prices_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;