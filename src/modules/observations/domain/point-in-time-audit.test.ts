import { describe, expect, it } from "vitest";

import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  withIngestionFlags,
  type Observation,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";
import {
  addChainsToAudit,
  auditRevisionChain,
  createAudit,
  summarizeAudit,
  sourceDocumentKey,
  type PointInTimeClaim,
  type SourceDocumentIndex,
} from "@/modules/observations/domain/point-in-time-audit";

const SUBJECT_ID = "0a1b7c40-3f21-4d8e-9a01-000000000001";
const RUN_ID = "0a1b7c40-3f21-4d8e-9a01-0000000000f1";

const FIRST_AVAILABLE_AT = "2025-02-20T21:00:00.000Z";
const SECOND_AVAILABLE_AT = "2025-05-01T14:00:00.000Z";
const FETCHED_AT = "2026-08-24T10:00:00.000Z";

function logicalKey(
  overrides: Partial<ObservationLogicalKey> = {},
): ObservationLogicalKey {
  return {
    subjectType: "legal_entity",
    subjectId: SUBJECT_ID,
    metricId: "revenue",
    concept: "Revenues",
    asOf: "2024-12-31",
    periodStart: "2024-01-01",
    periodEnd: "2024-12-31",
    periodType: "annual",
    unit: "monetary",
    currency: "USD",
    sourceId: "fixture-demo-fundamentals",
    datasetId: "demo.fundamentals.annual",
    valueBasis: "reported",
    ...overrides,
  };
}

let sequence = 0;

function observation(fields: {
  key?: Partial<ObservationLogicalKey>;
  rawValue?: string;
  availableAt: string;
  fetchedAt?: string;
  supersededAt?: string | null;
  revisionNumber?: number;
  restatementOfId?: string | null;
  sourceDocumentId?: string | null;
  parserVersion?: string;
}): Observation {
  sequence += 1;
  const key = logicalKey(fields.key);
  const revisionNumber = fields.revisionNumber ?? 1;
  const rawValue = fields.rawValue ?? "100";
  const parserVersion = fields.parserVersion ?? "fixture-1.0.0";
  const sourceDocumentId =
    fields.sourceDocumentId === undefined ? "doc-1" : fields.sourceDocumentId;

  return observationSchema.parse({
    observationId: `0a1b7c40-3f21-4d8e-9a01-${String(sequence).padStart(12, "0")}`,
    ...key,
    parserVersion,
    rawValue,
    rawValueStatus: "stored",
    normalizedValue: null,
    transformationId: null,
    availableAt: fields.availableAt,
    supersededAt: fields.supersededAt ?? null,
    fetchedAt: fields.fetchedAt ?? FETCHED_AT,
    recordedAt: FETCHED_AT,
    revisionGroupId: computeRevisionGroupId(key),
    revisionNumber,
    restatementOfId:
      fields.restatementOfId === undefined
        ? revisionNumber === 1
          ? null
          : "0a1b7c40-3f21-4d8e-9a01-0000000000b1"
        : fields.restatementOfId,
    contentHash: computeObservationContentHash({
      logicalKey: key,
      parserVersion,
      rawValue,
      rawValueStatus: "stored",
      normalizedValue: null,
      availableAt: fields.availableAt,
      sourceDocumentId,
      externalId: `external-${sequence}`,
      qualityFlags: [],
    }),
    qualityFlags: withIngestionFlags([], fields.availableAt, FETCHED_AT),
    sourceDocumentId,
    ingestionRunId: RUN_ID,
  });
}

/**
 * La cadena sana del ejemplo del contrato: 100 el 2025-02-20 y 96 el 2025-05-01,
 * con la primera revisión superseded exactamente en la aceptación de la segunda.
 */
function restatedChain(): Observation[] {
  const first = observation({
    rawValue: "100",
    availableAt: FIRST_AVAILABLE_AT,
    supersededAt: SECOND_AVAILABLE_AT,
    revisionNumber: 1,
  });

  const second = observation({
    rawValue: "96",
    availableAt: SECOND_AVAILABLE_AT,
    revisionNumber: 2,
    restatementOfId: first.observationId,
    sourceDocumentId: "doc-2",
  });

  return [first, second];
}

function documentsFor(chain: readonly Observation[]): SourceDocumentIndex {
  return new Map(
    chain.flatMap((revision) =>
      revision.sourceDocumentId === null
        ? []
        : [
            [
              sourceDocumentKey(revision.sourceId, revision.sourceDocumentId),
              revision.availableAt,
            ] as const,
          ],
    ),
  );
}

function detailsFor(
  chain: readonly Observation[],
  claim: PointInTimeClaim,
  documents: SourceDocumentIndex = documentsFor(chain),
): string[] {
  return auditRevisionChain(chain, documents)
    .findings.filter((finding) => finding.claim === claim)
    .map((finding) => finding.detail);
}

describe("auditRevisionChain", () => {
  it("does not report a healthy restated chain", () => {
    const chain = restatedChain();

    expect(auditRevisionChain(chain, documentsFor(chain)).findings).toEqual([]);
  });

  it("exercises every claim on a restated chain", () => {
    const chain = restatedChain();
    const { tallies } = auditRevisionChain(chain, documentsFor(chain));

    expect(tallies.provenance_resolves.checked).toBe(2);
    expect(tallies.availability_precedes_fetch.checked).toBe(2);
    expect(tallies.revision_chain_ordered.checked).toBe(3);
    expect(tallies.as_known_excludes_later_revision.checked).toBe(1);
    expect(tallies.restatement_changes_content.checked).toBe(1);
  });

  describe("provenance_resolves", () => {
    it("counts a row that cites no document instead of failing it", () => {
      // Una fuente de fixture no publica documentos. La afirmación es sobre la
      // cita que no resuelve, no sobre la fila que no cita.
      const chain = [
        observation({
          availableAt: FIRST_AVAILABLE_AT,
          sourceDocumentId: null,
        }),
      ];
      const result = auditRevisionChain(chain, new Map());

      expect(result.findings).toEqual([]);
      expect(result.rowsWithoutSourceDocument).toBe(1);
      expect(result.tallies.provenance_resolves.checked).toBe(0);
    });

    it("names a row whose source document is not stored", () => {
      const chain = [observation({ availableAt: FIRST_AVAILABLE_AT })];

      expect(detailsFor(chain, "provenance_resolves", new Map())).toEqual([
        "unknown_source_document",
      ]);
    });

    it("names a row dated differently from its own filing", () => {
      const chain = [observation({ availableAt: FIRST_AVAILABLE_AT })];
      const documents = new Map([
        [
          sourceDocumentKey("fixture-demo-fundamentals", "doc-1"),
          SECOND_AVAILABLE_AT,
        ],
      ]);

      expect(detailsFor(chain, "provenance_resolves", documents)).toEqual([
        "document_availability_mismatch",
      ]);
    });
  });

  describe("availability_precedes_fetch", () => {
    it("names a row dated with the download instant", () => {
      const chain = [
        observation({
          availableAt: FIRST_AVAILABLE_AT,
          fetchedAt: FIRST_AVAILABLE_AT,
        }),
      ];

      expect(detailsFor(chain, "availability_precedes_fetch")).toEqual([
        "availability_dated_with_the_clock",
      ]);
    });
  });

  describe("revision_chain_ordered", () => {
    it("names a revision that is not newer than the one it restates", () => {
      const first = observation({
        availableAt: SECOND_AVAILABLE_AT,
        supersededAt: "2025-09-01T00:00:00.000Z",
        revisionNumber: 1,
      });
      const second = observation({
        rawValue: "96",
        availableAt: FIRST_AVAILABLE_AT,
        revisionNumber: 2,
        restatementOfId: first.observationId,
        sourceDocumentId: "doc-2",
      });

      expect(detailsFor([first, second], "revision_chain_ordered")).toEqual([
        "revision_not_newer",
      ]);
    });

    it("names a revision that restates something other than its predecessor", () => {
      const [first, second] = restatedChain();
      const detached = observationSchema.parse({
        ...second,
        restatementOfId: "0a1b7c40-3f21-4d8e-9a01-0000000000c9",
      });

      expect(detailsFor([first!, detached], "revision_chain_ordered")).toEqual([
        "broken_restatement_link",
      ]);
    });

    it("names a predecessor superseded at an instant that is not the successor's", () => {
      const [first, second] = restatedChain();
      const early = observationSchema.parse({
        ...first,
        supersededAt: "2025-04-01T00:00:00.000Z",
      });

      expect(detailsFor([early, second!], "revision_chain_ordered")).toEqual([
        "supersession_does_not_match_successor",
      ]);
    });

    it("names a chain whose last revision is not the current one", () => {
      const [first, second] = restatedChain();
      const closed = observationSchema.parse({
        ...second,
        supersededAt: "2025-09-01T00:00:00.000Z",
      });

      expect(detailsFor([first!, closed], "revision_chain_ordered")).toEqual([
        "no_current_revision",
      ]);
    });

    it("names a chain with two revisions still current", () => {
      const [first, second] = restatedChain();
      const open = observationSchema.parse({ ...first, supersededAt: null });

      expect(detailsFor([open, second!], "revision_chain_ordered")).toEqual([
        "supersession_does_not_match_successor",
        "more_than_one_current_revision",
      ]);
    });
  });

  describe("restatement_changes_content", () => {
    it("names a revision that repeats the value with no reason to exist", () => {
      const first = observation({
        rawValue: "100",
        availableAt: FIRST_AVAILABLE_AT,
        supersededAt: SECOND_AVAILABLE_AT,
        revisionNumber: 1,
      });
      const second = observation({
        rawValue: "100",
        availableAt: SECOND_AVAILABLE_AT,
        revisionNumber: 2,
        restatementOfId: first.observationId,
        sourceDocumentId: "doc-2",
      });

      expect(
        detailsFor([first, second], "restatement_changes_content"),
      ).toEqual(["identical_value_without_reason"]);
    });

    it("accepts the same value republished by another parser version", () => {
      const first = observation({
        rawValue: "100",
        availableAt: FIRST_AVAILABLE_AT,
        supersededAt: SECOND_AVAILABLE_AT,
        revisionNumber: 1,
      });
      const second = observation({
        rawValue: "100",
        availableAt: SECOND_AVAILABLE_AT,
        revisionNumber: 2,
        restatementOfId: first.observationId,
        sourceDocumentId: "doc-2",
        parserVersion: "fixture-2.0.0",
      });

      expect(
        detailsFor([first, second], "restatement_changes_content"),
      ).toEqual([]);
    });
  });

  describe("as_known_excludes_later_revision", () => {
    it("names a fact that cannot be read at its own acceptance", () => {
      // `as_of` posterior a la aceptación del filing que lo reporta: el corte
      // económico lo esconde justo cuando se volvió público.
      const key = { asOf: "2025-12-31", periodEnd: "2025-12-31" };
      const first = observation({
        key,
        rawValue: "100",
        availableAt: FIRST_AVAILABLE_AT,
        supersededAt: SECOND_AVAILABLE_AT,
        revisionNumber: 1,
      });
      const second = observation({
        key,
        rawValue: "96",
        availableAt: SECOND_AVAILABLE_AT,
        revisionNumber: 2,
        restatementOfId: first.observationId,
        sourceDocumentId: "doc-2",
      });

      const result = auditRevisionChain(
        [first, second],
        documentsFor([first, second]),
      );

      expect(
        result.findings.map((finding) => [finding.claim, finding.detail]),
      ).toEqual([
        [
          "as_known_excludes_later_revision",
          "earlier_knowledge_returned_nothing",
        ],
      ]);
    });

    it("names a revision number that does not track availability", () => {
      // La tercera revisión quedó disponible antes que la segunda. Elegir por
      // número de revisión la vuelve visible en una consulta anterior.
      const first = observation({
        rawValue: "100",
        availableAt: FIRST_AVAILABLE_AT,
        supersededAt: "2025-07-01T00:00:00.000Z",
        revisionNumber: 1,
      });
      const second = observation({
        rawValue: "96",
        availableAt: "2025-07-01T00:00:00.000Z",
        supersededAt: "2025-08-01T00:00:00.000Z",
        revisionNumber: 2,
        restatementOfId: first.observationId,
        sourceDocumentId: "doc-2",
      });
      const third = observation({
        rawValue: "94",
        availableAt: SECOND_AVAILABLE_AT,
        revisionNumber: 3,
        restatementOfId: second.observationId,
        sourceDocumentId: "doc-3",
      });

      expect(
        detailsFor([first, second, third], "as_known_excludes_later_revision"),
      ).toContain("later_revision_leaked_into_earlier_query");
    });
  });
});

describe("summarizeAudit", () => {
  it("passes only when every claim was exercised", () => {
    const chain = restatedChain();
    const report = summarizeAudit(
      addChainsToAudit(createAudit(), [chain], documentsFor(chain)),
    );

    expect(report.passed).toBe(true);
    expect(report.chains).toBe(1);
    expect(report.revisions).toBe(2);
    expect(report.restatedChains).toBe(1);
  });

  it("refuses to call an unexercised claim a pass", () => {
    // Una base sin ninguna cadena restateada no prueba nada sobre el
    // no-look-ahead: la afirmación queda sin ejercitar, nunca en verde.
    const chain = [observation({ availableAt: FIRST_AVAILABLE_AT })];
    const report = summarizeAudit(
      addChainsToAudit(createAudit(), [chain], documentsFor(chain)),
    );

    expect(report.passed).toBe(false);
    expect(
      report.verdicts.find(
        (verdict) => verdict.claim === "as_known_excludes_later_revision",
      ),
    ).toEqual({
      claim: "as_known_excludes_later_revision",
      status: "not_exercised",
      checked: 0,
      failed: 0,
    });
  });

  it("counts every failure and keeps the findings bounded", () => {
    const broken = Array.from({ length: 60 }, () => [
      observation({ availableAt: FIRST_AVAILABLE_AT }),
    ]);

    const report = summarizeAudit(
      addChainsToAudit(createAudit(), broken, new Map()),
    );

    expect(report.chains).toBe(60);
    expect(report.findings).toHaveLength(50);
    expect(report.droppedFindings).toBe(10);
    expect(
      report.verdicts.find(
        (verdict) => verdict.claim === "provenance_resolves",
      ),
    ).toEqual({
      claim: "provenance_resolves",
      status: "fail",
      checked: 60,
      failed: 60,
    });
  });
});
