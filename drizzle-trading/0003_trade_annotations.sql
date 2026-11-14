CREATE TYPE "public"."trade_adherence_mark" AS ENUM('kept', 'broken');--> statement-breakpoint
CREATE TYPE "public"."trade_review_status" AS ENUM('pending', 'reviewed');--> statement-breakpoint
CREATE TABLE "trade_annotations" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"account_key" "bytea" NOT NULL,
	"trade_key" varchar(80) NOT NULL,
	"revision" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"setup_code" varchar(48),
	"plan_entry" numeric,
	"plan_stop" numeric,
	"plan_target" numeric,
	"plan_quantity" numeric,
	"adherence_entry" "trade_adherence_mark",
	"adherence_stop" "trade_adherence_mark",
	"adherence_target" "trade_adherence_mark",
	"adherence_size" "trade_adherence_mark",
	"emotion" varchar(16),
	"review" "trade_review_status" NOT NULL,
	"notes" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "trade_annotations_revision_check" CHECK ("trade_annotations"."revision" >= 1),
	CONSTRAINT "trade_annotations_trade_key_check" CHECK ("trade_annotations"."trade_key" ~ '^schwab:[0-9]{1,32}:[0-9]{1,32}(:before)?$'),
	CONSTRAINT "trade_annotations_setup_check" CHECK ("trade_annotations"."setup_code" is null or "trade_annotations"."setup_code" ~ '^([a-z][a-z0-9_]{1,40}|own-[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?)$'),
	CONSTRAINT "trade_annotations_plan_check" CHECK (("trade_annotations"."plan_entry" is null or "trade_annotations"."plan_entry" > 0) and ("trade_annotations"."plan_stop" is null or "trade_annotations"."plan_stop" > 0) and ("trade_annotations"."plan_target" is null or "trade_annotations"."plan_target" > 0) and ("trade_annotations"."plan_quantity" is null or "trade_annotations"."plan_quantity" > 0)),
	CONSTRAINT "trade_annotations_emotion_check" CHECK ("trade_annotations"."emotion" is null or "trade_annotations"."emotion" in ('calm', 'focused', 'confident', 'anxious', 'fomo', 'revenge', 'tired', 'bored')),
	CONSTRAINT "trade_annotations_notes_check" CHECK (char_length("trade_annotations"."notes") <= 4000),
	CONSTRAINT "trade_annotations_superseded_check" CHECK ("trade_annotations"."superseded_at" is null or "trade_annotations"."superseded_at" >= "trade_annotations"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "trading_setups" (
	"code" varchar(48) PRIMARY KEY NOT NULL,
	"label" varchar(40) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trading_setups_code_check" CHECK ("trading_setups"."code" ~ '^own-[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "trading_setups_label_check" CHECK (char_length("trading_setups"."label") between 2 and 40)
);
--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_account_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_annotations_revision_uidx" ON "trade_annotations" USING btree ("account_key","trade_key","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_annotations_current_uidx" ON "trade_annotations" USING btree ("account_key","trade_key") WHERE "trade_annotations"."superseded_at" is null;