import { z } from "zod";

import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import {
  resolveConstituents,
  type ResolvedConstituent,
} from "./resolve-constituents";
import { declaredForeignFiler } from "./declared-foreign-filers";
import type { CompanyTickerAssignment } from "./universe-source-records";

/**
 * Quién entra al universo fuera del S&P 500 (`F6-33`,
 * [ADR 0084](../../../../docs/architecture/adr/0084-followed-filers-outside-sp500.md)).
 *
 * El owner pide un ticker en `/valuacion` que el grafo no tiene. Entra al
 * índice declarado `owner-followed` sólo si:
 *
 * 1. la tabla ticker→CIK de la SEC lo asigna a **un** emisor en **un** venue
 *    del mapa versionado: los mismos rechazos que constituyen el S&P 500
 *    (`constituent-match-1.0.0`), sin regla propia;
 * 2. su último informe anual original en `submissions` es un `10-K` (o un
 *    `10-KT` de transición) presentado dentro de los 18 meses: un `20-F` o
 *    un `40-F` es un emisor privado extranjero, con otra taxonomía y otros
 *    interinos, y queda para su propia ADR. Un filer cuyo último anual es más
 *    viejo dejó de reportar y no tiene ventana que valuar.
 *
 * Las enmiendas (`/A`) no cuentan: corrigen un informe, no dicen qué presenta
 * el emisor. Un trust de commodities o cripto presenta 10-K y pasa: el
 * selector de método es el que lo niega, nunca esta regla.
 *
 * La 1.1.0 (`F6-55`, ADR 0087) admite un `20-F` sólo si su CIK está en
 * `DECLARED_FOREIGN_FILERS`: el owner decide a quién seguir y en qué moneda se
 * lo valúa. Un 20-F no declarado y cualquier 40-F siguen siendo
 * `foreign_private_issuer`.
 */
export const FOLLOWED_FILER_ELIGIBILITY_VERSION =
  "followed-filer-eligibility-1.1.0";

/** El índice declarado del owner: nunca se cierra por un rebalanceo ajeno. */
export const OWNER_FOLLOWED_INDEX_ID = "owner-followed";

const DOMESTIC_ANNUAL_FORMS: ReadonlySet<string> = new Set(["10-K", "10-KT"]);
const FOREIGN_ANNUAL_FORMS: ReadonlySet<string> = new Set(["20-F", "40-F"]);

/** Dieciocho meses: un ejercicio más el plazo de presentación con holgura. */
export const ANNUAL_REPORT_MAX_AGE_DAYS = 548;

/**
 * Por qué un ticker no entra: los rechazos de `constituent-match-1.0.0`, los
 * del informe anual, los del planner y una fuente que no respondió.
 */
export const followedFilerRefusalSchema = z.enum([
  "duplicate_claim_symbol",
  "issuer_not_assigned",
  "ambiguous_issuer",
  "ambiguous_venue",
  "missing_exchange",
  "unmapped_venue",
  "foreign_private_issuer",
  "no_annual_report",
  "annual_report_stale",
  "issuer_conflict",
  "unresolved_share_class",
  "stale_effective_date",
  "source_unavailable",
]);

export type FollowedFilerRefusal = z.infer<typeof followedFilerRefusalSchema>;

export type FollowedTickerReading =
  | { readonly status: "assigned"; readonly constituent: ResolvedConstituent }
  | { readonly status: "refused"; readonly reason: FollowedFilerRefusal };

/** Paso 1: el ticker en la tabla de la SEC, con las reglas del S&P 500. */
export function resolveFollowedTicker(
  ticker: string,
  assignments: readonly CompanyTickerAssignment[],
): FollowedTickerReading {
  const resolution = resolveConstituents(
    [{ symbol: ticker, name: ticker, sector: null }],
    assignments,
  );
  const [constituent] = resolution.resolved;

  if (constituent !== undefined) {
    return { status: "assigned", constituent };
  }

  return {
    status: "refused",
    reason: resolution.rejections[0]?.code ?? "issuer_not_assigned",
  };
}

export type AnnualReportReading =
  | {
      readonly status: "eligible";
      readonly accessionNumber: string;
      readonly form: string;
      readonly filingDate: string;
    }
  | { readonly status: "refused"; readonly reason: FollowedFilerRefusal };

/** Paso 2: qué informe anual presenta, sobre las filas de `submissions`. */
export function judgeAnnualReports(
  filings: readonly SecFiling[],
  observedOn: string,
  cik: string | null = null,
): AnnualReportReading {
  const annual = filings
    .filter(
      (filing) =>
        DOMESTIC_ANNUAL_FORMS.has(filing.form) ||
        FOREIGN_ANNUAL_FORMS.has(filing.form),
    )
    .toSorted(
      (left, right) =>
        right.filingDate.localeCompare(left.filingDate) ||
        right.accessionNumber.localeCompare(left.accessionNumber),
    );
  const [latest] = annual;

  if (latest === undefined) {
    return { status: "refused", reason: "no_annual_report" };
  }

  const declared = cik === null ? null : declaredForeignFiler(cik);
  if (
    FOREIGN_ANNUAL_FORMS.has(latest.form) &&
    latest.form !== declared?.annualForm
  ) {
    return { status: "refused", reason: "foreign_private_issuer" };
  }

  if (
    latest.filingDate < subtractDays(observedOn, ANNUAL_REPORT_MAX_AGE_DAYS)
  ) {
    return { status: "refused", reason: "annual_report_stale" };
  }

  return {
    status: "eligible",
    accessionNumber: latest.accessionNumber,
    form: latest.form,
    filingDate: latest.filingDate,
  };
}
