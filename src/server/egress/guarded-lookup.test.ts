import dns from "node:dns";

import { describe, expect, it, vi } from "vitest";

import { EgressBlockedError } from "@/server/egress/egress-policy";
import {
  createGuardedLookup,
  type AddressResolver,
  type ResolvedAddress,
} from "@/server/egress/guarded-lookup";

type LookupResult =
  | { error: NodeJS.ErrnoException; address: null; family: null }
  | { error: null; address: string | dns.LookupAddress[]; family?: number };

function runLookup(
  resolve: AddressResolver,
  options: dns.LookupOptions = { all: true },
  hostname = "data.sec.gov",
): Promise<LookupResult> {
  const lookup = createGuardedLookup(resolve);

  return new Promise<LookupResult>((settle) => {
    lookup(hostname, options, (error, address, family) => {
      settle(
        error
          ? { error, address: null, family: null }
          : { error: null, address, family },
      );
    });
  });
}

const publicAddresses: readonly ResolvedAddress[] = [
  { address: "13.32.99.7", family: 4 },
  { address: "2600:9000:2000::1", family: 6 },
];

describe("createGuardedLookup", () => {
  it("passes through every address when all of them are publicly routable", async () => {
    const result = await runLookup(async () => publicAddresses);

    expect(result.error).toBeNull();
    expect(result.address).toEqual([
      { address: "13.32.99.7", family: 4 },
      { address: "2600:9000:2000::1", family: 6 },
    ]);
  });

  it("answers the single-address form when the caller does not ask for all", async () => {
    const result = await runLookup(async () => publicAddresses, { all: false });

    expect(result.address).toBe("13.32.99.7");
    expect(result.family).toBe(4);
  });

  it("blocks a hostname that resolves to a private or loopback address", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.10",
      "169.254.169.254",
      "::1",
      "::ffff:127.0.0.1",
      "fd00::1",
    ]) {
      const result = await runLookup(async () => [{ address, family: 4 }]);

      expect(result.error).toBeInstanceOf(EgressBlockedError);
      expect((result.error as EgressBlockedError).code).toBe(
        "address_not_publicly_routable",
      );
    }
  });

  it("blocks the whole connection when only one of the addresses is private", async () => {
    // Filtrar la mala y conectarse a la buena alcanzaría para no entrar a la red
    // privada, pero dejaría pasar en silencio a un host aprobado que empezó a
    // resolver a `127.0.0.1`. Eso no es un detalle a tolerar: es la señal de que
    // el nombre dejó de ser el que se aprobó.
    const result = await runLookup(async () => [
      { address: "13.32.99.7", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    expect(result.error).toBeInstanceOf(EgressBlockedError);
    expect((result.error as EgressBlockedError).code).toBe(
      "address_not_publicly_routable",
    );
  });

  it("names the category in the message without leaking the address", () => {
    const error = new EgressBlockedError(
      "address_not_publicly_routable",
      "data.sec.gov",
      "resolved to a cloud_metadata address",
    );

    expect(error.message).toContain("cloud_metadata");
    expect(error.message).toContain("data.sec.gov");
  });

  it("blocks an empty answer instead of letting the caller pick a default", async () => {
    const result = await runLookup(async () => []);

    expect((result.error as EgressBlockedError).code).toBe(
      "address_unresolvable",
    );
  });

  it("blocks when the resolver itself fails", async () => {
    const result = await runLookup(async () => {
      throw new Error("ENOTFOUND");
    });

    expect((result.error as EgressBlockedError).code).toBe(
      "address_unresolvable",
    );
  });

  it("rejects a resolver answer that is not a canonical address literal", async () => {
    // Una respuesta con una forma heredada —`0177.0.0.1` es `127.0.0.1` para
    // `inet_aton`— cae en `unparsable`, y lo que no se entiende no se alcanza.
    const result = await runLookup(async () => [
      { address: "0177.0.0.1", family: 4 },
    ]);

    expect((result.error as EgressBlockedError).code).toBe(
      "address_not_publicly_routable",
    );
  });

  it("asks the resolver once per lookup and never touches the network here", async () => {
    const resolve = vi.fn<AddressResolver>(async () => publicAddresses);

    await runLookup(resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("data.sec.gov");
  });
});
