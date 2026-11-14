CREATE TYPE "public"."schwab_transaction_run_status" AS ENUM('succeeded', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."schwab_transaction_state" AS ENUM('recorded', 'withdrawn');--> statement-breakpoint
CREATE TABLE "schwab_accounts" (
	"account_key" "bytea" PRIMARY KEY NOT NULL,
	"last_four" varchar(4) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schwab_accounts_key_check" CHECK (octet_length("schwab_accounts"."account_key") = 32),
	CONSTRAINT "schwab_accounts_last_four_check" CHECK ("schwab_accounts"."last_four" ~ '^[0-9]{4}$'),
	CONSTRAINT "schwab_accounts_seen_check" CHECK ("schwab_accounts"."last_seen_at" >= "schwab_accounts"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "schwab_transaction_runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"account_key" "bytea",
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"requests" integer NOT NULL,
	"status" "schwab_transaction_run_status" NOT NULL,
	"code" varchar(64),
	"inserted" integer NOT NULL,
	"revised" integer NOT NULL,
	"withdrawn" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"parser_version" varchar(64) NOT NULL,
	CONSTRAINT "schwab_transaction_runs_counts_check" CHECK ("schwab_transaction_runs"."requests" >= 0 and "schwab_transaction_runs"."inserted" >= 0 and "schwab_transaction_runs"."revised" >= 0 and "schwab_transaction_runs"."withdrawn" >= 0 and "schwab_transaction_runs"."unchanged" >= 0),
	CONSTRAINT "schwab_transaction_runs_code_check" CHECK (("schwab_transaction_runs"."status" = 'succeeded') = ("schwab_transaction_runs"."code" is null) and ("schwab_transaction_runs"."code" is null or "schwab_transaction_runs"."code" ~ '^[a-z0-9_:.-]{1,64}$')),
	CONSTRAINT "schwab_transaction_runs_timeline_check" CHECK ("schwab_transaction_runs"."finished_at" >= "schwab_transaction_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "schwab_transaction_sync" (
	"account_key" "bytea" PRIMARY KEY NOT NULL,
	"history_from" timestamp with time zone,
	"checked_through" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	CONSTRAINT "schwab_transaction_sync_window_check" CHECK (("schwab_transaction_sync"."history_from" is null) = ("schwab_transaction_sync"."checked_through" is null) and ("schwab_transaction_sync"."checked_through" is null or "schwab_transaction_sync"."checked_through" >= "schwab_transaction_sync"."history_from"))
);
--> statement-breakpoint
CREATE TABLE "schwab_transactions" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"account_key" "bytea" NOT NULL,
	"activity_id" varchar(32) NOT NULL,
	"revision" integer NOT NULL,
	"state" "schwab_transaction_state" NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"description" varchar(256),
	"order_id" varchar(32),
	"position_id" varchar(32),
	"net_amount" numeric NOT NULL,
	"fees" numeric,
	"instrument_id" varchar(32),
	"symbol" varchar(64),
	"asset_type" varchar(32),
	"instrument_type" varchar(64),
	"instrument_description" varchar(256),
	"quantity" numeric,
	"price" numeric,
	"position_effect" varchar(16),
	"content_hash" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "schwab_transactions_revision_check" CHECK ("schwab_transactions"."revision" >= 1),
	CONSTRAINT "schwab_transactions_activity_check" CHECK ("schwab_transactions"."activity_id" ~ '^[0-9]{1,32}$'),
	CONSTRAINT "schwab_transactions_hash_check" CHECK ("schwab_transactions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "schwab_transactions_instrument_check" CHECK (("schwab_transactions"."type" = 'TRADE') = ("schwab_transactions"."instrument_id" is not null and "schwab_transactions"."symbol" is not null and "schwab_transactions"."asset_type" is not null and "schwab_transactions"."quantity" is not null and "schwab_transactions"."fees" is not null)),
	CONSTRAINT "schwab_transactions_superseded_check" CHECK ("schwab_transactions"."superseded_at" is null or "schwab_transactions"."superseded_at" >= "schwab_transactions"."recorded_at")
);
--> statement-breakpoint
ALTER TABLE "schwab_transaction_runs" ADD CONSTRAINT "schwab_transaction_runs_account_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schwab_transaction_sync" ADD CONSTRAINT "schwab_transaction_sync_account_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schwab_transactions" ADD CONSTRAINT "schwab_transactions_account_key_schwab_accounts_account_key_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schwab_transaction_runs_finished_idx" ON "schwab_transaction_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schwab_transactions_revision_uidx" ON "schwab_transactions" USING btree ("account_key","activity_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "schwab_transactions_current_uidx" ON "schwab_transactions" USING btree ("account_key","activity_id") WHERE "schwab_transactions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "schwab_transactions_executed_idx" ON "schwab_transactions" USING btree ("account_key","executed_at");