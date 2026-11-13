import { parseArgs } from "node:util";

import { sameDatabaseTarget } from "@/modules/configuration/domain/database-target";

/**
 * Las dos cadenas de migraciones del proyecto (ADR 0076). Cada una lee sólo su
 * conexión directa: un destino nunca toma la variable del otro, y se niega si
 * las dos nombran la misma base, porque aplicar `drizzle-trading/` sobre la base
 * de análisis —o al revés— mezclaría lo que la ADR separa.
 */
export type MigrationTarget = {
  readonly name: "analysis" | "trading";
  readonly directUrlVariable: string;
  readonly otherDirectUrlVariable: string;
  readonly migrationsFolder: string;
};

const TARGETS: Readonly<Record<MigrationTarget["name"], MigrationTarget>> = {
  analysis: {
    name: "analysis",
    directUrlVariable: "DATABASE_DIRECT_URL",
    otherDirectUrlVariable: "TRADING_DATABASE_DIRECT_URL",
    migrationsFolder: "drizzle",
  },
  trading: {
    name: "trading",
    directUrlVariable: "TRADING_DATABASE_DIRECT_URL",
    otherDirectUrlVariable: "DATABASE_DIRECT_URL",
    migrationsFolder: "drizzle-trading",
  },
};

/** `--target analysis` (el default, como antes de la ADR 0076) o `--target trading`. */
export function migrationTargetFromArgs(
  args: readonly string[] = process.argv.slice(2),
): MigrationTarget {
  const { values } = parseArgs({
    args: [...args],
    options: { target: { type: "string", default: "analysis" } },
    strict: true,
  });

  const target = TARGETS[values.target as MigrationTarget["name"]];

  if (!target) {
    throw new Error(`Unknown migration target "${values.target}".`);
  }

  return target;
}

export function directUrlFor(
  target: MigrationTarget,
  environment: Readonly<Record<string, string | undefined>>,
  purpose: string,
): string {
  const directUrl = environment[target.directUrlVariable]?.trim();

  if (!directUrl) {
    throw new Error(`${target.directUrlVariable} is required ${purpose}.`);
  }

  const other = environment[target.otherDirectUrlVariable]?.trim();

  if (other && sameDatabaseTarget(directUrl, other)) {
    throw new Error(
      `${target.directUrlVariable} and ${target.otherDirectUrlVariable} name the same database; analysis and trading migrate apart.`,
    );
  }

  return directUrl;
}
