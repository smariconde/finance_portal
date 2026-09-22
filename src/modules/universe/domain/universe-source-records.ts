import { z } from "zod";

/**
 * Las dos entradas que constituyen el universo, como contrato de dominio.
 *
 * Están separadas a propósito porque dicen cosas distintas y tienen autoridad
 * distinta:
 *
 * - una **claim de constituyente** afirma que un símbolo pertenece al índice.
 *   Su fuente publicada (`datahub-sp500-pddl`) deriva de Wikipedia y no prueba
 *   membresía oficial: es un universo de desarrollo declarado como tal en
 *   `docs/data/source-registry.md`. Nombra un ticker, que no es una identidad;
 * - una **asignación ticker→CIK** es autoritativa sobre la identidad del filer.
 *   La publica la SEC y es la única de las dos que puede decir a qué emisor
 *   corresponde un símbolo.
 *
 * La constitución del universo es el join entre ambas, y ese join sólo puede
 * hacerse por ticker. Por eso el resultado no es "el universo": es un universo
 * con sus casos irresueltos nombrados (`resolve-constituents.ts`).
 *
 * Los parsers de los formatos de cable —CSV del paquete PDDL y el JSON de
 * `company_tickers_exchange`— llegan con el provider real en `F2-03`. Escribirlos
 * ahora sería adivinar una forma de archivo que este slice no puede verificar
 * contra un payload; el contrato que sí se puede fijar hoy es el de estos dos
 * registros.
 */
export const indexConstituentClaimSchema = z.object({
  /** Valor original de la fuente: la normalización no lo reemplaza. */
  symbol: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(256),
  /**
   * Sector declarado por la lista, como etiqueta cruda.
   *
   * Desde `F7-02` se persiste como clasificación declarada (ADR 0025): la
   * taxonomía es `sp500-wikipedia-gics-sector` y su versión es el commit
   * pineado. Acá sigue viajando sin interpretar —el valor tal como la fuente lo
   * escribe—, y quien lo traduce a un código es `src/modules/classification/`.
   */
  sector: z.string().trim().min(1).max(128).nullable().default(null),
});

export type IndexConstituentClaim = z.infer<typeof indexConstituentClaimSchema>;

export const companyTickerAssignmentSchema = z.object({
  /** Dígitos tal como los publica la fuente; el relleno a diez es normalización. */
  cik: z
    .string()
    .trim()
    .regex(/^[0-9]{1,10}$/u),
  name: z.string().trim().min(1).max(256),
  ticker: z.string().trim().min(1).max(32),
  /** Etiqueta comercial del mercado; el MIC se resuelve por convención versionada. */
  exchange: z.string().trim().min(1).max(64).nullable(),
});

export type CompanyTickerAssignment = z.infer<
  typeof companyTickerAssignmentSchema
>;
