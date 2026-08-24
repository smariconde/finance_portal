import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import type { PointInTimeQuery } from "./point-in-time-query";
import { TemporalContractError } from "./temporal-error";

export const utcTimestampSchema = z.iso.datetime({ offset: true });
export const calendarDateSchema = z.iso.date();
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/**
 * Envelope común de toda dimensión versionada (identidad, símbolos, listings,
 * ratios y clasificaciones). Se expone como shape y no como schema cerrado
 * porque cada nivel agrega sus campos propios y Zod no permite extender un
 * objeto ya refinado.
 */
export const temporalVersionShape = {
  /** Vigencia efectiva semiabierta `[validFrom, validTo)`. */
  validFrom: utcTimestampSchema,
  validTo: utcTimestampSchema.nullable(),
  /** Primer instante defendible en que el hecho podía conocerse. */
  availableAt: utcTimestampSchema,
  /** Instante desde el que otra versión pasa a ser la vigente en la cadena. */
  supersededAt: utcTimestampSchema.nullable(),
  sourceId: sourceIdSchema,
  sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
  contentHash: contentHashSchema,
  /** Instante de commit local: la dimensión de auditoría, no de publicación. */
  recordedAt: utcTimestampSchema,
} as const;

export type TemporalVersion = z.infer<z.ZodObject<typeof temporalVersionShape>>;

type RefinementContext = {
  addIssue: (issue: {
    code: "custom";
    path: (string | number)[];
    message: string;
  }) => void;
};

/**
 * Refinamiento compartido por cada nivel de identidad. `validTo` igual a
 * `validFrom` es un intervalo vacío, no un instante: el contrato lo rechaza.
 */
export function refineTemporalVersion(
  version: TemporalVersion,
  context: RefinementContext,
): void {
  if (
    version.validTo !== null &&
    Date.parse(version.validFrom) >= Date.parse(version.validTo)
  ) {
    context.addIssue({
      code: "custom",
      path: ["validTo"],
      message: "validTo must be strictly later than validFrom.",
    });
  }

  if (
    version.supersededAt !== null &&
    Date.parse(version.supersededAt) <= Date.parse(version.availableAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["supersededAt"],
      message: "supersededAt must be strictly later than availableAt.",
    });
  }
}

/** Envelope suelto ya refinado; cada nivel de identidad agrega sus campos. */
export const temporalVersionSchema = z
  .object(temporalVersionShape)
  .superRefine(refineTemporalVersion);

/** `[validFrom, validTo)`: el borde superior es exclusivo. */
export function isEffectiveAt(
  version: TemporalVersion,
  effectiveAt: string,
): boolean {
  const at = Date.parse(effectiveAt);

  return (
    Date.parse(version.validFrom) <= at &&
    (version.validTo === null || at < Date.parse(version.validTo))
  );
}

/**
 * Corte de conocimiento. `latest_restated` es la vista actual —sólo versiones no
 * superseded— y `as_known` aplica `available_at <= known_at`, más
 * `recorded_at <= known_at` cuando la basis es `system_recorded`.
 */
export function isKnownAt(
  version: TemporalVersion,
  query: PointInTimeQuery,
): boolean {
  if (query.revisionPolicy === "latest_restated") {
    return version.supersededAt === null;
  }

  const at = Date.parse(query.knownAt);

  if (Date.parse(version.availableAt) > at) {
    return false;
  }

  if (version.supersededAt !== null && at >= Date.parse(version.supersededAt)) {
    return false;
  }

  return (
    query.knowledgeBasis !== "system_recorded" ||
    Date.parse(version.recordedAt) <= at
  );
}

/**
 * Selecciona la única versión efectiva y conocida en el corte. Dos versiones
 * autoritativas simultáneas no se desempatan por `fetched_at` ni por orden de
 * inserción: son un conflicto declarado (`overlapping_effective_versions`).
 */
export function selectEffectiveVersion<TVersion extends TemporalVersion>(
  versions: readonly TVersion[],
  query: PointInTimeQuery,
  subjectId: string,
): TVersion | null {
  const matches = versions.filter(
    (version) =>
      isEffectiveAt(version, query.effectiveAt) && isKnownAt(version, query),
  );

  if (matches.length > 1) {
    throw new TemporalContractError(
      "overlapping_effective_versions",
      "More than one effective version is valid at the requested cutoff.",
      [subjectId],
    );
  }

  return matches[0] ?? null;
}

/**
 * Invariante de vigencia: para el mismo sujeto no puede haber dos intervalos
 * activos solapados. Los intervalos que se tocan (`validTo === validFrom`) son
 * legales justamente porque el borde superior es exclusivo.
 */
export function assertNoOverlappingVersions(
  versions: readonly TemporalVersion[],
  subjectId: string,
): void {
  const current = versions
    .filter((version) => version.supersededAt === null)
    .map((version) => ({
      from: Date.parse(version.validFrom),
      to:
        version.validTo === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(version.validTo),
    }))
    .sort((left, right) => left.from - right.from);

  for (let index = 1; index < current.length; index += 1) {
    if (current[index]!.from < current[index - 1]!.to) {
      throw new TemporalContractError(
        "overlapping_effective_versions",
        "Two authoritative versions overlap for the same subject.",
        [subjectId],
      );
    }
  }
}
