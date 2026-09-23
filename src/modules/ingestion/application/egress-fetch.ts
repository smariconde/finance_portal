/**
 * Forma en que un adaptador de fuente ve el egress.
 *
 * Los módulos de dominio y aplicación no importan `src/server/egress/`: reciben
 * esta función ya construida por la raíz de composición, que es la única que
 * puede llegar al cliente real. Un test la reemplaza por un doble y ningún socket
 * se abre (`tests/setup/no-network.ts`).
 */
export type EgressFetchRequest = {
  readonly sourceId: string;
  readonly url: string;
  readonly accept?: string;
};

export type EgressFetchResponse = {
  readonly status: number;
  readonly body: Uint8Array;
  readonly byteLength: number;
  readonly fetchedAt: string;
  /** `Retry-After` de un `429` o `503`, sin interpretar. */
  readonly retryAfter?: string | null;
};

export type EgressFetch = (
  request: EgressFetchRequest,
) => Promise<EgressFetchResponse>;

/**
 * Ritmo de llamadas a una fuente (`TM-10`). Los valores salen de la matriz de
 * cuotas (`docs/data/provider-use-matrix.md`), no de lo que la fuente tolera:
 * para la SEC la Fair Access admite 10 requests/s y el proyecto se fija 2.
 */
export type RequestPacingPolicy = {
  /** Espacio mínimo entre el inicio de dos llamadas. */
  readonly minIntervalMs: number;
  /** Techo de llamadas para la vida de este cliente: una corrida. */
  readonly maxRequests: number;
};

export const SEC_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 500,
  maxRequests: 1000,
});

/**
 * El archivo de constituyentes son dos requests por corrida y un snapshot por
 * día (`docs/data/provider-use-matrix.md`). El techo del proceso deja lugar a un
 * redirect sin habilitar un bucle.
 */
export const DATAHUB_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: 4,
});

/**
 * La serie de precios es **una request por security**, y la fuente no publica
 * cuota, así que el ritmo lo elegimos nosotros por prudencia y no por eco de un
 * límite ajeno ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)):
 * una por segundo, y un techo de proceso que cubre el universo entero con
 * margen para reintentos. El tope **diario** de la fuente es el que manda.
 */
export const PRICES_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: 600,
});

/**
 * El registro CEDEAR es **una request por emisor**: dos por corrida
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 * Ninguno de los dos publica cuota; el techo del proceso deja lugar a un
 * reintento manual sin habilitar un bucle.
 */
export const CEDEAR_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: 4,
});

export class RequestBudgetExhaustedError extends Error {
  readonly sourceId: string;
  readonly maxRequests: number;

  constructor(sourceId: string, maxRequests: number) {
    super(
      `The request budget of ${maxRequests} calls for this run is exhausted (source ${sourceId}).`,
    );
    this.name = "RequestBudgetExhaustedError";
    this.sourceId = sourceId;
    this.maxRequests = maxRequests;
  }
}

export type PacingClock = {
  /** Reloj monótono en milisegundos. */
  readonly elapsedMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export type PacedEgressFetch = EgressFetch & {
  readonly requestCount: () => number;
};

/**
 * Envuelve un `EgressFetch` para que las llamadas salgan de a una, espaciadas y
 * dentro del presupuesto.
 *
 * La concurrencia 1 es por construcción: cada llamada espera a que termine la
 * anterior, aunque el llamador las dispare juntas. El presupuesto se consume al
 * **intentar**, no al tener éxito: una llamada fallida también gastó cuota de la
 * fuente, y agotarlo corta antes de abrir la conexión.
 */
export function createPacedEgressFetch(
  fetch: EgressFetch,
  policy: RequestPacingPolicy,
  clock: PacingClock,
): PacedEgressFetch {
  let count = 0;
  let lastStartedAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const paced = (request: EgressFetchRequest) => {
    const run = async () => {
      if (count >= policy.maxRequests) {
        throw new RequestBudgetExhaustedError(
          request.sourceId,
          policy.maxRequests,
        );
      }

      if (lastStartedAt !== null) {
        const waitMs = lastStartedAt + policy.minIntervalMs - clock.elapsedMs();

        if (waitMs > 0) {
          await clock.sleep(waitMs);
        }
      }

      count += 1;
      lastStartedAt = clock.elapsedMs();

      return fetch(request);
    };

    const result = queue.then(run, run);
    // La cola sigue aunque una llamada falle: un error no puede dejar a las
    // siguientes esperando para siempre.
    queue = result.catch(() => undefined);

    return result;
  };

  return Object.assign(paced, { requestCount: () => count });
}
