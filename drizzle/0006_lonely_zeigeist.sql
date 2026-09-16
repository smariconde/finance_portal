CREATE TYPE "public"."corporate_action_type" AS ENUM('successor_issuer');--> statement-breakpoint
CREATE TYPE "public"."identity_decision_maker" AS ENUM('rule', 'owner');--> statement-breakpoint
CREATE TYPE "public"."legal_entity_relationship_type" AS ENUM('reporting_successor');--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"corporate_action_id" uuid PRIMARY KEY NOT NULL,
	"action_type" "corporate_action_type" NOT NULL,
	"subject_type" "identifier_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"announced_at" timestamp with time zone,
	"effective_on" date NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256) NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_content_hash_check" CHECK ("corporate_actions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "corporate_actions_announced_before_available_check" CHECK ("corporate_actions"."announced_at" is null or "corporate_actions"."announced_at" <= "corporate_actions"."available_at"),
	CONSTRAINT "corporate_actions_terms_object_check" CHECK (jsonb_typeof("corporate_actions"."terms") = 'object')
);
--> statement-breakpoint
CREATE TABLE "legal_entity_relationships" (
	"relationship_id" uuid NOT NULL,
	"relationship_type" "legal_entity_relationship_type" NOT NULL,
	"predecessor_legal_entity_id" uuid NOT NULL,
	"successor_legal_entity_id" uuid NOT NULL,
	"corporate_action_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"decided_by" "identity_decision_maker" NOT NULL,
	"decision_rule_version" varchar(64) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entity_relationships_pkey" PRIMARY KEY("relationship_id","valid_from"),
	CONSTRAINT "legal_entity_relationships_valid_interval_check" CHECK ("legal_entity_relationships"."valid_to" is null or "legal_entity_relationships"."valid_from" < "legal_entity_relationships"."valid_to"),
	CONSTRAINT "legal_entity_relationships_superseded_after_available_check" CHECK ("legal_entity_relationships"."superseded_at" is null or "legal_entity_relationships"."superseded_at" > "legal_entity_relationships"."available_at"),
	CONSTRAINT "legal_entity_relationships_content_hash_check" CHECK ("legal_entity_relationships"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "legal_entity_relationships_distinct_entities_check" CHECK ("legal_entity_relationships"."predecessor_legal_entity_id" <> "legal_entity_relationships"."successor_legal_entity_id"),
	CONSTRAINT "legal_entity_relationships_valid_from_check" CHECK ("legal_entity_relationships"."valid_from" = ("legal_entity_relationships"."effective_on"::timestamp at time zone 'America/New_York'))
);
--> statement-breakpoint
ALTER TABLE "legal_entity_relationships" ADD CONSTRAINT "legal_entity_relationships_predecessor_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("predecessor_legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_relationships" ADD CONSTRAINT "legal_entity_relationships_successor_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("successor_legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_relationships" ADD CONSTRAINT "legal_entity_relationships_corporate_action_id_corporate_actions_corporate_action_id_fk" FOREIGN KEY ("corporate_action_id") REFERENCES "public"."corporate_actions"("corporate_action_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_source_document_uidx" ON "corporate_actions" USING btree ("source_id","source_document_id","action_type");--> statement-breakpoint
CREATE INDEX "corporate_actions_subject_idx" ON "corporate_actions" USING btree ("subject_type","subject_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entity_relationships_successor_open_uidx" ON "legal_entity_relationships" USING btree ("relationship_type","successor_legal_entity_id") WHERE "legal_entity_relationships"."valid_to" is null and "legal_entity_relationships"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entity_relationships_predecessor_open_uidx" ON "legal_entity_relationships" USING btree ("relationship_type","predecessor_legal_entity_id") WHERE "legal_entity_relationships"."valid_to" is null and "legal_entity_relationships"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "legal_entity_relationships_predecessor_idx" ON "legal_entity_relationships" USING btree ("predecessor_legal_entity_id");