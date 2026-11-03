import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import type { ArgentinaIndicator } from "../domain/argentina-indicator";
import {
  ARGENTINA_SERIES_MAX_PAGES,
  ARGENTINA_SERIES_PAGE_LIMIT,
  ARGENTINA_SERIES_PARSER_VERSION,
  argentinaSeriesPageUrl,
  parseArgentinaSeriesPage,
} from "../domain/argentina-series-parser";
import { DECLARED_ARGENTINA_INDICATORS } from "../domain/declared-argentina-indicators";

export const ARGENTINA_SERIES_SOURCE_ID = "argentina-series-tiempo";
export const ARGENTINA_SERIES_DATASET_ID = "argentina.series-observations";

export class ArgentinaSeriesSourceError extends Error {
  constructor(
    readonly code:
      | "rights_not_approved"
      | "not_declared"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed"
      | "pagination_failed",
    readonly indicatorId: string,
    readonly retryAfter: string | null = null,
  ) {
    super(`${code}: ${indicatorId}`);
    this.name = "ArgentinaSeriesSourceError";
  }
}

export type FetchedArgentinaIndicator = {
  readonly indicator: ArgentinaIndicator;
  readonly points: readonly {
    readonly periodOn: string;
    readonly value: string | null;
  }[];
  readonly observedAt: string;
  readonly sourceName: string;
  readonly requests: number;
  readonly bytes: number;
};

export function createLiveArgentinaSeriesSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}) {
  return {
    sourceId: ARGENTINA_SERIES_SOURCE_ID,
    datasetId: ARGENTINA_SERIES_DATASET_ID,
    parserVersion: ARGENTINA_SERIES_PARSER_VERSION,
    async load(
      indicator: ArgentinaIndicator,
    ): Promise<FetchedArgentinaIndicator> {
      if (
        !DECLARED_ARGENTINA_INDICATORS.some(
          (item) => JSON.stringify(item) === JSON.stringify(indicator),
        )
      ) {
        throw new ArgentinaSeriesSourceError("not_declared", indicator.id);
      }
      const entry = await dependencies.sourceRegistry.findBySourceId(
        ARGENTINA_SERIES_SOURCE_ID,
      );
      const rights =
        entry && entry.datasets.includes(ARGENTINA_SERIES_DATASET_ID)
          ? evaluateIngestionRights(entry, {
              storesRawPayload: false,
              storesNormalizedValues: true,
              publicDisplay: false,
            })
          : null;
      if (!rights?.allowed) {
        throw new ArgentinaSeriesSourceError(
          "rights_not_approved",
          indicator.id,
        );
      }

      const points: { periodOn: string; value: string | null }[] = [];
      let total: number | null = null;
      let sourceName: string | null = null;
      let observedAt: string | null = null;
      let bytes = 0;
      let requests = 0;

      for (
        let pageIndex = 0;
        pageIndex < ARGENTINA_SERIES_MAX_PAGES;
        pageIndex += 1
      ) {
        let response: Awaited<ReturnType<EgressFetch>>;
        try {
          response = await dependencies.fetch({
            sourceId: ARGENTINA_SERIES_SOURCE_ID,
            url: argentinaSeriesPageUrl(indicator.externalId, points.length),
            accept: "application/json",
          });
        } catch {
          throw new ArgentinaSeriesSourceError("fetch_failed", indicator.id);
        }
        requests += 1;
        bytes += response.byteLength;
        observedAt = response.fetchedAt;
        if (response.status === 429 || response.status === 503) {
          throw new ArgentinaSeriesSourceError(
            "rate_limited",
            indicator.id,
            response.retryAfter ?? null,
          );
        }
        if (response.status !== 200) {
          throw new ArgentinaSeriesSourceError(
            "unexpected_status",
            indicator.id,
          );
        }
        const parsed = parseArgentinaSeriesPage(
          new TextDecoder().decode(response.body),
          indicator,
        );
        if (!parsed.ok) {
          throw new ArgentinaSeriesSourceError("schema_changed", indicator.id);
        }
        const page = parsed.page;
        if (
          (total !== null && total !== page.total) ||
          (sourceName !== null && sourceName !== page.sourceName) ||
          (points.length > 0 &&
            page.points[0] &&
            page.points[0].periodOn <= points[points.length - 1]!.periodOn)
        ) {
          throw new ArgentinaSeriesSourceError(
            "pagination_failed",
            indicator.id,
          );
        }
        total = page.total;
        sourceName = page.sourceName;
        points.push(...page.points);
        if (points.length === total) {
          return { indicator, points, observedAt, sourceName, requests, bytes };
        }
        if (page.points.length !== ARGENTINA_SERIES_PAGE_LIMIT) {
          throw new ArgentinaSeriesSourceError(
            "pagination_failed",
            indicator.id,
          );
        }
      }
      throw new ArgentinaSeriesSourceError("pagination_failed", indicator.id);
    },
  };
}
