import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import type { ArgentinaIndicator } from "../domain/argentina-indicator";
import { DECLARED_ARGENTINA_INDICATORS } from "../domain/declared-argentina-indicators";
import { DECLARED_INDEC_EXPANDED_INDICATORS } from "../domain/declared-indec-expanded-indicators";
import {
  publishedMonthlyRateIndicator,
  reconcileLatestIndecMonthlyRate,
} from "../domain/indec-monthly-reconciliation";
import {
  INDEC_API_PARSER_VERSION,
  INDEC_MAX_PAGES,
  INDEC_PAGE_LIMIT,
  indecPageUrl,
  parseIndecPage,
  type IndecParseFailure,
  type IndecPoint,
} from "../domain/indec-api-parser";

import type {
  ArgentinaIndicatorSource,
  FetchedIndicatorPoints,
} from "./record-argentina-indicator";

export const INDEC_SOURCE_ID = "indec-api";
export const INDEC_DATASET_ID = "indec.service-rows";

export class IndecSourceError extends Error {
  constructor(
    readonly code:
      | "rights_not_approved"
      | "not_declared"
      | "fetch_failed"
      /** 401/403: the owner's token expired or was regenerated (12 months). */
      | "unauthorized"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed"
      | "no_rows"
      | "pagination_failed"
      | "reconciliation_failed",
    readonly indicatorId: string,
    readonly detail: IndecParseFailure | string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(`${code}${detail ? ` (${detail})` : ""}: ${indicatorId}`);
    this.name = "IndecSourceError";
  }
}

/**
 * Reads a declared series from the Catálogo API-INDEC (ADR 0069). The token
 * never reaches this adapter: the egress door adds it for `indec-api`.
 */
export function createLiveIndecSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): ArgentinaIndicatorSource {
  return {
    sourceId: INDEC_SOURCE_ID,
    datasetId: INDEC_DATASET_ID,
    parserVersion: INDEC_API_PARSER_VERSION,
    async load(indicator: ArgentinaIndicator): Promise<FetchedIndicatorPoints> {
      if (
        indicator.sourceId !== INDEC_SOURCE_ID ||
        ![
          ...DECLARED_ARGENTINA_INDICATORS,
          ...DECLARED_INDEC_EXPANDED_INDICATORS,
        ].some((item) => JSON.stringify(item) === JSON.stringify(indicator))
      ) {
        throw new IndecSourceError("not_declared", indicator.id);
      }
      const entry =
        await dependencies.sourceRegistry.findBySourceId(INDEC_SOURCE_ID);
      const rights =
        entry && entry.datasets.includes(INDEC_DATASET_ID)
          ? evaluateIngestionRights(entry, {
              storesRawPayload: false,
              storesNormalizedValues: true,
              publicDisplay: false,
            })
          : null;
      if (!rights?.allowed) {
        throw new IndecSourceError("rights_not_approved", indicator.id);
      }

      const points: IndecPoint[] = [];
      let observedAt: string | null = null;
      let requests = 0;
      let bytes = 0;
      async function fetchPage(
        target: ArgentinaIndicator,
        offset: number,
      ): Promise<readonly IndecPoint[]> {
        let response: Awaited<ReturnType<EgressFetch>>;
        try {
          response = await dependencies.fetch({
            sourceId: INDEC_SOURCE_ID,
            url: indecPageUrl(target, offset),
            accept: "application/json",
          });
        } catch {
          throw new IndecSourceError("fetch_failed", indicator.id);
        }
        requests += 1;
        bytes += response.byteLength;
        observedAt = response.fetchedAt;
        if (response.status === 401 || response.status === 403) {
          throw new IndecSourceError("unauthorized", indicator.id);
        }
        if (response.status === 429 || response.status === 503) {
          throw new IndecSourceError(
            "rate_limited",
            indicator.id,
            null,
            response.retryAfter ?? null,
          );
        }
        if (response.status !== 200) {
          throw new IndecSourceError("unexpected_status", indicator.id);
        }
        const parsed = parseIndecPage(
          new TextDecoder().decode(response.body),
          target,
        );
        if (!parsed.ok) {
          throw new IndecSourceError(
            "schema_changed",
            indicator.id,
            parsed.reason,
          );
        }
        return parsed.points;
      }

      for (let page = 0; page < INDEC_MAX_PAGES; page += 1) {
        const pagePoints = await fetchPage(indicator, points.length);
        const first = pagePoints[0];
        const last = points.at(-1);
        if (first && last && first.periodOn <= last.periodOn) {
          throw new IndecSourceError("pagination_failed", indicator.id);
        }
        points.push(...pagePoints);
        if (pagePoints.length < INDEC_PAGE_LIMIT) {
          if (points.length === 0) {
            // A declared series always has history: zero rows means a renamed
            // filter value or a withdrawn service, never "nothing to record".
            throw new IndecSourceError("no_rows", indicator.id);
          }
          if (observedAt === null) {
            throw new IndecSourceError("fetch_failed", indicator.id);
          }
          const expanded = DECLARED_INDEC_EXPANDED_INDICATORS.some(
            (item) => item.id === indicator.id,
          );
          if (!expanded) return { points, observedAt, requests, bytes };

          const rate = publishedMonthlyRateIndicator(indicator);
          const rates = await fetchPage(rate, 0);
          if (rates.length === 0) {
            throw new IndecSourceError(
              "no_rows",
              indicator.id,
              "published_rate",
            );
          }
          if (rates.length === INDEC_PAGE_LIMIT) {
            throw new IndecSourceError("pagination_failed", indicator.id);
          }
          const reconciliation = reconcileLatestIndecMonthlyRate({
            level: indicator,
            rate,
            levels: points,
            rates,
          });
          if (reconciliation.status === "refused") {
            throw new IndecSourceError(
              "reconciliation_failed",
              indicator.id,
              reconciliation.reason,
            );
          }
          return { points, observedAt, requests, bytes, reconciliation };
        }
      }
      throw new IndecSourceError("pagination_failed", indicator.id);
    },
  };
}
