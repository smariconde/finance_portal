ALTER TYPE "public"."corporate_action_type" ADD VALUE 'acquisition';--> statement-breakpoint
ALTER TYPE "public"."corporate_action_type" ADD VALUE 'symbol_change';--> statement-breakpoint
ALTER TYPE "public"."legal_entity_relationship_type" ADD VALUE 'acquired_by';--> statement-breakpoint
DROP INDEX "legal_entity_relationships_successor_open_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entity_relationships_successor_open_uidx" ON "legal_entity_relationships" USING btree ("relationship_type","successor_legal_entity_id") WHERE "legal_entity_relationships"."valid_to" is null and "legal_entity_relationships"."superseded_at" is null and "legal_entity_relationships"."relationship_type" = 'reporting_successor';--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_declared_terms_check" CHECK (case when "corporate_actions"."action_type"::text in ('acquisition', 'symbol_change') then
        coalesce("corporate_actions"."terms"->>'decidedBy', '') = 'owner'
        and coalesce("corporate_actions"."terms"->>'decidedAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$'
        and coalesce("corporate_actions"."terms"->>'declarationHash', '') ~ '^[a-f0-9]{64}$'
        and length(coalesce("corporate_actions"."terms"->>'rationale', '')) > 0
        and length(coalesce("corporate_actions"."terms"->>'ruleVersion', '')) > 0
        and case when "corporate_actions"."action_type"::text = 'acquisition' then
          "corporate_actions"."subject_type"::text = 'legal_entity'
          and coalesce("corporate_actions"."terms"->>'acquirerLegalEntityId', '') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
          and "corporate_actions"."terms"->>'acquirerLegalEntityId' <> "corporate_actions"."subject_id"::text
        else "corporate_actions"."subject_type"::text = 'listing'
          and coalesce("corporate_actions"."terms"->>'mic', '') ~ '^[A-Z0-9]{4}$'
          and coalesce("corporate_actions"."terms"->>'fromSymbol', '') ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'
          and coalesce("corporate_actions"."terms"->>'toSymbol', '') ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'
          and "corporate_actions"."terms"->>'fromSymbol' <> "corporate_actions"."terms"->>'toSymbol'
        end
      else true end);