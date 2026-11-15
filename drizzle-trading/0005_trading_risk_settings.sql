CREATE TABLE "trading_risk_settings" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"risk_per_trade_percent" numeric NOT NULL,
	"open_risk_percent" numeric NOT NULL,
	"daily_loss_percent" numeric,
	"max_trades_per_session" integer,
	"max_consecutive_losses" integer,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "trading_risk_settings_revision_check" CHECK ("trading_risk_settings"."revision" >= 1),
	CONSTRAINT "trading_risk_settings_percent_check" CHECK ("trading_risk_settings"."risk_per_trade_percent" > 0 and "trading_risk_settings"."risk_per_trade_percent" <= "trading_risk_settings"."open_risk_percent" and "trading_risk_settings"."open_risk_percent" <= 100 and ("trading_risk_settings"."daily_loss_percent" is null or ("trading_risk_settings"."daily_loss_percent" > 0 and "trading_risk_settings"."daily_loss_percent" <= 100))),
	CONSTRAINT "trading_risk_settings_count_check" CHECK (("trading_risk_settings"."max_trades_per_session" is null or "trading_risk_settings"."max_trades_per_session" between 1 and 20) and ("trading_risk_settings"."max_consecutive_losses" is null or "trading_risk_settings"."max_consecutive_losses" between 1 and 20)),
	CONSTRAINT "trading_risk_settings_superseded_check" CHECK ("trading_risk_settings"."superseded_at" is null or "trading_risk_settings"."superseded_at" >= "trading_risk_settings"."recorded_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trading_risk_settings_revision_uidx" ON "trading_risk_settings" USING btree ("revision");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_risk_settings_current_uidx" ON "trading_risk_settings" USING btree ((true)) WHERE "trading_risk_settings"."superseded_at" is null;