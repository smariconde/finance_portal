import {
  resolveSectorLabel,
  SP500_SECTOR_TAXONOMY_ID,
  type SectorRejectionCode,
} from "./sector-taxonomy";
import {
  isOpenClassification,
  subjectClassificationSchema,
  type SubjectClassification,
} from "./subject-classification";

/**
 * Planificador de la clasificación sectorial
 * ([ADR 0025](../../../../docs/architecture/adr/0025-declared-sector-classification.md)).
 *
 * Es puro: recibe lo que la fuente afirma y lo que la base ya tiene, y devuelve
 * lo que habría que escribir. No abre transacciones ni mira el reloj.
 */
export const SECTOR_CLASSIFICATION_RULE_VERSION = "sector-classification-1.0.0";

/**
 * El pin del paquete es a la vez la **versión** de la taxonomía y la fecha desde
 * la que la aserción podía conocerse.
 *
 * Que el `availableAt` sea el `committedAt` del commit y no el instante de la
 * descarga es lo que hace que `TM-06` valga: un `as_known` anterior a ese commit
 * no ve esta clasificación, porque antes de ese commit efectivamente no existía.
 */
export type SectorSourcePin = {
  readonly commit: string;
  readonly committedAt: string;
};

export type SectorClaim = {
  readonly subjectId: string;
  /** Etiqueta cruda de la fuente; puede faltar. */
  readonly rawSector: string | null;
  /** Para nombrar el rechazo sin exponer el valor recibido. */
  readonly claimSymbol: string | null;
};

export type SectorPlanRejection = {
  readonly claimSymbol: string | null;
  readonly subjectId: string;
  readonly code: SectorRejectionCode;
};

/**
 * Una supersesión, no un cierre. El paquete no publica **desde cuándo** cambió
 * el sector de una empresa, así que fechar el cambio con el instante de la
 * corrida sería inventar evidencia: es la misma razón por la que la
 * [ADR 0013](../../../../docs/architecture/adr/0013-listing-events-dated-evidence.md)
 * supersede un renombre anterior a la versión registrada en vez de cerrarlo en
 * el pasado.
 */
export type SectorSupersession = {
  readonly subjectId: string;
  readonly validFrom: string;
  readonly supersededAt: string;
  readonly previousCode: string;
  readonly nextCode: string;
};

export type SectorClassificationPlan = {
  readonly ruleVersion: string;
  readonly taxonomyId: string;
  readonly taxonomyVersion: string;
  readonly opened: readonly SubjectClassification[];
  readonly supersessions: readonly SectorSupersession[];
  readonly rejections: readonly SectorPlanRejection[];
  readonly counts: {
    readonly claims: number;
    readonly opened: number;
    readonly superseded: number;
    readonly unchanged: number;
    readonly rejected: number;
    /**
     * Sujetos con aserción vigente que esta corrida **no** vuelve a afirmar.
     * Se cuentan y no se tocan: ver `plan` para el motivo.
     */
    readonly notReasserted: number;
  };
};

export type PlanSectorClassificationInput = {
  readonly claims: readonly SectorClaim[];
  /** Aserciones ya guardadas en esta taxonomía, vigentes o no. */
  readonly stored: readonly SubjectClassification[];
  readonly pin: SectorSourcePin;
  readonly sourceId: string;
  readonly sourceDocumentId: string | null;
  readonly recordedAt: string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
};

/**
 * El contenido que identifica una aserción: sujeto, taxonomía y código.
 *
 * La **versión del pin queda afuera a propósito**. Si quedara adentro, cada
 * cambio de pin reescribiría las quinientas filas aunque ningún sector hubiera
 * cambiado, y el historial dejaría de distinguir «cambió de sector» de «hubo un
 * rebalanceo». Lo que la fila guarda en `taxonomyVersion` es el pin que afirmó
 * **por primera vez** el valor vigente, no el último que lo confirmó, y por eso
 * su `availableAt` sigue siendo el instante correcto para `TM-06`.
 */
function contentOf(
  subjectId: string,
  taxonomyId: string,
  code: string,
): string {
  return `${taxonomyId}|${subjectId}|${code}`;
}

export function planSectorClassification(
  input: PlanSectorClassificationInput,
): SectorClassificationPlan {
  const {
    claims,
    stored,
    pin,
    sourceId,
    sourceDocumentId,
    recordedAt,
    newId,
    hashContent,
  } = input;

  const openBySubject = new Map<string, SubjectClassification>();

  for (const classification of stored) {
    if (
      classification.taxonomyId === SP500_SECTOR_TAXONOMY_ID &&
      isOpenClassification(classification)
    ) {
      openBySubject.set(classification.subjectId, classification);
    }
  }

  const opened: SubjectClassification[] = [];
  const supersessions: SectorSupersession[] = [];
  const rejections: SectorPlanRejection[] = [];
  const reasserted = new Set<string>();
  let unchanged = 0;

  for (const claim of claims) {
    const resolution = resolveSectorLabel(claim.rawSector);

    if (!resolution.ok) {
      rejections.push({
        claimSymbol: claim.claimSymbol,
        subjectId: claim.subjectId,
        code: resolution.code,
      });
      continue;
    }

    reasserted.add(claim.subjectId);
    const open = openBySubject.get(claim.subjectId);

    // Mismo sector que el vigente: la corrida lo confirma y no escribe nada.
    // Reconstituir dos veces el mismo estado no abre ni cierra nada.
    if (open !== undefined && open.code === resolution.code) {
      unchanged += 1;
      continue;
    }

    if (open !== undefined) {
      supersessions.push({
        subjectId: claim.subjectId,
        validFrom: open.validFrom,
        supersededAt: pin.committedAt,
        previousCode: open.code,
        nextCode: resolution.code,
      });
    }

    opened.push(
      subjectClassificationSchema.parse({
        classificationAssignmentId: newId(),
        subjectType: "legal_entity",
        subjectId: claim.subjectId,
        taxonomyId: SP500_SECTOR_TAXONOMY_ID,
        taxonomyVersion: pin.commit,
        code: resolution.code,
        label: resolution.label,
        validFrom: pin.committedAt,
        validTo: null,
        availableAt: pin.committedAt,
        supersededAt: null,
        sourceId,
        sourceDocumentId,
        contentHash: hashContent(
          contentOf(claim.subjectId, SP500_SECTOR_TAXONOMY_ID, resolution.code),
        ),
        recordedAt,
      }),
    );
  }

  /**
   * Un sujeto que tenía sector y que esta corrida no vuelve a afirmar **no se
   * cierra**.
   *
   * Es la diferencia con la membresía, y no es una omisión. La lista es
   * autoritativa sobre quién está en el índice, así que dejar de listar a una
   * empresa **es** la evidencia de que salió. Pero no es autoritativa sobre de
   * qué sector es una empresa: que deje de listarla no dice que haya cambiado de
   * sector, dice que dejó de mirarla. Cerrar la aserción ahí afirmaría algo que
   * la fuente no dijo —la misma regla de la
   * [ADR 0014](../../../../docs/architecture/adr/0014-declared-corporate-events.md):
   * una tabla parcial no prueba una ausencia—.
   */
  let notReasserted = 0;

  for (const subjectId of openBySubject.keys()) {
    if (!reasserted.has(subjectId)) {
      notReasserted += 1;
    }
  }

  return {
    ruleVersion: SECTOR_CLASSIFICATION_RULE_VERSION,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: pin.commit,
    opened,
    supersessions,
    rejections,
    counts: {
      claims: claims.length,
      opened: opened.length,
      superseded: supersessions.length,
      unchanged,
      rejected: rejections.length,
      notReasserted,
    },
  };
}
