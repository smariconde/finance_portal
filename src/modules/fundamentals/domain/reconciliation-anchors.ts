import { z } from "zod";

import {
  createDecimalOperations,
  HUNDRED,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * Anclas de reconciliación del gate de la Fase 2 (`F2-07`).
 *
 * Reconciliar una empresa contra su filing es comparar un puñado de números
 * publicados con lo que dice la presentación. Este módulo elige **cuáles** y
 * calcula lo único que se puede verificar sin abrir el filing: que los números
 * entre sí cierren.
 *
 * Los arquetipos no reportan los mismos conceptos, y eso se midió antes de
 * escribir esto: Apple no publica `us-gaap:Revenues` sino
 * `RevenueFromContractWithCustomer…`, Berkshire no publica EPS diluida,
 * Caterpillar no publica `StockholdersEquity` sino la versión que incluye
 * participaciones no controlantes, y JPMorgan publica `Revenues` siete veces
 * contra cuarenta de Progressive.
 *
 * Por eso cada ancla declara **alternativas en orden**, y el informe dice qué
 * concepto dio el número. Eso es lo contrario de una sustitución silenciosa: la
 * alternativa está escrita, revisada y nombrada en la salida. Un ancla sin
 * ninguna de sus alternativas queda `no reportada`, que es un resultado y no un
 * cero.
 */
export const RECONCILIATION_VERSION = "gate-reconciliation-1.0.0";

export const anchorIdSchema = z.enum([
  "revenue",
  "net_income",
  "net_income_to_common",
  "assets",
  "liabilities",
  "equity",
  "eps_diluted",
  "diluted_shares",
]);

export type AnchorId = z.infer<typeof anchorIdSchema>;

export type AnchorDefinition = {
  readonly anchor: AnchorId;
  /** Período que el ancla habita: el balance es un instante, el resultado un ejercicio. */
  readonly periodType: "instant" | "annual";
  /** Conceptos aceptados, en orden de preferencia. El informe dice cuál se usó. */
  readonly concepts: readonly string[];
};

export const RECONCILIATION_ANCHORS: readonly AnchorDefinition[] =
  Object.freeze([
    {
      anchor: "revenue",
      periodType: "annual",
      concepts: [
        "us-gaap:Revenues",
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      ],
    },
    {
      anchor: "net_income",
      periodType: "annual",
      concepts: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss"],
    },
    {
      // El numerador de la EPS, que no es el resultado: la 3.0.0 de la
      // selección lo agregó después de que este mismo chequeo midiera residuos
      // que no se podían explicar con lo guardado.
      anchor: "net_income_to_common",
      periodType: "annual",
      concepts: [
        "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted",
        "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
      ],
    },
    { anchor: "assets", periodType: "instant", concepts: ["us-gaap:Assets"] },
    {
      anchor: "liabilities",
      periodType: "instant",
      concepts: ["us-gaap:Liabilities"],
    },
    {
      anchor: "equity",
      periodType: "instant",
      concepts: [
        "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        "us-gaap:StockholdersEquity",
      ],
    },
    {
      anchor: "eps_diluted",
      periodType: "annual",
      concepts: [
        "us-gaap:EarningsPerShareDiluted",
        "us-gaap:IncomeLossFromContinuingOperationsPerDilutedShare",
      ],
    },
    {
      anchor: "diluted_shares",
      periodType: "annual",
      concepts: [
        "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
        "us-gaap:WeightedAverageNumberOfDilutedSharesOutstandingAdjustment",
      ],
    },
  ]);

/**
 * La reconciliación falla con su propio error, con los mismos códigos de la
 * política numérica: una división por cero acá es un fallo de policy y no un
 * residuo que se pueda informar.
 */
export class ReconciliationError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

const { parseDecimal, divide, toFixedScale } = createDecimalOperations(
  (code, message, subjects) => new ReconciliationError(code, message, subjects),
);

/**
 * Escala del residuo. Más allá de cuatro decimales un porcentaje de residuo es
 * ruido de la división, no información sobre el filing.
 */
export const RESIDUAL_SCALE = 4;

/** Lo que el informe encontró para un ancla. `concept` nulo es «no reportada». */
export type AnchorReading = {
  readonly anchor: AnchorId;
  readonly concept: string | null;
  readonly value: string | null;
  readonly unit: string | null;
  readonly currency: string | null;
  readonly asOf: string | null;
  readonly sourceDocumentId: string | null;
  readonly availableAt: string | null;
};

export function isReported(reading: AnchorReading): boolean {
  return reading.concept !== null && reading.value !== null;
}

export const coherenceCheckSchema = z.enum([
  /** Activo contra pasivo más patrimonio. */
  "balance_sheet",
  /** Resultado contra EPS diluida por acciones diluidas. */
  "earnings_per_share",
]);

export type CoherenceCheckId = z.infer<typeof coherenceCheckSchema>;

/**
 * Un residuo **no es** una falla por sí mismo: el patrimonio sin participaciones
 * no controlantes deja un resto legítimo, y la EPS diluida no se calcula sobre
 * `NetIncomeLoss` sino sobre un numerador ajustado. Lo que el residuo detecta es
 * el error de escala o de unidad, que es de órdenes de magnitud y no de puntos
 * porcentuales.
 *
 * El residuo lleva **signo**, y el signo dice qué ajuste domina: negativo cuando
 * el numerador de la EPS es menor que el resultado —dividendos preferidos, como
 * en Duke y JPMorgan—, positivo cuando es mayor —intereses de convertibles
 * readicionados o unidades de la sociedad operativa de un REIT, como en Carnival
 * y Prologis—. Tomar el valor absoluto borraría justamente esa distinción.
 */
export const COHERENCE_TOLERANCE_PCT = "1";

export type CoherenceStatus = "ok" | "residual" | "not_evaluable";

export type CoherenceResult = {
  readonly check: CoherenceCheckId;
  readonly status: CoherenceStatus;
  /**
   * Residuo sobre la referencia, en porcentaje y **con signo**. Nulo si no se
   * pudo evaluar.
   */
  readonly residualPct: string | null;
  /** Qué faltó, cuando no se pudo evaluar. */
  readonly missing: readonly AnchorId[];
  /**
   * Qué ancla aportó el numerador. Un emisor que publica el numerador de la EPS
   * se compara contra él; uno que no, contra el resultado, y entonces el residuo
   * carga los ajustes que separan a los dos. Decir cuál se usó es lo que hace
   * legible al residuo.
   */
  readonly numeratorAnchor?: AnchorId;
};

function readingOf(
  readings: readonly AnchorReading[],
  anchor: AnchorId,
): AnchorReading | null {
  const found = readings.find((reading) => reading.anchor === anchor);

  return found !== undefined && isReported(found) ? found : null;
}

function residualPct(expected: Dec, actual: Dec, path: string): string | null {
  if (expected.isZero()) {
    // Sin referencia no hay porcentaje: decirlo es más honesto que dividir por cero.
    return null;
  }

  const ratio = divide(actual.minus(expected), expected.abs(), path);

  return toFixedScale(ratio.times(HUNDRED), RESIDUAL_SCALE, path);
}

/** La tolerancia se aplica a la magnitud; el signo se conserva para leerlo. */
function withinTolerance(pct: string): boolean {
  return parseDecimal(pct, "residual")
    .abs()
    .lessThanOrEqualTo(parseDecimal(COHERENCE_TOLERANCE_PCT, "tolerance"));
}

/**
 * Coherencia interna de las anclas. No abre el filing: comprueba que los
 * números publicados cierren entre sí, que es lo que se rompe cuando una unidad,
 * un signo o una escala se perdieron en la ingesta.
 *
 * Un ancla ausente deja el chequeo `not_evaluable`, nunca `ok`: no evaluar algo
 * no es haberlo verificado.
 */
export function checkCoherence(
  readings: readonly AnchorReading[],
): readonly CoherenceResult[] {
  const results: CoherenceResult[] = [];

  const assets = readingOf(readings, "assets");
  const liabilities = readingOf(readings, "liabilities");
  const equity = readingOf(readings, "equity");

  if (assets === null || liabilities === null || equity === null) {
    results.push({
      check: "balance_sheet",
      status: "not_evaluable",
      residualPct: null,
      missing: (
        [
          ["assets", assets],
          ["liabilities", liabilities],
          ["equity", equity],
        ] as const
      )
        .filter(([, reading]) => reading === null)
        .map(([anchor]) => anchor),
    });
  } else {
    const total = parseDecimal(liabilities.value!, "liabilities").plus(
      parseDecimal(equity.value!, "equity"),
    );
    const pct = residualPct(
      parseDecimal(assets.value!, "assets"),
      total,
      "balance_sheet",
    );

    results.push({
      check: "balance_sheet",
      status:
        pct === null
          ? "not_evaluable"
          : withinTolerance(pct)
            ? "ok"
            : "residual",
      residualPct: pct,
      missing: [],
    });
  }

  // El numerador propio de la EPS gana al resultado cuando el emisor lo publica.
  const toCommon = readingOf(readings, "net_income_to_common");
  const netIncome = toCommon ?? readingOf(readings, "net_income");
  const numeratorAnchor: AnchorId =
    toCommon === null ? "net_income" : "net_income_to_common";
  const eps = readingOf(readings, "eps_diluted");
  const shares = readingOf(readings, "diluted_shares");

  if (netIncome === null || eps === null || shares === null) {
    results.push({
      check: "earnings_per_share",
      status: "not_evaluable",
      residualPct: null,
      missing: (
        [
          ["net_income", netIncome],
          ["eps_diluted", eps],
          ["diluted_shares", shares],
        ] as const
      )
        .filter(([, reading]) => reading === null)
        .map(([anchor]) => anchor),
    });
  } else {
    const implied = parseDecimal(eps.value!, "eps_diluted").times(
      parseDecimal(shares.value!, "diluted_shares"),
    );
    const pct = residualPct(
      parseDecimal(netIncome.value!, numeratorAnchor),
      implied,
      "earnings_per_share",
    );

    results.push({
      check: "earnings_per_share",
      status:
        pct === null
          ? "not_evaluable"
          : withinTolerance(pct)
            ? "ok"
            : "residual",
      residualPct: pct,
      missing: [],
      numeratorAnchor,
    });
  }

  return results;
}

/**
 * Cierre del ejercicio contra el que se reconcilia, entre las anclas del linaje.
 *
 * Dos cosas que parecen detalles y no lo son. Un período de 365 días **no es**
 * un ejercicio: Amazon publica cifras de doce meses móviles que terminan en cada
 * cierre de trimestre, así que el ejercicio sale del ancla que registró la
 * ingesta (`fp = FY`, ADR 0017) y no de buscar el período anual más reciente.
 *
 * Y el ancla se busca a lo largo del **linaje**: un sucesor recién constituido
 * todavía no cerró un ejercicio —el de ExxonMobil se registró en julio de 2026 y
 * su única presentación es un 10-Q—, y reconciliarlo contra su propio cierre de
 * trimestre diría que no hay resultado cuando el ejercicio del grupo sí está en
 * la base, del lado del antecesor (ADR 0011).
 *
 * Se elige el ancla más reciente en la que el linaje efectivamente publicó
 * anclas anuales. Sin ninguna, `null`: no se inventa una fecha.
 */
export function selectFiscalYearEnd(
  lineageAnchors: readonly string[],
  publishedAnnualPeriodEnds: readonly string[],
): string | null {
  const published = new Set(publishedAnnualPeriodEnds);

  return (
    [...new Set(lineageAnchors)]
      .sort()
      .reverse()
      .find((anchor) => published.has(anchor)) ?? null
  );
}

/** URL pública del filing que publicó un ancla, para abrirlo y comparar. */
export function edgarFilingUrl(cik: string, sourceDocumentId: string): string {
  const accession = sourceDocumentId.replace(/-/gu, "");

  return `https://www.sec.gov/Archives/edgar/data/${Number.parseInt(cik, 10)}/${accession}/${sourceDocumentId}-index.htm`;
}
