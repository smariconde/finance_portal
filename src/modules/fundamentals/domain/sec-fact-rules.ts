import type { StagedRecord } from "@/modules/ingestion/domain/staged-record";

import type { SecFiling } from "./parse-sec-submissions";

/**
 * Reglas que convierten un punto de companyfacts en un registro del contrato
 * point-in-time: qué tipo de período es, en qué unidad está y desde cuándo era
 * conocible. Son parte del contenido publicado, así que viajan con la versión del
 * parser y cambiarlas sube esa versión.
 */
export const SEC_FACT_RULES_VERSION = "sec-fact-rules-1.0.0";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets de duración, en días contando ambos extremos.
 *
 * Medidos sobre el cable real: un ejercicio de 52/53 semanas da 91 y 98 días por
 * trimestre, 182 y 189 por semestre, 273 y 280 por nueve meses, y 364 o 371 por
 * año; un ejercicio calendario da 90 a 92, 181 a 182, 273 y 365 o 366. Nada cayó
 * fuera de esos buckets en 15.767 duraciones. Lo que caiga fuera —un período de
 * transición, un stub después de una adquisición— se rechaza nombrado en vez de
 * forzarse al bucket más cercano.
 *
 * `year_to_date` se infiere de la duración y no del inicio del ejercicio: la
 * clave lógica conserva `start` y `end` exactos, así que la clasificación nunca
 * altera la identidad del hecho, sólo cómo se agrupa.
 */
const PERIOD_BUCKETS: ReadonlyArray<
  readonly [number, number, "quarter" | "year_to_date" | "annual"]
> = [
  [84, 98, "quarter"],
  [175, 190, "year_to_date"],
  [266, 282, "year_to_date"],
  [350, 378, "annual"],
];

export type SecPeriod = Pick<
  StagedRecord,
  "asOf" | "periodStart" | "periodEnd" | "periodType"
>;

export function classifySecPeriod(
  start: string | null,
  end: string,
): SecPeriod | null {
  if (start === null) {
    return {
      asOf: end,
      periodStart: null,
      periodEnd: null,
      periodType: "instant",
    };
  }

  const days =
    Math.round(
      (Date.parse(`${end}T00:00:00.000Z`) -
        Date.parse(`${start}T00:00:00.000Z`)) /
        DAY_MS,
    ) + 1;
  const bucket = PERIOD_BUCKETS.find(
    ([min, max]) => days >= min && days <= max,
  );

  return bucket === undefined
    ? null
    : { asOf: end, periodStart: start, periodEnd: end, periodType: bucket[2] };
}

export type SecUnit = Pick<StagedRecord, "unit" | "currency">;

/**
 * Unidad de la fuente al vocabulario del contrato. Un importe es `monetary` con su
 * moneda aparte, igual que en el resto del sistema, para que dos monedas nunca se
 * sumen por compartir la palabra «monetary». Lo que no se reconoce se rechaza: una
 * unidad adivinada es un valor que se compara con lo que no corresponde.
 */
export function mapSecUnit(unit: string): SecUnit | null {
  const perShare = /^([A-Z]{3})\/shares$/u.exec(unit);

  if (perShare !== null) {
    return { unit: "monetary_per_share", currency: perShare[1]! };
  }

  if (/^[A-Z]{3}$/u.test(unit)) {
    return { unit: "monetary", currency: unit };
  }

  if (unit === "shares" || unit === "pure") {
    return { unit, currency: null };
  }

  return null;
}

/**
 * Inversa de `mapSecUnit`: la unidad de la fuente que produjo una unidad del
 * contrato. Es exacta porque `mapSecUnit` no descarta nada de lo que acepta.
 */
export function formatSecUnit(unit: SecUnit): string | null {
  if (unit.currency !== null && /^[A-Z]{3}$/u.test(unit.currency)) {
    if (unit.unit === "monetary") {
      return unit.currency;
    }

    if (unit.unit === "monetary_per_share") {
      return `${unit.currency}/shares`;
    }

    return null;
  }

  return unit.currency === null &&
    (unit.unit === "shares" || unit.unit === "pure")
    ? unit.unit
    : null;
}

export type SecFactIdentity = SecUnit & {
  /** CIK del documento, normalizado a diez dígitos. */
  readonly cik: string;
  /** Concepto calificado: `us-gaap:Assets`. */
  readonly concept: string;
  readonly periodStart: string | null;
  /** Fin del período, o el instante de un saldo. */
  readonly asOf: string;
  readonly accessionNumber: string;
};

/**
 * ID externo de una vintage de la SEC: CIK, concepto calificado, unidad de la
 * fuente, inicio (o `instant`), fin y presentación.
 *
 * Todo sale de columnas de la observación publicada más el `subject_key` de su
 * corrida, así que la fila no lo guarda (ADR 0018) y el rollback de la migración
 * `0012` repite esta fórmula en SQL. El ID entra al content hash: cambiar el
 * formato haría que cada hecho ya publicado pareciera una revisión nueva.
 */
export function secFactExternalId(identity: SecFactIdentity): string {
  const unit = formatSecUnit(identity);

  if (unit === null) {
    throw new RangeError(
      `No SEC unit produces ${identity.unit}/${identity.currency ?? "none"}.`,
    );
  }

  return [
    identity.cik,
    identity.concept,
    unit,
    identity.periodStart ?? "instant",
    identity.asOf,
    identity.accessionNumber,
  ].join(":");
}

/**
 * Formularios cuya fecha de filing nunca es anterior a su aceptación: los reportes
 * periódicos y corrientes que traen estados financieros. En el cable real hay
 * documentos cuya fecha de filing precede por semanas a la aceptación —cartas del
 * staff, `NO ACT`—, y para esos la fecha no es una cota defendible.
 */
const FILING_DATE_BOUNDED_FORMS: ReadonlySet<string> = new Set(
  ["10-K", "10-Q", "10-KT", "10-QT", "8-K", "20-F", "40-F", "6-K"].flatMap(
    (form) => [form, `${form}/A`],
  ),
);

export const AVAILABILITY_INFERRED_FLAG = "availability_inferred";

export type SecAvailability = {
  readonly availableAt: string;
  readonly acceptedAt: string | null;
  readonly rule: "sec_acceptance" | "sec_filing_date_end_of_day";
  readonly inferred: boolean;
};

/**
 * `available_at` de una presentación.
 *
 * 1. Con aceptación publicada, es la aceptación: el instante en que EDGAR la
 *    diseminó.
 * 2. Sin aceptación, y sólo para formularios acotados por su fecha de filing, es
 *    el primer instante del día siguiente en Nueva York con el offset más tardío
 *    del año (EST, `05:00Z`). En horario de verano eso queda una hora después de
 *    la medianoche real: la regla puede llegar tarde, nunca antes. Se marca
 *    `availability_inferred`.
 * 3. Cualquier otro caso no tiene fecha defendible y se rechaza. Nunca se toma el
 *    cierre del período ni la fecha de descarga.
 */
export function resolveSecAvailability(filing: {
  readonly form: string;
  readonly filingDate: string;
  readonly acceptedAt: string | null;
}): SecAvailability | null {
  if (filing.acceptedAt !== null) {
    return {
      availableAt: filing.acceptedAt,
      acceptedAt: filing.acceptedAt,
      rule: "sec_acceptance",
      inferred: false,
    };
  }

  if (!FILING_DATE_BOUNDED_FORMS.has(filing.form)) {
    return null;
  }

  const nextDay = new Date(
    Date.parse(`${filing.filingDate}T05:00:00.000Z`) + DAY_MS,
  );

  return {
    availableAt: nextDay.toISOString(),
    acceptedAt: null,
    rule: "sec_filing_date_end_of_day",
    inferred: true,
  };
}

/** Índice de presentaciones por accession, con los desacuerdos separados. */
export type SecFilingIndex = {
  readonly byAccession: ReadonlyMap<string, SecFiling>;
  /** Accessions que dos filas describen distinto: no se usan. */
  readonly conflicting: ReadonlySet<string>;
};

export function indexSecFilings(filings: readonly SecFiling[]): SecFilingIndex {
  const byAccession = new Map<string, SecFiling>();
  const conflicting = new Set<string>();

  for (const filing of filings) {
    const known = byAccession.get(filing.accessionNumber);

    if (known === undefined) {
      byAccession.set(filing.accessionNumber, filing);
    } else if (
      known.form !== filing.form ||
      known.filingDate !== filing.filingDate ||
      known.acceptedAt !== filing.acceptedAt ||
      known.reportDate !== filing.reportDate
    ) {
      conflicting.add(filing.accessionNumber);
    }
  }

  for (const accession of conflicting) {
    byAccession.delete(accession);
  }

  return { byAccession, conflicting };
}
