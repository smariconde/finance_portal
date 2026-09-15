import { describe, expect, it, vi } from "vitest";

import { SEC_COMPANY_CONCEPT_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-company-concept";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import type { Observation } from "@/modules/observations/domain/observation";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";

import { SPLIT_RECORDING_RULE_VERSION } from "../domain/plan-split-recording";
import {
  corporateActionSchema,
  type CorporateAction,
} from "../domain/reporting-succession";
import { SPLIT_BASIS_RULE_VERSION } from "../domain/share-basis";
import { SPLIT_EVIDENCE_RULE_VERSION } from "../domain/verify-split-evidence";
import {
  buildCompanyConceptPayload,
  buildSplitClaim,
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureGraph,
  buildSplitFixtureObservations,
  SPLIT_ACCEPTED_AT,
  SPLIT_ACCESSIONS,
  SPLIT_FILER_CIK,
  SPLIT_FILER_ENTITY_ID,
} from "../infrastructure/fixture-split";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";
import { createLiveSplitClaimSource } from "./live-split-claim-source";
import { recordSplits, SPLIT_PIPELINE } from "./record-splits";

const CLOCK = "2025-09-15T12:00:00.000Z";

function createIds() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(0xe000 + sequence).padStart(12, "0")}`;
  };
}

function harness(
  options: {
    registry?: typeof DEMO_SOURCE_REGISTRY;
    status?: number;
    body?: unknown;
    observations?: readonly Observation[];
    recorded?: readonly CorporateAction[];
  } = {},
) {
  const encoder = new TextEncoder();
  const body: unknown =
    options.body ?? buildCompanyConceptPayload(buildSplitFixtureClaims());
  const fetch = vi.fn<EgressFetch>(async () => {
    const bytes = encoder.encode(
      typeof body === "string" ? body : JSON.stringify(body),
    );

    return {
      status: options.status ?? 200,
      body: bytes,
      byteLength: bytes.byteLength,
      fetchedAt: "2025-09-15T11:59:00.000Z",
    };
  });
  const corporateActions = createInMemoryCorporateActionRepository({
    graph: buildSplitFixtureGraph(),
    corporateActions: options.recorded ?? [],
  });
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const dependencies = {
    sourceRegistry: createInMemorySourceRegistryRepository(
      options.registry ?? DEMO_SOURCE_REGISTRY,
    ),
    ingestionRuns,
    sourceDocuments: createInMemorySourceDocumentRepository(
      buildSplitFixtureDocuments(),
    ),
    observations: createInMemoryObservationRepository(
      options.observations ?? buildSplitFixtureObservations(),
    ),
    corporateActions,
    loadIdentityGraph: corporateActions.loadIdentityGraph,
    source: createLiveSplitClaimSource({ fetch }),
    now: () => CLOCK,
    newId: createIds(),
  };

  return {
    fetch,
    corporateActions,
    ingestionRuns,
    record(overrides: { dryRun?: boolean; cik?: string } = {}) {
      return recordSplits(
        {
          cik: overrides.cik ?? SPLIT_FILER_CIK,
          mode: "personal",
          dryRun: overrides.dryRun,
        },
        dependencies,
      );
    },
  };
}

describe("recordSplits", () => {
  it("fija las versiones que componen el pipeline", () => {
    expect(SPLIT_PIPELINE).toStrictEqual({
      parserVersion: "sec-split-1.0.0",
      components: {
        companyconcept: SEC_COMPANY_CONCEPT_PARSER_VERSION,
        basis: SPLIT_BASIS_RULE_VERSION,
        evidence: SPLIT_EVIDENCE_RULE_VERSION,
        recording: SPLIT_RECORDING_RULE_VERSION,
      },
    });
  });

  it("verifica, registra la corrida y abre el split confirmado", async () => {
    const test = harness();
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "succeeded",
      sourceId: "sec-edgar",
      datasetId: "sec.companyconcept",
      parserVersion: "sec-split-1.0.0",
      subjectKey: SPLIT_FILER_CIK,
      counts: { fetched: 4, accepted: 4, rejected: 0, duplicate: 0 },
      qualityFlags: ["split_evidence_outliers"],
    });
    expect(outcome.legalEntityId).toBe(SPLIT_FILER_ENTITY_ID);
    expect(outcome.applied).toStrictEqual({ corporateActions: 1 });

    const recorded = await test.corporateActions.listCorporateActions();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actionType: "split",
      subjectId: SPLIT_FILER_ENTITY_ID,
      sourceDocumentId: SPLIT_ACCESSIONS.annual2024,
      availableAt: SPLIT_ACCEPTED_AT,
      terms: { ratio: "4" },
    });
    expect(
      await test.ingestionRuns.list({ sourceId: "sec-edgar" }),
    ).toHaveLength(1);
  });

  it("repetir la corrida no abre otro evento y deja constancia del duplicado", async () => {
    const test = harness();
    const first = await test.record();
    const again = await test.record();

    expect(again.run).toMatchObject({
      status: "duplicate",
      counts: { fetched: 4, accepted: 0, rejected: 0, duplicate: 4 },
      replayOfRunId: first.run!.runId,
    });
    expect(again.plan?.status).toBe("unchanged");
    expect(again.applied).toBeNull();
    expect(await test.corporateActions.listCorporateActions()).toHaveLength(1);
  });

  it("completa un registro que se cortó después de anotar su corrida", async () => {
    const test = harness();
    test.corporateActions.failNextApply();

    await expect(test.record()).rejects.toThrow(/simulated/u);
    expect(await test.corporateActions.listCorporateActions()).toHaveLength(0);

    const retry = await test.record();

    expect(retry.run?.status).toBe("duplicate");
    expect(retry.applied).toStrictEqual({ corporateActions: 1 });
  });

  it("un dry run descarga y planifica, pero no escribe nada", async () => {
    const test = harness();
    const outcome = await test.record({ dryRun: true });

    expect(outcome.persisted).toBe(false);
    expect(outcome.plan?.status).toBe("planned");
    expect(outcome.run?.status).toBe("succeeded");
    expect(
      await test.ingestionRuns.list({ sourceId: "sec-edgar" }),
    ).toHaveLength(0);
    expect(await test.corporateActions.listCorporateActions()).toHaveLength(0);
  });

  it("sin re-expresiones publicadas no sale a la red", async () => {
    const test = harness({
      observations: buildSplitFixtureObservations().filter(
        (observation) => observation.concept === "us-gaap:Revenues",
      ),
    });
    const outcome = await test.record();

    expect(outcome.rejection).toBe("no_published_share_facts");
    expect(outcome.run).toBeNull();
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("un CIK fuera del grafo no sale a la red", async () => {
    const test = harness();
    const outcome = await test.record({ cik: "999" });

    expect(outcome.rejection).toBe("subject_not_in_graph");
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("sin derechos aprobados no hay tráfico", async () => {
    const blocked = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "sec-edgar"
        ? sourceRegistryEntrySchema.parse({
            ...entry,
            approvalStatus: "rights_review_pending",
          })
        : entry,
    );
    const test = harness({ registry: blocked });
    const outcome = await test.record();

    expect(outcome.run?.status).toBe("failed");
    expect(outcome.run?.failure?.code).toBe("rights_not_approved");
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("un filer que nunca declaró un ratio deja una corrida vacía", async () => {
    const test = harness({ status: 404, body: "" });
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "empty",
      counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
      qualityFlags: ["no_split_ratio_claims"],
    });
    expect(outcome.applied).toBeNull();
  });

  it("sólo candidatos: la corrida queda en cuarentena con el motivo", async () => {
    const test = harness({
      body: buildCompanyConceptPayload([
        buildSplitClaim({ filing: "annual2023", end: "2023-06-01" }),
      ]),
    });
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "quarantined",
      counts: { fetched: 1, accepted: 0, rejected: 1, duplicate: 0 },
      qualityFlags: ["split_candidate_no_coherent_reexpression"],
    });
    expect(await test.corporateActions.listCorporateActions()).toHaveLength(0);
  });

  it("confirmados y candidatos juntos dejan una corrida parcial", async () => {
    const test = harness({
      body: buildCompanyConceptPayload([
        ...buildSplitFixtureClaims(),
        buildSplitClaim({
          filing: "annual2022",
          end: "2021-06-01",
          value: "2",
        }),
      ]),
    });
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "partial",
      counts: { fetched: 5, accepted: 4, rejected: 1, duplicate: 0 },
    });
    expect(outcome.applied).toStrictEqual({ corporateActions: 1 });
  });

  it("un documento que no se entiende se cuarentena sin tocar eventos", async () => {
    const test = harness({ body: "{" });
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "quarantined",
      qualityFlags: ["companyconcept_payload_schema_invalid"],
    });
    expect(await test.corporateActions.listCorporateActions()).toHaveLength(0);
  });

  it("un fallo pasajero de la fuente queda como corrida fallida reintentable", async () => {
    const test = harness({ status: 503, body: "" });
    const outcome = await test.record();

    expect(outcome.run?.status).toBe("failed");
    expect(outcome.run?.failure).toMatchObject({
      code: "provider_error",
      retryable: true,
    });
  });

  it("la misma presentación descripta de otra forma es un conflicto en cuarentena", async () => {
    const first = await harness().record({ dryRun: true });
    const recorded = corporateActionSchema.parse({
      ...first.plan!.corporateActions[0]!,
      terms: { ...first.plan!.corporateActions[0]!.terms, ratio: "2" },
      contentHash: "f".repeat(64),
    });
    const test = harness({ recorded: [recorded] });
    const conflicted = await test.record();

    expect(conflicted.plan?.rejection).toBe("conflicting_split");
    expect(conflicted.run).toMatchObject({
      status: "quarantined",
      counts: { fetched: 4, accepted: 0, rejected: 4, duplicate: 0 },
      qualityFlags: expect.arrayContaining(["split_conflicting_split"]),
    });
    expect(conflicted.applied).toBeNull();
    expect(await test.corporateActions.listCorporateActions()).toStrictEqual([
      recorded,
    ]);
  });
});
