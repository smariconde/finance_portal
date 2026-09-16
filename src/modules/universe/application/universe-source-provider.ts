import type {
  CompanyTickerAssignment,
  IndexConstituentClaim,
} from "../domain/universe-source-records";

/**
 * Puerto de las dos fuentes que constituyen el universo.
 *
 * `constituteUniverse` recibe los registros ya parseados a propósito: la decisión
 * de identidad vive en el dominio y probarla no debe exigir red ni base. Este
 * puerto es el otro lado de esa separación —de dónde salen esos registros— y su
 * implementación viva es el único lugar donde el universo toca la red.
 */
export type UniverseSourceDocument = {
  readonly sourceId: string;
  /** Origen y path del documento, sin query (`TM-02`). */
  readonly url: string;
  readonly fetchedAt: string;
  readonly byteLength: number;
  /** Hash del contenido descargado, para que la corrida sea reproducible. */
  readonly contentHash: string;
  readonly parserVersion: string;
  /** Filas que el parser rechazó nombradas; nunca sus valores. */
  readonly rejectedRows: number;
};

export type UniverseSourceSnapshot = {
  readonly claims: readonly IndexConstituentClaim[];
  readonly assignments: readonly CompanyTickerAssignment[];
  readonly documents: readonly UniverseSourceDocument[];
};

export type UniverseSourceFailureCode =
  /** El registro de fuentes no aprobó esta fuente para acceso automatizado. */
  | "rights_not_approved"
  /** La fuente no está registrada. */
  | "source_not_registered"
  /** La URL no fija una versión inmutable del documento. */
  | "source_not_pinned"
  /** El egress falló o fue bloqueado. */
  | "fetch_failed"
  /** La fuente respondió algo que no es el documento. */
  | "unexpected_status"
  /** El documento no tiene la forma que el parser declara entender. */
  | "parser_broken";

/**
 * Fallo de una fuente del universo. Conserva un código cerrado y auditable; el
 * detalle nunca incluye el payload ni la query del destino.
 */
export class UniverseSourceError extends Error {
  readonly code: UniverseSourceFailureCode;
  readonly sourceId: string;

  constructor(
    code: UniverseSourceFailureCode,
    sourceId: string,
    detail?: string,
  ) {
    super(
      detail === undefined
        ? `Universe source "${sourceId}" failed with ${code}.`
        : `Universe source "${sourceId}" failed with ${code}: ${detail}.`,
    );
    this.name = "UniverseSourceError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

export interface UniverseSourceProvider {
  readonly indexId: string;
  load(): Promise<UniverseSourceSnapshot>;
}
