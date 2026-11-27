import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  evaluateIngestionRights,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";
import {
  BUENOS_AIRES,
  calendarDateIn,
} from "@/modules/market-calendar/domain/zoned-time";

import {
  AMBITO_COUNTRY_RISK_QUOTE_DATASET,
  AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
  AMBITO_COUNTRY_RISK_QUOTE_URL,
  parseAmbitoCountryRiskQuote,
  type CountryRiskQuote,
} from "../domain/ambito-country-risk-parser";

/** A quote is useful only for its own local session. It is never an ingestion run. */
export async function readCountryRiskQuote(dependencies: {
  readonly source: SourceRegistryEntry | undefined;
  readonly fetch: EgressFetch;
}): Promise<CountryRiskQuote | null> {
  const { source } = dependencies;
  if (
    source?.sourceId !== AMBITO_COUNTRY_RISK_QUOTE_SOURCE ||
    !source.datasets.includes(AMBITO_COUNTRY_RISK_QUOTE_DATASET) ||
    !evaluateIngestionRights(source, {
      storesRawPayload: false,
      storesNormalizedValues: false,
      publicDisplay: false,
    }).allowed
  ) {
    return null;
  }

  const response = await dependencies.fetch({
    sourceId: AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
    url: AMBITO_COUNTRY_RISK_QUOTE_URL,
    accept: "application/json",
  });
  if (response.status !== 200) return null;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return null;
  }

  const quote = parseAmbitoCountryRiskQuote(body);
  return quote?.on === calendarDateIn(response.fetchedAt, BUENOS_AIRES)
    ? { ...quote, observedAt: response.fetchedAt }
    : null;
}
