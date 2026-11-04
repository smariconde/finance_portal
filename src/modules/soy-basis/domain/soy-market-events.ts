/**
 * Dated context for the soy chart (`F9-15`): changes of the export duty on
 * the soybean and the yearly harvest season. Each duty change is a declared
 * fact with its decree, from the day it took effect; the chart only places
 * it. Declared since December 2019 (Decreto 37/2019), which covers the five
 * years drawn day by day; earlier changes are not on the list yet, so a
 * reading before that date has no rate rather than a guessed one.
 */
export const SOY_MARKET_EVENTS_VERSION = "soy-market-events-1.0.0";

export type SoyDutyChange = {
  readonly id: string;
  readonly on: string;
  /** Short label for the chart: «DEX 26 %». */
  readonly label: string;
  /** The soybean's rate from that day, as printed: `"33"`, `"0"`. */
  readonly ratePct: string;
  readonly norm: string;
  readonly description: string;
};

export const DECLARED_SOY_DUTY_CHANGES: readonly SoyDutyChange[] = [
  {
    id: "dex-2019-12",
    on: "2019-12-14",
    label: "DEX 30 %",
    ratePct: "30",
    norm: "Decreto 37/2019 (B.O. 14/12/2019)",
    description:
      "Deja sin efecto el tope de $ 4 por dólar: el poroto pasa a 18 % más 12 % ad valorem.",
  },
  {
    id: "dex-2020-03",
    on: "2020-03-05",
    label: "DEX 33 %",
    ratePct: "33",
    norm: "Decreto 230/2020 (B.O. 5/3/2020)",
    description: "El poroto de soja sube al 33 %, el máximo que fijó la ley.",
  },
  {
    id: "dex-2020-10",
    on: "2020-10-05",
    label: "DEX 30 %",
    ratePct: "30",
    norm: "Decreto 790/2020 (B.O. 5/10/2020)",
    description:
      "Baja temporal: 30 % en octubre, 31,5 % en noviembre y 32 % en diciembre de 2020.",
  },
  {
    id: "dex-2020-11",
    on: "2020-11-01",
    label: "DEX 31,5 %",
    ratePct: "31.5",
    norm: "Decreto 790/2020, segundo escalón",
    description: "El poroto sube al 31,5 % en noviembre de 2020.",
  },
  {
    id: "dex-2020-12",
    on: "2020-12-01",
    label: "DEX 32 %",
    ratePct: "32",
    norm: "Decreto 790/2020, tercer escalón",
    description: "El poroto sube al 32 % en diciembre de 2020.",
  },
  {
    id: "dex-2021-01",
    on: "2021-01-01",
    label: "DEX 33 %",
    ratePct: "33",
    norm: "Decreto 790/2020, fin de la baja temporal",
    description: "El poroto vuelve al 33 %.",
  },
  {
    id: "dex-2025-01",
    on: "2025-01-27",
    label: "DEX 26 %",
    ratePct: "26",
    norm: "Decreto 38/2025 (B.O. 27/1/2025), hasta el 30/6/2025",
    description:
      "Baja temporal del 33 % al 26 %, con la condición de liquidar el 95 % de las divisas en 15 días hábiles.",
  },
  {
    id: "dex-2025-07",
    on: "2025-07-01",
    label: "DEX 33 %",
    ratePct: "33",
    norm: "Decreto 439/2025, fin de la baja temporal para la soja",
    description:
      "La soja vuelve al 33 %; el trigo y la cebada conservan la baja.",
  },
  {
    id: "dex-2025-07-31",
    on: "2025-07-31",
    label: "DEX 26 %",
    ratePct: "26",
    norm: "Decreto 526/2025 (30/7/2025)",
    description:
      "Baja permanente: el poroto al 26 % y los subproductos al 24,5 %.",
  },
  {
    id: "dex-2025-09",
    on: "2025-09-22",
    label: "DEX 0 %",
    ratePct: "0",
    norm: "Decreto 682/2025 (B.O. 22/9/2025)",
    description:
      "Retenciones en cero hasta el 31/10/2025 o hasta US$ 7.000 millones registrados; el cupo se completó el 24/9/2025.",
  },
  {
    id: "dex-2025-09-25",
    on: "2025-09-25",
    label: "DEX 26 %",
    ratePct: "26",
    norm: "Decreto 682/2025, cupo completo (ARCA, 24/9/2025)",
    description:
      "Con el cupo agotado, la soja vuelve al régimen anterior: 26 %.",
  },
  {
    id: "dex-2025-12",
    on: "2025-12-12",
    label: "DEX 24 %",
    ratePct: "24",
    norm: "Decreto 877/2025 (B.O. 12/12/2025)",
    description:
      "El poroto baja del 26 % al 24 % y los subproductos al 22,5 %.",
  },
  {
    id: "dex-2026-06",
    on: "2026-06-04",
    label: "Cronograma DEX",
    ratePct: "24",
    norm: "Decreto 423/2026 (junio de 2026)",
    description:
      "El poroto sigue en 24 % durante 2026 y baja mes a mes desde enero de 2027 hasta 15 % en diciembre de 2028.",
  },
];

/** The soybean's export duty in force on a day, or `null` before the list. */
export function soyDutyOn(on: string): SoyDutyChange | null {
  let current: SoyDutyChange | null = null;
  for (const change of DECLARED_SOY_DUTY_CHANGES) {
    if (change.on <= on) current = change;
  }
  return current;
}

export type SoySeason = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  /** Exclusive. */
  readonly to: string;
};

/**
 * The main soybean harvest, April through June of each year: a project
 * convention for shading the chart, not a measured calendar. The crop's
 * actual progress moves with the weather every campaign.
 */
export function soyHarvestSeasons(
  fromYear: number,
  toYear: number,
): SoySeason[] {
  const seasons: SoySeason[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    seasons.push({
      id: `harvest-${year}`,
      label: "Cosecha",
      from: `${year}-04-01`,
      to: `${year}-07-01`,
    });
  }
  return seasons;
}
