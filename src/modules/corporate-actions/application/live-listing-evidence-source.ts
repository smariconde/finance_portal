import {
  buildSubmissionsUrl,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { normalizeCik } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import { parseCompanyTickersExchange } from "@/modules/universe/domain/parse-company-tickers-exchange";

import { parseSecListingIndex } from "../domain/parse-sec-listing-index";
import {
  ListingEvidenceSourceError,
  type ListingEvidenceDocument,
  type ListingEvidenceSource,
} from "./listing-evidence-source";

/**
 * Evidencia de eventos de listing desde la SEC: un request por la tabla y uno por
 * cada filer que diverge o que el owner pidió verificar.
 *
 * Sólo se lee el índice reciente. Los eventos que se buscan son posteriores a la
 * versión registrada, que en este universo tiene semanas; si el índice reciente no
 * la alcanza, la verificación lo rechaza como `evidence_window_not_covered` en vez
 * de recorrer archivos históricos que ningún caso medido necesitó. El ritmo lo
 * pone el espaciador que recibe.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createLiveListingEvidenceSource(dependencies: {
  readonly fetch: EgressFetch;
}): ListingEvidenceSource {
  const { fetch } = dependencies;

  async function fetchJson(
    kind: ListingEvidenceDocument["kind"],
    url: string,
  ): Promise<{ response: EgressFetchResponse; payload: unknown }> {
    let response: EgressFetchResponse;

    try {
      response = await fetch({
        sourceId: SEC_SOURCE_ID,
        url,
        accept: "application/json",
      });
    } catch (cause) {
      throw new ListingEvidenceSourceError("fetch_failed", kind, {
        detail: cause instanceof Error ? cause.message : "egress failed",
      });
    }

    if (response.status !== 200) {
      throw new ListingEvidenceSourceError("unexpected_status", kind, {
        retryable: isRetryableStatus(response.status),
        detail: `status ${response.status}`,
      });
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        response.body,
      );

      return { response, payload: JSON.parse(text) };
    } catch {
      throw new ListingEvidenceSourceError("payload_schema_invalid", kind, {
        detail: "payload is not valid utf-8 json",
      });
    }
  }

  return {
    async loadAssignments(options) {
      const { response, payload } = await fetchJson(
        "company_tickers",
        ASSIGNMENTS_URL,
      );
      const parsed = parseCompanyTickersExchange(payload);

      if (!parsed.ok) {
        throw new ListingEvidenceSourceError(
          "payload_schema_invalid",
          "company_tickers",
          { detail: parsed.code },
        );
      }

      // Absence cannot be inferred from a table whose discarded row may be the
      // symbol we are trying to prove disappeared (ADR 0014).
      if (options?.requireComplete && parsed.rejections.length > 0) {
        throw new ListingEvidenceSourceError(
          "payload_schema_invalid",
          "company_tickers",
          { detail: "assignment_rows_rejected" },
        );
      }

      return {
        assignments: parsed.assignments,
        document: {
          kind: "company_tickers",
          cik: null,
          url: ASSIGNMENTS_URL,
          fetchedAt: response.fetchedAt,
          byteLength: response.byteLength,
          parserVersion: parsed.parserVersion,
        },
      };
    },
    async loadIndex(requestedCik) {
      const cik = normalizeCik(requestedCik);

      if (cik === null) {
        throw new TypeError("The requested CIK is not a valid SEC CIK.");
      }

      const url = buildSubmissionsUrl(cik);
      const { response, payload } = await fetchJson("submissions", url);
      const parsed = parseSecListingIndex(payload);

      if (!parsed.ok) {
        throw new ListingEvidenceSourceError(
          "payload_schema_invalid",
          "submissions",
          { detail: parsed.code },
        );
      }

      if (parsed.cik !== cik) {
        throw new ListingEvidenceSourceError("subject_mismatch", "submissions");
      }

      return {
        index: parsed,
        document: {
          kind: "submissions",
          cik,
          url,
          fetchedAt: response.fetchedAt,
          byteLength: response.byteLength,
          parserVersion: parsed.parserVersion,
        },
      };
    },
  };
}
