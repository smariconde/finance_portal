import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fallo cerrado de la capa IA (`F5-02`, `TM-01`).
 *
 * El transporte y la base se reemplazan por espías: lo que se prueba es si la
 * composición llegó siquiera a construirlos. Un runtime trabado no debe abrir
 * PostgreSQL ni preparar un socket hacia un modelo, ni para averiguar si podría.
 */
const httpsTransport = vi.hoisted(() => vi.fn(() => vi.fn()));
const runtimeDatabase = vi.hoisted(() =>
  vi.fn(() => ({ marker: "fake-drizzle-database" })),
);

vi.mock("@/server/egress/https-transport", () => ({
  createHttpsTransport: httpsTransport,
}));

vi.mock("@/server/db/runtime-client", () => ({
  getRuntimeDatabase: runtimeDatabase,
  resolveRuntimeDatabaseUrl: vi.fn(() => "postgres://pooled"),
}));

const VARIABLES = [
  "APP_MODE",
  "APP_RUNTIME_ACCESS",
  "DATABASE_URL",
  "SEC_USER_AGENT",
  "OPENROUTER_API_KEY",
  "VERCEL",
  "VERCEL_ENV",
];

const PERSONAL_ENVIRONMENT = {
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgres://pooled",
  OPENROUTER_API_KEY: "sk-or-v1-synthetic-test-credential",
};

const LOCKED_ENVIRONMENTS: ReadonlyArray<
  readonly [string, Record<string, string>]
> = [
  ["un entorno que no declara nada", {}],
  [
    "`locked` con la clave configurada",
    {
      APP_MODE: "locked",
      OPENROUTER_API_KEY: "sk-or-v1-synthetic-test-credential",
    },
  ],
  [
    "`personal` sin límite de acceso privado",
    { ...PERSONAL_ENVIRONMENT, APP_RUNTIME_ACCESS: "public" },
  ],
  [
    "una producción de Vercel sin acceso declarado",
    {
      ...PERSONAL_ENVIRONMENT,
      APP_RUNTIME_ACCESS: "",
      VERCEL: "1",
      VERCEL_ENV: "production",
    },
  ],
];

function applyEnvironment(environment: Record<string, string>) {
  for (const name of VARIABLES) {
    vi.stubEnv(name, undefined as unknown as string);
  }

  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}

async function loadLayer() {
  vi.resetModules();
  httpsTransport.mockClear();
  runtimeDatabase.mockClear();

  const [{ getAiLayer }, { isRuntimeLockedError }] = await Promise.all([
    import("@/server/ai/get-ai-layer"),
    import("@/modules/configuration/domain/runtime-lock"),
  ]);

  return { getAiLayer, isRuntimeLockedError };
}

describe("composición de la capa IA", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(LOCKED_ENVIRONMENTS)(
    "se niega con %s sin abrir la base ni preparar el egress",
    async (_scenario, environment) => {
      applyEnvironment(environment);
      const { getAiLayer, isRuntimeLockedError } = await loadLayer();

      try {
        getAiLayer();
        expect.unreachable("la composición debía negarse");
      } catch (error) {
        expect(isRuntimeLockedError(error)).toBe(true);
        expect(isRuntimeLockedError(error) && error.resource).toBe("ai layer");
        // Ni el valor de la clave ni el nombre de una fuente: la negativa es
        // del runtime, no de la IA.
        expect((error as Error).message).not.toContain("sk-or-v1");
      }

      expect(runtimeDatabase).not.toHaveBeenCalled();
      expect(httpsTransport).not.toHaveBeenCalled();
    },
  );

  it("construye la capa en un runtime personal, con un breaker por corrida", async () => {
    applyEnvironment(PERSONAL_ENVIRONMENT);
    const { getAiLayer } = await loadLayer();
    const layer = getAiLayer();
    const first = layer.runDependencies();
    const second = layer.runDependencies();

    expect(layer).toBe(getAiLayer());
    expect(layer.spend.storage).toBe("personal-postgres");
    expect(first.breaker).not.toBe(second.breaker);
    expect(first.spend).toBe(layer.spend);
    // La clave no viaja por las dependencias: la agrega la puerta.
    expect(JSON.stringify(Object.keys(first))).not.toMatch(/key|credential/i);
  });
});
