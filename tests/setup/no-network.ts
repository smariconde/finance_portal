import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Guard de red para unit y contract tests (`F1-07`).
 *
 * `AGENTS.md` exige que estas suites corran sin red: por eso cada proveedor
 * necesita una fixture y el fake provider no importa un SDK. Hasta ahora eso se
 * verificaba archivo por archivo con `vi.spyOn(globalThis, "fetch")`, que sólo
 * cubre el test que se acordó de escribirlo y sólo la ruta de `fetch`.
 *
 * Este setup lo convierte en una propiedad de la suite: cualquier intento de
 * salida —`fetch`, `http`, `https` o un socket TCP directo, que es por donde
 * saldría el driver de PostgreSQL— falla nombrando el destino. Una fixture que
 * silenciosamente empiece a pegarle a la red deja de pasar.
 *
 * No se aplica a `tests/integration/`, que por contrato abre TCP contra una
 * base dedicada; esa suite tiene su propia configuración.
 */
const CONTRACT =
  "Unit and contract tests must run without network access (AGENTS.md). Use a fixture or a test double instead.";

class BlockedNetworkAccessError extends Error {
  constructor(api: string, target: string) {
    super(`Blocked network access via ${api} to "${target}". ${CONTRACT}`);
    this.name = "BlockedNetworkAccessError";
  }
}

function describeFetchTarget(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (input instanceof Request) {
    return input.url;
  }

  return "unknown";
}

/**
 * Lanza sincrónicamente en vez de devolver una promesa rechazada, que es lo que
 * haría `fetch` ante un fallo real de red. Es a propósito: un adaptador escrito
 * como `fetch(url).catch(() => valorPorDefecto)` se tragaría el rechazo y el
 * test seguiría en verde ocultando la salida. Una excepción sincrónica no se
 * puede absorber con un `.catch()` de la cadena.
 */
globalThis.fetch = (input: unknown): never => {
  throw new BlockedNetworkAccessError("fetch()", describeFetchTarget(input));
};

function describeRequestTarget(args: unknown[]): string {
  const [first] = args;

  if (typeof first === "string") {
    return first;
  }

  if (first instanceof URL) {
    return first.toString();
  }

  if (typeof first === "object" && first !== null) {
    const options = first as {
      host?: string;
      hostname?: string;
      port?: number;
    };
    const host = options.hostname ?? options.host;

    if (host) {
      return options.port ? `${host}:${options.port}` : host;
    }
  }

  return "unknown";
}

for (const [name, module] of [
  ["http", http],
  ["https", https],
] as const) {
  for (const method of ["request", "get"] as const) {
    module[method] = ((...args: unknown[]): never => {
      throw new BlockedNetworkAccessError(
        `${name}.${method}()`,
        describeRequestTarget(args),
      );
    }) as never;
  }
}

/**
 * El último recorte: `postgres` y cualquier cliente binario abren un socket
 * directo y no pasan por `http`. Se bloquea el destino remoto y se dejan pasar
 * los sockets locales del propio runner, que usa IPC para hablar con sus
 * workers.
 */
const connect = net.Socket.prototype.connect;

/**
 * `connect` tiene cuatro sobrecargas y ninguna describe un wrapper que las cubra
 * a todas, así que el parche se tipa por su forma real —argumentos variádicos— y
 * se reinstala con una aserción acotada a esta línea.
 */
function patchedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
  const [first] = args;

  if (typeof first === "object" && first !== null) {
    const target = first as { host?: string; port?: number; path?: string };

    // `path` es un socket de dominio local: es el transporte de IPC del runner,
    // no una salida a la red.
    if (target.path === undefined) {
      throw new BlockedNetworkAccessError(
        "net.Socket#connect()",
        `${target.host ?? "unknown"}:${target.port ?? "unknown"}`,
      );
    }
  }

  if (typeof first === "number") {
    throw new BlockedNetworkAccessError(
      "net.Socket#connect()",
      `${args[1] ?? "localhost"}:${first}`,
    );
  }

  return (
    connect as (this: net.Socket, ...rest: unknown[]) => net.Socket
  ).apply(this, args);
}

net.Socket.prototype.connect =
  patchedConnect as unknown as typeof net.Socket.prototype.connect;
