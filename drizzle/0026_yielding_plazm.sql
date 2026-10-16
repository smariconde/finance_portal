CREATE TYPE "public"."operations_mix_outcome" AS ENUM('accepted', 'abstained', 'stopped');--> statement-breakpoint
CREATE TABLE "operations_mix_evidence" (
	"proposal_id" uuid NOT NULL,
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
	CONSTRAINT "operations_mix_evidence_pkey" PRIMARY KEY("proposal_id","evidence_id"),
	CONSTRAINT "operations_mix_evidence_bytes_check" CHECK ("operations_mix_evidence"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "operations_mix_lines" (
	"proposal_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" varchar(120) NOT NULL,
	"printed_amount" varchar(32) NOT NULL,
	"amount" numeric NOT NULL,
	"basis" varchar(24) NOT NULL,
	"exposure_keys" jsonb NOT NULL,
	"quote" text NOT NULL,
	"evidence_id" varchar(8) NOT NULL,
	"definition_quote" text,
	CONSTRAINT "operations_mix_lines_pkey" PRIMARY KEY("proposal_id","ordinal"),
	CONSTRAINT "operations_mix_lines_basis_check" CHECK ("operations_mix_lines"."basis" in ('name_match', 'filing_definition', 'rest_of_world', 'unallocated')),
	CONSTRAINT "operations_mix_lines_definition_check" CHECK ("operations_mix_lines"."basis" <> 'filing_definition' or "operations_mix_lines"."definition_quote" is not null)
);
--> statement-breakpoint
CREATE TABLE "operations_mix_proposals" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"fiscal_year_end" date NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"ladder_version" varchar(64) NOT NULL,
	"extract_version" varchar(64) NOT NULL,
	"country_release_id" uuid NOT NULL,
	"region_release_id" uuid NOT NULL,
	"outcome" "operations_mix_outcome" NOT NULL,
	"unit" varchar(16),
	"printed_total" varchar(32),
	"expected_revenue" numeric NOT NULL,
	"confidence" varchar(8),
	"rationale" text,
	"reason" varchar(64),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"proposed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operations_mix_proposals_outcome_check" CHECK (("operations_mix_proposals"."outcome" = 'accepted') = ("operations_mix_proposals"."reason" is null) and ("operations_mix_proposals"."outcome" = 'accepted') = ("operations_mix_proposals"."unit" is not null and "operations_mix_proposals"."printed_total" is not null)),
	CONSTRAINT "operations_mix_proposals_unit_check" CHECK ("operations_mix_proposals"."unit" is null or "operations_mix_proposals"."unit" in ('units', 'thousands', 'millions', 'billions')),
	CONSTRAINT "operations_mix_proposals_confidence_check" CHECK ("operations_mix_proposals"."confidence" is null or "operations_mix_proposals"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "operations_mix_proposals_accession_check" CHECK ("operations_mix_proposals"."accession_number" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
	CONSTRAINT "operations_mix_proposals_timeline_check" CHECK ("operations_mix_proposals"."recorded_at" >= "operations_mix_proposals"."proposed_at")
);
--> statement-breakpoint
ALTER TABLE "operations_mix_evidence" ADD CONSTRAINT "operations_mix_evidence_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."operations_mix_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_mix_lines" ADD CONSTRAINT "operations_mix_lines_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."operations_mix_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_mix_proposals_subject_idx" ON "operations_mix_proposals" USING btree ("legal_entity_id","proposed_at");