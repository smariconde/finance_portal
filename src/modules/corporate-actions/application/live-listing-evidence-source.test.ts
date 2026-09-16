import { describe, expect, it, vi } from "vitest";

import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";

import {
  FIXTURE_LISTING_FILERS,
  fixtureListingIndex,
  fixtureSubmissionsPayload,
} from "../infrastructure/fixture-listing-events";
import { ListingEvidenceSourceError } from "./listing-evidence-source";
import { createLiveListingEvidenceSource } from "./live-listing-evidence-source";

const FETCHED_AT = "2025-09-20T18:00:00.000Z";
const TRANSFER_CIK = FIXTURE_LISTING_FILERS.transfer.cik;

function serve(documents: Record<string, { status?: number; body: unknown }>) {
  const encoder = new TextEncoder();

  return vi.fn<EgressFetch>(async ({ url }) => {
    const document = documents[url];
    const body = encoder.encode(
      document === undefined
        ? ""
        : typeof document.body === "string"
          ? document.body
          : JSON.stringify(document.body),
    );

    return {
      status: document === undefined ? 404 : (document.status ?? 200),
      body,
      byteLength: body.byteLength,
      fetchedAt: FETCHED_AT,
    };
  });
}

describe("fuente viva de evidencia de listings", () => {
  it("requires a complete table when the caller will infer absence", async () => {
    const source = createLiveListingEvidenceSource({
      fetch: serve({
        [ASSIGNMENTS_URL]: {
          body: {
            fields: ["cik", "name", "ticker", "exchange"],
            data: [
              [85, "Synthetic", "NEWT", "NYSE"],
              [85, null, "OLDT", "NYSE"],
            ],
          },
        },
      }),
    });
    await expect(
      source.loadAssignments({ requireComplete: true }),
    ).rejects.toMatchObject({
      code: "payload_schema_invalid",
      document: "company_tickers",
    });
    expect((await source.loadAssignments()).assignments).toHaveLength(1);
  });
  it("sale sólo por `sec-edgar` y devuelve tabla e índice parseados", async () => {
    const fetch = serve({
      [ASSIGNMENTS_URL]: {
        body: {
          fields: ["cik", "name", "ticker", "exchange"],
          data: [[81, "TRASPASO SINTETICO CORP", "TRSP", "NYSE"]],
        },
      },
      [buildSubmissionsUrl(TRANSFER_CIK)]: {
        body: fixtureSubmissionsPayload(fixtureListingIndex("transfer")),
      },
    });
    const source = createLiveListingEvidenceSource({ fetch });

    const table = await source.loadAssignments();
    const { index, document } = await source.loadIndex("81");

    expect(table.assignments).toHaveLength(1);
    expect(table.document).toMatchObject({
      kind: "company_tickers",
      cik: null,
    });
    expect(index.filings.map((filing) => filing.form)).toContain("CERT");
    expect(document).toMatchObject({
      kind: "submissions",
      cik: TRANSFER_CIK,
      url: buildSubmissionsUrl(TRANSFER_CIK),
      fetchedAt: FETCHED_AT,
    });
    expect(
      fetch.mock.calls.every(([request]) => request.sourceId === "sec-edgar"),
    ).toBe(true);
  });

  it("distingue lo reintentable de lo que se cuarentena", async () => {
    const source = createLiveListingEvidenceSource({
      fetch: serve({
        [ASSIGNMENTS_URL]: { status: 429, body: "" },
        [buildSubmissionsUrl(TRANSFER_CIK)]: { body: "{ roto" },
        [buildSubmissionsUrl("0000000082")]: {
          body: fixtureSubmissionsPayload(fixtureListingIndex("transfer")),
        },
      }),
    });

    await expect(source.loadAssignments()).rejects.toMatchObject({
      code: "unexpected_status",
      retryable: true,
    });
    await expect(source.loadIndex(TRANSFER_CIK)).rejects.toMatchObject({
      code: "payload_schema_invalid",
      document: "submissions",
    });
    // Pedir un CIK y recibir el índice de otro no es un documento válido.
    await expect(source.loadIndex("82")).rejects.toBeInstanceOf(
      ListingEvidenceSourceError,
    );
    await expect(source.loadIndex("82")).rejects.toMatchObject({
      code: "subject_mismatch",
    });
  });
});
