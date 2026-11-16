/** Recurso visual actual; el símbolo es un localizador del proveedor, nunca FK financiera. */
export type StoredCompanyLogo = {
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly fetchedAt: string;
};

export type CompanyLogoStore = {
  read(symbol: string): Promise<StoredCompanyLogo | null>;
  /** Reserva atómica de un faltante; una lease vencida se puede recuperar. */
  claim(symbol: string, token: string, now: string): Promise<boolean>;
  save(symbol: string, token: string, logo: StoredCompanyLogo): Promise<void>;
  defer(symbol: string, token: string, retryAt: string): Promise<void>;
};
