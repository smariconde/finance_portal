CREATE TYPE "public"."market_expectations_outcome" AS ENUM('accepted', 'abstained', 'stopped');--> statement-breakpoint
CREATE TABLE "market_expectations_evidence" (
	"reading_id" uuid NOT NULL,
	"evidence_id" varchar(8) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"section" varchar(48) NOT NULL,
	"document_url" text NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"document_accepted_at" timestamp with time zone NOT NULL,
	"sha256" char(64) NOT NULL,
	"byte_length" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "market_expectations_evidence_reading_id_evidence_id_pk" PRIMARY KEY("reading_id","evidence_id"),
	CONSTRAINT "market_expectations_evidence_bytes_check" CHECK ("market_expectations_evidence"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_expectations_readings" (
	"reading_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"fiscal_year_end" date NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"ladder_version" varchar(64) NOT NULL,
	"extract_version" varchar(64) NOT NULL,
	"outcome" "market_expectations_outcome" NOT NULL,
	"reading" jsonb,
	"reason" varchar(64),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"proposed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_expectations_readings_outcome_check" CHECK (("market_expectations_readings"."outcome" = 'accepted') = ("market_expectations_readings"."reason" is null) and ("market_expectations_readings"."outcome" = 'accepted') = ("market_expectations_readings"."reading" is not null)),
	CONSTRAINT "market_expectations_readings_accession_check" CHECK ("market_expectations_readings"."accession_number" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
	CONSTRAINT "market_expectations_readings_timeline_check" CHECK ("market_expectations_readings"."recorded_at" >= "market_expectations_readings"."proposed_at")
);
--> statement-breakpoint
ALTER TABLE "market_expectations_evidence" ADD CONSTRAINT "market_expectations_evidence_reading_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."market_expectations_readings"("reading_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_expectations_readings_subject_idx" ON "market_expectations_readings" USING btree ("legal_entity_id","fiscal_year_end","proposed_at");