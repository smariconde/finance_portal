import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import {
  divide,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import type {
  MarketPriceComparison,
  MarketPriceComparisonUnavailableReason,
} from "./market-implied";
import type { BridgeItem } from "./valuation-input";
import type { ValuationRun } from "./valuation-run";

/**
 * La brecha de una empresa frente a lo demás que se valuó (`F6-19`,
 * [ADR 0060](../../../../docs/architecture/adr/0060-valuation-peer-context.md)).
 *
 * Separa tres lecturas que la página antes mezclaba en una sola cifra:
 *
 * - **el modelo**: la mediana de precio sobre valor de todas las corridas
 *   registradas en la ventana, de cualquier sector. Si el modelo valúa casi
 *   todo por debajo del mercado, esa mediana lo dice;
 * - **el sector**: la misma mediana entre los pares del sector, y P/E y
 *   EV/EBIT entre ellos;
 * - **la empresa**: su propia proporción frente a la del sector.
 *
 * Los pares son **sólo empresas valuadas** (decisión del owner del
 * 2026-10-27): la muestra crece a medida que se valúa, y por debajo de
 * `PEER_MINIMUM` no hay mediana sino «pares insuficientes» con su `n`. Es una
 * lectura del render: nunca entra al snapshot ni mueve sus hashes, y no es
 * una señal de compra o venta.
 */
export const PEER_CONTEXT_VERSION = "valuation-peer-context-1.0.0";

/**
 * Un par cuenta si su última corrida tiene un `as_of` entre siete días antes
 * del de la empresa y el mismo día (decisión del owner del 2026-10-27).
 */
export const PEER_WINDOW_DAYS = 7;

/** Por debajo de tres pares, una mediana es una anécdota. */
export const PEER_MINIMUM = 3;

/** Los estados con valor por acción; `rejected` no tiene ninguno. */
export const PEER_RUN_STATUSES = ["computed", "requires_review"] as const;

export type PeerMetricNullReason =
  | MarketPriceComparisonUnavailableReason
  /** La serie anual al corte del par no tiene la ganancia neta del año base. */
  | "net_income_not_reported"
  /** Una ganancia cero o negativa no da un P/E que se pueda comparar. */
  | "non_positive_net_income"
  /** La corrida no tiene EBIT ajustado del año base. */
  | "ebit_unavailable"
  | "non_positive_ebit"
  /** Algún reclamo del puente quedó `missing`: el EV no se completa. */
  | "bridge_claim_missing"
  | "non_positive_enterprise_value";

export type PeerMetric =
  | { readonly status: "value"; readonly value: string }
  | { readonly status: "null"; readonly reason: PeerMetricNullReason };

export type PeerMetrics = {
  /** `precio ÷ valor por acción`, al `as_of` de la corrida. */
  readonly priceToValue: PeerMetric;
  /** Capitalización ÷ ganancia neta reportada del año base. */
  readonly priceToEarnings: PeerMetric;
  /**
   * (capitalización + deuda + deuda por arrendamientos + minoritarios − caja)
   * ÷ EBIT ajustado del año base: el mismo EV y el mismo EBIT del modelo.
   */
  readonly enterpriseValueToEbit: PeerMetric;
};

export const PEER_METRIC_KEYS = [
  "priceToValue",
  "priceToEarnings",
  "enterpriseValueToEbit",
] as const satisfies readonly (keyof PeerMetrics)[];

export type PeerMetricKey = (typeof PEER_METRIC_KEYS)[number];

/** La ganancia neta reportada del año base, como la ve la serie al corte. */
export type BaseNetIncome = {
  readonly value: string;
  readonly currency: string | null;
};

type MetricRun = Pick<ValuationRun, "currency" | "input">;

function value(amount: Dec, path: string): PeerMetric {
  return { status: "value", value: formatDecimal(amount, path) };
}

function nullMetric(reason: PeerMetricNullReason): PeerMetric {
  return { status: "null", reason };
}

/**
 * Un reclamo del puente como monto: lo reportado vale lo que dice y lo
 * declarado ausente vale cero, porque tiene su motivo escrito. Lo que quedó
 * `missing` no se completa con nada.
 */
function bridgeAmount(item: BridgeItem, path: string): Dec | null {
  if (item.status === "declared_absent") return ZERO;
  if (item.status === "missing" || item.amount === null) return null;
  return parseDecimal(item.amount.value, path);
}

/**
 * Las tres cifras de una corrida. Todas salen de la comparación con el
 * precio: si el precio no se puede leer contra el valor —sin cierre, un split
 * entre la base de acciones y el cierre, otra moneda—, tampoco se puede armar
 * la capitalización, y las tres llevan el mismo motivo.
 */
export function peerMetrics(input: {
  readonly run: MetricRun;
  readonly comparison: MarketPriceComparison;
  readonly netIncome: BaseNetIncome | null;
}): PeerMetrics {
  const { run, comparison } = input;

  if (comparison.status !== "compared") {
    const missing = nullMetric(comparison.reason);
    return {
      priceToValue: missing,
      priceToEarnings: missing,
      enterpriseValueToEbit: missing,
    };
  }

  const marketCap = parseDecimal(comparison.price.close, "price.close").times(
    parseDecimal(
      run.input.employeeEquity.sharesOutstanding.value,
      "employeeEquity.sharesOutstanding.value",
    ),
  );

  return {
    priceToValue: { status: "value", value: comparison.priceToValue },
    priceToEarnings: priceToEarnings(marketCap, run, input.netIncome),
    enterpriseValueToEbit: enterpriseValueToEbit(marketCap, run),
  };
}

function priceToEarnings(
  marketCap: Dec,
  run: MetricRun,
  netIncome: BaseNetIncome | null,
): PeerMetric {
  if (netIncome === null) return nullMetric("net_income_not_reported");
  if (netIncome.currency !== run.currency) {
    return nullMetric("currency_mismatch");
  }

  const earnings = parseDecimal(netIncome.value, "netIncome");

  if (!earnings.greaterThan(ZERO)) {
    return nullMetric("non_positive_net_income");
  }

  return value(
    divide(marketCap, earnings, "priceToEarnings"),
    "priceToEarnings",
  );
}

function enterpriseValueToEbit(marketCap: Dec, run: MetricRun): PeerMetric {
  const ebitText = run.input.normalization.base.ebitAdjusted;

  if (ebitText === null) return nullMetric("ebit_unavailable");

  const ebit = parseDecimal(ebitText, "normalization.base.ebitAdjusted");

  if (!ebit.greaterThan(ZERO)) return nullMetric("non_positive_ebit");

  const { bridge } = run.input;
  const claims = [
    bridgeAmount(bridge.debt, "bridge.debt"),
    bridgeAmount(bridge.leaseDebt, "bridge.leaseDebt"),
    bridgeAmount(bridge.minorityInterest, "bridge.minorityInterest"),
  ];
  const cash = bridgeAmount(bridge.excessCash, "bridge.excessCash");

  if (cash === null || claims.some((claim) => claim === null)) {
    return nullMetric("bridge_claim_missing");
  }

  const currencies = [
    bridge.debt,
    bridge.leaseDebt,
    bridge.minorityInterest,
    bridge.excessCash,
  ].flatMap((item) => (item.amount === null ? [] : [item.amount.currency]));

  if (currencies.some((currency) => currency !== run.currency)) {
    return nullMetric("currency_mismatch");
  }

  const enterpriseValue = sum([marketCap, ...(claims as Dec[])]).minus(cash);

  if (!enterpriseValue.greaterThan(ZERO)) {
    return nullMetric("non_positive_enterprise_value");
  }

  return value(
    divide(enterpriseValue, ebit, "enterpriseValueToEbit"),
    "enterpriseValueToEbit",
  );
}

/** Un par, como lo muestra la página: identidad, cómo se valuó y sus cifras. */
export type PeerEntry = {
  readonly legalEntityId: string;
  readonly symbol: string | null;
  readonly legalName: string | null;
  /** El sector al corte de la empresa; `null` si no tenía. */
  readonly sector: string | null;
  readonly method: ValuationRun["method"];
  readonly status: ValuationRun["status"];
  readonly asOf: string;
  readonly currency: string;
  readonly metrics: PeerMetrics;
};

export type PeerExclusionReason =
  /** Es la misma empresa: no se compara contra sí misma. */
  | "same_company"
  /** Su corrida cae fuera de la ventana o después del `as_of`. */
  | "outside_window"
  /** Rechazada: no tiene valor por acción. */
  | "rejected_run"
  /** Otra moneda: una mediana no mezcla dólares con otra cosa. */
  | "currency_mismatch";

export type PeerSummary =
  | {
      readonly status: "median";
      readonly value: string;
      readonly n: number;
      /** Cuántos de los `n` quedaron `requires_review`. */
      readonly underReview: number;
      readonly excluded: Readonly<
        Partial<Record<PeerMetricNullReason, number>>
      >;
    }
  | {
      readonly status: "insufficient";
      readonly n: number;
      readonly minimum: number;
      readonly excluded: Readonly<
        Partial<Record<PeerMetricNullReason, number>>
      >;
    };

/** La empresa frente a una mediana: `empresa ÷ mediana − 1`. */
export type PeerRelative =
  | { readonly status: "value"; readonly value: string }
  | {
      readonly status: "null";
      readonly reason: "company_metric_null" | "no_median";
    };

export type SectorContext =
  | {
      readonly status: "classified";
      readonly code: string;
      readonly peers: readonly PeerEntry[];
      readonly summaries: Readonly<Record<PeerMetricKey, PeerSummary>>;
      readonly companyVsSector: Readonly<Record<PeerMetricKey, PeerRelative>>;
    }
  | {
      readonly status: "unclassified";
      readonly reason: "never_classified" | "not_effective_at_cutoff";
    };

export type PeerContext = {
  readonly version: typeof PEER_CONTEXT_VERSION;
  readonly asOf: string;
  readonly windowFrom: string;
  readonly minimum: number;
  readonly company: PeerMetrics;
  /** Precio sobre valor de todo lo valuado en la ventana: el sesgo del modelo. */
  readonly model: PeerSummary;
  readonly sector: SectorContext;
  /** El sector frente al modelo, en precio sobre valor. */
  readonly sectorVsModel: PeerRelative;
  /** Corridas que no entraron, por motivo. */
  readonly excluded: Readonly<Partial<Record<PeerExclusionReason, number>>>;
};

/** El primer día de la ventana: `as_of − 7`. */
export function peerWindowFrom(asOf: string): string {
  return subtractDays(asOf, PEER_WINDOW_DAYS);
}

/** La mediana exacta: con `n` par, el promedio de los dos del medio. */
export function median(values: readonly Dec[]): Dec {
  if (values.length === 0) {
    throw new RangeError("A median needs at least one value.");
  }

  const sorted = [...values].sort((left, right) => left.comparedTo(right));
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
}

export function summarize(
  peers: readonly Pick<PeerEntry, "metrics" | "status">[],
  key: PeerMetricKey,
): PeerSummary {
  const excluded: Partial<Record<PeerMetricNullReason, number>> = {};
  const values: Dec[] = [];
  let underReview = 0;

  for (const peer of peers) {
    const metric = peer.metrics[key];

    if (metric.status === "null") {
      excluded[metric.reason] = (excluded[metric.reason] ?? 0) + 1;
      continue;
    }

    values.push(parseDecimal(metric.value, key));
    if (peer.status === "requires_review") underReview += 1;
  }

  if (values.length < PEER_MINIMUM) {
    return {
      status: "insufficient",
      n: values.length,
      minimum: PEER_MINIMUM,
      excluded,
    };
  }

  return {
    status: "median",
    value: formatDecimal(median(values), `median.${key}`),
    n: values.length,
    underReview,
    excluded,
  };
}

function relative(metric: PeerMetric, summary: PeerSummary): PeerRelative {
  if (metric.status === "null") {
    return { status: "null", reason: "company_metric_null" };
  }

  if (summary.status !== "median")
    return { status: "null", reason: "no_median" };

  const ratio = divide(
    parseDecimal(metric.value, "company"),
    parseDecimal(summary.value, "median"),
    "relative",
  ).minus(1);

  return { status: "value", value: formatDecimal(ratio, "relative") };
}

/**
 * Quién cuenta como par. Una corrida rechazada no tiene valor; una fuera de
 * la ventana tiene otro precio de referencia; una en otra moneda no se
 * promedia con dólares. Cada exclusión se cuenta con su motivo.
 */
export function admitPeers(input: {
  readonly company: Pick<ValuationRun, "asOf" | "currency" | "subject">;
  readonly candidates: readonly PeerEntry[];
}): {
  readonly admitted: readonly PeerEntry[];
  readonly excluded: Readonly<Partial<Record<PeerExclusionReason, number>>>;
} {
  const { company } = input;
  const from = peerWindowFrom(company.asOf);
  const excluded: Partial<Record<PeerExclusionReason, number>> = {};
  const admitted: PeerEntry[] = [];
  const exclude = (reason: PeerExclusionReason) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };

  for (const candidate of input.candidates) {
    if (candidate.legalEntityId === company.subject.legalEntityId) {
      exclude("same_company");
    } else if (candidate.asOf < from || candidate.asOf > company.asOf) {
      exclude("outside_window");
    } else if (candidate.status === "rejected") {
      exclude("rejected_run");
    } else if (candidate.currency !== company.currency) {
      exclude("currency_mismatch");
    } else {
      admitted.push(candidate);
    }
  }

  return { admitted, excluded };
}

function byMetric<T>(
  build: (key: PeerMetricKey) => T,
): Readonly<Record<PeerMetricKey, T>> {
  return {
    priceToValue: build("priceToValue"),
    priceToEarnings: build("priceToEarnings"),
    enterpriseValueToEbit: build("enterpriseValueToEbit"),
  };
}

/**
 * Arma el contexto. `candidates` es la última corrida de cada empresa en la
 * ventana, ya con sus cifras; `sector` es el de la empresa al corte de su
 * corrida, o el motivo por el que no tiene.
 */
export function peerContext(input: {
  readonly company: Pick<ValuationRun, "asOf" | "currency" | "subject">;
  readonly companyMetrics: PeerMetrics;
  readonly sector:
    | { readonly status: "classified"; readonly code: string }
    | {
        readonly status: "unclassified";
        readonly reason: "never_classified" | "not_effective_at_cutoff";
      };
  readonly candidates: readonly PeerEntry[];
}): PeerContext {
  const { admitted, excluded } = admitPeers(input);
  const model = summarize(admitted, "priceToValue");
  let sector: SectorContext;
  let sectorVsModel: PeerRelative = { status: "null", reason: "no_median" };

  if (input.sector.status === "unclassified") {
    sector = input.sector;
  } else {
    const code = input.sector.code;
    const peers = admitted.filter((peer) => peer.sector === code);
    const summaries = byMetric((key) => summarize(peers, key));

    sector = {
      status: "classified",
      code,
      peers,
      summaries,
      companyVsSector: byMetric((key) =>
        relative(input.companyMetrics[key], summaries[key]),
      ),
    };

    const sectorMedian = summaries.priceToValue;
    sectorVsModel =
      sectorMedian.status !== "median"
        ? { status: "null", reason: "no_median" }
        : relative({ status: "value", value: sectorMedian.value }, model);
  }

  return {
    version: PEER_CONTEXT_VERSION,
    asOf: input.company.asOf,
    windowFrom: peerWindowFrom(input.company.asOf),
    minimum: PEER_MINIMUM,
    company: input.companyMetrics,
    model,
    sector,
    sectorVsModel,
    excluded,
  };
}
