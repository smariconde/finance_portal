import { openDayPnl } from "./open-day-pnl";
import {
  markOf,
  openRisk,
  positionRisk,
  type OpenRisk,
  type PlanLevels,
  type PositionRisk,
  type RiskOrderInput,
} from "./position-size-risk";
import type { SchwabPosition } from "./schwab-account";
import {
  bookOfPosition,
  marketValueOf,
  type TradingBook,
} from "./trading-book";
import {
  capitalLeft,
  evaluateTradingRules,
  type RiskSettings,
  type RuleReading,
  type SessionActivity,
} from "./trading-rules";

/**
 * El riesgo de una lectura de la cuenta en sus dos bolsillos (`F11-18`): el
 * tipo de cada posición (`trading-book-1.1.0`), su riesgo, el 6 % de las swing
 * y las reglas (`trading-rules-2.0.0`). Lo leen `/cuenta` y `/plan`, así que las
 * dos superficies dicen lo mismo de la misma lectura.
 */
export type BookedPositionRisk = PositionRisk & { readonly book: TradingBook };

export type AccountRisk = {
  readonly risks: readonly BookedPositionRisk[];
  /** El riesgo abierto de las posiciones swing. */
  readonly openRisk: OpenRisk;
  readonly rules: readonly RuleReading[];
};

export function accountRisk(input: {
  readonly positions: readonly SchwabPosition[];
  readonly orders: readonly RiskOrderInput[] | null;
  /** El precio de cada posición; sin cotización, el de Schwab en la cuenta. */
  readonly priceOf: (symbol: string) => string | null;
  readonly plans: readonly (PlanLevels & {
    readonly symbol: string;
    readonly book: TradingBook;
  })[];
  readonly settings: RiskSettings;
  readonly liquidationValue: string;
  readonly liquidationValueAtOpen: string;
  readonly activity: SessionActivity;
}): AccountRisk {
  const plans = new Map(input.plans.map((plan) => [plan.symbol, plan]));
  const held = input.positions.filter((position) => position.side !== "flat");
  const bookOf = (position: SchwabPosition): TradingBook =>
    bookOfPosition({
      trade: plans.get(position.symbol)?.book ?? null,
      previousSessionQuantity: position.previousSessionQuantity,
    });
  const risks = held.map((position): BookedPositionRisk => ({
    ...positionRisk({
      position,
      price: input.priceOf(position.symbol) ?? markOf(position),
      plan: plans.get(position.symbol) ?? null,
      orders: input.orders,
    }),
    book: bookOf(position),
  }));
  const inBook = (book: TradingBook) =>
    held.filter((position) => bookOf(position) === book);
  // El 6 % se mide sólo en las swing: un day trade lo cuida la pérdida diaria.
  const open = openRisk(
    risks.filter((risk) => risk.book === "swing"),
    input.liquidationValue,
    input.settings.openRiskPercent,
  );
  const rules = evaluateTradingRules({
    settings: input.settings,
    liquidationValue: input.liquidationValue,
    liquidationValueAtOpen: input.liquidationValueAtOpen,
    day: { openDayPnl: openDayPnl(inBook("day")).day.value },
    swing: { openRisk: open.value, exposure: marketValueOf(inBook("swing")) },
    activity: input.activity,
  });
  return { risks, openRisk: open, rules };
}

/** Lo que le queda al capital de un tipo según sus reglas; `null` sin medir. */
export function bookCapitalLeft(
  rules: readonly RuleReading[],
  book: TradingBook,
): string | null {
  return capitalLeft(
    rules.find(
      (reading) =>
        reading.rule === (book === "day" ? "day_capital" : "swing_exposure"),
    ),
  );
}
