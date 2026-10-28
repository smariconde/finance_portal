import "server-only";

import { companyLogoUrl } from "@/modules/configuration/domain/company-logo";

/**
 * La URL del logo de una empresa (ADR 0062), o `null` si este runtime no tiene
 * clave de logo.dev. Se llama durante el request, después de resolver el modo,
 * así que la clave nunca se hornea en el build.
 */
export function requestCompanyLogoUrl(ticker: string): string | null {
  return companyLogoUrl(ticker, process.env.LOGO_DEV_PUBLISHABLE_KEY);
}
