CREATE TABLE "classification_assignments" (
	"classification_assignment_id" uuid NOT NULL,
	"subject_type" "identifier_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"taxonomy_id" varchar(64) NOT NULL,
	"taxonomy_version" varchar(128) NOT NULL,
	"code" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_assignments_pkey" PRIMARY KEY("classification_assignment_id","valid_from"),
	CONSTRAINT "classification_assignments_valid_interval_check" CHECK ("classification_assignments"."valid_to" is null or "classification_assignments"."valid_from" < "classification_assignments"."valid_to"),
	CONSTRAINT "classification_assignments_superseded_after_available_check" CHECK ("classification_assignments"."superseded_at" is null or "classification_assignments"."superseded_at" > "classification_assignments"."available_at"),
	CONSTRAINT "classification_assignments_content_hash_check" CHECK ("classification_assignments"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "classification_assignments_taxonomy_id_check" CHECK ("classification_assignments"."taxonomy_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "classification_assignments_code_check" CHECK ("classification_assignments"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "classification_assignments_open_uidx" ON "classification_assignments" USING btree ("subject_type","subject_id","taxonomy_id") WHERE "classification_assignments"."valid_to" is null and "classification_assignments"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "classification_assignments_taxonomy_idx" ON "classification_assignments" USING btree ("taxonomy_id","code");--> statement-breakpoint
CREATE INDEX "classification_assignments_subject_idx" ON "classification_assignments" USING btree ("subject_type","subject_id");