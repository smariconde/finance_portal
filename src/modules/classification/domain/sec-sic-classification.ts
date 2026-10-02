import { z } from "zod";

import type { ClassificationPlan } from "./plan-sector-classification";
import {
  isOpenClassification,
  subjectClassificationSchema,
  type SubjectClassification,
} from "./subject-classification";

/**
 * El SIC que la SEC asigna a un filer, como aserción fechada (`F3-01`).
 *
 * La SEC publica el código **vigente** en `submissions` y no dice desde cuándo
 * rige. Por eso la aserción se fecha con la observación, igual que el registro
 * CEDEAR (ADR 0027): `validFrom` y `availableAt` son el instante de la descarga, y
 * un corte anterior a la primera captura no ve ningún SIC. Fecharlo hacia atrás
 * sería inventar desde cuándo la empresa es lo que la SEC dice hoy.
 *
 * Un cambio de código **supersede** en la nueva observación y no cierra la
 * vigencia anterior en una fecha que la fuente nunca publicó (la misma regla de la
 * ADR 0025 para el sector).
 */
export const SEC_SIC_TAXONOMY_ID = "sec-sic";
export const SEC_SIC_CLASSIFICATION_RULE_VERSION =
  "sec-sic-classification-1.0.0";

/** Cuatro dígitos, como los publica la lista oficial de la SEC. */
export const secSicCodeSchema = z.string().regex(/^[0-9]{4}$/u);

const sicEnvelopeSchema = z.object({
  sic: secSicCodeSchema,
  sicDescription: z.string().trim().min(1).max(128).nullable().optional(),
});

export type SecSicReading = {
  readonly sic: string;
  readonly description: string | null;
};

/**
 * Lee el SIC de un payload de `submissions` ya validado por su parser. Un SIC
 * ausente o malformado es `null`: no se repara ni se adivina, y tampoco prueba
 * nada sobre la empresa.
 */
export function readSecSic(payload: unknown): SecSicReading | null {
  const parsed = sicEnvelopeSchema.safeParse(payload);

  if (!parsed.success) {
    return null;
  }

  return {
    sic: parsed.data.sic,
    description: parsed.data.sicDescription ?? null,
  };
}

export type SecSicObservation = {
  readonly subjectId: string;
  readonly reading: SecSicReading;
  /** Instante de la descarga de `submissions`: la única fecha defendible. */
  readonly observedAt: string;
  readonly sourceId: string;
  readonly sourceDocumentId: string;
};

export type PlanSecSicClassificationInput = {
  readonly observation: SecSicObservation;
  /** Aserciones ya guardadas en la taxonomía, vigentes o no. */
  readonly stored: readonly SubjectClassification[];
  readonly recordedAt: string;
  /** Versión del parser que leyó el payload: el release de la aserción. */
  readonly taxonomyVersion: string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
};

function contentOf(subjectId: string, code: string): string {
  return `${SEC_SIC_TAXONOMY_ID}|${subjectId}|${code}`;
}

/** La etiqueta es para leer; la SEC escribe la descripción en mayúsculas o no. */
function labelOf(reading: SecSicReading): string {
  return reading.description === null
    ? `SIC ${reading.sic}`
    : `${reading.sic} ${reading.description}`.slice(0, 128);
}

/**
 * Planificador puro del SIC de un sujeto. Devuelve el mismo plan que aplica el
 * repositorio de clasificaciones, así que abrir la nueva aserción y superseder la
 * anterior son una sola transacción.
 */
export function planSecSicClassification(
  input: PlanSecSicClassificationInput,
): ClassificationPlan {
  const { observation, stored, recordedAt, newId, hashContent } = input;
  const open = stored.filter(
    (classification) =>
      classification.taxonomyId === SEC_SIC_TAXONOMY_ID &&
      classification.subjectId === observation.subjectId &&
      isOpenClassification(classification),
  );

  if (open.length > 1) {
    throw new Error(
      `subject ${observation.subjectId} has more than one open SIC assertion`,
    );
  }

  const current = open[0];
  const code = observation.reading.sic;
  const base = {
    ruleVersion: SEC_SIC_CLASSIFICATION_RULE_VERSION,
    taxonomyId: SEC_SIC_TAXONOMY_ID,
    taxonomyVersion: input.taxonomyVersion,
    rejections: [],
  };

  if (current !== undefined && current.code === code) {
    return {
      ...base,
      opened: [],
      supersessions: [],
      counts: {
        claims: 1,
        opened: 0,
        superseded: 0,
        unchanged: 1,
        rejected: 0,
        notReasserted: 0,
      },
    };
  }

  if (
    current !== undefined &&
    Date.parse(observation.observedAt) <= Date.parse(current.availableAt)
  ) {
    // Una observación que no es posterior a la vigente no puede reemplazarla: el
    // orden de las descargas es lo único que fecha el cambio.
    throw new Error(
      `SIC observation for ${observation.subjectId} does not follow the stored assertion`,
    );
  }

  const opened = subjectClassificationSchema.parse({
    classificationAssignmentId: newId(),
    subjectType: "legal_entity",
    subjectId: observation.subjectId,
    taxonomyId: SEC_SIC_TAXONOMY_ID,
    taxonomyVersion: input.taxonomyVersion,
    code,
    label: labelOf(observation.reading),
    validFrom: observation.observedAt,
    validTo: null,
    availableAt: observation.observedAt,
    supersededAt: null,
    sourceId: observation.sourceId,
    sourceDocumentId: observation.sourceDocumentId,
    contentHash: hashContent(contentOf(observation.subjectId, code)),
    recordedAt,
  });

  return {
    ...base,
    opened: [opened],
    supersessions:
      current === undefined
        ? []
        : [
            {
              subjectId: observation.subjectId,
              validFrom: current.validFrom,
              supersededAt: observation.observedAt,
              previousCode: current.code,
              nextCode: code,
            },
          ],
    counts: {
      claims: 1,
      opened: 1,
      superseded: current === undefined ? 0 : 1,
      unchanged: 0,
      rejected: 0,
      notReasserted: 0,
    },
  };
}

/**
 * Lo guardado con el plan ya aplicado, sin escribir: lo que el dry run evalúa.
 * Supersede y abre igual que la transacción del repositorio, así que el dry run
 * ve exactamente lo que `--apply` dejaría.
 */
export function projectClassificationPlan(
  stored: readonly SubjectClassification[],
  plan: ClassificationPlan,
): readonly SubjectClassification[] {
  const projected = stored.map((classification) => {
    const supersession = plan.supersessions.find(
      (candidate) =>
        candidate.subjectId === classification.subjectId &&
        candidate.validFrom === classification.validFrom &&
        classification.taxonomyId === plan.taxonomyId &&
        isOpenClassification(classification),
    );

    return supersession === undefined
      ? classification
      : { ...classification, supersededAt: supersession.supersededAt };
  });

  return [...projected, ...plan.opened];
}
