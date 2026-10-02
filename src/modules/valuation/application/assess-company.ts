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
} from "../domain/completeness-profile";
import {
  mapIndustry,
  type IndustryDeclaration,
  type IndustryMapping,
} from "../domain/industry-mapping";
import {
  buildCostOfCapital,
  COST_OF_CAPITAL_VERSION,
  type CostOfCapitalResult,
  type ReferenceReading,
} from "../domain/cost-of-capital";
import {
  assessFundamentalProfileSignals,
  latestInterestCoverage,
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
  /**
   * Industrias de la release de betas de Damodaran visible al corte, por clave,
   * o `null` si ninguna se conocía todavía (`F3-04`).
   */
  readonly industryRelease: (
    query: PointInTimeQuery,
  ) => Promise<ReadonlyMap<string, string> | null>;
  /** Las cuatro releases de Damodaran visibles al corte, o `null` cada una (`F3-04`). */
  readonly costOfCapitalReadings: (query: PointInTimeQuery) => Promise<{
    readonly betas: ReferenceReading | null;
    readonly countryRisk: ReferenceReading | null;
    readonly impliedErp: ReferenceReading | null;
    readonly ratings: ReferenceReading | null;
  }>;
};

export type CompanyAssessmentRequest = {
  readonly legalEntityId: string;
  readonly query: PointInTimeQueryInput;
  /** Fuente de los fundamentals, para la provenance de la evidencia. */
  readonly fundamentalsSourceId: string;
  /** CIK vigente: las declaraciones de industria se escriben por CIK. */
  readonly cik: string | null;
  /** Industrias declaradas por el owner para SIC ambiguos (`F3-05`). */
  readonly industryDeclarations: readonly IndustryDeclaration[];
  /** País ISO del listing primario: aproxima el domicilio para el riesgo país. */
  readonly listingCountry: string | null;
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
  /** Industria del dataset de betas, o la ambigüedad nombrada (`F3-05`). */
  readonly industry: IndustryMapping;
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
  /** WACC construido con componentes fechados, o lo que faltó (`F3-06`). */
  readonly costOfCapital: CostOfCapitalResult;
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

/** Perfiles que se valúan sobre el equity: no llevan WACC (`F3-06`). */
const FINANCIAL_PROFILES: ReadonlySet<string> = new Set([
  "bank",
  "insurer",
  "reit",
]);

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
  const industry = mapIndustry({
    cik: request.cik,
    sic: visibleSic?.code ?? null,
    releaseIndustries: await dependencies.industryRelease(query),
    declarations: request.industryDeclarations,
  });
  const completeness = measureCompleteness(series, {
    industryMapping: industry.status,
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
    industry,
    fundamentals: { anchor, series },
    fundamentalSignals: fundamental?.signals ?? [],
    evidence,
    completeness,
    selection,
    rigor: deriveRigorLevel(selection, completeness),
    costOfCapital: FINANCIAL_PROFILES.has(selection.assetProfile ?? "")
      ? {
          // Un banco, una aseguradora o un REIT se valúan sobre el equity: un
          // WACC con la tabla de no financieras sería un número que engaña.
          status: "unsupported",
          version: COST_OF_CAPITAL_VERSION,
          missing: ["financial_profile_uses_cost_of_equity"],
        }
      : buildCostOfCapital({
          // La moneda de los estados: la del libre de riesgo tiene que coincidir.
          currency:
            series?.fiscalYears[0]?.items.revenue?.currency ?? "unknown",
          industryKey:
            industry.status === "mapped" ? industry.industryKey : null,
          listingCountry: request.listingCountry,
          ...(await dependencies.costOfCapitalReadings(query)),
          coverage: series === null ? null : latestInterestCoverage(series),
        }),
  };
}
