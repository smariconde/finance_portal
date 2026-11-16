CREATE TABLE "finviz_screener_strategies" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"strategy_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"catalog_version" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"view" varchar(3) NOT NULL,
	"signal" varchar(48),
	"filters" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "finviz_screener_strategies_revision_check" CHECK ("finviz_screener_strategies"."revision" >= 1),
	CONSTRAINT "finviz_screener_strategies_name_check" CHECK (char_length("finviz_screener_strategies"."name") between 1 and 80 and "finviz_screener_strategies"."name" = btrim("finviz_screener_strategies"."name")),
	CONSTRAINT "finviz_screener_strategies_query_check" CHECK ("finviz_screener_strategies"."view" ~ '^[0-9]{3}$' and ("finviz_screener_strategies"."signal" is null or "finviz_screener_strategies"."signal" ~ '^[a-z][a-z0-9_]{1,47}$') and "finviz_screener_strategies"."filters" ~ '^([a-z][a-z0-9_]*_[a-z0-9._-]+(,[a-z][a-z0-9_]*_[a-z0-9._-]+)*)?$' and char_length("finviz_screener_strategies"."filters") <= 4000),
	CONSTRAINT "finviz_screener_strategies_status_check" CHECK ("finviz_screener_strategies"."status" in ('active', 'archived')),
	CONSTRAINT "finviz_screener_strategies_superseded_check" CHECK ("finviz_screener_strategies"."superseded_at" is null or "finviz_screener_strategies"."superseded_at" >= "finviz_screener_strategies"."recorded_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finviz_screener_strategies_revision_uidx" ON "finviz_screener_strategies" USING btree ("strategy_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "finviz_screener_strategies_current_uidx" ON "finviz_screener_strategies" USING btree ("strategy_id") WHERE "finviz_screener_strategies"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "finviz_screener_strategies_name_uidx" ON "finviz_screener_strategies" USING btree (lower("name")) WHERE "finviz_screener_strategies"."superseded_at" is null and "finviz_screener_strategies"."status" = 'active';