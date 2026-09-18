CREATE TABLE "observation_prunes" (
	"prune_id" uuid PRIMARY KEY NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"subject_type" "observation_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"selection_version" varchar(64) NOT NULL,
	"selection_anchor_on" date NOT NULL,
	"anchor_run_id" uuid NOT NULL,
	"periods_ending_before" date NOT NULL,
	"evidence_periods_ending_before" date NOT NULL,
	"evidence_concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_count" integer NOT NULL,
	"kept_count" integer NOT NULL,
	"deleted_min_as_of" date,
	"deleted_max_as_of" date,
	"actor" varchar(128) NOT NULL,
	"reason" varchar(240) NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "observation_prunes_counts_check" CHECK ("observation_prunes"."deleted_count" >= 0 and "observation_prunes"."kept_count" >= 0),
	CONSTRAINT "observation_prunes_deleted_range_check" CHECK (("observation_prunes"."deleted_count" = 0) = ("observation_prunes"."deleted_min_as_of" is null)
        and ("observation_prunes"."deleted_count" = 0) = ("observation_prunes"."deleted_max_as_of" is null)
        and ("observation_prunes"."deleted_min_as_of" is null or "observation_prunes"."deleted_min_as_of" <= "observation_prunes"."deleted_max_as_of")),
	CONSTRAINT "observation_prunes_cuts_check" CHECK ("observation_prunes"."evidence_periods_ending_before" <= "observation_prunes"."periods_ending_before"
        and "observation_prunes"."periods_ending_before" <= "observation_prunes"."selection_anchor_on"),
	CONSTRAINT "observation_prunes_within_cut_check" CHECK ("observation_prunes"."deleted_max_as_of" is null or "observation_prunes"."deleted_max_as_of" < "observation_prunes"."periods_ending_before"),
	CONSTRAINT "observation_prunes_evidence_concepts_check" CHECK (jsonb_typeof("observation_prunes"."evidence_concepts") = 'array'),
	CONSTRAINT "observation_prunes_actor_check" CHECK ("observation_prunes"."actor" ~ '^[A-Za-z0-9._:@/-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "observation_prunes" ADD CONSTRAINT "observation_prunes_anchor_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("anchor_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observation_prunes_subject_idx" ON "observation_prunes" USING btree ("subject_type","subject_id","executed_at");