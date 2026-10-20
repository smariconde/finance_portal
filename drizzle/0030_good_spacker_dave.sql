CREATE TYPE "public"."employee_equity_outcome" AS ENUM('accepted', 'abstained', 'stopped');--> statement-breakpoint
CREATE TABLE "employee_equity_evidence" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"document_url" text NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"document_accepted_at" timestamp with time zone NOT NULL,
	"sha256" char(64) NOT NULL,
	"byte_length" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "employee_equity_evidence_bytes_check" CHECK ("employee_equity_evidence"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "employee_equity_proposals" (
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
	"xbrl_options_outstanding" numeric,
	"xbrl_weighted_strike" numeric,
	"outcome" "employee_equity_outcome" NOT NULL,
	"transcription" jsonb,
	"reason" varchar(64),
	"accepted_rung" integer,
	"responded_model" varchar(128),
	"proposed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_equity_proposals_outcome_check" CHECK (("employee_equity_proposals"."outcome" = 'accepted') = ("employee_equity_proposals"."reason" is null) and ("employee_equity_proposals"."outcome" = 'accepted') = ("employee_equity_proposals"."transcription" is not null)),
	CONSTRAINT "employee_equity_proposals_accession_check" CHECK ("employee_equity_proposals"."accession_number" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
	CONSTRAINT "employee_equity_proposals_xbrl_check" CHECK (("employee_equity_proposals"."xbrl_options_outstanding" is null or "employee_equity_proposals"."xbrl_options_outstanding" >= 0) and ("employee_equity_proposals"."xbrl_weighted_strike" is null or "employee_equity_proposals"."xbrl_weighted_strike" >= 0)),
	CONSTRAINT "employee_equity_proposals_timeline_check" CHECK ("employee_equity_proposals"."recorded_at" >= "employee_equity_proposals"."proposed_at")
);
--> statement-breakpoint
ALTER TABLE "employee_equity_evidence" ADD CONSTRAINT "employee_equity_evidence_proposal_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."employee_equity_proposals"("proposal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_equity_proposals_subject_idx" ON "employee_equity_proposals" USING btree ("legal_entity_id","proposed_at");