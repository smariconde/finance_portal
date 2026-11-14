import { z } from "zod";

import {
  exactDecimalSchema,
  exactIntegerSchema,
  failure,
  issuePath,
  readExactJson,
  type SchwabParseResult,
} from "./schwab-exact";

/**
 * Parser cerrado de la cuenta Schwab (`schwab-account-1.0.0`, ADR 0076, `F11-04`).
 *
 * Medido con la cuenta real el 2026-11-13: una sola cuenta, tipo `CASH`, sin
 * posiciones —la clave `positions` no viene— y sin órdenes en 60 días. Lo que se
 * midió se declara exacto: un saldo nuevo o uno que falta rechaza la lectura
 * (`TM-05`). Lo que no se pudo medir sigue el schema publicado de la Trader API y
 * queda marcado así hasta que aparezca en la cuenta:
 *
 * - posiciones y órdenes: claves del schema publicado, también cerradas;
 * - una cuenta `MARGIN` no se lee: sus saldos no se midieron, y adivinar cuál es
 *   el poder de compra sería peor que decir que falta (decisión del owner).
 *
 * Ningún valor del cable sale de acá en un error: sólo códigos y caminos de
 * claves. El número de cuenta completo tampoco sale: la vista lleva los últimos
 * cuatro dígitos.
 */
export const SCHWAB_ACCOUNT_PARSER_VERSION = "schwab-account-1.0.0";

const decimal = exactDecimalSchema;
const optionalDecimal = exactDecimalSchema.optional();

const accountNumbersSchema = z
  .array(
    z
      .object({
        accountNumber: z.string().regex(/^\d{4,16}$/u),
        hashValue: z.string().regex(/^[A-F0-9]{64}$/iu),
      })
      .strict(),
  )
  .max(16);

export type SchwabAccountNumber = {
  /** Sólo vive en memoria: nunca se guarda ni sale al cliente. */
  readonly accountNumber: string;
  readonly hashValue: string;
};

export function parseSchwabAccountNumbers(
  body: Uint8Array,
): SchwabParseResult<readonly SchwabAccountNumber[]> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");
  const parsed = accountNumbersSchema.safeParse(json);
  if (!parsed.success) {
    return failure("account_numbers_schema_changed", issuePath(parsed.error));
  }
  return { ok: true, value: parsed.data };
}

/** Saldos de una cuenta `CASH`, tal como se midieron. */
const initialBalancesSchema = z
  .object({
    accruedInterest: decimal,
    cashAvailableForTrading: decimal,
    cashAvailableForWithdrawal: decimal,
    cashBalance: decimal,
    bondValue: decimal,
    cashReceipts: decimal,
    liquidationValue: decimal,
    longOptionMarketValue: decimal,
    longStockValue: decimal,
    moneyMarketFund: decimal,
    mutualFundValue: decimal,
    shortOptionMarketValue: decimal,
    shortStockValue: decimal,
    isInCall: z.boolean(),
    unsettledCash: decimal,
    cashDebitCallValue: decimal,
    pendingDeposits: decimal,
    accountValue: decimal,
  })
  .strict();

const currentBalancesSchema = z
  .object({
    accruedInterest: decimal,
    cashBalance: decimal,
    cashReceipts: decimal,
    longOptionMarketValue: decimal,
    liquidationValue: decimal,
    longMarketValue: decimal,
    moneyMarketFund: decimal,
    savings: decimal,
    shortMarketValue: decimal,
    pendingDeposits: decimal,
    mutualFundValue: decimal,
    bondValue: decimal,
    shortOptionMarketValue: decimal,
    cashAvailableForTrading: decimal,
    cashAvailableForWithdrawal: decimal,
    cashCall: decimal,
    longNonMarginableMarketValue: decimal,
    totalCash: decimal,
    cashDebitCallValue: decimal,
    unsettledCash: decimal,
  })
  .strict();

const projectedBalancesSchema = z
  .object({
    cashAvailableForTrading: decimal,
    cashAvailableForWithdrawal: decimal,
  })
  .strict();

const aggregatedBalanceSchema = z
  .object({
    currentLiquidationValue: decimal,
    liquidationValue: decimal,
    intradayBuyingPowerAmount: decimal,
    currentIntradayBuyingPowerAmount: decimal,
  })
  .strict();

export const SCHWAB_ASSET_TYPES = [
  "EQUITY",
  "OPTION",
  "INDEX",
  "MUTUAL_FUND",
  "CASH_EQUIVALENT",
  "FIXED_INCOME",
  "CURRENCY",
  "COLLECTIVE_INVESTMENT",
] as const;

export type SchwabAssetType = (typeof SCHWAB_ASSET_TYPES)[number];

/**
 * El instrumento de una posición o de una pata de orden: la unión de las
 * variantes publicadas por tipo de activo más lo que trajo el cable real. El
 * 2026-11-14, doce órdenes reales trajeron `uniformSymbol`, que el schema
 * publicado no tenía y que habría puesto en cuarentena la primera orden abierta.
 */
const instrumentSchema = z
  .object({
    assetType: z.enum(SCHWAB_ASSET_TYPES),
    symbol: z.string().min(1).max(64),
    uniformSymbol: z.string().max(64).optional(),
    cusip: z.string().max(16).optional(),
    description: z.string().max(256).optional(),
    instrumentId: exactIntegerSchema.optional(),
    netChange: optionalDecimal,
    type: z.string().max(64).optional(),
    putCall: z.enum(["PUT", "CALL", "UNKNOWN"]).optional(),
    underlyingSymbol: z.string().max(64).optional(),
    optionMultiplier: optionalDecimal,
    optionDeliverables: z.array(z.unknown()).optional(),
    maturityDate: z.string().max(40).optional(),
    factor: optionalDecimal,
    variableRate: optionalDecimal,
  })
  .strict();

/** Una posición según el schema publicado (sin medir: la cuenta no tenía). */
const positionSchema = z
  .object({
    shortQuantity: decimal,
    longQuantity: decimal,
    averagePrice: decimal,
    marketValue: decimal,
    instrument: instrumentSchema,
    currentDayProfitLoss: optionalDecimal,
    currentDayProfitLossPercentage: optionalDecimal,
    settledLongQuantity: optionalDecimal,
    settledShortQuantity: optionalDecimal,
    agedQuantity: optionalDecimal,
    maintenanceRequirement: optionalDecimal,
    averageLongPrice: optionalDecimal,
    averageShortPrice: optionalDecimal,
    taxLotAverageLongPrice: optionalDecimal,
    taxLotAverageShortPrice: optionalDecimal,
    longOpenProfitLoss: optionalDecimal,
    shortOpenProfitLoss: optionalDecimal,
    previousSessionLongQuantity: optionalDecimal,
    previousSessionShortQuantity: optionalDecimal,
    currentDayCost: optionalDecimal,
  })
  .strict();

const cashAccountSchema = z
  .object({
    securitiesAccount: z
      .object({
        type: z.literal("CASH"),
        accountNumber: z.string().regex(/^\d{4,16}$/u),
        roundTrips: exactIntegerSchema,
        isDayTrader: z.boolean(),
        isClosingOnlyRestricted: z.boolean(),
        isPortfolioMargin: z.boolean(),
        pfcbFlag: z.boolean(),
        positions: z.array(z.unknown()).max(500).optional(),
        initialBalances: initialBalancesSchema,
        currentBalances: currentBalancesSchema,
        projectedBalances: projectedBalancesSchema,
      })
      .strict(),
    aggregatedBalance: aggregatedBalanceSchema,
  })
  .strict();

const accountTypeProbeSchema = z.object({
  securitiesAccount: z.object({ type: z.string().max(32) }),
});

export type SchwabPositionSide = "long" | "short" | "flat";

export type SchwabPosition = {
  readonly symbol: string;
  readonly assetType: SchwabAssetType;
  readonly description: string | null;
  readonly side: SchwabPositionSide;
  /** Cantidad sin signo; el lado lo dice `side`. */
  readonly quantity: string;
  readonly averagePrice: string;
  readonly marketValue: string;
  readonly dayProfitLoss: string | null;
  /** En puntos porcentuales, como lo publica Schwab. */
  readonly dayProfitLossPercent: string | null;
  readonly openProfitLoss: string | null;
  /** Sólo opciones: lo que dice Schwab, `null` si no lo dice (nunca 100 supuesto). */
  readonly optionMultiplier: string | null;
};

export type SchwabCashBalances = {
  readonly liquidationValue: string;
  readonly cashBalance: string;
  readonly totalCash: string;
  readonly longMarketValue: string;
  readonly shortMarketValue: string;
  readonly unsettledCash: string;
  readonly cashAvailableForWithdrawal: string;
  /** Poder de compra overnight de una cuenta `CASH`: el disponible para operar. */
  readonly cashAvailableForTrading: string;
  /** Poder de compra intradía, tal cual lo informa Schwab ahora. */
  readonly currentIntradayBuyingPower: string;
  /** El mismo, al abrir la sesión. */
  readonly intradayBuyingPowerAtOpen: string;
  readonly liquidationValueAtOpen: string;
};

export type SchwabCashAccount = {
  readonly accountType: "CASH";
  readonly accountNumber: string;
  readonly roundTrips: number;
  readonly isDayTrader: boolean;
  readonly isClosingOnlyRestricted: boolean;
  readonly balances: SchwabCashBalances;
  readonly positions: readonly SchwabPosition[];
};

function isZero(value: string): boolean {
  return /^-?0(?:\.0+)?$/u.test(value);
}

function toPosition(
  raw: z.infer<typeof positionSchema>,
): SchwabParseResult<SchwabPosition> {
  const long = !isZero(raw.longQuantity);
  const short = !isZero(raw.shortQuantity);
  if (raw.longQuantity.startsWith("-") || raw.shortQuantity.startsWith("-")) {
    return failure("position_negative_quantity");
  }
  // Schwab publica largos y cortos por separado; una fila con los dos no se
  // netea en silencio.
  if (long && short) return failure("position_both_sides");

  const side: SchwabPositionSide = long ? "long" : short ? "short" : "flat";

  return {
    ok: true,
    value: {
      symbol: raw.instrument.symbol,
      assetType: raw.instrument.assetType,
      description: raw.instrument.description ?? null,
      side,
      quantity: short ? raw.shortQuantity : raw.longQuantity,
      averagePrice: raw.averagePrice,
      marketValue: raw.marketValue,
      dayProfitLoss: raw.currentDayProfitLoss ?? null,
      dayProfitLossPercent: raw.currentDayProfitLossPercentage ?? null,
      openProfitLoss:
        side === "short"
          ? (raw.shortOpenProfitLoss ?? null)
          : (raw.longOpenProfitLoss ?? null),
      optionMultiplier:
        raw.instrument.assetType === "OPTION"
          ? (raw.instrument.optionMultiplier ?? null)
          : null,
    },
  };
}

export function parseSchwabAccount(
  body: Uint8Array,
): SchwabParseResult<SchwabCashAccount> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");

  const probe = accountTypeProbeSchema.safeParse(json);
  if (!probe.success) {
    return failure("account_schema_changed", issuePath(probe.error));
  }
  const type = probe.data.securitiesAccount.type;
  if (type !== "CASH") {
    return failure(
      type === "MARGIN" ? "account_type_not_measured" : "account_type_unknown",
      "securitiesAccount.type",
    );
  }

  const parsed = cashAccountSchema.safeParse(json);
  if (!parsed.success) {
    return failure("account_schema_changed", issuePath(parsed.error));
  }

  const account = parsed.data.securitiesAccount;
  const positions: SchwabPosition[] = [];

  for (const [index, raw] of (account.positions ?? []).entries()) {
    const position = positionSchema.safeParse(raw);
    if (!position.success) {
      return failure(
        "position_schema_changed",
        issuePath(position.error, `securitiesAccount.positions[${index}]`),
      );
    }
    const read = toPosition(position.data);
    if (!read.ok) {
      return failure(read.code, `securitiesAccount.positions[${index}]`);
    }
    positions.push(read.value);
  }

  const current = account.currentBalances;
  const aggregated = parsed.data.aggregatedBalance;

  return {
    ok: true,
    value: {
      accountType: "CASH",
      accountNumber: account.accountNumber,
      roundTrips: account.roundTrips,
      isDayTrader: account.isDayTrader,
      isClosingOnlyRestricted: account.isClosingOnlyRestricted,
      balances: {
        liquidationValue: current.liquidationValue,
        cashBalance: current.cashBalance,
        totalCash: current.totalCash,
        longMarketValue: current.longMarketValue,
        shortMarketValue: current.shortMarketValue,
        unsettledCash: current.unsettledCash,
        cashAvailableForWithdrawal: current.cashAvailableForWithdrawal,
        cashAvailableForTrading: current.cashAvailableForTrading,
        currentIntradayBuyingPower: aggregated.currentIntradayBuyingPowerAmount,
        intradayBuyingPowerAtOpen: aggregated.intradayBuyingPowerAmount,
        liquidationValueAtOpen: account.initialBalances.liquidationValue,
      },
      positions,
    },
  };
}

/**
 * Estados de una orden según el schema publicado, partidos en abiertos y
 * terminados (`schwab-open-order-statuses-1.0.0`). Un estado fuera de la lista
 * rechaza la lectura: no se adivina si sigue viva.
 */
export const SCHWAB_OPEN_ORDER_STATUSES = [
  "AWAITING_PARENT_ORDER",
  "AWAITING_CONDITION",
  "AWAITING_STOP_CONDITION",
  "AWAITING_MANUAL_REVIEW",
  "ACCEPTED",
  "AWAITING_UR_OUT",
  "PENDING_ACTIVATION",
  "QUEUED",
  "WORKING",
  "NEW",
  "AWAITING_RELEASE_TIME",
  "PENDING_ACKNOWLEDGEMENT",
  "PENDING_CANCEL",
  "PENDING_REPLACE",
  "PENDING_RECALL",
] as const;

export const SCHWAB_CLOSED_ORDER_STATUSES = [
  "REJECTED",
  "CANCELED",
  "REPLACED",
  "FILLED",
  "EXPIRED",
  "UNKNOWN",
] as const;

export type SchwabOpenOrderStatus = (typeof SCHWAB_OPEN_ORDER_STATUSES)[number];

const orderStatusSchema = z.enum([
  ...SCHWAB_OPEN_ORDER_STATUSES,
  ...SCHWAB_CLOSED_ORDER_STATUSES,
]);

const executionLegSchema = z
  .object({
    legId: exactIntegerSchema.optional(),
    price: optionalDecimal,
    quantity: optionalDecimal,
    mismarkedQuantity: optionalDecimal,
    instrumentId: exactIntegerSchema.optional(),
    time: z.string().max(40).optional(),
  })
  .strict();

const orderActivitySchema = z
  .object({
    activityType: z.string().max(64).optional(),
    activityId: exactIntegerSchema.optional(),
    executionType: z.string().max(64).optional(),
    quantity: optionalDecimal,
    orderRemainingQuantity: optionalDecimal,
    executionLegs: z.array(executionLegSchema).optional(),
  })
  .strict();

const orderLegSchema = z
  .object({
    orderLegType: z.string().max(64).optional(),
    legId: exactIntegerSchema.optional(),
    instrument: instrumentSchema,
    instruction: z.string().max(64),
    positionEffect: z.string().max(64).optional(),
    quantity: decimal,
    quantityType: z.string().max(64).optional(),
    divCapGains: z.string().max(64).optional(),
    toSymbol: z.string().max(64).optional(),
  })
  .strict();

type RawOrder = {
  readonly orderId: number;
  readonly status: z.infer<typeof orderStatusSchema>;
  readonly enteredTime: string;
  readonly orderType?: string;
  readonly session?: string;
  readonly duration?: string;
  readonly quantity?: string;
  readonly filledQuantity?: string;
  readonly remainingQuantity?: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly orderStrategyType?: string;
  readonly orderLegCollection?: readonly z.infer<typeof orderLegSchema>[];
  readonly childOrderStrategies?: readonly RawOrder[];
  readonly replacingOrderCollection?: readonly RawOrder[];
};

const instantSchema = z
  .string()
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u,
  );

/** Una orden según el schema publicado (sin medir: no hubo órdenes en 60 días). */
const orderSchema: z.ZodType<RawOrder, unknown> = z.lazy(() =>
  z
    .object({
      orderId: exactIntegerSchema,
      status: orderStatusSchema,
      enteredTime: instantSchema,
      session: z.string().max(32).optional(),
      duration: z.string().max(32).optional(),
      orderType: z.string().max(64).optional(),
      cancelTime: z.string().max(40).optional(),
      complexOrderStrategyType: z.string().max(64).optional(),
      quantity: optionalDecimal,
      filledQuantity: optionalDecimal,
      remainingQuantity: optionalDecimal,
      requestedDestination: z.string().max(64).optional(),
      destinationLinkName: z.string().max(64).optional(),
      releaseTime: z.string().max(40).optional(),
      stopPrice: optionalDecimal,
      stopPriceLinkBasis: z.string().max(64).optional(),
      stopPriceLinkType: z.string().max(64).optional(),
      stopPriceOffset: optionalDecimal,
      stopType: z.string().max(64).optional(),
      priceLinkBasis: z.string().max(64).optional(),
      priceLinkType: z.string().max(64).optional(),
      price: optionalDecimal,
      taxLotMethod: z.string().max(64).optional(),
      orderLegCollection: z.array(orderLegSchema).max(8).optional(),
      activationPrice: optionalDecimal,
      specialInstruction: z.string().max(64).optional(),
      orderStrategyType: z.string().max(64).optional(),
      cancelable: z.boolean().optional(),
      editable: z.boolean().optional(),
      closeTime: z.string().max(40).optional(),
      tag: z.string().max(128).optional(),
      accountNumber: exactIntegerSchema.optional(),
      orderActivityCollection: z.array(orderActivitySchema).optional(),
      replacingOrderCollection: z.array(orderSchema).max(16).optional(),
      childOrderStrategies: z.array(orderSchema).max(16).optional(),
      statusDescription: z.string().max(512).optional(),
      firmActionType: z.string().max(64).optional(),
    })
    .strict(),
);

export type SchwabOpenOrder = {
  readonly orderId: string;
  /** La orden madre de un bracket o un OCO; `null` en una orden suelta. */
  readonly parentOrderId: string | null;
  readonly status: SchwabOpenOrderStatus;
  readonly enteredTime: string;
  readonly orderType: string | null;
  readonly duration: string | null;
  readonly session: string | null;
  readonly legs: readonly {
    readonly symbol: string;
    readonly assetType: SchwabAssetType;
    readonly instruction: string;
    readonly quantity: string;
  }[];
  readonly quantity: string | null;
  readonly filledQuantity: string | null;
  readonly price: string | null;
  readonly stopPrice: string | null;
};

const OPEN: ReadonlySet<string> = new Set(SCHWAB_OPEN_ORDER_STATUSES);

function collectOpen(
  order: RawOrder,
  parentOrderId: string | null,
  into: Map<string, SchwabOpenOrder>,
): void {
  const orderId = String(order.orderId);

  if (OPEN.has(order.status)) {
    into.set(orderId, {
      orderId,
      parentOrderId,
      status: order.status as SchwabOpenOrderStatus,
      enteredTime: order.enteredTime,
      orderType: order.orderType ?? null,
      duration: order.duration ?? null,
      session: order.session ?? null,
      legs: (order.orderLegCollection ?? []).map((leg) => ({
        symbol: leg.instrument.symbol,
        assetType: leg.instrument.assetType,
        instruction: leg.instruction,
        quantity: leg.quantity,
      })),
      quantity: order.quantity ?? null,
      filledQuantity: order.filledQuantity ?? null,
      price: order.price ?? null,
      stopPrice: order.stopPrice ?? null,
    });
  }

  // Una madre ejecutada puede tener hijas vivas: el stop y el target de un
  // bracket esperan con la madre ya `FILLED`.
  for (const child of order.childOrderStrategies ?? []) {
    collectOpen(child, orderId, into);
  }
}

/**
 * Las órdenes abiertas de una o más respuestas de `/orders`, sin duplicados
 * por `orderId` (dos ventanas pueden traer la misma) y ordenadas por ingreso,
 * la más nueva primero; las patas de un mismo ingreso, por `orderId`.
 */
export function parseSchwabOpenOrders(
  bodies: readonly Uint8Array[],
): SchwabParseResult<readonly SchwabOpenOrder[]> {
  const open = new Map<string, SchwabOpenOrder>();

  for (const body of bodies) {
    const json = readExactJson(body);
    if (json === null) return failure("invalid_json");
    if (!Array.isArray(json)) return failure("orders_schema_changed");

    for (const [index, raw] of json.entries()) {
      const order = orderSchema.safeParse(raw);
      if (!order.success) {
        return failure(
          "order_schema_changed",
          issuePath(order.error, `[${index}]`),
        );
      }
      collectOpen(order.data, null, open);
    }
  }

  return {
    ok: true,
    value: [...open.values()].sort(
      (a, b) =>
        Date.parse(b.enteredTime) - Date.parse(a.enteredTime) ||
        a.orderId.localeCompare(b.orderId, "en", { numeric: true }),
    ),
  };
}
