import { describe, expect, it } from "vitest";

import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import { DEMO_IDENTITY_GRAPH } from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import { parseDecimal } from "../domain/decimal-policy";
import type { ValuationRun } from "../domain/valuation-run";
import { buildDemoValuationRun } from "../infrastructure/demo-valuation-run";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import { baseNetIncome, readPeerContext } from "./read-peer-context";

const PIN_AT = "2020-01-01T00:00:00.000Z";
const SUBJECT = buildDemoValuationRun();
const VALUE = parseDecimal(SUBJECT.result!.valuePerShare, "value");

function uuid(index: number, prefix = "5"): string {
  return `${prefix.repeat(8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function peerRun(index: number, asOf = SUBJECT.asOf): ValuationRun {
  return {
    ...SUBJECT,
    valuationRunId: uuid(index, "6"),
    inputHash: String(index).padStart(64, "a"),
    asOf,
    subject: {
      ...SUBJECT.subject,
      legalEntityId: uuid(index),
      securityId: uuid(index, "7"),
      listingId: null,
    },
  };
}

function sector(subjectId: string, code: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: uuid(Number(subjectId.slice(-12)), "8"),
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code,
    label: code,
    validFrom: PIN_AT,
    validTo: null,
    availableAt: PIN_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "b".repeat(64),
    recordedAt: PIN_AT,
  });
}

describe("readPeerContext", () => {
  it("reads each peer's close at its own as_of and groups them by the company's sector", async () => {
    const peers = [
      { run: peerRun(1), sector: "industrials", priceToValue: "1" },
      { run: peerRun(2), sector: "industrials", priceToValue: "2" },
      { run: peerRun(3), sector: "industrials", priceToValue: "3" },
      { run: peerRun(4), sector: "energy", priceToValue: "4" },
      {
        run: peerRun(5, subtractDays(SUBJECT.asOf, 10)),
        sector: "industrials",
        priceToValue: "9",
      },
    ];
    const runs = createInMemoryValuationRunRepository([
      SUBJECT,
      ...peers.map((peer) => peer.run),
    ]);
    const prices = new InMemoryPriceRepository();
    await prices.writeSeries(
      peers.map((peer) => ({
        securityId: peer.run.subject.securityId,
        marketDate: peer.run.asOf,
        close: VALUE.times(peer.priceToValue).toFixed(),
        currency: "USD",
      })),
      [],
    );
    const classifications = new InMemoryClassificationRepository([
      sector(SUBJECT.subject.legalEntityId, "industrials"),
      ...peers.map((peer) =>
        sector(peer.run.subject.legalEntityId, peer.sector),
      ),
    ]);
    const asked: string[] = [];

    const context = await readPeerContext(
      {
        run: SUBJECT,
        series: null,
        comparison: {
          status: "unavailable",
          version: "market-price-comparison-1.0.0",
          reason: "no_close_at_as_of",
          price: null,
        },
        graph: DEMO_IDENTITY_GRAPH,
        subjectOf: () => null,
      },
      {
        runs,
        classifications,
        prices,
        fundamentals: () => ({
          readFundamentals: async (legalEntityId) => {
            asked.push(legalEntityId);
            return [];
          },
          fiscalYearAnchors: async () => [],
        }),
      },
    );

    // El de hace diez días no entra; el de energía cuenta para el modelo.
    expect(context.model).toMatchObject({ status: "median", n: 4 });
    expect(context.company.priceToValue).toEqual({
      status: "null",
      reason: "no_close_at_as_of",
    });
    if (context.sector.status !== "classified") throw new Error("classified");
    expect(context.sector.peers.map((peer) => peer.legalEntityId)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ]);
    expect(
      parseDecimal(
        (context.sector.summaries.priceToValue as { value: string }).value,
        "median",
      )
        .toDecimalPlaces(12)
        .toFixed(),
    ).toBe("2");
    // Sin serie no hay ganancia neta: P/E nulo con motivo, nunca cero.
    expect(context.sector.summaries.priceToEarnings).toMatchObject({
      status: "insufficient",
      n: 0,
      excluded: { net_income_not_reported: 3 },
    });
    // La serie se lee sólo para los pares del sector.
    expect(asked.sort()).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it("takes the base year's net income only from the same fiscal year end", () => {
    const end = SUBJECT.input.normalization.facts.baseFiscalYearEnd;
    const year = (
      fiscalYearEnd: string,
    ): AnnualFundamentals["fiscalYears"][number] => ({
      fiscalYearEnd,
      items: {
        net_income: {
          item: "net_income",
          concept: "us-gaap:NetIncomeLoss",
          value: "123",
          unit: "USD",
          currency: "USD",
          asOf: fiscalYearEnd,
          observationId: uuid(9),
          availableAt: PIN_AT,
          recordedAt: PIN_AT,
          sourceDocumentId: null,
        },
      },
    });
    const series = (fiscalYearEnd: string): AnnualFundamentals => ({
      version: "annual-fundamentals-1.6.0",
      fiscalYears: [year(fiscalYearEnd)],
    });

    expect(baseNetIncome(SUBJECT, series(end))).toEqual({
      value: "123",
      currency: "USD",
    });
    expect(baseNetIncome(SUBJECT, series("1999-12-31"))).toBeNull();
    expect(baseNetIncome(SUBJECT, null)).toBeNull();
  });
});
