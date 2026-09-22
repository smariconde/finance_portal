import { classificationCodeSchema } from "./subject-classification";

/**
 * La taxonomía de sector que el proyecto registra primero
 * ([ADR 0025](../../../../docs/architecture/adr/0025-declared-sector-classification.md)).
 *
 * **Se llama por lo que es, no por lo que reproduce.** El identificador no es
 * `gics` y la diferencia no es cosmética: GICS es una taxonomía propietaria de
 * S&P y MSCI, y lo que este proyecto tiene es la columna `GICS Sector` del
 * paquete PDDL, derivada de Wikipedia. El registro de fuentes ya dice de ese
 * paquete que «su upstream es Wikipedia y no prueba membresía oficial».
 *
 * Llamarla `gics` afirmaría una procedencia que nadie verificó contra S&P y
 * sugeriría derechos sobre una taxonomía que el proyecto no licenció. El nombre
 * dice las tres cosas que importan: qué universo cubre, de dónde sale de verdad
 * y qué pretende reproducir.
 */
export const SP500_SECTOR_TAXONOMY_ID = "sp500-wikipedia-gics-sector";

/**
 * Los once sectores del esquema que el paquete reproduce.
 *
 * La lista es **cerrada a propósito**. Una etiqueta que no esté acá se rechaza
 * por nombre en vez de caer en un cajón «Otros»: si el paquete cambia su
 * vocabulario —o si una fila viene con una industria donde debería haber un
 * sector— eso es una novedad que alguien tiene que mirar, no una fila más que
 * la matriz dibujaría como si fuera un sector real.
 */
const SECTOR_LABELS: readonly string[] = Object.freeze([
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
]);

/** `Information Technology` → `information-technology`. */
function toCode(label: string): string {
  return label.toLowerCase().replace(/\s+/gu, "-");
}

/**
 * Índice de búsqueda tolerante a la escritura: se compara en minúsculas y con
 * los espacios colapsados, porque «Health Care» y «health  care» son la misma
 * respuesta escrita distinto, no dos sectores.
 */
const BY_NORMALIZED_LABEL: ReadonlyMap<
  string,
  { code: string; label: string }
> = new Map(
  SECTOR_LABELS.map((label) => [
    label.toLowerCase().replace(/\s+/gu, " "),
    { code: toCode(label), label },
  ]),
);

export type SectorRejectionCode =
  /** La fila del paquete no trae sector. */
  | "sector_absent_in_source"
  /** Trae un valor que no es uno de los once sectores declarados. */
  | "sector_label_unknown";

export type SectorResolution =
  | { readonly ok: true; readonly code: string; readonly label: string }
  | { readonly ok: false; readonly code: SectorRejectionCode };

/**
 * Traduce la etiqueta cruda del paquete a un código de la taxonomía.
 *
 * Nunca adivina: un valor desconocido se nombra y no se clasifica. El valor
 * recibido no viaja en el rechazo (`TM-02`); el motivo alcanza para investigar.
 */
export function resolveSectorLabel(rawLabel: string | null): SectorResolution {
  if (rawLabel === null || rawLabel.trim().length === 0) {
    return { ok: false, code: "sector_absent_in_source" };
  }

  const normalized = rawLabel.trim().toLowerCase().replace(/\s+/gu, " ");
  const match = BY_NORMALIZED_LABEL.get(normalized);

  if (match === undefined) {
    return { ok: false, code: "sector_label_unknown" };
  }

  return { ok: true, code: match.code, label: match.label };
}

/** Los códigos declarados, para que una superficie no invente su propia lista. */
export function listSectorCodes(): readonly string[] {
  return SECTOR_LABELS.map(toCode);
}

/** Sanity check del módulo: los once códigos son válidos como código. */
export function assertSectorCodesAreValid(): void {
  for (const code of listSectorCodes()) {
    classificationCodeSchema.parse(code);
  }
}
