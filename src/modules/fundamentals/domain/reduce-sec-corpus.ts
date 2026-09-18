import {
  isSelectedSecConcept,
  isSplitEvidenceConcept,
} from "./sec-concept-selection";
import { subtractCalendarYears } from "./sec-history-window";

/**
 * Reducción de un extracto de la SEC a lo que el oráculo de regresión necesita.
 *
 * companyfacts de un filer grande son decenas de megabytes y el repositorio es
 * público: congelarlo entero sería un data lake commiteado. Pero recortar tiene un
 * riesgo propio, y es el que manda sobre el diseño de esta pieza.
 *
 * **El reductor no puede ser la selección de la ingesta.** Si el archivo quedara
 * con exactamente los conceptos y los períodos que la selección elige, un test que
 * afirma «el parser se queda con estos y descarta aquéllos» sería una tautología:
 * no habría en el archivo nada que descartar. Por eso el reductor es a propósito
 * **más grueso** que lo que prueba:
 *
 * - guarda la selección **y además** una muestra fija de conceptos que la
 *   selección no incluye, elegidos entre los que casi todos los filers reportan,
 *   con dos casi-aciertos —`CommonStockSharesIssued` contra el `…Outstanding` que
 *   sí está— y el primer concepto de cada taxonomía que no es `us-gaap` ni `dei`;
 * - corta por fecha con una ventana de ocho ejercicios contra los cinco más uno de
 *   la ADR 0017, y la ancla en el período más reciente que el filer reportó —no en
 *   su último cierre anual—, que es justo la distinción que la ventana decide.
 *
 * Así el archivo llega al test con conceptos que sobran y con períodos que la
 * ventana tiene que cortar, y el test mide trabajo real.
 *
 * Lo único que se tira sin reemplazo son `label` y `description` de cada concepto:
 * son prosa de la taxonomía, ningún parser los lee, y pesan más que los hechos.
 */
export const SEC_CORPUS_REDUCER_VERSION = "sec-corpus-reducer-1.0.0";

/** Ejercicios que conserva el corpus: más que la ventana, para que corte algo. */
export const CORPUS_HISTORY_YEARS = 8;

/**
 * Conceptos que la selección **no** incluye y el corpus conserva igual, para que
 * «no seleccionado» siga siendo un caso con datos y no una ausencia.
 */
export const CORPUS_UNSELECTED_CONCEPTS: readonly string[] = Object.freeze([
  // Casi-aciertos: se parecen a uno seleccionado y no lo son.
  "us-gaap:CommonStockSharesIssued",
  "us-gaap:LongTermDebtFairValue",
  // Balance corriente que casi todo filer industrial reporta.
  "us-gaap:AccountsPayableCurrent",
  "us-gaap:AccountsReceivableNetCurrent",
  "us-gaap:InventoryNet",
  "us-gaap:RetainedEarningsAccumulatedDeficit",
  // Un flujo que la metodología mira recién en Fase 4.
  "us-gaap:IncomeTaxesPaidNet",
]);

const UNSELECTED = new Set(CORPUS_UNSELECTED_CONCEPTS);

const KNOWN_TAXONOMIES: ReadonlySet<string> = new Set(["us-gaap", "dei"]);

/**
 * Formularios de alto volumen que el corpus no conserva.
 *
 * Es una **lista negra**, no una blanca, y a propósito: un oráculo tiene que
 * dejar pasar lo que no esperábamos, así que se nombra lo que sobra en vez de
 * enumerar lo que sirve. Lo que sobra son las presentaciones que ningún parser de
 * este proyecto lee y que dominan el índice —medido el 2026-09-18, de las 1.000
 * presentaciones recientes de Apple la enorme mayoría son Form 4 de directivos—.
 * Los 10-K, 10-Q, 8-K, los `25`/`8-A12B`/`CERT` de la ADR 0013 y cualquier
 * formulario raro siguen enteros.
 *
 * Los nombres cortos se comparan **exactos** —con su enmienda `/A`— y nunca por
 * prefijo: `4` como prefijo se llevaría puesto el `40-F`, que es el reporte anual
 * de un foreign filer y justamente uno de los casos que el corpus tiene que
 * conservar.
 */
/** Claves de un concepto que el corpus no conserva. */
const DROPPED_CONCEPT_KEYS: ReadonlySet<string> = new Set([
  "label",
  "description",
]);

export const CORPUS_DROPPED_FORMS: readonly string[] = Object.freeze([
  // Titularidad de directivos: el grueso del índice de cualquier filer grande.
  "3",
  "4",
  "5",
  "144",
]);

/** Familias enteras que sí se comparan por prefijo. */
export const CORPUS_DROPPED_FORM_PREFIXES: readonly string[] = Object.freeze([
  // Prospectos y material de oferta.
  "424",
  "FWP",
  // Participaciones de terceros y proxy de terceros.
  "SC 13",
  "SC 14",
  "PX14A",
  "13F",
]);

const DROPPED_FORMS = new Set(
  CORPUS_DROPPED_FORMS.flatMap((form) => [form, `${form}/A`]),
);

function isDroppedForm(form: unknown): boolean {
  if (typeof form !== "string") {
    return false;
  }

  return (
    DROPPED_FORMS.has(form) ||
    CORPUS_DROPPED_FORM_PREFIXES.some((prefix) => form.startsWith(prefix))
  );
}

export class SecCorpusReductionError extends Error {
  constructor(
    readonly code:
      | "payload_not_an_object"
      | "facts_missing"
      | "no_dated_points"
      | "recent_columns_ragged"
      | "filings_missing",
    detail?: string,
  ) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "SecCorpusReductionError";
  }
}

export type SecCorpusCounts = {
  readonly conceptsKept: number;
  readonly conceptsDropped: number;
  readonly pointsKept: number;
  readonly pointsDropped: number;
};

export type SecCorpusReduction = {
  /** Listo para `stringifyJsonPreservingNumbers`. */
  readonly document: unknown;
  /** Fecha desde la que el corpus conserva datos, inclusive. */
  readonly floorOn: string;
  /** El período más reciente que el documento trae, del que sale el piso. */
  readonly anchorOn: string;
  readonly counts: SecCorpusCounts;
};

function asRecord(value: unknown, code: "payload_not_an_object"): RecordLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SecCorpusReductionError(code);
  }

  return value as RecordLike;
}

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keepConcept(
  taxonomy: string,
  concept: string,
  isFirstOfUnknownTaxonomy: boolean,
): boolean {
  return (
    isSelectedSecConcept(taxonomy, concept) ||
    isSplitEvidenceConcept(taxonomy, concept) ||
    UNSELECTED.has(`${taxonomy}:${concept}`) ||
    isFirstOfUnknownTaxonomy
  );
}

function latestEnd(facts: RecordLike): string | null {
  let latest: string | null = null;

  for (const concepts of Object.values(facts)) {
    if (!isRecord(concepts)) {
      continue;
    }

    for (const concept of Object.values(concepts)) {
      if (!isRecord(concept) || !isRecord(concept.units)) {
        continue;
      }

      for (const points of Object.values(concept.units)) {
        if (!Array.isArray(points)) {
          continue;
        }

        for (const point of points) {
          const end = isRecord(point) ? point.end : undefined;

          if (typeof end === "string" && (latest === null || end > latest)) {
            latest = end;
          }
        }
      }
    }
  }

  return latest;
}

/**
 * Reduce companyfacts. El piso sale del documento mismo —el período más reciente
 * que trae— y no del reloj: congelar el mismo extracto dos veces da el mismo
 * archivo aunque pasen meses.
 */
export function reduceSecCompanyFacts(payload: unknown): SecCorpusReduction {
  const root = asRecord(payload, "payload_not_an_object");
  const facts = root.facts;

  if (!isRecord(facts)) {
    throw new SecCorpusReductionError("facts_missing");
  }

  const anchorOn = latestEnd(facts);

  if (anchorOn === null) {
    throw new SecCorpusReductionError("no_dated_points");
  }

  const floorOn = subtractCalendarYears(anchorOn, CORPUS_HISTORY_YEARS);
  const counts = {
    conceptsKept: 0,
    conceptsDropped: 0,
    pointsKept: 0,
    pointsDropped: 0,
  };

  const reducedFacts: RecordLike = {};

  for (const [taxonomy, concepts] of Object.entries(facts)) {
    if (!isRecord(concepts)) {
      continue;
    }

    const unknownTaxonomy = !KNOWN_TAXONOMIES.has(taxonomy);
    const reducedConcepts: RecordLike = {};
    let firstOfUnknownTaken = false;

    for (const [concept, body] of Object.entries(concepts)) {
      const isFirstOfUnknownTaxonomy = unknownTaxonomy && !firstOfUnknownTaken;

      if (!keepConcept(taxonomy, concept, isFirstOfUnknownTaxonomy)) {
        counts.conceptsDropped += 1;
        continue;
      }

      if (!isRecord(body)) {
        continue;
      }

      const reducedBody: RecordLike = {};

      for (const [key, value] of Object.entries(body)) {
        if (DROPPED_CONCEPT_KEYS.has(key)) {
          continue;
        }

        if (key !== "units" || !isRecord(value)) {
          reducedBody[key] = value;
          continue;
        }

        const reducedUnits: RecordLike = {};

        for (const [unit, points] of Object.entries(value)) {
          if (!Array.isArray(points)) {
            reducedUnits[unit] = points;
            continue;
          }

          const kept = points.filter((point) => {
            const end = isRecord(point) ? point.end : undefined;

            return typeof end === "string" && end >= floorOn;
          });

          counts.pointsKept += kept.length;
          counts.pointsDropped += points.length - kept.length;

          // Una unidad que se quedó sin puntos no se escribe vacía: el corpus no
          // inventa la afirmación «el filer reporta esto en esta unidad».
          if (kept.length > 0) {
            reducedUnits[unit] = kept;
          }
        }

        if (Object.keys(reducedUnits).length > 0) {
          reducedBody[key] = reducedUnits;
        }
      }

      if (reducedBody.units === undefined) {
        counts.conceptsDropped += 1;
        continue;
      }

      counts.conceptsKept += 1;
      reducedConcepts[concept] = reducedBody;

      // Recién acá: si el primer concepto de una taxonomía desconocida se queda
      // sin puntos en la ventana, el lugar sigue libre para el siguiente. Marcarlo
      // antes dejaría el corpus sin ningún caso de taxonomía desconocida.
      if (isFirstOfUnknownTaxonomy) {
        firstOfUnknownTaken = true;
      }
    }

    if (Object.keys(reducedConcepts).length > 0) {
      reducedFacts[taxonomy] = reducedConcepts;
    }
  }

  const document: RecordLike = {};

  for (const [key, value] of Object.entries(root)) {
    document[key] = key === "facts" ? reducedFacts : value;
  }

  return { document, floorOn, anchorOn, counts };
}

export type SecSubmissionsCorpusCounts = {
  readonly filingsKept: number;
  readonly filingsDropped: number;
};

export type SecSubmissionsReduction = {
  readonly document: unknown;
  readonly floorOn: string;
  readonly anchorOn: string;
  readonly counts: SecSubmissionsCorpusCounts;
};

/**
 * Reduce submissions. `filings.recent` son columnas paralelas, así que recortar
 * es elegir **índices** y aplicarlos a todas: una columna que quedara con otro
 * largo desalinearía cada presentación con la fecha de la siguiente, que es
 * exactamente el defecto que un oráculo tiene que hacer imposible.
 *
 * `filings.files` se conserva entero: es el índice que decide qué archivos
 * históricos pediría una corrida, pesa poco, y recortarlo cambiaría esa decisión.
 */
export function reduceSecSubmissions(
  payload: unknown,
): SecSubmissionsReduction {
  const root = asRecord(payload, "payload_not_an_object");
  const filings = root.filings;

  if (!isRecord(filings) || !isRecord(filings.recent)) {
    throw new SecCorpusReductionError("filings_missing");
  }

  const recent = filings.recent;
  const columns = Object.entries(recent).filter(
    (entry): entry is [string, unknown[]] => Array.isArray(entry[1]),
  );
  const lengths = new Set(columns.map(([, values]) => values.length));

  if (lengths.size > 1) {
    throw new SecCorpusReductionError(
      "recent_columns_ragged",
      [...lengths].join("/"),
    );
  }

  const dates = recent.filingDate;

  if (!Array.isArray(dates)) {
    throw new SecCorpusReductionError("filings_missing", "filingDate");
  }

  const anchorOn = dates.reduce<string | null>(
    (latest, date) =>
      typeof date === "string" && (latest === null || date > latest)
        ? date
        : latest,
    null,
  );

  if (anchorOn === null) {
    throw new SecCorpusReductionError("no_dated_points", "filingDate");
  }

  const floorOn = subtractCalendarYears(anchorOn, CORPUS_HISTORY_YEARS);
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const keptIndices = dates.flatMap((date, index) =>
    typeof date === "string" && date >= floorOn && !isDroppedForm(forms[index])
      ? [index]
      : [],
  );
  const keptSet = new Set(keptIndices);

  const reducedRecent: RecordLike = {};

  for (const [key, value] of Object.entries(recent)) {
    reducedRecent[key] = Array.isArray(value)
      ? value.filter((_item, index) => keptSet.has(index))
      : value;
  }

  const reducedFilings: RecordLike = {};

  for (const [key, value] of Object.entries(filings)) {
    reducedFilings[key] = key === "recent" ? reducedRecent : value;
  }

  const document: RecordLike = {};

  for (const [key, value] of Object.entries(root)) {
    document[key] = key === "filings" ? reducedFilings : value;
  }

  return {
    document,
    floorOn,
    anchorOn,
    counts: {
      filingsKept: keptIndices.length,
      filingsDropped: dates.length - keptIndices.length,
    },
  };
}
