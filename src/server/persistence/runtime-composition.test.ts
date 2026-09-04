import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fallo cerrado de las raíces de composición (`F1-07`, `TM-01` y `TM-04`).
 *
 * Las superficies preguntan antes por `servesRealData()`, así que llegar a un
 * selector con el runtime trabado significa que una ruta intentó leer datos sin
 * declarar que podía. Lo que se prueba acá es que ese camino termina en una
 * excepción y **no** en una conexión abierta: la ADR 0004 dice que un runtime
 * trabado no abre PostgreSQL ni para averiguar si podría.
 *
 * `getRuntimeDatabase` se reemplaza por un espía porque el driver de PostgreSQL
 * es perezoso: construir el cliente no abre el socket, así que esperar a que
 * falle la conexión probaría otra cosa. Lo que importa es si la composición
 * llegó siquiera a pedir la base.
 */
const runtimeDatabase = vi.hoisted(() =>
  vi.fn(() => ({ marker: "fake-drizzle-database" })),
);

vi.mock("@/server/db/runtime-client", () => ({
  getRuntimeDatabase: runtimeDatabase,
  resolveRuntimeDatabaseUrl: vi.fn(() => "postgres://pooled"),
}));

/**
 * Los importadores son estáticos y no un template: `import("./" + file)` obliga
 * a Vite a adivinar el conjunto de módulos posibles y emite un warning en cada
 * corrida. Un mapa explícito además falla en typecheck si un selector se
 * renombra, en vez de fallar recién al ejecutarse.
 */
const SELECTORS = [
  [
    "dataset snapshot",
    () => import("@/server/persistence/get-dataset-snapshot-repository"),
    "getDatasetSnapshotRepository",
  ],
  [
    "ingestion run",
    () => import("@/server/persistence/get-ingestion-run-repository"),
    "getIngestionRunRepository",
  ],
  [
    "observation",
    () => import("@/server/persistence/get-observation-repository"),
    "getObservationRepository",
  ],
  [
    "source registry",
    () => import("@/server/persistence/get-source-registry-repository"),
    "getSourceRegistryRepository",
  ],
  [
    "valuation run",
    () => import("@/server/persistence/get-valuation-run-repository"),
    "getValuationRunRepository",
  ],
] as const;

type SelectorImporter = () => Promise<Record<string, unknown>>;

/**
 * Cada selector memoiza su repositorio en un módulo, así que un escenario de
 * entorno nuevo exige un registro de módulos limpio. Sin esto, el primer test
 * dejaría cacheado el resultado y los demás medirían esa caché.
 *
 * El predicado de error se carga del **mismo** grafo recién reseteado. Importarlo
 * arriba del archivo daría otra identidad de clase y `instanceof` devolvería
 * `false` aunque el selector se hubiera negado correctamente.
 */
async function loadSelector(importer: SelectorImporter, exportName: string) {
  vi.resetModules();
  const loaded = await importer();
  const { isRuntimeLockedError } =
    await import("@/modules/configuration/domain/runtime-lock");

  return {
    getRepository: loaded[exportName] as () => unknown,
    isRuntimeLockedError,
  };
}

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
    // Invertido por la ADR 0008: producción de Vercel **con** protección
    // declarada ahora sirve. Lo que sigue trabado es producción sin declararla,
    // que es el caso del despliegue accidental del repositorio público.
    "una producción de Vercel sin acceso declarado",
    {
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    },
  ],
];

function applyEnvironment(environment: Record<string, string>) {
  for (const name of [
    "APP_MODE",
    "APP_RUNTIME_ACCESS",
    "DATABASE_URL",
    "VERCEL",
    "VERCEL_ENV",
  ]) {
    vi.stubEnv(name, undefined as unknown as string);
  }

  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}

describe("composición de repositorios personales", () => {
  beforeEach(() => {
    runtimeDatabase.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe.each(SELECTORS)("%s", (_label, importer, exportName) => {
    it.each(LOCKED_ENVIRONMENTS)(
      "se niega a construir con %s",
      async (_scenario, environment) => {
        applyEnvironment(environment);
        const { getRepository } = await loadSelector(importer, exportName);

        expect(getRepository).toBeTypeOf("function");
        expect(() => getRepository()).toThrow(
          /The runtime is locked and cannot provide/,
        );
        // No hay repositorio alternativo ni fixture de reemplazo: la negativa es
        // el resultado, no un paso previo a degradar.
        expect(runtimeDatabase).not.toHaveBeenCalled();
      },
    );

    it("lanza RuntimeLockedError nombrando el recurso pedido", async () => {
      applyEnvironment({ APP_MODE: "locked" });
      const { getRepository, isRuntimeLockedError } = await loadSelector(
        importer,
        exportName,
      );

      try {
        getRepository();
        expect.unreachable("el selector debía negarse");
      } catch (error) {
        expect(isRuntimeLockedError(error)).toBe(true);

        if (isRuntimeLockedError(error)) {
          expect(error.resource).not.toHaveLength(0);
          // El mensaje explica la política; no cita valores de configuración
          // (`TM-02`).
          expect(error.message).not.toContain("postgres://");
        }
      }
    });

    it("construye sobre PostgreSQL en un runtime personal verificado", async () => {
      applyEnvironment({
        APP_MODE: "personal",
        APP_RUNTIME_ACCESS: "local",
        DATABASE_URL: "postgres://pooled",
      });
      const { getRepository } = await loadSelector(importer, exportName);

      expect(getRepository()).toBeDefined();
      expect(runtimeDatabase).toHaveBeenCalledTimes(1);
    });

    it("construye en una producción de Vercel con protección declarada", async () => {
      // El punto del slice: sin esto el owner no llega a la aplicación desde
      // fuera de su máquina, porque producción caía a `locked` (ADR 0008).
      applyEnvironment({
        APP_MODE: "personal",
        APP_RUNTIME_ACCESS: "protected",
        DATABASE_URL: "postgres://pooled",
        VERCEL: "1",
        VERCEL_ENV: "production",
      });
      const { getRepository } = await loadSelector(importer, exportName);

      expect(getRepository()).toBeDefined();
      expect(runtimeDatabase).toHaveBeenCalledTimes(1);
    });

    it("memoiza el repositorio en vez de reconstruirlo por llamada", async () => {
      applyEnvironment({
        APP_MODE: "personal",
        APP_RUNTIME_ACCESS: "local",
        DATABASE_URL: "postgres://pooled",
      });
      const { getRepository } = await loadSelector(importer, exportName);

      expect(getRepository()).toBe(getRepository());
      expect(runtimeDatabase).toHaveBeenCalledTimes(1);
    });
  });
});
