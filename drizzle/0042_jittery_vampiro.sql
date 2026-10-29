CREATE TABLE "reit_affo_evidence" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"document_url" text NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"document_accepted_at" timestamp with time zone NOT NULL,
	"sha256" char(64) NOT NULL,
	"byte_length" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "reit_affo_evidence_bytes_check" CHECK ("reit_affo_evidence"."byte_length" between 1 and 14000)
);
--> statement-breakpoint
CREATE TABLE "reit_affo_proposals" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"fiscal_year_end" date NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"extract_version" varchar(64) NOT NULL,
	"expected_common_income" numeric NOT NULL,
	"common_income_observation_id" uuid NOT NULL,
	"common_income_source_document_id" varchar(20) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"transcription" jsonb,
	"reason" varchar(96),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"proposed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reit_affo_proposals_outcome_check" CHECK ("reit_affo_proposals"."outcome" in ('accepted', 'abstained', 'stopped') and ("reit_affo_proposals"."outcome" = 'accepted') = ("reit_affo_proposals"."transcription" is not null and "reit_affo_proposals"."reason" is null and "reit_affo_proposals"."accepted_rung" is not null and "reit_affo_proposals"."responded_model" is not null) and ("reit_affo_proposals"."outcome" = 'accepted' or ("reit_affo_proposals"."transcription" is null and "reit_affo_proposals"."reason" is not null and "reit_affo_proposals"."accepted_rung" is null and "reit_affo_proposals"."responded_model" is null))),
	CONSTRAINT "reit_affo_proposals_accession_check" CHECK ("reit_affo_proposals"."accession_number" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' and "reit_affo_proposals"."common_income_source_document_id" = "reit_affo_proposals"."accession_number"),
	CONSTRAINT "reit_affo_proposals_timeline_check" CHECK ("reit_affo_proposals"."recorded_at" >= "reit_affo_proposals"."proposed_at")
);
--> statement-breakpoint
ALTER TABLE "reit_affo_evidence" ADD CONSTRAINT "reit_affo_evidence_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."reit_affo_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reit_affo_proposals_subject_idx" ON "reit_affo_proposals" USING btree ("legal_entity_id","recorded_at");