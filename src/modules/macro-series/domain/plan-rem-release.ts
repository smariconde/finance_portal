import { z } from "zod";

import type { RemMonthlyForecast } from "./bcra-rem-release-parser";

const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const percentSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u);

export type RemForecastVintage = {
  readonly roundMonth: string;
  readonly targetMonth: string;
  readonly revision: number;
  readonly medianPercent: string;
  readonly publishedOn: string;
  readonly availableAt: string;
  readonly recordedAt: string;
  readonly supersededAt: string | null;
  readonly sourceRunId: string;
};

export type PlannedRemForecast = Omit<RemForecastVintage, "supersededAt">;

export function planRemRelease(input: {
  readonly roundMonth: string;
  readonly publishedOn: string;
  readonly availableAt: string;
  readonly recordedAt: string;
  readonly runId: string;
  readonly forecasts: readonly RemMonthlyForecast[];
  readonly open: readonly RemForecastVintage[];
}): {
  readonly observations: readonly PlannedRemForecast[];
  readonly unchanged: number;
} {
  const roundMonth = monthSchema.parse(input.roundMonth);
  z.iso.date().parse(input.publishedOn);
  z.iso.datetime({ offset: true }).parse(input.availableAt);
  z.iso.datetime({ offset: true }).parse(input.recordedAt);
  const previous = new Map(input.open.map((row) => [row.targetMonth, row]));
  if (previous.size !== input.open.length || input.forecasts.length === 0)
    throw new Error("rem_open_or_release_invalid");
  const seen = new Set<string>();
  const observations: PlannedRemForecast[] = [];
  let unchanged = 0;
  for (const forecast of input.forecasts) {
    const targetMonth = monthSchema.parse(forecast.targetMonth);
    const medianPercent = percentSchema.parse(forecast.medianPercent);
    if (!Number.isFinite(Number(medianPercent)))
      throw new Error("rem_non_finite");
    if (forecast.roundMonth !== roundMonth || seen.has(targetMonth))
      throw new Error("rem_forecast_identity_invalid");
    seen.add(targetMonth);
    const old = previous.get(targetMonth);
    if (old && (old.roundMonth !== roundMonth || old.supersededAt !== null))
      throw new Error("rem_open_identity_invalid");
    if (
      old?.medianPercent === medianPercent &&
      old.publishedOn === input.publishedOn
    ) {
      unchanged += 1;
      continue;
    }
    const availableAt = old ? input.recordedAt : input.availableAt;
    if (old && Date.parse(availableAt) <= Date.parse(old.availableAt))
      throw new Error("rem_non_monotone_revision");
    observations.push({
      roundMonth,
      targetMonth,
      revision: old ? old.revision + 1 : 0,
      medianPercent,
      publishedOn: input.publishedOn,
      availableAt,
      recordedAt: input.recordedAt,
      sourceRunId: input.runId,
    });
  }
  if (
    previous.size > 0 &&
    (seen.size !== previous.size ||
      [...previous.keys()].some((key) => !seen.has(key)))
  )
    throw new Error("rem_target_set_changed");
  return { observations, unchanged };
}
