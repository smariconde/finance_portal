import "server-only";

import { randomUUID } from "node:crypto";

import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  canExportSectorRiskSources,
  serializeSectorRiskMatrixCsv,
} from "@/modules/metrics/application/export-sector-risk-matrix";
import {
  loadSectorRiskMatrix,
  SectorRiskMatrixError,
} from "@/modules/metrics/application/load-sector-risk-matrix";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
  "Referrer-Policy": "no-referrer",
} as const;

function refusal(status: number, requestId: string): Response {
  return new Response("Export no disponible.", {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}

/** Descarga personal; una URL directa recibe los mismos guards que la página. */
export async function GET(
  request: Request,
  context: { params: Promise<{ sector: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) return refusal(403, requestId);

  const { sector } = await context.params;
  if (!listSectors().some((entry) => entry.code === sector))
    return refusal(404, requestId);
  if (new URL(request.url).search !== "") return refusal(400, requestId);

  try {
    // El registro declarado en código es la autoridad; PostgreSQL conserva
    // una proyección que puede seguir con la versión previa hasta el próximo job.
    const sources = new Map(
      DEMO_SOURCE_REGISTRY.map((entry) => [entry.sourceId, entry]),
    );
    const now = new Date().toISOString();
    if (!canExportSectorRiskSources(sources, now))
      return refusal(403, requestId);

    const reading = await loadSectorRiskMatrix(
      { sectorCode: sector, asOf: null },
      {
        universe: getUniverseRepository(),
        classifications: getClassificationRepository(),
        prices: getPriceRepository(),
        cedears: getCedearRegistryRepository(),
        today: () => new Date().toISOString().slice(0, 10),
      },
    );
    const csv = serializeSectorRiskMatrixCsv(reading, sources, now);

    console.info(
      "sector risk export served",
      requestId,
      sector,
      reading.matrix.asOf,
      reading.matrix.points.length,
    );

    return new Response(csv, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "X-Request-Id": requestId,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="riesgo-${sector}-${reading.matrix.asOf}.csv"`,
      },
    });
  } catch (error) {
    // Ningún mensaje de DB, ruta interna ni derecho termina en la respuesta.
    console.error(
      "sector risk export failed",
      requestId,
      error instanceof SectorRiskMatrixError
        ? error.code
        : error instanceof Error
          ? error.name
          : typeof error,
    );
    return refusal(503, requestId);
  }
}
