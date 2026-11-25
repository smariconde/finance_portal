import { buildFailureRisk, type FailureRisk } from "../domain/failure-risk";
import { DECLARED_FAILURE_PROBABILITIES } from "./declared-failure-probabilities";
import { DECLARED_RATINGS } from "./declared-ratings";
import { DECLARED_PROFILES } from "./declared-profiles";
import { applyProfileDeclarations } from "../domain/declared-profile";
import {
  assessDeclaredRating,
  declaredRatingAt,
  type DeclaredRating,
} from "../domain/declared-rating";
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
  buildCapitalization,
  capitalizationFactsFromSeries,
  type Capitalization,
} from "../domain/capitalization-bridge";
import {
  buildNormalization,
  debtInputOf,
  normalizationFactsFromSeries,
  type Normalization,
  type NormalizationFacts,
} from "../domain/normalization";
import { resolveReportedDebt } from "../domain/reported-debt";
import {
  assessNetCashCoverage,
  listNetCashCoverageFacts,
} from "../domain/net-cash-coverage";
import {
  captiveCoverage,
  deriveCaptiveFinanceSplit,
  type CaptiveFinanceAssessment,
  type CaptiveFinanceFiling,
  type CaptiveFinanceSplit,
} from "../domain/captive-finance";
import { declaredCaptiveFinance } from "../domain/declared-captive-finance";
import {
  buildTtmBasePeriod,
  TTM_BASE_PERIOD_VERSION,
  flowOf,
  ttmCapitalizationFacts,
  ttmFlowFact,
  ttmNormalizationFacts,
  type BasePeriod,
} from "../domain/ttm-base-period";
import { VALUATION_METHOD } from "../domain/valuation-input";
import {
  assessZeroDebtEvidence,
  type CoverageFloor,
  listZeroDebtEvidenceFacts,
  zeroDebtEvidenceHasInterest,
  type ZeroDebtAssessment,
  type ZeroDebtEvidence,
} from "../domain/zero-debt-evidence";
import { deriveCycleHistory, type DerivedCycle } from "../domain/derived-cycle";
import {
  deriveFinancialEquity,
  type DerivedFinancialEquity,
} from "../domain/derived-financial-equity";
import {
  deriveFinancialRisk,
  type DerivedFinancialRisk,
} from "../domain/derived-financial-risk";
import {
  buildAnnualFundamentals,
  chooseFiscalYearAnchor,
  type AnnualFundamentals,
  type FundamentalRow,
  type LineItemValue,
} from "../domain/annual-fundamentals";
import {
  completenessCheck,
  measureCompleteness,
  type CompletenessProfile,
} from "../domain/completeness-profile";
import type { DilutedSharesReconciled } from "../domain/diluted-shares-reconciled";
import {
  mapIndustry,
  type IndustryDeclaration,
  type IndustryMapping,
} from "../domain/industry-mapping";
import { DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY } from "../domain/industry-resolution";
import type {
  IndustryAssertionReading,
  StoredIndustryResolution,
} from "./industry-resolution-repository";
import {
  buildCostOfCapital,
  COST_OF_CAPITAL_VERSION,
  marginalTaxRateOf,
  ratingBandFloor,
  topCoverageFloor,
  type CostOfCapitalResult,
  type CoverageEvidence,
  type ReferenceReading,
} from "../domain/cost-of-capital";
import type { ConceptFact, MonetaryFact } from "../domain/valuation-facts";
import { parseDecimal } from "../domain/decimal-policy";
import {
  businessMixReadingOf,
  industryDecisionOf,
  operationsMixReadingOf,
  QUALITATIVE_DECISIONS_VERSION,
  type BusinessMixDecision,
  type OperationsMixDecision,
  type QualitativeDecisions,
} from "../domain/qualitative-decisions";
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
  /**
   * Aserciones `damodaran-industry` de la capa IA, vigentes o no (`F5-03`). La
   * evaluación elige la visible al corte; leerlas nunca llama a un modelo.
   */
  readonly loadIndustryResolutions?: (
    legalEntityId: string,
  ) => Promise<readonly IndustryAssertionReading[]>;
  /**
   * La resolución guardada con su evidencia, para congelarla en la decisión
   * (`F5-06`). Una industria de la IA sin ella no se puede explicar.
   */
  readonly loadIndustryResolution?: (
    resolutionId: string,
  ) => Promise<StoredIndustryResolution | null>;
  /** Las releases de Damodaran visibles al corte, o `null` cada una (`F3-04`). */
  readonly loadFailureRates?: (
    query: PointInTimeQuery,
  ) => Promise<ReferenceReading | null>;
  readonly costOfCapitalReadings: (query: PointInTimeQuery) => Promise<{
    readonly betas: ReferenceReading | null;
    readonly countryRisk: ReferenceReading | null;
    readonly impliedErp: ReferenceReading | null;
    readonly ratings: ReferenceReading | null;
    /** Las nueve regiones de la misma descarga que el riesgo país (`F5-05`). */
    readonly regions?: ReferenceReading | null;
    /** EV/Sales por industria, para pesar una mezcla de negocios (`F6-48`). */
    readonly evToSales?: ReferenceReading | null;
  }>;
  /**
   * El mix de operaciones visible al corte —la declaración del owner, o la
   * propuesta aceptada más reciente— como decisión, o `null` (`F5-05`). Leerlo
   * nunca llama a un modelo; los pesos se derivan de la decisión.
   */
  readonly loadOperationsMix?: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<OperationsMixDecision | null>;
  /**
   * La mezcla de negocios visible al corte como decisión, o `null` (`F6-48`,
   * ADR 0086). Una de una sola industria no entra a la corrida.
   */
  readonly loadBusinessMix?: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<BusinessMixDecision | null>;
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
  /**
   * El 10-K leído de una empresa con financiera cautiva declarada (`F6-23`,
   * ADR 0082). Ausente o `null`, la apertura queda `filing_unavailable`: la
   * evaluación no abre red.
   */
  readonly captiveFinanceFiling?: CaptiveFinanceFiling | null;
  /**
   * Acciones diluidas conciliadas en el instance del 10-K (`F6-49`), cuando la
   * serie no las trae. La evaluación no abre red: las lee quien la llama.
   */
  readonly dilutedShares?: DilutedSharesReconciled | null;
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
  readonly failureRisk: FailureRisk;
  /**
   * Industria y mix con lo que los sostiene, tal como una corrida los congela
   * en su snapshot (`F5-06`).
   */
  readonly qualitativeDecisions: QualitativeDecisions;
  /**
   * Arrendamientos e I+D capitalizados con su puente (`F4-01`), tal como una
   * corrida los congela. `null` sin serie anual o sin ventas del año base.
   */
  readonly capitalization: Capitalization | null;
  /**
   * La normalización del ejercicio base (`F4-03`), tal como una corrida la
   * congela: capital invertido, deuda, caja, tasa y cargos no recurrentes.
   * `null` sin capitalización.
   */
  readonly normalization: Normalization | null;
  /**
   * La evidencia de deuda cero (`F6-15`): lo que la regla encontró en la serie,
   * se haya usado o no. La normalización la congela sólo cuando ninguna receta
   * cierra. `null` sin serie anual; ausente en una evaluación armada a mano.
   */
  readonly zeroDebt?: ZeroDebtAssessment | null;
  /**
   * La historia de ciclo derivada (`F6-18`, ADR 0059), sólo para un perfil
   * cíclico o commodity con WACC y normalización. Ausente en una evaluación
   * armada a mano.
   */
  readonly cycle?: DerivedCycle | null;
  /**
   * La base del año base (`F6-24`, ADR 0081), sólo para `fcff_base`: TTM con
   * sus patas —y entonces `capitalization` y `normalization` son las del
   * TTM—, o anual con su motivo. Ausente o `null` en otro método.
   */
  readonly basePeriod?: BasePeriod | null;
  /**
   * La financiera cautiva de un emisor declarado (`F6-23`, ADR 0082): la
   * apertura que usa la normalización, o por qué no la hay. `null` si el CIK
   * no está declarado; ausente en una evaluación armada a mano.
   */
  readonly captiveFinance?: CaptiveFinanceAssessment | null;
  /** Common book, common earnings and equity risk for a bank or insurer. */
  readonly financialEquity?: DerivedFinancialEquity | null;
  readonly financialRisk?: DerivedFinancialRisk | null;
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

/** Perfiles que se valúan con el margen de ciclo (`F6-18`). */
const CYCLE_PROFILES: ReadonlySet<string> = new Set(["cyclical", "commodity"]);

/** Perfiles que se valúan sobre el equity: no llevan WACC (`F3-06`). */
const FINANCIAL_PROFILES: ReadonlySet<string> = new Set([
  "bank",
  "insurer",
  "reit",
]);

/**
 * La serie anual del linaje al corte: las filas que la consulta elige, ancladas
 * en el último cierre anual que registró la ingesta. Sin ancla —el sujeto no
 * tiene fundamentals ingeridos— la serie es `null`.
 */
export async function readAnnualFundamentals(
  legalEntityId: string,
  query: PointInTimeQuery,
  readers: Pick<
    CompanyAssessmentDependencies,
    "readFundamentals" | "fiscalYearAnchors"
  >,
): Promise<{
  readonly anchor: string | null;
  readonly series: AnnualFundamentals | null;
  /** Las filas elegidas al corte, de las que sale el año base TTM. */
  readonly rows: readonly FundamentalRow[];
}> {
  const rows = await readers.readFundamentals(legalEntityId, query);
  const lineageSubjects = [
    ...new Set([legalEntityId, ...rows.map((row) => row.subjectId)]),
  ];
  const anchor = chooseFiscalYearAnchor(
    await readers.fiscalYearAnchors(lineageSubjects),
    rows,
  );

  return {
    anchor,
    series:
      anchor === null
        ? null
        : buildAnnualFundamentals(rows, anchor, query.effectiveAt.slice(0, 10)),
    rows,
  };
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

  const { anchor, series, rows } = await readAnnualFundamentals(
    legalEntityId,
    query,
    dependencies,
  );

  const fundamental =
    series === null
      ? null
      : assessFundamentalProfileSignals(
          legalEntityId,
          series,
          request.fundamentalsSourceId,
        );

  // Un perfil de ciclo declarado por el owner reemplaza al del SIC (`F6-43`).
  const evidence = [
    ...applyProfileDeclarations(
      [...sicEvidence, ...(fundamental?.evidence ?? [])],
      DECLARED_PROFILES,
      { legalEntityId, cik: request.cik },
      query,
    ),
  ];
  const aiResolution =
    ((await dependencies.loadIndustryResolutions?.(legalEntityId)) ?? []).find(
      (item) =>
        item.classification.taxonomyId ===
          DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY &&
        item.classification.subjectId === legalEntityId &&
        isVisible(item.classification, query),
    )?.reading ?? null;
  const industry = mapIndustry({
    cik: request.cik,
    sic: visibleSic?.code ?? null,
    releaseIndustries: await dependencies.industryRelease(query),
    declarations: request.industryDeclarations,
    aiResolution,
  });
  const operationsMixDecision =
    (await dependencies.loadOperationsMix?.(legalEntityId, query)) ?? null;
  const operationsMix =
    operationsMixDecision === null
      ? null
      : operationsMixReadingOf(operationsMixDecision);
  const loadedBusinessMix =
    (await dependencies.loadBusinessMix?.(legalEntityId, query)) ?? null;
  const businessMix =
    loadedBusinessMix === null ? null : businessMixReadingOf(loadedBusinessMix);
  // Sólo una mezcla de dos o más industrias se congela: sin ella el snapshot
  // es `1.1.0` byte a byte y su hash no se mueve.
  const businessMixDecision = businessMix === null ? null : loadedBusinessMix;
  const qualitativeDecisions: QualitativeDecisions = {
    version:
      businessMixDecision === null
        ? "qualitative-decisions-1.1.0"
        : QUALITATIVE_DECISIONS_VERSION,
    industry: industryDecisionOf(industry, {
      declaration:
        industry.status === "mapped" && industry.basis === "owner_declaration"
          ? (request.industryDeclarations.find(
              (declaration) => declaration.cik === request.cik,
            ) ?? null)
          : null,
      resolution:
        industry.status === "mapped" && industry.resolution !== undefined
          ? ((await dependencies.loadIndustryResolution?.(
              industry.resolution.resolutionId,
            )) ?? null)
          : null,
    }),
    operationsMix: operationsMixDecision,
    ...(businessMixDecision === null
      ? {}
      : { businessMix: businessMixDecision }),
  };
  const completeness = measureCompleteness(series, {
    industryMapping: industry.status,
    operationsMix: operationsMix?.source ?? null,
    dilutedShares: request.dilutedShares ?? null,
  });

  const selection = selectValuationMethod({
    legalEntityId,
    knowledge: query,
    evidence,
    fcffInputsComplete:
      completenessCheck(completeness, "structural_inputs").status === "met",
  });

  const readings = await dependencies.costOfCapitalReadings(query);
  const financialProfile =
    selection.assetProfile === "bank" || selection.assetProfile === "insurer";
  const financialEquity = financialProfile
    ? deriveFinancialEquity(series, (item) =>
        seriesFact(item, request.fundamentalsSourceId),
      )
    : null;
  const financialRisk = financialProfile
    ? deriveFinancialRisk({
        industryKey: industry.status === "mapped" ? industry.industryKey : null,
        listingCountry: request.listingCountry,
        betas: readings.betas,
        countryRisk: readings.countryRisk,
        impliedErp: readings.impliedErp,
      })
    : null;
  const captiveDeclaration = declaredCaptiveFinance(request.cik);
  const baseYear = series?.fiscalYears[0];
  const captiveFinance: CaptiveFinanceAssessment | null =
    captiveDeclaration === null || baseYear === undefined
      ? null
      : deriveCaptiveFinanceSplit({
          declaration: captiveDeclaration,
          filing: request.captiveFinanceFiling ?? null,
          baseYear,
          sourceId: request.fundamentalsSourceId,
        });
  const captiveSplit =
    captiveFinance?.status === "split" ? captiveFinance.split : null;
  const baseOperatingIncome = baseYear?.items.operating_income;

  const zeroDebt =
    series === null
      ? null
      : assessZeroDebtEvidence(
          series,
          topCoverageFloor(readings.ratings),
          (item) => ({
            ...seriesFact(item, request.fundamentalsSourceId),
            concept: item.concept,
          }),
        );
  // Una financiera cautiva declarada nunca usa la evidencia de deuda cero: con
  // la apertura la deuda es la industrial, y sin ella la consolidada que
  // companyfacts no muestra no prueba que no haya deuda (PACCAR).
  const zeroDebtEvidence =
    captiveFinance === null &&
    zeroDebt?.status === "met" &&
    needsZeroDebtEvidence(series, request.fundamentalsSourceId)
      ? zeroDebt.evidence
      : null;

  // Un rating declarado por el owner manda sobre el sintético (`F6-42`).
  const ratingDeclaration = declaredRatingAt(
    DECLARED_RATINGS,
    request.cik,
    query,
  );
  const declaredRatingReading =
    ratingDeclaration === null
      ? null
      : assessDeclaredRating(
          ratingDeclaration,
          legalEntityId,
          ratingBandFloor(readings.ratings, ratingDeclaration.rating),
        );
  const declaredRating =
    declaredRatingReading?.status === "declared"
      ? declaredRatingReading.declared
      : null;

  const costOfCapital: CostOfCapitalResult = FINANCIAL_PROFILES.has(
    selection.assetProfile ?? "",
  )
    ? {
        // Un banco, una aseguradora o un REIT se valúan sobre el equity: un
        // WACC con la tabla de no financieras sería un número que engaña.
        status: "unsupported",
        version: COST_OF_CAPITAL_VERSION,
        missing: ["financial_profile_uses_cost_of_equity"],
      }
    : buildCostOfCapital({
        // La moneda de los estados: la del libre de riesgo tiene que coincidir.
        currency: series?.fiscalYears[0]?.items.revenue?.currency ?? "unknown",
        industryKey: industry.status === "mapped" ? industry.industryKey : null,
        listingCountry: request.listingCountry,
        ...readings,
        coverage:
          declaredRating !== null
            ? declaredRatingCoverage(
                declaredRating,
                baseYear?.fiscalYearEnd ?? null,
              )
            : captiveSplit !== null && baseOperatingIncome !== undefined
              ? captiveCoverage(captiveSplit, baseOperatingIncome)
              : zeroDebtEvidence !== null &&
                  !zeroDebtEvidenceHasInterest(zeroDebtEvidence)
                ? noInterestCoverage(zeroDebtEvidence)
                : series === null
                  ? null
                  : coverageWithNetCash(
                      series,
                      topCoverageFloor(readings.ratings),
                      (item) => ({
                        ...seriesFact(item, request.fundamentalsSourceId),
                        concept: item.concept,
                      }),
                    ),
        operationsMix,
        businessMix,
      });

  const capitalization = assessCapitalization(
    series,
    request.fundamentalsSourceId,
    industry.status === "mapped" ? industry.industryKey : null,
    costOfCapital.status === "computed"
      ? costOfCapital.costOfCapital.derived.preTaxCostOfDebt
      : null,
  );

  const normalization = assessNormalization(
    series,
    request.fundamentalsSourceId,
    capitalization,
    costOfCapital.status === "computed"
      ? marginalTaxRateOf(costOfCapital.costOfCapital)
      : null,
    zeroDebtEvidence,
    captiveSplit,
  );
  const cycle =
    series === null ||
    normalization === null ||
    costOfCapital.status !== "computed" ||
    !CYCLE_PROFILES.has(selection.assetProfile ?? "")
      ? null
      : deriveCycleHistory(series, {
          toFact: (item) => seriesFact(item, request.fundamentalsSourceId),
          industryKey: costOfCapital.costOfCapital.industryKey,
          preTaxCostOfDebt:
            costOfCapital.costOfCapital.derived.preTaxCostOfDebt,
          baseEbitAdjusted: normalization.base.ebitAdjusted,
        });
  // Con la historia lista, el ciclo deja de faltar: la misma evidencia
  // vuelve al selector con `cycle_margins` resuelto.
  const finalSelection = financialProfile
    ? selectValuationMethod({
        legalEntityId,
        knowledge: query,
        evidence,
        fcffInputsComplete: false,
        excessReturnMissingInputs: [
          ...(financialEquity?.status === "ready"
            ? []
            : ["common_book_equity", "roe"]),
          ...(financialRisk?.status === "ready" ? [] : ["cost_of_equity"]),
        ],
      })
    : cycle?.status === "ready"
      ? selectValuationMethod({
          legalEntityId,
          knowledge: query,
          evidence,
          fcffInputsComplete:
            completenessCheck(completeness, "structural_inputs").status ===
            "met",
          normalizedFcffMissingInputs: [],
        })
      : selection;
  const base = assessBasePeriod({
    selection: finalSelection,
    series,
    rows,
    cutoffDate: query.effectiveAt.slice(0, 10),
    sourceId: request.fundamentalsSourceId,
    capitalization,
    normalization,
    costOfCapital,
    captiveSplit,
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
    selection: finalSelection,
    financialEquity,
    financialRisk,
    rigor: deriveRigorLevel(finalSelection, completeness),
    qualitativeDecisions,
    costOfCapital,
    failureRisk: buildFailureRisk({
      syntheticRating:
        costOfCapital.status === "computed"
          ? costOfCapital.costOfCapital.derived.syntheticRating
          : null,
      reading: (await dependencies.loadFailureRates?.(query)) ?? null,
      knowledge: query,
      legalEntityId,
      cik: request.cik,
      declarations: DECLARED_FAILURE_PROBABILITIES,
    }),
    capitalization: base.capitalization,
    normalization: base.normalization,
    basePeriod: base.basePeriod,
    zeroDebt,
    captiveFinance,
    cycle,
  };
}

/**
 * El año base de una corrida `fcff_base` (`F6-24`, ADR 0081): los flujos TTM
 * al último 10-Q y el balance por bloques cuando las patas están; si no, el
 * anual con su motivo. Un cargo revertido en el anual deja la corrida anual:
 * su TTM no se arma igual.
 */
function assessBasePeriod(input: {
  readonly selection: MethodSelection;
  readonly series: AnnualFundamentals | null;
  readonly rows: readonly FundamentalRow[];
  readonly cutoffDate: string;
  readonly sourceId: string;
  readonly capitalization: Capitalization | null;
  readonly normalization: Normalization | null;
  readonly costOfCapital: CostOfCapitalResult;
  readonly captiveSplit: CaptiveFinanceSplit | null;
}): {
  readonly basePeriod: BasePeriod | null;
  readonly capitalization: Capitalization | null;
  readonly normalization: Normalization | null;
} {
  const { series, capitalization, normalization, costOfCapital } = input;
  const annual = { basePeriod: null, capitalization, normalization };

  if (
    input.selection.status !== "selected" ||
    input.selection.recommendedMethod !== VALUATION_METHOD ||
    series === null ||
    capitalization === null ||
    normalization === null ||
    costOfCapital.status !== "computed"
  ) {
    return annual;
  }

  const toFact = (item: LineItemValue) => ({
    ...seriesFact(item, input.sourceId),
    concept: item.concept,
  });
  const candidate = buildTtmBasePeriod({
    rows: input.rows,
    series,
    cutoffDate: input.cutoffDate,
    toFact,
  });

  if (candidate === null) {
    return annual;
  }

  // La apertura de la financiera es del 10-K: el balance del 10-Q no la tiene
  // y la deuda no puede mezclar cierres (ADR 0082).
  if (input.captiveSplit !== null) {
    return {
      ...annual,
      basePeriod: {
        version: TTM_BASE_PERIOD_VERSION,
        basis: "annual",
        fiscalYearEnd: input.captiveSplit.fiscalYearEnd,
        reason: "captive_finance_split",
        item: null,
      },
    };
  }

  if (candidate.status === "annual") {
    return { ...annual, basePeriod: candidate.basePeriod };
  }

  if (
    normalization.charges.restructuring.status === "applied" ||
    normalization.charges.impairment.status === "applied"
  ) {
    return {
      ...annual,
      basePeriod: {
        version: candidate.basePeriod.version,
        basis: "annual",
        fiscalYearEnd: candidate.basePeriod.fiscalYearEnd,
        reason: "non_recurring_charge_applied",
        item: null,
      },
    };
  }

  const annualCapitalization = capitalizationFactsFromSeries(series, (item) =>
    seriesFact(item, input.sourceId),
  );

  if (annualCapitalization === null) {
    return annual;
  }

  const { basePeriod } = candidate;
  const baseRevenue = ttmFlowFact(
    flowOf(basePeriod, "revenue")!,
    basePeriod.periodEnd,
  ).value;
  const { derived } = costOfCapital.costOfCapital;
  const ttmCapitalization = buildCapitalization(
    ttmCapitalizationFacts(annualCapitalization, candidate, toFact),
    {
      baseRevenue,
      industryKey: costOfCapital.costOfCapital.industryKey,
      preTaxCostOfDebt: derived.preTaxCostOfDebt,
    },
  );

  return {
    basePeriod,
    capitalization: ttmCapitalization,
    normalization: buildNormalization(
      ttmNormalizationFacts(normalization.facts, candidate, toFact),
      {
        baseRevenue,
        marginalTaxRate: marginalTaxRateOf(costOfCapital.costOfCapital),
        capitalization: ttmCapitalization,
      },
    ),
  };
}

/**
 * ¿La deuda del ejercicio base necesita la evidencia? Sólo cuando ninguna
 * receta cierra: con una receta, la deuda es la publicada y la evidencia no
 * viaja, así que el snapshot queda como antes.
 */
function needsZeroDebtEvidence(
  series: AnnualFundamentals | null,
  sourceId: string,
): boolean {
  const facts =
    series === null
      ? null
      : normalizationFactsFromSeries(series, (item) =>
          seriesFact(item, sourceId),
        );
  const debt =
    facts === null
      ? null
      : resolveReportedDebt(debtInputOf(facts.balance.debt));

  return debt?.status === "unresolved" && debt.reason === "no_recipe";
}

/**
 * La cobertura de un rating declarado: el piso de su banda, fechado cuando se
 * declaró (`declared-rating-1.0.0`).
 */
function declaredRatingCoverage(
  declared: DeclaredRating,
  baseFiscalYearEnd: string | null,
): CoverageEvidence {
  return {
    value: declared.coverageFloor.value,
    // El ejercicio base al que reemplaza: la declaración no tiene uno propio.
    fiscalYearEnd:
      baseFiscalYearEnd ?? declared.declaration.declaredAt.slice(0, 10),
    fromLatestFiscalYear: true,
    availableAt: declared.declaration.declaredAt,
    interestBasis: "owner_declared_rating",
    declaredRating: declared,
  };
}

/**
 * La cobertura medida, salvo que un EBIT no positivo la vuelva negativa en una
 * empresa con caja neta y flujo operativo positivo (`net-cash-coverage-1.0.0`):
 * entonces es el piso de la banda más alta, con la evidencia congelada. Sin la
 * regla —caja que no cubre, caja quemada, deuda sin receta— queda la medida.
 */
function coverageWithNetCash(
  series: AnnualFundamentals,
  floor: CoverageFloor | null,
  toFact: (item: LineItemValue) => ConceptFact,
): CoverageEvidence | null {
  const measured = latestInterestCoverage(series);
  if (measured === null || parseDecimal(measured.value, "coverage").gt(0))
    return measured;
  const netCash = assessNetCashCoverage(
    series,
    measured.fiscalYearEnd,
    floor,
    toFact,
  );
  if (netCash.status !== "met") return measured;
  return {
    value: netCash.evidence.coverageFloor.value,
    fiscalYearEnd: measured.fiscalYearEnd,
    fromLatestFiscalYear: measured.fromLatestFiscalYear,
    availableAt: listNetCashCoverageFacts(netCash.evidence, "netCash")
      .map(({ fact }) => fact.availableAt)
      .sort((left, right) => right.localeCompare(left))[0]!,
    interestBasis: "net_cash_operating_loss",
    netCash: netCash.evidence,
  };
}

/**
 * La cobertura de quien no pagó intereses en los cinco ejercicios de la
 * evidencia: el piso de la banda más alta, declarado como tal.
 */
function noInterestCoverage(evidence: ZeroDebtEvidence): CoverageEvidence {
  const facts = listZeroDebtEvidenceFacts(evidence, "zeroDebtEvidence");

  return {
    value: evidence.coverageFloor.value,
    fiscalYearEnd: evidence.fiscalYears[0]!.fiscalYearEnd,
    fromLatestFiscalYear: true,
    availableAt: facts
      .map((entry) => entry.fact.availableAt)
      .sort((left, right) => right.localeCompare(left))[0]!,
    interestBasis: "no_interest_expense",
  };
}

/**
 * La normalización que una corrida congelaría al corte (`F4-03`): los mismos
 * hechos de la serie, con su concepto, sobre la capitalización de la
 * evaluación. Sin costo de capital no hay tasa marginal y la base lo nombra.
 */
function assessNormalization(
  series: AnnualFundamentals | null,
  sourceId: string,
  capitalization: Capitalization | null,
  marginalTaxRate: string | null,
  zeroDebtEvidence: ZeroDebtEvidence | null,
  captiveSplit: CaptiveFinanceSplit | null,
): Normalization | null {
  const revenue = series?.fiscalYears[0]?.items.revenue;

  if (series === null || revenue === undefined || capitalization === null) {
    return null;
  }

  const facts = normalizationFactsFromSeries(
    series,
    (item) => seriesFact(item, sourceId),
    zeroDebtEvidence,
  );

  return facts === null
    ? null
    : buildNormalization(
        captiveSplit === null
          ? facts
          : // Con la apertura, la deuda es la del miembro industrial: los
            // totales consolidados no corroboran nada (`F6-46`).
            {
              ...withoutDebtControls(facts),
              captiveFinance: captiveSplit,
            },
        {
          baseRevenue: revenue.value,
          marginalTaxRate,
          capitalization,
        },
      );
}

function withoutDebtControls(facts: NormalizationFacts): NormalizationFacts {
  const { debtControls: _controls, ...plain } = facts;
  void _controls;
  return plain;
}

/** Una partida de la serie como hecho con la provenance de su fuente. */
export function seriesFact(
  item: LineItemValue,
  sourceId: string,
): MonetaryFact {
  return {
    value: item.value,
    currency: item.currency ?? "USD",
    unit: "monetary",
    asOf: item.asOf,
    availableAt: item.availableAt,
    sourceId,
    sourceDocumentId: item.sourceDocumentId,
    observationId: item.observationId,
    qualityFlags: [],
  };
}

/**
 * La capitalización que una corrida congelaría al corte (`F4-01`): los hechos
 * de la serie con la provenance de su fuente, la industria y el costo de deuda
 * de la evaluación. Sin ventas del ejercicio base no hay materialidad que medir
 * ni margen que publicar.
 */
function assessCapitalization(
  series: AnnualFundamentals | null,
  sourceId: string,
  industryKey: string | null,
  preTaxCostOfDebt: string | null,
): Capitalization | null {
  const revenue = series?.fiscalYears[0]?.items.revenue;

  if (series === null || revenue === undefined) {
    return null;
  }

  const facts = capitalizationFactsFromSeries(series, (item) =>
    seriesFact(item, sourceId),
  );

  return facts === null
    ? null
    : buildCapitalization(facts, {
        baseRevenue: revenue.value,
        industryKey,
        preTaxCostOfDebt,
      });
}
