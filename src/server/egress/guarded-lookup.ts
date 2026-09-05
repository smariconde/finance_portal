import "server-only";

import dns from "node:dns";

import { EgressBlockedError } from "./egress-policy";
import { classifyIpAddress } from "./ip-address-policy";

/**
 * Resolución de nombres validada, que es el punto donde `TM-08` se cierra de
 * verdad.
 *
 * Validar la dirección por separado y después llamar a `fetch` deja una ventana:
 * entre la comprobación y la conexión, el nombre puede volver a resolverse —el
 * cliente HTTP hace su propio lookup— y devolver otra dirección. Es el ataque de
 * DNS rebinding, y no lo cierra revisar más rápido.
 *
 * Acá la comprobación **es** la resolución. Esta función se le pasa a
 * `https.request` como su `lookup`, así que el socket sólo puede abrirse contra
 * las direcciones que este código ya aprobó: no queda una segunda resolución sin
 * vigilar.
 */
export type ResolvedAddress = {
  readonly address: string;
  readonly family: number;
};

export type AddressResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export const defaultAddressResolver: AddressResolver = async (hostname) => {
  // `verbatim` conserva el orden que devuelve el sistema en vez de reordenar
  // IPv4 primero; el orden no afecta la decisión, pero sí a qué dirección se
  // conecta, y la que se use tiene que ser una de las validadas.
  const addresses = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  return addresses.map(({ address, family }) => ({ address, family }));
};

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export type GuardedLookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
) => void;

/**
 * Rechaza la conexión completa si **alguna** de las direcciones del nombre no es
 * públicamente ruteable, en vez de filtrar las malas y conectarse a las buenas.
 *
 * Filtrar sería suficiente para no llegar a la red privada, pero dejaría pasar en
 * silencio a un host aprobado que empezó a resolver a `127.0.0.1`. Eso no es un
 * detalle a tolerar: es la señal de que el nombre dejó de ser el que se aprobó,
 * y el resultado correcto es un fallo nombrado, no una conexión que anda.
 */
export function createGuardedLookup(
  resolve: AddressResolver = defaultAddressResolver,
): GuardedLookup {
  return (hostname, options, callback) => {
    void (async () => {
      let resolved: readonly ResolvedAddress[];

      try {
        resolved = await resolve(hostname);
      } catch (cause) {
        callback(
          new EgressBlockedError(
            "address_unresolvable",
            hostname,
            cause instanceof Error ? cause.message : "lookup failed",
          ),
          "",
        );
        return;
      }

      if (resolved.length === 0) {
        callback(new EgressBlockedError("address_unresolvable", hostname), "");
        return;
      }

      for (const { address } of resolved) {
        const classification = classifyIpAddress(address);

        if (classification.category !== "public") {
          callback(
            new EgressBlockedError(
              "address_not_publicly_routable",
              hostname,
              `resolved to a ${classification.category} address`,
            ),
            "",
          );
          return;
        }
      }

      if (options.all === true) {
        callback(
          null,
          resolved.map(({ address, family }) => ({ address, family })),
        );
        return;
      }

      callback(null, resolved[0].address, resolved[0].family);
    })();
  };
}
