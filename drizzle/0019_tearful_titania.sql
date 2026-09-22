CREATE TYPE "public"."price_event_type" AS ENUM('split', 'dividend');--> statement-breakpoint
CREATE TABLE "price_events" (
	"security_id" uuid NOT NULL,
	"event_type" "price_event_type" NOT NULL,
	"effective_on" date NOT NULL,
	"value" numeric NOT NULL,
	"currency" varchar(3),
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "price_events_pkey" PRIMARY KEY("security_id","event_type","effective_on"),
	CONSTRAINT "price_events_value_check" CHECK ("price_events"."value" > 0),
	CONSTRAINT "price_events_currency_check" CHECK (("price_events"."event_type" = 'dividend' and "price_events"."currency" is not null)
        or ("price_events"."event_type" = 'split' and "price_events"."currency" is null))
);
--> statement-breakpoint
CREATE TABLE "security_prices" (
	"security_id" uuid NOT NULL,
	"market_date" date NOT NULL,
	"close" numeric NOT NULL,
	"currency" varchar(3) NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "security_prices_pkey" PRIMARY KEY("security_id","market_date"),
	CONSTRAINT "security_prices_close_check" CHECK ("security_prices"."close" >= 0),
	CONSTRAINT "security_prices_currency_check" CHECK ("security_prices"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "price_events" ADD CONSTRAINT "price_events_security_id_securities_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_events" ADD CONSTRAINT "price_events_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_prices" ADD CONSTRAINT "security_prices_security_id_securities_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_prices" ADD CONSTRAINT "security_prices_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;