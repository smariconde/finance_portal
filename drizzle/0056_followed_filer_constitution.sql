-- Constitución a pedido fuera del S&P 500 (`F6-33`, ADR 0084): un gap nuevo,
-- `identity_constituted`, que guarda `not_found` porque a su propio corte la
-- empresa todavía no existía, y el motivo de un ticker que no se sumó.
ALTER TYPE "public"."valuation_job_gap" ADD VALUE IF NOT EXISTS 'identity_constituted' BEFORE 'ambiguous_ticker';--> statement-breakpoint
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_identity_check";--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "identity_refusal" varchar(64);--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_identity_refusal_check" CHECK ("valuation_jobs"."identity_refusal" is null or "valuation_jobs"."gap"::text = 'unresolved_ticker');--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_identity_check" CHECK (("valuation_jobs"."gap"::text in ('unresolved_ticker', 'identity_constituted')) = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'not_found')
        and ("valuation_jobs"."gap" = 'ambiguous_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'ambiguous')
        and ("valuation_jobs"."gap" = 'identity_conflict') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'conflict')
        and ("valuation_jobs"."legal_entity_id" is not null) = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'resolved')
        and ("valuation_jobs"."security_id" is null or "valuation_jobs"."legal_entity_id" is not null)
        and ("valuation_jobs"."listing_id" is null or "valuation_jobs"."security_id" is not null)
        and ("valuation_jobs"."gap" is null or "valuation_jobs"."gap"::text in ('unresolved_ticker', 'identity_constituted', 'ambiguous_ticker', 'identity_conflict', 'assessment_failed') or "valuation_jobs"."legal_entity_id" is not null));