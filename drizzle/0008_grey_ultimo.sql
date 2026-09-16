ALTER TYPE "public"."corporate_action_type" ADD VALUE 'listing_transfer';--> statement-breakpoint
ALTER TYPE "public"."corporate_action_type" ADD VALUE 'delisting';--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_listing_terms_check" CHECK (case
        when "corporate_actions"."action_type"::text = 'listing_transfer' then "corporate_actions"."subject_type"::text = 'security'
          and coalesce("corporate_actions"."terms"->>'fromMic', '') ~ '^[A-Z0-9]{4}$'
          and coalesce("corporate_actions"."terms"->>'toMic', '') ~ '^[A-Z0-9]{4}$'
          and "corporate_actions"."terms"->>'fromMic' <> "corporate_actions"."terms"->>'toMic'
        when "corporate_actions"."action_type"::text = 'delisting' then "corporate_actions"."subject_type"::text = 'listing'
          and coalesce("corporate_actions"."terms"->>'mic', '') ~ '^[A-Z0-9]{4}$'
        else true
      end);