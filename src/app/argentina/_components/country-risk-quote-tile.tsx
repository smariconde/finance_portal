"use client";

import { useEffect, useState } from "react";

import { ChangeIndicator } from "@/app/_components/stat-tile";
import type { CountryRiskBlock } from "@/modules/argentina-dashboard/domain/country-risk-block";
import {
  SUMMARY_POLARITY,
  summaryChange,
} from "@/modules/argentina-dashboard/domain/summary-change";
import type { CountryRiskQuote } from "@/modules/macro-series/domain/ambito-country-risk-parser";
import { countryRiskIndexOn } from "@/modules/macro-series/domain/declared-country-risk";
import {
  BUENOS_AIRES,
  calendarDateIn,
} from "@/modules/market-calendar/domain/zoned-time";

import { readArgentinaCountryRiskQuote } from "../actions";
import {
  amount,
  calendarDate,
  dayMonth,
  roundedTo,
  signedAmount,
} from "./format";
import { SummaryTile, type SummaryTileProps } from "./freshness-marks";

const MIN_CHECK_INTERVAL_MS = 5 * 60_000;

export function CountryRiskQuoteTile({
  tile,
  close,
}: {
  readonly tile: SummaryTileProps;
  readonly close: CountryRiskBlock["latest"];
}) {
  const [quote, setQuote] = useState<CountryRiskQuote | null>(null);

  useEffect(() => {
    let lastCheck = 0;
    let active = true;
    async function check() {
      const now = Date.now();
      if (document.hidden || now - lastCheck < MIN_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      const reading = await readArgentinaCountryRiskQuote().then(
        (result) => result.quote,
        () => null,
      );
      if (active) {
        const today = calendarDateIn(new Date().toISOString(), BUENOS_AIRES);
        setQuote(
          (current) => reading ?? (current?.on === today ? current : null),
        );
      }
    }

    void check();
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (quote === null || (close !== null && quote.on <= close.on)) {
    return <SummaryTile {...tile} />;
  }

  const index = countryRiskIndexOn(quote.on);
  const change = summaryChange({
    current: quote,
    previous: index !== null && close?.index?.id === index.id ? close : null,
    cadence: "daily",
    basis: "basis_points",
  });
  const difference =
    change.status === "computed" ? roundedTo(change.difference, 0) : null;

  return (
    <SummaryTile
      {...tile}
      value={`${amount(quote.value)} pb`}
      date={calendarDate(quote.on)}
      detail="Cotización del día · Ámbito"
      observedQuoteAt={quote.observedAt}
      change={
        difference === null || change.status !== "computed" ? null : (
          <ChangeIndicator
            amount={difference}
            text={`${signedAmount(difference)}\u00a0pb`}
            polarity={SUMMARY_POLARITY.countryRisk}
            context={`vs. cierre ${dayMonth(change.previousOn)}`}
          />
        )
      }
    />
  );
}
