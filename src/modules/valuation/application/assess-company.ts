import { SEC_SIC_TAXONOMY_ID } from "@/modules/classification/domain/sec-sic-classification";
import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";
import {
  pointInTimeQuerySchema,
  type PointInTimeQuery,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";

import {
  buildAnnualFundamentals,
  chooseFiscalYearAnchor,
  type AnnualFundamentals,
  type FundamentalRow,
} from "../domain/annual-fundamentals";
import {
  completenessCheck,
  measureCompleteness,
  type CompletenessProfile,
  type IndustryMappingStatus,
} from "../domain/completeness-profile";
import {
  assessFundamentalProfileSignals,
  type FundamentalSignal,
} from "../domain/fundamental-profile-signals";
import {
  selectValuationMethod,
  type MethodSelection,
  type ProfileEvidence,
} from "../domain/method-selection";
import { deriveRigorLevel, type RigorAssessment } from "../domain/rigor-level";
import {
  assessSicProfiles,
  sicProfileEvidence,
  type SicProfileAssessment,
} from "../domain/sic-profile-signals";

/**
 * Evaluación de una empresa a demanda (`F3-01`): lo que el portal sabe de ella al
 * corte pedido y qué método le corresponde.
 *
 * Es el gate de la Fase 3 tal como lo decidió el owner el 2026-10-02: no se
 * clasifica el universo por adelantado, se clasifica la empresa que se va a
 * analizar, cuando se la analiza. No abre red ni escribe: recibe lo guardado.
 */
export type CompanyAssessmentDependencies = {
  /** Aserciones SIC del sujeto, vigentes o no: el selector filtra por tiempo. */
  readonly loadSicAssertions: (
    legalEntityId: string,
  ) => Promise<readonly SubjectClassification[]>;
  /** Filas de fundamentals del linaje, ya elegidas por la consulta. */
  readonly readFundamentals: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<readonly FundamentalRow[]>;
  /**
   * Últimos cierres anuales con `fp = FY` que registró la ingesta (ADR 0017),
   * uno por sujeto del linaje que lo tenga.
   */
  readonly fiscalYearAnchors: (
    subjectIds: readonly string[],
  ) => Promise<readonly string[]>;
};

export type CompanyAssessmentRequest = {
  readonly legalEntityId: string;
  readonly query: PointInTimeQueryInput;
  /** Fuente de los fundamentals, para la provenance de la evidencia. */
  readonly fundamentalsSourceId: string;
  /** Resultado del mapeo a industria (`F3-05`), si ya se evaluó. */
  readonly industryMapping?: IndustryMappingStatus | null;
};

export type CompanyAssessment = {
  readonly legalEntityId: string;
  readonly query: PointInTimeQuery;
  readonly sic: {
    readonly code: string;
    readonly label: string;
    readonly availableAt: string;
    readonly profiles: SicProfileAssessment;
  } | null;
  readonly fundamentals: {
    readonly anchor: string | null;
    readonly series: AnnualFundamentals | null;
  };
  readonly fundamentalSignals: readonly FundamentalSignal[];
  readonly evidence: readonly ProfileEvidence[];
  readonly completeness: CompletenessProfile;
  readonly selection: MethodSelection;
  /** Derivado de la selección y la completitud (`F3-03`), nunca elegido. */
  readonly rigor: RigorAssessment;
};

function isVisible(
  classification: SubjectClassification,
  query: PointInTimeQuery,
): boolean {
  return (
    isEffectiveAt(classification, query.effectiveAt) &&
    isKnownAt(classification, query)
  );
}

export async function assessCompany(
  request: CompanyAssessmentRequest,
  dependencies: CompanyAssessmentDependencies,
): Promise<CompanyAssessment> {
  const query = pointInTimeQuerySchema.parse(request.query);
  const { legalEntityId } = request;

  const assertions = (
    await dependencies.loadSicAssertions(legalEntityId)
  ).filter(
    (classification) =>
      classification.taxonomyId === SEC_SIC_TAXONOMY_ID &&
      classification.subjectId === legalEntityId,
  );

  const sicEvidence = assertions.flatMap((classification) =>
    sicProfileEvidence({
      legalEntityId,
      sic: classification.code,
      validFrom: classification.validFrom,
      validTo: classification.validTo,
      availableAt: classification.availableAt,
      supersededAt: classification.supersededAt,
      recordedAt: classification.recordedAt,
      sourceId: classification.sourceId,
      sourceDocumentId: classification.sourceDocumentId,
      contentHash: classification.contentHash,
    }),
  );

  const visibleSic = assertions.find((classification) =>
    isVisible(classification, query),
  );

  const rows = await dependencies.readFundamentals(legalEntityId, query);
  const lineageSubjects = [
    ...new Set([legalEntityId, ...rows.map((row) => row.subjectId)]),
  ];
  const anchor = chooseFiscalYearAnchor(
    await dependencies.fiscalYearAnchors(lineageSubjects),
    rows,
  );
  const series =
    anchor === null
      ? null
      : buildAnnualFundamentals(rows, anchor, query.effectiveAt.slice(0, 10));

  const fundamental =
    series === null
      ? null
      : assessFundamentalProfileSignals(
          legalEntityId,
          series,
          request.fundamentalsSourceId,
        );

  const evidence = [...sicEvidence, ...(fundamental?.evidence ?? [])];
  const completeness = measureCompleteness(series, {
    industryMapping: request.industryMapping ?? null,
  });

  const selection = selectValuationMethod({
    legalEntityId,
    knowledge: query,
    evidence,
    fcffInputsComplete:
      completenessCheck(completeness, "structural_inputs").status === "met",
  });

  return {
    legalEntityId,
    query,
    sic:
      visibleSic === undefined
        ? null
        : {
            code: visibleSic.code,
            label: visibleSic.label,
            availableAt: visibleSic.availableAt,
            profiles: assessSicProfiles(visibleSic.code),
          },
    fundamentals: { anchor, series },
    fundamentalSignals: fundamental?.signals ?? [],
    evidence,
    completeness,
    selection,
    rigor: deriveRigorLevel(selection, completeness),
  };
}
