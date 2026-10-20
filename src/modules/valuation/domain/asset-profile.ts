import { z } from "zod";

/**
 * Perfil del activo. FCFF sólo cubre no financieras maduras. Bancos y
 * aseguradoras tienen un contrato de equity propio desde F4-06; los demás
 * métodos aún no implementados se rechazan y nunca caen a FCFF en silencio.
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
