import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Pares ADR–acción local de los que sale el CCL implícito (`F9-07`,
 * [ADR 0068](../../../../docs/architecture/adr/0068-implied-ccl-adr-pairs.md)).
 *
 * El ratio es cuántas acciones locales representa un ADR, y es una **versión
 * fechada**: YPF pasó de 1 a 10 con el split local 10:1 del 2026-08-03. Cada
 * ratio se verificó sobre cierres crudos contra el mayorista en las épocas sin
 * cepo, donde el CCL y el oficial coinciden: `mayorista × ADR / local` dio el
 * ratio declarado con mediana dentro del 1 % (2016-03 a 2019-08).
 *
 * Quedaron fuera los pares cuyo cociente se corre con dividendos en acciones o
 * splits locales sin contraparte (TGS, CRESY, IRS). Agregar un par es un diff
 * revisable con su medición.
 */
export const pairIdSchema = z
  .string()
  .regex(/^[a-z0-9]+$/u)
  .max(16);

export const adrPairRatioSchema = z.object({
  validFrom: calendarDateSchema,
  /** Acciones locales por ADR, decimal canónico positivo. */
  localPerAdr: z.string().regex(/^[1-9][0-9]*(?:\.[0-9]*[1-9])?$/u),
});

export const declaredAdrPairSchema = z.object({
  pairId: pairIdSchema,
  issuer: z.string().min(1),
  adrSymbol: z.string().min(1).max(16),
  localSymbol: z.string().min(1).max(16),
  /** Ordenados por `validFrom`; el primero marca desde cuándo el par cuenta. */
  ratios: z.array(adrPairRatioSchema).min(1),
});

export type DeclaredAdrPair = z.infer<typeof declaredAdrPairSchema>;

export const DECLARED_ADR_PAIRS_VERSION = "declared-adr-pairs-1.0.0";

const declare = (
  pairId: string,
  issuer: string,
  adrSymbol: string,
  localSymbol: string,
  ratios: [string, string][],
): DeclaredAdrPair =>
  declaredAdrPairSchema.parse({
    pairId,
    issuer,
    adrSymbol,
    localSymbol,
    ratios: ratios.map(([validFrom, localPerAdr]) => ({
      validFrom,
      localPerAdr,
    })),
  });

/** Medido el 2026-11-03: mediana del ratio implícito 2016-03 a 2019-08 entre paréntesis. */
export const DECLARED_ADR_PAIRS: readonly DeclaredAdrPair[] = Object.freeze([
  // 9,98
  declare("ggal", "Grupo Financiero Galicia", "GGAL", "GGAL.BA", [
    ["2000-07-26", "10"],
  ]),
  // 1,00; 10 desde el split local 10:1
  declare("ypf", "YPF", "YPF", "YPFD.BA", [
    ["2000-01-03", "1"],
    ["2026-08-03", "10"],
  ]),
  // 9,98
  declare("bma", "Banco Macro", "BMA", "BMA.BA", [["2006-03-27", "10"]]),
  // 3,01
  declare("bbar", "BBVA Argentina", "BBAR", "BBAR.BA", [["2000-01-03", "3"]]),
  // 4,99
  declare("teo", "Telecom Argentina", "TEO", "TECO2.BA", [["2000-01-03", "5"]]),
  // 19,98
  declare("edn", "Edenor", "EDN", "EDN.BA", [["2007-04-30", "20"]]),
  // 24,95
  declare("pam", "Pampa Energía", "PAM", "PAMP.BA", [["2009-10-09", "25"]]),
  // 10,03
  declare("cepu", "Central Puerto", "CEPU", "CEPU.BA", [["2018-02-02", "10"]]),
  // 5,00
  declare("loma", "Loma Negra", "LOMA", "LOMA.BA", [["2017-11-01", "5"]]),
  // 5,00
  declare("supv", "Grupo Supervielle", "SUPV", "SUPV.BA", [
    ["2016-05-19", "5"],
  ]),
]);

export type AdrLegSide = "adr" | "local";

export function legIdOf(pairId: string, side: AdrLegSide): string {
  return `${pairId}-${side}`;
}

/** Moneda que cada pata tiene que traer: una pata en otra moneda se rechaza. */
export const LEG_CURRENCY: Readonly<Record<AdrLegSide, string>> = Object.freeze(
  { adr: "USD", local: "ARS" },
);

/** El ratio vigente un día, o `null` antes de que el par cuente. */
export function ratioOn(
  pair: DeclaredAdrPair,
  marketDate: string,
): string | null {
  let ratio: string | null = null;

  for (const version of pair.ratios) {
    if (version.validFrom <= marketDate) {
      ratio = version.localPerAdr;
    }
  }

  return ratio;
}

export const adrLegCloseSchema = z.object({
  legId: z.string().regex(/^[a-z0-9]+-(?:adr|local)$/u),
  marketDate: calendarDateSchema,
  /** Cierre **crudo**: lo que se operó ese día, sin ajuste por splits posteriores. */
  close: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u),
  currency: z.string().length(3),
});

export type AdrLegClose = z.infer<typeof adrLegCloseSchema>;
