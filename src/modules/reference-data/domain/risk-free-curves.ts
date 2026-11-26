import { z } from "zod";

import {
  latestSettledWeekday,
  sessionSettledAt,
} from "@/modules/prices/domain/price-freshness";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import { percentToFraction } from "./damodaran-datasets";
import type { ReferencePublication, ReferenceRow } from "./reference-release";

/**
 * Tasas libres de riesgo por moneda (`F6-55`,
 * [ADR 0087](../../../../docs/architecture/adr/0087-foreign-private-issuers.md)).
 *
 * Un emisor que reporta en EUR se valúa en EUR (decisión 1 del owner), así que
 * su libre de riesgo tiene que ser de esa moneda. Damodaran no publica tasas por
 * moneda como archivo; el ECB sí, como serie diaria de su API SDMX. Cada serie
 * es un **dataset de referencia** con el mismo modelo de releases que los de
 * Damodaran (ADR 0032): una observación con contenido nuevo supersede a la
 * vigente, y la lectura al corte nunca ve una release posterior. La release
 * guarda los últimos días hábiles, no la historia: el costo de capital pide el
 * dato del `as_of` y una corrida guardada congela el suyo.
 *
 * El EUR usa el **rendimiento par** a 10 años de la curva AAA del área del euro
 * (modelo Svensson): el cupón de un bono a la par, la misma clase de tasa que el
 * T-bond a 10 años que Damodaran usa en USD (decisión del owner del
 * 2026-11-25). Se le descuenta el diferencial de default de Alemania, Aaa en
 * cero, como hace Damodaran con el euro.
 */
export const ECB_SOURCE_ID = "ecb-data-portal";
export const ECB_PARSER_VERSION = "ecb-sdmx-csv-1.0.0";

export const riskFreeCurveSchema = z.strictObject({
  datasetId: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  /** Fila del riesgo país de Damodaran cuyo diferencial se descuenta. */
  sovereignCountryKey: z.string().min(1),
  label: z.string().min(1),
  /** Flujo SDMX y clave de la serie, tal como la API los nombra. */
  flowRef: z.string().regex(/^[A-Z0-9_]+$/u),
  seriesKey: z.string().regex(/^[A-Z0-9_.]+$/u),
  frequency: z.enum(["daily", "monthly"]),
  /** Observaciones que guarda cada release. */
  lastObservations: z.number().int().min(1).max(60),
  /**
   * Días de calendario que puede tener el dato frente al `as_of` (desde el día
   * del dato, o desde el fin del mes de una serie mensual).
   */
  maxAgeDays: z.number().int().min(1).max(92),
});

export type RiskFreeCurve = z.infer<typeof riskFreeCurveSchema>;

/** El campo de cada fila: la tasa como fracción (`0.0329` es 3,29 %). */
export const RISK_FREE_FIELD = "yield";

export const DECLARED_RISK_FREE_CURVES: readonly RiskFreeCurve[] =
  Object.freeze(
    [
      {
        datasetId: "ecb.eur-aaa-par-10y",
        currency: "EUR",
        sovereignCountryKey: "germany",
        label:
          "ECB — curva AAA del área del euro, rendimiento par a 10 años (Svensson)",
        flowRef: "YC",
        seriesKey: "B.U2.EUR.4F.G_N_A.SV_C_YM.PY_10Y",
        frequency: "daily",
        lastObservations: 10,
        maxAgeDays: 7,
      },
    ].map((curve) => riskFreeCurveSchema.parse(curve)),
  );

export function riskFreeCurveOf(currency: string): RiskFreeCurve | null {
  return (
    DECLARED_RISK_FREE_CURVES.find((curve) => curve.currency === currency) ??
    null
  );
}

export function findRiskFreeCurve(datasetId: string): RiskFreeCurve | null {
  return (
    DECLARED_RISK_FREE_CURVES.find((curve) => curve.datasetId === datasetId) ??
    null
  );
}

/** La URL de la serie: sólo datos, en CSV, las últimas observaciones. */
export function ecbSeriesUrl(curve: RiskFreeCurve): string {
  return (
    `https://data-api.ecb.europa.eu/service/data/${curve.flowRef}/${curve.seriesKey}` +
    `?lastNObservations=${curve.lastObservations}&detail=dataonly&format=csvdata`
  );
}

const DAILY = /^\d{4}-\d{2}-\d{2}$/u;
const MONTHLY = /^\d{4}-\d{2}$/u;
const PERCENT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
/** Una tasa de un soberano AAA fuera de ±25 % no es una tasa: es otro dato. */
const PLAUSIBLE_PERCENT = 25;

/**
 * `ecb-sdmx-csv-1.0.0`: el CSV de `detail=dataonly`. Cerrado: el encabezado
 * empieza por `KEY` y tiene `TIME_PERIOD` y `OBS_VALUE`; cada fila es de la serie
 * pedida y de su frecuencia, sin comillas (el modo sólo datos no trae textos),
 * con un valor decimal plausible y fechas estrictamente crecientes. Cualquier
 * otra cosa rechaza la publicación entera por nombre: una tasa a medias no es
 * una tasa.
 */
export function parseEcbSeriesCsv(
  curve: RiskFreeCurve,
  body: string,
): ReferencePublication {
  const fail = (code: string): ReferencePublication => ({ ok: false, code });
  const lines = body
    .replace(/^﻿/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  const header = lines[0]?.split(",") ?? [];

  if (header[0] !== "KEY") return fail("ecb_header_unexpected");

  const keyColumn = 0;
  const periodColumn = header.indexOf("TIME_PERIOD");
  const valueColumn = header.indexOf("OBS_VALUE");

  if (periodColumn < 0 || valueColumn < 0) return fail("ecb_header_unexpected");
  if (lines.length < 2) return fail("ecb_no_observations");

  const expectedKey = `${curve.flowRef}.${curve.seriesKey}`;
  const period = curve.frequency === "daily" ? DAILY : MONTHLY;
  const rows: ReferenceRow[] = [];
  let previous: string | null = null;

  for (const line of lines.slice(1)) {
    if (line.includes('"')) return fail("ecb_quoted_field");

    const cells = line.split(",");

    if (cells.length !== header.length) return fail("ecb_row_width");
    if (cells[keyColumn] !== expectedKey) return fail("ecb_series_mismatch");

    const date = cells[periodColumn]!;
    const value = cells[valueColumn]!;

    if (!period.test(date)) return fail("ecb_period_format");
    if (!PERCENT.test(value)) return fail("ecb_value_not_decimal");
    if (Math.abs(Number(value)) > PLAUSIBLE_PERCENT) {
      return fail("ecb_value_implausible");
    }
    if (previous !== null && date <= previous) {
      return fail("ecb_periods_not_increasing");
    }

    previous = date;
    rows.push({
      key: date,
      label: date,
      values: { [RISK_FREE_FIELD]: percentToFraction(value) },
    });
  }

  return {
    ok: true,
    datasetId: curve.datasetId,
    parserVersion: ECB_PARSER_VERSION,
    publishedLabel: previous,
    rows,
    rejections: [],
  };
}

/**
 * `risk-free-freshness-1.0.0`: cuándo una valuación tiene que volver a pedir la
 * curva. El ECB publica el dato de un día hábil al mediodía del siguiente, así
 * que lo esperable al cierre de una rueda es el día hábil **anterior**: la curva
 * está al día con ese dato, o si ya se la pidió después de que la rueda se
 * asentó (un feriado del TARGET no trae nada nuevo y no se vuelve a pedir). Una
 * curva mensual está al día con el mes anterior, o con un pedido de hoy.
 */
export const RISK_FREE_FRESHNESS_VERSION = "risk-free-freshness-1.0.0";

function previousWeekday(date: string): string {
  let candidate = subtractDays(date, 1);

  while ([0, 6].includes(new Date(`${candidate}T00:00:00.000Z`).getUTCDay())) {
    candidate = subtractDays(candidate, 1);
  }

  return candidate;
}

export function assessRiskFreeFreshness(input: {
  readonly curve: Pick<RiskFreeCurve, "frequency">;
  /** La última fila de la release vigente, o `null` sin release. */
  readonly latestPeriod: string | null;
  /** El último pedido que no falló, o `null`. */
  readonly lastCheckedAt: string | null;
  readonly now: string;
}): "current" | "stale" {
  const session = latestSettledWeekday(input.now);

  if (input.latestPeriod === null) return "stale";

  if (input.curve.frequency === "monthly") {
    const previousMonth = subtractDays(`${input.now.slice(0, 7)}-01`, 1).slice(
      0,
      7,
    );

    return input.latestPeriod >= previousMonth ||
      (input.lastCheckedAt !== null &&
        input.lastCheckedAt.slice(0, 10) === input.now.slice(0, 10))
      ? "current"
      : "stale";
  }

  return input.latestPeriod >= previousWeekday(session) ||
    (input.lastCheckedAt !== null &&
      Date.parse(input.lastCheckedAt) >= Date.parse(sessionSettledAt(session)))
    ? "current"
    : "stale";
}
