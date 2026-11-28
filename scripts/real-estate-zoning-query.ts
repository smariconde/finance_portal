import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  zoningQueryFileSchema,
  zoningQueryOf,
} from "@/modules/real-estate/domain/zoning-query";
import { getLocationStore } from "@/server/persistence/get-location-store";

/**
 * Carga la consulta de zonificación que el owner hizo al municipio por una
 * parcela (`zoning-query-1.0.0`): la única lectura `official_query`. El
 * archivo vive fuera del repositorio.
 *
 *   pnpm inmuebles:zoning-query --file ~/consulta.json           # valida, no escribe
 *   pnpm inmuebles:zoning-query --file ~/consulta.json --apply   # la guarda como revisión
 *
 * {
 *   "nomenclature": "1101010409014065",
 *   "pattern": "8256-G1", "ordinance": "Ord. 8256/86",
 *   "fos": "0.7", "fot": "1", "heightMaxM": "10.5", "floorsMax": 3,
 *   "consultedOn": "2026-12-01", "reference": "Expediente 123456/26"
 * }
 *
 * La próxima vez que se abra `/inmuebles`, los avisos de esa parcela la leen.
 */
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

if (values.file === undefined) {
  console.error("Falta --file con la consulta en JSON.");
  process.exit(2);
}

const parsed = zoningQueryFileSchema.safeParse(
  JSON.parse(readFileSync(values.file, "utf8")),
);
if (!parsed.success) {
  // Las rutas y los códigos, nunca los valores.
  for (const issue of parsed.error.issues)
    console.error(`${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
  process.exit(2);
}

console.log(
  `parcela ${parsed.data.nomenclature} · ${parsed.data.pattern}: válida`,
);
if (!values.apply) {
  console.log("en seco: usar --apply para guardarla");
  process.exit(0);
}
const revision = await getLocationStore().recordZoningQuery(
  zoningQueryOf(parsed.data, new Date().toISOString()),
);
console.log(`guardada como revisión ${revision}`);
process.exit(0);
