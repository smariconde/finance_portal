import { parseArgs } from "node:util";

import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
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
  console.log(
    `${member.ticker ?? "(sin ticker)"}: 2Y ${two.reason ?? "aligned"}, 5Y ${five.reason ?? "aligned"}; faltan ${missing.join(", ") || "—"}`,
  );
}

console.log(
  JSON.stringify(
    { sector: reading.sectorCode, asOf: reading.query.effectiveAt, ...counts },
    null,
    2,
  ),
);
