import { describe, expect, it, vi } from "vitest";

import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";

import { SUCCESSION_RECORDING_RULE_VERSION } from "../domain/plan-succession-recording";
import { SUCCESSION_EVIDENCE_RULE_VERSION } from "../domain/reporting-succession";
import {
  buildFixtureDeclaration,
  buildSubmissionsPayload,
  buildSuccessionFixtureGraph,
  FIXTURE_EFFECTIVE_FROM,
  FIXTURE_PREDECESSOR_CIK,
  FIXTURE_PREDECESSOR_FILINGS,
  FIXTURE_PREDECESSOR_NAME,
  FIXTURE_SUCCESSION_ACCEPTED_AT,
  FIXTURE_SUCCESSION_ACCESSIONS,
  FIXTURE_SUCCESSOR_CIK,
  FIXTURE_SUCCESSOR_ENTITY_ID,
  FIXTURE_SUCCESSOR_FILINGS,
  FIXTURE_SUCCESSOR_NAME,
} from "../infrastructure/fixture-succession";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";
import { createLiveSuccessionEvidenceSource } from "./live-succession-evidence-source";
import { recordSuccession, SUCCESSION_PIPELINE } from "./record-succession";

const CLOCK = "2025-09-10T12:00:00.000Z";

function createIds() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
}

function harness(
  options: {
    registry?: typeof DEMO_SOURCE_REGISTRY;
    successorBody?: unknown;
    graph?: ReturnType<typeof buildSuccessionFixtureGraph>;
  } = {},
) {
  const encoder = new TextEncoder();
  const successorBody =
    options.successorBody ??
    buildSubmissionsPayload({
      cik: FIXTURE_SUCCESSOR_CIK,
      name: FIXTURE_SUCCESSOR_NAME,
      filings: FIXTURE_SUCCESSOR_FILINGS,
    });
  const fetch = vi.fn<EgressFetch>(async ({ url }) => {
    const payload =
      url === buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)
        ? successorBody
        : url === buildSubmissionsUrl(FIXTURE_PREDECESSOR_CIK)
          ? buildSubmissionsPayload({
              cik: FIXTURE_PREDECESSOR_CIK,
              name: FIXTURE_PREDECESSOR_NAME,
              filings: FIXTURE_PREDECESSOR_FILINGS,
            })
          : null;
    const body = encoder.encode(
      typeof payload === "string" ? payload : JSON.stringify(payload),
    );

    return {
      status: payload === null ? 404 : 200,
      body,
      byteLength: body.byteLength,
      fetchedAt: "2025-09-10T11:59:00.000Z",
    };
  });
  const corporateActions = createInMemoryCorporateActionRepository({
    graph: options.graph ?? buildSuccessionFixtureGraph(),
  });
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const sourceDocuments = createInMemorySourceDocumentRepository();
  const dependencies = {
    sourceRegistry: createInMemorySourceRegistryRepository(
      options.registry ?? DEMO_SOURCE_REGISTRY,
    ),
    ingestionRuns,
    sourceDocuments,
    corporateActions,
    loadIdentityGraph: corporateActions.loadIdentityGraph,
    source: createLiveSuccessionEvidenceSource({ fetch }),
    now: () => CLOCK,
    newId: createIds(),
  };

  return {
    fetch,
    corporateActions,
    ingestionRuns,
    sourceDocuments,
    record(overrides: { dryRun?: boolean } = {}) {
      return recordSuccession(
        {
          declaration: buildFixtureDeclaration(),
          mode: "personal",
          dryRun: overrides.dryRun,
        },
        dependencies,
      );
    },
  };
}

describe("recordSuccession", () => {
  it("fija las versiones que componen el pipeline", () => {
    expect(SUCCESSION_PIPELINE).toStrictEqual({
      parserVersion: "sec-succession-1.0.0",
      components: {
        submissions: SEC_SUBMISSIONS_PARSER_VERSION,
        evidence: SUCCESSION_EVIDENCE_RULE_VERSION,
        recording: SUCCESSION_RECORDING_RULE_VERSION,
      },
    });
  });

  it("registra corrida, presentación, antecesor y vínculo en ese orden", async () => {
    const test = harness();
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "succeeded",
      datasetId: "sec.submissions",
      parserVersion: "sec-succession-1.0.0",
      subjectKey: FIXTURE_SUCCESSOR_CIK,
      counts: { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
    });
    expect(outcome.applied).toStrictEqual({
      legalEntities: 1,
      identifierAssignments: 1,
      corporateActions: 1,
      relationships: 1,
    });
    expect(outcome.sourceDocuments?.inserted).toStrictEqual([
      FIXTURE_SUCCESSION_ACCESSIONS.succession,
    ]);

    const [document] = await test.sourceDocuments.findByIds({
      sourceId: "sec-edgar",
      sourceDocumentIds: [FIXTURE_SUCCESSION_ACCESSIONS.succession],
    });
    expect(document).toMatchObject({
      documentType: "8-K12B",
      subjectId: FIXTURE_SUCCESSOR_ENTITY_ID,
      acceptedAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
      availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
      availabilityRule: "sec_acceptance",
      ingestionRunId: outcome.run!.runId,
    });

    const [relationship] = await test.corporateActions.listRelationships();
    expect(relationship).toMatchObject({
      successorLegalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
      validFrom: FIXTURE_EFFECTIVE_FROM,
      availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
    });

    const graph = await test.corporateActions.loadIdentityGraph();
    expect(
      graph.identifierAssignments.map(
        (assignment) => assignment.normalizedValue,
      ),
    ).toStrictEqual([FIXTURE_SUCCESSOR_CIK, FIXTURE_PREDECESSOR_CIK]);
  });

  it("la segunda corrida queda duplicada y no escribe otra fila", async () => {
    const test = harness();
    const first = await test.record();
    const second = await test.record();

    expect(second.run).toMatchObject({
      status: "duplicate",
      replayOfRunId: first.run!.runId,
      counts: { fetched: 1, accepted: 0, rejected: 0, duplicate: 1 },
    });
    expect(second.plan?.status).toBe("unchanged");
    expect(second.applied).toBeNull();
    expect(second.sourceDocuments?.unchanged).toStrictEqual([
      FIXTURE_SUCCESSION_ACCESSIONS.succession,
    ]);
    await expect(
      test.corporateActions.listRelationships(),
    ).resolves.toHaveLength(1);
    await expect(
      test.corporateActions.listCorporateActions(),
    ).resolves.toHaveLength(1);
  });

  it("completa bajo la corrida original un registro que se cortó antes del grafo", async () => {
    const test = harness();
    test.corporateActions.failNextApply();

    await expect(test.record()).rejects.toThrow(/simulated/u);
    await expect(
      test.corporateActions.listRelationships(),
    ).resolves.toHaveLength(0);

    const retry = await test.record();

    expect(retry.run?.status).toBe("duplicate");
    expect(retry.applied?.relationships).toBe(1);
    await expect(
      test.corporateActions.listRelationships(),
    ).resolves.toHaveLength(1);
  });

  it("un dry run descarga y planifica pero no escribe", async () => {
    const test = harness();
    const outcome = await test.record({ dryRun: true });

    expect(outcome.persisted).toBe(false);
    expect(outcome.plan?.status).toBe("planned");
    expect(outcome.run?.status).toBe("succeeded");
    await expect(
      test.ingestionRuns.list({ sourceId: "sec-edgar" }),
    ).resolves.toHaveLength(0);
    await expect(
      test.corporateActions.listRelationships(),
    ).resolves.toHaveLength(0);
  });

  it("bloquea una fuente sin derechos antes de cualquier egress", async () => {
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

    expect(outcome.run).toMatchObject({
      status: "failed",
      failure: { code: "rights_not_approved" },
    });
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("un sucesor fuera del grafo no justifica una descarga ni deja corrida", async () => {
    const test = harness({
      graph: { ...buildSuccessionFixtureGraph(), identifierAssignments: [] },
    });
    const outcome = await test.record();

    expect(outcome).toMatchObject({
      run: null,
      persisted: false,
      rejection: "successor_not_in_graph",
    });
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("una evidencia que no cierra se cuarentena y no toca el grafo", async () => {
    const test = harness({
      successorBody: buildSubmissionsPayload({
        cik: FIXTURE_SUCCESSOR_CIK,
        name: FIXTURE_SUCCESSOR_NAME,
        filings: FIXTURE_SUCCESSOR_FILINGS.map((filing) =>
          filing.form === "8-K12B" ? { ...filing, form: "8-K" } : filing,
        ),
      }),
    });
    const outcome = await test.record();

    expect(outcome.rejection).toBe("evidence_form_not_succession");
    expect(outcome.run).toMatchObject({
      status: "quarantined",
      counts: { fetched: 1, accepted: 0, rejected: 1 },
      qualityFlags: ["succession_evidence_form_not_succession"],
    });
    await expect(
      test.corporateActions.listRelationships(),
    ).resolves.toHaveLength(0);
    const graph = await test.corporateActions.loadIdentityGraph();
    expect(graph.legalEntities).toHaveLength(1);
  });

  it("cuarentena un índice ilegible con el documento nombrado", async () => {
    const test = harness({ successorBody: "{" });
    const outcome = await test.record();

    expect(outcome.run).toMatchObject({
      status: "quarantined",
      qualityFlags: ["submissions_payload_schema_invalid"],
    });
  });
});
