import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { usMarketGraph } from "@/modules/identity/domain/us-market-graph";
import { parseArgs } from "node:util";

import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import {
  businessExcerptSchema,
  extractBusinessExcerpt,
  verifyBusinessExcerpt,
  SEC_BUSINESS_EXCERPT_VERSION,
} from "@/modules/companies/domain/sec-business-excerpt";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { locateLatestAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getBusinessExcerptRepository } from "@/server/persistence/get-business-excerpt-repository";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/** Preview one filing or record an owner-selected literal quote; sector plans stay offline. */
const { values } = parseArgs({
  options: {
    sector: { type: "string" },
    ticker: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    quote: { type: "string" },
  },
});

if ((values.sector === undefined) === (values.ticker.length === 0)) {
  throw new Error("Indicá --sector <code> o uno o más --ticker <T>.");
}
if (
  values.apply &&
  (values.quote === undefined || values.ticker.length !== 1)
) {
  throw new Error(
    "--apply requiere un solo --ticker y --quote con una frase literal del Item 1.",
  );
}
if (
  values.sector !== undefined &&
  !listSectors().some((sector) => sector.code === values.sector)
) {
  throw new Error("Código de sector desconocido.");
}
if (getConfigHealth(process.env).mode !== "personal") {
  throw new Error("Se requiere un runtime personal.");
}

const now = new Date().toISOString();
const query = pointInTimeQuerySchema.parse({
  effectiveAt: now,
  knownAt: now,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: "source-policy-1.0.0",
});
const universe = getUniverseRepository();
const state = await universe.loadState({
  indexId: SP500_INDEX_ID,
  versions: "all",
});
const graph = usMarketGraph(state.graph);
const identity = createGraphIdentityResolver(() => graph);
const legalEntityIds = new Set<string>();

if (values.sector !== undefined) {
  const { population } = await loadSectorPopulation(
    { indexId: SP500_INDEX_ID, code: values.sector, query },
    { universe, classifications: getClassificationRepository() },
  );
  for (const member of population.members)
    legalEntityIds.add(member.issuerLegalEntityId);
} else {
  for (const ticker of values.ticker) {
    const resolved = await identity.resolve({ symbol: ticker }, query);
    if (resolved.status !== "resolved" || resolved.legalEntityId === null)
      throw new Error(`${ticker}: ticker ambiguo o desconocido.`);
    legalEntityIds.add(resolved.legalEntityId);
  }
}

const targets = [...legalEntityIds]
  .map((legalEntityId) => ({
    legalEntityId,
    companyName:
      graph.legalEntities.find(
        (entity) =>
          entity.legalEntityId === legalEntityId && entity.validTo === null,
      )?.legalName ?? "",
    cik:
      graph.identifierAssignments.find(
        (assignment) =>
          assignment.subjectType === "legal_entity" &&
          assignment.subjectId === legalEntityId &&
          assignment.identifierType === "cik" &&
          assignment.validTo === null &&
          assignment.supersededAt === null,
      )?.normalizedValue ?? null,
  }))
  .filter(
    (
      target,
    ): target is { legalEntityId: string; cik: string; companyName: string } =>
      target.cik !== null,
  );

console.log(
  `${targets.length} emisores con CIK; hasta ${targets.length * 2} solicitudes SEC.`,
);
if (!values.apply && values.sector !== undefined) process.exit(0);

if (values.apply) {
  await syncDeclaredSourceRegistry(
    DEMO_SOURCE_REGISTRY,
    getSourceRegistryRepository(),
  );
}
const source = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === "sec-edgar",
);
const rights =
  source &&
  evaluateIngestionRights(source, {
    storesRawPayload: false,
    storesNormalizedValues: true,
    publicDisplay: false,
  });
if (!rights?.allowed)
  throw new Error(
    `SEC no aprobada: ${rights?.blockedBy.join(", ") ?? "sin fila"}.`,
  );
const budget = await checkSourceBudget(
  getSourceBudgetStore(),
  "sec-edgar",
  targets.length * 2,
  now,
);
if (budget.status !== "allowed")
  throw new Error(describeSourceRefusal("sec-edgar", budget));

const fetch = getSourceEgressFetch(SEC_REQUEST_PACING);
const decoder = new TextDecoder();
const repository = getBusinessExcerptRepository();
for (const target of targets) {
  const submissions = await fetch({
    sourceId: "sec-edgar",
    url: buildSubmissionsUrl(target.cik),
    accept: "application/json",
  });
  if (submissions.status !== 200) {
    console.log(`${target.cik}: submissions ${submissions.status}; omitido`);
    continue;
  }
  const located = locateLatestAnnualReport(
    JSON.parse(decoder.decode(submissions.body)) as unknown,
    target.cik,
    now,
  );
  if (located.status !== "found") {
    console.log(`${target.cik}: sin 10-K conocido; omitido`);
    continue;
  }
  const report = located.report;
  if (
    await repository.hasFiling(
      target.legalEntityId,
      report.accessionNumber,
      SEC_BUSINESS_EXCERPT_VERSION,
    )
  )
    continue;
  const document = await fetch({
    sourceId: "sec-edgar",
    url: report.url,
    accept: "text/html",
  });
  if (document.status !== 200) {
    console.log(`${target.cik}: 10-K ${document.status}; omitido`);
    continue;
  }
  const html = decoder.decode(document.body);
  if (!values.apply) {
    console.log(
      `${target.cik}: candidato sin validar: ${extractBusinessExcerpt(html, target.companyName) ?? "sin candidato"}`,
    );
    console.log(`${target.cik}: filing: ${report.url}`);
    continue;
  }
  const excerpt = values.quote!.trim();
  if (!verifyBusinessExcerpt(html, excerpt)) {
    throw new Error(
      `${target.cik}: la cita no aparece literalmente en el Item 1.`,
    );
  }
  await repository.record(
    businessExcerptSchema.parse({
      ...target,
      accessionNumber: report.accessionNumber,
      acceptedAt: report.acceptedAt,
      documentUrl: report.url,
      excerpt,
      extractVersion: SEC_BUSINESS_EXCERPT_VERSION,
      recordedAt: new Date().toISOString(),
    }),
  );
  console.log(`${target.cik}: ${excerpt}`);
}
