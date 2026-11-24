import {
  createDecimalOperations,
  HUNDRED,
  sum,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * El planner y el riesgo abierto (`position-size-risk-1.0.0`, ADR 0076,
 * sección 9; `F11-09`). Decisiones del owner del 2026-11-15:
 *
 * - **2 % por trade:** `(entrada − stop) × acciones ≤ 2 %` del valor de
 *   liquidación que publica Schwab al momento.
 * - **6 % de cartera = riesgo abierto hoy:** `Σ (precio − stop) × cantidad` de
 *   las posiciones abiertas. Un stop ya sobre la entrada (trailing) sigue
 *   arriesgando lo que hay entre el precio y el stop, no el riesgo inicial; un
 *   stop sobre el precio no se lee como riesgo cero: `price_through_stop`.
 * - **El stop de una posición:** el planeado en el diario para el trade abierto;
 *   sin plan, la orden stop viva de Schwab, sólo si cubre toda la cantidad. Si
 *   están los dos y difieren, se marca. Sin ninguno, el riesgo es `null` con
 *   `no_stop`, y el total del 6 % no se suma: un parcial mostraría menos riesgo
 *   del que hay.
 * - **Los precios del planner los escribe el owner:** el planner no cotiza.
 *
 * La cuenta es `CASH`, así que sólo se miden largos de acciones y ETFs; un corto
 * u otro activo se nombra. Las acciones son enteras, hacia abajo.
 */
export const POSITION_SIZE_RISK_VERSION = "position-size-risk-1.0.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

const PATH = "position-size-risk";
const parse = (value: string) => parseDecimal(value, PATH);
const format = (value: Dec) => formatDecimal(value, PATH);

/** Los activos cuyo riesgo se mide: los que la cuenta cotiza. */
const MEASURED_ASSET_TYPES: ReadonlySet<string> = new Set([
  "EQUITY",
  "COLLECTIVE_INVESTMENT",
]);

/** Órdenes que protegen un largo: venden al tocar su `stopPrice`. */
const STOP_ORDER_TYPES: ReadonlySet<string> = new Set([
  "STOP",
  "STOP_LIMIT",
  "TRAILING_STOP",
  "TRAILING_STOP_LIMIT",
]);
const SELL_INSTRUCTIONS: ReadonlySet<string> = new Set(["SELL"]);

export type RiskPositionInput = {
  readonly symbol: string;
  readonly assetType: string;
  readonly side: "long" | "short" | "flat";
  readonly quantity: string;
  readonly averagePrice: string;
  readonly marketValue: string;
};

export type RiskOrderInput = {
  readonly orderType: string | null;
  readonly legs: readonly {
    readonly symbol: string;
    readonly instruction: string;
    readonly quantity: string;
  }[];
  readonly price: string | null;
  readonly stopPrice: string | null;
};

/** Lo planeado en el diario para el trade abierto de ese símbolo. */
export type PlanLevels = {
  readonly stop: string | null;
  readonly target: string | null;
  /** El segmento de `/diario/<ref>`, para ir a corregir el plan. */
  readonly tradeRef: string;
};

export type PositionRiskReason =
  | "no_stop"
  | "orders_unread"
  | "stop_order_partial"
  | "price_through_stop"
  | "asset_not_measured"
  | "short_not_measured";

export type PositionRisk = {
  readonly symbol: string;
  readonly quantity: string;
  readonly entry: string;
  readonly price: string;
  readonly stop: string | null;
  readonly stopSource: "plan" | "order" | null;
  readonly target: string | null;
  readonly targetSource: "plan" | "order" | null;
  /** Hay plan y orden stop, y no dicen lo mismo. */
  readonly stopMismatch: boolean;
  readonly planStop: string | null;
  readonly orderStop: string | null;
  readonly tradeRef: string | null;
  /** El stop ya está en o sobre la entrada: lo que salta es ganancia. */
  readonly lockedIn: boolean;
  /** `(precio − entrada) / (entrada − stop)`; `null` con el stop en o sobre la entrada. */
  readonly priceInR: string | null;
  readonly risk:
    | { readonly value: string; readonly reason: null }
    | { readonly value: null; readonly reason: PositionRiskReason };
};

/** El precio de una posición según Schwab: market value sobre cantidad. */
export function markOf(position: RiskPositionInput): string {
  return format(
    divide(parse(position.marketValue), parse(position.quantity), PATH),
  );
}

function legsFor(order: RiskOrderInput, symbol: string) {
  return order.legs.filter(
    (leg) => leg.symbol === symbol && SELL_INSTRUCTIONS.has(leg.instruction),
  );
}

/**
 * La orden stop viva de un largo. Varias con precios distintos dan el más bajo
 * (el que más arriesga); cubren la posición si suman toda su cantidad.
 */
function orderStopOf(
  orders: readonly RiskOrderInput[],
  symbol: string,
  quantity: Dec,
): { readonly price: string; readonly covers: boolean } | null {
  let lowest: Dec | null = null;
  let covered = ZERO;
  for (const order of orders) {
    if (order.orderType === null || !STOP_ORDER_TYPES.has(order.orderType))
      continue;
    if (order.stopPrice === null) continue;
    const legs = legsFor(order, symbol);
    if (legs.length === 0) continue;
    const price = parse(order.stopPrice);
    if (lowest === null || price.lessThan(lowest)) lowest = price;
    covered = covered.plus(sum(legs.map((leg) => parse(leg.quantity))));
  }
  if (lowest === null) return null;
  return {
    price: format(lowest),
    covers: covered.greaterThanOrEqualTo(quantity),
  };
}

/** La venta limit viva sobre el precio: el target que dejó puesto el owner. */
function orderTargetOf(
  orders: readonly RiskOrderInput[],
  symbol: string,
  price: Dec,
): string | null {
  let lowest: Dec | null = null;
  for (const order of orders) {
    if (order.orderType !== "LIMIT" || order.price === null) continue;
    if (legsFor(order, symbol).length === 0) continue;
    const limit = parse(order.price);
    if (!limit.greaterThan(price)) continue;
    if (lowest === null || limit.lessThan(lowest)) lowest = limit;
  }
  return lowest === null ? null : format(lowest);
}

export function positionRisk(input: {
  readonly position: RiskPositionInput;
  /** La cotización si la hay; si no, `markOf(position)`. */
  readonly price: string;
  readonly plan: PlanLevels | null;
  /** `null` si las órdenes no se leyeron: sin plan, el stop es desconocido. */
  readonly orders: readonly RiskOrderInput[] | null;
}): PositionRisk {
  const { position, plan } = input;
  const base = {
    symbol: position.symbol,
    quantity: position.quantity,
    entry: position.averagePrice,
    price: input.price,
    planStop: plan?.stop ?? null,
    tradeRef: plan?.tradeRef ?? null,
  };
  const unmeasured = (reason: PositionRiskReason): PositionRisk => ({
    ...base,
    stop: null,
    stopSource: null,
    target: null,
    targetSource: null,
    stopMismatch: false,
    orderStop: null,
    lockedIn: false,
    priceInR: null,
    risk: { value: null, reason },
  });
  if (!MEASURED_ASSET_TYPES.has(position.assetType)) {
    return unmeasured("asset_not_measured");
  }
  if (position.side !== "long") return unmeasured("short_not_measured");

  const quantity = parse(position.quantity);
  const price = parse(input.price);
  const entry = parse(position.averagePrice);
  const orders = input.orders ?? [];
  const order = orderStopOf(orders, position.symbol, quantity);

  let stop: string | null = null;
  let stopSource: PositionRisk["stopSource"] = null;
  if (plan?.stop != null) {
    stop = plan.stop;
    stopSource = "plan";
  } else if (order !== null && order.covers) {
    stop = order.price;
    stopSource = "order";
  }

  const orderTarget = orderTargetOf(orders, position.symbol, price);
  const target = plan?.target ?? orderTarget;
  const targetSource =
    plan?.target != null ? "plan" : orderTarget !== null ? "order" : null;

  const stopMismatch =
    plan?.stop != null &&
    order !== null &&
    !parse(plan.stop).equals(parse(order.price));

  const shared = {
    ...base,
    target,
    targetSource,
    stopMismatch,
    orderStop: order?.price ?? null,
  } as const;

  if (stop === null) {
    return {
      ...shared,
      stop: null,
      stopSource: null,
      lockedIn: false,
      priceInR: null,
      risk: {
        value: null,
        reason:
          input.orders === null
            ? "orders_unread"
            : order !== null
              ? "stop_order_partial"
              : "no_stop",
      },
    };
  }

  const stopValue = parse(stop);
  const perShare = entry.minus(stopValue);
  const located = {
    ...shared,
    stop,
    stopSource,
    lockedIn: !perShare.greaterThan(ZERO),
    priceInR: perShare.greaterThan(ZERO)
      ? format(divide(price.minus(entry), perShare, PATH))
      : null,
  };
  if (!price.greaterThan(stopValue)) {
    return {
      ...located,
      risk: { value: null, reason: "price_through_stop" },
    };
  }
  return {
    ...located,
    risk: {
      value: format(price.minus(stopValue).times(quantity)),
      reason: null,
    },
  };
}

export type OpenRisk = {
  /** `null` si alguna posición no tiene riesgo medido: un parcial no es el total. */
  readonly value: string | null;
  /** La suma de las que sí lo tienen. */
  readonly known: string;
  /** Los símbolos sin riesgo medido. */
  readonly missing: readonly string[];
  /** `openRiskPercent` del valor de liquidación; `null` sin capital. */
  readonly limit: string | null;
  /** El riesgo abierto en % del valor de liquidación. */
  readonly percent: string | null;
};

export function openRisk(
  risks: readonly PositionRisk[],
  liquidationValue: string,
  openRiskPercent: string,
): OpenRisk {
  const equity = parse(liquidationValue);
  const known = sum(
    risks.flatMap((risk) =>
      risk.risk.value === null ? [] : [parse(risk.risk.value)],
    ),
  );
  const missing = risks
    .filter((risk) => risk.risk.value === null)
    .map((risk) => risk.symbol);
  const value = missing.length === 0 ? known : null;
  const hasEquity = equity.greaterThan(ZERO);
  return {
    value: value === null ? null : format(value),
    known: format(known),
    missing,
    limit: hasEquity
      ? format(equity.times(parse(openRiskPercent)).div(HUNDRED))
      : null,
    percent:
      hasEquity && value !== null
        ? format(divide(value.times(HUNDRED), equity, PATH))
        : null,
  };
}

export type PlannerCap = "risk_per_trade" | "buying_power" | "open_risk";

export type PlannerInvalidReason =
  "no_equity" | "stop_on_wrong_side" | "zero_risk";

export type PositionPlan =
  | {
      readonly state: "planned";
      readonly shares: string;
      /** El tope que decidió la cantidad. */
      readonly binding: PlannerCap;
      readonly caps: {
        readonly riskPerTrade: string;
        readonly buyingPower: string;
        /** `null` si el riesgo abierto no se conoce entero. */
        readonly openRisk: string | null;
      };
      readonly riskPerShare: string;
      readonly riskBudget: string;
      readonly riskAmount: string;
      readonly riskPercent: string;
      readonly positionValue: string;
      readonly positionPercent: string;
      readonly rewardRisk:
        | { readonly value: string; readonly reason: null }
        | {
            readonly value: null;
            readonly reason: "no_target" | "target_on_wrong_side";
          };
      /** El riesgo abierto si entra este trade; `null` si no se conoce. */
      readonly openRiskAfterPercent: string | null;
    }
  | { readonly state: "invalid"; readonly reason: PlannerInvalidReason };

function wholeShares(budget: Dec, perShare: Dec): Dec {
  if (!budget.greaterThan(ZERO)) return ZERO;
  return divide(budget, perShare, PATH).floor();
}

/**
 * Cuántas acciones comprar: el mínimo entre lo que permite el 2 %, el buying
 * power y lo que le queda al 6 %. Sin riesgo abierto conocido, el tope del 6 %
 * no se calcula y no decide.
 */
export function planPosition(input: {
  readonly liquidationValue: string;
  readonly buyingPower: string;
  readonly riskPerTradePercent: string;
  readonly openRiskPercent: string;
  readonly openRisk: string | null;
  readonly entry: string;
  readonly stop: string;
  readonly target: string | null;
}): PositionPlan {
  const equity = parse(input.liquidationValue);
  if (!equity.greaterThan(ZERO))
    return { state: "invalid", reason: "no_equity" };
  const entry = parse(input.entry);
  const stop = parse(input.stop);
  const perShare = entry.minus(stop);
  if (perShare.isZero()) return { state: "invalid", reason: "zero_risk" };
  if (perShare.lessThan(ZERO)) {
    return { state: "invalid", reason: "stop_on_wrong_side" };
  }

  const riskBudget = equity
    .times(parse(input.riskPerTradePercent))
    .div(HUNDRED);
  const byRisk = wholeShares(riskBudget, perShare);
  const byBuyingPower = wholeShares(parse(input.buyingPower), entry);
  const open = input.openRisk === null ? null : parse(input.openRisk);
  const openLimit = equity.times(parse(input.openRiskPercent)).div(HUNDRED);
  const byOpenRisk =
    open === null ? null : wholeShares(openLimit.minus(open), perShare);

  const candidates: [PlannerCap, Dec][] = [
    ["risk_per_trade", byRisk],
    ["buying_power", byBuyingPower],
  ];
  if (byOpenRisk !== null) candidates.push(["open_risk", byOpenRisk]);
  // Empate: decide el primero de la lista, el 2 % antes que el resto.
  const [binding, shares] = candidates.reduce((best, candidate) =>
    candidate[1].lessThan(best[1]) ? candidate : best,
  );

  const riskAmount = shares.times(perShare);
  const positionValue = shares.times(entry);
  let rewardRisk: Extract<PositionPlan, { state: "planned" }>["rewardRisk"];
  if (input.target === null) {
    rewardRisk = { value: null, reason: "no_target" };
  } else {
    const reward = parse(input.target).minus(entry);
    rewardRisk = reward.greaterThan(ZERO)
      ? { value: format(divide(reward, perShare, PATH)), reason: null }
      : { value: null, reason: "target_on_wrong_side" };
  }
  const percentOf = (amount: Dec) =>
    format(divide(amount.times(HUNDRED), equity, PATH));

  return {
    state: "planned",
    shares: format(shares),
    binding,
    caps: {
      riskPerTrade: format(byRisk),
      buyingPower: format(byBuyingPower),
      openRisk: byOpenRisk === null ? null : format(byOpenRisk),
    },
    riskPerShare: format(perShare),
    riskBudget: format(riskBudget),
    riskAmount: format(riskAmount),
    riskPercent: percentOf(riskAmount),
    positionValue: format(positionValue),
    positionPercent: percentOf(positionValue),
    rewardRisk,
    openRiskAfterPercent:
      open === null ? null : percentOf(open.plus(riskAmount)),
  };
}

/**
 * El planner por monto (`position-size-amount-1.0.0`, pedido del owner del
 * 2026-11-16): thinkorswim compra por cantidad de acciones, así que el owner
 * escribe cuánto quiere poner y sale cuántas acciones son. Enteras, hacia abajo:
 * nunca se pasa del monto. El stop es opcional; con él se mide el riesgo de esa
 * cantidad contra el presupuesto por trade y se dice cuántas acciones permitía.
 * Nada se recorta: pasarse del riesgo o del buying power se marca, no se corrige.
 */
export const POSITION_SIZE_AMOUNT_VERSION = "position-size-amount-1.0.0";

export type AmountPlan =
  | {
      readonly state: "planned";
      readonly shares: string;
      readonly positionValue: string;
      readonly positionPercent: string;
      /** Lo que sobra del monto por redondear hacia abajo. */
      readonly leftover: string;
      readonly overBuyingPower: boolean;
      /** `null` sin stop: no hay riesgo que medir. */
      readonly risk: {
        readonly amount: string;
        readonly percent: string;
        readonly budget: string;
        /** Las acciones que el presupuesto por trade permitía. */
        readonly maxShares: string;
        readonly overBudget: boolean;
      } | null;
      readonly rewardRisk:
        | { readonly value: string; readonly reason: null }
        | {
            readonly value: null;
            readonly reason: "no_stop" | "no_target" | "target_on_wrong_side";
          };
    }
  | { readonly state: "invalid"; readonly reason: PlannerInvalidReason };

export function planByAmount(input: {
  readonly liquidationValue: string;
  readonly buyingPower: string;
  readonly riskPerTradePercent: string;
  readonly amount: string;
  readonly entry: string;
  readonly stop: string | null;
  readonly target: string | null;
}): AmountPlan {
  const equity = parse(input.liquidationValue);
  if (!equity.greaterThan(ZERO))
    return { state: "invalid", reason: "no_equity" };
  const entry = parse(input.entry);
  const stop = input.stop === null ? null : parse(input.stop);
  const perShare = stop === null ? null : entry.minus(stop);
  if (perShare !== null && perShare.isZero())
    return { state: "invalid", reason: "zero_risk" };
  if (perShare !== null && perShare.lessThan(ZERO))
    return { state: "invalid", reason: "stop_on_wrong_side" };

  const amount = parse(input.amount);
  const shares = wholeShares(amount, entry);
  const positionValue = shares.times(entry);
  const percentOf = (value: Dec) =>
    format(divide(value.times(HUNDRED), equity, PATH));

  let risk: Extract<AmountPlan, { state: "planned" }>["risk"] = null;
  if (perShare !== null) {
    const budget = equity.times(parse(input.riskPerTradePercent)).div(HUNDRED);
    const riskAmount = shares.times(perShare);
    risk = {
      amount: format(riskAmount),
      percent: percentOf(riskAmount),
      budget: format(budget),
      maxShares: format(wholeShares(budget, perShare)),
      overBudget: riskAmount.greaterThan(budget),
    };
  }

  let rewardRisk: Extract<AmountPlan, { state: "planned" }>["rewardRisk"];
  if (perShare === null) {
    rewardRisk = { value: null, reason: "no_stop" };
  } else if (input.target === null) {
    rewardRisk = { value: null, reason: "no_target" };
  } else {
    const reward = parse(input.target).minus(entry);
    rewardRisk = reward.greaterThan(ZERO)
      ? { value: format(divide(reward, perShare, PATH)), reason: null }
      : { value: null, reason: "target_on_wrong_side" };
  }

  return {
    state: "planned",
    shares: format(shares),
    positionValue: format(positionValue),
    positionPercent: percentOf(positionValue),
    leftover: format(amount.minus(positionValue)),
    overBuyingPower: positionValue.greaterThan(parse(input.buyingPower)),
    risk,
    rewardRisk,
  };
}
