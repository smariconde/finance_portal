import { z } from "zod";

import {
  createDecimalOperations,
  HUNDRED,
  sum,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import {
  notesSchema,
  priceInputSchema,
  quantityInputSchema,
} from "./trade-annotation";
import { setupCodeSchema } from "./trading-setups";

/** Ideas fechadas antes de una ejecución. Los resultados se reconstruyen desde
 * entradas y versión; nunca se recalculan con el capital de una fecha posterior.
 * `1.1.0` (`F11-18`): cada idea dice si es day o swing, y el stop automático y
 * el tamaño usan el riesgo y el capital de ese tipo. Una revisión anterior no
 * lo decía y usaba el riesgo por trade de entonces, el del swing: se lee swing. */
export const PRE_MARKET_PLAN_VERSION = "pre-market-plan-1.1.0";
export const STOP_LOSS_CALC_VERSION = "stop-loss-calc-1.0.0";

export const ideaIdSchema = z.uuid();
export const ideaSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9./-]{0,15}$/u);
export const ideaFormSchema = z
  .object({
    ideaId: ideaIdSchema.nullable(),
    baseRevision: z.number().int().min(1).max(1_000_000).nullable(),
    symbol: ideaSymbolSchema,
    setupCode: setupCodeSchema.nullable(),
    book: z.enum(["day", "swing"]),
    entry: priceInputSchema,
    quantity: quantityInputSchema,
    manualStop: priceInputSchema,
    manualTarget: priceInputSchema,
    stopMode: z.enum(["manual", "automatic"]),
    targetMode: z.enum(["manual", "one_to_two", "one_to_three"]),
    notes: notesSchema,
    status: z.enum(["active", "archived"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.entry === null)
      context.addIssue({
        code: "custom",
        path: ["entry"],
        message: "required",
      });
    if (value.quantity === null)
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "required",
      });
    else if (!/^[1-9][0-9]*$/u.test(value.quantity))
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "whole_shares_required",
      });
    if (value.stopMode === "manual" && value.manualStop === null)
      context.addIssue({
        code: "custom",
        path: ["manualStop"],
        message: "required",
      });
    if (value.targetMode === "manual" && value.manualTarget === null)
      context.addIssue({
        code: "custom",
        path: ["manualTarget"],
        message: "required",
      });
    if (
      (value.ideaId === null && value.baseRevision !== null) ||
      (value.ideaId !== null && value.baseRevision === null)
    )
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
        message: "revision_mismatch",
      });
  });

export type IdeaForm = z.infer<typeof ideaFormSchema>;
export type IdeaFields = Omit<IdeaForm, "ideaId" | "baseRevision"> & {
  readonly entry: string;
  readonly quantity: string;
};

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);
const parse = (value: string) => parseDecimal(value, "pre-market-plan");
const format = (value: ReturnType<typeof parse>) =>
  formatDecimal(value, "pre-market-plan");

export type IdeaLevels =
  | {
      readonly state: "valid";
      readonly stop: string;
      readonly target: string;
      readonly chosenRisk: string;
      readonly autoStop: string | null;
      readonly targetTwo: string;
      readonly targetThree: string;
      /** `entrada − stop`: lo que arriesga una acción, la unidad de `R`. */
      readonly riskPerShare: string;
      /** `entrada × cantidad`: el monto de la compra. */
      readonly chosenValue: string;
      /** Esa compra como porcentaje del capital observado al guardar. */
      readonly chosenPercent: string;
      readonly chosenRiskPercent: string;
      /** El target elegido medido en `R` desde la entrada. */
      readonly targetR: string;
    }
  | {
      readonly state: "invalid";
      readonly reason:
        | "no_equity"
        | "stop_on_wrong_side"
        | "target_on_wrong_side"
        | "auto_stop_non_positive"
        | "non_positive_input";
    };

/** El stop automático limita la pérdida al porcentaje de la liquidación en la
 * cantidad elegida. Se redondea hacia arriba a 6 decimales: el riesgo no supera
 * el presupuesto por el redondeo. Los TP parten del stop elegido. Sólo largos.
 * El monto de la compra (`chosenValue`) y su peso en el capital son una lectura
 * de esas mismas entradas: agregarlos no mueve el stop, el target ni un valor
 * guardado, así que la versión del contrato no cambia. */
export function ideaLevels(
  input: Pick<
    IdeaFields,
    | "entry"
    | "quantity"
    | "manualStop"
    | "manualTarget"
    | "stopMode"
    | "targetMode"
  > & {
    readonly liquidationValue: string;
    readonly riskPercent: string;
  },
): IdeaLevels {
  const entry = parse(input.entry);
  const quantity = parse(input.quantity);
  const equity = parse(input.liquidationValue);
  if (!equity.greaterThan(ZERO))
    return { state: "invalid", reason: "no_equity" };
  const riskPercent = parse(input.riskPercent);
  if (
    !entry.greaterThan(ZERO) ||
    !quantity.greaterThan(ZERO) ||
    !riskPercent.greaterThan(ZERO)
  )
    return { state: "invalid", reason: "non_positive_input" };
  const budget = equity.times(riskPercent).div(100);
  const rawStop = entry.minus(divide(budget, quantity, "pre-market-plan"));
  const autoStop = rawStop.greaterThan(ZERO)
    ? format(rawStop.times(1_000_000).ceil().div(1_000_000))
    : null;
  if (input.stopMode === "automatic" && autoStop === null)
    return { state: "invalid", reason: "auto_stop_non_positive" };
  const stop = parse(
    input.stopMode === "manual" ? input.manualStop! : autoStop!,
  );
  if (!stop.greaterThan(ZERO))
    return { state: "invalid", reason: "non_positive_input" };
  if (!stop.lessThan(entry))
    return { state: "invalid", reason: "stop_on_wrong_side" };
  const risk = entry.minus(stop);
  const targetTwo = format(entry.plus(risk.times(2)));
  const targetThree = format(entry.plus(risk.times(3)));
  const target =
    input.targetMode === "manual"
      ? input.manualTarget!
      : input.targetMode === "one_to_two"
        ? targetTwo
        : targetThree;
  const targetValue = parse(target);
  if (!targetValue.greaterThan(ZERO))
    return { state: "invalid", reason: "non_positive_input" };
  if (!targetValue.greaterThan(entry))
    return { state: "invalid", reason: "target_on_wrong_side" };
  const chosenValue = entry.times(quantity);
  const chosenRisk = risk.times(quantity);
  const percentOf = (amount: ReturnType<typeof parse>) =>
    format(divide(amount.times(HUNDRED), equity, "pre-market-plan"));
  return {
    state: "valid",
    stop: format(stop),
    target,
    chosenRisk: format(chosenRisk),
    autoStop,
    targetTwo,
    targetThree,
    riskPerShare: format(risk),
    chosenValue: format(chosenValue),
    chosenPercent: percentOf(chosenValue),
    chosenRiskPercent: percentOf(chosenRisk),
    targetR: format(divide(targetValue.minus(entry), risk, "pre-market-plan")),
  };
}

/**
 * El monto de la compra de varias ideas, sumado. Es aritmética exacta sobre lo
 * que cada revisión guardó —entrada y cantidad—, no una lectura del capital de
 * hoy: por eso no se suma el porcentaje, que depende del capital de cada guardado.
 */
export function purchaseTotal(
  ideas: readonly Pick<IdeaFields, "entry" | "quantity">[],
): string {
  return format(
    sum(ideas.map((idea) => parse(idea.entry).times(parse(idea.quantity)))),
  );
}
