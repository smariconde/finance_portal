CREATE TYPE "public"."industry_resolution_outcome" AS ENUM('resolved', 'abstained', 'stopped');--> statement-breakpoint
CREATE TABLE "industry_resolution_evidence" (
	"resolution_id" uuid NOT NULL,
	"evidence_id" varchar(8) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"section" varchar(32) NOT NULL,
	"document_url" text NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"document_accepted_at" timestamp with time zone NOT NULL,
	"sha256" char(64) NOT NULL,
	"byte_length" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "industry_resolution_evidence_pkey" PRIMARY KEY("resolution_id","evidence_id"),
	CONSTRAINT "industry_resolution_evidence_bytes_check" CHECK ("industry_resolution_evidence"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "industry_resolutions" (
	"resolution_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"sic" char(4) NOT NULL,
	"candidates" jsonb NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"ladder_version" varchar(64) NOT NULL,
	"sections_version" varchar(64) NOT NULL,
	"outcome" "industry_resolution_outcome" NOT NULL,
	"industry_key" varchar(64),
	"confidence" varchar(8),
	"rationale" text,
	"reason" varchar(64),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"cited_evidence_ids" jsonb NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "industry_resolutions_outcome_check" CHECK (("industry_resolutions"."outcome" = 'resolved') = ("industry_resolutions"."industry_key" is not null) and ("industry_resolutions"."outcome" = 'resolved') = ("industry_resolutions"."reason" is null)),
	CONSTRAINT "industry_resolutions_confidence_check" CHECK ("industry_resolutions"."confidence" is null or "industry_resolutions"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "industry_resolutions_timeline_check" CHECK ("industry_resolutions"."recorded_at" >= "industry_resolutions"."resolved_at")
);
--> statement-breakpoint
ALTER TABLE "industry_resolution_evidence" ADD CONSTRAINT "industry_resolution_evidence_resolution_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."industry_resolutions"("resolution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_resolutions_subject_idx" ON "industry_resolutions" USING btree ("legal_entity_id","resolved_at");