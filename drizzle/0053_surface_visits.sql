CREATE TABLE "surface_visits" (
	"surface" varchar(32) PRIMARY KEY NOT NULL,
	"baseline_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "surface_visits_surface_check" CHECK ("surface_visits"."surface" in ('argentina')),
	CONSTRAINT "surface_visits_timeline_check" CHECK ("surface_visits"."baseline_at" is null or "surface_visits"."baseline_at" <= "surface_visits"."last_seen_at")
);
