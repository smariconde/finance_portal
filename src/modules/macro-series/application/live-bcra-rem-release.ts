import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import { parseBcraRemReleasePage } from "../domain/bcra-rem-release-page";
import {
  parseBcraRemReleaseWorkbook,
  type RemMonthlyForecast,
} from "../domain/bcra-rem-release-parser";

export const BCRA_REM_SOURCE_ID = "bcra-rem-release";
export const BCRA_REM_DATASET_ID = "bcra.rem-monthly-inflation";
/** Changes when either the page or workbook parser changes. */
export const BCRA_REM_SOURCE_PARSER_VERSION = "bcra-rem-page-xlsx-1.0.0";
export const BCRA_REM_OCTOBER_PAGE =
  "https://www.bcra.gob.ar/publicaciones/relevamiento-de-expectativas-de-mercado-rem-octubre-de-2026/";

export type FetchedRemRelease = {
  readonly roundMonth: string;
  readonly publishedOn: string;
  readonly availableAt: string;
  readonly recordedAt: string;
  readonly pageUrl: string;
  readonly workbookUrl: string;
  readonly forecasts: readonly RemMonthlyForecast[];
  readonly requests: 2;
  readonly bytes: number;
};

export class BcraRemReleaseError extends Error {
  constructor(
    readonly code:
      | "round_not_declared"
      | "rights_not_approved"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "page_schema_changed"
      | "workbook_schema_changed",
    readonly detail: string | null = null,
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "BcraRemReleaseError";
  }
}

/** Only the release whose page and XLSX were independently inspected is declared. */
export function createLiveBcraRemRelease(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}) {
  return async (roundMonth: string): Promise<FetchedRemRelease> => {
    if (roundMonth !== "2026-10") {
      throw new BcraRemReleaseError("round_not_declared");
    }
    const entry =
      await dependencies.sourceRegistry.findBySourceId(BCRA_REM_SOURCE_ID);
    const rights = entry?.datasets.includes(BCRA_REM_DATASET_ID)
      ? evaluateIngestionRights(entry, {
          storesRawPayload: false,
          storesNormalizedValues: true,
          publicDisplay: false,
        })
      : null;
    if (!rights?.allowed) throw new BcraRemReleaseError("rights_not_approved");

    async function get(url: string, accept: string) {
      let response: Awaited<ReturnType<EgressFetch>>;
      try {
        response = await dependencies.fetch({
          sourceId: BCRA_REM_SOURCE_ID,
          url,
          accept,
        });
      } catch {
        throw new BcraRemReleaseError("fetch_failed");
      }
      if (response.status === 429 || response.status === 503)
        throw new BcraRemReleaseError(
          "rate_limited",
          response.retryAfter ?? null,
        );
      if (response.status !== 200)
        throw new BcraRemReleaseError(
          "unexpected_status",
          String(response.status),
        );
      return response;
    }

    const page = await get(BCRA_REM_OCTOBER_PAGE, "text/html");
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(page.body);
    } catch {
      throw new BcraRemReleaseError("page_schema_changed", "invalid_utf8");
    }
    const parsedPage = parseBcraRemReleasePage(html, roundMonth);
    if (!parsedPage.ok)
      throw new BcraRemReleaseError("page_schema_changed", parsedPage.code);
    const workbook = await get(
      parsedPage.workbookUrl,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const parsedWorkbook = parseBcraRemReleaseWorkbook(
      workbook.body,
      roundMonth,
    );
    if (!parsedWorkbook.ok)
      throw new BcraRemReleaseError(
        "workbook_schema_changed",
        parsedWorkbook.code,
      );
    return {
      roundMonth,
      publishedOn: parsedPage.publishedOn,
      availableAt: parsedPage.availableAt,
      recordedAt: workbook.fetchedAt,
      pageUrl: BCRA_REM_OCTOBER_PAGE,
      workbookUrl: parsedPage.workbookUrl,
      forecasts: parsedWorkbook.forecasts,
      requests: 2,
      bytes: page.byteLength + workbook.byteLength,
    };
  };
}
