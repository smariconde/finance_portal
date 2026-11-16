import "server-only";

import { companyLogoAssetUrl } from "@/modules/configuration/domain/company-logo";

/**
 * Recurso propio, compartido por listas y gráficos. No descarga durante el render
 * ni entrega la clave al navegador (ADR 0077).
 */
export function requestCompanyLogoUrl(ticker: string): string | null {
  return companyLogoAssetUrl(ticker);
}
