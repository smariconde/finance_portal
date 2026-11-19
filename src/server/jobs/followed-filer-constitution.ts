import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  createLiveCompanyFactsSource,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import {
  FOLLOWED_FILER_ELIGIBILITY_VERSION,
  judgeAnnualReports,
  OWNER_FOLLOWED_INDEX_ID,
  resolveFollowedTicker,
  type FollowedFilerRefusal,
} from "@/modules/universe/domain/followed-filer-eligibility";
import { parseCompanyTickersExchange } from "@/modules/universe/domain/parse-company-tickers-exchange";
import { planUniverseConstitution } from "@/modules/universe/domain/plan-universe-constitution";
import { CONSTITUENT_MATCH_RULE_VERSION } from "@/modules/universe/domain/resolve-constituents";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

export type FollowedFilerConstitution =
  | {
      readonly status: "constituted";
      readonly ruleVersion: typeof FOLLOWED_FILER_ELIGIBILITY_VERSION;
      readonly cik: string;
      readonly legalName: string;
      readonly annualReport: string;
    }
  | { readonly status: "refused"; readonly reason: FollowedFilerRefusal };

const now = () => new Date().toISOString();

/**
 * Constituye en `owner-followed` un ticker que el grafo no tiene (`F6-33`,
 * [ADR 0084](../../../docs/architecture/adr/0084-followed-filers-outside-sp500.md)).
 *
 * Dos requests a la SEC por el egress medido —la tabla ticker→CIK y el
 * `submissions` del CIK que asigna—, con los derechos de `sec-edgar`
 * comprobados antes de la red. El ticker sale de un request del owner, pero
 * sólo elige **una** empresa que la SEC ya asigna y que presenta 10-K: nunca
 * una URL ni un lote. Nada del payload se guarda; sí la identidad normalizada,
 * con la observación como vigencia y disponibilidad, igual que el registro
 * CEDEAR: un corte anterior no la ve.
 */
export async function constituteFollowedFiler(
  ticker: string,
): Promise<FollowedFilerConstitution> {
  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const entry = await registry.findBySourceId(SEC_SOURCE_ID);

  if (
    entry === null ||
    !evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  ) {
    return { status: "refused", reason: "source_unavailable" };
  }

  const fetch = createPacedEgressFetch(
    getMeteredEgressFetch(),
    SEC_REQUEST_PACING,
    { elapsedMs: () => performance.now(), sleep: (ms) => sleep(ms) },
  );

  try {
    const response = await fetch({
      sourceId: SEC_SOURCE_ID,
      url: ASSIGNMENTS_URL,
      accept: "application/json",
    });

    if (response.status !== 200) {
      return { status: "refused", reason: "source_unavailable" };
    }

    let payload: unknown;

    try {
      payload = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      return { status: "refused", reason: "source_unavailable" };
    }

    const table = parseCompanyTickersExchange(payload);

    if (!table.ok) {
      return { status: "refused", reason: "source_unavailable" };
    }

    const assigned = resolveFollowedTicker(ticker, table.assignments);

    if (assigned.status === "refused") {
      return assigned;
    }

    const { constituent } = assigned;
    const probe = await createLiveCompanyFactsSource({ fetch }).probe(
      constituent.normalizedCik,
    );
    const observedAt = now();
    const annual = judgeAnnualReports(probe.filings, observedAt.slice(0, 10));

    if (annual.status === "refused") {
      return annual;
    }

    const repository = getUniverseRepository();
    const state = await repository.loadState({
      indexId: OWNER_FOLLOWED_INDEX_ID,
      limit: 50_000,
    });
    const plan = planUniverseConstitution({
      indexId: OWNER_FOLLOWED_INDEX_ID,
      effectiveAt: observedAt,
      availableAt: observedAt,
      recordedAt: observedAt,
      sourceId: SEC_SOURCE_ID,
      sourceDocumentId: `${FOLLOWED_FILER_ELIGIBILITY_VERSION}:${annual.accessionNumber}`,
      resolution: {
        matchRuleVersion: CONSTITUENT_MATCH_RULE_VERSION,
        resolved: [constituent],
        rejections: [],
      },
      state,
      newId: () => randomUUID(),
      membershipPolicy: "additive",
    });
    const [rejection] = plan.rejections;

    if (rejection !== undefined) {
      return {
        status: "refused",
        reason: rejection.code as FollowedFilerRefusal,
      };
    }

    await repository.applyConstitution(plan);

    return {
      status: "constituted",
      ruleVersion: FOLLOWED_FILER_ELIGIBILITY_VERSION,
      cik: constituent.normalizedCik,
      legalName: constituent.legalName,
      annualReport: annual.accessionNumber,
    };
  } catch (error) {
    // Una negativa de la puerta —cuota, kill switch— no es un ticker inválido.
    if (error instanceof SourceRequestRefusedError) {
      return { status: "refused", reason: "source_unavailable" };
    }

    throw error;
  }
}
