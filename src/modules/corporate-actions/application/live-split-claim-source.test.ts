import { describe, expect, it, vi } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";

import {
  buildCompanyConceptPayload,
  buildSplitFixtureClaims,
  SPLIT_FILER_CIK,
} from "../infrastructure/fixture-split";
import {
  buildCompanyConceptUrl,
  createLiveSplitClaimSource,
} from "./live-split-claim-source";
import { SplitClaimSourceError } from "./split-claim-source";

const FETCHED_AT = "2025-09-15T11:59:00.000Z";
const URL = buildCompanyConceptUrl(SPLIT_FILER_CIK, {
  taxonomy: "us-gaap",
  concept: "StockholdersEquityNoteStockSplitConversionRatio1",
});

function serve(status: number, body: unknown) {
  const encoder = new TextEncoder();

  return vi.fn<EgressFetch>(async () => {
    const bytes = encoder.encode(
      typeof body === "string" ? body : JSON.stringify(body),
    );

    return {
      status,
      body: bytes,
      byteLength: bytes.byteLength,
      fetchedAt: FETCHED_AT,
    };
  });
}

async function failure(fetch: EgressFetch): Promise<SplitClaimSourceError> {
  try {
    await createLiveSplitClaimSource({ fetch }).load({ cik: "73" });
  } catch (error) {
    if (error instanceof SplitClaimSourceError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the source to fail");
}

describe("createLiveSplitClaimSource", () => {
  it("pide un solo documento, a la SEC, por el concepto de ratio", async () => {
    const claims = buildSplitFixtureClaims();
    const fetch = serve(200, buildCompanyConceptPayload(claims));
    const download = await createLiveSplitClaimSource({ fetch }).load({
      cik: "73",
    });

    expect(URL).toBe(
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000000073/us-gaap/StockholdersEquityNoteStockSplitConversionRatio1.json",
    );
    expect(fetch.mock.calls).toStrictEqual([
      [{ sourceId: "sec-edgar", url: URL, accept: "application/json" }],
    ]);
    expect(download.status).toBe("claims");
    if (download.status !== "claims") return;

    expect(download.claims).toStrictEqual(claims);
    expect(download.documents).toStrictEqual([
      {
        kind: "companyconcept",
        cik: SPLIT_FILER_CIK,
        url: URL,
        fetchedAt: FETCHED_AT,
        byteLength: expect.any(Number),
        parserVersion: "sec-companyconcept-1.0.0",
      },
    ]);
  });

  it("un 404 es un filer que nunca declaró un ratio, no un documento roto", async () => {
    const download = await createLiveSplitClaimSource({
      fetch: serve(404, "<Error><Code>NoSuchKey</Code></Error>"),
    }).load({ cik: "73" });

    expect(download).toMatchObject({
      status: "no_claims",
      cik: SPLIT_FILER_CIK,
      fetchedAt: FETCHED_AT,
    });
  });

  it("un 429 o un 5xx se puede reintentar; un 403 no", async () => {
    expect(await failure(serve(429, ""))).toMatchObject({
      code: "unexpected_status",
      retryable: true,
    });
    expect(await failure(serve(503, ""))).toMatchObject({ retryable: true });
    expect(await failure(serve(403, ""))).toMatchObject({ retryable: false });
  });

  it("un sobre que no se entiende es un contrato roto", async () => {
    expect((await failure(serve(200, "{"))).code).toBe(
      "payload_schema_invalid",
    );
    expect(
      (
        await failure(
          serve(200, { ...buildCompanyConceptPayload([]), tag: "Assets" }),
        )
      ).code,
    ).toBe("payload_schema_invalid");
  });

  it("un documento de otro filer no se usa", async () => {
    expect(
      (await failure(serve(200, buildCompanyConceptPayload([], 74)))).code,
    ).toBe("subject_mismatch");
  });

  it("un fallo del egress no expone el destino", async () => {
    const error = await failure(
      vi.fn<EgressFetch>(async () => {
        throw new Error("host_not_allowlisted");
      }),
    );

    expect(error.code).toBe("fetch_failed");
    expect(error.message).not.toContain("data.sec.gov");
  });
});
