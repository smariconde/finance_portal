import {
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import { fade, measuredGrowth } from "./derived-assumptions";
import { financialCostOfEquity } from "./excess-return";
import {
  DERIVED_REIT_VERSION,
  type DerivedReit,
  type ReitAssumptions,
  type ReitInput,
} from "./reit-input";

/**
 * `derived-reit-1.0.0` (ADR 0064): los supuestos de un REIT de propiedades
 * desde lo guardado, sin IA ni declaraciones.
 *
 * - El crecimiento inicial del AFFO es la tendencia log-lineal de las ventas,
 *   con piso cero y techo en `retención máxima × retorno sobre equity nuevo`:
 *   un REIT distribuye la mayor parte de su caja y no puede crecer más de lo
 *   que retiene. Se sostiene cinco años y converge al risk-free en el décimo.
 * - El retorno sobre equity nuevo arranca en AFFO ÷ patrimonio común y
 *   converge al costo de equity terminal: a perpetuidad el crecimiento no crea
 *   valor.
 * - La beta es la publicada de la industria y converge a 1 en diez años.
 * - Sin NAV, escenarios ni sensibilidad: no hay cap rate fechado.
 */
export const DERIVED_REIT_HORIZON = 10;

/** Techo de retención del AFFO: decisión del proyecto, nombrada en la ADR. */
export const REIT_RETENTION_CEILING = "0.3";

/** Inmuebles netos sobre activo total a partir del cual es de propiedades. */
export const REIT_PROPERTY_SHARE_FLOOR = "0.5";

export function reitPropertyShare(
  realEstatePropertyNet: string,
  assets: string,
): Dec | null {
  const property = parseDecimal(realEstatePropertyNet, "realEstatePropertyNet");
  const total = parseDecimal(assets, "assets");
  if (!total.gt(ZERO) || property.lt(ZERO)) return null;
  return divide(property, total, "propertyShare");
}

export function isEquityPropertyShare(share: Dec): boolean {
  return share.gte(parseDecimal(REIT_PROPERTY_SHARE_FLOOR, "floor"));
}

/**
 * `null` cuando la regla no puede derivar: AFFO o patrimonio no positivos, o
 * menos de tres ejercicios de ventas. La corrida nunca rellena lo que falta.
 */
export function deriveReitAssumptions(
  input: Pick<ReitInput, "risk">,
  derived: DerivedReit,
  affo: Dec,
): ReitAssumptions | null {
  const equity = parseDecimal(derived.commonEquity.value, "commonEquity");
  if (
    !affo.gt(ZERO) ||
    !equity.gt(ZERO) ||
    derived.revenueHistory.length < 3 ||
    derived.revenueHistory.some(
      (year) => !parseDecimal(year.value, "revenue").gt(ZERO),
    ) ||
    input.risk.riskFree === null
  )
    return null;
  const riskFree = parseDecimal(input.risk.riskFree.value, "riskFree");
  const beta = parseDecimal(derived.equityBeta.value, "equityBeta");
  const terminalKe = financialCostOfEquity(input, "1");
  const startReturn = divide(affo, equity, "returnOnEquity");
  const trend = measuredGrowth(derived.revenueHistory).trend;
  const ceiling = startReturn.times(
    parseDecimal(REIT_RETENTION_CEILING, "retentionCeiling"),
  );
  const startGrowth = maxOf(ZERO, minOf(trend, ceiling));
  const terminalGrowth = riskFree.gt(ZERO) ? riskFree : ZERO;
  const format = (value: Dec, label: string) => formatDecimal(value, label);
  const periods = Array.from({ length: DERIVED_REIT_HORIZON }, (_, index) => {
    const year = index + 1;
    const fraction = divide(
      parseDecimal(String(year), "year"),
      parseDecimal(String(DERIVED_REIT_HORIZON), "horizon"),
      "fraction",
    );
    return {
      affoGrowth: format(fade(startGrowth, terminalGrowth, year), "growth"),
      returnOnNewEquity: format(
        fade(startReturn, terminalKe, year),
        "returnOnNewEquity",
      ),
      equityBeta: format(
        year === 1 ? beta : beta.plus(ONE.minus(beta).times(fraction)),
        "equityBeta",
      ),
    };
  });
  return {
    rationale: `${DERIVED_REIT_VERSION}: AFFO growth starts at the log-linear revenue trend, floored at zero and capped at ${REIT_RETENTION_CEILING} × AFFO/common equity, held five years and converging to the risk-free; return on new equity converges to the terminal cost of equity; industry beta converges to 1.`,
    periods,
    terminal: {
      growth: format(terminalGrowth, "terminal.growth"),
      returnOnNewEquity: format(terminalKe, "terminal.returnOnNewEquity"),
      equityBeta: "1",
    },
    nav: null,
  };
}

function maxOf(left: Dec, right: Dec): Dec {
  return left.gt(right) ? left : right;
}

function minOf(left: Dec, right: Dec): Dec {
  return left.lt(right) ? left : right;
}
