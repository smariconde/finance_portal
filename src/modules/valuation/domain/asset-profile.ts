import { z } from "zod";

/**
 * Perfil del activo. FCFF sólo cubre no financieras maduras. Bancos y
 * aseguradoras tienen un contrato de equity propio desde F4-06, y los
 * corredores y bancos de inversión (SIC 6211) lo comparten desde `F6-53`; los demás
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
  "broker_dealer",
  "cyclical",
  "commodity",
  "holding",
  "distressed",
]);

export type AssetProfile = z.infer<typeof assetProfileSchema>;

/** Los perfiles que se valúan con exceso de retorno sobre el patrimonio común. */
export const EXCESS_RETURN_PROFILES = [
  "bank",
  "insurer",
  "broker_dealer",
] as const satisfies readonly AssetProfile[];

export type ExcessReturnProfile = (typeof EXCESS_RETURN_PROFILES)[number];

export function isExcessReturnProfile(
  profile: AssetProfile | null | undefined,
): profile is ExcessReturnProfile {
  return (EXCESS_RETURN_PROFILES as readonly string[]).includes(profile ?? "");
}
