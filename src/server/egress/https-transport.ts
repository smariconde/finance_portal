import "server-only";

import https from "node:https";

import { EgressBlockedError } from "./egress-policy";
import { createGuardedLookup, type AddressResolver } from "./guarded-lookup";

/**
 * Un único salto HTTP contra un destino ya autorizado. Es el único archivo del
 * proyecto que importa `node:https`.
 *
 * Se usa `node:https` en vez de `fetch` por una razón concreta: `fetch` no expone
 * el `lookup` del socket, así que no hay forma de garantizar que la conexión vaya
 * a la dirección que se validó. Acá el `lookup` guardado se pasa a la request y
 * el pin es real ([ADR 0009](../../../docs/architecture/adr/0009-egress-boundary.md)).
 *
 * El agente es propio y con `keepAlive: false` a propósito. Desde Node 19 el
 * agente global reusa conexiones, y una conexión reusada no vuelve a resolver el
 * nombre: heredaría un socket abierto sin pasar por el guard.
 */
export type EgressHopRequest = {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
};

export type EgressHopResponse = {
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string | null;
  /** Valor crudo de `Retry-After`, si vino; el presupuesto lo interpreta arriba. */
  readonly retryAfter: string | null;
  readonly body: Uint8Array;
};

export type EgressTransport = (
  request: EgressHopRequest,
) => Promise<EgressHopResponse>;

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function createHttpsTransport(
  resolve?: AddressResolver,
): EgressTransport {
  const lookup = createGuardedLookup(resolve);

  return (request) =>
    new Promise<EgressHopResponse>((resolvePromise, reject) => {
      const target = `${request.url.origin}${request.url.pathname}`;
      let settled = false;

      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(deadline);
        clientRequest.destroy();
        agent.destroy();
        reject(
          error instanceof EgressBlockedError
            ? error
            : new EgressBlockedError(
                "transport_error",
                target,
                error instanceof Error ? error.message : "request failed",
              ),
        );
      };

      const succeed = (response: EgressHopResponse): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(deadline);
        agent.destroy();
        resolvePromise(response);
      };

      const agent = new https.Agent({
        keepAlive: false,
        maxSockets: 1,
      });

      const clientRequest = https.request(
        request.url,
        {
          method: "GET",
          agent,
          headers: request.headers,
          lookup,
          minVersion: "TLSv1.2",
        },
        (message) => {
          const declaredLength = Number(
            firstHeader(message.headers["content-length"]) ?? Number.NaN,
          );

          // Si el servidor declara un cuerpo mayor al techo, no hace falta leerlo
          // para saber que no entra.
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > request.maxResponseBytes
          ) {
            message.destroy();
            fail(
              new EgressBlockedError(
                "response_too_large",
                target,
                `declared ${declaredLength} bytes`,
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;

          message.on("data", (chunk: Buffer) => {
            received += chunk.length;

            // El corte es sobre el stream, no sobre el buffer completo: un
            // cuerpo sin `content-length` no puede agotar la memoria del runtime
            // por llegar de a poco.
            if (received > request.maxResponseBytes) {
              message.destroy();
              fail(
                new EgressBlockedError(
                  "response_too_large",
                  target,
                  `exceeded ${request.maxResponseBytes} bytes`,
                ),
              );
              return;
            }

            chunks.push(chunk);
          });

          message.on("error", fail);

          message.on("end", () => {
            succeed({
              status: message.statusCode ?? 0,
              location: firstHeader(message.headers.location),
              contentType: firstHeader(message.headers["content-type"]),
              retryAfter: firstHeader(message.headers["retry-after"]),
              body: new Uint8Array(Buffer.concat(chunks)),
            });
          });
        },
      );

      // Presupuesto de la operación, no de inactividad: un servidor que manda un
      // byte por segundo mantendría vivo el socket para siempre bajo un timeout
      // de idle.
      const deadline = setTimeout(() => {
        fail(new EgressBlockedError("deadline_exceeded", target));
      }, request.timeoutMs);

      clientRequest.setTimeout(request.timeoutMs, () => {
        fail(new EgressBlockedError("deadline_exceeded", target));
      });

      clientRequest.on("error", fail);
      clientRequest.end();
    });
}
