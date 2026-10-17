CREATE TYPE "public"."ai_spend_purpose" AS ENUM('task', 'eval');--> statement-breakpoint
ALTER TABLE "ai_spend_ledger" ADD COLUMN "purpose" "ai_spend_purpose" DEFAULT 'task' NOT NULL;