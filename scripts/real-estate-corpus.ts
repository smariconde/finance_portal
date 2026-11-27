import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ExportedPage } from "../extensions/listings/capture/messages";
import {
  corpusFileText,
  reducePage,
  sha256Hex,
  type CorpusManifest,
} from "../extensions/listings/corpus/reducer";
import { PORTAL_ADAPTERS } from "../extensions/listings/portals/registry";

/**
 * Congela una página real de un portal como oráculo del adapter (ADR 0089,
 * Decisión 10). La página la exporta el owner con «Exportar página» en el
 * popup de la extensión; acá pasa por `listing-corpus-reducer-1.0.0` y queda
 * fijada por `sha256` en el manifiesto, junto con lo que el adapter lee de
 * ella. El archivo exportado se queda en Descargas: nunca entra crudo.
 *
 *   pnpm inmuebles:corpus --file ~/Downloads/remax-ar-….json --name casa-1            # en seco
 *   pnpm inmuebles:corpus --file ~/Downloads/remax-ar-….json --name casa-1 --write
 *
 * Después de `--write`, revisar el `.expected.json` contra la página: es lo que
 * el test exige de ahora en más.
 */
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    write: { type: "boolean", default: false },
  },
});

const DIRECTORY = resolve("extensions/listings/corpus/files");

async function main(): Promise<void> {
  if (values.file === undefined || values.name === undefined) {
    console.error(
      "Faltan --file con la página exportada y --name (kebab-case).",
    );
    process.exitCode = 2;
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values.name)) {
    console.error("--name tiene que ser kebab-case.");
    process.exitCode = 2;
    return;
  }

  const exported = JSON.parse(
    await readFile(values.file, "utf8"),
  ) as ExportedPage;
  const reduced = reducePage(exported);
  const adapter = PORTAL_ADAPTERS.find(
    (candidate) => candidate.sourceId === reduced.source,
  );
  if (adapter === undefined)
    throw new Error(`no adapter for ${reduced.source}`);
  const reading = adapter.read(reduced.document);

  console.log(`fuente             ${reduced.source}`);
  console.log(`página             ${reduced.document.url}`);
  console.log(`lectura            ${reading.kind}`);
  if (reading.kind === "captures") {
    console.log(`tipo               ${reading.pageKind}`);
    console.log(`avisos             ${reading.captures.length}`);
    console.log(`dejados afuera     ${JSON.stringify(reading.skipped)}`);
  } else if (reading.kind === "rejected") {
    console.log(`motivo             ${reading.reason}`);
  }
  if (exported.adapterVersion !== adapter.version) {
    console.log(
      `aviso              exportada con ${exported.adapterVersion}, leída con ${adapter.version}`,
    );
  }
  if (reading.kind !== "captures") {
    process.exitCode = 1;
    return;
  }

  const kind = reading.pageKind === "listing_detail" ? "detail" : "search";
  const file = `${reduced.source}-${kind}-${values.name}.json`;
  const text = corpusFileText(reduced);
  console.log(`archivo            ${file} (${Buffer.byteLength(text)} bytes)`);
  if (!values.write) {
    console.log("en seco: nada escrito (agregar --write)");
    return;
  }

  await writeFile(resolve(DIRECTORY, file), text);
  await writeFile(
    resolve(DIRECTORY, file.replace(/\.json$/u, ".expected.json")),
    `${JSON.stringify(reading, null, 2)}\n`,
  );
  const manifestPath = resolve(DIRECTORY, "manifest.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as CorpusManifest;
  const entries = [
    ...manifest.entries.filter((entry) => entry.file !== file),
    {
      file,
      sha256: sha256Hex(text),
      source: reduced.source,
      capturedAt: reduced.document.capturedAt,
      reducer: reduced.reducer,
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(
    manifestPath,
    `${JSON.stringify({ corpus: manifest.corpus, entries }, null, 2)}\n`,
  );
  console.log(
    `escrito            ${file}, su .expected.json y el manifiesto (${basename(values.file)} no se copia)`,
  );
}

await main();
