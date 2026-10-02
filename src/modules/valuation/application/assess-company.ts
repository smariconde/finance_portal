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
  assessFundamentalProfileSignals,
  type FundamentalSignal,
} from "../domain/fundamental-profile-signals";
import {
  selectValuationMethod,
  type MethodSelection,
  type ProfileEvidence,
} from "../domain/method-selection";
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
  readonly fcffPreflight: FcffPreflight;
  readonly selection: MethodSelection;
};

export type FcffPreflight = {
  readonly complete: boolean;
  readonly missing: readonly string[];
};

/**
 * Preflight estructural del FCFF base sobre el último ejercicio. Sólo pregunta si
 * existen las partidas sin las cuales el motor no puede ni empezar; cuánto de lo
 * demás falta lo mide el perfil de completitud (`F3-02`).
 */
export function fcffPreflight(
  series: AnnualFundamentals | null,
): FcffPreflight {
  const latest = series?.fiscalYears[0];

  if (latest === undefined) {
    return { complete: false, missing: ["annual_fundamentals"] };
  }

  const missing: string[] = [];
  const { items } = latest;

  if (items.revenue === undefined) missing.push("revenue");
  if (
    items.operating_income === undefined &&
    (items.pretax_income === undefined || items.interest_expense === undefined)
  ) {
    missing.push("operating_income");
  }
  if (items.income_tax === undefined) missing.push("income_tax");
  if (items.diluted_shares === undefined) missing.push("diluted_shares");

  return { complete: missing.length === 0, missing };
}

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
  const preflight = fcffPreflight(series);

  const selection = selectValuationMethod({
    legalEntityId,
    knowledge: query,
    evidence,
    fcffInputsComplete: preflight.complete,
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
    fcffPreflight: preflight,
    selection,
  };
}
