import type { SecReportedFact } from "./parse-sec-company-facts";
import { isCalendarDate } from "./parse-sec-submissions";
import { classifySecPeriod } from "./sec-fact-rules";

/**
 * Ventana de historia de los hechos XBRL de un filer (ADR 0017).
 *
 * Se guardan cinco ejercicios completos y el cierre del ejercicio anterior, que es
 * la base de toda comparación a cinco años: la matriz de divergencias calcula el
 * crecimiento del EPS entre dos cierres fiscales separados por cinco años, así
 * que necesita el EPS **anual** del cierre base, no sólo su balance.
 *
 * La regla es un solo corte por fin de período, igual para duraciones e
 * instantes:
 *
 *     se conserva un hecho si  end >= ancla − 5 años − 14 días
 *
 * - **Ancla:** el fin del último ejercicio anual que reportó el propio filer —la
 *   duración anual más reciente de una presentación con foco `FY`—, no el reloj.
 *   Un filer con cierre en junio que todavía no presentó su 10-K no pierde un
 *   año, y la misma descarga recorta siempre igual. Medido el 2026-09-17 sobre 25
 *   filers: coincide en todos con el `reportDate` de su último 10-K. Sin exigir
 *   `FY` no alcanza: Amazon publica duraciones anuales (TTM) en sus 10-Q.
 * - **Sin ejercicio anual** (un registrante nuevo, el sucesor de ExxonMobil), el
 *   ancla es el último fin de período publicado.
 * - **Los 14 días** absorben los ejercicios de 52/53 semanas, cuyo cierre se mueve
 *   hasta una semana entre años. Así entran el ejercicio base (anual y cuarto
 *   trimestre) y su balance de cierre, y queda afuera todo lo que termina antes:
 *   el tercer trimestre y los acumulados de nueve meses del ejercicio base.
 * - **Evidencia de splits:** los conceptos que un split re-expresa conservan un
 *   ejercicio más. La presentación que confirma un split re-expresa comparativos
 *   de un año antes (ADR 0012): sin ellos, un split del primer año de la ventana
 *   no se confirma, o se confirma en una presentación posterior y ajusta dos veces
 *   lo que ya estaba en base nueva. Medido sobre NVIDIA (4:1 de 2021) y GE (1:8 de
 *   2021). Ese ejercicio extra es evidencia, no historia de análisis.
 *
 * La ventana se aplica sobre los hechos seleccionados, antes de armar vintages y
 * antes de elegir los archivos históricos de submissions: lo que queda afuera no
 * se publica ni cuesta requests. Una regla que mira toda la presentación —la
 * firma fiscal de una accession— ve sólo los hechos de la ventana, igual que hoy
 * ve sólo los conceptos seleccionados.
 */
export const SEC_HISTORY_WINDOW_VERSION = "sec-history-5fy-1.0.0";

/** Ejercicios completos después del cierre base. */
export const HISTORY_FISCAL_YEARS = 5;

/** Ejercicios adicionales de los conceptos que prueban un split. */
export const SPLIT_EVIDENCE_EXTRA_FISCAL_YEARS = 1;

/** Movimiento máximo del cierre de un ejercicio de 52/53 semanas, con margen. */
export const FISCAL_YEAR_END_TOLERANCE_DAYS = 14;

export type SecHistoryAnchorBasis =
  /** Fin de la duración anual más reciente con foco `FY`. */
  | "annual_report"
  /** El filer no publicó ningún ejercicio anual: último fin de período. */
  | "latest_period";

export type SecHistoryWindow = {
  readonly version: string;
  readonly anchorOn: string;
  readonly anchorBasis: SecHistoryAnchorBasis;
  /** Primer fin de período que se conserva. */
  readonly periodsEndingFrom: string;
  /** Primer fin de período que se conserva para los conceptos de evidencia. */
  readonly evidencePeriodsEndingFrom: string;
};

export type SecHistoryWindowSelection = {
  /** `null` si no hay hechos: sin hechos no hay ancla. */
  readonly window: SecHistoryWindow | null;
  readonly facts: readonly SecReportedFact[];
  readonly counts: {
    /** Hechos seleccionados que entraron a la ventana. */
    readonly points: number;
    readonly kept: number;
    readonly outside: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function assertCalendarDate(value: string): void {
  if (!isCalendarDate(value)) {
    throw new TypeError("History window dates must be calendar dates.");
  }
}

/**
 * Misma fecha `years` años antes. Un 29 de febrero cae en el 28 de febrero de un
 * año no bisiesto, nunca en el 1 de marzo: correr el corte hacia adelante dejaría
 * afuera un cierre que entra.
 */
export function subtractCalendarYears(date: string, years: number): string {
  assertCalendarDate(date);

  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const targetYear = year - years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();

  return [
    String(targetYear).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}

export function subtractDays(date: string, days: number): string {
  assertCalendarDate(date);

  return new Date(Date.parse(`${date}T00:00:00.000Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function resolveSecHistoryAnchor(facts: readonly SecReportedFact[]): {
  readonly anchorOn: string;
  readonly anchorBasis: SecHistoryAnchorBasis;
} | null {
  let annual: string | null = null;
  let latest: string | null = null;

  for (const fact of facts) {
    if (latest === null || fact.end > latest) {
      latest = fact.end;
    }

    if (
      fact.fiscalPeriod === "FY" &&
      (annual === null || fact.end > annual) &&
      classifySecPeriod(fact.start, fact.end)?.periodType === "annual"
    ) {
      annual = fact.end;
    }
  }

  if (annual !== null) {
    return { anchorOn: annual, anchorBasis: "annual_report" };
  }

  return latest === null
    ? null
    : { anchorOn: latest, anchorBasis: "latest_period" };
}

export function buildSecHistoryWindow(
  anchorOn: string,
  anchorBasis: SecHistoryAnchorBasis,
): SecHistoryWindow {
  const from = (years: number) =>
    subtractDays(
      subtractCalendarYears(anchorOn, years),
      FISCAL_YEAR_END_TOLERANCE_DAYS,
    );

  return {
    version: SEC_HISTORY_WINDOW_VERSION,
    anchorOn,
    anchorBasis,
    periodsEndingFrom: from(HISTORY_FISCAL_YEARS),
    evidencePeriodsEndingFrom: from(
      HISTORY_FISCAL_YEARS + SPLIT_EVIDENCE_EXTRA_FISCAL_YEARS,
    ),
  };
}

export function isInSecHistoryWindow(
  fact: Pick<SecReportedFact, "end">,
  window: SecHistoryWindow,
  evidenceConcept: boolean,
): boolean {
  return (
    fact.end >=
    (evidenceConcept
      ? window.evidencePeriodsEndingFrom
      : window.periodsEndingFrom)
  );
}

export function applySecHistoryWindow(
  facts: readonly SecReportedFact[],
  isEvidenceConcept: (taxonomy: string, concept: string) => boolean,
): SecHistoryWindowSelection {
  const anchor = resolveSecHistoryAnchor(facts);

  if (anchor === null) {
    return {
      window: null,
      facts: [],
      counts: { points: facts.length, kept: 0, outside: facts.length },
    };
  }

  const window = buildSecHistoryWindow(anchor.anchorOn, anchor.anchorBasis);
  const kept = facts.filter((fact) =>
    isInSecHistoryWindow(
      fact,
      window,
      isEvidenceConcept(fact.taxonomy, fact.concept),
    ),
  );

  return {
    window,
    facts: kept,
    counts: {
      points: facts.length,
      kept: kept.length,
      outside: facts.length - kept.length,
    },
  };
}
