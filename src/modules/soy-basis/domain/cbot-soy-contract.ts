import { z } from "zod";

/**
 * Which CBOT soybean contract Yahoo's `ZS=F` carries on a day (ADR 0071).
 *
 * Measured on 2026-11-04: `ZS=F` is the nearest contract whose last trading
 * day —the business day before the 15th of the contract month— has not passed
 * (121 of 121 verifiable days against `ZSN25`, `ZSX25` and `ZSX26`). It rolls
 * at expiry, so for about two weeks it is a contract in its delivery period:
 * from first notice day —the last business day of the month before the
 * contract month— to its last trading day. Only weekends are skipped; no
 * soybean last trading day or first notice day falls on a CBOT holiday.
 */
export const CBOT_SOY_FRONT_CONTRACT_VERSION = "cbot-soy-front-contract-1.0.0";

/** Listed soybean months and their CME month codes. */
const CONTRACT_MONTHS: readonly (readonly [code: string, month: number])[] = [
  ["F", 1],
  ["H", 3],
  ["K", 5],
  ["N", 7],
  ["Q", 8],
  ["U", 9],
  ["X", 11],
];

export type CbotSoyContract = {
  readonly version: typeof CBOT_SOY_FRONT_CONTRACT_VERSION;
  /** `ZSX26`: root, month code and two-digit year. */
  readonly contract: string;
  readonly contractMonth: string;
  readonly firstNoticeOn: string;
  readonly lastTradeOn: string;
  readonly inDeliveryPeriod: boolean;
};

function isoDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function previousWeekday(date: Date): Date {
  const result = new Date(date);
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result.setUTCDate(result.getUTCDate() - 1);
  }
  return result;
}

function contractDates(year: number, month: number) {
  return {
    lastTradeOn: previousWeekday(isoDate(year, month - 1, 14)),
    // Day 0 of the contract month is the last day of the month before.
    firstNoticeOn: previousWeekday(isoDate(year, month - 1, 0)),
  };
}

export function cbotSoyFrontContract(marketOn: string): CbotSoyContract {
  z.iso.date().parse(marketOn);
  const day = new Date(`${marketOn}T00:00:00Z`);
  const firstYear = day.getUTCFullYear();
  for (let year = firstYear; year <= firstYear + 1; year += 1) {
    for (const [code, month] of CONTRACT_MONTHS) {
      const { lastTradeOn, firstNoticeOn } = contractDates(year, month);
      if (lastTradeOn < day) continue;
      return {
        version: CBOT_SOY_FRONT_CONTRACT_VERSION,
        contract: `ZS${code}${String(year % 100).padStart(2, "0")}`,
        contractMonth: `${year}-${String(month).padStart(2, "0")}`,
        firstNoticeOn: firstNoticeOn.toISOString().slice(0, 10),
        lastTradeOn: lastTradeOn.toISOString().slice(0, 10),
        inDeliveryPeriod: day >= firstNoticeOn,
      };
    }
  }
  // November's last trading day is at most the 14th: January of next year
  // always follows, so the loop cannot end without a contract.
  throw new Error("contract_not_found");
}
