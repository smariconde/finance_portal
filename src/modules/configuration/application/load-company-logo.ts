import { companyLogoSymbol } from "../domain/company-logo";

import type { CompanyLogoStore, StoredCompanyLogo } from "./company-logo-store";

export type CompanyLogoResult =
  | { readonly state: "stored"; readonly logo: StoredCompanyLogo }
  | { readonly state: "missing" }
  | { readonly state: "unavailable" };

export function createCompanyLogoLoader(dependencies: {
  readonly store: CompanyLogoStore;
  readonly download: (symbol: string) => Promise<StoredCompanyLogo | null>;
  readonly canDownload: () => boolean;
  readonly newToken: () => string;
  readonly now: () => string;
}) {
  return async (ticker: string): Promise<CompanyLogoResult> => {
    const symbol = companyLogoSymbol(ticker);
    if (symbol === null) return { state: "missing" };
    const stored = await dependencies.store.read(symbol);
    if (stored !== null) return { state: "stored", logo: stored };
    if (!dependencies.canDownload()) return { state: "missing" };
    const token = dependencies.newToken();
    if (!(await dependencies.store.claim(symbol, token, dependencies.now()))) {
      // Otra instancia puede haber terminado entre la lectura y la reserva.
      const ready = await dependencies.store.read(symbol);
      return ready === null
        ? { state: "missing" }
        : { state: "stored", logo: ready };
    }
    try {
      const logo = await dependencies.download(symbol);
      if (logo !== null) {
        await dependencies.store.save(symbol, token, logo);
        return { state: "stored", logo };
      }
      await dependencies.store.defer(
        symbol,
        token,
        new Date(Date.parse(dependencies.now()) + 86_400_000).toISOString(),
      );
      return { state: "missing" };
    } catch {
      // Nunca guarda HTML, un SVG, un error o un 404 como imagen. Los fallos
      // transitorios no se convierten en una ausencia permanente.
      await dependencies.store.defer(
        symbol,
        token,
        new Date(Date.parse(dependencies.now()) + 300_000).toISOString(),
      );
      return { state: "unavailable" };
    }
  };
}
