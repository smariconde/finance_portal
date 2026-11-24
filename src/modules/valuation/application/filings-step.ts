import type { RefreshCompanyFactsOutcome } from "@/modules/fundamentals/application/refresh-company-facts";
import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import { isPublishableStatus } from "@/modules/ingestion/domain/ingestion-run";

import {
  filingsStepSchema,
  periodicFilingSchema,
  type FilingsStep,
  type PeriodicFiling,
} from "../domain/valuation-data-step";

/**
 * Lo que una vuelta del refresh (ADR 0022) significa para la valuación
 * (`F6-44`). El job durable ya terminó bien: acá sólo se lee qué vio el sondeo
 * y qué publicó la descarga. Un índice que no se entiende queda en cuarentena y
 * se nombra como fallo, que no bloquea.
 */
export function filingsStepFromRefresh(
  outcome: RefreshCompanyFactsOutcome | null,
): FilingsStep {
  if (outcome === null || outcome.decision === null) {
    return { status: "failed", code: "refresh_not_observed" };
  }

  if (outcome.probeRun.status === "quarantined") {
    return { status: "failed", code: "submissions_quarantined" };
  }

  const { decision } = outcome;
  const latest = periodicOf(decision.latestPeriodic);

  if (outcome.periodicFilingMissing !== null) {
    return filingsStepSchema.parse({
      status: "not_in_companyfacts",
      latest: periodicOf(outcome.periodicFilingMissing),
    });
  }

  const published =
    outcome.ingestion !== null &&
    isPublishableStatus(outcome.ingestion.run.status);

  if (
    !published ||
    decision.reason === "up_to_date" ||
    decision.reason === "no_relevant_filings"
  ) {
    // Sin novedades, o una redescarga que no publicó nada: lo guardado ya era
    // lo último.
    return filingsStepSchema.parse({ status: "current", latest });
  }

  return filingsStepSchema.parse({
    status: "refreshed",
    reason: decision.reason,
    latest,
  });
}

function periodicOf(filing: SecFiling | null): PeriodicFiling | null {
  return filing === null
    ? null
    : periodicFilingSchema.parse({
        form: filing.form,
        acceptedAt: filing.acceptedAt,
        accessionNumber: filing.accessionNumber,
      });
}
