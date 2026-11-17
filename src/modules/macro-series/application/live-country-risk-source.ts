import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import type { ArgentinaIndicator } from "../domain/argentina-indicator";
import {
  AMBITO_COUNTRY_RISK_PARSER_VERSION,
  ambitoCountryRiskUrl,
  parseAmbitoCountryRisk,
} from "../domain/ambito-country-risk-parser";
import { DECLARED_COUNTRY_RISK } from "../domain/declared-country-risk";

import type {
  ArgentinaIndicatorSource,
  FetchedIndicatorPoints,
} from "./record-argentina-indicator";

export const COUNTRY_RISK_SOURCE_ID = "ambito-riesgo-pais";
export const COUNTRY_RISK_DATASET_ID = "ambito.riesgo-pais";

export class CountryRiskSourceError extends Error {
  constructor(
    readonly code:
      | "rights_not_approved"
      | "not_declared"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed",
    /** The parser's or the door's own code, never a payload value. */
    readonly detail: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(
      `${code}${detail ? ` (${detail})` : ""}: ${DECLARED_COUNTRY_RISK.id}`,
    );
    this.name = "CountryRiskSourceError";
  }
}

async function fetchOk(
  fetch: EgressFetch,
  url: string,
): Promise<EgressFetchResponse> {
  let response: EgressFetchResponse;
  try {
    response = await fetch({
      sourceId: COUNTRY_RISK_SOURCE_ID,
      url,
      accept: "application/json",
    });
  } catch (error) {
    // The door's rejection code names the cause; a message could carry a URL.
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    throw new CountryRiskSourceError(
      "fetch_failed",
      code !== null && /^[a-z_]{1,48}$/u.test(code) ? code : null,
    );
  }
  if (response.status === 429 || response.status === 503) {
    throw new CountryRiskSourceError(
      "rate_limited",
      null,
      response.retryAfter ?? null,
    );
  }
  if (response.status !== 200) {
    throw new CountryRiskSourceError(
      "unexpected_status",
      String(response.status),
    );
  }
  return response;
}

/**
 * Ámbito's whole history of country risk closes in one request (ADR 0080).
 * Only the closes: the day's value moves during the session and is never
 * asked for. A day published with two values is left out by the parser and
 * counted in `rejectedDays`.
 */
export function createLiveCountryRiskSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  readonly now: () => Date;
}): ArgentinaIndicatorSource {
  return {
    sourceId: COUNTRY_RISK_SOURCE_ID,
    datasetId: COUNTRY_RISK_DATASET_ID,
    parserVersion: AMBITO_COUNTRY_RISK_PARSER_VERSION,
    async load(indicator: ArgentinaIndicator): Promise<FetchedIndicatorPoints> {
      if (JSON.stringify(indicator) !== JSON.stringify(DECLARED_COUNTRY_RISK)) {
        throw new CountryRiskSourceError("not_declared");
      }
      const entry = await dependencies.sourceRegistry.findBySourceId(
        COUNTRY_RISK_SOURCE_ID,
      );
      const rights =
        entry && entry.datasets.includes(COUNTRY_RISK_DATASET_ID)
          ? evaluateIngestionRights(entry, {
              storesRawPayload: false,
              storesNormalizedValues: true,
              publicDisplay: false,
            })
          : null;
      if (!rights?.allowed) {
        throw new CountryRiskSourceError("rights_not_approved");
      }

      const response = await fetchOk(
        dependencies.fetch,
        ambitoCountryRiskUrl(dependencies.now().toISOString().slice(0, 10)),
      );
      const parsed = parseAmbitoCountryRisk(
        new TextDecoder().decode(response.body),
      );
      if (!parsed.ok) {
        throw new CountryRiskSourceError("schema_changed", parsed.reason);
      }
      return {
        points: parsed.points,
        observedAt: response.fetchedAt,
        requests: 1,
        bytes: response.byteLength,
        rejectedDays: parsed.conflictingDays,
      };
    },
  };
}
