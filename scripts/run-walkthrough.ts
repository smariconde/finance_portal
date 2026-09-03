import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/**
 * Harness del walkthrough del owner (`F1-08`).
 *
 * El gate de `F1-07` prueba con Playwright que el runtime personal sirve y que
 * el trabado niega. Este script no repite esa prueba: prepara la sesión para que
 * **una persona** recorra el producto y registre tiempo, bloqueos y confusiones,
 * que es lo único que un test no puede producir.
 *
 * Levanta **un solo build** en dos servidores que se diferencian sólo por su
 * entorno, igual que el gate:
 *
 * - `personal` usa el `.env.local` real del owner, sin sustituciones. La
 *   sesión tiene que correr sobre el runtime que el owner realmente tiene, no
 *   sobre uno fabricado por el harness.
 * - `sin declarar` vacía las variables que deciden el modo, así que el mismo
 *   artefacto queda trabado. `@next/env` no pisa una variable ya presente en
 *   `process.env`, y `hasValue("")` la lee como ausente: es la forma de *quitar*
 *   una variable sin tocar el archivo del owner.
 *
 * Ambos servidores escuchan en `127.0.0.1` a propósito. El runtime personal
 * sirve datos reales y exponerlo a la red local para probarlo desde un teléfono
 * contradiría la frontera de la [ADR 0004](../docs/architecture/adr/0004-personal-first-runtime.md).
 * La tarea mobile se hace con emulación de dispositivo a 390×844; el runbook lo
 * declara como límite del walkthrough, no como detalle de implementación.
 *
 * Protocolo, tareas y plantilla de registro:
 * [docs/runbooks/owner-walkthrough.md](../docs/runbooks/owner-walkthrough.md).
 */
const HOSTNAME = "127.0.0.1";
const PERSONAL_PORT = 3120;
const UNDECLARED_PORT = 3121;

/** Puertos distintos a los del gate E2E (3110/3111): las dos cosas pueden convivir. */
const READINESS_TIMEOUT_MS = 120_000;
const READINESS_INTERVAL_MS = 500;

const shouldBuild = !process.argv.includes("--no-build");

const baseEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  // El walkthrough tampoco reporta uso por red.
  NEXT_TELEMETRY_DISABLED: "1",
};

type ServerSpec = {
  readonly id: string;
  readonly label: string;
  readonly port: number;
  readonly expectation: string;
  readonly environment: NodeJS.ProcessEnv;
};

const servers: readonly ServerSpec[] = [
  {
    id: "personal",
    label: "personal",
    port: PERSONAL_PORT,
    expectation: "sirve shell, diagnóstico y corrida de referencia",
    environment: baseEnvironment,
  },
  {
    id: "undeclared",
    label: "sin declarar",
    port: UNDECLARED_PORT,
    expectation: "queda trabado y no sirve ninguna superficie de datos",
    environment: {
      ...baseEnvironment,
      APP_MODE: "",
      APP_RUNTIME_ACCESS: "",
      DATABASE_URL: "",
      // No se lee en runtime, pero vaciarla deja explícito que este servidor no
      // tiene ninguna ruta hacia la base del owner, ni siquiera la administrativa.
      DATABASE_DIRECT_URL: "",
      VERCEL: "",
      VERCEL_ENV: "",
    },
  },
];

function baseUrlOf(server: ServerSpec): string {
  return `http://${HOSTNAME}:${server.port}`;
}

function build(): number {
  const result = spawnSync("pnpm", ["exec", "next", "build"], {
    stdio: "inherit",
    env: baseEnvironment,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const isWindows = process.platform === "win32";
const children = new Map<string, ChildProcess>();
let shuttingDown = false;

/**
 * `pnpm` es un `.cmd` en Windows, así que hay que pasar por el shell y el hijo
 * directo es `cmd.exe`, no el servidor. Matarlo a él dejaría `next start` vivo y
 * el puerto ocupado hasta el próximo reinicio, justo lo que el runbook promete
 * que no pasa. Por eso cada plataforma corta el **árbol**: `taskkill /t` en
 * Windows y el grupo de procesos —de ahí `detached`— en POSIX.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }

  try {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });

      return;
    }

    process.kill(-child.pid, "SIGTERM");
  } catch {
    // El proceso ya no existe; no hay nada que cortar.
  }
}

function shutdown(code: number): never {
  shuttingDown = true;

  for (const child of children.values()) {
    killTree(child);
  }

  process.exit(code);
}

function start(server: ServerSpec): ChildProcess {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "next",
      "start",
      "--hostname",
      HOSTNAME,
      "--port",
      String(server.port),
    ],
    {
      // El stdout de dos servidores mezclado no le sirve a nadie; el stderr sí,
      // porque es donde aparece un puerto ocupado o un crash de arranque.
      stdio: ["ignore", "ignore", "inherit"],
      env: server.environment,
      shell: isWindows,
      // En POSIX el servidor queda en su propio grupo para poder cortarlo
      // completo. El costo es que `Ctrl+C` de la terminal ya no le llega solo:
      // lo corta el handler de `SIGINT` de este proceso, más abajo.
      detached: !isWindows,
    },
  );

  child.on("exit", (exitCode) => {
    if (shuttingDown) {
      return;
    }

    console.error(
      `\nEl servidor "${server.label}" terminó con código ${exitCode ?? "desconocido"}.`,
    );
    console.error(
      "Un puerto ocupado es la causa más común: cerrá cualquier `next start` en " +
        `${PERSONAL_PORT} o ${UNDECLARED_PORT} y volvé a correr el walkthrough.`,
    );
    shutdown(1);
  });

  children.set(server.id, child);

  return child;
}

async function waitUntilReady(server: ServerSpec): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  const url = baseUrlOf(server);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });

      // Cualquier respuesta HTTP alcanza: el runtime trabado también responde,
      // con su negativa. Lo que se espera acá es que el proceso escuche.
      if (response.status > 0) {
        return;
      }
    } catch {
      // Todavía no escucha.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, READINESS_INTERVAL_MS);
    });
  }

  throw new Error(
    `El servidor "${server.label}" no respondió en ${url} después de ${READINESS_TIMEOUT_MS / 1000} s.`,
  );
}

function announce(): void {
  const lines = [
    "",
    "Walkthrough del owner — F1-08",
    "=============================",
    "",
    "Un mismo build servido bajo dos entornos:",
    "",
  ];

  for (const server of servers) {
    lines.push(
      `  ${server.label.padEnd(13)} ${baseUrlOf(server)}  → ${server.expectation}`,
    );
  }

  lines.push(
    "",
    "Rutas: /  ·  /configuracion  ·  /valuacion/referencia  ·  /ruta-que-no-existe",
    "",
    "Sesión limpia: ventana privada nueva, sin extensiones y sin estado previo",
    "de la sidebar. Mobile: emulación de dispositivo a 390×844; los servidores",
    "escuchan sólo en 127.0.0.1 y no se exponen a la red local.",
    "",
    "Protocolo y plantilla de registro: docs/runbooks/owner-walkthrough.md",
    "",
    "Ctrl+C para terminar.",
    "",
  );

  console.log(lines.join("\n"));
}

if (shouldBuild) {
  const buildStatus = build();

  if (buildStatus !== 0) {
    process.exit(buildStatus);
  }
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});

for (const server of servers) {
  start(server);
}

try {
  await Promise.all(servers.map((server) => waitUntilReady(server)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}

announce();

// Los servidores quedan vivos hasta que el owner corte la sesión.
await new Promise(() => {});
