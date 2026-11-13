CREATE TYPE "public"."schwab_connection_event_kind" AS ENUM('connected', 'access_refreshed', 'refresh_failed', 'exchange_failed', 'callback_rejected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TABLE "schwab_connection_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"kind" "schwab_connection_event_kind" NOT NULL,
	"code" varchar(64) NOT NULL,
	"request_id" varchar(64),
	"occurred_at" timestamp with time zone NOT NULL,
	"detail" text,
	CONSTRAINT "schwab_connection_events_code_check" CHECK ("schwab_connection_events"."code" ~ '^[a-z0-9_:.-]{1,64}$'),
	CONSTRAINT "schwab_connection_events_detail_check" CHECK ("schwab_connection_events"."detail" is null or length("schwab_connection_events"."detail") <= 512)
);
--> statement-breakpoint
CREATE TABLE "schwab_connections" (
	"connection_id" varchar(16) PRIMARY KEY NOT NULL,
	"access_envelope" "bytea" NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_envelope" "bytea" NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"envelope_version" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"refresh_claimed_until" timestamp with time zone,
	CONSTRAINT "schwab_connections_owner_check" CHECK ("schwab_connections"."connection_id" = 'owner'),
	CONSTRAINT "schwab_connections_refresh_lifetime_check" CHECK ("schwab_connections"."refresh_expires_at" > "schwab_connections"."authorized_at"),
	CONSTRAINT "schwab_connections_timeline_check" CHECK ("schwab_connections"."updated_at" >= "schwab_connections"."authorized_at")
);
--> statement-breakpoint
CREATE TABLE "schwab_oauth_states" (
	"state_hash" "bytea" PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "schwab_oauth_states_hash_check" CHECK (octet_length("schwab_oauth_states"."state_hash") = 32),
	CONSTRAINT "schwab_oauth_states_lifetime_check" CHECK ("schwab_oauth_states"."expires_at" > "schwab_oauth_states"."created_at"),
	CONSTRAINT "schwab_oauth_states_consumed_check" CHECK ("schwab_oauth_states"."consumed_at" is null or "schwab_oauth_states"."consumed_at" >= "schwab_oauth_states"."created_at")
);
--> statement-breakpoint
CREATE TABLE "source_budgets" (
	"source_id" varchar(64) NOT NULL,
	"usage_on" date NOT NULL,
	"requests" integer NOT NULL,
	"first_request_at" timestamp with time zone NOT NULL,
	"last_request_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_budgets_pkey" PRIMARY KEY("source_id","usage_on"),
	CONSTRAINT "source_budgets_requests_check" CHECK ("source_budgets"."requests" >= 0),
	CONSTRAINT "source_budgets_timeline_check" CHECK ("source_budgets"."last_request_at" >= "source_budgets"."first_request_at")
);
--> statement-breakpoint
CREATE TABLE "source_controls" (
	"control_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"status" "source_status" NOT NULL,
	"daily_request_limit" integer,
	"daily_spend_limit_nano_usd" bigint,
	"reason" varchar(240) NOT NULL,
	"actor" varchar(128) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "source_controls_limit_check" CHECK ("source_controls"."daily_request_limit" is null or "source_controls"."daily_request_limit" >= 0),
	CONSTRAINT "source_controls_spend_limit_check" CHECK ("source_controls"."daily_spend_limit_nano_usd" is null or "source_controls"."daily_spend_limit_nano_usd" >= 0),
	CONSTRAINT "source_controls_timeline_check" CHECK ("source_controls"."superseded_at" is null or "source_controls"."superseded_at" >= "source_controls"."recorded_at"),
	CONSTRAINT "source_controls_actor_check" CHECK ("source_controls"."actor" ~ '^[A-Za-z0-9._:@/-]{1,128}$')
);
--> statement-breakpoint
CREATE INDEX "schwab_connection_events_occurred_idx" ON "schwab_connection_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "schwab_oauth_states_expires_idx" ON "schwab_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_controls_current_uidx" ON "source_controls" USING btree ("source_id") WHERE "source_controls"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "source_controls_source_idx" ON "source_controls" USING btree ("source_id","recorded_at");