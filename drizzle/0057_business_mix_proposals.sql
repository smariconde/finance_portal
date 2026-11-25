CREATE TYPE "public"."business_mix_outcome" AS ENUM('accepted', 'abstained', 'stopped');--> statement-breakpoint
CREATE TABLE "business_mix_evidence" (
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
	CONSTRAINT "business_mix_evidence_pkey" PRIMARY KEY("proposal_id","evidence_id"),
	CONSTRAINT "business_mix_evidence_section_check" CHECK ("business_mix_evidence"."section" in ('item_1_business', 'xbrl_business_lines')),
	CONSTRAINT "business_mix_evidence_bytes_check" CHECK ("business_mix_evidence"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "business_mix_lines" (
	"proposal_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"line_id" varchar(8) NOT NULL,
	"axis" varchar(40) NOT NULL,
	"member" varchar(160) NOT NULL,
	"concept" varchar(160) NOT NULL,
	"amount" numeric NOT NULL,
	"industry_key" varchar(64) NOT NULL,
	"quote" text NOT NULL,
	"evidence_id" varchar(8) NOT NULL,
	CONSTRAINT "business_mix_lines_pkey" PRIMARY KEY("proposal_id","ordinal"),
	CONSTRAINT "business_mix_lines_amount_check" CHECK ("business_mix_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "business_mix_proposals" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"fiscal_year_end" date NOT NULL,
	"task_version" varchar(64) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"ladder_version" varchar(64) NOT NULL,
	"lines_version" varchar(64) NOT NULL,
	"sections_version" varchar(64) NOT NULL,
	"betas_release_id" uuid NOT NULL,
	"outcome" "business_mix_outcome" NOT NULL,
	"axis" varchar(40),
	"expected_revenue" numeric NOT NULL,
	"confidence" varchar(8),
	"rationale" text,
	"reason" varchar(64),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"proposed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_mix_proposals_outcome_check" CHECK (("business_mix_proposals"."outcome" = 'accepted') = ("business_mix_proposals"."reason" is null) and ("business_mix_proposals"."outcome" = 'accepted') = ("business_mix_proposals"."axis" is not null)),
	CONSTRAINT "business_mix_proposals_axis_check" CHECK ("business_mix_proposals"."axis" is null or "business_mix_proposals"."axis" in ('StatementBusinessSegmentsAxis', 'ProductOrServiceAxis')),
	CONSTRAINT "business_mix_proposals_confidence_check" CHECK ("business_mix_proposals"."confidence" is null or "business_mix_proposals"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "business_mix_proposals_accession_check" CHECK ("business_mix_proposals"."accession_number" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
	CONSTRAINT "business_mix_proposals_timeline_check" CHECK ("business_mix_proposals"."recorded_at" >= "business_mix_proposals"."proposed_at")
);
--> statement-breakpoint
ALTER TABLE "business_mix_evidence" ADD CONSTRAINT "business_mix_evidence_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."business_mix_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_mix_lines" ADD CONSTRAINT "business_mix_lines_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."business_mix_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_mix_proposals_subject_idx" ON "business_mix_proposals" USING btree ("legal_entity_id","proposed_at");