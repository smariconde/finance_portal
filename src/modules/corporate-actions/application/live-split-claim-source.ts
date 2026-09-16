import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  parseSecCompanyConcept,
  SEC_COMPANY_CONCEPT_PARSER_VERSION,
} from "@/modules/fundamentals/domain/parse-sec-company-concept";
import { normalizeCik } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";

import { SPLIT_RATIO_CONCEPT } from "../domain/share-basis";
import {
  SplitClaimSourceError,
  type SplitClaimDocument,
  type SplitClaimSource,
} from "./split-claim-source";

/**
 * Ratios de split declarados por un filer, desde `companyconcept`.
 *
 * Un request por empresa. Un `404` es la respuesta de la SEC para un filer que
 * nunca etiquetó el concepto —ExxonMobil Holdings, medido el 2026-09-15— y no un
 * documento roto: se devuelve como `no_claims`. Cualquier otro estado distinto de
 * `200` sí es un fallo. El ritmo lo pone el espaciador que recibe.
 */
export function buildCompanyConceptUrl(
  cik: string,
  concept: { readonly taxonomy: string; readonly concept: string },
): string {
  return `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${concept.taxonomy}/${concept.concept}.json`;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createLiveSplitClaimSource(dependencies: {
  readonly fetch: EgressFetch;
}): SplitClaimSource {
  const { fetch } = dependencies;

  return {
    async load(request) {
      const cik = normalizeCik(request.cik);

      if (cik === null) {
        throw new TypeError("The requested CIK is not a valid SEC CIK.");
      }

      const url = buildCompanyConceptUrl(cik, SPLIT_RATIO_CONCEPT);
      let response: EgressFetchResponse;

      try {
        response = await fetch({
          sourceId: SEC_SOURCE_ID,
          url,
          accept: "application/json",
        });
      } catch (cause) {
        throw new SplitClaimSourceError("fetch_failed", {
          detail: cause instanceof Error ? cause.message : "egress failed",
        });
      }

      const document: SplitClaimDocument = {
        kind: "companyconcept",
        cik,
        url,
        fetchedAt: response.fetchedAt,
        byteLength: response.byteLength,
        parserVersion: SEC_COMPANY_CONCEPT_PARSER_VERSION,
      };

      if (response.status === 404) {
        return {
          status: "no_claims",
          cik,
          fetchedAt: response.fetchedAt,
          documents: [document],
        };
      }

      if (response.status !== 200) {
        throw new SplitClaimSourceError("unexpected_status", {
          retryable: isRetryableStatus(response.status),
          detail: `status ${response.status}`,
        });
      }

      let text: string;

      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
      } catch {
        throw new SplitClaimSourceError("payload_schema_invalid", {
          detail: "body is not valid utf-8",
        });
      }

      const parsed = parseSecCompanyConcept(text, SPLIT_RATIO_CONCEPT);

      if (!parsed.ok) {
        throw new SplitClaimSourceError("payload_schema_invalid", {
          detail: parsed.code,
        });
      }

      if (parsed.cik !== cik) {
        throw new SplitClaimSourceError("subject_mismatch");
      }

      return {
        status: "claims",
        cik,
        claims: parsed.facts,
        rejections: parsed.rejections,
        points: parsed.points,
        fetchedAt: response.fetchedAt,
        documents: [document],
      };
    },
  };
}
