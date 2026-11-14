import { z } from "zod";

import {
  createDecimalOperations,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import type { PlannedStop } from "./trade-r-multiple";
import type { RoundTrip } from "./trade-round-trips";
import { setupCodeSchema } from "./trading-setups";

/**
 * Lo que el owner anota de un trade (`trade-annotation-1.0.0`, `F11-07`, ADR 0076
 * sección 10). Decisiones del owner: setup de una base declarada más los suyos,
 * estado emocional **y** estado de revisión, y adherencia regla por regla.
 *
 * - **Plan:** entrada, stop, target y cantidad planeados, en la moneda del trade.
 *   El stop es el que da R (`trade-r-multiple-1.0.0`); sin stop, R sigue `null`.
 * - **Adherencia:** entrada, stop, target y tamaño, cada uno `kept`, `broken` o
 *   sin marcar. La marca el owner: deducirla de las ejecuciones confundiría un
 *   deslizamiento con una regla rota.
 * - **Notas:** texto plano. Se guardan como se escribieron —normalizadas a NFC,
 *   sin caracteres de control ni marcas de dirección— y se muestran escapadas
 *   (`TM-12`), nunca como HTML ni markdown.
 *
 * Una anotación se guarda como revisiones append-only: corregir el stop deja
 * visible el anterior.
 */
export const TRADE_ANNOTATION_VERSION = "trade-annotation-1.0.0";

/** Relación beneficio/riesgo planeada (`trade-plan-1.0.0`). */
export const TRADE_PLAN_VERSION = "trade-plan-1.0.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export const NOTES_MAX = 4000;

export const ADHERENCE_RULES = ["entry", "stop", "target", "size"] as const;
export type AdherenceRule = (typeof ADHERENCE_RULES)[number];
export const adherenceMarkSchema = z.enum(["kept", "broken"]).nullable();
export type AdherenceMark = z.infer<typeof adherenceMarkSchema>;

export const EMOTIONS = [
  "calm",
  "focused",
  "confident",
  "anxious",
  "fomo",
  "revenge",
  "tired",
  "bored",
] as const;
export const emotionSchema = z.enum(EMOTIONS).nullable();
export type Emotion = (typeof EMOTIONS)[number];

export const reviewStatusSchema = z.enum(["pending", "reviewed"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * Un precio o una cantidad como los escribe el owner: coma o punto decimal, sin
 * separador de miles ni signo. Sale canónico (`123.45`); vacío es `null`.
 */
function positiveDecimalInput(maxScale: number) {
  return z
    .string()
    .max(24)
    .transform((value, context) => {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const pattern = new RegExp(
        `^[0-9]{1,9}(?:[.,][0-9]{1,${maxScale}})?$`,
        "u",
      );
      if (!pattern.test(trimmed)) {
        context.addIssue({ code: "custom", message: "not_a_decimal" });
        return z.NEVER;
      }
      const decimal = parseDecimal(trimmed.replace(",", "."), "annotation");
      if (!decimal.greaterThan(ZERO)) {
        context.addIssue({ code: "custom", message: "not_positive" });
        return z.NEVER;
      }
      return formatDecimal(decimal, "annotation");
    });
}

export const priceInputSchema = positiveDecimalInput(6);
export const quantityInputSchema = positiveDecimalInput(6);

/** Controles C0/C1 salvo salto de línea y tabulación, y las marcas bidi. */
const DISALLOWED_IN_NOTES =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/u;

export const notesSchema = z
  .string()
  .max(NOTES_MAX * 2)
  .transform((value) =>
    value.normalize("NFC").replace(/\r\n?/gu, "\n").trimEnd(),
  )
  .pipe(
    z
      .string()
      .max(NOTES_MAX)
      .refine((value) => !DISALLOWED_IN_NOTES.test(value), "control_character"),
  );

const canonicalPositive = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u)
  .refine((value) => value !== "0");

export const tradePlanSchema = z
  .object({
    entry: canonicalPositive.nullable(),
    stop: canonicalPositive.nullable(),
    target: canonicalPositive.nullable(),
    quantity: canonicalPositive.nullable(),
  })
  .strict();
export type TradePlan = z.infer<typeof tradePlanSchema>;

export const tradeAnnotationSchema = z
  .object({
    setupCode: setupCodeSchema.nullable(),
    plan: tradePlanSchema,
    adherence: z
      .object({
        entry: adherenceMarkSchema,
        stop: adherenceMarkSchema,
        target: adherenceMarkSchema,
        size: adherenceMarkSchema,
      })
      .strict(),
    emotion: emotionSchema,
    review: reviewStatusSchema,
    notes: z.string().max(NOTES_MAX),
  })
  .strict();
export type TradeAnnotation = z.infer<typeof tradeAnnotationSchema>;

export const EMPTY_ANNOTATION: TradeAnnotation = Object.freeze({
  setupCode: null,
  plan: Object.freeze({
    entry: null,
    stop: null,
    target: null,
    quantity: null,
  }),
  adherence: Object.freeze({
    entry: null,
    stop: null,
    target: null,
    size: null,
  }),
  emotion: null,
  review: "pending",
  notes: "",
}) as TradeAnnotation;

export function sameAnnotation(
  a: TradeAnnotation,
  b: TradeAnnotation,
): boolean {
  return (
    a.setupCode === b.setupCode &&
    a.emotion === b.emotion &&
    a.review === b.review &&
    a.notes === b.notes &&
    (["entry", "stop", "target", "quantity"] as const).every(
      (field) => a.plan[field] === b.plan[field],
    ) &&
    ADHERENCE_RULES.every((rule) => a.adherence[rule] === b.adherence[rule])
  );
}

/**
 * La clave de un trade en el almacén: el `tradeId` sin la cuenta, que ya va en
 * su propia columna (`schwab:<instrumentId>:<fillId>`, con `:before` si abrió
 * antes de la historia). Es estable: la dan los IDs de Schwab del instrumento y
 * de la primera ejecución.
 */
export const tradeKeySchema = z
  .string()
  .regex(/^schwab:[0-9]{1,32}:[0-9]{1,32}(?::before)?$/u);

export function tradeKeyOf(trade: Pick<RoundTrip, "tradeId" | "accountKey">) {
  const prefix = `${trade.accountKey}:`;
  if (!trade.tradeId.startsWith(prefix)) {
    throw new Error("The trade does not belong to its own account.");
  }
  return tradeKeySchema.parse(trade.tradeId.slice(prefix.length));
}

/**
 * El segmento de la URL de un trade: los dos IDs de Schwab con un guion, y `-b`
 * si abrió antes de la historia. Nunca lleva la cuenta.
 */
export const tradeRefSchema = z
  .string()
  .regex(/^[0-9]{1,32}-[0-9]{1,32}(?:-b)?$/u);

export function tradeRefOf(tradeKey: string): string {
  const [, instrument, fill, before] = tradeKeySchema
    .parse(tradeKey)
    .split(":");
  return `${instrument}-${fill}${before === undefined ? "" : "-b"}`;
}

export function tradeKeyFromRef(ref: string): string | null {
  if (!tradeRefSchema.safeParse(ref).success) return null;
  const [instrument, fill, before] = ref.split("-");
  return `schwab:${instrument}:${fill}${before === undefined ? "" : ":before"}`;
}

/** El stop planeado como lo pide R, o `null` si no hay. */
export function plannedStopOf(
  annotation: TradeAnnotation | null,
  currency: string,
): PlannedStop | null {
  if (annotation === null || annotation.plan.stop === null) return null;
  return { price: annotation.plan.stop, currency };
}

export type AdherenceTally = {
  readonly kept: number;
  readonly broken: number;
  readonly unmarked: number;
};

export function adherenceTally(annotation: TradeAnnotation): AdherenceTally {
  const marks = ADHERENCE_RULES.map((rule) => annotation.adherence[rule]);
  return {
    kept: marks.filter((mark) => mark === "kept").length,
    broken: marks.filter((mark) => mark === "broken").length,
    unmarked: marks.filter((mark) => mark === null).length,
  };
}

export type RewardRiskReason =
  | "no_stop"
  | "no_target"
  | "entry_unknown"
  | "stop_on_wrong_side"
  | "target_on_wrong_side";

export type PlannedRewardRisk =
  | {
      readonly value: string;
      readonly entryBasis: "plan" | "fills";
      readonly reason: null;
    }
  | {
      readonly value: null;
      readonly entryBasis: null;
      readonly reason: RewardRiskReason;
    };

/**
 * Beneficio sobre riesgo planeado (`trade-plan-1.0.0`): `|target − entrada| /
 * |entrada − stop|`. La entrada es la planeada o, sin ella, el promedio de las
 * ejecuciones, y se nombra cuál. Un stop o un target del lado equivocado no es
 * una relación: es `null` con motivo.
 */
export function plannedRewardRisk(
  direction: "long" | "short",
  plan: TradePlan,
  averageEntryPrice: string | null,
): PlannedRewardRisk {
  if (plan.stop === null)
    return { value: null, entryBasis: null, reason: "no_stop" };
  if (plan.target === null) {
    return { value: null, entryBasis: null, reason: "no_target" };
  }
  const entryText = plan.entry ?? averageEntryPrice;
  if (entryText === null) {
    return { value: null, entryBasis: null, reason: "entry_unknown" };
  }
  const path = "trade-plan";
  const entry = parseDecimal(entryText, path);
  const sign = direction === "long" ? 1 : -1;
  const risk = entry.minus(parseDecimal(plan.stop, path)).times(sign);
  const reward = parseDecimal(plan.target, path).minus(entry).times(sign);
  if (!risk.greaterThan(ZERO)) {
    return { value: null, entryBasis: null, reason: "stop_on_wrong_side" };
  }
  if (!reward.greaterThan(ZERO)) {
    return { value: null, entryBasis: null, reason: "target_on_wrong_side" };
  }
  return {
    value: formatDecimal(divide(reward, risk, path), path),
    entryBasis: plan.entry === null ? "fills" : "plan",
    reason: null,
  };
}

/**
 * Un precio medido en R desde la entrada (`trade-plan-1.0.0`): `(precio −
 * entrada) / (entrada − stop)`, la misma fórmula en un largo y en un corto. El
 * stop queda en −1 R y un target bien puesto, positivo. `null` sin stop, sin
 * entrada o con el stop del lado equivocado: no hay R contra qué medir.
 */
export function priceInR(
  direction: "long" | "short",
  entry: string | null,
  stop: string | null,
  price: string,
): string | null {
  if (entry === null || stop === null) return null;
  const path = "trade-plan";
  const entryValue = parseDecimal(entry, path);
  const risk = entryValue.minus(parseDecimal(stop, path));
  const sign = direction === "long" ? 1 : -1;
  if (!risk.times(sign).greaterThan(ZERO)) return null;
  return formatDecimal(
    divide(parseDecimal(price, path).minus(entryValue), risk, path),
    path,
  );
}
