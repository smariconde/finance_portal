import "server-only";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { COUNTRY_RISK_SOURCE_ID } from "@/modules/macro-series/application/live-country-risk-source";
import { readCountryRiskQuote } from "@/modules/macro-series/application/read-country-risk-quote";
import {
  AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
  type CountryRiskQuote,
} from "@/modules/macro-series/domain/ambito-country-risk-parser";
import {
  BUENOS_AIRES,
  calendarDateIn,
} from "@/modules/market-calendar/domain/zoned-time";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";

import { getSourceBudgetStore } from "./get-source-budget-store";

const QUOTE_CACHE_MS = 5 * 60_000;

let cache: {
  day: string;
  until: number;
  quote: CountryRiskQuote | null;
} | null = null;
let active: Promise<CountryRiskQuote | null> | null = null;

/** The request-time personal guard is checked by the action before reaching this cache. */
export async function readArgentinaCountryRiskQuote(): Promise<CountryRiskQuote | null> {
  const now = new Date();
  const day = calendarDateIn(now.toISOString(), BUENOS_AIRES);
  if (cache?.day === day && cache.until > now.getTime()) return cache.quote;
  if (active !== null) return active;

  active = load()
    .catch(() => null)
    .then((quote) => {
      cache = {
        day,
        quote,
        until: Date.now() + (quote === null ? 60_000 : QUOTE_CACHE_MS),
      };
      return quote;
    })
    .finally(() => {
      active = null;
    });
  return active;

  async function load(): Promise<CountryRiskQuote | null> {
    const { control } = await getSourceBudgetStore().readState(
      COUNTRY_RISK_SOURCE_ID,
      now.toISOString(),
    );
    if (control?.status === "disabled") return null;

    return readCountryRiskQuote({
      source: DEMO_SOURCE_REGISTRY.find(
        ({ sourceId }) => sourceId === AMBITO_COUNTRY_RISK_QUOTE_SOURCE,
      ),
      fetch: getSourceEgressFetch({ minIntervalMs: 0, maxRequests: 1 }),
    });
  }
}
