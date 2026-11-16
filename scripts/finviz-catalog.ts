import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { format } from "prettier";

import {
  readFinvizScreenerPage,
  type FinvizFilterCatalogSource,
} from "@/modules/finviz-screener/domain/finviz-screener-page";

/**
 * Regenera el catálogo de filtros del screener de Finviz (`F11-13`) desde una
 * página que el owner guardó con su navegador: el portal nunca baja Finviz.
 *
 *   pnpm finviz:catalog --file ~/Downloads/screener.html          # en seco: cuenta y compara
 *   pnpm finviz:catalog --file ~/Downloads/screener.html --write  # reescribe el JSON
 *
 * Conviene guardar la pestaña «All» (`ft=4`): la página sólo embebe los
 * filtros de la pestaña abierta. La página no se guarda en el repositorio;
 * sólo el catálogo normalizado, sin lo que es Elite. Después de `--write`, el
 * test del catálogo exige subir `FINVIZ_SCREENER_CATALOG_VERSION`.
 */
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    write: { type: "boolean", default: false },
  },
});

const TARGET = resolve(
  "src/modules/finviz-screener/domain/finviz-screener-filters.json",
);

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(24)} ${String(value)}`);
}

function optionKeys(source: FinvizFilterCatalogSource): Set<string> {
  return new Set(
    source.filters.flatMap((filter) =>
      filter.options.map((option) => `${filter.key}_${option.value}`),
    ),
  );
}

async function main(): Promise<void> {
  if (values.file === undefined) {
    console.error("Falta --file con la página guardada del screener.");
    process.exitCode = 2;
    return;
  }
  const reading = readFinvizScreenerPage(await readFile(values.file, "utf8"));
  if (reading.state === "rejected") {
    console.error(`Página rechazada: ${reading.reason} ${reading.detail}`);
    process.exitCode = 1;
    return;
  }
  const { source } = reading;
  const options = source.filters.reduce(
    (total, filter) => total + filter.options.length,
    0,
  );
  log("filtersVersion", source.filtersVersion);
  log("medido", source.measuredOn);
  log("filtros", source.filters.length);
  log("opciones", options);
  log("opciones Elite fuera", reading.eliteOptions);
  for (const exclusion of reading.excluded)
    log(`  fuera ${exclusion.key}`, exclusion.reason);

  const current = JSON.parse(
    await readFile(TARGET, "utf8").catch(() => "null"),
  ) as FinvizFilterCatalogSource | null;
  if (current !== null) {
    const before = optionKeys(current);
    const after = optionKeys(source);
    const added = [...after].filter((key) => !before.has(key));
    const removed = [...before].filter((key) => !after.has(key));
    log("contra el vigente", current.filtersVersion);
    log("  opciones nuevas", added.length);
    log("  opciones que faltan", removed.length);
    for (const key of removed.slice(0, 20)) log("    falta", key);
  }
  if (!values.write) {
    console.log("En seco: nada escrito. --write reescribe el catálogo.");
    return;
  }
  await writeFile(
    TARGET,
    await format(JSON.stringify(source), { parser: "json" }),
    "utf8",
  );
  log("escrito", TARGET);
}

await main();
