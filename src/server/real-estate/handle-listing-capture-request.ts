import "server-only";

import {
  servesListingCapture,
  type ConfigHealth,
} from "@/modules/configuration/domain/config-health";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import { bearerMatches } from "@/modules/owner-mcp/domain/mcp-access-token";
import type { ListingStore } from "@/modules/real-estate/application/listing-store";
import {
  CAPTURE_EXTENSION_ORIGIN,
  CAPTURE_REQUEST_VERSION,
  captureRequestSchema,
  type CaptureResponse,
} from "@/modules/real-estate/domain/capture-request";
import { parseListingCapture } from "@/modules/real-estate/domain/listing-capture";

/**
 * La «fuente» que cuenta los pedidos de la extensión en el presupuesto
 * diario (ADR 0020): no sale a la red, pero un content script que se
 * desboca no puede llenar Neon, y el owner la frena con
 * `pnpm ingestion:sources --source inmuebles-captura --disable`.
 */
export const LISTING_CAPTURE_SOURCE_ID = "inmuebles-captura";

/** 50 capturas de ~1,5 kB caben con holgura; nada justifica más. */
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export type ListingCaptureRequestDependencies = {
  readonly health: ConfigHealth;
  /** SHA-256 de `CAPTURE_TOKEN`, o `null` si no hay uno válido. */
  readonly tokenDigest: Buffer | null;
  readonly budget: Pick<SourceBudgetStore, "consume">;
  /** Se construye sólo después de las puertas: un rechazo no abre la base. */
  readonly store: () => ListingStore;
  readonly requestId: string;
  readonly clock: () => string;
  readonly log: (entry: ListingCaptureLog) => void;
};

export type ListingCaptureLog = {
  readonly requestId: string;
  readonly event: "listing_capture_request";
  readonly status: number;
  readonly outcome: string;
  readonly counts?: Readonly<Record<string, number>>;
};

function plain(status: number, body: string, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks),
  );
}

/**
 * `POST /api/inmuebles/captura` (ADR 0089, «Envío»; patrón de la ADR 0078),
 * en este orden:
 *
 * 1. sólo `POST`;
 * 2. un runtime que no sirve datos o sin `CAPTURE_TOKEN`: `404`, sin abrir
 *    una base (`TM-01`);
 * 3. el `Origin` tiene que ser exactamente el de la extensión, cuyo ID fija
 *    la `key` del manifest: una página web no puede escribir avisos aunque
 *    robe el token, porque no puede mandar ese `Origin`;
 * 4. sin el token: `401`, comparado en tiempo constante;
 * 5. `application/json` y 256 kB como mucho;
 * 6. el tope diario y el kill switch de `inmuebles-captura`;
 * 7. el esquema cerrado del pedido y, captura por captura, el del contrato:
 *    una captura rechazada no frena a las demás y nombra campo y motivo,
 *    nunca el valor.
 *
 * Todo es idempotente: reenviar una captura ya aplicada es `out_of_order`, así
 * que un fallo a mitad de lote se resuelve reenviando el lote entero.
 */
export async function handleListingCaptureRequest(
  request: Request,
  dependencies: ListingCaptureRequestDependencies,
): Promise<Response> {
  const finish = (
    response: Response,
    outcome: string,
    counts?: Readonly<Record<string, number>>,
  ) => {
    dependencies.log({
      requestId: dependencies.requestId,
      event: "listing_capture_request",
      status: response.status,
      outcome,
      ...(counts === undefined ? {} : { counts }),
    });
    response.headers.set("X-Request-Id", dependencies.requestId);
    return response;
  };

  if (request.method !== "POST") {
    return finish(
      plain(405, "Method not allowed.", { Allow: "POST" }),
      "method_not_allowed",
    );
  }

  if (
    !servesListingCapture(dependencies.health) ||
    dependencies.tokenDigest === null
  ) {
    return finish(plain(404, "Not found."), "not_served");
  }

  if (request.headers.get("origin") !== CAPTURE_EXTENSION_ORIGIN) {
    return finish(plain(403, "Forbidden."), "origin_rejected");
  }

  if (
    !bearerMatches(
      request.headers.get("authorization"),
      dependencies.tokenDigest,
    )
  ) {
    return finish(
      plain(401, "Unauthorized.", { "WWW-Authenticate": "Bearer" }),
      "unauthorized",
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/iu.test(contentType)) {
    return finish(plain(415, "Unsupported media type."), "media_type");
  }

  const text = await readBody(request);
  if (text === null) {
    return finish(plain(413, "Payload too large."), "too_large");
  }

  let verdict: Awaited<ReturnType<typeof dependencies.budget.consume>>;
  try {
    verdict = await dependencies.budget.consume(
      LISTING_CAPTURE_SOURCE_ID,
      dependencies.clock(),
    );
  } catch (error) {
    // Sin poder contar no se escribe: el tope es parte del contrato (`TM-10`).
    console.error(
      "listing capture budget unreadable",
      error instanceof Error ? error.name : typeof error,
    );
    return finish(plain(503, "Capture unavailable."), "budget_unreadable");
  }
  if (verdict.status === "daily_budget_exhausted") {
    const seconds = Math.max(
      1,
      Math.ceil(
        (Date.parse(verdict.resumesAt) - Date.parse(dependencies.clock())) /
          1000,
      ),
    );
    return finish(
      plain(429, "Daily capture budget exhausted.", {
        "Retry-After": String(seconds),
      }),
      verdict.status,
    );
  }
  if (verdict.status !== "allowed") {
    return finish(plain(503, "Capture disabled."), verdict.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return finish(plain(400, "Body is not JSON."), "not_json");
  }
  const parsed = captureRequestSchema.safeParse(json);
  if (!parsed.success) {
    return finish(
      plain(400, "Request does not match the capture contract."),
      "request_invalid",
    );
  }

  const store = dependencies.store();
  const recordedAt = dependencies.clock();
  const results: CaptureResponse["results"][number][] = [];
  const counts: Record<string, number> = {};
  try {
    for (const candidate of parsed.data.captures) {
      const checked = parseListingCapture(candidate);
      if (!checked.ok) {
        results.push({
          outcome: "rejected",
          issues: [...checked.rejection.issues],
        });
        counts.rejected = (counts.rejected ?? 0) + 1;
        continue;
      }
      const outcome = await store.applyCapture(checked.capture, recordedAt);
      results.push({ outcome });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
  } catch (error) {
    // Lo aplicado queda: reenviar el lote lo vuelve `out_of_order`.
    console.error(
      "listing capture store failed",
      error instanceof Error ? error.name : typeof error,
    );
    return finish(plain(503, "Capture unavailable."), "store_failed", counts);
  }

  const body: CaptureResponse = { contract: CAPTURE_REQUEST_VERSION, results };
  return finish(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
    "applied",
    counts,
  );
}
