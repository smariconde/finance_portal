CREATE TYPE "public"."snapshot_manifest_status" AS ENUM('stored', 'not_provided', 'license_restricted');--> statement-breakpoint
CREATE TABLE "dataset_snapshots" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"version" varchar(64) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manifest" jsonb,
	"manifest_status" "snapshot_manifest_status" NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "dataset_snapshots_valid_interval_check" CHECK ("dataset_snapshots"."valid_to" is null or "dataset_snapshots"."valid_from" < "dataset_snapshots"."valid_to"),
	CONSTRAINT "dataset_snapshots_manifest_status_check" CHECK (("dataset_snapshots"."manifest_status" = 'stored' and "dataset_snapshots"."manifest" is not null) or ("dataset_snapshots"."manifest_status" <> 'stored' and "dataset_snapshots"."manifest" is null)),
	CONSTRAINT "dataset_snapshots_content_hash_check" CHECK ("dataset_snapshots"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_snapshots_dataset_version_uidx" ON "dataset_snapshots" USING btree ("dataset_id","version");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_temporal_idx" ON "dataset_snapshots" USING btree ("dataset_id","valid_from","available_at");