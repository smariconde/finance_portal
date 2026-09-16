import { describe, expect, it, vi } from "vitest";

import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";

import {
  buildFilingColumns,
  buildSubmissionsPayload,
  FIXTURE_PREDECESSOR_CIK,
  FIXTURE_PREDECESSOR_FILINGS,
  FIXTURE_PREDECESSOR_NAME,
  FIXTURE_SUCCESSION_ACCESSIONS,
  FIXTURE_SUCCESSOR_CIK,
  FIXTURE_SUCCESSOR_FILINGS,
  FIXTURE_SUCCESSOR_NAME,
} from "../infrastructure/fixture-succession";
import { createLiveSuccessionEvidenceSource } from "./live-succession-evidence-source";
import { SuccessionEvidenceSourceError } from "./succession-evidence-source";

const FETCHED_AT = "2025-09-10T11:59:00.000Z";
const REQUEST = {
  predecessorCik: FIXTURE_PREDECESSOR_CIK,
  successorCik: FIXTURE_SUCCESSOR_CIK,
  successionAccession: FIXTURE_SUCCESSION_ACCESSIONS.succession,
};

function historyUrl(name: string): string {
  return `https://data.sec.gov/submissions/${name}`;
}

function serve(documents: Record<string, { status?: number; body: unknown }>) {
  const encoder = new TextEncoder();

  return vi.fn<EgressFetch>(async ({ url }) => {
    const document = documents[url];
    const status = document === undefined ? 404 : (document.status ?? 200);
    const body = encoder.encode(
      document === undefined
        ? ""
        : typeof document.body === "string"
          ? document.body
          : JSON.stringify(document.body),
    );

    return { status, body, byteLength: body.byteLength, fetchedAt: FETCHED_AT };
  });
}

const recent = {
  [buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)]: {
    body: buildSubmissionsPayload({
      cik: FIXTURE_SUCCESSOR_CIK,
      name: FIXTURE_SUCCESSOR_NAME,
      filings: FIXTURE_SUCCESSOR_FILINGS,
    }),
  },
  [buildSubmissionsUrl(FIXTURE_PREDECESSOR_CIK)]: {
    body: buildSubmissionsPayload({
      cik: FIXTURE_PREDECESSOR_CIK,
      name: FIXTURE_PREDECESSOR_NAME,
      filings: FIXTURE_PREDECESSOR_FILINGS,
    }),
  },
};

describe("createLiveSuccessionEvidenceSource", () => {
  it("con todo entre las recientes pide dos documentos: sucesor y antecesor", async () => {
    const fetch = serve(recent);
    const download = await createLiveSuccessionEvidenceSource({ fetch }).load(
      REQUEST,
    );

    expect(fetch.mock.calls.map(([request]) => request.url)).toStrictEqual([
      buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK),
      buildSubmissionsUrl(FIXTURE_PREDECESSOR_CIK),
    ]);
    expect(
      fetch.mock.calls.every(([request]) => request.sourceId === "sec-edgar"),
    ).toBe(true);
    expect(download.successor).toMatchObject({
      cik: FIXTURE_SUCCESSOR_CIK,
      entityName: FIXTURE_SUCCESSOR_NAME,
      fetchedAt: FETCHED_AT,
    });
    expect(download.predecessor.entityName).toBe(FIXTURE_PREDECESSOR_NAME);
    expect(download.predecessor.filings).toHaveLength(
      FIXTURE_PREDECESSOR_FILINGS.length,
    );
    expect(download.documents.map((document) => document.kind)).toStrictEqual([
      "submissions",
      "submissions",
    ]);
  });

  it("busca la presentación de sucesión en los archivos históricos y lee lo anterior", async () => {
    const [jointQuarter, succession] = FIXTURE_SUCCESSOR_FILINGS as [
      SecFiling,
      SecFiling,
    ];
    const newerFile = `CIK${FIXTURE_SUCCESSOR_CIK}-submissions-001.json`;
    const olderFile = `CIK${FIXTURE_SUCCESSOR_CIK}-submissions-002.json`;
    const unrelatedFile = `CIK${FIXTURE_SUCCESSOR_CIK}-submissions-000.json`;
    const fetch = serve({
      ...recent,
      [buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)]: {
        body: buildSubmissionsPayload({
          cik: FIXTURE_SUCCESSOR_CIK,
          name: FIXTURE_SUCCESSOR_NAME,
          filings: [jointQuarter],
          files: [
            // Más viejo que la sucesión: puede tener un reporte previo.
            {
              name: olderFile,
              filingFrom: "2020-01-01",
              filingTo: "2025-06-30",
            },
            {
              name: newerFile,
              filingFrom: "2025-07-01",
              filingTo: "2025-07-31",
            },
            // El más nuevo se pide primero aunque no tenga la presentación.
            {
              name: unrelatedFile,
              filingFrom: "2025-08-01",
              filingTo: "2025-08-02",
            },
          ],
        }),
      },
      [historyUrl(unrelatedFile)]: { body: buildFilingColumns([]) },
      [historyUrl(newerFile)]: { body: buildFilingColumns([succession]) },
      [historyUrl(olderFile)]: { body: buildFilingColumns([]) },
    });

    const download = await createLiveSuccessionEvidenceSource({ fetch }).load(
      REQUEST,
    );

    expect(fetch.mock.calls.map(([request]) => request.url)).toStrictEqual([
      buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK),
      // Del más nuevo al más viejo hasta encontrarla.
      historyUrl(unrelatedFile),
      historyUrl(newerFile),
      // Y después lo que empieza antes de su fecha de filing.
      historyUrl(olderFile),
      buildSubmissionsUrl(FIXTURE_PREDECESSOR_CIK),
    ]);
    expect(
      download.successor.filings.map((filing) => filing.accessionNumber),
    ).toContain(FIXTURE_SUCCESSION_ACCESSIONS.succession);
  });

  it("recorre el histórico del antecesor hasta un reporte periódico previo", async () => {
    const annualOnly = FIXTURE_PREDECESSOR_FILINGS.filter(
      (filing) => filing.form === "10-K",
    );
    const file = `CIK${FIXTURE_PREDECESSOR_CIK}-submissions-001.json`;
    const fetch = serve({
      ...recent,
      [buildSubmissionsUrl(FIXTURE_PREDECESSOR_CIK)]: {
        body: buildSubmissionsPayload({
          cik: FIXTURE_PREDECESSOR_CIK,
          name: FIXTURE_PREDECESSOR_NAME,
          filings: FIXTURE_PREDECESSOR_FILINGS.filter(
            (filing) => filing.form === "25-NSE",
          ),
          files: [
            { name: file, filingFrom: "2000-01-01", filingTo: "2025-06-30" },
          ],
        }),
      },
      [historyUrl(file)]: { body: buildFilingColumns(annualOnly) },
    });

    const download = await createLiveSuccessionEvidenceSource({ fetch }).load(
      REQUEST,
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(download.predecessor.filings.map((filing) => filing.form)).toContain(
      "10-K",
    );
  });

  it("cuarentena un índice que describe a otro filer", async () => {
    const fetch = serve({
      ...recent,
      [buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)]: {
        body: buildSubmissionsPayload({
          cik: "0000000099",
          name: "Otro",
          filings: FIXTURE_SUCCESSOR_FILINGS,
        }),
      },
    });

    await expect(
      createLiveSuccessionEvidenceSource({ fetch }).load(REQUEST),
    ).rejects.toMatchObject({
      code: "subject_mismatch",
      document: "submissions",
    });
  });

  it.each([
    ["un JSON roto", { body: "{" }, "payload_schema_invalid", false],
    [
      "un envelope sin presentaciones",
      { body: { cik: 72 } },
      "payload_schema_invalid",
      false,
    ],
    ["un 429", { status: 429, body: "" }, "unexpected_status", true],
    ["un 404", { status: 404, body: "" }, "unexpected_status", false],
  ])("falla nombrada ante %s", async (_label, document, code, retryable) => {
    const fetch = serve({
      ...recent,
      [buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)]: document,
    });

    try {
      await createLiveSuccessionEvidenceSource({ fetch }).load(REQUEST);
      expect.unreachable("la fuente debía fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(SuccessionEvidenceSourceError);
      expect(error).toMatchObject({ code, retryable });
    }
  });

  it("envuelve un egress bloqueado sin repetir el destino", async () => {
    const fetch = vi.fn<EgressFetch>(async () => {
      throw new Error("egress blocked: path_not_allowlisted");
    });

    await expect(
      createLiveSuccessionEvidenceSource({ fetch }).load(REQUEST),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });
});
