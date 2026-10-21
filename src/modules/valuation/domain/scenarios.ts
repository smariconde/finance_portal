import { deriveRevenueMargin } from "./revenue-margin";
import { z } from "zod";
import { deriveCycleNormalization } from "./cycle-normalization";
import { formatDecimal } from "./decimal-policy";

import {
  engineDecimalSchema,
  parseDecimal,
  rateSchema,
} from "./decimal-policy";
import type {
  PeriodAssumption,
  TerminalAssumption,
  ValuationInput,
} from "./valuation-input";

/**
 * Escenarios bear/base/bull (`F4-04`, ADR 0039, `scenario-set-1.0.0`).
 *
 * Un escenario es un **conjunto de supuestos**, nunca un multiplicador sobre el
 * resultado: declara qué drivers cambian, a qué valor y por qué, y el motor
 * recalcula la proyección entera con ellos. La base es la corrida misma —sus
 * períodos y su terminal—, así que el número principal sigue siendo una celda
 * de la sensibilidad. Bear y bull viajan en el mismo snapshot: un `input_hash`
 * cubre los tres.
 *
 * Lo que un escenario **no** mueve, por decisión del owner: el costo de capital
 * (los `wacc` salen de componentes fechados, y la incertidumbre de tasa es la
 * sensibilidad WACC/g), la tasa impositiva (la deriva la normalización), los
 * hechos del ejercicio base y el puente EV-equity. Tampoco lleva probabilidad:
 * no hay base defendible para declararla, así que el rango no se pondera.
 */
export const SCENARIO_SET_VERSION = "scenario-set-1.0.0";

export const SCENARIO_KEYS = ["bear", "bull"] as const;

export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

const rationaleSchema = z.string().trim().min(1).max(512);

/** Drivers por período: un valor por período explícito, `null` lo deja igual. */
export const PERIOD_SCENARIO_DRIVERS = [
  "revenueGrowth",
  "ebitMargin",
  "salesToCapital",
  "returnOnCapital",
] as const;

/** Drivers del terminal: un único valor. */
export const TERMINAL_SCENARIO_DRIVERS = [
  "terminalGrowth",
  "terminalEbitMargin",
  "terminalReturnOnCapital",
] as const;

export type PeriodScenarioDriver = (typeof PERIOD_SCENARIO_DRIVERS)[number];
export type TerminalScenarioDriver = (typeof TERMINAL_SCENARIO_DRIVERS)[number];
export type ScenarioDriverKey = PeriodScenarioDriver | TerminalScenarioDriver;

export const scenarioDriverSchema = z.discriminatedUnion("driver", [
  z.object({
    driver: z.enum(PERIOD_SCENARIO_DRIVERS),
    values: z.array(engineDecimalSchema.nullable()).min(1).max(20),
    rationale: rationaleSchema,
  }),
  z.object({
    driver: z.enum(TERMINAL_SCENARIO_DRIVERS),
    value: rateSchema,
    rationale: rationaleSchema,
  }),
]);

export type ScenarioDriver = z.infer<typeof scenarioDriverSchema>;

export const scenarioSchema = z
  .object({
    /** Qué historia cuenta el escenario: los drivers la sostienen. */
    thesis: rationaleSchema,
    drivers: z
      .array(scenarioDriverSchema)
      .min(1)
      .max(PERIOD_SCENARIO_DRIVERS.length + TERMINAL_SCENARIO_DRIVERS.length),
  })
  .superRefine((scenario, context) => {
    const seen = new Set<string>();

    scenario.drivers.forEach((driver, index) => {
      if (seen.has(driver.driver)) {
        context.addIssue({
          code: "custom",
          path: ["drivers", index, "driver"],
          message: "A scenario declares each driver at most once.",
        });
      }

      seen.add(driver.driver);
    });
  });

export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioSetSchema = z.object({
  version: z.literal(SCENARIO_SET_VERSION),
  bear: scenarioSchema,
  bull: scenarioSchema,
});

export type ScenarioSet = z.infer<typeof scenarioSetSchema>;

function isPeriodDriver(
  driver: ScenarioDriver,
): driver is Extract<ScenarioDriver, { values: unknown }> {
  return "values" in driver;
}

function periodBaseValue(
  period: PeriodAssumption,
  driver: PeriodScenarioDriver,
): string | null {
  switch (driver) {
    case "revenueGrowth":
      return period.revenueGrowth;
    case "ebitMargin":
      return period.ebitMargin;
    case "salesToCapital":
      return period.reinvestment.convention === "sales_to_capital"
        ? period.reinvestment.salesToCapital
        : null;
    case "returnOnCapital":
      return period.reinvestment.convention === "return_on_capital"
        ? period.reinvestment.returnOnCapital
        : null;
  }
}

function terminalBaseValue(
  terminal: TerminalAssumption,
  driver: TerminalScenarioDriver,
): string {
  switch (driver) {
    case "terminalGrowth":
      return terminal.growth;
    case "terminalEbitMargin":
      return terminal.ebitMargin;
    case "terminalReturnOnCapital":
      return terminal.returnOnCapital;
  }
}

/**
 * Rutas de los drivers que el snapshot no admite. Un escenario cambia un
 * supuesto que la base tiene, en la convención que la base usa —cambiar de
 * convención sería otro modelo, no otro escenario—, y cada valor declarado
 * cambia algo: un driver igual a la base es un motivo sin efecto.
 */
export function scenarioDriverMismatches(
  input: Pick<ValuationInput, "periods" | "terminal">,
  key: ScenarioKey,
  scenario: Scenario,
): string[] {
  const mismatches: string[] = [];

  scenario.drivers.forEach((driver, index) => {
    const path = `scenarios.${key}.drivers.${index}`;

    if (isPeriodDriver(driver)) {
      if (driver.values.length !== input.periods.length) {
        mismatches.push(`${path}.values`);
        return;
      }

      if (driver.values.every((value) => value === null)) {
        mismatches.push(`${path}.values`);
        return;
      }

      driver.values.forEach((value, periodIndex) => {
        if (value === null) {
          return;
        }

        const period = input.periods[periodIndex];
        const base =
          period === undefined ? null : periodBaseValue(period, driver.driver);

        if (
          base === null ||
          parseDecimal(value, `${path}.values.${periodIndex}`).eq(
            parseDecimal(base, `periods.${periodIndex}`),
          )
        ) {
          mismatches.push(`${path}.values.${periodIndex}`);
        }
      });

      return;
    }

    if (
      parseDecimal(driver.value, `${path}.value`).eq(
        parseDecimal(
          terminalBaseValue(input.terminal, driver.driver),
          `terminal.${driver.driver}`,
        ),
      )
    ) {
      mismatches.push(`${path}.value`);
    }
  });

  return mismatches;
}

function applyPeriodDriver(
  period: PeriodAssumption,
  driver: PeriodScenarioDriver,
  value: string,
): PeriodAssumption {
  switch (driver) {
    case "revenueGrowth":
      return { ...period, revenueGrowth: value };
    case "ebitMargin":
      return { ...period, ebitMargin: value };
    case "salesToCapital":
      return period.reinvestment.convention === "sales_to_capital"
        ? {
            ...period,
            reinvestment: { ...period.reinvestment, salesToCapital: value },
          }
        : period;
    case "returnOnCapital":
      return period.reinvestment.convention === "return_on_capital"
        ? {
            ...period,
            reinvestment: { ...period.reinvestment, returnOnCapital: value },
          }
        : period;
  }
}

function applyTerminalDriver(
  terminal: TerminalAssumption,
  driver: TerminalScenarioDriver,
  value: string,
): TerminalAssumption {
  switch (driver) {
    case "terminalGrowth":
      return { ...terminal, growth: value };
    case "terminalEbitMargin":
      return { ...terminal, ebitMargin: value };
    case "terminalReturnOnCapital":
      return { ...terminal, returnOnCapital: value };
  }
}

/**
 * El snapshot completo de un escenario: la base con sus drivers reemplazados y
 * sin escenarios ni sensibilidad propios. Es un `ValuationInput` válido, así
 * que el motor lo valúa entero y los checks lo juzgan igual que a la base: un
 * escenario no tiene reglas más blandas.
 */
export function materializeScenario(
  input: ValuationInput,
  scenario: Scenario,
): ValuationInput {
  let periods = input.periods;
  let terminal = input.terminal;
  let cycleNormalization = input.cycleNormalization;
  let revenueMargin = input.revenueMargin;

  for (const driver of scenario.drivers) {
    if (isPeriodDriver(driver)) {
      periods = periods.map((period, index) => {
        const value = driver.values[index];

        return value === null || value === undefined
          ? period
          : applyPeriodDriver(period, driver.driver, value);
      });
      if (revenueMargin !== undefined && driver.driver === "revenueGrowth") {
        revenueMargin = {
          ...revenueMargin,
          initialRevenueGrowth:
            driver.values[0] ?? revenueMargin.initialRevenueGrowth,
        };
      }
    } else {
      if (
        revenueMargin !== undefined &&
        driver.driver === "terminalEbitMargin"
      ) {
        revenueMargin = { ...revenueMargin, targetMargin: driver.value };
      }
      terminal = applyTerminalDriver(terminal, driver.driver, driver.value);
      if (
        input.method === "normalized_fcff" &&
        cycleNormalization !== undefined &&
        driver.driver === "terminalEbitMargin"
      ) {
        const cycle = deriveCycleNormalization(
          cycleNormalization,
          input.baseRevenue.value,
          input.normalization.base.ebitAdjusted,
          periods.length,
        );
        cycleNormalization = {
          ...cycleNormalization,
          marginShift: {
            value: formatDecimal(
              parseDecimal(driver.value, "margin").minus(
                parseDecimal(cycle.historicalMargin, "margin"),
              ),
              "marginShift",
            ),
            rationale: driver.rationale,
          },
        };
        const changed = deriveCycleNormalization(
          cycleNormalization,
          input.baseRevenue.value,
          input.normalization.base.ebitAdjusted,
          periods.length,
        );
        periods = periods.map((period, index) => ({
          ...period,
          ebitMargin: changed.periodMargins[index]!,
        }));
      }
    }
  }

  if (revenueMargin !== undefined) {
    const path = deriveRevenueMargin(
      revenueMargin,
      input.baseRevenue.value,
      input.normalization.base.ebitAdjusted,
      periods.length,
      terminal.growth,
    );
    const declaredGrowth = scenario.drivers.some(
      (driver) => driver.driver === "revenueGrowth",
    );
    periods = periods.map((period, index) => ({
      ...period,
      ebitMargin: path.periodMargins[index]!,
      revenueGrowth: declaredGrowth
        ? period.revenueGrowth
        : path.periodGrowth[index]!,
    }));
  }
  // La derivación es de la base: sus escenarios ya los verifica el check de la
  // base (`F6-10`), y un escenario no es la regla que lo armó.
  return {
    ...input,
    derivedAssumptions: undefined,
    ...(revenueMargin === undefined ? {} : { revenueMargin }),
    ...(cycleNormalization === undefined ? {} : { cycleNormalization }),
    periods,
    terminal,
    scenarios: null,
    sensitivity: null,
  };
}
