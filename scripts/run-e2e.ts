import { spawnSync } from "node:child_process";

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
 */
const environment = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
};

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

// Los argumentos posteriores se reenvían tal cual: `pnpm test:e2e --project
// locked-desktop` o `--grep` funcionan sin duplicar scripts.
process.exit(
  run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]),
);
