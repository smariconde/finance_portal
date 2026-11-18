import {
  RequestBudgetExhaustedError,
  type EgressFetch,
  type EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import {
  earningsEstimatesUrl,
  EARNINGS_ESTIMATES_PARSER_VERSION,
  parseEarningsEstimates,
  type FiscalYearEstimate,
} from "../domain/earnings-estimates-parser";
import { CONSENSUS_DATASET_ID } from "./consensus-repository";

export const CONSENSUS_SOURCE_ID = "alpha-vantage";

export type ConsensusSourceErrorCode =
  | "rights_not_approved"
  | "fetch_failed"
  | "rate_limited"
  | "unexpected_status"
  | "schema_changed";

export class ConsensusSourceError extends Error {
  constructor(
    readonly code: ConsensusSourceErrorCode,
    readonly symbol: string,
    /** The parser's or the door's own code, never a payload value or a URL. */
    readonly detail: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(`${code}${detail ? ` (${detail})` : ""}: ${symbol}`);
    this.name = "ConsensusSourceError";
  }
}

export type FetchedConsensus = {
  readonly symbol: string;
  readonly fiscalYears: readonly FiscalYearEstimate[];
  readonly quartersDropped: number;
  readonly observedAt: string;
  readonly byteLength: number;
};

export interface ConsensusSource {
  readonly sourceId: typeof CONSENSUS_SOURCE_ID;
  readonly parserVersion: typeof EARNINGS_ESTIMATES_PARSER_VERSION;
  load(symbol: string): Promise<FetchedConsensus>;
}

async function fetchOk(
  fetch: EgressFetch,
  symbol: string,
): Promise<EgressFetchResponse> {
  let response: EgressFetchResponse;
  try {
    response = await fetch({
      sourceId: CONSENSUS_SOURCE_ID,
      url: earningsEstimatesUrl(symbol),
      accept: "application/json",
    });
  } catch (error) {
    // A budget or kill-switch refusal keeps its own type for the job.
    if (
      error instanceof SourceRequestRefusedError ||
      error instanceof RequestBudgetExhaustedError
    ) {
      throw error;
    }
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    throw new ConsensusSourceError(
      "fetch_failed",
      symbol,
      code !== null && /^[a-z_]{1,48}$/u.test(code) ? code : null,
    );
  }
  if (response.status === 429 || response.status === 503) {
    throw new ConsensusSourceError(
      "rate_limited",
      symbol,
      null,
      response.retryAfter ?? null,
    );
  }
  if (response.status !== 200) {
    throw new ConsensusSourceError(
      "unexpected_status",
      symbol,
      String(response.status),
    );
  }
  return response;
}

/**
 * One `EARNINGS_ESTIMATES` request per ticker (ADR 0083). The response is
 * normalized and never kept: the rights row declares `rawStorage: restricted`.
 */
export function createLiveConsensusSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): ConsensusSource {
  return {
    sourceId: CONSENSUS_SOURCE_ID,
    parserVersion: EARNINGS_ESTIMATES_PARSER_VERSION,
    async load(symbol) {
      const entry =
        await dependencies.sourceRegistry.findBySourceId(CONSENSUS_SOURCE_ID);
      const rights =
        entry && entry.datasets.includes(CONSENSUS_DATASET_ID)
          ? evaluateIngestionRights(entry, {
              storesRawPayload: false,
              storesNormalizedValues: true,
              publicDisplay: false,
            })
          : null;
      if (!rights?.allowed) {
        throw new ConsensusSourceError("rights_not_approved", symbol);
      }

      const response = await fetchOk(dependencies.fetch, symbol);
      const parsed = parseEarningsEstimates(
        new TextDecoder().decode(response.body),
        symbol,
      );
      if (!parsed.ok) {
        // The plan's limit answers with a 200; it is a quota signal, not a
        // changed schema, and must not poison the subject.
        throw new ConsensusSourceError(
          parsed.reason === "api_rate_limited"
            ? "rate_limited"
            : "schema_changed",
          symbol,
          parsed.reason,
        );
      }
      return {
        symbol,
        fiscalYears: parsed.fiscalYears,
        quartersDropped: parsed.quartersDropped,
        observedAt: response.fetchedAt,
        byteLength: response.byteLength,
      };
    },
  };
}
