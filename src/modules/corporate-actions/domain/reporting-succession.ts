import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import {
  calendarDateSchema,
  contentHashSchema,
  refineTemporalVersion,
  temporalVersionShape,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

/**
 * Sucesión de emisor: el contrato ejecutable de la primera corporate action del
 * proyecto (`docs/data/identity-model.md`, "Corporate actions").
 *
 * Una reorganización en holding —la SEC la registra como `8-K12B` o `8-K12G3`—
 * cambia el CIK que presenta los estados del grupo sin que el grupo cambie. El
 * modelo la guarda en dos piezas que no se mezclan:
 *
 * - el **evento** (`CorporateAction`), inmutable, con la presentación que lo hizo
 *   público y la fecha que esa presentación declara;
 * - el **vínculo** (`LegalEntityRelationship`), una dimensión versionada entre dos
 *   entidades legales que conservan sus IDs. Nunca se recicla el ID del sucesor
 *   para el antecesor ni se reasignan hechos (invariante 9 del modelo).
 */
export const SUCCESSION_EVIDENCE_RULE_VERSION = "sec-succession-evidence-1.0.0";

const cikSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,10}$/u)
  .refine((value) => Number(value) > 0, "CIK must be positive.")
  .transform((value) => value.padStart(10, "0"));

const accessionSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u);

/**
 * Declaración del owner. `submissions` no publica un «CIK antecesor» y la
 * presentación de sucesión lo nombra sólo en texto libre, así que el vínculo no se
 * detecta: se declara con la presentación que lo prueba y se verifica contra el
 * cable. Una coincidencia de nombre no alcanza (invariante 8).
 */
export const declaredSuccessionSchema = z
  .object({
    predecessorCik: cikSchema,
    successorCik: cikSchema,
    /** Accession de la presentación de sucesión, en el índice del sucesor. */
    successionAccession: accessionSchema,
    decidedBy: z.literal("owner"),
    decidedOn: calendarDateSchema,
    /** Por qué la sucesión une series: se lee en el diff, no se interpreta. */
    rationale: z.string().trim().min(1).max(512),
  })
  .superRefine((declaration, context) => {
    if (declaration.predecessorCik === declaration.successorCik) {
      context.addIssue({
        code: "custom",
        path: ["successorCik"],
        message: "A filer cannot succeed itself.",
      });
    }
  });

export type DeclaredSuccession = z.infer<typeof declaredSuccessionSchema>;
export type DeclaredSuccessionInput = z.input<typeof declaredSuccessionSchema>;

export const corporateActionTypeSchema = z.enum([
  "successor_issuer",
  "split",
  "reverse_split",
  "listing_transfer",
  "delisting",
  "acquisition",
  "symbol_change",
]);

export type CorporateActionType = z.infer<typeof corporateActionTypeSchema>;

const CANONICAL_RATIO = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const MIC = /^[A-Z0-9]{4}$/u;

/**
 * Evento inmutable (`docs/data/point-in-time-contract.md`, "Eventos"). La fecha
 * efectiva es calendaria —la que declara la fuente— y no se convierte a medianoche
 * UTC; el vínculo que el evento abre lleva su propio instante de vigencia.
 *
 * Un split (ADR 0012) es un cambio de la **base accionaria reportada por el
 * filer**: su sujeto es la entidad legal cuyos hechos sin dimensiones re-expresó,
 * y `terms.ratio` son las acciones nuevas por cada anterior, como texto exacto.
 * Mayor que uno es `split`; entre cero y uno, `reverse_split`. PostgreSQL espeja
 * las tres condiciones.
 *
 * Un traspaso de mercado y un delisting (ADR 0013) cambian dónde cotiza un
 * instrumento, no la base de nada: el traspaso es de la **security** —el mismo
 * instrumento abre un listing en otro MIC— y el delisting del **listing** que se
 * cierra. Los dos llevan en `terms` los MIC que afirman.
 */
export const corporateActionSchema = z
  .object({
    corporateActionId: z.uuid(),
    actionType: corporateActionTypeSchema,
    subjectType: z.enum(["legal_entity", "security", "listing"]),
    subjectId: z.uuid(),
    announcedAt: utcTimestampSchema.nullable(),
    effectiveOn: calendarDateSchema,
    availableAt: utcTimestampSchema,
    sourceId: sourceIdSchema,
    sourceDocumentId: z.string().trim().min(1).max(256),
    /** Términos del evento como texto exacto: nunca un `number` binario. */
    terms: z.record(
      z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
      z.string().trim().min(1).max(256),
    ),
    contentHash: contentHashSchema,
    recordedAt: utcTimestampSchema,
  })
  .superRefine((action, context) => {
    if (
      action.actionType === "acquisition" ||
      action.actionType === "symbol_change"
    ) {
      const acquisition = action.actionType === "acquisition";
      const terms = action.terms;
      const valid = acquisition
        ? action.subjectType === "legal_entity" &&
          z.uuid().safeParse(terms.acquirerLegalEntityId).success &&
          terms.acquirerLegalEntityId !== action.subjectId
        : action.subjectType === "listing" &&
          MIC.test(terms.mic ?? "") &&
          /^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(terms.fromSymbol ?? "") &&
          /^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(terms.toSymbol ?? "") &&
          terms.fromSymbol !== terms.toSymbol;
      if (
        !valid ||
        terms.decidedBy !== "owner" ||
        !utcTimestampSchema.safeParse(terms.decidedAt).success ||
        !contentHashSchema.safeParse(terms.declarationHash).success ||
        !terms.rationale ||
        !terms.ruleVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["terms"],
          message:
            "A declared event requires its subject, terms and owner decision.",
        });
      }
      return;
    }

    if (action.actionType === "successor_issuer") {
      return;
    }

    if (action.actionType === "listing_transfer") {
      if (action.subjectType !== "security") {
        context.addIssue({
          code: "custom",
          path: ["subjectType"],
          message: "A listing transfer moves a security between venues.",
        });
      }

      const { fromMic, toMic } = action.terms;

      if (
        fromMic === undefined ||
        toMic === undefined ||
        !MIC.test(fromMic) ||
        !MIC.test(toMic) ||
        fromMic === toMic
      ) {
        context.addIssue({
          code: "custom",
          path: ["terms"],
          message: "A listing transfer requires two distinct MICs.",
        });
      }

      return;
    }

    if (action.actionType === "delisting") {
      if (action.subjectType !== "listing") {
        context.addIssue({
          code: "custom",
          path: ["subjectType"],
          message: "A delisting closes a listing.",
        });
      }

      if (action.terms.mic === undefined || !MIC.test(action.terms.mic)) {
        context.addIssue({
          code: "custom",
          path: ["terms", "mic"],
          message: "A delisting requires the MIC it leaves.",
        });
      }

      return;
    }

    if (action.subjectType !== "legal_entity") {
      context.addIssue({
        code: "custom",
        path: ["subjectType"],
        message: "A split changes the share basis a legal entity reports.",
      });
    }

    const ratio = action.terms.ratio;

    if (ratio === undefined || !CANONICAL_RATIO.test(ratio)) {
      context.addIssue({
        code: "custom",
        path: ["terms", "ratio"],
        message: "A split requires its ratio as a canonical decimal string.",
      });
      return;
    }

    // Comparar el texto contra «1» sin aritmética binaria: la parte entera decide,
    // y con parte entera 1 decide si queda algún dígito decimal distinto de cero.
    const [integer, fraction = ""] = ratio.split(".");
    const aboveOne =
      integer !== "0" && (integer !== "1" || /[1-9]/u.test(fraction));
    const belowOne = integer === "0" && /[1-9]/u.test(fraction);

    if (action.actionType === "split" ? !aboveOne : !belowOne) {
      context.addIssue({
        code: "custom",
        path: ["terms", "ratio"],
        message:
          "A split ratio must exceed one and a reverse split ratio must lie between zero and one.",
      });
    }
  });

export type CorporateAction = z.infer<typeof corporateActionSchema>;

/**
 * Hash del contenido de un evento. Cubre lo que el evento afirma, nunca el ID
 * generado ni el instante local: la misma evidencia registrada en otra corrida
 * hashea igual, y una descripción distinta de la misma accession es un conflicto.
 */
export function computeCorporateActionContentHash(
  action: Omit<
    CorporateAction,
    "corporateActionId" | "contentHash" | "recordedAt"
  >,
): string {
  return computeContentHash({
    actionType: action.actionType,
    subjectType: action.subjectType,
    subjectId: action.subjectId,
    announcedAt: action.announcedAt,
    effectiveOn: action.effectiveOn,
    availableAt: action.availableAt,
    sourceId: action.sourceId,
    sourceDocumentId: action.sourceDocumentId,
    terms: action.terms,
  });
}

export const relationshipTypeSchema = z.enum([
  "reporting_successor",
  "acquired_by",
]);

/**
 * Vínculo versionado entre dos entidades legales.
 *
 * `reporting_successor` es el único tipo que **une historias**: el antecesor
 * presentaba los estados del mismo grupo consolidado. `acquired_by` registra una
 * adquisición sin incorporarla al linaje de reporte.
 *
 * `effectiveOn` es el borde de la partición en el calendario de la fuente —el
 * antecesor aporta hechos con `as_of` anterior— y `validFrom` es ese mismo día a
 * las 00:00 de Nueva York. PostgreSQL verifica que los dos digan lo mismo.
 */
export const legalEntityRelationshipSchema = z
  .object({
    ...temporalVersionShape,
    relationshipId: z.uuid(),
    relationshipType: relationshipTypeSchema,
    predecessorLegalEntityId: z.uuid(),
    successorLegalEntityId: z.uuid(),
    corporateActionId: z.uuid(),
    effectiveOn: calendarDateSchema,
    decidedBy: z.enum(["rule", "owner"]),
    decisionRuleVersion: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:[.\-_][a-z0-9]+)*$/u),
  })
  .superRefine((relationship, context) => {
    refineTemporalVersion(relationship, context);

    if (
      relationship.predecessorLegalEntityId ===
      relationship.successorLegalEntityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["successorLegalEntityId"],
        message: "A legal entity cannot succeed itself.",
      });
    }

    if (
      relationship.validFrom !== startOfNewYorkDay(relationship.effectiveOn)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validFrom"],
        message: "validFrom must be the start of effectiveOn in New York.",
      });
    }
  });

export type LegalEntityRelationship = z.infer<
  typeof legalEntityRelationshipSchema
>;

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function newYorkLocalTime(instantMs: number): string {
  const parts = Object.fromEntries(
    NEW_YORK_CLOCK.formatToParts(new Date(instantMs)).map((part) => [
      part.type,
      part.value,
    ]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * Primer instante de una fecha calendaria en Nueva York, en UTC.
 *
 * Una presentación de la SEC declara la fecha del evento, no la hora. El inicio
 * del día en el huso de EDGAR es la lectura que no adelanta ni atrasa la fecha
 * declarada; medianoche UTC la correría cuatro o cinco horas hacia la noche
 * anterior en Nueva York. Los dos candidatos son los dos offsets posibles y se
 * elige el que el calendario de la zona confirma, así que los días de cambio de
 * horario —y las reglas anteriores a 2007— salen de la base de zonas y no de una
 * regla escrita a mano.
 */
export function startOfNewYorkDay(date: string): string {
  const parsed = calendarDateSchema.parse(date);

  for (const hour of ["04", "05"]) {
    const instant = Date.parse(`${parsed}T${hour}:00:00.000Z`);

    if (newYorkLocalTime(instant) === `${parsed}T00:00:00`) {
      return new Date(instant).toISOString();
    }
  }

  // Nueva York no tiene offsets fuera de -4 y -5 desde que existe EDGAR.
  throw new RangeError(`No New York midnight found for ${parsed}.`);
}
