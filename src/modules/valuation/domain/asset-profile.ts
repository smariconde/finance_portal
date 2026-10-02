import { z } from "zod";

/**
 * Perfil del activo. El motor de Fase 1 sólo cubre no financieras maduras; el
 * resto devuelve `unsupported_method` con sus inputs requeridos y nunca cae a
 * FCFF en silencio (`docs/valuation/methodology.md`, "Selección de método").
 *
 * Vive en su propio módulo porque lo comparten el snapshot de entrada y el
 * selector, y el snapshot ahora también lleva la selección.
 */
export const assetProfileSchema = z.enum([
  "non_financial_mature",
  "high_growth",
  "loss_making",
  "bank",
  "insurer",
  "reit",
  "cyclical",
  "commodity",
  "holding",
  "distressed",
]);

export type AssetProfile = z.infer<typeof assetProfileSchema>;
