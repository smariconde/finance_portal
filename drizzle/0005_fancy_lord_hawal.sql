ALTER TYPE "public"."observation_period_type" ADD VALUE 'year_to_date' BEFORE 'annual';--> statement-breakpoint
CREATE TABLE "source_documents" (
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256) NOT NULL,
	"document_type" varchar(32) NOT NULL,
	"subject_type" "observation_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"published_on" date,
	"accepted_at" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"availability_rule" varchar(64) NOT NULL,
	"period_end_on" date,
	"fiscal_year" integer,
	"fiscal_period" varchar(4),
	"content_hash" text NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_documents_pkey" PRIMARY KEY("source_id","source_document_id"),
	CONSTRAINT "source_documents_content_hash_check" CHECK ("source_documents"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "source_documents_available_after_accepted_check" CHECK ("source_documents"."accepted_at" is null or "source_documents"."available_at" >= "source_documents"."accepted_at"),
	CONSTRAINT "source_documents_fiscal_year_check" CHECK ("source_documents"."fiscal_year" is null or "source_documents"."fiscal_year" between 1900 and 2200)
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "subject_key" varchar(128);--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "selection_version" varchar(64);--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_documents_subject_idx" ON "source_documents" USING btree ("subject_type","subject_id","available_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_subject_idx" ON "ingestion_runs" USING btree ("source_id","dataset_id","subject_key","started_at");