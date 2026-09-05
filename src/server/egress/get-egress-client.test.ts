import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fallo cerrado de la raíz de composición del egress (`TM-01`, `TM-08`).
 *
 * El transporte real se reemplaza por un espía porque abrir el socket sería otra
 * prueba —y la suite unitaria no tiene red—. Lo que importa acá es si la
 * composición llegó siquiera a construir un transporte: un runtime trabado no
 * debe resolver un nombre ni presentarse ante la fuente.
 */
const httpsTransport = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock("@/server/egress/https-transport", () => ({
  createHttpsTransport: httpsTransport,
}));

const LOCKED_ENVIRONMENTS: ReadonlyArray<
  readonly [string, Record<string, string>]
> = [
  ["un entorno que no declara nada", {}],
  ["`locked` declarado explícitamente", { APP_MODE: "locked" }],
  [
    "`personal` sin límite de acceso privado",
    { APP_MODE: "personal", DATABASE_URL: "postgres://pooled" },
  ],
  [
    "`personal` sin conexión pooled",
    { APP_MODE: "personal", APP_RUNTIME_ACCESS: "local" },
  ],
  [
    "`personal` declarado local dentro de Vercel",
    {
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "local",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    },
  ],
  [
    "una producción de Vercel sin acceso declarado",
    {
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    },
  ],
];

const PERSONAL_ENVIRONMENT = {
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgres://pooled",
  SEC_USER_AGENT: "Portal Financiero owner@example.test",
};

function applyEnvironment(environment: Record<string, string>) {
  for (const name of [
    "APP_MODE",
    "APP_RUNTIME_ACCESS",
    "DATABASE_URL",
    "SEC_USER_AGENT",
    "VERCEL",
    "VERCEL_ENV",
  ]) {
    vi.stubEnv(name, undefined as unknown as string);
  }

  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}

async function loadClient() {
  vi.resetModules();
  httpsTransport.mockClear();

  const [{ getEgressClient }, { isRuntimeLockedError }] = await Promise.all([
    import("@/server/egress/get-egress-client"),
    import("@/modules/configuration/domain/runtime-lock"),
  ]);

  return { getEgressClient, isRuntimeLockedError };
}

describe("composición del cliente de egress", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(LOCKED_ENVIRONMENTS)(
    "se niega a construir con %s",
    async (_scenario, environment) => {
      applyEnvironment({
        ...environment,
        SEC_USER_AGENT: "Portal Financiero owner@example.test",
      });
      const { getEgressClient } = await loadClient();

      expect(() => getEgressClient()).toThrow(
        /The runtime is locked and cannot provide/,
      );
      // La negativa llega antes del transporte: no se resuelve ningún nombre.
      expect(httpsTransport).not.toHaveBeenCalled();
    },
  );

  it("lanza RuntimeLockedError nombrando el recurso pedido", async () => {
    applyEnvironment({ APP_MODE: "locked" });
    const { getEgressClient, isRuntimeLockedError } = await loadClient();

    try {
      getEgressClient();
      expect.unreachable("la composición debía negarse");
    } catch (error) {
      expect(isRuntimeLockedError(error)).toBe(true);
      expect(isRuntimeLockedError(error) && error.resource).toBe(
        "egress client",
      );
    }
  });

  it("construye un cliente en un runtime personal verificado", async () => {
    applyEnvironment(PERSONAL_ENVIRONMENT);
    const { getEgressClient } = await loadClient();

    expect(getEgressClient()).toBeTypeOf("function");
    expect(httpsTransport).toHaveBeenCalledTimes(1);
  });

  it("memoiza el cliente en vez de reconstruirlo por llamada", async () => {
    applyEnvironment(PERSONAL_ENVIRONMENT);
    const { getEgressClient } = await loadClient();

    expect(getEgressClient()).toBe(getEgressClient());
    expect(httpsTransport).toHaveBeenCalledTimes(1);
  });

  it("se niega en modo personal cuando no hay identificación declarada", async () => {
    // Un runtime personal sin `SEC_USER_AGENT` no sale anónimo a la SEC: no
    // sale. La Fair Access no tiene un modo por defecto.
    applyEnvironment({ ...PERSONAL_ENVIRONMENT, SEC_USER_AGENT: "" });
    const { getEgressClient } = await loadClient();

    expect(() => getEgressClient()).toThrow(/user_agent_missing/);
  });

  it("no repite el valor rechazado de la identificación en el error", async () => {
    applyEnvironment({
      ...PERSONAL_ENVIRONMENT,
      SEC_USER_AGENT: "portal-sin-contacto-secreto",
    });
    const { getEgressClient } = await loadClient();

    try {
      getEgressClient();
      expect.unreachable("la composición debía negarse");
    } catch (error) {
      // Nombra la variable y el problema, nunca el valor (`TM-02`).
      expect((error as Error).message).toContain("SEC_USER_AGENT");
      expect((error as Error).message).toContain("no_contact");
      expect((error as Error).message).not.toContain("secreto");
    }
  });
});
