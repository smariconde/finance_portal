import { parseArgs } from "node:util";

import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { computeDilutionBridge } from "@/modules/divergences/domain/dilution-bridge";
import {
  computeDivergenceViews,
  type DivergenceViews,
} from "@/modules/divergences/domain/divergence-views";
import { loadStoredSectorFiscalEndpoints } from "@/server/divergences/load-sector-fiscal-endpoints";

/** Stored-only coverage audit for F8-01. It opens no provider socket. */
const { values } = parseArgs({
  options: {
    sector: { type: "string" },
  },
});

if (
  !values.sector ||
  !listSectors().some((sector) => sector.code === values.sector)
) {
  console.error("Indicá --sector con un código declarado.");
  process.exit(2);
}

const reading = await loadStoredSectorFiscalEndpoints(values.sector);
const counts = {
  members: reading.members.length,
  twoYearPairs: 0,
  fiveYearPairs: 0,
  completeTwoYearPairs: 0,
  completeFiveYearPairs: 0,
};

for (const member of reading.members) {
  const two = member.twoYears;
  const five = member.fiveYears;
  if (two.earlier !== null) counts.twoYearPairs += 1;
  if (five.earlier !== null) counts.fiveYearPairs += 1;
  if (two.latest?.missing.length === 0 && two.earlier?.missing.length === 0)
    counts.completeTwoYearPairs += 1;
  if (five.latest?.missing.length === 0 && five.earlier?.missing.length === 0)
    counts.completeFiveYearPairs += 1;
  const missing = [
    ...new Set([
      ...(two.latest?.missing ?? []),
      ...(two.earlier?.missing ?? []),
      ...(five.latest?.missing ?? []),
      ...(five.earlier?.missing ?? []),
    ]),
  ];
  const pp = (value: string | null) =>
    value === null ? "—" : Number(value).toFixed(2);
  const describe = (views: DivergenceViews) =>
    `${views.horizonYears}Y principal ${views.fundamental.category} brecha ${pp(views.fundamental.gapPp)} sesgo ${pp(views.fundamental.shareCountBiasPp)} pp${views.fundamental.biasMarked ? " ◆" : ""} (${views.marketCapBasis ?? "sin market cap"}); agregada ${views.aggregate.category}; por acción ${views.perShare.category}`;
  const bridge = computeDilutionBridge(two, computeDivergenceViews(two)).latest;
  console.log(
    `  puente ${member.ticker ?? "(sin ticker)"} ${bridge?.fiscalYearEnd ?? "—"}: ${bridge?.numeratorBasis ?? "—"} residuo ${pp(bridge?.residualPct ?? null)} % (cota ${pp(bridge?.roundingBoundPct ?? null)}) ${bridge?.reconciled === null || bridge === null ? (bridge?.reason ?? "") : bridge.reconciled ? "concilia" : "NO concilia"}; dilutivos ${pp(bridge?.dilutivePct ?? null)} %`,
  );
  console.log(
    `${member.ticker ?? "(sin ticker)"}: ${describe(computeDivergenceViews(two))} | ${describe(computeDivergenceViews(five))}`,
  );
  console.log(
    `  ${member.ticker ?? "(sin ticker)"}: 2Y ${two.reason ?? "aligned"}, 5Y ${five.reason ?? "aligned"}; faltan ${missing.join(", ") || "—"}`,
  );
}

console.log(
  JSON.stringify(
    { sector: reading.sectorCode, asOf: reading.query.effectiveAt, ...counts },
    null,
    2,
  ),
);
