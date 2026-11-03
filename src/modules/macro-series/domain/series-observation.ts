import { z } from "zod";

import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { BcraSeriesPoint, RowRejection } from "./bcra-monetary-parser";
import {
  sameBasis,
  seriesBasisSchema,
  seriesKeySchema,
  type SeriesBasis,
} from "./series-definition";

/**
 * Un punto de una serie macro y sus revisiones (`F9-01`, ADR 0065, decisión 4).
 *
 * La fuente no fecha ni la publicación ni la revisión, así que `availableAt` es
 * la observación: el instante en que llegó la última página de la corrida. La
 * `periodOn` es la fecha del dato y nunca su disponibilidad —el CER se publica
 * con semanas de adelanto—.
 *
 * Un retiro es una revisión sin valor (`withdrawn`): la fuente dejó de publicar
 * esa fecha. No es un faltante ni un cero, y una lectura lo distingue.
 */
export const decimalTextSchema = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u)
  .max(64);

export const seriesObservationSchema = z
  .object({
    seriesKey: seriesKeySchema,
    periodOn: z.iso.date(),
    revision: z.number().int().min(0).max(32_767),
    value: decimalTextSchema.nullable(),
    withdrawn: z.boolean(),
    availableAt: z.iso.datetime({ offset: true }),
    supersededAt: z.iso.datetime({ offset: true }).nullable(),
    /** Viene de la corrida, como en las filas livianas (ADR 0018). */
    recordedAt: z.iso.datetime({ offset: true }),
    ingestionRunId: z.uuid(),
  })
  .superRefine((observation, context) => {
    if (observation.withdrawn !== (observation.value === null)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "A withdrawn revision has no value, and only it.",
      });
    }

    if (
      observation.supersededAt !== null &&
      Date.parse(observation.supersededAt) <=
        Date.parse(observation.availableAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must be strictly later than availableAt.",
      });
    }
  });

export type SeriesObservation = z.infer<typeof seriesObservationSchema>;

export function isOpenObservation(observation: SeriesObservation): boolean {
  return observation.supersededAt === null;
}

/** Identidad estable de una serie y la base que fijó su primera descarga. */
export const macroSeriesSchema = z.object({
  seriesKey: seriesKeySchema,
  sourceId: z.string().trim().min(1).max(64),
  externalId: z.string().regex(/^[1-9][0-9]{0,5}$/u),
  basis: seriesBasisSchema.nullable(),
});

export type MacroSeries = z.infer<typeof macroSeriesSchema>;

export type BasisCheck =
  | { readonly status: "pinned" | "matches" }
  | {
      readonly status: "definition_basis_changed";
      readonly pinned: SeriesBasis;
      readonly current: SeriesBasis;
    };

/**
 * La base de una serie se fija con su primera descarga. Si la definición
 * vigente cambia la frecuencia, la unidad o la moneda, la descarga se rechaza:
 * mezclar miles con millones en una cadena es un dato falso que nadie vería.
 */
export function checkDefinitionBasis(
  pinned: SeriesBasis | null,
  current: SeriesBasis,
): BasisCheck {
  if (pinned === null) {
    return { status: "pinned" };
  }

  return sameBasis(pinned, current)
    ? { status: "matches" }
    : { status: "definition_basis_changed", pinned, current };
}

/** Más de un décimo de lo comparado revisado o retirado en una corrida se rechaza. */
export const MASS_CHANGE_GUARD_SHARE = 0.1;
/** Por debajo de esto el porcentaje no dice nada: una serie corta cambia de a uno. */
export const MASS_CHANGE_GUARD_MIN_COMPARED = 20;

export type ObservationChange =
  | {
      readonly kind: "new";
      readonly periodOn: string;
      readonly value: string;
    }
  | {
      readonly kind: "revised" | "reinstated" | "withdrawn";
      readonly periodOn: string;
      /** `null` sólo para un retiro. */
      readonly value: string | null;
      readonly previous: SeriesObservation;
    };

export type ObservationPlan = {
  readonly seriesKey: string;
  readonly changes: readonly ObservationChange[];
  readonly counts: {
    readonly fetched: number;
    readonly new: number;
    readonly revised: number;
    readonly reinstated: number;
    readonly withdrawn: number;
    readonly unchanged: number;
    readonly rejected: number;
  };
  /**
   * Desde qué fecha se compararon los puntos guardados. `null` cuando se leyó la
   * serie entera: entonces se compara todo.
   */
  readonly windowStartsOn: string | null;
  /** Hay un punto rechazado sin fecha: la corrida no da nada por retirado. */
  readonly withdrawalsDeferred: boolean;
  readonly guard: {
    readonly compared: number;
    readonly changed: number;
    readonly refused: boolean;
  };
};

export type PlanObservationsInput = {
  readonly seriesKey: string;
  readonly points: readonly BcraSeriesPoint[];
  readonly rejections: readonly RowRejection[];
  /** `complete`: la serie entera; `window`: sólo las primeras páginas. */
  readonly coverage: "complete" | "window";
  /** Las revisiones vigentes guardadas de la serie, desde `windowStartsOn` si hay ventana. */
  readonly open: readonly SeriesObservation[];
  readonly acceptMassChange: boolean;
};

export function observationWindowStart(
  points: readonly BcraSeriesPoint[],
  rejections: readonly RowRejection[],
): string | null {
  const dates = [
    ...points.map((point) => point.periodOn),
    ...rejections.flatMap((rejection) =>
      rejection.periodOn === undefined ? [] : [rejection.periodOn],
    ),
  ];

  return dates.length === 0
    ? null
    : dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

export function planObservations(
  input: PlanObservationsInput,
): ObservationPlan {
  const windowStartsOn =
    input.coverage === "complete"
      ? null
      : observationWindowStart(input.points, input.rejections);
  const inWindow = (periodOn: string) =>
    windowStartsOn === null || periodOn >= windowStartsOn;

  const stored = new Map<string, SeriesObservation>();

  for (const observation of input.open) {
    if (
      observation.seriesKey !== input.seriesKey ||
      !isOpenObservation(observation)
    ) {
      throw new Error("the plan expects only open revisions of its series");
    }

    if (stored.has(observation.periodOn)) {
      throw new Error(
        `more than one open revision of ${input.seriesKey} at ${observation.periodOn}`,
      );
    }

    if (inWindow(observation.periodOn)) {
      stored.set(observation.periodOn, observation);
    }
  }

  const changes: ObservationChange[] = [];
  const fetchedDates = new Set<string>();
  let unchanged = 0;

  for (const point of input.points) {
    fetchedDates.add(point.periodOn);
    const previous = stored.get(point.periodOn);

    if (previous === undefined) {
      changes.push({
        kind: "new",
        periodOn: point.periodOn,
        value: point.value,
      });
    } else if (previous.withdrawn) {
      changes.push({
        kind: "reinstated",
        periodOn: point.periodOn,
        value: point.value,
        previous,
      });
    } else if (previous.value === point.value) {
      unchanged += 1;
    } else {
      changes.push({
        kind: "revised",
        periodOn: point.periodOn,
        value: point.value,
        previous,
      });
    }
  }

  const rejectedDates = new Set(
    input.rejections.flatMap((rejection) =>
      rejection.periodOn === undefined ? [] : [rejection.periodOn],
    ),
  );
  const withdrawalsDeferred = input.rejections.some(
    (rejection) => rejection.periodOn === undefined,
  );

  if (!withdrawalsDeferred) {
    for (const [periodOn, previous] of stored) {
      if (
        !previous.withdrawn &&
        !fetchedDates.has(periodOn) &&
        !rejectedDates.has(periodOn)
      ) {
        changes.push({ kind: "withdrawn", periodOn, value: null, previous });
      }
    }
  }

  const count = (kind: ObservationChange["kind"]) =>
    changes.filter((change) => change.kind === kind).length;
  const compared = [...stored.values()].filter(
    (observation) => !observation.withdrawn,
  ).length;
  const changed = count("revised") + count("withdrawn");
  const refused =
    !input.acceptMassChange &&
    compared >= MASS_CHANGE_GUARD_MIN_COMPARED &&
    changed > compared * MASS_CHANGE_GUARD_SHARE;

  return {
    seriesKey: input.seriesKey,
    changes: refused
      ? []
      : changes.sort((a, b) => a.periodOn.localeCompare(b.periodOn)),
    counts: {
      fetched: input.points.length + input.rejections.length,
      new: count("new"),
      revised: count("revised"),
      reinstated: count("reinstated"),
      withdrawn: count("withdrawn"),
      unchanged,
      rejected: input.rejections.length,
    },
    windowStartsOn,
    withdrawalsDeferred,
    guard: { compared, changed, refused },
  };
}

/**
 * Las revisiones que un plan escribe. Cada una supersede a la vigente en la
 * observación y lleva el número siguiente.
 */
export function materializeObservationPlan(
  plan: ObservationPlan,
  input: {
    readonly observedAt: string;
    readonly recordedAt: string;
    readonly ingestionRunId: string;
  },
): readonly SeriesObservation[] {
  return plan.changes.map((change) =>
    seriesObservationSchema.parse({
      seriesKey: plan.seriesKey,
      periodOn: change.periodOn,
      revision: change.kind === "new" ? 0 : change.previous.revision + 1,
      value: change.value,
      withdrawn: change.kind === "withdrawn",
      availableAt: input.observedAt,
      supersededAt: null,
      recordedAt: input.recordedAt,
      ingestionRunId: input.ingestionRunId,
    }),
  );
}

export type SeriesPoint = {
  readonly periodOn: string;
  readonly value: string;
  readonly revision: number;
  readonly availableAt: string;
};

function isVisible(
  observation: SeriesObservation,
  query: PointInTimeQuery,
): boolean {
  if (query.revisionPolicy === "latest_restated") {
    return observation.supersededAt === null;
  }

  const at = Date.parse(query.knownAt);

  if (Date.parse(observation.availableAt) > at) {
    return false;
  }

  if (
    observation.supersededAt !== null &&
    at >= Date.parse(observation.supersededAt)
  ) {
    return false;
  }

  return (
    query.knowledgeBasis !== "system_recorded" ||
    Date.parse(observation.recordedAt) <= at
  );
}

export type SeriesReading = {
  readonly points: readonly SeriesPoint[];
  /** Puntos conocidos al corte pero con fecha posterior a la efectiva, como el CER. */
  readonly aheadOfEffective: number;
  /** Fechas cuya revisión visible es un retiro. */
  readonly withdrawn: number;
};

/**
 * La serie como se la conocía al corte: por cada fecha, la revisión visible; un
 * retiro saca la fecha. Sólo entran fechas hasta la efectiva, y las que la
 * fuente publicó por adelantado se cuentan en vez de esconderse.
 */
export function resolveSeriesAt(
  observations: readonly SeriesObservation[],
  query: PointInTimeQuery,
): SeriesReading {
  const effectiveOn = query.effectiveAt.slice(0, 10);
  const byDate = new Map<string, SeriesObservation>();

  for (const observation of observations) {
    if (!isVisible(observation, query)) {
      continue;
    }

    if (byDate.has(observation.periodOn)) {
      throw new Error(
        `more than one revision of ${observation.seriesKey} at ${observation.periodOn} is visible`,
      );
    }

    byDate.set(observation.periodOn, observation);
  }

  const points: SeriesPoint[] = [];
  let aheadOfEffective = 0;
  let withdrawn = 0;

  for (const observation of byDate.values()) {
    if (observation.withdrawn) {
      withdrawn += 1;
    } else if (observation.periodOn > effectiveOn) {
      aheadOfEffective += 1;
    } else {
      points.push({
        periodOn: observation.periodOn,
        value: observation.value!,
        revision: observation.revision,
        availableAt: observation.availableAt,
      });
    }
  }

  points.sort((left, right) => left.periodOn.localeCompare(right.periodOn));

  return { points, aheadOfEffective, withdrawn };
}
