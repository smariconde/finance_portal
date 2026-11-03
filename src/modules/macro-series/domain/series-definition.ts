import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";

import {
  BCRA_CURRENCY_CODES,
  SERIES_FREQUENCIES,
  type BcraCatalogEntry,
  type BcraCurrencyCode,
  type RowRejection,
  type SeriesFrequency,
} from "./bcra-monetary-parser";
import {
  BCRA_MONETARY_PROFILE,
  type BcraSourceProfile,
} from "./bcra-source-profile";

/**
 * Definición de una serie macro (`F9-01`, ADR 0065, decisión 5): lo que la
 * fuente dice que la variable **es** —descripción, unidad, frecuencia, moneda,
 * metodología— como versión temporal.
 *
 * Como en el registro CEDEAR (ADR 0027), el catálogo no fecha lo que publica:
 * `validFrom` y `availableAt` son la observación. Una definición distinta
 * supersede a la vigente; una variable que el catálogo deja de listar se cierra
 * sin sucesora (`validTo`).
 */
export const seriesKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[0-9]{1,6}$/u);

export const seriesFrequencySchema = z.enum(SERIES_FREQUENCIES);
export const bcraCurrencyCodeSchema = z.enum(BCRA_CURRENCY_CODES);

/** Lo que una observación tiene que compartir con su serie para no mezclar escalas. */
export const seriesBasisSchema = z.object({
  frequency: seriesFrequencySchema,
  unit: z.string().trim().min(1).max(120),
  currencyCode: bcraCurrencyCodeSchema,
});

export type SeriesBasis = z.infer<typeof seriesBasisSchema>;

export const seriesDefinitionSchema = z
  .object({
    ...temporalVersionShape,
    definitionId: z.uuid(),
    seriesKey: seriesKeySchema,
    externalId: z.string().regex(/^[1-9][0-9]{0,5}$/u),
    description: z.string().trim().min(1).max(300),
    category: z.string().trim().min(1).max(120),
    seriesType: z.string().trim().min(1).max(120),
    ...seriesBasisSchema.shape,
    firstReportedOn: z.iso.date(),
    /** `null` cuando la fuente no publicó metodología para la variable. */
    methodology: z.string().trim().min(1).max(4000).nullable(),
    parserVersion: z.string().trim().min(1).max(64),
    ingestionRunId: z.uuid(),
  })
  .superRefine(refineTemporalVersion);

export type SeriesDefinition = z.infer<typeof seriesDefinitionSchema>;

/** Lo que define la variable. La última fecha y el último valor no entran. */
export type DefinitionContent = {
  readonly seriesKey: string;
  readonly description: string;
  readonly category: string;
  readonly seriesType: string;
  readonly frequency: SeriesFrequency;
  readonly unit: string;
  readonly currencyCode: BcraCurrencyCode;
  readonly firstReportedOn: string;
  readonly methodology: string | null;
};

export function definitionContentOf(
  entry: BcraCatalogEntry,
  methodology: string | null,
  profile: Pick<BcraSourceProfile, "seriesKeyOf"> = BCRA_MONETARY_PROFILE,
): DefinitionContent {
  return {
    seriesKey: profile.seriesKeyOf(entry.variableId),
    description: entry.description,
    category: entry.category,
    seriesType: entry.seriesType,
    frequency: entry.frequency,
    unit: entry.unit,
    currencyCode: entry.currencyCode,
    firstReportedOn: entry.firstReportedOn,
    methodology,
  };
}

export function definitionContentHash(content: DefinitionContent): string {
  return computeContentHash(content);
}

export function basisOf(definition: SeriesBasis): SeriesBasis {
  return {
    frequency: definition.frequency,
    unit: definition.unit,
    currencyCode: definition.currencyCode,
  };
}

export function sameBasis(left: SeriesBasis, right: SeriesBasis): boolean {
  return (
    left.frequency === right.frequency &&
    left.unit === right.unit &&
    left.currencyCode === right.currencyCode
  );
}

export function isOpenDefinition(definition: SeriesDefinition): boolean {
  return definition.validTo === null && definition.supersededAt === null;
}

/** Más de un décimo del catálogo cerrado en una corrida se rechaza (ADR 0065). */
export const WITHDRAWAL_GUARD_SHARE = 0.1;

export type CatalogPlan = {
  readonly opened: readonly SeriesDefinition[];
  readonly superseded: readonly {
    readonly previous: SeriesDefinition;
    readonly next: SeriesDefinition;
  }[];
  readonly withdrawn: readonly SeriesDefinition[];
  readonly unchanged: number;
  /** Variables del catálogo sin texto de metodología publicado. */
  readonly methodologyMissing: number;
  /**
   * Por qué no se retiró nada aunque faltaran variables: una fila rechazada sin
   * id puede ser cualquiera de ellas.
   */
  readonly withdrawalsDeferred: boolean;
  readonly guard: {
    readonly withdrawals: number;
    readonly open: number;
    readonly refused: boolean;
  };
};

export type PlanCatalogInput = {
  readonly entries: readonly BcraCatalogEntry[];
  readonly methodologies: ReadonlyMap<number, string | null>;
  readonly rejections: readonly RowRejection[];
  readonly current: readonly SeriesDefinition[];
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly sourceDocumentId: string;
  readonly parserVersion: string;
  readonly ingestionRunId: string;
  readonly acceptWithdrawals: boolean;
  readonly newId: () => string;
  /** La API cuyo catálogo es: por defecto, Estadísticas Monetarias (ADR 0067). */
  readonly profile?: BcraSourceProfile;
};

export function planCatalog(input: PlanCatalogInput): CatalogPlan {
  const profile = input.profile ?? BCRA_MONETARY_PROFILE;
  const open = input.current.filter(isOpenDefinition);
  const byKey = new Map(
    open.map((definition) => [definition.seriesKey, definition]),
  );

  if (byKey.size !== open.length) {
    throw new Error("more than one open definition for a series");
  }

  for (const definition of open) {
    if (Date.parse(input.observedAt) <= Date.parse(definition.availableAt)) {
      // El orden de las observaciones es lo único que fecha un cambio.
      throw new Error(
        `observation does not follow the open definition of ${definition.seriesKey}`,
      );
    }
  }

  const build = (content: DefinitionContent, externalId: number) =>
    seriesDefinitionSchema.parse({
      definitionId: input.newId(),
      externalId: String(externalId),
      ...content,
      parserVersion: input.parserVersion,
      ingestionRunId: input.ingestionRunId,
      validFrom: input.observedAt,
      validTo: null,
      availableAt: input.observedAt,
      supersededAt: null,
      sourceId: profile.sourceId,
      sourceDocumentId: input.sourceDocumentId,
      contentHash: definitionContentHash(content),
      recordedAt: input.recordedAt,
    });

  const opened: SeriesDefinition[] = [];
  const superseded: { previous: SeriesDefinition; next: SeriesDefinition }[] =
    [];
  const listed = new Set<string>();
  let unchanged = 0;
  let methodologyMissing = 0;

  for (const entry of input.entries) {
    const methodology = input.methodologies.get(entry.variableId) ?? null;

    if (methodology === null) {
      methodologyMissing += 1;
    }

    const content = definitionContentOf(entry, methodology, profile);
    listed.add(content.seriesKey);
    const previous = byKey.get(content.seriesKey);

    if (previous === undefined) {
      opened.push(build(content, entry.variableId));
    } else if (previous.contentHash === definitionContentHash(content)) {
      unchanged += 1;
    } else {
      superseded.push({ previous, next: build(content, entry.variableId) });
    }
  }

  // Una variable rechazada por un campo sigue en el catálogo: no se retira.
  for (const rejection of input.rejections) {
    if (rejection.variableId !== null) {
      listed.add(profile.seriesKeyOf(rejection.variableId));
    }
  }

  const withdrawalsDeferred = input.rejections.some(
    (rejection) => rejection.variableId === null,
  );
  const missing = withdrawalsDeferred
    ? []
    : open.filter((definition) => !listed.has(definition.seriesKey));
  const refused =
    !input.acceptWithdrawals &&
    missing.length > 0 &&
    missing.length > open.length * WITHDRAWAL_GUARD_SHARE;

  return {
    opened,
    superseded,
    withdrawn: refused
      ? []
      : missing.map((definition) =>
          seriesDefinitionSchema.parse({
            ...definition,
            validTo: input.observedAt,
          }),
        ),
    unchanged,
    methodologyMissing,
    withdrawalsDeferred,
    guard: { withdrawals: missing.length, open: open.length, refused },
  };
}

export function catalogPlanChanges(plan: CatalogPlan): number {
  return plan.opened.length + plan.superseded.length + plan.withdrawn.length;
}

/**
 * La definición de una serie visible al corte. Dos a la vez son el conflicto que
 * el índice único impide; si aparecen igual, se declaran.
 */
export function resolveDefinitionAt(
  definitions: readonly SeriesDefinition[],
  query: PointInTimeQuery,
): SeriesDefinition | null {
  const visible = definitions.filter(
    (definition) =>
      isEffectiveAt(definition, query.effectiveAt) &&
      isKnownAt(definition, query),
  );

  if (visible.length > 1) {
    throw new Error(
      `more than one definition of ${visible[0]!.seriesKey} is visible`,
    );
  }

  return visible[0] ?? null;
}
