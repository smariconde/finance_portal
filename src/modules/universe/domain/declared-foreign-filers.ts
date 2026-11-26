import { z } from "zod";

import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Emisores extranjeros que presentan 20-F y que el owner decidió seguir
 * (`F6-55`, [ADR 0087](../../../../docs/architecture/adr/0087-foreign-private-issuers.md)).
 *
 * Un 20-F se admite **sólo** por CIK declarado: nada se constituye a partir de
 * una lista ajena, y cada declaración dice en qué taxonomía y moneda reporta el
 * emisor y qué cotiza en EE. UU. El primer incremento declara a Spotify, que
 * cotiza su acción ordinaria en NYSE (sin ADS); Novo Nordisk entra cuando su ADS
 * se modele como recibo de depósito, y TSMC cuando haya tasa libre de riesgo en
 * TWD.
 */
export const DECLARED_FOREIGN_FILERS_VERSION = "declared-foreign-filers-1.0.0";

export const foreignFilerDeclarationSchema = z.strictObject({
  cik: z.string().regex(/^[0-9]{10}$/u),
  ticker: z.string().trim().min(1).max(12),
  annualForm: z.literal("20-F"),
  taxonomy: z.literal("ifrs-full"),
  reportingCurrency: z.string().regex(/^[A-Z]{3}$/u),
  /**
   * País ISO de incorporación, de la carátula del 20-F: el de la tasa marginal
   * y del riesgo país del domicilio (decisión del owner del 2026-11-25).
   */
  domicileCountry: z.string().regex(/^[A-Z]{2}$/u),
  /** Lo que cotiza en EE. UU.: la acción misma, sin ratio que aplicar. */
  listedInstrument: z.literal("ordinary_shares"),
  decidedBy: z.literal("owner"),
  declaredAt: utcTimestampSchema,
  rationale: z.string().trim().min(20).max(600),
});

export type ForeignFilerDeclaration = z.infer<
  typeof foreignFilerDeclarationSchema
>;

export const DECLARED_FOREIGN_FILERS: readonly ForeignFilerDeclaration[] =
  Object.freeze(
    [
      {
        cik: "0001639920",
        ticker: "SPOT",
        annualForm: "20-F",
        taxonomy: "ifrs-full",
        reportingCurrency: "EUR",
        domicileCountry: "LU",
        listedInstrument: "ordinary_shares",
        decidedBy: "owner",
        declaredAt: "2026-11-25T00:00:00.000Z",
        rationale:
          "Spotify Technology S.A. (Luxemburgo) presenta 20-F en IFRS y EUR y cotiza sus acciones ordinarias en NYSE; el owner decidió valuarla en EUR (ADR 0087).",
      },
    ].map((item) => foreignFilerDeclarationSchema.parse(item)),
  );

export function declaredForeignFiler(
  cik: string,
): ForeignFilerDeclaration | null {
  return DECLARED_FOREIGN_FILERS.find((item) => item.cik === cik) ?? null;
}
