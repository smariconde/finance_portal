import { parseArgs } from "node:util";

import { readMacroSeries } from "@/modules/macro-series/application/read-macro-series";
import { readTransformedMacroSeries } from "@/modules/macro-series/application/read-transformed-macro-series";
import { bcraSeriesKey } from "@/modules/macro-series/domain/bcra-monetary-source";
import { findDeclaredBcraSeries } from "@/modules/macro-series/domain/declared-bcra-series";
import {
  CPI_CHAIN_TOLERANCE,
  reconcileCpiChain,
  TRANSFORMATION_KINDS,
  TRANSFORMATION_REFERENCES,
  type TransformationKind,
} from "@/modules/macro-series/domain/series-transformation";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";

/**
 * Lee una serie del BCRA transformada
 * ([ADR 0066](../docs/architecture/adr/0066-macro-real-and-dollar-transformations.md)).
 * Sólo lee la base: no abre la red ni escribe.
 *
 *   pnpm macro:transform --variable 15                      # las tres transformaciones
 *   pnpm macro:transform --variable 15 --kind real_cpi --base 2016-01
 *   pnpm macro:transform --variable 26 --kind usd_wholesale --as-of 2024-12-31T23:59:59Z
 *   pnpm macro:transform --variable 15 --kind real_cer --json
 */
const { values } = parseArgs({
  options: {
    variable: { type: "string" },
    kind: { type: "string", multiple: true, default: [] },
    base: { type: "string" },
    "as-of": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const variableId = Number(values.variable);

if (findDeclaredBcraSeries(variableId) === null) {
  console.error("--variable tiene que ser una del set declarado.");
  process.exit(2);
}

const kinds = (
  values.kind.length === 0 ? TRANSFORMATION_KINDS : values.kind
) as readonly TransformationKind[];

for (const kind of kinds) {
  if (!TRANSFORMATION_KINDS.includes(kind)) {
    console.error(`--kind: ${kind} no es ${TRANSFORMATION_KINDS.join(", ")}.`);
    process.exit(2);
  }
}

const at = values["as-of"] ?? new Date().toISOString();
const query = pointInTimeQuerySchema.parse({
  effectiveAt: at,
  knownAt: at,
  revisionPolicy: "as_known",
  knowledgeBasis: "public_availability",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: "source-policy-1.0.0",
});
const repository = getMacroSeriesRepository();

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const readings = [];

for (const kind of kinds) {
  const reading = await readTransformedMacroSeries(
    {
      variableId,
      kind,
      ...(values.base === undefined ? {} : { baseOn: values.base }),
    },
    query,
    repository,
  );
  readings.push({ kind, reading });

  if (values.json) {
    continue;
  }

  console.log(`\n── ${String(variableId)} · ${kind}`);

  if (reading.status !== "read") {
    log("estado", `${reading.status} (${reading.seriesKey})`);
    continue;
  }

  const result = reading.transformation;
  log("serie", reading.definition.description);
  log("referencia", reading.referenceDefinition.description);

  if (result.status !== "computed") {
    log(
      "estado",
      `${result.status}${"reason" in result ? ` · ${result.reason}` : ""}${"baseOn" in result ? ` · ${result.baseOn}` : ""}`,
    );
    continue;
  }

  const reasons = new Map<string, number>();

  for (const point of result.points) {
    const key = point.reason ?? "computed";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  log(
    "versión",
    [result.version, result.chainVersion].filter(Boolean).join(" · "),
  );
  log("unidad", result.unit);
  log(
    "fechas propias",
    `serie ${result.coverage.nominal?.firstOn ?? "—"} a ${result.coverage.nominal?.lastOn ?? "—"} · referencia ${result.coverage.reference?.firstOn ?? "—"} a ${result.coverage.reference?.lastOn ?? "—"}`,
  );
  log(
    "puntos",
    [...reasons].map(([reason, count]) => `${reason} ${count}`).join(" · "),
  );

  if (result.splice !== null) {
    log(
      "empalme",
      `mayorista desde ${result.splice.on}; antes, cotización BCRA (${result.splice.beforeSplice.firstOn} a ${result.splice.beforeSplice.lastOn}) · salto de nivel ${result.splice.levelGap === null ? "sin cotización ese día" : `${(Number(result.splice.levelGap) * 100).toFixed(2)} %`}`,
    );
  }

  // Un punto por año —el último— y los cinco más recientes.
  const yearly = new Map<string, (typeof result.points)[number]>();

  for (const point of result.points) {
    yearly.set(point.periodOn.slice(0, 4), point);
  }

  const shown = new Set([...yearly.values(), ...result.points.slice(-5)]);

  for (const point of result.points.filter((candidate) =>
    shown.has(candidate),
  )) {
    console.log(
      `   ${point.periodOn}  ${point.nominal.padStart(22)}  →  ${(point.value === null ? point.reason! : Number(point.value).toFixed(2)).padStart(24)}`,
    );
  }

  if (kind === "real_cpi") {
    // La cadena se concilia con el interanual que publica la misma fuente.
    const [monthly, yearOnYear] = await Promise.all(
      [TRANSFORMATION_REFERENCES.real_cpi, 28].map((id) =>
        readMacroSeries(bcraSeriesKey(id), query, repository),
      ),
    );

    if (monthly!.status === "read" && yearOnYear!.status === "read") {
      const check = reconcileCpiChain(monthly!.points, yearOnYear!.points);
      log(
        "conciliación de la cadena",
        `${check.version} · ${check.compared} meses contra la variable 28 · desvío máximo ${check.maxDeviation === null ? "—" : `${(Number(check.maxDeviation) * 100).toFixed(3)} %`} · fuera de ${Number(CPI_CHAIN_TOLERANCE) * 100} %: ${check.outside.length === 0 ? "ninguno" : check.outside.map((entry) => entry.month).join(", ")}`,
      );
    } else {
      log("conciliación de la cadena", "sin la variable 28 al corte");
    }
  }

  for (const caveat of result.caveats) {
    console.log(
      `   ! ${caveat.code} (${caveat.from ?? "inicio"} a ${caveat.to ?? "hoy"}): ${caveat.note}`,
    );
  }
}

if (values.json) {
  console.log(JSON.stringify({ variableId, query, readings }, null, 2));
}

process.exit(0);
