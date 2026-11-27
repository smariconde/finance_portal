import { describe, expect, it, vi } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";

import {
  AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
  AMBITO_COUNTRY_RISK_QUOTE_URL,
} from "../domain/ambito-country-risk-parser";
import { readCountryRiskQuote } from "./read-country-risk-quote";

// Synthetic values using the provider's field names.
const BODY = {
  ultimo: "1.078,25",
  fecha: "27-11-2026",
  variacion: "-8,03%",
  "class-variacion": "down-green",
};
const source = DEMO_SOURCE_REGISTRY.find(
  ({ sourceId }) => sourceId === AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
)!;
const fetchedAt = "2026-11-28T01:10:00.000Z";

function response(body: string, status = 200) {
  const data = new TextEncoder().encode(body);
  return vi.fn<EgressFetch>().mockResolvedValue({
    status,
    body: data,
    byteLength: data.length,
    fetchedAt,
  });
}

describe("readCountryRiskQuote", () => {
  it("uses the provider date and the actual consultation time, even after UTC midnight", async () => {
    const fetch = response(JSON.stringify(BODY));
    await expect(readCountryRiskQuote({ source, fetch })).resolves.toEqual({
      on: "2026-11-27",
      value: "1078.25",
      observedAt: fetchedAt,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith({
      sourceId: AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
      url: AMBITO_COUNTRY_RISK_QUOTE_URL,
      accept: "application/json",
    });
  });

  it.each([
    { ...BODY, fecha: "26-11-2026" },
    { ...BODY, fecha: "28-11-2026" },
    { ...BODY, fecha: "31-11-2026" },
    { ...BODY, ultimo: "0" },
    { ...BODY, ultimo: "-9" },
    { ...BODY, ultimo: "N/A" },
    { ...BODY, ultimo: 1078 },
  ])("refuses a stale, future or malformed quote", async (body) => {
    await expect(
      readCountryRiskQuote({ source, fetch: response(JSON.stringify(body)) }),
    ).resolves.toBeNull();
  });

  it("refuses errors and unparseable data", async () => {
    await expect(
      readCountryRiskQuote({
        source,
        fetch: response(JSON.stringify(BODY), 429),
      }),
    ).resolves.toBeNull();
    await expect(
      readCountryRiskQuote({ source, fetch: response("invalid") }),
    ).resolves.toBeNull();
  });

  it("checks declared rights before spending a request", async () => {
    const fetch = response(JSON.stringify(BODY));
    const unavailable = {
      ...source,
      rights: { ...source.rights, automatedAccess: "restricted" as const },
    };
    await expect(
      readCountryRiskQuote({ source: unavailable, fetch }),
    ).resolves.toBeNull();
    await expect(
      readCountryRiskQuote({ source: undefined, fetch }),
    ).resolves.toBeNull();
    await expect(
      readCountryRiskQuote({ source: { ...source, datasets: [] }, fetch }),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
