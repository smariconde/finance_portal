import { z } from "zod";

import {
  completenessCheck,
  type CompletenessCheckId,
  type CompletenessProfile,
} from "./completeness-profile";
import type { MethodSelection } from "./method-selection";

/**
 * Nivel de rigor de una corrida (`F3-03`), derivado de la selección de método y
 * del perfil de completitud. **Nunca se elige**: el motor lo recalcula desde el
 * mismo snapshot y rechaza la corrida si no coincide.
 *
 * Degradar es un resultado legítimo; inventar un faltante para subir de nivel no
 * lo es. Por eso el nivel viaja con lo que lo bajó y con las aproximaciones que
 * declara.
 */
export const RIGOR_LEVEL_VERSION = "rigor-level-1.0.0";

export const rigorLevelSchema = z.enum([
  "full",
  "standard",
  "screening",
  "unsupported",
]);

export type RigorLevel = z.infer<typeof rigorLevelSchema>;

/**
 * Aproximaciones que un nivel por debajo de `full` obliga a declarar en la
 * corrida (`docs/valuation/methodology.md`, "Nivel de rigor declarado").
 */
export const rigorDeclarationSchema = z.enum([
  /** Sin mix geográfico, el riesgo país sale del domicilio legal. */
  "country_risk_by_domicile",
  /** Sin capital invertido reconstruido: rango amplio, ROIC no confiable. */
  "invested_capital_not_reconstructed",
]);

export type RigorDeclaration = z.infer<typeof rigorDeclarationSchema>;

export const rigorAssessmentSchema = z.object({
  version: z.literal(RIGOR_LEVEL_VERSION),
  level: rigorLevelSchema,
  /**
   * Qué impidió el nivel siguiente: comprobaciones de completitud por id o
   * motivos del selector (`selection.<motivo>`).
   */
  degradedBy: z.array(z.string().trim().min(1).max(96)).max(32),
  declarations: z.array(rigorDeclarationSchema).max(4),
});

export type RigorAssessment = z.infer<typeof rigorAssessmentSchema>;

/** Lo que exige cada nivel. Una comprobación `partial` sólo alcanza donde se dice. */
const FULL_REQUIRES: readonly CompletenessCheckId[] = [
  "structural_inputs",
  "history_years",
  "cash_and_debt",
  "leases",
  "research_development",
  "reinvestment_inputs",
  "tax_rate_inputs",
  "industry_mapping",
  "geographic_revenue_mix",
];

const STANDARD_REQUIRES: readonly CompletenessCheckId[] = [
  "structural_inputs",
  "history_years",
  "industry_mapping",
];

/** `standard` acepta tres años de historia (`partial`); `full` pide cinco. */
const STANDARD_ACCEPTS_PARTIAL: ReadonlySet<CompletenessCheckId> = new Set([
  "history_years",
]);

function unmet(
  profile: CompletenessProfile,
  required: readonly CompletenessCheckId[],
  acceptsPartial: ReadonlySet<CompletenessCheckId>,
): CompletenessCheckId[] {
  return required.filter((id) => {
    const { status } = completenessCheck(profile, id);
    return !(
      status === "met" ||
      (status === "partial" && acceptsPartial.has(id))
    );
  });
}

export function deriveRigorLevel(
  selection: MethodSelection,
  completeness: CompletenessProfile,
): RigorAssessment {
  if (selection.status !== "selected") {
    return {
      version: RIGOR_LEVEL_VERSION,
      level: "unsupported",
      degradedBy: selection.unsupportedReasons.map(
        (reason) => `selection.${reason}`,
      ),
      declarations: [],
    };
  }

  const structural = completenessCheck(completeness, "structural_inputs");
  if (structural.status !== "met") {
    return {
      version: RIGOR_LEVEL_VERSION,
      level: "unsupported",
      degradedBy: ["structural_inputs"],
      declarations: [],
    };
  }

  const geographic =
    completenessCheck(completeness, "geographic_revenue_mix").status === "met";
  const declarations: RigorDeclaration[] = geographic
    ? []
    : ["country_risk_by_domicile"];

  const forFull = unmet(completeness, FULL_REQUIRES, new Set());
  if (forFull.length === 0) {
    return {
      version: RIGOR_LEVEL_VERSION,
      level: "full",
      degradedBy: [],
      declarations: [],
    };
  }

  const forStandard = unmet(
    completeness,
    STANDARD_REQUIRES,
    STANDARD_ACCEPTS_PARTIAL,
  );
  if (forStandard.length === 0) {
    return {
      version: RIGOR_LEVEL_VERSION,
      level: "standard",
      degradedBy: forFull,
      declarations,
    };
  }

  return {
    version: RIGOR_LEVEL_VERSION,
    level: "screening",
    degradedBy: forStandard,
    declarations: [...declarations, "invested_capital_not_reconstructed"],
  };
}
