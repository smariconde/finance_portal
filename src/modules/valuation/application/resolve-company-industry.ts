import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import {
  TAVILY_SOURCE_ID,
  type WebSearchResult,
} from "@/modules/ai/application/tavily-search";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { AI_MODEL_LADDER_VERSION } from "@/modules/ai/domain/model-ladder";
import { isTransientAiAnswer } from "@/modules/ai/domain/task-answer";
import { SEC_SIC_TAXONOMY_ID } from "@/modules/classification/domain/sec-sic-classification";
import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  extractTenKSections,
  SEC_10K_SECTIONS_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-sections";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  mapIndustry,
  type IndustryDeclaration,
} from "../domain/industry-mapping";
import {
  planIndustryAssertion,
  type IndustryEvidenceRecord,
  type IndustryResolutionRecord,
} from "../domain/industry-resolution";
import {
  INDUSTRY_RESOLUTION_PROMPT_VERSION,
  INDUSTRY_RESOLUTION_TASK,
  industryWebQuery,
  type IndustryResolutionInput,
  type IndustryResolutionOutput,
} from "../domain/industry-resolution-task";

import type {
  IndustryResolutionRepository,
  StoredIndustryResolution,
} from "./industry-resolution-repository";

/**
 * Resuelve la industria de una empresa ambigua (`F5-03`,
 * [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisiones 6 a 8).
 *
 * Antes de gastar un centavo comprueba que haga falta: el SIC visible tiene que
 * ser ambiguo, el owner no tiene que haberlo declarado, y la última vez que se
 * preguntó no puede haber sido por el mismo SIC y el mismo 10-K —a menos que se
 * pida de nuevo a propósito—. Después localiza el último 10-K al corte, recorta
 * sus secciones dirigidas, comprueba que la evidencia pueda viajar a un modelo
 * y recién entonces corre la escalera.
 *
 * Toda respuesta se guarda con `apply`, también la abstención; sólo una
 * aceptada se publica como aserción. Un dry run llama al modelo y no escribe,
 * como cualquier dry run de este proyecto gasta cuota.
 *
 * Desde `F5-04` la búsqueda web es el **último recurso**: entra sólo si no hay
 * 10-K o Item 1 al corte, o si la escalera se abstuvo por evidencia
 * insuficiente, y en ese caso la tarea se repite **una vez** con hasta cinco
 * resultados agregados. La consulta lleva el nombre y las candidatas.
 */
export const SEC_SOURCE_ID = "sec-edgar";

export type ResolveCompanyIndustryRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /**
   * CIK donde buscar el 10-K, en orden: el vigente y después los antecesores
   * del linaje. Una sucesión reciente deja al sucesor sin 10-K propio todavía.
   */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly declarations: readonly IndustryDeclaration[];
  readonly apply: boolean;
  /** Preguntar aunque ya se haya preguntado por el mismo SIC y el mismo 10-K. */
  readonly again: boolean;
};

export type ResolveCompanyIndustryDependencies = {
  readonly loadSicAssertions: (
    legalEntityId: string,
  ) => Promise<readonly SubjectClassification[]>;
  readonly industryRelease: (
    query: PointInTimeQuery,
  ) => Promise<ReadonlyMap<string, string> | null>;
  /** `submissions` de un CIK, sin interpretar: el localizador lee lo suyo. */
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  /** El documento principal de una presentación, como texto. */
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<IndustryResolutionInput, IndustryResolutionOutput>,
    input: IndustryResolutionInput,
  ) => Promise<LadderResult<IndustryResolutionOutput>>;
  readonly repository: IndustryResolutionRepository;
  readonly now: () => string;
  readonly newId: () => string;
  readonly sha256: (text: string) => string;
  /**
   * La búsqueda web (`F5-04`). `null` si no salió —tope, kill switch, error—:
   * la tarea sigue con lo que tiene. Sin esta dependencia no se busca.
   */
  readonly searchWeb?: (
    query: string,
  ) => Promise<readonly WebSearchResult[] | null>;
};

/** Por qué se buscó en la web: lo que el 10-K no dio. */
export type WebSearchTrigger =
  "no_annual_report" | "item_1_not_found" | "insufficient_evidence";

export type WebSearchUse = {
  readonly trigger: WebSearchTrigger;
  readonly query: string;
  /** `null` si la búsqueda no salió. */
  readonly results: number | null;
};

export type SkipReason =
  | "sic_unknown"
  | "not_ambiguous"
  | "declared_by_owner"
  | "industry_release_missing"
  | "already_asked"
  | "no_annual_report"
  | "item_1_not_found";

export type ResolveCompanyIndustryResult =
  | {
      readonly status: "skipped";
      readonly reason: SkipReason;
      readonly sic: string | null;
      readonly candidates: readonly string[];
      /** Con `already_asked`: lo que se guardó la vez anterior. */
      readonly previous: StoredIndustryResolution | null;
      readonly annualReport: SecAnnualReport | null;
    }
  | {
      readonly status: "asked";
      readonly record: IndustryResolutionRecord;
      readonly evidence: readonly IndustryEvidenceRecord[];
      readonly ladder: LadderResult<IndustryResolutionOutput>;
      /** `null` cuando la evidencia es sólo de la web. */
      readonly annualReport: SecAnnualReport | null;
      readonly webSearch: WebSearchUse | null;
      readonly written: boolean;
    };

function visible(
  classification: SubjectClassification,
  query: PointInTimeQuery,
): boolean {
  return (
    isEffectiveAt(classification, query.effectiveAt) &&
    isKnownAt(classification, query)
  );
}

export async function resolveCompanyIndustry(
  request: ResolveCompanyIndustryRequest,
  dependencies: ResolveCompanyIndustryDependencies,
): Promise<ResolveCompanyIndustryResult> {
  const { query } = request;
  const skip = (
    reason: SkipReason,
    extra: Partial<{
      sic: string | null;
      candidates: readonly string[];
      previous: StoredIndustryResolution | null;
      annualReport: SecAnnualReport | null;
    }> = {},
  ): ResolveCompanyIndustryResult => ({
    status: "skipped",
    reason,
    sic: extra.sic ?? null,
    candidates: extra.candidates ?? [],
    previous: extra.previous ?? null,
    annualReport: extra.annualReport ?? null,
  });

  const sic = (
    await dependencies.loadSicAssertions(request.legalEntityId)
  ).find(
    (classification) =>
      classification.taxonomyId === SEC_SIC_TAXONOMY_ID &&
      classification.subjectId === request.legalEntityId &&
      visible(classification, query),
  );

  if (sic === undefined) {
    return skip("sic_unknown");
  }

  const release = await dependencies.industryRelease(query);
  const mapping = mapIndustry({
    cik: request.cik,
    sic: sic.code,
    releaseIndustries: release,
    declarations: request.declarations,
  });
  const base = { sic: sic.code, candidates: mapping.candidates };

  if (mapping.status === "mapped") {
    return skip(
      mapping.basis === "owner_declaration"
        ? "declared_by_owner"
        : "not_ambiguous",
      base,
    );
  }

  if (mapping.status === "unmapped") {
    return skip(
      mapping.reason === "industry_release_missing"
        ? "industry_release_missing"
        : "not_ambiguous",
      base,
    );
  }

  let annualReport: SecAnnualReport | null = null;

  for (const cik of request.annualReportCiks) {
    const located = locateLatestAnnualReport(
      await dependencies.loadSubmissions(cik),
      cik,
      // Sin corte de conocimiento declarado, «lo que se sabe ahora».
      query.knownAt ?? dependencies.now(),
    );

    if (located.status === "found") {
      annualReport = located.report;
      break;
    }
  }

  const previous = await dependencies.repository.latestForSubject(
    request.legalEntityId,
  );
  if (annualReport === null && dependencies.searchWeb === undefined) {
    return skip("no_annual_report", base);
  }

  const askedBefore =
    previous !== null &&
    !isTransientAiAnswer(previous.resolution) &&
    previous.resolution.sic === sic.code &&
    (annualReport === null
      ? previous.evidence.every((item) => item.section === "web_search")
      : previous.evidence.some(
          (item) => item.accessionNumber === annualReport!.accessionNumber,
        ));

  if (!request.again && askedBefore) {
    return skip("already_asked", { ...base, previous, annualReport });
  }

  const sections =
    annualReport === null
      ? null
      : extractTenKSections(await dependencies.loadAnnualReport(annualReport));
  const missing: WebSearchTrigger | null =
    annualReport === null
      ? "no_annual_report"
      : sections!.business === null
        ? "item_1_not_found"
        : null;

  if (missing !== null && dependencies.searchWeb === undefined) {
    return skip(missing, { ...base, annualReport });
  }

  const filingEvidence: IndustryEvidenceRecord[] =
    missing !== null
      ? []
      : [
          sections!.business!,
          ...(sections!.segments === null ? [] : [sections!.segments]),
        ].map((section, index) => ({
          evidenceId: `E${index + 1}`,
          sourceId: SEC_SOURCE_ID,
          section: section.section,
          documentUrl: annualReport!.url,
          accessionNumber: annualReport!.accessionNumber,
          documentAcceptedAt: annualReport!.acceptedAt,
          sha256: dependencies.sha256(section.text),
          byteLength: section.byteLength,
          truncated: section.truncated,
          excerpt: section.text,
        }));
  const ladderInput = (evidence: readonly IndustryEvidenceRecord[]) => {
    // Antes de reservar nada: cada pieza tiene que poder viajar a un modelo.
    assertAiTransferable(
      evidence.map((item) => item.sourceId),
      dependencies.registry,
    );

    return {
      companyName: request.companyName,
      sic: {
        code: sic.code,
        description: sicDescription(sic.label, sic.code),
      },
      candidates: mapping.candidates,
      releaseIndustryKeys: new Set(release!.keys()),
      evidence: evidence.map((item) => ({
        evidenceId: item.evidenceId,
        sourceId: item.sourceId,
        section: item.section,
        text: item.excerpt,
      })),
    };
  };
  const webQuery = industryWebQuery(request.companyName, mapping.candidates);
  const webEvidence = async (
    after: number,
  ): Promise<{
    readonly results: number | null;
    readonly evidence: IndustryEvidenceRecord[];
  }> => {
    const results = await dependencies.searchWeb!(webQuery);

    return {
      results: results === null ? null : results.length,
      evidence: (results ?? []).map((result, index) => ({
        evidenceId: `E${after + index + 1}`,
        sourceId: TAVILY_SOURCE_ID,
        section: "web_search" as const,
        documentUrl: result.url,
        accessionNumber: null,
        documentAcceptedAt: null,
        sha256: dependencies.sha256(result.excerpt),
        byteLength: new TextEncoder().encode(result.excerpt).byteLength,
        truncated: result.truncated,
        excerpt: result.excerpt,
      })),
    };
  };

  let evidence = filingEvidence;
  let webSearch: WebSearchUse | null = null;
  let ladder: LadderResult<IndustryResolutionOutput>;

  if (missing !== null) {
    const web = await webEvidence(0);
    webSearch = { trigger: missing, query: webQuery, results: web.results };

    if (web.evidence.length === 0) {
      return skip(missing, { ...base, annualReport });
    }

    evidence = web.evidence;
    ladder = await dependencies.runLadder(
      INDUSTRY_RESOLUTION_TASK,
      ladderInput(evidence),
    );
  } else {
    ladder = await dependencies.runLadder(
      INDUSTRY_RESOLUTION_TASK,
      ladderInput(evidence),
    );

    if (
      dependencies.searchWeb !== undefined &&
      ladder.outcome === "abstained" &&
      ladder.reason === "insufficient_evidence"
    ) {
      const web = await webEvidence(filingEvidence.length);
      webSearch = {
        trigger: "insufficient_evidence",
        query: webQuery,
        results: web.results,
      };

      if (web.evidence.length > 0) {
        // La tarea se repite una sola vez. Los intentos de la primera quedan
        // en el libro bajo su propio `task_run_id`.
        evidence = [...filingEvidence, ...web.evidence];
        ladder = await dependencies.runLadder(
          INDUSTRY_RESOLUTION_TASK,
          ladderInput(evidence),
        );
      }
    }
  }

  const resolvedAt = dependencies.now();
  const accepted = ladder.outcome === "accepted" ? ladder : null;
  const record: IndustryResolutionRecord = {
    resolutionId: ladder.taskRunId,
    legalEntityId: request.legalEntityId,
    cik: request.cik,
    sic: sic.code,
    candidates: [...mapping.candidates],
    taskVersion: INDUSTRY_RESOLUTION_TASK.taskVersion,
    promptVersion: INDUSTRY_RESOLUTION_PROMPT_VERSION,
    ladderVersion: AI_MODEL_LADDER_VERSION,
    sectionsVersion: SEC_10K_SECTIONS_VERSION,
    outcome:
      ladder.outcome === "accepted"
        ? "resolved"
        : ladder.outcome === "abstained"
          ? "abstained"
          : "stopped",
    industryKey: accepted?.output.industryKey ?? null,
    confidence: accepted?.output.confidence ?? null,
    rationale: accepted?.output.rationale ?? null,
    reason:
      ladder.outcome === "accepted"
        ? null
        : ladder.outcome === "abstained"
          ? ladder.reason
          : ladder.code,
    acceptedRung: accepted?.rung ?? null,
    respondedModel: accepted?.model ?? null,
    citedEvidenceIds: accepted === null ? [] : [...accepted.output.evidenceIds],
    resolvedAt,
    recordedAt: resolvedAt,
  };

  if (!request.apply) {
    return {
      status: "asked",
      record,
      evidence,
      ladder,
      annualReport,
      webSearch,
      written: false,
    };
  }

  const plan =
    accepted === null
      ? null
      : planIndustryAssertion({
          resolution: record,
          industryLabel: release!.get(record.industryKey!)!,
          stored: (
            await dependencies.repository.assertionsForSubject(
              request.legalEntityId,
            )
          ).map((item) => item.classification),
          newId: dependencies.newId,
          hashContent: dependencies.sha256,
        });

  await dependencies.repository.record({ resolution: record, evidence, plan });

  return {
    status: "asked",
    record,
    evidence,
    ladder,
    annualReport,
    webSearch,
    written: true,
  };
}

/** La etiqueta del SIC es `"7372 SERVICES-PREPACKAGED SOFTWARE"`; al modelo va la descripción. */
function sicDescription(label: string, code: string): string | null {
  const description = label.startsWith(`${code} `)
    ? label.slice(code.length + 1).trim()
    : null;

  return description === null || description.length === 0 ? null : description;
}
