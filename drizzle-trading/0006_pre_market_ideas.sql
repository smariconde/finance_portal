CREATE TABLE "pre_market_ideas" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"idea_id" uuid NOT NULL,
	"account_key" "bytea" NOT NULL,
	"revision" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"formula_version" varchar(64) NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"setup_code" varchar(48),
	"entry" numeric NOT NULL,
	"quantity" numeric NOT NULL,
	"manual_stop" numeric,
	"manual_target" numeric,
	"stop_mode" varchar(16) NOT NULL,
	"target_mode" varchar(16) NOT NULL,
	"liquidation_value" numeric NOT NULL,
	"risk_percent" numeric NOT NULL,
	"notes" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "pre_market_ideas_revision_check" CHECK ("pre_market_ideas"."revision" >= 1),
	CONSTRAINT "pre_market_ideas_symbol_check" CHECK ("pre_market_ideas"."symbol" ~ '^[A-Z][A-Z0-9./-]{0,15}$'),
	CONSTRAINT "pre_market_ideas_values_check" CHECK ("pre_market_ideas"."entry" > 0 and "pre_market_ideas"."quantity" > 0 and "pre_market_ideas"."liquidation_value" > 0 and "pre_market_ideas"."risk_percent" > 0 and "pre_market_ideas"."risk_percent" <= 100),
	CONSTRAINT "pre_market_ideas_modes_check" CHECK ("pre_market_ideas"."stop_mode" in ('manual', 'automatic') and "pre_market_ideas"."target_mode" in ('manual', 'one_to_two', 'one_to_three') and "pre_market_ideas"."status" in ('active', 'archived')),
	CONSTRAINT "pre_market_ideas_manual_check" CHECK (("pre_market_ideas"."manual_stop" is null or "pre_market_ideas"."manual_stop" > 0) and ("pre_market_ideas"."manual_target" is null or "pre_market_ideas"."manual_target" > 0) and ("pre_market_ideas"."stop_mode" <> 'manual' or "pre_market_ideas"."manual_stop" > 0) and ("pre_market_ideas"."target_mode" <> 'manual' or "pre_market_ideas"."manual_target" > 0)),
	CONSTRAINT "pre_market_ideas_notes_check" CHECK (char_length("pre_market_ideas"."notes") <= 4000),
	CONSTRAINT "pre_market_ideas_superseded_check" CHECK ("pre_market_ideas"."superseded_at" is null or "pre_market_ideas"."superseded_at" >= "pre_market_ideas"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "pre_market_trade_links" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"account_key" "bytea" NOT NULL,
	"idea_id" uuid NOT NULL,
	"plan_revision_id" uuid NOT NULL,
	"trade_key" varchar(80) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pre_market_trade_links_trade_key_check" CHECK ("pre_market_trade_links"."trade_key" ~ '^schwab:[0-9]{1,32}:[0-9]{1,32}(:before)?$'),
	CONSTRAINT "pre_market_trade_links_timeline_check" CHECK ("pre_market_trade_links"."linked_at" >= "pre_market_trade_links"."opened_at")
);
--> statement-breakpoint
ALTER TABLE "pre_market_ideas" ADD CONSTRAINT "pre_market_ideas_account_key_schwab_accounts_account_key_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_market_trade_links" ADD CONSTRAINT "pre_market_trade_links_account_key_schwab_accounts_account_key_fk" FOREIGN KEY ("account_key") REFERENCES "public"."schwab_accounts"("account_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_market_trade_links" ADD CONSTRAINT "pre_market_trade_links_plan_revision_id_pre_market_ideas_revision_id_fk" FOREIGN KEY ("plan_revision_id") REFERENCES "public"."pre_market_ideas"("revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_market_ideas_revision_uidx" ON "pre_market_ideas" USING btree ("account_key","idea_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_market_ideas_current_uidx" ON "pre_market_ideas" USING btree ("account_key","idea_id") WHERE "pre_market_ideas"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "pre_market_ideas_symbol_idx" ON "pre_market_ideas" USING btree ("account_key","symbol","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_market_trade_links_idea_uidx" ON "pre_market_trade_links" USING btree ("account_key","idea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_market_trade_links_trade_uidx" ON "pre_market_trade_links" USING btree ("account_key","trade_key");
