CREATE TABLE "company_business_excerpts" (
	"legal_entity_id" uuid NOT NULL,
	"cik" char(10) NOT NULL,
	"accession_number" varchar(20) NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"document_url" text NOT NULL,
	"excerpt" varchar(500) NOT NULL,
	"extract_version" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "company_business_excerpts_pkey" PRIMARY KEY("legal_entity_id","accession_number","extract_version"),
	CONSTRAINT "company_business_excerpts_length_check" CHECK (char_length("company_business_excerpts"."excerpt") between 80 and 500)
);
--> statement-breakpoint
CREATE INDEX "company_business_excerpts_subject_idx" ON "company_business_excerpts" USING btree ("legal_entity_id","accepted_at");