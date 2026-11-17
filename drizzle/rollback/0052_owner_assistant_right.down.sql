-- Quita el derecho del asistente del owner (ADR 0078); el registro declarado lo vuelve a escribir.
ALTER TABLE "source_registry" DROP COLUMN IF EXISTS "owner_assistant_right";
