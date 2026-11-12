import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import {
  BCRA_ITCRM_PARSER_VERSION,
  BCRA_ITCRM_SOURCE_URL,
  parseBcraItcrmWorkbook,
} from "../domain/bcra-itcrm-parser";
import { DECLARED_ITCRM } from "../domain/declared-argentina-indicators";
import type { ArgentinaIndicator } from "../domain/argentina-indicator";

import type { ArgentinaIndicatorSource } from "./record-argentina-indicator";

export const BCRA_ITCRM_SOURCE_ID = "bcra-itcrm-xlsx";
export const BCRA_ITCRM_DATASET_ID = "bcra.itcrm-daily";

export class BcraItcrmSourceError extends Error {
  readonly retryAfter: string | null;
  constructor(
    readonly code:
      | "not_declared"
      | "rights_not_approved"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed",
    readonly detail: string | null = null,
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "BcraItcrmSourceError";
    this.retryAfter = code === "rate_limited" ? detail : null;
  }
}

/** One bounded download. The workbook is read in memory and never persisted. */
export function createLiveBcraItcrmSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): ArgentinaIndicatorSource {
  return {
    sourceId: BCRA_ITCRM_SOURCE_ID,
    datasetId: BCRA_ITCRM_DATASET_ID,
    parserVersion: BCRA_ITCRM_PARSER_VERSION,
    async load(indicator: ArgentinaIndicator) {
      if (JSON.stringify(indicator) !== JSON.stringify(DECLARED_ITCRM)) {
        throw new BcraItcrmSourceError("not_declared");
      }
      const entry =
        await dependencies.sourceRegistry.findBySourceId(BCRA_ITCRM_SOURCE_ID);
      const rights =
        entry?.datasets.includes(BCRA_ITCRM_DATASET_ID) === true
          ? evaluateIngestionRights(entry, {
              storesRawPayload: false,
              storesNormalizedValues: true,
              publicDisplay: false,
            })
          : null;
      if (!rights?.allowed) {
        throw new BcraItcrmSourceError("rights_not_approved");
      }
      let response: Awaited<ReturnType<EgressFetch>>;
      try {
        response = await dependencies.fetch({
          sourceId: BCRA_ITCRM_SOURCE_ID,
          url: BCRA_ITCRM_SOURCE_URL,
          accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      } catch {
        throw new BcraItcrmSourceError("fetch_failed");
      }
      if (response.status === 429 || response.status === 503) {
        throw new BcraItcrmSourceError(
          "rate_limited",
          response.retryAfter ?? null,
        );
      }
      if (response.status !== 200) {
        throw new BcraItcrmSourceError(
          "unexpected_status",
          String(response.status),
        );
      }
      const parsed = parseBcraItcrmWorkbook(response.body);
      if (!parsed.ok) {
        throw new BcraItcrmSourceError("schema_changed", parsed.code);
      }
      return {
        points: parsed.points.map((point) => ({
          periodOn: point.on,
          value: point.value,
        })),
        observedAt: response.fetchedAt,
        requests: 1,
        bytes: response.byteLength,
      };
    },
  };
}
