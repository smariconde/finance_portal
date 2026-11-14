import type {
  AdherenceRule,
  Emotion,
  RewardRiskReason,
} from "@/modules/trading/domain/trade-annotation";
import type { RMultipleReason } from "@/modules/trading/domain/trade-r-multiple";

/** Cómo se nombran en pantalla las anotaciones del diario (`F11-07`). */
export const EMOTION_LABELS: Readonly<Record<Emotion, string>> = {
  calm: "Calma",
  focused: "Foco",
  confident: "Confianza",
  anxious: "Ansiedad",
  fomo: "FOMO",
  revenge: "Revancha",
  tired: "Cansancio",
  bored: "Aburrimiento",
};

export const ADHERENCE_LABELS: Readonly<Record<AdherenceRule, string>> = {
  entry: "Entrada",
  stop: "Stop",
  target: "Target",
  size: "Tamaño",
};

export const R_REASON_LABELS: Readonly<Record<RMultipleReason, string>> = {
  no_planned_stop: "Sin stop planeado",
  pnl_unknown: "Sin P&L realizado",
  entry_unknown: "Sin entrada en la historia",
  currency_mismatch: "Otra moneda",
  stop_on_wrong_side: "Stop del lado equivocado",
  zero_risk: "Stop igual a la entrada",
};

export const REWARD_RISK_REASON_LABELS: Readonly<
  Record<RewardRiskReason, string>
> = {
  no_stop: "Sin stop",
  no_target: "Sin target",
  entry_unknown: "Sin entrada",
  stop_on_wrong_side: "Stop del lado equivocado",
  target_on_wrong_side: "Target del lado equivocado",
};
