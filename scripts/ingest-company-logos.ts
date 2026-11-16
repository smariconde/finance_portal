import { parseArgs } from "node:util";

import { and, eq, isNull, lte, or, gt } from "drizzle-orm";

import { companyLogoSymbol } from "@/modules/configuration/domain/company-logo";
import { getCompanyLogoLoader } from "@/server/company-logos/load-company-logo";
import { getRuntimeDatabase } from "@/server/db/runtime-client";
import {
  indexMemberships,
  listingVersions,
  listingSymbols,
} from "@/server/db/schema";

/** El dry run lee lo guardado y nunca descarga ni escribe. */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true },
    universe: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});
if (values.universe === (values.ticker !== undefined)) {
  throw new Error("Elegí --universe o uno o más --ticker <símbolo>.");
}
// El guard se ejecuta incluso para el dry run antes de construir storage.
const load = getCompanyLogoLoader();
const now = new Date();
const tickers = values.universe
  ? (
      await getRuntimeDatabase()
        .selectDistinct({ symbol: listingSymbols.symbol })
        .from(listingSymbols)
        .innerJoin(
          listingVersions,
          eq(listingVersions.listingId, listingSymbols.listingId),
        )
        .innerJoin(
          indexMemberships,
          eq(indexMemberships.securityId, listingVersions.securityId),
        )
        .where(
          and(
            isNull(listingVersions.supersededAt),
            lte(listingVersions.validFrom, now),
            lte(listingVersions.availableAt, now),
            or(
              isNull(listingVersions.validTo),
              gt(listingVersions.validTo, now),
            ),
            isNull(indexMemberships.supersededAt),
            lte(indexMemberships.validFrom, now),
            lte(indexMemberships.availableAt, now),
            or(
              isNull(indexMemberships.validTo),
              gt(indexMemberships.validTo, now),
            ),
            eq(listingSymbols.symbolType, "ticker"),
            isNull(listingSymbols.supersededAt),
            lte(listingSymbols.validFrom, now),
            lte(listingSymbols.availableAt, now),
            or(isNull(listingSymbols.validTo), gt(listingSymbols.validTo, now)),
          ),
        )
    ).map((row) => row.symbol)
  : values.ticker!;
const symbols = [
  ...new Set(
    tickers.map((ticker) => {
      const symbol = companyLogoSymbol(ticker);
      if (symbol === null) throw new Error("Símbolo de logo inválido.");
      return symbol;
    }),
  ),
].sort();
if (symbols.length > 600) throw new Error("Máximo 600 símbolos por corrida.");
if (!values.apply) {
  console.log(JSON.stringify({ mode: "dry_run", symbols, requests: 0 }));
} else {
  const summary = { stored: 0, missing: 0, unavailable: 0 };
  for (const symbol of symbols) {
    const result = await load(symbol);
    summary[result.state] += 1;
    console.log(
      JSON.stringify({
        symbol,
        state: result.state,
        bytes: result.state === "stored" ? result.logo.bytes.byteLength : 0,
      }),
    );
    // El cliente de egress dura una request por imagen; el CLI espacia entre
    // símbolos sin afectar la reutilización inmediata de una imagen guardada.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(JSON.stringify({ mode: "apply", summary }));
  if (summary.unavailable > 0) process.exitCode = 1;
}
