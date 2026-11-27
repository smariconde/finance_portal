import { z } from "zod";

/**
 * La parcela catastral, versionada (ADR 0089, Decisión 3). Una subdivisión o
 * una fusión cierra la versión vigente de cada parcela que desaparece y abre
 * parcelas nuevas, unidas a las anteriores por un linaje; una corrección
 * cierra una versión y abre la siguiente de la misma parcela. La validez es
 * semiabierta: `[validFrom, validTo)`.
 *
 * La nomenclatura provincial y la municipal son alias de la misma parcela; se
 * guardan como las publica la fuente. Qué capa las publica y en qué formato
 * exacto se mide en `F13-06`, así que acá sólo se exige la forma de grupos
 * numéricos separados por guiones —siete la provincial, cuatro la
 * municipal—, sin derivar una de la otra.
 */
export const PARCEL_VERSIONING_VERSION = "re-parcel-1.0.0";

export const PARCEL_END_EVENTS = [
  "subdivision",
  "merge",
  "correction",
] as const;
export type ParcelEndEvent = (typeof PARCEL_END_EVENTS)[number];

export const provincialNomenclatureSchema = z
  .string()
  .regex(/^[0-9]{1,4}(?:-[0-9]{1,4}){6}$/u, "not_a_provincial_nomenclature");
export const municipalNomenclatureSchema = z
  .string()
  .regex(/^[0-9]{1,4}(?:-[0-9]{1,4}){3}$/u, "not_a_municipal_nomenclature");

export type ParcelNomenclature = {
  readonly provincial: string | null;
  readonly municipal: string | null;
};

export type ParcelVersion = {
  readonly parcelId: string;
  /** Empieza en 1. */
  readonly version: number;
  readonly nomenclature: ParcelNomenclature;
  /** Decimal canónico; `null` si la fuente no publica la superficie. */
  readonly landAreaM2: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  /** `null` exactamente cuando la versión sigue vigente. */
  readonly endedBy: ParcelEndEvent | null;
  /**
   * Cuándo se supo el cierre. Sin esto, leer la parcela a un instante anterior
   * a la subdivisión vería ya la versión cerrada: un dato del futuro.
   */
  readonly closedObservedAt: string | null;
  readonly sourceId: string;
  /** Cuándo se leyó: la disponibilidad de esta versión. */
  readonly observedAt: string;
};

export type ParcelLineage = {
  readonly predecessorParcelId: string;
  readonly successorParcelId: string;
  readonly event: "subdivision" | "merge";
  readonly effectiveOn: string;
};

export type ParcelSuccessor = {
  readonly parcelId: string;
  readonly nomenclature: ParcelNomenclature;
  readonly landAreaM2: string | null;
};

export type ParcelChangePlan = {
  /** Versiones vigentes que se cierran en `effectiveOn`. */
  readonly close: readonly {
    readonly parcelId: string;
    readonly version: number;
    readonly validTo: string;
    readonly endedBy: ParcelEndEvent;
    readonly closedObservedAt: string;
  }[];
  readonly open: readonly ParcelVersion[];
  readonly lineage: readonly ParcelLineage[];
};

export class ParcelVersionError extends Error {
  constructor(
    readonly code:
      | "nomenclature_missing"
      | "nomenclature_invalid"
      | "version_not_open"
      | "effective_not_after_valid_from"
      | "too_few_successors"
      | "too_few_predecessors"
      | "parcel_repeated"
      | "versions_of_several_parcels"
      | "area_not_canonical"
      | "subdivision_exceeds_parcel"
      | "merge_exceeds_parcels",
  ) {
    super(code);
    this.name = "ParcelVersionError";
  }
}

/**
 * Una subdivisión puede ceder suelo a la calle, nunca crearlo. El margen
 * absorbe el redondeo de cada lote al m² en la fuente.
 */
const AREA_TOLERANCE = 0.01;
const CANONICAL_AREA = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{0,1}[1-9])?$/u;

function assertNomenclature(nomenclature: ParcelNomenclature): void {
  if (nomenclature.provincial === null && nomenclature.municipal === null)
    throw new ParcelVersionError("nomenclature_missing");
  if (
    (nomenclature.provincial !== null &&
      !provincialNomenclatureSchema.safeParse(nomenclature.provincial)
        .success) ||
    (nomenclature.municipal !== null &&
      !municipalNomenclatureSchema.safeParse(nomenclature.municipal).success)
  )
    throw new ParcelVersionError("nomenclature_invalid");
}

function assertArea(area: string | null): void {
  if (area !== null && (!CANONICAL_AREA.test(area) || !/[1-9]/u.test(area)))
    throw new ParcelVersionError("area_not_canonical");
}

function assertOpen(version: ParcelVersion, effectiveOn: string): void {
  if (
    version.validTo !== null ||
    version.endedBy !== null ||
    version.closedObservedAt !== null
  )
    throw new ParcelVersionError("version_not_open");
  if (effectiveOn <= version.validFrom)
    throw new ParcelVersionError("effective_not_after_valid_from");
}

function assertDistinct(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length)
    throw new ParcelVersionError("parcel_repeated");
}

function knownSum(areas: readonly (string | null)[]): number | null {
  if (areas.some((area) => area === null)) return null;
  return areas.reduce((total, area) => total + Number(area), 0);
}

function firstVersion(
  successor: ParcelSuccessor,
  effectiveOn: string,
  sourceId: string,
  observedAt: string,
): ParcelVersion {
  assertNomenclature(successor.nomenclature);
  assertArea(successor.landAreaM2);
  return {
    parcelId: successor.parcelId,
    version: 1,
    nomenclature: successor.nomenclature,
    landAreaM2: successor.landAreaM2,
    validFrom: effectiveOn,
    validTo: null,
    endedBy: null,
    closedObservedAt: null,
    sourceId,
    observedAt,
  };
}

export function planParcelSubdivision(input: {
  readonly parcel: ParcelVersion;
  readonly successors: readonly ParcelSuccessor[];
  readonly effectiveOn: string;
  readonly sourceId: string;
  readonly observedAt: string;
}): ParcelChangePlan {
  assertOpen(input.parcel, input.effectiveOn);
  if (input.successors.length < 2)
    throw new ParcelVersionError("too_few_successors");
  assertDistinct([
    input.parcel.parcelId,
    ...input.successors.map((successor) => successor.parcelId),
  ]);
  const open = input.successors.map((successor) =>
    firstVersion(
      successor,
      input.effectiveOn,
      input.sourceId,
      input.observedAt,
    ),
  );
  const total = knownSum(open.map((version) => version.landAreaM2));
  if (
    total !== null &&
    input.parcel.landAreaM2 !== null &&
    total > Number(input.parcel.landAreaM2) * (1 + AREA_TOLERANCE)
  )
    throw new ParcelVersionError("subdivision_exceeds_parcel");
  return {
    close: [
      {
        parcelId: input.parcel.parcelId,
        version: input.parcel.version,
        validTo: input.effectiveOn,
        endedBy: "subdivision",
        closedObservedAt: input.observedAt,
      },
    ],
    open,
    lineage: open.map((version) => ({
      predecessorParcelId: input.parcel.parcelId,
      successorParcelId: version.parcelId,
      event: "subdivision" as const,
      effectiveOn: input.effectiveOn,
    })),
  };
}

export function planParcelMerge(input: {
  readonly parcels: readonly ParcelVersion[];
  readonly successor: ParcelSuccessor;
  readonly effectiveOn: string;
  readonly sourceId: string;
  readonly observedAt: string;
}): ParcelChangePlan {
  if (input.parcels.length < 2)
    throw new ParcelVersionError("too_few_predecessors");
  for (const parcel of input.parcels) assertOpen(parcel, input.effectiveOn);
  assertDistinct([
    ...input.parcels.map((parcel) => parcel.parcelId),
    input.successor.parcelId,
  ]);
  const opened = firstVersion(
    input.successor,
    input.effectiveOn,
    input.sourceId,
    input.observedAt,
  );
  const total = knownSum(input.parcels.map((parcel) => parcel.landAreaM2));
  if (
    total !== null &&
    opened.landAreaM2 !== null &&
    Number(opened.landAreaM2) > total * (1 + AREA_TOLERANCE)
  )
    throw new ParcelVersionError("merge_exceeds_parcels");
  return {
    close: input.parcels.map((parcel) => ({
      parcelId: parcel.parcelId,
      version: parcel.version,
      validTo: input.effectiveOn,
      endedBy: "merge" as const,
      closedObservedAt: input.observedAt,
    })),
    open: [opened],
    lineage: input.parcels.map((parcel) => ({
      predecessorParcelId: parcel.parcelId,
      successorParcelId: opened.parcelId,
      event: "merge" as const,
      effectiveOn: input.effectiveOn,
    })),
  };
}

/** Una corrección de la fuente: la misma parcela, otra versión. */
export function planParcelCorrection(input: {
  readonly parcel: ParcelVersion;
  readonly nomenclature: ParcelNomenclature;
  readonly landAreaM2: string | null;
  readonly effectiveOn: string;
  readonly sourceId: string;
  readonly observedAt: string;
}): ParcelChangePlan {
  assertOpen(input.parcel, input.effectiveOn);
  assertNomenclature(input.nomenclature);
  assertArea(input.landAreaM2);
  return {
    close: [
      {
        parcelId: input.parcel.parcelId,
        version: input.parcel.version,
        validTo: input.effectiveOn,
        endedBy: "correction",
        closedObservedAt: input.observedAt,
      },
    ],
    open: [
      {
        parcelId: input.parcel.parcelId,
        version: input.parcel.version + 1,
        nomenclature: input.nomenclature,
        landAreaM2: input.landAreaM2,
        validFrom: input.effectiveOn,
        validTo: null,
        endedBy: null,
        closedObservedAt: null,
        sourceId: input.sourceId,
        observedAt: input.observedAt,
      },
    ],
    lineage: [],
  };
}

/**
 * La versión de **una** parcela vigente en una fecha y conocida en un
 * instante: una versión leída después de `knownAt` no existe todavía para esa
 * lectura, y un cierre sabido después tampoco.
 */
export function parcelVersionAt(
  versions: readonly ParcelVersion[],
  input: { readonly effectiveOn: string; readonly knownAt: string },
): ParcelVersion | null {
  if (new Set(versions.map((version) => version.parcelId)).size > 1)
    throw new ParcelVersionError("versions_of_several_parcels");
  const knownAt = Date.parse(input.knownAt);
  const visible = versions.filter((version) => {
    if (Date.parse(version.observedAt) > knownAt) return false;
    const closeKnown =
      version.closedObservedAt !== null &&
      Date.parse(version.closedObservedAt) <= knownAt;
    return (
      version.validFrom <= input.effectiveOn &&
      (!closeKnown ||
        version.validTo === null ||
        input.effectiveOn < version.validTo)
    );
  });
  return visible.reduce<ParcelVersion | null>(
    (latest, version) =>
      latest === null || version.version > latest.version ? version : latest,
    null,
  );
}
