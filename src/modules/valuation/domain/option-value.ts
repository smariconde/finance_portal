import {
  assertFinite,
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Valor de las opciones de empleados vivas (`F4-05`, ADR 0040,
 * `option-value-dilution-1.0.0`): Black-Scholes con rendimiento de dividendos
 * y el ajuste por dilución de Damodaran.
 *
 * ```text
 * d1 = [ ln(S/K) + (r − y + σ²/2)·t ] / (σ·√t)
 * d2 = d1 − σ·√t
 * C  = S·e^(−y·t)·N(d1) − K·e^(−r·t)·N(d2)
 *
 * S_adj = (S·n + W·m) / (n + m)        W = C(S_adj), hasta converger
 * valor = W·m
 * ```
 *
 * Ejercer una opción emite acciones nuevas a `K`, así que el precio que la
 * opción ve no es `S` sino el que queda después de la dilución: Damodaran lo
 * resuelve con el precio ajustado, que depende del valor de la opción y se
 * itera hasta que deja de moverse. Converge porque `dC/dS ≤ 1` y `m / (n + m)`
 * es menor que uno.
 *
 * El valor es antes de impuestos: el ahorro fiscal del ejercicio no se resta,
 * así que el ajuste nunca hace parecer la acción más valiosa de lo que es.
 */
export const OPTION_VALUE_VERSION = "option-value-dilution-1.0.0";

/** Iteraciones del precio ajustado antes de declarar que no converge. */
export const MAX_DILUTION_ITERATIONS = 200;
/** Cambio del valor por opción por debajo del cual el precio ajustado se fija. */
export const DILUTION_TOLERANCE = "0.000000000000000000000001";

/**
 * `|x|` a partir del cual la normal acumulada se fija en cero o uno: más allá
 * de 38 desvíos la cola es menor que 1e-300 y la serie sólo gastaría tiempo.
 */
const NORMAL_SATURATION = 38;
const MAX_SERIES_TERMS = 5000;
/** Un término por debajo de esta fracción de la suma ya no la mueve. */
const SERIES_CUTOFF = ONE.div(ONE.times(10).pow(40));

const PI = ONE.negated().acos();
const SQRT_TWO = ONE.plus(ONE).sqrt();

/**
 * Normal estándar acumulada en aritmética decimal, sin pasar por `double`.
 *
 * `erf(z) = (2/√π)·e^(−z²)·Σ (2z²)^n·z / (1·3·…·(2n+1))`: todos los términos
 * son positivos, así que la suma no pierde precisión por cancelación, y para
 * `x < 0` vale `N(x) = 1 − N(−x)`.
 */
export function standardNormalCdf(x: Dec): Dec {
  if (x.abs().gte(NORMAL_SATURATION)) {
    return x.isNeg() ? ZERO : ONE;
  }

  if (x.isNeg()) {
    return ONE.minus(standardNormalCdf(x.negated()));
  }

  const z = x.div(SQRT_TWO);
  const twoZSquared = z.times(z).times(2);
  let term = z;
  let total = z;

  for (let n = 1; n < MAX_SERIES_TERMS; n += 1) {
    term = term.times(twoZSquared).div(2 * n + 1);
    total = total.plus(term);

    // Los términos crecen hasta `n ≈ z²` y después decaen: sólo se corta en la
    // cola, cuando el término ya no mueve la suma.
    if (n > twoZSquared.toNumber() && term.lte(total.times(SERIES_CUTOFF))) {
      const erf = total
        .times(2)
        .div(PI.sqrt())
        .times(z.times(z).negated().exp());

      return ONE.plus(erf).div(2);
    }
  }

  throw new ValuationPolicyError(
    "non_finite_value",
    "The standard normal series did not converge.",
    ["standardNormalCdf"],
  );
}

export type BlackScholesInput = {
  /** Precio de la acción. */
  price: Dec;
  strike: Dec;
  /** Años hasta el vencimiento. */
  maturity: Dec;
  volatility: Dec;
  riskFree: Dec;
  dividendYield: Dec;
};

/**
 * Call europeo de Black-Scholes con rendimiento de dividendos. Con volatilidad
 * o plazo cero el valor es el límite: el máximo entre cero y el precio
 * descontado menos el strike descontado.
 */
export function blackScholesCall(input: BlackScholesInput): Dec {
  const { price, strike, maturity, volatility, riskFree, dividendYield } =
    input;
  const discountedPrice = price.times(
    dividendYield.times(maturity).negated().exp(),
  );
  const discountedStrike = strike.times(
    riskFree.times(maturity).negated().exp(),
  );

  if (strike.isZero()) {
    return discountedPrice;
  }

  if (volatility.isZero() || maturity.isZero()) {
    const intrinsic = discountedPrice.minus(discountedStrike);

    return intrinsic.gt(ZERO) ? intrinsic : ZERO;
  }

  const deviation = volatility.times(maturity.sqrt());
  const d1 = divide(
    divide(price, strike, "options.strike")
      .ln()
      .plus(
        riskFree
          .minus(dividendYield)
          .plus(volatility.times(volatility).div(2))
          .times(maturity),
      ),
    deviation,
    "options.volatility",
  );
  const d2 = d1.minus(deviation);

  return assertFinite(
    discountedPrice
      .times(standardNormalCdf(d1))
      .minus(discountedStrike.times(standardNormalCdf(d2))),
    "options.callValue",
  );
}

export type OptionValueInput = {
  price: string;
  strike: string;
  maturityYears: string;
  volatility: string;
  riskFree: string;
  dividendYield: string;
  optionsOutstanding: string;
  sharesOutstanding: string;
};

export type OptionValue = {
  version: typeof OPTION_VALUE_VERSION;
  adjustedPrice: string;
  valuePerOption: string;
  totalValue: string;
  iterations: number;
};

/**
 * Valor de las opciones vivas con el precio ajustado por dilución. Cada
 * insumo inválido —precio, acciones o cantidad no positivos, strike, plazo o
 * volatilidad negativos— se rechaza con su ruta, nunca se recorta a cero.
 */
export function valueEmployeeOptions(input: OptionValueInput): OptionValue {
  const path = "employeeEquity.options";
  const price = parseDecimal(input.price, `${path}.price`);
  const strike = parseDecimal(input.strike, `${path}.strike`);
  const maturity = parseDecimal(input.maturityYears, `${path}.maturityYears`);
  const volatility = parseDecimal(input.volatility, `${path}.volatility`);
  const riskFree = parseDecimal(input.riskFree, `${path}.riskFree`);
  const dividendYield = parseDecimal(
    input.dividendYield,
    `${path}.dividendYield`,
  );
  const options = parseDecimal(input.optionsOutstanding, `${path}.count`);
  const shares = parseDecimal(input.sharesOutstanding, `${path}.shares`);

  const invalid = [
    price.lte(ZERO) ? `${path}.price` : null,
    strike.isNeg() ? `${path}.strike` : null,
    maturity.isNeg() ? `${path}.maturityYears` : null,
    volatility.isNeg() ? `${path}.volatility` : null,
    dividendYield.isNeg() ? `${path}.dividendYield` : null,
    options.lte(ZERO) ? `${path}.count` : null,
    shares.lte(ZERO) ? `${path}.shares` : null,
  ].filter((subject): subject is string => subject !== null);

  if (invalid.length > 0) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Option inputs must be positive prices and counts and non-negative strike, maturity, volatility and yield.",
      invalid,
    );
  }

  const tolerance = parseDecimal(DILUTION_TOLERANCE, "options.tolerance");
  const outstanding = shares.plus(options);
  const call = (adjusted: Dec) =>
    blackScholesCall({
      price: adjusted,
      strike,
      maturity,
      volatility,
      riskFree,
      dividendYield,
    });

  let valuePerOption = call(price);
  let adjustedPrice = price;

  for (
    let iteration = 1;
    iteration <= MAX_DILUTION_ITERATIONS;
    iteration += 1
  ) {
    adjustedPrice = price
      .times(shares)
      .plus(valuePerOption.times(options))
      .div(outstanding);
    const next = call(adjustedPrice);
    const converged = next.minus(valuePerOption).abs().lte(tolerance);

    valuePerOption = next;

    if (converged) {
      return {
        version: OPTION_VALUE_VERSION,
        adjustedPrice: formatDecimal(adjustedPrice, `${path}.adjustedPrice`),
        valuePerOption: formatDecimal(valuePerOption, `${path}.valuePerOption`),
        totalValue: formatDecimal(
          valuePerOption.times(options),
          `${path}.totalValue`,
        ),
        iterations: iteration,
      };
    }
  }

  throw new ValuationPolicyError(
    "non_finite_value",
    `The dilution-adjusted price did not converge in ${MAX_DILUTION_ITERATIONS} iterations.`,
    [`${path}.adjustedPrice`],
  );
}
