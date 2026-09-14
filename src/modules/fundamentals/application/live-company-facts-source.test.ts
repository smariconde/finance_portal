import { describe, expect, it, vi } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";

import {
  buildFixtureCompanyFactsText,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_ACCESSIONS,
  FIXTURE_FILER_CIK,
  FIXTURE_HISTORY_FILE,
  FIXTURE_RECENT_FILINGS,
} from "../infrastructure/fixture-sec-filer";
import { CompanyFactsSourceError } from "./company-facts-source";
import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  createLiveCompanyFactsSource,
  MAX_HISTORY_FILES_PER_COMPANY,
  selectHistoryFiles,
} from "./live-company-facts-source";

const HISTORY_URL = `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`;

type Route = { status: number; body: string };

function egress(routes: Record<string, Route>) {
  const encoder = new TextEncoder();

  return vi.fn<EgressFetch>(async (request: EgressFetchRequest) => {
    const route = routes[request.url];

    if (route === undefined) {
      throw new Error(`unexpected egress in test`);
    }

    const body = encoder.encode(route.body);

    return {
      status: route.status,
      body,
      byteLength: body.byteLength,
      fetchedAt: "2026-09-14T15:00:00.000Z",
    };
  });
}

function routes(overrides: Record<string, Route> = {}) {
  return {
    [buildSubmissionsUrl(FIXTURE_FILER_CIK)]: {
      status: 200,
      body: JSON.stringify(buildFixtureSubmissions()),
    },
    [buildCompanyFactsUrl(FIXTURE_FILER_CIK)]: {
      status: 200,
      body: buildFixtureCompanyFactsText(),
    },
    [HISTORY_URL]: {
      status: 200,
      body: JSON.stringify(buildFixtureSubmissionsHistory()),
    },
    ...overrides,
  };
}

describe("selectHistoryFiles", () => {
  const file = (name: string, filingFrom: string, filingTo: string) => ({
    name: `CIK${FIXTURE_FILER_CIK}-submissions-${name}.json`,
    filingFrom,
    filingTo,
  });
  const files = [
    file("014", "2024-05-02", "2024-06-08"),
    file("015", "2024-03-27", "2024-04-30"),
    file("016", "2024-02-15", "2024-03-25"),
  ];

  it("picks only the file whose declared range covers the date", () => {
    expect(
      selectHistoryFiles(files, ["2024-04-10"]).map((f) => f.name),
    ).toStrictEqual([files[1]!.name]);
  });

  it("picks both neighbors when the date falls in a gap between declared ranges", () => {
    // El hueco real del CIK 19617: ningún rango declara el 2024-05-01.
    expect(
      selectHistoryFiles(files, ["2024-05-01"]).map((f) => f.name),
    ).toStrictEqual([files[0]!.name, files[1]!.name]);
  });

  it("asks for each file once, in the source's order", () => {
    expect(
      selectHistoryFiles(files, ["2024-05-01", "2024-04-02", "2024-05-20"]).map(
        (f) => f.name,
      ),
    ).toStrictEqual([files[0]!.name, files[1]!.name]);
  });

  it("asks for nothing when no date is missing", () => {
    expect(selectHistoryFiles(files, [])).toStrictEqual([]);
  });
});

describe("createLiveCompanyFactsSource", () => {
  it("downloads submissions, company facts and only the history it needs", async () => {
    const fetch = egress(routes());
    const download = await createLiveCompanyFactsSource({ fetch }).load("42");

    expect(fetch.mock.calls.map(([request]) => request.url)).toStrictEqual([
      buildSubmissionsUrl(FIXTURE_FILER_CIK),
      buildCompanyFactsUrl(FIXTURE_FILER_CIK),
      HISTORY_URL,
    ]);
    expect(
      fetch.mock.calls.every(([request]) => request.sourceId === "sec-edgar"),
    ).toBe(true);

    expect(download.status).toBe("downloaded");
    if (download.status !== "downloaded") return;

    expect(download.cik).toBe(FIXTURE_FILER_CIK);
    expect(download.facts).toHaveLength(8);
    expect(download.filings.map((filing) => filing.accessionNumber)).toContain(
      FIXTURE_ACCESSIONS.q3Filing,
    );
    expect(download.documents.map((document) => document.kind)).toStrictEqual([
      "submissions",
      "companyfacts",
      "submissions_history",
    ]);
  });

  it("skips the history file when every selected filing is recent", async () => {
    const fetch = egress(
      routes({
        [buildSubmissionsUrl(FIXTURE_FILER_CIK)]: {
          status: 200,
          body: JSON.stringify(
            buildFixtureSubmissions({
              recent: [
                ...FIXTURE_RECENT_FILINGS,
                {
                  accessionNumber: FIXTURE_ACCESSIONS.q3Filing,
                  filingDate: "2009-11-03",
                  reportDate: "2009-09-30",
                  acceptanceDateTime: "2009-11-03T21:15:11.000Z",
                  form: "10-Q",
                },
              ],
            }),
          ),
        },
      }),
    );

    await createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses an index that needs more history files than the ceiling, before fetching them", async () => {
    const base = buildFixtureSubmissions() as {
      filings: { files: unknown[] };
    };
    // Todos cubren la fecha de filing del 10-Q viejo, así que todos harían falta.
    const files = Array.from(
      { length: MAX_HISTORY_FILES_PER_COMPANY + 1 },
      (_, index) => ({
        name: `CIK${FIXTURE_FILER_CIK}-submissions-${String(index + 1).padStart(3, "0")}.json`,
        filingFrom: "2009-01-02",
        filingTo: "2009-12-31",
      }),
    );
    const fetch = egress(
      routes({
        [buildSubmissionsUrl(FIXTURE_FILER_CIK)]: {
          status: 200,
          body: JSON.stringify({
            ...base,
            filings: { ...base.filings, files },
          }),
        },
      }),
    );

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).rejects.toMatchObject({
      code: "history_budget_exceeded",
      document: "submissions_history",
      retryable: false,
    });
    // Sólo submissions y companyfacts: ningún archivo histórico se pidió.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a filer without XBRL facts instead of failing", async () => {
    const fetch = egress(
      routes({
        [buildCompanyFactsUrl(FIXTURE_FILER_CIK)]: { status: 404, body: "" },
      }),
    );

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).resolves.toMatchObject({ status: "no_company_facts" });
  });

  it.each([
    [429, true],
    [503, true],
    [403, false],
  ])(
    "names status %i and says whether retrying makes sense",
    async (status, retryable) => {
      const fetch = egress(
        routes({
          [buildCompanyFactsUrl(FIXTURE_FILER_CIK)]: { status, body: "" },
        }),
      );

      const error = await createLiveCompanyFactsSource({ fetch })
        .load(FIXTURE_FILER_CIK)
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(CompanyFactsSourceError);
      expect(error).toMatchObject({
        code: "unexpected_status",
        document: "companyfacts",
        retryable,
      });
    },
  );

  it("quarantines a company facts document it does not understand", async () => {
    const fetch = egress(
      routes({
        [buildCompanyFactsUrl(FIXTURE_FILER_CIK)]: {
          status: 200,
          body: '{"cik": 42, "facts": []}',
        },
      }),
    );

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).rejects.toMatchObject({
      code: "payload_schema_invalid",
      document: "companyfacts",
    });
  });

  it("refuses a document that describes another filer", async () => {
    const fetch = egress(
      routes({
        [buildCompanyFactsUrl(FIXTURE_FILER_CIK)]: {
          status: 200,
          body: buildFixtureCompanyFactsText({ cik: 43 }),
        },
      }),
    );

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).rejects.toMatchObject({ code: "subject_mismatch" });
  });

  it("wraps an egress failure without echoing the destination", async () => {
    const fetch = vi.fn<EgressFetch>(async () => {
      throw new Error("Egress blocked: host_not_allowlisted");
    });

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).rejects.toMatchObject({ code: "fetch_failed", document: "submissions" });
  });

  it("does not build a URL from something that is not a CIK", async () => {
    const fetch = egress(routes());

    await expect(
      createLiveCompanyFactsSource({ fetch }).load("../files/company_tickers"),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not UTF-8 instead of replacing them", async () => {
    const fetch = vi.fn<EgressFetch>(async () => ({
      status: 200,
      body: new Uint8Array([0xff, 0xfe, 0x7b]),
      byteLength: 3,
      fetchedAt: "2026-09-14T15:00:00.000Z",
    }));

    await expect(
      createLiveCompanyFactsSource({ fetch }).load(FIXTURE_FILER_CIK),
    ).rejects.toMatchObject({
      code: "payload_schema_invalid",
      document: "submissions",
    });
  });
});
