import type { SecFiling } from "./parse-sec-submissions";

/**
 * Si un filer tiene algo nuevo que bajar (ADR 0021, incremento 4 de `F2-05`).
 *
 * El refresh pregunta una sola cosa por vuelta y por filer: ¿apareció en
 * `submissions` una presentación relevante posterior a la última que este sondeo
 * vio? Sólo entonces se baja companyfacts. La comparación es contra la **marca
 * de agua** que dejó el sondeo anterior, no contra lo publicado: una
 * presentación relevante que no aporta ningún hecho seleccionado igual mueve la
 * marca, y por eso dos vueltas seguidas sin novedades cuestan un request cada
 * una en lugar de repetir la descarga para siempre.
 *
 * La marca es el par `(aceptación, accession)` de la presentación relevante más
 * nueva del índice. El par y no el instante solo: dos presentaciones del mismo
 * filer pueden compartir el segundo, y comparar por tupla no deja a ninguna del
 * lado viejo.
 */
export const SEC_REFRESH_PROBE_VERSION = "sec-refresh-probe-1.0.0";

/**
 * Formularios que pueden publicar hechos XBRL de empresa.
 *
 * Es una selección declarada, igual que la de conceptos: lo que no está acá no
 * despierta una descarga. Sin ella cualquier Form 4 —Apple presenta varios por
 * semana— haría que el filer «cambió» en cada vuelta, que es exactamente lo que
 * el incremento evita. Medido el 2026-09-18 sobre la base personal, los
 * formularios que efectivamente produjeron hechos publicados son `10-K`, `10-Q`,
 * `10-K/A` y `8-K`, todos dentro de esta lista.
 *
 * Coincide hoy con los formularios cuya fecha de filing acota la disponibilidad
 * (`sec-fact-rules.ts`), pero se declara aparte: una lista contesta «qué puede
 * traer hechos» y la otra «para qué formulario la fecha de filing es una cota
 * defendible». Cambiar una no debería cambiar la otra en silencio.
 */
export const COMPANY_FACTS_FORM_SELECTION_VERSION =
  "sec-companyfacts-forms-1.0.0";

export const COMPANY_FACTS_FORMS: ReadonlySet<string> = new Set(
  ["10-K", "10-Q", "10-KT", "10-QT", "8-K", "20-F", "40-F", "6-K"].flatMap(
    (form) => [form, `${form}/A`],
  ),
);

export type FilerRefreshWatermark = {
  readonly acceptedAt: string;
  readonly accessionNumber: string;
  readonly formSelectionVersion: string;
};

export type FilerRefreshReason =
  /** Nunca se sondeó: se baja una vez y la marca queda escrita. */
  | "never_probed"
  /** Hay al menos una presentación relevante posterior a la marca. */
  | "new_filing"
  /** La lista de formularios cambió: lo que la marca dice ya no es comparable. */
  | "form_selection_superseded"
  /** La marca sigue siendo la presentación relevante más nueva. */
  | "up_to_date"
  /** El índice no trae ninguna presentación relevante con aceptación. */
  | "no_relevant_filings";

export type FilerRefreshDecision = {
  readonly probeVersion: string;
  readonly formSelectionVersion: string;
  readonly reason: FilerRefreshReason;
  /** Si corresponde bajar companyfacts en esta vuelta. */
  readonly refresh: boolean;
  /** Marca que deja este sondeo; `null` cuando no hay nada comparable. */
  readonly observed: FilerRefreshWatermark | null;
  /** Presentaciones relevantes que trae el índice, con y sin aceptación. */
  readonly relevant: number;
  /** Relevantes posteriores a la marca anterior, de la más vieja a la más nueva. */
  readonly newFilings: readonly SecFiling[];
  /**
   * Relevantes que el índice publica sin instante de aceptación. No se comparan
   * —no hay con qué— y se cuentan para que la omisión no sea silenciosa. En las
   * presentaciones recientes, que son las que el refresh mira, no aparecen.
   */
  readonly withoutAcceptance: number;
};

type AcceptedFiling = SecFiling & { readonly acceptedAt: string };

/**
 * Orden total de las presentaciones relevantes: el instante y, a igual instante,
 * el accession. Las aceptaciones son ISO canónicas (`toISOString`), así que
 * compararlas como texto es compararlas como instantes.
 */
function compareMarks(
  left: FilerRefreshWatermark,
  right: FilerRefreshWatermark,
): number {
  return (
    left.acceptedAt.localeCompare(right.acceptedAt) ||
    left.accessionNumber.localeCompare(right.accessionNumber)
  );
}

const isAfter = (left: FilerRefreshWatermark, right: FilerRefreshWatermark) =>
  compareMarks(left, right) > 0;

export function decideFilerRefresh(input: {
  readonly filings: readonly SecFiling[];
  readonly watermark: FilerRefreshWatermark | null;
}): FilerRefreshDecision {
  const relevant = input.filings.filter((filing) =>
    COMPANY_FACTS_FORMS.has(filing.form),
  );
  const accepted = relevant.filter(
    (filing): filing is AcceptedFiling => filing.acceptedAt !== null,
  );
  const withoutAcceptance = relevant.length - accepted.length;
  const marks = accepted
    .map((filing) => ({
      filing,
      mark: {
        acceptedAt: filing.acceptedAt,
        accessionNumber: filing.accessionNumber,
        formSelectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
      },
    }))
    .sort((left, right) => compareMarks(left.mark, right.mark));
  const newest = marks.at(-1) ?? null;
  const base = {
    probeVersion: SEC_REFRESH_PROBE_VERSION,
    formSelectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
    relevant: relevant.length,
    withoutAcceptance,
  };

  if (newest === null) {
    return {
      ...base,
      reason: "no_relevant_filings",
      refresh: false,
      observed: null,
      newFilings: [],
    };
  }

  const { watermark } = input;

  if (watermark === null) {
    return {
      ...base,
      reason: "never_probed",
      refresh: true,
      observed: newest.mark,
      newFilings: marks.map(({ filing }) => filing),
    };
  }

  if (watermark.formSelectionVersion !== COMPANY_FACTS_FORM_SELECTION_VERSION) {
    return {
      ...base,
      reason: "form_selection_superseded",
      refresh: true,
      observed: newest.mark,
      newFilings: marks.map(({ filing }) => filing),
    };
  }

  const newFilings = marks
    .filter(({ mark }) => isAfter(mark, watermark))
    .map(({ filing }) => filing);

  return newFilings.length === 0
    ? {
        ...base,
        reason: "up_to_date",
        refresh: false,
        observed: newest.mark,
        newFilings: [],
      }
    : {
        ...base,
        reason: "new_filing",
        refresh: true,
        observed: newest.mark,
        newFilings,
      };
}
