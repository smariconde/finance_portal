import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { SECRET_SENTINELS } from "../tests/e2e/support/runtime";

/**
 * Runner del gate E2E
 * ([ADR 0006](../docs/architecture/adr/0006-e2e-accessibility-harness.md)).
 *
 * Existe por dos motivos que un script de una línea en `package.json` no
 * resuelve en Windows y Linux a la vez:
 *
 * 1. **Telemetría.** El gate afirma que no hay egress, así que el build tampoco
 *    puede reportar uso. `NEXT_TELEMETRY_DISABLED` hay que fijarla en el proceso,
 *    y el prefijo `VAR=valor` de POSIX no funciona en el shell de Windows.
 * 2. **Orden.** Playwright levanta sus `webServer` antes de correr los tests,
 *    y `next start` necesita el build ya terminado. Compilar acá deja ese orden
 *    explícito en vez de depender de cuándo corre un `globalSetup`.
 *
 * El build es uno solo: los dos entornos —personal y trabado— se sirven desde el
 * mismo artefacto, que es justamente lo que el gate verifica.
 *
 * 3. **Secretos en el artefacto** (`F5-02`, `TM-02`). El build corre con los
 *    centinelas en el lugar de las claves —le ganan a `.env.local`, porque
 *    `@next/env` no pisa una variable ya definida— y después se busca cada uno
 *    en todo `.next/`: chunks del cliente, HTML y RSC prerenderizados y código
 *    del servidor. Un valor que aparece ahí quedó horneado en el artefacto, y
 *    el de verdad estaría en el mismo lugar.
 */
const environment = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  ...SECRET_SENTINELS,
};

/** `cache/` es del compilador y no se sirve ni se despliega. */
const SKIPPED_BUILD_DIRECTORIES: ReadonlySet<string> = new Set(["cache"]);

function* buildFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_BUILD_DIRECTORIES.has(entry.name)) {
        yield* buildFiles(full);
      }
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function findSentinelsInBuild(directory: string): string[] {
  const findings: string[] = [];
  let scanned = 0;

  for (const file of buildFiles(directory)) {
    scanned += 1;
    // `latin1` lee cualquier byte sin fallar; un centinela es ASCII.
    const content = readFileSync(file).toString("latin1");

    for (const [name, value] of Object.entries(SECRET_SENTINELS)) {
      if (content.includes(value)) {
        findings.push(`${path.relative(directory, file)}: ${name}`);
      }
    }
  }

  console.log(`Escaneo de secretos: ${scanned} archivos de .next/ revisados.`);

  return findings;
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: environment,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const buildStatus = run("pnpm", ["exec", "next", "build"]);

if (buildStatus !== 0) {
  process.exit(buildStatus);
}

const leaks = findSentinelsInBuild(path.resolve(".next"));

if (leaks.length > 0) {
  // Se nombra el archivo y la variable, nunca el valor.
  console.error(
    `El build horneó ${leaks.length} secreto(s) en el artefacto:\n${leaks.join("\n")}`,
  );
  process.exit(1);
}

// Los argumentos posteriores se reenvían tal cual: `pnpm test:e2e --project
// locked-desktop` o `--grep` funcionan sin duplicar scripts.
process.exit(
  run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]),
);
