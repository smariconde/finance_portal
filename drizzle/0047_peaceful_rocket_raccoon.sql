CREATE TABLE "adr_pair_closes" (
	"leg_id" varchar(32) NOT NULL,
	"market_date" date NOT NULL,
	"close" numeric NOT NULL,
	"currency" varchar(3) NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "adr_pair_closes_pkey" PRIMARY KEY("leg_id","market_date"),
	CONSTRAINT "adr_pair_closes_close_check" CHECK ("adr_pair_closes"."close" > 0),
	CONSTRAINT "adr_pair_closes_currency_check" CHECK ("adr_pair_closes"."currency" in ('USD', 'ARS')),
	CONSTRAINT "adr_pair_closes_leg_id_check" CHECK ("adr_pair_closes"."leg_id" ~ '^[a-z0-9]+-(adr|local)$')
);
--> statement-breakpoint
ALTER TABLE "adr_pair_closes" ADD CONSTRAINT "adr_pair_closes_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;