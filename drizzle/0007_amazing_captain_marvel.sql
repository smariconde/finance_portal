ALTER TYPE "public"."corporate_action_type" ADD VALUE 'split';--> statement-breakpoint
ALTER TYPE "public"."corporate_action_type" ADD VALUE 'reverse_split';--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_split_terms_check" CHECK (case
        when "corporate_actions"."action_type"::text not in ('split', 'reverse_split') then true
        when "corporate_actions"."subject_type"::text <> 'legal_entity' then false
        when coalesce("corporate_actions"."terms"->>'ratio', '') !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when "corporate_actions"."action_type"::text = 'split' then ("corporate_actions"."terms"->>'ratio')::numeric > 1
        else ("corporate_actions"."terms"->>'ratio')::numeric > 0 and ("corporate_actions"."terms"->>'ratio')::numeric < 1
      end);