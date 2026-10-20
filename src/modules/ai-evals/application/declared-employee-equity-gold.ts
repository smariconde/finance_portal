import type { EmployeeEquityGold } from "../domain/eval-cases";

/**
 * F4-05 / ADR 0035 decision 3: proposed from direct reading of the frozen SEC
 * notes. The owner explicitly confirmed all ten entries on 2026-10-20,
 * including Ford's unknown strike and XOM's mixed cash-settled-unit limitation.
 * No model output or personal database identifier is included.
 */
export const DECLARED_EMPLOYEE_EQUITY_GOLD: readonly (EmployeeEquityGold & {
  readonly cik: string;
})[] = Object.freeze([
  {
    cik: "0000200406",
    output: {
      decision: "proposed",
      scale: "thousands",
      optionsStatus: "outstanding",
      optionsCount: "93,072",
      optionsCountQuote: "Shares at December 28, 2025 93,072 $151.14 $5,257",
      optionsStrike: "151.14",
      optionsStrikeQuote: "Shares at December 28, 2025 93,072 $151.14 $5,257",
      optionsLifeBasis: "remaining_years",
      optionsLife: "5.5",
      optionsLifeQuote: "93,072 5.5 $151.14 67,512 $148.49",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "12,136",
          quote: "Shares at December 28, 2025 12,136 2,111",
        },
        {
          kind: "performance",
          count: "2,111",
          quote: "Shares at December 28, 2025 12,136 2,111",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Opciones vivas y promedio contractual total; RSU y PSU por separado al cierre, todo en miles.",
    review: "owner_reviewed",
  },
  {
    cik: "0001108524",
    output: {
      decision: "proposed",
      scale: "millions",
      optionsStatus: "outstanding",
      optionsCount: "6",
      optionsCountQuote: "Balance as of January 31, 2026 87 6 $ 207.54 $ 137",
      optionsStrike: "207.54",
      optionsStrikeQuote: "Balance as of January 31, 2026 87 6 $ 207.54 $ 137",
      optionsLifeBasis: "remaining_years",
      optionsLife: "2.8",
      optionsLifeQuote:
        "The weighted-average remaining contractual life of vested and expected to vest options is approximately 2.8 years.",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "combined",
          count: "26",
          quote: "Balance as of January 31, 2026 26 $ 265.64 $ 5,332",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "La tabla de actividad informa 6 M de opciones y 26 M de unidades combinadas; el 25 M de acciones reservadas de otra tabla no reemplaza el saldo de premios. Plazo del total 2,8 años.",
    review: "owner_reviewed",
  },
  {
    cik: "0000018230",
    output: {
      decision: "proposed",
      scale: "units",
      optionsStatus: "outstanding",
      optionsCount: "3,017,053",
      optionsCountQuote:
        "Outstanding at December 31, 2025 3,017,053 $ 220.52 5.81 $ 1,063",
      optionsStrike: "220.52",
      optionsStrikeQuote:
        "Outstanding at December 31, 2025 3,017,053 $ 220.52 5.81 $ 1,063",
      optionsLifeBasis: "remaining_years",
      optionsLife: "5.81",
      optionsLifeQuote:
        "Outstanding at December 31, 2025 3,017,053 $ 220.52 5.81 $ 1,063",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "878,830",
          quote:
            "Outstanding at December 31, 2025 878,830 $ 338.27 364,284 $ 374.52",
        },
        {
          kind: "performance",
          count: "364,284",
          quote:
            "Outstanding at December 31, 2025 878,830 $ 338.27 364,284 $ 374.52",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Las tablas de premios tienen cantidades en acciones; los millones califican el valor intrínseco en dólares, no esas cantidades.",
    review: "owner_reviewed",
  },
  {
    cik: "0001682852",
    output: {
      decision: "proposed",
      scale: "millions",
      optionsStatus: "outstanding",
      optionsCount: "27.18",
      optionsCountQuote:
        "Outstanding at December 31, 2025 27.18 38.63 4.8 years 153",
      optionsStrike: "38.63",
      optionsStrikeQuote:
        "Outstanding at December 31, 2025 27.18 38.63 4.8 years 153",
      optionsLifeBasis: "remaining_years",
      optionsLife: "4.8",
      optionsLifeQuote:
        "Outstanding at December 31, 2025 27.18 38.63 4.8 years 153",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "combined",
          count: "11.20",
          quote: "Outstanding, non-vested at December 31, 2025 11.20 46.11",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Opciones y unidades combinadas en millones; plazo remanente de opciones vivas 4,8 y no el supuesto de 5,54 de nuevos grants.",
    review: "owner_reviewed",
  },
  {
    cik: "0000320193",
    output: {
      decision: "proposed",
      scale: "thousands",
      optionsStatus: "none_disclosed",
      optionsCount: null,
      optionsCountQuote: null,
      optionsStrike: null,
      optionsStrikeQuote: null,
      optionsLifeBasis: null,
      optionsLife: null,
      optionsLifeQuote: null,
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "151,574",
          quote: "Balance as of September 27, 2025 151,574 $ 189.75",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "RSU en miles; la autorización para conceder opciones no es una tabla de opciones vivas y el mismo filing no publica cantidad XBRL.",
    review: "owner_reviewed",
  },
  {
    cik: "0000037996",
    output: {
      decision: "proposed",
      scale: "millions",
      optionsStatus: "outstanding",
      optionsCount: "4.2",
      optionsCountQuote:
        "At December 31, 2024 and 2025, stock options outstanding were 4.7 million and 4.2 million, respectively.",
      optionsStrike: null,
      optionsStrikeQuote: null,
      optionsLifeBasis: "expiration_year",
      optionsLife: "2030",
      optionsLifeQuote:
        "As of December 31, 2025, all of our stock options are fully vested and will expire in 2030",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "104.2",
          quote: "Outstanding, end of year (b) 104.2 12.04",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Plazo como vencimiento en 2030, que el código lleva al 31/12; strike desconocido con cota superior, no cero reportado. Excluye las acciones de directores ya vested.",
    review: "owner_reviewed",
  },
  {
    cik: "0000879169",
    output: {
      decision: "proposed",
      scale: "units",
      optionsStatus: "outstanding",
      optionsCount: "10,859,861",
      optionsCountQuote: "Balance at December 31, 2025 10,859,861 $ 83.46",
      optionsStrike: "83.46",
      optionsStrikeQuote: "Balance at December 31, 2025 10,859,861 $ 83.46",
      optionsLifeBasis: "range_rows",
      optionsLife: null,
      optionsLifeQuote: null,
      optionsRanges: [
        {
          count: "1,147,054",
          life: "7.3",
          quote: "$52.94 - $61.76 1,147,054 7.3 $ 60.83 720,211 $ 60.91",
        },
        {
          count: "1,477,011",
          life: "7.1",
          quote: "$62.03 - $68.62 1,477,011 7.1 66.70 642,215 67.16",
        },
        {
          count: "1,275,187",
          life: "6.1",
          quote: "$68.70 - $72.27 1,275,187 6.1 71.69 786,369 71.94",
        },
        {
          count: "1,112,675",
          life: "5.8",
          quote: "$72.66 - $77.67 1,112,675 5.8 75.63 1,012,061 75.54",
        },
        {
          count: "1,603,241",
          life: "5.1",
          quote: "$77.83 - $83.58 1,603,241 5.1 82.25 1,540,401 82.25",
        },
        {
          count: "1,456,611",
          life: "3.9",
          quote: "$83.83 - $90.56 1,456,611 3.9 86.66 1,347,601 86.78",
        },
        {
          count: "1,523,552",
          life: "3.5",
          quote: "$90.92 - $106.47 1,523,552 3.5 100.00 1,456,431 99.91",
        },
        {
          count: "1,149,228",
          life: "1.2",
          quote: "$113.64 - $128.34 1,149,228 1.2 118.77 1,149,228 118.77",
        },
        {
          count: "97,860",
          life: "1.2",
          quote: "$132.00 - $134.38 97,860 1.2 134.02 97,860 134.02",
        },
        {
          count: "17,442",
          life: "1.3",
          quote: "$138.52 - $138.52 17,442 1.3 138.52 17,442 138.52",
        },
      ],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "combined",
          count: "9,275,450",
          quote: "Balance at December 31, 2025 9,275,450 $ 66.86",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Cantidad y strike del total; diez tramos de vida que el código promedia ponderando cantidades. RSU y PSU en una sola línea.",
    review: "owner_reviewed",
  },
  {
    cik: "0001053507",
    output: {
      decision: "proposed",
      scale: "units",
      optionsStatus: "outstanding",
      optionsCount: "133,623",
      optionsCountQuote:
        "Outstanding as of December 31, 2025 133,623 $ 94.82 0.2 $ 10.8",
      optionsStrike: "94.82",
      optionsStrikeQuote:
        "Outstanding as of December 31, 2025 133,623 $ 94.82 0.2 $ 10.8",
      optionsLifeBasis: "remaining_years",
      optionsLife: "0.2",
      optionsLifeQuote:
        "Outstanding as of December 31, 2025 133,623 $ 94.82 0.2 $ 10.8",
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "1,283,669",
          quote:
            "Outstanding as of December 31, 2025 1,283,669 $ 209.96 333,401 $ 204.70",
        },
        {
          kind: "performance",
          count: "333,401",
          quote:
            "Outstanding as of December 31, 2025 1,283,669 $ 209.96 333,401 $ 204.70",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Cantidades completas, como declara cada tabla; 0,2 años de vida restante y unidades pendientes, sin las 21.664 vested and deferred.",
    review: "owner_reviewed",
  },
  {
    cik: "0002115436",
    output: {
      decision: "proposed",
      scale: "thousands",
      optionsStatus: "none_disclosed",
      optionsCount: null,
      optionsCountQuote: null,
      optionsStrike: null,
      optionsStrikeQuote: null,
      optionsLifeBasis: null,
      optionsLife: null,
      optionsLifeQuote: null,
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "restricted",
          count: "40,654",
          quote: "Issued and outstanding at December 31 40,654 92.45",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Saldo total de restricted stock y unidades de la nota, en miles; incluye unidades liquidadas en efectivo que la nota no separa en ese saldo (convención conservadora de la tarea). No hay tabla de opciones vivas ni hecho XBRL de ese filing.",
    review: "owner_reviewed",
  },
  {
    cik: "0001045810",
    output: {
      decision: "proposed",
      scale: "millions",
      optionsStatus: "none_disclosed",
      optionsCount: null,
      optionsCountQuote: null,
      optionsStrike: null,
      optionsStrikeQuote: null,
      optionsLifeBasis: null,
      optionsLife: null,
      optionsLifeQuote: null,
      optionsRanges: [],
      unitsStatus: "outstanding",
      units: [
        {
          kind: "combined",
          count: "189",
          quote: "Balance as of Jan 25, 2026 189 $ 81.51",
        },
      ],
      confidence: "high",
      rationale: "Year-end award balances from the declared compensation note.",
      abstainReason: null,
    },
    rationale:
      "Saldo combinado de RSU, PSU y PSU de mercado; 189 M, no los 188 M expected to vest. No hay opciones vivas publicadas.",
    review: "owner_reviewed",
  },
]);
