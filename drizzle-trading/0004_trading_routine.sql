CREATE TYPE "public"."routine_phase" AS ENUM('pre_open', 'close');--> statement-breakpoint
CREATE TABLE "routine_items" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"phase" "routine_phase" NOT NULL,
	"label" varchar(80) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "routine_items_label_check" CHECK (char_length("routine_items"."label") between 2 and 80),
	CONSTRAINT "routine_items_retired_check" CHECK ("routine_items"."retired_at" is null or "routine_items"."retired_at" >= "routine_items"."created_at")
);
--> statement-breakpoint
CREATE TABLE "session_routines" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"session" date NOT NULL,
	"phase" "routine_phase" NOT NULL,
	"revision" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"checked" uuid[] NOT NULL,
	"note" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "session_routines_revision_check" CHECK ("session_routines"."revision" >= 1),
	CONSTRAINT "session_routines_checked_check" CHECK (cardinality("session_routines"."checked") <= 12),
	CONSTRAINT "session_routines_note_check" CHECK (char_length("session_routines"."note") <= 2000),
	CONSTRAINT "session_routines_superseded_check" CHECK ("session_routines"."superseded_at" is null or "session_routines"."superseded_at" >= "session_routines"."recorded_at")
);
--> statement-breakpoint
CREATE INDEX "routine_items_created_idx" ON "routine_items" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_routines_revision_uidx" ON "session_routines" USING btree ("session","phase","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "session_routines_current_uidx" ON "session_routines" USING btree ("session","phase") WHERE "session_routines"."superseded_at" is null;