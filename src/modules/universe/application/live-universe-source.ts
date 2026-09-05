import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";

import { parseCompanyTickersExchange } from "../domain/parse-company-tickers-exchange";
import { parseSp500Constituents } from "../domain/parse-sp500-constituents";

import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  UniverseSourceError,
  type UniverseSourceDocument,
  type UniverseSourceProvider,
  type UniverseSourceSnapshot,
} from "./universe-source-provider";

/**
 * Las dos fuentes reales del universo, detrás del gate de derechos y del cliente
 * de egress.
 *
 * El orden importa y es el que exige el threat model: **primero** los derechos,
 * después la red. Una fuente sin rights row aprobada no genera tráfico, no sólo
 * deja de persistir (`TM-15`). El cliente de egress es un segundo control y no
 * reemplaza a este: la allowlist dice a dónde se puede abrir un socket, el
 * registro dice de qué tenemos derecho a ingerir.
 *
 * Ninguna de las dos descargas se conserva. Se parsea, se hashea y se guarda el
 * grafo; el payload no entra al repositorio ni a la base. Por eso los derechos que
 * se piden son `normalizedStorage` y no `rawStorage`: pedir más de lo que se usa
 * volvería el gate una formalidad.
 */
export const LIVE_UNIVERSE_SOURCE_VERSION = "live-universe-source-1.0.0";

export const SP500_INDEX_ID = "sp500";
export const CONSTITUENTS_SOURCE_ID = "datahub-sp500-pddl";
export const ASSIGNMENTS_SOURCE_ID = "sec-edgar";

/**
 * El registro exige pin por commit para el paquete PDDL: una lista servida desde
 * `main` cambia bajo los pies y la corrida deja de ser reproducible. Se acepta
 * sólo una URL cuyo ref sea un SHA completo.
 */
const PINNED_CONSTITUENTS_URL =
  /^https:\/\/raw\.githubusercontent\.com\/datasets\/s-and-p-500-companies\/[0-9a-f]{40}\/data\/constituents\.csv$/u;

const ASSIGNMENTS_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";

/**
 * Commit del paquete PDDL que esta versión del código constituye.
 *
 * Vive en control de versiones y no se resuelve solo a propósito: el registro de
 * fuentes exige que el pin lo decida el owner. Un runtime que resolviera «el
 * último commit» en cada corrida constituiría un universo distinto cada vez sin
 * que ningún diff lo muestre, y el rebalanceo del índice —que cierra membresías—
 * es exactamente la operación que no debe pasar sin que alguien la mire.
 *
 * Cambiar el pin es un cambio revisable, con su fecha al lado.
 */
export const SP500_CONSTITUENTS_PIN = {
  commit: "3b2bb60e6269439cd75541eded6281c48e7681d1",
  committedAt: "2026-09-05T01:39:10Z",
} as const;

export function buildConstituentsUrl(commit: string): string {
  return `https://raw.githubusercontent.com/datasets/s-and-p-500-companies/${commit}/data/constituents.csv`;
}

/**
 * El universo se deriva y se persiste normalizado; el payload descargado no se
 * conserva y nada de esto se muestra en una superficie anónima.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export type EgressFetch = (request: {
  sourceId: string;
  url: string;
  accept?: string;
}) => Promise<{
  status: number;
  body: Uint8Array;
  byteLength: number;
  fetchedAt: string;
}>;

export type LiveUniverseSourceDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  /** URL pineada del CSV de constituyentes; sin default, se declara por corrida. */
  readonly constituentsUrl: string;
};

async function fetchApproved(
  sourceId: string,
  url: string,
  accept: string,
  dependencies: LiveUniverseSourceDependencies,
): Promise<{ text: string; byteLength: number; fetchedAt: string }> {
  const entry = await dependencies.sourceRegistry.findBySourceId(sourceId);

  if (!entry) {
    throw new UniverseSourceError("source_not_registered", sourceId);
  }

  const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

  if (!rights.allowed) {
    // Fail-closed **antes** del egress: la red no se toca.
    throw new UniverseSourceError(
      "rights_not_approved",
      sourceId,
      rights.blockedBy.join(", "),
    );
  }

  let response: Awaited<ReturnType<EgressFetch>>;

  try {
    response = await dependencies.fetch({ sourceId, url, accept });
  } catch (cause) {
    throw new UniverseSourceError(
      "fetch_failed",
      sourceId,
      cause instanceof Error ? cause.message : "egress failed",
    );
  }

  if (response.status !== 200) {
    throw new UniverseSourceError(
      "unexpected_status",
      sourceId,
      `status ${response.status}`,
    );
  }

  return {
    text: new TextDecoder().decode(response.body),
    byteLength: response.byteLength,
    fetchedAt: response.fetchedAt,
  };
}

export function createLiveUniverseSource(
  dependencies: LiveUniverseSourceDependencies,
): UniverseSourceProvider {
  return {
    indexId: SP500_INDEX_ID,

    async load(): Promise<UniverseSourceSnapshot> {
      if (!PINNED_CONSTITUENTS_URL.test(dependencies.constituentsUrl)) {
        // Se comprueba antes de mirar derechos y antes de la red: una corrida que
        // no puede citar qué versión leyó no es reproducible, y ese defecto no
        // mejora por haber descargado el archivo.
        throw new UniverseSourceError(
          "source_not_pinned",
          CONSTITUENTS_SOURCE_ID,
          "the constituents URL must pin a full commit sha",
        );
      }

      const constituents = await fetchApproved(
        CONSTITUENTS_SOURCE_ID,
        dependencies.constituentsUrl,
        "text/csv",
        dependencies,
      );
      const list = parseSp500Constituents(constituents.text);

      if (!list.ok) {
        throw new UniverseSourceError(
          "parser_broken",
          CONSTITUENTS_SOURCE_ID,
          list.code,
        );
      }

      const assignmentsResponse = await fetchApproved(
        ASSIGNMENTS_SOURCE_ID,
        ASSIGNMENTS_URL,
        "application/json",
        dependencies,
      );

      let payload: unknown;

      try {
        payload = JSON.parse(assignmentsResponse.text);
      } catch {
        throw new UniverseSourceError(
          "parser_broken",
          ASSIGNMENTS_SOURCE_ID,
          "payload is not valid json",
        );
      }

      const assignments = parseCompanyTickersExchange(payload);

      if (!assignments.ok) {
        throw new UniverseSourceError(
          "parser_broken",
          ASSIGNMENTS_SOURCE_ID,
          assignments.code,
        );
      }

      const documents: UniverseSourceDocument[] = [
        {
          sourceId: CONSTITUENTS_SOURCE_ID,
          url: dependencies.constituentsUrl,
          fetchedAt: constituents.fetchedAt,
          byteLength: constituents.byteLength,
          // El hash cubre los registros parseados y no los bytes: dos descargas
          // del mismo commit con distinto final de línea son el mismo universo.
          contentHash: computeContentHash(list.claims),
          parserVersion: list.parserVersion,
          rejectedRows: list.rejections.length,
        },
        {
          sourceId: ASSIGNMENTS_SOURCE_ID,
          url: ASSIGNMENTS_URL,
          fetchedAt: assignmentsResponse.fetchedAt,
          byteLength: assignmentsResponse.byteLength,
          contentHash: computeContentHash(assignments.assignments),
          parserVersion: assignments.parserVersion,
          rejectedRows: assignments.rejections.length,
        },
      ];

      return {
        claims: list.claims,
        assignments: assignments.assignments,
        documents,
      };
    },
  };
}
