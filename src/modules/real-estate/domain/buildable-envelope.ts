import {
  createDecimalOperations,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { ZoningParameters } from "./zoning-resolution";

/**
 * Cuántos metros se pueden construir en un lote (`buildable-envelope-1.0.0`,
 * ADR 0089, Decisión 7; modelo §9):
 *
 * ```
 * planta_max  = fos × area
 * total_fot   = fot × area
 * por_altura  = planta_max × plantas
 * construible = min(total_fot, por_altura)
 * ```
 *
 * Las plantas son las que publica la capa («Planta Baja + 2 pisos» = 3). Sin
 * ese texto salen de la altura con 3,5 m de planta baja y 2,8 m por piso
 * (`floors_from_height`), una convención propia: sobre los pares altura–pisos
 * de la 8256 reproduce 9 de 11 (10,5 → 3, 23,5 → 8, 38,5 → 13…). La fórmula de
 * la ADR sin esa calibración daba alturas imposibles. El área central publica
 * altura y pisos pero no FOT: ahí manda la altura, y una zona sin altura usa
 * sólo el FOT. Sin FOS no hay envolvente.
 *
 * La sensibilidad mueve el FOT ±0,3, porque un FOT mal leído es el error que
 * más cambia el caso de desarrollo. Todo sale en m² con dos decimales.
 */
export const BUILDABLE_ENVELOPE_VERSION = "buildable-envelope-1.0.0";
export const GROUND_FLOOR_HEIGHT_M = "3.5";
export const TYPICAL_FLOOR_HEIGHT_M = "2.8";
export const FOT_SENSITIVITY = "0.3";

export class BuildableEnvelopeError extends Error {
  constructor(
    readonly code: string,
    readonly subjects: readonly string[],
  ) {
    super(code);
    this.name = "BuildableEnvelopeError";
  }
}

const { parseDecimal, toFixedScale } = createDecimalOperations(
  (code, _message, subjects) => new BuildableEnvelopeError(code, subjects),
);

export type EnvelopeAreaBasis =
  "parcel" | "parcel_unverified" | "declared_land";

export type BuildableEnvelope =
  | {
      readonly status: "computed";
      readonly areaBasis: EnvelopeAreaBasis;
      readonly landAreaM2: string;
      readonly footprintMaxM2: string;
      /** El FOT publicado, en la misma forma que las filas de la sensibilidad. */
      readonly fot: string | null;
      readonly fotMaxM2: string | null;
      readonly floors: number | null;
      readonly floorsBasis: "published" | "from_height" | null;
      readonly heightBoundM2: string | null;
      readonly buildableM2: string;
      /** Qué límite decide: el FOT o la altura. */
      readonly binding: "fot" | "height";
      readonly sensitivity: readonly {
        readonly fot: string;
        readonly buildableM2: string;
      }[];
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "land_area_missing"
        | "zoning_unknown"
        | "fos_not_published"
        | "fot_and_height_not_published";
    };

const m2 = (value: Dec, path: string) => toFixedScale(value, 2, path);

/** Plantas desde la altura, con la convención de 3,5 + 2,8 m. */
export function floorsFromHeight(heightMaxM: string): number | null {
  const height = parseDecimal(heightMaxM, "heightMaxM");
  const ground = parseDecimal(GROUND_FLOOR_HEIGHT_M, "ground");
  if (height.lessThan(ground)) return null;
  return (
    height
      .minus(ground)
      .div(parseDecimal(TYPICAL_FLOOR_HEIGHT_M, "typical"))
      .floor()
      .toNumber() + 1
  );
}

export function buildableEnvelope(input: {
  readonly landAreaM2: string | null;
  readonly areaBasis: EnvelopeAreaBasis | null;
  readonly parameters: ZoningParameters | null;
}): BuildableEnvelope {
  if (input.parameters === null)
    return { status: "unavailable", reason: "zoning_unknown" };
  if (input.landAreaM2 === null || input.areaBasis === null)
    return { status: "unavailable", reason: "land_area_missing" };
  const { fos, fot, heightMaxM, floorsMax } = input.parameters;
  if (fos === null)
    return { status: "unavailable", reason: "fos_not_published" };

  const area = parseDecimal(input.landAreaM2, "landAreaM2");
  const footprint = parseDecimal(fos, "fos").times(area);
  const floors =
    floorsMax ?? (heightMaxM === null ? null : floorsFromHeight(heightMaxM));
  const floorsBasis =
    floorsMax !== null ? "published" : floors !== null ? "from_height" : null;
  const heightBound = floors === null ? null : footprint.times(floors);
  if (fot === null && heightBound === null)
    return { status: "unavailable", reason: "fot_and_height_not_published" };

  const atFot = (factor: Dec): { value: Dec; binding: "fot" | "height" } => {
    const byFot = factor.times(area);
    return heightBound !== null && heightBound.lessThan(byFot)
      ? { value: heightBound, binding: "height" }
      : { value: byFot, binding: "fot" };
  };

  let buildable: { value: Dec; binding: "fot" | "height" };
  const sensitivity: { fot: string; buildableM2: string }[] = [];
  if (fot === null) buildable = { value: heightBound!, binding: "height" };
  else {
    const factor = parseDecimal(fot, "fot");
    buildable = atFot(factor);
    const step = parseDecimal(FOT_SENSITIVITY, "sensitivity");
    for (const moved of [factor.minus(step), factor, factor.plus(step)]) {
      if (!moved.greaterThan(0)) continue;
      sensitivity.push({
        fot: moved.toFixed(),
        buildableM2: m2(atFot(moved).value, "sensitivity"),
      });
    }
  }

  return {
    status: "computed",
    areaBasis: input.areaBasis,
    landAreaM2: input.landAreaM2,
    footprintMaxM2: m2(footprint, "footprintMaxM2"),
    fot: fot === null ? null : parseDecimal(fot, "fot").toFixed(),
    fotMaxM2:
      fot === null ? null : m2(parseDecimal(fot, "fot").times(area), "fot"),
    floors,
    floorsBasis,
    heightBoundM2: heightBound === null ? null : m2(heightBound, "heightBound"),
    buildableM2: m2(buildable.value, "buildableM2"),
    binding: buildable.binding,
    sensitivity,
  };
}
